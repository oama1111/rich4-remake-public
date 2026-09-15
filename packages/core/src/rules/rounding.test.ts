/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * `__round_toward_zero`（VA 0x00457dbc）的语义 —— 向零截断
 *
 * 判据见本目录 `rounding.ts` 的头部反汇编与 `docs/deviations/Q-NUM-1.md`。
 */

import { describe, expect, it } from 'vitest';
import { truncTowardZero } from './rounding.ts';
import { percentageOf, NEWS_TAX_RATE, BANK_DIVIDEND_RATE } from './percentage.ts';
import { auctionBasePrice } from './auction.ts';

describe('0x457dbc = 向零截断（RC=11 的 frndint）', () => {
  it('非 .5 时与四舍五入/向下取整无分歧', () => {
    expect(truncTowardZero(1.2)).toBe(1);
    expect(truncTowardZero(1.8)).toBe(1);
    expect(truncTowardZero(2.9999)).toBe(2);
  });

  it('★ 恰好 .5（各符号、各奇偶）一律向零', () => {
    expect(truncTowardZero(0.5)).toBe(0);
    expect(truncTowardZero(1.5)).toBe(1);
    expect(truncTowardZero(2.5)).toBe(2);
    expect(truncTowardZero(-0.5)).toBe(-0);
    expect(truncTowardZero(-1.5)).toBe(-1);
    expect(truncTowardZero(-2.5)).toBe(-2);
  });

  it('★ 负数方向：向零截断 ≠ floor；且只有在 |v| 位于奇数 .5 一带时才 ≠ round', () => {
    expect(truncTowardZero(-2.6)).toBe(-2);
    expect(Math.floor(-2.6)).toBe(-3);
    expect(Math.round(-2.6)).toBe(-3);
    expect(truncTowardZero(-3.5)).toBe(-3);
    expect(Math.floor(-3.5)).toBe(-4);
    expect(truncTowardZero(-4.5)).toBe(-4);
  });

  it('★ 旧误读（就近取偶）在这些点上会给不同答案', () => {
    const banker = (v: number): number => {
      const f = Math.floor(v);
      const d = v - f;
      if (d > 0.5) return f + 1;
      if (d < 0.5) return f;
      return f % 2 === 0 ? f : f + 1;
    };
    // 分叉点：整数部分为奇数（1.5→1 vs 2、3.5→3 vs 4、7.5→7 vs 8）
    for (const v of [1.5, 3.5, 7.5, 1499.5, 1501.5]) {
      expect(truncTowardZero(v)).not.toBe(banker(v));
    }
    // 同值点：整数部分为偶数（0.5→0、2.5→2、52.5→52）
    for (const v of [0.5, 2.5, 52.5]) {
      expect(truncTowardZero(v)).toBe(banker(v));
    }
  });

  it('★ 与各规则模块的结果一致（税率/红利/拍賣起拍价）', () => {
    // 所得税：cash = 20k+10 时正好落在 .5
    for (const cash of [10, 30, 50, 150, 1050, 1051]) {
      expect(percentageOf(cash, NEWS_TAX_RATE)).toBe(truncTowardZero(cash * NEWS_TAX_RATE));
    }
    for (const bank of [5, 15, 25, 50001]) {
      expect(percentageOf(bank, BANK_DIVIDEND_RATE)).toBe(truncTowardZero(bank * BANK_DIVIDEND_RATE));
    }
    // 拍賣起拍价：等级奇数 ⇒ 系数 x.5
    expect(auctionBasePrice({ landPrice: 1, level: 1 }, 1)).toBe(1); // 1 × 1.5 = 1.5 → 1
    expect(auctionBasePrice({ landPrice: 3, level: 1 }, 1)).toBe(4); // 3 × 1.5 = 4.5 → 4
    expect(auctionBasePrice({ landPrice: 1, level: 1 }, 1)).toBe(
      truncTowardZero(1 * (1 + 1 * 0.5)),
    );
  });
});
