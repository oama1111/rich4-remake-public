/*
 * 公佈欄屏（挂 / 撤 / 买 / 出价输入）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-033）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * 入口：**熱鍵「交易」**（`HOTKEY.trade` = 13，`assets.ts` 的 `TOOLBAR_LABELS` 旁写着
 * 「公佈欄 ← 熱鍵交易」）。原版整屏底图 `Panel.mkf` **#73**（20 张子图），版式见
 * `docs/original-screens.md` 的 S13（路障挂 3,000 元那张示例）。
 *
 * 规则侧早已做完（`core/places/notice-board.ts`，含四种市價与 AI 判据），
 * 状态在 `state.noticeBoard[玩家][槽]`（每列 7 槽）。要出的 action：
 * `noticeBoard`，`op` 取 `list`/`withdraw`/`buy` —— 形状见
 * `core/state/actions.ts` 的 `noticeBoard` 一项，**照它写，别自己造**。
 *
 * 三件事：自己的列可挂（选物 → 填价，走 `dialog.ts` 的 AmountPage）可撤；
 * 别人的列可买。出价默认值用 core 的 `*ListPrice`，卖家可改。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const boardScreen: UiScreen = {
  id: 'board',
  active: () => false,
  draw: () => undefined,
};
