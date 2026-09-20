/*
 * 飞行记录仪 —— 「这一刻出了什么问题」的可重放现场
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么需要它：打包后的桌面版**没有控制台**，前端抛错、回合链断掉、画错一帧，
 *   玩的人只看得到「不对劲」，开发的人什么也拿不到 —— 而「小细节不完美」恰恰最难口述。
 *   core 是确定性引擎：只要留下**一份起点快照 + 之后的每一条 action（连同宿主注入的种子）**，
 *   任何现场都能在开发机上**逐条重放**出来（`tools/replay-report.ts`）。
 *
 * ★ 纯逻辑、零 DOM：截图 / 落盘由调用方（`main.ts` / `host.ts`）做，这里只管攒数据。
 *   不读也不写 `GameState`（C-DET-4）—— 它只是旁路抄一份。
 *
 * 容量：只留最近 `KEEP_TURNS` 个回合起点的快照；更早的快照连同它名下的 action 一起丢。
 *   报告 = 最老那份快照 + 此后全部 action ⇒ 永远能从头重放到「现在」。
 */

import type { Action } from '@rich4/core';

/** 留几个回合起点（4 人局 ≈ 3 轮）*/
export const KEEP_TURNS = 12;
/** 错误环形缓冲的长度 */
export const KEEP_ERRORS = 40;
/** 报告格式版本 —— `tools/replay-report.ts` 据此拒收不认识的格式 */
export const REPORT_VERSION = 1;

/** 一条已施加的 action，连同宿主那一刻给的种子（日推进时的 `reseed` 要用它才能重放）*/
export interface TrailEntry {
  /** 施加时刻（`Date.now()`），只用于人读 */
  t: number;
  action: Action;
  /** `reduceWithHostRng` 的 `seed` 实参 */
  seed: number;
}

interface Segment {
  /** 这一段起点的 `turnCount` */
  turn: number;
  /** 起点状态（`serializeGame` 的产物；施加本段第一条 action **之前**）*/
  base: string;
  trail: TrailEntry[];
}

export interface RecordedError {
  t: number;
  kind: 'error' | 'unhandledrejection' | 'stall' | 'note';
  message: string;
  stack: string | null;
}

export interface FlightReport {
  version: number;
  createdAt: string;
  /** 玩的人写的一句话（可空）*/
  note: string;
  /** 触发原因：手动（F9）/ 未捕获异常 / 回合链停摆 */
  reason: 'manual' | 'error' | 'stall';
  /**
   * ★ 这份现场是不是**被开发用的注入口改过状态**（`__rich4.debug.patch`，W-53）。
   *
   * 一旦为 true，`base` + `trail` 就**不再是这个状态的来源** ——
   * 重放到头必然指纹不符，而那不是 bug。故 `tools/replay-report.ts`
   * 见到它就**拒绝验指纹**（报「来自被改过的状态」），而不是报一个假的不一致。
   */
  devPatched: boolean;
  env: Record<string, unknown>;
  /** 重放起点（最老那一段的快照）*/
  base: string;
  baseTurn: number;
  /** 起点之后的全部 action，按施加顺序 */
  trail: TrailEntry[];
  /** 出报告那一刻的状态与指纹 —— 重放到头应当与它逐字节相等 */
  finalState: string;
  finalFingerprint: string;
  errors: RecordedError[];
  /** 画布截图（`data:image/png;base64,…`）；拿不到为 null */
  screenshot: string | null;
}

export class FlightRecorder {
  readonly #segments: Segment[] = [];
  readonly #errors: RecordedError[] = [];
  /**
   * 状态被注入口改过没有（见 `FlightReport.devPatched`）。
   *
   * ★ 与 `#errors` 不同，`reset()` 会清它：reset 的语义是「之前的现场与新状态接不上，
   *   整段作废」——新局 / 读档 / 联机重放都会调它，那之后 base 就是新状态本身，
   *   taint 的那个「旧状态」已经与报告无关了。
   */
  #tainted = false;

  /** 新局 / 读档 / 联机重放之后调：之前的现场与新状态接不上，整段作废 */
  reset(): void {
    this.#segments.length = 0;
    this.#tainted = false;
  }

  /**
   * 把记录仪标脏 —— 调用方**绕过了 `reduceRecorded`** 直接改了 `state`
   * （目前只有 `__rich4.debug.patch` 这一处）。
   *
   * 标脏是**粘的**：改过之后，报告里的轨迹与终点不再有因果链，
   * 只有 `reset()`（= 换了一个新的起点）才能清掉。
   */
  taint(): void {
    this.#tainted = true;
  }

  get devPatched(): boolean {
    return this.#tainted;
  }

  /**
   * 记一条**已经生效**的 action。
   *
   * @param turnBefore 施加前的 `turnCount`
   * @param serializeBefore 惰性取「施加前状态」的序列化 —— 只在要开新段时才调（省掉每步一次序列化）
   */
  record(entry: TrailEntry, turnBefore: number, serializeBefore: () => string): void {
    const last = this.#segments.at(-1);
    if (last === undefined || last.turn !== turnBefore) {
      this.#segments.push({ turn: turnBefore, base: serializeBefore(), trail: [entry] });
      while (this.#segments.length > KEEP_TURNS) this.#segments.shift();
      return;
    }
    last.trail.push(entry);
  }

  error(e: RecordedError): void {
    this.#errors.push(e);
    while (this.#errors.length > KEEP_ERRORS) this.#errors.shift();
  }

  get errorCount(): number {
    return this.#errors.length;
  }

  get trailLength(): number {
    return this.#segments.reduce((n, s) => n + s.trail.length, 0);
  }

  /**
   * 出一份报告。还没记过任何 action（刚开局就按了 F9）时，起点 = 此刻的状态、轨迹为空。
   */
  report(opts: {
    reason: FlightReport['reason'];
    note: string;
    env: Record<string, unknown>;
    finalState: string;
    finalFingerprint: string;
    finalTurn: number;
    screenshot: string | null;
    now: Date;
  }): FlightReport {
    const first = this.#segments[0];
    return {
      version: REPORT_VERSION,
      createdAt: opts.now.toISOString(),
      note: opts.note,
      reason: opts.reason,
      devPatched: this.#tainted,
      env: opts.env,
      base: first === undefined ? opts.finalState : first.base,
      baseTurn: first === undefined ? opts.finalTurn : first.turn,
      trail: this.#segments.flatMap((s) => s.trail),
      finalState: opts.finalState,
      finalFingerprint: opts.finalFingerprint,
      errors: [...this.#errors],
      screenshot: opts.screenshot,
    };
  }
}

/** 报告文件名：`rich4-report-20260919-153012-manual.json`（本地时间，好找）*/
export function reportFileName(now: Date, reason: FlightReport['reason']): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  const d = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const t = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `rich4-report-${d}-${t}-${reason}.json`;
}
