/*
 * 乞丐 —— 破产者留在地图上的棋子
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 破产并不会把棋子收走。`who_plays` 清成 0 之后，那颗棋子还站在
 *   出局的那一格上，成了**乞丐**：谁走到同一格，谁掏一笔施捨。
 *
 * @source 落点处理函数里、物件派发**之前**的一段，VA 0x0041b5fd：
 * ```asm
 * edi = 同格玩家位图 & ~(1 << 我)          ; node.flags bits 8..11
 * 其他 = lowest_set_bit(edi)               ; call 0x40d293
 * if (其他 == -1) 跳过
 * if (其他.who_plays != 0) 跳过            ; ★ 只有**出局者**才是乞丐
 * if ([0x48baf8] != 0) 跳过                ; ★ 路过不算，得停在这格
 * 金额 = 物价指数 × 1000
 * sprintf(buf, "施捨給乞丐%d元", 金额)
 * pay_money(我, -1, 金额, 0)               ; -1 → 进公库
 * call 0x40cc56(其他)                      ; ★ 乞丐换个地方待着
 * ```
 */

import { occupantsOfNode } from './object-landing.ts';
import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';

/**
 * 施捨金额相对物价指数的倍数。
 *
 * @source VA 0x0041b63a 的一串移位，逐步是
 *   `a → 4a → 3a → 24a → 25a → 200a → 800a → 1000a`：
 * ```asm
 * mov ebx, eax / shl ebx, 2 / sub ebx, eax    ; 3a
 * shl ebx, 3 / add ebx, eax                   ; 25a
 * shl ebx, 3 / mov eax, ebx                   ; 200a
 * shl ebx, 2 / add ebx, eax                   ; ★ 1000a
 * ```
 */
export const ALMS_PER_PRICE_INDEX = 1000;

export function almsAmount(priceIndex: number): number {
  return priceIndex * ALMS_PER_PRICE_INDEX;
}

/**
 * 这一格上要给谁施捨。
 *
 * @param nodeId 我站的格子
 * @param me 我的下标
 * @returns 乞丐的玩家下标；没有则 -1
 *
 * ⚠️ 原版**只看下标最小的那一个**（`0x40d293` 返回位图最低位），
 *   他要是还活着就直接跳过，不会接着往下找。
 *   两个出局者站在同一格时，只有下标小的那个能收到钱。照搬。
 */
export function beggarAt(players: readonly Player[], nodeId: number, me: number): number {
  // @source edi = 位图 & ~(1 << 我) —— 位图只有 4 位，即玩家 0..3
  // ★ 节点占位位：住店/消失/坐牢/住院的人那一位已清掉（见 `occupantsOfNode`）——
  //   先前按 nodeId 现算，关在门口格上的人会挡住下标更大的乞丐
  const first = occupantsOfNode(players, nodeId, me)[0];
  // @source cmp eax, -1 / je 跳过
  if (first === undefined) return -1;
  // @source cmp byte [其他 + 0x15], 0 / jne 跳过 —— who_plays 非 0 即还在场
  const who = players[first];
  if (who === undefined || isAlive(who)) return -1;
  return first;
}
