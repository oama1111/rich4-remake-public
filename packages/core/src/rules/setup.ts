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

/**
 * 开局资金的**全部可选档位**。
 *
 * @source 开局时 `mov eax, dword [eax*4 + 0x46cb94]` → `mov [0x49908c], eax`
 *   （VA 0x00407177）。表内恰好 6 项，第 7 项起已是别的数据。
 *
 * ★ 这个值不只决定开局发多少钱——`update_price_index` 拿它当除数
 *   （见 rules/wealth.ts）。**选的初始资金越少，通胀就越快**，
 *   它实际上是难度旋钮。
 */
export const GAME_INITIAL_FUNDS: readonly number[] = [
  300_000, 200_000, 100_000, 50_000, 30_000, 10_000,
];

/**
 * 开局日期的**下限 / 上限** @source `_rich4_read_config`（VA 0x00411e8f）里的钳位：
 * ```asm
 * 00411f30  cmp eax, 0x7ce / jge 下一支        ; 0x7ce = 1998
 *           年 = 1998、月 = 1、日 = 1
 * 00411f49  cmp eax, 0x7da / jle 结束          ; 0x7da = 2010
 *           年 = 2010、月 = 1、日 = 1
 * ```
 * （重建源码 `rich4-re/asm/rich4_config_file.c:40-49` 的
 * `USE_RICH4_DATE_DEFAULT` 分支；exe 里这两个常量确实在 —— 见上两条 VA。）
 */
export const START_DATE_MIN = { year: 1998, month: 1, day: 1 } as const;
export const START_DATE_MAX = { year: 2010, month: 1, day: 1 } as const;

/**
 * 本来这一局该从哪天开始 —— **系统当天**，越界就钳到上下限。
 *
 * ★ 这是原版的真实行为，不是我们自定的：`_rich4_read_config` 读配置文件之后
 *   **无条件**用 `libc_getdate()`（= Win32 `GetLocalTime`）覆盖掉
 *   `global_rich4_cfg` 的 `day/month/year` 三个字节
 *   （重建源码 `rich4_config_file.c:37-49`），所以「当前游戏日期」的起点
 *   就是**玩家机器上的今天**。之后每回合 `fcn_00452117(&CFG+8)` 逐日推进。
 *
 * ⇒ 对任何 2010 年之后的机器，原版的起始日期恒为 **2010-01-01**；
 *   1998 年之前的机器恒为 1998-01-01；中间那些年就是当天。
 *   （**只钳年**：`if (年<1998)` / `else if (年>2010)` 两支各把月日重置为 1/1。）
 *
 * ⚠️ `now` **必须由调用方注入**（C-DET-2：core 内不许读真实时间）。
 *   客户端传 `new Date()`；core 里算不出来的场合用 `START_DATE_MAX`
 *   —— 「2010 年之后的机器一定是它」，与真值等价。
 *
 * @param now 系统时间（注入）
 */
export function defaultStartDate(now: Date): {
  year: number;
  month: number;
  day: number;
} {
  const year = now.getFullYear();
  if (year < START_DATE_MIN.year) return { ...START_DATE_MIN };
  if (year > START_DATE_MAX.year) return { ...START_DATE_MAX };
  return { year, month: now.getMonth() + 1, day: now.getDate() };
}

export interface StartingMoney {
  cash: number;
  moneyInBank: number;
}

/**
 * 分配开局资金 —— **电脑**按角色的 `init_cash_ratio`，**真人**一律对半。
 *
 * ```
 * 电脑：现金 = trunc(ratio × (初始资金 / 100.0))     真人：现金 = 初始资金 >> 1
 * 存款 = 初始资金 − 现金
 * ```
 *
 * @source 开局 `fcn_00406de7` 的逐人循环（审计 2026-09-24 订正真人那一支）：
 * ```asm
 * 004072f9  mov  byte [p + 0x64], al        ; al = 1（人）/ 2（电脑）
 * 004072ff  test al, 1 / je 0x4071d4        ; ★ 电脑 ⇒ 按比例
 * 00407307  mov  eax, [0x49908c] / sar eax, 1
 * 0040730e  mov  [p + 0x1c], eax            ; ★ 真人：现金 = 初始资金 >> 1
 * 00407314  jmp  0x407210                   ;   存款 = 初始资金 − 现金
 * 004071d4  fild word [p+0x19] × (fild [0x49908c] ÷ f32 [0x463190]=100.0) → 0x457dbc 截断 → 现金
 * 00407210  mov  [p + 0x20], 初始资金 − 现金
 * ```
 * 实证（`SAVE1.DAT` 一局刚开始的游戏）：孫小美 ratio=50 → 150000/150000（两支同值）、
 *   阿土伯 ratio=40 → 120000/180000、金貝貝 ratio=80 → 240000/60000（电脑）—— 与上面一致。
 *   ⚠️ 先前不分人机一律按比例，真人选了 ratio≠50 的角色开局现金就错了。
 *
 * @param characterId 角色编号 0..11
 * @param initialFund 初始资金
 * @param human       这一位由人操作（`+0x64 & 1`）
 */
export function startingMoney(characterId: number, initialFund: number, human = false): StartingMoney {
  const ch = CHARACTERS[characterId];
  if (ch === undefined) throw new RangeError(`未知角色编号: ${characterId}`);
  if (human) {
    // @source 0x0040730c `sar eax, 1`（初始资金恒为正，等于向零取整的一半）
    const half = initialFund >> 1;
    return { cash: half, moneyInBank: initialFund - half };
  }
  // 整数运算（C-DET-3）：先乘后除，向零取整
  const cash = Math.trunc((initialFund * ch.initCashRatio) / 100);
  return { cash, moneyInBank: initialFund - cash };
}

/**
 * 遊戲時間档位 → **天数**。0 = 無限。
 *
 * @source 开局写入 `mov eax, [0x46cb4c] / mov eax, [eax*4 + 0x46cbe8] /
 *   mov [0x49911c], eax`（VA 0x0040737d..0x00407389）；
 *   表 dump：`0x46cbe8 = 0, 730, 365, 182, 91, 30`。
 *
 * ★ 下拉的**标签**与「土地權限」共用同一批串（两张表的指针值完全相同）：
 *   `無限期/二年/一年/六個月/三個月/一個月`（表 @0x46cbd0），
 *   但这里的值前者是**天**、后者是地契年限。
 */
export const GAME_TIME_DAYS: readonly number[] = [0, 730, 365, 182, 91, 30];

/**
 * 勝利條件档位 → **开局资金的倍率**。0 = 無限。
 *
 * @source `mov eax, [0x46cb50] / mov edx, [0x49908c] /
 *   mov eax, [eax*4 + 0x46cc00] / imul eax, edx / mov [0x499108], eax`
 *   （VA 0x0040738e..0x004073a3）；表 dump：`0x46cc00 = 0, 100, 50, 10, 5, 3`。
 *
 * ★ 乘的是**本局真正选中的开局资金**（`[0x49908c]`），不是默认 30 万。
 */
export const VICTORY_FACTORS: readonly number[] = [0, 100, 50, 10, 5, 3];

/**
 * 胜负条件。两者皆为 0 时表示**无限制**，对局不会自动结束。
 *
 * @source `fcn_0041d89e`（VA 0x0041d89e）开头：
 *   `if (ref_0049911c == 0 && ref_00499108 == 0) return 0;`
 *   返回 0 即「未达成结束条件」，日期推进得以继续、物价指数得以更新。
 *
 * ★ 语义已由 `rich4_new_game.asm` 的开局写入**直接证实**（不再是推测）：
 *   `targetDays` 就是遊戲時間下拉查 `0x46cbe8` 的结果，
 *   `targetWealth` 就是勝利條件下拉查 `0x46cc00` 再乘开局资金。
 *   判定细节见 `rules/victory.ts`。
 */
export interface WinConditions {
  /** 目标天数 @source ref_0049911c（`0x46cbe8[遊戲時間档]`） */
  targetDays: number;
  /** 目标总资产 @source ref_00499108（`0x46cc00[勝利條件档] × 开局资金`） */
  targetWealth: number;
}

export const NO_WIN_CONDITIONS: WinConditions = { targetDays: 0, targetWealth: 0 };

/** 是否设定了任何胜负条件 */
export function hasWinConditions(w: WinConditions): boolean {
  return w.targetDays !== 0 || w.targetWealth !== 0;
}

/**
 * 把开局屏那三条档位换算成本局的胜负条件 —— 逐句照开局写入复刻。
 *
 * ```asm
 * ; VA 0x0040737d
 * [0x49911c] = 0x46cbe8[[0x46cb4c]]          ; 遊戲時間 → 天
 * ; VA 0x0040738e
 * [0x499108] = 0x46cc00[[0x46cb50]] * [0x49908c]   ; 勝利條件 → 金额
 * ```
 *
 * @param fundIndex    總資金档 0..5（`GAME_INITIAL_FUNDS` / 表 0x46cb94）
 * @param timeIndex    遊戲時間档 0..5（表 0x46cb4c → 0x46cbe8）
 * @param victoryIndex 勝利條件档 0..5（表 0x46cb50 → 0x46cc00）
 */
export function winConditionsOf(
  fundIndex: number,
  timeIndex: number,
  victoryIndex: number,
): WinConditions {
  const fund = GAME_INITIAL_FUNDS[fundIndex] ?? DEFAULT_INITIAL_FUND;
  return {
    targetDays: GAME_TIME_DAYS[timeIndex] ?? 0,
    // imul：整数乘，与开局资金同一档
    targetWealth: fund * (VICTORY_FACTORS[victoryIndex] ?? 0),
  };
}
