/*
 * 傳送機（道具 11）—— 搬地產、搬設施、搬人
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 它不是「传送到某一格」那么简单。`rich4_tool_chuansongji.asm` 里按
 *   选择器返回的**编码**分三路（VA 0x0044748b 起）：
 *
 * ```asm
 * cmp ebp, 0x7d0 / jle …        ; > 2000 且
 * cmp ebp, 0xfa0 / jge …        ;   < 4000 → 住宅地，下标 = v − 2000
 * cmp ecx, 0xfa0 / jle …        ; > 4000 且
 * cmp ecx, 0x1770 / jge …       ;   < 6000 → 設施，下标 = v − 4000
 * test byte [esp+0x1d], 0x80    ; 最高位 → 玩家/物件位图
 * ```
 *
 * 三路各干各的：
 *
 * **地產 → 地產**（0x004474a9）把**整块地搬走**，源头清零：
 * ```asm
 * bl = [源+0x19] ; [目标+0x19] = bl ; [源+0x19] = 0      ; owner
 * bl = [源+0x1a] ; [目标+0x1a] = bl ; [源+0x1a] = 0      ; level
 * bl = [源+0x18] ; [目标+0x18] = bl ; [源+0x18] = 0      ; ★ type 也搬
 * ecx = [源+0x30] ; [目标+0x30] = ecx ; [源+0x30] = 0
 * [源+0x2c] = 0
 * ```
 *
 * **設施 → 設施**（0x0044759e）同理，步长 0x38，字段 +0x19/+0x1a/+0x18/+0x34。
 *
 * **玩家/物件 → 格子**（0x0044761c）：选一个节点，再**挑一个朝向**，
 * 让它落地之后还是朝着原来那个大方向走（见 `pickFacingAt`）。
 */

import { syncEscortNodes } from './object-landing.ts';
import type { GameState } from '../state/types.ts';
import type { MapNode } from '../loaders/map.ts';
import { placeOnNode } from './position.ts';
import { directionOf, linkBlockedMask } from '../state/reduce.ts';

/** 傳送機道具编号 */
export const TOOL_TELEPORTER = 11;

/**
 * 选择器的编码 —— 三种目标共用一个 int。
 * @source 上面那几条 `cmp` 的立即数
 */
export const TELEPORT_LAND_BASE = 0x7d0;
export const TELEPORT_FACILITY_BASE = 0xfa0;
export const TELEPORT_FACILITY_END = 0x1770;

export type TeleportTarget =
  | { kind: 'land'; index: number }
  | { kind: 'facility'; index: number }
  | { kind: 'node'; nodeId: number }
  | null;

/** 把选择器的编码解开 */
export function decodeTeleport(v: number): TeleportTarget {
  if (v > TELEPORT_LAND_BASE && v < TELEPORT_FACILITY_BASE) {
    return { kind: 'land', index: v - TELEPORT_LAND_BASE };
  }
  if (v > TELEPORT_FACILITY_BASE && v < TELEPORT_FACILITY_END) {
    return { kind: 'facility', index: v - TELEPORT_FACILITY_BASE };
  }
  return null;
}

/**
 * 落地之后朝哪边。
 *
 * @source VA 0x00447705 的那个循环：把目标格**可走的邻居**都试一遍，
 * 算出「从目标格朝这个邻居」的方位，取与原朝向**圆周距离最小**的那个：
 * ```asm
 * eax = 原朝向 − 该方位 ; call abs
 * cmp eax, 4 / jle 保留          ; ≤ 4 直接用
 * edi = min(原朝向, 该方位) + 8
 * edx = max(原朝向, 该方位)
 * edi -= edx                      ; = 8 − |差| ，绕另一边更近
 * ```
 * 也就是标准的八向圆周距离 `min(|d|, 8 − |d|)`。
 *
 * 返回 `null` 表示那一格四周无路可走。
 */
export function pickFacingAt(
  nodes: readonly MapNode[],
  targetNodeId: number,
  currentDirection: number,
): { direction: number; toward: number; from: number } | null {
  const node = nodes[targetNodeId - 1];
  if (node === undefined) return null;

  // @source 0x004476af：空槽与被封的槽都不算
  const candidates: number[] = [];
  for (let slot = 0; slot < 4; slot++) {
    const n = node.adjacentSlots[slot] ?? 0;
    if (n === 0) continue;
    if ((node.flags & linkBlockedMask(slot)) !== 0) continue;
    candidates.push(n);
  }
  if (candidates.length === 0) return null;

  let bestIdx = 0;
  let bestDist = 8;
  let bestDir = currentDirection;
  for (let i = 0; i < candidates.length; i++) {
    const other = nodes[candidates[i]! - 1];
    if (other === undefined) continue;
    const dir = directionOf(other.x - node.x, other.y - node.y);
    const raw = Math.abs(currentDirection - dir);
    const dist = raw <= 4 ? raw : 8 - raw;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      bestDir = dir;
    }
  }

  const toward = candidates[bestIdx]!;
  // @source 0x0044777e：`last_node` 取**第一个与最佳邻居不同的**候选，
  //   这样下一步自然朝最佳邻居走。只有一个候选时就取它本身。
  let from = toward;
  if (candidates.length > 1) {
    for (const c of candidates) {
      if (c !== toward) {
        from = c;
        break;
      }
    }
  }
  return { direction: bestDir, toward, from };
}

/**
 * 把一块地整个搬到另一块地上。
 *
 * @source 0x004474a9 —— **源头会被清空**，等于「这块地连房子带归属一起搬家」。
 */
export function teleportLand(state: GameState, from: number, to: number): GameState | null {
  if (from === to) return null;
  const owner = state.landOwner[from] ?? 0;
  // 空地没什么好搬的
  if (owner === 0) return null;
  // ★ 目标必须是**无主、0 级**的空地（真人拾取子类 8：`0x0044658c` owner == 0 且 level == 0）
  if ((state.landOwner[to] ?? 0) !== 0 || (state.landLevel[to] ?? 0) !== 0) return null;
  const landOwner = [...state.landOwner];
  const landLevel = [...state.landLevel];
  const landType = [...state.landType];
  const landTenure = [...state.landTenure];
  const landLastToll = [...state.landLastToll];
  landOwner[to] = owner;
  landLevel[to] = state.landLevel[from] ?? 0;
  landType[to] = state.landType[from] ?? 0;
  // ★★ 到期日随地搬走、源的「上次過路費」清零 —— 先前漏了这两句
  //   @source 0x00447546 mov ecx,[源+0x30] / 0x00447549 mov [标+0x30],ecx / 0x0044754c mov [源+0x30],0 /
  //           0x00447553 mov dword [源+0x2c], 0
  landTenure[to] = state.landTenure[from] ?? 0;
  landOwner[from] = 0;
  landLevel[from] = 0;
  landType[from] = 0;
  landTenure[from] = 0;
  landLastToll[from] = 0;
  return { ...state, landOwner, landLevel, landType, landTenure, landLastToll };
}

/**
 * 把一处設施整个搬到另一处設施上 —— 与 `teleportLand` 同构，多搬一项**到期日**。
 *
 * @source VA 0x004475d8 起（在 `rich4.exe` 里逐行对过）：
 * ```asm
 * 004475d8  mov bl, [源 + 0x19] / mov [标 + 0x19], bl / mov [源 + 0x19], 0    ; owner
 * 004475e5  mov bl, [源 + 0x1a] / mov [标 + 0x1a], bl / mov [源 + 0x1a], 0    ; level
 * 004475f2  mov bl, [源 + 0x18] / mov [标 + 0x18], bl / mov [源 + 0x18], 0    ; type
 * 004475ff  mov ecx,[源 + 0x34] / mov [标 + 0x34], ecx / mov [源 + 0x34], 0   ; 地契到期日
 * 0044760f  mov dword [源 + 0x30], 0                                         ; ★ 上次過路費：只清源，不搬
 * ```
 * ⚠️ rich4-re 的 `rich4_tool_chuansongji.asm` 140..173 行**漏了最后那一句**——
 *   又一处 C 级线索与 exe 不符。新址的 `+0x30` 保持原样（不写），
 *   所以間諜在搬来的新址取到的是**新址原来那笔**，在空掉的旧址什么也取不到。
 */
export function teleportFacility(state: GameState, from: number, to: number): GameState | null {
  if (from === to) return null;
  const owner = state.facilityOwner[from] ?? 0;
  if (owner === 0) return null;
  // ★ 目标同样要**无主、0 级**（拾取子类 8，`0x0044658c`）
  if ((state.facilityOwner[to] ?? 0) !== 0 || (state.facilityLevel[to] ?? 0) !== 0) return null;
  const facilityOwner = [...state.facilityOwner];
  const facilityLevel = [...state.facilityLevel];
  const facilityType = [...state.facilityType];
  const facilityTenure = [...state.facilityTenure];
  const facilityLastToll = [...state.facilityLastToll];
  facilityOwner[to] = owner;
  facilityLevel[to] = state.facilityLevel[from] ?? 0;
  facilityType[to] = state.facilityType[from] ?? 0;
  facilityTenure[to] = state.facilityTenure[from] ?? 0;
  facilityOwner[from] = 0;
  facilityLevel[from] = 0;
  facilityType[from] = 0;
  facilityTenure[from] = 0;
  facilityLastToll[from] = 0;
  return { ...state, facilityOwner, facilityLevel, facilityType, facilityTenure, facilityLastToll };
}

/**
 * 把一个玩家传送到某一格。
 *
 * @source 0x004477e2：写 `node_id`、`last_node_id`、`direction`、`xpos/ypos`，
 * 并把占用位从旧格挪到新格。
 */
export function teleportPlayer(
  state: GameState,
  nodes: readonly MapNode[],
  playerIndex: number,
  targetNodeId: number,
): GameState | null {
  const p = state.players[playerIndex];
  const node = nodes[targetNodeId - 1];
  if (p === undefined || node === undefined) return null;
  if (p.nodeId === targetNodeId) return null;
  const facing = pickFacingAt(nodes, targetNodeId, p.direction);
  if (facing === null) return null;
  const moved = placeOnNode({ ...p, lastNodeId: facing.from, direction: facing.direction }, node);
  return {
    ...state,
    players: state.players.map((x, i) => (i === playerIndex ? moved : x)),
    // ★ 身上的神明 / 炸彈跟着搬（`0x00447844 call 0x40fc00`）
    objects: syncEscortNodes(state.objects, moved),
  };
}
