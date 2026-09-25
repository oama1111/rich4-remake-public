/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 买卖股票接入 reduce
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer, tradableMarket } from '../testing/factories.ts';
import { applyBankruptcy, reduce, valuationsOf } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_HUMAN } from './types.ts';
import { newStockMarket } from '../places/stock-market.ts';
import type { Action } from './actions.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

function base(over: Partial<GameState> = {}): GameState {
  return makeGameState({
    // ★ 工厂默认 1998-01-01 是元旦（節日表首条）—— 休市日柜台不开门。挑个开市的星期一。
    year: 1998,
    month: 1,
    day: 5,
    market: tradableMarket(newStockMarket(0)),
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, cash: 50_000, moneyInBank: 1_000_000 }),
    ),
    ...over,
  });
}

const act = (s: GameState, a: Action): GameState => reduce(s, a, topo);

describe('买入', () => {
  it('★ 从存款扣款，不动现金', () => {
    const s0 = base();
    const price = s0.market.stocks[0]!.price; // 中國信託 100
    const s = act(s0, { type: 'buyStock', stock: 0, shares: 100 });
    expect(s.players[0]!.moneyInBank).toBe(1_000_000 - 100 * price);
    expect(s.players[0]!.cash).toBe(50_000);
    expect(s.holdings[0]![0]!.amount).toBe(100);
  });

  it('★ 可流通股数随之减少', () => {
    const s0 = base();
    const before = s0.market.stocks[0]!.shares;
    const s = act(s0, { type: 'buyStock', stock: 0, shares: 250 });
    expect(s.market.stocks[0]!.shares).toBe(before - 250);
  });

  it('★ 成本均价按加权算', () => {
    let s = base();
    s = act(s, { type: 'buyStock', stock: 0, shares: 100 }); // 均价 100
    s = {
      ...s,
      market: {
        ...s.market,
        // ★ 連 openPrice 一起改：只改現價会被当成一天内涨了 100% → 漲停無法買進
        stocks: s.market.stocks.map((x, i) => (i === 0 ? { ...x, price: 200, openPrice: 200 } : x)),
      },
    };
    s = act(s, { type: 'buyStock', stock: 0, shares: 100 }); // 再买 100 @200
    expect(s.holdings[0]![0]!.amount).toBe(200);
    expect(s.holdings[0]![0]!.avgCost).toBeCloseTo(150, 3);
  });

  it('存款不够就买不成', () => {
    const s0 = base({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 999_999, moneyInBank: 100 })),
    });
    expect(act(s0, { type: 'buyStock', stock: 0, shares: 10 })).toBe(s0);
  });

  it('★ 现金再多也没用 —— 柜台只认存款', () => {
    const s0 = base({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, cash: 100_000_000, moneyInBank: 0 }),
      ),
    });
    expect(act(s0, { type: 'buyStock', stock: 0, shares: 1 })).toBe(s0);
  });

  it('买不到超过可流通量的股数', () => {
    const s0 = base();
    const all = s0.market.stocks[0]!.shares;
    expect(act(s0, { type: 'buyStock', stock: 0, shares: all + 1 })).toBe(s0);
  });

  it('越界下标、非正股数都被拒', () => {
    const s0 = base();
    expect(act(s0, { type: 'buyStock', stock: 99, shares: 1 })).toBe(s0);
    expect(act(s0, { type: 'buyStock', stock: 0, shares: 0 })).toBe(s0);
    expect(act(s0, { type: 'buyStock', stock: 0, shares: -5 })).toBe(s0);
    expect(act(s0, { type: 'buyStock', stock: 0, shares: 1.5 })).toBe(s0);
  });

  it('出局者不能交易', () => {
    const s0 = base({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, moneyInBank: 1_000_000, whoPlays: i === 0 ? 0 : 1 }),
      ),
    });
    expect(act(s0, { type: 'buyStock', stock: 0, shares: 1 })).toBe(s0);
  });
});

describe('卖出', () => {
  const held = (shares: number): GameState => {
    const s = base();
    return {
      ...s,
      holdings: s.holdings.map((row, i) =>
        i === 0 ? row.map((h, j) => (j === 0 ? { amount: shares, avgCost: 80 } : h)) : row,
      ),
    };
  };

  it('★ 所得进存款', () => {
    const s0 = held(100);
    const price = s0.market.stocks[0]!.price;
    const s = act(s0, { type: 'sellStock', stock: 0, shares: 100 });
    expect(s.players[0]!.moneyInBank).toBe(1_000_000 + 100 * price);
    expect(s.holdings[0]![0]!.amount).toBe(0);
  });

  it('★ 清仓后成本均价归零', () => {
    const s = act(held(100), { type: 'sellStock', stock: 0, shares: 100 });
    expect(s.holdings[0]![0]!.avgCost).toBe(0);
  });

  it('部分卖出保留均价', () => {
    const s = act(held(100), { type: 'sellStock', stock: 0, shares: 40 });
    expect(s.holdings[0]![0]!.amount).toBe(60);
    expect(s.holdings[0]![0]!.avgCost).toBe(80);
  });

  it('卖出使可流通股数增加', () => {
    const s0 = held(100);
    const before = s0.market.stocks[0]!.shares;
    const s = act(s0, { type: 'sellStock', stock: 0, shares: 100 });
    expect(s.market.stocks[0]!.shares).toBe(before + 100);
  });

  it('卖不了没有的股', () => {
    const s0 = held(10);
    expect(act(s0, { type: 'sellStock', stock: 0, shares: 11 })).toBe(s0);
    const empty = base();
    expect(act(empty, { type: 'sellStock', stock: 0, shares: 1 })).toBe(empty);
  });
});

describe('估值', () => {
  it('★ 持仓按**当前**股价计入总资产，不是成本价', () => {
    let s = base();
    s = act(s, { type: 'buyStock', stock: 0, shares: 100 });
    s = {
      ...s,
      market: {
        ...s.market,
        stocks: s.market.stocks.map((x, i) => (i === 0 ? { ...x, price: 300 } : x)),
      },
    };
    const v = valuationsOf(s, 0);
    expect(v[0]).toEqual({ amount: 100, price: 300 });
  });
});

describe('破产清算', () => {
  it('★ 持股全部变现，钱进公库', () => {
    let s = base({ pool: 1000 });
    s = act(s, { type: 'buyStock', stock: 0, shares: 100 });
    const price = s.market.stocks[0]!.price;

    const after = applyBankruptcy(s, 0);
    expect(after.holdings[0]![0]!.amount).toBe(0);
    expect(after.pool).toBe(1000 + 100 * price);
  });

  it('★ 变现使可流通股数回到市场', () => {
    let s = base();
    const before = s.market.stocks[0]!.shares;
    s = act(s, { type: 'buyStock', stock: 0, shares: 100 });
    const after = applyBankruptcy(s, 0);
    expect(after.market.stocks[0]!.shares).toBe(before);
  });

  it('空仓破产不改动公库', () => {
    const s = base({ pool: 777 });
    expect(applyBankruptcy(s, 0).pool).toBe(777);
  });
});

describe('★ 2026-09-24 审计：柜台买入上限 = min(今日可成交量 f10, trunc(存款 ÷ 現價)) @source 0x0042af43 / 0x0042af66', () => {
  it('超过今日可成交量（+0x0a）就买不成，哪怕流通股（+8）还够', () => {
    const s0 = base();
    const s1: GameState = {
      ...s0,
      market: { ...s0.market, stocks: s0.market.stocks.map((x, i) => (i === 0 ? { ...x, f10: 50 } : x)) },
    };
    expect(act(s1, { type: 'buyStock', stock: 0, shares: 51 })).toBe(s1);
    expect(act(s1, { type: 'buyStock', stock: 0, shares: 50 }).holdings[0]![0]!.amount).toBe(50);
  });

  it('真人：存款 99、價 9.95 ⇒ 最多 9 股（成本 99.5 截断成 99 也不放行第 10 股）', () => {
    const s0 = base();
    const s1: GameState = {
      ...s0,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, whoPlays: WHO_PLAYS_HUMAN, moneyInBank: 99 } : p)),
      market: { ...s0.market, stocks: s0.market.stocks.map((x, i) => (i === 0 ? { ...x, price: 9.95, openPrice: 9.95 } : x)) },
    };
    expect(act(s1, { type: 'buyStock', stock: 0, shares: 10 })).toBe(s1);
    expect(act(s1, { type: 'buyStock', stock: 0, shares: 9 }).holdings[0]![0]!.amount).toBe(9);
  });
});

describe('★ 2026-09-25 审计：关股市屏强制收回特別融資（0x0042ba86 push 0 / 0x0042ba88 call 0x436b0a）', () => {
  it('非董事長欠着特別融資 ⇒ 关屏那一刻从存款还清；没人欠就原样返回', () => {
    const CID = 1;
    const topo2 = {
      nodes: [makeNode({ id: 1, adjacent: [1] })],
      commercials: [{
        id: CID, x: 0, y: 0, name: '測試銀行', stockIndex: 0, landPrice: 500, type: 7,
        spriteIndex: 0, assetValue: 1_000_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 1000,
      }],
    };
    const s0 = base();
    const commercialOwners = [...s0.commercialOwners];
    while (commercialOwners.length <= CID) commercialOwners.push({ owner: 0, ranking: [0, 0, 0, 0] });
    commercialOwners[CID] = { owner: 2, ranking: [2, 0, 0, 0] }; // 董事長 = 1 号
    const owing: GameState = {
      ...s0,
      commercialOwners,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, whoPlays: WHO_PLAYS_HUMAN, specialFinance: 8000 } : p)),
    };
    const closed = reduce(owing, { type: 'stockScreen', op: 'close' }, topo2);
    expect(closed.players[0]!.specialFinance).toBe(0);
    expect(closed.players[0]!.moneyInBank).toBe(1_000_000 - 8000);
    const clean = { ...owing, players: owing.players.map((p) => ({ ...p, specialFinance: 0 })) };
    expect(reduce(clean, { type: 'stockScreen', op: 'close' }, topo2)).toBe(clean);
  });
});
