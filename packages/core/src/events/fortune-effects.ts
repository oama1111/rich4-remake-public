/*
 * 命運事件的效果
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 两阶段结构。每个事件函数入口都是：
 * ```asm
 * cmp dword [esp + 0x94], 0
 * jne 施加阶段
 * …公告阶段：算出金额存进 [0x48c5b4]，格式化提示语，显示…
 * ```
 * 即**同一个函数被调用两次**：先公告、后施加。
 * 这解释了为什么 `scan fortune all` 几乎扫不到状态写入——
 * 写入都在第二阶段跳转到的共用尾部里。
 *
 * 金额一律是 `物价指数 × factor`，系数见 `@rich4/data` 的 FORTUNE_EVENTS。
 */

import type { Player } from '../state/types.ts';
import { FORTUNE_EVENTS, eventAmount, fortuneEvent } from '@rich4/data';
import { PARTY_POOL, receiveMoney, transferMoney } from '../rules/payment.ts';
import { confine } from '../rules/confinement.ts';

/**
 * 金额加倍的修正。
 *
 * @source 施加阶段先 `call 0x44b896` 取一个结果，为 2 时：
 * ```asm
 * mov esi, [0x48c5b4]
 * add esi, esi            ; ★ 金额翻倍
 * mov [0x48c5b4], esi
 * ```
 * 该函数读 `word [player + 0x46]`，**语义待确认**（疑与道具或神明有关），
 * 故此处把倍率作为参数交由调用方给出，core 不臆测其来源。
 */
export const DOUBLE_AMOUNT = 2;

/**
 * 支票跳票后银行拒绝往来的天数。
 * @source `add byte [player + 0x3b], 0x1e`（VA 0x0044c2ba）——0x1e = 30。
 * ★ 事件文案写作「一個月」，这里得到了确切数值。
 */
export const BANK_BAN_DAYS = 30;

export interface FortuneEffectResult {
  players: Player[];
  /** 公库余额 */
  pool: number;
  /** 监狱／医院占用表 */
  occupancy: number[];
  /** 实际动用的金额（已含倍率） */
  amount: number;
  /** 是否有人因此破产 */
  bankrupted: boolean;
  /** 未实现的事件在此标记，便于上层降级处理 */
  unimplemented: boolean;
}

export interface FortuneEffectContext {
  players: readonly Player[];
  currentPlayer: number;
  priceIndex: number;
  pool?: number;
  occupancy?: readonly number[];
  /** `0x44b896` 的结果；2 表示金额翻倍 */
  multiplier?: number;
  /**
   * 覆盖坐牢／住院天数。通常**不必给**——天数已在事件表的 `literal` 里
   * （公告阶段 `mov [0x48c5b4], imm` 的字面常量）。
   */
  days?: number;
}

/** 本模块已实现效果的命運事件编号 */
export const IMPLEMENTED_FORTUNE_IDS: readonly number[] = FORTUNE_EVENTS.filter(
  (e) => e.factor !== null && (e.effects.includes('pay') || e.effects.includes('give')),
).map((e) => e.id);

/**
 * 施加一个命運事件的效果（第二阶段）。
 *
 * 目前实现的是**纯金额**事件（罚款／捡钱／中奖／保险），它们占了
 * 命運表里最大的一块，且效果完全由 `factor` 与方向决定。
 *
 * ★ 两个方向**不对称**，这是照搬而非简化：
 * - `pay`  → `transferMoney(current, PARTY_POOL, 金额, 0)`
 *            现金不够会动存款，两者都空则破产
 * - `give` → `receiveMoney(current, 金额)` 直接加现金，不可能破产
 *
 * 坐牢（33..36）与住院（12/13）走 `confine`，天数取自事件表的 `literal`：
 * 酒醉大鬧 3 天、防礙風化 5 天、走私毒品 7 天、販賣大補帖 9 天；
 * 就醫与住院各 3 天。
 */
export function applyFortuneEffect(
  eventId: number,
  ctx: FortuneEffectContext,
): FortuneEffectResult {
  const players = [...ctx.players];
  const pool = ctx.pool ?? 0;
  const occupancy = [...(ctx.occupancy ?? new Array<number>(8).fill(0))];
  const base: FortuneEffectResult = {
    players,
    pool,
    occupancy,
    amount: 0,
    bankrupted: false,
    unimplemented: false,
  };

  const entry = fortuneEvent(eventId);
  if (entry === undefined) return { ...base, unimplemented: true };

  const amount = eventAmount(entry, ctx.priceIndex) * (ctx.multiplier === DOUBLE_AMOUNT ? 2 : 1);

  if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
    // 天数取自事件表的 literal（公告阶段写进 [0x48c5b4] 的字面常量）
    const days = ctx.days ?? entry.literal;
    if (days === null || days === undefined) return { ...base, unimplemented: true };
    const kind = entry.effects.includes('prison') ? 'prison' : 'hospital';
    const out = confine(players, occupancy, kind, ctx.currentPlayer, days);
    return { ...base, players: out.players, occupancy: out.occupancy, amount: days };
  }

  // ★ 冒貸：直接给 loan 加钱，不经任何付款通道
  // @source add dword [player + 0x24], edx（VA 0x0044c1fa）
  if (entry.effects.includes('loan')) {
    const p = players[ctx.currentPlayer];
    if (p === undefined) return { ...base, unimplemented: true };
    const next = players.map((q, i) =>
      i === ctx.currentPlayer ? { ...q, loan: q.loan + amount } : q,
    );
    return { ...base, players: next, amount };
  }

  // ★ 支票跳票：银行拒绝往来 30 天
  // @source add byte [player + 0x3b], 0x1e（VA 0x0044c2ba）
  if (entry.effects.includes('bankBan')) {
    const next = players.map((q, i) =>
      i === ctx.currentPlayer
        ? { ...q, daysRejectedByBank: q.daysRejectedByBank + BANK_BAN_DAYS }
        : q,
    );
    return { ...base, players: next };
  }

  if (entry.factor === null) return { ...base, unimplemented: true };

  if (entry.effects.includes('pay')) {
    const r = transferMoney(players, [], pool, ctx.currentPlayer, PARTY_POOL, amount, 0);
    return {
      players: r.players,
      pool: r.pool,
      occupancy,
      amount: r.paid,
      bankrupted: r.bankrupted,
      unimplemented: false,
    };
  }

  if (entry.effects.includes('give')) {
    return {
      ...base,
      players: receiveMoney(players, ctx.currentPlayer, amount),
      amount,
    };
  }

  return { ...base, unimplemented: true };
}
