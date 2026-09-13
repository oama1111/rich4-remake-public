/*
 * 被动卡机制
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 *
 * 复仇/嫁祸/免费/免罪四张卡**无法主动使用**——它们的 card_functions 项
 * 都指向同一个 2 字节空桩 `xor eax,eax; ret`（VA 0x004420d5）。
 *
 * 它们的真实触发方式是：**当有害卡命中某玩家时，施害卡会先检查
 * 目标是否持有相应的防御卡**，持有则触发防御并中止原效果。
 *
 * @source 梦游卡 VA 0x004442f2：
 * ```asm
 * push 0x15              ; 21 = 免罪卡
 * push ebx               ; 目标
 * call 0x4413ad          ; _rich4_player_has_card
 * cmp  eax, 1
 * jne  0x444310
 * push ebx / call 0x444bb2   ; 免罪卡生效 → 免疫，直接结束
 * jmp  end
 * 0x444310:
 * push 0x13              ; 19 = 嫁祸卡
 * push ebx
 * call 0x4413ad          ; 再查嫁祸卡
 * ```
 */

import type { Player } from '../state/types.ts';

/**
 * 每个玩家的手牌槽位数。
 * @source `_rich4_player_has_card`（VA 0x004413ad）的寻址：
 *   `eax = player*5; eax = eax*4 - eax` → player*15，
 *   循环上界 `cmp ecx, 0xf`（15）。
 *   全局数组 `rich4_player_cards[60]` = 4 玩家 × 15 槽，与存档布局一致。
 */
export const CARD_SLOTS_PER_PLAYER = 15;

/**
 * 玩家是否持有某张卡。
 * @source `_rich4_player_has_card(player, cardId)` VA 0x004413ad
 */
export function playerHasCard(player: Player, cardId: number): boolean {
  return player.cards.includes(cardId);
}

/** 防御性被动卡的编号 */
export const PASSIVE_CARDS = {
  /** 复仇卡 —— 反弹 */
  REVENGE: 18,
  /** 嫁祸卡 —— 转嫁给他人 */
  SCAPEGOAT: 19,
  /** 免费卡 —— 免付费用 */
  FREE: 20,
  /** 免罪卡 —— 免疫惩罚 */
  ABSOLUTION: 21,
} as const;

/** 被动卡的触发结果 */
export type PassiveTrigger =
  | { kind: 'none' }
  | { kind: 'absolution' }
  | { kind: 'scapegoat' };

/**
 * 检查有害卡命中目标时是否被防御卡拦下。
 *
 * ⚠️ **检查顺序按原版**：先免罪卡（21），再嫁祸卡（19）。
 * 免罪卡命中即直接免疫并中止，不再查嫁祸卡。
 *
 * @source 梦游卡 VA 0x004442f2 与 0x00444310 的两段连续检查
 */
export function checkDefensiveCards(target: Player): PassiveTrigger {
  // @source push 0x15 / call has_card / cmp eax,1 / jne 下一项
  if (playerHasCard(target, PASSIVE_CARDS.ABSOLUTION)) return { kind: 'absolution' };
  // @source push 0x13 / call has_card
  if (playerHasCard(target, PASSIVE_CARDS.SCAPEGOAT)) return { kind: 'scapegoat' };
  return { kind: 'none' };
}

/** 从手牌中消耗一张卡（取第一张匹配的） */
export function consumeCard(player: Player, cardId: number): Player {
  const at = player.cards.indexOf(cardId);
  if (at < 0) return player;
  const cards = [...player.cards];
  cards.splice(at, 1);
  return { ...player, cards };
}
