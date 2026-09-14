/*
 * 卡片效果分发
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 把已实现的各张卡接入统一入口，供 reducer 调用。
 * 每张卡的具体效果仍在各自模块中，本文件只做**分发与前置校验**，
 * 不含任何新的游戏规则。
 *
 * 统一前置顺序（与原版函数入口一致）：
 *   1. 手上必须有这张卡
 *   2. 被动卡无法主动使用（原版函数体是 `xor eax,eax; ret`）
 *   3. 目标合法性校验
 *   4. 执行效果
 *   5. ★ **仅在效果真正生效时消耗卡片** —— 原版多处
 *      `test eax,eax / je end` 后才走扣卡分支
 */

import type { Player } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode } from '../loaders/map.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOfCard, validateTarget } from './target.ts';
import type { MapObject } from './summon.ts';
import { summonableObjects } from './summon.ts';
import { attachGod } from '../rules/object-landing.ts';
import { cardImpl, CARDS } from '@rich4/data';
import { consumeCard, playerHasCard } from './passive.ts';
import { housingIndexOf, facilityIndexOf } from '../rules/land.ts';
import { transferMoney } from '../rules/payment.ts';
import { applyHostilityDeltas } from '../rules/hostility.ts';
import type { PendingInteraction } from '../rules/interaction.ts';
import { auctionBasePrice, auctionCardHostility, eligibleBidders } from '../rules/auction.ts';

import { applyAverageCashCard } from './average-cash.ts';
import { applyAveragePoorCard } from './average-poor.ts';
import { applyHibernateCard } from './hibernate.ts';
import { applySleepwalkCard } from './sleepwalk.ts';
import { applyStayCard } from './stay.ts';
import { applyTortoiseCard } from './tortoise.ts';
import { applyAllianceCard } from './alliance.ts';
import { applyTurnCard, applySwapHouseCard } from './turn-and-house.ts';
import { applyTaxCard } from './tax.ts';
import { applyDispelCard } from './dispel.ts';
import { applyFrameCard } from './frame.ts';
import { applyBuyLandCard } from './buy-land.ts';
import { applyRebuildCard } from './rebuild.ts';
import { applyRobCard, applyRobCardCard } from './rob.ts';
import { applyMonsterCard, applyMonsterFacilityCard, MONSTER_HOSTILITY_PER_LEVEL } from './monster.ts';
import { applyRedCard, applyBlackCard, applySwapLandCard } from './swap-and-stock.ts';
import type { StockMarketState } from '../places/stock-market.ts';
import {
  applyAngelCard,
  applyAngelFacilityCard,
  applyDevilCard,
  applyDevilFacilityCard,
  applyDemolishCard,
  applyDemolishFacilityCard,
  applyRaisePriceCard,
  applySealCard,
} from './land-cards.ts';
import { markFacility, PRICE_STATUS } from '../rules/land-mutation.ts';

export type HostilityDelta = { from: number; to: number; delta: number };

export type UseCardError =
  | TargetError
  | 'notInHand'
  | 'unknownCard'
  | 'notImplemented'
  | 'passiveCard'
  | 'noEffect'
  | 'nothingToRob'
  | 'landNotFound'
  | 'notStandingOnLand'
  | 'marketClosed';

/** 卡片使用的结果 */
export interface UseCardResult {
  ok: boolean;
  error: UseCardError | null;
  players: Player[];
  lands: LandInfo[];
  /** 全局道具表（仅夢遊卡等会改动；其余卡原样返回） */
  tools: number[];
  /** 道具库存（仅搶奪卡道具路径会改动；其余卡原样返回） */
  toolStock: number[];
  /** 地图物件表（仅請神符等会改动；其余卡原样返回） */
  objects: MapObject[];
  /** 股票行情（仅紅/黑卡会改动；其余卡原样返回） */
  market: StockMarketState;
  /** 設施表（仅怪獸卡等会改动；其余卡原样返回） */
  facilities: FacilityInfo[];
  /**
   * 效果执行中需要**重新登场的搭档**（請神符挤走旧神时，
   * 旧神的搭档要回到地图上）。落点选择交给 reduce 的 respawnPartner。
   */
  respawns: { partner: number; nearNode: number }[];
  hostilityDeltas: HostilityDelta[];
  /** 是否被防御性被动卡挡下 */
  defended: boolean;
  /**
   * 本次要送回物件表的物件 handle（下标 + 1）。
   *
   * ★ 卡片只改玩家结构里的 `godInfo`/`f64` 两个引用；**物件本身**
   *   （`attached`、修正量退还、搭档登场）要由调用方走
   *   `rules/object-landing.ts` 的 `releaseObject` 收尾。
   *
   * ⚠️ 漏了这一步，送神符就成了「凭空蒸发」：物件的 `attached`
   *   永远挂在那个玩家身上，`tickGod` 再也够不着它，搭档也不会登场——
   *   跑几千回合地图上的神明会被一张卡一张卡地抽干。
   */
  releasedObjects: number[];
  /**
   * 效果挂出的**待决交互**（目前只有拍賣卡的拍賣）。
   * registry 只产出描述，由 reduce 落进 `state.pending` 并切相。
   */
  followUp: PendingInteraction | null;
  /**
   * 本次要**清研发天数**的設施 id（查封卡(28) 命中研究所(type 4) 时：
   * 原版把 `fac + 0x1e` 清零）。registry 只列出 id，由 reduce 写
   * `facilityResearchDays`（研发项目 +0x1d 不动）。
   * @source 查封卡 VA 0x004456cb: `cmp [fac+0x18], 4 / jne 跳过;
   *   mov byte [fac+0x1e], 0` —— **只有研究所才清**
   */
  researchReset: number[];
}

export interface UseCardContext {
  players: readonly Player[];
  lands: readonly LandInfo[];
  /** 地图节点表，用于把玩家所在节点解析成地块 */
  nodes: readonly MapNode[];
  currentPlayer: number;
  priceIndex: number;
  /** 全局道具表（夢遊卡把交通工具退还成道具时要写） */
  tools: readonly number[];
  /** 道具库存（搶奪卡的道具路径经 take_tool/give_tool 会动库存） */
  toolStock: readonly number[];
  /** 地图物件表（請神符要读/写） */
  objects: readonly MapObject[];
  /** 股票行情（紅/黑卡写 newsFlag） */
  market: StockMarketState;
  /**
   * 今天股市开不开门（= `marketOpenOn(globalMapId, 年, 月, 日)`）。
   * 由调用方算好传入，registry 不做日期推算。
   */
  marketOpen: boolean;
  /** 設施表（怪獸卡等可指向設施的卡要读/写） */
  facilities: readonly FacilityInfo[];
  /**
   * 嫁祸卡的新目标选择器（陷害卡等有害卡在被嫁祸时调用）。
   * 返回 -1 表示放弃转嫁。目标选择属表现层，由 UI/AI 提供。
   */
  scapegoatPicker?: (from: number) => number;
}

/** 本项目已实现效果、可经本入口使用的卡片编号 */
export const IMPLEMENTED_CARD_IDS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 22, 23, 24, 25, 26, 27, 28, 29, 30,
];

/** 取玩家当前**所站地块**（不是住宅地则返回 null） */
export function standingLand(
  ctx: UseCardContext,
  playerIndex: number,
): { node: MapNode; land: LandInfo | null } | null {
  const p = ctx.players[playerIndex];
  if (p === undefined) return null;
  const node = ctx.nodes.find((n) => n.id === p.nodeId);
  if (node === undefined) return null;
  const idx = housingIndexOf(node.type);
  const land = idx === null ? null : (ctx.lands.find((l) => l.id === idx) ?? null);
  return { node, land };
}

/** 取玩家当前**所站设施**（不是设施格则返回 null） */
export function standingFacility(
  ctx: UseCardContext,
  playerIndex: number,
): FacilityInfo | null {
  const p = ctx.players[playerIndex];
  if (p === undefined) return null;
  const node = ctx.nodes.find((n) => n.id === p.nodeId);
  if (node === undefined) return null;
  const idx = facilityIndexOf(node.type);
  return idx === null ? null : (ctx.facilities.find((f) => f.id === idx) ?? null);
}

/**
 * 使用一张卡。
 *
 * 对**没有目标**的卡（购地/改建等），效果作用于玩家当前所站地块。
 * 对**地块目标**的卡，`target` 给出被选中地块的 id；换地/换屋则以
 * 「玩家所站地块 ↔ 选中地块」成对处理（原版只做**一次**选择，
 * 另一块固定为落点，见 VA 0x0044262b 起对 `player.node_id` 的读取）。
 */
export function useCard(
  ctx: UseCardContext,
  cardId: number,
  target: CardTarget = { kind: 'none' },
): UseCardResult {
  const base: UseCardResult = {
    ok: false,
    error: null,
    players: [...ctx.players],
    lands: [...ctx.lands],
    tools: [...ctx.tools],
    toolStock: [...ctx.toolStock],
    objects: [...ctx.objects],
    market: ctx.market,
    facilities: [...ctx.facilities],
    respawns: [],
    hostilityDeltas: [],
    defended: false,
    releasedObjects: [],
    followUp: null,
    researchReset: [],
  };
  const fail = (error: UseCardError): UseCardResult => ({ ...base, error });

  const impl = cardImpl(cardId);
  if (impl === undefined) return fail('unknownCard');

  const cur = ctx.currentPlayer;
  const me = ctx.players[cur];
  if (me === undefined) return fail('playerOutOfRange');
  if (!playerHasCard(me, cardId)) return fail('notInHand');
  // @source 被动卡的函数体是 `xor eax,eax; ret`，主动使用恒返回 0
  if (impl.passive) return fail('passiveCard');

  const cls = targetClassOfCard(impl);
  const targetError = validateTarget(cls, target, cur, ctx.players.length, {
    objectCount: ctx.objects.length,
    stockCount: ctx.market.stocks.length,
    facilityCount: ctx.facilities.reduce((m, f) => Math.max(m, f.id), 0),
  });
  if (targetError !== null) return fail(targetError);

  const targetPlayer = target.kind === 'player' ? target.index : -1;
  const targetLand =
    target.kind === 'entity'
      ? (ctx.lands.find((l) => l.id === target.entityId) ?? null)
      : null;
  if (target.kind === 'entity' && targetLand === null) return fail('landNotFound');

  let players: Player[] = [...ctx.players];
  let lands: LandInfo[] = [...ctx.lands];
  let tools: number[] = [...ctx.tools];
  let toolStock: number[] = [...ctx.toolStock];
  let objects: MapObject[] = [...ctx.objects];
  let market: StockMarketState = ctx.market;
  let facilities: FacilityInfo[] = [...ctx.facilities];
  const respawns: { partner: number; nearNode: number }[] = [];
  let hostilityDeltas: HostilityDelta[] = [];
  let defended = false;
  let releasedObjects: number[] = [];
  let followUp: PendingInteraction | null = null;
  const researchReset: number[] = [];

  /** 就地替换一块地 */
  const putLand = (l: LandInfo): void => {
    lands = lands.map((x) => (x.id === l.id ? l : x));
  };

  switch (cardId) {
    // ── 玩家目标 / 无目标 ──────────────────────────────
    case 1: {
      const r = applyAverageCashCard(players, cur);
      players = r.players;
      hostilityDeltas = r.hostilityDeltas;
      break;
    }
    case 2: {
      const r = applyAveragePoorCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      hostilityDeltas = r.hostilityDeltas;
      break;
    }
    case 13: {
      // 搶奪卡：steal.kind 决定路径 —— @source 0x441abd `test bh, 0x80`
      //   卡片路径 0x441343/0x4412e4；道具路径 0x445aa2/0x445a4d
      if (target.kind !== 'player') return fail('wrongTargetKind');
      const steal = target.steal;
      // 抢什么必须由外部选定（原版模态选单 0x4018e7 / AI 参数 0x41e6f2）
      if (steal === undefined) return fail('targetRequired');
      let robbedId: number;
      if (steal.kind === 'card') {
        const r = applyRobCardCard(players, cur, target.index, steal.id);
        if (!r.ok) return fail(r.error ?? 'noEffect');
        players = r.players;
        robbedId = r.robbed;
      } else {
        const r = applyRobCard(players, cur, target, tools, toolStock, steal.id);
        if (!r.ok) return fail(r.error ?? 'noEffect');
        tools = r.tools;
        toolStock = r.stock;
        robbedId = r.robbed;
      }
      // @source 0x443f1a `mov al, [eax*8 + 0x47fdef]` → call 0x40df69：
      //   敌意增量 = 被抢物在**卡片表** +5 的价格；道具路径也读这张表
      //  （ebx 已 and 0x7fff），即抢到道具 N 记的是卡片 N 的价 —— 原版如此
      const robbedPrice = CARDS.find((c) => c.id === robbedId)?.price ?? 0;
      hostilityDeltas = [{ from: target.index, to: cur, delta: robbedPrice }];
      break;
    }
    case 6: {
      const r = applyTurnCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      break;
    }
    case 14: {
      const r = applyStayCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      break;
    }
    case 15: {
      const r = applyHibernateCard(players, cur, ctx.priceIndex);
      players = r.players;
      hostilityDeltas = r.hostilityDeltas;
      break;
    }
    case 16: {
      // 夢遊卡：交通工具退还成道具，故全局道具表也要跟着结果走
      const r = applySleepwalkCard(players, cur, target, tools);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      tools = r.tools;
      // @source 復仇卡(18) 把效果反弹给出牌者（applySleepwalkCard 内部处理），
      //   反弹不算「被防御性被动卡挡下」，defended 保持 false
      break;
    }
    case 22: {
      const r = applyDispelCard(me);
      // ★ 什么都没送走时不消耗卡片
      if (!r.ok) return fail('noEffect');
      players = players.map((p, i) => (i === cur ? r.player : p));
      releasedObjects = r.removed;
      break;
    }
    case 23: {
      // 請神符：把地图上的物件请到身上 —— @source VA 0x00444e1a → call 0x40ead7
      if (target.kind !== 'object') return fail('wrongTargetKind');
      // 只能请「还在地图上、未被附身、种类可附身」的物件
      if (!summonableObjects(objects).includes(target.objectIndex)) return fail('noEffect');
      // attachGod = 0x40ead7 完整版：旧神先送走（0x40eb3e）、三项修正（0x0040ebcc 起）
      const r = attachGod({ players, objects, tools, toolStock }, cur, target.objectIndex);
      if (!r.ok) return fail('noEffect');
      players = r.players;
      objects = r.objects;
      tools = r.tools;
      toolStock = r.toolStock;
      // 被挤走的旧神若有搭档，交给 reduce 重新登场
      if (r.respawn !== null) respawns.push(r.respawn);
      break;
    }
    case 26: {
      const r = applyTaxCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      defended = r.defended;
      hostilityDeltas = [{ from: targetPlayer, to: cur, delta: r.hostilityDelta }];
      break;
    }
    case 17: {
      // 陷害卡：嫁祸的新目标由外部给出；core 只用结果（C-ARC-2）
      const r = applyFrameCard(players, cur, target, ctx.priceIndex, ctx.scapegoatPicker);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      hostilityDeltas = r.hostilityDeltas;
      defended = r.outcome?.kind === 'absolved';
      break;
    }
    case 29: {
      const r = applyAllianceCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      break;
    }
    case 30: {
      const r = applyTortoiseCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      break;
    }

    // ── 作用于「落点」的卡 ─────────────────────────────
    case 8: {
      // 拍賣卡 VA 0x00443225：拍卖的是**脚下**的地块/設施（读玩家节点
      //   的 entity，不做目标选择）；原版不挑主 —— 自己的、无主的也照拍，
      //   只有脚下不是地块/設施时才不生效（不扣卡）。
      const here = standingLand(ctx, cur);
      const onLand = here !== null && here.land !== null;
      const hereFac = onLand ? null : standingFacility(ctx, cur);
      if (!onLand && hereFac === null) return fail('notStandingOnLand');
      if (onLand) {
        const land = here.land!;
        // @source 0x443282：无主不记敌意；敌意值是 double 压栈的原版 bug
        //   （低 32 位，常规地价恒为 0），见 auction.ts 的 auctionCardHostility
        if (land.owner !== 0) {
          hostilityDeltas = [
            {
              from: land.owner - 1,
              to: cur,
              delta: auctionCardHostility(land.landPrice, land.level, ctx.priceIndex),
            },
          ];
        }
        followUp = {
          kind: 'auction',
          entityId: land.id,
          basePrice: auctionBasePrice(land, ctx.priceIndex),
          bidders: eligibleBidders(players, land),
        };
        break;
      }
      const fac = hereFac!;
      if (fac.owner !== 0) {
        hostilityDeltas = [
          {
            from: fac.owner - 1,
            to: cur,
            delta: auctionCardHostility(fac.landPrice, fac.level, ctx.priceIndex),
          },
        ];
      }
      followUp = {
        kind: 'auction',
        entityId: fac.id,
        basePrice: auctionBasePrice(fac, ctx.priceIndex),
        bidders: eligibleBidders(players, fac),
        facility: true,
      };
      break;
    }
    case 3: {
      const here = standingLand(ctx, cur);
      if (here === null || here.land === null) return fail('notStandingOnLand');
      const r = applyBuyLandCard(here.node.type, here.land, me, ctx.priceIndex);
      if (!r.ok) return fail('noEffect');
      // @source push 0 / push edi(成交价) / push esi(原地主) / push current / call 0x41d2c6
      //   flags = 0 → 付款方**先扣现金**，收款方进**银行存款**
      const pay = transferMoney(players, [], 0, cur, r.previousOwner, r.price, 0);
      players = pay.players;
      // @source mov al, [0x49910c] / inc al / mov [land+0x19], al
      putLand({ ...here.land, owner: cur + 1 });
      // ⚠️ 购地卡的敌意更新是原版 bug（空操作），见 buy-land.ts
      break;
    }
    case 7: {
      const here = standingLand(ctx, cur);
      if (here === null) return fail('notStandingOnLand');
      const r = applyRebuildCard(here.node.type, here.land);
      if (!r.ok || r.land === null) return fail('noEffect');
      putLand(r.land);
      break;
    }

    // ── 地块目标 ───────────────────────────────────────
    case 11: {
      // 怪獸卡 VA 0x00443917：敌意先按原等级算（level×30×物价指数，无主不记），
      //   再 mutate mode 2 夷平 —— 地块与設施两条路径完全同构
      if (target.kind === 'facility') {
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        const r = applyMonsterFacilityCard(fac, ctx.priceIndex, cur);
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        hostilityDeltas = r.hostilityDeltas;
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      const r = applyMonsterCard(targetLand, ctx.priceIndex, cur);
      if (!r.ok) return fail('noEffect');
      putLand(r.land);
      hostilityDeltas = r.hostilityDeltas;
      break;
    }
    case 4:
    case 5: {
      const here = standingLand(ctx, cur);
      if (here === null || here.land === null) return fail('notStandingOnLand');
      if (targetLand === null) return fail('landNotFound');
      const r =
        cardId === 4
          ? applySwapLandCard(lands, here.land.id, targetLand.id)
          : applySwapHouseCard(lands, here.land.id, targetLand.id);
      if (!r.ok) return fail('noEffect');
      lands = r.lands;
      break;
    }
    case 9: {
      // 天使卡 VA 0x004434c0：地块是**同區批量**（遍历同名地块各升一级，
      //   0x443541..0x4435e4）；設施是单个（fcn_0040b110 設施分支）
      if (target.kind === 'facility') {
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        const r = applyAngelFacilityCard(fac, target.buildType ?? 0);
        // 满级不动 → 不生效不扣卡（原版返回 0）
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      lands = lands.map((l) => (l.name === targetLand.name ? applyAngelCard(l) : l));
      break;
    }
    case 10: {
      // 惡魔卡 VA 0x004436e0：地块同區批量夷平，**每块有主地**记敌意
      //   （等级×30×物价指数，0x4437a7，与怪獸同式）；設施单个
      if (target.kind === 'facility') {
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        const r = applyDevilFacilityCard(fac, ctx.priceIndex, cur);
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        hostilityDeltas = r.hostilityDeltas;
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      const deltas: HostilityDelta[] = [];
      lands = lands.map((l) => {
        if (l.name !== targetLand.name) return l;
        if (l.owner !== 0) {
          deltas.push({
            from: l.owner - 1,
            to: cur,
            delta: l.level * MONSTER_HOSTILITY_PER_LEVEL * ctx.priceIndex,
          });
        }
        return applyDevilCard(l);
      });
      hostilityDeltas = deltas;
      break;
    }
    case 12: {
      if (target.kind === 'facility') {
        // 拆除卡設施段 VA 0x00443cee..0x00443d1d：单个拆一级，
        //   拆到 0 级退回公園；敌意平坦 30×物价指数（不按级），无主不记
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        const r = applyDemolishFacilityCard(fac, ctx.priceIndex);
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        if (r.victim >= 0) {
          hostilityDeltas = [{ from: r.victim, to: cur, delta: r.hostilityDelta }];
        }
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      const r = applyDemolishCard(targetLand, ctx.priceIndex);
      putLand(r.land);
      // 无主地块不记敌意（victim 为 -1）
      if (r.victim >= 0) {
        hostilityDeltas = [{ from: r.victim, to: cur, delta: r.hostilityDelta }];
      }
      break;
    }
    case 27:
    case 28: {
      if (target.kind === 'facility') {
        // 漲價 VA 0x0044542d / 查封 VA 0x00445593：設施是**单个**
        //   写 +0x1c = 0x50/0x51（地块侧才是同區批量）
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        const status = cardId === 27 ? PRICE_STATUS.RAISED : PRICE_STATUS.SEALED;
        const r = markFacility(fac, status);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        // @source 查封卡 `cmp [fac+0x18], 4 / jne 跳过; mov byte [fac+0x1e], 0`
        //   —— **只有研究所（type 4）**才清研发天数
        if (r.extraCleared && fac.type === 4) researchReset.push(fac.id);
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      const r =
        cardId === 27
          ? applyRaisePriceCard(lands, targetLand.name)
          : applySealCard(lands, targetLand.name);
      if (r.affected.length === 0) return fail('noEffect');
      lands = r.lands;
      break;
    }

    // ── 股票目标 ───────────────────────────────────────
    case 24:
    case 25: {
      // 紅卡 VA 0x00444f25 / 黑卡 VA 0x0044503f：整字节写 newsFlag
      // ⚠️ 下面两道护栏原版卡片函数里没有（真人走股市屏 UI 天然避开，
      //   AI 选股参数 0x41e6f2(0) 也只挑可交易股），属引擎护栏，
      //   与 willWork 防空跑同一动机 —— 已登记，非静默偏差。
      if (!ctx.marketOpen) return fail('marketClosed');
      if (target.kind !== 'stock') return fail('wrongTargetKind');
      const stock = market.stocks[target.index];
      if (stock === undefined) return fail('stockOutOfRange');
      // f6 非 0 = 停牌中，当日不波动，置数无意义 @source loc_00429470
      if (stock.f6 !== 0) return fail('noEffect');
      const r =
        cardId === 24
          ? applyRedCard(market.stocks, target.index)
          : applyBlackCard(market.stocks, target.index);
      if (r.affected < 0) return fail('stockOutOfRange');
      market = { ...market, stocks: r.stocks };
      // 紅卡无敌意段；黑卡尾部的敌意循环是原版 bug（恒为 0），均不落敌意
      break;
    }

    default:
      return fail('notImplemented');
  }

  // 敌意真正落到状态上（updateHostility 内含「敌意上升解除同盟」的副作用）
  players = applyHostilityDeltas(players, hostilityDeltas);

  // ★ 效果生效后才消耗卡片
  players = players.map((p, i) => (i === cur ? consumeCard(p, cardId) : p));

  return { ok: true, error: null, players, lands, tools, toolStock, objects, market, facilities, respawns, hostilityDeltas, defended, releasedObjects, followUp, researchReset };
}
