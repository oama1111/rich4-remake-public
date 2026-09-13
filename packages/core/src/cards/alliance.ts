/*
 * 同盟卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 29`
 *   函数 VA 0x00445710
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';

/** 同盟卡的选择参数 @source `push 0xe0c0410` —— 属 player 组，**不可对自己用** */
export const ALLIANCE_SELECTION_PARAM = 0xe0c0410;

/** 同盟持续天数 @source `mov byte [player + 0x3d], 7` */
export const ALLIANCE_DAYS = 7;

export interface AllianceResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  /** 因本次结盟而被解除的旧同盟（玩家下标对） */
  dissolved: [number, number][];
}

/**
 * 解除某玩家的现有同盟（双向清空）。
 *
 * @source VA 0x004457fb-0x445821（对一方）与 0x445834-0x445860（对另一方）：
 * ```asm
 * cmp byte [p + 0x41], 0 / je 跳过
 * bl = p.allied_player - 1            ; 对方下标
 * mov byte [partner + 0x41], 0        ; 对方的 allied_player = 0
 * mov byte [partner + 0x3d], 0        ; 对方的 allied_days = 0
 * mov byte [p + 0x41], 0
 * mov byte [p + 0x3d], 0
 * ```
 */
function dissolve(
  players: Player[],
  index: number,
  dissolved: [number, number][],
): void {
  const p = players[index];
  if (p === undefined || p.alliedPlayer === 0) return;
  const partnerIdx = p.alliedPlayer - 1;
  const partner = players[partnerIdx];
  if (partner !== undefined) {
    players[partnerIdx] = { ...partner, alliedPlayer: 0, alliedDays: 0 };
  }
  players[index] = { ...p, alliedPlayer: 0, alliedDays: 0 };
  dissolved.push([index, partnerIdx]);
}

/**
 * 同盟卡：与目标玩家结为同盟 7 天。
 *
 * 原版顺序（VA 0x004457e9 起）：
 * 1. **先解除出牌者原有的同盟**（双向清空）
 * 2. **再解除目标原有的同盟**（双向清空）
 * 3. 双方互指对方，`allied_days` 各设为 7
 *
 * 注意 `allied_player` 存的是**玩家下标 + 1**，0 表示无同盟。
 */
export function applyAllianceCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): AllianceResult {
  const cls = targetClassOf(ALLIANCE_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  if (error !== null) return { ok: false, error, players: [...players], dissolved: [] };
  if (target.kind !== 'player') {
    return { ok: false, error: 'wrongTargetKind', players: [...players], dissolved: [] };
  }

  const next = [...players];
  const dissolved: [number, number][] = [];
  dissolve(next, currentPlayer, dissolved);
  dissolve(next, target.index, dissolved);

  // 结盟：allied_player 存的是下标 + 1
  const a = next[currentPlayer];
  const b = next[target.index];
  if (a === undefined || b === undefined) {
    return { ok: false, error: 'playerOutOfRange', players: [...players], dissolved: [] };
  }
  next[currentPlayer] = { ...a, alliedPlayer: target.index + 1, alliedDays: ALLIANCE_DAYS };
  next[target.index] = { ...b, alliedPlayer: currentPlayer + 1, alliedDays: ALLIANCE_DAYS };

  return { ok: true, error: null, players: next, dissolved };
}
