/*
 * AI 炒股：三道闸与预算
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import {
  STOCK_LOAN_DUE_GUARD_DAYS,
  daysUntil,
  decideStockTrade,
  holdingsCost,
  holdingsValue,
} from './stock-policy.ts';
import { stockBudget } from './personality.ts';

/** 打包日期：日 | 月<<8 | 年<<16 */
const packed = (y: number, m: number, d: number): number => (y << 16) | (m << 8) | d;

function scene(over: Partial<ReturnType<typeof makePlayer>> = {}) {
  const s = makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, cash: 100_000, moneyInBank: 200_000, stockRatio: 50, ...(i === 0 ? over : {}) }),
    ),
    year: 1998,
    month: 1,
    day: 1,
    phase: 'awaitingRoll',
  });
  return s;
}

describe('AI 炒股', () => {
  it('★ 闸一：f26 == 0 的角色从不碰股票（@source 0x0042bf30）', () => {
    expect(decideStockTrade(scene({ stockRatio: 0 }))).toBeNull();
  });

  it('★ 闸三：距還款日不足 15 天就不进股市（@source 0x0042bf65 cmp eax, 0xf）', () => {
    expect(STOCK_LOAN_DUE_GUARD_DAYS).toBe(15);
    // 到期日正好 15 天之后 —— 还能炒
    const ok = scene({ loanDueDate: packed(1998, 1, 16) });
    expect(daysUntil(ok, packed(1998, 1, 16))).toBe(15);
    expect(decideStockTrade(ok)).not.toBeNull();
    // 14 天 —— 不炒
    const guard = scene({ loanDueDate: packed(1998, 1, 15) });
    expect(daysUntil(guard, packed(1998, 1, 15))).toBe(14);
    expect(decideStockTrade(guard)).toBeNull();
    // 没欠款（0）不受这条限制
    expect(decideStockTrade(scene({ loanDueDate: 0 }))).not.toBeNull();
  });

  it('★ 预算封顶在**存款**上 —— 股票从存款付（@source 0x0042c05e）', () => {
    // 可动用总额 = 0 持仓 + 20 万存款 + 10 万现金 = 30 万，50% → 目标 15 万
    expect(stockBudget(0, 100_000, 200_000, 50)).toBe(150_000);
    // 存款只剩 5 万时，预算被压到 5 万
    expect(stockBudget(0, 100_000, 50_000, 50)).toBe(50_000);
  });

  it('持仓已经超过目标就不再买', () => {
    const s = scene();
    const rich = {
      ...s,
      holdings: s.holdings.map((h, i) =>
        i === 0 ? h.map((x, j) => (j === 0 ? { amount: 10_000, avgCost: 100 } : x)) : h,
      ),
    };
    // 持仓市值远超 50% 目标
    expect(holdingsValue(rich, 0)).toBeGreaterThan(0);
    expect(decideStockTrade(rich)).toBeNull();
  });

  it('买的是合法的 buyStock，股数不超过流通量也不超预算', () => {
    const s = scene();
    const a = decideStockTrade(s);
    expect(a).not.toBeNull();
    if (a === null || a.type !== 'buyStock') throw new Error('应当是 buyStock');
    const stock = s.market.stocks[a.stock]!;
    expect(a.shares).toBeGreaterThan(0);
    expect(a.shares).toBeLessThanOrEqual(stock.shares);
    expect(a.shares * stock.price).toBeLessThanOrEqual(
      stockBudget(0, s.players[0]!.cash, s.players[0]!.moneyInBank, 50) + stock.price,
    );
  });

  it('★ 持仓成本与市值是两码事 —— 查账要用成本', () => {
    const s = scene();
    const held = {
      ...s,
      holdings: s.holdings.map((h, i) =>
        i === 0 ? h.map((x, j) => (j === 0 ? { amount: 10, avgCost: 7 } : x)) : h,
      ),
    };
    expect(holdingsCost(held, 0)).toBe(70);
    // 市值按当前股价算，与成本无关
    expect(holdingsValue(held, 0)).toBe(Math.round(10 * (held.market.stocks[0]?.price ?? 0)));
  });
});
