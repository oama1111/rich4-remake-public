/*
 * 物价指数更新 `rich4_update_price_index` @ `0x423acf` —— 原版真码回归
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 算法（34 条指令 / 85 字节，**无参数、全读全局**）：
 * ```
 * sum = 0 ; count = 0
 * for p in 0 .. [0x499114]-1:
 *     if byte [player(p) + 0x15] == 0: continue   ; whoPlays==0 ⇒ 出局，跳过
 *     sum += wealth(p)                            ; ← 0x4239b9，内部把总资产压成 float32
 *     count++
 * average = trunc(sum / count)          ; 0x423b02 idiv edi
 * next    = trunc(average / [0x49908c]) ; 0x423b0f idiv ecx（除数 = 本局开局资金档位）
 * if next > [0x4990e8]: [0x4990e8] = next       ; 0x423b13 cmp/jle ⇒ **不降级**
 * ```
 *
 * 期望值来自原版机器码（Unicorn 跑 `0x423acf`），见
 * `rich4-spec/tests/test_price_index.py`（29/29）。
 */
import { describe, expect, it } from 'vitest';
import { calculatePlayerWealth, updatePriceIndex } from './wealth.ts';
import { makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_DEAD, WHO_PLAYS_HUMAN } from '../state/types.ts';
import type { Player } from '../state/types.ts';

const INITIAL = 300_000;

function player(cash: number, alive = true, index = 0): Player {
  return makePlayer({
    index,
    cash,
    moneyInBank: 0,
    loan: 0,
    whoPlays: alive ? WHO_PLAYS_HUMAN : WHO_PLAYS_DEAD,
  });
}

/** 与 `reduce.ts` 里接线一致：wealthOf 走 calculatePlayerWealth（无地无股） */
function next(players: readonly Player[], current = 1, initial = INITIAL): number {
  return updatePriceIndex(
    players,
    (p) => calculatePlayerWealth(p, [], [], []),
    initial,
    current,
  );
}

describe('物价指数更新 @ 0x423acf', () => {
  it('单人：next = trunc(资产 / 开局资金)，只在变大时写入', () => {
    expect(next([player(1_000_000)])).toBe(3);
    expect(next([player(599_999)])).toBe(1);
    expect(next([player(600_000)])).toBe(2);
    expect(next([player(899_999)])).toBe(2);
    expect(next([player(900_000)])).toBe(3);
    expect(next([player(0)])).toBe(1);
  });

  it('★ 不降级：当前指数更高时原样返回', () => {
    expect(next([player(1_000_000)], 99)).toBe(99);
    expect(next([player(1_000_000)], 3)).toBe(3);
  });

  it('出局者（whoPlays == 0）既不计分子也不计分母', () => {
    expect(next([player(1_000_000), player(0, false), player(0, false), player(0, false)]))
      .toBe(3);
    expect(next([player(0, false), player(0, false), player(1_000_000, true, 2),
      player(0, false)])).toBe(3);
    expect(next([player(0, false), player(1_200_000, true, 1),
      player(600_000, true, 2), player(0, false)])).toBe(3);
  });

  it('4 人全活时平均值按 4 人算', () => {
    expect(next([player(300_000), player(300_000), player(300_000), player(300_000)]))
      .toBe(1);
    expect(next([player(450_000), player(450_000), player(450_000), player(450_000)]))
      .toBe(1);
    expect(next([player(600_000), player(600_000), player(600_000), player(600_000)]))
      .toBe(2);
  });

  it('除数是**本局开局资金档位**', () => {
    expect(next([player(1_000_000)], 1, 30_000)).toBe(33);
    expect(next([player(1_000_000)], 1, 1_000_000)).toBe(1);
    expect(next([player(1_000_000)], 1, 100_000)).toBe(10);
  });

  it('★★ 总资产的 float32 量化会穿透到物价指数（差 1 档）', () => {
    // 99899999 → f32 = 99900000 ⇒ trunc(99900000/300000) = 333
    // 纯精确模型会给 trunc(99899999/300000) = 332
    expect(next([player(99_899_999)])).toBe(333);
    expect(Math.trunc(99_899_999 / INITIAL)).toBe(332);
    // 89999999 → f32 = 90000000 ⇒ 300（精确 299）
    expect(next([player(89_999_999)])).toBe(300);
    expect(Math.trunc(89_999_999 / INITIAL)).toBe(299);
    // 不跨界的例子：量化了但结论不变
    expect(next([player(99_999_999)])).toBe(333);
    expect(next([player(2 ** 24 + 1)])).toBe(55);
  });
});
