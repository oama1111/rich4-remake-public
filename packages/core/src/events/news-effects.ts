/*
 * 新聞事件的效果
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 与命運事件同为两阶段结构（先公告、后施加），金额也同为
 * `物价指数 × factor`，故复用同一套方向语义。
 *
 * ⚠️ 与命運的**关键差别**：新聞事件大多**不作用于当前玩家**。
 * 文案里的 `%s` 是被点名的对象——「公開表揚第一大地主%s獲得%d元獎勵」
 * 的受益者是**地主**，不是抽到这张新闻的人。
 * 因此本模块的接口要求调用方**显式给出受影响的玩家**，
 * 不像命運那样默认取 `currentPlayer`。
 */

import type { Player } from '../state/types.ts';
import { NEWS_EVENTS, eventAmount, newsEvent } from '@rich4/data';
import { PARTY_POOL, receiveMoney, transferMoney } from '../rules/payment.ts';
import { confine } from '../rules/confinement.ts';

export interface NewsEffectResult {
  players: Player[];
  pool: number;
  occupancy: number[];
  amount: number;
  bankrupted: boolean;
  unimplemented: boolean;
}

export interface NewsEffectContext {
  players: readonly Player[];
  /**
   * ★ **受影响的玩家**，由调用方指定。
   *
   * 新聞事件的对象多半不是抽牌者，而是「第一大地主」「土地最少者」
   * 「股市第一大戶」这类由局面算出来的人。谁符合条件属于**选择**，
   * 按 C-ARC-2 由外部决定，core 只施加效果。
   */
  affected: readonly number[];
  priceIndex: number;
  pool?: number;
  occupancy?: readonly number[];
  /** 覆盖天数；通常取自事件表的 literal */
  days?: number;
}

/**
 * 本模块**已能施加效果**的新聞事件编号。
 *
 * ⚠️ 比「有方向的事件」要少。新聞里的付款类**全是百分比**：
 * 11/12/13「所有人繳交所得稅／地價稅／證交稅５％」、
 * 23「銀行加發１０％儲金紅利」——它们的 `factor` 为 null，
 * 金额要由玩家的收入／地产／持股现算，属于另一套机制，尚未实现。
 *
 * 实际能算的是：4（送医院）、8/9/10（带固定 factor 的奖励）、29（送监狱）。
 *
 * ⚠️ 其中 4 与 29 的文案里**没有 `%d`**（「外星人攻打地球」「坐牢５天」——
 * 后者的 5 是写死的全角字），故 `literal` 为 null，天数必须由调用方给出；
 * 不给就报 `unimplemented`，不会默默关 0 天。
 */
export const IMPLEMENTED_NEWS_IDS: readonly number[] = NEWS_EVENTS.filter(
  (e) =>
    e.effects.includes('prison') ||
    e.effects.includes('hospital') ||
    (e.factor !== null && (e.effects.includes('pay') || e.effects.includes('give'))),
).map((e) => e.id);

/**
 * 施加一个新聞事件的效果（第二阶段）。
 *
 * 方向与命運一致：
 * - `pay`  → `transferMoney(玩家, PARTY_POOL, 金额, 0)`，含级联与破产
 * - `give` → `receiveMoney(玩家, 金额)`，直接加现金
 * - `prison` / `hospital` → `confine`
 *
 * 对 `affected` 里的**每个**玩家各施加一次——税金类事件
 * （11/12/13「所有人繳交…」）正是对全体生效。
 */
export function applyNewsEffect(
  eventId: number,
  ctx: NewsEffectContext,
): NewsEffectResult {
  let players = [...ctx.players];
  let pool = ctx.pool ?? 0;
  let occupancy = [...(ctx.occupancy ?? new Array<number>(8).fill(0))];
  const base: NewsEffectResult = {
    players,
    pool,
    occupancy,
    amount: 0,
    bankrupted: false,
    unimplemented: false,
  };

  const entry = newsEvent(eventId);
  if (entry === undefined || entry.effects.length === 0) {
    return { ...base, unimplemented: true };
  }

  const amount = eventAmount(entry, ctx.priceIndex);
  let total = 0;
  let bankrupted = false;

  for (const who of ctx.affected) {
    if (players[who] === undefined) continue;

    if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
      const days = ctx.days ?? entry.literal;
      if (days === null || days === undefined) return { ...base, unimplemented: true };
      const kind = entry.effects.includes('prison') ? 'prison' : 'hospital';
      const out = confine(players, occupancy, kind, who, days);
      players = out.players;
      occupancy = out.occupancy;
      total = days;
      continue;
    }

    if (entry.factor === null) return { ...base, unimplemented: true };

    if (entry.effects.includes('pay')) {
      const r = transferMoney(players, [], pool, who, PARTY_POOL, amount, 0);
      players = r.players;
      pool = r.pool;
      total += r.paid;
      bankrupted = bankrupted || r.bankrupted;
    } else if (entry.effects.includes('give')) {
      players = receiveMoney(players, who, amount);
      total += amount;
    }
  }

  return { players, pool, occupancy, amount: total, bankrupted, unimplemented: false };
}
