/*
 * 开局设置
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本模块的数值全部由**原版存档实证**确认，见 docs/known-deviations.md F-001。
 */

import { CHARACTERS } from '@rich4/data';

/**
 * 默认初始资金。
 *
 * @source `Rich4/Save0.dat` 与 `Rich4/SAVE1.DAT` 偏移 0x268A
 *   （对应全局变量 `_rich4_game_initial_fund` @0x49908c）均为 300000。
 *
 * 该值可由玩家在开局设置中调整（`rich4_new_game.asm:4032` 处写入），
 * 此处只是原版默认值。
 */
export const DEFAULT_INITIAL_FUND = 300_000;

export interface StartingMoney {
  cash: number;
  moneyInBank: number;
}

/**
 * 按角色的 `init_cash_ratio` 分配开局资金。
 *
 * ```
 * 现金 = 初始资金 × ratio / 100
 * 存款 = 初始资金 − 现金
 * ```
 *
 * @source 实证（`SAVE1.DAT` 一局刚开始的游戏）：
 *   孫小美 ratio=50 → 150000/150000 ✓
 *   阿土伯 ratio=40 → 120000/180000 ✓
 *   金貝貝 ratio=80 → 240000/ 60000 ✓
 *
 * @param characterId 角色编号 0..11
 * @param initialFund 初始资金
 */
export function startingMoney(characterId: number, initialFund: number): StartingMoney {
  const ch = CHARACTERS[characterId];
  if (ch === undefined) throw new RangeError(`未知角色编号: ${characterId}`);
  // 整数运算（C-DET-3）：先乘后除，向零取整
  const cash = Math.trunc((initialFund * ch.initCashRatio) / 100);
  return { cash, moneyInBank: initialFund - cash };
}

/**
 * 胜负条件。两者皆为 0 时表示**无限制**，对局不会自动结束。
 *
 * @source `fcn_0041d89e`（rich4_player_core_actions.asm:5615）：
 *   `if (ref_0049911c == 0 && ref_00499108 == 0) return 0;`
 *   返回 0 即「未达成结束条件」，日期推进得以继续、物价指数得以更新。
 *
 * ⚠️ 两个字段的确切语义**待确认**：由其在存档中的位置与用法推测为
 *    「目标天数」与「目标金额」，但尚无直接证据。两个样本存档中均为 0。
 */
export interface WinConditions {
  /** @source ref_0049911c —— 推测为目标天数 */
  targetDays: number;
  /** @source ref_00499108 —— 推测为目标金额 */
  targetWealth: number;
}

export const NO_WIN_CONDITIONS: WinConditions = { targetDays: 0, targetWealth: 0 };

/** 是否设定了任何胜负条件 */
export function hasWinConditions(w: WinConditions): boolean {
  return w.targetDays !== 0 || w.targetWealth !== 0;
}
