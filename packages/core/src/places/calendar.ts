/*
 * 日曆 —— 日期换算与節日
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 右下角那块 200×200 是一个**独立的小模块**，原版给了它两种面貌
 *   （RICH4.CFG offset 5：日曆 / 小地圖 / 兩者輪流），而「日曆」这一面本身
 *   又分**日曆**与**月曆**两个版式。画法见 client/hud.ts，这里只放算法与数据。
 *
 * 日期在原版里打包成一个 dword：`日 | 月<<8 | 年<<16`（全局 `[0x497160]`）。
 */

import { lunarOf } from '@rich4/data';

// ============================================================
//  基本换算
// ============================================================

/**
 * 每月天数（下标 1..12）。
 * @source `0x0047638f` 起 13 字节：`0 31 28 31 30 31 30 31 31 30 31 30 31`
 */
export const MONTH_LENGTH: readonly number[] = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * 闰年判定。
 *
 * ⚠️ 原版**只看能不能被 4 整除**，没有百年/四百年例外：
 * ```asm
 * 004520de  mov edi, 4
 * 004520ea  idiv edi
 * 004520ec  test edx, edx / jne 不是闰年
 * ```
 * 所以到 2100 年它会和真实公历差一天。照抄——这是原版的行为。
 */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0;
}

/** 某年某月有几天 @source VA 0x004520d9 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTH[month] ?? 30;
}

/** 日曆的纪元：公历 1998-01-01 @source VA 0x00451fb2 `mov ecx, 0x7ce` */
export const EPOCH_YEAR = 1998;

/**
 * 自 1998-01-01 起的第几天（1998-01-01 = 0）。
 *
 * @source VA 0x00451f8c：
 * ```asm
 * for (y = 1998; y < year; y++) ebx += (y % 4 == 0) ? 366 : 365
 * for (m = 1; m < month; m++)   ebx += (m == 2 && 闰) ? 29 : monthLen[m]
 * eax = ebx + (day - 1)
 * ```
 */
export function dayNumberSince1998(year: number, month: number, day: number): number {
  let n = 0;
  for (let y = EPOCH_YEAR; y < year; y++) n += isLeapYear(y) ? 366 : 365;
  for (let m = 1; m < month; m++) n += m === 2 && isLeapYear(year) ? 29 : (MONTH_LENGTH[m] ?? 30);
  return n + (day - 1);
}

/**
 * 星期几，0 = 星期日。
 * @source VA 0x004520c6 `ecx = (dayNumber + 4) % 7`
 *   —— 常数 4 把纪元 1998-01-01 定在星期四，与真实公历一致。
 */
export function weekdayOf(year: number, month: number, day: number): number {
  return (dayNumberSince1998(year, month, day) + 4) % 7;
}

// ============================================================
//  底图
// ============================================================

/**
 * 月份 → 季节底图（`Panel.mkf` 资源 2）。
 *
 * @source `0x00475218` 起 12 字节（下标 = 月 − 1）：
 * `[3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3]`
 *
 * 即 **2~4 月春、5~7 月夏、8~10 月秋、11~1 月冬** —— 不是常识里的分法，
 * 别自作主张改成 3~5 / 6~8 / 9~11 / 12~2。
 *
 * 两个版式取的图不一样：
 * - 日曆用 `图 = 季节`（0..3，纯实景，没有星期栏）@source VA 0x00416b7c
 * - 月曆用 `图 = 季节 + 4`（4..7，带星期栏与太阳月亮）@source VA 0x00416a38
 */
export const MONTH_SCENE: readonly number[] = [3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];

export function sceneOfMonth(month: number): number {
  return MONTH_SCENE[(((month - 1) % 12) + 12) % 12] ?? 0;
}

// ============================================================
//  節日
// ============================================================

/** 一条節日记录 @source `0x0047ff4a` 起，每张地图 24 条 × 12 字节 */
export interface HolidayEntry {
  /** 在该地图 24 条里的槽号 —— 决定用哪张節日图 */
  index: number;
  /** 非 0 = 算假日（有 0x80 的写法，原版只按 `!= 0` 判断） */
  holiday: number;
  /** 0 公历固定日 / 1 農曆固定日 / 2 某月第 n 个星期 w */
  kind: number;
  month: number;
  /** kind 0/1 是「日」，kind 2 是「第几个」 */
  day: number;
  /** kind 2 用：目标星期（0 = 星期日） */
  weekday: number;
}

/**
 * 八张地图各自的節日表。
 *
 * 一眼就能认出来它们确实是各地的节庆：地图 0（台湾）有 1/1 元旦、3/29 青年節、
 * 4/4 兒童節、10/10 國慶、農曆正月初一到初三、端午、中秋；
 * 地图 3（美国）有「1 月第 3 个星期一」「11 月第 4 个星期四」这种第 n 个星期 w。
 */
export const HOLIDAY_TABLE: readonly (readonly HolidayEntry[])[] = [
  [
    { index: 0, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 1, holiday: 0x00, kind: 0, month: 2, day: 14, weekday: 0 },
    { index: 2, holiday: 0x01, kind: 0, month: 3, day: 29, weekday: 0 },
    { index: 3, holiday: 0x00, kind: 0, month: 4, day: 1, weekday: 0 },
    { index: 4, holiday: 0x01, kind: 0, month: 4, day: 4, weekday: 0 },
    { index: 5, holiday: 0x01, kind: 0, month: 4, day: 5, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 0, month: 5, day: 1, weekday: 0 },
    { index: 7, holiday: 0x00, kind: 2, month: 5, day: 2, weekday: 0 },
    { index: 8, holiday: 0x00, kind: 0, month: 8, day: 8, weekday: 0 },
    { index: 9, holiday: 0x01, kind: 0, month: 9, day: 28, weekday: 0 },
    { index: 10, holiday: 0x01, kind: 0, month: 10, day: 10, weekday: 0 },
    { index: 11, holiday: 0x01, kind: 0, month: 10, day: 25, weekday: 0 },
    { index: 12, holiday: 0x80, kind: 0, month: 10, day: 31, weekday: 0 },
    { index: 13, holiday: 0x01, kind: 0, month: 10, day: 31, weekday: 0 },
    { index: 14, holiday: 0x01, kind: 0, month: 11, day: 12, weekday: 0 },
    { index: 15, holiday: 0x01, kind: 0, month: 12, day: 25, weekday: 0 },
    { index: 16, holiday: 0x01, kind: 1, month: 12, day: 31, weekday: 0 },
    { index: 17, holiday: 0x01, kind: 1, month: 1, day: 1, weekday: 0 },
    { index: 18, holiday: 0x01, kind: 1, month: 1, day: 2, weekday: 0 },
    { index: 19, holiday: 0x01, kind: 1, month: 1, day: 3, weekday: 0 },
    { index: 20, holiday: 0x00, kind: 1, month: 1, day: 15, weekday: 0 },
    { index: 21, holiday: 0x01, kind: 1, month: 5, day: 5, weekday: 0 },
    { index: 22, holiday: 0x00, kind: 1, month: 7, day: 15, weekday: 0 },
    { index: 23, holiday: 0x01, kind: 1, month: 8, day: 15, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 1, holiday: 0x00, kind: 0, month: 2, day: 14, weekday: 0 },
    { index: 2, holiday: 0x01, kind: 0, month: 3, day: 8, weekday: 0 },
    { index: 3, holiday: 0x01, kind: 0, month: 4, day: 5, weekday: 0 },
    { index: 4, holiday: 0x01, kind: 0, month: 5, day: 4, weekday: 0 },
    { index: 5, holiday: 0x01, kind: 0, month: 6, day: 1, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 0, month: 7, day: 1, weekday: 0 },
    { index: 7, holiday: 0x01, kind: 0, month: 8, day: 1, weekday: 0 },
    { index: 8, holiday: 0x01, kind: 0, month: 5, day: 1, weekday: 0 },
    { index: 9, holiday: 0x01, kind: 0, month: 10, day: 1, weekday: 0 },
    { index: 10, holiday: 0x00, kind: 0, month: 12, day: 25, weekday: 0 },
    { index: 11, holiday: 0x01, kind: 1, month: 12, day: 31, weekday: 0 },
    { index: 12, holiday: 0x01, kind: 1, month: 1, day: 1, weekday: 0 },
    { index: 13, holiday: 0x01, kind: 1, month: 1, day: 2, weekday: 0 },
    { index: 14, holiday: 0x01, kind: 1, month: 1, day: 3, weekday: 0 },
    { index: 15, holiday: 0x00, kind: 1, month: 1, day: 15, weekday: 0 },
    { index: 16, holiday: 0x01, kind: 1, month: 5, day: 5, weekday: 0 },
    { index: 17, holiday: 0x00, kind: 1, month: 7, day: 15, weekday: 0 },
    { index: 18, holiday: 0x01, kind: 1, month: 8, day: 15, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 1, holiday: 0x01, kind: 0, month: 1, day: 2, weekday: 0 },
    { index: 2, holiday: 0x01, kind: 0, month: 1, day: 3, weekday: 0 },
    { index: 3, holiday: 0x01, kind: 0, month: 1, day: 15, weekday: 0 },
    { index: 4, holiday: 0x00, kind: 0, month: 2, day: 3, weekday: 0 },
    { index: 5, holiday: 0x00, kind: 0, month: 2, day: 14, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 0, month: 2, day: 11, weekday: 0 },
    { index: 7, holiday: 0x00, kind: 0, month: 3, day: 3, weekday: 0 },
    { index: 8, holiday: 0x01, kind: 0, month: 3, day: 22, weekday: 0 },
    { index: 9, holiday: 0x01, kind: 0, month: 4, day: 29, weekday: 0 },
    { index: 10, holiday: 0x01, kind: 0, month: 5, day: 3, weekday: 0 },
    { index: 11, holiday: 0x01, kind: 0, month: 5, day: 5, weekday: 0 },
    { index: 12, holiday: 0x01, kind: 0, month: 9, day: 15, weekday: 0 },
    { index: 13, holiday: 0x01, kind: 0, month: 9, day: 23, weekday: 0 },
    { index: 14, holiday: 0x01, kind: 0, month: 10, day: 10, weekday: 0 },
    { index: 15, holiday: 0x01, kind: 0, month: 11, day: 3, weekday: 0 },
    { index: 16, holiday: 0x01, kind: 0, month: 11, day: 23, weekday: 0 },
    { index: 17, holiday: 0x01, kind: 0, month: 12, day: 23, weekday: 0 },
    { index: 18, holiday: 0x00, kind: 0, month: 12, day: 25, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 0, month: 12, day: 31, weekday: 0 },
    { index: 1, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 2, holiday: 0x00, kind: 2, month: 1, day: 3, weekday: 1 },
    { index: 3, holiday: 0x00, kind: 0, month: 2, day: 2, weekday: 0 },
    { index: 4, holiday: 0x01, kind: 0, month: 2, day: 12, weekday: 0 },
    { index: 5, holiday: 0x00, kind: 0, month: 2, day: 14, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 2, month: 2, day: 3, weekday: 1 },
    { index: 7, holiday: 0x00, kind: 0, month: 3, day: 30, weekday: 0 },
    { index: 8, holiday: 0x00, kind: 2, month: 5, day: 2, weekday: 0 },
    { index: 9, holiday: 0x00, kind: 2, month: 5, day: 5, weekday: 1 },
    { index: 10, holiday: 0x00, kind: 0, month: 6, day: 14, weekday: 0 },
    { index: 11, holiday: 0x00, kind: 0, month: 6, day: 15, weekday: 0 },
    { index: 12, holiday: 0x01, kind: 0, month: 7, day: 4, weekday: 0 },
    { index: 13, holiday: 0x00, kind: 2, month: 9, day: 1, weekday: 1 },
    { index: 14, holiday: 0x00, kind: 0, month: 10, day: 12, weekday: 0 },
    { index: 15, holiday: 0x00, kind: 0, month: 10, day: 31, weekday: 0 },
    { index: 16, holiday: 0x00, kind: 0, month: 11, day: 11, weekday: 0 },
    { index: 17, holiday: 0x01, kind: 2, month: 11, day: 4, weekday: 4 },
    { index: 18, holiday: 0x01, kind: 0, month: 12, day: 24, weekday: 0 },
    { index: 19, holiday: 0x01, kind: 0, month: 12, day: 25, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 1, holiday: 0x01, kind: 0, month: 2, day: 5, weekday: 0 },
    { index: 2, holiday: 0x01, kind: 0, month: 2, day: 27, weekday: 0 },
    { index: 3, holiday: 0x01, kind: 0, month: 6, day: 30, weekday: 0 },
    { index: 4, holiday: 0x01, kind: 0, month: 7, day: 20, weekday: 0 },
    { index: 5, holiday: 0x01, kind: 0, month: 8, day: 23, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 0, month: 11, day: 11, weekday: 0 },
    { index: 7, holiday: 0x01, kind: 0, month: 12, day: 25, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 1, month: 1, day: 1, weekday: 0 },
    { index: 1, holiday: 0x01, kind: 1, month: 1, day: 2, weekday: 0 },
    { index: 2, holiday: 0x01, kind: 1, month: 1, day: 3, weekday: 0 },
    { index: 3, holiday: 0x00, kind: 1, month: 1, day: 7, weekday: 0 },
    { index: 4, holiday: 0x00, kind: 1, month: 1, day: 15, weekday: 0 },
    { index: 5, holiday: 0x00, kind: 1, month: 1, day: 20, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 1, month: 5, day: 5, weekday: 0 },
    { index: 7, holiday: 0x00, kind: 1, month: 7, day: 15, weekday: 0 },
    { index: 8, holiday: 0x01, kind: 1, month: 8, day: 15, weekday: 0 },
    { index: 9, holiday: 0x01, kind: 1, month: 12, day: 31, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 1, holiday: 0x01, kind: 0, month: 2, day: 24, weekday: 0 },
    { index: 2, holiday: 0x01, kind: 0, month: 4, day: 5, weekday: 0 },
    { index: 3, holiday: 0x01, kind: 0, month: 6, day: 10, weekday: 0 },
    { index: 4, holiday: 0x01, kind: 0, month: 6, day: 11, weekday: 0 },
    { index: 5, holiday: 0x01, kind: 0, month: 6, day: 12, weekday: 0 },
    { index: 6, holiday: 0x01, kind: 0, month: 6, day: 13, weekday: 0 },
    { index: 7, holiday: 0x01, kind: 0, month: 6, day: 14, weekday: 0 },
    { index: 8, holiday: 0x01, kind: 0, month: 6, day: 15, weekday: 0 },
    { index: 9, holiday: 0x01, kind: 0, month: 6, day: 16, weekday: 0 },
    { index: 10, holiday: 0x01, kind: 0, month: 8, day: 19, weekday: 0 },
    { index: 11, holiday: 0x01, kind: 0, month: 11, day: 30, weekday: 0 },
    { index: 12, holiday: 0x01, kind: 0, month: 12, day: 25, weekday: 0 },
  ],
  [
    { index: 0, holiday: 0x01, kind: 0, month: 12, day: 31, weekday: 0 },
    { index: 1, holiday: 0x01, kind: 0, month: 1, day: 1, weekday: 0 },
    { index: 2, holiday: 0x00, kind: 0, month: 2, day: 14, weekday: 0 },
    { index: 3, holiday: 0x00, kind: 0, month: 3, day: 30, weekday: 0 },
    { index: 4, holiday: 0x00, kind: 2, month: 5, day: 2, weekday: 0 },
    { index: 5, holiday: 0x01, kind: 0, month: 8, day: 15, weekday: 0 },
    { index: 6, holiday: 0x00, kind: 0, month: 10, day: 31, weekday: 0 },
    { index: 7, holiday: 0x01, kind: 2, month: 11, day: 4, weekday: 4 },
    { index: 8, holiday: 0x01, kind: 0, month: 12, day: 24, weekday: 0 },
    { index: 9, holiday: 0x01, kind: 0, month: 12, day: 25, weekday: 0 },
  ],];

/**
 * 这一天是該地图的第几条節日；没有返回 −1。
 *
 * @source VA 0x004521f0。三种匹配方式：
 * - **kind 0**：`(月<<8 | 日)` 直接比
 * - **kind 1**：先把公历换成農曆（查表，见 `@rich4/data` 的 `lunarOf`），再比月日
 * - **kind 2**：该月第 n 个星期 w
 */
export function holidayIndexOf(
  globalMapId: number,
  year: number,
  month: number,
  day: number,
): number {
  const list = HOLIDAY_TABLE[globalMapId] ?? [];
  const want = (month << 8) | day;
  for (const e of list) {
    let match = 0;
    if (e.kind === 0) {
      match = (e.month << 8) | e.day;
    } else if (e.kind === 1) {
      const l = lunarOf(dayNumberSince1998(year, month, day));
      // 表走完了就判不了 —— 原版会读到表外，这里直接跳过
      if (l === null) continue;
      if (l.month === e.month && l.day === e.day) return e.index;
      continue;
    } else if (e.kind === 2) {
      const d = nthWeekdayOfMonth(year, e.month, e.day, e.weekday);
      match = d === null ? 0 : (e.month << 8) | d;
    }
    if (match !== 0 && match === want) return e.index;
  }
  return -1;
}

/**
 * 某年某月「第 n 个星期 w」是几号；排不下返回 null。
 *
 * ⚠️ **原版这里有个 bug，本引擎照抄**：
 * ```asm
 * 00452316  eax = 目标星期 w
 * 00452325  cmp eax, edx          ; edx = 该月 1 号是星期几 w1
 * 00452327  jge 0x45232e
 * 00452329  mov eax, 7            ; ★ w < w1 时把 w 丢了，本该是 w + 7
 * 0045232e  sub eax, edx
 * 00452341  inc eax               ; 日 = 上面的差 + 1
 * 0045236d  add eax, (n - 1) * 7
 * ```
 * `w < w1` 时正确的算法是 `w + 7 - w1 + 1`，原版算的是 `7 - w1 + 1`，少了 `w`。
 * 只有 `w == 0`（星期日）两者才相同 —— 地图 0 唯一的 kind 2 是「五月第二个
 * 星期日」（母親節），正好没踩上；地图 3 的感恩節（十一月第四个星期四）
 * 在 11 月 1 日晚于星期四的年份就会错到前面去。
 *
 * 照抄而不修，理由同 Q-002：这是原版行为，改了就不是复刻。
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  nth: number,
  weekday: number,
): number | null {
  const first = weekdayOf(year, month, 1);
  // ★ 原样复刻上面那段：w >= w1 用 w − w1，否则用 7 − w1（丢掉了 w）
  const delta = weekday >= first ? weekday - first : 7 - first;
  const day = delta + 1 + (nth - 1) * 7;
  return day <= daysInMonth(year, month) ? day : null;
}

/**
 * 这一天算不算假日。
 *
 * @source VA 0x004523d5：
 * ```asm
 * 0x4520a6(packed, &weekday, NULL)
 * if (weekday == 0) return 1          ; ★ 星期日一律算假日
 * idx = 0x4521f0(packed)
 * if (idx == -1) return 0
 * return 節日表[idx].holiday != 0
 * ```
 */
export function isHoliday(
  globalMapId: number,
  year: number,
  month: number,
  day: number,
): boolean {
  if (weekdayOf(year, month, day) === 0) return true;
  const idx = holidayIndexOf(globalMapId, year, month, day);
  if (idx === -1) return false;
  const e = (HOLIDAY_TABLE[globalMapId] ?? []).find((x) => x.index === idx);
  return e !== undefined && e.holiday !== 0;
}
