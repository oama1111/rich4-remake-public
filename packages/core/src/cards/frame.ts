/*
 * 陷害卡（17）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 17`
 *   函数 VA 0x004444bf
 *
 * 把目标送进监狱。它是**第一张打通「有害卡 → 防御卡」全链路**的卡，
 * 也独立印证了 `cards/passive.ts` 里记的检查顺序（免罪 21 → 嫁祸 19）。
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import type { MapNode, LandscapeInfo } from '../loaders/map.ts';
import type { MapObject } from './summon.ts';
import { PASSIVE_CARDS, REVENGE_DAYS, applyDefensiveCards, consumeCard, playerHasCard } from './passive.ts';
import { CONFINEMENT_SLOTS, KNOWN_PRISON_DAYS, sendToConfinement } from '../rules/confinement.ts';

/**
 * 敌意增量的物价指数系数。
 *
 * @source VA 0x004445a2 的移位序列：
 * ```asm
 * edx = price_index
 * eax = edx<<2 ; 4pi
 * eax += edx   ; 5pi
 * eax += eax   ; 10pi
 * edx2 = eax
 * eax <<= 4    ; 160pi
 * eax -= edx2  ; ★ 150pi
 * ```
 * 与冬眠卡同为 150，见 `cards/hibernate.ts`。
 */
export const FRAME_HOSTILITY_FACTOR = 150;

/**
 * 刑期。
 * @source VA 0x0044460b：
 * ```asm
 * mov eax, [0x49910c]
 * cmp ebx, eax          ; 目标 == 出牌者？
 * jne 别人分支
 * push 4                ; ★ 是自己 → 4 天
 * jmp send
 * 别人分支: push 5       ; 别人 → 5 天
 * send: call 0x43d593   ; send_to_prison(target, days)
 * ```
 *
 * ★ 注意这个比较发生在**嫁祸卡改写目标之后**：
 * 你陷害别人、对方用嫁祸卡把账转回你头上，你只关 4 天而不是 5 天。
 */
export const FRAME_DAYS_SELF = KNOWN_PRISON_DAYS.self;
export const FRAME_DAYS_OTHER = KNOWN_PRISON_DAYS.other;

/** 陷害卡的结局 */
export type FrameOutcome =
  /** 目标用免罪卡免疫，无人入狱 */
  | { kind: 'absolved'; absolvedBy: number }
  /**
   * 有人入狱。
   *
   * `revenged`：★ 目标**未被嫁祸改写**且持有復仇卡(18) ⇒ 復仇卡生效，
   *   **施卡者**也被关 5 天（`@source 0x00444652`–`0x00444678`）。
   */
  | {
      kind: 'imprisoned';
      victim: number;
      days: number;
      redirected: boolean;
      revenged?: boolean;
    };

export interface FrameResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  /**
   * 物件表 —— 首次关押时跟班物件要跟着目标搬进监狱格
   * （`@source 0x444678 call 0x43d593` → 函数体内 `0x43d668 call 0x40fc00`）。
   * 调用方不传 `nodes`/`objects` 时是入参原样。
   */
  objects: MapObject[];
  /**
   * 更新后的**监狱**占用表（`0x496b30`）。
   *
   * ★★ 2026 本轮：此前这里叫 `occupancy` 且**调用方根本不传**（用了个全 0 的
   *   默认数组），于是「嫁禍/復仇」把人关进监狱却**没在主状态里占床位** ——
   *   客户端 `confine-fx.ts` 靠"占用表 0→1"的跳变播关押动效，因此那张卡
   *   连动效都不会播。现在两张表都进 ctx/结果。
   */
  prisonOccupancy: number[];
  /** 更新后的**医院**占用表（`0x496b60`）——首次关押要清掉它那一格 */
  hospitalOccupancy: number[];
  /** 敌意变化：目标对出牌者 */
  hostilityDeltas: { from: number; to: number; delta: number }[];
  outcome: FrameOutcome | null;
}

/**
 * 使用陷害卡。
 *
 * 原版顺序（VA 0x004445a2 起），**不可调换**：
 * 1. `update_hostility(target, current, price_index × 150)`
 *    —— ★ 敌意**先记**，免疫与否都记
 * 2. 免罪卡(21)：`has_card(target, 0x15)` 命中 → `call 0x444bb2(target)`
 *    并**直接结束**，不入狱
 * 3. 嫁祸卡(19)：`has_card(target, 0x13)` 命中 → `0x44476a` 选新目标，
 *    返回 -1 表示放弃，否则 `target = 新目标`
 * 4. `send_to_prison(target, target === current ? 4 : 5)`
 *
 * ⚠️ 目标 >= 4 时走**物件分支**（VA 0x0044467a），把地图物件也能"关起来"，
 *    刑期固定 5 天。本实现只处理玩家目标，物件分支待物件系统落地。
 *
 * @param scapegoatPicker 嫁祸的新目标由外部（UI/AI）给出，-1 表示放弃。
 *                        目标选择是表现层职责（C-ARC-2）。
 */
export function applyFrameCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
  priceIndex: number,
  scapegoatPicker: (from: number) => number = () => -1,
  prisonOccupancy: readonly number[] = new Array<number>(CONFINEMENT_SLOTS).fill(0),
  hospitalOccupancy: readonly number[] = new Array<number>(CONFINEMENT_SLOTS).fill(0),
  nodes: readonly MapNode[] = [],
  objects: readonly MapObject[] = [],
  landscapes: readonly LandscapeInfo[] = [],
): FrameResult {
  const fail = (error: TargetError): FrameResult => ({
    ok: false,
    error,
    players: [...players],
    objects: [...objects],
    prisonOccupancy: [...prisonOccupancy],
    hospitalOccupancy: [...hospitalOccupancy],
    hostilityDeltas: [],
    outcome: null,
  });

  if (target.kind !== 'player') return fail('wrongTargetKind');
  if (target.index < 0 || target.index >= players.length) return fail('playerOutOfRange');

  const victim0 = players[target.index];
  if (victim0 === undefined) return fail('playerOutOfRange');

  // 1. 敌意先记 @source call 0x40df69(target, current, pi*150)
  const hostilityDeltas = [
    { from: target.index, to: currentPlayer, delta: priceIndex * FRAME_HOSTILITY_FACTOR },
  ];

  // 2. 免罪卡：命中即结束 @source push 0x15 / call has_card / call 0x444bb2
  //    ★ 命中时**该卡被消耗**（`0x444bb2` 内部 `0x444c11 call 0x441343`）；
  //      详见 `passive.ts` 的 `applyDefensiveCards`。
  const def = applyDefensiveCards(victim0);
  const originalTarget = target.index; // ★ 復仇卡的判据要用「原始目标」，不是改写后的
  let victimIndex = target.index;
  let redirected = false;

  if (def.trigger.kind === 'absolution') {
    return {
      ok: true,
      error: null,
      // ★ 受害者少一张免罪卡（其余玩家不变）
      players: players.map((p, i) => (i === target.index ? def.player : p)),
      objects: [...objects],
      prisonOccupancy: [...prisonOccupancy],
      hospitalOccupancy: [...hospitalOccupancy],
      hostilityDeltas,
      outcome: { kind: 'absolved', absolvedBy: target.index },
    };
  }

  // 3. 嫁祸卡：改写目标 @source push 0x13 / call has_card / call 0x44476a
  //    ★ 同上：命中时消耗（`0x4449ef call 0x441343`）
  let playersAfterDefense: readonly Player[] = players;
  if (def.trigger.kind === 'scapegoat') {
    const picked = scapegoatPicker(target.index);
    // @source cmp eax, -1 / je 保持原目标 / mov ebx, eax
    if (picked !== -1 && picked >= 0 && picked < players.length) {
      victimIndex = picked;
      redirected = true;
      // ★★ 只有**真的改写了目标**才扣嫁祸卡(19)：原版 `0x4449e7 cmp ebx,-1` /
      //   `0x4449ea je 0x444a53` 在扣卡点 `0x4449ef` **之前** ⇒ 放弃转嫁不扣卡。
      //   （通道 2 `test_passive_cards.py` 130/130；订正 README §四之二 第 11 条。）
      playersAfterDefense = players.map((p, i) =>
        i === target.index ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p,
      );
    }
  }

  // 4. 入狱 —— ★ 比较的是**改写之后**的目标
  //    走 rules/confinement.ts，从而自动获得「已在狱中则加刑」的语义
  const days = victimIndex === currentPlayer ? FRAME_DAYS_SELF : FRAME_DAYS_OTHER;
  // ★ 入狱首次要清**医院**那一张（原版 `0x41a7c5 call 0x40d761` 的两道闸）
  // ★★ 并且首次要**传送到监狱格 + 跟班搬家**（`0x444678 call 0x43d593`，
  //    那两件事写在 `send_to_prison` 函数体内）—— 走 `sendToConfinement`。
  const out = sendToConfinement(
    [...playersAfterDefense],
    objects,
    nodes,
    prisonOccupancy,
    'prison',
    victimIndex,
    days,
    hospitalOccupancy,
    landscapes,
  );

  // 5. ★★ 復仇卡(18)：**在主效果施加之后**才查，且仅当
  //    「最终目标 == 原始目标」（未被嫁祸改写）
  //    @source `0x00444652 cmp ebx, edi / jne 0x444685`（ebx = 最终目标，edi = 原始目标）
  //            `0x00444659 call 0x4413ad`（has_card(原始目标, 18)）
  //            `0x00444667 call 0x444691`（復仇卡生效 ⇒ **消耗 18**，见 `0x4446f0`）
  //            `0x0044466f push 5` / `0x00444671 mov ecx,[0x49910c]` / `0x00444678 call 0x43d593`
  //            ⇒ **把施卡者送进监狱 5 天**（硬编码 5）
  //    此前 remake 完全没有这一支 —— 陷害卡的受害者拿着復仇卡也不会反弹。
  let players2 = out.players;
  let objects2 = out.objects;
  let occupancy2 = out.occupancy;                       // confine 的 occupancy = 目标表（监狱）
  const hospital2 = out.otherOccupancy ?? [...hospitalOccupancy];
  let revenged = false;
  const originalHolder = players2[originalTarget];
  if (
    !redirected &&
    victimIndex === originalTarget &&
    originalHolder !== undefined &&
    playerHasCard(originalHolder, PASSIVE_CARDS.REVENGE)
  ) {
    // 先消耗復仇卡（`0x004446f0 remove_card(持有者, 18)`）
    players2 = players2.map((p, i) =>
      i === originalTarget ? consumeCard(p, PASSIVE_CARDS.REVENGE) : p,
    );
    // 再把**施卡者**关 5 天（`0x00444678 call 0x43d593([0x49910c], 5)`）
    const second = sendToConfinement(
      [...players2],
      objects2,
      nodes,
      occupancy2,
      'prison',
      currentPlayer,
      REVENGE_DAYS,
      hospital2,
      landscapes,
    );
    players2 = second.players;
    objects2 = second.objects;
    occupancy2 = second.occupancy;
    revenged = true;
  }

  return {
    ok: true,
    error: null,
    players: players2,
    objects: objects2,
    prisonOccupancy: occupancy2,
    hospitalOccupancy: hospital2,
    hostilityDeltas,
    outcome: {
      kind: 'imprisoned',
      victim: victimIndex,
      days: out.days,
      redirected,
      ...(revenged ? { revenged: true } : {}),
    },
  };
}
