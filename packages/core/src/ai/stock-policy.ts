/*
 * AI 炒股
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 入口 VA 0x0042bf30，三道闸 + 一条预算公式 + 一段十二支股票的打分（0x0042c075 起）：
 *
 * ```asm
 * 0042bf30  cmp byte [player + 0x1a], 0 / je 结束     ; ★ 闸一：f26 == 0 的角色从不碰股票
 * 0042bf3d  call 0x428d01 / cmp eax, 1 / je 结束      ; ★ 闸二：股市不开门
 * 0042bf4b  edx = player.loan_due_date (+0x2c)
 * 0042bf53  if (edx != 0) {
 * 0042bf5d      eax = date_diff(今天, 到期日)
 * 0042bf68      if (eax < 0xf) 结束                   ; ★ 闸三：距還款日不足 15 天就不炒
 *           }
 * 0042bf94  for (i = 0; i < 12; i++)                  ; 持仓市值
 * 0042bfc7      市值 += round(持股[i] × 股价[i])
 * 0042c002  eax = 存款(+0x20) + 现金(+0x1c)
 * 0042c015  edx = 市值 + eax                          ; 可动用总额
 * 0042c01f  target = trunc(edx × f26 / 100)
 * 0042c043  if (市值 >= target) 结束
 * 0042c04d  可投 = target − 市值
 * 0042c05e  if (可投 > 存款) 可投 = 存款              ; ★ 股票从**存款**付
 * ```
 *
 * ## 打分（0x0042c58c 的循环，每支一个 32 位记录：高字 = 股票下标，低字 = 分）
 *
 * ```
 * 0042c5a6  f6(停牌) != 0            → 0 分
 * 0042c5b0  fcn_004295ea == 1（漲停）→ 0 分
 * 0042c5bd  f10(当日可成交量) == 0   → 0 分
 * 0042c5ca  有对应企業？
 *   ── 没有企業（0x42c352）──
 *   0042c373  存款 <= 30000×物價         → 0 分
 *   0042c37f  avg24 = 最近 24 日收盘均价（只算非 0 项，环形 144），avg6 同理
 *   0042c4a2  現價 < 参考价×2.5 && 波动系数 > 2.0 && avg6 > avg24 → +2
 *   0042c4f7  現價 < 参考价×0.6 && avg6 > avg24                    → +4
 *   0042c52d  avg6 < avg24×0.5                                     → +2
 *   ── 有企業（0x42c5d8）──
 *   0042c5f2  存款 <= 20000×物價         → 0 分
 *   0042c612  S = 總天數 ? trunc(累計盈餘(+0x2c) / 總天數) : 累計盈餘   ; 月均盈餘
 *   0042c084  A = trunc(資產額(+0x24) / 10000)
 *   0042c0a3  0 < S < 5000×物價        → +1
 *   0042c0f3  5000×物價 <= S < 10000×物價 → +2
 *   0042c164  S >= 10000×物價          → +3
 *   0042c1a7  累積盈餘(+0x28) > 0 && 我持股 < 5000 && 現價 <= A×1.2 → +1，并且
 *   0042c218    董事長存在且不是我：
 *   0042c275      流通股 + 我持股 + 企業剩余股 > 董事長持股 → +1
 *   0042c2cf      我持股 + 可成交量 > 董事長持股           → +2
 *   0042c2e7  現價 < A×0.85 → +3
 *   0042c318  現價 < A×0.7  → +5
 * ```
 *
 * 然后 `qsort` 按分降序（0x0042bed0），从头扫：0 分跳过；第 i 名以 `rand()%24 <= 12−i`
 * 的概率被选中（0x0042c690），第一个中的就买：股数 = round(可投 / 現價)，不超过可成交量。
 *
 * ⚠️ 两处替身（D-004 / D-006）：`rand()%24` 用 `aiRoll`；Watcom 的 qsort 不稳定，
 *   同分的先后不可知，本引擎按下标升序。
 */

import type { Action } from '../state/actions.ts';
import type { GameState, Player } from '../state/types.ts';
import type { MapTopology } from '../state/reduce.ts';
import { stockBudget } from './personality.ts';
import { aiRoll } from './card-policy.ts';
import { dayNumberSince1998 } from '../places/calendar.ts';
import { HISTORY_DAYS } from '../places/stock-market.ts';
import { isLimitDown, isLimitUp, loanSellPressure, marketOpenOn } from '../places/stock-market.ts';

/** 距還款日不足这么多天就不进股市 @source 0x0042bf65 `cmp eax, 0xf` */
export const STOCK_LOAN_DUE_GUARD_DAYS = 0xf;

/** 打包的日期 → 距今天还有几天；到期日在过去时返回负数 */
export function daysUntil(state: GameState, packed: number): number {
  const year = packed >>> 16;
  const month = (packed >>> 8) & 0xff;
  const day = packed & 0xff;
  return (
    dayNumberSince1998(year, month, day) -
    dayNumberSince1998(state.year, state.month, state.day)
  );
}

/** 当前玩家的持仓市值 @source 0x0042bf94 的循环，逐支 `round(股数 × 股价)` 后累加 */
export function holdingsValue(state: GameState, playerIndex: number): number {
  const held = state.holdings[playerIndex] ?? [];
  let total = 0;
  for (let i = 0; i < held.length; i++) {
    const amount = held[i]?.amount ?? 0;
    if (amount === 0) continue;
    const price = state.market.stocks[i]?.price ?? 0;
    total += Math.round(amount * price);
  }
  return total;
}

/**
 * 持仓的**成本**（Σ 股数 × 均价），不是市值。
 *
 * ★ 查账时要用它而不是市值：买入是把钱 1:1 换成成本，所以成本守恒；
 *   市值会随行情涨跌，那是**账面**盈亏，不是凭空多出来的钱。
 */
export function holdingsCost(state: GameState, playerIndex: number): number {
  const held = state.holdings[playerIndex] ?? [];
  let total = 0;
  for (const h of held) total += Math.round((h?.amount ?? 0) * (h?.avgCost ?? 0));
  return total;
}

// ============================================================
//  打分
// ============================================================

/** 打分里的六个倍率 @source 0x46419c..0x4641c4（double） */
export const SCORE_RATIO = {
  /** 現價 <= A × 1.2 才算「便宜到能进场」 */
  cheapEnough: 1.2,
  /** 現價 < A × 0.85 → +3 */
  bargain: 0.85,
  /** 現價 < A × 0.7 → +5 */
  steal: 0.7,
  /** 無企業：現價 < 参考价 × 2.5 */
  baseHigh: 2.5,
  /** 無企業：現價 < 参考价 × 0.6 */
  baseLow: 0.6,
  /** 無企業：avg6 < avg24 × 0.5 */
  crash: 0.5,
} as const;

/** 最近 n 日收盘均价：只算非 0 项，环形 144 日；没有非 0 项时为 0 @source 0x0042c37f / 0x0042c408 */
export function recentAverage(state: GameState, stock: number, n: number): number {
  const hist = state.market.history[stock] ?? [];
  let idx = state.market.day - n;
  if (idx < 0) idx += HISTORY_DAYS;
  let sum = 0;
  let count = 0;
  for (let k = 0; k < n; k++) {
    if (idx === HISTORY_DAYS) idx = 0;
    const v = hist[idx] ?? 0;
    if (v !== 0) {
      sum = Math.fround(sum + v);
      count++;
    }
    idx++;
  }
  return count === 0 ? 0 : Math.fround(sum / count);
}

/** 打分要看的一支股票 + 它背后的企業 */
export interface StockScoreInput {
  price: number;
  basePrice: number;
  volatility: number;
  /** 可流通股数 +8 */
  shares: number;
  /** 当日可成交量 +10 */
  f10: number;
  /** 停牌天数 +6 */
  f6: number;
  limitUp: boolean;
  avg24: number;
  avg6: number;
  /** null = 没有对应企業 */
  company: {
    /** 資產額 +0x24 */
    assetValue: number;
    /** 累積盈餘 +0x28（分紅会清） */
    funds: number;
    /** 累計盈餘 +0x2c（从不清） */
    profit: number;
    /** 企業还剩的可售股 +0x30 */
    remainingShares: number;
    /** 董事長，1 基；0 = 无 */
    chairman: number;
    /** 董事長的持股 */
    chairmanHolding: number;
  } | null;
  /** 我的持股 */
  myHolding: number;
}

/**
 * 一支股票的分 @source 0x0042c075..0x0042c557。返回 0 = 不考虑。
 *
 * @param moneyInBank 我的存款；@param priceIndex 物價；@param totalDays 總天數（[0x499084]）
 */
export function scoreStock(
  s: StockScoreInput,
  moneyInBank: number,
  priceIndex: number,
  totalDays: number,
  meIndex: number,
): number {
  if (s.f6 !== 0) return 0;
  if (s.limitUp) return 0;
  if (s.f10 === 0) return 0;
  let score = 0;

  if (s.company === null) {
    // @source 0x0042c373：`cmp 30000×物價, 存款 / jge 跳过`
    if (30000 * priceIndex >= moneyInBank) return 0;
    if (s.price < s.basePrice * SCORE_RATIO.baseHigh && s.volatility > 2.0 && s.avg6 > s.avg24) score += 2;
    if (s.price < s.basePrice * SCORE_RATIO.baseLow && s.avg6 > s.avg24) score += 4;
    if (s.avg6 < s.avg24 * SCORE_RATIO.crash) score += 2;
    return score;
  }

  const c = s.company;
  // @source 0x0042c5f2：`cmp 20000×物價, 存款 / jge 跳过`
  if (20000 * priceIndex >= moneyInBank) return 0;
  // @source 0x0042c612..0x0042c638：idiv → 向零取整
  const monthly = totalDays !== 0 ? Math.trunc(c.profit / totalDays) : c.profit;
  const asset = Math.trunc(c.assetValue / 10000);

  if (monthly > 0 && monthly < 5000 * priceIndex) score += 1;
  if (monthly >= 5000 * priceIndex && monthly < 10000 * priceIndex) score += 2;
  if (monthly >= 10000 * priceIndex) score += 3;

  if (c.funds > 0 && s.myHolding < 5000 && s.price <= asset * SCORE_RATIO.cheapEnough) {
    score += 1;
    if (c.chairman !== 0 && c.chairman !== meIndex + 1) {
      if (s.shares + s.myHolding + c.remainingShares > c.chairmanHolding) score += 1;
      if (s.myHolding + s.f10 > c.chairmanHolding) score += 2;
    }
  }
  if (s.price < asset * SCORE_RATIO.bargain) score += 3;
  if (s.price < asset * SCORE_RATIO.steal) score += 5;
  return score;
}

/** 把状态整理成打分输入 */
export function stockScoreInput(
  state: GameState,
  topo: MapTopology,
  stock: number,
  meIndex: number,
): StockScoreInput | null {
  const st = state.market.stocks[stock];
  if (st === undefined) return null;
  const commercial =
    st.commercialIndex === 0 ? undefined : topo.commercials?.find((c) => c.id === st.commercialIndex);
  let company: StockScoreInput['company'] = null;
  if (commercial !== undefined) {
    const chairman = state.commercialOwners[commercial.id]?.owner ?? 0;
    company = {
      assetValue: commercial.assetValue,
      funds: state.companyFunds[commercial.id] ?? 0,
      profit: state.companyProfit[commercial.id] ?? 0,
      remainingShares: state.commercialShares[commercial.id] ?? 0,
      chairman,
      chairmanHolding: chairman === 0 ? 0 : (state.holdings[chairman - 1]?.[stock]?.amount ?? 0),
    };
  }
  return {
    price: st.price,
    basePrice: st.basePrice,
    volatility: st.volatility,
    shares: st.shares,
    f10: st.f10,
    f6: st.f6,
    limitUp: isLimitUp(st.openPrice, st.price),
    avg24: recentAverage(state, stock, 24),
    avg6: recentAverage(state, stock, 6),
    company,
    myHolding: state.holdings[meIndex]?.[stock]?.amount ?? 0,
  };
}

/** 十二支的分，按分降序、同分下标升序（D-006）@source qsort + 0x0042bed0 */
export function rankStocks(scores: readonly number[]): { stock: number; score: number }[] {
  return scores
    .map((score, stock) => ({ stock, score }))
    .sort((a, b) => b.score - a.score || a.stock - b.stock);
}

/**
 * 从排名里挑一支 @source 0x0042c656..0x0042c6c1：
 * 0 分跳过；第 i 名（0 起）当 `rand()%24 <= 12 − i` 时选中，否则看下一名。
 *
 * @param roll 第 i 次那个 `rand()%24` 的替身（D-004）
 */
export function pickRanked(
  ranked: readonly { stock: number; score: number }[],
  roll: (i: number) => number,
): number {
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]!;
    if ((r.score & 0xffff) === 0) continue;
    if (roll(i) > 12 - i) continue;
    return r.stock;
  }
  return -1;
}

/**
 * AI 这一步要不要买股票；不买返回 `null`。
 */
export function decideStockTrade(state: GameState, topo?: MapTopology): Action | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;

  // @source 闸一
  if (me.stockRatio === 0) return null;
  // @source 闸二：`call 0x428d01 / cmp eax, 1 / je 结束` —— 休市不进场
  if (!marketOpenOn(state.globalMapId, state.year, state.month, state.day)) return null;
  // @source 闸三
  if (me.loanDueDate !== 0 && daysUntil(state, me.loanDueDate) < STOCK_LOAN_DUE_GUARD_DAYS) {
    return null;
  }

  const owned = holdingsValue(state, state.currentPlayer);
  const budget = stockBudget(owned, me.cash, me.moneyInBank, me.stockRatio);
  if (budget <= 0) return null;

  const scores = state.market.stocks.map((_, j) => {
    const input = stockScoreInput(state, topo ?? { nodes: [] }, j, state.currentPlayer);
    return input === null ? 0 : scoreStock(input, me.moneyInBank, state.priceIndex, state.totalDays, state.currentPlayer);
  });
  const pick = pickRanked(rankStocks(scores), (i) => aiRoll(state, 0x42c690 + i, 24));
  if (pick === -1) return null;

  const stock = state.market.stocks[pick]!;
  // @source 0x0042c6e2：round(可投 / 現價)；0x0042c716：不超过可成交量
  let shares = Math.round(budget / stock.price);
  if (shares === 0) return null;
  if (stock.f10 < shares) shares = stock.f10;
  // 柜台还要求 trunc(股数 × 現價) <= 存款；可投已封顶在存款上，这里只防浮点边角
  while (shares > 0 && Math.trunc(shares * stock.price) > me.moneyInBank) shares--;
  if (shares <= 0) return null;
  return { type: 'buyStock', stock: pick, shares };
}

/** 供测试/调试：当前玩家眼里每支股票的分 */
export function stockScores(state: GameState, topo: MapTopology, me: Player = state.players[state.currentPlayer]!): number[] {
  return state.market.stocks.map((_, j) => {
    const input = stockScoreInput(state, topo, j, me.index);
    return input === null ? 0 : scoreStock(input, me.moneyInBank, state.priceIndex, state.totalDays, me.index);
  });
}

// ============================================================
//  賣股 @source 0x0042c79f..0x0042d0ee
// ============================================================

/**
 * ```
 * 0042c7bc  壓力 = 距還款日 <= 6 && 現金+存款 < 貸款（loanSellPressure）
 * 0042c802  没壓力时 rand()%3 != 0 → 不賣（D-004 替身）
 * 0042c81b  休市 → 不賣
 * 0042cf7c  逐支（我持股 > 0、没停牌、没跌停）打分，取分最高且 > 0 的一支，**全部賣出**
 * 0042d0a2  壓力下：現金+存款 < 貸款×1.1 就回头再賣一支（本引擎：aiStep 停在 1，下一帧再来）
 *
 * ── 有企業（0x42c872）──  ratio = 我持股 / 全體持股；S = 月均盈餘；A = 資產額/10000；day = 今日
 * 0042c8fa  盈餘(+0x28) <= −10000×物價 && ratio > 0.6 && 10 < day < 15         → +3
 * 0042c941  盈餘 <= −6000×物價 && 現價 > 成本×1.2 && 董事長≠我 && 8 < day < 15  → +2
 * 0042c9b8  S <= 10000×物價 && A×2 <= 現價 && 現價 > 成本×1.3 && ratio < 0.4   → +1
 * 0042ca26  董事長是别人 && 流通+我+剩余 < 董事長持股 && 盈餘 <= 0 && 現價 >= 成本×1.5 → +1
 * 0042cadb  A×2 < 現價 && 成本×2 < 現價 && 現價 < 開盤 && 董事長≠我          → +2
 * 0042cb46  A×3 < 現價 && 成本×3 < 現價 && 現價 < 開盤 && 董事長==我          → +2
 * 0042cba7  壓力                                                           → +1
 *
 * ── 無企業（0x42cbc1）──  gain = 現價/成本；minHist = 144 日里最低的非 0 收盘
 * 0042cd59  gain > 1.6 && 波动系数 < 1.0                                   → +2
 * 0042cd8e  現價 > minHist×8 && minHist×8 > 成本×1.25                        → +2
 * 0042cde4  avg24 > avg6 && 現價 < 開盤                                     → +2
 * 0042ce19  gain >= −2                                                     → +round((gain−2)/0.5 + 1)
 * 0042ce5c  現金+存款 < 30000×物價 && gain > 0                              → +round(gain/0.5 + 1)
 * 0042cec9  現金+存款 < 16000×物價 && gain > 0                              → +round(gain/0.5 + 1)
 * 0042cf33  壓力                                                           → 分 ×2
 * ```
 */
export const SELL_RATIO = {
  redRatio: 0.6,
  gainA: 1.2,
  gainB: 1.3,
  gainC: 1.5,
  assetHigh: 2.0,
  assetVeryHigh: 3.0,
  minHistMultiple: 8.0,
  minHistCost: 1.25,
  bigGain: 1.6,
  gainFloor: -2.0,
} as const;

export interface SellScoreInput extends StockScoreInput {
  /** 持仓成本均价 */
  avgCost: number;
  openPrice: number;
  /** 144 日里最低的非 0 收盘；没有则 9999 */
  minHist: number;
  /** 全體玩家对这支的持股合计 */
  totalHold: number;
}

/** 144 日里最低的非 0 收盘 @source 0x0042cbd6（初值 0x461c4000 = 9999.0） */
export function lowestHistory(state: GameState, stock: number): number {
  let low = 9999;
  for (const v of state.market.history[stock] ?? []) if (v !== 0 && v < low) low = v;
  return low;
}

export function sellScoreInput(state: GameState, topo: MapTopology, stock: number, meIndex: number): SellScoreInput | null {
  const base = stockScoreInput(state, topo, stock, meIndex);
  const st = state.market.stocks[stock];
  if (base === null || st === undefined) return null;
  let totalHold = 0;
  for (const h of state.holdings) totalHold += h?.[stock]?.amount ?? 0;
  return {
    ...base,
    avgCost: state.holdings[meIndex]?.[stock]?.avgCost ?? 0,
    openPrice: st.openPrice,
    minHist: lowestHistory(state, stock),
    totalHold,
  };
}

function roundHalf(x: number): number {
  return Math.round(x);
}

/** 一支股票的賣出分；0 = 不賣 */
export function scoreStockForSale(
  s: SellScoreInput,
  me: { cash: number; moneyInBank: number },
  priceIndex: number,
  totalDays: number,
  meIndex: number,
  mustSell: boolean,
  dayOfMonth: number,
): number {
  if (s.myHolding === 0 || s.f6 !== 0) return 0;
  const limitDown = isLimitDown(s.openPrice, s.price);
  if (limitDown) return 0;
  let score = 0;
  const cost = s.avgCost;
  const price = s.price;

  if (s.company !== null) {
    const c = s.company;
    const monthly = totalDays !== 0 ? Math.trunc(c.profit / totalDays) : c.profit;
    const asset = Math.trunc(c.assetValue / 10000);
    const ratio = s.totalHold === 0 ? 0 : Math.fround(s.myHolding / s.totalHold);
    const mine = c.chairman === meIndex + 1;
    if (c.funds <= -10000 * priceIndex && ratio > SELL_RATIO.redRatio && dayOfMonth > 10 && dayOfMonth < 15) score += 3;
    if (c.funds <= -6000 * priceIndex && price > cost * SELL_RATIO.gainA && !mine && dayOfMonth > 8 && dayOfMonth < 15) score += 2;
    if (monthly <= 10000 * priceIndex && asset * SELL_RATIO.assetHigh <= price && price > cost * SELL_RATIO.gainB && ratio < 0.4) score += 1;
    if (c.chairman !== 0 && !mine && s.shares + s.myHolding + c.remainingShares < c.chairmanHolding && c.funds <= 0 && price >= cost * SELL_RATIO.gainC) score += 1;
    if (asset * SELL_RATIO.assetHigh < price && cost * SELL_RATIO.assetHigh < price && price < s.openPrice && !mine) score += 2;
    if (asset * SELL_RATIO.assetVeryHigh < price && cost * SELL_RATIO.assetVeryHigh < price && price < s.openPrice && mine) score += 2;
    if (mustSell) score += 1;
    return score;
  }

  const gain = cost === 0 ? 0 : Math.fround(price / cost);
  const min8 = Math.fround(s.minHist * SELL_RATIO.minHistMultiple);
  if (gain > SELL_RATIO.bigGain && s.volatility < 1.0) score += 2;
  if (price > min8 && min8 > cost * SELL_RATIO.minHistCost) score += 2;
  if (s.avg24 > s.avg6 && price < s.openPrice) score += 2;
  // ÷ 0.5 就是 × 2（精确），避开除法：round((gain − 2) / 0.5 + 1) = round(2·gain − 3)
  if (gain >= SELL_RATIO.gainFloor) score += roundHalf(2 * gain - 3);
  const liquid = me.cash + me.moneyInBank;
  if (liquid < 30000 * priceIndex && gain > 0) score += roundHalf(2 * gain + 1);
  if (liquid < 16000 * priceIndex && gain > 0) score += roundHalf(2 * gain + 1);
  if (mustSell) score *= 2;
  return score;
}

/** 分最高且 > 0 的一支；同分取先出现的（`cmp best, score / jge`） */
export function pickForSale(scores: readonly number[]): number {
  let best = 0;
  let pick = -1;
  scores.forEach((sc, j) => {
    if (sc > best) {
      best = sc;
      pick = j;
    }
  });
  return pick;
}

/**
 * 電腦這一步賣不賣、賣哪支；不賣返回 `null`。賣就是**全部持股**。
 * 調度里是第 1 步（`aiStep === 1`），壓力下 reducer 会让它停在第 1 步再来一次。
 */
export function decideStockSell(state: GameState, topo: MapTopology): Action | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const mustSell = loanSellPressure(me, state);
  // @source 0x0042c802：没壓力时三分之二的回合根本不看
  if (!mustSell && aiRoll(state, 0x42c802, 3) !== 0) return null;
  if (!marketOpenOn(state.globalMapId, state.year, state.month, state.day)) return null;
  const scores = state.market.stocks.map((_, j) => {
    const input = sellScoreInput(state, topo, j, state.currentPlayer);
    return input === null
      ? 0
      : scoreStockForSale(input, me, state.priceIndex, state.totalDays, state.currentPlayer, mustSell, state.day);
  });
  const pick = pickForSale(scores);
  if (pick === -1) return null;
  const shares = state.holdings[state.currentPlayer]?.[pick]?.amount ?? 0;
  if (shares <= 0) return null;
  return { type: 'sellStock', stock: pick, shares };
}
