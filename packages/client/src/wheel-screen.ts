/*
 * 旅館 / 購物中心轉盤动画
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-039）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * 12 格圆盘，表 `0x475d0c`；结果由 core 定（`rules/facility.ts` 的 `spinWheel`）。
 * D-003 记着「真人点击时机不复刻」—— 本屏只把**指针从起点走到落点**播出来；
 * 「動畫過程」关掉时直接显示结果。
 *
 * 落点是「本次轉盤的起点与落点槽号」，core 里可能还没记（`state` 若无
 * `lastWheel` 这类字段，先加一个带测试的小改写，或从 before/after 的 diff 推）。
 * ⚠️ 素材号待认 —— 找到之前先用占位绘制，别硬编码猜出来的资源号。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const wheelScreen: UiScreen = {
  id: 'wheel',
  active: () => false,
  draw: () => undefined,
};
