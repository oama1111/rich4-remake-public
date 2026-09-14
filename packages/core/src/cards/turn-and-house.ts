/*
 * 转向卡 / 换屋卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 */

import type { Player } from '../state/types.ts';
import type { LandInfo } from '../loaders/map.ts';
import type { SpecialActor } from '../rules/special-actors.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';

// ============================================================
//  转向卡（6）
// ============================================================

/** 转向卡的选择参数 @source `push 0xe0c0010` —— anyPlayer 组，**可对自己用** */
export const TURN_SELECTION_PARAM = 0xe0c0010;

/** 方向的取值个数（8 方向） */
export const DIRECTION_COUNT = 8;
/** 掉头的偏移量 = 半圈 */
export const TURN_AROUND_OFFSET = 4;

/**
 * 掉头：在 8 个方向中转 180 度。
 *
 * @source `_rich4_change_player_direction` VA 0x0040c7c0:
 * ```asm
 * mov dl, byte [player + 0x10]    ; direction
 * add dl, 4
 * and dl, 7                        ; ★ (direction + 4) & 7
 * mov byte [player + 0x10], dl
 * ```
 */
export function turnAround(direction: number): number {
  return (direction + TURN_AROUND_OFFSET) & (DIRECTION_COUNT - 1);
}

export interface TurnResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
}

/**
 * 转向卡：让目标玩家掉头。
 *
 * 选择参数属 anyPlayer 组，**可以对自己使用**（原版在目标为自己时
 * 会说另一句台词，效果照常生效）。
 */
export function applyTurnCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
): TurnResult {
  const cls = targetClassOf(TURN_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  if (error !== null) return { ok: false, error, players: [...players] };
  if (target.kind !== 'player') {
    return { ok: false, error: 'wrongTargetKind', players: [...players] };
  }
  const next = players.map((p, i) =>
    i === target.index ? { ...p, direction: turnAround(p.direction) } : p,
  );
  return { ok: true, error: null, players: next };
}

/**
 * 转向卡对**特殊棋子**：掉头逻辑在共用函数 `0x40c78c` 里，
 * 目标 ≥ 4 时走替身表分支（VA 0x0040c85e）：
 *
 * @source
 * ```asm
 * lea ecx, [target - 4]
 * shl ecx, 4
 * mov dl, byte [ecx + 0x498e31]     ; special.direction (+9)
 * add dl, 4 / and dl, 7
 * mov byte [ecx + 0x498e31], dl     ; ★ (direction + 4) & 7，与玩家同式
 * ```
 *
 * ⚠️ 尾部还有一段「在相邻格中 `rand()` 摇一个 ≠ 旧 last_node 的写回
 *   last_node」（0x0040c8e8，玩家分支 0x0040c834 同款）——需要拓扑与
 *   掷骰，玩家路径目前也未实现（见 applyTurnCard），两条路保持一致，
 *   待 last_node 语义进引擎时一并补。
 */
export function applyTurnCardToActor(actor: SpecialActor): SpecialActor {
  return { ...actor, direction: turnAround(actor.direction) };
}

// ============================================================
//  换屋卡（5）
// ============================================================

/** 换屋卡的选择参数 @source `push 0xe0c0202` —— 地块组（与换地卡相同） */
export const SWAP_HOUSE_SELECTION_PARAM = 0xe0c0202;

/**
 * 换屋卡：**交换两块地上的房子（等级），归属不变**。
 *
 * @source VA 0x00442bed 起反复比较 `[land + 0x1a]`（level），
 * 且不像换地卡那样写 `+0x19`（owner）。
 *
 * ⚠️ 与换地卡的区别（易混）：
 *   换地卡 → 换 **owner**，房子随地走
 *   换屋卡 → 换 **level**，地还是各自的
 */
export function applySwapHouseCard(
  lands: readonly LandInfo[],
  landIdA: number,
  landIdB: number,
): { lands: LandInfo[]; ok: boolean } {
  const a = lands.find((l) => l.id === landIdA);
  const b = lands.find((l) => l.id === landIdB);
  if (a === undefined || b === undefined || landIdA === landIdB) {
    return { lands: [...lands], ok: false };
  }
  const next = lands.map((l) => {
    if (l.id === landIdA) return { ...l, level: b.level };
    if (l.id === landIdB) return { ...l, level: a.level };
    return l;
  });
  return { lands: next, ok: true };
}
