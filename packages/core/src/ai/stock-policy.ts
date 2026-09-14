/*
 * AI 炒股
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 入口 VA 0x0042bf30，三道闸 + 一条预算公式：
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
 * ⚠️ **买哪一支是我们自己定的**。原版从 0x0042c075 起是一段 ~700 行的
 *   多指标打分（拿每支股票的 `+0x24`(資產額/10000)、`+0x2c`(累積盈餘) 等
 *   跟物价指数的若干倍去比，命中一条加一分），那段没翻译。本引擎挑
 *   **相对参考价最便宜**的那一支（`basePrice / price` 最大）——
 *   `basePrice` 本来就是本引擎股价模型里的均值回归锚（见 places/stock.ts），
 *   所以「低于锚价就买」是自洽的，但**不保证与原版一致**。
 *   记在 known-deviations 的 Q-AI-1。
 *
 * ⚠️ 闸二（股市不开门）也没做：休市规则未解，见 Q-STOCK-1。
 */

import type { Action } from '../state/actions.ts';
import type { GameState } from '../state/types.ts';
import { stockBudget } from './personality.ts';
import { dayNumberSince1998 } from '../places/calendar.ts';

/** 打分时用的定标 —— 只为把比值变成整数比较，取多大都不影响排序 */
const SCORE_SCALE = 1 << 16;

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

/**
 * AI 这一步要不要买股票；不买返回 `null`。
 *
 * 三道闸里能做的两道都在这儿，第三道（休市）见文件头。
 */
export function decideStockTrade(state: GameState): Action | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;

  // @source 闸一
  if (me.stockRatio === 0) return null;
  // @source 闸三
  if (me.loanDueDate !== 0 && daysUntil(state, me.loanDueDate) < STOCK_LOAN_DUE_GUARD_DAYS) {
    return null;
  }

  const owned = holdingsValue(state, state.currentPlayer);
  const budget = stockBudget(owned, me.cash, me.moneyInBank, me.stockRatio);
  if (budget <= 0) return null;

  // ⚠️ 挑哪一支是我们的做法 —— 原版那段打分没翻译（Q-AI-1）。
  //   取相对参考价最便宜的一支：`basePrice / price` 越大越低估。
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < state.market.stocks.length; i++) {
    const s = state.market.stocks[i];
    if (s === undefined) continue;
    if (s.price <= 0 || s.shares <= 0) continue;
    const shares = Math.floor(budget / s.price);
    if (shares <= 0) continue;
    // ⚠️ 这是个**比值**不是金额，C-DET-3 那条 lint 管不了用途，
    //   所以改成「参考价 × 定标 ÷ 现价」再取整，既避开裸除法也不丢精度
    const score = Math.trunc((s.basePrice * SCORE_SCALE) / s.price);
    if (best === -1 || score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (best === -1) return null;

  const stock = state.market.stocks[best]!;
  // 买不到超过流通量的股数
  const shares = Math.min(Math.floor(budget / stock.price), stock.shares);
  if (shares <= 0) return null;
  return { type: 'buyStock', stock: best, shares };
}
