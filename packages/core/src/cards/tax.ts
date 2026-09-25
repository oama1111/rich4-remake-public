/*
 * 查税卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 26`
 *   函数 VA 0x004451f0
 */

import type { Player } from '../state/types.ts';
import type { ScapegoatPicker } from './passive.ts';
import { WHO_PLAYS_HUMAN } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import { consumeCard, playerHasCard, PASSIVE_CARDS } from './passive.ts';

/**
 * 查稅卡查嫁祸卡(19) 的**税额门槛**：`0x0044534e cmp dword [esp+0x94], 0x7d0`
 * ⇒ 只有税额 **> 2000** 时才问嫁祸卡。
 */
export const SEAPGOAT_TAX_THRESHOLD = 0x7d0;
import { transferMoney } from '../rules/payment.ts';
import { applyHostilityDeltas } from '../rules/hostility.ts';
import { aiUsesFreeCard } from '../rules/toll-flow.ts';
import { HOSTILITY_DIVISOR } from './average-cash.ts';

/**
 * ★★ 免費卡(20) 的「**要不要真的用掉**」判据 —— 2026-09-20 补（§7.142(5) 的 E5）。
 *
 * 查稅卡 `0x44532d` 在目标持有免費卡时调 `0x444a60`，而**那里面还有一道判据**，
 * 不是有卡就免单（`0x444a60` 的完整分支）：
 * ```asm
 * 00444a92  cmp  byte ptr [ebx + 0x496b7d], 1   ; 目标 who_plays == 1（纯人类）？
 * 00444a99  je   0x444ad8                       ; → 弹确认框（见下）
 * 00444a9b  call 0x456f2d                       ; ★ 电脑：先无条件吃掉一次 rand()
 * 00444aa2  mov  esi, 0xbb8                     ; 3000
 * 00444aaa  idiv esi                            ; edx = rand() % 3000
 * 00444aac  add  edx, esi                       ; edx = 3000 + rand() % 3000
 * 00444aae  mov  esi, dword ptr [0x4990e8]      ; 物價指數
 * 00444ab4  imul esi, edx                       ; 門檻 = pi × (3000 + rand()%3000)
 * 00444ab7  mov  eax, dword ptr [esp + 0x9c]    ; 税额（第三参数）
 * 00444abe  cmp  eax, dword ptr [ebx + 0x496b84]; 税额 vs 目标**现金**
 * 00444ac4  jg   0x444aca                       ; 税额 > 现金 ⇒ 用卡
 * 00444ac6  cmp  esi, eax
 * 00444ac8  jge  0x444ad1                       ; 門檻 >= 税额 ⇒ ★ 不用（卡留着，照付）
 * 00444aca  mov  esi, 1                         ; 用卡 → 0x444b07 弹「使用%s」+ remove_card
 * 00444ad8  ...(真人) sprintf「%s\n\n是否使用免費卡？」0x465388
 * 00444af4  call 0x440ba8                       ; 确认框；返回 1 = 用
 * 00444afe  cmp  eax, 1 / jne 0x444ba0          ; ≠1 ⇒ 返回 0，**卡不消耗**
 * ```
 * ⇒ 电脑受害者**只有** `税额 > 现金` 或 `税额 > pi×(3000+rand()%3000)` 才动卡：
 *   ① `rand()` 在**比较之前**无条件消耗一次 —— 哪怕最后判「不用」，
 *      全局 RNG 流也已经往前走了一格（这正是缺口里说的「流错位」）；
 *   ② 判据是**严格大于**（`jge` 判「不用」，`税额 == 門檻` ⇒ 不用）；
 *   ③ 模数 **3000**、再加 **3000**、乘数码**指数在前**（`imul esi, edx`）。
 *
 * 这条判据与付过路费那一支是**同一个 `0x444a60`**，故直接复用
 * `rules/toll-flow.ts` 的 `aiUsesFreeCard`（通道 2 `test_passive_cards.py` 已判 MATCH），
 * 免得两处各写一份而漂移。
 *
 * ⚠️ 查稅这条路上 `税额 = trunc(现金 × 0.2)`，故 `税额 > 现金` 对 `现金 >= 0`
 *    永不成立（对过路费那一支才有意义）—— 但 `rand()` 与它的先后顺序照原版保留。
 */

/**
 * `0x444a60` 里那一次 `rand()` 的出口 —— 与 `UseCardContext.rng` 同形（C-DET-4）。
 * `next()` 就是原版 `0x456f2d` 那个 Watcom `rand()`（LCG，返回值 0..32767）。
 */
export interface TaxRandomSource {
  next(): number;
}

/**
 * `0x444a60` 里「用不用免費卡」的判定 —— 判据与逐条汇编见上面那段注释。
 *
 * @param rng `0x444a9b call 0x456f2d` 那一次 `rand()` 的出口；预览路径没有随机流时
 *   传 `undefined`（与 `cards/registry.ts` 的轉向卡 `ctx.rng?.next() ?? 0` 同一约定，
 *   退化成 `rand() == 0`，即門檻取最小 `pi × 3000`）。
 */
function usesFreeCard(
  victim: Player,
  amount: number,
  priceIndex: number,
  rng: TaxRandomSource | undefined,
): boolean {
  // @source 0x444a92 `cmp byte [ebx+0x496b7d], 1` / 0x444a99 `je 0x444ad8`
  //   ★ 整字节**精确等于 1**（不是位测试）：带托管位(0x04)／走回棋盘位(0x10)的
  //     人类在这里也落进**电脑**分支 —— 与 `state/reduce.ts` 樂透投注站同一条规矩。
  //   真人支是确认框；core 里没有可停下来问的地方，沿用既有行为「默认为是」
  //   （弹窗属 P2；D-008 记的是「真人先按电脑判据替他决定」，此处按原版结构分流，
  //     并**不消耗**随机数 —— 见报告「不确定的点」）。
  if (victim.whoPlays === WHO_PLAYS_HUMAN) return true;
  // @source 0x444a9b `call 0x456f2d` —— ★ 无条件、恰好一次，且在任何比较之前
  const roll = rng?.next() ?? 0;
  // @source 0x444abe `cmp eax,[ebx+0x496b84] / jg` + 0x444ac6 `cmp esi,eax / 0x444ac8 jge`
  return aiUsesFreeCard(amount, victim, priceIndex, roll);
}

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
  /** 实际被查的人（嫁祸之后的 `ebx`）—— 「抽取%s\n\n%d元稅金！」那扇框的 `%s`；被免费卡挡下时是原目标 */
  victim?: number;
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
 * cmp   eax, 1 / jne 0x44533e
 * push  税额 / push 使用者 / push ebx
 * call  0x444a60                 ; ★★ 里面还有一道门槛（AI 随机门槛 / 真人确认框）
 * cmp   eax, 1 / je 0x445426     ; == 1 才算免单（并已扣卡）
 * ```
 *
 * ★ 这里印证了**免费卡（20）的用途**：它是防御「缴费类」效果的被动卡。
 *   注意与梦游卡不同——梦游查的是免罪卡(21)与嫁祸卡(19)，
 *   **不同的有害卡查不同的防御卡**。
 * ★★ `0x444a60` 的返回值才是裁决：见 `usesFreeCard` 上方那段汇编 ——
 *   持卡 ≠ 免单（电脑要过随机门槛，且**无条件消耗一次 `rand()`**）。
 */
export function applyTaxCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
  /** 物价指数 —— 嫁祸卡 mode 2 的门槛 `0.2×cash > 4000×pi` 要用（`@source 0x444934`） */
  priceIndex: number,
  /**
   * 嫁祸卡(19) 改写后的新目标，由外部（UI/AI）给出，`-1` 表示放弃。
   * 与原版 `0x00445368 cmp eax,-1 / je` 同义。默认不转嫁。
   */
  scapegoatPicker: ScapegoatPicker = () => -1,
  /**
   * ★ 免費卡 AI 門檻要消耗的那一次 `rand()`（`@source 0x444a9b`）。
   *   必须传 `state.rngState` 装出来的那条流（C-DET-4），否则 AI 受害者这条路上
   *   全局 RNG 流会比原版少走一格。预览路径（`state/preview.ts`）没有随机流，
   *   传 `undefined`（退化成 `rand() == 0`）。
   */
  freeCardRng: TaxRandomSource | undefined,
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
  //   ★★ 2026-09-20 订正：**不是有卡就免单** —— 还要过 `0x444a60` 内部那道门槛
  //   （电脑 `pi×(3000+rand()%3000)` 严格小于税额，或真人确认框答「是」）。
  //   此前 remake 只要有卡就免单并扣卡 ⇒ AI 受害者小额查稅被白烧一张免费卡，
  //   而且**一次 `rand()` 都没消耗**（全局 RNG 流从此错位）。
  const defended = playerHasCard(victim, PASSIVE_CARDS.FREE)
    && usesFreeCard(victim, tax, priceIndex, freeCardRng);

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
    // ★★ 2026-09-19 补（§7.140，通道 2 `test_passive_cards.py` 实证）：
    //   原版 `0x44476a(target, mode 2)` **内部还有一道门槛**（`0x444934`–`0x44496f`）：
    //   ```asm
    //   00444934  fild  dword [victim + 0x1c]        ; 目标现金
    //   0044493a  fmul  qword [0x465380]             ; ★ × 0.2（double）
    //   …         eax = 4000 × 物價指數（移位链）
    //   00444963  fild  dword [esp+0x98]
    //   0044496a  fcompp                             ; 比较
    //   0044496f  jae   0x444973                     ; 4000×pi >= 0.2×cash ⇒ 放弃
    //   ```
    //   ⇒ 只有 `0.2×cash > 4000×pi` 才转嫁；否则返回 −1、**卡不扣**、保持原目标。
    //   （注意是双精度比较：`cash=20000, pi=1` 时 `0.2×cash` 四舍五入**恰好等于 4000**
    //   ⇒ **不转嫁**。整数等价式 `cash > 20000×pi` 在该边界上一致。）
    //   ★★ 2026-09-24 审计订正：门槛只在**电脑支**里（`0x4448b0` 之后），而且**候选先定**
    //   （`0x40d31c` 可能先掷一次 `rand()`）再过门槛 —— 整条交给 `scapegoatPicker(…, 2)`
    //   （电脑持有者走 `passive.ts` 的 `aiScapegoatPick`）。先前这里先判门槛、过了才问、
    //   **问之前就扣了 19** ⇒ 放弃转嫁（返回 −1）时 19 被白扣（`0x004449e7 cmp ebx,-1 / je` 在扣卡点之前）。
    // ★ 敌意 `0x00445305 call 0x40df69(目标, 当前, 税/100)` 在查免費/嫁禍**之前**就写了 ——
    //   电脑支挑「最恨的人」读的是记过之后的表（往往就是查稅的人）
    const now = applyHostilityDeltas(players, [{ from: target.index, to: currentPlayer, delta: hostilityDelta }]);
    const picked = scapegoatPicker(target.index, now, 2);
    if (picked !== -1 && picked >= 0 && picked < players.length && picked !== target.index) {
      // 嫁祸卡真的换了人才**消耗**（`0x004449ef call 0x441343`）
      playersAfterRedirect = players.map((p, i) =>
        i === target.index ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p,
      );
      finalIndex = picked;
    }
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
  // ★★ 嫁禍到**查稅的人自己**头上 ⇒ 不收税、不弹框，照样算成功（卡已扣）
  //   @source 0x00445375 cmp ebx, [0x49910c] / 0x00445377 je 0x445421
  if (finalIndex === currentPlayer) {
    return {
      ok: true,
      error: null,
      tax: 0,
      defended: false,
      victim: finalIndex,
      hostilityDelta,
      players: [...playersAfterRedirect],
    };
  }
  const finalPlayer = playersAfterRedirect[finalIndex];
  const tax2 = finalPlayer === undefined ? tax : Math.trunc(finalPlayer.cash * TAX_RATE);

  const moved = transferMoney(playersAfterRedirect, [], 0, finalIndex, currentPlayer, tax2, 0);

  return {
    ok: true,
    error: null,
    tax: tax2, // 实际转移的金额
    defended: false,
    victim: finalIndex,
    hostilityDelta,
    // ⚠️ 敌意 `tax/100` 用的是**最初**那个 `tax`（`@source 0x004452fa`，在嫁祸之前），
    //    故上面那个字段保持不动。
    players: moved.players,
  };
}
