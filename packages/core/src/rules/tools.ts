/*
 * 道具的持有与发放
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`give_tool` @ VA 0x00445a4d
 */

import type { Player } from '../state/types.ts';
import { TOOLS } from '@rich4/data';

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
 * 開局發的道具。
 *
 * @source VA 0x00407281 起，对**每个参与的**玩家连发**六次** `give_tool`：
 * ```asm
 * 00407281  push 1 / push ebx / call 0x445a4d     ; 機器娃娃
 * 0040728c  push 2                                 ; 路障
 * 00407297  push 3                                 ; 地雷
 * 004072a2  push 4                                 ; 定時炸彈
 * 004072ad  push 8                                 ; ★ 遙控骰子
 * 004072b8  push 9                                 ; ★ 機器工人
 * ```
 * ⚠️ 先前这里只写了 `[1,2,3,4]` —— 少了 8 与 9 两件。那不是有意简化，
 *   是当时只读到了前四次调用。
 */
export const STARTING_TOOLS: readonly number[] = [1, 2, 3, 4, 8, 9];

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

/**
 * 收走一个道具。
 *
 * @source `take_tool` @ VA 0x00445aa2 —— 与 `give_tool` 完全对称：
 * ```asm
 * eax = player*15 + toolId
 * dl = byte [eax + 0x49915b]
 * test dl,dl / je 结束              ; 没有就什么都不做
 * byte [eax + 0x49915b] = dl - 1
 * cmp ecx, 8 / jg 结束
 * inc byte [ecx + 0x49731f]          ; ★ 编号 ≤ 8 的把库存**还回去**
 * ```
 *
 * ★ 「还库存」这一条很要紧：道具在原版里是**有限资源**，
 *   收走不等于销毁。搶奪卡把道具从一人转到另一人时，
 *   库存先 +1 再 −1，净额不变——这正是它该有的行为。
 */
export function takeTool(
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
  const have = nextTools[at] ?? 0;
  // @source test dl,dl / je 结束
  if (have === 0) return { tools: nextTools, stock: nextStock, given: false };

  nextTools[at] = have - 1;
  // @source cmp ecx, 8 / jg 结束 / inc byte [toolId + 0x49731f]
  if (toolId <= STOCKED_TOOL_MAX_ID) {
    nextStock[toolId] = (nextStock[toolId] ?? 0) + 1;
  }
  return { tools: nextTools, stock: nextStock, given: true };
}

/**
 * 全局库存的初始值。
 *
 * @source `rich4_tool_table.c` 每项的第二个字段：
 *   编号 1..8 各 **10** 份，9..13 为 0。
 *
 * ★ 9..13 的 0 **不表示稀缺**——`give_tool` 对编号 > 8 根本不查库存
 *   （`cmp edx, 8 / jg 跳过`），故它们实际是**不限量**的。
 *   真正有限的是前 8 个。
 */
export function initialToolStock(): number[] {
  const stock = new Array<number>(MAX_TOOL_ID + 1).fill(0);
  for (const t of TOOLS) stock[t.id] = t.initAmount;
  return stock;
}
