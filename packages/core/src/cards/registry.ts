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
import type { FacilityInfo, LandInfo, LandscapeInfo, MapNode } from '../loaders/map.ts';
import type { CardTarget, StandingInstanceKind, TargetError } from './target.ts';
import { targetClassOfCard, validateTarget } from './target.ts';
import type { MapObject } from './summon.ts';
import { summonableObjects } from './summon.ts';
import { attachGod } from '../rules/object-landing.ts';
import { cardImpl, CARDS } from '@rich4/data';
import { consumeCard, playerHasCard } from './passive.ts';
import { housingIndexOf, facilityIndexOf } from '../rules/land.ts';
import { transferMoney } from '../rules/payment.ts';
import { applyHostilityDeltas } from '../rules/hostility.ts';
import type { AuctionRequest, PendingInteraction } from '../rules/interaction.ts';
import { auctionBasePrice, auctionCardHostility, eligibleBidders } from '../rules/auction.ts';
import { actorActive, specialSlotOf } from '../rules/special-actors.ts';
import type { SpecialActor } from '../rules/special-actors.ts';

import { applyAverageCashCard } from './average-cash.ts';
import { applyAveragePoorCard } from './average-poor.ts';
import { applyHibernateCard, hibernateActors } from './hibernate.ts';
import { applySleepwalkCard, applySleepwalkCardToActor } from './sleepwalk.ts';
import { applyStayCard, applyStayCardToActor } from './stay.ts';
import { applyTortoiseCard, applyTortoiseCardToActor } from './tortoise.ts';
import { applyAllianceCard } from './alliance.ts';
import { applyTurnCard, applyTurnCardToActor, applySwapHouseCard, applySwapHouseFacilityCard } from './turn-and-house.ts';
import { applyTaxCard } from './tax.ts';
import { applyDispelCard } from './dispel.ts';
import { applyFrameCard } from './frame.ts';
import { applyBuyLandCard, buyLandCardHostility } from './buy-land.ts';
import { applyRebuildCard, applyRebuildFacilityCard } from './rebuild.ts';
import { applyRobCard, applyRobCardCard } from './rob.ts';
import { applyMonsterCard, applyMonsterFacilityCard, MONSTER_HOSTILITY_PER_LEVEL } from './monster.ts';
import { releaseConfinedPlayers } from '../rules/blocking.ts';
import {
  applyBlackCard,
  applyRedCard,
  applySwapFacilityCard,
  applySwapLandCard,
  blackCardHostilityDeltas,
} from './swap-and-stock.ts';
import type { StockMarketState } from '../places/stock-market.ts';
import { applyStockNews } from '../places/stock-market.ts';
import {
  applyAngelCard,
  applyAngelFacilityCard,
  applyDevilCard,
  applyDevilFacilityCard,
  applyDemolishCard,
  demolishLikeTargetAllowed,
  applyDemolishFacilityCard,
  applyDemolishObjectCard,
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
  | 'marketClosed'
  /** 購地卡：现金不够（原版弹「您的現金不足！」`0x004425fb`，卡不扣）*/
  | 'notEnoughCash';

/** 卡片使用的结果 */
export interface UseCardResult {
  /**
   * ★ `ok` **就是原版卡片函数的返回值语义**：非 0 = 成功（卡已扣），
   *   0 = 失败（卡未扣、状态一点不动）。
   *
   * 这条等价关系是**机械核验过的**，不是近似：
   * `rich4-spec/tools/scratch/consume_invariant_check.py` 把 30 张卡片函数
   * 从每个 `call 0x441343`（`remove_card`）的下一条指令起做前向 DFS，
   * 结论 **30/30：扣卡之后的每一条出口都返回非 0**。
   * 因此原版里不存在「返回 0 但卡已扣」的路径 ⇒
   * `ok === false` ⟺ 卡还在手上（`state/reduce.ts` 的 `playCard` 据此直接
   * `return state`，不需要额外的 `consumed` 标志）。
   *
   * ⚠️ 反过来说：**「已扣卡但什么都没发生」是 `ok: true`**，见 `noEffect()`。
   */
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
   * 特殊棋子表（仅停留/轉向/烏龜卡的 actor 目标会改动；
   * 其余卡原样返回）。下标 = actor − 4，与 `state.specialActors` 同形。
   */
  actors: SpecialActor[];
  /** 监狱占用表（嫁禍/復仇卡入狱会改；其余卡原样返回） */
  prisonOccupancy: number[];
  /** 医院占用表（首次关押清"另一张"时会改） */
  hospitalOccupancy: number[];
  /**
   * 效果执行中需要**重新登场的搭档**（請神符挤走旧神时，
   * 旧神的搭档要回到地图上）。落点选择交给 reduce 的 respawnPartner。
   */
  respawns: { partner: number; nearNode: number }[];
  hostilityDeltas: HostilityDelta[];
  /** 是否被防御性被动卡挡下 */
  defended: boolean;
  /**
   * 查稅卡真的收到税（没被免费卡挡下）时：被查的人与税额 ——
   * 「抽取%s\n\n%d元稅金！」那扇框（`0x004453ef`）要用，调用方弹。
   */
  taxed?: { victim: number; amount: number };
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
   *
   * ★ 拍賣那一条是**开拍请求**（`AuctionRequest`）：座位状态 / 心理价位 /
   *   现价这些要读全局随机状态，只有 reducer 算得出来 —— 见 `openAuction`。
   */
  followUp: PendingInteraction | AuctionRequest | null;
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
   * 各玩家持股（`holdings[玩家][股票]`）—— **黑卡尾部敌意循环**要读它。
   *
   * @source VA 0x0044519d：`holdings + p*96 + n*8`（n 为 1-based 股票号）。
   * 可选：不传就当「谁都没持股」（预览路径不需要它）。
   */
  holdings?: readonly (readonly { amount: number }[])[];
  /**
   * 今天股市开不开门（= `marketOpenOn(globalMapId, 年, 月, 日)`）。
   * 由调用方算好传入，registry 不做日期推算。
   */
  marketOpen: boolean;
  /** 設施表（怪獸卡等可指向設施的卡要读/写） */
  facilities: readonly FacilityInfo[];
  /** 特殊棋子表（停留/轉向/烏龜卡的 actor 目标要读/写） */
  actors: readonly SpecialActor[];
  /**
   * 监狱占用表（`0x496b30`）。★ 嫁禍/復仇卡要写它 —— 客户端关押动效
   *   （`client/src/confine-fx.ts`）靠"这一格 0→1"的跳变触发。
   */
  prisonOccupancy?: readonly number[];
  /** 医院占用表（`0x496b60`）：首次关押要清掉它对应那一格 */
  hospitalOccupancy?: readonly number[];
  /**
   * 特殊景观表 —— 首次关押的**屏幕坐标**取自它
   * （監獄 = 记录 2「綠島」、醫院 = 记录 1；`@source 0x43d643`/`0x43ecef`）。
   */
  landscapes?: readonly LandscapeInfo[];
  /**
   * 引擎随机出口（轉向卡掉头后要 `rand()` 重挑「来路」：原版 `0x40c834`）。
   * 传的必须是 `state.rngState` 装出来的那条流（C-DET-4）。
   */
  rng?: { next(): number } | undefined;
  /**
   * 嫁祸卡的新目标选择器（陷害卡等有害卡在被嫁祸时调用）。
   * 返回 -1 表示放弃转嫁。目标选择属表现层，由 UI/AI 提供。
   */
  scapegoatPicker?: (from: number) => number;
}

/**
 * 本项目已实现效果、**可经本入口（`useCard`）使用**的卡片编号。
 *
 * ⚠️ **18 / 19 / 20 / 21（復仇 / 嫁禍 / 免費 / 免罪）不在这张表里 —— 这是设计，不是漏**
 *   （2026-09-17 补注，免得复核者当成缺口）：原版这四张卡的 `card_functions`
 *   项都指向同一个 2 字节空桩 `xor eax,eax; ret`（VA 0x004420d5），
 *   **根本无法主动使用**；它们的真实触发是「有害卡命中某玩家时，先查目标是否持有
 *   相应防御卡」，见 `cards/passive.ts` 与 `cards/frame.ts`。
 *   ⇒ 谁要「把 18..21 补进这张表」，先去看那两张卡的处理：
 *     它们走的是**反应**路径，不是出牌路径。
 */
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
 * 玩家脚下那一格的**实例类别** —— 换地/换屋的目标类别由它决定
 * （见 `target.ts` 的 `StandingInstanceKind`）。
 *
 * @source 换地卡 VA 0x00442685 / 0x004428cc：读脚下节点的 `+0x20` 实例编码，
 *   `0x7d0 < code < 0xfa0` → 地块，`0xfa0 < code < 0x1770` → 設施，
 *   其余（路面/企業/物件）两张卡都不生效。
 */
export function standingInstanceKind(
  ctx: UseCardContext,
  playerIndex: number,
): StandingInstanceKind {
  const p = ctx.players[playerIndex];
  if (p === undefined) return null;
  const node = ctx.nodes.find((n) => n.id === p.nodeId);
  if (node === undefined) return null;
  if (housingIndexOf(node.type) !== null) return 'land';
  if (facilityIndexOf(node.type) !== null) return 'facility';
  return null;
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
    actors: [...ctx.actors],
    prisonOccupancy: [...(ctx.prisonOccupancy ?? new Array<number>(8).fill(0))],
    hospitalOccupancy: [...(ctx.hospitalOccupancy ?? new Array<number>(8).fill(0))],
    respawns: [],
    hostilityDeltas: [],
    defended: false,
    releasedObjects: [],
    followUp: null,
    researchReset: [],
  };
  /**
   * 失败返回 —— **卡未扣、状态一点不动**（`ok: false`）。
   *
   * ★★ 扣卡的时机是**机械的**：卡在「目标选定之后、效果之前」被移除
   *   （`@source 0x004441dc` 的开头，以夢遊卡为例）：
   *   ```asm
   *   004441fc  push 0 / call 0x41e6f2        ; 取默认目标（或先弹选择框）
   *   00444206  mov  esi, eax                 ; esi = 目标
   *   00444208  test esi, esi
   *   0044420a  je   0x4444b8                 ; ★ 选不到目标 → 返回，**卡未扣**
   *   00444210  push 0x10                     ; 16 = 夢遊卡
   *   00444219  call 0x441343                 ; ★ remove_card —— 在**效果之前**
   *   ```
   *
   * ★ 30 张卡的 `remove_card` 位置已**逐张回 exe 核过**
   *   （`rich4-spec/tools/scratch/consume_probe.py` 一次列出每张卡函数里
   *   `call 0x441343` 与全部分支的相对次序）：
   *
   * | 组 | 卡 | `remove_card` 相对目标选择 |
   * |---|---|---|
   * | 甲 | 2/6/9/10/11/12/14/16/17/23/26/27/28/29/30 | **紧跟**在选框/AI 取参之后 |
   * | 乙 | 3/4/5/7/8/13 | 在「换/买/拆/抢**成功**」判定之后 |
   * | 丙 | 1/15 | 函数**开头**（无目标选择，也没有失败路径） |
   * | 丁 | 22 | 在「有没有东西可送」判定之后 |
   * | 戊 | 24/25 | 在「股市屏/AI 有没有选到股」判定之后 |
   *
   *   逐卡汇编依据（每张都取「`call 0x441343` 之前/之后的分支」）：
   *   `0x4421f1`(卡2) `0x442610`(卡3) `0x442aeb`(卡4) `0x442f36`(卡5)
   *   `0x442f8a`(卡6) `0x443213`(卡7) `0x44349f`(卡8) `0x443505`(卡9)
   *   `0x44371d`(卡10) `0x443954`(卡11) `0x443b53`(卡12) `0x443f40`(卡13)
   *   `0x443fca`(卡14) `0x4440f6`(卡15) `0x444219`(卡16) `0x4444fc`(卡17)
   *   `0x444ce4`(卡22) `0x444e52`(卡23) `0x44502a`(卡24) `0x4451db`(卡25)
   *   `0x445233`(卡26) `0x44546a`(卡27) `0x4455cc`(卡28) `0x445750`(卡29)
   *   `0x445929`(卡30)。
   *
   *   ⚠️ 甲组的收尾一律是 `mov eax, <选中的目标值>` ⇒ 返回值**非 0**
   *   ⇒ 原版把这看成**成功**（卡照扣、界面不报错）。这类「已选定但状态不变」
   *   的情形不是 `fail`，而是下面的 `noEffect()` —— 两者**没有交集**：
   *   `consume_invariant_check.py` 从每个 `remove_card` 之后做前向 DFS，
   *   证明「扣卡之后的每一条出口都返回非 0」（30/30 成立）。
   *   所以 `ok === false` ⟺ 卡还在手上，`state/reduce.ts` 的 `playCard`
   *   才能直接用 `if (!r.ok) return state`。
   */
  const fail = (error: UseCardError): UseCardResult => ({ ...base, error });

  /**
   * 「目标已选定、但什么都没发生」—— 原版这类路径**返回非 0**（见上表甲组），
   * 即 **`ok: true` + 卡已扣**，只是状态没有变化。
   *
   * 典型：天使卡打满级設施（`@source 0x4436d9 mov eax, ebp` —— `ebp` 是选中
   * 的地产编号，恒非 0）、夢遊卡打已在冬眠的替身（`@source 0x4444b8 mov eax, esi`）、
   * 停留/轉向/烏龜卡打不在棋盘上的替身、紅/黑卡遇上停牌股。
   *
   * ⚠️ 若这里改成 `fail(...)`，`state/preview.ts` 的 `canUse` 会把这张卡
   * 判成「用不了」（原版是能用的，点下去照扣卡），故必须是 `ok: true`。
   */
  const noEffect = (): UseCardResult => ({
    ...base,
    ok: true,
    players: base.players.map((p, i) =>
      i === ctx.currentPlayer ? consumeCard(p, cardId) : p,
    ),
  });

  const impl = cardImpl(cardId);
  if (impl === undefined) return fail('unknownCard');

  const cur = ctx.currentPlayer;
  const me = ctx.players[cur];
  if (me === undefined) return fail('playerOutOfRange');
  if (!playerHasCard(me, cardId)) return fail('notInHand');
  // @source 被动卡的函数体是 `xor eax,eax; ret`，主动使用恒返回 0
  if (impl.passive) return fail('passiveCard');

  // ★ 目标类别**跟脚下走**：换地/换屋站地块上就收地块、站設施上就收設施
  //   （原版在卡片函数里按脚下实例编码换选择参数，见 target.ts 的 targetClassOf）
  const standing = standingInstanceKind(ctx, cur);
  // 换地/换屋：脚下既不是地块也不是設施时原版连选择都不开、直接返回 0
  //   @source 换地卡两条区间之外 VA 0x0044288c → `loc_00442ade` → eax = 0
  if ((cardId === 4 || cardId === 5) && standing === null) return fail('notStandingOnLand');
  const cls = targetClassOfCard(impl, standing);
  const targetError = validateTarget(cls, target, cur, ctx.players.length, {
    objectCount: ctx.objects.length,
    stockCount: ctx.market.stocks.length,
    facilityCount: ctx.facilities.reduce((m, f) => Math.max(m, f.id), 0),
    // REQ-05.1：停留(14)/轉向(6)/烏龜(30) 三卡可指向四大惡人与機器娃娃；
    // ★ 夢遊卡(16) 也有替身那一支 —— @source `rich4_card_mengyouka.asm:252-257`
    //   （`cmp ebx,4 / jl 跳过` 之后写替身记录 `+13`），
    //   2026-09-16 订正后再接上（先前误判「索引空间没核清」，见 D-T047-5）。
    allowActor: cardId === 6 || cardId === 14 || cardId === 16 || cardId === 30,
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
  let actors: SpecialActor[] = [...ctx.actors];
  let prisonOccupancy: number[] = [...(ctx.prisonOccupancy ?? new Array<number>(8).fill(0))];
  let hospitalOccupancy: number[] = [...(ctx.hospitalOccupancy ?? new Array<number>(8).fill(0))];
  const respawns: { partner: number; nearNode: number }[] = [];
  let hostilityDeltas: HostilityDelta[] = [];
  let defended = false;
  let taxed: { victim: number; amount: number } | undefined;
  let releasedObjects: number[] = [];
  // ★ 拍賣那一条是**开拍请求**（AuctionRequest）：座位/心理价位等由 reduce 补齐
  let followUp: PendingInteraction | AuctionRequest | null = null;
  const researchReset: number[] = [];

  /** 就地替换一块地 */
  const putLand = (l: LandInfo): void => {
    lands = lands.map((x) => (x.id === l.id ? l : x));
  };

  /** 就地替换一栋設施 */
  const putFacility = (f: FacilityInfo): void => {
    facilities = facilities.map((x) => (x.id === f.id ? f : x));
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
      // ★ 掉头后要 `rand()` 重挑「来路」（原版 `0x40c78c` 的 0x40c834）——
      //   出口是 ctx 给的 `rng`，**只在真有候选时才调用**（见 `pickTurnBackNode`）。
      const draw = (): number => ctx.rng?.next() ?? 0;
      if (target.kind === 'actor') {
        // REQ-05.1：轉向卡对特殊棋子 —— 0x40c78c 的 actor ≥ 4 分支
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        // 不在棋盘上（監獄/醫院/未出场）不生效。★ **卡照扣、原版算成功**：
        //   @source `0x00442f8a call 0x441343`（remove_card）在选完掩码之后、
        //   `0x00443025 call 0x40c78c`（真正掉头）之前；收尾 `0x00443069 mov eax, ebx`
        //   （`ebx` = 掩码，恒非 0）。故走 `noEffect()` 而不是 `fail`。
        if (!actorActive(a)) return noEffect();
        actors = actors.map((x, i) =>
          i === slot ? applyTurnCardToActor(x, ctx.nodes, draw) : x,
        );
        break;
      }
      const r = applyTurnCard(players, cur, target, ctx.nodes, draw);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      break;
    }
    case 14: {
      if (target.kind === 'actor') {
        // REQ-05.1：停留卡对特殊棋子 —— VA 0x004440d9 写 +14 halted = 1
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        // 不在棋盘上不生效。★ **卡照扣、原版算成功** ——
        //   @source `0x00443fca call 0x441343`（remove_card）在 `0x00443fb5 call 0x40d293`
        //   （掩码取位号）之后；之后只剩「目标≠自己就说一句」的台词分支。
        if (!actorActive(a)) return noEffect();
        actors = actors.map((x, i) => (i === slot ? applyStayCardToActor(x) : x));
        break;
      }
      const r = applyStayCard(players, cur, target);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      break;
    }
    case 15: {
      const r = applyHibernateCard(players, cur, ctx.priceIndex);
      players = r.players;
      hostilityDeltas = r.hostilityDeltas;
      // ★ 替身那一支**确实存在** —— 先前这里写着「冬眠卡不碰替身记录」，
      //   那是**读错了**（把 `_rich4_all_special_players_state` 当成了玩家结构）。
      //   @source `rich4_card_dongmianka.asm:36-92`：同一个 `ebx` 循环 `0..7`，
      //   `ebx >= 4` 走替身那一支（`+12` 置 5、`+13` 清 0），且**只在盘上**的才写；
      //   循环上界 8 意味着**機器娃娃（actor 8）不在其中**。
      //   渲染据此把替身画成灰的（见 D-T047-4 / `render.ts` 的 `isActorAsleep`）。
      const hib = hibernateActors(actors);
      actors = hib.actors;
      break;
    }
    case 16: {
      // ★ 夢遊卡对**替身**（四大惡人 4..7 / 機器娃娃 8）也有效 ——
      //   原版那一支写记录 `+13`（梦游天数）。
      //
      // @source `rich4_card_mengyouka.asm:252-257`：
      // ```asm
      // 0044449b  cmp    ebx, 4                     ; ebx = 实例下标（已过 CTZ）
      //           jl     loc_004444b3               ; < 4 → 玩家那一支（上面已处理）
      //           shl    ebx, 4                     ; ×16 = 替身记录步长
      //           cmp    byte [ebx + 0x498df4], 0   ; +12 冬眠中 → 不动
      //           jne    loc_004444b3
      //           mov    byte [ebx + 0x498df5], 5   ; ★ +13 = 5
      // ```
      // ⚠️ 先前这里写的是「`ebx` 是位掩码、硬套会把天数写到错的替身上，故不接」
      //   —— **那个判据是错的**：`esi`（选择器的返回值）在更早一处就已经
      //   `push esi / call _count_trailing_zero_u8 / mov ebp, eax / mov ebx, eax`
      //   取过位号了（@0x444295 一带，之后 `ebp` 就是那个下标、`ebx` 是它的副本），
      //   所以到 0x44449b 时 `ebx` 已经是**下标**。订正记录见
      //   `docs/deviations/T-047.md` 的 D-T047-5。
      if (target.kind === 'actor') {
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        // 不在棋盘上（監獄/醫院/未出场）不生效 —— 与停留/轉向/烏龜同一条规矩。
        // ⚠️ 原版那一支没有 `actorActive` 这个判断（它按鼠标点得到谁就是谁），
        //   但 picker 画的就是在场的那几个，故行为一致。
        if (!actorActive(a)) return noEffect();
        // ★★ 已经冬眠的替身：**不写天数**，但原版在 `0x004444b3` 只做
        //   `call 0x41d546` 收尾 + `mov eax, esi`（`esi` = 选中的目标，恒非 0）
        //   ⇒ 返回值非 0 = **成功**，而 `remove_card` 早在 `0x00444219` 执行过了。
        //   @source `0x004444a3 cmp byte [ebx + 0x498df4], 0` / `0x004444aa jne 0x4444b3`
        //   —— 那条 `jne` 只跳过 `mov byte [ebx+0x498df5], 5`。
        //   ⇒ 故走 `noEffect()`（`ok: true` + 已扣卡），不是 `fail`。
        const applied = applySleepwalkCardToActor(a!);
        if (!applied.applied) return noEffect();
        actors = actors.map((x, i) => (i === slot ? applied.actor : x));
        break;
      }
      // 夢遊卡：交通工具退还成道具，故全局道具表也要跟着结果走
      const r = applySleepwalkCard(
        players,
        cur,
        target,
        tools,
        ctx.scapegoatPicker,
        ctx.priceIndex,
      );
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      tools = r.tools;
      // ★ 夢遊卡的敌意（`150 × priceIndex`，`@source 0x004442ea`）——
      //   位置在防御卡判定**之前**，故被免罪卡挡下时**照样**记。
      hostilityDeltas = r.hostilityDeltas;
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
      // ★ 走到这里说明「可请的物件」那道闸门已过；`attachGod` 的内部失败
      //   （noObject/outOfRange/notAttachable）是第二道防线。原版的扣卡在
      //   `0x00444e52 call 0x441343`（紧跟 `0x00444e37 call 0x41e6f2` 取参），
      //   之后一路到 `0x00444f20 jmp 0x444685` 无条件收尾并返回非 0
      //   ⇒ 无变化也算成功。故 `noEffect()`。
      if (!r.ok) return noEffect();
      players = r.players;
      objects = r.objects;
      tools = r.tools;
      toolStock = r.toolStock;
      // 被挤走的旧神若有搭档，交给 reduce 重新登场
      if (r.respawn !== null) respawns.push(r.respawn);
      break;
    }
    case 26: {
      const r = applyTaxCard(players, cur, target, ctx.priceIndex, ctx.scapegoatPicker, ctx.rng);
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      defended = r.defended;
      if (!r.defended && r.victim !== undefined && r.victim !== cur) taxed = { victim: r.victim, amount: r.tax };
      hostilityDeltas = [{ from: targetPlayer, to: cur, delta: r.hostilityDelta }];
      break;
    }
    case 17: {
      // 陷害卡：嫁祸的新目标由外部给出；core 只用结果（C-ARC-2）
      const r = applyFrameCard(
        players, cur, target, ctx.priceIndex, ctx.scapegoatPicker,
        prisonOccupancy, hospitalOccupancy,
        // ★ 首次入狱要传送到监狱格 + 跟班搬家（`send_to_prison` 函数体内的事）
        ctx.nodes, objects, ctx.landscapes,
      );
      if (!r.ok) return fail(r.error ?? 'noEffect');
      players = r.players;
      objects = r.objects;
      hostilityDeltas = r.hostilityDeltas;
      // ★ 入狱要占床位（客户端关押动效靠这一格 0→1 触发）+ 清医院那一格
      prisonOccupancy = r.prisonOccupancy;
      hospitalOccupancy = r.hospitalOccupancy;
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
      if (target.kind === 'actor') {
        // REQ-05.1：烏龜卡对特殊棋子 —— VA 0x00445a3e 写 +15 single_step = 3
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        // 不在棋盘上不生效。★ **卡照扣、原版算成功** ——
        //   @source `0x00445929 call 0x441343`（remove_card）在 `0x00445914 call 0x40d293`
        //   之后；收尾 `0x004458d8 mov eax, esi`（`esi` = 选中目标，恒非 0）。
        if (!actorActive(a)) return noEffect();
        actors = actors.map((x, i) => (i === slot ? applyTortoiseCardToActor(x) : x));
        break;
      }
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
          // @source 0x443348 `mov ebx,[0x49910c]` → `0x44334e push ebx`
          //   ⇒ 拍賣卡的 arg0 = **用卡者**：原版只把他排除出座（`0x43c22a cmp ebx,ebp`），
          //   且落槌款 `pay_money(得标者, arg0, …)`（`0x43c855`）归他。
          bidders: eligibleBidders(players, land, cur),
          seller: cur,
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
        // 同上（設施支）：arg0 = 用卡者
        bidders: eligibleBidders(players, fac, cur),
        seller: cur,
        facility: true,
      };
      break;
    }
    case 3: {
      const here = standingLand(ctx, cur);
      if (here === null || here.land === null) return fail('notStandingOnLand');
      const r = applyBuyLandCard(here.node.type, here.land, me, ctx.priceIndex);
      // @source `0x004423b5 cmp edi, [現金] / jg 0x4425f1`：只差现金那一支弹「您的現金不足！」（卡不扣）
      if (!r.ok) return fail(r.reason === 'notEnoughCash' ? 'notEnoughCash' : 'noEffect');
      // @source push 0 / push edi(成交价) / push esi(原地主) / push current / call 0x41d2c6
      //   flags = 0 → 付款方**先扣现金**，收款方进**银行存款**
      const pay = transferMoney(players, [], 0, cur, r.previousOwner, r.price, 0);
      players = pay.players;
      // @source mov al, [0x49910c] / inc al / mov [land+0x19], al
      putLand({ ...here.land, owner: cur + 1 });
      // ★★ 敌意：原版按 **8 字节 double** 压栈、`0x40df69` 只读**低 32 位**
      //   （@source 0x004423ed `sub esp,8` / 0x004423f0 `fstp qword [esp]` /
      //   0x004423fb `call 0x40df69`）。公式 `(地价×物价)×(等级+2)/5`，
      //   地价住宅取 `+0x1c`、商業取 `+0x22`（两条支路同一个公式与常量）。
      //   ⚠️ 先前这里写着「空操作、恒为 0」——**错**（见 buy-land.ts 的订正注释）。
      hostilityDeltas = [
        {
          from: r.previousOwner,
          to: cur,
          delta: buyLandCardHostility(here.land.landPrice, ctx.priceIndex, here.land.level),
        },
      ];
      break;
    }
    case 7: {
      // ★ 两支按**脚下那一格**的实例区间分（VA 0x004430c7 / 0x00443147）：
      //   0x7d0 < code < 0xfa0 → 地块（住宅 ↔ 连锁店互换，不需要外部参数）
      //   0xfa0 < code < 0x1770 → 設施（种类由外部给：真人过选類別窗、电脑取 AI 参数）
      const here = standingLand(ctx, cur);
      if (here !== null && here.land !== null) {
        const r = applyRebuildCard(here.node.type, here.land);
        if (!r.ok || r.land === null) return fail('noEffect');
        putLand(r.land);
        break;
      }
      const fac = standingFacility(ctx, cur);
      if (fac === null) return fail('notStandingOnLand');
      // 种类挂在 `none` 目标的 `facilityType` 上（这张卡的 `selection` 是 `'none'`，
      // 所以 `validateTarget` 只收 `none` 目标 —— 见 target.ts 的 `facilityType` 注释）。
      // 真人：选類別窗的返回值（VA 0x004431c8）；电脑：AI 参数 `[0x48be58]`。
      const chosenType = target.kind === 'none' ? target.facilityType : undefined;
      const rf = applyRebuildFacilityCard(fac, chosenType);
      if (!rf.ok || rf.facility === null) return fail('noEffect');
      putFacility(rf.facility);
      break;
    }

    // ── 地块目标 ───────────────────────────────────────
    case 11: {
      // 怪獸卡 VA 0x00443917：敌意先按原等级算（level×30×物价指数，无主不记），
      //   再 mutate mode 2 夷平 —— 地块与設施两条路径完全同构
      if (target.kind === 'facility') {
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        // ★ 不能打自己的 / 不能打空地 @source 拾取跳表组 4 `loc_00446457`
        if (!demolishLikeTargetAllowed(fac.owner, fac.level, cur)) return fail('targetNotAllowed');
        // ★ 不设「无变化就早退」的闸门：原版对无主/已夷平的记录**照样**
        //   先记敌意再调 `mutate_land`（`@source 0x004439e8` 起：`cmp [rec+0x19],0`
        //   只决定跳不跳 `0x40df69`，与 `mutate_land` 的「level==0 不动」无关），
        //   且收尾 `0x00443b08 mov eax, esi` 恒非 0 ⇒ 无变化也算成功、卡照扣。
        //   `applyMonsterFacilityCard` 在无变化时原样返回设施与敌意，落地即可。
        const r = applyMonsterFacilityCard(fac, ctx.priceIndex, cur);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        hostilityDeltas = r.hostilityDeltas;
        // ★ 原版 `mutate_facility` 尾部 `call 0x40dffa` —— 全场放人
        if (r.releasesConfined) players = releaseConfinedPlayers(players);
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      // ★ 同上（地块那支）
      if (!demolishLikeTargetAllowed(targetLand.owner, targetLand.level, cur)) {
        return fail('targetNotAllowed');
      }
      // ★ 同上：无变化（level==0）也照样记敌意、照样算成功
      const r = applyMonsterCard(targetLand, ctx.priceIndex, cur);
      putLand(r.land);
      hostilityDeltas = r.hostilityDeltas;
      // ★ 原版 `mutate_land` 尾部 `call 0x40dffa` —— 全场放人
      if (r.releasesConfined) players = releaseConfinedPlayers(players);
      break;
    }
    case 4:
    case 5: {
      // ★ 两条分支由**脚下那一格**决定（原版同形：VA 0x00442685 地块 / 0x004428cc 設施）
      if (target.kind === 'facility') {
        // 换地/换屋的設施版：脚下設施 ↔ 选中設施
        const here = standingFacility(ctx, cur);
        if (here === null) return fail('notStandingOnLand');
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        // @source 拾取组 2 VA 0x00446427 `cmp ecx, ebx / je 拒绝`：不能选自己脚下那个
        if (fac.id === here.id) return fail('noEffect');
        if (cardId === 4) {
          // @source VA 0x00442a09 —— 只换 owner（+0x19）
          const r = applySwapFacilityCard(facilities, here.id, fac.id);
          if (!r.ok) return fail('noEffect');
          facilities = r.facilities;
        } else {
          // @source 助手 0x40b4f8 設施分支 VA 0x0040b880 —— 换 type（+0x18）与 level（+0x1a）
          const r = applySwapHouseFacilityCard(facilities, here.id, fac.id);
          if (!r.ok) return fail('noEffect');
          facilities = r.facilities;
        }
        break;
      }
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
        // ★ 满级不动 → 状态不变，**但卡照扣、原版算成功**。
        //   先前这里写着「原版返回 0」，那是**读反了**：
        //   @source `0x004436b7 je 0x4436c0` → `0x004436ce cmp dword [esp],0` →
        //   `0x004436d2 je 0x4436d9` → `0x004436d9 mov eax, ebp`，
        //   而 `ebp` 是 `0x004434dc call 0x446ae8` 选中的**地产编号**，恒非 0。
        //   ⇒ 返回非 0 = 成功（卡在 `0x00443505` 已扣）。故 `noEffect()`。
        if (!r.ok) return noEffect();
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
        // ★ 同怪獸卡：无变化也要落敌意、算成功（收尾 `0x0044558c mov eax, ebp`）
        const r = applyDevilFacilityCard(fac, ctx.priceIndex, cur);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        hostilityDeltas = r.hostilityDeltas;
        if (r.releasesConfined) players = releaseConfinedPlayers(players);
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
      if (target.kind === 'object') {
        // ★ 第三支：打**地图物件**（路障 16 / 地雷 17 / 定時炸彈 18）
        //   @source VA 0x00443d22 `test byte [esp+1], 0x80` → `_rich4_remove_object`
        const r = applyDemolishObjectCard(
          { players, objects, tools, toolStock },
          target.objectIndex,
        );
        if (r === null) return fail('noEffect');
        players = r.players;
        objects = r.objects;
        tools = r.tools;
        toolStock = r.toolStock;
        // 这三种物件没有搭档（`partnerSlot` 给 -1），保险起见仍按结果处理
        if (r.partner >= 0) respawns.push({ partner: r.partner, nearNode: r.formerNode });
        // ⚠️ 原版物件分支**不记敌意**（只有地块/設施两支调 update_hostility）
        break;
      }
      if (target.kind === 'facility') {
        // 拆除卡設施段 VA 0x00443cee..0x00443d1d：单个拆一级，
        //   拆到 0 级退回公園；敌意平坦 30×物价指数（不按级），无主不记
        const fac = facilities.find((f) => f.id === target.facilityId) ?? null;
        if (fac === null) return fail('facilityOutOfRange');
        // ★ 不能打自己的 / 不能打空地 @source 拾取跳表组 5 `loc_004464c3`
        if (!demolishLikeTargetAllowed(fac.owner, fac.level, cur)) return fail('targetNotAllowed');
        // ★ 无变化（level==0）也照样记平坦敌意、照样算成功
        //   （收尾 `0x00443e35 mov eax, [esp]` = 选中编号，恒非 0；
        //   `0x00443d47 je` 只跳过台词，不跳过敌意）
        const r = applyDemolishFacilityCard(fac, ctx.priceIndex);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));
        if (r.victim >= 0) {
          hostilityDeltas = [{ from: r.victim, to: cur, delta: r.hostilityDelta }];
        }
        if (r.releasesConfined) players = releaseConfinedPlayers(players);
        break;
      }
      if (targetLand === null) return fail('landNotFound');
      // ★ 不能打自己的 / 不能打空地（同設施那支，@source 拾取跳表组 5 `loc_004464c3`）
      if (!demolishLikeTargetAllowed(targetLand.owner, targetLand.level, cur)) {
        return fail('targetNotAllowed');
      }
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
      // ★ 原版对「选到的编号不落在任何地产区间」的情形**照扣卡**并返回该编号
      //   （非 0 = 成功）：@source 漲價卡 `0x004454b0 jle 0x445516` /
      //   `0x0044551c jle 0x44557e` 都汇到 `0x0044558c mov eax, ebp`。
      //   查封卡同形（`0x00445612` / `0x004456a0` → `0x0044558c`）。
      if (r.affected.length === 0) return noEffect();
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
      // ★ 原版没有这道闸门：真人在股市屏里点下去就写了 `newsFlag`（`0x00444f88`
      //   / `0x004450f6`，在「选到了没有」判定之**后**），AI 那条更是**无条件**写；
      //   两边随后都在 `0x0044502a` / `0x004451db` 扣卡并返回选中编号（非 0）。
      //   所以停牌股上也该扣卡 ⇒ `noEffect()`（本闸门只挡住无意义的写）。
      if (stock.f6 !== 0) return noEffect();
      // ★ 黑卡尾部要「旧价 − 现价」，故先把旧价留下（原版函数开头就快照了 12 支旧价）
      const oldPrice = stock.price;
      const r =
        cardId === 24
          ? applyRedCard(market.stocks, target.index)
          : applyBlackCard(market.stocks, target.index);
      if (r.affected < 0) return fail('stockOutOfRange');
      market = { ...market, stocks: r.stocks };
      // ★ 写完 `newsFlag` **紧接着**就把那一支的当日价算出来 —— 原版两路都有这一步：
      //   真人在股市屏的选股模式里（`loc_0042b137` → `call 0x429040(row)`），
      //   AI 在卡函数里（写完 `0x00444f88` / `0x004450f6` 紧接着就
      //   `call 0x429040`，@source 0x00444f91 / 0x004450ff）。
      //   `0x429040` 就是 `applyStockNews`：按 `newsFlag` 取 ±10% 重算价、并覆盖
      //   当日那一格历史。UI 不写行情（C-ARC-2），所以这一步必须落在 core ——
      //   少了它，卡的效果要拖到第二天才看得见（且黑卡尾部的价差会是 0）。
      market = applyStockNews(market, target.index + 1);
      // ★★ 黑卡尾部的敌意循环（VA 0x00445164 起）—— **真的会落敌意**：
      //   它把 `持股 × 价差 ÷ 200` 按 double 压栈，而被调方 `0x40df69` 只读
      //   **低 32 位**；那个低 32 位大多数时候**不是 0**（实测 40/40 见
      //   `rich4-spec/tests/test_stock_alliance_cards.py`），于是关系值会被
      //   写进一个巨大的整数（如 +1717986918）。本节此前写「恒为 0、均不落敌意」
      //   是**错的**，已订正。
      //   紅卡没有敌意段。
      if (cardId === 25 && ctx.holdings !== undefined) {
        const holders = ctx.players.map((_p, i) => ctx.holdings?.[i]?.[target.index]?.amount ?? 0);
        hostilityDeltas = blackCardHostilityDeltas(
          holders,
          cur,
          oldPrice,
          market.stocks[target.index]?.price ?? oldPrice,
        );
      }
      break;
    }

    default:
      return fail('notImplemented');
  }

  // 敌意真正落到状态上（updateHostility 内含「敌意上升解除同盟」的副作用）
  players = applyHostilityDeltas(players, hostilityDeltas);

  // ★ 效果生效后才消耗卡片
  players = players.map((p, i) => (i === cur ? consumeCard(p, cardId) : p));

  // ★ 走到这里 = 原版返回非 0（成功）：效果已落地，卡已被扣
  return { ok: true, error: null, players, lands, tools, toolStock, objects, market, facilities, actors, prisonOccupancy, hospitalOccupancy, respawns, hostilityDeltas, defended, releasedObjects, followUp, researchReset, ...(taxed === undefined ? {} : { taxed }) };
}
