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
import { isAlive } from '../state/types.ts';
import { blessingMultiplier } from '../rules/blessing.ts';
import { bankDividend, incomeTax, propertyTax, stockTax } from '../rules/percentage.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';

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
  /**
   * 地价税（新闻 12）要的两张表 —— 归属与等级取**运行时**（`landOwner`/`landLevel`
   * 已经并进这两张表的 `owner`/`level`，见 `allEffectiveLands`）。
   */
  lands?: readonly LandInfo[];
  facilities?: readonly FacilityInfo[];
  /** 證交稅（新闻 13）要的持股与现价 */
  holdings?: readonly (readonly number[])[];
  prices?: readonly number[];
  pool?: number;
  occupancy?: readonly number[];
  /** 覆盖天数；通常取自事件表的 literal */
  days?: number;
  /** 神明加持倍率档位：2 加倍、1 归零、0 不变（见 rules/blessing.ts） */
  multiplier?: number;
}

/**
 * 四条百分比事件的「每人多少钱」。
 *
 * | 事件 | 基数 | 税率 | 方向 | @source |
 * |---|---|---|---|---|
 * | 11 所得稅 | 现金 `+0x1c` | 5% | 缴公库 | `0x00449cce` |
 * | 12 地價稅 | 名下地产原值 | 5%×物價 | 缴公库 | `0x00449ede` |
 * | 13 證交稅 | 持股市值 | 5%×物價 | 缴公库 | `0x0044a0e5` |
 * | 23 儲金紅利 | 存款 `+0x20` | 10% | **发钱**（银行出）| `0x0044af3c` |
 *
 * ★ 11 与 23 不乘物价指数（`0x4990e8` 在这两支里一次都没出现），
 *   12/13 是「先 trunc 再乘指数」——规矩都在 `rules/percentage.ts` 里。
 */
export const PERCENT_NEWS: ReadonlyMap<
  number,
  (p: Player, who: number, ctx: NewsEffectContext) => number
> = new Map([
  [11, (p: Player) => incomeTax(p)],
  [
    12,
    (p: Player, who: number, ctx: NewsEffectContext) =>
      propertyTax(who, ctx.lands ?? [], ctx.facilities ?? [], ctx.priceIndex),
  ],
  [
    13,
    (p: Player, who: number, ctx: NewsEffectContext) =>
      stockTax(ctx.holdings?.[who] ?? [], ctx.prices ?? [], ctx.priceIndex),
  ],
  [23, (p: Player) => bankDividend(p)],
]);

/**
 * 本模块**已能施加效果**的新聞事件编号。
 *
 * 三类：
 * 1. 固定金额（`factor != null`）的 `pay`/`give`；
 * 2. 坐牢 / 住院；
 * 3. ★ **百分比类**（2026-09-16 接上）：11 所得稅 5%、12 地價稅 5%、
 *    13 證交稅 5%、23 儲金紅利 10% —— 金额逐人现算，见 `PERCENT_NEWS`
 *    与 `rules/percentage.ts`。这四条先前是「规则译好了但没人调用」，
 *    抽到只画文案、一分钱不动。
 *
 * ⚠️ 其中 4 与 29 的文案里**没有 `%d`**（「外星人攻打地球」「坐牢５天」——
 * 后者的 5 是写死的全角字），故 `literal` 为 null，天数必须由调用方给出；
 * 不给就报 `unimplemented`，不会默默关 0 天。
 */
export const IMPLEMENTED_NEWS_IDS: readonly number[] = [
  ...NEWS_EVENTS.filter(
    (e) =>
      e.effects.includes('prison') ||
      e.effects.includes('hospital') ||
      (e.factor !== null && (e.effects.includes('pay') || e.effects.includes('give'))),
  ).map((e) => e.id),
  ...PERCENT_NEWS.keys(),
];

/** 銀行擠兌的停放天数 @source 0x0044aeb6 `mov byte/word [player+0x3c], 15`（写死立即数） */
export const LOAN_FREEZE_DAYS = 15;

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

  const amount = eventAmount(entry, ctx.priceIndex) * blessingMultiplier(ctx.multiplier ?? 0);
  let total = 0;
  let bankrupted = false;

  // ★ 銀行擠兌：不看 affected，**所有在场玩家**的 +0x3c 都写成 15 @source 0x0044aeb6..0x0044aed8
  //   天数 15 是汇编里写死的立即数；文案的「１５」是全角字、没有 %d，
  //   故 event-table 的 literal 为 null（同 4/29 的既有先例），常数住在这里。
  if (entry.effects.includes('loanFreeze')) {
    const days = LOAN_FREEZE_DAYS;
    const next = players.map((p) => (isAlive(p) ? { ...p, bankFreezeDays: days } : p));
    return { ...base, players: next, amount: days };
  }

  // ── 百分比类（11/12/13/23）────────────────────────────────────
  // ★ 四条事件的 `factor` 都是 null，金额要**逐人现算**（见 rules/percentage.ts）：
  // ```asm
  // 00449cce  for (i = 0; i < num_players; i++) {
  //             if (player[i].who_plays == 0) continue      ; 出局跳过
  //             [0x48c59c + i*4] = trunc(基数 × 税率)        ; ★ 先算好存起来
  //             … 画那一行「%s 繳交 %d 元」…
  //           }
  // 00449da1  for (i = 0; i < num_players; i++) {          ; ★ 第二趟才真收钱
  //             if ([0x46caf8] != 0) break                  ; 终局码
  //             pay_money(player[i], -1, [0x48c59c + i*4], 0)
  //           }
  // ```
  // 地價稅 / 證交稅 / 儲金紅利三支同构，只有基数与税率不同。
  const perPlayer = PERCENT_NEWS.get(eventId);
  if (perPlayer !== undefined) {
    for (const who of ctx.affected) {
      const p = players[who];
      if (p === undefined || !isAlive(p)) continue;
      const each = perPlayer(p, who, ctx);
      if (each <= 0) continue;
      if (entry.effects.includes('pay')) {
        const r = transferMoney(players, [], pool, who, PARTY_POOL, each, 0);
        players = r.players;
        pool = r.pool;
        total += r.paid;
        bankrupted = bankrupted || r.bankrupted;
      } else {
        players = receiveMoney(players, who, each);
        total += each;
      }
    }
    return { players, pool, occupancy, amount: total, bankrupted, unimplemented: false };
  }

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
