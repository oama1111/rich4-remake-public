/*
 * 魔法屋屏（外圈 12 功能悬停高亮 + 中央文字 + 音）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-037）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * 底图 `Panel.mkf` **#18**（35 张子图）。版式见 `docs/original-ui.md` 的 U-9：
 * 鼠标划过外圈的 12 个选项会高亮 + 中间出文字提示 + 提示音。
 *
 * ⚠️ 魔法屋在 core 里是**即时结算**（`state/reduce.ts` 的 `runMagicHouse`：
 *   两个转盘都是自己转的，玩家一次也插不上手）—— 所以本屏是**回放这次结果**的
 *   演出：转盘落点 + 被点到的人 + 效果文字。12 个功能的文案在
 *   `data/magic-house.ts`，效果派发在 `places/magic-house.ts`。
 *   用 `event(before, after, env)` 察觉。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const magicScreen: UiScreen = {
  id: 'magic',
  active: () => false,
  draw: () => undefined,
};
