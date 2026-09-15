/*
 * 每月結算 + 頒獎屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-041）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * 底图 `Panel.mkf` **#25**（83 张子图）。版式见 `docs/original-ui.md` 的 U-15。
 * 只读屏：列出各玩家这个月的收入/支出/利息/頒獎，确认后继续。
 *
 * 月結规则在 `core/rules/monthly.ts`。摘要若 core 没暴露，用
 * `event(before, after, env)` 对 diff 取，或在 core 加 `state.lastMonthly`（小改 + 测试）。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const monthlyScreen: UiScreen = {
  id: 'monthly',
  active: () => false,
  draw: () => undefined,
};
