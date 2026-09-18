/*
 * 总资产里股票部分的 **f32(total)** 怪癖 —— 原版真码回归
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版 `calculate_player_wealth` 的股票循环（`0x4239e0`..`0x423a1e`）：
 * ```asm
 * 004239ec  fild dword [持股表 + ...]        ; 持股数
 * 004239f8  fmul dword [股价表 + i*0x24]     ; × 现价（float32）
 * 004239ff  mov eax, [esp]                   ; 当前整数总资产
 * 00423a02  mov [esp+4], eax
 * 00423a06  fild dword [esp+4]               ; 装入（精确）
 * 00423a0a  fstp dword [esp+4]               ; ★ 又存回 float32（>2^24 丢低位）
 * 00423a0e  fadd dword [esp+4]               ; 加上这个被舍入过的总资产
 * 00423a12  call 0x457dbc                    ; 向零截断
 * 00423a17  fistp dword [esp]                ; 写回整数总资产
 * ```
 * ⇒ `total = trunc(市值 + f32(total))`。
 *
 * 期望值由**原版机器码**（Unicorn）跑出，见
 * `rich4-spec/tools/scratch/probe_stock_sum.py` 与
 * `rich4-spec/tests/test_inline_formulas.py` §10。
 */
import { describe, expect, it } from 'vitest';
import { calculatePlayerWealth } from './wealth.ts';
import { makePlayer } from '../testing/factories.ts';

/**
 * 持股 1000 股 × 10.35 元。
 * ⚠️ 现价必须用**它真正存进去的那个 float32 值** —— 原版股价表是 float32，
 *    `Math.fround(10.35) = 10.350000381469727`；直接用 10.35 会和原版差 1~19。
 */
const PRICE = Math.fround(10.35);
const STOCKS = [{ amount: 1000, price: PRICE }];

function wealthWith(total0: number): number {
  return calculatePlayerWealth(
    makePlayer({ cash: total0, moneyInBank: 0, loan: 0, index: 0 }),
    [],
    [],
    STOCKS,
  );
}

describe('★ 总资产：原版把运行中的总资产每步压回 float32（fstp dword）', () => {
  it('2^24 及以下：与纯双精度一致', () => {
    expect(wealthWith(0)).toBe(10_350);
    expect(wealthWith(10_000_000)).toBe(10_010_350);
    expect(wealthWith(2 ** 24)).toBe(16_787_566);
  });

  it('★ 2^24 边界之上：原版 16787566，纯双精度会给 16787567', () => {
    expect(wealthWith(2 ** 24 + 1)).toBe(16_787_566);
    expect(Math.trunc(1000 * PRICE + (2 ** 24 + 1))).toBe(16_787_567);
  });

  it('★ 大额玩家：999,999,999 → 原版 1000010368，纯双精度 1000010349（差 19）', () => {
    expect(wealthWith(999_999_999)).toBe(1_000_010_368);
    expect(Math.trunc(1000 * PRICE + 999_999_999)).toBe(1_000_010_349);
  });

  it('千万级也已经在偏移：123,456,789 → 123467144（双精度 123467139）', () => {
    expect(wealthWith(123_456_789)).toBe(123_467_144);
    expect(Math.trunc(1000 * PRICE + 123_456_789)).toBe(123_467_139);
  });

  it('1 亿：100010352（双精度 100010350）', () => {
    expect(wealthWith(100_000_000)).toBe(100_010_352);
  });

  it('★ 空仓也照样被量化：原版 12 轮一轮不落，每轮都 f32(total)', () => {
    // 原版真值（Unicorn 跑 0x4239e0..0x423a20，持股全 0）：
    //   999999999 → 1000000000 ；16777217 → 16777216（**往下**舍）；
    //   123456789 → 123456792 ；1000 → 1000（小额不受影响）
    const empty = (cash: number) => calculatePlayerWealth(
      makePlayer({ cash, moneyInBank: 0, loan: 0 }), [], [], [],
    );
    expect(empty(999_999_999)).toBe(1_000_000_000);
    expect(empty(2 ** 24 + 1)).toBe(2 ** 24);
    expect(empty(123_456_789)).toBe(123_456_792);
    expect(empty(1000)).toBe(1000);
  });
});
