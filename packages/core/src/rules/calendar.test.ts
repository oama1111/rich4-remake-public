/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DAYS_IN_MONTH,
  advanceDate,
  daysInMonth,
  isLeapYear,
  packDate,
  unpackDate,
} from './calendar.ts';

describe('月长表', () => {
  it('★ 与 rich4.exe 0x47638f 逐字节相符', () => {
    expect([...DAYS_IN_MONTH]).toEqual([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it('一年 365 天', () => {
    expect(DAYS_IN_MONTH.reduce((a, b) => a + b, 0)).toBe(365);
  });
});

describe('闰年', () => {
  it('★ 原版只判 4 的倍数 —— 没有百年例外，照搬不改', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(true); // 现实中不是闰年，但原版认为是
    expect(isLeapYear(2100)).toBe(true);
    expect(isLeapYear(2001)).toBe(false);
  });

  it('闰年 2 月 29 天，平年 28 天', () => {
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2001, 2)).toBe(28);
    expect(daysInMonth(2000, 1)).toBe(31);
  });
});

describe('打包', () => {
  it('★ 年<<16 | 月<<8 | 日', () => {
    expect(packDate({ year: 2001, month: 12, day: 25 })).toBe((2001 << 16) | (12 << 8) | 25);
  });

  it('打包与解包互逆', () => {
    for (const d of [
      { year: 1999, month: 1, day: 1 },
      { year: 2001, month: 6, day: 30 },
      { year: 2026, month: 12, day: 31 },
    ]) {
      expect(unpackDate(packDate(d))).toEqual(d);
    }
  });
});

describe('推进', () => {
  it('月中推进不跨月', () => {
    const r = advanceDate({ year: 2001, month: 3, day: 10 });
    expect(r.date).toEqual({ year: 2001, month: 3, day: 11 });
    expect(r.newMonth).toBe(false);
  });

  it('★ 月末跨月，返回 newMonth', () => {
    const r = advanceDate({ year: 2001, month: 3, day: 31 });
    expect(r.date).toEqual({ year: 2001, month: 4, day: 1 });
    expect(r.newMonth).toBe(true);
  });

  it('★ 年末跨年 —— 跨年也算跨月', () => {
    const r = advanceDate({ year: 2001, month: 12, day: 31 });
    expect(r.date).toEqual({ year: 2002, month: 1, day: 1 });
    expect(r.newMonth).toBe(true);
  });

  it('闰年 2 月 29 日之后才跨月', () => {
    expect(advanceDate({ year: 2000, month: 2, day: 28 }).date.day).toBe(29);
    expect(advanceDate({ year: 2000, month: 2, day: 29 }).newMonth).toBe(true);
    expect(advanceDate({ year: 2001, month: 2, day: 28 }).newMonth).toBe(true);
  });

  it('★ 连推一年恰好 365 天、12 次跨月', () => {
    let d = { year: 2001, month: 1, day: 1 };
    let months = 0;
    for (let i = 0; i < 365; i++) {
      const r = advanceDate(d);
      d = r.date;
      if (r.newMonth) months++;
    }
    expect(d).toEqual({ year: 2002, month: 1, day: 1 });
    expect(months).toBe(12);
  });

  it('★ 闰年连推 366 天回到年初', () => {
    let d = { year: 2000, month: 1, day: 1 };
    for (let i = 0; i < 366; i++) d = advanceDate(d).date;
    expect(d).toEqual({ year: 2001, month: 1, day: 1 });
  });

  it('每月 15 号每年恰好来 12 次', () => {
    let d = { year: 2001, month: 1, day: 1 };
    let draws = 0;
    for (let i = 0; i < 365; i++) {
      d = advanceDate(d).date;
      if (d.day === 15) draws++;
    }
    expect(draws).toBe(12);
  });
});
