/*
 * 樂透開獎动画屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本屏尚未实现**（T-036）。文件先立在这里，是为了让 `screens.ts` 的登记
 *   一次接好 —— 实现的人**只改这一个文件**（外加自己的 `*.test.ts`），
 *   不要动 `main.ts`：契约见 `ui-screen.ts`。
 *
 * **不是待决交互** —— 開獎在 core 里即时结算，本屏是**演出**：
 * 察觉開獎发生 → 播一段状态机 → 播完自己关。
 *
 * 演出脚本**已经写好了**：`core/places/lottery-ceremony.ts`（纯数据 + 纯函数，
 * 十态状态机、台词顺序、停顿、擦除矩形全在里面）—— 本屏只负责按脚本播。
 * 素材：`Panel.mkf` **#15**（47 张子图，底图/主持人六姿势/脸部件/两个爆炸框/
 * 十二个角色徽章/号码球 37..46）、**#16** = `LOTOOPEN/LOTOBALL.FLC` 42 帧、
 * **#17** = `256_S/A01.FLC` 37 帧 —— 两块都是 ANM，解码器已就绪。
 *
 * 用 `event(before, after, env)` 察觉開獎，或在自己 `tick` 里比对状态。
 *
 * 验收：卡片 `docs/tasks/cards.yaml` 的 `tests` 一栏全绿 + `pnpm check` 三绿；
 * 做完把卡片 `status` 改 `done`、跑 `python3 tools/task-cards.py render`。
 */

import type { UiScreen } from './ui-screen.ts';

export const lotteryDrawScreen: UiScreen = {
  id: 'lottery-draw',
  active: () => false,
  draw: () => undefined,
};
