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

/**
 * 天号 → 打包日期（`日 | 月<<8 | 年<<16`）—— `dayNumberSince1998` 的逆。
 *
 * @source VA 0x0045201f：
 * ```asm
 * ecx = 0x7ce（1998）; esi = 1; edx = 0x16d
 * 0045203a  cmp ebx, edx / jl → ebx -= edx; ecx++        ; 逐年扣
 *           edx = 0x16d + (ecx % 4 == 0)                  ; 下一年的天数
 *           cmp ebx, edx / jge 0x45203a
 * 00452069  cmp ebx, edx / jl → ebx -= edx; esi++        ; 逐月扣（2 月闰年 0x1d，余查 0x47638f）
 * 00452095  eax = (ecx << 16) + (esi << 8) + ebx + 1
 * ```
 * 只对 `n >= 0` 有意义（原版的调用点都是「今天 + 正数」）。
 */
export function packedFromDayNumber(n: number): number {
  let rest = n;
  let year = EPOCH_YEAR;
  while (rest >= (isLeapYear(year) ? 366 : 365)) {
    rest -= isLeapYear(year) ? 366 : 365;
    year++;
  }
  let month = 1;
  while (rest >= daysInMonth(year, month)) {
    rest -= daysInMonth(year, month);
    month++;
  }
  return ((year << 16) | (month << 8) | (rest + 1)) >>> 0;
}

/** 打包日期 → 天号（`0x451f8c` 就是拆包后走 `dayNumberSince1998`）*/
export function dayNumberOfPacked(packed: number): number {
  return dayNumberSince1998(packed >>> 16, (packed >>> 8) & 0xff, packed & 0xff);
}

/**
 * 打包日期 + `n` 天。
 * @source VA 0x0045218f：`push date / call 0x451f8c / add eax, [esp+8] / push eax / call 0x45201f`
 */
export function addDaysPacked(packed: number, n: number): number {
  return packedFromDayNumber(dayNumberOfPacked(packed) + n);
}

/**
 * 两个打包日期的天数差 **`b − a`**。
 * @source VA 0x004521aa：`0x451f8c(a)` 存 ebx，`0x451f8c(b)`，`sub eax, ebx`
 *
 * ⚠️ 打包值 0（「没有到期日」）按原版照算：年 0 < 1998 ⇒ 年循环一次不走、月循环一次不走、
 *   `日 − 1 = −1` ⇒ 天号 −1（`dayNumberSince1998(0, 0, 0)` 同样给 −1）。
 */
export function packedDayDiff(a: number, b: number): number {
  return dayNumberOfPacked(b) - dayNumberOfPacked(a);
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
      // ★ 2026-09-25 审计：命中后同样要过 0x80 那道（见下）
      if (l.month === e.month && l.day === e.day && (e.holiday & 0x80) === 0) return e.index;
      continue;
    } else if (e.kind === 2) {
      const d = nthWeekdayOfMonth(year, e.month, e.day, e.weekday);
      match = d === null ? 0 : (e.month << 8) | d;
    }
    // ★ 2026-09-25 审计补：命中的记录若首字节带 0x80 就**跳过**、接着往下找 ——
    //   @source `0x004523b3 test byte [记录 + 0x47ff4a], 0x80 / 0x004523bb jne 0x452205`。
    //   地图 0 的 10/31 有两条（12 号 0x80、13 号 0x01）⇒ 原版取 13 号（节日图不同；算不算假日两条都一样）。
    if (match !== 0 && match === want && (e.holiday & 0x80) === 0) return e.index;
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

// ============================================================
//  節日插画
// ============================================================

/**
 * 每张地图的**節日插画资源基号**（`Data.mkf`）。
 *
 * @source `0x00475208` 起 8 个 word（一张地图一个）：
 * `[4, 28, 47, 67, 87, 108, 95, 118]`
 *
 * 用法（@source VA 0x00416baf 起，`fcn_004521f0` 返回的不是 −1 时）：
 * ```asm
 * movsx ebx, word [0x4991b6]      ; 地图号高位
 * shl   ebx, 2
 * movsx esi, word [0x4991b8]      ; 地图号低位
 * add   ebx, esi                  ; 地图号
 * mov   bx, word [ebx*2 + 0x475208]   ; ★ 本表
 * and   ebx, 0xffff
 * add   ebx, eax                  ; + 節日序号 → Data.mkf 的资源号
 * ```
 * 即 **`资源号 = 本表[地图号] + 節日序号`**。
 *
 * ⚠️ 各图之间**不是等距**（相邻差 24/19/20/20/21/−13/23，且 map6 的 95 < map5 的 108）
 *   —— 别当成 `基号 + 地图×24` 去推。表里就是这么写的，照抄。
 */
export const HOLIDAY_ART_BASE: readonly number[] = [4, 28, 47, 67, 87, 108, 95, 118];

// ============================================================
//  節日配乐（W-17）
// ============================================================

/**
 * 節日记录里与配乐有关的两格 —— **稀疏表**（其余 184 条两格都是 0）。
 *
 * @source 表 `0x0047ff4a`（每图 24 条 × 12 字节）：`+5` 旗标、`+0xa` 曲号（u16）。实 dump：
 * | 地图 | 槽 | 節日 | 旗标 & 4 | 曲号 |
 * |---|---|---|---|---|
 * | 0 / 1 / 2 / 3 | 15 / 10 / 18 / 19 | 聖誕節 12/25 | ✓ | 13 |
 * | 0 / 1 | 17 / 12 | 農曆正月初一 | ✓ | 14 |
 * | 0 / 1 | 18,19 / 13,14 | 初二、初三 | ✗（只有曲号）| 14 |
 *
 * 初二、初三**没有旗标**却填了曲号 —— 它们不触发换曲，只被「下一条曲号非 0 ⇒ 连放 3 天」那条判据读到。
 */
const HOLIDAY_MUSIC_WORDS: readonly (Readonly<Record<number, { flag: boolean; id: number }>>)[] = [
  { 15: { flag: true, id: 13 }, 17: { flag: true, id: 14 }, 18: { flag: false, id: 14 }, 19: { flag: false, id: 14 } },
  { 10: { flag: true, id: 13 }, 12: { flag: true, id: 14 }, 13: { flag: false, id: 14 }, 14: { flag: false, id: 14 } },
  { 18: { flag: true, id: 13 } },
  { 19: { flag: true, id: 13 } },
  {}, {}, {}, {},
];

/** 某条節日记录的 (旗标 & 4, 曲号)；表里没有 = (false, 0) */
export function holidayMusicWord(globalMapId: number, holidayIndex: number): { flag: boolean; id: number } {
  return HOLIDAY_MUSIC_WORDS[globalMapId]?.[holidayIndex] ?? { flag: false, id: 0 };
}

/**
 * 今天这个節日要不要换背景曲；要的话放哪一首（`fcn_004549cf` 的曲号）、连放几天。
 *
 * @source `sub_00452444`（日推进里 `0x0041d07b` 调）：
 * ```asm
 * 0045257d  test byte [记录+5], 4 / je 跳过            ; 旗标 & 4 才换曲
 * 00452586  cmp  byte [0x46cb06], 0 / jne 跳过          ; 已经在放節日曲就不重起（由调用方判）
 * 00452591  mov  di, [记录+0xa] / or di,0x8000 / call fcn_004549cf
 * 004525d3  cmp  word [**下一条**记录+0xa], 0
 * 004525de  mov  byte [0x46cb06], 0x33   ; 非 0 ⇒ 低 4 位 = 3（連放 3 天：初一～初三）
 * 004525e7  mov  byte [0x46cb06], 0x11   ; 是 0 ⇒ 1 天（聖誕節）
 * ```
 * 计数器每次日推进先减 1，低 4 位归零就停掉節日曲、接回背景曲的**下一首**
 * （`sub_0041cf67` 开头 `0x0041cf6c..0x0041cf94`）。
 */
export function holidayMusicOf(globalMapId: number, holidayIndex: number): { id: number; days: number } | null {
  if (holidayIndex < 0) return null;
  const w = holidayMusicWord(globalMapId, holidayIndex);
  if (!w.flag) return null;
  return { id: w.id, days: holidayMusicWord(globalMapId, holidayIndex + 1).id !== 0 ? 3 : 1 };
}

/** 某地图某節日的插画在 `Data.mkf` 里的资源号；不在表内返回 null */
export function holidayArtResource(globalMapId: number, holidayIndex: number): number | null {
  const base = HOLIDAY_ART_BASE[globalMapId];
  if (base === undefined || holidayIndex < 0) return null;
  return base + holidayIndex;
}

/** 插画的边长 —— 原版备的是一个 200×200 的 `graph_st` @source VA 0x00451a5a `allocate_graph_st(0xc8, 0xc8, 0, 0)` */
export const HOLIDAY_ART_SIZE = 0xc8;

// ============================================================
//  節日送卡（節日表旗标 & 8）
// ============================================================

/**
 * 每张地图**送卡**的那一条節日（節日表 `0x0047ff4a` 记录 `+5` 旗标的 bit3）——稀疏表，实 dump：
 * | 地图 | 槽 | 節日 |
 * |---|---|---|
 * | 0 / 1 / 2 / 3 | 15 / 10 / 18 / 19 | 聖誕節 12/25 |
 * | 4 / 5 / 6 / 7 | 7 / 9 / 12 / 9 | 銀河系和平日 / 恐龍蛋節 / 除夕 / 聖誕節 |
 * 其余 184 条 bit3 都是 0。
 */
const HOLIDAY_CARD_GIFT_SLOT: readonly number[] = [15, 10, 18, 19, 7, 9, 12, 9];

/**
 * 今天这条節日送不送卡。
 *
 * @source `sub_00452444`（日推进 `0x0041d07b` 调，在股市收盘 `0x0041d076` 之后、分紅/開獎之前）：
 * ```asm
 * 00452637  test byte [记录 + 5], 8 / je 结束
 * 00452645  for (esi = 0; esi < 人数; esi++)
 * 00452656    cmp byte [esi + 0x15], 0 / je 下一位          ; 出局者不送
 * 00452664    call 0x441e12(esi)                          ; 按牌堆加权抽一张（袋空返回 0、不掷）
 * 00452670    test eax,eax / je 下一位
 * 0045268e    call 0x41d476（镜头）→ 00452740 call 0x441f73（按地图选框文）
 * 00452753    call 0x44f230(esi, 卡價)                    ; 「好消息」台词（50 < 價 ≤ 100 掷一次 rand）
 * ```
 */
export function holidayGivesCard(globalMapId: number, holidayIndex: number): boolean {
  return holidayIndex >= 0 && HOLIDAY_CARD_GIFT_SLOT[globalMapId] === holidayIndex;
}
