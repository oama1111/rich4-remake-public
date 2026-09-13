/*
 * 查税卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 26`
 *   函数 VA 0x004451f0
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import { playerHasCard, PASSIVE_CARDS } from './passive.ts';
import { HOSTILITY_DIVISOR } from './average-cash.ts';

/** 查税卡的选择参数 @source `push 0xe0c0410` —— player 组 */
export const TAX_SELECTION_PARAM = 0xe0c0410;

/**
 * 查税税率 = **20%**。
 * @source VA 0x004452d7 `fmul qword [0x4653d8]`，该常量为 double **0.2**
 */
export const TAX_RATE = 0.2;

export interface TaxResult {
  ok: boolean;
  error: TargetError | null;
  /** 应缴税额 */
  tax: number;
  /** 是否被免费卡挡下 */
  defended: boolean;
  hostilityDelta: number;
  players: Player[];
}

/**
 * 查税卡：向目标征收其**现金**的 20%。
 *
 * @source VA 0x004452ce:
 * ```asm
 * fild  dword [target + 0x1c]   ; target.cash
 * fmul  qword [0x4653d8]        ; × 0.2
 * call  __round_toward_zero
 * fistp dword [esp + 0x94]      ; tax = trunc(cash × 0.2)
 * mov   esi, 0x64
 * idiv  esi                      ; hostility = tax / 100
 * call  update_hostility(target, current, hostility)   ; 3 个 int，调用正确
 * push  0x14                     ; ★ 20 = 免费卡
 * push  ebx                      ; 目标
 * call  0x4413ad                 ; 查目标是否持有免费卡
 * ```
 *
 * ★ 这里印证了**免费卡（20）的用途**：它是防御「缴费类」效果的被动卡。
 *   注意与梦游卡不同——梦游查的是免罪卡(21)与嫁祸卡(19)，
 *   **不同的有害卡查不同的防御卡**。
 */
export function applyTaxCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): TaxResult {
  const cls = targetClassOf(TAX_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  const fail = (e: TargetError): TaxResult => ({
    ok: false, error: e, tax: 0, defended: false, hostilityDelta: 0, players: [...players],
  });
  if (error !== null) return fail(error);
  if (target.kind !== 'player') return fail('wrongTargetKind');

  const victim = players[target.index];
  if (victim === undefined) return fail('playerOutOfRange');

  // @source fild cash / fmul 0.2 / __round_toward_zero / fistp
  const tax = Math.trunc(victim.cash * TAX_RATE);
  // @source mov esi,0x64 / idiv —— 敌意 = 税额 / 100
  const hostilityDelta = Math.trunc(tax / HOSTILITY_DIVISOR);

  // ★ 免费卡防御（@source push 0x14 / call has_card）
  const defended = playerHasCard(victim, PASSIVE_CARDS.FREE);

  const next = defended
    ? [...players]
    : players.map((p, i) => (i === target.index ? { ...p, cash: p.cash - tax } : p));

  return { ok: true, error: null, tax, defended, hostilityDelta, players: next };
}
