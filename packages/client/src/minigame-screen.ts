/*
 * 三个小游戏：企鵝挖寶 / 七彩氣球 / 財神接金幣
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-042/043/044）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * `pending.kind === 'minigame'` 时接管，`pending.game` 是 6/7/8
 * （`SPECIAL_KIND.PENGUIN_DIG` / `BALLOON` / `GIFT_FROM_SKY`）。
 * 玩完 dispatch `minigameScore`；不玩送 `null`（core 会按 50..69 抽）。
 *
 * 底图：企鵝挖寶 = `Panel.mkf` **#80**、七彩氣球 = **#91**、
 * 財神接金幣 = **#22**（⚠️ 需求方 2026-09-15 确认玩法是「財神接金幣」，
 * 但**它对应哪个 specialKind 还没在 `rich4_small_games.asm` 里核过** ——
 * 先核，别照搬推断）。
 *
 * 玩法状态机全在 client（`places/minigame.ts` 只收分数）；随机数用本屏自己的
 * PRNG，**只有分数进 core** 才是确定性的边界（C-DET）。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const minigameScreen: UiScreen = {
  id: 'minigame',
  active: () => false,
  draw: () => undefined,
};
