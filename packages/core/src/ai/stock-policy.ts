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
 * 0042bfc7      市值 = trunc(市值 + 持股[i] × 股价[i])  ; 0x42bff1 `call 0x457dbc`（向零截断）
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
 *   0042c612  S = 總月數 ? trunc(累計盈餘(+0x2c) / 總月數) : 累計盈餘   ; 月均盈餘（[0x499084] 跨月 +1）
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
 * 的概率被选中（0x0042c690），第一个中的就买：股数 = trunc(可投 / 現價)，不超过可成交量。
 *
 * ★★ 审计（provenance-ai-econ）：买卖两段都改由 **reducer** 在调度步里跑（`aiStockBuy` /
 *   `aiStockSellPick`，见 `state/reduce.ts` 的 `aiAdvance`），随机数走**全局** Watcom 流、
 *   与原版同序同次数：买股入口 `rand()%3`（**每个电脑回合必掷**）、排名里逐名 `rand()%24`、
 *   卖股（没壓力时）`rand()%3`。先前策略层用 `aiRoll` 派生替身（D-004），全局流一次都不推进；
 *   `qsort` 也已按原版 Watcom 算法逐条移植（`rules/watcom-qsort.ts`，D-006 撤）。
 */

import type { GameState } from '../state/types.ts';
import type { MapTopology } from '../state/reduce.ts';
import { stockBudget } from './personality.ts';
import { watcomQsort } from '../rules/watcom-qsort.ts';
import { dayNumberSince1998 } from '../places/calendar.ts';
import { HISTORY_DAYS } from '../places/stock-market.ts';
import { isLimitDown, isLimitUp, marketOpenOn } from '../places/stock-market.ts';
import { truncTowardZero } from '../rules/rounding.ts';

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

/**
 * 当前玩家的持仓市值 @source 0x0042bf94 的循环：
 * 每支 `fild 股数 / fmul 股价 / fadd 累计 / call 0x457dbc / fistp`
 * —— 0x42bff1 那个 `call 0x457dbc` 是 `__round_toward_zero`（**向零截断**），
 * 不是 `Math.round`。股价带小数时逐支截断会与逐支四舍五入差 1。
 */
export function holdingsValue(state: GameState, playerIndex: number): number {
  const held = state.holdings[playerIndex] ?? [];
  let total = 0;
  for (let i = 0; i < held.length; i++) {
    const amount = held[i]?.amount ?? 0;
    if (amount === 0) continue;
    const price = state.market.stocks[i]?.price ?? 0;
    // @source 0042bfb3..0042bff6 逐轮：
    //   fild 持股 → fmul [股价]                （st0 = 股数 × 股价，extended）
    //   fild [esp+0xe4]（= 上一轮的整数累加器）
    //   fstp dword [esp+0xe4]                  ; ★ 累加器**过一趟 f32**
    //   fadd dword [esp+0xe4]                  ; st0 = 本项 + f32(上一轮)
    //   call 0x457dbc（向零截断）→ fistp 回整数累加器
    //   ⇒ 累加器是**整数**，但每轮都要过一次 f32（24 位尾数）——
    //     总额 > 2^24 且不可精确表示时，结果会与纯整数累加差几块钱。
    //     `Math.fround` 就是这一步（D-QNUM-3 订正：不是「整体用 f32 累加」，
    //     而是「整数累加器 + 每轮过一次 f32」）。
    total = truncTowardZero(amount * price + Math.fround(total));
  }
  return total;
}

/**
 * 持仓的**成本**（Σ 股数 × 均价），不是市值。
 *
 * ★ 查账时要用它而不是市值：买入是把钱 1:1 换成成本，所以成本守恒；
 *   市值会随行情涨跌，那是**账面**盈亏，不是凭空多出来的钱。
 *
 * ⚠️ 这里的 `Math.round` **没有** exe 判据：它是本引擎自己的账目守恒工具
 *   （`state/soak.test.ts` 的「没印钞机时总额只减不增」用它），原版没有
 *   对应的「持仓成本」概念。故**保持原样**，不与 `holdingsValue` 的
 *   `__round_toward_zero` 统一 —— 这不是漏改。见 `Q-NUM-1.md` 的 D-QNUM-4。
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
  /**
   * 当日涨跌趋势 @source stock_info `+0x1c`（float）—— ★ 2026-09-19 补（§7.140）：
   * “无企业那个 +2” 的第二个判据用的是**它**，不是 `volatility`（`+0x18`）。
   *   `0x42c4bb cmp dword [股票 + 0x1c], 0x40000000`（= 2.0f）。
   *   实测 `volatility` 恒在 0.40..2.00 ⇒ 用它会让那个 +2 **永不可得**。
   */
  trend: number;
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
 * @param moneyInBank 我的存款；@param priceIndex 物價；@param totalMonths 總月數（[0x499084]）
 */
export function scoreStock(
  s: StockScoreInput,
  moneyInBank: number,
  priceIndex: number,
  totalMonths: number,
  meIndex: number,
): number {
  if (s.f6 !== 0) return 0;
  if (s.limitUp) return 0;
  if (s.f10 === 0) return 0;
  let score = 0;

  if (s.company === null) {
    // @source 0x0042c373：`cmp 30000×物價, 存款 / jge 跳过`
    if (30000 * priceIndex >= moneyInBank) return 0;
    if (s.price < s.basePrice * SCORE_RATIO.baseHigh && s.trend > 2.0 && s.avg6 > s.avg24) score += 2;
    if (s.price < s.basePrice * SCORE_RATIO.baseLow && s.avg6 > s.avg24) score += 4;
    if (s.avg6 < s.avg24 * SCORE_RATIO.crash) score += 2;
    return score;
  }

  const c = s.company;
  // @source 0x0042c5f2：`cmp 20000×物價, 存款 / jge 跳过`
  if (20000 * priceIndex >= moneyInBank) return 0;
  // @source 0x0042c612..0x0042c638：idiv → 向零取整
  const monthly = totalMonths !== 0 ? Math.trunc(c.profit / totalMonths) : c.profit;
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
    trend: st.trend,
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

/**
 * 十二支的分按原版 `qsort` 排名 @source `0x0042c64e call 0x457e6c(表, 12, 4, 0x42bed0)`。
 *
 * 表是 12 个 dword：低字 = 分、高字 = 股票下标（`0x0042c56d or [..], 股<<16`）；比较器 `0x42bed0`
 * 比**低字**（`movsx`，有符号），大者在前。Watcom 的 `qsort` 不稳定 —— 同分谁先由算法定，
 * 故用逐条移植的 `watcomQsort`（4 字节元素 ⇒ 枢轴拷贝那一型；n = 12 < 16 只走两趟插入）。
 */
export function rankStocks(scores: readonly number[]): { stock: number; score: number }[] {
  const recs = scores.map((score, stock) => ({ stock, score }));
  return watcomQsort(recs, (a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0), false);
}

/**
 * 从排名里挑一支 @source 0x0042c656..0x0042c6c1：
 * 0 分跳过（**不掷**）；第 i 名（0 起）掷一次 `rand()%24`，`<= 12 − i` 就选中，否则看下一名。
 *
 * @param roll 第 i 名那次 `rand()%24`（reducer 传全局流）
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

/** 原版 `rand()` 的来源（reducer 传 `WatcomRng.next`） */
export type RandSource = () => number;

/** 电脑这一趟买 / 卖哪支、几股 */
export interface AiStockTrade {
  stock: number;
  shares: number;
}

/**
 * 电脑买股 —— `fcn_0042bf03(玩家)` 整段（reducer 在调度步 0 → 1 时调）。
 *
 * ★ 随机数与原版同序同次数（全局流）：
 *   1. `0x0042bf14 call rand / idiv 3 / test edx,edx / jne 返回` —— **每个电脑回合必掷**，
 *      三分之二的回合到此为止；
 *   2. 排名里每个非 0 分的名次各掷一次 `rand()%24`（`0x0042c690`），选中即停。
 * ★ 买本身是 `0x0042c72d call 0x428d2a(玩家, 股, 股数, 1)` —— **没有**柜台那几道检查
 *   （流通量 / 存款够不够），调用方直接落账。
 */
export function aiStockBuy(state: GameState, topo: MapTopology, rand: RandSource): AiStockTrade | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  // @source 0x0042bf14：rand()%3 != 0 ⇒ 返回（先于三道闸）
  if (rand() % 3 !== 0) return null;
  // @source 闸一 0x0042bf30 `cmp byte [player+0x1a], 0 / je`
  if (me.stockRatio === 0) return null;
  // @source 闸二 `call 0x428d01 / cmp eax, 1 / je 结束` —— 休市（含新聞 26 的全股市暂停）不进场
  if (!marketOpenOn(state.globalMapId, state.year, state.month, state.day, state.market.closedDays)) return null;
  // @source 闸三 0x0042bf65 `cmp eax, 0xf / jl`
  if (me.loanDueDate !== 0 && daysUntil(state, me.loanDueDate) < STOCK_LOAN_DUE_GUARD_DAYS) return null;

  const owned = holdingsValue(state, state.currentPlayer);
  // 预算 ≤ 0 只在存款 ≤ 0 时出现 —— 那时两条存款闸让十二支全 0 分、`rand()%24` 一次也不掷，与这里直接返回同效
  const budget = stockBudget(owned, me.cash, me.moneyInBank, me.stockRatio);
  if (budget <= 0) return null;

  const scores = state.market.stocks.map((_, j) => {
    const input = stockScoreInput(state, topo, j, state.currentPlayer);
    return input === null ? 0 : scoreStock(input, me.moneyInBank, state.priceIndex, state.totalMonths, state.currentPlayer);
  });
  const pick = pickRanked(rankStocks(scores), () => rand() % 24);
  if (pick === -1) return null;

  const stock = state.market.stocks[pick]!;
  // @source 0x0042c6e2 `fild 可投 / fdiv 現價` → 0x0042c6ef `call 0x457dbc`（向零截断）
  let shares = truncTowardZero(budget / stock.price);
  // @source 0x0042c702 `test edx, edx / je 返回`
  if (shares === 0) return null;
  // @source 0x0042c716 `cmp 可成交量, 股数 / jge` —— 不超过当日可成交量
  if (stock.f10 < shares) shares = stock.f10;
  return { stock: pick, shares };
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
 * ── 有企業（0x42c872）──  ratio = 全體持股 / 我持股（★ 见下）；S = 月均盈餘；A = 資產額/10000；day = 今日
 * 0042c8fa  盈餘(+0x28) <= −10000×物價 && ratio > 0.6 && 10 < day < 15         → +3
 * 0042c941  盈餘 <= −6000×物價 && 現價 > 成本×1.2 && 董事長≠我 && 8 < day < 15  → +2
 * 0042c9b8  S <= 10000×物價 && A×2 <= 現價 && 現價 > 成本×1.3 && ratio < 0.4   → +1
 * 0042ca26  董事長是别人 && 流通+我+剩余 < 董事長持股 && 盈餘 <= 0 && 現價 >= 成本×1.5 → +1
 * 0042cadb  A×2 < 現價 && 成本×2 < 現價 && 現價 < 開盤 && 董事長≠我          → +2
 * 0042cb46  A×3 < 現價 && 成本×3 < 現價 && 現價 < 開盤 && 董事長==我          → +2
 * 0042cba7  壓力                                                           → +1
 *
 * ── 無企業（0x42cbc1）──  gain = 現價/成本；minHist = 144 日里最低的非 0 收盘
 * 0042cd59  gain > 1.6 && 趋势(+0x1c) < 1.0                                  → +2
 * 0042cd8e  現價 > minHist×8 && minHist×8 > 成本×1.25                        → +2
 * 0042cde4  avg24 > avg6 && 現價 < 開盤                                     → +2
 * 0042ce19  gain >= +2.0                                                   → +trunc(2·(gain−2)+1)
 * 0042ce5c  現金+存款 < 30000×物價 && gain > 0                              → +trunc(2·gain + 1)
 * 0042cec9  現金+存款 < 16000×物價 && gain > 0                              → +trunc(2·gain + 1)
 * 0042cf33  壓力                                                           → 分 ×2
 * ```
 *
 * ★★ 审计订正（provenance-ai-econ）两处：
 *   1. **ratio 是「全體 ÷ 我」不是「我 ÷ 全體」**：`0x0042c8ad fild [我持股]` 先入栈、`0x0042c8c2 fild 全體`
 *      后入栈，`0x0042c8c9 fdivrp st(1)`（`DE F1`：ST(1) ← ST(0) ÷ ST(1)）⇒ 全體 ÷ 我 —— 与 `0x428e02`
 *      算均价（同一条 `DE F1`、同样先成本后股数入栈 ⇒ 成本 ÷ 股数）同形。于是 ratio ≥ 1：
 *      「ratio > 0.6」恒成立、「ratio < 0.4」恒不成立（原版如此，照抄）。先前写反了。
 *   2. **無企業那条 +2 看的是趋势 `+0x1c`**（`0x0042cd72 cmp dword [股*36 + 0x49699c], 0x3f800000 / jge`，
 *      与买股 `0x42c4bb` 同一个字段），不是波动系数 `+0x18`。先前用了 `volatility`。
 *
 * ★ `0x0042ce20` 的判据阈值是 **+2.0**（`0x4641f4`），`−2.0`（`0x4641f8`）是
 *   紧接着 `fadd` 的**偏移量**、不是阈值。旧代码把这两个常量读反，写成
 *   `gainFloor = -2.0`，于是 `gain ∈ (0, 2)` 时凭空多出 `trunc(2·gain−3)`（0 或负数）。
 *   已按 exe 订正，见 `Q-NUM-1.md` 的 D-QNUM-5。
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
  /**
   * 「大赚」加分的**判据阈值**：`0042ce20 fcomp dword [0x4641f4]`，
   * 而 `0x4641f4` 是 f32 **+2.0**（不是 −2.0）。
   *
   * @source 直读 exe 常量：`[0x4641f0] = f32 1.90625`（`00 00 f4 3f`，另一段的系数）、
   *   `[0x4641f4] = f32 **+2.0**`（`00 00 00 40`，本阈值）、
   *   `[0x4641f8] = f32 −2.0`（`00 00 00 c0`，下方的偏移量）、
   *   `[0x4641fc] = f64 0.5`（`00…00 e0 3f`，步长；它的低 dword 恰好是 0）。
   *
   * ★ `fcomp` 之后是 `fnstsw ax / sahf / jb 0x42ce5c`：`jb` 取 CF=1，
   *   而 x87 的 C0（= CF）为 1 表示 ST(0) < 操作数 ⇒ **gain < 2.0 时跳过加分**，
   *   即 `gain >= 2.0` 才走那段 `fadd −2.0 / fdiv 0.5 / fld1 / faddp / trunc`。
   */
  gainFloor: 2.0,
} as const;

/**
 * 大赚那段的**偏移量**（不是判据阈值）@source 0x0042ce32 `fadd dword [0x4641f8]`
 *   / 0x4641f8 = f32 **−2.0**。
 *
 * 旧代码把它误当成 `gainFloor`，见 `Q-NUM-1.md` 的 D-QNUM-5。
 */
export const SELL_GAIN_SHIFT = -2.0;

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

/**
 * 賣出打分里那三段加分的取整。
 *
 * @source 三段同一形状（0x0042ce38 / 0x0042cea5 / 0x0042cf15 一带）：
 * ```asm
 * fadd(-2.0) / fdiv(0.5) 或直接 fdiv(0.5) → fld1 → faddp st(1) → call 0x457dbc
 * ```
 * 末尾那个 0x457dbc 是 `__round_toward_zero`（**向零截断**），不是四舍五入。
 * 原来的 `roundHalf`（`Math.round`）在结果恰为 k+0.5 时会多给 1 分。
 */
function saleScoreRound(x: number): number {
  return truncTowardZero(x);
}

/** 一支股票的賣出分；0 = 不賣 */
export function scoreStockForSale(
  s: SellScoreInput,
  me: { cash: number; moneyInBank: number },
  priceIndex: number,
  totalMonths: number,
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
    const monthly = totalMonths !== 0 ? Math.trunc(c.profit / totalMonths) : c.profit;
    const asset = Math.trunc(c.assetValue / 10000);
    // @source 0x0042c8c9 `fdivrp st(1)`（DE F1）⇒ 全體 ÷ 我，`fstp dword` 存 f32（myHolding > 0 已由入口保证）
    const ratio = Math.fround(s.totalHold / s.myHolding);
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
  // @source 0x0042cd72 `cmp dword [股*36 + 0x49699c], 0x3f800000 / jge` —— 趋势 +0x1c（整数比位型 ≡ 浮点 < 1.0）
  if (gain > SELL_RATIO.bigGain && s.trend < 1.0) score += 2;
  if (price > min8 && min8 > cost * SELL_RATIO.minHistCost) score += 2;
  if (s.avg24 > s.avg6 && price < s.openPrice) score += 2;
  // 三段都收在 `(x + 偏移)/0.5 + 1` 再 `call 0x457dbc`；÷0.5 就是 ×2（精确，
  // 且避开 C-DET-3 的裸除法），故写作 2·(gain + shift) + 1。
  // @source 0042ce2b..0042ce42（判据 gain >= +2.0，偏移 −2.0）：
  //   trunc((gain − 2)/0.5 + 1) = trunc(2·gain − 3)
  if (gain >= SELL_RATIO.gainFloor) {
    score += saleScoreRound(2 * (gain + SELL_GAIN_SHIFT) + 1);
  }
  const liquid = me.cash + me.moneyInBank;
  // @source 0042ce9e..0042cec2 / 0042cf08..0042cf2c：无偏移，直接 trunc(gain/0.5 + 1)
  if (liquid < 30000 * priceIndex && gain > 0) score += saleScoreRound(2 * gain + 1);
  if (liquid < 16000 * priceIndex && gain > 0) score += saleScoreRound(2 * gain + 1);
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
 * 卖股那一轮打分挑哪支 —— `0x0042cf7c` 的十二支循环（逐支打分、取分最高且 > 0 的一支，**全部卖出**）。
 * 返回 null = 没有可卖的。随机闸与「壓力下回头再卖」的循环在 reducer（`aiStockSellTurn`）里。
 *
 * @param mustSell 进入 `0x42c79f` 时算好的壓力旗（`[esp+0xd0]`）—— ★ 整趟**不重算**：
 *   回头再卖（`0x0042d0de ja 0x42c829`）跳回的是打分循环，旗还是入口那一份。
 */
export function aiStockSellPick(state: GameState, topo: MapTopology, mustSell: boolean): AiStockTrade | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const scores = state.market.stocks.map((_, j) => {
    const input = sellScoreInput(state, topo, j, state.currentPlayer);
    return input === null
      ? 0
      : scoreStockForSale(input, me, state.priceIndex, state.totalMonths, state.currentPlayer, mustSell, state.day);
  });
  const pick = pickForSale(scores);
  if (pick === -1) return null;
  const shares = state.holdings[state.currentPlayer]?.[pick]?.amount ?? 0;
  if (shares <= 0) return null;
  return { stock: pick, shares };
}
