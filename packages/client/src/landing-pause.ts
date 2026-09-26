/*
 * 落在「地産格」上、落点例程收尾之后，**停 8 个 tick 才换下一位** —— 纯节拍
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 第十四份試玩回報（天使那条的补充说明：「……然后提示天使顯靈加蓋一層，再把模型替换到 2 级」）：
 *   顯靈框一收，本引擎的回合驱动当场就派 `endTurn` → `startTurn`，镜头在同一拍切到下一位 ——
 *   框后那次重画（`0x0040f506 call 0x41d476`，2 级露面）**一帧都看不到**。
 *
 * 原版的换人不在落点例程里，而是每 tick 的状态机（`fcn_0040d7c4`）按玩家状态字节
 * `[0x498ea5 + 0x34*玩家]` 倒数：
 *
 * ```asm
 * ; 落点例程 fcn_0041982d
 * 00419864  mov  byte [esp+0xf4], 0x80          ; 默认返回值：bit7 = 该换人，计数 0
 * 004198c3  je   0x41b3d0                       ; 格值为 0 ⇒ 直接返回 0x80
 * 0041b111  mov  byte [esp+0xf4], 0x88          ; ★ 类型 0（地块 / 設施 / 企業…）走完尾块 0x41b077 ⇒ 0x88
 * 0041b3d2  mov  al, [esp+0xf4] / ret
 * ; 调用方 fcn_00418e7f
 * 00418ea1  call 0x41982d
 * 00418eb6  mov  byte [eax+0x498ea5], dl        ; 存进玩家状态字节
 * ; 每 tick（fcn_0040d7c4）
 * 0040d831  bh = [..0x498ea5] / test bh,0x7f / je → 不减
 * 0040d840  [..0x498ea5] = bh − 1               ; 低 7 位是倒数计数
 * 0040d853  test ch,0x7f / jne 0x40d88e         ; 还没数完 ⇒ 这一 tick 什么都不做
 * 0040d85c  test ch,0x80 / je …
 * 0040d86f  call 0x418ebd                       ; ★ 数到 0 且 bit7 ⇒ 换下一位（镜头随之切走）
 * ```
 *
 * ⇒ 落在类型 0 的格上（且格值非 0），落点例程（含它里面所有阻塞的框 / 台词 / 顯靈重画）返回之后，
 *   棋盘**原地再停 8 个 tick**才换人；其余特殊格返回 0x80，下一个 tick 就换。
 *   速度 2 档一 tick = 40 ms ⇒ 320 ms（`tick.ts`）。
 *
 * ## 同一个状态字节的另外两种来源（2026-09-23 补，协调方要求把返回码逐个对上）
 *
 * | 写入点 | 值 | 什么时候 | 本引擎 |
 * |---|---|---|---|
 * | `0x00419864`（落点默认）| `0x80` | 特殊格、格值 0（`0x004198c3 je 0x41b3d0`）| 下一 tick 换人 = 已有的「至少一个 tick」节拍（`paceDelay`），不另停 |
 * | `0x0041b111`（落点类型 0）| `0x88` | 地块 / 設施 / 企業 / 景點格走完尾块 | `LANDING_TAIL_TICKS` = 8 |
 * | `0x00418ead`（`fcn_00418e7f`）| `0x83` | `fcn_0040c912(1)` 返回 0 ⇒ **不进落点例程** | `BLOCKED_TURN_TICKS` = 3，见下 |
 * | `0x0040de2b` | `0x82` | 游标在 4..7（替身 / 四大惡人那几格），不是玩家 | 不在本模块范围 |
 *
 * `0x83` 那一支的来路（被关押的回合）：换人后回合开头 `0x00418d70 call 0x40c912(0)` ——
 * `dword [+0x32] != 0`（住宿/消失/坐牢/住院）或 `byte [+0x36] != 0`（冬眠）且 `[+0x15] & 0x30 == 0` 时
 * 说台词、弹「○○住院中」框，`ebx` 一直是 0 ⇒ 返回 0 ⇒ 跳表 `0x418c3d[0]` = `0x00418d88 call 0x418e7f`
 * ⇒ `0x00418e81 call 0x40c912(1)`：`0x0040cbc7 cmp dword [+0x32],0 / jne` / `0x0040cbd0 cmp byte [+0x36],0 / jne`
 * 返回 0 ⇒ `0x00418ead mov dl,0x83`。出局者（`[+0x15] == 0`，`0x0040c938 je 0x40cc0d`）两次都返回 0，同一支。
 * ⇒ 那一扇框（阻塞）收掉之后再停 **3 tick** 才换人。
 *
 * ## `[+0x15] & 0x30`（走回棋盘 / 住进旅館）：走完之后 5 + 3 = **8 tick**（审计 #21 / #17，读了跳表 `0x40d7b4`）
 *
 * 回合开头 `0x0040c972 call 0x40dd1f` 先起一段走路（`0x0040dd40 [0x48baf8] = 1`、`0x0040dd4a [0x498ea2] = 1`），
 * 同一拍 `0x00418d88 call 0x418e7f` → `0x40c912(1)`（`0x0040cbc2 test ch,0x30 / jne` ⇒ 0）→ `0x00418eb6` 写 `0x83`。
 * 两个字节在每 tick 的 `fcn_0040d7c4` 里**不交错**：它按 `[0x498ea2]`（`0x0040d7f6 cmp al,3 / ja`，
 * `0x0040d801 jmp [eax*4 + 0x40d7b4]`）四选一，只有**相 0**（`[0]` = `0x0040d808`）才数 `[0x498ea5]`：
 *
 * ```asm
 * ; 相 1（走子，跳表 [1] = 0x0040d8d3）—— 不碰 [0x498ea5]
 * 0040d8d3  cmp  dword [0x48baf8], 0 / jne 0x40d932   ; 还有格要走
 * 0040d91f  mov  [..0x498ea2], 0                        ; 走完：回相 0
 * 0040d92b  mov  byte [..0x498ea5], 5                   ; ★ 覆盖掉那个 0x83：再数 5 tick（bit7 不置）
 * 0040d950  call 0x40c05c                               ; 走路例程（0x10 / 0x20 两支，N = trunc(dist × 0.125) 拍）
 * ; 相 0（跳表 [0] = 0x0040d808）
 * 0040d889  call 0x418e7f                               ; 5 数完 ⇒ 0x40c912(1)：0x10 还挂着（半程只清计数 `0x0040c3cf`）/
 *                                                       ;   住店者计数 `[+0x32]` 非 0 ⇒ 仍返回 0 ⇒ `0x00418ead` 再写 0x83
 * 0040d86f  call 0x418ebd                               ; 3 数完 ⇒ 换人（走回棋盘那一支不推进游标，同一位再来一回合）
 * ```
 * ⇒ 补间播完（= 相 1 发现「没格可走」的那一拍）之后再过 **5 + 3 = 8 tick** 才换人。
 *   住进旅館（`0x41a85e call 0x40d5a5` 支 A → `0x40dd1f`）同一条路：落点例程返回的 `0x88` 同样被 `0x0040d92b` 覆盖。
 *
 * ★ C-ARC-2 / C-DET-4：只决定「回合驱动什么时候可以派下一步」，不读写规则。
 */

import {
  WHO_PLAYS_RELOCATED,
  WHO_PLAYS_RETURN_TO_BOARD,
  evaluateTurnStart,
  type GameState,
  type MapTopology,
} from '@rich4/core';

/** 类型 0 格落点收尾后的倒数 @source 0x0041b111 `mov byte [esp+0xf4], 0x88`（低 7 位 = 8）*/
export const LANDING_TAIL_TICKS = 0x88 & 0x7f;

/**
 * 这一条 action 是不是让落点例程**收尾**在一个类型 0 的格上 —— 是就返回要停的 tick 数，否则 0。
 *
 * 判据：刚从 `settling`（落点结算）或 `awaitingDecision`（落点问出来的買/蓋/升級）进入 `turnEnd`、
 * 同一个人、脚下是地块 / 設施 / 企業 / 景點格（`specialKind == 0` 且格值非 0，
 * 即 `0x004198b9` 那一支里除 `je 0x41b3d0` 之外的全部分支）。
 */
export function landingPauseTicks(before: GameState, after: GameState, topo: Pick<MapTopology, 'nodes'>): number {
  if (after === before || after.phase !== 'turnEnd' || before.phase === 'turnEnd') return 0;
  if (before.phase !== 'settling' && before.phase !== 'awaitingDecision') return 0;
  if (after.currentPlayer !== before.currentPlayer) return 0;
  const me = after.players[after.currentPlayer];
  const node = me === undefined ? undefined : topo.nodes[me.nodeId - 1];
  if (node === undefined || node.specialKind !== 0) return 0;
  const k = node.ref.kind;
  return k === 'land' || k === 'facility' || k === 'commercial' || k === 'landscape' ? LANDING_TAIL_TICKS : 0;
}

/** 被挡的回合（不进落点例程）@source 0x00418ead `mov dl, 0x83`（低 7 位 = 3）*/
export const BLOCKED_TURN_TICKS = 0x83 & 0x7f;

/** 走子相走完回相 0 时的倒数 @source 0x0040d92b `mov byte [..0x498ea5], 5` */
export const WALK_END_TICKS = 5;

/** 「被挪」那一趟（走回棋盘 / 住进旅館）走完之后换人前的停顿 = 5（`0x0040d92b`）+ 3（`0x00418ead`）*/
export const RELOCATE_WALK_PAUSE_TICKS = WALK_END_TICKS + BLOCKED_TURN_TICKS;

/**
 * 「被挪」那一趟之后的停顿 ⇒ 8；否则 0。两个来路（都是**当前玩家**、这一条 action 进 `turnEnd`）：
 * - ★ 审计 #21：**走回棋盘**那一回合 —— `startTurn` 时他带着 `0x10`（`WHO_PLAYS_RETURN_TO_BOARD`）；
 * - ★ 审计 #17：**住进旅館** —— 这一条 action 让他带上了 `0x20`（`WHO_PLAYS_RELOCATED`，`0x40d5a5` 支 A；
 *   支 B 是别人代付、瞬移，不走，当前玩家身上不会多出这一位）。
 * 起算点与其余两档一样是「台上空下来」—— 两段补间都算进 `stageBusy` 的 `walkDone`，所以就是补间播完那一拍。
 */
export function relocateWalkPauseTicks(before: GameState, after: GameState): number {
  if (after === before || after.phase !== 'turnEnd' || before.phase === 'turnEnd') return 0;
  if (after.currentPlayer !== before.currentPlayer) return 0;
  const was = before.players[before.currentPlayer];
  const now = after.players[after.currentPlayer];
  if (was === undefined || now === undefined) return 0;
  if (before.phase === 'turnStart' && (was.whoPlays & WHO_PLAYS_RETURN_TO_BOARD) !== 0) return RELOCATE_WALK_PAUSE_TICKS;
  if ((now.whoPlays & WHO_PLAYS_RELOCATED) !== 0 && (was.whoPlays & WHO_PLAYS_RELOCATED) === 0) return RELOCATE_WALK_PAUSE_TICKS;
  return 0;
}

/**
 * 被挡、不进落点例程就进 `turnEnd` 的那一拍 ⇒ 3；否则 0。两个来路走的是同一个 `0x418e7f`：
 * - 回合开头就被挡（`startTurn` 的 `skip` 支，`0x00418d88 call 0x418e7f`）；
 * - ★ 第十六份：走完这一步**才**被关（最后一步踩到惡犬 / 地雷被送进醫院），`settle` 被
 *   `0x40c912(1)` 挡下（`0x0040d889 call 0x418e7f` → `0x00418ead mov dl,0x83`，见 core 的 `settle`）。
 * 走回棋盘 / 住进旅館（`whoPlays & 0x30`）那一支走 `relocateWalkPauseTicks`（见文件头）。
 */
export function blockedTurnPauseTicks(before: GameState, after: GameState): number {
  if (after === before || after.phase !== 'turnEnd') return 0;
  if (after.currentPlayer !== before.currentPlayer) return 0;
  const me = before.players[before.currentPlayer];
  if (me === undefined) return 0;
  if ((me.whoPlays & (WHO_PLAYS_RETURN_TO_BOARD | WHO_PLAYS_RELOCATED)) !== 0) return 0;
  if (before.phase === 'turnStart') return BLOCKED_TURN_TICKS;
  if (before.phase === 'settling' && !evaluateTurnStart(me, true).canAct) return BLOCKED_TURN_TICKS;
  return 0;
}

/** 这一条 action 之后换人前要停几个 tick（被挪那一趟走完 5+3 / 落点收尾 8 / 被挡的回合 3 / 其余 0）*/
export function turnEndPauseTicks(before: GameState, after: GameState, topo: Pick<MapTopology, 'nodes'>): number {
  // 「被挪」那一趟：`0x0040d92b` 把落点例程返回的 0x88 覆盖成 5、之后 0x83 —— 先判
  // 被挡的落点根本没进落点例程 ⇒ 不是 0x88，再判
  return relocateWalkPauseTicks(before, after) || blockedTurnPauseTicks(before, after) || landingPauseTicks(before, after, topo);
}

/** 已武装的那一次停顿 */
export interface LandingPause {
  ticks: number;
  /** 台上第一次空下来（原版「落点例程返回」）的时刻；`null` = 还没空下来 */
  idleAt: number | null;
}

/**
 * 台上已经空了、现在能不能派下一步。返回还要等的毫秒数（0 = 可以了）。
 * 第一次调用时记下空下来的时刻（原版 `0x00418eb6` 存状态字节的那一拍）。
 */
export function landingPauseRemaining(pause: LandingPause, now: number, tickMs: number): { pause: LandingPause; waitMs: number } {
  const idleAt = pause.idleAt ?? now;
  const waitMs = Math.max(0, idleAt + pause.ticks * tickMs - now);
  return { pause: { ...pause, idleAt }, waitMs };
}
