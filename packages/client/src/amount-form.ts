/*
 * 「同一个计算器」的那些壳 —— 通用填数页（`AmountPage`）的**界面壳**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版全游戏只有一个填数窗：`fcn_00453544`（VA 0x00453544）。它的调用点
 * 在整份 exe 里**只有 12 处**（`tools/disasm.py callers 0x00453544`）：
 *
 * | # | 调用点 VA | 哪一屏的哪一处 |
 * |---|---|---|
 * | 1 | 0x0041d25b | 上市企業落点「是否認購股份」`fcn_0041d1a9` |
 * | 2 | 0x0042af92 | 股市柜台 **買進**（`fcn_0042aaff` 的 `loc_0042af89`）|
 * | 3 | 0x0042b07e | 股市柜台 **賣出**（`fcn_0042aaff` 的 `loc_0042b05a`）|
 * | 4 | 0x00434671 | 特別融資 **借**（`fcn_00434492`）|
 * | 5 | 0x004346c2 | 特別融資 **還**（`fcn_00434492`）|
 * | 6 | 0x00435245 | 貸款屏 **借**（`fcn_00435062`）|
 * | 7 | 0x00435367 | 貸款屏 **還**（`fcn_00435062`）|
 * | 8 | 0x00425ee9 | 個人資產表 **賣股票**（`fcn_004258c1`）|
 * | 9 | 0x00425f6b | 個人資產表 **賣股票**（`fcn_004258c1`，另一支）|
 * | 10 | 0x00426631 | 個人資產表 **賣地產**（`fcn_0042608f`）|
 * | 11 | 0x00426b35 | 個人資產表 **賣道具**（`fcn_004267a4`）|
 * | 12 | 0x00426f57 | 個人資產表 **賣卡片**（`fcn_00426c2e`）|
 *
 * 「12 处之外还输数字」的几屏在原版是**各自的专窗**，不是这一个 ——
 * 銀行 ATM 的数字键盘（`Panel.mkf` #24）、拍賣的七颗加价钮、樂透的号格、
 * 設定屏的日期頁、開局設定的人数。它们**不许**被并进来（见
 * `docs/deviations/Q-UI-7.md` 的清单）。
 *
 * 本模块只放「把某一屏要填的数翻成 `InteractionUi`」这类**壳子**：
 * 壳子本身不含规则（C-ARC-2），它只交出 `amount` 那一项，
 * 版式/命中一律走 `dialog.ts` 的 `layoutDialog` / `hitDialog` / `drawDialog`。
 */

import type { Action } from '@rich4/core';
import type { InteractionUi } from './interactions.ts';

/** 股市柜台那一扇填数页要填的东西 @source `fcn_0042aaff` 的 `[0x48c2eb]` */
export interface StockCounterAmount {
  readonly kind: 'buy' | 'sell';
  /** 行号（0 基）*/
  readonly stock: number;
  /**
   * 上限 —— 買進 = `min(流通量, 存款 ÷ 股價)`（@source `loc_0042af30`）、
   * 賣出 = 持有股數（@source `loc_0042b05a` 的 `player_stocks`）。
   * ★ 规则在 core / `stock-screen.ts` 算好，这里**只负责交给窗子**。
   */
  readonly max: number;
}

/**
 * 股市柜台的填数页 —— 与銀行、公佈欄、上市企業认購**同一扇窗**
 * （`fcn_00453544`，@source 0x0042af92 / 0x0042b07e）。
 *
 * 形状刻意与 `interactions.ts` 各条 `amount` 一模一样：整条交互只给
 * `choices[i].amount`，自己**不画**任何版式 —— 那正是「同一个计算器」的判据。
 *
 * @param a    買／賣与上限（规则算好的）
 * @param name 股票名（core 的状态里不带名字，在 `@rich4/data` 的表里）
 */
export function stockAmountForm(a: StockCounterAmount, name: string): InteractionUi {
  const label = a.kind === 'buy' ? '買進股數' : '賣出股數';
  const fill = (n: number): Action =>
    a.kind === 'buy'
      ? { type: 'buyStock', stock: a.stock, shares: n }
      : { type: 'sellStock', stock: a.stock, shares: n };
  return {
    title: '股市',
    detail: `${name}\n${a.kind === 'buy' ? '買進' : '賣出'}（上限 ${a.max.toLocaleString('en-US')} 股）`,
    choices: [{ label, amount: { label, max: a.max, step: 1, fill }, action: fill(a.max) }],
  };
}
