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
 * ★ C-ARC-2 / C-DET-4：只决定「回合驱动什么时候可以派下一步」，不读写规则。
 */

import type { GameState, MapTopology } from '@rich4/core';

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
