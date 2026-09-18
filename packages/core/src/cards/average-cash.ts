/*
 * 均富卡 / 均贫卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 本文件的实现**以原版 exe 的反汇编为准**，不采信任何转录版本。
 *   验证方式：`python3 tools/disasm.py card 1`（均富卡）
 *
 * ⚠️ 两代逆向 C 版对均富卡的敌意增量**互相矛盾**：
 *   `csrc/cards.c`（2018）      → `average / 100`        ❌ 错误
 *   `asm/rich4_card_junfuka.c`（2026）→ `(cash − average) / 100`  ✅ 正确
 *   已由反汇编裁决，详见 docs/reverse-engineering-audit.md 错误 #7。
 */

import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';

/** 敌意增量的除数 @source `mov ecx, 0x64`（VA 0x00442173） */
export const HOSTILITY_DIVISOR = 100;

export interface AverageCashResult {
  players: Player[];
  /** 本次产生的敌意变化：`[受损玩家下标, 增量]` */
  hostilityDeltas: { from: number; to: number; delta: number }[];
  /** 计算出的平均现金 */
  average: number;
}

/**
 * 均富卡：把所有在场玩家的**现金**拉平到平均值。
 *
 * 原版实现（VA 0x004420d8，反汇编逐行核对）：
 * ```asm
 * ; 第一轮：累加在场玩家现金
 * loop1:
 *   cmp byte [player + 0x15], 0     ; who_plays
 *   je  skip                         ; 出局者不计入
 *   add esi, [player + 0x1c]         ; sum += cash
 *   inc ecx                          ; count++
 * ; 求平均（有符号整数除法）
 *   mov eax, esi / cdq / idiv ecx    ; esi = sum / count
 * ; 第二轮：拉平并结算敌意
 * loop2:
 *   cmp byte [player + 0x15], 0
 *   je  skip
 *   mov edx, [player + 0x1c]         ; cash
 *   cmp esi, edx
 *   jge no_hostility                 ; average >= cash → 不加敌意
 *   sub edx, esi                     ; ★ cash - average
 *   mov ecx, 0x64 / idiv ecx         ; ★ (cash - average) / 100
 *   call update_hostility(i, current, 该值)
 * no_hostility:
 *   mov [player + 0x1c], esi         ; cash = average
 * ```
 *
 * 要点：
 * - **只影响现金**，不动存款
 * - 出局玩家（`who_plays == 0`）既不计入平均，也不被改动
 * - 敌意只对**现金被拉低**的玩家产生，增量为其损失额的 1/100
 * - 平均值用有符号整数除法（向零取整）
 *
 * @param players       全体玩家
 * @param currentPlayer 出牌者下标
 */
export function applyAverageCashCard(
  players: readonly Player[],
  currentPlayer: number,
): AverageCashResult {
  let sum = 0;
  let count = 0;
  for (const p of players) {
    if (!isAlive(p)) continue;
    // @source `add esi, dword [player + 0x496b84]` —— ★ 32 位寄存器**按补码回绕**
    //   （通道 2 钉住：`rich4-spec/tests/test_average_cards.py` 里 0x7FFFFFFF×2+1 ⇒ −1）
    sum = (sum + p.cash) | 0;
    count++;
  }
  if (count === 0) return { players: [...players], hostilityDeltas: [], average: 0 };

  // @source mov eax, esi / cdq / idiv ecx —— 有符号整数除法，向零取整
  //   ⚠️ JS 的 `Math.trunc(-1/3)` 是 **−0**，而原版 `idiv` 给的是 0（无符号位）
  //     ⇒ 统一归一到 0，免得 −0 渗进状态与存档
  const average = Math.trunc(sum / count) || 0;

  const hostilityDeltas: { from: number; to: number; delta: number }[] = [];
  const next = players.map((p, i) => {
    if (!isAlive(p)) return p;
    // @source cmp esi, edx / jge → 仅当 average < cash 才加敌意（**有符号**比较）
    if (average < p.cash) {
      // @source `sub edx, esi` —— 差值同样按 32 位回绕（溢出时 delta 会变负）
      const delta = Math.trunc(((p.cash - average) | 0) / HOSTILITY_DIVISOR) || 0;
      hostilityDeltas.push({ from: i, to: currentPlayer, delta });
    }
    return { ...p, cash: average };
  });

  return { players: next, hostilityDeltas, average };
}

/**
 * 均贫卡：原版 VA 0x004421b4。
 *
 * ⚠️ **尚未实现**。与均富卡不同，它先弹出目标选择
 * （`who_plays == 1` 走 UI `0x446ae8`，否则走 AI `0x41e6f2`），
 * 取消则返回 0、不消耗卡片。目标选择机制需先落地。
 *
 * 用 `python3 tools/disasm.py card 2` 查看完整实现。
 */
export const JUNPIN_CARD_TODO =
  '均贫卡需要目标选择机制（UI 0x446ae8 / AI 0x41e6f2），待实现';
