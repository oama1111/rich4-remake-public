/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 節日配乐的节拍（W-17）—— 一天一天推过去，看哪天起曲、哪天接回背景曲。
 */
import { describe, expect, it } from 'vitest';
import { daysInMonth, holidayIndexOf } from '@rich4/core';
import { holidayBgmOnDayAdvance } from './holiday-bgm.ts';

/** 从 (y,m,d) 起连推 n 天，返回每一天推进后的记录 */
function walk(map: number, y: number, m: number, d: number, n: number) {
  const out: { date: string; days: number; ended: boolean; play: string | null }[] = [];
  let days = 0;
  for (let i = 0; i < n; i++) {
    d += 1;
    if (d > daysInMonth(y, m)) { d = 1; m += 1; if (m > 12) { m = 1; y += 1; } }
    const s = holidayBgmOnDayAdvance(days, map, y, m, d);
    days = s.days;
    out.push({ date: `${y}-${m}-${d}`, ...s });
  }
  return out;
}

describe('★ 節日配乐的节拍 @source sub_0041cf67 / sub_00452444', () => {
  it('聖誕節：12/25 那天起 MIDI14-1，12/26 一到就接回背景曲', () => {
    const w = walk(0, 2010, 12, 23, 4); // 推到 24、25、26、27
    expect(w.map((x) => x.play)).toEqual([null, 'midi14-1.mid', null, null]);
    expect(w.map((x) => x.days)).toEqual([0, 1, 0, 0]);
    expect(w.map((x) => x.ended)).toEqual([false, false, true, false]);
  });

  it('農曆新年：初一起 MIDI14-2，初二、初三**不重起**，初四一到才接回背景曲', () => {
    // 先找出 2011 年的農曆正月初一落在公历哪天（用 core 自己的節日判定，不手算）
    const y = 2011;
    let m = 1;
    let d = 1;
    while (holidayIndexOf(0, y, m, d) !== 17) { d += 1; if (d > daysInMonth(y, m)) { d = 1; m += 1; } }
    // 从初一的**前两天**起连推 6 天：除夕前一天、除夕、初一、初二、初三、初四
    const py = y;
    let pm = m;
    let pd = d - 3;
    if (pd < 1) { pm -= 1; pd += daysInMonth(py, pm); }
    const w = walk(0, py, pm, pd, 6);
    expect(w.map((x) => x.play)).toEqual([null, null, 'midi14-2.mid', null, null, null]);
    expect(w.map((x) => x.days)).toEqual([0, 0, 3, 2, 1, 0]);
    expect(w.map((x) => x.ended)).toEqual([false, false, false, false, false, true]);
  });

  it('没有配乐的節日（元旦）与后四张图：什么都不发生', () => {
    expect(holidayBgmOnDayAdvance(0, 0, 2011, 1, 1)).toEqual({ days: 0, ended: false, play: null });
    expect(holidayBgmOnDayAdvance(0, 5, 2010, 12, 25)).toEqual({ days: 0, ended: false, play: null });
  });

  it('★ 節日曲还没放完就不重起（计数器非 0 ⇒ `0x00452586 jne` 跳过）', () => {
    // 人为造一个「还剩 2 天」的计数器撞上聖誕：只减不起
    expect(holidayBgmOnDayAdvance(2, 0, 2010, 12, 25)).toEqual({ days: 1, ended: false, play: null });
    // 恰好减到 0 的那一天又是有配乐的節日 ⇒ 先收、再起（原版两段代码先后都会走到）
    expect(holidayBgmOnDayAdvance(1, 0, 2010, 12, 25)).toEqual({ days: 1, ended: true, play: 'midi14-1.mid' });
  });
});
