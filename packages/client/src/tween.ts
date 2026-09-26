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
 *                                                 ; ★ 0x40c1d4/0x40c205：直接取**节点记录**的
 *                                                 ;   +0x00/+0x02，**不做投影**
 * dx = tx - 旧x ; dy = ty - 旧y                   ; ★ 旧x/y 也是节点记录（或 player.x/y，
 *                                                 ;   「走回棋盘」那一支 0x40c0dc）
 * dist = sqrt(dx*dx + dy*dy)                      ; ★ 世界距离，不是屏幕距离
 * if (slot != 0 || (player.flags & 0x30))  N_f = dist * 0.125      ; [0x4631dc] = 0.125f
 * else                                     N_f = dist / speed[交通方式]
 *                                          ; ★ [0x4749d8] = [8, 12, 16, 8]，单位**世界单位/tick**
 * stepX = dx / N_f ; stepY = dy / N_f
 * curX = (float)player.x ; curY = (float)player.y ; ★ 0x40c2d0 起：累加器 = player.x/y
 * N = (int)N_f            ; ★ 向零截断（fcn_00457dbc 把 FPU 舍入位置成 11b）
 * if (N == 0) N = 1
 * N--
 * if (N <= 0) { 吸附到 (tx,ty) ; return 1 }        ; ★ 最后一格不插值
 * curX += stepX ; curY += stepY
 * player.x = (int)curX ; player.y = (int)curY      ; ★ 0x40c38a/0x40c3a4
 * ```
 * ★★ **整支都在世界坐标里**（2026-09-18 订正，见 `render.ts` 的 `startWalk`）：
 *   `player.x/y`（`+0x496b70/+0x496b72`）就是地图坐标，投影只发生在**画**的时候
 *   （`fcn_00407a2c`）。所以「世界线性」≠「屏幕线性」——画面上那一段有透视畸变。
 *   一格耗时的真值 = `trunc(世界距离 / 速度) × tickMs(游戏速度)`。
 *
 * 于是第 k 次 tick 落在 `from + (to - from) × k / N`（k = 1..N），
 * 第 N 次正好是终点 —— 是**线性等分**，不是弧线（老注释里那句「跳跃弧线」是猜的）。
 *
 * ★ 每 N 次 tick 走完一格，**一次 tick 一帧**；tick 的时长见 `tickMs()`。
 */

import { WHO_PLAYS_RELOCATED, WHO_PLAYS_RETURN_TO_BOARD, directionOf } from '@rich4/core';

/**
 * 每种交通方式的走子速度，单位 **世界单位 / tick**（不是屏幕像素）。
 * @source VA 0x004749d8（dump 出来就是这 4 个数：走路 8、機車 12、汽車 16、船 8）
 */
export const WALK_SPEED_PX_PER_TICK: readonly number[] = [8, 12, 16, 8];

/**
 * 「特殊态」的走子速度倒数 —— `dist × 0.125`（即每 tick 8 像素）。
 * @source VA 0x004631dc = `0x3E000000` = 0.125f
 */
export const SPECIAL_SPEED_RECIP = 0.125;

/**
 * 一帧的落点（**世界坐标** —— 投影是画的时候才做的，见文件头）。
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
 * @param dx,dy    **世界**位移（终点 − 起点，节点 x/y）
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
 * 整条补间的帧序列（世界坐标；调用方投影到屏幕）。
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
 * ★★ `special`：**走回棋盘必须走「特殊支」**（`dist × 0.125`，8 世界单位/拍），
 *   与玩家的交通方式无关。依据是 `0x40c05c` 里两次读**同一个字节** `player+0x15`：
 * ```asm
 * 0040c0b4  mov  dl, byte [eax + 0x496b7d]      ; 0x10 分支的判据
 * 0040c0ba  test dl, 0x10 / je 0x40c0ed
 * ...（中间唯一的调用 0x40b93b 只读不写该字节，@source 0x40b96c）...
 * 0040c26d  test byte [eax + 0x496b7d], 0x30    ; ★ 同一个字节
 * 0040c274  je   0x40c282                       ;   普通走法才查速度表 [0x4749d8]
 * 0040c27a  fmul dword [0x4631dc]               ;   N_f = dist × 0.125f
 * ```
 *   ⇒ 能被 `0x10` 分支接走的那一趟，必然也走 `0x40c27a`。
 *   先前这里一律传 `special=false` + 交通方式 ⇒ 坐牢前開車的人（16/tick）
 *   走回来会快一倍（`trunc(dist/16)` 而不是 `trunc(dist×0.125)`）。
 *   走回棋盘的格数恒为 1（`@source 0x40dd40 mov dword [0x48baf8], 1`）。
 *
 * ★★ `landing`（第八份试玩回报 #8，2026-09-22）：走一格的**终点是踏上的那一格**，不是 after 里的 `nodeId`。
 *   两者在「踏上去就被送走」时不同：踩惡犬 / 地雷 / 炸彈炸了 → core 在同一条 `step` 里把人写进醫院
 *   （`nodeId` = 醫院關押格、`x/y` = 醫院大樓），拿它当终点就成了一段横跨地图的 4 秒「走去醫院」——
 *   原版是 `0x40c05c` 走到狗格、`fcn_0041b42d` 才处理落点。调用方用引擎自己的 `pickNextNode`
 *   回放这一步（`dev-patch.ts` 的 `nextNodeOf`：随机流位置就是 before 的 `rngState`）把踏上的格传进来；
 *   不传就按 after 的 `nodeId`（先前的口径）。
 *
 * 返回 `null` = 这一条 action 不起补间。
 * ★ C-ARC-2：只算"画在哪"，不碰规则；补间**绝不进 state**（C-DET-4）。
 */
export interface WalkTween {
  player: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 是否走「特殊支」（`player+0x15 & 0x30`）—— 走回棋盘恒为真，见上 */
  special: boolean;
  /**
   * ★ 审计 #17：「被挪」那两支（`player+0x15 & 0x30`）的**显隐**与朝向 —— 见 `relocateVisible`。
   * 只在调用方给了 `whoPlays` 时才判（没给 = 老口径，全程画、朝向照 state）。
   */
  relocate?: RelocateWalk;
}

/**
 * 「被挪」那一趟的走法 —— `fcn_0040c05c` 的两条特殊支：
 * - `'emerge'`：**走出来**（`+0x15 & 0x10`，刑满 / 住满「走回棋盘」）。起点 = 在押贴图位
 *   （綠島 / 醫院大樓 / 旅館設施），终点 = 所在格。
 * - `'enter'`：**走进去**（`+0x15 & 0x20`，旅館住店 `0x40d5a5` 支 A）。起点 = 旅館格、
 *   终点 = 設施坐标（`0x40c0ed..0x40c127`：`設施表 [0x498e88] + [+0x4a]×0x38` 的 +0x00/+0x02）。
 */
export interface RelocateWalk {
  kind: 'enter' | 'emerge';
  /**
   * 这一趟摆的朝向（`player+0x10`）= `directionOf(终点 − 起点)`。
   * @source 走进去：`0x40d5a5` 支 A 先按「設施 − 自己」算好朝向再 `call 0x40dd1f`；
   *   走出来：释放 `0x40d6be` 的 `0x0040d70f call 0x454fb4(node − x/y)` → `0x0040d717` 写 `+0x10`。
   *   两支走路时都**不再**按格重算朝向（`0x0040c417 test [+0x15],0x30 / jne` 跳过 `0x40c437`）。
   */
  facing: number;
}

/**
 * 「被挪」那一趟**第几拍起换了显隐**（1 基；`null` = 这一趟一直不换）。
 *
 * @source `fcn_0040c05c`：
 * ```asm
 * 0040c313  eax = [0x4749dc] / sar eax,1 / mov [0x48baf4], eax   ; 半程 = trunc(N_f) >> 1（钳到 1 之前）
 * 0040c338  dec ecx / mov [0x4749dc], ecx                         ; 本拍之后还剩几拍
 * 0040c34a  jle 0x40c3ec                                          ; 剩 0 ⇒ 末拍吸附，**不查**半程
 * 0040c3ab  test byte [+0x15], 0x30 / je
 * 0040c3ba  cmp  edx, [0x48baf4] / jge                            ; 剩余 < 半程 才动手（只动一次：动完把半程清 0）
 * 0040c3cf  mov  dword [+0x32], 0                                 ; 0x10 支：清四个阻碍计数 ⇒ 开始画（走出来）
 * 0040c3dc  and  dl, 0xf / mov [+0x15], dl                        ; 0x20 支：清掉 0x20 ⇒ 不再画（走进去）
 * ```
 * 画不画由棋子绘制 `0x00408691 cmp dword [+0x32],0 / je 画` + `0x0040869a test [+0x15],0x20 / je 不画` 决定。
 * ⇒ 第 k 拍剩 `N − k`；第一次 `0 < N − k < N >> 1` 的那一拍 = `N − (N >> 1) + 1`（须 ≤ N − 1）。
 */
export function relocateToggleTick(ticks: number): number | null {
  const t = ticks - (ticks >> 1) + 1;
  return t <= ticks - 1 ? t : null;
}

/**
 * 「被挪」那一趟第 `k` 拍（1..N；`k > N` = 走完之后）棋子画不画。
 * - `'enter'`（住店）：过半之前画、之后隐 —— 人走进旅館**不见了**；
 * - `'emerge'`（走回棋盘）：过半之前隐（阻碍计数还在）、之后画 —— 人从建筑里**走出来**。
 * 拍数太少（`relocateToggleTick` 为 null）时原版这一趟不换显隐：走进去一直画、走出来一直隐。
 */
export function relocateVisible(kind: RelocateWalk['kind'], ticks: number, k: number): boolean {
  const t = relocateToggleTick(ticks);
  const toggled = t !== null && k >= t;
  return kind === 'enter' ? !toggled : toggled;
}

export function walkTweenFor(
  actionType: string,
  before: { currentPlayer: number; players: readonly TweenPlayer[] },
  after: { currentPlayer: number; players: readonly TweenPlayer[] },
  nodeAt: (nodeId: number) => { x: number; y: number } | undefined,
  landing: number | null = null,
): WalkTween | null {
  const idx = after.currentPlayer;
  const a = after.players[idx];
  const b = before.players[idx];
  if (a === undefined || b === undefined) return null;
  // ★★ 审计 #17：**住进旅館那一趟**（`0x41a85e call 0x40d5a5` 支 A：当前玩家、原格）——
  //   core 在落点结算里置 `+0x15 |= 0x20` 并把贴图位写成設施坐标（`nodeId` 不变），
  //   原版由 `0x40dd1f`（剩 1 格、走姿）+ 走路例程 `0x20` 支把人从旅館格走到設施坐标、半程隐去。
  //   支 B（付钱的不是当前玩家，如死神代付）是瞬移（`0x40b93b`），不走 ⇒ 只看当前玩家。
  if (
    actionType !== 'step' &&
    actionType !== 'startTurn' &&
    a.whoPlays !== undefined &&
    b.whoPlays !== undefined &&
    (a.whoPlays & WHO_PLAYS_RELOCATED) !== 0 &&
    (b.whoPlays & WHO_PLAYS_RELOCATED) === 0 &&
    (a.xpos !== b.xpos || a.ypos !== b.ypos)
  ) {
    const from = { x: b.xpos, y: b.ypos };
    const to = { x: a.xpos, y: a.ypos };
    return { player: idx, from, to, special: true, relocate: { kind: 'enter', facing: directionOf(to.x - from.x, to.y - from.y) } };
  }
  if (actionType === 'step') {
    if (a.nodeId === b.nodeId) return null; // 没真的挪窝（例如被阻碍）
    // ★ 终点 = 踏上的那一格（见文件头 `landing`）；没给就退回 after 的 `nodeId`
    const toId = landing ?? a.nodeId;
    if (toId === b.nodeId) return null;
    const from = nodeAt(b.nodeId);
    const to = nodeAt(toId);
    if (from === undefined || to === undefined) return null;
    // 普通走子：原版查速度表 `[0x4749d8]`（`@source 0x40c282..0x40c29e`）
    return {
      player: idx,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      special: false,
    };
  }
  if (actionType === 'startTurn') {
    if (a.xpos === b.xpos && a.ypos === b.ypos) return null;
    // ★ 「走回棋盘」＝ `player+0x15 & 0x10` 那一支 ⇒ **特殊支**（见上）
    const from = { x: b.xpos, y: b.ypos };
    const to = { x: a.xpos, y: a.ypos };
    // ★ 审计 #17：带着 0x10 走出来（監獄 / 醫院 / 旅館住满）⇒ 前半程不画、过半才露面（`relocateVisible`）
    if (b.whoPlays !== undefined && (b.whoPlays & WHO_PLAYS_RETURN_TO_BOARD) !== 0) {
      return { player: idx, from, to, special: true, relocate: { kind: 'emerge', facing: directionOf(to.x - from.x, to.y - from.y) } };
    }
    return { player: idx, from, to, special: true };
  }
  return null;
}

/** `walkTweenFor` 读的那几个玩家字段（`whoPlays` 可缺：缺了就不判「被挪」那两支）*/
export interface TweenPlayer {
  nodeId: number;
  xpos: number;
  ypos: number;
  whoPlays?: number;
}
