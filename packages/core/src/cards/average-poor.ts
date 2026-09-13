/*
 * 均贫卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 2`
 *   函数 VA 0x004421b4
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import { HOSTILITY_DIVISOR } from './average-cash.ts';

/** 均贫卡的选择参数 @source `push 0xe0c0410` —— player 组，不可对自己用 */
export const AVERAGE_POOR_SELECTION_PARAM = 0xe0c0410;

export interface AveragePoorResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  hostilityDeltas: { from: number; to: number; delta: number }[];
  /** 两人拉平后的现金 */
  average: number;
}

/**
 * 均贫卡：把**出牌者与目标两人**的现金拉平。
 *
 * ⚠️ 与均富卡的关键差别：**均富卡拉平全场，均贫卡只拉平两人**。
 *
 * @source VA 0x0044223a:
 * ```asm
 * edx = players[current].cash
 * esi = players[target].cash
 * add edx, esi                     ; sum
 * mov eax, edx / sar edx, 0x1f
 * sub eax, edx / sar eax, 1        ; ★ 有符号除以 2（向零取整）
 * mov esi, eax                     ; avg
 * cmp esi, [target].cash
 * jge 跳过敌意
 * edx = target.cash - avg
 * mov ecx, 0x64 / idiv ecx         ; (cash - avg) / 100
 * call update_hostility(target, current, delta)   ; ★ 3 个 int 参数，调用正确
 * mov [current].cash, esi
 * mov [target].cash, esi
 * ```
 *
 * 敌意公式与均富卡一致（损失额 / 100），且此处的调用是**正确的**
 * 3 个 4 字节参数——不像购地卡那个传 double 的 bug（见 Q-002）。
 */
export function applyAveragePoorCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): AveragePoorResult {
  const cls = targetClassOf(AVERAGE_POOR_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  const fail = (e: TargetError): AveragePoorResult => ({
    ok: false, error: e, players: [...players], hostilityDeltas: [], average: 0,
  });
  if (error !== null) return fail(error);
  if (target.kind !== 'player') return fail('wrongTargetKind');

  const me = players[currentPlayer];
  const them = players[target.index];
  if (me === undefined || them === undefined) return fail('playerOutOfRange');

  const sum = me.cash + them.cash;
  // @source sar edx,0x1f / sub eax,edx / sar eax,1 —— 有符号除 2，向零取整
  const average = Math.trunc(sum / 2);

  const hostilityDeltas: { from: number; to: number; delta: number }[] = [];
  // @source cmp esi, eax / jge 跳过 —— 仅当目标现金被拉低时记敌意
  if (average < them.cash) {
    hostilityDeltas.push({
      from: target.index,
      to: currentPlayer,
      delta: Math.trunc((them.cash - average) / HOSTILITY_DIVISOR),
    });
  }

  const next = players.map((p, i) =>
    i === currentPlayer || i === target.index ? { ...p, cash: average } : p,
  );
  return { ok: true, error: null, players: next, hostilityDeltas, average };
}
