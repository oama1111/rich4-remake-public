/*
 * 乌龟卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 30`
 *   函数 VA 0x004458df
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';

/** 乌龟卡的选择参数 @source `push 0xe0c0010` */
export const TORTOISE_SELECTION_PARAM = 0xe0c0010;

/**
 * ★ 天数因目标而异 —— 这是个容易漏掉的不对称。
 *
 * @source VA 0x004459c3:
 * ```asm
 * cmp esi, dword [0x49910c]   ; 目标 == 当前玩家？
 * jne 0x445a02                ; 不是自己 → mov byte [ebx+0x39], 3
 * ; 是自己 → mov byte [ebx+0x39], 2
 * ```
 * 特殊玩家（下标 ≥ 4）也是 3（`mov byte [esi+0x498df7], 3`）。
 */
export const TORTOISE_DAYS_SELF = 2;
export const TORTOISE_DAYS_OTHER = 3;

export interface TortoiseResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  /** 实际施加的天数 */
  days: number;
}

/**
 * 乌龟卡：让目标玩家接下来若干天行动变慢。
 *
 * 选择参数属 **anyPlayer** 组，可对自己使用——而且对自己用**少一天**。
 */
export function applyTortoiseCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): TortoiseResult {
  const cls = targetClassOf(TORTOISE_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  if (error !== null) return { ok: false, error, players: [...players], days: 0 };
  if (target.kind !== 'player') {
    return { ok: false, error: 'wrongTargetKind', players: [...players], days: 0 };
  }

  const days = target.index === currentPlayer ? TORTOISE_DAYS_SELF : TORTOISE_DAYS_OTHER;
  const next = players.map((p, i) =>
    i === target.index
      ? { ...p, blocking: { ...p.blocking, tortoiseWalking: days } }
      : p,
  );
  return { ok: true, error: null, players: next, days };
}
