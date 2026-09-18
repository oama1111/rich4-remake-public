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
 * @param special  「特殊态」：原版在 `回合记录+1 != 0`（该玩家的**动画序号**非 0）
 *                 或 `player.flags & 0x30`（走回棋盘 / 被外力挪过）时改走
 *                 `dist × 0.125` 那一支（乘骑、被抬走等）
 *                 @source 0x0040c25d / 0x0040c26d（通道 2：`test_walk_step.py` §E）
 */
export function tweenTickCount(
  dx: number,
  dy: number,
  traffic = 0,
  special = false,
): number {
  // ★ 向零截断；`N == 0` 时钳到 1（@source VA 0x0040c31f）
  const n = Math.trunc(tweenTickExact(dx, dy, traffic, special));
  return n < 1 ? 1 : n;
}

/**
 * **未截断**的拍数 `N_f` —— 原版 `[esp+0x1c]`。
 *
 * ★★ 为什么单独要它：原版每拍位移是 `dx / N_f`（`@source 0x0040c2ae`
 *   `fdiv dword [esp+0x1c]`），**除的是这个浮点值**，不是截断后的 `[0x4749dc]`。
 *   只有末拍才吸附到落点（`0x0040c3ec`）。通道 2 实测（`rich4-spec/tests/
 *   test_walk_step.py` §F）：100 px 走路 ⇒ `N_f = 12.5`、12 拍，每拍 **8.0** px
 *   （108/116/…/188，第 12 拍吸附 200）。
 *   此前这里只给截断值，客户端按 `dx / 12` 走（8.33 px/拍）⇒ 中段最多差 ~4 px。
 */
export function tweenTickExact(
  dx: number,
  dy: number,
  traffic = 0,
  special = false,
): number {
  const dist = Math.hypot(dx, dy);
  if (special) return dist * SPECIAL_SPEED_RECIP;
  return dist / (WALK_SPEED_PX_PER_TICK[traffic & 3] ?? WALK_SPEED_PX_PER_TICK[0]!);
}

/**
 * **走子**补间的逐拍位置 —— 与原版同一套公式（末拍吸附）。
 *
 * @param ticks      要播几拍 = `tweenTickCount(...)`（截断后的）
 * @param exactTicks 未截断的 `N_f` = `tweenTickExact(...)`
 *
 * 第 k 拍（k < ticks）= `from + (to − from) × k / N_f`，第 `ticks` 拍 = `to`。
 *
 * ⚠️ 剩下的最后一档差异（**留给画质那一轮**）：原版的 `player.x/y` 是**整数**
 *   —— 每拍把浮点累加器 `fcn_00457dbc` 向零截断；这里保留浮点（渲染要亚像素）。
 *   两条曲线的**累计差 < 1 px**、末拍同点，故 1:1 的行为一致。
 */
export function walkFramesFor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ticks: number,
  exactTicks: number,
): TweenFrame[] {
  if (ticks <= 0) return [];
  const n = Number.isFinite(exactTicks) && exactTicks > 0 ? exactTicks : ticks;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const frames: TweenFrame[] = [];
  for (let k = 1; k <= ticks; k++) {
    if (k === ticks) {
      frames.push({ x: to.x, y: to.y }); // ★ 末拍吸附（`0x0040c3ec`）
      continue;
    }
    const t = Math.min(1, k / n);
    frames.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return frames;
}

/**
 * 整条补间的帧序列（屏幕坐标）。
 *
 * 第 k 帧（k = 1..N）落在 `from + (to − from) × k / N`，故**最后一帧正好落在终点**，
 * 而第一帧已经离起点一步 —— 与 exe 的 `curX = fromX + stepX` 一致。
 *
 * ⚠️ 本函数是**通用等分器**（道具飞行等用），**走子请用 `walkFramesFor`** ——
 *   它按原版那样用**未截断**的 `N_f` 做除数、末拍吸附（见其文档；T-WALK-1 已修）。
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

/**
 * 这一条 action 之后要不要起**位移补间**，起的话起终点是什么。
 *
 * @source 两种情形：
 *  ① 走一格 —— `fcn_0040c05c`：起点 = `lastNodeId` 那一格、终点 = `nodeId` 那一格
 *     （core 的 `step` 会把两个字段都维护好）。没真的挪窝（被阻碍）就**不起**。
 *  ② ★★ **「走回棋盘」那一回合**（第 86/87 条）：core 在消费 `+0x15 & 0x10`
 *     标记时把 `x/y` 从**綠島／醫院大樓**回填成監獄／醫院格坐标
 *     （原版由走路例程 `0x40c05c` 逐帧走回去；见 `rules/confinement.ts`
 *     的 0x43d643 与 `state/reduce.ts` 的 `startTurn`）。
 *     ⇒ 判据就是"`x/y` 变了"，不需要另加标记。
 *
 * 返回 `null` = 这一条 action 不起补间。
 * ★ C-ARC-2：只算"画在哪"，不碰规则；补间**绝不进 state**（C-DET-4）。
 */
export interface WalkTween {
  player: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function walkTweenFor(
  actionType: string,
  before: { currentPlayer: number; players: readonly { nodeId: number; xpos: number; ypos: number }[] },
  after: { currentPlayer: number; players: readonly { nodeId: number; xpos: number; ypos: number }[] },
  nodeAt: (nodeId: number) => { x: number; y: number } | undefined,
): WalkTween | null {
  const idx = after.currentPlayer;
  const a = after.players[idx];
  const b = before.players[idx];
  if (a === undefined || b === undefined) return null;
  if (actionType === 'step') {
    if (a.nodeId === b.nodeId) return null; // 没真的挪窝（例如被阻碍）
    const from = nodeAt(b.nodeId);
    const to = nodeAt(a.nodeId);
    if (from === undefined || to === undefined) return null;
    return { player: idx, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
  }
  if (actionType === 'startTurn') {
    if (a.xpos === b.xpos && a.ypos === b.ypos) return null;
    return { player: idx, from: { x: b.xpos, y: b.ypos }, to: { x: a.xpos, y: a.ypos } };
  }
  return null;
}
