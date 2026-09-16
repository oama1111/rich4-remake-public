/*
 * 银行：存取款、贷款、还款、到行时的現金／存款重分
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_ui_bank.asm
 *   `_rich4_ui_bank_entry` @ VA 0x00436790（柜台）
 *   `_rich4_ui_bank_atm_entry` @ VA 0x004379c9（ATM／到行）
 *
 * 月息与「有贷款不发利息」在 rules/monthly.ts。
 */

import type { Player } from '../state/types.ts';
import { truncTowardZero } from '../rules/rounding.ts';

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
  // @source 0x004341e1 `cmp byte [+0x3c], 0 / je` —— 銀行暫停放款期内借不到
  if (amount <= 0 || player.daysRejectedByBank !== 0 || player.bankFreezeDays !== 0) {
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
 * if (loan == 0) player[+44] = 0      ; 还清时清空 loanDueDate
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
    // 还清时清空 loanDueDate @source mov dword [player + 44], edx（edx 此时为 0）
    loanDueDate: loan === 0 ? 0 : player.loanDueDate,
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

// ============================================================
//  到行时的現金／存款比例重分（`cashRatio` +0x19 的唯一读者）
// ============================================================

/**
 * 目标**现金**占比 —— 「現金 ↔ 存款」滑块的百分比 × **日期倍率**，再夹两端。
 *
 * @source `_rich4_ui_bank_atm_entry` @ VA 0x004379c9 的 `loc_00437acd` 那一支
 *   （**非真人**到銀行时走这里；`who_plays == 1` 的真人走 `loc_00437a18`
 *   那条 ATM 对话框的路，不重分）：
 * ```asm
 * 00437ad3  mov  al, byte [edx + 0x496b81]        ; player + 0x19 = init_cash_ratio（百分比）
 * 00437ae2  fild word [esp + 0x94]                ; 整数（值只有 0..255，低 16 位就是它）
 * 00437ae9  fdiv dword [ref_00464c08]             ; ÷ 100.0f
 * 00437aef  fstp dword [esp + 0x88]               ; ★ 存成单精度
 * 00437af1  cmp  ecx, 7 / jg short 0x437b3c       ; 日 ≤ 7 →
 * 00437af7  fld/fmul qword [ref_00464c10] / fstp  ;   × 1.5（double）
 * 00437b3c  cmp  ecx, 0x1a / jl short 0x437b55    ; 日 ≥ 26 →
 * 00437b42  fld/fmul qword [ref_00464c18] / fstp  ;   × 0.5（double）
 * 00437b55  cmp  dword [esp + 0x88], 0x3f800000
 * 00437b5e  jl   short 0x437b6f                    ; t < 1.0 才往下查另一端
 * 00437b60  mov  dword [esp + 0x88], 0x3f666666    ; t = 0.9f
 * 00437b6f  fldz / fcomp dword [esp + 0x88] / sahf
 * 00437b81  jb   short 0x437b88                    ; 0 < t → 保留
 * 00437b83  mov  dword [esp + 0x88], 0x3dcccccd    ; t = 0.1f
 * ```
 *
 * 常量（都在 `rich4_ui_bank.asm` 的 `.data` 段）：
 * - `[0x464c08]` = `0x42c80000` = **100.0f**
 * - `[0x464c10]` = `0x3ff8000000000000` = **1.5**（double）
 * - `[0x464c18]` = `0x3fe0000000000000` = **0.5**（double）
 * - `0x3dcccccd` = **0.1f**、`0x3f666666` = **0.9f**
 *
 * ★ 夹取**只在两端**：`t ≥ 1` 换成 0.9，`t ≤ 0` 换成 0.1；`0 < t < 0.1`
 *   **原样保留**（例如 `cashRatio = 5` → 0.05）。滑块是按 10 一档、角色表
 *   的 `initCashRatio` 又都 ≥ 40，所以正常对局碰不到这条缝，但照 exe 写。
 *
 * ⚠️ 原版每一步都 `fstp dword` 回单精度，所以这里也用 `Math.fround` 把
 *   中间值钉成 f32（与 `companyDividends` 的 ratio 同一处理）。
 */
export function cashRatioTarget(cashRatio: number, day: number): number {
  // @source loc_00437ad3 / 00437ae9 / 00437aef
  let t = Math.fround(Math.fround(cashRatio) / 100);
  // @source loc_00437af1 `cmp ecx, 7 / jg` —— 月初（日 ≤ 7）目标现金 ×1.5
  if (day <= 7) t = Math.fround(t * 1.5);
  // @source loc_00437b3c `cmp ecx, 0x1a / jl` —— 月末（日 ≥ 26）目标现金 ×0.5
  if (day >= 0x1a) t = Math.fround(t * 0.5);
  // @source loc_00437b55 起的两道夹取（第一次是单精度位模式比 0x3f800000）
  if (t >= 1) t = Math.fround(0.9);
  else if (t <= 0) t = Math.fround(0.1);
  return t;
}

/**
 * 到銀行时按 `cashRatio`(+0x19) 把現金／存款重分一次。
 *
 * 规则（`loc_00437acd`..`loc_00437c14`）：
 * ```
 * total   = 現金 + 存款
 * current = 現金 / total                       （单精度）
 * target  = cashRatioTarget(cashRatio, 日)
 * diff    = current − target
 * if (diff ≥ +0.25) 重分                       ; [0x464c20] = double +0.25
 * if (diff ≤ −0.25) 重分                       ; [0x464c28] = double −0.25
 * if (|diff| < 0.25 且 現金 ≠ 0) 什么也不做     ; loc_00437bc1 `cmp [player+0x1c], 0`
 * 新現金 = trunc(total × target)               ; loc_00437bca `call 0x457dbc`
 * 新存款 = total − 新現金
 * ```
 * ⇒ 变动幅度小于总资产 25% 就不折腾（现金正好为 0 时除外，那时必须给钱）。
 *
 * ⚠️ **总资产 = 0 的偏差**：原版这时 `現金 / 0` 是 `0/0 = NaN`，NaN 的比较
 *   全为「无序」⇒ 落进重分那一支，`fistp` 把 NaN 写成整数不确定值
 *   `0x80000000`，現金与存款**双双变成 −2147483648**。那是数值事故不是规则，
 *   本引擎原样返回，已在 `docs/known-deviations.md` 的 Q-BANK-3 登记。
 *
 * ⚠️ 最后那次乘法原版是 x87 扩展精度（`fild` 整数 → `fmul dword` 单精度 →
 *   `frndint` 向零）。这里按仓库既有做法用 `truncTowardZero(total * target)`
 *   建模（f64 乘积），与扩展精度最多差 1 个整数 —— 见 Q-BANK-3 的注记。
 *
 * @source VA 0x00437acd（入口）/ 0x00437b88（带）/ 0x00437bca（落账）
 */
export function rebalanceCashByRatio(player: Player, day: number): Player {
  const total = player.cash + player.moneyInBank;
  if (total <= 0) return player;

  // @source loc_00437ad3 起：current = 現金 / 总资产（`fstp dword` ⇒ 单精度）
  const current = Math.fround(player.cash / total);
  const target = cashRatioTarget(player.cashRatio, day);

  // @source loc_00437b88..0x00437bc6 —— 「什么都不做」的带
  const diff = current - target;
  if (diff > -0.25 && diff < 0.25 && player.cash !== 0) return player;

  // @source loc_00437bca：新現金 = trunc(总资产 × target)，余额进存款
  const cash = truncTowardZero(total * target);
  return { ...player, cash, moneyInBank: total - cash };
}
