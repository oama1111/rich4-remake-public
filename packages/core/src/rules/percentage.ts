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
 *
 * ★ 物价指数的**位置**（D-QNUM-2 已结案）：四条里只有地價稅 / 證交稅
 *   乘物价指数，而且都是**先 `trunc(基数 × 税率)`、再整数 `imul [0x4990e8]`**：
 *   ```asm
 *   00449f22  fmul  qword [0x4655cc]      ; 地價稅 × 0.05
 *   00449f28  call  0x457dbc             ; 向零截断
 *   00449f41  imul  eax, [0x4990e8]      ; ★ 截断之后才 × 物价指数
 *   0044a11c  fmul  qword [0x4655f4]      ; 證交稅 × 0.05
 *   0044a122  call  0x457dbc
 *   0044a13b  imul  eax, [0x4990e8]      ; ★ 同上
 *   ```
 *   所得稅（0x00449cee..0x00449d12）与儲金紅利（0x0044af44..0x0044af5c）
 *   **通篇没有** `[0x4990e8]`，故它们不随物价指数变——本模块照搬。
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
 * @param base **不含**物价指数的整数基数（原版 `fild`/`fld` 读到的就是它；
 *   物价指数一律在**本函数截断之后**才由调用方乘上去，见 D-QNUM-2）
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
 * 地产**原值** —— 地價稅的基数，★ **不含**物价指数。
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
 * ★ **本函数不含物价指数**：原版把这个累加和**直接**喂给 `fild`（0x00449f1b
 *   `fild dword [esp + ebx + 0x94]`），「× 物价指数」是**税算完之后**的
 *   `imul eax, [0x4990e8]`（0x00449f41）。故 `propertyTax = trunc(本值 × 0.05)
 *   × 物价指数`，指数乘在**截断之后**。
 *
 * ⚠️ 这里**曾经**把物价指数乘进末行（`sum * priceIndex`），导致
 *   `trunc(原值 × 指数 × 0.05)`——指数 ≠ 1 时与原版不同
 *   （例：原值 30、指数 3 ⇒ 原版 `trunc(1.5)×3 = 3`，旧式 `trunc(4.5) = 4`）。
 *   已按 exe 订正；判决过程见 `docs/deviations/Q-NUM-1.md` 的 D-QNUM-2。
 *
 * 与 `rules/wealth.ts` 的总资产估值同式，但**只取地产部分**、且原版那里
 * 同样不含物价指数（`calculatePlayerWealth` 无指数项）。
 */
export function propertyValue(
  playerIndex: number,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
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
  return sum;
}

/**
 * 地價稅：地产原值的 5%，**向零截断之后再**乘物价指数。
 *
 * @source 0x00449f1b `fild 原值` / 0x00449f22 `fmul 0.05` / 0x00449f28
 *   `call 0x457dbc` / 0x00449f2d `fistp` / 0x00449f3b `mov ebp, [0x4990e8]`
 *   / 0x00449f41 `imul eax, ebp`（×物价指数）。
 *
 * ★ 顺序：`trunc(原值 × 0.05) × 物价指数`。`fistp` 先把截断后的整数写回内存，
 *   之后才是整数 `imul`；指数 **不** 参与 `trunc` 里那一次浮点乘。
 */
export function propertyTax(
  playerIndex: number,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
  priceIndex: number,
): number {
  return percentageOf(propertyValue(playerIndex, lands, facilities), NEWS_TAX_RATE) * priceIndex;
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
 * 證交稅：持股市值的 5%，**向零截断之后再**乘物价指数。
 *
 * @source 0x0044a115 `fld 市值` / 0x0044a11c `fmul 0.05` / 0x0044a122
 *   `call 0x457dbc` / 0x0044a127 `fistp` / 0x0044a135 `mov edx, [0x4990e8]`
 *   / 0x0044a13b `imul eax, edx`（×物价指数）。
 *
 * ★ 与 `propertyTax` 同形：`trunc(市值 × 0.05) × 物价指数`。指数乘在截断之后，
 *   参数由调用方显式给出（旧签名没有它，等于按指数 1 算）。
 *   见 `Q-NUM-1.md` 的 D-QNUM-2。
 */
export function stockTax(
  holdings: readonly number[],
  prices: readonly number[],
  priceIndex: number,
): number {
  return percentageOf(stockValue(holdings, prices), NEWS_TAX_RATE) * priceIndex;
}
