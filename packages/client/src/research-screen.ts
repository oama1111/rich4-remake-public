/*
 * 研究所选項目屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-040）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * `pending.kind === 'research'` 时接管。`pending` 里已有
 * `facilityId / name / level / choices` —— 列出 1..level 个项目（名字 = 研发出的道具名），
 * 点中 dispatch `research`（带 `project`）。
 *
 * 触发点：業主停在自己的研究所上（@source VA 0x0041b0b3）；天数固定 5（P0-5）。
 * ⚠️ 素材号待认 —— 找到之前先照 `Panel.mkf` 逐张导出认用途，别猜。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const researchScreen: UiScreen = {
  id: 'research',
  active: () => false,
  draw: () => undefined,
};
