/*
 * 點券（`player_info + 0x30`）—— ★★ **16 位字段**，一切加减都按 16 位回绕
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版把點券当 **word**（`+0x30`）用，全 exe 与它有关的 38 处访问里
 * **37 处是 16 位**（`add word` / `sub word` / `mov word` / `cmp word`），
 * 唯一例外是醫院保釋那条 `sub dword`（`0x43ec0c`，见 Q-BAIL-1，**不可达**）。
 * 机械清单与逐条宽度分类：`rich4-spec/tests/test_points_field.py`。
 *
 * ```asm
 * 0041b1d7  add word [player + 0x496b98], 0x32     ; 得點券５０點
 * 0041b271  add word [player + 0x496b98], 0x1e     ; 得點券３０點
 * 0041b2f5  add word [player + 0x496b98], 0xa      ; 得點券１０點
 * 0041bb62  add word [player + 0x496b98], 0x1f4    ; 寶箱：５００點
 * 0041bcb6  add word [主人  + 0x496b98], 0x1f4     ; 替身拾到寶箱
 * 0041c25d  sub word [受害者 + 0x496b98], di       ; 小偷/強盜：轉移
 * 0041c27a  add word [主人   + 0x496b98], di
 * 0043d55f  sub word [访客   + 0x496b98], si       ; 保釋扣點（監獄）
 * ```
 *
 * ★ 为什么必须回绕：`(點券 + 500) & 0xffff`。原版在**超过 65535 时会绕回小数字**
 *   （得點券/寶箱/變賣卡片/小遊戲结算都只写低 16 位），而本引擎的 `points` 是 JS number。
 *   不回绕会让「點券是否够买/够保釋」的判据在长局里与原版分叉
 *   （原版绕回后可能**付不起**，复刻却付得起）。
 *
 * ⚠️ 任何写 `player.points` 的地方都必须过这个文件的两个函数 ——
 *   直接写 `p.points + n` / `p.points - n` 都是 bug。
 */

/** 點券的位宽掩码（`+0x30` 是 word） */
export const POINTS_MASK = 0xffff;

/**
 * 點券加减，按 **16 位**回绕。
 *
 * `delta` 可为负（扣款）。原版的扣款都带「够不够」前置判据，
 * 故负数结果只会在**构造出来的非法状态**里出现；回绕语义与 `sub word` 一致。
 */
export function addPoints(current: number, delta: number): number {
  return (current + delta) & POINTS_MASK;
}

/** 把一个外部来源（存档/小遊戲分数）的點券值夹进 16 位 */
export function toPoints16(value: number): number {
  return value & POINTS_MASK;
}
