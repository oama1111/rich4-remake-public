/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 神明对过路费的影响 —— 以 VA 0x0041d709 的 6 路跳表为准
 */

import { describe, expect, it } from 'vitest';
import {
  GOD_BIG_FORTUNE,
  GOD_BIG_LUCK,
  GOD_BIG_POVERTY,
  GOD_SMALL_FORTUNE,
  GOD_SMALL_LUCK,
  GOD_SMALL_POVERTY,
  adjustTollByGod,
  FACILITY_TOLL_BASE,
  facilityToll,
  trafficMultiplier,
} from './god-toll.ts';

describe('財神减免', () => {
  it('小財神：减免一半', () => {
    expect(adjustTollByGod(1000, GOD_SMALL_FORTUNE)).toEqual({ toll: 500, changed: true });
  });

  it('大財神：全免', () => {
    expect(adjustTollByGod(1000, GOD_BIG_FORTUNE)).toEqual({ toll: 0, changed: true });
  });
});

describe('★ 福神对过路费没有影响', () => {
  it('小福神与大福神都原样返回', () => {
    for (const god of [GOD_SMALL_LUCK, GOD_BIG_LUCK]) {
      expect(adjustTollByGod(1000, god)).toEqual({ toll: 1000, changed: false });
    }
  });
});

describe('窮神加成', () => {
  it('小窮神：加付 50%', () => {
    expect(adjustTollByGod(1000, GOD_SMALL_POVERTY)).toEqual({ toll: 1500, changed: true });
  });

  it('大窮神：加倍', () => {
    expect(adjustTollByGod(1000, GOD_BIG_POVERTY)).toEqual({ toll: 2000, changed: true });
  });
});

describe('★ sar 是算术右移，奇数向下取整', () => {
  it('小財神：999 → 499，不是 500', () => {
    expect(adjustTollByGod(999, GOD_SMALL_FORTUNE).toll).toBe(499);
  });

  it('小窮神：999 → 1498，不是 1499', () => {
    // toll + floor(toll/2) = 999 + 499
    expect(adjustTollByGod(999, GOD_SMALL_POVERTY).toll).toBe(1498);
  });

  it('租金为 1 时小財神直接抹成 0', () => {
    expect(adjustTollByGod(1, GOD_SMALL_FORTUNE)).toEqual({ toll: 0, changed: true });
  });
});

describe('跳表范围', () => {
  it('无附身（0）不调整', () => {
    expect(adjustTollByGod(1000, 0)).toEqual({ toll: 1000, changed: false });
  });

  it('★ 7 及以上落在跳表外，原样返回（dec al / cmp al,5 / ja）', () => {
    for (const god of [7, 8, 12, 15, 46]) {
      expect(adjustTollByGod(1000, god)).toEqual({ toll: 1000, changed: false });
    }
  });

  it('changed 只在金额真的变了时为 true', () => {
    // 大財神把 0 变成 0 —— 金额没变
    expect(adjustTollByGod(0, GOD_BIG_FORTUNE)).toEqual({ toll: 0, changed: false });
  });
});

describe('★ 设施过路费 = 步数 × 500 × 交通倍率 × 物价指数', () => {
  it('基数是 500', () => {
    expect(FACILITY_TOLL_BASE).toBe(500);
  });

  it('★ 倍率由付款方的 traffic_method 低 2 位决定：1 / 2 / 4', () => {
    expect(trafficMultiplier(1)).toBe(1);
    expect(trafficMultiplier(2)).toBe(2);
    expect(trafficMultiplier(3)).toBe(4);
  });

  it('★ 低 2 位为 0（没有交通工具）→ 完全不收费', () => {
    expect(trafficMultiplier(0)).toBe(0);
    expect(facilityToll(6, 0, 10)).toBe(0);
  });

  it('高位不参与，只看低 2 位', () => {
    expect(trafficMultiplier(0xfc | 1)).toBe(trafficMultiplier(1));
    expect(trafficMultiplier(0x80 | 3)).toBe(4);
  });

  it('步数翻倍则费用翻倍', () => {
    expect(facilityToll(3, 1, 1)).toBe(1500);
    expect(facilityToll(6, 1, 1)).toBe(3000);
  });

  it('再乘物价指数', () => {
    expect(facilityToll(3, 1, 7)).toBe(10_500);
  });

  it('★ 与住宅的区别：走的步数不同，设施费用就不同', () => {
    expect(facilityToll(2, 1, 1)).not.toBe(facilityToll(5, 1, 1));
  });
});
