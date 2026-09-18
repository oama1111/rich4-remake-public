/*
 * 转向卡 / 换屋卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 */

import type { Player } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode } from '../loaders/map.ts';
import type { SpecialActor } from '../rules/special-actors.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import { linkBlockedMask } from '../state/reduce.ts';

// ============================================================
//  转向卡（6）
// ============================================================

/** 转向卡的选择参数 @source `push 0xe0c0010` —— anyPlayer 组，**可对自己用** */
export const TURN_SELECTION_PARAM = 0xe0c0010;

/** 方向的取值个数（8 方向） */
export const DIRECTION_COUNT = 8;
/** 掉头的偏移量 = 半圈 */
export const TURN_AROUND_OFFSET = 4;

/**
 * 掉头：在 8 个方向中转 180 度。
 *
 * @source `_rich4_change_player_direction` VA 0x0040c7c0:
 * ```asm
 * mov dl, byte [player + 0x10]    ; direction
 * add dl, 4
 * and dl, 7                        ; ★ (direction + 4) & 7
 * mov byte [player + 0x10], dl
 * ```
 */
export function turnAround(direction: number): number {
  return (direction + TURN_AROUND_OFFSET) & (DIRECTION_COUNT - 1);
}

export interface TurnResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
}

/** 同格四槽的拜访顺序（与原版 `for (slot=0..3)` 同序）*/
const SLOT_ORDER = [0, 1, 2, 3] as const;

/**
 * 掉头后**重挑「来路」**：原版 `0x40c78c` 的 0x40c7ea..0x40c859（玩家）与
 * 0x40c8a2..0x40c903（替身）两段同构。
 *
 * @source
 * ```asm
 * 0040c824  word [esp + ebx*2] = ax ; ebx++    ; 收候选（顺序 = 槽 0..3）
 * 0040c830  test ebx,ebx / je 0x40c850
 * 0040c834  call 0x456f2d                      ; ★ rand()
 * 0040c83e  idiv ebx                           ;   余数
 * 0040c840  ax = word [esp + edx*2]            ;   last_node = 候选[余数]
 * 0040c850  （无候选）last_node = 0
 * ```
 * 三个筛子（顺序也照原版）：`adjacent[slot] != 0`、**该槽未封路**
 * （`node.flags & (0x40000000 >> slot)`）、`!= 旧的 last_node`。
 *
 * ★ 这一笔是**规则可见**的：`pickNextNode` 会避开 `last_node`，
 * 所以"掉头"= 换一个方向走回去。
 * 通道 2 证据：`rich4-spec/tests/test_turn_around.py`（23/23）。
 */
export function pickTurnBackNode(
  node: MapNode,
  oldLastNode: number,
  draw: () => number,
): number {
  const candidates: number[] = [];
  for (const slot of SLOT_ORDER) {
    const n = node.adjacentSlots[slot] ?? 0;
    if (n === 0) continue;
    if ((node.flags & linkBlockedMask(slot)) !== 0) continue;
    if (n === oldLastNode) continue;
    candidates.push(n);
  }
  // ★ `rand()` 只在**有候选**时才掷（原版 `test ebx,ebx / je 0x40c850` 先判后掷）——
  //   这条直接决定全局随机流的位置，不能多掷也不能少掷。
  if (candidates.length === 0) return 0;
  return candidates[(draw() >>> 0) % candidates.length] ?? 0;
}

/**
 * 转向卡：让目标玩家掉头（并重挑来路）。
 *
 * 选择参数属 anyPlayer 组，**可以对自己使用**（原版在目标为自己时
 * 会说另一句台词，效果照常生效）。
 *
 * @param nodes 地图节点表（`MapTopology.nodes`，下标 = 节点号 − 1）。
 *              **缺省时只掉头、不重挑来路**（旧调用点与老用例的兼容行为）。
 * @param draw  `rand()` 出口（**只在有候选时**会被调用一次）。缺省恒 0 ⇒ 取第 0 个候选。
 */
export function applyTurnCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
  nodes?: readonly MapNode[],
  draw: () => number = () => 0,
): TurnResult {
  const cls = targetClassOf(TURN_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  if (error !== null) return { ok: false, error, players: [...players] };
  if (target.kind !== 'player') {
    return { ok: false, error: 'wrongTargetKind', players: [...players] };
  }
  const next = players.map((p, i) => {
    if (i !== target.index) return p;
    const flipped = { ...p, direction: turnAround(p.direction) };
    if (nodes === undefined) return flipped;
    const node = nodes[p.nodeId - 1];
    if (node === undefined) return { ...flipped, lastNodeId: 0 };
    return { ...flipped, lastNodeId: pickTurnBackNode(node, p.lastNodeId, draw) };
  });
  return { ok: true, error: null, players: next };
}

/**
 * 转向卡对**特殊棋子**：与玩家同构，只是换 `0x498e28 + (target−4)*0x10` 那张表
 * （`@source` 见 `pickTurnBackNode`；朝向在 `+9`、`nodeId` 在 `+4`、`last_node` 在 `+6`）。
 *
 * @param nodes 缺省时只掉头（兼容旧调用点）
 */
export function applyTurnCardToActor(
  actor: SpecialActor,
  nodes?: readonly MapNode[],
  draw: () => number = () => 0,
): SpecialActor {
  const flipped = { ...actor, direction: turnAround(actor.direction) };
  if (nodes === undefined) return flipped;
  const node = nodes[flipped.nodeId - 1];
  if (node === undefined) return { ...flipped, lastNodeId: 0 };
  return { ...flipped, lastNodeId: pickTurnBackNode(node, actor.lastNodeId, draw) };
}

// ============================================================
//  换屋卡（5）
// ============================================================

/** 换屋卡的选择参数 —— 与换地卡同一对：脚下地块 0xe0c0202 / 脚下設施 0xe0c0204 */
export const SWAP_HOUSE_SELECTION_PARAM = 0xe0c0202;
export const SWAP_HOUSE_FACILITY_SELECTION_PARAM = 0xe0c0204;

/**
 * 换屋卡：**交换两处房产的房子（种类 + 等级），归属不变**。
 *
 * @source 两处房产共用的助手 `0x40b4f8`，其尾部（地块分支 0x0040b6c5、
 *   設施分支 0x0040b8aa 完全同形）：
 * ```asm
 * mov al, byte [ebx + 0x1a]      ; 脚下.等级
 * mov ah, byte [esi + 0x1a]      ; 选中.等级
 * mov byte [ebx + 0x1a], ah
 * mov byte [esi + 0x1a], al      ; ★ 等级互换
 * mov al, byte [ebx + 0x18]      ; 脚下.种类
 * mov ah, byte [esi + 0x18]      ; 选中.种类
 * mov byte [ebx + 0x18], ah
 * mov byte [esi + 0x18], al      ; ★ 种类也互换（住宅 ↔ 连锁店）
 * ```
 * 前段那几十条浮点指令只是「两个图标相向飞过去」的动画（`0x40b555..0x40b6a2`），
 * core 不复刻。
 *
 * ⚠️ 与换地卡的区别（易混）：
 *   换地卡 → 换 **owner**（`+0x19`），房子随地走
 *   换屋卡 → 换 **type + level**（`+0x18` / `+0x1a`），地还是各自的
 *
 * ⚠️ 先前这里只换 `level`，漏了 `+0x18`（住宅/连锁店）；两条分支同改。
 */
export function applySwapHouseCard(
  lands: readonly LandInfo[],
  landIdA: number,
  landIdB: number,
): { lands: LandInfo[]; ok: boolean } {
  const a = lands.find((l) => l.id === landIdA);
  const b = lands.find((l) => l.id === landIdB);
  if (a === undefined || b === undefined || landIdA === landIdB) {
    return { lands: [...lands], ok: false };
  }
  const next = lands.map((l) => {
    if (l.id === landIdA) return { ...l, level: b.level, type: b.type };
    if (l.id === landIdB) return { ...l, level: a.level, type: a.type };
    return l;
  });
  return { lands: next, ok: true };
}

/**
 * 换屋卡对**設施**：同一处助手 `0x40b4f8` 的設施分支（VA 0x0040b880 起），
 * 交换 **种类 `+0x18` 与等级 `+0x1a`**，归属 `+0x19` 不动。
 *
 * @source
 * ```asm
 * mov al, byte [esi + 0x1a] / mov ah, byte [ebx + 0x1a]
 * mov byte [esi + 0x1a], ah / mov byte [ebx + 0x1a], al    ; 等级互换
 * mov al, byte [esi + 0x18] / mov ah, byte [ebx + 0x18]
 * mov byte [esi + 0x18], ah / mov byte [ebx + 0x18], al    ; 种类互换
 * ```
 *
 * ⚠️ 种类互换意味着 **旅館 ↔ 購物中心 ↔ 加油站 ↔ 研究所** 都会换（公園也照换），
 *   等级上限表（`FACILITY_MAX_LEVEL`）**不参与校验** —— 原版就是这么写的，
 *   照搬不做「改良」。
 */
export function applySwapHouseFacilityCard(
  facilities: readonly FacilityInfo[],
  facilityIdA: number,
  facilityIdB: number,
): { facilities: FacilityInfo[]; ok: boolean } {
  const a = facilities.find((f) => f.id === facilityIdA);
  const b = facilities.find((f) => f.id === facilityIdB);
  if (a === undefined || b === undefined || facilityIdA === facilityIdB) {
    return { facilities: [...facilities], ok: false };
  }
  const next = facilities.map((f) => {
    if (f.id === facilityIdA) return { ...f, level: b.level, type: b.type };
    if (f.id === facilityIdB) return { ...f, level: a.level, type: a.type };
    return f;
  });
  return { facilities: next, ok: true };
}
