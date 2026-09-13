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
import { PASSIVE_CARDS, playerHasCard } from './passive.ts';
import { CONFINEMENT_SLOTS, KNOWN_PRISON_DAYS, confine } from '../rules/confinement.ts';

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
  /** 有人入狱 */
  | { kind: 'imprisoned'; victim: number; days: number; redirected: boolean };

export interface FrameResult {
  ok: boolean;
  error: TargetError | null;
  players: Player[];
  /** 更新后的监狱占用表 */
  occupancy: number[];
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
  occupancy: readonly number[] = new Array<number>(CONFINEMENT_SLOTS).fill(0),
): FrameResult {
  const fail = (error: TargetError): FrameResult => ({
    ok: false,
    error,
    players: [...players],
    occupancy: [...occupancy],
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
  if (playerHasCard(victim0, PASSIVE_CARDS.ABSOLUTION)) {
    return {
      ok: true,
      error: null,
      players: [...players],
      occupancy: [...occupancy],
      hostilityDeltas,
      outcome: { kind: 'absolved', absolvedBy: target.index },
    };
  }

  // 3. 嫁祸卡：改写目标 @source push 0x13 / call has_card / call 0x44476a
  let victimIndex = target.index;
  let redirected = false;
  if (playerHasCard(victim0, PASSIVE_CARDS.SCAPEGOAT)) {
    const picked = scapegoatPicker(target.index);
    // @source cmp eax, -1 / je 保持原目标 / mov ebx, eax
    if (picked !== -1 && picked >= 0 && picked < players.length) {
      victimIndex = picked;
      redirected = true;
    }
  }

  // 4. 入狱 —— ★ 比较的是**改写之后**的目标
  //    走 rules/confinement.ts，从而自动获得「已在狱中则加刑」的语义
  const days = victimIndex === currentPlayer ? FRAME_DAYS_SELF : FRAME_DAYS_OTHER;
  const out = confine(players, occupancy, 'prison', victimIndex, days);

  return {
    ok: true,
    error: null,
    players: out.players,
    occupancy: out.occupancy,
    hostilityDeltas,
    outcome: { kind: 'imprisoned', victim: victimIndex, days: out.days, redirected },
  };
}
