/*
 * 整屏 UI 的登记表
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一份是**唯一**把各屏挂进 `main.ts` 的地方 —— 一屏一行，只加不改。
 *   顺序 = 优先级：`active()` 为真的**第一屏**接管整屏。
 *
 * ⚠️ 新增一屏：写好 `xxx-screen.ts`（导出 `UiScreen`，契约见 `ui-screen.ts`），
 *   在这里加一行 import 与一项登记。**不要往 `main.ts` 里塞这一屏的东西。**
 *
 * 已在别处接了线的整屏（历史原因，不在此表）：
 * 個人資產表（`asset-sheet.ts`）、道具/卡片欄（`inventory.ts`）、
 * 設定/開局/託管AI（`options.ts` / `setup.ts` / `ai-settings.ts`）、
 * 存讀檔（`saveload.ts`）、股市（`stock-screen.ts`）、
 * 銀行 ATM／貸款（`bank-screen.ts` / `bank-loan.ts`）、
 * 百貨公司（`shop-screen.ts`）、監獄/醫院（`bail-screen.ts`）。
 */

import type { UiScreen } from './ui-screen.ts';
import { boardScreen } from './board-screen.ts';
import { auctionScreen } from './auction-screen.ts';
import { lotteryScreen } from './lottery-screen.ts';
import { lotteryDrawScreen } from './lottery-draw-screen.ts';
import { magicScreen } from './magic-screen.ts';
import { wheelScreen } from './wheel-screen.ts';
import { researchScreen } from './research-screen.ts';
import { monthlyScreen } from './monthly-screen.ts';
import { minigameScreen } from './minigame-screen.ts';
import { helpScreen } from './help-screen.ts';
import { sharesScreen } from './shares-screen.ts';

export const SCREENS: readonly UiScreen[] = [
  // 演出类（事件起播）放前面：它们一旦在播就压住底下的一切
  //
  // ★ `sharesScreen`（每月 15 日的上市公司分紅屏）排在最前 —— 原版在那一天是
  //   **先分红屏（VA 0x0041d08f `call 0x42ba97`）、后樂透開獎（VA 0x0041d094
  //   `call 0x431712`）**，两屏都在同一个「日期跨到 15 日」的 action 里起播。
  sharesScreen,
  lotteryDrawScreen,
  monthlyScreen,
  magicScreen,
  wheelScreen,
  // 待决交互类
  boardScreen,
  auctionScreen,
  lotteryScreen,
  researchScreen,
  minigameScreen,
  // 工具列/熱鍵打开的
  helpScreen,
];
