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
  actingSeat,
  auctionNextBid,
  decideAction,
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
  /**
   * ★ Q-NET-2：开局时冻结的**大厅设置** —— 每个座位的角色 + 房间地图。
   *
   * 为什么是快照而不是可变的：角色/地图只允许在**未开局**时改，而 `Room`
   * 是开局那一刻才建的（hub 的 `#start`）。开局之后 hub 就不再放行
   * `setCharacter`/`setMap` 了，所以这份设置从这里起就是死的。
   *
   * 权威性也在这里：`newGame` 的 `players`（角色、真人/电脑）与
   * `globalMapId` 全部取自它，**不读任何客户端上报的本地设置** ——
   * 否则「我以为我选的是忍者、服务器记的是錢夫人」要到指纹对不上才暴露。
   */
  readonly lobby: { globalMapId: number; seats: readonly SeatInfo[] };

  readonly #map: Rich4Map;
  readonly #topo: MapTopology;
  readonly #sequencer: Sequencer;
  #mirror: GameState;
  #started = false;
  /** 每条被接受的 action 施加后的指纹，按序号存，供 checksum 比对 */
  readonly #fingerprints = new Map<number, string>();

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.seed = opts.seed;
    this.globalMapId = opts.globalMapId;
    this.seats = opts.seats;
    // ★ 拷一份快照：hub 之后还会改 `Table` 上的座位/地图（比如开局补电脑），
    //   那些改动不该再影响这一局已经定下的设置。
    this.lobby = { globalMapId: opts.globalMapId, seats: opts.seats.map((s) => ({ ...s })) };
    this.#map = opts.map;
    // ★ 与客户端 main.ts 的 topo **逐项一致**：少了設施表或企业表，镜像在
    //   設施落点、股市锚点上就会与客户端走岔，指纹对不上却谁也没错。
    this.#topo = {
      nodes: opts.map.nodes,
      lands: opts.map.lands,
      facilities: opts.map.facilities,
      commercials: opts.map.commercials,
    };

    this.#mirror = newGame({
      map: opts.map,
      globalMapId: opts.globalMapId,
      players: opts.seats.map((s) => ({ character: s.character, kind: s.kind })),
      seed: opts.seed,
      mode: 'multiplayer',
    });

    this.#sequencer = new Sequencer({
      seats: opts.seats.length,
      // ★ 提交权 = 「此刻该谁拿主意」，不是「谁的回合」—— 拍賣期间轮到谁举牌谁提交
      //   （issue #9；判据只有 core 的 `actingSeat` 这一处）。
      currentSeat: () => actingSeat(this.#mirror),
    });
  }

  get started(): boolean {
    return this.#started;
  }

  /** 回合主人（`currentPlayer`）。⚠️ **不是**提交权的判据 —— 那个看 `actingSeat` */
  get currentSeat(): number {
    return this.#mirror.currentPlayer;
  }

  /** 此刻该谁拿主意：拍賣期间 = 轮到举牌的那位，其余 = 回合主人 */
  get actingSeat(): number {
    return actingSeat(this.#mirror);
  }

  /** 服务器侧的状态指纹——用来比对客户端上报 */
  get fingerprint(): string {
    return stateFingerprint(this.#mirror);
  }

  get sequenceLength(): number {
    return this.#sequencer.length;
  }

  /** 镜像状态（只读用途：AI 代打、调试） */
  get state(): GameState {
    return this.#mirror;
  }

  /** 第 seq 号 action 施加后的指纹；没记录返回 null */
  fingerprintAt(seq: number): string | null {
    return this.#fingerprints.get(seq) ?? null;
  }

  /** 让 core 的 AI 替当前座位拿主意（电脑座位或掉线代打） */
  decideForCurrent(): Action | null {
    return decideAction({ state: this.#mirror, map: this.#map });
  }

  /**
   * 竞价期间：轮到举牌的那位若由 AI 控制（电脑 / 掉线代打 / 自己开了託管），给出他这一口；
   * 不在竞价、或轮到的是真人 ⇒ `null`。
   *
   * ★ 为什么不能复用 `decideForCurrent()`：`decideAction` 先过 `isAiTurn`（判的是
   *   **回合主人**），回合主人是真人时它直接返回 null —— 而此刻举牌的可能是电脑。
   *   单机由 `client/auction-screen.ts` 补这个缝；服务器无头，得自己问
   *   `auctionNextBid`（与屏、与 `decidePending` 同一个函数，不是第二套算法）。
   */
  decideAuctionBid(): Action | null {
    const p = this.#mirror.pending;
    if (p === null || p.kind !== 'auction' || !('seat' in p)) return null;
    return auctionNextBid(this.#mirror, p);
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
      // ★ 网络来的 action 不可信：`type` 不在 Action 联合里时 reduce 的 switch
      //   没有分支可走，TS 层面是「穷尽」了、运行时却返回 undefined——
      //   镜像一旦被它顶掉，下一条 stateFingerprint 就把整台服务器带崩。
      const next = reduce(this.#mirror, a, this.#topo) as GameState | undefined;
      if (next === undefined || next === this.#mirror) return false;
      advanced = next;
      return true;
    });

    if (!r.accepted || r.sequenced === null) {
      return { ok: false, reason: r.reason ?? 'rejected' };
    }
    // 校验通过时 advanced 必然已被赋值
    this.#mirror = advanced as unknown as GameState;
    this.#fingerprints.set(r.sequenced.seq, stateFingerprint(this.#mirror));
    return { ok: true, broadcast: { seq: r.sequenced.seq, action } };
  }

  /** 服务器发起的 action（不受回合限制），同样先在镜像上验过再编号 */
  submitSystem(action: Action): { ok: true; broadcast: Broadcast } | { ok: false; reason: string } {
    let advanced: GameState | null = null;
    const r = this.#sequencer.submitSystem(action, (a) => {
      // ★★ 首席复核续（DeepSeek）：**`undefined` 也要挡**，与 `submit` 那一条同理。
      //   `reduce` 的 switch 对不认识的 `type` 没有分支可走 ⇒ 返回 `undefined`；
      //   原先只比了 `next === this.#mirror`，于是 `#mirror` 被换成 `undefined`，
      //   **紧接着那一行 `stateFingerprint` 就抛**，而且这个房间**从此永久坏掉**
      //   （之后每一次 `fingerprint` 都抛）。实测复现（`room.test.ts` 里那条）。
      //   眼下 `submitSystem` 只被服务器自己用 `setAi` 调，够不到这条路 ——
      //   但这条闸与 `submit` 必须对称，不然下一次加系统 action 就会踩上。
      const next = reduce(this.#mirror, a, this.#topo) as GameState | undefined;
      if (next === undefined || next === this.#mirror) return false;
      advanced = next;
      return true;
    });
    if (!r.accepted || r.sequenced === null) return { ok: false, reason: r.reason ?? 'rejected' };
    this.#mirror = advanced as unknown as GameState;
    this.#fingerprints.set(r.sequenced.seq, stateFingerprint(this.#mirror));
    return { ok: true, broadcast: { seq: r.sequenced.seq, action } };
  }

  /** 断线重连补发 */
  since(seq: number): Broadcast[] {
    return this.#sequencer.since(seq).map((e) => ({ seq: e.seq, action: e.action }));
  }
}
