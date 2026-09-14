/*
 * 停留卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 14`
 *   函数 VA 0x00443f80
 */

import type { Player } from '../state/types.ts';
import type { SpecialActor } from '../rules/special-actors.ts';
import type { CardTarget } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import type { TargetError } from './target.ts';

/** 停留卡的选择参数 @source `push 0xe0c0010 / call 0x446ae8` */
export const STAY_SELECTION_PARAM = 0xe0c0010;

/**
 * ★ 停留卡的原始写入值**因目标而异** —— 与乌龟卡同构的不对称。
 *
 * @source VA 0x00444064:
 * ```asm
 * cmp esi, dword [0x49910c]        ; 目标 == 当前玩家？
 * jne 0x4440a0                      ; 不是自己 → mov byte [ebx+0x38], 1
 * ; 是自己 → mov byte [ebx+0x38], 0x80
 * ```
 *
 * 这两个值要配合「高位是标志位」的解码规则看（`displayDays`）：
 *   `0x80` → (0x80 & 0x7f) + 1 = **1 天**
 *   `0x01` → (0x01 & 0x7f) + 1 = **2 天**
 * 即：**对自己用停 1 天，对别人用停 2 天。**
 */
export const STAY_RAW_SELF = 0x80;
export const STAY_RAW_OTHER = 0x01;

export interface StayResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  /** 实际写入 days_stopping 的原始值（含高位标志） */
  raw: number;
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
 * - ★ **对自己停 1 天，对别人停 2 天**（见 STAY_RAW_SELF / STAY_RAW_OTHER）
 * - 特殊玩家（下标 ≥ 4）写 `special_players[i].days_stopping`
 */
export function applyStayCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): StayResult {
  const cls = targetClassOf(STAY_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  if (error !== null) return { ok: false, error, players: [...players], raw: 0 };
  if (target.kind !== 'player') {
    return { ok: false, error: 'wrongTargetKind', players: [...players], raw: 0 };
  }

  const raw = target.index === currentPlayer ? STAY_RAW_SELF : STAY_RAW_OTHER;
  const next = players.map((p, i) =>
    i === target.index
      ? { ...p, blocking: { ...p.blocking, stopping: raw } }
      : p,
  );
  return { ok: true, error: null, players: next, raw };
}

/**
 * 停留卡对**特殊棋子**（四大惡人/機器娃娃）：写替身记录的 `+14 halted`。
 *
 * @source VA 0x004440d9（停留卡的 `cmp 目标, 4 / jge` 分支）：
 * ```asm
 * shl esi, 4                            ; 目标 × 16
 * mov byte [esi + 0x498df6], 1          ; ★ = special[target-4].halted = 1
 * ```
 * （0x498df6 + target×16 == 0x498e28 + (target−4)×16 + 14）
 *
 * 写入值与「对别人」相同（raw 1 = 停 2 天）—— NPC 不可能是出牌者自己，
 * 走不到 0x80 那一支。递减/挂旗与玩家同一套（`tickBlockingCounter`，
 * @source 0x0041cf19..0x0041cf34）。
 */
export function applyStayCardToActor(actor: SpecialActor): SpecialActor {
  return { ...actor, halted: STAY_RAW_OTHER };
}
