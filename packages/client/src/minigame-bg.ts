/*
 * 小游戏整屏底图的**交接处**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么要有这个模块：財神接金幣那一屏的底图是 `Panel.mkf` #92 ——
 *   一张**无头 640×480 RGB555**，`assets-clean/manifest.json` 里没有它，
 *   所以 `env.sprite('Panel.mkf', 92, 0)` 永远是 `null`。它只能走
 *   `readRaw555Resource` / `loadMinigameBackground`（`assets.ts`）。
 *
 *   于是问题变成「载好的位图怎么送到 `minigame-screen.ts` 的 `draw()` 手里」。
 *   三条路里挑了最窄的一条：
 *   ① 扩 `UiScreenEnv`（加 `background()` 之类）—— 要动 `ui-screen.ts`
 *      的契约，`main.ts` 与好几份假 env 都得跟着改，风险与本屏无关；
 *   ② `main.ts` 在开小游戏前把图塞进 `state` —— 玩法状态是 core 的，不该塞位图；
 *   ③ **本模块**：一个模块级的图槽，`main.ts` 开局载一次就够（三个小游戏里
 *      只有財神那屏需要它），`minigame-screen.ts` 的 `draw()` 每帧读一次。
 *      取不到就返回 `null`，那一屏照旧画其余部件（不能因为底图缺席就整屏不画）。
 *
 *   ⚠️ 只放**一张**：原版三个小游戏的底图都在各自资源里，
 *   只有 #92 是「没有头、`sprite()` 取不到」的那一张（D-MINI-1）。
 */

/** 当前这张財神屏底图；`null` = 还没载好 / 载不到 */
let background: ImageBitmap | null = null;

/** 之后要不要重画（由 `main.ts` 在设置时接上）—— 图是异步到的，到了得催一帧 */
let onReady: (() => void) | null = null;

/**
 * `main.ts` 载完底图后调这里。
 *
 * @param bitmap 解好的 640×480 底图；`null` 表示这次没取到（清掉旧的）
 */
export function setMinigameBackground(bitmap: ImageBitmap | null): void {
  background = bitmap;
  onReady?.();
}

/** `minigame-screen.ts` 的 `draw()` 每帧调这里；取不到就是 `null` */
export function getMinigameBackground(): ImageBitmap | null {
  return background;
}

/** 底图异步到达时催一帧重画（可选，不接也不影响正确性，只是慢一帧） */
export function onMinigameBackgroundReady(cb: () => void): void {
  onReady = cb;
}

/** 测试用：清空并断开回调 —— 位图是 `ImageBitmap`，`close()` 的时机交给调用方 */
export function resetMinigameBackground(): void {
  background = null;
  onReady = null;
}
