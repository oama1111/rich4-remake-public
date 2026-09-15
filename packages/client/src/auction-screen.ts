/*
 * 拍賣屏（PASS / +1000 / +5000、挥锤动画）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-034）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * `pending.kind === 'auction'` 时接管整屏。底图 `Panel.mkf` **#26**（184 张子图）；
 * 版式见 `docs/original-ui.md` 的 U-7：左侧有人挥锤、右侧是当局玩家的 Q 版小人、
 * 资产金额与加价钮（PASS / +1000 / +5000）。
 *
 * 竞价规则在 `core/rules/auction.ts`；AI 出价也走 core。本屏只做：
 * 「谁轮到 → 问 core 该出多少 / PASS → 三次无人加价就 dispatch
 * `auctionBid`」。拍賣卡（T-007）与破產拍賣都走这一屏。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const auctionScreen: UiScreen = {
  id: 'auction',
  active: () => false,
  draw: () => undefined,
};
