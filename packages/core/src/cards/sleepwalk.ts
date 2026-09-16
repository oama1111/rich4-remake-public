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

import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { PASSIVE_CARDS, playerHasCard } from './passive.ts';
import { TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
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
  | { kind: 'applied'; victim: number; days: number };

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
}

/** 把一名玩家置入梦游状态 */
function enterSleepwalk(
  p: Player,
  tools: readonly number[],
  days: number,
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
      // @source add byte [+0x42], 5
      totalWinterSleepDays: p.totalWinterSleepDays + SLEEPWALK_WINTER_DAYS,
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
): SleepwalkResult {
  const fail = (error: TargetError): SleepwalkResult => ({
    ok: false,
    error,
    players: [...players],
    tools: [...tools],
    outcome: null,
    affected: [],
    days: 0,
  });

  if (target.kind !== 'player') return fail('wrongTargetKind');
  if (target.index < 0 || target.index >= players.length) return fail('playerOutOfRange');

  const victim0 = players[target.index];
  if (victim0 === undefined) return fail('playerOutOfRange');
  // 出局者不在原版目标选择列表里（0x446ae8 只画在场玩家）——等价于选不到
  if (!isAlive(victim0)) return fail('playerOutOfRange');

  // ★ 復仇卡：把效果反弹给出牌者
  const reflected = playerHasCard(victim0, PASSIVE_CARDS.REVENGE);
  const victimIndex = reflected ? currentPlayer : target.index;
  const victim = players[victimIndex];
  if (victim === undefined) return fail('playerOutOfRange');

  const days = victimIndex === currentPlayer ? SLEEPWALK_DAYS_SELF : SLEEPWALK_DAYS_OTHER;
  const out = enterSleepwalk(victim, tools, days);

  return {
    ok: true,
    error: null,
    players: players.map((p, i) => (i === victimIndex ? out.player : p)),
    tools: out.tools,
    outcome: {
      kind: reflected ? 'reflected' : 'applied',
      victim: victimIndex,
      days,
    },
    affected: [victimIndex],
    days,
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
