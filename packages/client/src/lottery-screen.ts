/*
 * 樂透投注屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-035）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * `pending.kind === 'lottery'` 时接管整屏。底图 `Panel.mkf` **#12**（10 张子图）。
 * 号格：9 列 × 4 行，格距 64×48，从 **(30,271)** 起；命中
 * `col=(x-30)/64`、`row=(y-271)/48`、`index=row*9+col` @source VA 0x0042feae 起。
 * 子图 1/2 = 猫女郎两种姿势、7 = 红色粉笔（点中号格时画在那格上）、
 * 8 = 对话气泡 @(360,20)、9 = 蓝色底板 @(28,27)（奖池金额）。
 * `Panel#14` 是奖池那圈金色跑马灯（ANM，`assets-pipeline/src/anm.ts`），起在 (8,8)。
 *
 * ★ 一次落点只买 **1 注**：买中的那一下 reducer 就把 pending 收了，本屏自己关。
 * dispatch `lotteryBuy`。现金 < 1000 时屏一闪即关。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const lotteryScreen: UiScreen = {
  id: 'lottery',
  active: () => false,
  draw: () => undefined,
};
