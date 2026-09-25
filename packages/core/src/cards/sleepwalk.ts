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

import { applyHostilityDeltas } from '../rules/hostility.ts';
import type { Player } from '../state/types.ts';
import type { ScapegoatPicker } from './passive.ts';
import { isAlive } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import {
  PASSIVE_CARDS,
  REVENGE_DAYS,
  applyDefensiveCards,
  consumeCard,
  playerHasCard,
} from './passive.ts';

// 復仇卡的天数常量归属被动卡（`passive.ts`），这里转出以保持既有引用可用
export { REVENGE_DAYS };
import { TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
import { misfortuneDaysAfter } from '../rules/monthly.ts';
import type { SpecialActor } from '../rules/special-actors.ts';

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

/**
 * 夢遊卡的敌意系数。
 *
 * @source `0x004442cb`–`0x004442ea`（**在免罪卡判定 `0x004442f5` 之前**）：
 * ```asm
 * 004442cb  mov  edx, dword ptr [0x4990e8]   ; price_index
 * 004442d1  mov  eax, edx
 * 004442d3  shl  eax, 2
 * 004442d6  add  eax, edx                    ; 5×pi
 * 004442d8  add  eax, eax                    ; 10×pi
 * 004442da  mov  edx, eax
 * 004442dc  shl  eax, 4                      ; 160×pi
 * 004442df  sub  eax, edx                    ; ★ 150×pi
 * 004442e1  push eax
 * 004442e2  mov  edi, dword ptr [0x49910c]   ; 施卡者
 * 004442e8  push edi
 * 004442e9  push ebx                         ; 目标
 * 004442ea  call 0x40df69                    ; update_hostility(目标, 施卡者, 150×pi)
 * ```
 * ★ 与陷害卡同系数（`cards/frame.ts` 的 `FRAME_HOSTILITY_FACTOR`），
 *   但**位置不同**：陷害卡在免罪判定之前就记，夢遊卡也在之前 —— 两者一致。
 */
export const SLEEPWALK_HOSTILITY_FACTOR = 150;

/** 冬眠天数累计的增量 @source `add byte [target + 0x42], 5` */
export const SLEEPWALK_WINTER_DAYS = 5;

/**
 * 夢遊卡命中**替身**（四大惡人 / 機器娃娃）时写进记录 `+13` 的天数。
 *
 * @source `rich4_card_mengyouka.asm:252-257`：
 * ```asm
 * 0044449b  cmp    ebx, 4                    ; ebx = CTZ(选择位集) = 实例下标
 *           jl     loc_004444b3              ; < 4 → 是玩家，走上面那一支
 *           shl    ebx, 4                    ; ×16 = 替身记录步长
 *           cmp    byte [ebx + 0x498df4], 0  ; +12 非 0（已冬眠）→ 不动
 *           jne    loc_004444b3
 *           mov    byte [ebx + 0x498df5], 5  ; ★ +13 = 5
 * ```
 *
 * ★ **0x44449b 之前 `esi` 已经过一次 `_count_trailing_zero_u8`**
 *   （`mov ebx, eax` @0x444295 附近的 `push esi / call 0x40d293 / mov ebp, eax /
 *   mov ebx, eax`），所以 `ebx` 是**下标**而不是位掩码 —— 与陷害卡
 *   （`rich4_card_xianhaika.asm:62-66` 才做 CTZ）不同，那张卡是拿到下标之后
 *   又算了一次。故这一支**可以直接照抄**：下标 4..11 里 ≥ 4 的都写自己的记录。
 *
 * ⚠️ 另外：`ebx` 只用**低字节**参与 `shl ebx, 4` 的地址算术（0..11 区间内不会溢出），
 *   且 `+10` 那个「已在監獄/醫院」的闸门只对**玩家**那一支有
 *   （见 `rich4_card_dongmianka.asm`），这一支没有。
 */
export const SLEEPWALK_ACTOR_DAYS = 5;

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
  | { kind: 'applied'; victim: number; days: number; /** ★ 被免罪卡(21) 抵消（此时 `days` 为 0） */ absolved?: true }
  /**
   * ★ 目标**已在冬眠**（`+0x36 != 0`）⇒ 整段效果不施加。
   *
   * @source `0x004442be cmp byte [eax+0x496b9e], 0` / `0x004442c5 jne 0x44449b`。
   * ⚠️ 此时**卡仍然被消耗**（原版由调用方在进入处理函数前就 `remove_card`），
   *   所以 `ok` 仍是 `true` —— 与"打不出去"（`ok: false`，不扣卡）是两回事。
   */
  | { kind: 'ineffective'; victim: number; reason: 'sleeping' };

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
  /**
   * 敌意变化：**目标 → 施卡者**，`150 × priceIndex`。
   * @source `0x004442ea`（在防御卡判定之前、无论免疫与否都记；但冬眠中不记）
   */
  hostilityDeltas: { from: number; to: number; delta: number }[];
}

/** 把一名玩家置入梦游状态 */
function enterSleepwalk(
  p: Player,
  tools: readonly number[],
  days: number,
  /**
   * 累加「倒霉天数」`+0x42`（`0x00444372 add byte [+0x42], 5`）——**只有主效果那一支加**；
   * 復仇卡反弹给出牌者的那一支（`0x00444414..0x00444499`）没有这一句。
   */
  countMisfortune = true,
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
      // @source 0x00444372 `add byte ptr [eax + 0x496baa], 5`（8 位累加）
      totalWinterSleepDays: countMisfortune
        ? misfortuneDaysAfter(p.totalWinterSleepDays, SLEEPWALK_WINTER_DAYS)
        : p.totalWinterSleepDays,
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
  /**
   * 嫁祸卡(19) 改写后的新目标由外部（UI/AI）给出，`-1` 表示放弃转嫁（保持原目标）。
   * 与原版 `0x00444330 cmp eax,-1 / je` 同义。默认不转嫁。
   */
  scapegoatPicker: ScapegoatPicker = () => -1,
  /** 物价指数，用于敌意增量 `150 × priceIndex`（`@source 0x004442ea`） */
  priceIndex = 1,
): SleepwalkResult {
  const fail = (error: TargetError): SleepwalkResult => ({
    ok: false,
    error,
    players: [...players],
    tools: [...tools],
    outcome: null,
    affected: [],
    days: 0,
    hostilityDeltas: [],
  });

  if (target.kind !== 'player') return fail('wrongTargetKind');
  if (target.index < 0 || target.index >= players.length) return fail('playerOutOfRange');

  const victim0 = players[target.index];
  if (victim0 === undefined) return fail('playerOutOfRange');
  // 出局者不在原版目标选择列表里（0x446ae8 只画在场玩家）——等价于选不到
  if (!isAlive(victim0)) return fail('playerOutOfRange');

  // ★★ 闸门：目标**已在冬眠**（`+0x36 != 0`）⇒ 整段效果跳过。
  //   @source `0x004442be cmp byte ptr [eax + 0x496b9e], 0` / `0x004442c5 jne 0x44449b`
  //   ⇒ 不记敌意、不查防御卡、不施加效果；**但卡已消耗**（调用方先 remove_card）。
  //   故这里返回 `ok: true` + `ineffective`，而不是 `ok: false`。
  if (victim0.blocking.sleeping !== 0) {
    return {
      ok: true,
      error: null,
      players: [...players],
      tools: [...tools],
      outcome: { kind: 'ineffective', victim: target.index, reason: 'sleeping' },
      affected: [],
      days: 0,
      hostilityDeltas: [],
    };
  }

  // ── 敌意：**在防御卡判定之前**就记（`@source 0x004442cb`–`0x004442ea`）──────
  //   ⚠️ 但目标**已在冬眠**（`+0x36 != 0`）时整段跳过，**连敌意都不记**
  //      （`@source 0x004442be cmp byte [eax+0x496b9e],0 / jne 0x44449b`）。
  const hostilityDeltas =
    victim0.blocking.sleeping === 0
      ? [
          {
            from: target.index,
            to: currentPlayer,
            delta: priceIndex * SLEEPWALK_HOSTILITY_FACTOR,
          },
        ]
      : [];

  // ── 防御卡链（按原版顺序：免罪(21) → 嫁祸(19)）────────────────────────────
  //   @source `0x004442f5 push 0x15` → `call 0x444bb2`（免罪）
  //           `0x00444313 push 0x13` → `call 0x44476a`（嫁祸）
  //   ★ 两个处理函数**内部各自 remove_card**（`0x444c11` / `0x4449ef`），
  //     所以命中即消耗；此前 remake 完全不查这两张卡，且復仇卡也从不消耗。
  let working: readonly Player[] = players;
  const def = applyDefensiveCards(victim0);
  if (def.trigger.kind === 'absolution') {
    // 免罪卡：完全抵消，**不再**查嫁祸卡与复仇卡（顺序固定、命中即止）
    return {
      ok: true,
      error: null,
      players: players.map((p, i) => (i === target.index ? def.player : p)),
      tools: [...tools],
      outcome: { kind: 'applied', victim: target.index, days: 0, absolved: true },
      affected: [],
      days: 0,
      hostilityDeltas,
    };
  }

  const originalTarget = target.index;
  let victimIndex = target.index;
  let redirected = false;
  if (def.trigger.kind === 'scapegoat') {
    // ★ 敌意在 `0x004442ea` 就已写进去了，`0x44476a` 电脑支挑「最恨的人」（`0x40d2d3`）读的是**记过之后**的表
    const picked = scapegoatPicker(target.index, applyHostilityDeltas(players, hostilityDeltas), 0);
    // @source `cmp eax,-1 / je 保持原目标`
    if (picked !== -1 && picked >= 0 && picked < players.length) {
      victimIndex = picked;
      redirected = true;
      // ★★ 只有真的改写了目标才扣 19（原版 `0x4449e7` 的 `cmp` 在扣卡点 `0x4449ef` 之前）；
      //   放弃转嫁时卡留在手里。通道 2 `test_passive_cards.py` 130/130。
      working = players.map((p, i) =>
        i === target.index ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p,
      );
    }
  }

  const days = victimIndex === currentPlayer ? SLEEPWALK_DAYS_SELF : SLEEPWALK_DAYS_OTHER;
  let out = enterSleepwalk(working[victimIndex]!, tools, days);
  let playersAfter = working.map((p, i) => (i === victimIndex ? out.player : p));
  let reflected = false;

  // ── 復仇卡(18)：**在防御卡与效果施加之后**才查，且仅当
  //    「最终目标 == 原始目标」（未被嫁祸改写）────────────────────────────
  //   @source `0x004443ef cmp ebx, ebp / jne 结束`（ebx = 最终目标，ebp = 原始目标）
  //           `0x004443fa has_card(原始目标, 18)` → `0x0044440c call 0x444691`
  //           `0x00444414 mov ecx,[0x49910c]` → `0x0044441d mov byte [eax+0x496b9f], 5`
  //   ★ 反弹天数是**硬编码 5**，不走"对自己 4 天"那条式子；
  //   ★ `0x444691` 内部 `0x4446f0 call 0x441343`（remove_card(持有者, 18)）⇒ 必须消耗。
  const originalHolder = playersAfter[originalTarget];
  if (
    !redirected &&
    victimIndex === originalTarget &&
    originalHolder !== undefined &&
    playerHasCard(originalHolder, PASSIVE_CARDS.REVENGE)
  ) {
    const holderAfter = consumeCard(originalHolder, PASSIVE_CARDS.REVENGE);
    playersAfter = playersAfter.map((p, i) => (i === originalTarget ? holderAfter : p));
    const caster = playersAfter[currentPlayer];
    if (caster !== undefined) {
      // ★ 反弹这一支**不加** `+0x42`（`0x0044441d mov [+0x37],5` 之后直接存座驾/退车，没有 `add [+0x42]`）
      out = enterSleepwalk(caster, out.tools, REVENGE_DAYS, false);
      playersAfter = playersAfter.map((p, i) => (i === currentPlayer ? out.player : p));
      reflected = true;
    }
  }

  return {
    ok: true,
    error: null,
    players: playersAfter,
    tools: out.tools,
    outcome: {
      kind: reflected ? 'reflected' : 'applied',
      victim: reflected ? currentPlayer : victimIndex,
      days: reflected ? REVENGE_DAYS : days,
    },
    affected: reflected ? [victimIndex, currentPlayer] : [victimIndex],
    days: reflected ? REVENGE_DAYS : days,
    hostilityDeltas,
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

/**
 * 夢遊卡命中**替身**（四大惡人 / 機器娃娃）—— 写 `+13` 的梦游天数。
 *
 * @source 见 `SLEEPWALK_ACTOR_DAYS` 那段机器码（`rich4_card_mengyouka.asm:252-257`）。
 *
 * ★ 与玩家那一支的两处不同：
 *   1. 天数**恒为 5**（玩家是 4/5 按「是否对自己」分）；
 *   2. 替身的交通工具不在记录里（`traffic_method` 是**玩家**字段），
 *      故没有「退还成道具 / 存 `+0x66`」那一套。
 *
 * ★ `+12`（冬眠）非 0 时**不动** —— 原版那条 `jne` 走的就是这个意思，
 *   本引擎对应 `SpecialActor.hibernating`。冬眠卡与夢遊卡都写同一族计数，
 *   原版让先到的那个说了算。
 *
 * ⚠️ 原版在这一支上**照样扣卡**（`_rich4_consume_card` 在 `cmp ebx,4` 之前，
 *   @0x444213）—— 但本引擎的统一入口有一条「只在效果真正生效时才消耗」的
 *   硬规矩（见 `registry.ts` 头注释第 5 条），故返回 `applied: false`，
 *   由调用方按 `noEffect` 处理。**这是有意偏离**，登记在
 *   `docs/deviations/T-047.md` 的 D-T047-5。
 */
export function applySleepwalkCardToActor(actor: SpecialActor): {
  actor: SpecialActor;
  applied: boolean;
} {
  if ((actor.hibernating ?? 0) !== 0) return { actor, applied: false };
  return { actor: { ...actor, sleepwalkDays: SLEEPWALK_ACTOR_DAYS }, applied: true };
}
