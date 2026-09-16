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
import { BLESSING_DOUBLE, BLESSING_VOID, blessingMultiplier } from '../rules/blessing.ts';
import { sellAllCards, sellAllTools } from '../rules/inventory.ts';
import {
  EMPTY_HOLDING,
  sellStock,
  type SellDestination,
  type StockHolding,
} from '../places/stock.ts';
import type { StockMarketState } from '../places/stock-market.ts';

/**
 * 金额倍率档位 —— 转发 `rules/blessing.ts` 的定义。
 *
 * @source 施加阶段先 `call 0x44b896` 取档位，`2` 加倍、`1` 归零。
 * 档位由玩家的神明加持值（+0x46）决定，详见 rules/blessing.ts。
 *
 * ★ 先前只实现了「2 → 加倍」，**漏掉了「1 → 归零」**。
 *   四条提示语（獎金加倍／獎金作廢／罰金加倍／免付罰金）表明
 *   它是完整的三档倍率，不是一个布尔开关。
 */
export const DOUBLE_AMOUNT = BLESSING_DOUBLE;

/**
 * 支票跳票后银行拒绝往来的天数。
 * @source `add byte [player + 0x3b], 0x1e`（VA 0x0044c2ba）——0x1e = 30。
 * ★ 事件文案写作「一個月」，这里得到了确切数值。
 */
export const BANK_BAN_DAYS = 30;

/** 事件 8「股票違約交割損失股票%d％」 */
export const FORTUNE_STOCK_DEFAULT = 8;
/** 事件 9「變賣所有股票求現」 */
export const FORTUNE_STOCK_LIQUIDATE = 9;
/** 事件 10「機車被偷遺失」 */
export const FORTUNE_MOTORCYCLE_STOLEN = 10;
/** 事件 11「汽車撞電線桿全毀」 */
export const FORTUNE_CAR_WRECKED = 11;
/** 事件 32「變賣所有卡片道具」 */
export const FORTUNE_SELL_ALL_ITEMS = 32;
/** 事件 8 的百分比字面量 @source 事件表 `literal: 10` */
export const FORTUNE_STOCK_DEFAULT_PCT = 10;
/** 事件 8 的除数 @source `fdiv dword [0x465a24]` = 100.0 */
export const FORTUNE_STOCK_PCT_SCALE = 100;

/**
 * 这两条事件的神明闸门：`fcn_0044b896` 返回 **1** 就整个挡掉
 * （「逃過此劫／免付罰金」那句由表现层放）。
 *
 * @source `fcn_0044c7ef` / `fcn_0044c91f` 的 `cmp eax, 1 / jne 继续`；
 *   10/11 同构。**注意不是 `blessingMultiplier`**：这几条只用「是不是 1」，
 *   档位 2 与 0 走同一条路（照常执行）。
 */
function cancelledByBlessing(ctx: FortuneEffectContext): boolean {
  return (ctx.multiplier ?? 0) === BLESSING_VOID;
}

export interface FortuneEffectResult {
  players: Player[];
  /**
   * 卖股票之后当前玩家那一条持仓（与入参同下标）；没卖就是入参原样。
   * @source 事件 8/9 的 `rich4_sell_stock`（VA 0x00428e23）
   */
  holdings: StockHolding[] | null;
  /** 卖股票要动的行情（可流通股回补）——没卖就是入参原样 */
  market: StockMarketState | null;
  /** 车辆被毁要还回商店库存的道具表（下标 = 道具号）；没动就是入参原样 */
  toolStock: number[] | null;
  /** 变卖道具/手牌后的道具表（`tools[player*15+id]`）；没动就是 null */
  tools: number[] | null;
  /** 变卖手牌后的卡片库存（下标 = 卡片 id − 1）；没动就是 null */
  cardAmount: number[] | null;
  /**
   * 变卖手牌与道具得到的**點券** —— 只有事件 32 用得到
   * （破产清算那一支把返回值丢掉了）。
   */
  points: number;
  /**
   * 卖掉过股票的股票号 —— 调用方要对这几个跑一次
   * `_rich4_update_commercial_owner`（`rich4_sell_stock` 的尾巴）。
   */
  reown: number[];
  /**
   * ★ 事件尾巴的**特別融資收回** `fcn_00436b0a(0)`。
   *
   * 只有事件 **8**（股票違約交割）与 **9**（變賣所有股票求現）有这一句
   * （@source `rich4_fortune.asm` 的两处 `push 0 / call 0x436b0a`）。
   */
  recallFinance: boolean;
  /**
   * 神明加持把这一条整个挡掉了（`fcn_0044b896(...) == 1` 那一支）
   * —— 表现层要放「逃過此劫／免付罰金」那句（`fcn_00440cac`）。
   */
  cancelled: boolean;
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
  /** 当前玩家的持仓（事件 8/9 要卖）—— 缺省表示没有股票 */
  holdings?: readonly StockHolding[];
  /** 股市行情（卖出价与可流通股）*/
  market?: StockMarketState;
  /** 全局道具库存（事件 10/11 把车还回去）*/
  toolStock?: number[];
  /** 当前玩家的道具表（事件 32 要全卖）`tools[player*15+id]` */
  tools?: number[];
  /** 卡片库存（事件 32 卖手牌要还回去），下标 = 卡片 id − 1 */
  cardAmount?: number[];
  /**
   * 事件 8/9 卖股票的去向。
   * @source 事件 8 的 `push 0`（进公库）、事件 9 的 `push 1`（进存款）。
   */
  sellDestination?: SellDestination;
  currentPlayer: number;
  priceIndex: number;
  pool?: number;
  occupancy?: readonly number[];
  /**
   * `0x44b896` 返回的**倍率档位**：2 加倍、1 归零、0 不变。
   * 由玩家的神明加持值决定，见 rules/blessing.ts 的 blessingLevel()。
   */
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
    holdings: null,
    market: null,
    toolStock: null,
    tools: null,
    cardAmount: null,
    points: 0,
    reown: [],
    recallFinance: false,
    cancelled: false,
    pool,
    occupancy,
    amount: 0,
    bankrupted: false,
    unimplemented: false,
  };

  const entry = fortuneEvent(eventId);
  if (entry === undefined) return { ...base, unimplemented: true };

  const amount = eventAmount(entry, ctx.priceIndex) * blessingMultiplier(ctx.multiplier ?? 0);

  if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
    // 天数取自事件表的 literal（公告阶段写进 [0x48c5b4] 的字面常量）
    const raw = ctx.days ?? entry.literal;
    if (raw === null || raw === undefined) return { ...base, unimplemented: true };
    // ★ 神明加持：劫难那一支（`fcn_0044b896(1,1)`）
    //   @source `fcn_0044c5d8` 的 `cmp ecx, 1 / je 放「逃過此劫」并返回`、
    //     `cmp ecx, 2 / jne … / add [0x48c5b4], [0x48c5b4]`（天数翻倍）
    const mult = blessingMultiplier(ctx.multiplier ?? 0);
    if (mult === 0) return { ...base, cancelled: true };
    const days = raw * mult;
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

  // ── 事件 8/9：卖股票（以及 8/9 尾巴上的特別融資收回）────────────────
  // @source `fcn_0044c7ef`（8）/ `fcn_0044c91f`（9）的施加阶段：
  // ```
  // call 0x44b896(...)                      ; 神明加持
  // cmp [0x48c5b0], 1 / je 取消并放「逃過此劫」那句
  // 事件 8：for (i = 0; i < 12; i++) {       ; 每支按 literal% 卖掉
  //            shares = trunc(持仓 × literal / 100.0)
  //            rich4_sell_stock(player, i, shares, 0)     ; ★ 0 = 进公库
  //          }
  // 事件 9：for (i = 0; i < 12; i++) {       ; 全部卖掉
  //            if (持仓 == 0) continue
  //            rich4_sell_stock(player, i, 持仓, 1)       ; ★ 1 = 进存款
  //          }
  // push 0 / call 0x436b0a                  ; ★ 收回特別融資
  // ```
  if (eventId === FORTUNE_STOCK_DEFAULT || eventId === FORTUNE_STOCK_LIQUIDATE) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const market = ctx.market;
    const held = ctx.holdings;
    if (market === undefined || held === undefined) return { ...base, unimplemented: true };
    const pct = FORTUNE_STOCK_DEFAULT_PCT;
    const destination: SellDestination = ctx.sellDestination ?? 'pool';
    let player = players[ctx.currentPlayer] ?? undefined;
    if (player === undefined) return { ...base, unimplemented: true };
    const row = [...held];
    const stocks = [...market.stocks];
    const reown: number[] = [];
    // 事件 8 的卖出所得进**公库**（`sellStock` 只负责改持仓与行情，
    // 公库那一笔由调用方加 —— 与破产清算 `liquidateStocks` 同一约定）
    let toPool = 0;
    for (let i = 0; i < stocks.length; i++) {
      const h = row[i] ?? EMPTY_HOLDING;
      if (h.amount <= 0) continue;
      // 事件 8 按百分比（`literal` = 10 ⇒ 10%），事件 9 全部
      const shares =
        eventId === FORTUNE_STOCK_DEFAULT
          ? Math.trunc((h.amount * pct) / FORTUNE_STOCK_PCT_SCALE)
          : h.amount;
      if (shares <= 0) continue;
      const r = sellStock(player, h, stocks[i]!, shares, destination);
      player = r.player;
      if (destination === 'pool') toPool += r.amount;
      row[i] = r.holding;
      stocks[i] = r.stock;
      reown.push(i);
    }
    const nextPlayers = players.map((q, i) => (i === ctx.currentPlayer ? player! : q));
    return {
      ...base,
      players: nextPlayers,
      pool: pool + toPool,
      holdings: row,
      market: { ...market, stocks },
      reown,
      // ★ 事件 8/9 的尾巴：`push 0 / call 0x436b0a`
      recallFinance: true,
    };
  }

  // ── 事件 10/11：座驾被偷 / 撞毁 ────────────────────────────────
  // @source `fcn_0044ca46`（10，機車）/ `fcn_0044cb53`（11，汽車）：
  // ```
  // call 0x44b896(1, 1) / cmp [0x48c5b0], 1 / je 取消
  // player+0x11 = 0        ; traffic_method 归零（徒步）
  // player+0x12 = 1        ; ndices = 1（一颗骰子）
  // update_player_sprite
  // inc byte [0x497324]    ; ★ 事件 10：機車 回商店库存（道具 5）
  // inc byte [0x497325]    ; ★ 事件 11：汽車 回商店库存（道具 6）
  // ```
  // ⚠️ **原版不看当前座驾是什么**：开著汽車抽到「機車被偷」照样把
  //    `traffic_method` 清零、并把**機車**库存 +1。这是原版的既定行为，
  //    本引擎照抄（登记在 known-deviations 的 Q-FORTUNE-1）。
  if (eventId === FORTUNE_MOTORCYCLE_STOLEN || eventId === FORTUNE_CAR_WRECKED) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const player = players[ctx.currentPlayer];
    if (player === undefined) return { ...base, unimplemented: true };
    const tool = eventId === FORTUNE_MOTORCYCLE_STOLEN ? 5 : 6; // 機車 / 汽車
    const stock = [...(ctx.toolStock ?? [])];
    stock[tool] = (stock[tool] ?? 0) + 1;
    const nextPlayers = players.map((q, i) =>
      i === ctx.currentPlayer ? { ...q, trafficMethod: 0, ndices: 1 } : q,
    );
    return { ...base, players: nextPlayers, toolStock: stock };
  }

  // ── 事件 32「變賣所有卡片道具」──────────────────────────────
  // @source `fcn_0044d677` 的施加阶段：
  // ```
  // call 0x44b896(1,1) / cmp [0x48c5b0],1 / je 取消       ; 神明挡掉
  // call _rich4_player_sell_all_tools(player)
  // add word [player+0x30], ax                            ; ★ 所得进**點券**
  // call _rich4_player_sell_all_the_card(player)
  // add word [player+0x30], ax                            ; ★ 第二笔也进點券
  // update_player_info_window / player_say
  // ```
  if (eventId === FORTUNE_SELL_ALL_ITEMS) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const player = players[ctx.currentPlayer];
    if (player === undefined) return { ...base, unimplemented: true };
    const a = sellAllTools(player, ctx.tools ?? [], ctx.toolStock ?? []);
    const b = sellAllCards(a.player, ctx.cardAmount ?? []);
    const nextPlayers = players.map((q, i) => (i === ctx.currentPlayer ? b.player : q));
    return {
      ...base,
      players: nextPlayers,
      tools: a.tools,
      toolStock: a.toolStock,
      cardAmount: b.cardAmount,
      // 原版是 `add word`（16 位）；本引擎的點券一直是普通数值，不额外截断
      points: a.points + b.points,
    };
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
      ...base,
      players: r.players,
      pool: r.pool,
      amount: r.paid,
      bankrupted: r.bankrupted,
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
