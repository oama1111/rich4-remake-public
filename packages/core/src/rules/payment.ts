/*
 * 金钱转移 —— 全局唯一的付款通道
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py va 0x0041d2c6`
 *   原版签名（Watcom stack 调用）：
 *   ```c
 *   void pay_money(int payer, int payee, int amount, int flags);
 *   ```
 *   它的**溢出级联**与**破产触发**必须 1:1 还原，否则全盘数值都会偏。
 *
 * 共 20 处调用点（`python3 tools/disasm.py callers 0x41d2c6`），
 * 其中 0x00419fb4 / 0x0041a003 是**过路费**，0x00442479 是购地卡。
 * 详见 `docs/money-flow.md`。
 *
 * ⚠️ 与之相对，**落点消费（买地/盖房）不走这里**——那是就地
 *   `cmp` + `sub`，只看现金、无存款级联、不触发破产，见 rules/purchase.ts。
 */

import type { Player } from '../state/types.ts';

// ============================================================
//  参与方编码（沿用原版的单一整数表示）
// ============================================================

/**
 * 收款方为 -1 表示进入**公库**（全局资金池 `[0x499080]`）。
 * @source `cmp edi, -1 / jne / add dword [0x499080], ebx`
 */
export const PARTY_POOL = -1;

/**
 * 编号 > 100 表示**企业**，实际下标为 `编号 - 100`。
 * @source `cmp esi, 0x64 / jle 玩家分支 / lea edx,[esi-0x64] / imul edx,0x34`
 *
 * ⚠️ 原版用的是 `jle`，即 **100 本身走玩家分支**。玩家最多 4 人，
 * 中间的 4..100 不会出现。
 */
export const PARTY_COMPANY_BASE = 100;

export function isCompany(party: number): boolean {
  return party > PARTY_COMPANY_BASE;
}

export function companyIndexOf(party: number): number {
  return party - PARTY_COMPANY_BASE;
}

/**
 * 把企业下标编码成参与方编号。
 *
 * ⚠️ 企业下标**从 1 开始**：原版的判据是 `cmp esi,0x64 / jle 玩家分支`，
 * 100 本身归玩家，故最小的企业编号是 101 → 下标 1。`companies[0]` 不使用。
 */
export function companyParty(index: number): number {
  return PARTY_COMPANY_BASE + index;
}

// ============================================================
//  标志位
// ============================================================

/**
 * bit 0：**收款进现金**；未置位则进银行存款。
 * @source `test byte [esp+0x20], 1 / je → add [+0x20](存款) / else add [+0x1c](现金)`
 */
export const PAY_FLAG_CREDIT_TO_CASH = 0x01;

/**
 * bit 2：**从银行存款先扣**；未置位则先扣现金。
 * @source `test byte [esp+0x20], 4 / je → 先扣现金分支`
 */
export const PAY_FLAG_DEBIT_FROM_BANK = 0x04;

// ============================================================
//  企业资金
// ============================================================

/**
 * 企业的两个资金字段（结构步长 0x34，表基址 `[0x498e7c]`）。
 * 原版对二者**同增同减**，语义差别未明（疑为「现值 / 累计」）。
 * @source `sub [edx+eax+0x28], ebx` 与 `sub [edx+eax+0x2c], ebx`
 */
export interface Company {
  /** @source +0x28 */
  funds: number;
  /** @source +0x2c */
  fundsMirror: number;
}

// ============================================================
//  结果
// ============================================================

export interface TransferResult {
  players: Player[];
  companies: Company[];
  /** 公库余额 @source [0x499080] */
  pool: number;
  /**
   * ★ **实际转移的金额**。
   *
   * 付款方钱不够时，原版会把缺口从 `amount` 里扣掉
   * （`add ebx, edx` / 负则 `xor ebx,ebx`），收款方只收到实付部分。
   */
  paid: number;
  /** 付款方是否被判定破产（原版在此处 `call 0x40cd87`） */
  bankrupted: boolean;
}

// ============================================================
//  实现
// ============================================================

/** 玩家「本月支出」累加器 @source player_info +0x5c (`[player*0x68 + 0x496bc4]`) */
/** 玩家「本月收入」累加器 @source player_info +0x60 (`[player*0x68 + 0x496bc8]`) */

export interface DebitOutcome {
  cash: number;
  bank: number;
  /** 实付金额（可能小于请求额） */
  paid: number;
  bankrupted: boolean;
}

/**
 * 从玩家身上扣钱，含**两级级联**与破产判定。
 *
 * 原版「先现金后存款」分支（VA 0x0041d33d）：
 * ```asm
 * edx = cash - amount
 * cash = edx
 * jge done                    ; 现金够 → 结束
 * bank += edx                 ; ★ 把负数搬进存款
 * cash = 0
 * ecx = bank
 * jge done                    ; 存款兜住了 → 结束
 * amount += ecx               ; ★ 仍不够：实付额减去缺口
 * bank = 0
 * jge 破产                     ; amount 若为负则清零
 * amount = 0
 * 破产: call 0x40cd87(payer)
 * ```
 * 「先存款后现金」分支（VA 0x0041d2fd）结构完全对称。
 *
 * ⚠️ 注意 `call 0x40cd87` 位于级联**之后**，即只要走到「两个口袋都空」
 * 就一定触发，哪怕实付额恰好被削成 0。
 */
export function debitPlayer(cash: number, bank: number, amount: number, fromBank: boolean): DebitOutcome {
  const first = fromBank ? bank : cash;
  const rest = fromBank ? cash : bank;

  let a = first - amount;
  let b = rest;
  let paid = amount;
  let bankrupted = false;

  if (a < 0) {
    b += a; // 负数搬进另一个口袋
    a = 0;
    if (b < 0) {
      paid += b; // 缺口从实付额里扣
      b = 0;
      if (paid < 0) paid = 0;
      bankrupted = true;
    }
  }

  return fromBank
    ? { cash: b, bank: a, paid, bankrupted }
    : { cash: a, bank: b, paid, bankrupted };
}

/**
 * 转账。
 *
 * @param payer  付款方编号（玩家下标 / `companyParty(i)` / 不适用）
 * @param payee  收款方编号（玩家下标 / `companyParty(i)` / `PARTY_POOL`）
 * @param amount 金额（整数）
 * @param flags  见 PAY_FLAG_*
 *
 * ★ 顺序不可调换：**先扣款、后入账**，因为入账用的是扣款后被修正过的
 * `paid`，而不是原始 `amount`。
 *
 * ⚠️ 企业付款分支（`esi > 100`）在原版里 `jmp 0x41d387` 直接跳到收款方处理，
 * **跳过了破产判定**——企业不会破产，资金可以为负。此处照搬。
 */
export function transferMoney(
  players: readonly Player[],
  companies: readonly Company[],
  pool: number,
  payer: number,
  payee: number,
  amount: number,
  flags = 0,
): TransferResult {
  const nextPlayers = [...players];
  const nextCompanies = [...companies];
  let nextPool = pool;
  let paid = amount;
  let bankrupted = false;

  // ── 付款方 ──────────────────────────────────────────
  if (isCompany(payer)) {
    const i = companyIndexOf(payer);
    const c = nextCompanies[i];
    if (c !== undefined) {
      nextCompanies[i] = { funds: c.funds - amount, fundsMirror: c.fundsMirror - amount };
    }
    // ★ 企业不做破产判定，且不累计「本月支出」
  } else {
    const p = nextPlayers[payer];
    if (p !== undefined) {
      const out = debitPlayer(
        p.cash,
        p.moneyInBank,
        amount,
        (flags & PAY_FLAG_DEBIT_FROM_BANK) !== 0,
      );
      paid = out.paid;
      bankrupted = out.bankrupted;
      nextPlayers[payer] = {
        ...p,
        cash: out.cash,
        moneyInBank: out.bank,
        // @source add dword [player*0x68 + 0x496bc4], ebx —— 累计的是**实付额**
        monthlyPaid: p.monthlyPaid + paid,
      };
    }
  }

  // ── 收款方 ──────────────────────────────────────────
  if (payee === PARTY_POOL) {
    nextPool += paid;
  } else if (isCompany(payee)) {
    const i = companyIndexOf(payee);
    const c = nextCompanies[i];
    if (c !== undefined) {
      nextCompanies[i] = { funds: c.funds + paid, fundsMirror: c.fundsMirror + paid };
    }
  } else {
    const q = nextPlayers[payee];
    if (q !== undefined) {
      const toCash = (flags & PAY_FLAG_CREDIT_TO_CASH) !== 0;
      nextPlayers[payee] = {
        ...q,
        cash: toCash ? q.cash + paid : q.cash,
        moneyInBank: toCash ? q.moneyInBank : q.moneyInBank + paid,
        // @source add dword [payee*0x68 + 0x496bc8], ebx
        monthlyReceived: q.monthlyReceived + paid,
      };
    }
  }

  return { players: nextPlayers, companies: nextCompanies, pool: nextPool, paid, bankrupted };
}

// ============================================================
//  give_money —— 纯收款，与 pay_money 不对称
// ============================================================

/**
 * 给玩家发钱。
 *
 * @source VA 0x0041d3f4（紧接 `pay_money` 之后的下一个函数）：
 * ```asm
 * test byte [esp + 0x10], 1
 * je   进存款
 * add  dword [player + 0x1c], ecx      ; 进现金
 * jmp  统计
 * 进存款:
 * add  dword [player + 0x20], ecx
 * 统计:
 * add  dword [player + 0x60], ecx      ; 本月收入累计
 * if (player == current) 刷新界面
 * ```
 *
 * ★ **它与 `transferMoney` 不对称，这点必须保留**：
 * 这里只做加法——没有付款方、没有级联、不可能破产。
 * 命运事件里「撿到钱／中獎／領保險金」走这条；
 * 「罰款／損失」则走 `transferMoney(current, PARTY_POOL, …)`，
 * 那条有完整的级联与破产判定。
 *
 * @param toCash `flags & 1`；命运事件的调用点传的都是 1，即**进现金**
 */
export function receiveMoney(
  players: readonly Player[],
  payee: number,
  amount: number,
  toCash = true,
): Player[] {
  const next = [...players];
  const p = next[payee];
  if (p === undefined) return next;
  next[payee] = {
    ...p,
    cash: toCash ? p.cash + amount : p.cash,
    moneyInBank: toCash ? p.moneyInBank : p.moneyInBank + amount,
    // @source add dword [player*0x68 + 0x496bc8], ecx
    monthlyReceived: p.monthlyReceived + amount,
  };
  return next;
}
