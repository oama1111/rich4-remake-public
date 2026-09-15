/*
 * 走子补间 —— 起步/终点的线性插值，帧数与节拍**照 exe**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「这一步的棋子画在哪」，不碰任何规则。
 *   ★ C-DET-4：补间**绝不能进 state/history** —— 它纯表现，丢了不影响重放。
 *
 * @source `_rich4_animate_object`（VA 0x0040e669，`rich4_animate_object.asm`）：
 * ```asm
 * ; dx, dy = 终点的**屏幕**坐标 − 起点
 * fild (dx²+dy²) / call sqrt / fmul [0x46324c] / fld1 faddp / round_toward_zero
 *         ; ★ 帧数 = trunc(√(dx²+dy²) × 0.125) + 1     （0x46324c = 0.125f）
 * stepX = dx / 帧数 ; stepY = dy / 帧数                 ; 线性等分
 * curX = fromX + stepX ; curY = fromY + stepY           ; 第一帧就已经走了一步
 * 每帧：画在 (trunc(curX), trunc(curY))
 *       `timeGetTime` 等到本帧满 24 ms 再进下一帧        ; ★ 每帧固定 24 ms
 *       curX += stepX ; curY += stepY ; 帧数--
 * ```
 * 所以是**线性插值、不是弧线**（卡里那句「跳跃弧线」是猜的），
 * 且「動畫過程」关掉时由调用方**根本不调**这个函数 ⇒ 0 帧、瞬移。
 */

/** 每帧固定多久 @source VA 0x0040e96a 起 `cmp eax, 0x18(24)` 的 24 ms */
export const TWEEN_FRAME_MS = 0x18;

/** 一帧的落点（屏幕坐标，和 exe 一样是整数截断前的浮点） */
export interface TweenFrame {
  x: number;
  y: number;
}

/**
 * 这一步要播几帧。
 *
 * ★ 帧数只看**屏幕距离**，与游戏速度档无关（速度档在别处管）。
 *   一格的屏幕距离约 36~49 px → 6~7 帧 → 约 150 ms。
 * @source 上面那段 `×0.125 + 1`，取整方向是**向零**（`round_toward_zero`）
 */
export function tweenFrameCount(dx: number, dy: number): number {
  return Math.trunc(Math.hypot(dx, dy) * 0.125) + 1;
}

/**
 * 整条补间的帧序列（屏幕坐标）。`enabled === false`（動畫過程关）→ 空数组。
 *
 * 第 k 帧（k = 1..N）落在 `from + (to − from) × k / N`，故**最后一帧正好落在终点**，
 * 而第一帧已经离起点一步 —— 与 exe 的 `curX = fromX + stepX` 一致。
 */
export function framesFor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  enabled = true,
): TweenFrame[] {
  if (!enabled) return [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = tweenFrameCount(dx, dy);
  const frames: TweenFrame[] = [];
  for (let k = 1; k <= n; k++) {
    frames.push({ x: from.x + (dx * k) / n, y: from.y + (dy * k) / n });
  }
  return frames;
}

/** 整条补间要播多久（毫秒） */
export function tweenDurationMs(frameCount: number): number {
  return Math.max(0, frameCount) * TWEEN_FRAME_MS;
}
