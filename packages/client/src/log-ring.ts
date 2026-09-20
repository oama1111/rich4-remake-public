/*
 * 最近的日志行**环** —— F9 问题回报里要带的那一份
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么单独一个模块：本项目的调试一直靠「出事前那几行说了什么」
 *   （「⚠ 电脑在 X 无事可做，已停手」「底圖載入失敗」「語音載入失敗」…），
 *   而屏幕上的日志栏只在 DOM 里留 120 行、**不进报告** —— 需求方把报告发过来，
 *   开发这边看不到任何上下文。这里把它做成一份可单测的纯数据。
 *
 * 用固定长度的环：内存恒定、不会因为长跑几小时而涨（一次长跑日志上千行）。
 */

/** 环的容量 —— 120 行足够覆盖出事前后（与屏幕日志栏同一个数） */
export const LOG_RING_MAX = 120;

/** 日志环 —— 纯数据，不含 DOM */
export class LogRing {
  readonly #lines: string[] = [];

  push(line: string): void {
    this.#lines.push(line);
    while (this.#lines.length > LOG_RING_MAX) this.#lines.shift();
  }

  /** 最老的在前、最新的在后（顺序与时间一致，便于人读） */
  toArray(): string[] {
    return [...this.#lines];
  }

  get size(): number {
    return this.#lines.length;
  }

  clear(): void {
    this.#lines.length = 0;
  }
}
