/*
 * 联机客户端 —— 把「本地输入」变成意图，把「服务器广播」按序号施加
 * SPDX-License-Identifier: GPL-3.0-or-later
 * ★ 服务器权威（PRD MOD-14 / REQ-14.2）：本地**从不**直接 reduce 自己的 action；
 *   `submit()` 只发 `intent`，等服务器回 `action{seq}` 才由 `onAction` 施加。
 *   于是本地、远端、服务器代打的 action 走的是同一条路——与单机的 reduce 一模一样。
 * ★ 与传输无关：只要一个 `send(text)`；收到的文本交给 `receive(text)`。真跑用 WebSocket，
 *   测试用内存队列。乱序的广播先攒着，凑齐再按序施加。
 */

import {
  PROTOCOL_VERSION,
  type Action,
  type ClientMessage,
  type RoomInfo,
  type SeatInfo,
  type ServerMessage,
} from '@rich4/core';

/** 往服务器写文本的口子 */
export interface NetSocket {
  send(text: string): void;
}

export interface NetClientOptions {
  room: string;
  name: string;
  /** 重连：本地已施加到第几号（含） */
  since?: number;
  /** 每几号 action 上报一次校验和 @default 10 */
  checksumEvery?: number;
  /** 开局参数到了：建本地状态 */
  onStart(start: { seed: number; globalMapId: number; seats: SeatInfo[] }): void;
  /** 一条按序号到达的 action：施加到本地状态 */
  onAction(action: Action, seq: number): void;
  /** 房间信息变化（有人进出、掉线） */
  onRoom?(room: RoomInfo): void;
  onJoined?(seat: number, room: RoomInfo): void;
  onError?(message: string): void;
  /** 服务器判定有人失步；`seat` 是谁的校验和不对 */
  onDesync?(info: { seq: number; expected: string; got: string; seat: number }): void;
  /** 本地状态的指纹（发校验和用） */
  fingerprint(): string;
}

export class NetClient {
  readonly #socket: NetSocket;
  readonly #opts: NetClientOptions;
  readonly #pending = new Map<number, Action>();
  #expected: number;
  #seat: number | null = null;
  #room: RoomInfo | null = null;

  constructor(socket: NetSocket, opts: NetClientOptions) {
    this.#socket = socket;
    this.#opts = opts;
    this.#expected = opts.since === undefined ? 0 : opts.since + 1;
  }

  /** 我的座位；加入前为 null */
  get seat(): number | null {
    return this.#seat;
  }

  get room(): RoomInfo | null {
    return this.#room;
  }

  /** 下一条期待的序号 = 本地已施加的条数 */
  get expectedSeq(): number {
    return this.#expected;
  }

  /** 连上之后第一件事：加入房间 */
  join(): void {
    const msg: ClientMessage = { t: 'join', version: PROTOCOL_VERSION, room: this.#opts.room, name: this.#opts.name };
    if (this.#opts.since !== undefined) msg.since = this.#opts.since;
    this.#send(msg);
  }

  /** 房主开局 */
  start(): void {
    this.#send({ t: 'start' });
  }

  /** 本地输入 → 意图。不施加、不回滚，等广播 */
  submit(action: Action): void {
    this.#send({ t: 'intent', action });
  }

  /** 收到服务器一条文本 */
  receive(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'joined':
        this.#seat = msg.seat;
        this.#room = msg.room;
        this.#opts.onJoined?.(msg.seat, msg.room);
        return;
      case 'room':
        this.#room = msg.room;
        this.#opts.onRoom?.(msg.room);
        return;
      case 'start':
        this.#opts.onStart({ seed: msg.seed, globalMapId: msg.globalMapId, seats: msg.seats });
        return;
      case 'action':
        this.#pending.set(msg.seq, msg.action);
        this.#flush();
        return;
      case 'desync':
        this.#opts.onDesync?.({ seq: msg.seq, expected: msg.expected, got: msg.got, seat: msg.seat });
        return;
      case 'error':
        this.#opts.onError?.(msg.message);
        return;
      default:
        return;
    }
  }

  /** 按序号施加攒着的广播；重复的（seq < expected）直接丢 */
  #flush(): void {
    for (const seq of [...this.#pending.keys()]) if (seq < this.#expected) this.#pending.delete(seq);
    const every = this.#opts.checksumEvery ?? 10;
    while (this.#pending.has(this.#expected)) {
      const seq = this.#expected;
      const action = this.#pending.get(seq)!;
      this.#pending.delete(seq);
      this.#expected = seq + 1;
      this.#opts.onAction(action, seq);
      if (every > 0 && (seq + 1) % every === 0) {
        this.#send({ t: 'checksum', seq, hash: this.#opts.fingerprint() });
      }
    }
  }

  #send(msg: ClientMessage): void {
    this.#socket.send(JSON.stringify(msg));
  }
}

/** 从页面 URL 读联机参数：`?ws=ws://host:port&room=r1&name=小明`；缺 ws 就是单机 */
export function netParamsFrom(search: string): { url: string; room: string; name: string } | null {
  const q = new URLSearchParams(search);
  const url = q.get('ws');
  if (url === null || url === '') return null;
  return { url, room: q.get('room') ?? 'default', name: q.get('name') ?? `玩家${Math.floor(Math.random() * 1000)}` };
}
