/*
 * 命運事件：可行性判定与事件重映射
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/csrc/fortune.c `fortune_check()`
 * @source rich4.asm:23001 fcn_0044bb4b @ VA 0x0044bb4b（据此校正了 C 版的一处错误）
 *
 * 与新聞不同，命運的判定**兼做事件重映射**：
 * 若干事件会依当前玩家的 `traffic_method` 被改写成另一个编号。
 */

import type { LandInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';

export interface FortuneContext {
  currentPlayer: Player;
  /** 其他玩家（用于统计手牌总数） */
  otherPlayers: readonly Player[];
  lands: readonly LandInfo[];
  /** 当前玩家的 12 支持股 */
  stockAmount: readonly number[];
  /** 关卡编号 `game_stage`（0 或 1） */
  gameStage: number;
}

export interface FortuneCheck {
  feasible: boolean;
  /** 判定后的事件编号——**可能与传入的不同**（重映射） */
  eventId: number;
}

/**
 * 交通方式相关事件的基数。
 *
 * 事件 14/15/16 构成一组，规则统一为 **`eventId = 14 + traffic_method`**，
 * `traffic_method > 2` 则不可行。
 *
 * @source rich4.asm loc_0044bda8 / loc_0044bdd1 / loc_0044bded
 *   三段共用 `mov dword [edx], 0xe/0xf/0x10` 三条写入指令
 */
export const TRAFFIC_EVENT_BASE = 14;

/**
 * ⚠️ **`rich4-re/csrc/fortune.c` 在 case 15 有一处转录错误。**
 *
 * C 版写作：
 * ```c
 * case 15:
 *     ch = traffic_method;
 *     if (ch > 2) return 0;
 *     if (ch == 0) { *v = 15; }      // ← 映射到自己，破坏了 14/16 的对称
 *     else if (ch == 2) { *v = 16; }
 *     return 1;
 * ```
 * 而汇编 `loc_0044bdd1` 实际是：
 * ```asm
 * test ch, ch
 * jne  short loc_0044bde8
 * loc_0044bde0:
 * mov  dword [edx], 0xe        ; ★ *v = 14，不是 15
 * ```
 * 本项目按**汇编**实现。此差异已登记于 docs/known-deviations.md。
 */
export const FORTUNE_C_TRANSCRIPTION_BUG = 'fortune.c case 15: *v=15 应为 *v=14';

/** 统计一名玩家的手牌数 */
function handSize(p: Player): number {
  return p.cards.length;
}

/**
 * 命運事件可行性判定。
 *
 * @source fortune_check()，未列出的编号一律可行（`default: return 1`）
 */
export function checkFortune(eventId: number, ctx: FortuneContext): FortuneCheck {
  const me = ctx.currentPlayer;
  const ownerId = me.index + 1;
  const traffic = me.trafficMethod;
  const no: FortuneCheck = { feasible: false, eventId };
  const yes = (id = eventId): FortuneCheck => ({ feasible: true, eventId: id });

  switch (eventId) {
    // 自有地中有**已建房**者
    case 0:
      return ctx.lands.some((l) => l.owner === ownerId && l.level !== 0) ? yes() : no;

    // 自有地中有**空地**者
    case 1:
      return ctx.lands.some((l) => l.owner === ownerId && l.level === 0) ? yes() : no;

    // 其他玩家手牌总数不为 0
    case 5: {
      const total = ctx.otherPlayers.reduce((s, p) => s + handSize(p), 0);
      return total !== 0 ? yes() : no;
    }

    // 当前玩家持有任何股票
    case 8:
    case 9:
      return ctx.stockAmount.some((a) => a !== 0) ? yes() : no;

    // 10/11 一组：要求 traffic 为 1 或 2，并互相重映射
    case 10:
      if (traffic !== 1 && traffic !== 2) return no;
      return yes(traffic === 2 ? 11 : eventId);
    case 11:
      if (traffic !== 1 && traffic !== 2) return no;
      return yes(traffic === 1 ? 10 : eventId);

    // 12/13 一组：要求 traffic 为 0 或 1
    case 12:
      if (traffic !== 0 && traffic !== 1) return no;
      return yes(traffic === 1 ? 13 : eventId);
    case 13:
      if (traffic !== 0 && traffic !== 1) return no;
      return yes(traffic === 0 ? 12 : eventId);

    // 14/15/16 一组：统一映射为 14 + traffic_method
    case 14:
    case 15:
    case 16:
      if (traffic > 2) return no;
      return yes(TRAFFIC_EVENT_BASE + traffic);

    // 仅第一关可触发
    case 33:
    case 34:
    case 35:
    case 36:
      return ctx.gameStage === 0 ? yes() : no;

    default:
      return yes();
  }
}

/** 有可行性约束或会被重映射的命運事件编号 */
export const CONSTRAINED_FORTUNE_IDS: readonly number[] = [
  0, 1, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 33, 34, 35, 36,
];

/**
 * 命運事件的资源索引表（49 项）。
 * @source rich4-re/csrc/fortune.c `fortune_data_idx[49]`
 * 注意表中存在重复值（如 0x01f1 出现三次），说明多个事件共用同一张图。
 */
export const FORTUNE_DATA_IDX: readonly number[] = [
  0x01dd, 0x01de, 0x01df, 0x01e0, 0x01e1, 0x01e2, 0x01e3, 0x01e4,
  0x01e5, 0x01e6, 0x01e7, 0x01e8, 0x01e9, 0x01ea, 0x01eb, 0x01ec,
  0x01ed, 0x01ee, 0x01ef, 0x01f0, 0x01f1, 0x01f1, 0x01f1, 0x01f2,
  0x01f2, 0x01f3, 0x01f4, 0x01f5, 0x01f5, 0x01f5, 0x01f6, 0x01f7,
  0x01f8, 0x01f9, 0x01fa, 0x01fb, 0x01fc, 0x01f9, 0x01fd, 0x01fe,
  0x01ff, 0x0200, 0x01fa, 0x01fb, 0x0201, 0x0202, 0x0203, 0x01fe,
  0x0204,
];
