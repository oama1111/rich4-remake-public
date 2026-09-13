/*
 * 送神符
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 22`
 *   函数 VA 0x00444c45
 */

import type { Player } from '../state/types.ts';
import { canDispel } from '../rules/objects.ts';

export interface DispelResult {
  /** 是否真的送走了东西；否则**不消耗卡片** */
  ok: boolean;
  player: Player;
  /** 被送走的物件下标（1 基，与原字段同制）；未送走则为空 */
  removed: number[];
}

/**
 * 送神符：驱散附着在自己身上的「坏」物件。
 *
 * @source VA 0x00444c4b:
 * ```asm
 * mov dl, byte [player + 0x40]      ; f64（物件下标 + 1）
 * test dl, dl / je 跳过
 * call remove_object(dl)
 * mov ebx, 1                         ; found = 1
 *
 * mov dh, byte [player + 0x3f]      ; god_info（物件下标 + 1）
 * test dh, dh / je 跳过
 * eax = objects_info[god_info - 1].type
 * cmp eax, 5 / 6 / 7 / 8 / 0xa / 0xf  ; ★ 只处理这几类
 * ... call remove_object
 * mov ebx, 1
 *
 * test ebx, ebx / je end             ; ★ 什么都没送走 → 不消耗卡片
 * push 0x16 / call consume_card      ; 22 = 送神符
 * ```
 *
 * 要点：
 * - `god_info`(+0x3f) 与 `f64`(+0x40) 都是**物件下标 + 1**，不是类型本身
 * - **只送走类型属 {5,6,7,8,10,15} 的物件**，财神（类型 1/2）不在其列
 * - 一件都没送走时**不消耗卡片**（原版 `test ebx,ebx / je end`）
 */
export function applyDispelCard(player: Player): DispelResult {
  const removed: number[] = [];
  let f64 = player.f64;
  let godInfo = player.godInfo;

  // @source 先处理 f64，**无类型判定，有就送**
  if (f64 !== 0) {
    removed.push(f64);
    f64 = 0;
  }
  // @source 再处理 god_info，**须通过类型判定**
  if (godInfo !== 0 && canDispel(godInfo)) {
    removed.push(godInfo);
    godInfo = 0;
  }

  if (removed.length === 0) {
    return { ok: false, player, removed: [] };
  }
  return { ok: true, player: { ...player, f64, godInfo }, removed };
}
