/*
 * 变卖手牌与道具 —— 「變賣所有卡片道具」与破产清算共用
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 两个函数是**一对**，原版里总是连着调：
 *
 * | 场景 | @source |
 * |---|---|
 * | 命運事件 32「變賣所有卡片道具」 | `rich4_fortune.asm` `fcn_0044d677` |
 * | 破产清算（非终局路径）| `rich4_player_bankrupt.asm:412-417` |
 * | 財神 / 魔法屋的没收分支 | `rich4_gods.asm:1190` / `rich4_magic_house.asm:562` |
 *
 * ```asm
 * ; _rich4_player_sell_all_tools @ VA 0x00445b3f（返回值在 eax）
 * 00445b49  dl = player[+0x11]                 ; traffic_method
 * 00445b51  if (dl == 0) 跳到卖道具
 * 00445b55  bl = dl & 3
 * 00445b66  bl == 1 → [player*15 + 0x499160] += bl   ; ★ 座驾折回**道具 5**（機車）
 * 00445b81  bl == 2 → [player*15 + 0x499161]++       ; 道具 6 汽車
 * 00445b89  bl == 3 → [player*15 + 0x499167]++       ; 道具 12 工程車
 * 00445b8f  player[+0x11] = 0 ; player[+0x12] = 1    ; 下车、退回一颗骰子
 * 00445bb0  for (eax = 0; eax < 0xd; eax++) {        ; 道具 1..13
 *             cl = [player*15 + eax + 0x49915c]      ; 持有量（0x49915b 是空槽 0）
 *             if (cl == 0) continue
 *             if (eax < 8) [eax + 0x497320] += cl    ; ★ 编号 ≤ 8 才回商店库存
 *             ebx += byte [eax*8 + 0x47fee7] × cl    ; ★ 表项 +5 = **price**
 *             [player*15 + eax + 0x49915c] = 0
 *           }
 *
 * ; _rich4_player_sell_all_the_card @ VA 0x00441f21（返回值在 eax）
 * 00441f33  for (ecx = 0; ecx < 0xf; ecx++) {        ; 15 个手牌槽
 *             dl = player_cards[player*15 + ecx]
 *             if (dl == 0) continue
 *             [dl + 0x499197] += 1                   ; ★ 卡片回商店库存
 *             ebx += byte [dl*8 + 0x47fdef] × 1      ; ★ 卡表 +5 = price
 *             player_cards[player*15 + ecx] = 0
 *           }
 * ```
 *
 * ⇒ 两边的「卖价」都是**原价**（道具表的 price / 卡片表的 price），
 *   单位是**點券**：事件 32 的调用方把两次返回各 `add word [player+0x30], ax`。
 *
 * ⚠️ 原版这两支**不看物价指数**，也不打折 —— 卖价就是原价。
 */

import { TOOLS, cardById } from '@rich4/data';
import type { Player } from '../state/types.ts';
import {
  MAX_TOOL_ID,
  MIN_TOOL_ID,
  STOCKED_TOOL_MAX_ID,
  TOOL_SLOTS_PER_PLAYER,
} from './tools.ts';

/**
 * 座驾 → 道具编号 @source `[0x499160/0x499161/0x499167]` 三个落点。
 *
 * `traffic_method & 3` 为 1/2/3 时分别是 **5 機車 / 6 汽車 / 12 工程車**；
 * 0（走路）没有对应的道具，只把 `traffic_method` 清零。
 */
export const VEHICLE_TOOL: ReadonlyMap<number, number> = new Map([
  [1, 5],
  [2, 6],
  [3, 12],
]);

export interface SellAllToolsResult {
  player: Player;
  tools: number[];
  toolStock: number[];
  /** 变卖所得（**點券**）*/
  points: number;
}

/**
 * 变卖一名玩家的全部道具（含先把座驾折回道具）。
 *
 * @source `_rich4_player_sell_all_tools` @ VA 0x00445b3f
 * @param tools `state.tools`（`tools[player * 15 + toolId]`）
 * @param toolStock `state.toolStock`（下标 = 道具号，只有 1..8 受库存限制）
 */
export function sellAllTools(
  player: Player,
  tools: readonly number[],
  toolStock: readonly number[],
): SellAllToolsResult {
  const out = [...tools];
  const stock = [...toolStock];
  let points = 0;
  let p = player;

  // ① 座驾先折回道具（原版在卖道具**之前**做，于是那台车也会被卖掉）
  const kind = p.trafficMethod & 3;
  if (p.trafficMethod !== 0) {
    const asTool = VEHICLE_TOOL.get(kind);
    if (asTool !== undefined) {
      const at = p.index * TOOL_SLOTS_PER_PLAYER + asTool;
      out[at] = (out[at] ?? 0) + 1;
    }
    // @source mov byte [player+0x11], 0 / mov byte [player+0x12], 1
    p = { ...p, trafficMethod: 0, ndices: 1 };
  }

  // ② 逐件卖掉
  for (let id = MIN_TOOL_ID; id <= MAX_TOOL_ID; id++) {
    const at = p.index * TOOL_SLOTS_PER_PLAYER + id;
    const n = out[at] ?? 0;
    if (n <= 0) continue;
    // @source cmp eax, 8 / jge 跳过 —— 编号 ≤ 8 的把库存**还回去**
    if (id <= STOCKED_TOOL_MAX_ID) stock[id] = (stock[id] ?? 0) + n;
    points += n * toolPrice(id);
    out[at] = 0;
  }

  return { player: p, tools: out, toolStock: stock, points };
}

/** 道具卖价 = 道具表的 `price` @source `byte [eax*8 + 0x47fee7]`（表项 +5）*/
export function toolPrice(toolId: number): number {
  return TOOLS[toolId - 1]?.price ?? 0;
}

/** 卡片卖价 = 卡片表的 `price` @source `byte [dl*8 + 0x47fdef]`（表项 +5）*/
export function cardPrice(cardId: number): number {
  return cardById(cardId)?.price ?? 0;
}

export interface SellAllCardsResult {
  player: Player;
  /** `state.cardAmount`（下标 = 卡片 id − 1）*/
  cardAmount: number[];
  /** 变卖所得（**點券**）*/
  points: number;
}

/**
 * 变卖一名玩家的全部手牌。
 *
 * @source `_rich4_player_sell_all_the_card` @ VA 0x00441f21
 */
export function sellAllCards(
  player: Player,
  cardAmount: readonly number[],
): SellAllCardsResult {
  const stock = [...cardAmount];
  let points = 0;
  for (const id of player.cards) {
    if (id <= 0) continue;
    // @source inc byte [dl + 0x499197] —— 卡片回商店库存
    stock[id - 1] = (stock[id - 1] ?? 0) + 1;
    points += cardPrice(id);
  }
  return { player: { ...player, cards: [] }, cardAmount: stock, points };
}
