/*
 * 「走回棋盘」（刑满释放那一段位移）的**规格几何** —— 起点 / 终点 / 拍数 / 几格
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算纯数据（起终点与拍数），**不碰规则状态、不碰渲染**。
 *   客户端拿它当补间的真值；core 侧没有规则读它。
 *
 * ── 出处（全部逐条读过 `rich4.exe`）─────────────────────────────────────
 *
 * 释放那一回合，原版**不搬人**：`send_to_prison`/`send_to_hospital` 把 `x/y` 写成
 * 特殊景观记录（綠島／醫院大樓）而 `nodeId` 是關押格，两者一直分叉；
 * 走到自己回合开头，`0x418ebd` 的回合推进看到 `+0x15 & 0x10`
 * （`@source 0x418f25 test byte [player+0x15], 0x10`）就**整回合不掷骰**，
 * 由走路例程 `0x40c05c` 的 `0x10` 分支把棋子走回關押格。
 *
 * ## ① 起点 / 终点（`0x40c05c` 的 `dl & 0x10` 分支）
 *
 * ```asm
 * ; @source 0x0040c0b4..0x0040c0e8
 * 0040c0b4  mov  dl, byte [eax + 0x496b7d]     ; dl = player+0x15
 * 0040c0ba  test dl, 0x10 / je 0x40c0ed        ; ★ 只有「走回棋盘」标记走这一支
 * 0040c0c1  dx = word [eax + 0x496b70]         ; ★ 起点 x = player.x（当前贴图位）
 * 0040c0cc  ax = word [eax + 0x496b72]         ;   起点 y = player.y
 * 0040c0dc  eax = word [ebx]                   ; ★ 终点 = node[player.nodeId] 的 +0x00
 * 0040c0e4  eax = word [ebx + 2]               ;   终点 = 同一节点的 +0x02
 * ```
 * `ebx` 在 `0x40c093..0x40c0a1` 由 `player.nodeId` 算出（`[0x498e80] + nodeId*0x28`）
 * ⇒ **终点就是關押格节点坐标**，起点是 `x/y`（在押期间 = 景观记录）。
 *
 * ## ② 几格：**一格**
 *
 * ```asm
 * ; @source 0x0040dd1f（起步函数）的 0x40dd37..0x40dd4a
 * 0040dd37  test byte [edx + 0x496b7d], 0x30
 * 0040dd3e  je   0x40dd53
 * 0040dd40  mov  dword [0x48baf8], 1           ; ★ 只走一格（主循环每格 dec 一次）
 * 0040dd4a  mov  byte [eax + 0x498ea2], 1      ; ★ 摆「走」姿（见下面 ④）
 * ```
 * `[0x48baf8]` 是主循环 `0x40d947..0x40d960` 的**剩余格数**：
 * 非 0 就 `call 0x40c05c`，返回非 0（一格走完）才 `dec`。
 *
 * ## ③ 拍数：`trunc(dist × 0.125)`（**与交通方式无关**）
 *
 * ```asm
 * ; @source 0x0040c239..0x0040c252 —— dist = sqrt(dx² + dy²)（世界坐标）
 * ; @source 0x0040c25d / 0x0040c26d —— 特殊支的判据就是**同一个** +0x15 & 0x30
 * 0040c26d  test byte [eax + 0x496b7d], 0x30
 * 0040c274  je   0x40c282                      ; 普通走法才查速度表 [0x4749d8]
 * 0040c27a  fmul dword [0x4631dc]              ; ★ N_f = dist × 0.125f
 * ; @source 0x0040c304..0x0040c30d —— 向零截断成拍数
 * 0040c308  call 0x457dbc / fistp [0x4749dc]
 * ```
 * `0x40c0ba` 与 `0x40c26d` 读的是**同一个字节**（`player+0x15` = `[eax+0x496b7d]`），
 * 两次读之间没有任何写入（中间唯一的调用 `0x40b93b` 只读不写，见
 * `0x40b96c mov cl, byte [ebp + 0x496b7d]`）⇒ **走回棋盘必然走 `dist × 0.125` 那一支**，
 * 即 8 世界单位/拍，**機車 12 / 汽車 16 也用不上**。
 *
 * ⇒ 出厂图 0001.bin 实测（`gate-walk.test.ts` 逐条钉住）：
 * 醫院關押格 23 `(384,1056)` → 醫院大樓 `(319,990)` = **11 拍**；
 * 監獄關押格 1 `(1752,1871)` → 綠島 `(1817,1960)` = **13 拍**。
 *
 * ## ④ 清账发生在**半程**（不是起手）
 *
 * ```asm
 * ; @source 0x0040c3ab..0x0040c3ea（每拍插值之后）
 * 0040c3ab  test byte [eax + 0x496b7d], 0x30 / je 0x40c410
 * 0040c3b4  edx = [0x4749dc]                   ; 本拍之后还剩几拍
 * 0040c3ba  cmp  edx, [0x48baf4]               ; [0x48baf4] = 总拍数 >> 1（0x40c313）
 * 0040c3c0  jge  0x40c410                      ; ★ 还没过半 ⇒ 不清
 * 0040c3c8  test ch, 0x10 / je 0x40c3d7
 * 0040c3cf  mov  dword [eax + 0x496b9a], 0     ; ★ 走回棋盘：一次清四个阻碍计数
 * ```
 * `0x496b9a` = `player+0x32` = 住宿/消失/監獄/醫院四个字节。
 * ★ 这是**规则态**的写；复刻把它折叠到 `reduce.ts` 的 `startTurn` 入口
 *   （该回合整回合不掷骰，动画期间没有规则读者）—— 详见
 *   `docs/known-deviations.md` 的 D-CONFINE-1 与 `state/reduce.ts` 的 `startTurn`。
 */

import type { LandscapeInfo, MapNode } from '../loaders/map.ts';
import { confinementGateNodeId, gateLandscapeIndex, type ConfinementKind } from './confinement.ts';

/**
 * 特殊支的速度倒数 —— `0.125f`（= 8 世界单位/拍）。
 * @source VA 0x004631dc（`0x3E000000`）；走回棋盘那一支在 `0x0040c27a fmul [0x4631dc]`
 */
export const GATE_WALK_SPEED_RECIP = 0.125;

/**
 * 「走回棋盘」只走**一格**。
 * @source 0x0040dd40 `mov dword [0x48baf8], 1`（起步函数 `0x40dd1f` 的 `+0x15 & 0x30` 支）
 */
export const GATE_WALK_STEPS = 1;

/** 拍数、未截断的拍数 `N_f` 与距离（**世界坐标**） */
export interface GateWalkTicks {
  distance: number;
  /** `dist × 0.125`（原版 `[esp+0x1c]`，每拍位移除的是它） */
  exactTicks: number;
  /** `trunc(exactTicks)`，至少 1（原版 `[0x4749dc]`；`0x40c31f` 把 0 钳到 1） */
  ticks: number;
}

/**
 * 一段位移要走几拍 —— 走回棋盘专用（**无条件**特殊支）。
 *
 * ⚠️ 普通走子请**不要**用本函数：那时原版查速度表 `[0x4749d8]`（见 `client/tween.ts`
 * 的 `tweenTickExact`）。本函数只对应 `player+0x15 & 0x30` 那一支。
 */
export function gateWalkTicks(dx: number, dy: number): GateWalkTicks {
  const distance = Math.hypot(dx, dy);
  const exactTicks = distance * GATE_WALK_SPEED_RECIP;
  const n = Math.trunc(exactTicks);
  return { distance, exactTicks, ticks: n < 1 ? 1 : n };
}

/** 「走回棋盘」一段位移的完整规格（纯数据） */
export interface GateWalkPlan extends GateWalkTicks {
  kind: ConfinementKind;
  /** 起点 = 在押期间的贴图位置（景观记录；`0x40c0c1/0x40c0cc`） */
  from: { x: number; y: number };
  /** 终点 = 關押格节点坐标（`0x40c0dc/0x40c0e4`） */
  to: { x: number; y: number };
  /** 关押格的节点号（`[0x48bae0]`/`[0x48bae2]` → 本引擎的 `type` 判据） */
  gateNodeId: number;
  /** 走几格（恒 `GATE_WALK_STEPS` = 1） */
  steps: number;
}

/**
 * 按地图算出这一种关押的「走回棋盘」规格；景观表或關押格缺失 ⇒ `null`。
 *
 * @param nodes      `MapTopology.nodes`（下标 = 节点号 − 1）
 * @param landscapes `MapTopology.landscapes`（0 基，记录 1 = 下标 0）
 */
export function gateWalkPlan(
  kind: ConfinementKind,
  nodes: readonly MapNode[],
  landscapes: readonly LandscapeInfo[] | undefined,
): GateWalkPlan | null {
  const gateNodeId = confinementGateNodeId(nodes, kind);
  if (gateNodeId <= 0) return null;
  const gate = nodes[gateNodeId - 1];
  const land = landscapes?.[gateLandscapeIndex(kind)];
  if (gate === undefined || land === undefined) return null;
  return gateWalkPlanFrom(kind, gateNodeId, { x: land.x, y: land.y }, gate);
}

/**
 * 同上，但**起点由调用方给**（真实调用方给的是 `player.xpos/ypos` —— 释放那一刻
 * 它正是景观记录坐标，`@source 0x43d643/0x43d652`）。用于把补间的起点钉在
 * **玩家当时真正在的地方**，而不是从地图表反推。
 */
export function gateWalkPlanFrom(
  kind: ConfinementKind,
  gateNodeId: number,
  from: { x: number; y: number },
  gate: MapNode,
): GateWalkPlan {
  const t = gateWalkTicks(gate.x - from.x, gate.y - from.y);
  return {
    kind,
    from: { x: from.x, y: from.y },
    to: { x: gate.x, y: gate.y },
    gateNodeId,
    steps: GATE_WALK_STEPS,
    ...t,
  };
}
