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
import { truncTowardZero } from './rounding.ts';

/**
 * 税率／红利率。
 * @source 各事件的 `fmul qword [常量]`：
 *   所得稅 0x004655a4、地價稅 0x004655cc、證交稅 0x004655f4 均为 **0.05**；
 *   儲金紅利 0x00465734 为 **0.1**。
 *
 * ⚠️ 与查税卡（card 26）的 `TAX_RATE = 0.2` **不是一回事**：
 * 那张卡按 20% 收且用**整数截断**，这里的新聞税按 5% 收，
 * 走 x87 的 `__round_toward_zero`（VA 0x457dbc）—— 即**向零截断**。
 * 两套机制各自照搬，不要合并。
 */
export const NEWS_TAX_RATE = 0.05;
export const BANK_DIVIDEND_RATE = 0.1;

/**
 * 税率乘法之后的取整 —— 原版是 `call 0x00457dbc`（`__round_toward_zero`）。
 *
 * @source 四个税额点都是 `fild 基数 / fmul qword [税率常量] / call 0x457dbc / fistp`：
 *   所得稅 0x00449cfa、地價稅 0x00449f28、證交稅 0x0044a122、儲金紅利 0x0044af50。
 *
 * ★ `0x457dbc` 是**向零截断**（`fnstcw` → `mov byte [esp+1],0x1f` → `fldcw`
 *   ⇒ RC = `11` → `frndint`），**不是** x87 默认的就近取偶。
 *   见 `rules/rounding.ts` 的完整判据。
 *
 * ⚠️ 这里**曾经**写成「就近取偶（banker's rounding）」，那是 T-034 那一轮的误读；
 *   两者在**恰好 .5** 时差 1：现金 150 的 5% = 7.5，原版给 7，就近取偶给 8。
 *
 * ⚠️ 税额出现恰好 .5 的情形需要 `cash` 是 `20k+10`（如 10 → 0.5、30 → 1.5、
 *   150 → 7.5），实战中并不罕见，故必须照 exe 截断。
 *
 * @param base 已含（或未含，视调用点而定）物价指数的**整数**基数
 */
export function percentageOf(base: number, rate: number): number {
  return truncTowardZero(base * rate);
}

/** 所得稅：现金的 5% @source 0x00449cee `fild [player+0x1c]` / 0x00449cf4 `fmul 0.05` / 0x00449cfa `call 0x457dbc` */
export function incomeTax(p: Player): number {
  return percentageOf(p.cash, NEWS_TAX_RATE);
}

/** 儲金紅利：存款的 10% @source 0x0044af44 `fild [player+0x20]` / 0x0044af4a `fmul 0.1` / 0x0044af50 `call 0x457dbc` */
export function bankDividend(p: Player): number {
  return percentageOf(p.moneyInBank, BANK_DIVIDEND_RATE);
}

/**
 * 地产估值 —— 地價稅的基数，**含**物价指数。
 *
 * @source VA 0x00449e9b..0x00449eb1（住宅地）与 0x00449ef7..0x00449f0b（設施）：
 * ```asm
 * 00449e9b  bx  = word [地产 + 0x1e]     ; 住宅房价
 * 00449ea3  cl  = byte [地产 + 0x1a]     ; 等级
 * 00449ea6  imul ecx, ebx                ; 房价 × 等级
 * 00449eab  bx  = word [地产 + 0x1c]     ; 住宅地价
 * 00449eaf  add ecx, ebx                 ; 地价 + 房价×等级
 * 00449eb1  add [esp + esi*4 + 0x94], ecx ; 逐项按玩家累加
 * …（設施那支同构：房价 +0x24、地价 +0x22、等级 +0x1a）
 * ```
 *
 * ⚠️ **原版把「× 物价指数」放在 `× 0.05` 并截断之后**（0x00449f41
 *   `imul eax, [0x4990e8]`），本函数却先乘了物价指数（`propertyValue` 的
 *   末行）。两条路在物价指数 ≠ 1 时会给不同的税（例：原值 30、指数 3
 *   ⇒ 原版 `trunc(1.5)×3 = 3`，本式 `trunc(4.5) = 4`）。这一条**不在**
 *   本轮取整订正范围内（要动公开签名），已如实登记
 *   `docs/deviations/Q-NUM-1.md` 的 D-QNUM-2。
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

/**
 * 地價稅：地产原值的 5%，向零截断。
 *
 * @source 0x00449f1b `fild 原值` / 0x00449f22 `fmul 0.05` / 0x00449f28
 *   `call 0x457dbc` / 0x00449f41 `imul eax, [0x4990e8]`（×物价指数）。
 *
 * ⚠️ 与 `propertyValue` 的差别（指数乘在截断前还是后）见该函数的注释与
 *   `Q-NUM-1.md` 的 D-QNUM-2。
 */
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
 * @source 0x0044a0e5：`fild [持股数] / fmul dword [股价] / fadd 累计`
 *
 * ⚠️ 原版是**单精度**累加（`fadd dword [esp+…]` / `fstp dword`），本式用的是
 *   JS 双精度；股价为常规整数时结果一致，行情带小数时可能差到最低位。
 *   已登记 `Q-NUM-1.md` 的 D-QNUM-3。
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

/**
 * 證交稅：持股市值的 5%，向零截断。
 *
 * @source 0x0044a115 `fld 市值` / 0x0044a11c `fmul 0.05` / 0x0044a122
 *   `call 0x457dbc` / 0x0044a13b `imul eax, [0x4990e8]`（×物价指数）。
 *
 * ⚠️ 与 `propertyTax` 一样，原版的物价指数乘在**截断之后**；本函数当前
 *   没有物价指数入参，等于按指数 1 算。属于同一族问题，见 D-QNUM-2。
 */
export function stockTax(
  holdings: readonly number[],
  prices: readonly number[],
): number {
  return percentageOf(stockValue(holdings, prices), NEWS_TAX_RATE);
}
