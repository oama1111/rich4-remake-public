/*
 * 股市行情 —— 每日波动、新闻冲击、大盘指数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 逐行翻译自原版三个函数（rich4-re/asm/rich4_stocks.asm，并以 exe 复核）：
 *   `fcn_00428ec5`  股价落档（把涨跌幅按价位档取整）
 *   `fcn_004291d6`  每日收盘 —— 由日期推进 `0041d076 call 0x4291d6` 触发
 *   `fcn_00429040`  新闻即时改价 —— 新闻事件触发，改写**当日**收盘
 *
 * 全局量对应关系：
 * | 原版 | 本模块 |
 * |---|---|
 * | `_stocks_on_map` 0x496980（12 × 36B） | `StockMarketState.stocks` |
 * | `[0x499100]` 日序号 0..143            | `day` |
 * | `[0x497328]` 144 日价格环形历史        | `history` |
 * | `[0x499078]` 大盘指数                 | `index` |
 * | `[0x4990ec]` 当日大盘漂移             | `drift`（只在一次 tick 内有意义） |
 *
 * ⚠️ 全程 32 位 float。原版把这些字段都按 `dword` 存取，
 *   用 JS 的 double 算会在几十日后与原版分道扬镳，故每一步都 `Math.fround`。
 */

import type { StockState } from './stock.ts';
import type { WatcomRng } from '../rng/watcom.ts';
import { STOCKS, STOCKS_PER_MAP } from '@rich4/data';
import { dayNumberSince1998, isHoliday } from './calendar.ts';

// ============================================================
//  常量 —— 全部从 rich4.exe 的 .data 段直接读出
// ============================================================

/** 涨跌幅的百分比基数 @source `fadd/fdiv dword [0x463f88]` = 100.0 */
const PERCENT_BASE = 100;

/**
 * 价位档：股价落在哪一段，涨跌就按多大的档位取整。
 *
 * @source fcn_00428ec5 的四次比较，阈值 `[0x463f8c..0x463f98]`
 *   = 5 / 15 / 50 / 150，对应档位 `[0x463fb4/0463fac/0x463fa4/0x463f9c]`
 *   = 0.01 / 0.05 / 0.1 / 0.5，超过 150 则为 1.0（`fld1`）。
 *
 * ★ 这正是台股的「跳动单位」制度——原版照搬了现实规则。
 */
const TICK_LADDER: readonly (readonly [limit: number, tick: number])[] = [
  [5, 0.01],
  [15, 0.05],
  [50, 0.1],
  [150, 0.5],
];
const TICK_ABOVE_LADDER = 1;

/** 股价下限 @source `cmp ..., 0x3f800000 / jge` = 1.0 */
export const MIN_PRICE = 1;
/** 股价上限 @source `fcomp [0x463fbc]` = 9999.0，越界即钳到 0x461c3c00 = 9999 */
export const MAX_PRICE = 9999;

/** 趋势上下限 @source `cmp [+28], 0x41200000` / `fcomp [0x463fe8]` = ±10 */
export const MAX_TREND = 10;

/** 大盘漂移的除数 @source `fdiv [0x463fc4]` = 4097 */
const DRIFT_DIVISOR = 4097;
/** 个股随机冲击的除数 @source `fdiv [0x463fc8]` = 1171 */
const SHOCK_DIVISOR = 1171;
/** `rand()` 的中点，减去它把 0..32767 变成 ±16384 @source `sub eax, 0x4000` */
const RAND_MIDPOINT = 0x4000;

/** 企业资产折算成股价的除数 @source `fdiv [0x463fd8]` = 10000 */
const COMMERCIAL_VALUE_DIVISOR = 10000;

/** 有对应企业时的「过高」倍数 @source `fmul [0x463fe4]` = 3.0 */
const OVER_RATIO_WITH_COMMERCIAL = 3;
/** 有对应企业时的「过低」倍数 @source `fmul qword [0x463fdc]` = 0.85 */
const UNDER_RATIO_WITH_COMMERCIAL = 0.85;
/** 无企业时的「过高」倍数 @source `fmul [0x463fd4]` = 8.0 */
const OVER_RATIO_PLAIN = 8;
/** 无企业时的「过低」倍数 @source `fmul [0x463fcc]` = 0.5 */
const UNDER_RATIO_PLAIN = 0.5;

/** 逆势时的削弱倍数 @source `fmul [0x463fcc]` = 0.5 */
const DAMPEN = 0.5;
/** 顺势时的放大倍数 @source `fmul [0x463fd0]` = 2.0 */
const AMPLIFY = 2;

/** 大盘指数 = Σ收盘价 × 10 @source `fmul [0x463fec]` = 10.0，再向零取整 */
const INDEX_SCALE = 10;

/** 价格历史的天数 @source `cmp ecx, 0x90 / jne` = 144 */
export const HISTORY_DAYS = 0x90;

/** 新闻利多／利空的固定趋势 @source `0x41200000` / `0xc1200000` */
const NEWS_TREND_UP = 10;
const NEWS_TREND_DOWN = -10;

// ============================================================
//  股价落档
// ============================================================

/** 某个价位适用的跳动单位 */
export function tickSize(price: number): number {
  for (const [limit, tick] of TICK_LADDER) {
    if (price < limit) return tick;
  }
  return TICK_ABOVE_LADDER;
}

/**
 * 把「开盘价 + 涨跌幅%」算成收盘价，并按跳动单位落档。
 *
 * @source fcn_00428ec5（两个 float 参数：开盘价、涨跌幅百分比）
 * ```asm
 * raw = (pct + 100) / 100 * price
 * if (pct > 0) { diff = raw - price;  result = raw - fmod(diff, tick(raw)) }
 * else         { diff = price - raw;  result = raw + fmod(diff, tick(raw)) }
 * if (result < 1)     result = 1
 * if (result > 9999)  result = 9999
 * ```
 *
 * ★ 两个方向都是**朝开盘价方向取整**——涨的少算、跌的少算，
 *   而不是四舍五入。别改成 round，那会让长期走势整体偏高。
 */
export function applyPriceTick(price: number, pct: number): number {
  const raw = Math.fround(Math.fround(Math.fround(pct + PERCENT_BASE) / PERCENT_BASE) * price);
  const tick = tickSize(raw);
  // @source fldz / fcomp [pct] / jae → 0 >= pct 时走「跌」分支
  const diff = pct > 0 ? Math.fround(raw - price) : Math.fround(price - raw);
  const rem = Math.fround(diff % tick);
  let result = pct > 0 ? Math.fround(raw - rem) : Math.fround(raw + rem);

  if (!(result >= MIN_PRICE)) result = MIN_PRICE;
  if (result > MAX_PRICE) result = MAX_PRICE;
  return result;
}

// ============================================================
//  行情状态
// ============================================================

export interface StockMarketState {
  /** 本局 12 支股票 */
  stocks: StockState[];
  /** 日序号 0..143，写满一圈回绕 @source [0x499100] */
  day: number;
  /** `history[股票][日]` 的收盘价环形缓冲 @source [0x497328] */
  history: number[][];
  /** 大盘指数 @source [0x499078] */
  index: number;
}

/**
 * 把股票与地图上的上市企业绑定。
 *
 * @source `_rich4_init_stock_commercial` VA 0x00428cb1：
 * ```asm
 * for (esi = 0; esi < 12; esi++) {
 *     if (word [stocks + esi*36 + 4] == 0) continue;   ; 该股没有对应企业
 *     for (edx = 1; edx <= num_commercials; edx++)
 *         if (byte [commercial(edx) + 0x19] == esi) {  ; 企业记的股票下标
 *             word [stocks + esi*36 + 4] = edx;        ; ★ 改写成 1 基企业序号
 *             break-ish
 *         }
 * }
 * ```
 * 也就是说数值表里的 `hasCommercial`（0/1）在开局时会被**改写**成企业序号，
 * 之后 `commercialIndex` 才是真正可用的下标。
 */
export function bindCommercials(
  stocks: StockState[],
  commercials: readonly { id: number; stockIndex: number }[],
): void {
  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i]!;
    // @source cmp word [+4], 0 / je —— 表里标了 0 的股票没有对应企业
    if (s.commercialIndex === 0) continue;
    const c = commercials.find((x) => x.stockIndex === i);
    s.commercialIndex = c?.id ?? 0;
  }
}

/**
 * 从数值表建一局的行情。`mapId` 决定取哪 12 支。
 *
 * `commercials` 给出后会做一次 `bindCommercials`——不给则各股都按
 * 「没有对应企业」处理，均值回归退回用初始股价当锚点。
 */
export function newStockMarket(
  mapId: number,
  commercials?: readonly { id: number; stockIndex: number }[],
): StockMarketState {
  const base = mapId * STOCKS_PER_MAP;
  const stocks: StockState[] = [];
  for (let i = 0; i < STOCKS_PER_MAP; i++) {
    const t = STOCKS[base + i];
    if (t === undefined) break;
    stocks.push({
      // ★ 表里 +12/+16/+20 三者同值，开局照此铺开
      price: t.price,
      openPrice: t.price,
      basePrice: t.price,
      shares: t.shares,
      f10: t.f10,
      commercialIndex: t.hasCommercial,
      f6: t.f6,
      newsFlag: t.f7,
      volatility: t.volatility,
      trend: t.f28,
      shock: t.f32,
    });
  }
  if (commercials !== undefined) bindCommercials(stocks, commercials);

  return {
    stocks,
    day: 0,
    history: stocks.map(() => new Array<number>(HISTORY_DAYS).fill(0)),
    index: 0,
  };
}

/**
 * 企业下标 → 企业资产额（原版的 `commercial[idx].field_0x24`）。
 *
 * 由调用方提供：core 不持有地图企业表的所有权，且该字段在
 * loaders/map.ts 里尚未定名（见 `LandInfo` 的 TODO）。
 * 返回 null 表示该企业查不到，此时按「无企业」处理。
 */
export type CommercialValueLookup = (commercialIndex: number) => number | null;

// ============================================================
//  每日收盘
// ============================================================

/** 单支股票的均值回归调整 —— 把 fcn_004291d6 的两组对称分支收在一处 */
function meanRevert(trend: number, openPrice: number, reference: number, hasCommercial: boolean): number {
  const overRatio = hasCommercial ? OVER_RATIO_WITH_COMMERCIAL : OVER_RATIO_PLAIN;
  const underRatio = hasCommercial ? UNDER_RATIO_WITH_COMMERCIAL : UNDER_RATIO_PLAIN;

  if (openPrice > reference) {
    // @source fld f16 / fcomp ref*倍数 / jbe → 未超线就不调整
    if (!(openPrice > Math.fround(reference * overRatio))) return trend;
    // 高得离谱：涨势削半、跌势加倍
    return Math.fround(trend > 0 ? trend * DAMPEN : trend * AMPLIFY);
  }
  // @source 低价侧的阈值是**乘一个小于 1 的系数**，故比较方向相反
  if (!(openPrice < Math.fround(reference * underRatio))) return trend;
  // 低得离谱：跌势削半、涨势加倍
  return Math.fround(trend < 0 ? trend * DAMPEN : trend * AMPLIFY);
}

/** 把趋势钳进 ±10 @source loc_004293d2 的两次比较 */
function clampTrend(trend: number): number {
  if (trend > MAX_TREND) return MAX_TREND;
  if (trend < -MAX_TREND) return -MAX_TREND;
  return trend;
}

/** 新闻标记 → 当日趋势。高半字节利多、低半字节利空。 */
export function newsTrend(newsFlag: number): number {
  return (newsFlag & 0xf0) !== 0 ? NEWS_TREND_UP : NEWS_TREND_DOWN;
}

/**
 * 收盘 —— 每天调用一次。
 *
 * @source fcn_004291d6，由 `0041d076`（日期推进）调用。
 *
 * ```
 * drift = (rand() - 0x4000) / 4097          ← 当日大盘气氛，全场共用
 * for 每支股票:
 *   开盘 = 昨收
 *   if (f6)        趋势 = 0                  ← 该股当日不动
 *   elif (新闻标记) 趋势 = ±10
 *   else:
 *     冲击 = (rand() - 0x4000) / 1171
 *     趋势 = 冲击 × 波动系数 + 昨日趋势        ← ★ 趋势有惯性，不是每日重置
 *     趋势 = drift + 趋势
 *     趋势 = 均值回归(趋势, 开盘, 参考价)
 *   趋势 = clamp(趋势, ±10)
 *   收盘 = 落档(开盘, 趋势)
 *   历史[股][日] = 收盘
 * 日 = (日 + 1) % 144
 * 大盘指数 = trunc(Σ收盘 × 10)
 * ```
 *
 * ★ 两点容易看漏、但决定了整条曲线的形状：
 *   1. **趋势是累加的**（`f28 = shock*vol + f28`），所以行情会走出连续的
 *      上升／下降段，而不是白噪声。
 *   2. **参考价优先取对应企业的资产额 ÷ 10000**，没有企业才退回初始股价。
 *      这就是「买下地图上的企业会拉抬对应股票」的机制来源。
 */
export function tickStockMarket(
  market: StockMarketState,
  rng: WatcomRng,
  commercialValue: CommercialValueLookup = () => null,
): StockMarketState {
  // @source call rand / sub eax,0x4000 / fild / fdiv [0x463fc4]
  const drift = Math.fround((rng.next() - RAND_MIDPOINT) / DRIFT_DIVISOR);

  const stocks: StockState[] = [];
  const history = market.history.map((h) => [...h]);
  let total = 0;

  for (let i = 0; i < market.stocks.length; i++) {
    const prev = market.stocks[i]!;
    // @source loc_00429470: f16 = f20（昨收成为今日基准）
    const openPrice = prev.price;
    let trend: number;
    let shock = prev.shock;

    if (prev.f6 !== 0) {
      // @source `cmp byte [+6], 0 / jne` → 趋势清零，直接落档
      trend = 0;
    } else if (prev.newsFlag !== 0) {
      trend = newsTrend(prev.newsFlag);
    } else {
      shock = Math.fround((rng.next() - RAND_MIDPOINT) / SHOCK_DIVISOR);
      // @source fmul [+24] / fadd [+28] —— ★ 叠加在昨日趋势上
      trend = Math.fround(Math.fround(shock * prev.volatility) + prev.trend);
      // @source fld [0x4990ec] / fadd [+28]
      trend = Math.fround(drift + trend);

      const com = prev.commercialIndex !== 0 ? commercialValue(prev.commercialIndex) : null;
      const reference =
        com !== null ? Math.fround(com / COMMERCIAL_VALUE_DIVISOR) : prev.basePrice;
      trend = meanRevert(trend, openPrice, reference, com !== null);
    }

    trend = clampTrend(trend);
    const price = applyPriceTick(openPrice, trend);

    // @source mov [edx + eax*4 + 0x497328], ecx
    const row = history[i];
    if (row !== undefined) row[market.day] = price;
    total = Math.fround(total + price);

    stocks.push({ ...prev, openPrice, trend, shock, price });
  }

  // @source lea ecx,[eax+1] / cmp ecx,0x90 / 归零
  const day = (market.day + 1) % HISTORY_DAYS;
  // @source fmul [0x463fec] / __round_toward_zero / fistp [0x499078]
  const index = Math.trunc(Math.fround(total * INDEX_SCALE));

  return { stocks, day, history, index };
}

// ============================================================
//  新闻即时改价
// ============================================================

/**
 * 新闻事件当场改写股价。
 *
 * @source fcn_00429040，7 处调用点（新闻 28 等）。
 *   参数 `stockId` 为 **1 基**；传 0 表示「全部 12 支」。
 *
 * ⚠️ 它写的是**当日已经收过的盘**：历史下标取 `day - 1`（为负则回绕到 143），
 *   即覆盖刚刚记下的那一笔，而不是新开一天。
 *   `0042905b` 的 `dec edi / test edi,edi / jge` 就是这个回绕。
 *
 * ⚠️ **只对 `newsFlag` 非 0 的股票生效**——没有标记的直接跳过（`test dl,dl / je`）。
 *   单支与全体两条分支的算法完全一致，不存在「整体利多」这种模式：
 *   全体分支里那个看着像参数的 `ebp` 常量也是 +10，与单支分支相同。
 */
export function applyStockNews(market: StockMarketState, stockId: number): StockMarketState {
  // @source mov edi, [0x499100] / dec edi / jge / mov edi, 0x8f
  const slot = market.day - 1 >= 0 ? market.day - 1 : HISTORY_DAYS - 1;

  const stocks = [...market.stocks];
  const history = market.history.map((h) => [...h]);

  const touch = (i: number): void => {
    const s = stocks[i];
    // @source test dl,dl / je → 没有新闻标记的股票原样不动
    if (s === undefined || s.newsFlag === 0) return;
    // @source test dl, 0xf0 / je → 低半字节即利空
    const trend = newsTrend(s.newsFlag);
    const price = applyPriceTick(s.openPrice, trend);
    stocks[i] = { ...s, trend, price };
    const row = history[i];
    if (row !== undefined) row[slot] = price;
  };

  if (stockId !== 0) {
    // @source test esi,esi / je → 非 0 走单支分支，下标 = stockId - 1
    touch(stockId - 1);
  } else {
    for (let i = 0; i < stocks.length; i++) touch(i);
  }

  return { ...market, stocks, history };
}

// ============================================================
//  每日倒数
// ============================================================

/**
 * 把各股的「停牌天数」与「新闻天数」各减一天。
 *
 * @source 日期推进 VA 0x0041cff9 起的 12 次循环：
 * ```asm
 * ch = [i*36 + 0x496986]          ; f6
 * if (ch) [i*36 + 0x496986] = ch - 1
 * dh = [i*36 + 0x496987]          ; newsFlag
 * if (dh == 0) 下一支
 * if (dh & 0xf0) [ ... ] = dh - 0x10      ; ★ 高半字节减一
 * dl = [i*36 + 0x496987]
 * if (dl & 0x0f) [ ... ] = dl - 1         ; ★ 低半字节减一
 * ```
 *
 * ★ 这条循环揭穿了 `newsFlag` 的真面目：它**不是标志位，是两个 4 位计数器**——
 *   高半字节 = 利多还剩几天，低半字节 = 利空还剩几天，每天各减一。
 *   `tickStockMarket` 里那句 `(newsFlag & 0xf0) ? +10 : -10`
 *   因此读作「利多期未过就按利多算，否则按利空算」。
 *
 * ⚠️ 两个半字节是**独立**递减的：同一支股票可以同时背着利多和利空
 *   （原版没有任何互斥处理），此时利多优先。
 */
export function tickStockCountdowns(market: StockMarketState): StockMarketState {
  const stocks = market.stocks.map((s) => {
    // @source test ch,ch / je → 为 0 就不动
    const f6 = s.f6 !== 0 ? s.f6 - 1 : 0;
    let newsFlag = s.newsFlag;
    if (newsFlag !== 0) {
      if ((newsFlag & 0xf0) !== 0) newsFlag -= 0x10;
      if ((newsFlag & 0x0f) !== 0) newsFlag -= 1;
    }
    return { ...s, f6, newsFlag };
  });
  return { ...market, stocks };
}

// ============================================================
//  流通股数的每日扰动
// ============================================================

/**
 * 重算各股的 `f10`。
 *
 * @source fcn_0042915a，由开局（`00407dfe`）与回合推进（`0041c868`）调用：
 * ```
 * for 每支股票:
 *   if (shares <= 1000)  f10 = shares            ← 小盘股原样
 *   else                 f10 = trunc(shares × (rand()%2000 + 1000) / 10000)
 * ```
 *
 * ⚠️ `rand() % 2000 + 1000` 落在 1000..2999，除以 10000 即 **10%~30%**。
 *   故 f10 是「当日可成交量」而非总股本——这解释了它为何与 shares
 *   同步增减却又每日重算。
 */
export function refreshTradableShares(market: StockMarketState, rng: WatcomRng): StockMarketState {
  const stocks = market.stocks.map((s) => {
    // @source cmp dx, 0x3e8 / jbe → 不超过 1000 就原样照抄
    if (s.shares <= 1000) return { ...s, f10: s.shares };
    const r = (rng.next() % 2000) + 1000;
    return { ...s, f10: Math.trunc(Math.fround(s.shares * Math.fround(r / 10000))) };
  });
  return { ...market, stocks };
}

// ============================================================
//  漲停 / 跌停 与 休市日
// ============================================================

/**
 * 漲跌停幅度 ±10%。
 * @source `fcn_004295ea`：`0x428ec5(開盤, +10.0f)` / `0x428ec5(開盤, −10.0f)`
 *   —— 常量 `0x41200000` = 10.0、`0xc1200000` = −10.0。
 *   门槛本身就是本文件的 `applyPriceTick(開盤, ±10)`，含升降单位落档。
 */
export const LIMIT_PCT = 10;

/**
 * 一支股票现在的状态。
 *
 * @source `fcn_004295ea(股票)`，比的是 `+0x1c` 現價 与 `+0x18` 開盤：
 * ```
 * 現價 > 開盤：現價 >= 落档(開盤 × 1.10) → 1 漲停，否则 0 上涨
 * 現價 < 開盤：現價 <= 落档(開盤 × 0.90) → 3 跌停，否则 2 下跌
 * 相等 → 4 持平
 * ```
 * 柜台：**漲停無法買進**（0x0042af13 `cmp eax, 1`）、**跌停無法賣出**（0x0042b046 `cmp eax, 3`）。
 */
export const STOCK_STATUS = { up: 0, limitUp: 1, down: 2, limitDown: 3, flat: 4 } as const;

export function stockStatus(openPrice: number, price: number): number {
  // 没有開盤價可比（例如手工造的状态）就当持平 —— 原版 +0x18 永远是个真价，
  // 这条只为不让缺字段的测试状态被当成「漲停」
  if (!(openPrice > 0)) return STOCK_STATUS.flat;
  if (price > openPrice) {
    return price >= applyPriceTick(openPrice, LIMIT_PCT) ? STOCK_STATUS.limitUp : STOCK_STATUS.up;
  }
  if (price < openPrice) {
    return price <= applyPriceTick(openPrice, -LIMIT_PCT) ? STOCK_STATUS.limitDown : STOCK_STATUS.down;
  }
  return STOCK_STATUS.flat;
}

export function isLimitUp(openPrice: number, price: number): boolean {
  return stockStatus(openPrice, price) === STOCK_STATUS.limitUp;
}
export function isLimitDown(openPrice: number, price: number): boolean {
  return stockStatus(openPrice, price) === STOCK_STATUS.limitDown;
}

/**
 * 今天股市开不开。
 *
 * @source `fcn_00428d01`：`[0x4990dc] != 0` 或 `fcn_004523d5(今天) == 1` → 休市。
 *   `fcn_004523d5` 逐行对过：先 `0x4520a6` 算星期（= `weekdayOf`，星期日→休），
 *   再 `0x4521f0` 查節日表 `0x0047ff4a` 的首字节 —— **就是 `isHoliday`**。
 *   `[0x4990dc]` 只在開局清零与每日递减处被写，没有事件把它置非 0，故不建模。
 *
 * 休市日：柜台不能买卖（0x0042afe6 那一路直接退），AI 不进场（闸二），
 * **且当日不走行情**（`0x4291d6` 开头 `call 0x428d01 / cmp eax, 1 / je 结束`）。
 */
export function marketOpenOn(globalMapId: number, year: number, month: number, day: number): boolean {
  return !isHoliday(globalMapId, year, month, day);
}

// ============================================================
//  電腦賣股的兩道「還款壓力」判据 @source 0x0042c7bc..0x0042c7f6 / 0x0042d0ae..0x0042d0de
// ============================================================

/** 距還款日不超过这么多天就算有壓力 @source `cmp eax, 6 / jg` */
export const SELL_LOAN_DUE_DAYS = 6;
/** 賣到 現金+存款 ≥ 貸款 × 1.1 才停 @source `fmul [0x464234]` = 1.1 */
export const SELL_LOAN_COVER_RATIO = 1.1;

/**
 * 有還款壓力：距還款日 ≤ 6 天且 現金+存款 < 貸款。此时電腦不掷 1/3 的闸、逢股必賣。
 * `loanDueDate` 为 0 时（没贷款）原版照算日期差，但 貸款 = 0 使第二条永远不成立。
 */
export function loanSellPressure(
  p: { cash: number; moneyInBank: number; loan: number; loanDueDate: number },
  today: { year: number; month: number; day: number },
): boolean {
  if (p.loan <= 0 || p.loanDueDate === 0) return false;
  const y = p.loanDueDate >>> 16;
  const m = (p.loanDueDate >>> 8) & 0xff;
  const d = p.loanDueDate & 0xff;
  const daysLeft = dayNumberSince1998(y, m, d) - dayNumberSince1998(today.year, today.month, today.day);
  return daysLeft <= SELL_LOAN_DUE_DAYS && p.cash + p.moneyInBank < p.loan;
}

/** 壓力下賣完一支后还要不要继续賣：現金+存款 < 貸款 × 1.1 就继续 @source 0x0042d0cd */
export function loanStillUncovered(p: { cash: number; moneyInBank: number; loan: number }): boolean {
  return p.cash + p.moneyInBank < p.loan * SELL_LOAN_COVER_RATIO;
}
