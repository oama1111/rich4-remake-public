/*
 * 節日配乐的节拍（W-17）—— 纯函数，宿主（`main.ts`）只管照着放
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版靠一个字节 `[0x46cb06]`（低 4 位 = 節日曲还要放几天）：
 *
 * | 时机 | 做什么 | 出处 |
 * |---|---|---|
 * | 每次**日推进**，先 | 低 4 位非 0 ⇒ 减 1；减到 0 ⇒ 清零、停曲、`sub_00454d91(0)`（背景曲**下一首**）| `sub_0041cf67` 开头 `0x0041cf6c..0x0041cf94` |
 * | 日期推进之后 | 今天的節日记录旗标 `& 4`、且计数器为 0 ⇒ `fcn_004549cf(曲号 \| 0x8000)`，计数器 = `0x33` / `0x11` | `sub_00452444`（`0x0041d07b` 调）|
 * | 计数器非 0 期间 | **场所曲一律不放**（`fcn_004549cf` 开头 `0x004549da cmp [0x46cb06],0 / jne 返回`），场所收屏也不接背景曲（`sub_00454bcc` 的 `0x00454bd5` 同一道闸）| — |
 * | 新开一局 / 读档 | 清零 | `0x00401dc4` / `0x00404128` |
 *
 * ⇒ 聖誕節放一整天；農曆初一放到初三过完。期间进銀行、商店、拍賣，听到的仍是節日曲。
 */

import { bgmAssetFileFor } from '@rich4/assets-pipeline';
import { holidayIndexOf, holidayMusicOf } from '@rich4/core';

export interface HolidayBgmStep {
  /** 推进之后计数器的值（还要放几天）*/
  days: number;
  /** 这一次推进把節日曲放完了 ⇒ 宿主接回背景曲的下一首 */
  ended: boolean;
  /** 这一次推进要起一首節日曲（文件名，如 `midi14-1.mid`）；不起 = null */
  play: string | null;
}

/**
 * 一次日推进对節日配乐的影响。
 *
 * @param days 推进**之前**计数器的值
 * @param year/month/day 推进**之后**的日期
 */
export function holidayBgmOnDayAdvance(
  days: number,
  globalMapId: number,
  year: number,
  month: number,
  day: number,
): HolidayBgmStep {
  let left = Math.max(0, days);
  let ended = false;
  // ① 先减（@source 0x0041cf72 `test ah,0xf` … 0x0041cf94）
  if (left > 0) {
    left -= 1;
    if (left === 0) ended = true;
  }
  // ② 再看新的一天（@source 0x0045257d / 0x00452586：旗标 & 4，且计数器已经是 0）
  let play: string | null = null;
  if (left === 0) {
    const hm = holidayMusicOf(globalMapId, holidayIndexOf(globalMapId, year, month, day));
    const file = hm === null ? null : bgmAssetFileFor(hm.id);
    if (hm !== null && file !== null) {
      play = file;
      left = hm.days;
    }
  }
  return { days: left, ended, play };
}
