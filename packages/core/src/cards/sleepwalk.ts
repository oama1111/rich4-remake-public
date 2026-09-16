/*
 * 夢遊卡（16）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 16`
 *   函数 VA 0x004441dc
 *
 * 顺带解出**復仇卡(18)** 的触发——它是四张被动卡里最后一张
 * 机制未明的：有害卡命中时把效果**反弹给出牌者**。
 */

import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { PASSIVE_CARDS, playerHasCard } from './passive.ts';
import { TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';

/**
 * 梦游天数：对自己 4 天，对别人 5 天。
 *
 * @source VA 0x0044435e：
 * ```asm
 * cmp    ebx, dword [0x49910c]   ; 目标 == 出牌者？
 * setne  al                      ; 不等则 1
 * add    al, 4                   ; ★ 4（自己）或 5（别人）
 * mov    byte [target + 0x37], al
 * ```
 *
 * ★ 与停留卡、陷害卡是同一个模式：**对自己下手更轻**。
 */
export const SLEEPWALK_DAYS_SELF = 4;
export const SLEEPWALK_DAYS_OTHER = 5;

/** 冬眠天数累计的增量 @source `add byte [target + 0x42], 5` */
export const SLEEPWALK_WINTER_DAYS = 5;

/**
 * 交通方式与对应道具编号的映射。
 *
 * @source VA 0x0044439b 起：
 * ```asm
 * cmp dh, 1 / jne …
 * inc byte [target*15 + 0x499160]     ; 0x499160 = 0x49915b + 5 → 道具 5 機車
 * cmp byte [target + 0x11], 2 / jne …
 * inc byte [target*15 + 0x499161]     ; 0x49915b + 6 → 道具 6 汽車
 * ```
 *
 * ★ 这同时**独立印证了道具表**：基址 0x49915b、步长 15（见 rules/tools.ts）。
 *   梦游会把交通工具**退还成道具**，而不是凭空消失。
 */
export const TRAFFIC_TO_TOOL: ReadonlyMap<number, number> = new Map([
  [1, 5], // 機車
  [2, 6], // 汽車
]);

/** 梦游前的交通方式与骰子数存放处 —— 醒来后据此恢复 */
export const SAVED_TRAFFIC_OFFSET = 0x66;
export const SAVED_NDICES_OFFSET = 0x67;

export type SleepwalkOutcome =
  /** 目标用復仇卡把效果反弹给出牌者 */
  | { kind: 'reflected'; victim: number; days: number }
  | { kind: 'applied'; victim: number; days: number };

export interface SleepwalkResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  /** 更新后的全局道具表 */
  tools: number[];
  outcome: SleepwalkOutcome | null;
  /** 实际被置入梦游的玩家下标（反弹时是出牌者）；`ok === false` 时为空 */
  affected: number[];
  /** 写进替身记录 `+13` 的天数（= `days`；`ok === false` 时为 0） */
  days: number;
}

/** 把一名玩家置入梦游状态 */
function enterSleepwalk(
  p: Player,
  tools: readonly number[],
  days: number,
): { player: Player; tools: number[] } {
  const nextTools = [...tools];

  // @source dl = [+0x11] / [+0x66] = dl；dl = [+0x12] / [+0x67] = dl
  const savedTraffic = p.trafficMethod;
  const savedNdices = p.ndices;

  // @source 按原 traffic_method 把交通工具退还成道具
  const toolId = TRAFFIC_TO_TOOL.get(savedTraffic);
  if (toolId !== undefined) {
    const at = p.index * TOOL_SLOTS_PER_PLAYER + toolId;
    nextTools[at] = (nextTools[at] ?? 0) + 1;
  }

  return {
    player: {
      ...p,
      blocking: { ...p.blocking, sleepWalking: days },
      // @source add byte [+0x42], 5
      totalWinterSleepDays: p.totalWinterSleepDays + SLEEPWALK_WINTER_DAYS,
      savedTrafficMethod: savedTraffic,
      savedNdices,
      // @source [+0x11] = cl（清零）/ [+0x12] = 1
      trafficMethod: 0,
      ndices: 1,
    },
    tools: nextTools,
  };
}

/**
 * 使用夢遊卡。
 *
 * 原版流程（VA 0x0044435e 起）：
 * 1. `days = (target === current) ? 4 : 5`，写入 `days_sleep_walking`
 * 2. `total_winter_sleep_days += 5`
 * 3. 把当前 `traffic_method` / `ndices` 存到 `+0x66` / `+0x67`
 * 4. 按 `traffic_method` 把交通工具**退还成道具**（1→機車, 2→汽車）
 * 5. `traffic_method = 0`、`ndices = 1`
 * 6. ★ 若目标持**復仇卡(18)**，整个效果**反弹给出牌者**
 *
 * @source 第 6 步 VA 0x004443f7：
 * ```asm
 * push 0x12 / push ebp / call 0x4413ad    ; has_card(target, 18)
 * cmp eax, 1 / jne 正常施加
 * push ebp / call 0x444691                 ; 復仇卡生效
 * …随后对 [0x49910c]（出牌者）施加同样的效果
 * ```
 */
export function applySleepwalkCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
  tools: readonly number[],
): SleepwalkResult {
  const fail = (error: TargetError): SleepwalkResult => ({
    ok: false,
    error,
    players: [...players],
    tools: [...tools],
    outcome: null,
    affected: [],
    days: 0,
  });

  if (target.kind !== 'player') return fail('wrongTargetKind');
  if (target.index < 0 || target.index >= players.length) return fail('playerOutOfRange');

  const victim0 = players[target.index];
  if (victim0 === undefined) return fail('playerOutOfRange');
  // 出局者不在原版目标选择列表里（0x446ae8 只画在场玩家）——等价于选不到
  if (!isAlive(victim0)) return fail('playerOutOfRange');

  // ★ 復仇卡：把效果反弹给出牌者
  const reflected = playerHasCard(victim0, PASSIVE_CARDS.REVENGE);
  const victimIndex = reflected ? currentPlayer : target.index;
  const victim = players[victimIndex];
  if (victim === undefined) return fail('playerOutOfRange');

  const days = victimIndex === currentPlayer ? SLEEPWALK_DAYS_SELF : SLEEPWALK_DAYS_OTHER;
  const out = enterSleepwalk(victim, tools, days);

  return {
    ok: true,
    error: null,
    players: players.map((p, i) => (i === victimIndex ? out.player : p)),
    tools: out.tools,
    outcome: {
      kind: reflected ? 'reflected' : 'applied',
      victim: victimIndex,
      days,
    },
    affected: [victimIndex],
    days,
  };
}

/**
 * 梦游结束后恢复交通方式与骰子数。
 *
 * ⚠️ 恢复的**时机**尚未定位——`days_sleep_walking` 不在
 * `rules/blocking.ts` 的每日递减那一组里（那组只有 +0x32..+0x35），
 * 故它由别处清除，恢复也应在同一处。此函数先把「怎么恢复」定下来。
 */
export function wakeFromSleepwalk(p: Player): Player {
  return {
    ...p,
    trafficMethod: p.savedTrafficMethod,
    ndices: p.savedNdices,
    savedTrafficMethod: 0,
    savedNdices: 0,
    blocking: { ...p.blocking, sleepWalking: 0 },
  };
}
