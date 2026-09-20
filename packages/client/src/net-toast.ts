/*
 * 联机提示 —— 谁进来了、谁掉线、谁被託管（W-75）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **只在联机时出现**，DOM 覆盖层（右下角堆叠），**不进 canvas、不走原版訊息框** ——
 *   那是复刻屏，不往里加本项目自己的文案（任务书 W-75）。
 *
 * ★ 这个文件分两半（与 `foyer.ts` 同一条边界）：
 *   · `roomToasts()` —— **纯函数**：比较前后两份 `RoomInfo`，吐出该说的话，单测钉着；
 *   · `NetToasts` —— DOM：排队、4 秒自收、最多同时 3 条、被託管的本人看常驻横幅。
 */

import type { RoomInfo, SeatInfo } from '@rich4/core';

/** 一条提示说的是谁 */
export interface ToastLine {
  seat: number;
  text: string;
}

/** 每条提示挂多久（毫秒） */
export const TOAST_MS = 4000;
/** 同时最多挂几条 */
export const TOAST_MAX = 3;

/** 被超时託管的人自己看到的那句常驻横幅 */
export const AUTOPILOT_BANNER = '你已被託管，點一下畫面收回';

/**
 * 比较前后两份房间快照，算出该弹哪几条。
 *
 * `strikes` 是**每个座位「连续超时」的计数**，与服务器那边的 `strikes` 同一条规则
 * （**只有他自己交了一个 intent 才清零**；自动归还**不算**）。为什么要客户端也算
 * 一遍：`SeatInfo.autopilot` 只有 `'offline' | 'idle'` 两个值，**看不出这是第几次
 * 超时** —— 而「这一回合由电脑代打」与「连续两次，已交给电脑託管」是两句不同的话。
 *
 * ★ 纯函数：不改传进来的 `strikes`，返回一份新的。
 */
export function roomToasts(
  before: RoomInfo | null,
  after: RoomInfo,
  strikes: ReadonlyMap<number, number> = new Map(),
): { lines: ToastLine[]; strikes: Map<number, number> } {
  const lines: ToastLine[] = [];
  const next = new Map(strikes);
  for (const s of after.seats) {
    const b = before?.seats.find((x) => x.seat === s.seat);
    if (s.kind !== 'human') continue;
    // ① 新来的（之前没这号人，或者这一号原本是电脑）
    if (b === undefined || b.kind !== 'human') {
      lines.push({ seat: s.seat, text: `${s.name} 加入了房間` });
      continue;
    }
    // ② 掉线 / ③ 回来
    if (b.connected !== false && s.connected === false) {
      lines.push({ seat: s.seat, text: `${s.name} 離線了，30 秒後由電腦代打` });
    } else if (b.connected === false && s.connected !== false) {
      lines.push({ seat: s.seat, text: `${s.name} 回來了` });
    }
    // ④ / ⑤ 超时託管（第一次 / 连续第二次）
    if (b.autopilot !== 'idle' && s.autopilot === 'idle') {
      const n = (next.get(s.seat) ?? 0) + 1;
      next.set(s.seat, n);
      lines.push({
        seat: s.seat,
        text:
          n >= 2
            ? `${s.name} 連續超時，已交給電腦託管（點一下畫面即可收回）`
            : `${s.name} 超時，這一回合由電腦代打`,
      });
    }
    // ⚠️ 「收回来了」**不在这里清零**：服务器那边的 `strikes` 只在
    //   「该座位自己发来一个合法 intent」或「`resume`」时清零 —— 而**自动归还**
    //   （第一次超时之后回合结束）**不清零**。这里照抄同一条规则，清零由
    //   `NetToasts.noteIntent()` 在「看见这个座位派了一条 action」时做。
  }
  return { lines, strikes: next };
}

/** 找出「本机座位此刻被超时託管」这件事（是的话显示常驻横幅，而不是弹一条就走） */
export function selfAutopilot(info: RoomInfo | null, mySeat: number | null): boolean {
  if (info === null || mySeat === null) return false;
  return info.seats.find((s) => s.seat === mySeat)?.autopilot === 'idle';
}

// ============================================================
//  DOM
// ============================================================

interface Shown extends ToastLine {
  el: HTMLElement;
  timer: number;
}

/**
 * 右下角的提示条 + 被託管时的常驻横幅。
 *
 * ⚠️ 它**只在联机时**有内容：单机根本不会有人调 `update()`。
 */
export class NetToasts {
  readonly #doc: Document;
  readonly #host: HTMLElement;
  readonly #banner: HTMLElement;
  readonly #shown: Shown[] = [];
  #strikes = new Map<number, number>();

  constructor(doc: Document, host: HTMLElement, banner: HTMLElement) {
    this.#doc = doc;
    this.#host = host;
    this.#banner = banner;
  }

  /** 收到一份新的 `RoomInfo` —— 比较前后两份，该弹的弹 */
  update(before: RoomInfo | null, after: RoomInfo, mySeat: number | null): void {
    const r = roomToasts(before, after, this.#strikes);
    this.#strikes = r.strikes;
    for (const line of r.lines) {
      // ★ 最后一条（连续超时）**只发给其他人** —— 被託管的本人已经看到常驻横幅了
      if (line.seat === mySeat && line.text.includes('連續超時')) continue;
      this.push(line.text);
    }
    this.#banner.hidden = !selfAutopilot(after, mySeat);
  }

  /** 弹一条；最多同时 3 条（多了把最老的挤掉），每条 4 秒自收 */
  push(text: string): void {
    // 同一句话不重复堆（同一条 `room` 广播可能因为别的原因再来一次）
    if (this.#shown.some((s) => s.text === text)) return;
    const el = this.#doc.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'padding:7px 12px;border-radius:8px;background:rgba(12,24,40,.9);color:#e9eef7;' +
      'border:1px solid #3a5a83;font:500 13px/1.35 -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35)';
    this.#host.append(el);
    const entry: Shown = { seat: -1, text, el, timer: 0 };
    entry.timer = window.setTimeout(() => this.#drop(entry), TOAST_MS);
    this.#shown.push(entry);
    while (this.#shown.length > TOAST_MAX) this.#drop(this.#shown[0]!);
  }

  #drop(entry: Shown): void {
    const i = this.#shown.indexOf(entry);
    if (i === -1) return;
    this.#shown.splice(i, 1);
    window.clearTimeout(entry.timer);
    entry.el.remove();
  }

  /**
   * ★ 这个座位**自己派了一条 action** —— 服务器那本 `strikes` 就是在那一刻清零的
   *   （`hub.ts` 的 `#submit`），这里照抄同一条规则。
   *
   * @param seat 派这条 action 的座位（调用方用**施加之前**的镜像算 `actingSeat(state)`）
   */
  noteIntent(seat: number): void {
    this.#strikes.set(seat, 0);
  }

  /** 供测试/监控：此刻挂着几条 */
  get count(): number {
    return this.#shown.length;
  }

  /** 座位信息变了（大厅里换角色之类）—— 目前什么都不用做，留着给将来的调用点 */
  static seatName(info: RoomInfo | null, seat: number): string | null {
    const s: SeatInfo | undefined = info?.seats.find((x) => x.seat === seat);
    return s?.name ?? null;
  }
}
