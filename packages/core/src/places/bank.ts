/*
 * 银行：存取款、贷款、还款
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_ui_bank.asm
 *   `_rich4_ui_bank_entry` @ VA 0x00436790（柜台）
 *   `_rich4_ui_bank_atm_entry`（ATM）
 *
 * 月息与「有贷款不发利息」在 rules/monthly.ts。
 */

import type { Player } from '../state/types.ts';

// ============================================================
//  存取款
// ============================================================

/**
 * 存款（现金 → 银行）。
 * @source rich4_ui_bank.asm:4856-4858（ATM 分支 `ref_0048c3f0 != 0`）
 * ```asm
 * add dword [player + 32], ebx    ; money_in_bank += amount
 * sub dword [player + 28], ebx    ; cash -= amount
 * ```
 */
export function deposit(player: Player, amount: number): Player {
  if (amount <= 0) return player;
  const capped = Math.min(amount, player.cash);
  if (capped <= 0) return player;
  return { ...player, cash: player.cash - capped, moneyInBank: player.moneyInBank + capped };
}

/**
 * 取款（银行 → 现金）。
 * @source rich4_ui_bank.asm:4921-4922
 * ```asm
 * sub dword [player + 32], ebx    ; money_in_bank -= amount
 * add dword [player + 28], ebx    ; cash += amount
 * ```
 */
export function withdraw(player: Player, amount: number): Player {
  if (amount <= 0) return player;
  const capped = Math.min(amount, player.moneyInBank);
  if (capped <= 0) return player;
  return { ...player, cash: player.cash + capped, moneyInBank: player.moneyInBank - capped };
}

// ============================================================
//  贷款
// ============================================================

/**
 * 贷款上限 = **玩家总资产**。
 *
 * @source rich4_ui_bank.asm:3502 先 `call _rich4_calculate_player_wealth`
 *   存入 `ref_0048c3b0`；放贷时 loc_00435228：
 * ```asm
 * eax = player.loan
 * edi = ref_0048c3b0            ; = 总资产
 * cmp eax, edi / jge → 不可再借
 * eax = edi - player.loan       ; 可借额度
 * ```
 */
export function loanCapacity(wealth: number, currentLoan: number): number {
  const room = wealth - currentLoan;
  return room > 0 ? room : 0;
}

/**
 * 银行拒绝贷款的状态字段。
 * @source rich4_ui_bank.asm:3498 `cmp byte [player + 59], 0 / jne → 跳过放贷`
 *   （+59 = 0x3b = `days_rejected_by_bank`）
 */
export function isRejectedByBank(player: Player): boolean {
  return player.daysRejectedByBank !== 0;
}

export interface LoanResult {
  player: Player;
  /** 实际借到的金额 */
  borrowed: number;
}

/**
 * 借款。
 *
 * ⚠️ **借到的钱直接进存款，不是现金**。
 *
 * @source loc_00435228 之后：
 * ```asm
 * add dword [player + 32], edx    ; money_in_bank += amount
 * add dword [player + 36], edx    ; loan += amount
 * ```
 */
export function borrow(player: Player, amount: number, wealth: number): LoanResult {
  if (amount <= 0 || player.daysRejectedByBank !== 0) {
    return { player, borrowed: 0 };
  }
  const capacity = loanCapacity(wealth, player.loan);
  const borrowed = Math.min(amount, capacity);
  if (borrowed <= 0) return { player, borrowed: 0 };

  return {
    player: {
      ...player,
      moneyInBank: player.moneyInBank + borrowed, // ★ 进存款
      loan: player.loan + borrowed,
    },
    borrowed,
  };
}

/**
 * 还款。
 *
 * ⚠️ **级联顺序与付款相反**：还款先扣**存款**，不足再扣**现金**；
 * 而 `rules/bankruptcy.ts` 的 `payMoney` 是先现金后存款。
 *
 * @source loc_004353a3:
 * ```asm
 * ebp = money_in_bank - amount
 * player.money_in_bank = ebp
 * if (ebp < 0) {                      ; 存款不足
 *     player.cash += ebp              ; 从现金补（ebp 为负）
 *     player.money_in_bank = 0
 * }
 * player.loan -= amount
 * if (loan == 0) player[+44] = 0      ; 还清时清空 f44
 * ```
 */
export function repay(player: Player, amount: number): Player {
  if (amount <= 0 || player.loan <= 0) return player;
  const repaid = Math.min(amount, player.loan);

  let bank = player.moneyInBank - repaid;
  let cash = player.cash;
  if (bank < 0) {
    cash += bank; // bank 为负
    bank = 0;
  }

  const loan = player.loan - repaid;
  return {
    ...player,
    cash,
    moneyInBank: bank,
    loan,
    // 还清时清空 f44 @source mov dword [player + 44], edx（edx 此时为 0）
    f44: loan === 0 ? 0 : player.f44,
  };
}

// ============================================================
//  特别融资
// ============================================================

/**
 * 特别融资存入：同时计入存款与 `special_finance`。
 * @source rich4_ui_bank.asm:1089-1090
 * ```asm
 * add dword [player + 32], edx    ; money_in_bank += amount
 * add dword [player + 40], edx    ; special_finance += amount  (+40 = 0x28)
 * ```
 */
export function addSpecialFinance(player: Player, amount: number): Player {
  if (amount <= 0) return player;
  return {
    ...player,
    moneyInBank: player.moneyInBank + amount,
    specialFinance: player.specialFinance + amount,
  };
}

/**
 * 特别融资取出：先扣存款，不足从现金补，同时减记 `special_finance`。
 * @source loc_00434700
 */
export function removeSpecialFinance(player: Player, amount: number): Player {
  if (amount <= 0) return player;
  const taken = Math.min(amount, player.specialFinance);
  if (taken <= 0) return player;

  let bank = player.moneyInBank - taken;
  let cash = player.cash;
  if (bank < 0) {
    cash += bank;
    bank = 0;
  }
  return {
    ...player,
    cash,
    moneyInBank: bank,
    specialFinance: player.specialFinance - taken,
  };
}
