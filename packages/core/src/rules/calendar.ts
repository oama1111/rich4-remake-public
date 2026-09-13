/*
 * 日历 —— 打包日期与推进
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版把整个日期塞进**一个 dword**（`[0x497160]`）：
 *   `年 = v >> 16`、`月 = (v >> 8) & 0xff`、`日 = v & 0xff`。
 *   这解释了随处可见的 `and eax, 0xff / cmp eax, 0xf`——
 *   那是在取「日」，不是在取什么标志位。
 *
 * @source `advance_date` VA 0x00452117
 * @source 月长表 VA 0x0047638f
 * @source 调用点 VA 0x0041cfa1（回合边界推进一天）
 */

/**
 * 每月天数。下标即月份 1..12，下标 0 不用（原版表首字节就是 0）。
 * @source 从 rich4.exe 0x0047638f 直接读出：
 *   `[0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]`
 */
export const DAYS_IN_MONTH: readonly number[] = [
  0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/** 闰年 2 月的天数 @source `mov eax, 0x1d` */
const LEAP_FEBRUARY = 29;

export interface GameDate {
  year: number;
  month: number;
  day: number;
}

/**
 * 是否闰年。
 *
 * ⚠️ 原版**只判 4 的倍数**（`idiv 4 / test edx,edx`），
 *   没有百年/四百年例外。2100 年在原版里是闰年——照搬，别「修正」。
 */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0;
}

/** 某年某月的天数 @source `cmp ecx, 2 / jne` 之后的两条路 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return LEAP_FEBRUARY;
  return DAYS_IN_MONTH[month] ?? 30;
}

/** 打包成原版的那个 dword @source `(年<<16) | (月<<8) | 日` */
export function packDate(d: GameDate): number {
  return ((d.year << 16) | (d.month << 8) | d.day) >>> 0;
}

/** 从打包值解出年月日 */
export function unpackDate(v: number): GameDate {
  return { year: v >>> 16, month: (v >>> 8) & 0xff, day: v & 0xff };
}

export interface AdvanceResult {
  date: GameDate;
  /** 是否跨入了新的一个月 —— 原版的返回值，用来触发月结 */
  newMonth: boolean;
}

/**
 * 推进一天。
 *
 * @source VA 0x00452117 全文：
 * ```asm
 * 年 = v>>16 ; 月 = (v>>8)&0xff ; 日 = v&0xff
 * if (月 == 2 && 年 % 4 == 0) 本月天数 = 29
 * else                        本月天数 = [0x47638f + 月]
 * 日++
 * if (日 > 本月天数) {
 *     日 = 1 ; 返回值 = 1
 *     月++
 *     if (月 > 12) { 月 = 1 ; 年++ }
 * }
 * v = (年<<16) | (月<<8) | 日
 * return 返回值
 * ```
 *
 * ★ 注意跨月与跨年是**两层独立判断**，且返回值只表示「跨月」——
 *   跨年时它同样是 1（跨年必然跨月）。月结就挂在这个返回值上。
 */
export function advanceDate(d: GameDate): AdvanceResult {
  let { year, month, day } = d;
  const limit = daysInMonth(year, month);

  day++;
  if (day <= limit) return { date: { year, month, day }, newMonth: false };

  day = 1;
  month++;
  if (month > 12) {
    month = 1;
    year++;
  }
  return { date: { year, month, day }, newMonth: true };
}
