/*
 * 收一张卡（连同牌堆计数）—— 原版 `0x004412e4` 的完整镜像
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `cards/rob.ts` 的 `giveCard` 只管**手牌**；原版这一个函数同时动**牌堆计数**：
 *
 * ```asm
 * 004412e4  push ebx / mov ebx, [esp+8]          ; 玩家
 * 004412ea  call 0x441262                        ; 手牌张数
 * 004412f2  cmp  eax, 0xf / jne 0x44130a         ; 满 15 张才弃
 * 004412f8  call 0x44128f                        ; 挑最便宜的一张（严格更小才换 ⇒ 同价取靠前）
 * 00441302  call 0x441343(玩家, 那张)             ; ★ 移除；函数尾 0x004413a2 `inc byte [卡号 + 0x499197]`
 *                                                ;   ⇒ **弃掉的那张回到牌堆**
 * 0044130a..00441331                             ; 写进第一个空槽
 * 0044133b  dec  byte [卡号 + 0x499197]           ; ★ 收下的那张从牌堆扣掉
 * ```
 *
 * ⇒ 满手时抽到新卡：新卡 −1、被弃那张 +1。先前各调用点只扣新卡，被弃那张凭空消失
 *   （牌堆越打越少，后面的抽卡袋子与原版不同 ⇒ 随机抽出的卡也不同）。
 *
 * 计数是**字节**（`inc/dec byte`）⇒ 按 `& 0xff` 回绕，与原版同宽。
 */

import type { Player } from '../state/types.ts';
import { giveCard, priceOf } from '../cards/rob.ts';
import { MAX_HAND_CARDS } from './special-square.ts';

export interface ReceiveCardResult {
  player: Player;
  cardAmount: number[];
  /** 满手时被弃回牌堆的那张（1 基卡号）；没弃为 0 */
  discarded: number;
}

/** 满手时 `0x44128f` 会弃掉的那一张（1 基卡号）；没满为 0 */
export function cardToDiscard(player: Player): number {
  const cards = player.cards;
  if (cards.length < MAX_HAND_CARDS) return 0;
  // @source 0x0044128f：初值 10000，`cmp ebx, eax / jle 跳过` —— 严格更小才换
  let best = 0x2710;
  let pick = 0;
  for (const c of cards) {
    if (c === 0) continue;
    const price = priceOf(c) & 0xff;
    if (best > price) {
      best = price;
      pick = c;
    }
  }
  return pick;
}

/**
 * 给玩家一张卡，并按原版同步牌堆计数（`0x004412e4`）。
 *
 * @param cardAmount 牌堆各卡剩余张数，下标 = 卡号 − 1
 */
export function receiveCard(
  player: Player,
  cardId: number,
  cardAmount: readonly number[],
): ReceiveCardResult {
  const amount = [...cardAmount];
  const discarded = cardToDiscard(player);
  // @source 0x004413a2 `inc byte [edi + 0x499197]` —— 被弃那张回牌堆
  if (discarded !== 0) amount[discarded - 1] = ((amount[discarded - 1] ?? 0) + 1) & 0xff;
  const given = giveCard(player, cardId);
  // @source 0x0044133b `dec byte [eax + 0x499197]` —— 收下的那张出牌堆
  amount[cardId - 1] = ((amount[cardId - 1] ?? 0) - 1) & 0xff;
  return { player: given, cardAmount: amount, discarded };
}
