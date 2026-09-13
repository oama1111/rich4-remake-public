/*
 * 停留卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 14`
 *   函数 VA 0x00443f80
 */

import type { Player } from '../state/types.ts';
import type { CardTarget } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import type { TargetError } from './target.ts';

/** 停留卡的选择参数 @source `push 0xe0c0010 / call 0x446ae8` */
export const STAY_SELECTION_PARAM = 0xe0c0010;

/** 停留天数 @source `mov byte [player + 0x38], 1` */
export const STAY_DAYS = 1;

export interface StayResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
}

/**
 * 停留卡：让目标玩家下回合停留。
 *
 * 原版流程（VA 0x00443f80）：
 * ```asm
 * cmp byte [current + 0x15], 1        ; 人类？
 * push 0xe0c0010 / call 0x446ae8      ; → 鼠标选择（UI）
 * push 0 / call 0x41e6f2              ; → AI 取值
 * test edi, edi / je end              ; ★ 取消则不消耗卡片，返回 0
 * call 0x40d293                       ; CTZ(bitset) → 目标下标
 * push 0xe / call 0x441343            ; 消耗卡片 14
 * ...
 * mov byte [target + 0x38], 1         ; ★ days_stopping = 1
 * ```
 *
 * 要点：
 * - 选择参数 `0xe0c0010` 属 **anyPlayer** 组，**可以对自己使用**
 * - 目标是自己时跳过台词与动画（`cmp ebx, ebp / je`），但效果照常生效
 * - 特殊玩家（下标 ≥ 4）写 `special_players[i].days_stopping`
 */
export function applyStayCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): StayResult {
  const cls = targetClassOf(STAY_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  if (error !== null) return { ok: false, error, players: [...players] };
  if (target.kind !== 'player') return { ok: false, error: 'wrongTargetKind', players: [...players] };

  const next = players.map((p, i) =>
    i === target.index
      ? { ...p, blocking: { ...p.blocking, stopping: STAY_DAYS } }
      : p,
  );
  return { ok: true, error: null, players: next };
}
