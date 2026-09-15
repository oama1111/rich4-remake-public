/*
 * 勝負條件（遊戲時間 / 勝利條件）的判定
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `fcn_0041d89e` @ **VA 0x0041d89e**（rich4_player_core_actions.asm:5615）
 *
 * 这是原版**唯一**的「时间/资产达标就结束」判定点，只有一个调用者：
 * 日推进 `fcn_0041cf67`（VA 0x0041cf67）里的
 * ```asm
 * 0041cfab  inc  dword [0x4990e4]      ; 總天數 +1
 * 0041cfb1  call 0x41d89e
 * 0041cfb6  cmp  eax, 1
 * 0041cfb9  je   0x41d1a5              ; ★ 达成 → 日推进当场 return
 * 0041cfbf  call 0x423acf              ; 物价指数（达成时被跳过）
 * ```
 * 即**只在日推进那一刻判**（不是每个玩家回合），且终点那天的行情 / 開獎 /
 * 月結 / 地契到期全部不走。见 `docs/deviations/Q-SETUP-1.md`。
 */

import type { Player } from '../state/types.ts';
import { isAlive, WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from '../state/types.ts';
import type { WinConditions } from './setup.ts';
import { hasWinConditions } from './setup.ts';

/** 触发结束的那一条 */
export type VictoryReason =
  /** 已过天数 >= 目标天数 @source `cmp edx, [0x4990e4] / jle` */
  | 'timeLimit'
  /** 首富总资产 >= 目标金额 @source `cmp edi, ebx / jl` */
  | 'wealthTarget';

export interface VictoryOutcome {
  /** 赢家下标 —— 原版取的是**在世者里的首富**，与哪条条件触发无关 */
  winner: number;
  reason: VictoryReason;
  /** 达标那一刻的首富总资产（供表现层显示） */
  wealth: number;
  /**
   * 终局码 `[0x46caf8]`，**在清 `who_plays` 之前**算好存下来。
   *
   * ★ 必须存：原版的收尾会先 `who_plays = 0` 掉除赢家以外的所有人
   *   （见 `clearLosers`），之后再也数不出「本局有几名真人」——
   *   而终局码恰恰是按**开局时的真人数**定的。
   */
  code: 1 | 2 | 3;
}

/**
 * 收尾：把除赢家以外的所有人标成出局。
 *
 * @source `fcn_0041d89e` 的 `loc_0041d951`（VA 0x0041d951）：
 * ```asm
 * xor ebx, ebx
 * loc_0041d951:
 *   cmp ebx, [0x499114] / jge done
 *   cmp ebx, esi / je skip           ; esi = 赢家
 *   imul eax, ebx, 0x68
 *   mov byte [eax + 0x496b7d], 0     ; ★ who_plays = 0，**只清这一个字节**
 * skip: inc ebx / jmp loc_0041d951
 * ```
 *
 * ⚠️ 与破产的 `markPlayerBankrupt` **不是一回事**：那里还会把 `+0x1c` 起
 *   0x4c 字节 memset 掉（钱、点券、手牌全没了）。这里只清 `who_plays`，
 *   **钱和地产都留着** —— 頒獎／名次屏还要按身家排名。
 */
export function clearLosers(players: readonly Player[], winner: number): Player[] {
  return players.map((p, i) => (i === winner ? p : { ...p, whoPlays: 0 }));
}

/**
 * 判一次胜负。
 *
 * 逐句照 `fcn_0041d89e` 的判定段（0x0041d8e9..0x0041d915）复刻：
 *
 * ```asm
 * 0041d8a3  if ([0x49911c] == 0 && [0x499108] == 0) return 0;   ; 两条都無限
 *           ; 在世者里取总资产最高 → esi = 下标、edi = 资产
 * 0041d8e9  if (edi == 0) goto 看金额;              ; ★ 首富资产为 0 时天数条件不生效
 * 0041d8f1  if ([0x49911c] == 0) goto 看金额;
 * 0041d8fa  if ([0x49911c] <= 已过天数) → 结束;
 * 0041d8ff  if ([0x499108] == 0) return 0;
 * 0041d908  if (edi >= [0x499108]) → 结束;
 * ```
 *
 * ⚠️ 三处容易做错的：
 * 1. 首富只从**未出局**（`who_plays & 3 != 0`）的人里选，平手取**先出现者**
 *    （原版是 `jge` 跳过替换，与 `monthly.ts` 的 `pickRichest` 同一套）；
 * 2. 天数比较是 `目标 <= 已过`，而 `elapsedDays` 是**已经 +1 过**的總天數
 *    （开局置 0）⇒ 目标 30 天就是第 30 次日推进那天结束；
 * 3. `bestWealth === 0` 时**天数条件整个跳过** —— 原版如此，不是笔误。
 *
 * @param players     全体玩家
 * @param wealthOf    取某玩家总资产（`_rich4_calculate_player_wealth`）
 * @param conditions  本局的两条条件（0 = 無限）
 * @param elapsedDays **已 +1 过**的總天數 `[0x4990e4]`
 * @returns 达标则返回结果，否则 null
 */
export function checkVictory(
  players: readonly Player[],
  wealthOf: (p: Player) => number,
  conditions: WinConditions,
  elapsedDays: number,
): VictoryOutcome | null {
  // @source 0x0041d8a3：两条都为 0 时连遍历都不做，行为与「没接」完全一致
  if (!hasWinConditions(conditions)) return null;

  let best = 0;
  let bestAt = 0;
  for (const p of players) {
    // @source `cmp byte [eax + 0x496b7d], 0 / je` —— 出局者不参评
    if (!isAlive(p)) continue;
    const w = wealthOf(p);
    // @source `cmp edi, eax / jge` —— 严格大于才替换，平手取先出现者
    if (best < w) {
      best = w;
      bestAt = p.index;
    }
  }

  // @source 0x0041d8e9 `test edi, edi / je loc_0041d8ff`
  if (best !== 0 && conditions.targetDays !== 0 && conditions.targetDays <= elapsedDays) {
    return {
      winner: bestAt,
      reason: 'timeLimit',
      wealth: best,
      code: victoryEndCode(players, bestAt),
    };
  }
  // @source 0x0041d8ff..0x0041d915
  if (conditions.targetWealth !== 0 && best >= conditions.targetWealth) {
    return {
      winner: bestAt,
      reason: 'wealthTarget',
      wealth: best,
      code: victoryEndCode(players, bestAt),
    };
  }
  return null;
}

/**
 * 达标结束时的**终局码** `[0x46caf8]`。
 *
 * @source `fcn_0041d89e` 的收尾 0x0041d96b..0x0041da55：
 * ```asm
 * ; _num_human_players == 1：
 * ;   赢家是真人        → [0x46caf8] = 2
 * ;   赢家是电脑        → [0x46caf8] = fcn_00407842(1)   ← 1 或 4，见下
 * ; _num_human_players != 1：
 * ;   赢家是真人        → 3
 * ;   否则              → 1
 * ```
 *
 * ⚠️ 「单人类局里电脑赢」原版会弹一个模态框（`fcn_00407842`），
 *   玩家选了「读档」时返回 **4**（跳到读档屏）。那是 UI 流程，本引擎未复刻，
 *   该情形一律按 **1**（回主菜单）处理 —— 见 `docs/deviations/Q-SETUP-1.md` §2。
 */
export function victoryEndCode(players: readonly Player[], winner: number): 1 | 2 | 3 {
  const humans = players.filter((p) => (p.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN).length;
  // @source `test byte [player + 0x15], 1` —— 原版只看 bit0（1 = 真人）
  const winnerHuman = (players[winner]?.whoPlays ?? 0) & WHO_PLAYS_MASK;
  if (winnerHuman !== WHO_PLAYS_HUMAN) return 1;
  return humans === 1 ? 2 : 3;
}
