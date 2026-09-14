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
import type { LandInfo, MapNode } from '../loaders/map.ts';
import type { CardTarget, TargetError } from './target.ts';
import { targetClassOf, validateTarget } from './target.ts';
import { cardImpl } from '@rich4/data';
import { consumeCard, playerHasCard } from './passive.ts';
import { housingIndexOf } from '../rules/land.ts';
import { transferMoney } from '../rules/payment.ts';
import { applyHostilityDeltas } from '../rules/hostility.ts';

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
import { applySwapLandCard } from './swap-and-stock.ts';
import {
  applyAngelCard,
  applyDevilCard,
  applyDemolishCard,
  applyRaisePriceCard,
  applySealCard,
} from './land-cards.ts';

export type HostilityDelta = { from: number; to: number; delta: number };

export type UseCardError =
  | TargetError
  | 'notInHand'
  | 'unknownCard'
  | 'notImplemented'
  | 'passiveCard'
  | 'noEffect'
  | 'landNotFound'
  | 'notStandingOnLand';

/** 卡片使用的结果 */
export interface UseCardResult {
  ok: boolean;
  error: UseCardError | null;
  players: Player[];
  lands: LandInfo[];
  /** 全局道具表（仅夢遊卡等会改动；其余卡原样返回） */
  tools: number[];
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
  /**
   * 嫁祸卡的新目标选择器（陷害卡等有害卡在被嫁祸时调用）。
   * 返回 -1 表示放弃转嫁。目标选择属表现层，由 UI/AI 提供。
   */
  scapegoatPicker?: (from: number) => number;
}

/** 本项目已实现效果、可经本入口使用的卡片编号 */
export const IMPLEMENTED_CARD_IDS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 14, 15, 16, 17, 22, 26, 27, 28, 29, 30,
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
    hostilityDeltas: [],
    defended: false,
    releasedObjects: [],
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

  const cls = targetClassOf(impl.selectionParam);
  const targetError = validateTarget(cls, target, cur, ctx.players.length);
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
  let hostilityDeltas: HostilityDelta[] = [];
  let defended = false;
  let releasedObjects: number[] = [];

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
      if (targetLand === null) return fail('landNotFound');
      putLand(applyAngelCard(targetLand));
      break;
    }
    case 10: {
      if (targetLand === null) return fail('landNotFound');
      putLand(applyDevilCard(targetLand));
      break;
    }
    case 12: {
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
      if (targetLand === null) return fail('landNotFound');
      const r =
        cardId === 27
          ? applyRaisePriceCard(lands, targetLand.name)
          : applySealCard(lands, targetLand.name);
      if (r.affected.length === 0) return fail('noEffect');
      lands = r.lands;
      break;
    }

    default:
      return fail('notImplemented');
  }

  // 敌意真正落到状态上（updateHostility 内含「敌意上升解除同盟」的副作用）
  players = applyHostilityDeltas(players, hostilityDeltas);

  // ★ 效果生效后才消耗卡片
  players = players.map((p, i) => (i === cur ? consumeCard(p, cardId) : p));

  return { ok: true, error: null, players, lands, tools, hostilityDeltas, defended, releasedObjects };
}
