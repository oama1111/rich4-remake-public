/*
 * AI 炒股：三道闸与预算
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import {
  SCORE_RATIO,
  STOCK_LOAN_DUE_GUARD_DAYS,
  daysUntil,
  decideStockTrade,
  holdingsCost,
  holdingsValue,
  pickRanked,
  rankStocks,
  recentAverage,
  scoreStock,
  stockScoreInput,
  type StockScoreInput,
} from './stock-policy.ts';
import { stockBudget } from './personality.ts';
import { aiRoll } from './card-policy.ts';
import { HISTORY_DAYS } from '../places/stock-market.ts';
import type { GameState } from '../state/types.ts';
import type { MapTopology } from '../state/reduce.ts';

/** 打包日期：日 | 月<<8 | 年<<16 */
const packed = (y: number, m: number, d: number): number => (y << 16) | (m << 8) | d;

function scene(over: Partial<ReturnType<typeof makePlayer>> = {}) {
  const s = makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, cash: 100_000, moneyInBank: 200_000, stockRatio: 50, ...(i === 0 ? over : {}) }),
    ),
    // ★ 1998-01-01 是元旦（節日表首条）→ 休市，闸二会把 AI 挡在门外；挑个开市的星期一
    year: 1998,
    month: 1,
    day: 5,
    phase: 'awaitingRoll',
  });
  return attractive(s);
}

/**
 * 让 0 号股票值得买（無企業路径：近 6 日均价 < 近 24 日均价的一半 → +2，
 * @source 0x0042c52d），并挑一个让第一名 `rand()%24 <= 12` 的种子（0x0042c690）。
 */
function attractive(s: GameState): GameState {
  const history = s.market.history.map((h) => [...h]);
  const row = history[0]!;
  // market.day = 0 → 24 日窗口是 120..143，6 日窗口是 138..143
  for (let d = 120; d < 138; d++) row[d] = 100;
  for (let d = 138; d < HISTORY_DAYS; d++) row[d] = 10;
  // 表里的 f10（当日可成交量）开局为 0，要等每日重算；这里直接给
  const stocks = s.market.stocks.map((x, j) => (j === 0 ? { ...x, f10: x.shares } : x));
  let rngState = 1;
  while (aiRoll({ ...s, rngState }, 0x42c690, 24) > 12) rngState++;
  return { ...s, rngState, market: { ...s.market, history, stocks } };
}

describe('AI 炒股', () => {
  it('★ 闸一：f26 == 0 的角色从不碰股票（@source 0x0042bf30）', () => {
    expect(decideStockTrade(scene({ stockRatio: 0 }))).toBeNull();
  });

  it('★ 闸三：距還款日不足 15 天就不进股市（@source 0x0042bf65 cmp eax, 0xf）', () => {
    expect(STOCK_LOAN_DUE_GUARD_DAYS).toBe(15);
    // 到期日正好 15 天之后 —— 还能炒
    const ok = scene({ loanDueDate: packed(1998, 1, 20) });
    expect(daysUntil(ok, packed(1998, 1, 20))).toBe(15);
    expect(decideStockTrade(ok)).not.toBeNull();
    // 14 天 —— 不炒
    const guard = scene({ loanDueDate: packed(1998, 1, 19) });
    expect(daysUntil(guard, packed(1998, 1, 19))).toBe(14);
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

// ============================================================
//  打分 @source 0x0042c075
// ============================================================

function input(over: Partial<StockScoreInput> = {}): StockScoreInput {
  return {
    price: 10, basePrice: 10, volatility: 1, shares: 5000, f10: 1000, f6: 0, limitUp: false,
    avg24: 0, avg6: 0, company: null, myHolding: 0, ...over,
  };
}
function company(over: Partial<NonNullable<StockScoreInput['company']>> = {}): NonNullable<StockScoreInput['company']> {
  return { assetValue: 1_000_000, funds: 0, profit: 0, remainingShares: 0, chairman: 0, chairmanHolding: 0, ...over };
}

describe('★ 选股打分 @source 0x0042c075..0x0042c557', () => {
  it('停牌 / 漲停 / 无可成交量 → 0 分', () => {
    expect(scoreStock(input({ f6: 3 }), 1_000_000, 1, 10, 0)).toBe(0);
    expect(scoreStock(input({ limitUp: true }), 1_000_000, 1, 10, 0)).toBe(0);
    expect(scoreStock(input({ f10: 0 }), 1_000_000, 1, 10, 0)).toBe(0);
  });

  it('無企業：存款须 > 30000×物價；三条加分各自独立', () => {
    expect(scoreStock(input({ avg24: 100, avg6: 10 }), 30_000, 1, 10, 0)).toBe(0);
    expect(scoreStock(input({ avg24: 100, avg6: 10 }), 30_001, 1, 10, 0)).toBe(2);
    // 現價 < 参考价×0.6 且 avg6 > avg24 → +4
    expect(scoreStock(input({ price: 5, basePrice: 10, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(4);
    // 波动系数 > 2 的那条也同时命中 → +2 +4
    expect(scoreStock(input({ price: 5, basePrice: 10, volatility: 2.5, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(6);
    expect(SCORE_RATIO).toEqual({ cheapEnough: 1.2, bargain: 0.85, steal: 0.7, baseHigh: 2.5, baseLow: 0.6, crash: 0.5 });
  });

  it('有企業：存款须 > 20000×物價；月均盈餘 = trunc(累計盈餘 / 總天數) 分三档', () => {
    const c = (profit: number, totalDays: number, pi = 1) =>
      scoreStock(input({ price: 1000, company: company({ profit }) }), 100_000, pi, totalDays, 0);
    expect(scoreStock(input({ company: company() }), 20_000, 1, 10, 0)).toBe(0);
    expect(c(0, 10)).toBe(0);
    expect(c(49_999, 10)).toBe(1); // 4999 < 5000
    expect(c(50_000, 10)).toBe(2); // 5000
    expect(c(99_999, 10)).toBe(2);
    expect(c(100_000, 10)).toBe(3);
    // 總天數 0：直接用累計盈餘
    expect(c(100_000, 0)).toBe(3);
    // 物價 2：门槛翻倍
    expect(c(100_000, 10, 2)).toBe(2);
  });

  it('有企業：便宜到能进场（現價 <= A×1.2，A = 資產額/10000）→ +1；董事長争夺 +1/+2', () => {
    // A = 100；現價 120 刚好 <= 120；累積盈餘 > 0；我持股 < 5000
    const base = input({ price: 120, myHolding: 100, company: company({ funds: 1 }) });
    expect(scoreStock(base, 100_000, 1, 10, 0)).toBe(1);
    // 董事長是别人，持股 3000：流通股 5000 + 我 100 + 剩余 0 > 3000 → +1；我 100 + 可成交 1000 > 3000？否
    const contest = input({ ...base, company: company({ funds: 1, chairman: 2, chairmanHolding: 3000 }) });
    expect(scoreStock(contest, 100_000, 1, 10, 0)).toBe(2);
    // 可成交量 5000：我 100 + 5000 > 3000 → 再 +2
    expect(scoreStock({ ...contest, f10: 5000 }, 100_000, 1, 10, 0)).toBe(4);
    // 董事長是我：不加
    expect(scoreStock(input({ ...base, company: company({ funds: 1, chairman: 1, chairmanHolding: 3000 }) }), 100_000, 1, 10, 0)).toBe(1);
    // 現價 121 > 120：这一整块不算
    expect(scoreStock(input({ ...base, price: 121 }), 100_000, 1, 10, 0)).toBe(0);
  });

  it('有企業：現價 < A×0.85 → +3，< A×0.7 → 再 +5（叠加）', () => {
    // 累積盈餘 0 → 「便宜到能进场」那 +1 不算
    expect(scoreStock(input({ price: 84, company: company() }), 100_000, 1, 10, 0)).toBe(3);
    expect(scoreStock(input({ price: 69, company: company() }), 100_000, 1, 10, 0)).toBe(3 + 5);
    expect(scoreStock(input({ price: 85, company: company() }), 100_000, 1, 10, 0)).toBe(0);
    // 累積盈餘 > 0 时三条叠加
    expect(scoreStock(input({ price: 69, company: company({ funds: 1 }) }), 100_000, 1, 10, 0)).toBe(1 + 3 + 5);
  });

  it('近 n 日均价：只算非 0 项，环形 144 @source 0x0042c37f', () => {
    const s = scene();
    // 窗口跨过 143 → 0 的回绕：把 day 设成 3，24 日窗口 = 123..143 + 0..2
    const history = s.market.history.map((h) => h.map(() => 0));
    const row = history[0]!;
    for (let d = 123; d < 144; d++) row[d] = 50;
    row[0] = 200; // 只有 22 个非 0 项
    const st = { ...s, market: { ...s.market, day: 3, history } };
    expect(recentAverage(st, 0, 24)).toBeCloseTo((21 * 50 + 200) / 22, 3);
    // 6 日窗口 = 141..143 + 0..2 → 三个 50 + 一个 200，两个 0 不计
    expect(recentAverage(st, 0, 6)).toBe(87.5);
  });

  it('排名：分降序、同分下标升序（D-006）；选中规则 rand()%24 <= 12 − 名次', () => {
    expect(rankStocks([0, 5, 3, 5]).map((r) => r.stock)).toEqual([1, 3, 2, 0]);
    // 第一名 roll 13 落选、第二名 roll 11 <= 11 选中
    expect(pickRanked(rankStocks([0, 5, 3, 5]), (i) => (i === 0 ? 13 : 11))).toBe(3);
    // 全是 0 分 → -1；roll 全部太大 → -1
    expect(pickRanked(rankStocks([0, 0]), () => 0)).toBe(-1);
    expect(pickRanked(rankStocks([1, 1]), () => 23)).toBe(-1);
  });

  it('stockScoreInput 从状态里取企業与董事長', () => {
    const s = scene();
    const topo: MapTopology = {
      nodes: [],
      commercials: [{ id: 1, x: 0, y: 0, name: '企', stockIndex: 0, landPrice: 0, type: 1, spriteIndex: 0, assetValue: 500_000, shares: 0 }],
    };
    // 表里的 commercialIndex 开局只是「有无企業」的旗子，真正的绑定在 bindCommercials；这里手动指
    const stocks = s.market.stocks.map((x, j) => ({ ...x, commercialIndex: j === 0 ? 1 : 0 }));
    const owners = [...s.commercialOwners];
    owners[1] = { ...owners[1]!, owner: 2 };
    const holdings = s.holdings.map((h, i) => (i === 1 ? h.map((x, j) => (j === 0 ? { amount: 777, avgCost: 1 } : x)) : h));
    const companyProfit = [...s.companyProfit];
    companyProfit[1] = 4200;
    const st = { ...s, market: { ...s.market, stocks }, commercialOwners: owners, holdings, companyProfit };
    const inp = stockScoreInput(st, topo, 0, 0)!;
    expect(inp.company).toMatchObject({ assetValue: 500_000, profit: 4200, chairman: 2, chairmanHolding: 777 });
    expect(stockScoreInput(st, topo, 1, 0)!.company).toBeNull();
  });
});
