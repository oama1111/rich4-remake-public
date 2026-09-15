/*
 * 持股彙總屏（買股份 / 企業董事長）—— T-031
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-031）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * 触发：`pending.kind === 'buyShares'`（落点踩到**上市企業**，VA 0x0041d277）。
 * `pending` 字段：`commercialId / name / stock / unitPrice / available / cash`
 * （见 `packages/core/src/rules/interaction.ts`）。
 * dispatch `{ type: 'buyShares', shares }`。
 *
 * 底图：`Panel.mkf` **#76**（1 张 592×432，`assets-clean/Panel/0076_000.png`）——
 * 那是「每個人的持股情況彙總」：每家企业列出前四持股与**董事長**。
 * 数据在 `state.commercialShares` / `state.commercialOwners`，
 * 排名与董事長判据在 `core/places/commercial.ts`。
 * 买股份的股数走填数页（`client/dialog.ts` 的 `AmountPage`，照股市屏喂它的样）。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const sharesScreen: UiScreen = {
  id: 'shares',
  active: () => false,
  draw: () => undefined,
};
