/*
 * 开局资金档位（`_rich4_game_initial_fund` `[0x49908c]`）进状态 —— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这个值**不只是「发多少钱」**，它同时是两处**规则**的输入：
 *
 * | 用处 | 原版 | 本引擎 |
 * |---|---|---|
 * | 开局发钱（现金/存款按角色比例分）| `startingMoney()` @0x00407177 | `rules/setup.ts` |
 * | **物价指数的除数**（档位越小通胀越快）| `fcn_00423acf`：`fild 平均身家 / fild [0x49908c]` | `rules/wealth.ts` `updatePriceIndex` |
 * | **AI 买地保留额的基数**（= 档位 × 5%，封顶 7000）| `fcn_0041d7d4` 一带 | `rules/purchase.ts` `aiShouldPurchase` |
 *
 * ⚠️ 2026-09-16 之前：`GameState` 里**没有**这个字段，上面后两处都硬编码
 *   `DEFAULT_INITIAL_FUND`（30 万）。玩家在开局設定选 3 万档时发钱按 3 万、
 *   但通胀与 AI 门槛仍按 30 万算 —— 档位这个难度旋钮有一半是坏的。
 *
 * 本文件钉住三件事：① `newGame` 把它写进状态；② 存档解析器**读**它；
 * ③ 两处规则真的按它走（换档位会改变结果）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { newGame } from './new-game.ts';
import {
  GAME_INITIAL_FUNDS,
  DEFAULT_INITIAL_FUND,
  START_DATE_MAX,
  START_DATE_MIN,
  defaultStartDate,
  startingMoney,
} from './setup.ts';
import { updatePriceIndex, calculatePlayerWealth } from './wealth.ts';
import { aiShouldPurchase, AI_PURCHASE_RESERVE_RATIO, AI_PURCHASE_RESERVE_CAP } from './purchase.ts';
import { makePlayer } from '../testing/factories.ts';
import { parseSave, OFFSET } from '../loaders/save.ts';
import { parseMap } from '../loaders/map.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const SAVE0 = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/Save0.dat';
/** 素材在就跑、不在就跳过 —— 与仓库里其它对二进制取证的用例同一套写法 */
const haveMap = existsSync(MAP) ? it : it.skip;
const haveSave = existsSync(SAVE0) ? it : it.skip;

/** 保留额公式（= `aiShouldPurchase` 里那一行）*/
const reserveOf = (fund: number): number =>
  Math.min(Math.trunc(fund * AI_PURCHASE_RESERVE_RATIO), AI_PURCHASE_RESERVE_CAP);

describe('★ 档位表本身', () => {
  it('六档，从高到低；第一档就是默认值 @source 0x46cb94（6 项）', () => {
    expect(GAME_INITIAL_FUNDS).toHaveLength(6);
    expect(GAME_INITIAL_FUNDS[0]).toBe(DEFAULT_INITIAL_FUND);
    for (let i = 1; i < GAME_INITIAL_FUNDS.length; i++) {
      expect(GAME_INITIAL_FUNDS[i]!, `第 ${i} 档`).toBeLessThan(GAME_INITIAL_FUNDS[i - 1]!);
    }
  });
});

describe('★ ① newGame 把档位写进状态', () => {
  haveMap('★ `GameState.initialFund` = 传进去的那一档（六档逐个验）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    for (const fund of GAME_INITIAL_FUNDS) {
      const s = newGame({
        map,
        players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
        initialFund: fund,
        seed: 5,
      });
      expect(s.initialFund, `档位 ${fund}`).toBe(fund);
    }
  });

  haveMap('不传时用默认档（30 万）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const s = newGame({
      map,
      players: [0, 1].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 5,
    });
    expect(s.initialFund).toBe(DEFAULT_INITIAL_FUND);
  });

  haveMap('★ 发钱确实按档位走（起手现金 + 存款 = 档位）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    for (const fund of GAME_INITIAL_FUNDS) {
      const s = newGame({
        map,
        players: [0, 1].map((i) => ({ character: i, kind: 'computer' as const })),
        initialFund: fund,
        seed: 5,
      });
      const want = startingMoney(0, fund);
      expect(s.players[0]!.cash + s.players[0]!.moneyInBank, `档位 ${fund}`).toBe(fund);
      expect(s.players[0]!.cash, `档位 ${fund}`).toBe(want.cash);
    }
  });
});

describe('★ ② 存档解析器读这一格 @source 0x268a', () => {
  it('偏移表里有 initialFund，且就在 priceIndex 之前', () => {
    expect(OFFSET.initialFund).toBe(0x268a);
    expect(OFFSET.priceIndex).toBe(0x268e);
    expect(OFFSET.initialFund).toBeLessThan(OFFSET.priceIndex);
  });

  haveSave('Save0.dat 实测：0x268a = 300000，解析器把它读出来', () => {
    const data = new Uint8Array(readFileSync(SAVE0));
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(view.getInt32(OFFSET.initialFund, true)).toBe(DEFAULT_INITIAL_FUND);
    expect(parseSave(data).initialFund).toBe(DEFAULT_INITIAL_FUND);
  });
});

describe('★ ③ 物价指数的除数就是这一档（换档位结果不同）', () => {
  it('同一份身家：档位越小，指数涨得越高', () => {
    const p = makePlayer({ index: 0, cash: 900_000, moneyInBank: 0 });
    const wealth = (): number => calculatePlayerWealth(p, [], [], []);
    const hi = updatePriceIndex([p], wealth, 300_000, 1);
    const lo = updatePriceIndex([p], wealth, 30_000, 1);
    // 90 万 / 30 万 = 3；90 万 / 3 万 = 30
    expect(hi).toBe(3);
    expect(lo).toBe(30);
    expect(lo).toBeGreaterThan(hi);
  });

  it('★ 硬编码 30 万是错的：选 3 万档时除数必须是 3 万', () => {
    const p = makePlayer({ index: 0, cash: 60_000, moneyInBank: 0 });
    const wealth = (): number => calculatePlayerWealth(p, [], [], []);
    // 6 万 / 3 万 = 2；若错用 30 万则得 0（0 不大于现值 1 ⇒ 指数永远不动）
    expect(updatePriceIndex([p], wealth, 30_000, 1)).toBe(2);
    expect(updatePriceIndex([p], wealth, DEFAULT_INITIAL_FUND, 1)).toBe(1);
  });

  it('除数 0 时原样返回（防除零）', () => {
    const p = makePlayer({ index: 0, cash: 999_999 });
    expect(updatePriceIndex([p], () => 999_999, 0, 7)).toBe(7);
  });
});

describe('★ ③ AI 买地保留额的基数也是这一档', () => {
  // @source `aiShouldPurchase`：`现金 + 存款 − 价 > min(档位×5%, 7000) × 物价指数`
  it('保留额 = 档位 × 5%，封顶 `AI_PURCHASE_RESERVE_CAP`（= 7000）', () => {
    expect(AI_PURCHASE_RESERVE_RATIO).toBe(0.05);
    expect(AI_PURCHASE_RESERVE_CAP).toBe(7_000);
    expect(reserveOf(30_000)).toBe(1_500);
    expect(reserveOf(100_000)).toBe(5_000);
    expect(reserveOf(200_000)).toBe(7_000);
    expect(reserveOf(300_000)).toBe(7_000);
    // ⇒ 高档位之间没有差别（都被顶到 7000），只有低档位才拉开
    expect(reserveOf(300_000)).toBe(reserveOf(200_000));
    expect(reserveOf(10_000)).toBe(500);
  });

  it('★ 换档位会改变同一笔购买的决定（硬编码 30 万就是错的）', () => {
    const p = makePlayer({ index: 0, cash: 5_000, moneyInBank: 0 });
    // 3 万档：保留额 1500 ⇒ 4000 > 1500 ⇒ 买
    expect(aiShouldPurchase(p, 1_000, 30_000, 1)).toBe(true);
    // 30 万档：保留额 7000 ⇒ 4000 不大于 7000 ⇒ 不买
    expect(aiShouldPurchase(p, 1_000, 300_000, 1)).toBe(false);
  });

  it('使用**现金 + 存款**（不只是现金）', () => {
    const p = makePlayer({ index: 0, cash: 0, moneyInBank: 5_000 });
    expect(aiShouldPurchase(p, 1_000, 30_000, 1)).toBe(true);
  });

  it('判据是**严格大于**（正好等于保留额不放行）', () => {
    const exact = makePlayer({ index: 0, cash: 2_500, moneyInBank: 0 });
    expect(aiShouldPurchase(exact, 1_000, 30_000, 1)).toBe(false);
    const plus1 = makePlayer({ index: 0, cash: 2_501, moneyInBank: 0 });
    expect(aiShouldPurchase(plus1, 1_000, 30_000, 1)).toBe(true);
  });

  it('保留额也要乘物价指数', () => {
    const p = makePlayer({ index: 0, cash: 5_000, moneyInBank: 0 });
    // 指数 1：4000 > 1500 ⇒ 买；指数 3：4000 > 4500 ⇒ 不买
    expect(aiShouldPurchase(p, 1_000, 30_000, 1)).toBe(true);
    expect(aiShouldPurchase(p, 1_000, 30_000, 3)).toBe(false);
  });
});

// ============================================================
//  ★ 起始日期 = 系统当天（钳到 1998-01-01 .. 2010-01-01）
//    @source `_rich4_read_config`（VA 0x00411e8f）：读配置文件之后**无条件**用
//    `libc_getdate()`（Win32 `GetLocalTime`）覆盖 cfg 的 day/month/year；
//    钳位常量 0x7ce / 0x7da 在 VA 0x00411f30 / 0x00411f49。
//    ⇒ 2010 年之后的机器一律从 **2010-01-01** 开始，不是写死的 1998-01-01。
// ============================================================

describe('★ 起始日期', () => {
  it('上下限常量 = 1998-01-01 / 2010-01-01 @source 0x7ce / 0x7da', () => {
    expect(START_DATE_MIN).toEqual({ year: 1998, month: 1, day: 1 });
    expect(START_DATE_MAX).toEqual({ year: 2010, month: 1, day: 1 });
  });

  it('★ `newGame` 缺省 = `START_DATE_MAX`（core 不许读真实时间，C-DET-2）', () => {
    expect(START_DATE_MAX).toEqual({ year: 2010, month: 1, day: 1 });
  });

  it('★ 年 > 2010 ⇒ 钳到 2010-01-01（今天的机器走这一支）', () => {
    expect(defaultStartDate(new Date(2026, 8, 16))).toEqual({ year: 2010, month: 1, day: 1 });
    expect(defaultStartDate(new Date(2011, 0, 2))).toEqual({ year: 2010, month: 1, day: 1 });
  });

  it('★ 年 < 1998 ⇒ 钳到 1998-01-01', () => {
    expect(defaultStartDate(new Date(1997, 11, 31))).toEqual({ year: 1998, month: 1, day: 1 });
    expect(defaultStartDate(new Date(1980, 5, 5))).toEqual({ year: 1998, month: 1, day: 1 });
  });

  it('★ 区间内就是**当天**（不重置月日）', () => {
    expect(defaultStartDate(new Date(2005, 5, 15))).toEqual({ year: 2005, month: 6, day: 15 });
    expect(defaultStartDate(new Date(1998, 0, 1))).toEqual({ year: 1998, month: 1, day: 1 });
    expect(defaultStartDate(new Date(2010, 11, 31))).toEqual({ year: 2010, month: 12, day: 31 });
  });

  it('边界年本身**不**被钳（钳的是「小于 / 大于」）', () => {
    expect(defaultStartDate(new Date(1998, 6, 4)).year).toBe(1998);
    expect(defaultStartDate(new Date(1998, 6, 4)).month).toBe(7);
    expect(defaultStartDate(new Date(2010, 0, 2)).year).toBe(2010);
    expect(defaultStartDate(new Date(2010, 0, 2)).day).toBe(2);
  });

  haveMap('★ `newGame` 缺省就用它；显式传 `startDate` 时以传的为准', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const players = [0, 1].map((i) => ({ character: i, kind: 'computer' as const }));
    const dflt = newGame({ map, players, seed: 5 });
    // ★ core 不许读真实时间（C-DET-2）⇒ 缺省取 `START_DATE_MAX`。
    //   对任何 2010 年之后的机器这就是真值；客户端传 `defaultStartDate(new Date())` 更精确。
    expect([dflt.year, dflt.month, dflt.day]).toEqual([2010, 1, 1]);
    const fixed = newGame({ map, players, seed: 5, startDate: { year: 1998, month: 1, day: 1 } });
    expect([fixed.year, fixed.month, fixed.day]).toEqual([1998, 1, 1]);
  });

  haveMap('★ 起始日期不影响随机数（同种子同玩家 ⇒ 同一 rngState）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const players = [0, 1].map((i) => ({ character: i, kind: 'computer' as const }));
    const a = newGame({ map, players, seed: 5, startDate: { year: 1998, month: 1, day: 1 } });
    const b = newGame({ map, players, seed: 5, startDate: { year: 2010, month: 1, day: 1 } });
    expect(a.rngState).toBe(b.rngState);
    expect(a.totalDays).toBe(b.totalDays);
  });
});
