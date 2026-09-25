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
  DEFAULT_INITIAL_FUND,
  GAME_INITIAL_FUNDS,
  winConditionsOf,
  type LobbyOptions,
} from '@rich4/core';

export interface RoomOptions {
  id: string;
  map: Rich4Map;
  globalMapId: number;
  /** 由服务器生成并下发——★ 客户端不得自取种子 */
  seed: number;
  seats: SeatInfo[];
  /**
   * ★★ 第十一份試玩回報 #1：开局选项（总人数 + 起始资金/载具/地产期限/时间/胜利条件）。
   *   与 `seats`/`globalMapId` 同一套：**开局那一刻冻结**，只由这一份进 `newGame`。
   */
  options: LobbyOptions;
  /**
   * ★ 聯機存檔（v6）：**從存檔繼續**的局 —— 起點就是這個局面（`deserializeGame` 讀回來的），
   *   不再 `newGame`。`snapshot` 是它的原文，開局 / 重連 / 重放時原樣發給客戶端。
   */
  base?: { state: GameState; snapshot: string };
  /**
   * ★ v6：開局日期（服務器的今天，`defaultStartDate`）—— 與單機同一個規則。
   * 不給 = core 缺省（2010-01-01，舊行為；測試用）。有 `base` 時不用（快照裡有日期）。
   */
  startDate?: { year: number; month: number; day: number };
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
  readonly lobby: { globalMapId: number; seats: readonly SeatInfo[]; options: LobbyOptions };
  /** ★ 聯機存檔（v6）：起點局面的原文（從存檔繼續的局才有；新局為 `null`）*/
  readonly snapshot: string | null;
  /** ★ v6：開局日期（新局才有）—— 隨 `start` / `replay` 下發 */
  readonly startDate: { year: number; month: number; day: number } | null;

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
    this.lobby = {
      globalMapId: opts.globalMapId,
      seats: opts.seats.map((s) => ({ ...s })),
      options: { ...opts.options },
    };
    this.#map = opts.map;
    // ★ 与客户端 main.ts 的 topo **逐项一致**：少了設施表或企业表，镜像在
    //   設施落点、股市锚点上就会与客户端走岔，指纹对不上却谁也没错。
    //   ★★ 2026-09-25（cards 审计跨区发现，实测抓到）：**还少 `landscapes`** ——
    //   入監 / 入院的坐标要读景观记录（`0x43ecef` 读醫院 / 監獄那一笔），客户端四处都带
    //   （如 main.ts 建 topo 那一行），服务器先前不带 ⇒ 服务器把当事人留在**格心**
    //   （384/1056），每个客户端把他挪到**景观**坐标（319/990）。过去这处分叉看不见，
    //   是因为指纹不收 `xpos/ypos`；指纹补上坐标之后（同一次收口）它会直接报失步。
    this.#topo = {
      nodes: opts.map.nodes,
      lands: opts.map.lands,
      facilities: opts.map.facilities,
      commercials: opts.map.commercials,
      landscapes: opts.map.landscapes,
    };

    this.snapshot = opts.base?.snapshot ?? null;
    this.startDate = opts.base === undefined && opts.startDate !== undefined ? { ...opts.startDate } : null;
    this.#mirror = opts.base?.state ?? newGame({
      map: opts.map,
      globalMapId: opts.globalMapId,
      players: opts.seats.map((s) => ({ character: s.character, kind: s.kind })),
      seed: opts.seed,
      mode: 'multiplayer',
      ...(this.startDate === null ? {} : { startDate: this.startDate }),
      // ★★ 第十一份試玩回報 #1（需求方 2026-09-23）：单机那五项在联机也要能设。
      //   逐项照 `client/src/main.ts` 的 `startGame()`（单机的同一处），
      //   ⚠️ 必须与客户端 `onStart` **逐项同源**，否则 `stateFingerprint` 对不上。
      initialFund: GAME_INITIAL_FUNDS[opts.options.fundIndex] ?? DEFAULT_INITIAL_FUND,
      startingVehicle: opts.options.vehicle,
      landTenure: opts.options.landTenure,
      winConditions: winConditionsOf(
        opts.options.fundIndex,
        opts.options.timeIndex,
        opts.options.victoryIndex,
      ),
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
    // ★ pt26：座位发来的 `setAi` **只能改自己那一座**。原版託管AI 屏是一台机器一只鼠标，
    //   联机里「别人的座位」就是别人的机器 —— 客户端那一屏也只提交本机座位那一行（`aiCanEdit`）。
    //   服务器自己的接管 / 归还走 `submitSystem`，不经过这里。「只在轮到自己时受理」那一道由定序器照旧把关。
    if (action.type === 'setAi' && action.player !== seat) {
      return { ok: false, reason: 'notYourSeat' };
    }
    // ★ 审计 2026-09-25（loop F1）：`rollDice.forced` 是单机开发钩子，**不收**客户端带来的点数 ——
    //   否则任一座位都能掷任意点数（`forced: 100` 就走 100 格）。原版的点数只来自掷骰 `0x419572`
    //   与遙控骰子 `[0x475dd8]`（core 里是 `GameState.forcedDice`，由 `useTool 8` 写），不经客户端。
    if (action.type === 'rollDice' && (action as { forced?: unknown }).forced !== undefined) {
      return { ok: false, reason: 'forcedDiceNotAllowed' };
    }
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
    // 与 `submit` 同一道闸（loop F1）：服务器自己也不许带客户端点数
    if (action.type === 'rollDice' && (action as { forced?: unknown }).forced !== undefined) {
      return { ok: false, reason: 'forcedDiceNotAllowed' };
    }
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
