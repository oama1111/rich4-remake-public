/*
 * 按比例计算的事件金额（税金与红利）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 新聞事件里有四条不是固定金额，而是按玩家资产的某个比例算：
 *
 * | 事件 | 基数 | 比例 |
 * |---|---|---|
 * | news[11] 所得稅 | **现金**（+0x1c） | 5% |
 * | news[12] 地價稅 | 名下地产估值 | 5% |
 * | news[13] 證交稅 | 持股市值 | 5% |
 * | news[23] 儲金紅利 | **存款**（+0x20） | 10% |
 *
 * ★ 「所得稅」的基数是**现金余额**，不是收入——名字容易误导，
 *   但 `fild dword [player + 0x1c]` 说得很清楚。
 */

import type { Player } from '../state/types.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';

/**
 * 税率／红利率。
 * @source 各事件的 `fmul qword [常量]`：
 *   所得稅 0x004655a4、地價稅 0x004655cc、證交稅 0x004655f4 均为 **0.05**；
 *   儲金紅利 0x00465734 为 **0.1**。
 *
 * ⚠️ 与查税卡（card 26）的 `TAX_RATE = 0.2` **不是一回事**：
 * 那张卡按 20% 收且用**整数截断**，这里的新聞税按 5% 收且走
 * x87 的**就近取偶**。两套机制各自照搬，不要合并。
 */
export const NEWS_TAX_RATE = 0.05;
export const BANK_DIVIDEND_RATE = 0.1;

/**
 * x87 的取整。
 *
 * @source 每处 `fmul` 之后都紧跟 `call 0x00457dbc` 再 `fistp`。
 * 该辅助函数按 x87 的**当前舍入模式**取整，默认是**就近舍入、
 * 遇 .5 取偶**（banker's rounding），与 JS 的 `Math.round`
 * （总是向上）在 .5 处不同。
 *
 * ⚠️ 税额出现恰好 .5 的情形需要 `cash` 是 10 的奇数倍（如 150 → 7.5），
 * 实战中并不罕见，故此处如实复刻就近取偶而不是图省事用 Math.round。
 */
export function x87Round(v: number): number {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // 恰好 .5 → 取偶
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 按比例取整后的金额 */
export function percentageOf(base: number, rate: number): number {
  return x87Round(base * rate);
}

/** 所得稅：现金的 5% @source fild [player+0x1c] / fmul 0.05 */
export function incomeTax(p: Player): number {
  return percentageOf(p.cash, NEWS_TAX_RATE);
}

/** 儲金紅利：存款的 10% @source fild [player+0x20] / fmul 0.1 */
export function bankDividend(p: Player): number {
  return percentageOf(p.moneyInBank, BANK_DIVIDEND_RATE);
}

/**
 * 地产估值 —— 地價稅的基数。
 *
 * @source VA 0x00449ef7：
 * ```asm
 * cx  = word [地产 + 0x24]     ; 房价
 * imul ecx, eax                ; × 等级
 * ax  = word [地产 + 0x22]     ; 地价
 * add eax, ecx                 ; 地价 + 房价×等级
 * …逐项累加后 imul eax, ebp    ; × 物价指数
 * ```
 *
 * 与 `rules/wealth.ts` 的总资产估值同式，但**只取地产部分**。
 */
export function propertyValue(
  playerIndex: number,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
  priceIndex: number,
): number {
  const ownerId = playerIndex + 1;
  let sum = 0;
  for (const l of lands) {
    if (l.owner !== ownerId) continue;
    sum += l.landPrice + l.housePrice * l.level;
  }
  for (const f of facilities) {
    if (f.owner !== ownerId) continue;
    sum += f.landPrice + f.housePrice * f.level;
  }
  return sum * priceIndex;
}

/** 地價稅：地产估值的 5% */
export function propertyTax(
  playerIndex: number,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
  priceIndex: number,
): number {
  return percentageOf(propertyValue(playerIndex, lands, facilities, priceIndex), NEWS_TAX_RATE);
}

/**
 * 持股市值 —— 證交稅的基数。
 * @source VA 0x0044a0e5：`fild [持股数] / fmul [股价] / fadd 累计`
 */
export function stockValue(
  holdings: readonly number[],
  prices: readonly number[],
): number {
  let sum = 0;
  for (let i = 0; i < holdings.length; i++) {
    sum += (holdings[i] ?? 0) * (prices[i] ?? 0);
  }
  return sum;
}

/** 證交稅：持股市值的 5% */
export function stockTax(
  holdings: readonly number[],
  prices: readonly number[],
): number {
  return percentageOf(stockValue(holdings, prices), NEWS_TAX_RATE);
}
