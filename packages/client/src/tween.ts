/*
 * 走子补间 —— 一格走几步、每步落在哪，全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「这一步的棋子画在哪」，不碰任何规则。
 *   ★ C-DET-4：补间**绝不能进 state/history** —— 它纯表现，丢了不影响重放。
 *
 * ── 出处 ───────────────────────────────────────────────────────────────
 * @source `fcn_0040c05c`（VA 0x0040c05c，**不是** `_rich4_animate_object`；
 *   后者 VA 0x0040e669 的 26 个调用点全在 0x442xxx~0x446xxx，是**道具**飞行动画）：
 *
 * ```asm
 * ; 一格开始时算一次（[0x4749dc] == 0）：
 * tx, ty = mapnode[目标].x, .y                    ; → [0x48bae4] / [0x48bae8]
 * dx = tx - 旧屏幕x ; dy = ty - 旧屏幕y
 * dist = sqrt(dx*dx + dy*dy)
 * if (slot != 0 || (player.flags & 0x30))  N_f = dist * 0.125      ; [0x4631dc] = 0.125f
 * else                                     N_f = dist / speed[交通方式]
 *                                          ; ★ [0x4749d8] = [8, 12, 16, 8]，单位**像素/tick**
 * stepX = dx / N_f ; stepY = dy / N_f
 * curX = (float)player.screenX ; curY = (float)player.screenY
 * N = (int)N_f            ; ★ 向零截断（fcn_00457dbc 把 FPU 舍入位置成 11b）
 * if (N == 0) N = 1
 * N--
 * if (N <= 0) { 吸附到 (tx,ty) ; return 1 }        ; ★ 最后一格不插值
 * curX += stepX ; curY += stepY
 * player.screenX = (int)curX ; player.screenY = (int)curY
 * ```
 * 于是第 k 次 tick 落在 `from + (to - from) × k / N`（k = 1..N），
 * 第 N 次正好是终点 —— 是**线性等分**，不是弧线（老注释里那句「跳跃弧线」是猜的）。
 *
 * ★ 每 N 次 tick 走完一格，**一次 tick 一帧**；tick 的时长见 `tickMs()`。
 */

/**
 * 每种交通方式的走子速度，单位 **像素 / tick**。
 * @source VA 0x004749d8（dump 出来就是这 4 个数：走路 8、機車 12、汽車 16、船 8）
 */
export const WALK_SPEED_PX_PER_TICK: readonly number[] = [8, 12, 16, 8];

/**
 * 「特殊态」的走子速度倒数 —— `dist × 0.125`（即每 tick 8 像素）。
 * @source VA 0x004631dc = `0x3E000000` = 0.125f
 */
export const SPECIAL_SPEED_RECIP = 0.125;

/**
 * 一帧的落点（屏幕坐标）。
 *
 * 与 exe 一样是**截断前**的浮点值；调用方按需取整。
 * （exe 每一帧都先累加浮点再 `fcn_00457dbc` 向零截断 —— 这里同样保留浮点，
 *   由 `framesFor` 的调用方决定何时取整，避免提前取整带来的漂移。）
 */
export interface TweenFrame {
  x: number;
  y: number;
}

/**
 * 这一步要播几 tick。
 *
 * @param dx,dy    **屏幕**位移（终点 − 起点）
 * @param traffic  交通方式（0 走路 / 1 機車 / 2 汽車 / 3 船）
 * @param special  「特殊态」：原版在 `slot != 0 || (player.flags & 0x30)` 时改走
 *                 `dist × 0.125` 那一支（乘骑、被抬走等）
 */
export function tweenTickCount(
  dx: number,
  dy: number,
  traffic = 0,
  special = false,
): number {
  const dist = Math.hypot(dx, dy);
  const speed = special
    ? dist === 0
      ? Infinity
      : 1 / SPECIAL_SPEED_RECIP
    : (WALK_SPEED_PX_PER_TICK[traffic & 3] ?? WALK_SPEED_PX_PER_TICK[0]!);
  // ★ 向零截断；`N == 0` 时钳到 1（@source VA 0x0040c31f）
  const n = Math.trunc(dist / speed);
  return n < 1 ? 1 : n;
}

/**
 * 整条补间的帧序列（屏幕坐标）。
 *
 * 第 k 帧（k = 1..N）落在 `from + (to − from) × k / N`，故**最后一帧正好落在终点**，
 * 而第一帧已经离起点一步 —— 与 exe 的 `curX = fromX + stepX` 一致。
 *
 * ★ `enabled === false`（「動畫過程」关掉）→ 空数组，调用方直接落格心。
 */
export function framesFor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ticks = 1,
): TweenFrame[] {
  if (ticks <= 0) return [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const frames: TweenFrame[] = [];
  for (let k = 1; k <= ticks; k++) {
    frames.push({ x: from.x + (dx * k) / ticks, y: from.y + (dy * k) / ticks });
  }
  return frames;
}
