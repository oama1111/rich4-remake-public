/*
 * 房间集线器 —— 服务器的消息层，与传输无关
 * SPDX-License-Identifier: GPL-3.0-or-later
 * ★ 服务器权威（DEVELOPMENT_PLAN §6 步骤 3）：客户端只发**意图**，服务器用 `Room`
 *   （定序器 + core 镜像）校验、编号、广播；随机数只在镜像里消耗，客户端靠重放同步。
 * ★ 传输层抽象成 `Conn`（只有一个 `send`）：单元测试用内存连接，生产用 `ws` 适配器
 *   （见 index.ts）。这里不 import 任何网络库。
 * ★ 计时（掉线多久换电脑代打）由外部驱动：`sweepDisconnected(now)`；测试可以直接推时间。
 */

import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  type Action,
  type ClientMessage,
  type Rich4Map,
  type RoomInfo,
  type SeatInfo,
  type ServerMessage,
} from '@rich4/core';
import { Room } from './room.ts';

/** 一条到客户端的连接：集线器只会往里 send */
export interface Conn {
  send(msg: ServerMessage): void;
}

export interface HubOptions {
  map: Rich4Map;
  globalMapId: number;
  /** 种子由服务器生成——★ 客户端不得自取（C-DET / 反作弊） */
  seedFor: (roomId: string) => number;
  /** 一桌几个座位（原版 2..4） */
  seatCount?: number;
  /** 真人掉线多久（毫秒）交给电脑代打 @default 30000 */
  takeoverAfterMs?: number;
  /** 客户端每几号 action 上报一次校验和（对应客户端约定，仅用于文档） */
  checksumEvery?: number;
}

interface SeatSlot {
  info: SeatInfo;
  conn: Conn | null;
  /** 断线时刻（毫秒）；在线为 null */
  disconnectedAt: number | null;
  /** 掉线超时后由电脑代打；重连归还 */
  takenOver: boolean;
}

interface Table {
  id: string;
  seats: SeatSlot[];
  room: Room | null;
}

/** 一个客户端连接在集线器里的句柄 */
export interface ClientHandle {
  /** 收到客户端一条消息（已解析为对象；解析失败的直接丢弃即可） */
  onMessage(msg: ClientMessage): void;
  /** 连接断开 */
  onClose(now: number): void;
  /** 加入后才有：房间号与座位号 */
  readonly roomId: string | null;
  readonly seat: number | null;
}

export class RoomHub {
  readonly #opts: Required<Pick<HubOptions, 'seatCount' | 'takeoverAfterMs' | 'checksumEvery'>> & HubOptions;
  readonly #tables = new Map<string, Table>();

  constructor(opts: HubOptions) {
    this.#opts = { seatCount: 4, takeoverAfterMs: 30_000, checksumEvery: 10, ...opts };
  }

  /** 供测试/监控：房间信息 */
  roomInfo(roomId: string): RoomInfo | null {
    const t = this.#tables.get(roomId);
    return t === null || t === undefined ? null : this.#info(t);
  }

  /** 供测试/监控：房间的 core 镜像 */
  room(roomId: string): Room | null {
    return this.#tables.get(roomId)?.room ?? null;
  }

  /** 接一条新连接；之后把它收到的每条消息交给返回的句柄 */
  connect(conn: Conn): ClientHandle {
    let table: Table | null = null;
    let seat: number | null = null;

    const handle: ClientHandle = {
      get roomId() {
        return table?.id ?? null;
      },
      get seat() {
        return seat;
      },
      onMessage: (msg: ClientMessage): void => {
        switch (msg.t) {
          case 'join': {
            if (msg.version !== PROTOCOL_VERSION) {
              conn.send({ t: 'error', message: `协议版本不符：服务器 ${PROTOCOL_VERSION}，客户端 ${msg.version}` });
              return;
            }
            if (table !== null) {
              conn.send({ t: 'error', message: '已经在房间里了' });
              return;
            }
            const t = this.#tableFor(msg.room);
            const s = this.#assignSeat(t, msg.name, conn);
            if (s === null) {
              conn.send({ t: 'error', message: '房间已满' });
              return;
            }
            table = t;
            seat = s;
            conn.send({ t: 'joined', version: PROTOCOL_VERSION, seat: s, room: this.#info(t) });
            this.#broadcast(t, { t: 'room', room: this.#info(t) });
            // 重连：补发开局参数与漏掉的 action
            if (t.room !== null) {
              conn.send({ t: 'start', seed: t.room.seed, globalMapId: t.room.globalMapId, seats: t.seats.map((x) => x.info) });
              const from = msg.since === undefined ? 0 : msg.since + 1;
              for (const b of t.room.since(from)) conn.send({ t: 'action', seq: b.seq, action: b.action });
            }
            return;
          }
          case 'start': {
            if (table === null || seat === null) return;
            if (seat !== 0) {
              conn.send({ t: 'error', message: '只有房主（0 号座）能开局' });
              return;
            }
            if (table.room !== null) return;
            this.#start(table);
            return;
          }
          case 'intent': {
            if (table === null || seat === null || table.room === null) {
              conn.send({ t: 'error', message: '还没开局' });
              return;
            }
            this.#submit(table, seat, msg.action, conn);
            return;
          }
          case 'checksum': {
            if (table === null || seat === null || table.room === null) return;
            const expected = table.room.fingerprintAt(msg.seq);
            if (expected !== null && expected !== msg.hash) {
              this.#broadcast(table, { t: 'desync', seq: msg.seq, expected, got: msg.hash, seat });
            }
            return;
          }
          default:
            return;
        }
      },
      onClose: (now: number): void => {
        if (table === null || seat === null) return;
        const slot = table.seats[seat];
        if (slot === undefined || slot.conn !== conn) return;
        slot.conn = null;
        slot.disconnectedAt = now;
        slot.info.connected = false;
        this.#broadcast(table, { t: 'room', room: this.#info(table) });
      },
    };
    return handle;
  }

  /**
   * 掉线超时的真人座位交给电脑代打（T-073）。由适配器定时调用；返回本次接管的座位。
   * 接管后若正轮到该座位，立刻让电脑把这一回合走完。
   */
  sweepDisconnected(now: number): { roomId: string; seat: number }[] {
    const out: { roomId: string; seat: number }[] = [];
    for (const t of this.#tables.values()) {
      if (t.room === null) continue;
      for (const slot of t.seats) {
        if (slot.info.kind !== 'human' || slot.conn !== null || slot.takenOver) continue;
        if (slot.disconnectedAt !== null && now - slot.disconnectedAt >= this.#opts.takeoverAfterMs) {
          // 託管：镜像里把他改成「真人 + 託管」，之后轮到他就由 core 的 AI 代打
          const r = t.room.submitSystem({ type: 'setAi', player: slot.info.seat, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
          if (!r.ok) continue;
          this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
          slot.takenOver = true;
          out.push({ roomId: t.id, seat: slot.info.seat });
        }
      }
      if (out.some((x) => x.roomId === t.id)) {
        this.#broadcast(t, { t: 'room', room: this.#info(t) });
        this.#driveComputers(t);
      }
    }
    return out;
  }

  // ------------------------------------------------------------
  //  内部
  // ------------------------------------------------------------

  #tableFor(id: string): Table {
    let t = this.#tables.get(id);
    if (t === undefined) {
      t = { id, seats: [], room: null };
      this.#tables.set(id, t);
    }
    return t;
  }

  /** 同名且断线中的座位优先认回；否则占下一个空位；开局后不再放新人 */
  #assignSeat(t: Table, name: string, conn: Conn): number | null {
    const back = t.seats.find((s) => s.info.kind === 'human' && s.info.name === name && s.conn === null);
    if (back !== undefined) {
      back.conn = conn;
      back.disconnectedAt = null;
      back.info.connected = true;
      if (back.takenOver && t.room !== null) {
        // 归还：镜像里把他从託管改回真人（也广播给所有人）
        const r = t.room.submitSystem({ type: 'setAi', player: back.info.seat, whoPlays: WHO_PLAYS_HUMAN });
        if (r.ok) this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
      }
      back.takenOver = false;
      return back.info.seat;
    }
    if (t.room !== null) return null;
    if (t.seats.length >= this.#opts.seatCount) return null;
    const seat = t.seats.length;
    t.seats.push({
      info: { seat, name, character: seat, kind: 'human', connected: true },
      conn,
      disconnectedAt: null,
      takenOver: false,
    });
    return seat;
  }

  #info(t: Table): RoomInfo {
    return { id: t.id, seats: t.seats.map((s) => ({ ...s.info })), started: t.room !== null };
  }

  #broadcast(t: Table, msg: ServerMessage): void {
    for (const s of t.seats) s.conn?.send(msg);
  }

  /** 开局：空座补电脑，建 Room，广播 start，然后若首位就是电脑就让它走 */
  #start(t: Table): void {
    while (t.seats.length < this.#opts.seatCount) {
      const seat = t.seats.length;
      t.seats.push({
        info: { seat, name: `電腦${seat + 1}`, character: seat, kind: 'computer' },
        conn: null,
        disconnectedAt: null,
        takenOver: false,
      });
    }
    const seats = t.seats.map((s) => ({ ...s.info }));
    const room = new Room({
      id: t.id,
      map: this.#opts.map,
      globalMapId: this.#opts.globalMapId,
      seed: this.#opts.seedFor(t.id),
      seats,
    });
    room.start();
    t.room = room;
    this.#broadcast(t, { t: 'start', seed: room.seed, globalMapId: room.globalMapId, seats });
    this.#driveComputers(t);
  }

  #submit(t: Table, seat: number, action: Action, from: Conn | null): void {
    const room = t.room;
    if (room === null) return;
    const r = room.submit(seat, action);
    if (!r.ok) {
      from?.send({ t: 'error', message: `拒绝：${r.reason}` });
      return;
    }
    this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
    this.#driveComputers(t);
  }

  /** 只要轮到电脑座位（含掉线代打的），就用 core 的 AI 替它把 action 一条条提交，直到轮到真人 */
  #driveComputers(t: Table): void {
    const room = t.room;
    if (room === null) return;
    for (let guard = 0; guard < 10_000; guard++) {
      const seat = room.currentSeat;
      const slot = t.seats[seat];
      if (slot === undefined) return;
      const computerControlled = slot.info.kind === 'computer' || slot.takenOver;
      if (!computerControlled) return;
      const action = room.decideForCurrent();
      if (action === null) return;
      const r = room.submit(seat, action);
      if (!r.ok) return;
      this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
    }
  }
}
