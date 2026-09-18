/*
 * 證交稅基数（持股市值）的 **float32 逐步累加** —— 原版真码回归
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版区块 `0x44a0c6`..`0x44a110`（事件表第 13 项 `0x44a029` 的持股遍历循环）：
 * ```asm
 * 0044a0e5  fild dword [持股表 + ...]        ; 持股数（int32，精确）
 * 0044a0f9  fmul dword [股价表 + i*0x24]     ; × 现价（float32）
 * 0044a100  fadd dword [esp + ebx*4 + 0x94]  ; 加进合计数
 * 0044a107  fstp dword [esp + ebx*4 + 0x94]  ; ★ 每步把合计数**存回 float32**
 * ```
 * ⇒ 合计数每一步都被压回 24 位尾数。产品本身在 x87 里按 PC=双精度（53 位）算，
 *   与 JS 双精度位级一致；**只有"存回"那一步**是 float32。
 *
 * 本文件里的期望值全部由 **原版机器码**（Unicorn）跑出来，不是手算：
 * 见 `rich4-spec/tools/scratch/probe_stock_sum.py` 与
 * `rich4-spec/tests/test_inline_formulas.py` §10。
 */
import { describe, expect, it } from 'vitest';
import { stockTax, stockValue } from './percentage.ts';

/** 原版真值算例：持股与现价（现价是 float32，写成 double 是其精确值） */
const HOLDS = [9572, 3546, 5541, 8967, 9430, 683, 0, 0, 0, 0, 0, 0];
const PRICES = [
  141.9310760498047, 78.52230072021484, 284.5124816894531,
  57.75619888305664, 238.64231872558594, 113.8723373413086,
  0, 0, 0, 0, 0, 0,
];

describe('★ 持股市值：原版每步把合计数存回 float32（fstp dword）', () => {
  it('原版合计 = 6059560（float32 累加），不是 6059559.70671463（双精度）', () => {
    expect(stockValue(HOLDS, PRICES)).toBe(6_059_560);
  });

  it('差别会落到税上：證交稅 302978（原版）而不是 302977（双精度）', () => {
    // 若改回双精度累加，这里会得到 302977 —— 这正是本轮修掉的 1 元偏差
    const naive = Math.trunc(6_059_559.70671463 * 0.05);
    expect(naive).toBe(302_977);
    expect(stockTax(HOLDS, PRICES, 1)).toBe(302_978);
  });

  it('不带小数、或金额小的时候两者一致（修复没有引入回归）', () => {
    const h = [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const p = [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(stockValue(h, p)).toBe(12_000);
    expect(stockValue([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [12.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(37.5);
  });

  it('空持股 / 全 0 → 0', () => {
    expect(stockValue([], [])).toBe(0);
    expect(stockValue([0, 0], [10, 20])).toBe(0);
  });

  it('合计数一旦超过 2^24，float32 量化就显形（原版真值 8448000）', () => {
    // 单支 1000 股 × 8448 元 = 8448000 > 2^24 ⇒ f32 只能表示到 ULP=1
    const v = stockValue([1000], [8448]);
    expect(v).toBe(8_448_000);
    expect(Math.fround(v)).toBe(v); // 仍是 float32 可表示值
  });
});
