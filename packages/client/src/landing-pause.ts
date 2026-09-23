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
 * ⚠️ **不接**的一支：`[+0x15] & 0x30`（走回棋盘 / 被外力挪过）—— 回合开头 `0x0040c972 call 0x40dd1f` 先起了
 *   一段走路（`0x0040dd4a [0x498ea2] = 1`），同一 tick 又被 `0x00418eb6` 写成 `0x83`，两个状态字节在
 *   `fcn_0040d7c4` 里怎么交错要另读跳表 `0x40d7b4`，属「需要新解读控制流」⇒ 上报，不猜。
 *
 * ★ C-ARC-2 / C-DET-4：只决定「回合驱动什么时候可以派下一步」，不读写规则。
 */

import { WHO_PLAYS_RELOCATED, WHO_PLAYS_RETURN_TO_BOARD, type GameState, type MapTopology } from '@rich4/core';

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

/**
 * 回合开头就被挡、直接进 `turnEnd` 的那一拍（`startTurn` 的 `skip` 支）⇒ 3；否则 0。
 * 走回棋盘 / 被外力挪过（`whoPlays & 0x30`）那一支不接（见文件头）。
 */
export function blockedTurnPauseTicks(before: GameState, after: GameState): number {
  if (after === before || before.phase !== 'turnStart' || after.phase !== 'turnEnd') return 0;
  if (after.currentPlayer !== before.currentPlayer) return 0;
  const me = before.players[before.currentPlayer];
  if (me === undefined) return 0;
  if ((me.whoPlays & (WHO_PLAYS_RETURN_TO_BOARD | WHO_PLAYS_RELOCATED)) !== 0) return 0;
  return BLOCKED_TURN_TICKS;
}

/** 这一条 action 之后换人前要停几个 tick（落点收尾 8 / 被挡的回合 3 / 其余 0）*/
export function turnEndPauseTicks(before: GameState, after: GameState, topo: Pick<MapTopology, 'nodes'>): number {
  return landingPauseTicks(before, after, topo) || blockedTurnPauseTicks(before, after);
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
