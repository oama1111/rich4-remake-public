/*
 * 輔助說明屏（工具列 #1「遊戲百科」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-045）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * 素材在 `help.mkf`（整屏页图），翻页浏览 + 关闭。
 * 入口是工具列那颗「遊戲百科／輔助說明」，也有熱鍵 `HOTKEY.help`（= 24）。
 *
 * 先把 `help.mkf` 加进 `assets.ts` 的 `ARCHIVES`，再照 `hitSheetBtn` 那一套
 * 写「上一页 / 下一页 / 关闭」三颗钮的命中与翻页夹取。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const helpScreen: UiScreen = {
  id: 'help',
  active: () => false,
  draw: () => undefined,
};
