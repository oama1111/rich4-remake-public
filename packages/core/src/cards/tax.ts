/*
 * 查税卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 26`
 *   函数 VA 0x004451f0
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import { consumeCard, playerHasCard, PASSIVE_CARDS } from './passive.ts';

/**
 * 查稅卡查嫁祸卡(19) 的**税额门槛**：`0x0044534e cmp dword [esp+0x94], 0x7d0`
 * ⇒ 只有税额 **> 2000** 时才问嫁祸卡。
 */
export const SEAPGOAT_TAX_THRESHOLD = 0x7d0;
import { transferMoney } from '../rules/payment.ts';
import { HOSTILITY_DIVISOR } from './average-cash.ts';

/** 查税卡的选择参数 @source `push 0xe0c0410` —— player 组 */
export const TAX_SELECTION_PARAM = 0xe0c0410;

/**
 * 查税税率 = **20%**。
 * @source VA 0x004452d7 `fmul qword [0x4653d8]`，该常量为 double **0.2**
 */
export const TAX_RATE = 0.2;

export interface TaxResult {
  ok: boolean;
  error: TargetError | null;
  /** 应缴税额 */
  tax: number;
  /** 是否被免费卡挡下 */
  defended: boolean;
  hostilityDelta: number;
  players: Player[];
}

/**
 * 查税卡：向目标征收其**现金**的 20%。
 *
 * @source VA 0x004452ce:
 * ```asm
 * fild  dword [target + 0x1c]   ; target.cash
 * fmul  qword [0x4653d8]        ; × 0.2
 * call  __round_toward_zero
 * fistp dword [esp + 0x94]      ; tax = trunc(cash × 0.2)
 * mov   esi, 0x64
 * idiv  esi                      ; hostility = tax / 100
 * call  update_hostility(target, current, hostility)   ; 3 个 int，调用正确
 * push  0x14                     ; ★ 20 = 免费卡
 * push  ebx                      ; 目标
 * call  0x4413ad                 ; 查目标是否持有免费卡
 * ```
 *
 * ★ 这里印证了**免费卡（20）的用途**：它是防御「缴费类」效果的被动卡。
 *   注意与梦游卡不同——梦游查的是免罪卡(21)与嫁祸卡(19)，
 *   **不同的有害卡查不同的防御卡**。
 */
export function applyTaxCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
  /**
   * 嫁祸卡(19) 改写后的新目标，由外部（UI/AI）给出，`-1` 表示放弃。
   * 与原版 `0x00445368 cmp eax,-1 / je` 同义。默认不转嫁。
   */
  scapegoatPicker: (from: number) => number = () => -1,
): TaxResult {
  const cls = targetClassOf(TAX_SELECTION_PARAM);
  const error = validateTarget(cls, target, currentPlayer, players.length);
  const fail = (e: TargetError): TaxResult => ({
    ok: false, error: e, tax: 0, defended: false, hostilityDelta: 0, players: [...players],
  });
  if (error !== null) return fail(error);
  if (target.kind !== 'player') return fail('wrongTargetKind');

  const victim = players[target.index];
  if (victim === undefined) return fail('playerOutOfRange');

  // @source fild cash / fmul 0.2 / __round_toward_zero / fistp
  const tax = Math.trunc(victim.cash * TAX_RATE);
  // @source mov esi,0x64 / idiv —— 敌意 = 税额 / 100
  const hostilityDelta = Math.trunc(tax / HOSTILITY_DIVISOR);

  // ★ 免费卡防御（@source push 0x14 / call has_card / call 0x444a60）
  const defended = playerHasCard(victim, PASSIVE_CARDS.FREE);

  if (defended) {
    // ★★ 免费卡被**消耗**：原版 `0x444a60` 内部 `0x444b30 push 0x14 / call 0x441343`
    //    （= `remove_card(持有者, 20)`）。此前 remake 只读不扣 ⇒ 同一张免费卡
    //    可以反复免掉每一次缴费。
    const next = players.map((p, i) =>
      i === target.index ? consumeCard(p, PASSIVE_CARDS.FREE) : p,
    );
    return { ok: true, error: null, tax, defended: true, hostilityDelta, players: next };
  }

  // ★★ 嫁祸卡(19)：**税额 > 2000** 且目标持有 19 时可换目标
  //   （`@source 0x0044533e`–`0x0044536d`）：
  //   ```asm
  //   0044533e  push 0x13 / push ebx / call 0x4413ad   ; has_card(目标, 19)
  //   00445349  cmp eax,1 / jne 0x44536f
  //   0044534e  cmp dword [esp+0x94], 0x7d0            ; ★ 税额 > 2000 才查
  //   00445359  jle 0x44536f
  //   0044535b  push 0 / push 2 / push ebx / call 0x44476a   ; 嫁祸卡(target, mode 2)
  //   00445368  cmp eax,-1 / je 0x44536f               ; 放弃 → 保持原目标
  //   0044536d  mov ebx, eax                           ; ★ 最终目标
  //   ```
  let finalIndex = target.index;
  let playersAfterRedirect: readonly Player[] = players;
  if (tax > SEAPGOAT_TAX_THRESHOLD && playerHasCard(victim, PASSIVE_CARDS.SCAPEGOAT)) {
    // 嫁祸卡命中即**消耗**（`0x44476a` 内部 `0x4449ef call 0x441343`）
    playersAfterRedirect = players.map((p, i) =>
      i === target.index ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p,
    );
    const picked = scapegoatPicker(target.index);
    if (picked !== -1 && picked >= 0 && picked < players.length) finalIndex = picked;
  }

  // ★★ 税金必须**转给施卡者**，不是凭空消失。
  //   原版 `0x004453a4`：`0x41d2c6(最终目标, 使用者, tax2, 0)`
  //   （见 `0x00445398 push 0` / `0x004453a2 push edx` / `0x004453a3 push ebx` 的压栈序），
  //   而 `0x41d2c6(payer, receiver, amount, flags)` 的两侧语义是：
  //   · 付款方（`esi`）：`flags & 4` → 先扣存款；否则**先扣现金**、不够再扣存款；
  //   · 收款方（`edi`）：`-1` → 公库；`> 0x64` → 企业；否则玩家
  //       —— `flags & 1` → 进**现金**，否则进**存款**（`add [eax+0x496b88], ebx`），
  //          并且**总是** `add [eax+0x496bc8], ebx`（`+0x60` 本月收入累计）。
  //   所以 `flags = 0` ⇒ 目标**现金扣**、施卡者**存款收**、施卡者本月收入累加。
  //   remake 的 `rules/payment.ts` 的 `transferMoney` 已逐条镜像该函数，直接复用即可。
  //   此前这里只 `p.cash - tax`，钱**凭空消失**，施卡者一分都拿不到。
  // ★★ `tax2` **按最终目标的现金重算**（`@source 0x0044537d`–`0x00445391`）：
  //   `fild [最终目标+0x1c] / fmul 0.2 / __round_toward_zero / fistp [esp+0x94]`
  //   —— 不是沿用最初那个 `tax`。所以换目标后金额会变。
  const finalPlayer = playersAfterRedirect[finalIndex];
  const tax2 = finalPlayer === undefined ? tax : Math.trunc(finalPlayer.cash * TAX_RATE);

  const moved = transferMoney(playersAfterRedirect, [], 0, finalIndex, currentPlayer, tax2, 0);

  return {
    ok: true,
    error: null,
    tax: tax2, // 实际转移的金额
    defended: false,
    hostilityDelta,
    // ⚠️ 敌意 `tax/100` 用的是**最初**那个 `tax`（`@source 0x004452fa`，在嫁祸之前），
    //    故上面那个字段保持不动。
    players: moved.players,
  };
}
