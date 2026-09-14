/*
 * 特別融資 —— 銀行董事長的专属额度
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这条规则先前完全没做。玩家结构里那个 `specialFinance`(+0x28) 一直只是
 *   个摆设：它**不是谁都能用的**，只有**銀行的董事長**才看得见那扇窗户。
 *
 * ## 谁是董事長
 *
 * ```asm
 * ; VA 0x00436b1e 起
 * edi = -1
 * ebp = [0x498e7c]                     ; 上市企業表
 * for (b = 1; b <= [0x498e90]; b++) {
 *     esi = ebp + b*0x34
 *     if (esi[0x1a] != 7) continue     ; ★ 行業別 == 7 → 銀行
 *     dl = esi[0x18]                   ; 該企業的擁有者（1 基）
 *     if (dl == 0) continue
 *     edi = dl - 1                     ; ★ 董事長
 * }
 * ```
 * 企業的 `owner` 由**持股最多者**决定（见 places/commercial.ts 的
 * `updateCommercialOwner`），所以「銀行董事長 = 銀行股票持有最多的人」。
 * 八张地图上行業別 7 的企業各有一家，股票索引恒为 0。
 *
 * ## 额度
 *
 * ```asm
 * ; VA 0x00434577 起
 * [0x48c3c8] = 0
 * for (i = 0; i < 4; i++) {
 *     if (i == current_player) continue          ; ★ 不算自己
 *     [0x48c3c8] += players[i].money_in_bank     ; ★ 其他人的**存款**之和
 * }
 * ```
 * 即界面上那行「客戶存款總額」。开屏的人就是董事長，所以等价于
 * 「**除董事長外所有人的存款之和**」。
 *
 * ## 借与还
 *
 * ```asm
 * ; 借 VA 0x00434665
 * 可借 = 額度 − 已融資
 * 金額 = 輸入框(可借)           ; 0 = 取消
 * player.money_in_bank += 金額
 * player.special_finance += 金額   ; ★ 不进 loan —— 与一般貸款是**两笔账**
 *
 * ; 還 VA 0x004346bb
 * 金額 = 輸入框(已融資)
 * if (金額 > 現金 + 存款) → 「您的現金不足」
 * money_in_bank -= 金額
 * if (money_in_bank < 0) { cash += money_in_bank; money_in_bank = 0 }  ; 存款不够动现金
 * player.special_finance -= 金額
 * ```
 *
 * ★ `special_finance` **不计入 `loan`**，所以借款 90 天到期、銀行拒絕往來
 *   那一套（见 places/bank.ts）对它统统不适用。
 *
 * ## 銀行資金準備不足（強制墊付）
 *
 * ```asm
 * ; VA 0x00436b5c 起
 * if (董事長 == -1 || 董事長 == current_player) skip
 * 已融資 = players[董事長].special_finance
 * if (已融資 == 0) skip
 * 存款總額 = Σ 其他**在場**玩家的 money_in_bank      ; ★ 这一支查 who_plays
 * if (存款總額 >= 已融資) skip
 * 差額 = 已融資 − 存款總額
 * 訊息「銀行資金準備\n\n不足%d元\n\n由經營者%s墊付！」
 * 从董事長身上扣 差額
 * players[董事長].special_finance −= 差額（不小于 0）
 * ```
 *
 * ⚠️ 两处求和**不一致**，照抄：算额度那处 `i < 4` 不查在场与否，
 *   強制墊付那处查 `who_plays != 0`。破产者的存款会不会算进额度，
 *   原版自己就是两套口径。
 */

import { isAlive, type GameState, type Player } from '../state/types.ts';
import type { CommercialInfo } from '../loaders/map.ts';

/** 行業別 7 = 銀行 @source VA 0x00436b31 `cmp byte [esi+0x1a], 7` */
export const COMMERCIAL_TYPE_BANK = 7;

/** 地图上某个行業的那家企業；没有返回 null。@source 0x00436b31 / 0x0044ba82 / 0x0042e9xx 都是同一种从头扫的循环 */
export function commercialOfIndustry(
  commercials: readonly CommercialInfo[] | undefined,
  industry: number,
): CommercialInfo | null {
  if (commercials === undefined) return null;
  // @source 循环是**从头扫到尾**、后面的覆盖前面的，故取最后一家
  let found: CommercialInfo | null = null;
  for (const c of commercials) if (c.type === industry) found = c;
  return found;
}

/** 地图上那家銀行；没有返回 null */
export function bankCommercial(commercials: readonly CommercialInfo[] | undefined): CommercialInfo | null {
  return commercialOfIndustry(commercials, COMMERCIAL_TYPE_BANK);
}

/** 某行業那家企業的董事長（玩家下标）；无人持有返回 null */
export function chairmanOfIndustry(
  state: GameState,
  commercials: readonly CommercialInfo[] | undefined,
  industry: number,
): number | null {
  const c = commercialOfIndustry(commercials, industry);
  if (c === null) return null;
  const owner = state.commercialOwners[c.id]?.owner ?? 0;
  return owner === 0 ? null : owner - 1;
}

/**
 * 銀行董事長的玩家下标；无人持有返回 `null`。
 * @source VA 0x00436b37 `dl = [企業 + 0x18]`（1 基），`edi = dl − 1`
 */
export function bankChairman(
  state: GameState,
  commercials: readonly CommercialInfo[] | undefined,
): number | null {
  const bank = bankCommercial(commercials);
  if (bank === null) return null;
  const owner = state.commercialOwners[bank.id]?.owner ?? 0;
  return owner === 0 ? null : owner - 1;
}

/**
 * 特別融資的额度 = 除自己以外所有人的存款之和。
 * @source VA 0x00434593 —— 注意这一支**不查在场与否**。
 */
export function specialFinanceLimit(players: readonly Player[], self: number): number {
  let total = 0;
  for (let i = 0; i < players.length; i++) {
    if (i === self) continue;
    total += players[i]?.moneyInBank ?? 0;
  }
  return total;
}

/** 还能再融多少 */
export function specialFinanceAvailable(players: readonly Player[], self: number): number {
  const me = players[self];
  if (me === undefined) return 0;
  return Math.max(0, specialFinanceLimit(players, self) - me.specialFinance);
}

export interface FinanceResult {
  player: Player;
  /** 没成交时说明原因 */
  error: 'none' | 'cashShort' | null;
}

/** 借。超额自动截到可借上限；`amount <= 0` 视为取消 */
export function borrowSpecial(
  players: readonly Player[],
  self: number,
  amount: number,
): FinanceResult | null {
  const me = players[self];
  if (me === undefined) return null;
  // @source 0x00436fdd / 0x004371e5 `cmp byte [+0x3c], 0` —— 特別融資同样停放
  if (me.bankFreezeDays !== 0) return null;
  const room = specialFinanceAvailable(players, self);
  const take = Math.min(Math.trunc(amount), room);
  if (take <= 0) return null;
  return {
    player: { ...me, moneyInBank: me.moneyInBank + take, specialFinance: me.specialFinance + take },
    error: null,
  };
}

/**
 * 還。先扣存款，不够再动现金。
 * @source VA 0x00434700 起
 */
export function repaySpecial(
  players: readonly Player[],
  self: number,
  amount: number,
): FinanceResult | null {
  const me = players[self];
  if (me === undefined) return null;
  const pay = Math.min(Math.trunc(amount), me.specialFinance);
  if (pay <= 0) return null;
  // @source `cmp edx, ebx / jle` —— 现金 + 存款不够就退回「您的現金不足」
  if (pay > me.cash + me.moneyInBank) return { player: me, error: 'cashShort' };
  let bank = me.moneyInBank - pay;
  let cash = me.cash;
  if (bank < 0) {
    cash += bank;
    bank = 0;
  }
  return { player: { ...me, cash, moneyInBank: bank, specialFinance: me.specialFinance - pay }, error: null };
}

/**
 * 从存款扣钱，不够动现金，再不够就破产。
 *
 * @source VA 0x00433bd8：
 * ```asm
 * money_in_bank -= amount
 * if (money_in_bank < 0) {
 *     cash += money_in_bank          ; 负数 → 从现金补
 *     money_in_bank = 0
 *     if (cash < 0) { cash = 0; 破產(player) }   ; ★ 现金也不够 → 破產
 * }
 * ```
 */
export function payFromBank(p: Player, amount: number): { player: Player; bankrupt: boolean } {
  let bank = p.moneyInBank - amount;
  let cash = p.cash;
  let bankrupt = false;
  if (bank < 0) {
    cash += bank;
    bank = 0;
    if (cash < 0) {
      cash = 0;
      bankrupt = true;
    }
  }
  return { player: { ...p, cash, moneyInBank: bank }, bankrupt };
}

export interface ReserveCall {
  /** 要墊付的差額；0 表示没事 */
  shortfall: number;
  /** 董事長的玩家下标 */
  chairman: number;
}

/**
 * 銀行資金準備是否不足。
 *
 * @source VA 0x00436b5c 起。`current` 是当前行动的玩家 ——
 *   董事長轮到自己时这条**不触发**（原版如此）。
 */
export function bankReserveCall(
  state: GameState,
  commercials: readonly CommercialInfo[] | undefined,
  current: number,
): ReserveCall | null {
  const chairman = bankChairman(state, commercials);
  if (chairman === null || chairman === current) return null;
  const boss = state.players[chairman];
  if (boss === undefined || boss.specialFinance === 0) return null;
  // ★ 这一支**查在场与否**，与额度那一支的口径不同 —— 照抄
  let deposits = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === chairman) continue;
    const p = state.players[i];
    if (p === undefined || !isAlive(p)) continue;
    deposits += p.moneyInBank;
  }
  if (deposits >= boss.specialFinance) return null;
  return { shortfall: boss.specialFinance - deposits, chairman };
}
