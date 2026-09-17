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
import { eventBoxScreen } from './event-box-screen.ts';
import { wheelScreen } from './wheel-screen.ts';
import { godSlotScreen } from './god-slot.ts';
import { researchScreen } from './research-screen.ts';
import { monthlyScreen } from './monthly-screen.ts';
import { minigameScreen } from './minigame-screen.ts';
import { helpScreen } from './help-screen.ts';
import { bigMapScreen } from './big-map-screen.ts';
import { sharesScreen } from './shares-screen.ts';
import { facilityPickerScreen } from './facility-picker.ts';
import { stealPickerScreen } from './steal-picker.ts';

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
  // ★ 事件提示框（新聞 / 命運 / 抽卡）排在 `magicScreen` **之后** —— 魔法屋的
  //   「得一張卡片」与卡片格都会让手牌变长，两屏会从同一次 action 各起一段；
  //   魔法屋那一次该由魔法屋屏演（见 `event-box-screen.ts` 头注释）。
  eventBoxScreen,
  wheelScreen,
  // ★ 「神明附身」那一刻的老虎机窗（Q-GOD-1）：与转盘同一类**演出**屏，
  //   由 `event(before, after)` diff 出「刚附身 + 四种金額型」时起播。
  godSlotScreen,
  // ★ 「請選擇設施類別」（Q-TOOL-4）：真人盖**等级 0 的設施**时要先选种类
  //   （原版 `fcn_00440aac`，一扇盖在棋盘上的浮窗）。它由主机的拾取/加蓋流程
  //   主动 `openFacilityPicker()` 打开，`active()` 只在开窗期间为真。
  facilityPickerScreen,
  // ★ 「从对方手里挑一件」（T-053）：搶奪卡（13）的真人路径。原版是
  //   `fcn_0044192a` 里那扇**模态浮窗**（`Panel.mkf` 11 的卡片欄 + 道具欄），
  //   由主机的「目标拾取」拾到人之后主动 `openStealPicker()` 打开。
  //   ★ 与施設类别窗同一类：`windowed: true`、`active()` 只在开窗期间为真。
  stealPickerScreen,
  // 待决交互类
  boardScreen,
  auctionScreen,
  lotteryScreen,
  researchScreen,
  minigameScreen,
  // 工具列/熱鍵打开的
  helpScreen,
  // 大地圖彈窗（T-086）：一扇 **400×400 贴 (20,60) 的浮窗**，不是缩放镜头。
  // ★ 放最后无妨 —— 它与别的屏不会同时开（模态期间键盘全被它吞掉，
  //   见 big-map-screen.ts 的 `hotkey`）。
  bigMapScreen,
];
