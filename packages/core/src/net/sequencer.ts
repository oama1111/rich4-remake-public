/*
 * Action 定序器 —— 联机的全部服务端逻辑
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 服务器**不跑游戏规则**。它只回答一个问题：
 *   「这个意图现在轮得到这个座位提吗？」
 *   轮得到就编号广播，轮不到就丢弃。
 *
 *   规则判断全在客户端的 `reduce()` 里——反正大家跑的是同一份
 *   确定性引擎，服务器再判一遍既多余又会引入第二处真值。
 *
 * ⚠️ 这是**信任前提下**的设计，对应 C-LEG-5 的私人小圈子场景。
 *   它防不住恶意客户端伪造有利的 action（例如在自己回合宣称掷出 6）。
 *   真要防作弊，得让服务器也跑引擎并成为唯一真值——那是另一套架构，
 *   代价是服务器必须持有完整状态。此处**有意不做**，并在此写明。
 */

import type { Action } from '../state/actions.ts';

/** 一条已定序的 action */
/** 服务器发起的 action 在日志里的座位号 */
export const SYSTEM_SEAT = -1;

export interface SequencedAction {
  seq: number;
  action: Action;
  /** 提交者的座位；服务器补位的 AI 动作记为 -1 */
  seat: number;
}

export interface SequencerOptions {
  /** 座位数 = 玩家数 */
  seats: number;
  /**
   * 判断某个座位此刻能否行动。
   *
   * 由调用方注入——服务器不持有游戏状态，故「轮到谁」这个信息
   * 要么来自各客户端上报，要么来自服务器自己跑一份轻量镜像。
   * 抽成回调是为了两种做法都能接。
   */
  currentSeat: () => number;
}

export type RejectReason =
  /** 不是这个座位的回合 */
  | 'notYourTurn'
  /** 座位号非法 */
  | 'badSeat'
  /** 对局尚未开始或已结束 */
  | 'notRunning'
  /** 该 action 在当前局面下不合法 */
  | 'illegalAction';

export interface AcceptResult {
  accepted: boolean;
  reason: RejectReason | null;
  /** 接受时给出的定序结果 */
  sequenced: SequencedAction | null;
}

/**
 * 定序器。
 *
 * 保证三件事：
 * 1. `seq` 从 0 开始**严格连续**——客户端据此发现丢包
 * 2. 同一时刻只有当前座位的意图会被接受
 * 3. 广播顺序即施加顺序
 */
export class Sequencer {
  #seq = 0;
  #running = false;
  readonly #log: SequencedAction[] = [];
  readonly #seats: number;
  readonly #currentSeat: () => number;

  constructor(opts: SequencerOptions) {
    this.#seats = opts.seats;
    this.#currentSeat = opts.currentSeat;
  }

  get running(): boolean {
    return this.#running;
  }

  /** 已定序的条数 */
  get length(): number {
    return this.#seq;
  }

  start(): void {
    this.#running = true;
  }

  stop(): void {
    this.#running = false;
  }

  /**
   * 提交一个意图。
   *
   * ★ **序号在校验全部通过之后才分配**，没有回滚这回事。
   *
   * 这一点很要紧：若先编号再发现 action 非法，日志里就会留下一条
   * 谁也施加不了的记录，所有客户端从此分歧。而「先编号、出错再撤回」
   * 在并发广播下根本不可靠——可能已经发出去了。
   *
   * @param apply 可选的合法性校验。返回 false 表示该 action 在当前
   *   局面下不合法（例如在 `turnEnd` 阶段掷骰）。服务器用它跑一份
   *   轻量镜像来判定；不传则只做回合校验。
   */
  submit(seat: number, action: Action, apply?: (a: Action) => boolean): AcceptResult {
    if (!this.#running) return { accepted: false, reason: 'notRunning', sequenced: null };
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.#seats) {
      return { accepted: false, reason: 'badSeat', sequenced: null };
    }
    if (seat !== this.#currentSeat()) {
      return { accepted: false, reason: 'notYourTurn', sequenced: null };
    }
    if (apply !== undefined && !apply(action)) {
      return { accepted: false, reason: 'illegalAction', sequenced: null };
    }

    const sequenced: SequencedAction = { seq: this.#seq++, action, seat };
    this.#log.push(sequenced);
    return { accepted: true, reason: null, sequenced };
  }

  /**
   * 服务器自己发起的 action（掉线代打的 `setAi`、系统性调整），不受「轮到谁」限制，
   * 但仍要过合法性校验；日志里座位记 `SYSTEM_SEAT`。
   */
  submitSystem(action: Action, apply?: (a: Action) => boolean): AcceptResult {
    if (!this.#running) return { accepted: false, reason: 'notRunning', sequenced: null };
    if (apply !== undefined && !apply(action)) {
      return { accepted: false, reason: 'illegalAction', sequenced: null };
    }
    const sequenced: SequencedAction = { seq: this.#seq++, action, seat: SYSTEM_SEAT };
    this.#log.push(sequenced);
    return { accepted: true, reason: null, sequenced };
  }

  /**
   * 服务器代打（座位空缺或玩家掉线时）。
   * 不做回合校验——调用方自己确保时机正确。
   */
  submitAsServer(action: Action): SequencedAction | null {
    if (!this.#running) return null;
    const sequenced: SequencedAction = { seq: this.#seq++, action, seat: -1 };
    this.#log.push(sequenced);
    return sequenced;
  }

  /**
   * 取某个序号之后的全部 action —— 断线重连时补发。
   *
   * ★ 这就是「重连」的全部实现：确定性引擎只要拿到完整的 action 序列
   *   就能从头重放出当前状态，不需要传输状态快照。
   */
  since(seq: number): SequencedAction[] {
    return this.#log.filter((e) => e.seq >= seq);
  }

  /** 完整日志——存盘即回放 */
  get log(): readonly SequencedAction[] {
    return this.#log;
  }
}
