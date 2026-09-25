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
  aiStockBuy,
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
import { truncTowardZero } from '../rules/rounding.ts';
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
  return { ...s, market: { ...s.market, history, stocks } };
}

/** 按次序吐出原版 `rand()` 的替身（用完之后恒 0） */
function seq(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++] ?? 0;
}
/** 入口闸 rand()%3 = 0、第一名 rand()%24 = 0 ⇒ 一定进场、一定挑第一名 */
const buy = (s: GameState) => aiStockBuy(s, { nodes: [] }, seq(0, 0));

describe('AI 炒股', () => {
  it('★ 闸一：f26 == 0 的角色从不碰股票（@source 0x0042bf30）', () => {
    expect(buy(scene({ stockRatio: 0 }))).toBeNull();
  });

  it('★ 闸三：距還款日不足 15 天就不进股市（@source 0x0042bf65 cmp eax, 0xf）', () => {
    expect(STOCK_LOAN_DUE_GUARD_DAYS).toBe(15);
    // 到期日正好 15 天之后 —— 还能炒
    const ok = scene({ loanDueDate: packed(1998, 1, 20) });
    expect(daysUntil(ok, packed(1998, 1, 20))).toBe(15);
    expect(buy(ok)).not.toBeNull();
    // 14 天 —— 不炒
    const guard = scene({ loanDueDate: packed(1998, 1, 19) });
    expect(daysUntil(guard, packed(1998, 1, 19))).toBe(14);
    expect(buy(guard)).toBeNull();
    // 没欠款（0）不受这条限制
    expect(buy(scene({ loanDueDate: 0 }))).not.toBeNull();
  });

  // ★★ 2026-09-19 补（§7.140，通道 2 `test_stock_daily_bf03.py`）：原版入口
  //   `0x0042bf14` 是 `rand()%3 != 0 ⇒ 返回` —— **三分之二的回合根本不看股市**，
  //   此前复刻漏了这道闸（卖股侧 `decideStockSell` 早有同型实现）。
  it('★★ 入口闸：rand()%3 != 0 就不看股市（0x0042bf14，先于三道闸、每回合必掷）', () => {
    expect(aiStockBuy(scene(), { nodes: [] }, seq(1))).toBeNull();
    expect(aiStockBuy(scene(), { nodes: [] }, seq(5))).toBeNull();
    expect(aiStockBuy(scene(), { nodes: [] }, seq(3, 0))).not.toBeNull();
    // f26 == 0 的角色也照样先掷这一次
    let n = 0;
    aiStockBuy(scene({ stockRatio: 0 }), { nodes: [] }, () => (n++, 0));
    expect(n).toBe(1);
  });

  it('★ 排名里每个非 0 分的名次各掷一次 rand()%24，<= 12 − 名次才选中', () => {
    // 只有 0 号股票有分 ⇒ 第一名 roll 13 落选 ⇒ 不买；roll 12 选中
    expect(aiStockBuy(scene(), { nodes: [] }, seq(0, 13))).toBeNull();
    expect(aiStockBuy(scene(), { nodes: [] }, seq(0, 12))?.stock).toBe(0);
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
    expect(buy(rich)).toBeNull();
  });

  it('买的股数不超过可成交量也不超预算', () => {
    const s = scene();
    const a = buy(s);
    if (a === null) throw new Error('应当买');
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
    // 市值按当前股价算，与成本无关；取整是 0x42bff1 的 __round_toward_zero（向零截断）
    expect(holdingsValue(held, 0)).toBe(
      truncTowardZero(10 * (held.market.stocks[0]?.price ?? 0)),
    );
  });

  it('★ 持仓市值逐支向零截断（0x42bff1 的 `call 0x457dbc`）', () => {
    const s = scene();
    const withPrice = (price: number, amount: number) => ({
      ...s,
      holdings: s.holdings.map((h, i) =>
        i === 0 ? h.map((x, j) => (j === 0 ? { amount, avgCost: x.avgCost } : x)) : h,
      ),
      market: {
        ...s.market,
        stocks: s.market.stocks.map((st, j) => (j === 0 ? { ...st, price } : st)),
      },
    });
    // 1 × 2.5 = 2.5：截断 2、Math.round 3
    expect(holdingsValue(withPrice(2.5, 1), 0)).toBe(2);
    // 3 × 0.5 = 1.5：截断 1、Math.round 2
    expect(holdingsValue(withPrice(0.5, 3), 0)).toBe(1);
    // 3 × 2.5 = 7.5：截断 7、Math.round 8
    expect(holdingsValue(withPrice(2.5, 3), 0)).toBe(7);
    expect(holdingsValue(withPrice(2.5, 3), 0)).toBe(truncTowardZero(3 * 2.5));
  });
});

// ============================================================
//  打分 @source 0x0042c075
// ============================================================

function input(over: Partial<StockScoreInput> = {}): StockScoreInput {
  return {
    price: 10, basePrice: 10, volatility: 1, trend: 0, shares: 5000, f10: 1000, f6: 0, limitUp: false,
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
    // ★★ 2026-09-19 订正（§7.140，通道 2 `test_stock_daily_bf03.py`）：
    //   「动能 > 2」判的是 **`trend`（+0x1c）**，不是 `volatility`（+0x18，
    //   实测恒在 0.40..2.00 ⇒ 用它会永不可得）。旧断言用的是 volatility，已改正。
    expect(scoreStock(input({ price: 5, basePrice: 10, trend: 2.5, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(6);
    // 同一条只把 trend 归 0 ⇒ 只剩 +4；反过来只给 volatility 也**不该**得 +2
    expect(scoreStock(input({ price: 5, basePrice: 10, trend: 0, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(4);
    expect(scoreStock(input({ price: 5, basePrice: 10, volatility: 2.5, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(4);
    // 边界：trend == 2.0 **不** > 2.0 ⇒ 只得 +4；2.0000001 才得 +6
    expect(scoreStock(input({ price: 5, basePrice: 10, trend: 2.0, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(4);
    expect(scoreStock(input({ price: 5, basePrice: 10, trend: 2.0000001, avg24: 10, avg6: 20 }), 100_000, 1, 10, 0)).toBe(6);
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

  it('排名：分降序、同分照原版 Watcom qsort（0x457e6c）；选中规则 rand()%24 <= 12 − 名次', () => {
    // ★ gap 3 那一趟：cmp(0 号 0 分, 3 号 5 分) > 0 ⇒ 互换 ⇒ 同为 5 分的 3 号排到 1 号前面（原版如此）
    expect(rankStocks([0, 5, 3, 5]).map((r) => r.stock)).toEqual([3, 1, 2, 0]);
    // ★ 不稳定：gap 3 那一趟把 3 号（分 5）换到 0 号位 ⇒ 同分的 3 号排在 1 号前面
    expect(rankStocks([1, 5, 1, 5]).map((r) => r.stock)).toEqual([3, 1, 2, 0]);
    // 第一名 roll 13 落选、第二名 roll 11 <= 11 选中
    expect(pickRanked(rankStocks([0, 5, 3, 5]), (i) => (i === 0 ? 13 : 11))).toBe(1);
    // 全是 0 分 → -1；roll 全部太大 → -1
    expect(pickRanked(rankStocks([0, 0]), () => 0)).toBe(-1);
    expect(pickRanked(rankStocks([1, 1]), () => 23)).toBe(-1);
  });

  it('stockScoreInput 从状态里取企業与董事長', () => {
    const s = scene();
    const topo: MapTopology = {
      nodes: [],
      commercials: [{ id: 1, x: 0, y: 0, name: '企', stockIndex: 0, landPrice: 0, type: 1, spriteIndex: 0, assetValue: 500_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 0 }],
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

// ============================================================
//  賣股 @source 0x0042c79f
// ============================================================

import { SELL_GAIN_SHIFT, SELL_RATIO, aiStockSellPick, lowestHistory, pickForSale, scoreStockForSale, sellScoreInput, type SellScoreInput } from './stock-policy.ts';
import { loanSellPressure, loanStillUncovered } from '../places/stock-market.ts';
import { reduce } from '../state/reduce.ts';

function sellInput(over: Partial<SellScoreInput> = {}): SellScoreInput {
  return {
    // trend 1：无企業那条「趋势 < 1.0」的 +2 默认不命中（0x0042cd72）
    ...input({ myHolding: 100, trend: 1 }),
    avgCost: 10,
    openPrice: 10,
    minHist: 9999,
    totalHold: 100,
    ...over,
  };
}
const me = { cash: 100_000, moneyInBank: 100_000 };

describe('★ 還款壓力 @source 0x0042c7bc', () => {
  it('距還款日 <= 6 天且 現金+存款 < 貸款 才算', () => {
    const today = { year: 1998, month: 1, day: 5 };
    const p = { cash: 100, moneyInBank: 100, loan: 1000, loanDueDate: packed(1998, 1, 11) };
    expect(loanSellPressure(p, today)).toBe(true);
    expect(loanSellPressure({ ...p, loanDueDate: packed(1998, 1, 12) }, today)).toBe(false);
    expect(loanSellPressure({ ...p, cash: 900 }, today)).toBe(false);
    expect(loanSellPressure({ ...p, loan: 0, loanDueDate: 0 }, today)).toBe(false);
    // 賣到 貸款 × 1.1 才停
    expect(loanStillUncovered({ cash: 500, moneyInBank: 500, loan: 1000 })).toBe(true);
    expect(loanStillUncovered({ cash: 600, moneyInBank: 500, loan: 1000 })).toBe(false);
  });
});

describe('★ 賣出打分：無企業', () => {
  it('没持股 / 停牌 / 跌停 → 0', () => {
    expect(scoreStockForSale(sellInput({ myHolding: 0 }), me, 1, 10, 0, false, 5)).toBe(0);
    expect(scoreStockForSale(sellInput({ f6: 1 }), me, 1, 10, 0, false, 5)).toBe(0);
    expect(scoreStockForSale(sellInput({ openPrice: 100, price: 90 }), me, 1, 10, 0, false, 5)).toBe(0);
  });

  /*
   * ★ 这一条**改了旧期望**（旧断言是 `.toBe(-1)`，见 Q-NUM-1.md 的 D-QNUM-5）。
   *
   * 旧期望建立在「判据阈值 = −2.0」的错读上。exe 是：
   * ```asm
   * 0042ce19  fld   dword [esp + 0xe4]        ; gain = 現價/成本（0x42cbc1 算出）
   * 0042ce20  fcomp dword [0x4641f4]          ; ★ 0x4641f4 = f32 +2.0
   * 0042ce29  jb    0x42ce5c                  ; gain < 2.0 → 跳过（C0=CF=1）
   * 0042ce32  fadd  dword [0x4641f8]          ; 0x4641f8 = f32 −2.0（偏移量）
   * 0042ce38  fdiv  qword [0x4641fc]          ; 0x4641fc = f64 0.5
   * 0042ce3e  fld1 / 0042ce40 faddp st(1)     ; +1
   * 0042ce42  call  0x457dbc                  ; 向零截断
   * ```
   * gain = 1.0 时 `1.0 < 2.0` ⇒ **跳过整段**，原文就是 **0 分**；
   * 旧代码把 −2.0 当阈值，于是多算了 `trunc(2×1 − 3) = −1`。
   * 所以新期望 0 才是原版行为。
   */
  it('★ gain 那条：阈值是 +2.0（不是 −2.0），2·(gain−2)+1 向零截断', () => {
    // gain = 1.0 < 2.0 → 整段跳过 → 0（旧误读给 −1）
    expect(scoreStockForSale(sellInput(), me, 1, 10, 0, false, 5)).toBe(0);
    // gain = 0.5（price 5 / cost 10）→ 旧误读 `trunc(2×0.5 − 3) = trunc(−2) = −2`；
    //   原版跳过 → 0。openPrice 取 5 以免落进「跌停直接 0」那条岔路（0x42cfbb `cmp eax,3`）
    expect(scoreStockForSale(sellInput({ price: 5, openPrice: 5 }), me, 1, 10, 0, false, 5)).toBe(0);
    // gain = 2.0 → +trunc(2×(2−2)+1) = +1；gain > 1.6 且**趋势** < 1 → 再 +2（审计订正：原先写的是波动系数）
    expect(scoreStockForSale(sellInput({ price: 20, openPrice: 20, trend: 0.5 }), me, 1, 10, 0, false, 5)).toBe(1 + 2);
  });

  it('★ 边界：gain 恰好 / 刚过 / 刚不到 +2.0，以及负的 −2.0', () => {
    // 门槛常量本身
    expect(SELL_RATIO.gainFloor).toBe(2.0);
    expect(SELL_GAIN_SHIFT).toBe(-2.0);
    // 恰好 2.0（price 20 / cost 10）→ +trunc(1) = +1
    expect(scoreStockForSale(sellInput({ price: 20, openPrice: 20 }), me, 1, 10, 0, false, 5)).toBe(1);
    // 刚不到 2.0（19.99/10 = 1.999）→ 跳过 → 0
    expect(scoreStockForSale(sellInput({ price: 19.99, openPrice: 20 }), me, 1, 10, 0, false, 5)).toBe(0);
    // 刚过 2.0（20.01/10 = 2.001）→ trunc(1.002) = +1
    expect(scoreStockForSale(sellInput({ price: 20.01, openPrice: 20 }), me, 1, 10, 0, false, 5)).toBe(1);
    // 旧的错阈值 −2.0：即使 gain 恰好是 −2.0，原版也（2.0 > −2.0）跳过 → 0。
    // 用负成本构造这个数学边界，只喂纯函数，不代表游戏里会出现负成本。
    expect(scoreStockForSale(sellInput({ price: 20, avgCost: -10, openPrice: 20 }), me, 1, 10, 0, false, 5)).toBe(0);
  });

  /*
   * ★ AI 行为会怎么变（这是 D-QNUM-5 修好后的**可观测**后果）：
   *
   * 旧代码对小赚（gain < 1.5）的持仓**倒扣** 1~2 分，可能把总分压到 ≤ 0
   * —— `pickForSale` 只挑 > 0 的，于是那一回合干脆不卖。订正后这段在
   * gain < 2.0 时**不再动分**，被其它条款推到正分的持仓就会照卖。
   *
   * 构造：gain = 20/40 = 0.5，另有「avg24 > avg6 且 現價 < 開盤」+2。
   *   旧：2 + trunc(2×0.5 − 3) = 2 − 2 = 0 → 不卖
   *   新：2 + 0 = 2 → 卖
   * gain ≥ 2 的部分新旧完全一致（`trunc(2·gain−3)` 本来就只在 gain ≥ 1.5 才非负）。
   */
  it('★ 行为变化：gain 0.5 的持仓不再被倒扣，总分转正后会被卖出', () => {
    const s = sellInput({ price: 20, avgCost: 40, openPrice: 21, avg24: 30, avg6: 10 });
    const score = scoreStockForSale(s, me, 1, 10, 0, false, 5);
    // 旧的 −2 已经不存在；只剩 avg24 > avg6 且 現價 < 開盤 的 +2
    expect(score).toBe(2);
    expect(pickForSale([0, score])).toBe(1);
    // 若分数仍是旧的 0，pickForSale 会返回 −1（不卖）——把这条对照钉住
    expect(pickForSale([0, 0])).toBe(-1);
  });

  it('現價 > 144 日最低×8 且 最低×8 > 成本×1.25 → +2；avg24 > avg6 且 現價 < 開盤 → +2', () => {
    // minHist 2 → 16；price 20 > 16；16 > 12.5 ✓；gain 2 → +1；trend 1（不 < 1）
    expect(scoreStockForSale(sellInput({ price: 20, openPrice: 20, minHist: 2 }), me, 1, 10, 0, false, 5)).toBe(1 + 2);
    expect(scoreStockForSale(sellInput({ price: 20, openPrice: 21, avg24: 30, avg6: 10 }), me, 1, 10, 0, false, 5)).toBe(1 + 2);
  });

  it('手头紧（現金+存款 < 30000×物價 / < 16000×物價）各再加 round(2·gain + 1)；壓力下总分 ×2', () => {
    const poor = { cash: 10_000, moneyInBank: 5_000 };
    // gain 2：基础 +1；两道各 +5 → 11
    expect(scoreStockForSale(sellInput({ price: 20, openPrice: 20 }), poor, 1, 10, 0, false, 5)).toBe(11);
    expect(scoreStockForSale(sellInput({ price: 20, openPrice: 20 }), poor, 1, 10, 0, true, 5)).toBe(22);
    expect(SELL_RATIO.bigGain).toBe(1.6);
  });
});

describe('★ 賣出打分：有企業', () => {
  const co = (over: Partial<NonNullable<StockScoreInput['company']>> = {}) => company({ assetValue: 100_000, ...over }); // A = 10

  it('公司深亏且我持大头、月中前 → +3；亏 6000 以上且賺 20% 且董事長不是我 → +2', () => {
    const s = sellInput({ price: 13, openPrice: 13, company: co({ funds: -10_000 }), myHolding: 70, totalHold: 100 });
    expect(scoreStockForSale(s, me, 1, 10, 0, false, 12)).toBe(3 + 2);
    // day 15：两条都不算
    expect(scoreStockForSale(s, me, 1, 10, 0, false, 15)).toBe(0);
    // 董事長是我：第二条不算
    expect(scoreStockForSale({ ...s, company: co({ funds: -10_000, chairman: 1 }) }, me, 1, 10, 0, false, 12)).toBe(3);
  });

  it('★★ 持股比例是「全體 ÷ 我」（0x0042c8c9 fdivrp，DE F1）⇒ 恒 ≥ 1：「< 0.4」那条 +1 永不命中，「> 0.6」恒命中', () => {
    // 月均盈餘平平、現價 >= A×2、賺 30% —— 只差比例那一条，而它永远不成立
    const s = sellInput({ price: 20, openPrice: 20, company: co(), myHolding: 10, totalHold: 100 });
    expect(scoreStockForSale(s, me, 1, 10, 0, false, 5)).toBe(0);
    // 深亏、月中前：我只持 10%（「我 ÷ 全體」= 0.1）照样 +3（全體 ÷ 我 = 10 > 0.6）
    const red = sellInput({ price: 10, openPrice: 10, company: co({ funds: -10_000, chairman: 1 }), myHolding: 10, totalHold: 100 });
    expect(scoreStockForSale(red, me, 1, 10, 0, false, 12)).toBe(3);
  });

  it('★★ 無企業那条 +2 看趋势 +0x1c（0x0042cd72），不看波动系数', () => {
    const hot = sellInput({ price: 17, openPrice: 17, trend: 0.5, volatility: 5 }); // gain 1.7 > 1.6
    expect(scoreStockForSale(hot, me, 1, 10, 0, false, 5)).toBe(2);
    expect(scoreStockForSale({ ...hot, trend: 1, volatility: 0.1 }, me, 1, 10, 0, false, 5)).toBe(0);
  });

  it('当不了董事長且公司不赚、賺 50% → +1；跌势中 A×2/成本×2 之上（董事長不是我）→ +2；×3（董事長是我）→ +2；壓力 +1', () => {
    const contest = sellInput({ price: 15, openPrice: 15, shares: 10, company: co({ chairman: 2, chairmanHolding: 1000, remainingShares: 0 }) });
    expect(scoreStockForSale(contest, me, 1, 10, 0, false, 5)).toBe(1);
    const falling = sellInput({ price: 25, openPrice: 26, company: co({ chairman: 2, chairmanHolding: 0 }) });
    // 流通 5000 + 我 100 > 董事長 0 → 「当不了董事長」那条不命中，只有跌势 +2
    expect(scoreStockForSale(falling, me, 1, 10, 0, false, 5)).toBe(2);
    const mine = sellInput({ price: 31, openPrice: 32, company: co({ chairman: 1 }) });
    expect(scoreStockForSale(mine, me, 1, 10, 0, true, 5)).toBe(2 + 1);
  });
});

describe('★ 挑哪支、要不要賣', () => {
  it('分最高且 > 0 的一支；同分先出现的', () => {
    expect(pickForSale([0, 3, 5, 5])).toBe(2);
    expect(pickForSale([0, -1, 0])).toBe(-1);
  });

  it('144 日最低价：只看非 0；没有则 9999', () => {
    const s = scene();
    expect(lowestHistory(s, 0)).toBe(10); // scene() 里 0 号股票近 6 日 = 10
    expect(lowestHistory(s, 1)).toBe(9999);
  });

  it('★ 挑中就賣**全部持股**（打分在 aiStockSellPick，随机闸在 reducer）', () => {
    const base = scene();
    const holdings = base.holdings.map((h, i) => (i === 0 ? h.map((x, j) => (j === 0 ? { amount: 500, avgCost: 1 } : x)) : h));
    expect(aiStockSellPick({ ...base, holdings }, { nodes: [] }, false)).toEqual({ stock: 0, shares: 500 });
  });

  it('★ reducer：没壓力时掷 rand()%3（每趟一次），壓力下不掷', () => {
    const base = scene({ whoPlays: 2 });
    const holdings = base.holdings.map((h, i) => (i === 0 ? h.map((x, j) => (j === 0 ? { amount: 500, avgCost: 1 } : x)) : h));
    let sold = 0;
    for (let seed = 1; seed <= 90; seed++) {
      const st = { ...base, holdings, aiStep: 1, rngState: seed };
      const after = reduce(st, { type: 'aiNext' }, { nodes: [] });
      if ((after.holdings[0]![0]!.amount) === 0) sold++;
    }
    expect(sold).toBeGreaterThan(10);
    expect(sold).toBeLessThan(60);
  });

  it('★★ 壓力旗整趟不重算：卖到 貸款 ≤ 現金+存款 < 貸款×1.1 仍接着卖（0x0042d0de），一直盖住 1.1 倍为止', () => {
    // 貸款 100000、手头 200；两支各 1000 股 @ 50 ⇒ 卖一支得 50000（仍 < 貸款，壓力下也会继续）
    const base = scene({ cash: 100, moneyInBank: 100, loan: 100_000, loanDueDate: packed(1998, 1, 8), whoPlays: 2 });
    const stocks = base.market.stocks.map((x, j) => (j <= 2 ? { ...x, price: 50, openPrice: 50 } : x));
    const amounts = [1000, 1000, 100];
    const holdings = base.holdings.map((h, i) => (i === 0 ? h.map((x, j) => (j <= 2 ? { amount: amounts[j]!, avgCost: 10 } : x)) : h));
    const s = { ...base, market: { ...base.market, stocks }, holdings, aiStep: 1 };
    expect(loanSellPressure(s.players[0]!, s)).toBe(true);
    const after = reduce(s, { type: 'aiNext' }, { nodes: [] });
    // 两支卖完 100200 ≥ 貸款（入口旗若重算就此停），但 < 110000 ⇒ 第三支也卖
    expect(after.holdings[0]!.slice(0, 3).map((h) => h!.amount)).toEqual([0, 0, 0]);
    expect(after.players[0]!.moneyInBank).toBe(100 + 50_000 + 50_000 + 5_000);
    expect(after.aiStep).toBe(2);
  });
});

describe('★ 持股市值的累加要过 f32（D-QNUM-3 订正）@source 0x0042bfb3..0x0042bff6', () => {
  it('★ 总额 > 2^24 时与纯整数累加会差几块钱 —— 原版每轮 fstp dword 过一趟 f32', () => {
    const state = makeGameState();
    state.market.stocks[0] = { ...state.market.stocks[0]!, price: 1, openPrice: 1 };
    state.market.stocks[1] = { ...state.market.stocks[1]!, price: 1, openPrice: 1 };
    state.holdings[0] = [
      { amount: 16_777_217, avgCost: 1 }, // 2^24 + 1，f32 表示不了（会落到 2^24）
      { amount: 4, avgCost: 1 },
    ];
    // 纯整数累加会是 16777221；过一趟 f32 得到 fround(16777217)=16777216，+4 = 16777220
    expect(holdingsValue(state, 0)).toBe(16_777_220);
  });

  it('★ 没有跨过 2^24 时与纯整数累加完全一致（正常盘面不受影响）', () => {
    const state = makeGameState();
    state.market.stocks[0] = { ...state.market.stocks[0]!, price: 100, openPrice: 100 };
    state.market.stocks[1] = { ...state.market.stocks[1]!, price: 40, openPrice: 40 };
    state.holdings[0] = [
      { amount: 1000, avgCost: 1 },
      { amount: 500, avgCost: 1 },
    ];
    expect(holdingsValue(state, 0)).toBe(100 * 1000 + 40 * 500);
  });
});
