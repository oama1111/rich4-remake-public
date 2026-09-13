/*
 * 神明加持：事件金额的倍率
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：VA 0x0044b896
 *
 * 新聞／命運事件在**施加阶段**先调用它拿一个倍率，再用它去乘金额。
 * 四条提示语把语义钉得很死：
 *
 * | 返回 | 奖金情形 | 罚金情形 |
 * |---|---|---|
 * | 2 | `%s保佑\n\n獎金加倍！` | `%s作祟\n\n罰金加倍！` |
 * | 1 | `%s作祟\n\n獎金作廢！` | `%s保佑\n\n免付罰金！` |
 * | 0 | （无提示） | （无提示） |
 *
 * ★ 所以返回值**不是「是否加倍」，而是倍率档位**：
 *   `0 → ×1`、`1 → ×0`、`2 → ×2`。
 *   对奖金 ×0 叫「作廢」，对罚金 ×0 叫「免付」——同一个机制，
 *   好坏只取决于钱的方向。提示语里的「保佑／作祟」也随之互换。
 */

import type { Player } from '../state/types.ts';

/** 倍率档位 */
export const BLESSING_NONE = 0;
/** 金额归零：奖金作廢 / 免付罚金 */
export const BLESSING_VOID = 1;
/** 金额加倍：奖金加倍 / 罚金加倍 */
export const BLESSING_DOUBLE = 2;

/**
 * 把档位翻译成实际倍率。
 * @source 施加阶段对返回值的用法：
 *   `cmp ecx, 2 / jne … / mov esi, [0x48c5b4] / add esi, esi`（×2）
 *   `cmp ecx, 1 / jne …`（该分支不再执行付款，等价于 ×0）
 */
export function blessingMultiplier(level: number): number {
  switch (level) {
    case BLESSING_DOUBLE:
      return 2;
    case BLESSING_VOID:
      return 0;
    default:
      return 1;
  }
}

/**
 * 决定倍率档位的阈值。
 *
 * @source VA 0x0044b8c1 起，读 `word [player + 0x46]`（**有符号**）：
 * ```asm
 * mov  si, word [player + 0x46]
 * cmp  si, 0x64          ; 100
 * jle  查50
 * mov  ebx, 2            ; ★ > 100 → 必定加倍
 * jmp  出口
 * 查50:
 * cmp  si, 0x32          ; 50
 * jle  查负
 * call rand
 * mov  ebx, eax / and ebx, 1 / add ebx, ebx   ; ★ 50..100 → 一半概率加倍
 * jmp  出口
 * 查负:
 * test si, si
 * jge  出口              ; 0..50 → 0，不变
 * mov  ebx, 1            ; ★ < 0 → 金额归零
 * ```
 */
export const BLESSING_DOUBLE_THRESHOLD = 100;
export const BLESSING_CHANCE_THRESHOLD = 50;

/**
 * 由玩家的加持值算出倍率档位。
 *
 * ⚠️ `50 < blessing <= 100` 这一档要掷一次随机数（`rand() & 1`），
 * 故本函数需要外部注入随机源——core 内禁止 `Math.random`（C-DET-1）。
 *
 * @param coinFlip `rand() & 1` 的结果，0 或 1
 */
export function blessingLevel(blessing: number, coinFlip: number): number {
  // @source cmp si, 100 / jle …
  if (blessing > BLESSING_DOUBLE_THRESHOLD) return BLESSING_DOUBLE;
  // @source cmp si, 50 / jle … / rand & 1 / ×2
  if (blessing > BLESSING_CHANCE_THRESHOLD) return (coinFlip & 1) * 2;
  // @source test si,si / jge 出口 —— 只有**负值**才归零
  if (blessing < 0) return BLESSING_VOID;
  return BLESSING_NONE;
}

/** 从玩家身上取加持值并算出倍率 */
export function playerBlessingMultiplier(p: Player, coinFlip: number): number {
  return blessingMultiplier(blessingLevel(p.blessing, coinFlip));
}
