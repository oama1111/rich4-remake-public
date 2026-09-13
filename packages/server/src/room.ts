/*
 * 房间 —— 服务端的全部状态
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 服务器持有的「游戏状态」只有一份**轻量镜像**，且只用来回答
 *   「现在轮到谁」。它不判规则、不算钱——那些在客户端的确定性引擎里。
 *
 *   为什么还要跑一份镜像：定序器必须知道当前座位，否则无法拒绝
 *   「不是你的回合」的意图。跑镜像比让客户端上报更可靠，
 *   且成本极低（同一个 reduce，没有渲染）。
 */

import {
  Sequencer,
  newGame,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type MapTopology,
  type Rich4Map,
  type SeatInfo,
} from '@rich4/core';

export interface RoomOptions {
  id: string;
  map: Rich4Map;
  globalMapId: number;
  /** 由服务器生成并下发——★ 客户端不得自取种子 */
  seed: number;
  seats: SeatInfo[];
}

export interface Broadcast {
  seq: number;
  action: Action;
}

export class Room {
  readonly id: string;
  readonly seed: number;
  readonly globalMapId: number;
  readonly seats: SeatInfo[];

  readonly #map: Rich4Map;
  readonly #topo: MapTopology;
  readonly #sequencer: Sequencer;
  #mirror: GameState;
  #started = false;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.seed = opts.seed;
    this.globalMapId = opts.globalMapId;
    this.seats = opts.seats;
    this.#map = opts.map;
    this.#topo = { nodes: opts.map.nodes, lands: opts.map.lands };

    this.#mirror = newGame({
      map: opts.map,
      globalMapId: opts.globalMapId,
      players: opts.seats.map((s) => ({ character: s.character, kind: s.kind })),
      seed: opts.seed,
      mode: 'multiplayer',
    });

    this.#sequencer = new Sequencer({
      seats: opts.seats.length,
      currentSeat: () => this.#mirror.currentPlayer,
    });
  }

  get started(): boolean {
    return this.#started;
  }

  get currentSeat(): number {
    return this.#mirror.currentPlayer;
  }

  /** 服务器侧的状态指纹——用来比对客户端上报 */
  get fingerprint(): string {
    return stateFingerprint(this.#mirror);
  }

  get sequenceLength(): number {
    return this.#sequencer.length;
  }

  start(): void {
    this.#started = true;
    this.#sequencer.start();
  }

  /**
   * 收到一个意图。
   *
   * 接受则同时推进镜像并返回待广播内容；拒绝则返回原因。
   *
   * ⚠️ 「镜像推进失败」即该 action 在当前局面下**非法**。
   * 这种情况必须在**分配序号之前**挡掉——一旦编号进了日志，
   * 所有客户端都会试图施加一条谁也施加不了的 action，从此分歧。
   * 故校验以回调形式交给定序器，而不是事后回滚。
   */
  submit(seat: number, action: Action): { ok: true; broadcast: Broadcast } | { ok: false; reason: string } {
    // ★ 把「镜像能否推进」作为合法性判据交给定序器：
    //   只有推进成功才会拿到序号，故日志里绝不会出现无法施加的记录。
    let advanced: GameState | null = null;
    const r = this.#sequencer.submit(seat, action, (a) => {
      const next = reduce(this.#mirror, a, this.#topo);
      if (next === this.#mirror) return false;
      advanced = next;
      return true;
    });

    if (!r.accepted || r.sequenced === null) {
      return { ok: false, reason: r.reason ?? 'rejected' };
    }
    // 校验通过时 advanced 必然已被赋值
    this.#mirror = advanced as unknown as GameState;
    return { ok: true, broadcast: { seq: r.sequenced.seq, action } };
  }

  /** 断线重连补发 */
  since(seq: number): Broadcast[] {
    return this.#sequencer.since(seq).map((e) => ({ seq: e.seq, action: e.action }));
  }
}
