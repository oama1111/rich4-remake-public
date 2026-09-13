/*
 * 道具的持有与发放
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`give_tool` @ VA 0x00445a4d
 */

import type { Player } from '../state/types.ts';

/**
 * 每个玩家的道具槽位数。
 *
 * @source `give_tool` 的寻址：
 * ```asm
 * ecx = player
 * eax = ecx<<2 + ecx        ; 5p
 * ecx = eax
 * eax = eax<<2 - ecx        ; ★ 15p
 * byte [edx + eax + 0x49915b]
 * ```
 * 即 `tools[player * 15 + toolId]`。
 *
 * ⚠️ 道具编号是 **1..13**（见 @rich4/data 的 TOOLS），
 * 槽 0 与 14 不用。先前把数组长度写成 13 是错的——
 * 那会让 13 号「核子飛彈」越界。
 */
export const TOOL_SLOTS_PER_PLAYER = 15;

/** 道具编号范围 */
export const MIN_TOOL_ID = 1;
export const MAX_TOOL_ID = 13;

/**
 * 每种道具的持有上限。
 * @source `cmp byte [player*15 + toolId + 0x49915b], 9 / jae 放弃`
 */
export const MAX_TOOL_COUNT = 9;

/**
 * 编号 ≤ 8 的道具有**全局库存**，用完就发不出来了。
 *
 * @source `cmp edx, 8 / jg 跳过库存检查`，
 *   命中则查 `byte [toolId + 0x0049731f]`，为 0 直接放弃，否则减 1。
 *
 * 即 機器娃娃(1) / 路障(2) / 地雷(3) / 定時炸彈(4) / 機車(5) /
 * 汽車(6) / 飛彈(7) / 遙控骰子(8) 受库存限制；
 * 9..13（機器工人/時光機/傳送機/工程車/核子飛彈）不受限。
 */
export const STOCKED_TOOL_MAX_ID = 8;

/**
 * 开局发给每个玩家的道具。
 *
 * @source 开局循环 VA 0x0040727f 起，对每个在场玩家连续四次：
 * ```asm
 * push 1 / push ebx / call 0x445a4d
 * push 2 / push ebx / call 0x445a4d
 * push 3 / push ebx / call 0x445a4d
 * push 4 / push ebx / call 0x445a4d
 * ```
 * 即 機器娃娃、路障、地雷、定時炸彈 各一个。
 */
export const STARTING_TOOLS: readonly number[] = [1, 2, 3, 4];

export interface GiveToolResult {
  tools: number[];
  stock: number[];
  /** 是否真的发出去了 */
  given: boolean;
}

/**
 * 发一个道具。
 *
 * 原版全文（VA 0x00445a4d）：
 * ```asm
 * edx = toolId ; ecx = player
 * cmp byte [player*15 + toolId + 0x49915b], 9
 * jae 结束                                  ; ★ 已有 9 个则不发
 * cmp edx, 8
 * jg  跳过库存                              ; 编号 > 8 不查库存
 * bh = byte [toolId + 0x49731f]
 * test bh, bh / je 结束                     ; ★ 库存为 0 则不发
 * byte [toolId + 0x49731f] = bh - 1
 * 跳过库存:
 * inc byte [player*15 + toolId + 0x49915b]
 * ```
 *
 * ⚠️ 注意上限检查在**库存扣减之前**：已满 9 个时不会白白消耗库存。
 */
export function giveTool(
  tools: readonly number[],
  stock: readonly number[],
  player: number,
  toolId: number,
): GiveToolResult {
  const nextTools = [...tools];
  const nextStock = [...stock];
  const at = player * TOOL_SLOTS_PER_PLAYER + toolId;

  if (toolId < MIN_TOOL_ID || toolId > MAX_TOOL_ID) {
    return { tools: nextTools, stock: nextStock, given: false };
  }
  // @source cmp ..., 9 / jae 结束
  if ((nextTools[at] ?? 0) >= MAX_TOOL_COUNT) {
    return { tools: nextTools, stock: nextStock, given: false };
  }
  // @source cmp edx, 8 / jg 跳过
  if (toolId <= STOCKED_TOOL_MAX_ID) {
    const have = nextStock[toolId] ?? 0;
    if (have === 0) return { tools: nextTools, stock: nextStock, given: false };
    nextStock[toolId] = have - 1;
  }
  nextTools[at] = (nextTools[at] ?? 0) + 1;
  return { tools: nextTools, stock: nextStock, given: true };
}

/** 读某玩家某道具的持有量 */
export function toolCount(tools: readonly number[], player: number, toolId: number): number {
  return tools[player * TOOL_SLOTS_PER_PLAYER + toolId] ?? 0;
}

/** 新建一个全零的道具数组 */
export function emptyTools(playerCount: number): number[] {
  return new Array<number>(playerCount * TOOL_SLOTS_PER_PLAYER).fill(0);
}

/** 玩家持有的道具清单（编号 → 数量），只列非零项 */
export function toolsOf(tools: readonly number[], player: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let id = MIN_TOOL_ID; id <= MAX_TOOL_ID; id++) {
    const n = toolCount(tools, player, id);
    if (n > 0) out.set(id, n);
  }
  return out;
}

/** 某玩家是否持有该道具 */
export function hasTool(p: Player, tools: readonly number[], toolId: number): boolean {
  return toolCount(tools, p.index, toolId) > 0;
}
