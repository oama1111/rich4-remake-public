/*
 * 回到棋盘那一帧要不要把回合驱动重新叫起来 —— 纯函数（W-60）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 为什么需要它（第六份试玩回报第 10 条，**阻断**）
 *
 * `main.ts` 的两条回合驱动（`scheduleHumanTurn()` / `scheduleAi()`）在**排程入口**
 * 都有 `if (screen !== 'game') return;`（那是为了别在標題屏 / 過場里推进回合）。
 * 于是：
 *
 * 1. 走子途中，上一拍排好的定时器还挂着；玩家这时打开「遊戲設定」⇒ `screen = 'options'`；
 * 2. 定时器到点照常 `dispatch(step)`，`dispatch` 末尾再叫 `scheduleHumanTurn()` 续下一拍 ——
 *    此刻 `screen !== 'game'` ⇒ **直接 return，没人再排**；
 * 3. 关掉設定时，所有「回棋盘」的出口（`closeStock` / `closeSaveLoad` /
 *    `applyCancelLayer` 的 `'options'` 支 / `onOptionsUp` 的取消与確定两支 /
 *    `closeAiSettings` / `closeAssets` / `closeInventory` …）都只写了
 *    `screen = …; requestRender();`，**一处都没叫** `resumeTurnDriver()`。
 *
 * ⇒ 链条永远断着：棋子停在半路、GO 点不动、地也买不了。
 * （過場那条 `endIntro()` 早就踩过同一个坑，那里是**手工**补的两句 ——
 *   本模块要把它变成**一处**判据，免得以后每加一个整屏都要记得补。）
 *
 * ## 判据
 *
 * 「**这一帧刚从别的屏回到棋盘**」—— `now === 'game' && prev !== 'game'`。
 *
 * 为什么不逐屏在退出时补一句：漏一个就又卡一次（第七、第八个出口迟早会出现）；
 * 为什么不改成「設定屏开着也继续走子」：原版設定屏是**模态**的。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4），能单测。
 */

/**
 * 这一帧要不要把回合驱动重新叫起来。
 *
 * @param prev 上一帧的屏号（`main.ts` 的 `lastFrameScreen`）
 * @param now  这一帧的屏号（`main.ts` 的 `screen`）
 */
export function shouldResumeDriver(prev: string, now: string): boolean {
  return now === 'game' && prev !== 'game';
}
