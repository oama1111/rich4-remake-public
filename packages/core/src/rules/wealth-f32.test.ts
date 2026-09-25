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
import { makeLand, makePlayer } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

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

/**
 * ★★ WLT-02：累加器是 **32 位整数**（帧里那一格 `[esp]`），`fistp dword` 越界时
 *   存 x87 的「整数不确定值」`0x80000000`。
 *
 * 期望值由**原版真码**（Unicorn）跑 `0x4239db..0x423a20` 实测（注入口袋与持股/股价、
 * 回读 `[esp]`）：
 * ```
 * total=INT_MAX、无持股          → -2147483648
 * total=2^31、无持股             → -2147483648
 * 持股 1000×2e6 = 2e9、total=0   → 2000000000     （范围内精确）
 * 持股 1000×3e6 = 3e9、total=0   → -2147483648    （fistp 溢出）
 * total=2e9 + 1000×3e5           → -2147483648
 * total=INT_MAX + 1000×1e3       → -2147483648
 * ```
 */
describe('★★ WLT-02：身家是 32 位整数（fistp 溢出 ⇒ 0x80000000）', () => {
  const INT_MIN = -2_147_483_648;
  const withStocks = (cash: number, bank: number, amount: number, price: number): number =>
    calculatePlayerWealth(
      makePlayer({ cash, moneyInBank: bank, loan: 0, index: 0 }),
      [],
      [],
      [{ amount, price }],
    );

  it('★ 口袋相加就是 32 位加法：INT_MAX + 1 ⇒ INT_MIN', () => {
    expect(calculatePlayerWealth(makePlayer({ cash: 2 ** 31 - 1, moneyInBank: 1, loan: 0 }), [], [], []))
      .toBe(INT_MIN);
  });

  it('★ f32(total) 之后越界 ⇒ fistp 存整数不确定值：2^31 ⇒ INT_MIN', () => {
    expect(withStocks(2 ** 31, 0, 0, 0)).toBe(INT_MIN);
  });

  it('范围内照样精确：1000 × 2e6 = 2e9', () => {
    expect(withStocks(0, 0, 1000, 2_000_000)).toBe(2_000_000_000);
  });

  it('★ 市值把 total 顶出 int32 ⇒ INT_MIN（3e9）', () => {
    expect(withStocks(0, 0, 1000, 3_000_000)).toBe(INT_MIN);
  });

  it('★ 20 亿 + 3 亿 ⇒ INT_MIN', () => {
    expect(withStocks(2_000_000_000, 0, 1000, 300_000)).toBe(INT_MIN);
  });

  it('★ 地块/設施的加法也回绕（`add ebp, ecx` 是 32 位）', () => {
    const land = makeLand({ id: 1, owner: 1, landPrice: 50_000, housePrice: 0, type: LAND_TYPE_HOUSE });
    const s = calculatePlayerWealth(
      makePlayer({ cash: 2 ** 31 - 1, moneyInBank: 0, loan: 0, index: 0 }),
      [land],
      [],
      [],
    );
    // INT_MAX 先被股票那 12 轮压成 f32(INT_MAX) = 2^31（f32 的最近值）→ fistp 越界 ⇒ INT_MIN，
    // 再加地价仍是 INT_MIN + 50000（不越界时就是普通加法）
    expect(s).toBe((INT_MIN + 50_000) | 0);
  });
});
