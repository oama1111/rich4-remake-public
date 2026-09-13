/*
 * 回合开始判定
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4.asm:6561-6806  fcn_0040c912 @ VA 0x0040c912
 *   该函数在每个回合开始时调用，返回值驱动回合总调度 fcn_00418c55
 *   的 6 路跳表（@0x418c3d）：1 → 人类回合，2/5 → AI 回合，3/4 → 跳过。
 */

import type { Player } from '../state/types.ts';
import {
  WHO_PLAYS_MASK,
  WHO_PLAYS_DEAD,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_SPECIAL_MASK,
  isBlocked,
} from '../state/types.ts';

/**
 * 回合开始判定的结果。
 *
 * 原版直接返回一个整数（0 / -1 / who_plays）。此处拆成具名结构，
 * 但**保留原始返回码**以便逐值比对。
 */
export interface TurnStartResult {
  /** 原版 fcn_0040c912 的返回值 */
  raw: number;
  /** 该玩家本回合能否行动 */
  canAct: boolean;
  /** 是否为梦游导致的自动走子（不受玩家控制） */
  sleepWalk: boolean;
  /** 被阻碍的原因，供 UI 显示状态文字；可行动时为 null */
  blockedBy: BlockReason | null;
}

export type BlockReason =
  | 'notAlive'
  | 'inHotel'
  | 'disappearing'
  | 'inPrison'
  | 'inHospital'
  | 'sleeping'
  | 'special';

/**
 * 判定回合开始时玩家的处境。
 *
 * @param player 当前玩家
 * @param quiet  对应原版的 `arg0`（栈上 `[esp+0xa8]`）。
 *               非 0 时**只做判定、不播放状态提示**，用于内部查询。
 *
 * 原版逻辑（rich4.asm:6568-6606、6764-6789）：
 * ```
 * who = player[0x15]
 * if (who == 0) return 0;                       // 不在场
 * if (quiet) {
 *     if (who & 0x30) return 0;
 *     if (dword[0x32] != 0) return 0;           // 住宿/消失/坐牢/住院
 *     if (byte[0x36] != 0) return 0;            // 冬眠
 *     return who;
 * }
 * if (dword[0x32] != 0 || byte[0x36] != 0) {
 *     if (who & 0x30) { auto_move(); return 0; }
 *     ...显示状态文字...
 *     return 0;
 * }
 * if (byte[0x37] != 0) { auto_move(); return -1; }   // 梦游
 * return who;
 * ```
 */
export function evaluateTurnStart(player: Player, quiet = false): TurnStartResult {
  const who = player.whoPlays;

  if ((who & WHO_PLAYS_MASK) === WHO_PLAYS_DEAD) {
    return { raw: 0, canAct: false, sleepWalk: false, blockedBy: 'notAlive' };
  }

  if (quiet) {
    if ((who & WHO_PLAYS_SPECIAL_MASK) !== 0) {
      return { raw: 0, canAct: false, sleepWalk: false, blockedBy: 'special' };
    }
    if (isBlocked(player)) {
      return { raw: 0, canAct: false, sleepWalk: false, blockedBy: blockReason(player) };
    }
    return { raw: who, canAct: true, sleepWalk: false, blockedBy: null };
  }

  if (isBlocked(player)) {
    // who & 0x30 时原版直接走子且不显示文字，但同样不算「可行动」
    const reason = (who & WHO_PLAYS_SPECIAL_MASK) !== 0 ? 'special' : blockReason(player);
    return { raw: 0, canAct: false, sleepWalk: false, blockedBy: reason };
  }

  // 梦游：原版立即自动走子并返回 -1
  if (player.blocking.sleepWalking !== 0) {
    return { raw: -1, canAct: false, sleepWalk: true, blockedBy: null };
  }

  return { raw: who, canAct: true, sleepWalk: false, blockedBy: null };
}

/**
 * 阻碍原因的判定顺序，与原版显示状态文字的顺序一致。
 * @source rich4.asm:6596(住宿) → 6607(消失) → 6624(坐牢) → 6660(住院) → 6702(冬眠)
 */
function blockReason(p: Player): BlockReason {
  const b = p.blocking;
  if (b.inHotel !== 0) return 'inHotel';
  if (b.disappearing !== 0) return 'disappearing';
  if (b.inPrison !== 0) return 'inPrison';
  if (b.inHospital !== 0) return 'inHospital';
  return 'sleeping';
}

/**
 * 回合归属：该回合由谁来下决定。
 *
 * @source 回合总调度 fcn_00418c55 的 6 路跳表 @0x418c3d：
 *   1 → 人类回合 UI；2 / 5 → AI 回合；3 / 4 → 跳过
 *   （5 = 1|4，即被托管的人类，故同样交给 AI）
 */
export type TurnController = 'human' | 'ai' | 'skip';

export function turnController(result: TurnStartResult): TurnController {
  if (!result.canAct) return 'skip';
  const who = result.raw;
  if ((who & WHO_PLAYS_AUTOPILOT) !== 0) return 'ai'; // 托管
  return (who & WHO_PLAYS_MASK) === 1 ? 'human' : 'ai';
}
