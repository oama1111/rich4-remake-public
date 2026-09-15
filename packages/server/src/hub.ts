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
  LOBBY_CHARACTER_COUNT,
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  characterTaken,
  isLobbyCharacter,
  isLobbyMapId,
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
  /**
   * ★ Q-NET-2 换地图：按全局地图号取地图结构。
   *
   * 不给（测试的缺省）＝ 服务器只端得出 `globalMapId` 那一张，
   *   换别的图会被拒（错误信息是「伺服器沒有這張地圖」）。
   * 真服务器（`cli.ts`）给一份按需读 `map.mkf` 的实现。
   */
  mapFor?: (globalMapId: number) => Rich4Map | null;
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
  /**
   * ★ Q-NET-2 房间地图（大厅设置）。开局前只有房主能改；开局的 `newGame`
   *   用的就是它 —— **不看**任何客户端上报的本地设置。
   */
  globalMapId: number;
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
            if (typeof msg.action !== 'object' || msg.action === null || typeof msg.action.type !== 'string') {
              conn.send({ t: 'error', message: '拒绝：action 格式不对' });
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
          // ★ Q-NET-1 失步自愈：把**完整** action 日志重放给请求者。
          //   权限只认 `join` 时绑在这条连接上的座位（下面的所有权检查），
          //   消息体里没有任何座位/名字可填 —— 所以索取不到别人的重放。
          //   也谈不上额外泄密：这条连接本来就收得到每一条广播 action。
          case 'resync': {
            if (table === null || seat === null || table.room === null) {
              conn.send({ t: 'error', message: '還沒開局' });
              return;
            }
            if (table.seats[seat]?.conn !== conn) {
              // 掉线后沿用旧句柄、或别的连接想蹭同一个座位，都在这里挡住
              conn.send({ t: 'error', message: '拒絕：這條連接不是該座位' });
              return;
            }
            const log = table.room.since(0);
            // ⚠️ 只回请求者，不广播（重放是给一个人的）
            conn.send({
              t: 'replay',
              seed: table.room.seed,
              globalMapId: table.room.globalMapId,
              seats: table.seats.map((s) => ({ ...s.info })),
              through: log.length === 0 ? -1 : log[log.length - 1]!.seq,
              actions: log.map((b) => ({ seq: b.seq, action: b.action })),
            });
            return;
          }
          // ★ Q-NET-2 大厅设置：改**自己**座位的角色。
          //   座位号取自 `join` 时绑在这条连接上的 `seat`，消息体里没有座位号 ——
          //   所以「改别人的角色」不是被拒绝，而是根本表达不出来。
          case 'setCharacter': {
            if (table === null || seat === null) {
              conn.send({ t: 'error', message: '還沒進房' });
              return;
            }
            this.#setCharacter(table, seat, msg.character, conn);
            return;
          }
          // ★ Q-NET-2 大厅设置：换房间地图。只有房主（0 号座）。
          case 'setMap': {
            if (table === null || seat === null) {
              conn.send({ t: 'error', message: '還沒進房' });
              return;
            }
            this.#setMap(table, seat, msg.globalMapId, conn);
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
      t = { id, seats: [], room: null, globalMapId: this.#opts.globalMapId };
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
      // ★ 角色不能再无脑取 `seat` 了（Q-NET-2）：前面进来的人可能已经把
      //   这个号改成别的，得挑一个**没人占**的；否则一开局就有人撞车。
      info: { seat, name, character: this.#freeCharacter(t.seats), kind: 'human', connected: true },
      conn,
      disconnectedAt: null,
      takenOver: false,
    });
    return seat;
  }

  /**
   * 挑一个还没被占的角色号（Q-NET-2「角色不能撞车」）。
   *
   * ★ 取**最小空号**而不是随机：服务器是权威，同输入必须同结果 ——
   *   随机补角会让「同一房、同一串消息」在不同机器上补出不同角色。
   *   （单机那套 `fillComputerSeats` 用随机，是因为它没有联机一致性问题。）
   */
  #freeCharacter(seats: readonly SeatSlot[]): number {
    const used = new Set(seats.map((s) => s.info.character));
    for (let c = 0; c < LOBBY_CHARACTER_COUNT; c++) if (!used.has(c)) return c;
    // 座位数（≤4）远小于角色数（12），走不到这里；给个合法号别返回 undefined
    return seats.length % LOBBY_CHARACTER_COUNT;
  }

  #info(t: Table): RoomInfo {
    return {
      id: t.id,
      seats: t.seats.map((s) => ({ ...s.info })),
      started: t.room !== null,
      // ★ Q-NET-2：地图是房间级设置，跟着 `room` 广播一起同步给所有人
      globalMapId: t.globalMapId,
    };
  }

  /** 按全局地图号取地图；没配 `mapFor` 就只认开局那一张 */
  #mapFor(globalMapId: number): Rich4Map | null {
    const { mapFor } = this.#opts;
    if (mapFor !== undefined) return mapFor(globalMapId) ?? null;
    return globalMapId === this.#opts.globalMapId ? this.#opts.map : null;
  }

  /**
   * Q-NET-2：改自己座位的角色。**服务器校验，不信客户端**。
   *
   * 三道闸，缺一不可：
   *   ① 未开局 —— 角色在 `newGame` 里就烧进局面了，开局后再改会让
   *      服务器镜像与各客户端当场分歧（而且没有任何 action 能表达这次改动）；
   *   ② 角色号合法（`isLobbyCharacter`）—— 越界号会在 `newGame` 里查出
   *      一张不存在的头像，甚至越界读角色表；
   *   ③ 不与别人撞车（`characterTaken`）—— 同房角色唯一。
   *
   * 只有「过闸」才改 `Table` 并广播；被拒时一个字都不动。
   */
  #setCharacter(t: Table, seat: number, character: unknown, conn: Conn): void {
    if (t.room !== null) {
      conn.send({ t: 'error', message: '已開局：角色不能再改' });
      return;
    }
    if (!isLobbyCharacter(character)) {
      conn.send({ t: 'error', message: '拒絕：角色編號不合法' });
      return;
    }
    if (characterTaken(t.seats.map((s) => s.info), character, seat)) {
      conn.send({ t: 'error', message: '拒絕：這個角色已經有人選了' });
      return;
    }
    const slot = t.seats[seat];
    // 座位必须还是这条连接的（掉线后旧句柄、或已被别人认回）
    if (slot === undefined || slot.conn !== conn) return;
    if (slot.info.character === character) return; // 幂等：没变就不广播
    slot.info.character = character;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  /**
   * Q-NET-2：换房间地图。**只有房主（0 号座）、只有未开局**，
   * 且服务器自己得真有这张图 —— 三条都过才改并广播。
   *
   * ⚠️ 地图是**房间级**设置（不是每人的本地设置）：服务器认下之后
   *   所有人下一次收到 `room` 就都看到新图，开局也照它 `newGame`。
   */
  #setMap(t: Table, seat: number, globalMapId: unknown, conn: Conn): void {
    if (t.room !== null) {
      conn.send({ t: 'error', message: '已開局：地圖不能再改' });
      return;
    }
    if (seat !== 0) {
      conn.send({ t: 'error', message: '只有房主（0 號座）能換地圖' });
      return;
    }
    if (!isLobbyMapId(globalMapId)) {
      conn.send({ t: 'error', message: '拒絕：地圖編號不合法' });
      return;
    }
    if (this.#mapFor(globalMapId) === null) {
      conn.send({ t: 'error', message: `拒絕：伺服器沒有地圖 ${globalMapId}` });
      return;
    }
    if (t.globalMapId === globalMapId) return; // 幂等
    t.globalMapId = globalMapId;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  #broadcast(t: Table, msg: ServerMessage): void {
    for (const s of t.seats) s.conn?.send(msg);
  }

  /**
   * 开局：空座补电脑，建 Room，广播 start，然后若首位就是电脑就让它走。
   *
   * ★ Q-NET-2：这里的**每一个字段都取自服务器手上的大厅设置**
   *   （`t.seats` 的角色 + `t.globalMapId`），不读客户端任何本地设置。
   */
  #start(t: Table): void {
    while (t.seats.length < this.#opts.seatCount) {
      const seat = t.seats.length;
      t.seats.push({
        // 电脑也挑没人占的角色 —— 真人可能已经把 `seat` 号改掉了
        info: { seat, name: `電腦${seat + 1}`, character: this.#freeCharacter(t.seats), kind: 'computer' },
        conn: null,
        disconnectedAt: null,
        takenOver: false,
      });
    }
    const map = this.#mapFor(t.globalMapId);
    if (map === null) {
      // `setMap` 已经拦过一道；这是「房间建好之后那张图才没了」的兜底
      this.#broadcast(t, { t: 'error', message: `伺服器沒有地圖 ${t.globalMapId}，無法開局` });
      return;
    }
    const seats = t.seats.map((s) => ({ ...s.info }));
    const room = new Room({
      id: t.id,
      map,
      globalMapId: t.globalMapId,
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
