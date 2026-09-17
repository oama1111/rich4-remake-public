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
import { CONFINEMENT_SLOTS, confine } from '../rules/confinement.ts';
import type { StockMarketState } from '../places/stock-market.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { isAlive } from '../state/types.ts';
import { blessingMultiplier } from '../rules/blessing.ts';
import { bankDividend, incomeTax, propertyTax, stockTax } from '../rules/percentage.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';

export interface NewsEffectResult {
  players: Player[];
  pool: number;
  /**
   * 监狱占用表（`0x496b30`，8 槽）／医院占用表（`0x496b60`，8 槽）。
   *
   * ★ 2026-09-17 起**两张分开给**：先前的单一 `occupancy` 让调用方一律传
   *   `prisonOccupancy`，于是新聞 4「外星人攻打地球」（`hospital` 效果）把医院的人
   *   记进了**监狱**表。占用表就是原版那两张字节表（槽 0..3 玩家、4..7 物件），
   *   见 `rules/confinement.ts` 与 `docs/deviations/Q-CONFINE-1`。
   */
  prisonOccupancy: number[];
  hospitalOccupancy: number[];
  /**
   * 股市那边被改动后的行情（新聞 24/25/26 会改）；没碰就**不带**这个字段
   *   （调用方用 `out.market ?? 原值` 回写）。
   */
  market?: StockMarketState;
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
  /** 监狱占用表（`0x496b30`）—— `prison` / `releasePrison` / `extendPrison` 效果用它 */
  prisonOccupancy?: readonly number[];
  /** 医院占用表（`0x496b60`）—— `hospital` / `releaseHospital` / `extendHospital` 效果用它 */
  hospitalOccupancy?: readonly number[];
  /** 行情 —— 新聞 24/25（改各股 `newsFlag`）与 26（改 `closedDays`）要它 */
  market?: StockMarketState;
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
      // ★ 2026-09-17：四条「释放／延长」也在此列 —— 它们的 effects 先前是空的，
      //   于是抽到只画文案、一分钱一天都不动（见 docs/known-deviations.md）
      e.effects.includes('releasePrison') ||
      e.effects.includes('releaseHospital') ||
      e.effects.includes('extendPrison') ||
      e.effects.includes('extendHospital') ||
      e.effects.includes('loanFreeze') ||
      // ★ 2026-09-17：16/17（行人/車輛休息一回合）与 24/25/26（股市三连）
      e.effects.includes('stopPedestrians') ||
      e.effects.includes('stopVehicles') ||
      e.effects.includes('marketBearish') ||
      e.effects.includes('marketBullish') ||
      e.effects.includes('marketClose') ||
      (e.factor !== null && (e.effects.includes('pay') || e.effects.includes('give'))),
  ).map((e) => e.id),
  ...PERCENT_NEWS.keys(),
];

/** 銀行擠兌的停放天数 @source 0x0044aeb6 `mov byte/word [player+0x3c], 15`（写死立即数） */
export const LOAN_FREEZE_DAYS = 15;

/**
 * 新聞 26「股市暫停交易１０天」写入的全股市休市天数
 * @source VA 0x0044b0c6 `mov dword [0x4990dc], 0xa`
 *   （文案的「１０」是全角字、没有 `%d`，所以 event-table 的 literal 是 null）
 */
export const MARKET_CLOSE_DAYS = 0xa;

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
  let prisonOccupancy = [...(ctx.prisonOccupancy ?? new Array<number>(CONFINEMENT_SLOTS).fill(0))];
  let hospitalOccupancy = [
    ...(ctx.hospitalOccupancy ?? new Array<number>(CONFINEMENT_SLOTS).fill(0)),
  ];
  const base: NewsEffectResult = {
    players,
    pool,
    prisonOccupancy,
    hospitalOccupancy,
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

  // ── 新聞 0/2「無罪開釋／提前出院」与 1/3「延長刑期／延長住院」──────────
  //   ★ 这四条**不看 `affected`**：原版扫占用表，谁在里面就动谁。
  //     @source `rich4_news.asm` 四个函数各有一段同构的循环：
  //     ```asm
  //     xor ebx, ebx                   ; i = 0
  //     mov esi, 0x148                 ; 头像落点 y
  //     loop:
  //       cmp byte [ebx + 0x496b30], 0   ; ★ 监狱表（医院那两条是 0x496b60）
  //       je  next                       ; 不在里面 → 跳过
  //       … 在 (0x186, y) 画这个人 + 建筑图 …
  //       ; 释放：mov byte [player+0x34], 0x80 / mov byte [ebx+0x496b30], 0
  //       ; 延长：add dh, n / mov cl, dh / and cl, 0x7f   ⇒ (days + n) & 0x7f
  //       add esi, 0x2a
  //     next:
  //       inc ebx / cmp ebx, 4 / jl loop
  //     ```
  //   ★ 循环上界是 **4** ⇒ 只动玩家槽 0..3，地图物件槽 4..7 够不到。
  const kind: 'prison' | 'hospital' | null = entry.effects.includes('releasePrison') ||
    entry.effects.includes('extendPrison')
    ? 'prison'
    : entry.effects.includes('releaseHospital') || entry.effects.includes('extendHospital')
      ? 'hospital'
      : null;
  if (kind !== null) {
    const releasing =
      entry.effects.includes('releasePrison') || entry.effects.includes('releaseHospital');
    const table = kind === 'prison' ? prisonOccupancy : hospitalOccupancy;
    const field: 'inPrison' | 'inHospital' = kind === 'prison' ? 'inPrison' : 'inHospital';
    // 「延长 %d 天」的 n = 文案里的字面常量（`mov ecx, 3` ⇒ literal 3）
    const days = ctx.days ?? entry.literal ?? 0;
    const next = [...players];
    const nextTable = [...table];
    for (let who = 0; who < 4; who++) {
      const p = next[who];
      if (p === undefined) continue;
      // ★ 闸门是**占用表**（不是天数）
      if ((nextTable[who] ?? 0) === 0) continue;
      if (releasing) {
        // 释放 = 挂「待释放」位（下一次推进才真正走释放流程）+ 清占用槽
        next[who] = { ...p, blocking: { ...p.blocking, [field]: RELEASE_PENDING } };
        nextTable[who] = 0;
      } else {
        // 延长 = (当前 + n) & 0x7f —— ★ 掩码会把 0x80 抹掉
        const raw = ((p.blocking[field] as number) + days) & 0x7f;
        next[who] = { ...p, blocking: { ...p.blocking, [field]: raw } };
      }
    }
    if (kind === 'prison') prisonOccupancy = nextTable;
    else hospitalOccupancy = nextTable;
    return {
      players: next,
      pool,
      prisonOccupancy,
      hospitalOccupancy,
      amount: days,
      bankrupted,
      unimplemented: false,
    };
  }

  // ★ 銀行擠兌：不看 affected，**所有在场玩家**的 +0x3c 都写成 15 @source 0x0044aeb6..0x0044aed8
  //   天数 15 是汇编里写死的立即数；文案的「１５」是全角字、没有 %d，
  //   故 event-table 的 literal 为 null（同 4/29 的既有先例），常数住在这里。
  if (entry.effects.includes('loanFreeze')) {
    const days = LOAN_FREEZE_DAYS;
    const next = players.map((p) => (isAlive(p) ? { ...p, bankFreezeDays: days } : p));
    return { ...base, players: next, amount: days };
  }

  // ── 新聞 16 / 17「行人／車輛休息一回合」────────────────────────
  //   ★ 也是**不看 `affected`**：原版逐人筛「在场 + 交通方式对得上」，命中就写
  //     `+0x38 (days_stopping) = 1`。
  //     @source `fcn_0044a5d6`（VA 0x0044a606 起）与 `fcn_0044a657`（0x0044a68b 起）：
  //     ```asm
  //     for (i = 0; i < [0x499114]; i++) {          ; num_players
  //       if (player[+0x15] == 0) continue;          ; 出局跳过
  //       if (player[+0x11] != 0) continue;          ; ★ 16：traffic_method != 0 → 跳过（只打行人）
  //       … 画头像 …
  //       player[+0x38] = 1                          ; days_stopping
  //     }
  //     ```
  //     17 的那一支把中间的判据反过来（`je skip`）⇒ 只打**非行人**。
  if (
    entry.effects.includes('stopPedestrians') ||
    entry.effects.includes('stopVehicles')
  ) {
    const wantPedestrian = entry.effects.includes('stopPedestrians');
    const next = players.map((p) => {
      if (!isAlive(p)) return p;
      // traffic_method 0 = 走路（行人）；非 0 = 有座驾
      const isPedestrian = p.trafficMethod === 0;
      if (isPedestrian !== wantPedestrian) return p;
      return { ...p, blocking: { ...p.blocking, stopping: 1 } };
    });
    return { ...base, players: next, amount: 1 };
  }

  // ── 新聞 24 / 25「股市崩盤／全面上漲」──────────────────────────
  //   @source VA 0x0044b035..0x0044b047（24）与 0x0044b080..0x0044b092（25）：
  //   ```asm
  //   for (edx = 0; edx < 0xc; edx++) {
  //     eax = edx*9                       ; 一支股票 36 字节 = 9 个 dword
  //     byte [eax*4 + 0x496987] = 1       ; 24：低半字节 1 = 利空 1 天
  //     byte [eax*4 + 0x496987] = 0x10    ; 25：高半字节 1 = 利多 1 天
  //   }
  //   ```
  //   ★ 是**赋值**不是置位 ⇒ 会把原有的剩余天数冲掉（两支都照抄）。
  if (entry.effects.includes('marketBearish') || entry.effects.includes('marketBullish')) {
    const flag = entry.effects.includes('marketBullish') ? 0x10 : 0x1;
    const market = ctx.market;
    if (market === undefined) return { ...base, unimplemented: true };
    const stocks = market.stocks.map((s) => ({ ...s, newsFlag: flag }));
    return { ...base, amount: 1, market: { ...market, stocks } };
  }

  // ── 新聞 26「股市暫停交易１０天」──────────────────────────────
  //   @source VA 0x0044b0c6 `mov dword [0x4990dc], 0xa` ⇒ `closedDays = 10`
  //   （文案说 10 天，但计数「减到 0 先置 0x80、隔天再清」⇒ 实际关门 11 天，见
  //    `stock-market.ts` 的 `tickMarketClosure`）。这四条**不看 `affected`**。
  if (entry.effects.includes('marketClose')) {
    const market = ctx.market;
    if (market === undefined) return { ...base, unimplemented: true };
    return { ...base, amount: MARKET_CLOSE_DAYS, market: { ...market, closedDays: MARKET_CLOSE_DAYS } };
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
    return {
      players,
      pool,
      prisonOccupancy,
      hospitalOccupancy,
      amount: total,
      bankrupted,
      unimplemented: false,
    };
  }

  for (const who of ctx.affected) {
    if (players[who] === undefined) continue;

    if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
      const days = ctx.days ?? entry.literal;
      if (days === null || days === undefined) return { ...base, unimplemented: true };
      const kind = entry.effects.includes('prison') ? 'prison' : 'hospital';
      // ★ 两张表各归各的（先前一律写监狱表，医院的人会记错地方）
      const table = kind === 'prison' ? prisonOccupancy : hospitalOccupancy;
      const out = confine(players, table, kind, who, days);
      players = out.players;
      if (kind === 'prison') prisonOccupancy = out.occupancy;
      else hospitalOccupancy = out.occupancy;
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

  return {
    players,
    pool,
    prisonOccupancy,
    hospitalOccupancy,
    amount: total,
    bankrupted,
    unimplemented: false,
  };
}
