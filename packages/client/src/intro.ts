/*
 * 開局跳伞过场 —— 机制照原版；**内容拿不到**（见 Q-INTRO-1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2 / C-DET-4：过场是**纯表现** —— 不派任何 action，
 *   结束后才让引擎自己走 `startTurn`，与「有没有看过过场」无关。
 *
 * 原版开场播的是 AVI（`mciSendStringA` 播）：
 *   `AIRPLANE.AVI` 与按地区选的 `FLYTW/FLYCHINA/FLYJP/FLYUS.AVI`
 *   （名字就在 exe 里，VA 0x46xxxx 那片串表）。
 *
 * ⚠️ **那些 AVI 复刻不了**：
 *   · 编码是 **Indeo Video 4.1（`IV41`）** —— 专有编码，浏览器与我都解不了；
 *   · 而且它们**全是残档**：每个恰好 **5112 字节**，`movi` 里只有 **1 个 338 字节**
 *     的视频块，却在 `avih` 里声明 **15 帧**。
 *   故这里只复刻**时序与可跳过**这两条能确证的行为，画面留给 Q-INTRO-1。
 */

/** 过场画面尺寸 @source `Airplane.avi` 的 `strf`：312 × 160 */
export const INTRO_SIZE = { w: 0x138, h: 0xa0 } as const;

/** 帧数 @source `avih` 的 `dwTotalFrames` = 15 */
export const INTRO_FRAMES = 15;

/** 每帧多少微秒 @source `avih` 的 `dwMicroSecPerFrame` = 0x1046b = 66667（≈15 fps） */
export const INTRO_FRAME_US = 0x1046b;

/** 整段过场多长（毫秒）—— 15 × 66.667 ≈ 1000 ms */
export function introMs(frames: number = INTRO_FRAMES): number {
  return Math.max(0, frames) * (INTRO_FRAME_US / 1000);
}

/**
 * 过场该结束了吗 —— **放完**或**用户跳过**都算。
 *
 * 原版是可跳过的（跳过就立刻进棋盘）；这里把「跳过」抽成参数，
 * 于是这条判据是纯函数、可测。
 */
export function introDone(
  startedAt: number,
  now: number,
  skipped: boolean,
  frames: number = INTRO_FRAMES,
): boolean {
  return skipped || now - startedAt >= introMs(frames);
}

/**
 * 画过场。内容拿不到（Q-INTRO-1），故只画**原版那块画面的位置与尺寸**
 * （居中 312×160）与一行「跳过」提示 —— 不自己编内容。
 */
export function drawIntro(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  frames: number = INTRO_FRAMES,
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const at = { x: (width - INTRO_SIZE.w) / 2, y: (height - INTRO_SIZE.h) / 2 };
  ctx.fillStyle = '#101820';
  ctx.fillRect(at.x, at.y, INTRO_SIZE.w, INTRO_SIZE.h);
  ctx.strokeStyle = '#38404c';
  ctx.lineWidth = 1;
  ctx.strokeRect(at.x + 0.5, at.y + 0.5, INTRO_SIZE.w - 1, INTRO_SIZE.h - 1);

  // 进度条 —— 用「播到第几帧」表达，与 AVI 的时序一一对应
  const frame = Math.min(frames, Math.floor(elapsedMs / (INTRO_FRAME_US / 1000)) + 1);
  ctx.fillStyle = '#5a6472';
  ctx.fillRect(at.x, at.y + INTRO_SIZE.h - 3, (INTRO_SIZE.w * frame) / Math.max(1, frames), 3);

  ctx.fillStyle = '#c8ccd4';
  ctx.font = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('開場動畫（原版為 AIRPLANE.AVI，見 Q-INTRO-1）—— 按任意鍵跳過', width / 2, at.y + INTRO_SIZE.h + 16);
}
