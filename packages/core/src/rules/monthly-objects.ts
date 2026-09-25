/*
 * 跨月时把禮物 / 寶箱挪到别处（被拿走的也借此重新登场）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 日推进 `fcn_0041cf67`，月結（`0x0041d09e call 0x439bfa`）紧接着那一段 —— 同在
 *   `0x0041d099 cmp edi, 1 / jne 0x41d0ff`（跨月）的守卫里：
 * ```asm
 * 0041d0a5  mov  bx, word [0x496e2a]         ; 物件[12]（種類 13 禮物）的所在格（+0x02），**先读**
 * 0041d0ac  push 0xd / call 0x40e14d          ; release_object(13) —— 收回（地上有就清格；已被拿走就是空操作）
 * 0041d0bb  push ebx / call 0x40aa6c          ; 挑一格：候选 = 可放物件、没人没物件（`0x80ffff00`）、非孤立格；
 *                                             ;   参照点 = 原格 ⇒ 两轴都 < 300 就重抽（原格 0 ⇒ 一次就收）
 * 0041d0c6  push eax / push 0xd / call 0x40e033   ; place_object(13, 新格, 0, 0)
 * 0041d0d0  mov  bx, word [0x496e42]         ; 物件[13]（種類 14 寶箱）—— 同上一遍
 * 0041d0d7  push 0xe / call 0x40e14d
 * 0041d0e6  push ebx / call 0x40aa6c
 * 0041d0f1  push eax / push 0xe / call 0x40e033
 * 0041d0f9  add  [0x499084], edi              ; 總月數 +1
 * ```
 *
 * ★ 这是禮物 / 寶箱**唯一**的重新登场路径：落点拿走它们（`0x0041b936` / 寶箱那一支 `push 0xe / call 0x40e14d`）
 *   都只收回、不再放 —— 先前本引擎没有这一段，禮物 / 寶箱被拿过一次就再也不出现。
 */

import type { Player } from '../state/types.ts';
import type { SpecialActor } from './special-actors.ts';
import type { MapObject } from '../cards/summon.ts';
import {
  OBJECT_TYPE_GIFT,
  OBJECT_TYPE_TREASURE,
  objectNodeCandidates,
  pickObjectNodeDistant,
  placeObjectOfType,
  releaseObject,
  runtimeOccupiedNodes,
} from './object-landing.ts';

/** 跨月重摆的那两件（按原版的先后：禮物、寶箱）@source `0x0041d0ac push 0xd` / `0x0041d0d7 push 0xe` */
export const MONTHLY_RELOCATED_OBJECTS: readonly number[] = [OBJECT_TYPE_GIFT, OBJECT_TYPE_TREASURE];

export interface MonthlyObjectWorld {
  players: readonly Player[];
  objects: readonly MapObject[];
  tools: readonly number[];
  toolStock: readonly number[];
  specialActors: readonly SpecialActor[];
}

/**
 * 跨月重摆禮物 / 寶箱。每件：记下原格 → 收回 → 以原格为参照挑远处一格（`rand()`，可能多次）→ 放下。
 *
 * @param nodes 地图节点（`MapTopology.nodes`）
 * @param draw  取一个 15 位随机数（调用方持 PRNG）
 */
export function relocateMonthlyObjects(
  world: MonthlyObjectWorld,
  nodes: readonly { id: number; x: number; y: number; walkable: boolean; noObjects: boolean }[],
  draw: () => number,
): { objects: MapObject[]; players: Player[]; tools: number[]; toolStock: number[] } {
  let players = world.players.map((p) => ({ ...p }));
  let objects = world.objects.map((o) => ({ ...o }));
  let tools = [...world.tools];
  let toolStock = [...world.toolStock];
  const xy = (id: number): { x: number; y: number } | null => {
    const n = nodes[id - 1];
    return n === undefined ? null : { x: n.x, y: n.y };
  };
  for (const type of MONTHLY_RELOCATED_OBJECTS) {
    // 唯一物件：槽位 = 種類 − 1，handle = 種類（`rules/objects.ts` 的 OBJECT_TYPE_TABLE）
    const former = objects[type - 1]?.nodeId ?? 0;
    const rel = releaseObject({ players, objects, tools, toolStock }, type);
    players = rel.players;
    objects = rel.objects;
    tools = rel.tools;
    toolStock = rel.toolStock;
    // @source 0x0040aa37 `test [node+0x24], 0x80ffff00`：静态禁放 + 有人站 + 有物件（刚收回的那一格已空出来）
    const occupied = runtimeOccupiedNodes(players, objects, world.specialActors);
    const spots = objectNodeCandidates(nodes).filter((n) => !occupied.has(n));
    const node = pickObjectNodeDistant(spots, former, xy, draw);
    if (node === 0) continue;
    objects = placeObjectOfType(objects, type, node).objects;
  }
  return { objects, players, tools, toolStock };
}
