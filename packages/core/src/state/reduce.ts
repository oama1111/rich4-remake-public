/*
 * 状态归约器 —— 引擎的心脏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * C-DET-4：`reduce(state, action)` 必须是**纯函数**。
 *   相同的 (初始状态, action 序列) 必须产出逐字节相同的结果。
 *   引擎内不读挂钟、不调 Math.random、不做浮点金额运算。
 *
 * 实现约定：不原地修改入参，一律返回新对象。
 */

import type { Action } from './actions.ts';
import type { GameState, Player } from './types.ts';
import type { SpecialActor } from '../rules/special-actors.ts';
import { isAiControlled, isAlive } from './types.ts';
import { WatcomRng, drawRandomCard, rollDice } from '../rng/watcom.ts';
import { applyNpcEvents, runNpc } from '../rules/npc-walk.ts';
import {
  ACTOR_DOLL,
  NPC_ACTORS,
  SPECIAL_ACTOR_BASE,
  actorActive,
  npcSteps,
  npcTurnSteps,
  releaseNpc,
  runDoll,
  spawnDoll,
  specialSlotOf,
  tickNpcCounters,
} from '../rules/special-actors.ts';
import {
  TOOL_TIME_MACHINE,
  restoreSnapshot,
  snapshotOnTurnStart,
} from '../rules/time-machine.ts';
import {
  TOOL_TELEPORTER,
  decodeTeleport,
  teleportLand,
  teleportPlayer,
  teleportFacility,
} from '../rules/teleport.ts';
import { TRAFFIC_WALK, VEHICLE_DICE } from '../rules/tool-effects.ts';
import {
  bankChairman,
  bankReserveCall,
  borrowSpecial,
  payFromBank,
  repaySpecial,
  specialFinanceAvailable,
  chairmanOfIndustry,
} from '../places/special-finance.ts';
import { evaluateTurnStart, turnController } from '../rules/turn-start.ts';
import type { MapNode, LandInfo, FacilityInfo, CommercialInfo } from '../loaders/map.ts';
import { housingIndexOf, canPurchase, canUpgrade, landingOnLand } from '../rules/land.ts';
import { collectRent } from '../rules/rent.ts';
import { PAY_FLAG_CREDIT_TO_CASH, companyParty, receiveMoney, transferMoney, type Company } from '../rules/payment.ts';
import { reaperPayer, tollExemption, tollPassiveTail } from '../rules/toll-flow.ts';
import { PASSIVE_CARDS, consumeCard } from '../cards/passive.ts';
import {
  markPlayerBankrupt,
  resolveBankruptcyOutcome,
} from '../rules/bankruptcy.ts';
import { LOTTERY_DRAW_DAY, drawLottery, releaseTickets } from '../places/lottery.ts';
import { buyStock, commercialUnitPrice, liquidateStocks, sellStock,
  recalcAvgCost,
} from '../places/stock.ts';
import { emptyOwnership, ownerOf, updateCommercialOwner } from '../places/commercial.ts';
import { useCard } from '../cards/registry.ts';
import {
  MISSILE_HOSPITAL_DAYS,
  MISSILE_HOSTILITY_FACTOR,
  MISSILE_RADIUS,
  PLACEMENT_TOOLS,
  VEHICLE_TOOLS,
  blastLand,
  buildOneLevel,
  isToolImplemented,
  isValidRemoteDice,
  placeObject,
  useVehicleTool,
} from '../rules/tool-effects.ts';
import { STOCKED_TOOL_MAX_ID, TOOL_SLOTS_PER_PLAYER, giveTool, takeTool, toolCount, toolsOf } from '../rules/tools.ts';
import {
  AI_BOARD_LIST_CHANCE,
  AI_BOARD_REPRICE_CHANCE,
  AI_BOARD_SHOP_CHANCE,
  AI_CARD_LIST_MIN_HAND,
  LISTING,
  aiWantsListedEstate,
  aiWantsListedStock,
  aiWantsToListTool,
  canBuyListing,
  cardListPrice,
  decodeEstate,
  duplicateCards,
  emptyColumn,
  estateListPrice,
  isColumnFull,
  listItem,
  settlePayment,
  toolListPrice,
  withdrawItem,
  type Listing,
  type ListingKind,
} from '../places/notice-board.ts';
import { isLimitDown, isLimitUp, loanSellPressure, loanStillUncovered, marketOpenOn } from '../places/stock-market.ts';
import {
  DIVIDEND_DAY,
  INDUSTRY,
  addInsuranceDays,
  aiPickConstructionTarget,
  applyDividend,
  chairmanEffect,
  companyDividends,
  companyFeeOnLanding,
  industryUsesWheel,
  shareWindowLimit,
} from '../places/company.ts';
import { tickBlockingCounter } from '../rules/blocking.ts';
import {
  buyCard,
  buyTool,
  cardPrice,
  resellValue,
  sellCard,
  sellTool,
  toolPrice,
  drawCardShelf,
  toolShelf,
  STORE_INDUSTRY,
} from '../places/shop.ts';
import { CARDS, CHARACTERS, TOOLS, fortuneEvent, newsEvent } from '@rich4/data';
import type { CardTarget } from '../cards/target.ts';
import { applyHostilityDeltas, breakAlliance, updateHostility } from '../rules/hostility.ts';
import {
  objectNodeCandidates,
  pickObjectNodeDistant,
  releaseObject,
  resolveArrival,
  tickGod,
  drawGiftTool,
} from '../rules/object-landing.ts';
import { demolishLand, isSealedStrict, sweepPriceStatus } from '../rules/land-mutation.ts';
import { almsAmount, beggarAt } from '../rules/beggar.ts';
import {
  MINIGAME_MAX_SCORE,
  MINIGAME_NAMES,
  autoMinigameScore,
  clampMinigameScore,
  isMinigame,
} from '../places/minigame.ts';
import {
  applyMagicEffect,
  spinMagicHouse,
  type MagicNodeInfo,
  type MagicRequest,
} from '../places/magic-house.ts';
import type { TradeResult } from '../places/stock.ts';
import {
  refreshTradableShares,
  tickStockCountdowns,
  tickStockMarket,
} from '../places/stock-market.ts';
import { advanceDate, daysInMonth, packDate } from '../rules/calendar.ts';
import { settleMonthlyBank } from '../rules/monthly.ts';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from './types.ts';
import {
  FACILITY_TYPE,
  WHEEL,
  aiPickFacilityType,
  RESEARCH_MAX_PROJECT,
  RESEARCH_MIN_PROJECT,
  aiPickResearchProject,
  calculateFacilityToll,
  startResearch,
  tickResearch,
  canUpgradeFacility,
  facilityBuildPrice,
  facilityBuyPrice,
  facilityUpgradePrice,
  hotelStayLoss,
  spinWheel,
  tenureExpiresToday,
  tenureExpiry,
} from '../rules/facility.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { adjustTollByGod } from '../rules/god-toll.ts';
import { facilityIndexOf } from '../rules/land.ts';
import { tickBlocking, tickTurnCounters } from '../rules/blocking.ts';
import { wakeFromSleepwalk } from '../cards/sleepwalk.ts';
import { purchase, purchaseBlockedBy } from '../rules/purchase.ts';
import { settleSpecialSquare, addPoints, MAX_HAND_CARDS } from '../rules/special-square.ts';
import { MAX_LAND_LEVEL, SPECIAL_KIND } from '../loaders/map.ts';
import { drawEvent } from '../events/deck.ts';
import { isNewsFeasible } from '../events/news.ts';
import { checkFortune } from '../events/fortune.ts';
import {
  FORTUNE_STOCK_LIQUIDATE,
  applyFortuneEffect,
} from '../events/fortune-effects.ts';
import { blessingFieldOf, blessingLevelFor } from '../rules/blessing.ts';
import { sellAllCards, sellAllTools } from '../rules/inventory.ts';
import { applyNewsEffect } from '../events/news-effects.ts';
import { anyoneConfined, confine, type ConfinementKind } from '../rules/confinement.ts';
import { applyBail, bailCandidates, decideBail } from '../rules/visit.ts';
import {
  isUnimplementedPlace,
  needsInteraction,
  unimplementedPlace,
  type AuctionPending,
  type AuctionRequest,
  type PendingInteraction,
} from '../rules/interaction.ts';
import {
  borrow,
  deposit,
  loanCapacity,
  rebalanceCashByRatio,
  repay,
  withdraw,
} from '../places/bank.ts';
import {
  LOTTERY_TICKET_PRICE,
  aiBuyTicket,
  availableNumbers,
  buyTicket,
  numbersOf,
} from '../places/lottery.ts';
import {
  auctionAdvanceSeat,
  auctionAiLimits,
  auctionCanAfford,
  auctionFinished,
  auctionFirstSeat,
  auctionOutcome,
  auctionSeatStatus,
  sameNameFacilityOwned,
  sameNameLandOwned,
  settleAuction,
  settleFacilityAuction,
  type AuctionSeatStatus,
} from '../rules/auction.ts';
import { calculatePlayerWealth, updatePriceIndex } from '../rules/wealth.ts';
import type { StockValuation } from '../rules/wealth.ts';
import { DEFAULT_INITIAL_FUND } from '../rules/setup.ts';
import { checkVictory, clearLosers } from '../rules/victory.ts';

/**
 * 归约所需的地图静态数据（只读，不进状态，避免快照臃肿）。
 *
 * 地块的**实时**归属与等级存在 `GameState.landOwner` / `landLevel` 里，
 * 这里的 `lands` 只提供不变的模板（名称、地价、房价、租金表）。
 */
export interface MapTopology {
  nodes: readonly MapNode[];
  lands?: readonly LandInfo[];
  /** 设施表 —— 有了它才能处理设施落点 */
  facilities?: readonly FacilityInfo[];
  /** 上市企业表 —— 股市的均值回归锚点要用它的资产额 */
  commercials?: readonly CommercialInfo[];
}

/**
 * 把静态設施模板与状态中的实时归属/等级/种类合并 —— 与 `effectiveLand` 同构。
 *
 * ★ 所有要看「這處設施現在是誰的、幾級、什麼建築」的地方都必須走这里，
 *   直接读 `topo.facilities` 拿到的是地图初值（全 0）。
 */
export function effectiveFacility(
  s: GameState,
  topo: MapTopology,
  facilityId: number,
): FacilityInfo | null {
  const tpl = topo.facilities?.find((f) => f.id === facilityId);
  if (tpl === undefined) return null;
  return {
    ...tpl,
    owner: s.facilityOwner[facilityId] ?? tpl.owner,
    level: s.facilityLevel[facilityId] ?? tpl.level,
    type: s.facilityType[facilityId] ?? tpl.type,
    priceStatus: s.facilityPriceStatus[facilityId] ?? tpl.priceStatus,
  };
}

export function allEffectiveFacilities(s: GameState, topo: MapTopology): FacilityInfo[] {
  return (topo.facilities ?? []).map((f) => effectiveFacility(s, topo, f.id) ?? f);
}

/** 把静态地块模板与状态中的实时归属合并，得到当前有效的地块 */
export function effectiveLand(
  s: GameState,
  topo: MapTopology,
  landIndex: number,
): LandInfo | null {
  const tpl = topo.lands?.find((l) => l.id === landIndex);
  if (tpl === undefined) return null;
  return {
    ...tpl,
    owner: s.landOwner[landIndex] ?? tpl.owner,
    level: s.landLevel[landIndex] ?? tpl.level,
    type: s.landType[landIndex] ?? tpl.type,
    priceStatus: s.landPriceStatus[landIndex] ?? tpl.priceStatus,
  };
}

/**
 * 给一个刚挂出来的 `pending{auction}` 补上竞价循环需要的字段。
 *
 * @source 拍賣入口 `0x0043c110` 起（建座位表）→ `0x43c5d9`（逐座位
 *   `fcn_00439f0d` 算心理价位，存座位 `+8`）。
 *
 * 三件事：
 * 1. 座位状态：出局 / 出不起底价 → 非 0（原版还细分 1..6 与 8，本引擎合并）；
 * 2. 心理价位：**只在开拍时算一次**，种子由 `rngState` 与实体号派生，
 *    不推进 `rngState`（这样读档/联机两端算出来一模一样，见 auction.ts 的注）；
 * 3. 现价 = 起拍价、最高出价者 = -1、轮到第一家。
 *
 * ★ 放在这里而不是卡片/新聞各自的调用点：开拍这件事有**五个**调用点
 *   （拍賣卡两处、破产清算、新聞事件、0x40d1e3），把这段逻辑挂一次
 *   比抄五遍可靠 —— 而且 `auctionBid` 要求这些字段一定在。
 */
function openAuction(
  state: GameState,
  topo: MapTopology,
  pending: AuctionRequest,
): AuctionPending {
  const status = auctionSeatStatus(state.players, pending.bidders, pending.basePrice);
  const facility = pending.facility === true;
  const entity = facility
    ? (() => {
        const fac = effectiveFacility(state, topo, pending.entityId);
        const all = allEffectiveFacilities(state, topo);
        return {
          basePrice: pending.basePrice,
          priceIndex: state.priceIndex,
          landPrice: fac?.landPrice ?? 0,
          level: fac?.level ?? 0,
          total: all.length,
          unowned: all.filter((f) => f.owner === 0).length,
          sameNameOwned: sameNameFacilityOwned,
        };
      })()
    : (() => {
        const land = effectiveLand(state, topo, pending.entityId);
        const all = allEffectiveLands(state, topo);
        return {
          basePrice: pending.basePrice,
          priceIndex: state.priceIndex,
          landPrice: land?.landPrice ?? 0,
          level: land?.level ?? 0,
          total: all.length,
          unowned: all.filter((l) => l.owner === 0).length,
          sameNameOwned: (player: number): number =>
            sameNameLandOwned(land?.name ?? '', player, all, (id, fallback) =>
              facility ? (state.facilityOwner[id] ?? fallback) : (state.landOwner[id] ?? fallback),
            ),
        };
      })();

  const seed = (state.rngState ^ Math.imul(pending.entityId + 1, 0x9e3779b1)) >>> 0;

  // ★★ 卖家 = 待拍实体的**现主**（1 基编码 → −1 得玩家下标；0 = 无主）。
  //   原版建表时给卖家那一格写状态 **7**，绕圈因此永远跳过它
  //   （`loc_0043c110` 的 `cmp ebx, [esp+0xac]` 那一支）—— 起拍那一口
  //   不可能落在卖家头上。本引擎的 `status` 里没有「7」这一档，
  //   所以把卖家**显式**传给 `auctionFirstSeat` 让它跳过。
  //   ⚠️ 不这么做时，**无主地**自拍会出问题：`eligibleBidders` 不排除任何人
  //   （`entity.owner === 0` 谁都匹配不上）⇒ 名单里含卖家自己、状态是 `'active'`
  //   ⇒ 开场席位落回卖家（外部审查 A-3 实测到的卡死）。
  //   无主时卖家就是当前行动者（拍賣卡/魔法屋都只拍「自己脚下」那块）。
  const owner = facility
    ? (effectiveFacility(state, topo, pending.entityId)?.owner ?? 0)
    : (effectiveLand(state, topo, pending.entityId)?.owner ?? 0);
  const seller = owner === 0 ? state.currentPlayer : owner - 1;

  return {
    ...pending,
    price: pending.basePrice,
    top: -1,
    topCash: 0,
    // ★ 卖家单列（见 `AuctionPending.seller` 的注释）：出价循环两处都要跳过他
    seller,
    // ★ 开场席位从 slot 0 起（原版 `loc_0043a365` 把 `[0x48c4a4]` 清 0），
    //   并跳过卖家与非 active 的座位。找不到返回 -1
    //   （此时已判流标/成交，客户端据此不再等任何人点钮）。见 `auctionFirstSeat`。
    seat: auctionFirstSeat(pending.bidders, status, seller),
    status,
    limits: auctionAiLimits(entity, state.players, pending.bidders, seed),
  };
}

/**
 * 拍卖落槌 —— 地盘/設施两条路共用。
 *
 * @source 拍賣卡 VA 0x0044334f / 0x0044346c：`run_auction` 返回 0（流拍）→
 *   `mov byte [land + 0x19], 0` 变无主；得标者付款进公库
 *   （见 `rules/auction.ts` 的 `settleAuction` / `settleFacilityAuction`）。
 */
function settleAuctionPending(
  state: GameState,
  topo: MapTopology,
  pending: AuctionPending,
): GameState {
  const out = auctionOutcome(pending);
  return settleAuctionExplicit(state, topo, pending, out.winner, out.price);
}

/**
 * 拍卖落槌的**显式**版本：成交者与成交价已经定好，只做归属与付款。
 *
 * 两条路都用它：
 * - 竞价循环自己收尾（`settleAuctionPending` 按 `auctionOutcome` 判完再进来）；
 * - 兼容入口 `{ type: 'auction', winner, price }`（Q-AUC-1 之前由表现层发）。
 */
function settleAuctionExplicit(
  state: GameState,
  topo: MapTopology,
  pending: AuctionRequest,
  w: number,
  p: number,
): GameState {
  const entityId = pending.entityId;

  // 設施拍卖（拍賣卡踏在設施格上时挂出）——结算走同一条公库付款路径
  if (pending.facility === true) {
    const fac = effectiveFacility(state, topo, entityId);
    if (fac === null) return { ...state, pending: null, phase: 'turnEnd' };
    const fr = settleFacilityAuction(state.players, fac, { winner: w, price: p }, state.pool);
    const facilityOwner = [...state.facilityOwner];
    facilityOwner[entityId] = fr.facility.owner;
    const settled: GameState = {
      ...state,
      players: fr.players,
      facilityOwner,
      pool: fr.pool,
      pending: null,
      phase: 'turnEnd',
    };
    return fr.bankrupted ? applyBankruptcy(settled, w, topo) : settled;
  }

  const land = effectiveLand(state, topo, entityId);
  if (land === null) return { ...state, pending: null, phase: 'turnEnd' };
  const r = settleAuction(state.players, land, { winner: w, price: p }, state.pool);
  const landOwner = [...state.landOwner];
  landOwner[entityId] = r.land.owner;
  const settled: GameState = {
    ...state,
    players: r.players,
    landOwner,
    pool: r.pool,
    pending: null,
    phase: 'turnEnd',
  };
  return r.bankrupted ? applyBankruptcy(settled, w, topo) : settled;
}

/**
 * 这个玩家是不是銀行董事長；是就给出他的特別融資额度。
 *
 * ★ 不是董事長返回 `null` —— 原版那扇窗户里根本看不见人
 *   （@source VA 0x00436b31 起，见 places/special-finance.ts）。
 */
function specialFinanceOf(
  s: GameState,
  topo: MapTopology,
  player: number,
): { owed: number; available: number } | null {
  if (bankChairman(s, topo.commercials) !== player) return null;
  const me = s.players[player];
  if (me === undefined) return null;
  return { owed: me.specialFinance, available: specialFinanceAvailable(s.players, player) };
}

/**
 * 銀行資金準備不足时，让董事長把差額垫上。
 *
 * @source VA 0x00436b5c 起，见 places/special-finance.ts 的 `bankReserveCall`。
 * 扣钱走「先存款、再现金、还不够就破產」（VA 0x00433bd8）。
 */
function settleBankReserve(s: GameState, topo: MapTopology): GameState {
  const call = bankReserveCall(s, topo.commercials, s.currentPlayer);
  if (call === null) return s;
  const boss = s.players[call.chairman];
  if (boss === undefined) return s;
  const paid = payFromBank(boss, call.shortfall);
  const after: Player = {
    ...paid.player,
    specialFinance: Math.max(0, boss.specialFinance - call.shortfall),
  };
  const players = s.players.map((p, i) => (i === call.chairman ? after : p));
  const next: GameState = { ...s, players };
  // ⚠️ 垫付到破产这一支原版也有（0x00433c16 调破產）；这里交给统一的破产流程
  return paid.bankrupt ? settleBankruptcies(next, [call.chairman], topo) : next;
}

/** 当前玩家落点所对应的住宅地块下标；非住宅返回 null */
export function landIndexAtPlayer(s: GameState, topo: MapTopology): number | null {
  const p = s.players[s.currentPlayer];
  if (p === undefined) return null;
  const node = topo.nodes[p.nodeId - 1];
  if (node === undefined) return null;
  return housingIndexOf(node.type);
}

/** 该地图上全部地块的当前有效状态（用于过路费的同区累加） */
export function allEffectiveLands(s: GameState, topo: MapTopology): LandInfo[] {
  if (topo.lands === undefined) return [];
  return topo.lands.map((l) => ({
    ...l,
    owner: s.landOwner[l.id] ?? l.owner,
    level: s.landLevel[l.id] ?? l.level,
    type: s.landType[l.id] ?? l.type,
  }));
}

/** 浅拷贝玩家，避免原地修改 */
function cloneP(p: Player): Player {
  return { ...p, blocking: { ...p.blocking }, cards: [...p.cards], tools: [...p.tools] };
}

/**
 * `setAi` 的五个可选字段各自的合法范围（越界即整条拒绝）。
 *
 * - `whoPlays`：只接受 1 真人 / 2 電腦 / 5 真人託管 —— 出局的 0 不能从这一屏设置回去；
 * - `aiFlags`：能力位只有 bit0 会用卡、bit1 会用道具，故 0..3；
 * - `personality`：S3 截图上就三档（乖寶寶/普通人/大老奸），故 0..2；
 * - 两个比例是**百分比**，0..100（`loanRatio` 不在 setAi 里：原版那一屏没有它的滑块）。
 */
function isValidAiSetting(a: {
  whoPlays?: number;
  aiFlags?: number;
  personality?: number;
  cashRatio?: number;
  stockRatio?: number;
}): boolean {
  if (a.whoPlays !== undefined) {
    const allowed = [WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT];
    if (!allowed.includes(a.whoPlays)) return false;
  }
  const percent = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= 100;
  if (a.aiFlags !== undefined && !Number.isInteger(a.aiFlags)) return false;
  if (a.aiFlags !== undefined && (a.aiFlags < 0 || a.aiFlags > 3)) return false;
  if (a.personality !== undefined && !Number.isInteger(a.personality)) return false;
  if (a.personality !== undefined && (a.personality < 0 || a.personality > 2)) return false;
  if (a.cashRatio !== undefined && !percent(a.cashRatio)) return false;
  if (a.stockRatio !== undefined && !percent(a.stockRatio)) return false;
  return true;
}

function withPlayer(s: GameState, index: number, fn: (p: Player) => void): GameState {
  const players = s.players.map((p, i) => (i === index ? cloneP(p) : p));
  const target = players[index];
  if (target !== undefined) fn(target);
  return { ...s, players };
}

/**
 * 封路位：第 i 个邻接槽被封时，节点 flags 的第 (30 − i) 位为 1。
 *
 * @source 走子选路 VA 0x0040c12c：
 * ```asm
 * mov  ecx, 0x40000000          ; 掩码从 bit30 起
 * ...
 * 0040c144  sar ecx, 1          ; 每试一个槽右移一位 → bit30/29/28/27
 * 0040c14e  mov dx, [ebx + edx*2 + 0x18]   ; node.adjacent[i]
 * 0040c159  je  下一个                      ; 槽为 0 → 跳过
 * 0040c16b  cmp edx, edi / je 下一个        ; ★ 等于 last_node_id → 跳过（不走回头路）
 * 0040c16f  test [esp+0x24], ecx / jne 下一个 ; ★ 该槽被封 → 跳过
 * ```
 *
 * 八张地图上这几位一共只置了 10 次，且**只出现在岔路节点上**——
 * 它就是「这条支线此刻不通」的标记。台湾图（地图 0）两个岔路各封掉一条，
 * 于是那两处实际只剩一条路可走。
 */
export function linkBlockedMask(slot: number): number {
  return 0x40000000 >>> slot;
}

/**
 * 求出从 `from` 出发、上一步来自 `prev` 时的候选前进节点。
 *
 * ★ **原版在岔路口不问玩家**。它按上面那段汇编筛一遍（去掉空槽、
 *   去掉回头路、去掉被封的槽），剩下几个就 `rand() % n` 随机挑一个：
 * ```asm
 * 0040c17c  test esi, esi / jne 有候选
 * 0040c180  next = player.last_node_id      ; ★ 一个都不剩 → 原路返回
 * 0040c196  call rand / idiv esi            ; ★ 有候选 → 随机挑
 * ```
 *
 * 这纠正了本引擎先前的一处**自创玩法**：原来在 `candidates.length > 1` 时
 * 会停成 `awaitingDirection` 弹框问玩家走哪边。原版没有这个交互——
 * 棋子一路向前，遇到岔路由引擎决定，玩家只能靠「向後轉」之类的卡改方向。
 */
export function nextCandidates(
  topo: MapTopology,
  from: number,
  prev: number,
): number[] {
  const node = topo.nodes[from - 1];
  if (node === undefined) return [];
  const out: number[] = [];
  for (let slot = 0; slot < 4; slot++) {
    const n = node.adjacentSlots[slot] ?? 0;
    if (n === 0) continue;
    if (n === prev) continue;
    if ((node.flags & linkBlockedMask(slot)) !== 0) continue;
    out.push(n);
  }
  return out;
}

/**
 * 下一格是哪个 —— 含随机选路，故要用并推进 PRNG。
 *
 * 返回 `null` 表示这个节点根本不在地图上。
 */
export function pickNextNode(
  topo: MapTopology,
  from: number,
  prev: number,
  rng: WatcomRng,
): number | null {
  const node = topo.nodes[from - 1];
  if (node === undefined) return null;
  const candidates = nextCandidates(topo, from, prev);
  // @source 0x0040c180：无候选时回到上一格；上一格也没有（开局第一步）就原地不动
  if (candidates.length === 0) return prev !== 0 ? prev : from;
  if (candidates.length === 1) return candidates[0]!;
  // @source 0x0040c196 `call rand / idiv esi`
  return candidates[rng.next() % candidates.length]!;
}

/**
 * 世界位移 → 八向朝向。
 *
 * @source VA 0x0040d639：
 * ```asm
 * push dy / push dx / call 0x00454fb4
 * mov  byte [player + 0x10], al         ; player.direction
 * ```
 * 而 `0x00454fb4` 是定点 atan2 加一次量化：
 * ```asm
 * 00454fc1  neg ecx                     ; ★ dy 取反（屏幕 y 向下，角度按数学向上算）
 * 00454fc3  call atan2_16bit            ; → ax ∈ 0..0xffff 表示 0..360°
 * 00454fc8  shr ax, 0xc                 ; → 0..15（每 22.5°）
 * 00454fcc  inc ax / shr ax, 1          ; → 四舍五入到 0..8
 * 00454fd1  and eax, 7                  ; → 八分圆 0..7
 * 00454fd4  movzx eax, byte [eax + 0x482414]   ; 再查一张 8 字节重映射表
 * ```
 * 那张表是 `[2,3,4,5,6,7,0,1]`，即 `direction = (八分圆 + 2) & 7`。
 */
export const DIRECTION_REMAP: readonly number[] = [2, 3, 4, 5, 6, 7, 0, 1];

/**
 * 1 / 2π。
 *
 * ⚠️ 写成常量而不是 `x / (2π)`：C-DET-3 那条 lint 规则不准出现裸除法
 *   （它管的是金额，但规则没法分辨用途）。这里是角度，与钱无关。
 */
const TURNS_PER_RADIAN = 0.15915494309189535;

export function directionOf(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0; // @source 0x00454fe5：两个都是 0 时不改
  // atan2(-dy, dx) 归一到 0..1 圈，再量化到八分圆
  const turns = Math.atan2(-dy, dx) * TURNS_PER_RADIAN;
  const octant = Math.round((((turns % 1) + 1) % 1) * 8) & 7;
  return DIRECTION_REMAP[octant]!;
}

/**
 * 这一輪还有哪些惡人要走 —— 在盘上的槽位（0..3），按**槽位升序**。
 *
 * @source `rich4.asm:11766-11782`（`loc_00418f93`）那条游标：越过最后一名玩家后
 * `[0x49910c]` 依次取 4..7，每个都查 `cmp byte [eax + 0x498df2], 0`（`+10` = 在盘上）
 * —— 不在盘上的**跳过**（游标继续往下走，不给它这一趟）。
 *
 * ⚠️ 原版的游标在 4..7 之间**逐个停下来走一趟**，不是一次走完；本引擎把
 *   「还有哪些」记进 `GameState.pendingNpcSlots`，由 `npcStep` 逐个消费。
 */
function activeNpcSlots(state: GameState): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < NPC_ACTORS.length; slot++) {
    if (actorActive(state.specialActors[slot])) out.push(slot);
  }
  return out;
}

/**
 * 讓**一个**惡人走一趟 @source 0x0040dd1f（步数：停留 0 / 龜行 1 / 其余 rand()%9+2）
 * + `tick_blocking` 的 actor 分支（他**轮到时**先走一天计数）。
 *
 * 与保釋当场那一趟同一条 `runNpc`；不同点是这一条**只看一个槽**，
 * 好让表现层拿到「一趟一条」的 `lastNpcWalks`（串行播放，T-047 的 D-T047-5）。
 *
 * 返回 `null` 表示这个槽不在了（不在盘上 / 已出局），调用方跳过它。
 */
function npcStepOnce(
  state: GameState,
  topo: MapTopology,
  slot: number,
): GameState | null {
  const actor = state.specialActors[slot];
  if (!actorActive(actor)) return null;
  const actorId = SPECIAL_ACTOR_BASE + slot;
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const ticked = tickNpcCounters(actor!);
  const steps = npcTurnSteps(ticked, rng);
  const put = (st: GameState, a: SpecialActor): GameState => {
    const specialActors = [...st.specialActors];
    specialActors[slot] = a;
    return { ...st, specialActors };
  };
  if (steps === 0) {
    // 停留（`+14 halted != 0`）：这一趟不走，但计数照样走了一天
    return put({ ...state, rngState: rng.getState(), lastNpcWalks: [] }, ticked);
  }
  const walk = runNpc(
    actorId,
    { ...ticked, stepsRemaining: steps },
    state,
    topo,
    (from, prev) => pickNextNode(topo, from, prev, rng) ?? 0,
    rng,
  );
  const settled = applyNpcEvents(state, ticked.owner, walk.events);
  let next = put(
    // ★ 覆写（不累积）：这一条 action 只走了一个惡人，表现层就只该看到一个
    { ...settled.state, rngState: rng.getState(), lastNpcWalks: [{ slot, path: walk.path }] },
    walk.actor,
  );
  const home = walk.events.find((e) => e.kind === 'home');
  if (home !== undefined) {
    const back = [...(home.place === 'prison' ? next.prisonOccupancy : next.hospitalOccupancy)];
    back[actorId] = 1;
    next = home.place === 'prison' ? { ...next, prisonOccupancy: back } : { ...next, hospitalOccupancy: back };
  }
  for (const who of settled.bankrupted) next = applyBankruptcy(next, who, topo);
  return next;
}

/**
 * 回合边界的惡人段 —— 走**下一位**，走完最后一个才推日期并轮到下一位玩家。
 *
 * @source `rich4.asm:11766-11832`：
 * ```asm
 * 00418f93  xor ebx, ebx                    ; ebx = 0：还没绕回 0 号玩家
 * 00418f95  current_player++                ; 0→1→2→3→4→…→7→8
 * 00418fa2  if (current_player == num_players) current_player = 4   ; ★ 跳到第一个惡人
 * 00418fb6  if (current_player == 8) { current_player = 0; ebx = 1 } ; ★ 绕回来了
 * 00418fca… at 4..7: 查 +10 在不在盘上，不在就 ++ 继续
 * 0041902a  if (ebx) call 0x41cf67          ; ★ 只有绕回来那一次才推日期
 * ```
 * 本引擎的 `currentPlayer` 只装 0..3（玩家），惡人那一段由 `pendingNpcSlots`
 * 表示 —— 顺序与上面那条游标**同序**（槽位升序），推日期也压在最后一个之后。
 */
function npcRoundStep(state: GameState, topo: MapTopology, next: number): GameState {
  let rest = state.pendingNpcSlots ?? [];
  let done: GameState = state;
  // ★ 一条 action **只走一个**惡人 —— 表现层要靠这个粒度一趟一趟播。
  //   队列里可能有**过期**的槽（这一輪中间被保釋回家/被抓回去），
  //   那些**跳过**、不占这一条 action（原版游标 `+10 == 0` 的才停）。
  while (rest.length > 0) {
    const slot = rest[0]!;
    rest = rest.slice(1);
    const stepped = npcStepOnce(state, topo, slot);
    if (stepped !== null) {
      done = stepped;
      break;
    }
    // 这个槽不在盘上了：把这一格空转掉，继续看下一个
    done = { ...state, pendingNpcSlots: rest, lastNpcWalks: [] };
  }
  if (done.phase === 'gameOver') return { ...done, pendingNpcSlots: [] };
  // 还有惡人没走 —— 停在 turnEnd 等下一条 `npcStep`（**不**换玩家、**不**推日期）
  if (rest.length > 0) return { ...done, pendingNpcSlots: rest };
  // ★ 最后一个走完了 —— 这一輪到此结束：推日期（含物价指数 / 行情 / 開獎 / 月結），
  //   然后轮到下一位玩家。原版那两件事在**同一次**游标推进里
  //   （`rich4.asm:11826 call 0x41cf67` 之后才 `ret`，下一轮从 `currentPlayer` 起算）。
  const rolled = advanceGameDay({ ...done, pendingNpcSlots: [] }, topo);
  if (rolled.phase === 'gameOver') return rolled;
  // ★ 下一位玩家由**调用方**算好传进来（`endTurn` 里已经算过 `nextAlivePlayer`）——
  //   在这一段里再算一遍会看到惡人段开始之后才变化的状态，与原版那条游标不同。
  return {
    ...rolled,
    currentPlayer: next,
    phase: 'turnStart',
    pending: null,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    turnCount: state.turnCount + 1,
  };
}

/**
 * 回合边界的后半段计数（0x0041caf4 起，见 rules/blocking.ts `tickTurnCounters`）：
 * 冬眠／梦游／停留／龜行／銀行拒貸／同盟各走一天；梦游醒来把交通工具拿回来
 * （0x0041c9bc..0x0041ca72），同盟每日互减敌意 20×物價（0x0041cbe5..0x0041cc2e），
 * 到期解除双方（0x40cc1a）。
 */
function tickDailyCounters(state: GameState, index: number): GameState {
  const me = state.players[index];
  if (me === undefined) return state;
  const t = tickTurnCounters(me);
  let players = state.players.map((p, i) => (i === index ? t.player : p));
  let tools = state.tools;
  if (t.wakeFromSleepwalk) {
    // @source 0x0041c9bc：+0x66 & 3 → 1 機車(道具 5) / 2 汽車(道具 6) / 3 直接恢复；道具栏没那辆就步行
    const p = players[index]!;
    const saved = p.savedTrafficMethod & 3;
    const toolId = saved === 1 ? 5 : saved === 2 ? 6 : 0;
    const woke = wakeFromSleepwalk(p);
    if (saved === 3 || (toolId !== 0 && toolCount(tools, index, toolId) !== 0)) {
      if (toolId !== 0) {
        tools = [...tools];
        tools[index * TOOL_SLOTS_PER_PLAYER + toolId] = toolCount(tools, index, toolId) - 1;
      }
      players[index] = woke;
    } else {
      // @source 0x0041ca60：traffic = 0, ndices = 1
      players[index] = { ...woke, trafficMethod: TRAFFIC_WALK, ndices: 1 };
    }
  }
  if (t.alliedTick) {
    const ally = me.alliedPlayer - 1;
    const delta = -20 * state.priceIndex;
    players = updateHostility(players, index, ally, delta).players;
    players = updateHostility(players, ally, index, delta).players;
  }
  if (t.allianceExpired) players = breakAlliance(players, index);
  return { ...state, players, tools };
}

/**
 * 归约一个 action。
 *
 * @param state 当前状态（不会被修改）
 * @param action 要应用的 action
 * @param topo  地图拓扑（只读）
 */
export function reduce(state: GameState, action: Action, topo: MapTopology): GameState {
  switch (action.type) {
    case 'reseed': {
      // 唯一的非确定性入口，且其值已被记入 action 日志
      return { ...state, rngState: action.seed >>> 0 };
    }

    case 'startTurn': {
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;

      const result = evaluateTurnStart(player);
      const who = turnController(result);

      if (who === 'skip') {
        // 被阻碍或已出局 → 直接进入回合结束（天数递减在 endTurn 处理）
        return { ...state, phase: 'turnEnd' };
      }
      // ★ 時光機的后悔药：真人回合开局先拍一张快照（@source VA 0x004480a0）
      //   电脑的调度步归零（公佈欄那一步挪到了 aiAdvance：原版是买股卖股之后才轮到它）
      let snapped: GameState = { ...snapshotOnTurnStart(state), aiStep: 0, aiBranch: 0 };
      // @source 0x0041cc4b：保險期每日 −1，归零挂 0x80，下一次推进清掉 —— 与阻碍计数同一套
      snapped = withPlayer(snapped, snapped.currentPlayer, (p) => {
        p.insuranceDays = tickBlockingCounter(p.insuranceDays).value;
      });
      // ★ 研究所：只在業主自己的回合推进（@source 0x0041cdc6 `owner == 當前 + 1`），
      //   与其余「回合开始的倒数」在原版是同一个函数（0x0041cc20 一带）。
      snapped = tickOwnResearch(snapped, topo);
      if (result.sleepWalk) {
        // 梦游：原版立即自动掷骰走子，玩家无法干预
        return reduce({ ...snapped, phase: 'awaitingRoll' }, { type: 'rollDice' }, topo);
      }
      return { ...snapped, phase: 'awaitingRoll' };
    }

    case 'setDiceCount': {
      // 只在等掷骰时能改；上限由交通工具定
      if (state.phase !== 'awaitingRoll') return state;
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;
      const max = VEHICLE_DICE.get(player.trafficMethod & 3) ?? 1;
      const count = Math.max(1, Math.min(max, Math.trunc(action.count)));
      if (count === player.ndices) return state;
      return withPlayer(state, state.currentPlayer, (p) => {
        p.ndices = count;
      });
    }

    case 'rollDice': {
      if (state.phase !== 'awaitingRoll') return state;
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;

      const rng = new WatcomRng();
      rng.setState(state.rngState);
      // ★ 遙控骰子留下的点数优先，且**用完即消**
      // @source `0x00447285`：读出来就把 [0x475dd8] 清零
      const forced = state.forcedDice !== 0 ? state.forcedDice : (action.forced ?? 0);
      const { dice, sum } = rollDice(rng, player.ndices, forced);

      return {
        ...state,
        rngState: rng.getState(),
        forcedDice: 0,
        dice,
        stepsRemaining: sum,
        stepsTotal: sum,
        phase: 'moving',
      };
    }

    case 'step': {
      if (state.phase !== 'moving') return state;
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;
      if (state.stepsRemaining <= 0) return { ...state, phase: 'settling' };

      // ★ 岔路**不问玩家**：按原版筛一遍再随机挑（见 `pickNextNode`）。
      //   随机要走 PRNG，所以状态得带回去，否则回放对不上（C-DET-4）。
      const rng = new WatcomRng();
      rng.setState(state.rngState);
      const next = pickNextNode(topo, player.nodeId, player.lastNodeId, rng);
      if (next === null) return { ...state, phase: 'settling' };

      const from = topo.nodes[player.nodeId - 1];
      const to = topo.nodes[next - 1];
      // @source 0x0040d639：朝向由**这一步的位移**求出
      const facing =
        from === undefined || to === undefined
          ? player.direction
          : directionOf(to.x - from.x, to.y - from.y);

      const moved = withPlayer(state, state.currentPlayer, (p) => {
        p.lastNodeId = p.nodeId;
        p.nodeId = next;
        p.direction = facing;
      });
      const remaining = state.stepsRemaining - 1;
      return applyArrival({
        ...moved,
        rngState: rng.getState(),
        stepsRemaining: remaining,
        phase: remaining > 0 ? 'moving' : 'settling',
      }, topo);
    }

    case 'settle': {
      if (state.phase !== 'settling') return state;
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;

      const node = topo.nodes[player.nodeId - 1];
      if (node === undefined) return { ...state, phase: 'turnEnd' };

      // 特殊格优先：原版按 node.flags & 0xff 走 17 路跳表
      if (node.specialKind !== 0) {
        const out = settleSpecialSquare(
          node.specialKind,
          player,
          state.cardAmount,
          state.rngState,
        );
        let next: GameState = { ...state, rngState: out.rngState, phase: 'turnEnd' };
        if (out.pointsDelta !== 0) {
          next = withPlayer(next, state.currentPlayer, (p) => {
            p.points = addPoints(p.points, out.pointsDelta);
          });
        }
        if (out.cardDrawn !== 0) {
          const cardAmount = [...next.cardAmount];
          const at = out.cardDrawn - 1;
          cardAmount[at] = Math.max(0, (cardAmount[at] ?? 0) - 1);
          next = withPlayer({ ...next, cardAmount }, state.currentPlayer, (p) => {
            if (p.cards.length < MAX_HAND_CARDS) p.cards.push(out.cardDrawn);
          });
        }
        // 新聞／命運：抽一张可行的事件并施加其效果
        if (node.specialKind === SPECIAL_KIND.NEWS) return drawAndApplyNews(next, topo);
        if (node.specialKind === SPECIAL_KIND.FORTUNE) return drawAndApplyFortune(next, topo);
        // 魔法屋：两个转盘一转就结算，中间没有玩家决策
        if (node.specialKind === SPECIAL_KIND.MAGIC_HOUSE) return runMagicHouse(next, topo);
        // 小游戏：电脑玩家直接按「不玩」出口结算，真人才挂待决交互
        if (isMinigame(node.specialKind)) return enterMinigame(next, node.specialKind);
        // 探監／探病：同样是电脑自己拿主意、真人才弹窗
        if (
          node.specialKind === SPECIAL_KIND.PRISON ||
          node.specialKind === SPECIAL_KIND.HOSPITAL
        ) {
          return enterVisit(next, topo, node.specialKind);
        }

        // 百貨公司要先抽货架、董事長还有礼 —— 都要随机数，单独走
        if (node.specialKind === SPECIAL_KIND.DEPARTMENT_STORE) return enterShop(next, topo);

        // 樂透投注站：电脑自己匿名买一注就走，真人才开投注屏
        if (node.specialKind === SPECIAL_KIND.LOTTERY) return landOnLottery(next);

        // ★ 銀行：非真人在进柜台之前先按 `cashRatio`(+0x19) 重分現金／存款
        //   （原版 `_rich4_ui_bank_atm_entry` 的 `loc_00437acd` 那一支）。
        //   见 `rebalanceBankOnArrival`。
        if (node.specialKind === SPECIAL_KIND.BANK) next = rebalanceBankOnArrival(next);

        // 其余特殊格：交给「待决交互」机制。
        // ★ 这样每一格都**可达**：已实现的给出具体交互，
        //   未实现的给出一个明确的 unimplemented，而不是静默无事发生。
        return { ...next, pending: pendingForSpecial(next, topo, node.specialKind) };
      }

      const landIndex = landIndexAtPlayer(state, topo);
      if (landIndex === null) {
        // 住宅之外：设施走过路费，上市企业问「买多少股」
        const fac = facilityAtPlayer(state, topo);
        if (fac !== null) return landOnFacility(state, topo, fac);
        if (node.ref.kind === 'commercial') return landOnCompany(state, topo, node);
        return { ...state, phase: 'turnEnd' };
      }

      const land = effectiveLand(state, topo, landIndex);
      if (land === null) return { ...state, phase: 'turnEnd' };

      switch (landingOnLand(land, state.currentPlayer)) {
        case 'unowned': {
          // 买不起或被阻止时直接结束，不给决策机会
          //
          // ★ **两处拦截都要查**：`canPurchase` 查的是土地公那一处
          //   （只挡买无主地），而衰神/大衰神/死神是在 `purchase` 里
          //   拦下所有消费（`call 0x40fa61`）。只查前者的话，会给出一个
          //   `buyLand` 待决交互，然后 `buyLand` 必被 `purchase` 拒掉、
          //   状态原样返回、交互留在那里 —— 玩家点一百次「買下」也没反应。
          const buy = canPurchase(land, player, state.priceIndex);
          if (!buy.ok || purchaseBlockedBy(player) !== null) {
            return { ...state, phase: 'turnEnd' };
          }
          // ★ 价钱由 core 算好放进 `pending`。UI 与联机对端都不该自己再算一遍
          //   ——算第二份规则，迟早两边对不上（C-ARC-2）。
          return {
            ...state,
            phase: 'awaitingDecision',
            pending: { kind: 'buyLand', landId: land.id, name: land.name, price: buy.price },
          };
        }
        case 'own': {
          const up = canUpgrade(land, player, state.priceIndex);
          if (!up.ok || purchaseBlockedBy(player) !== null) {
            return { ...state, phase: 'turnEnd' };
          }
          return {
            ...state,
            phase: 'awaitingDecision',
            pending: { kind: 'upgradeLand', landId: land.id, name: land.name, cost: up.cost },
          };
        }
        case 'other': {
          // 他人地产 → 立即支付过路费。
          // ★ 走 rules/rent.ts：含**同盟分账**、存款级联、破产判定与本月收支累计。
          //   早先这里是裸的 `cash -= toll` / `cash += toll`，四样全缺。
          // ★ 先过 0x41d559 的九种免收（0x00419a8a）：查封／同盟／死神／地主被关着或睡着 → 一分不收
          const landlord = state.players[land.owner - 1];
          if (landlord === undefined || tollExemption(landlord, state.currentPlayer, land.priceStatus) !== null) {
            return { ...state, phase: 'turnEnd' };
          }
          const lands = allEffectiveLands(state, topo);
          // 先算出費额（collectRent 是纯函数，预演一遍只为拿 total）
          const preview = collectRent(state.players, lands, state.currentPlayer, land, state.priceIndex);
          const rng = new WatcomRng();
          rng.setState(state.rngState);
          // ★ 尾巴照 0x00419e36 起：免費卡 → 嫁禍卡 → 死神顯靈由他人賠償
          const tail = tollPassiveTail(state.players, state.currentPlayer, preview.total, state.priceIndex, true, () => rng.next());
          let players = state.players;
          let who = state.currentPlayer;
          if (tail.free) players = players.map((p, i) => (i === who ? consumeCard(p, PASSIVE_CARDS.FREE) : p));
          if (tail.scapegoat !== -1) {
            players = players.map((p, i) => (i === who ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p));
            who = tail.scapegoat;
          }
          const total = tail.free ? 0 : preview.total;
          if (total !== 0) {
            const reaper = reaperPayer(players, who);
            if (reaper !== -1) who = reaper;
          }
          const withRng: GameState = { ...state, players, rngState: rng.getState() };
          if (total === 0) {
            // @source 免費卡抹成 0 后不付；0x0041a00b 仍记这一笔 = 0
            const landLastToll = [...withRng.landLastToll];
            landLastToll[land.id] = 0;
            return { ...withRng, landLastToll, phase: 'turnEnd' };
          }
          const out = collectRent(players, lands, who, land, state.priceIndex);
          // @source 0x0041a00b `mov [land + 0x2c], ebp` —— 记下这一笔（間諜要用）
          const landLastToll = [...withRng.landLastToll];
          landLastToll[land.id] = out.total;
          const paid: GameState = { ...withRng, players: out.players, landLastToll, phase: 'turnEnd' };
          // ★ 付不起就破产——这是对局能真正结束的唯一途径
          return out.bankrupted ? applyBankruptcy(paid, who, topo) : paid;
        }
      }
    }

    case 'buyLand': {
      // ★ 必须是**落点**留下的那一个交互：`buyLand` 只在
      //   `_rich4_handle_player_land_on_node` 的地块分支里问（0x0041a013）。
      //   只查 phase 是不够的 —— `awaitingDecision` 是**所有**待决交互共用的阶段
      //   （買設施/加蓋/研究所/拍賣卡挂出的拍賣…）。漏了 `pending.kind`，
      //   就等于允许「拿买地去顶掉别人那个待决交互」：卡片/道具/命運改建筑
      //   各有各的路，不该从这条缝里挤进来。
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'buyLand') return state;
      const player = state.players[state.currentPlayer];
      const landIndex = landIndexAtPlayer(state, topo);
      if (player === undefined || landIndex === null) return state;
      const land = effectiveLand(state, topo, landIndex);
      if (land === null) return state;

      const check = canPurchase(land, player, state.priceIndex);
      if (!check.ok) return state;

      // ★ 走 rules/purchase.ts：只扣现金、不动存款、不触发破产，
      //   并补上 `call 0x40fa61` 的衰神/死神拦截（canPurchase 查的是另一处，
      //   即 loc_0041a013 对土地公的判定，两者并存）。
      const bought = purchase(player, check.price);
      if (!bought.ok) return state;
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const landOwner = [...paid.landOwner];
      landOwner[landIndex] = state.currentPlayer + 1;
      // @source 0x0041a108：土地權限非無限期时写到期日（flast）
      const landTenure = [...paid.landTenure];
      landTenure[landIndex] = tenureExpiry(packDate(state), state.landTenureIndex);
      return { ...paid, landOwner, landTenure, pending: null, phase: 'turnEnd' };
    }

    // ── 設施：買 / 首建（选种类）/ 加蓋 ──
    // @source 0x0041a86b / 0x0041a1f2 / 0x0041a2b3，三条各自查一遍衰神拦截
    case 'buyFacility': {
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'buyFacility') return state;
      const player = state.players[state.currentPlayer];
      const fac = facilityAtPlayer(state, topo);
      if (player === undefined || fac === null || fac.owner !== 0) return state;
      const bought = purchase(player, facilityBuyPrice(fac.landPrice, state.priceIndex));
      if (!bought.ok) return state;
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const facilityOwner = [...paid.facilityOwner];
      facilityOwner[fac.id] = state.currentPlayer + 1;
      // @source 0x0041a978 `mov [設施 + 0x34], eax`
      const facilityTenure = [...paid.facilityTenure];
      facilityTenure[fac.id] = tenureExpiry(packDate(state), state.landTenureIndex);
      return { ...paid, facilityOwner, facilityTenure, pending: null, phase: 'turnEnd' };
    }

    case 'buildFacility': {
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'buildFacility') return state;
      const player = state.players[state.currentPlayer];
      const fac = facilityAtPlayer(state, topo);
      if (player === undefined || fac === null) return state;
      if (fac.owner !== state.currentPlayer + 1 || fac.level !== 0) return state;
      if (!state.pending.choices.includes(action.facilityType)) return state;
      const bought = purchase(player, facilityBuildPrice(fac.landPrice, state.priceIndex));
      if (!bought.ok) return state;
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const facilityType = [...paid.facilityType];
      const facilityLevel = [...paid.facilityLevel];
      facilityType[fac.id] = action.facilityType;
      facilityLevel[fac.id] = 1;
      return { ...paid, facilityType, facilityLevel, pending: null, phase: 'turnEnd' };
    }

    case 'research': {
      // 落点收尾的研究所面板（pending research）；真人也可随时点自己的研究所（P2-14 的入口）
      const fromPanel = state.pending?.kind === 'research';
      if (fromPanel && state.pending?.kind === 'research' && state.pending.facilityId !== action.facilityId) return state;
      const player = state.players[state.currentPlayer];
      if (player === undefined || !isAlive(player)) return state;
      const fac = effectiveFacility(state, topo, action.facilityId);
      if (fac === null || fac.type !== FACILITY_TYPE.lab) return state;
      if (fac.owner !== state.currentPlayer + 1) return state;
      // @source 0x0041cdb3 `test cl, cl / je` —— 正在研發就不再接新的
      if ((state.facilityResearchDays[fac.id] ?? 0) !== 0) return state;
      const started = startResearch(action.project, fac.level);
      if (started === null) return state;
      const facilityResearchProject = [...state.facilityResearchProject];
      const facilityResearchDays = [...state.facilityResearchDays];
      facilityResearchProject[fac.id] = started.project;
      facilityResearchDays[fac.id] = started.daysLeft;
      const next: GameState = { ...state, facilityResearchProject, facilityResearchDays };
      return fromPanel ? { ...next, pending: null, phase: 'turnEnd' } : next;
    }

    case 'buildTarget': {
      if (state.pending?.kind !== 'chooseBuildTarget') return state;
      const pend = state.pending;
      if (!pend.choices.includes(action.entityId)) return state;
      const built = freeBuildEntity(state, topo, action.entityId, -1);
      if (built === null) return state;
      let next: GameState = { ...built, pending: null };
      if (pend.charge) {
        // @source 0x0041adc0：工程費 = 那处地的地價 × 物價，付给公司
        const fee = entityLandPrice(next, topo, action.entityId) * next.priceIndex;
        next = payCompany(next, topo, state.currentPlayer, pend.commercialId, fee);
        if (next.phase === 'gameOver') return next;
        if (!isAlive(next.players[state.currentPlayer]!)) return { ...next, phase: 'turnEnd', pending: null };
      }
      return afterCompany(next, topo, pend.commercialId);
    }

    case 'upgradeFacility': {
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'upgradeFacility') return state;
      const player = state.players[state.currentPlayer];
      const fac = facilityAtPlayer(state, topo);
      if (player === undefined || fac === null) return state;
      if (fac.owner !== state.currentPlayer + 1 || fac.level === 0) return state;
      if (!canUpgradeFacility(fac.type, fac.level)) return state;
      const bought = purchase(player, facilityUpgradePrice(fac.housePrice, state.priceIndex));
      if (!bought.ok) return state;
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const facilityLevel = [...paid.facilityLevel];
      facilityLevel[fac.id] = fac.level + 1;
      return afterOwnLab({ ...paid, facilityLevel, pending: null, phase: 'turnEnd' }, topo, fac.id);
    }

    case 'upgradeLand': {
      // 同 `buyLand`：加蓋只由落点（0x004198b9 自有地分支）问出来，
      // 必须**就是这个交互**，不能是别的 pending 顺手顶掉。
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'upgradeLand') return state;
      const player = state.players[state.currentPlayer];
      const landIndex = landIndexAtPlayer(state, topo);
      if (player === undefined || landIndex === null) return state;
      const land = effectiveLand(state, topo, landIndex);
      if (land === null) return state;

      const check = canUpgrade(land, player, state.priceIndex);
      if (!check.ok) return state;

      const built = purchase(player, check.cost);
      if (!built.ok) return state;
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = built.player.cash;
      });
      const landLevel = [...paid.landLevel];
      landLevel[landIndex] = land.level + 1;
      return { ...paid, landLevel, pending: null, phase: 'turnEnd' };
    }

    case 'buyStock':
    case 'sellStock': {
      const traded = tradeStock(state, action);
      // @source 0x0042d0a2：還款壓力下賣完一支若 現金+存款 仍 < 貸款×1.1，就回头再賣 —— 调度步停在 1
      const seller = traded.players[state.currentPlayer];
      const keepSelling =
        action.type === 'sellStock' && seller !== undefined && loanSellPressure(seller, traded) && loanStillUncovered(seller);
      return afterAiStep(state, traded, topo, action.type === 'buyStock' ? 1 : keepSelling ? 1 : 2);
    }

    case 'aiNext': {
      // @source 0x00418dc6 的顺序：策略层在某一步没事可做就发它把步数推进
      if (state.phase !== 'awaitingRoll') return state;
      const me = state.players[state.currentPlayer];
      if (me === undefined || !isAiControlled(me)) return state;
      return aiAdvance(state, topo, state.aiStep + 1);
    }

    case 'buyShares':
      return buySharesFromCommercial(state, action.shares);

    case 'useCard':
      return afterAiStep(state, playCard(state, topo, action.cardId, action.target ?? { kind: 'none' }), topo, 3);

    case 'useTool':
      return afterAiStep(state, useToolAction(state, topo, action.toolId, action.nodeId ?? 0, action.value ?? 0), topo, 3);

    case 'shop':
      return shopAction(state, action);

    case 'noticeBoard':
      return noticeBoardAction(state, topo, action);

    case 'declineDecision': {
      // ★ 「不了」对**任何**待决交互都合法（rules/interaction.ts 的
      //   `responseMatches` 第一句就是这个），故不只在 awaitingDecision 生效：
      //   银行、樂透、百貨这些柜台也得有办法关门走人。
      if (state.phase === 'awaitingDecision') {
        const done: GameState = { ...state, pending: null, phase: 'turnEnd' };
        // 不加蓋也照样走到落点收尾：自己的研究所要问研發（0x0041b0b3）
        return state.pending?.kind === 'upgradeFacility' ? afterOwnLab(done, topo, state.pending.facilityId) : done;
      }
      return state.pending === null ? state : { ...state, pending: null, phase: 'turnEnd' };
    }

    case 'bank': {
      if (state.pending === null || state.pending.kind !== 'bank') return state;
      const me = state.players[state.currentPlayer];
      if (me === undefined || !isAlive(me)) return state;
      const wealth = state.pending.wealth;
      let next: Player;
      switch (action.op) {
        case 'deposit':
          next = deposit(me, action.amount);
          break;
        case 'withdraw':
          next = withdraw(me, action.amount);
          break;
        case 'borrow':
          next = borrow(me, action.amount, wealth).player;
          break;
        case 'repay':
          next = repay(me, action.amount);
          break;
        // ★ 特別融資：只有董事長能用，且**不进 loan**，与一般貸款两笔账
        case 'financeBorrow': {
          if (state.pending.specialFinance === null) return state;
          const r = borrowSpecial(state.players, state.currentPlayer, action.amount);
          if (r === null || r.error !== null) return state;
          next = r.player;
          break;
        }
        case 'financeRepay': {
          if (state.pending.specialFinance === null) return state;
          const r = repaySpecial(state.players, state.currentPlayer, action.amount);
          // @source 「您的現金不足」—— 柜台不关，什么也不改
          if (r === null || r.error !== null) return state;
          next = r.player;
          break;
        }
        default:
          return state;
      }
      // 没成交就当没按 —— 但柜台还开着，别把 pending 清掉
      if (next === me) return state;
      const after: GameState = {
        ...state,
        players: state.players.map((p, i) => (i === state.currentPlayer ? next : p)),
      };
      // ★ 取款会让「客戶存款總額」变小，可能跌破董事長的已融資额度 ——
      //   原版就是在取款之后立刻查一次（@source VA 0x0043784d `push 1`）。
      const settled = action.op === 'withdraw' ? settleBankReserve(after, topo) : after;

      // 刷新柜台上显示的数字（额度会随贷款与融资变）
      return {
        ...settled,
        pending: {
          kind: 'bank',
          wealth,
          loanCapacity: loanCapacity(wealth, next.loan),
          specialFinance: specialFinanceOf(settled, topo, state.currentPlayer),
        },
      };
    }

    case 'lottery': {
      if (state.pending === null || state.pending.kind !== 'lottery') return state;
      const me = state.players[state.currentPlayer];
      if (me === undefined || !isAlive(me)) return state;
      const r = buyTicket(me, state.lottery, action.number);
      if (!r.ok) return state;
      return {
        ...state,
        players: state.players.map((p, i) => (i === state.currentPlayer ? r.player : p)),
        lottery: r.lottery,
        // ★ 票钱进公库 —— 买票既是投注也是在给奖池添柴
        pool: state.pool + r.toPool,
        // ★ 买完就收摊 —— 原版买中的那一下紧接着 `PostMessage(hwnd, 0x406, 3, 0)`
        //   （VA 0x0042ffd1 那段），投注屏随即自行关闭；想再买得下次踩到这一格。
        pending: null,
      };
    }

    /**
     * 拍賣的**一口价** @source 拍賣窗口刷新循环 VA 0x0043c4f5 一带 +
     *   终局判据 `loc_0043b295` VA 0x0043b295。
     *
     * 一个 action 走一口：更新现价/座位状态 → 复查「还剩几个能出价的」
     * → 该收尾时按 `auctionOutcome` 落槌（结算沿用既有终局形状）。
     *
     * ★ 校验三条，任一不过就原样返回（保证 AI/屏重提也不会把状态搞乱）：
     *   1. `pending` 确实在等这一场拍卖；
     *   2. `bidder` 就是 `pending.seat` 上那一位（轮到你才能出价）——
     *      ⚠️ **不要求 `bidder === currentPlayer`**：原版的竞价轮转与
     *      `currentPlayer` 无关（整场拍卖挂在出卡人那个回合里，四家轮流举牌）；
     *   3. 加价的那一口出得起（`现价 + step <= 现金`）——
     *      原版真人那一支是 `cmp / jg 不理会`（0x43a478），电脑那一支由
     *      心理价位夹住现金（0x43a131）；这里统一把关，杜绝负现金。
     */
    case 'auctionBid': {
      // ★ 只认**完整**的拍賣 pending（带 seat/status/limits 那一支）——
      //   卡片刚挂出来的「开拍请求」不可能在这一刻被答（reduce 挂出来时就补全了）
      const pending = state.pending;
      if (pending === null || pending.kind !== 'auction') return state;
      if (!('seat' in pending)) return state;
      const bidder = pending.bidders[pending.seat];
      if (bidder === undefined || bidder !== action.bidder) return state;
      if ((pending.status[bidder] ?? 'active') !== 'active') return state;
      const me = state.players[bidder];
      if (me === undefined || me.whoPlays === 0) return state;

      const raising = action.status === 'raise';
      if (raising && (action.step <= 0 || !auctionCanAfford(pending.price, action.step, me.cash))) {
        return state;
      }

      const status: AuctionSeatStatus[] = [...pending.status];
      let price = pending.price;
      let top = pending.top;
      let topCash = pending.topCash;
      if (raising) {
        // @source 0x43a552 `mov [0x48c488], eax` —— 现价 += 档位
        price = pending.price + action.step;
        top = bidder;
        // @source loc_0043b183 的压价线要的是「最高者出价时的现金」
        topCash = me.cash;
      } else {
        // @source PASS 0x43a426 写 1 / 放棄 0x43a43a 写 4 —— 两者都**永久**
        //   把这一位踢出竞价（全文件没有一处写回 0）
        status[bidder] = action.status === 'giveUp' ? 'givenUp' : 'passed';
      }

      const after = { ...pending, price, top, topCash, status };
      if (!auctionFinished(after)) {
        return {
          ...state,
          pending: {
            ...after,
            // ★ 也要跳过卖家（原版卖家状态 7，绕圈一并跳）——见 `auctionAdvanceSeat`
            seat: auctionAdvanceSeat(after.bidders, status, pending.seat, pending.seller ?? -1),
          },
        };
      }
      return settleAuctionPending(state, topo, after as AuctionPending);
    }

    case 'auction': {
      // ★ 终局形状的兼容入口（Q-AUC-1 之前由表现层发）。现在 core 自己会落槌，
      //   但存档/联机/既有测试仍可能送进这一条，照旧处理：
      //   winner/price 由 action 明说，不依赖 pending 里的竞价进度。
      const pending = state.pending;
      if (pending === null || pending.kind !== 'auction') return state;
      return settleAuctionExplicit(state, topo, pending, action.winner, action.price);
    }

    case 'bail': {
      if (state.pending === null || state.pending.kind !== 'bail') return state;
      const place = state.pending.place;
      const occ = place === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
      const r = applyBail(state.players, occ, place, state.currentPlayer, action.slot);
      if (!r.ok) return { ...state, pending: null, phase: 'turnEnd' };
      let paid: GameState = { ...state, players: r.players, pending: null, phase: 'turnEnd' };

      // ★ 保釋的若是 NPC（槽 4..7），他会**当场上路** —— 从監獄/醫院那一格
      //   起步走 rand()%9+2 步，主人记成保釋他的人。
      //   @source 0x0043d7e0（出獄）/ 0x0043ee8f（出院），两段同构。
      let occupancy = r.occupancy;
      const slotIdx = specialSlotOf(action.slot);
      if (slotIdx >= 0) {
        const gate = gateNodeOf(topo, place);
        if (gate > 0) {
          const rng = new WatcomRng();
          rng.setState(paid.rngState);
          const npc = releaseNpc(gate, state.currentPlayer, npcSteps(rng));

          // ★ 放出来就**立刻上路** —— 原版把 [0x49910c] 切成 4..7 走完再切回，
          //   期间没有玩家输入，所以对 core 来说这就是同一个动作（与機器娃娃同理）。
          const walk = runNpc(
            action.slot,
            npc,
            paid,
            topo,
            (from, prev) => pickNextNode(topo, from, prev, rng) ?? 0,
            rng,
          );
          const settled = applyNpcEvents(paid, npc.owner, walk.events);

          const specialActors = [...paid.specialActors];
          specialActors[slotIdx] = walk.actor;
          // ★ 保釋当场那一趟也交给表现层（纯表现提示，覆写；见 GameState.lastNpcWalks）
          paid = {
            ...settled.state,
            specialActors,
            rngState: rng.getState(),
            lastNpcWalks: [{ slot: slotIdx, path: walk.path }],
          };

          // 半路又被收回去了 —— 占用表要跟着改（可能换了一张表）
          const home = walk.events.find((e) => e.kind === 'home');
          if (home !== undefined) {
            const back = [...(home.place === 'prison' ? paid.prisonOccupancy : paid.hospitalOccupancy)];
            back[action.slot] = 1;
            paid = home.place === 'prison'
              ? { ...paid, prisonOccupancy: back }
              : { ...paid, hospitalOccupancy: back };
            // 他是从**另一处**被保釋出来的，原表那一格已经清了，不要再写回去
            if (home.place !== place) occupancy = r.occupancy;
          }

          // 被榨破产的人逐个收口 —— 与过路费同一条路
          let after: GameState = place === 'prison'
            ? { ...paid, prisonOccupancy: home?.place === 'prison' ? paid.prisonOccupancy : occupancy }
            : { ...paid, hospitalOccupancy: home?.place === 'hospital' ? paid.hospitalOccupancy : occupancy };
          for (const who of settled.bankrupted) after = applyBankruptcy(after, who, topo);
          return after;
        }
      }

      return place === 'prison'
        ? { ...paid, prisonOccupancy: occupancy }
        : { ...paid, hospitalOccupancy: occupancy };
    }

    case 'minigame': {
      if (state.pending === null || state.pending.kind !== 'minigame') return state;
      return settleMinigame({ ...state, pending: null }, action.score);
    }

    case 'setAi': {
      // 託管设置：五个字段都可选，给哪个改哪个（见 actions.ts 的注释）。
      // ★ 任一字段越界就**整条拒绝**，不做「部分生效」——半个设置生效比不改更糟：
      //   玩家按了確定、屏上显示的和实际存的不一致，而错的那半要到对局里才显形。
      const target = state.players[action.player];
      if (target === undefined || !isAlive(target)) return state;
      if (!isValidAiSetting(action)) return state;

      const next = {
        whoPlays: action.whoPlays ?? target.whoPlays,
        aiFlags: action.aiFlags ?? target.aiFlags,
        personality: action.personality ?? target.personality,
        cashRatio: action.cashRatio ?? target.cashRatio,
        stockRatio: action.stockRatio ?? target.stockRatio,
      };
      // 值没变就别造新对象 —— reduce 靠 `===` 判断「拒绝」，同值返回原 state
      const same =
        next.whoPlays === target.whoPlays &&
        next.aiFlags === target.aiFlags &&
        next.personality === target.personality &&
        next.cashRatio === target.cashRatio &&
        next.stockRatio === target.stockRatio;
      if (same) return state;

      return withPlayer(state, action.player, (p) => {
        p.whoPlays = next.whoPlays;
        p.aiFlags = next.aiFlags;
        p.personality = next.personality;
        p.cashRatio = next.cashRatio;
        p.stockRatio = next.stockRatio;
      });
    }

    /**
     * 回合边界的**一个**惡人走一趟（T-047 串行化）。
     *
     * 与 `endTurn` 一样是引擎自行推进的那一类（见 `autoAction`）：没有任何
     * 选择余地。合法条件 = 相位 `turnEnd` 且 `pendingNpcSlots` 非空；
     * 其余情况原样返回（幂等，重复派不会多走）。
     *
     * @source `rich4.asm:11766-11832`：游标 4..7 逐个停一次，走完最后一个
     *   （游标到 8、`ebx = 1`）才 `call 0x41cf67` 推日期。
     */
    /**
     * 設定屏「日期更改」—— 改**当前游戏日期**（原版 `RICH4.CFG+8`）。
     * 见 `actions.ts` 的注释（逐条 VA）。
     */
    case 'setDate': {
      const { year, month, day } = action;
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return state;
      if (month < 1 || month > 12) return state;
      // 日的上限按**那个月**算（闰年 2 月 29）
      if (day < 1 || day > daysInMonth(year, month)) return state;
      if (year === state.year && month === state.month && day === state.day) return state;
      // ⚠️ 只改这三个字段 —— 原版不碰 `totalDays` / `totalMonths`
      return { ...state, year, month, day };
    }

    case 'npcStep': {
      if (state.phase !== 'turnEnd') return state;
      if ((state.pendingNpcSlots ?? []).length === 0) return state;
      // 下一位玩家 = 当前玩家之后的第一个在场者（`endTurn` 里那一条同源）
      return npcRoundStep(state, topo, nextAlivePlayer(state, state.currentPlayer));
    }

    case 'endTurn': {
      if (state.phase !== 'turnEnd') return state;
      // ★ 惡人段没走完之前不许 `endTurn`：那会把同一輪的惡人再走一遍
      //   （计数被 tick 两次、`lastNpcWalks` 被覆写成第二批）。这段时间属于
      //   `npcStep` —— 见 `npcRoundStep` 与 `autoAction` 的注释（D-T047-5）。
      if ((state.pendingNpcSlots ?? []).length > 0) return state;

      // 递减当前玩家的阻碍计数。
      // ★ 时机已查清（原 TODO）：`00419039 call 0x41c84f`，参数是
      //   `[0x49910c]` 即**当前玩家**，就在回合边界——与此处一致。
      // ★ 语义见 rules/blocking.ts：减到 0 时**挂 0x80 而非清零**，
      //   下一次推进才执行释放流程。先前「保留高位、只减低 7 位」是错的。
      const blocked = tickDailyCounters(
        withPlayer(state, state.currentPlayer, (p) => {
          p.blocking = tickBlocking(p.blocking).blocking;
        }),
        state.currentPlayer,
      );

      // ★ 神明的任期也在这里走一天 —— 原版就紧挨着阻碍计数
      //   （tick_blocking @ 0x41c8d5，神明 @ 0x41cc6c，同一个函数）。
      //   附身写的 7（死神 13）是天数，减到 0 神明自己走人，搭档登场。
      const g = tickGod(blocked, state.currentPlayer);
      const ticked = respawnPartner(
        { ...blocked, players: g.players, objects: g.objects, tools: g.tools, toolStock: g.toolStock },
        topo,
        g.respawn,
      );

      // ★ 物价指数在回合边界采样一次。
      //   @source `00419033 call 0x41cf67`（推进日期）之后
      //   `0041cfbf call 0x423acf`（更新物价指数），每回合一次。
      //   它**只增不减**，是后期通货膨胀的唯一来源——不接这条，
      //   经济永远不会升温，租金永远追不上身家。
      //   ⚠️ 采样本身现在在 `advanceGameDay` 内部（原版就在这里，
      //     且在勝負判定**之后**）—— 达标那天不再更新物价指数。
      const next = nextAlivePlayer(ticked, state.currentPlayer);
      // ★ **一輪才是一天** @source 0x00418f93..0x0041902e：cur++ 越过最后一名玩家后先依次轮到
      //   棋盘上的四大惡人（4..7，+10 == 0 的才算）**各走一趟**，回到 0 号时 ebx = 1，
      //   这时才 `call 0x41cf67`（推进日期、物价指数、行情、開獎、月結）。
      //   先前每个玩家回合都推一天、都更新物价，是错的（见 known-deviations「一輪一天」）。
      const wraps = next <= state.currentPlayer;
      if (wraps) {
        // ★ 惡人段**逐个**走（T-047 的 D-T047-5，2026-09-16）：
        //   先把「这一輪还有哪些惡人」记进相位，然后当场走**第一个**；
        //   队列还非空就停在 `turnEnd` 等 `npcStep`（表现层据此一趟一趟播），
        //   走完最后一个才由 `npcRoundStep` 推日期并轮到下一位玩家。
        //   原版 `[0x49910c]` 那条游标就是逐个停的（`rich4.asm:11766-11832`）。
        const queue = activeNpcSlots(ticked);
        if (queue.length > 0) {
          const first = npcRoundStep({ ...ticked, pendingNpcSlots: queue }, topo, next);
          if (first.phase === 'gameOver') return first;
          // 还有惡人没走 —— 停在 turnEnd，等 `npcStep`；**不**换玩家、**不**推日期
          if ((first.pendingNpcSlots ?? []).length > 0) {
            return { ...first, phase: 'turnEnd', pending: null };
          }
          // 一轮的惡人已经走完（`npcRoundStep` 已推日期并轮到下一位玩家）
          return first;
        }
        // 没有惡人在盘上 —— 照旧直接推日期
        const roundEnd = advanceGameDay({ ...ticked, pendingNpcSlots: [] }, topo);
        // ★ 勝利條件（遊戲時間／勝利條件）达标 → 当天就结束，不再进下一回合。
        //   @source 0x0041cfb1 `call 0x41d89e` / 0x0041cfb9 `je 0x41d1a5`
        if (roundEnd.phase === 'gameOver') return roundEnd;
        return {
          ...roundEnd,
          currentPlayer: next,
          phase: 'turnStart',
          pending: null,
          dice: [],
          stepsRemaining: 0,
          stepsTotal: 0,
          turnCount: state.turnCount + 1,
        };
      }
      return {
        ...ticked,
        pendingNpcSlots: [],
        currentPlayer: next,
        phase: 'turnStart',
        // ★ 待决交互属于**那个玩家的那个回合**，不能带进下一回合。
        //   商店这类模态窗口尤其明显：不清掉，下家一上来就站在别人的柜台前。
        pending: null,
        dice: [],
        stepsRemaining: 0,
        stepsTotal: 0,
        turnCount: state.turnCount + 1,
      };
    }
  }
}

/**
 * 买卖股票。
 *
 * ★ 交易走的是「柜台」路径（`market`）：买入**从存款扣**、卖出**进存款**
 *   （@source `sub dword [player+32], eax` / `add dword [player+32], eax`），
 *   与地图上的上市企业买入（从现金扣）是两回事。
 *
 * ⚠️ 不做任何「该不该买」的判断——那是策略。这里只拦**不合法**的：
 *   下标越界、股数非正、可流通股不够、钱不够、持股不够。
 *   原版 UI 在按钮层面就不让你越界，故这些检查在原版里体现为
 *   界面约束而非函数内的分支；本引擎必须自己兜住，否则
 *   一个构造出来的网络消息就能凭空造钱。
 */
/**
 * 站在这一格上的物件 handle（下标 + 1）；0 表示这格没有物件。
 *
 * ⚠️ 判定条件是 **`nodeId` 相同且 `attached === 0`**。
 *   已经附身或被人带着走的物件，`nodeId` 会跟着主人跑
 *   （`attach_object` 明写 `objects[i].nodeId = player.nodeId`），
 *   光比 `nodeId` 会把别人身上的財神当成地上的財神再踩一次。
 *   原版靠地图格里那一字节（node +0x26）区分，附身时会把它抹掉。
 */
function objectHandleAt(state: GameState, nodeId: number): number {
  for (let i = 0; i < state.objects.length; i++) {
    const o = state.objects[i];
    if (o !== undefined && o.nodeId === nodeId && o.attached === 0) return i + 1;
  }
  return 0;
}

/**
 * 踩到破产者的棋子 —— 施捨一笔，然后他换个地方待着。
 *
 * @source VA 0x0041b5fd，见 `rules/beggar.ts`。
 *
 * ⚠️ 乞丐的新位置由 `0x40cc56` → `pick_object_node(原节点)` 挑，
 *   带**离原地至少 300 像素**的重抽条件，本引擎未接（Q-OBJ-2）。
 */
function giveAlmsIfBeggar(state: GameState, topo: MapTopology, nodeId: number): GameState {
  // @source cmp dword [0x48baf8], 0 / jne 跳过 —— 路过不算
  if (state.stepsRemaining > 0) return state;
  const who = beggarAt(state.players, nodeId, state.currentPlayer);
  if (who < 0) return state;

  const amount = almsAmount(state.priceIndex);
  // @source pay_money(我, -1, 金额, 0) —— 收款方 -1 即公库
  const r = transferMoney(state.players, [], state.pool, state.currentPlayer, -1, amount, 0);

  // @source call 0x40cc56 —— 清掉原格的占位，再挑一格把乞丐挪过去
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const spots = objectNodeCandidates(topo.nodes).filter((n) => n !== nodeId);
  // ★ 走**远距**那一支：原版 `fcn_0040cc56` 把玩家当前节点当参照点传给
  //   `_rich4_find_random_unoccupied_distant_node`（`rich4.asm:6843` 的 `push eax`）
  //   —— 刚被施捨过的那一格不该立刻又冒出乞丐。
  const moved = pickObjectNodeDistant(spots, nodeId, nodeXyOf(topo), () => rng.next());

  const players = r.players.map((p, i) =>
    i === who && moved !== 0 ? { ...p, lastNodeId: p.nodeId, nodeId: moved } : p,
  );
  const paid: GameState = { ...state, players, pool: r.pool, rngState: rng.getState() };
  // 施捨也可能把自己掏空 —— 与过路费同一条收口
  return r.bankrupted ? applyBankruptcy(paid, state.currentPlayer, topo) : paid;
}

/**
 * 走到一格之后的物件结算。
 *
 * ★ 原版这一整套跑在**每走一格**的处理函数里（VA 0x0041b440），
 *   不是回合末。故这里挂在 `step` / `chooseDirection` 之后，
 *   而不是 `settle` —— 路障要能在半途拦人，定時炸彈的引信
 *   要按**格**走，这两件事都做不到「等落点再说」。
 *
 * ⚠️ 随机数只在**禮物真的抽到东西**时才推进，见 `randConsumed`。
 */
function applyArrival(state: GameState, topo: MapTopology): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;

  // ★ 物件派发**之前**先过一遍乞丐（原版顺序，VA 0x0041b5fd）
  const afterAlms = giveAlmsIfBeggar(state, topo, me.nodeId);
  // 施捨把自己掏破产了 —— 物件那一步不必再走
  if (afterAlms.phase === 'gameOver' || !isAlive(afterAlms.players[state.currentPlayer]!)) {
    return afterAlms;
  }

  const handle = objectHandleAt(afterAlms, me.nodeId);
  // 身上没炸彈、脚下也没东西 → 这一格什么都不会发生，连状态都不必重建
  if (handle === 0 && me.f64 === 0) return afterAlms;

  const node = topo.nodes[me.nodeId - 1];
  const landIdx = node === undefined ? null : housingIndexOf(node.type);
  const land = landIdx === null ? null : effectiveLand(afterAlms, topo, landIdx);

  // 预支一个随机数；没用掉就不推进（C-DET-4）
  const rng = new WatcomRng();
  rng.setState(afterAlms.rngState);
  const randValue = rng.next();

  const r = resolveArrival({
    world: afterAlms,
    playerIndex: afterAlms.currentPlayer,
    handle,
    landId: land === null ? 0 : land.id,
    stepsRemaining: afterAlms.stepsRemaining,
    othersHere: afterAlms.players
      .filter((p) => p.index !== me.index && isAlive(p) && p.nodeId === me.nodeId)
      .map((p) => p.index),
    randValue,
  });

  let next: GameState = {
    ...afterAlms,
    players: r.players,
    objects: r.objects,
    tools: r.tools,
    toolStock: r.toolStock,
    rngState: r.randConsumed ? rng.getState() : afterAlms.rngState,
  };

  // 路障／惡犬／地雷／爆炸都会把人钉在原地
  if (r.stopMovement) {
    next = { ...next, stepsRemaining: 0, phase: 'settling' };
  }

  // 炸彈把脚下的建筑降一级（連鎖店直接夷平退回住宅）
  // @source `0x40ab4a(landId, 0)`，与拆除卡同一套，见 rules/land-mutation.ts
  if (r.demolishLand !== 0 && land !== null) {
    const d = demolishLand(land, state.priceIndex);
    const landLevel = [...next.landLevel];
    landLevel[land.id] = d.land.level;
    next = { ...next, landLevel };
  }

  // 住院
  if (r.hospitalDays !== 0) {
    const c = confine(next.players, next.hospitalOccupancy, 'hospital', me.index, r.hospitalDays);
    next = insureConfinement({ ...next, players: c.players, hospitalOccupancy: c.occupancy }, topo, me.index, r.hospitalDays);
  }

  // 神明离场后，搭档换上来
  return respawnPartner(next, topo, r.respawn);
}

/**
 * 让离场神明的搭档重新登场。
 *
 * @source `release_object` 尾部 `place_object(搭档+1, pick_node(原节点), 0, 0)`
 *   （VA 0x0040e297）。
 *
 * ⚠️ 原版的 `pick_node` 传了**参照节点**，会一直重抽直到新位置与原位置
 *   在 x、y 上都相距 ≥ 300（VA 0x0040ab22）。本引擎没有接那层重抽，
 *   只抽一次——随机数消耗因此与原版不同（Q-OBJ-2）。
 *   但「搭档必须登场」这件事本身不能省：不接它，地图上的神明
 *   被踩一个少一个，长局跑到后面一个物件都不剩。
 */
/** 节点号 → 世界坐标；取不到给 null（`pickObjectNodeDistant` 的出口）*/
function nodeXyOf(
  topo: MapTopology,
): (nodeId: number) => { x: number; y: number } | null {
  return (id) => {
    const n = topo.nodes[id - 1];
    return n === undefined ? null : { x: n.x, y: n.y };
  };
}

function respawnPartner(
  state: GameState,
  topo: MapTopology,
  respawn: { partner: number; nearNode: number } | null,
): GameState {
  if (respawn === null) return state;
  const objects = state.objects.map((o) => ({ ...o }));
  const partner = objects[respawn.partner];
  if (partner === undefined || partner.nodeId !== 0 || partner.attached !== 0) return state;

  // 别叠在已有物件上——原版靠节点 flags 的运行时占用位，本引擎反查物件表
  const taken = new Set(
    objects.filter((o) => o.nodeId !== 0 && o.attached === 0).map((o) => o.nodeId),
  );
  const spots = objectNodeCandidates(topo.nodes).filter((n) => !taken.has(n));
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const node = pickObjectNodeDistant(spots, respawn.nearNode, nodeXyOf(topo), () => rng.next());
  if (node === 0) return state;

  partner.nodeId = node;
  return { ...state, objects, rngState: rng.getState() };
}

/**
 * 魔法屋 —— 转两个转盘，然后对被点到的人逐一施加效果。
 *
 * ★ 它**不是待决交互**：原版两个转盘都是自己转的（`rand()`），
 *   玩家一次也插不上手，所以按即时结算处理，与新聞/命運同类。
 *
 * @source 转盘 VA 0x0043390b，效果派发 0x00431caa。见 places/magic-house.ts。
 */
function runMagicHouse(state: GameState, topo: MapTopology): GameState {
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const lands = allEffectiveLands(state, topo);
  const facilities = allEffectiveFacilities(state, topo);

  const owns = (playerIndex: number, needDeveloped: boolean): number => {
    let n = 0;
    // @source 先扫地块表再扫设施表，两者都比 `owner == p + 1`
    for (const l of lands) {
      if (l.owner !== playerIndex + 1) continue;
      if (needDeveloped && l.level === 0) continue;
      n++;
    }
    for (const f of facilities) {
      if (f.owner !== playerIndex + 1) continue;
      if (needDeveloped && f.level === 0) continue;
      n++;
    }
    return n;
  };

  const targetCtx = {
    players: state.players,
    landCountOf: (i: number) => owns(i, false),
    houseCountOf: (i: number) => owns(i, true),
    wealthOf: (i: number) => {
      const p = state.players[i];
      if (p === undefined) return 0;
      return calculatePlayerWealth(p, lands, facilities, valuationsOf(state, i));
    },
  };

  const spin = spinMagicHouse(targetCtx, state.currentPlayer, () => rng.next());

  const nodeOf = (playerIndex: number): MagicNodeInfo | null => {
    const p = state.players[playerIndex];
    if (p === undefined) return null;
    const n = topo.nodes[p.nodeId - 1];
    if (n === undefined) return null;
    // @source cmp ebx, 0x7d0 / jle 跳过；cmp ebx, 0x1770 / jge 跳过
    //   住宅(2000..4000) 与设施(4000..6000) 都算，景观与特殊格不算
    const buildable = housingIndexOf(n.type) !== null || facilityIndexOf(n.type) !== null;
    return { type: n.type, buildable };
  };

  const r = applyMagicEffect(spin.option, spin.targets, {
    players: state.players,
    cardAmount: state.cardAmount,
    tools: state.tools,
    toolStock: state.toolStock,
    priceIndex: state.priceIndex,
    initiator: state.currentPlayer,
    nodeOf,
    nextRandom: () => rng.next(),
  });

  let next: GameState = {
    ...state,
    rngState: rng.getState(),
    players: applyHostilityDeltas(r.players, r.hostilityDeltas),
    cardAmount: r.cardAmount,
    tools: r.tools,
    toolStock: r.toolStock,
    phase: 'turnEnd',
  };

  for (const req of r.requests) {
    next = applyMagicRequest(next, topo, req);
    if (next.phase === 'gameOver') return next;
  }
  return next;
}

/** 魔法屋里跨子系统的那几件事 */
export function applyMagicRequest(
  state: GameState,
  topo: MapTopology,
  req: MagicRequest,
): GameState {
  switch (req.kind) {
    // @source for (i = 0; i < 3; i++) call 0x44db81
    case 'drawFortune': {
      let s = state;
      for (let i = 0; i < req.amount; i++) {
        // 命運事件按**被点到的那个人**结算，故临时把行动者切过去
        const drawn = drawAndApplyFortune({ ...s, currentPlayer: req.player }, topo);
        s = { ...drawn, currentPlayer: state.currentPlayer };
        if (s.phase === 'gameOver') return s;
      }
      return { ...s, phase: 'turnEnd' };
    }
    case 'prison':
    case 'hospital': {
      const kind = req.kind === 'prison' ? 'prison' : 'hospital';
      const occ = kind === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
      const c = confine(state.players, occ, kind, req.player, req.amount);
      const confined: GameState = kind === 'prison'
        ? { ...state, players: c.players, prisonOccupancy: c.occupancy }
        : { ...state, players: c.players, hospitalOccupancy: c.occupancy };
      return insureConfinement(confined, topo, req.player, req.amount);
    }
    // @source 0x40b110(type)：住宅 level < 5 可建；連鎖店只有 level == 0 时可建
    case 'build': {
      const land = landAtPlayer(state, topo, req.player);
      if (land === null) {
        // ★ 0x40b110 对設施同样生效（0x0040b170 起）：等级 0 → 電腦（自己的）rand()%4+1 / 别人的 公園，
        //   真人要选种类（0x440aac，本引擎没那一屏 → 不建，Q-CO-1 同类）；否则 +1 级、不超上限
        const facIdx = facilityIndexAtPlayer(state, topo, req.player);
        if (facIdx === null) return state;
        const built = freeBuildFacilityById(state, topo, facIdx, -1);
        return built ?? state;
      }
      const isChain = land.type !== 0;
      const buildable = isChain ? land.level === 0 : land.level < MAX_LAND_LEVEL;
      if (!buildable) return state;
      const landLevel = [...state.landLevel];
      landLevel[land.id] = land.level + 1;
      return { ...state, landLevel };
    }
    // @source 0x40ab4a(type, 0)：与拆除卡、炸彈同一套
    case 'demolish': {
      const land = landAtPlayer(state, topo, req.player);
      if (land === null) return state;
      const d = demolishLand(land, state.priceIndex);
      const landLevel = [...state.landLevel];
      landLevel[land.id] = d.land.level;
      return { ...state, landLevel };
    }
    // @source run_auction(player, 1) @ 0x43bde5
    // ⚠️ 拍卖是**模态 UI**（出价由人给），按 C-ARC-2 不能在 reducer 里跑完。
    //   本引擎把它挂成待决交互，由上层作答——与银行拍卖同一条路。
    case 'auction':
      return state;
    default:
      return state;
  }
}

/**
 * 監獄／醫院那一格的节点号。
 *
 * ★ 原版存在两个全局里（`[0x48bae0]` 監獄、`[0x48bae2]` 醫院，
 *   由两个释放函数 0x0043d7f9 / 0x0043eeb0 用到）；本引擎不镜像全局，
 *   现查地图 —— 每张图各有且仅有一格。
 */
function gateNodeOf(topo: MapTopology, kind: ConfinementKind): number {
  const want = kind === 'prison' ? SPECIAL_KIND.PRISON : SPECIAL_KIND.HOSPITAL;
  return topo.nodes.find((n) => n.specialKind === want)?.id ?? 0;
}

/** 道具编号 */
const TOOL_ROBOT_DOLL = 1;
const TOOL_MISSILE = 7;
const TOOL_REMOTE_DICE = 8;
const TOOL_ROBOT_WORKER = 9;
const TOOL_NUKE = 13;

/** 某个节点上的住宅；不是住宅返回 null */
function landAtNode(state: GameState, topo: MapTopology, nodeId: number): LandInfo | null {
  const node = topo.nodes[nodeId - 1];
  if (node === undefined) return null;
  const idx = housingIndexOf(node.type);
  if (idx === null) return null;
  return effectiveLand(state, topo, idx);
}

/**
 * 打一发飛彈。
 *
 * @source `damage_area` VA 0x0040ac7b，参数见 rules/tool-effects.ts 的
 *   `MISSILE_RADIUS` / `NUKE_RADIUS`。逐块地的效果走 `blastLand`。
 *
 * ⚠️ **爆炸范围是本引擎与原版最明确的一处偏离**（Q-TOOL-1）：
 *   原版把镜头移到目标上，再在一张 440×440 的**视图空间**格子里
 *   取 ±半径 的方窗（VA 0x0040a45c）。那需要等距投影与镜头，
 *   规则层拿不到。本引擎改用**节点坐标**的方窗，半径同为 100。
 *   核子飛彈的半径是 -1（全图），两者**完全一致**，那一发是精确的。
 */
function fireMissile(
  state: GameState,
  topo: MapTopology,
  heavy: boolean,
  targetNode: number,
): GameState | null {
  const target = topo.nodes[targetNode - 1];
  if (target === undefined) return null;

  const inBlast = (n: MapNode): boolean => {
    if (heavy) return true; // @source 半径 -1：整张图
    return (
      Math.abs(n.x - target.x) <= MISSILE_RADIUS && Math.abs(n.y - target.y) <= MISSILE_RADIUS
    );
  };

  const landLevel = [...state.landLevel];
  const landOwner = [...state.landOwner];
  const deltas: { from: number; to: number; delta: number }[] = [];
  const hitNodes = new Set<number>();

  for (const n of topo.nodes) {
    if (!inBlast(n)) continue;
    hitNodes.add(n.id);
    // @source flags & 2 —— 住宅
    const idx = housingIndexOf(n.type);
    if (idx === null) continue;
    const land = effectiveLand(state, topo, idx);
    if (land === null) continue;
    const out = blastLand(land.owner, land.level, land.type, state.priceIndex, heavy);
    landLevel[land.id] = out.level;
    landOwner[land.id] = out.owner;
    if (out.hostility !== 0 && land.owner !== 0) {
      deltas.push({ from: land.owner - 1, to: state.currentPlayer, delta: out.hostility });
    }
  }

  // @source flags & 0x20 —— 范围里的人：毁车 + 挂上「被炸」标志
  //   随后统一 `敌意 += 90 × 物价指数` 并送医 3 天（VA 0x004470a1 的循环）
  // ⚠️ 必须**按下标**改一个工作数组：`confine` 返回的是新数组，
  //   若边遍历原数组边替换，后面几个人的改动会写到已被丢弃的旧对象上。
  //   核彈打全图时四个人都在范围里，这个坑一踩一个准。
  let players: Player[] = state.players.map((p) => ({ ...p }));
  let hospital = [...state.hospitalOccupancy];
  const toolStock = [...state.toolStock];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p === undefined || !isAlive(p) || !hitNodes.has(p.nodeId)) continue;
    // @source 飛彈把镜头移到目标处再炸，自己站在别处；核彈打全图，自己也跑不掉
    if (i === state.currentPlayer && !heavy) continue;
    deltas.push({
      from: i,
      to: state.currentPlayer,
      delta: MISSILE_HOSTILITY_FACTOR * state.priceIndex,
    });
    // @source call 0x40cd07 —— 与地雷同一个毁车流程
    const b = p.blocking;
    const immune =
      b.inHotel !== 0 || b.disappearing !== 0 || b.inPrison !== 0 || b.inHospital !== 0;
    if (!immune && p.trafficMethod !== 0) {
      const kind = p.trafficMethod & 3;
      if (kind === 1) toolStock[5] = (toolStock[5] ?? 0) + 1;
      else if (kind === 2) toolStock[6] = (toolStock[6] ?? 0) + 1;
      players[i] = { ...p, trafficMethod: 0, ndices: 1 };
    }
    const c = confine(players, hospital, 'hospital', i, MISSILE_HOSPITAL_DAYS);
    players = c.players.map((q) => ({ ...q }));
    hospital = c.occupancy;
  }
  // 保險：住院的意外損失（send_to_hospital 里 0x0043edf8）
  const insured = new Set<number>();
  players.forEach((q, i) => {
    if (q.blocking.inHospital !== 0 && state.players[i]?.blocking.inHospital === 0) insured.add(i);
  });

  let out: GameState = {
    ...state,
    players: applyHostilityDeltas(players, deltas),
    landLevel,
    landOwner,
    hospitalOccupancy: hospital,
    toolStock,
  };
  for (const i of insured) out = insureConfinement(out, topo, i, MISSILE_HOSPITAL_DAYS);
  return out;
}

/** 某玩家脚下那块住宅；不是住宅返回 null */
/** 某玩家脚下的設施下标（不在設施上 → null） */
function facilityIndexAtPlayer(state: GameState, topo: MapTopology, playerIndex: number): number | null {
  const p = state.players[playerIndex];
  if (p === undefined) return null;
  const node = topo.nodes[p.nodeId - 1];
  if (node === undefined) return null;
  return facilityIndexOf(node.type);
}

function landAtPlayer(state: GameState, topo: MapTopology, playerIndex: number): LandInfo | null {
  const p = state.players[playerIndex];
  if (p === undefined) return null;
  const node = topo.nodes[p.nodeId - 1];
  if (node === undefined) return null;
  const idx = housingIndexOf(node.type);
  if (idx === null) return null;
  return effectiveLand(state, topo, idx);
}

/**
 * 走到小游戏格上。
 *
 * @source 落点跳表第 6/7/8 项 + 三个小游戏共用的「不玩」出口 0x00415457：
 * ```asm
 * if (player.who_plays != 1) goto 不玩     ; ★ 电脑玩家从来不玩
 * if ([0x497159] == 0)       goto 不玩     ; 设置里关掉了
 * …玩…
 * ```
 * 真人才需要把玩法跑起来，故只有真人会挂待决交互。
 */
function enterMinigame(state: GameState, specialKind: number): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return state;
  // @source cmp byte [player + 0x15], 1 / jne 不玩
  const human = (me.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN;
  if (!human) return settleMinigame(state, null);

  return {
    ...state,
    pending: {
      kind: 'minigame',
      game: specialKind,
      name: MINIGAME_NAMES[specialKind] ?? `小游戏${specialKind}`,
      maxScore: MINIGAME_MAX_SCORE,
    },
  };
}

/**
 * 小游戏结算 —— 规则上只有一件事：點券 += 得分。
 *
 * @param score 玩出来的分；`null` 表示没玩，按 `50 + rand() % 20` 抽
 *
 * ⚠️ 随机数**只在没玩时才推进**，与原版一致：真人玩完那条路上
 *   原版一次 `rand()` 都不调（分数来自玩法本身）。
 */
function settleMinigame(state: GameState, score: number | null): GameState {
  let rngState = state.rngState;
  let gained: number;
  if (score === null) {
    const rng = new WatcomRng();
    rng.setState(rngState);
    gained = autoMinigameScore(rng.next());
    rngState = rng.getState();
  } else {
    gained = clampMinigameScore(score);
  }
  // @source add word [player + 0x30], ax
  const next = withPlayer({ ...state, rngState }, state.currentPlayer, (p) => {
    p.points = addPoints(p.points, gained);
  });
  return { ...next, phase: 'turnEnd' };
}

/** 角色名 —— 保釋提示语要用 */
function characterNameOf(p: Player | undefined): string {
  if (p === undefined) return '？';
  return CHARACTERS[p.character]?.name ?? `玩家${p.index + 1}`;
}

/**
 * 落在監獄/醫院格上。
 *
 * @source VA 0x0043d304 / 0x0043e9a4：真人弹保釋窗口，电脑自己掷骰子决定。
 *   见 rules/visit.ts。
 */
function enterVisit(state: GameState, topo: MapTopology, specialKind: number): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return { ...state, phase: 'turnEnd' };
  const kind: ConfinementKind = specialKind === SPECIAL_KIND.PRISON ? 'prison' : 'hospital';
  const occ = kind === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
  // @source 占用表全空即返回
  if (!anyoneConfined(occ)) return { ...state, phase: 'turnEnd' };

  const human = (me.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN;
  if (human) {
    return { ...state, pending: pendingForSpecial(state, topo, specialKind) };
  }

  // 电脑：随机数在 reducer 里掷，AI 保持纯函数
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  // decideBail 最多用三个随机数；多备无妨，用几个由它告诉我们
  const rolls = [rng.next(), rng.next(), rng.next()];
  const d = decideBail(me.personality, occ, me.points, rolls);

  // ★ 只推进**真正用掉**的那几个 —— 多推一个，整条随机序列就与原版错位
  const after = new WatcomRng();
  after.setState(state.rngState);
  for (let i = 0; i < d.randomsUsed; i++) after.next();
  const rolled: GameState = { ...state, rngState: after.getState(), phase: 'turnEnd' };
  if (d.slot < 0) return rolled;

  const r = applyBail(rolled.players, occ, kind, state.currentPlayer, d.slot);
  if (!r.ok) return rolled;
  const paid: GameState = { ...rolled, players: r.players };
  return kind === 'prison'
    ? { ...paid, prisonOccupancy: r.occupancy }
    : { ...paid, hospitalOccupancy: r.occupancy };
}

function tradeStock(
  state: GameState,
  action: { type: 'buyStock' | 'sellStock'; stock: number; shares: number },
): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;
  const stock = state.market.stocks[action.stock];
  const held = state.holdings[state.currentPlayer]?.[action.stock];
  if (stock === undefined || held === undefined) return state;
  if (!Number.isInteger(action.shares) || action.shares <= 0) return state;
  // @source fcn_00428d01 —— 休市日柜台不开门
  if (!marketOpenOn(state.globalMapId, state.year, state.month, state.day)) return state;
  // @source 0x0042af13 `cmp eax, 1` 漲停無法買進；0x0042b046 `cmp eax, 3` 跌停無法賣出
  // @source 0x0042aef4 / 0x0042b02f `cmp byte [股票 + 0x02], 0 / jne 跳过` —— 停牌倒数非 0 时柜台不理
  if (stock.f6 !== 0) return state;
  if (action.type === 'buyStock' && isLimitUp(stock.openPrice, stock.price)) return state;
  if (action.type === 'sellStock' && isLimitDown(stock.openPrice, stock.price)) return state;

  const commit = (r: TradeResult): GameState => ({
    ...state,
    players: state.players.map((p, i) => (i === state.currentPlayer ? r.player : p)),
    market: {
      ...state.market,
      stocks: state.market.stocks.map((s, i) => (i === action.stock ? r.stock : s)),
    },
    holdings: state.holdings.map((row, i) =>
      i === state.currentPlayer ? row.map((h, j) => (j === action.stock ? r.holding : h)) : row,
    ),
  });

  if (action.type === 'buyStock') {
    // 可流通股不够就买不到
    if (action.shares > stock.shares) return state;
    const cost = Math.trunc(action.shares * stock.price);
    // @source 柜台买入扣的是存款
    if (cost > me.moneyInBank) return state;
    // @source buy_stock 末尾无条件重排企业名次 —— 柜台买入同样触发
    return reownCommercial(
      commit(buyStock(me, held, stock, action.shares, 'market')),
      action.stock,
      state.currentPlayer,
    );
  }

  if (action.shares > held.amount) return state;
  // ★ 卖出**也要**重排企业名次 @source `_rich4_sell_stock` 尾部
  //   （VA 0x00428e23 起，`call _rich4_update_commercial_owner` @0x00428eb7）：
  //   `rich4_stocks.asm:214-219` 的
  //   ```asm
  //   00428ead  mov ebx, [esp+0x18] / push ebx
  //             mov esi, [esp+0x18] / push esi
  //   00428eb7  call _rich4_update_commercial_owner     ; ★ 与买入那一条同源
  //   ```
  //   ⚠️ 先前这里写着「卖出不触发」，那是**读反了** —— 卖光股票（或卖到不再是
  //   第一大股东）**当场**就让出企业归属，不必等下一次有别人买入。
  return reownCommercial(
    commit(sellStock(me, held, stock, action.shares, 'bank')),
    action.stock,
    state.currentPlayer,
  );
}

/**
 * 用一个道具。
 *
 * ★ 效果全在 `rules/tool-effects.ts`，这里只做状态接驳：
 *   交通工具改玩家的 `trafficMethod` / `ndices` 并把旧车退还成道具；
 *   放置类占用一个物件槽。
 *
 * ⚠️ **只在真正生效时才收走道具**（`takeTool`）。原版换乘同种车时
 *   直接 `jmp 结束`、根本不走 take_tool，故那种情况不消耗——
 *   `useVehicleTool` 返回 `ok: false` 正是这个意思。
 */
/**
 * 傳送機的三路分派。
 *
 * `nodeId` 与 `value` 都是**选择器编码**（见 rules/teleport.ts）：
 * - `2000 < v < 4000` → 住宅地，下标 `v − 2000`
 * - `4000 < v < 6000` → 設施
 * - 其余当作节点号（搬人那一路）
 *
 * 設施那一路已接通（`teleportFacility`，P0-2）：設施归属与等级
 *   已进状态，編码正常生效。地產↔設施 混搬原版没有，仍拒收。
 */
function teleportWith(
  state: GameState,
  topo: MapTopology,
  source: number,
  target: number,
): GameState | null {
  const from = decodeTeleport(source);
  const to = decodeTeleport(target);
  if (from?.kind === 'land' && to?.kind === 'land') {
    return teleportLand(state, from.index, to.index);
  }
  if (from?.kind === 'facility' && to?.kind === 'facility') {
    return teleportFacility(state, from.index, to.index);
  }
  // 地產↔設施 混搬原版没有这一路（三段编码各走各的）
  if (from?.kind === 'facility' || to?.kind === 'facility') return null;
  // 搬人：source 是玩家下标 + 1，target 是节点号
  const playerIndex = source - 1;
  if (playerIndex < 0 || playerIndex >= state.players.length) return null;
  return teleportPlayer(state, topo.nodes, playerIndex, target);
}

export function useToolAction(
  state: GameState,
  topo: MapTopology,
  toolId: number,
  nodeId: number,
  value: number,
): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;
  if (!isToolImplemented(toolId)) return state;
  if (toolCount(state.tools, me.index, toolId) <= 0) return state;

  const consume = (next: GameState): GameState => {
    const taken = takeTool(next.tools, next.toolStock, me.index, toolId);
    return { ...next, tools: taken.tools, toolStock: taken.stock };
  };

  // ── 傳送機（11）：搬地產 / 搬設施 / 搬人 ──
  if (toolId === TOOL_TELEPORTER) {
    const moved = teleportWith(state, topo, nodeId, value);
    if (moved === null) return state; // 选不出合法的源/目标 → 不消耗道具
    return consume(moved);
  }

  // ── 時光機（10）：把这一回合退回去重来 ──
  if (toolId === TOOL_TIME_MACHINE) {
    const back = restoreSnapshot(state);
    // @source `test eax, eax / je loc_00447423` —— 没快照就**不消耗道具**
    if (back === null) return state;
    // 还原之后要把道具扣掉，所以在**还原后的**状态上扣
    const taken = takeTool(back.tools, back.toolStock, me.index, toolId);
    return { ...back, tools: taken.tools, toolStock: taken.stock };
  }

  // ── 機器娃娃（1）：放一个替身出去，沿路九格把物件全扫掉 ──
  if (toolId === TOOL_ROBOT_DOLL) {
    const doll = spawnDoll(state, me.index);
    if (doll === null) return state;
    // ★ 替身与玩家共用一套走子规则（不走回头路、封路位、岔路随机），
    //   所以这里直接把 `pickNextNode` 交给它，不另造一套（C-ARC-2）。
    const rng = new WatcomRng();
    rng.setState(state.rngState);
    const swept = runDoll(doll, state.objects, (from, prev) =>
      pickNextNode(topo, from, prev, rng) ?? 0,
    );
    const specialActors = [...state.specialActors];
    specialActors[specialSlotOf(ACTOR_DOLL)] = swept.actor;
    return consume({
      ...state,
      objects: swept.objects,
      specialActors,
      rngState: rng.getState(),
      // ★ 機器娃娃那九格同样交给表现层（纯表现提示，覆写）。
      //   ⚠️ T-047 的偏离单原先把「path 被丢掉」只记在 `npcRound` / `bail` 两处，
      //   这里同样丢 —— 娃娃是九格，漏了它等于最显眼的那一趟还是瞬移。
      lastNpcWalks: [{ slot: specialSlotOf(ACTOR_DOLL), path: swept.path }],
    });
  }

  // ── 遙控骰子（8）──
  if (toolId === TOOL_REMOTE_DICE) {
    // @source `test ebx, ebx / je 结束` —— 没给点数就不消耗道具
    if (!isValidRemoteDice(value)) return state;
    return consume({ ...state, forcedDice: value });
  }

  // ── 機器工人（9）：免费加蓋一级 ──
  if (toolId === TOOL_ROBOT_WORKER) {
    const land = landAtNode(state, topo, nodeId);
    if (land !== null) {
      const b = buildOneLevel(land.type, land.level, MAX_LAND_LEVEL);
      if (!b.ok) return state;
      const landLevel = [...state.landLevel];
      landLevel[land.id] = b.level;
      return consume({ ...state, landLevel });
    }
    // 設施也吃这一件（`0x40b110` 对 0xfa0..0x1770 那一段）：
    //   等级 0 → 定种类再蓋第一级；等级 ≥ 1 → 不超过该种类上限就 +1
    const built = freeBuildFacility(state, topo, nodeId, value);
    if (built === null) return state;
    return consume(built);
  }

  // ── 飛彈（7）／核子飛彈（13）──
  if (toolId === TOOL_MISSILE || toolId === TOOL_NUKE) {
    const fired = fireMissile(state, topo, toolId === TOOL_NUKE, nodeId);
    if (fired === null) return state;
    return consume(fired);
  }

  // ── 交通工具 ──
  if (VEHICLE_TOOLS.has(toolId)) {
    const r = useVehicleTool(me, state.tools, toolId);
    if (!r.ok) return state; // 已经是同一种车 → 原版不消耗道具
    const taken = takeTool(r.tools, state.toolStock, me.index, toolId);
    return {
      ...state,
      players: state.players.map((p, i) => (i === state.currentPlayer ? r.player : p)),
      tools: taken.tools,
      toolStock: taken.stock,
    };
  }

  // ── 放置类 ──
  const objectType = PLACEMENT_TOOLS.get(toolId);
  if (objectType !== undefined) {
    if (nodeId <= 0) return state;
    const r = placeObject(state.objects, nodeId, objectType);
    if (!r.ok) return state; // 没有空物件槽
    const taken = takeTool(state.tools, state.toolStock, me.index, toolId);
    return { ...state, objects: r.objects, tools: taken.tools, toolStock: taken.stock };
  }

  return state;
}

/**
 * 打出一张手牌。
 *
 * ★ 卡片效果本身全在 `cards/registry.ts`，这里只做**状态接驳**：
 *   把 `GameState` 拆成 `UseCardContext` 要的形状，再把结果合回去。
 *   一行新规则都不加。
 *
 * ⚠️ 合并 `lands` 时只取**归属与等级**两项写回 `landOwner` / `landLevel`
 *   ——地价、租金表这些是地图静态数据，卡片不会改它们，
 *   真要改也该改地图表而不是状态。
 *
 * ⚠️ 只在 `ok` 时才落地。原版多处是 `test eax,eax / je end` 之后才扣卡，
 *   registry 已经照此实现，故失败时状态原样返回（连卡都不扣）。
 */
function playCard(
  state: GameState,
  topo: MapTopology,
  cardId: number,
  target: CardTarget,
): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;

  const lands = allEffectiveLands(state, topo);
  const r = useCard(
    {
      players: state.players,
      lands,
      nodes: topo.nodes,
      currentPlayer: state.currentPlayer,
      priceIndex: state.priceIndex,
      tools: state.tools,
      toolStock: state.toolStock,
      objects: state.objects,
      market: state.market,
      marketOpen: marketOpenOn(state.globalMapId, state.year, state.month, state.day),
      facilities: allEffectiveFacilities(state, topo),
      actors: state.specialActors,
      // 嫁祸的新目标：交给上层决定；没给就放弃转嫁（返回 -1）
      scapegoatPicker: () => -1,
    },
    cardId,
    target,
  );
  if (!r.ok) return state;

  const landOwner = [...state.landOwner];
  const landLevel = [...state.landLevel];
  // ★ `type` 也要落回去：改建卡改的就是它，先前漏掉导致那张卡看着生效
  //   实际下一次读地块又变回原样
  const landType = [...state.landType];
  const landPriceStatus = [...state.landPriceStatus];
  for (const l of r.lands) {
    landOwner[l.id] = l.owner;
    landLevel[l.id] = l.level;
    landType[l.id] = l.type;
    landPriceStatus[l.id] = l.priceStatus;
  }

  // 設施同理：怪獸卡改的是 level/type，owner 也可能被未来的卡动到，一并合回
  const facilityOwner = [...state.facilityOwner];
  const facilityLevel = [...state.facilityLevel];
  const facilityType = [...state.facilityType];
  const facilityPriceStatus = [...state.facilityPriceStatus];
  for (const f of r.facilities) {
    facilityOwner[f.id] = f.owner;
    facilityLevel[f.id] = f.level;
    facilityType[f.id] = f.type;
    facilityPriceStatus[f.id] = f.priceStatus;
  }

  // 查封卡封到研究所时，+0x1e（研发剩余天数）被清零 @source 0x004456d5
  const facilityResearchDays = [...state.facilityResearchDays];
  for (const facId of r.researchReset) {
    facilityResearchDays[facId] = 0;
  }

  // 敌意由 registry 算好，这里按增量落到玩家身上
  const players = applyHostilityDeltas(r.players, r.hostilityDeltas);

  // ★ 送神符之类只清了玩家身上的引用，物件本身要在这里收回：
  //   退还三项修正、清 `attached`、让搭档登场。
  let next: GameState = { ...state, players, landOwner, landLevel, landType, landPriceStatus, facilityOwner, facilityLevel, facilityType, facilityPriceStatus, facilityResearchDays, specialActors: r.actors, tools: r.tools, toolStock: r.toolStock, objects: r.objects, market: r.market };
  for (const handle of r.releasedObjects) {
    const rel = releaseObject(next, handle);
    next = respawnPartner(
      {
        ...next,
        players: rel.players,
        objects: rel.objects,
        tools: rel.tools,
        toolStock: rel.toolStock,
      },
      topo,
      rel.partner >= 0 ? { partner: rel.partner, nearNode: rel.formerNode } : null,
    );
  }
  // 請神符挤走旧神时，旧神的搭档在这里重新登场
  for (const rs of r.respawns) {
    next = respawnPartner(next, topo, rs);
  }
  // 拍賣卡：把竞价挂成待决交互。★ Q-AUC-1 之后竞价循环归 core ——
  //   挂出来时就把座位表、心理价位、现价、轮到谁一并建好（见 openAuction）。
  if (r.followUp !== null) {
    if (r.followUp.kind === 'auction') {
      const opened = openAuction(next, topo, r.followUp);
      // ★ 一开拍就没人出得起底价（全体 `givenUp`）→ 当场流标。
      //   原版窗口也是这个下场（`loc_0043b295` 的 `esi == edi` 那一条），
      //   但引擎里若不在这里结掉，`decidePending` 会拿不到座位（`seat` 落空），
      //   pending 就永远挂着。
      if (auctionFinished(opened)) {
        const out = auctionOutcome(opened);
        return settleAuctionExplicit(next, topo, opened, out.winner, out.price);
      }
      next = { ...next, pending: opened, phase: 'awaitingDecision' };
    } else {
      next = { ...next, pending: r.followUp, phase: 'awaitingDecision' };
    }
  }
  return next;
}

/**
 * 买入股票之后重排对应企业的持股名次。
 *
 * @source `_rich4_buy_stock` 末尾无条件调 `_rich4_update_commercial_owner`
 *   —— **柜台买入与企业买入都会触发**，不只是后者。
 *
 * ★ **卖出也触发** —— @source `_rich4_sell_stock` 尾部
 *   `call _rich4_update_commercial_owner`（VA 0x00428e23 → 0x00428eb7，
 *   见 `rich4_stocks.asm:214-219`）。买入与卖出两条都重排，破产清算那条
 *   （原版走 `_rich4_sell_stock`）同理。
 *
 * ⚠️ 本文件与 `places/commercial.ts` 先前都写着「卖出不触发」——**读反了**，
 *   2026-09-16 已订正。
 *
 * 参数名仍叫 `buyer`（它其实只是「**发生变动的那名玩家**」）：卖出时
 * 传的就是卖方 —— `updateCommercialOwner` 只按当前持股重算名次，
 * 不关心这次是买是卖。
 */
function reownCommercial(state: GameState, stockIndex: number, buyer: number): GameState {
  const commercialId = state.market.stocks[stockIndex]?.commercialIndex ?? 0;
  if (commercialId === 0) return state;
  const prev = state.commercialOwners[commercialId] ?? emptyOwnership();
  const r = updateCommercialOwner(prev, buyer, (p) => state.holdings[p]?.[stockIndex]?.amount ?? 0);
  const commercialOwners = [...state.commercialOwners];
  commercialOwners[commercialId] = r.ownership;
  return { ...state, commercialOwners };
}

/**
 * 买下当前待决企业的股份。
 *
 * @source 落点 VA 0x0041d277：`buy_stock(玩家, commercial[+0x19], 股数, 0)`
 *   末位 0 即「从企业买」那一支 —— 按资产额定价、从现金付、
 *   扣企业自己的可售股数（`sub dword [commercial+0x30], 股数`）。
 *
 * ⚠️ 原版随后还会调 `_rich4_update_commercial_owner` 维护一张
 *   4 人的持股排名（企业记录 +0x1c..+0x1f），据此决定企业归谁。
 *   那一段尚未实现，见 known-deviations 的 Q-COM-1。
 */
function buySharesFromCommercial(state: GameState, shares: number): GameState {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'buyShares') return state;
  if (!Number.isInteger(shares) || shares <= 0) return state;
  if (shares > pending.available) return state;

  const me = state.players[state.currentPlayer];
  const stock = state.market.stocks[pending.stock];
  const held = state.holdings[state.currentPlayer]?.[pending.stock];
  if (me === undefined || stock === undefined || held === undefined) return state;
  if (shares * pending.unitPrice > me.cash) return state;

  const r = buyStock(me, held, stock, shares, 'commercial', pending.unitPrice);
  const commercialShares = [...state.commercialShares];
  commercialShares[pending.commercialId] =
    (commercialShares[pending.commercialId] ?? 0) - r.commercialSharesTaken;

  const next: GameState = {
    ...state,
    players: state.players.map((p, i) => (i === state.currentPlayer ? r.player : p)),
    holdings: state.holdings.map((row, i) =>
      i === state.currentPlayer ? row.map((h, j) => (j === pending.stock ? r.holding : h)) : row,
    ),
    commercialShares,
    pending: null,
  };
  return reownCommercial(next, pending.stock, state.currentPlayer);
}

/**
 * 落在上市企业上：问玩家要买多少股。
 *
 * @source 落点 VA 0x0041d277 —— 拿到股数后调
 *   `buy_stock(玩家, commercial[+0x19], 股数, 0)`，末位 0 即「从企业买」。
 *
 * 按 C-ARC-2，「买几股」是模态 UI 的事，core 只负责把做这个决定所需的
 * 信息算齐（单价、余量、现金、**通用填数窗的上限**）。
 *
 * ★ **上限在这里算**（`shareWindowLimit`，照 VA 0x0041d1a9），客户端只管
 *   把它交给 `AmountPage` —— 先前 UI 拿 `available` 当上限，等于把原版
 *   那三道夹回（1000 / 現金 ÷ 單價 / 企業餘量）抄了半份在界面上。
 *
 * ★ **上限为 0 就返回 `null`**：原版 `test esi, esi / je loc_0041d2bb`
 *   —— 一股都买不起、或企業已售罄时，訊息框根本不开（真人电脑共用这道闸）。
 */
function pendingForCommercial(
  state: GameState,
  topo: MapTopology,
  node: MapNode,
): PendingInteraction | null {
  if (node.ref.kind !== 'commercial') return null;
  const commercialId = node.ref.index;
  const c = topo.commercials?.find((x) => x.id === commercialId);
  if (c === undefined) return null;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  // ★ 进门两道闸 @source `fcn_0041d1a9`（VA 0x0041d857 起）：
  //   ① `player+0x37 != 0`（**梦游中**）→ 不问；
  //   ② `who_plays == 0`（已出局）→ 不问。
  //   两道都在算「上限」之前，所以是**连框都不开**。
  if (me.blocking.sleepWalking !== 0) return null;
  if ((me.whoPlays & WHO_PLAYS_MASK) === 0) return null;
  const unitPrice = commercialUnitPrice(c.assetValue);
  const available = state.commercialShares[commercialId] ?? 0;
  const max = shareWindowLimit(unitPrice, me.cash, available);
  if (max <= 0) return null;
  return {
    kind: 'buyShares',
    commercialId: c.id,
    name: c.name,
    stock: c.stockIndex,
    unitPrice,
    available,
    max,
    cash: me.cash,
  };
}

/**
 * 某玩家的持仓估值 —— 把持股数与**当前**股价配对。
 *
 * @source `_rich4_calculate_player_wealth` 取的是 `stock_info + 20`
 *   （见 rules/wealth.ts 的 StockValuation），而不是持仓成本均价。
 */
export function valuationsOf(s: GameState, playerIndex: number): StockValuation[] {
  const held = s.holdings[playerIndex];
  if (held === undefined) return [];
  return held.map((h, i) => ({ amount: h.amount, price: s.market.stocks[i]?.price ?? 0 }));
}

/**
 * 推进一天 —— 回合边界上跑完的那一整条链。
 *
 * @source `00419033 call 0x41cf67`，该函数（VA 0x0041cf67）里的顺序是：
 * ```asm
 * 0041cfa1  call advance_date(&[0x497160])   → edi = 是否跨月
 * 0041cfab  inc  dword [0x4990e4]            ; 总天数
 * 0041cfbf  call 0x423acf                    ; 物价指数（已在调用方算过）
 * 0041cff9  12 支股票的停牌/新闻天数各减一
 * 0041d076  call 0x4291d6                    ; ★ 股市收盘
 * 0041d080  if ((日期 & 0xff) == 15) call 0x431712   ; ★ 樂透开奖
 * 0041d099  if (跨月) call 0x439bfa                  ; ★ 月结
 * ```
 *
 * ★ 顺序不是随意的：股市先收盘再开奖，故开奖那一刻的公库已经
 *   含了当天所有买票钱；月结在最后，利息按结算完的存款算。
 *
 * ⚠️ 原版在收盘前 `srand(GetTickCount())`（VA 0x0041d06e）——
 *   这正是 docs/known-deviations.md 记的那处重播种，本引擎**不做**，
 *   随机数一路从 `rngState` 顺序取。
 *
 * ★ **勝利條件判定就在本函数里**（原版 `fcn_0041cf67` 也是同一个函数）：
 *   `inc [0x4990e4]` 之后、更新物价指数之前判一次，达标就**当场返回**
 *   （行情/開獎/月結/地契到期全部跳过）。见 rules/victory.ts。
 */
function advanceGameDay(state: GameState, topo: MapTopology): GameState {
  const rng = new WatcomRng();
  rng.setState(state.rngState);

  // @source 0041cfa1 call 0x452117
  const { date, newMonth } = advanceDate({
    year: state.year,
    month: state.month,
    day: state.day,
  });

  // ★ 總天數先 +1，再判勝負 —— 比较用的是**加过之后**的值。
  //   @source 0041cfab `inc dword [0x4990e4]`
  const totalDays = state.totalDays + 1;

  // 总资产取值器（`_rich4_calculate_player_wealth`）—— 勝負判定与物价指数共用
  const wealthOf = (p: Player): number =>
    calculatePlayerWealth(
      p,
      allEffectiveLands(state, topo),
      allEffectiveFacilities(state, topo),
      valuationsOf(state, p.index),
    );

  // ── ★ 勝負判定（遊戲時間 / 勝利條件）@source 0041cfb1 `call 0x41d89e` ──
  //    达成 → 整个日推进当场 return（0x0041cfb9 `je 0x41d1a5`）：
  //    物价指数、行情、樂透開獎、月結、地契到期**全部不走**。
  const victory = checkVictory(state.players, wealthOf, state.winConditions, totalDays);
  if (victory !== null) {
    return {
      ...state,
      ...date,
      totalDays,
      // @source 0x0041d915 `mov dword [0x49910c], esi` —— 当前玩家 = 赢家
      currentPlayer: victory.winner,
      // @source 0x0041d951 那段循环：除赢家以外**所有人 `who_plays = 0`**
      //   （只清这一个字节，钱与地产都留着 —— 与破产的 memset 不同）
      players: clearLosers(state.players, victory.winner),
      victory,
      phase: 'gameOver',
    };
  }

  // @source 0041cfbf call 0x423acf —— 物价指数（勝負判定之后才走这一步）
  // ★ 除数是**本局选中的开局资金档位**（`[0x49908c]`），不是默认的 30 万 ——
  //   选 3 万档时通胀快得多，先前这里硬编码 `DEFAULT_INITIAL_FUND` 是错的。
  const priceIndex = updatePriceIndex(
    state.players,
    wealthOf,
    state.initialFund || DEFAULT_INITIAL_FUND,
    state.priceIndex,
  );

  // @source 0041c868 call 0x42915a —— 每日重算可成交量
  let market = refreshTradableShares(state.market, rng);
  // @source 0041cff9 起的 12 次循环
  market = tickStockCountdowns(market);
  // @source 0041d076 call 0x4291d6 —— 开头 `call 0x428d01 / cmp eax, 1 / je 结束`：
  //   ★ 休市日（星期日、節日）当天**不走行情**
  if (marketOpenOn(state.globalMapId, date.year, date.month, date.day)) {
    market = tickStockMarket(market, rng, (i) => commercialValueOf(topo, i));
  }

  let players = state.players;
  let lottery = state.lottery;
  let pool = state.pool;

  // @source 0041d080 `cmp eax, 0xf` → 先 0x42ba97 上市公司分紅，再 0x431712 樂透開獎
  const companyFunds = [...state.companyFunds];
  const dividendBankrupts: number[] = [];
  if (date.day === DIVIDEND_DAY) {
    for (const c of topo.commercials ?? []) {
      const holdings = players.map((_, p) => state.holdings[p]?.[c.stockIndex]?.amount ?? 0);
      const d = companyDividends(companyFunds[c.id] ?? 0, holdings, players);
      for (const row of d.rows) {
        const pl = players[row.player];
        if (pl === undefined) continue;
        const r = applyDividend(pl, row.amount);
        players = players.map((x, i) => (i === row.player ? r.player : x));
        if (r.bankrupt) dividendBankrupts.push(row.player);
      }
      // @source 0x0042bd37 `test ebp, ebp / je` —— 有人持股才清零
      if (d.cleared) companyFunds[c.id] = 0;
    }
  }
  if (date.day === LOTTERY_DRAW_DAY) {
    const draw = drawLottery(lottery, pool, rng);
    lottery = draw.lottery;
    pool = draw.pool;
    // @source give_money(中奖者, 公库, 1) —— 旗标 1 即进现金
    if (draw.winner !== null) players = receiveMoney(players, draw.winner, draw.prize, true);
  }

  // @source 0041d09e call 0x439bfa
  if (newMonth) players = players.map((p) => (isAlive(p) ? settleMonthlyBank(p) : p));

  // @source 0041d0ff 起：逐块地、逐处設施 —— 这组循环在
  //   `cmp edi,1 / jne 0x41d0ff` 的跨月守卫**之外**，**每天**都跑：
  //   ① 涨价/查封的高 nibble 每天 −0x10，减到 0 就整字节清零（sweepPriceStatus，
  //      @source 0x0041d114 地块 / 0x0041d160 設施 / 0x0041d129 清查封位）
  //   ② 到期日 == 今天 → owner = 0、到期日 = 0（房子留着）
  const landPriceStatus = state.landPriceStatus.map(sweepPriceStatus);
  const facilityPriceStatus = state.facilityPriceStatus.map(sweepPriceStatus);
  const today = packDate(date);
  const landOwner = [...state.landOwner];
  const landTenure = [...state.landTenure];
  for (let i = 0; i < landTenure.length; i++) {
    if (tenureExpiresToday(landTenure[i] ?? 0, today)) {
      landOwner[i] = 0;
      landTenure[i] = 0;
    }
  }
  const facilityOwner = [...state.facilityOwner];
  const facilityTenure = [...state.facilityTenure];
  for (let i = 0; i < facilityTenure.length; i++) {
    if (tenureExpiresToday(facilityTenure[i] ?? 0, today)) {
      facilityOwner[i] = 0;
      facilityTenure[i] = 0;
    }
  }

  let out: GameState = {
    ...state,
    ...date,
    // @source 0041cfab `inc dword [0x4990e4]`
    totalDays: state.totalDays + 1,
    // @source 0x0041d0f9 `add [0x499084], edi` —— 跨月才 +1
    totalMonths: state.totalMonths + (newMonth ? 1 : 0),
    // @source 0x0041cfbf `call 0x423acf`（本函数内算，见上）
    priceIndex,
    players,
    lottery,
    pool,
    market,
    landOwner,
    landTenure,
    landPriceStatus,
    facilityOwner,
    facilityTenure,
    facilityPriceStatus,
    companyFunds,
    rngState: rng.getState(),
  };
  // @source 0x0042beba `call 0x40cd87` —— 负紅利把人压破產
  for (const who of dividendBankrupts) out = applyBankruptcy(out, who, topo);
  return out;
}

/**
 * 股票对应的地图企业资产额 —— 股市均值回归的锚点。
 *
 * @source 原版取 `commercial[idx].field_0x24`（VA 0x00429279），
 *   下标是 `_rich4_init_stock_commercial` 写进 `stocks_on_map+4` 的
 *   **1 基**企业序号。
 */
function commercialValueOf(topo: MapTopology, commercialIndex: number): number | null {
  const c = topo.commercials?.find((x) => x.id === commercialIndex);
  return c === undefined ? null : c.assetValue;
}

/**
 * 引擎自行推进的 action —— 不归任何人决策的那一类。
 *
 * ★ 已出局的玩家既不会被人类操作（他没有 UI 了），也不归 AI
 *   （`isAiControlled` 对出局者为假）。但**他的回合仍要走完**：
 *   `startTurn` 判定 skip 落到 `turnEnd`，`turnEnd` 再轮转到下一个
 *   在场玩家。若没人发出这两个 action，整局会**卡死在尸体身上**——
 *   这正是先前「跑 1769 回合后停住、三人还在场却不再前进」的原因。
 *
 * 这不是策略（出局者没有任何选择余地），而是规则，故放在引擎侧：
 * 任何驱动循环（热座 UI / AI / 联机）都应先问它，再去问玩家。
 */
export function autoAction(state: GameState): Action | null {
  if (state.phase === 'gameOver') return null;
  // ★ 惡人段**优先于**「当前玩家是否出局」那一条判断（T-047 的 D-T047-5）：
  //   那一輪的惡人才走了一半，回合边界就还没结束 —— 与「当前玩家是谁、死没死」
  //   无关。放到后面判，就会在下家还活着时返回 null，把整局**停在惡人段**。
  if (state.phase === 'turnEnd' && (state.pendingNpcSlots ?? []).length > 0) {
    return { type: 'npcStep' };
  }
  const p = state.players[state.currentPlayer];
  if (p === undefined || isAlive(p)) return null;
  if (state.phase === 'turnStart') return { type: 'startTurn' };
  if (state.phase === 'turnEnd') return { type: 'endTurn' };
  return null;
}

/** 轮转到下一个在场玩家；无人在场时保持原样 */
export function nextAlivePlayer(s: GameState, from: number): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const p = s.players[idx];
    if (p !== undefined && isAlive(p)) return idx;
  }
  return from;
}

/** 依次应用一串 action —— 回放与测试的入口 */
export function reduceAll(
  state: GameState,
  actions: readonly Action[],
  topo: MapTopology,
): GameState {
  let s = state;
  for (const a of actions) s = reduce(s, a, topo);
  return s;
}

// ============================================================
//  新聞 / 命運
// ============================================================

/**
 * 抽一张**当前局面下可行**的命運事件并施加。
 *
 * ⚠️ 牌堆游标无论事件是否可行都会前进（见 events/deck.ts），
 * 故这里必须把更新后的牌堆写回状态，否则会反复抽到同一张。
 */
function drawAndApplyFortune(state: GameState, topo: MapTopology): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return state;
  // ★ `checkFortune` 的可行性判据要真数据：
  //   · 事件 0/1（拆屋 / 徵收）看 `lands` 的归属与等级
  //   · 事件 8/9（卖股票）看 `stockAmount`
  //   先前这两样**写死成空/全 0**，于是那四条事件永远判为不可行、牌堆直接跳过
  //   —— 表现就是「命运牌堆里 0/1/8/9 从没出现过」。归属与等级取运行时状态
  //   （`landOwner`/`landLevel`），不是地图静态表。
  const ctx = {
    currentPlayer: me,
    otherPlayers: state.players.filter((_, i) => i !== state.currentPlayer),
    lands: (topo.lands ?? []).map((l) => ({
      owner: state.landOwner[l.id] ?? 0,
      level: state.landLevel[l.id] ?? 0,
    })),
    stockAmount: (state.holdings[state.currentPlayer] ?? []).map((h) => h.amount),
    gameStage: 0,
  };

  const draw = drawEvent(state.fortuneDeck, (id) => checkFortune(id, ctx).feasible);
  const withDeck: GameState = { ...state, fortuneDeck: draw.deck };
  if (draw.eventId < 0) return withDeck;

  // ★ checkFortune 可能把事件号**重映射**（交通方式相关的 14/15/16 一组），
  //   施加效果时必须用重映射后的号，否则会施加错事件。
  const effectiveId = checkFortune(draw.eventId, ctx).eventId;

  // ★ 神明加持（`fcn_0044b896`）：施加阶段**先问一次**，档位随事件不同
  //   （獎金 `(0,0)` / 罰金 `(0,1)` / 劫难 `(1,1)`，见 EventEntry.blessing）。
  //   50..100 那一档要掷一次 `rand() & 1` —— 走引擎随机数（C-DET-1）。
  const blessKind = fortuneEvent(effectiveId)?.blessing;
  const rng = new WatcomRng();
  rng.setState(withDeck.rngState);
  const coinFlip = rng.next() & 1;
  const blessLevel =
    blessKind === undefined
      ? 0
      : blessingLevelFor(blessingFieldOf(me, blessKind), coinFlip, blessKind);

  const out = applyFortuneEffect(effectiveId, {
    players: withDeck.players,
    currentPlayer: withDeck.currentPlayer,
    priceIndex: withDeck.priceIndex,
    pool: withDeck.pool,
    occupancy:
      // 坐牢与住院共用一个入口，故按事件实际走向取对应的占用表
      withDeck.prisonOccupancy,
    multiplier: blessLevel,
    // 事件 8/9 卖股票要的三样
    holdings: withDeck.holdings[withDeck.currentPlayer] ?? [],
    market: withDeck.market,
    sellDestination: effectiveId === FORTUNE_STOCK_LIQUIDATE ? 'bank' : 'pool',
    // 事件 10/11 把车还回商店
    toolStock: withDeck.toolStock,
    // 事件 32 变卖手牌与道具
    tools: withDeck.tools,
    cardAmount: withDeck.cardAmount,
  });

  let applied: GameState = {
    ...withDeck,
    rngState: rng.getState(),
    players: out.players,
    pool: out.pool,
    prisonOccupancy: out.occupancy,
    lastEvent: { kind: 'fortune', id: effectiveId },
  };
  // ★ 卖股票（事件 8/9）：持仓 + 行情写回，并按 `rich4_sell_stock` 的尾巴
  //   对每支卖过的股票重排企业名次（`_rich4_update_commercial_owner`）。
  if (out.holdings !== null && out.market !== null) {
    applied = {
      ...applied,
      holdings: applied.holdings.map((row, i) =>
        i === applied.currentPlayer ? out.holdings! : row,
      ),
      market: out.market,
    };
    for (const stock of out.reown) applied = reownCommercial(applied, stock, applied.currentPlayer);
  }
  if (out.toolStock !== null) applied = { ...applied, toolStock: out.toolStock };
  // ★ 事件 32：道具表 / 卡片库存写回 + 变卖所得进**點券**
  if (out.tools !== null || out.cardAmount !== null) {
    applied = {
      ...applied,
      tools: out.tools ?? applied.tools,
      cardAmount: out.cardAmount ?? applied.cardAmount,
    };
    if (out.points !== 0) {
      applied = {
        ...applied,
        players: applied.players.map((p, i) =>
          i === applied.currentPlayer ? { ...p, points: p.points + out.points } : p,
        ),
      };
    }
  }
  // ★ 事件 8/9 尾巴的特別融資收回：`push 0 / call 0x436b0a`
  if (out.recallFinance) applied = sweepSpecialFinance(applied, topo);
  // ★ 保險理賠的三处命運调用点：坐牢/住院走 send_to_*（0x0043d749 / 0x0043edf8）；
  //   「冒貸」（id 2，0x0044c218）与「行人闖越馬路罰款」（id 14，0x0044cf11）直接赔金额
  const entry = fortuneEvent(effectiveId);
  if (entry !== undefined && !out.unimplemented) {
    const me = withDeck.currentPlayer;
    if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
      applied = insureConfinement(applied, topo, me, out.amount);
    } else if (entry.effects.includes('loan') || effectiveId === FORTUNE_JAYWALK_FINE) {
      applied = insurancePayoutTo(applied, topo, me, out.amount);
    }
  }
  return applied;
}

/**
 * 抽一张新聞事件并施加。
 *
 * ⚠️ 与命運的关键差别：新聞的**受影响者未必是抽牌人**
 * （「表揚第一大地主」的受益者是地主）。谁符合条件属于**选择**，
 * 此处按事件语义现场挑；尚不能判定的事件由 applyNewsEffect
 * 标记 unimplemented，状态不变。
 */
function drawAndApplyNews(state: GameState, topo: MapTopology): GameState {
  const lands = allEffectiveLands(state, topo);
  const draw = drawEvent(state.newsDeck, (id) =>
    isNewsFeasible(id, {
      players: state.players,
      lands,
      facilities: [],
      stockAmount: state.players.map(() => []),
      commercials: [],
      stockF6: new Array<number>(12).fill(0),
      prisonOccupied: anyoneConfined(state.prisonOccupancy) ? 1 : 0,
      hospitalOccupied: anyoneConfined(state.hospitalOccupancy) ? 1 : 0,
      checkCommercialOwner: () => false,
    }),
  );
  const withDeck: GameState = { ...state, newsDeck: draw.deck };
  if (draw.eventId < 0) return withDeck;

  const facilities = allEffectiveFacilities(state, topo);
  const out = applyNewsEffect(draw.eventId, {
    players: withDeck.players,
    affected: newsTargets(draw.eventId, withDeck, lands, facilities),
    priceIndex: withDeck.priceIndex,
    pool: withDeck.pool,
    occupancy: withDeck.prisonOccupancy,
    // 百分比类（11 所得稅 / 12 地價稅 / 13 證交稅 / 23 儲金紅利）要的三样
    lands,
    facilities,
    holdings: withDeck.holdings.map((row) => row.map((h) => h.amount)),
    prices: withDeck.market.stocks.map((st) => st.price),
  });

  let applied: GameState = {
    ...withDeck,
    players: out.players,
    pool: out.pool,
    prisonOccupancy: out.occupancy,
    lastEvent: { kind: 'news', id: draw.eventId },
  };
  // 新聞的坐牢/住院也走 send_to_*，保險期内赔 2000×天×物價
  const entry = newsEvent(draw.eventId);
  if (entry !== undefined && !out.unimplemented && (entry.effects.includes('prison') || entry.effects.includes('hospital'))) {
    for (const who of newsTargets(draw.eventId, withDeck, lands, allEffectiveFacilities(state, topo))) {
      applied = insureConfinement(applied, topo, who, out.amount);
    }
  }
  return applied;
}

/**
 * 新聞事件的受影响者。
 *
 * @source 文案里的 `%s` 指明了对象：
 *   8「第一大地主」/ 9「土地最少者」/ 10「股市第一大戶」
 * 其余按抽牌人处理。
 */
function newsTargets(
  eventId: number,
  state: GameState,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
): number[] {
  // ★ 原版扫**两张表**：房产（0x498e84，步长 0x34）与商业地块
  //   （0x498e88，步长 0x38），都读 +0x19 的 owner。
  const countOwned = (i: number): number =>
    lands.filter((l) => l.owner === i + 1).length +
    facilities.filter((f) => f.owner === i + 1).length;

  // ★ 只在**在场**玩家里评比。
  //   @source 新闻 9（VA 0x00449b29）与新闻 8 的同名循环都有
  //   `cmp byte [player*0x68 + 0x496b7d], 0 / je 跳过`——即 who_plays。
  //   先前漏了这一条，后果很具体：出局者名下地产为 0，于是**永远**
  //   是「地产最少者」，新闻 9 会一直往尸体上打钱。
  const alive: number[] = [];
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p !== undefined && isAlive(p)) alive.push(i);
  }
  if (alive.length === 0) return [state.currentPlayer];

  switch (eventId) {
    case 8: {
      // 地产最多者
      let best = alive[0]!;
      for (const i of alive) if (countOwned(i) > countOwned(best)) best = i;
      return [best];
    }
    case 9: {
      // 地产最少者
      let worst = alive[0]!;
      for (const i of alive) if (countOwned(i) < countOwned(worst)) worst = i;
      return [worst];
    }
    // ★ 「所有人」那一类：11 所得稅 / 12 地價稅 / 13 證交稅 / 23 儲金紅利。
    //   原版这三支（与红利那一支）都是**两层循环扫全部玩家**，且跳过出局者
    //   （`cmp byte [player+0x15], 0 / je`）—— 与 `alive` 同一个口径。
    case 11:
    case 12:
    case 13:
    case 23:
      return alive;
    default:
      return [state.currentPlayer];
  }
}

// ============================================================
//  落点交互
// ============================================================

/**
 * 落在樂透投注站（節點 kind 9）。
 *
 * @source 落点 VA 0x004315cc `rich4_ui_letou_bar_entry`：
 * ```asm
 * cmp byte [eax + 0x496b7d], 1
 * jne 0x43169e                  ; ★ 只有**正好等于 1** 才开投注屏 0x42f7fc；
 *                               ;   托管（who_plays = 5）落到电脑那支
 * 0x43169e:                     ; 电脑分支——一口气买完，没有屏
 * ```
 *
 * ★ **一次落点只买一注**，两边都一样：
 *   - 电脑：0x4315cc 那个函数线性走到尾，只写一个号码就 ret。
 *   - 真人：点中格子买下后立刻 `PostMessage(hwnd, 0x406, 3, 0)`
 *     （VA 0x0043000e 那一段），0x406 处理程序把窗口置成 state 5，
 *     而 state 5 就是 `KillTimer` + `Post_0402_Message` —— **投注屏自行关闭**，
 *     想再买得下次踩到这一格。→ `case 'lottery'` 里把 pending 收掉。
 *
 * ★ 真人侧钱不够时原版**连屏都不开**（0x0042f8ba `cmp .., 0x3e8 / jge`：
 *   不满足就走 `PostMessage(0x405, 4, 4)`，那个 state 一路自减到关屏），
 *   所以这里直接不给交互，而不是给一个只能「離開」的空屏。
 */
function landOnLottery(state: GameState): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return state;

  // @source cmp byte [eax + 0x496b7d], 1 / jne 0x43169e
  //   注意是**精确等于 1**：托管位（0x04）落在这里会走电脑分支。
  if (me.whoPlays !== WHO_PLAYS_HUMAN) {
    const rng = new WatcomRng();
    rng.setState(state.rngState);
    const r = aiBuyTicket(me, state.lottery, rng);
    // 抽不了签（现金 <= 1000 或号码售罄）→ 随机数一次也不消耗，状态原样
    if (r === null) return state;
    return {
      ...withPlayer({ ...state, rngState: rng.getState() }, state.currentPlayer, (p) => {
        p.cash = r.player.cash;
      }),
      lottery: r.lottery,
      // @source add dword [0x499080], 0x3e8
      pool: state.pool + r.toPool,
    };
  }

  // @source 0x0042f8ba `cmp dword [eax + 0x496b84], 0x3e8 / jge`
  if (me.cash < LOTTERY_TICKET_PRICE) return state;

  return {
    ...state,
    pending: {
      kind: 'lottery',
      available: availableNumbers(state.lottery),
      price: LOTTERY_TICKET_PRICE,
      owned: numbersOf(state.lottery, state.currentPlayer).length,
    },
  };
}

/**
 * ★ 落**銀行格**的收尾：非真人玩家在**进柜台之前**按 `cashRatio`(+0x19)
 *   把現金／存款重分一次。
 *
 * @source `_rich4_ui_bank_atm_entry` @ VA 0x004379c9（银行落点 0x0041b396
 *   `call 0x4379c9`，紧接着才是柜台 `_rich4_ui_bank_entry`）。它的分派是：
 * ```asm
 * 00437a04  cmp  byte [player + 0x3b], 0 / jne 提示          ; 拒绝往来期内不办
 * 00437a1f  cmp  byte [player + 0x15], 1 / jne 0x437acd      ; who_plays == 1 → ATM 对话框
 * 00437acd  ...按 +0x19 重分現金/存款...                       ; 其余（电脑 / 被托管）
 * ```
 *   `+0x15` = `who_plays`（1 = 真人）：**只有恰好 1 的真人**走对话框那一支；
 *   电脑(2) 与「真人+托管」(1|4=5) 都落进重分那一支。
 *
 * ⚠️ 原版对电脑也照样往下开柜台（`_rich4_ui_bank_entry` 的电脑支去借款），
 *   所以这里只做「重分」，`pending` 照旧由 `pendingForSpecial` 给出。
 */
function rebalanceBankOnArrival(state: GameState): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;
  // @source 0x00437a04 `cmp byte [player + 0x3b], 0 / jne`（+0x3b = days_rejected_by_bank）
  if (me.daysRejectedByBank !== 0) return state;
  // @source 0x00437a1f `cmp byte [player + 0x15], 1 / jne 0x437acd`
  if ((me.whoPlays & 0xff) === WHO_PLAYS_HUMAN) return state;

  const next = rebalanceCashByRatio(me, state.day);
  if (next === me) return state;
  return withPlayer(state, state.currentPlayer, (p) => {
    p.cash = next.cash;
    p.moneyInBank = next.moneyInBank;
  });
}

/**
 * 这一格要求玩家做什么。
 *
 * ★ 由 core 判定而非 UI —— 见 rules/interaction.ts 顶部说明。
 */
function pendingForSpecial(
  state: GameState,
  topo: MapTopology,
  specialKind: number,
): PendingInteraction | null {
  if (!needsInteraction(specialKind)) return null;

  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;

  // 監獄／醫院：先看有没有人在里面。没人可探就什么都不发生。
  // @source 落点处理开头 `for (i=0;i<8;i++) if (table[i]) break;` 全 0 即返回
  if (specialKind === SPECIAL_KIND.PRISON || specialKind === SPECIAL_KIND.HOSPITAL) {
    const kind: ConfinementKind = specialKind === SPECIAL_KIND.PRISON ? 'prison' : 'hospital';
    const occ = kind === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
    if (!anyoneConfined(occ)) return null;
    return {
      kind: 'bail',
      place: kind,
      candidates: bailCandidates(occ, state.players, me.points, (i) =>
        characterNameOf(state.players[i]),
      ),
      points: me.points,
    };
  }

  if (specialKind === SPECIAL_KIND.BANK) {
    // @source 落点 VA 0x0043667b：拒绝往来期内直接返回
    if (me.daysRejectedByBank !== 0) return null;
    const wealth = calculatePlayerWealth(me, [], []);
    return {
      kind: 'bank',
      wealth,
      loanCapacity: loanCapacity(wealth, me.loan),
      specialFinance: specialFinanceOf(state, topo, state.currentPlayer),
    };
  }

  // 樂透不在这里 —— 它由 `landOnLottery` 接管：电脑当场买完（不经 pending），
  // 真人的投注屏是「一次只买一注」的，与其余 pending 的流程不同。

  if (specialKind === SPECIAL_KIND.DEPARTMENT_STORE) {
    // ★ 百貨公司花的是**點數**，不是钱
    return {
      kind: 'shop',
      points: me.points,
      cards: CARDS.map((c) => ({ id: c.id, name: c.name, price: c.price })),
      tools: TOOLS.map((t) => ({
        id: t.id,
        name: t.name,
        price: t.price,
        // @source give_tool 对编号 > 8 不查库存（见 rules/tools.ts）
        stock: t.id <= STOCKED_TOOL_MAX_ID ? (state.toolStock[t.id] ?? 0) : null,
      })),
      // ★ 手上有什么也要带出来 —— 这一屏能把卡片/道具卖回去换點數（退九成）
      owned: {
        cards: [...new Set(me.cards)].map((id) => ({
          id,
          name: CARDS.find((c) => c.id === id)?.name ?? `卡${id}`,
          refund: resellValue(cardPrice(id)),
        })),
        tools: [...toolsOf(state.tools, state.currentPlayer)].map(([id, count]) => ({
          id,
          name: TOOLS.find((x) => x.id === id)?.name ?? `道具${id}`,
          count,
          refund: resellValue(toolPrice(id)),
        })),
      },
    };
  }

  if (isUnimplementedPlace(specialKind)) return unimplementedPlace(specialKind);
  return null;
}

/**
 * 公佈欄：挂牌、撤件、买下别人的东西。
 *
 * ★ 规则全在 `places/notice-board.ts`，这里只接驳状态与物品转移。
 *   物品转移按类型走各自既有的路子（持股、地產归属、道具、手牌），
 *   **不另起一套**。
 */
/**
 * ★ 电脑回合掷骰前的调度 @source VA 0x00418dc6：
 * ```asm
 * 00418de6  call 0x42bf03            ; 买股（ai/stock-policy.ts）
 * 00418df4  call 0x42c79f            ; 卖股（未译，T-016）
 * 00418dfe  push 0 / call 0x436b0a   ; 特別融資收回：非董事長却欠着的人当场全额还
 * 00418e06  cmp [0x46caf8], 0 / jne  ; 终局码非 0 就不再往下
 * 00418e13  call 0x4284be            ; 公佈欄（1/15 挂、1/3 重估、1/4 买）
 * 00418e18  call rand / test al, 1   ; 1 → 用卡（0x441baa），0 → 用道具（0x447d97）
 * ```
 * 策略层每次只能给一个 action，所以把这条顺序拆成 `aiStep`：
 * 0 买股 → 1 卖股 → 2 用卡|用道具 → 3 掷骰。跨进 2 的那一刻做中间三件事。
 */
function aiAdvance(state: GameState, topo: MapTopology, step: number): GameState {
  let s = state;
  if (s.aiStep < 2 && step >= 2) {
    s = sweepSpecialFinance(s, topo);
    if (s.phase !== 'awaitingRoll') return { ...s, aiStep: step };
    // ★ 三道随机闸都在 reducer 里掷，AI 策略层不碰随机数（与保釋同一做法）
    s = aiNoticeBoardTurn(s, topo);
    const rng = new WatcomRng();
    rng.setState(s.rngState);
    const branch = rng.next() & 1;
    s = { ...s, rngState: rng.getState(), aiBranch: branch };
  }
  return s.aiStep >= step ? s : { ...s, aiStep: step };
}

/** 电脑在 awaitingRoll 做完某一步后把调度步推到 `step`；真人或没生效的 action 原样返回 */
function afterAiStep(before: GameState, after: GameState, topo: MapTopology, step: number): GameState {
  if (after === before || before.phase !== 'awaitingRoll' || after.phase !== 'awaitingRoll') return after;
  const me = before.players[before.currentPlayer];
  if (me === undefined || !isAiControlled(me)) return after;
  return aiAdvance(after, topo, step);
}

/**
 * 特別融資收回 @source VA 0x00436c6d（`0x436b0a(0)`）：
 * 除銀行董事長以外、还欠着特別融資的在场玩家，当场全额扣回
 * （存款 → 现金 → 破產，0x433bd8），再把欠额清零。没有董事長时人人都收。
 */
function sweepSpecialFinance(state: GameState, topo: MapTopology): GameState {
  const chairman = bankChairman(state, topo.commercials);
  let s = state;
  for (let i = 0; i < s.players.length; i++) {
    if (i === chairman) continue;
    const p = s.players[i];
    if (p === undefined || !isAlive(p) || p.specialFinance === 0) continue;
    const r = payFromBank(p, p.specialFinance);
    s = { ...s, players: s.players.map((q, k) => (k === i ? { ...r.player, specialFinance: 0 } : q)) };
    if (r.bankrupt) s = applyBankruptcy(s, i, topo);
  }
  return s;
}

/**
 * 电脑玩家的公佈欄回合 —— 挂东西 / 重估 / 买别人的，逐条照 VA 0x0042886e。
 * 规则常量与判据见 places/notice-board.ts 的 AI 一节。
 */
function aiNoticeBoardTurn(state: GameState, topo: MapTopology): GameState {
  const me = state.currentPlayer;
  const player = state.players[me];
  if (player === undefined || !isAlive(player)) return state;
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  let next: GameState = state;

  // ── ① 1/15：挂一样东西 ──
  if (rng.next() % AI_BOARD_LIST_CHANCE === 0) {
    let listed = false;
    let mine = next.noticeBoard[me] ?? emptyColumn();
    // 卡片：手牌 > 12 且有重复的
    if (player.cards.length > AI_CARD_LIST_MIN_HAND) {
      const dup = duplicateCards(player.cards);
      if (dup.length > 0) {
        const id = dup[rng.next() % dup.length]!;
        // @source 0x0042891b 板满就先撤第 0 格
        if (isColumnFull(mine)) mine = withdrawItem(mine, 0) ?? mine;
        const col = listItem(mine, { kind: LISTING.card, id, price: cardListPrice(id, next.priceIndex), amount: 0 });
        if (col !== null) {
          mine = col;
          listed = true;
        }
      }
    }
    // 道具：没挂成卡片才看
    if (!listed) {
      const candidates: number[] = [];
      for (const t of TOOLS) {
        const n = toolCount(next.tools, me, t.id);
        if (aiWantsToListTool(n, t.f7, player.personality)) candidates.push(t.id);
      }
      if (candidates.length > 0) {
        const id = candidates[rng.next() % candidates.length]!;
        if (isColumnFull(mine)) mine = withdrawItem(mine, 0) ?? mine;
        const col = listItem(mine, { kind: LISTING.tool, id, price: toolListPrice(id, next.priceIndex), amount: 0 });
        if (col !== null) mine = col;
      }
    }
    next = { ...next, noticeBoard: next.noticeBoard.map((c, i) => (i === me ? mine : c)) };
  }

  // ── ② 1/3：按当前物價重估自己挂着的道具/卡片 ──
  if (rng.next() % AI_BOARD_REPRICE_CHANCE === 0) {
    const mine = (next.noticeBoard[me] ?? emptyColumn()).map((it) => {
      if (it === null) return it;
      if (it.kind === LISTING.tool) return { ...it, price: toolListPrice(it.id, next.priceIndex) };
      if (it.kind === LISTING.card) return { ...it, price: cardListPrice(it.id, next.priceIndex) };
      return it;
    });
    next = { ...next, noticeBoard: next.noticeBoard.map((c, i) => (i === me ? mine : c)) };
  }

  // ── ③ 1/4：去买别人挂的股票或地產，成交一件即止 ──
  if (rng.next() % AI_BOARD_SHOP_CHANCE === 0) {
    outer: for (let seller = 0; seller < next.players.length; seller++) {
      if (seller === me) continue;
      const him = next.players[seller];
      if (him === undefined || !isAlive(him)) continue;
      const col = next.noticeBoard[seller] ?? emptyColumn();
      for (let slot = 0; slot < col.length; slot++) {
        const it = col[slot];
        if (it === null || it === undefined) continue;
        let want = false;
        if (it.kind === LISTING.stock) {
          want = aiWantsListedStock(it.price, it.amount, next.market.stocks[it.id]?.price ?? 0);
        } else if (it.kind === LISTING.estate) {
          const e = decodeEstate(it.id);
          const v =
            e.kind === 'land'
              ? effectiveLand(next, topo, e.index)
              : effectiveFacility(next, topo, e.index);
          if (v === null) continue;
          const valuation = estateListPrice(v.landPrice, v.level, v.housePrice, next.priceIndex);
          want = aiWantsListedEstate(it.price, valuation, next.players[me]?.cash ?? 0);
        }
        if (!want) continue;
        const bought = noticeBoardAction({ ...next, rngState: rng.getState() }, topo, {
          type: 'noticeBoard',
          op: 'buy',
          seller,
          slot,
        });
        if (bought !== next) {
          next = bought;
          break outer;
        }
      }
    }
  }

  return { ...next, rngState: rng.getState() };
}

function noticeBoardAction(
  state: GameState,
  topo: MapTopology,
  action: Action & { type: 'noticeBoard' },
): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;
  const board = state.noticeBoard;

  if (action.op === 'withdraw') {
    const col = withdrawItem(board[state.currentPlayer] ?? emptyColumn(), action.slot);
    if (col === null) return state;
    return { ...state, noticeBoard: board.map((c, i) => (i === state.currentPlayer ? col : c)) };
  }

  if (action.op === 'list') {
    // @source 0x00427ee6：七格满了就挂不上（原版弹「公佈欄已滿，請先撤件！」）
    const mine = board[state.currentPlayer] ?? emptyColumn();
    if (!Number.isInteger(action.price) || action.price <= 0) return state;
    if (!ownsListing(state, topo, state.currentPlayer, action.kind, action.id, action.amount ?? 0)) {
      return state;
    }
    const col = listItem(mine, {
      kind: action.kind as ListingKind,
      id: action.id,
      price: Math.trunc(action.price),
      amount: Math.trunc(action.amount ?? 0),
    });
    if (col === null) return state;
    return { ...state, noticeBoard: board.map((c, i) => (i === state.currentPlayer ? col : c)) };
  }

  // ── 买 ──
  const seller = action.seller;
  const item = board[seller]?.[action.slot] ?? null;
  if (canBuyListing(state, state.currentPlayer, seller, item) !== null || item === null) {
    return state;
  }
  const moved = transferListing(state, topo, state.currentPlayer, seller, item);
  if (moved === null) return state;
  const buyerP = moved.players[state.currentPlayer];
  const sellerP = moved.players[seller];
  if (buyerP === undefined || sellerP === undefined) return state;
  // @source 0x004258ac `pay_money(買家, 賣家, 價, 0)` —— 付的是**现金**
  const paid = settlePayment(buyerP, sellerP, item.price);
  const players = moved.players.map((p, i) =>
    i === state.currentPlayer ? paid.buyer : i === seller ? paid.seller : p,
  );
  // 成交后那一格要撤掉
  const col = withdrawItem(moved.noticeBoard[seller] ?? emptyColumn(), action.slot);
  return {
    ...moved,
    players,
    noticeBoard: moved.noticeBoard.map((c, i) => (i === seller ? (col ?? c) : c)),
  };
}

/** 挂牌前先确认「这东西确实是你的」—— 否则谁都能挂别人的地 */
function ownsListing(
  state: GameState,
  topo: MapTopology,
  player: number,
  kind: number,
  id: number,
  amount: number,
): boolean {
  const p = state.players[player];
  if (p === undefined) return false;
  switch (kind) {
    case LISTING.stock:
      return amount > 0 && (state.holdings[player]?.[id]?.amount ?? 0) >= amount;
    case LISTING.estate: {
      const e = decodeEstate(id);
      if (e.kind === 'land') return (state.landOwner[e.index] ?? 0) === player + 1;
      return (state.facilityOwner[e.index] ?? 0) === player + 1;
    }
    case LISTING.tool:
      return toolCount(state.tools, player, id) > 0;
    case LISTING.card:
      return p.cards.includes(id);
    default:
      return false;
  }
}

/** 按类型把东西从卖家转到买家；转不动返回 null */
function transferListing(
  state: GameState,
  topo: MapTopology,
  buyer: number,
  seller: number,
  item: Listing,
): GameState | null {
  switch (item.kind) {
    case LISTING.stock: {
      // @source 0x0042565c：买家持股 += 股數、卖家 −=；卖家清零时均价也归零
      const holdings = state.holdings.map((row) => row.map((h) => ({ ...h })));
      const from = holdings[seller]?.[item.id];
      const to = holdings[buyer]?.[item.id];
      if (from === undefined || to === undefined || from.amount < item.amount) return null;
      // 买家的均价按「原成本 + 买价」重算，走与柜台买入同一条
      // `recalcAvgCost`（原版把均价存成 32 位 float，那里已经对齐了精度）
      const next = recalcAvgCost(to, item.amount, item.price);
      to.amount = next.amount;
      to.avgCost = next.avgCost;
      from.amount -= item.amount;
      // @source 0x004256bc：卖家清零时均价也归零
      if (from.amount === 0) from.avgCost = 0;
      return { ...state, holdings };
    }
    case LISTING.estate: {
      const e = decodeEstate(item.id);
      // @source 0x004257c3 `mov byte [地塊或設施 + 0x19], 當前玩家+1` —— 两路汇合到同一句，
      //   只改归属；等级/种类/到期日都留在原处
      if (e.kind === 'land') {
        const landOwner = [...state.landOwner];
        if (landOwner[e.index] !== seller + 1) return null;
        landOwner[e.index] = buyer + 1;
        return { ...state, landOwner };
      }
      const facilityOwner = [...state.facilityOwner];
      if (facilityOwner[e.index] !== seller + 1) return null;
      facilityOwner[e.index] = buyer + 1;
      return { ...state, facilityOwner };
    }
    case LISTING.tool: {
      // @source 0x0042580d `take_tool(賣家, id)` + 0x00425826 `give_tool(買家, id)`
      const taken = takeTool(state.tools, state.toolStock, seller, item.id);
      const given = giveTool(taken.tools, taken.stock, buyer, item.id);
      if (!given.given) return null;
      return { ...state, tools: given.tools, toolStock: given.stock };
    }
    case LISTING.card: {
      // @source 0x0042587a 移除卖家的、0x00425893 给买家
      const players = state.players.map((p) => ({ ...p, cards: [...p.cards] }));
      const from = players[seller];
      const to = players[buyer];
      if (from === undefined || to === undefined) return null;
      const at = from.cards.indexOf(item.id);
      if (at < 0) return null;
      from.cards.splice(at, 1);
      to.cards.push(item.id);
      return { ...state, players };
    }
    default:
      return null;
  }
}

/**
 * 在百貨公司买卖。
 *
 * ★ 规则全在 `places/shop.ts`，这里只接驳状态。
 *   成功后**保持 `pending`**——原版的商店是个模态窗口，
 *   一次可以买好几样，直到玩家自己关掉（`declineDecision`）。
 */
/**
 * 走进百貨公司。
 *
 * @source `_rich4_ui_shop_entry`（0x0042e9xx）：
 * 1. 董事長（行業別 10 那家企業的 owner）是进门的人 → `rand() & 1`：送一件库存里的
 *    随机道具（0x445ada），否则送一张牌堆里的随机卡（0x441e12）；
 * 2. 抄一份牌堆，抽 `rand()%10+6` 件卡片上货架（加权、不放回）；
 * 3. 道具货架 = 1..8 号里库存 > 0 的全部。
 * 货架进 `pending.cards` / `pending.tools`，买卡只认货架上有的、买一件少一件。
 */
function enterShop(state: GameState, topo: MapTopology): GameState {
  const me = state.currentPlayer;
  const player = state.players[me];
  if (player === undefined) return { ...state, phase: 'turnEnd' };
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  let next: GameState = state;

  // ① 董事長進門有禮
  if (chairmanOfIndustry(next, topo.commercials, STORE_INDUSTRY) === me) {
    if ((rng.next() & 1) !== 0) {
      const toolId = drawGiftTool(next.toolStock, rng.next());
      if (toolId !== 0) {
        const g = giveTool(next.tools, next.toolStock, me, toolId);
        next = { ...next, tools: g.tools, toolStock: g.stock };
      }
    } else {
      const cardId = drawRandomCard(rng, next.cardAmount);
      if (cardId !== 0) {
        const cardAmount = [...next.cardAmount];
        cardAmount[cardId - 1] = (cardAmount[cardId - 1] ?? 0) - 1;
        next = withPlayer({ ...next, cardAmount }, me, (p) => {
          if (p.cards.length < MAX_HAND_CARDS) p.cards = [...p.cards, cardId];
        });
      }
    }
  }

  // ② ③ 货架
  const shelf = drawCardShelf(next.cardAmount, rng);
  const tools = toolShelf(next.toolStock);
  const owner = next.players[me]!;
  return {
    ...next,
    rngState: rng.getState(),
    pending: {
      kind: 'shop',
      points: owner.points,
      cards: shelf.map((id) => ({ id, name: CARDS.find((c) => c.id === id)?.name ?? `卡${id}`, price: cardPrice(id) })),
      tools: tools.map((id) => ({
        id,
        name: TOOLS.find((t) => t.id === id)?.name ?? `道具${id}`,
        price: toolPrice(id),
        stock: next.toolStock[id] ?? 0,
      })),
      owned: {
        cards: [...new Set(owner.cards)].map((id) => ({
          id,
          name: CARDS.find((c) => c.id === id)?.name ?? `卡${id}`,
          refund: resellValue(cardPrice(id)),
        })),
        tools: [...toolsOf(next.tools, me)].map(([id, count]) => ({
          id,
          name: TOOLS.find((x) => x.id === id)?.name ?? `道具${id}`,
          count,
          refund: resellValue(toolPrice(id)),
        })),
      },
    },
  };
}

function shopAction(state: GameState, action: Action & { type: 'shop' }): GameState {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'shop') return state;
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;

  const commit = (
    player: Player,
    tools: readonly number[] = state.tools,
    stock: readonly number[] = state.toolStock,
  ): GameState => ({
    ...state,
    players: state.players.map((p, i) => (i === state.currentPlayer ? player : p)),
    tools: [...tools],
    toolStock: [...stock],
    // 刷新待决交互里的點數，商店还开着
    pending: { ...pending, points: player.points },
  });

  switch (action.op) {
    case 'buyCard': {
      // ★ 只认货架上有的；买一件少一件（货架是从牌堆抽的，牌堆本身由 buyCard 扣）
      const at = pending.cards.findIndex((c) => c.id === action.id);
      if (at === -1) return state;
      const r = buyCard(me, action.id);
      if (!r.ok) return state;
      const bought = commit(r.player);
      const cards = pending.cards.filter((_, i) => i !== at);
      return { ...bought, pending: { ...pending, points: r.player.points, cards } };
    }
    case 'sellCard': {
      const r = sellCard(me, action.id);
      return r.ok ? commit(r.player) : state;
    }
    case 'buyTool': {
      // ★ 与 buyCard 同构：买一件少一件 —— 原版两页都这么干
      //   @source `rich4_shop.asm` 0x42e466 尾 `mov byte [ebx + 0x48c2f8], 0`
      //
      // ⚠️ 这一条**必须**同时保证「AI 不会提一个货架上没有的购买」：
      //   `ai/policy.ts` 的 shop 分支是按「买得起 + 装得下」挑的，不查货架；
      //   删掉之后 reducer 会拒，而 AI 是纯函数、被拒就原样重提 —— 立刻卡死在
      //   `turnEnd / shop`（`soak.test.ts` 抓得住）。所以那边也加了货架判据。
      const at = pending.tools.findIndex((t) => t.id === action.id);
      if (at === -1) return state;
      const r = buyTool(me, state.tools, state.toolStock, action.id);
      if (!r.ok) return state;
      const bought = commit(r.player, r.tools, r.stock);
      const tools = pending.tools.filter((_, i) => i !== at);
      return { ...bought, pending: { ...pending, points: r.player.points, tools } };
    }
    case 'sellTool': {
      const r = sellTool(me, state.tools, state.toolStock, action.id, action.count ?? 1);
      return r.ok ? commit(r.player, r.tools, r.stock) : state;
    }
    default:
      return state;
  }
}

// ============================================================
//  设施落点
// ============================================================

/** 玩家脚下的设施；不是设施格则返回 null */
function facilityAtPlayer(state: GameState, topo: MapTopology): FacilityInfo | null {
  const p = state.players[state.currentPlayer];
  if (p === undefined || topo.facilities === undefined) return null;
  const node = topo.nodes[p.nodeId - 1];
  if (node === undefined) return null;
  const idx = facilityIndexOf(node.type);
  if (idx === null) return null;
  // ★ 走 effective —— 归属/等级/种类都在状态里，静态表是开局初值
  return effectiveFacility(state, topo, idx);
}

/**
 * 免费给一处設施加蓋一级（機器工人 / 魔法屋「就地加蓋」共用）。
 *
 * @source `0x40b110` 的設施段（0x0040b188 起）：
 * ```asm
 * 0040b1a0  if (level == 0) {
 * 0040b1ad    if (who_plays & 6) {                      ; 电脑 / 托管
 * 0040b1c1      if (owner == 當前 + 1) type = rand() % 4 + 1
 * 0040b1dc      else                   type = 0          ; ★ 替别人蓋 → 公園
 *             } else type = 0x440aac(0)                 ; 真人选种类
 * 0040b1f4    level = 1
 *           } else {
 * 0040b201    if (level >= MAX[type]) 失败
 * 0040b212    level++
 *           }
 * ```
 * ★ 与住宅那段一样**不看归属**——给别人的地也盖；只是电脑替别人盖的时候一律盖公園。
 *
 * @param chosenType 真人对等级 0 的設施要给的种类（0..4）；不给就失败（UI 属 P2-14）
 */
function freeBuildFacility(
  state: GameState,
  topo: MapTopology,
  nodeId: number,
  chosenType: number,
): GameState | null {
  const node = topo.nodes[nodeId - 1];
  if (node === undefined) return null;
  const idx = facilityIndexOf(node.type);
  if (idx === null) return null;
  return freeBuildFacilityById(state, topo, idx, chosenType);
}

function freeBuildFacilityById(
  state: GameState,
  topo: MapTopology,
  idx: number,
  chosenType: number,
): GameState | null {
  const fac = effectiveFacility(state, topo, idx);
  if (fac === null) return null;
  const me = state.currentPlayer;
  const player = state.players[me];
  if (player === undefined) return null;

  const facilityLevel = [...state.facilityLevel];
  const facilityType = [...state.facilityType];
  if (fac.level === 0) {
    let type: number;
    let rngState = state.rngState;
    if ((player.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_HUMAN) {
      if (fac.owner === me + 1) {
        const rng = new WatcomRng();
        rng.setState(rngState);
        type = aiPickFacilityType(rng.next());
        rngState = rng.getState();
      } else {
        type = FACILITY_TYPE.park;
      }
    } else {
      if (!Number.isInteger(chosenType) || chosenType < 0 || chosenType > FACILITY_TYPE.lab) return null;
      type = chosenType;
    }
    facilityType[idx] = type;
    facilityLevel[idx] = 1;
    return { ...state, facilityType, facilityLevel, rngState };
  }
  if (!canUpgradeFacility(fac.type, fac.level)) return null;
  facilityLevel[idx] = fac.level + 1;
  return { ...state, facilityLevel };
}

/**
 * 按实体编码免费加蓋一级（建設公司那一路）：0x7d0+地块 → 住宅那套；0xfa0+設施 → 設施那套。
 * `chosenType` 只对等级 0 的設施有意义（真人 −1 = 没选 → 失败）。
 */
function freeBuildEntity(
  state: GameState,
  topo: MapTopology,
  entityId: number,
  chosenType: number,
): GameState | null {
  const e = decodeEstate(entityId);
  if (e.kind === 'land') {
    const land = effectiveLand(state, topo, e.index);
    if (land === null) return null;
    const b = buildOneLevel(land.type, land.level, MAX_LAND_LEVEL);
    if (!b.ok) return null;
    const landLevel = [...state.landLevel];
    landLevel[land.id] = b.level;
    return { ...state, landLevel };
  }
  return freeBuildFacilityById(state, topo, e.index, chosenType);
}

/** 实体（地块/設施）的地價 —— 建設公司算工程費用 @source 0x0041adc7 / 0x0041ade3 */
function entityLandPrice(state: GameState, topo: MapTopology, entityId: number): number {
  const e = decodeEstate(entityId);
  if (e.kind === 'land') return effectiveLand(state, topo, e.index)?.landPrice ?? 0;
  return effectiveFacility(state, topo, e.index)?.landPrice ?? 0;
}

/** 当前玩家名下可加蓋的实体编码（给建設公司的选择框） */
function buildableEntities(state: GameState, topo: MapTopology, player: number, human: boolean): number[] {
  const out: number[] = [];
  for (const l of topo.lands ?? []) {
    if ((state.landOwner[l.id] ?? 0) !== player + 1) continue;
    const eff = effectiveLand(state, topo, l.id);
    if (eff !== null && buildOneLevel(eff.type, eff.level, MAX_LAND_LEVEL).ok) out.push(0x7d0 + l.id);
  }
  for (const f of topo.facilities ?? []) {
    if ((state.facilityOwner[f.id] ?? 0) !== player + 1) continue;
    const level = state.facilityLevel[f.id] ?? 0;
    const type = state.facilityType[f.id] ?? 0;
    // 真人对等级 0 的設施还得选种类，那个界面属 P2 —— 先不列进来
    if (level === 0 && human) continue;
    if (level === 0 || canUpgradeFacility(type, level)) out.push(0xfa0 + f.id);
  }
  return out;
}

/**
 * 保險理賠 @source 0x0044ba63(玩家, 損失, 旗标)：
 * ```asm
 * 0044ba74  if (玩家.+0x3e 保險期 == 0) return
 * 0044ba82  ebx = 第一家 行業別 == 4（保險）的企業（从头扫，命中即停）
 * 0044bad8  pay_money(100 + ebx, 玩家, 損失, 1)      ; ★ 第三个参数没用到，一律進現金
 * ```
 * 六个调用点（Q-INS-1 已找齐）：住旅館的 2000×天×物價（0x0041a82d 落点 / 0x0040d425 通用住店）、
 * 坐牢 2000×天×物價（0x0043d749）、住院 2000×天×物價（0x0043edf8）、命運「冒貸」的金额（0x0044c218）、
 * 命運「行人闖越馬路罰款」（0x0044cf11）。
 * ⚠️ 没有保險公司的地图上原版会写到企業表外（ebx = 家数 + 1），本引擎不赔，记 Q-INS-2。
 */
export function insurancePayoutTo(state: GameState, topo: MapTopology, index: number, loss: number): GameState {
  const p = state.players[index];
  if (p === undefined || !isAlive(p) || p.insuranceDays === 0 || loss <= 0) return state;
  const co = (topo.commercials ?? []).find((c) => c.type === INDUSTRY.insurance);
  if (co === undefined) return state;
  const companies: Company[] = state.companyFunds.map((f, i) => ({ funds: f, fundsMirror: state.companyProfit[i] ?? 0 }));
  const r = transferMoney(state.players, companies, state.pool, companyParty(co.id), index, loss, PAY_FLAG_CREDIT_TO_CASH);
  return {
    ...state,
    players: r.players,
    pool: r.pool,
    companyFunds: r.companies.map((c) => c.funds),
    companyProfit: r.companies.map((c) => c.fundsMirror),
  };
}

/** 住店／坐牢／住院的「意外損失」= 2000 × 天 × 物價，保險期内由保險公司赔 @source 0x0040d402 / 0x0043d72c / 0x0043edd9 */
/** 命運「行人闖越馬路罰款」的事件号（0x0044cd99，尾部 0x0044cf11 调保險） */
const FORTUNE_JAYWALK_FINE = 14;

function insureConfinement(state: GameState, topo: MapTopology, index: number, days: number): GameState {
  return insurancePayoutTo(state, topo, index, hotelStayLoss(days, state.priceIndex));
}

/**
 * 玩家付一笔費给公司 —— 进 `companyFunds`，付款走 `transferMoney`（现金→存款→破產）。
 * @source 0x0041b022 `pay_money(付款人, 企業編碼 − 0x170c, 費, 0)`
 */
function payCompany(
  state: GameState,
  topo: MapTopology,
  payer: number,
  commercialId: number,
  amount: number,
): GameState {
  if (amount <= 0) return state;
  // ★ +0x28 与 +0x2c 同进同出（0x0041d3a5/0x0041d3a9）；分紅只清前者
  const companies: Company[] = state.companyFunds.map((f, i) => ({
    funds: f,
    fundsMirror: state.companyProfit[i] ?? 0,
  }));
  const r = transferMoney(state.players, companies, state.pool, payer, companyParty(commercialId), amount, 0);
  const companyFunds = r.companies.map((c) => c.funds);
  const companyProfit = r.companies.map((c) => c.fundsMirror);
  const paid: GameState = { ...state, players: r.players, pool: r.pool, companyFunds, companyProfit };
  return r.bankrupted ? applyBankruptcy(paid, payer, topo) : paid;
}

/** 公司落点收尾：照原版走到出口时再问一次「是否認購股份」（0x0041d1a9） */
function afterCompany(state: GameState, topo: MapTopology, commercialId: number): GameState {
  const me = state.players[state.currentPlayer];
  const node = me === undefined ? undefined : topo.nodes[me.nodeId - 1];
  const shares = node === undefined ? null : pendingForCommercial(state, topo, node);
  if (shares !== null && shares.kind === 'buyShares' && shares.commercialId === commercialId) {
    return { ...state, phase: 'turnEnd', pending: shares };
  }
  return { ...state, phase: 'turnEnd', pending: null };
}

/**
 * 走到上市企業上。
 *
 * @source 0x0041a9ca（自家）/ 0x0041ab6d（别人的）；规则本体在 places/company.ts。
 *   出口一律回到 0x0041b067 → `0x41d1a9`：那里再问「是否認購股份」，故三路之后都接 afterCompany。
 */
function landOnCompany(state: GameState, topo: MapTopology, node: MapNode): GameState {
  const ref = node.ref;
  if (ref.kind !== 'commercial') return { ...state, phase: 'turnEnd' };
  const c = topo.commercials?.find((x) => x.id === ref.index);
  const me = state.currentPlayer;
  const player = state.players[me];
  if (c === undefined || player === undefined) return { ...state, phase: 'turnEnd' };
  const chairman = ownerOf(state.commercialOwners[c.id] ?? emptyOwnership());
  const human = (player.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN;
  const rng = new WatcomRng();
  rng.setState(state.rngState);

  // ── 自家公司：董事長的好处 ──
  if (chairman === me) {
    const eff = chairmanEffect(c.type, c.type === INDUSTRY.insurance ? rng.next() : 0);
    let next: GameState = { ...state, rngState: rng.getState() };
    if (eff.kind === 'insurance') {
      next = withPlayer(next, me, (p) => {
        p.insuranceDays = addInsuranceDays(p.insuranceDays, eff.days);
      });
    } else if (eff.kind === 'construction') {
      if (!human) {
        const target = aiPickConstructionTarget(
          me, topo.lands ?? [], next.landOwner, next.landLevel, next.landType,
          topo.facilities ?? [], next.facilityOwner, next.facilityLevel, next.facilityType,
        );
        if (target !== 0) next = freeBuildEntity(next, topo, target, -1) ?? next;
      } else {
        const choices = buildableEntities(next, topo, me, true);
        if (choices.length > 0) {
          return {
            ...next,
            phase: 'turnEnd',
            pending: { kind: 'chooseBuildTarget', commercialId: c.id, name: c.name, choices, charge: false },
          };
        }
      }
    }
    return afterCompany(next, topo, c.id);
  }

  // ── 无主：只问認購 ──
  if (chairman < 0) return afterCompany(state, topo, c.id);

  // ── 别人的：按行業收費 ──
  const fee = companyFeeOnLanding(
    c.type, c.landPrice, state.priceIndex, state.totalDays, player.trafficMethod, state.stepsTotal,
    industryUsesWheel(c.type) ? rng.next() : 0,
  );
  let next: GameState = { ...state, rngState: rng.getState() };
  if (fee.kind === 'fee') {
    next = payCompany(next, topo, me, c.id, fee.amount);
  } else if (fee.kind === 'insurance') {
    next = withPlayer(next, me, (p) => {
      p.insuranceDays = addInsuranceDays(p.insuranceDays, fee.days);
    });
    next = payCompany(next, topo, me, c.id, fee.amount);
  } else if (fee.kind === 'construction') {
    if (!human) {
      const target = aiPickConstructionTarget(
        me, topo.lands ?? [], next.landOwner, next.landLevel, next.landType,
        topo.facilities ?? [], next.facilityOwner, next.facilityLevel, next.facilityType,
      );
      if (target !== 0) {
        const built = freeBuildEntity(next, topo, target, -1);
        if (built !== null) {
          next = payCompany(built, topo, me, c.id, entityLandPrice(built, topo, target) * built.priceIndex);
        }
      }
    } else {
      const choices = buildableEntities(next, topo, me, true);
      if (choices.length > 0) {
        return {
          ...next,
          phase: 'turnEnd',
          pending: { kind: 'chooseBuildTarget', commercialId: c.id, name: c.name, choices, charge: true },
        };
      }
    }
  }
  // 付費付到破產：人已出局，但阶段得收到 turnEnd，否则没人能推进这个回合
  if (next.phase === 'gameOver') return next;
  if (!isAlive(next.players[me]!)) return { ...next, phase: 'turnEnd', pending: null };
  return afterCompany(next, topo, c.id);
}

/**
 * 当前玩家名下每一处研究所推进一天；到期就发道具。
 *
 * @source VA 0x0041cd97 的循环（逐处設施：`type == 4` → 业主是当前玩家 → 倒数）。
 *   规则本体在 rules/facility.ts 的 `tickResearch`：項目等级高过设施等级就作废，
 *   归零那一刻 `give_tool(業主, 項目 + 8)`。
 */
function tickOwnResearch(state: GameState, topo: MapTopology): GameState {
  const me = state.currentPlayer;
  let tools = state.tools;
  let toolStock = state.toolStock;
  const project = [...state.facilityResearchProject];
  const days = [...state.facilityResearchDays];
  let touched = false;
  for (const f of topo.facilities ?? []) {
    if ((state.facilityType[f.id] ?? 0) !== FACILITY_TYPE.lab) continue;
    if ((state.facilityOwner[f.id] ?? 0) !== me + 1) continue;
    const r = tickResearch(
      { project: project[f.id] ?? 0, daysLeft: days[f.id] ?? 0 },
      state.facilityLevel[f.id] ?? 0,
    );
    if (r.next.daysLeft === (days[f.id] ?? 0) && r.produced === 0) continue;
    touched = true;
    project[f.id] = r.next.project;
    days[f.id] = r.next.daysLeft;
    if (r.produced !== 0) {
      // @source 0x0041ce25 give_tool —— 不查上限，給不出去就凭空消失（与搶奪卡同理）
      const g = giveTool(tools, toolStock, me, r.produced);
      tools = g.tools;
      toolStock = g.stock;
    }
  }
  if (!touched) return state;
  return { ...state, tools, toolStock, facilityResearchProject: project, facilityResearchDays: days };
}


/**
 * 落点收尾：站在**自己的已建研究所**上就开研究所面板 @source 0x0041b0b3..0x0041b109：
 * ```asm
 * 0041b0ba  code ∈ 4001..5999（設施）
 * 0041b0d1  owner == 我 + 1
 * 0041b0e6  我.+0x37（夢遊）== 0
 * 0041b0f6  type == 4（研究所） && level != 0
 * 0041b102  (+0x1c & 0xf) == 0                 ; 没被查封（設施的查封位，T-008 才进状态）
 * 0041b109  call 0x44101d(設施)                ; 面板：真人 0x4402d7 点选；电脑 0x4411e7
 * ```
 * 电脑分支（0x4411e7..0x4411fb）：`項目 = level; 天数 = 5`，**不看是否正在研發**——原样覆盖。
 * 这一步在加蓋问答**之后**（加蓋在 0x0041a2b3，收尾在 0x0041b0b3）。
 */
function afterOwnLab(state: GameState, topo: MapTopology, facilityId: number): GameState {
  const me = state.currentPlayer;
  const player = state.players[me];
  const fac = effectiveFacility(state, topo, facilityId);
  if (player === undefined || fac === null) return state;
  if (fac.owner !== me + 1 || fac.type !== FACILITY_TYPE.lab || fac.level === 0) return state;
  if (player.blocking.sleepWalking !== 0) return state;
  // @source 0x0041b102 `test byte [設施+0x1c], 0xf / jne 跳过` ——
  //   **被查封**的研究所不开面板（涨价位 0x50 的低半字节是 0，不受影响）。
  if (isSealedStrict(fac.priceStatus)) return state;
  if ((player.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_HUMAN) {
    const started = startResearch(aiPickResearchProject(fac.level), fac.level);
    if (started === null) return state;
    const facilityResearchProject = [...state.facilityResearchProject];
    const facilityResearchDays = [...state.facilityResearchDays];
    facilityResearchProject[fac.id] = started.project;
    facilityResearchDays[fac.id] = started.daysLeft;
    return { ...state, facilityResearchProject, facilityResearchDays, phase: 'turnEnd' };
  }
  const choices: number[] = [];
  for (let p = RESEARCH_MIN_PROJECT; p <= fac.level && p <= RESEARCH_MAX_PROJECT; p++) choices.push(p);
  return {
    ...state,
    phase: 'awaitingDecision',
    pending: { kind: 'research', facilityId: fac.id, name: fac.name, level: fac.level, choices },
  };
}

/**
 * 走到設施上 —— 原版 0x0041a199 起的整段，按「谁的」分三路：
 *
 * ```asm
 * 0041a1b9  if (owner == 0)          goto 買（0x0041a86b）
 * 0041a1d6  if (owner != 我)         goto 收費（0x0041a370）
 * 0041a1f2  if (level == 0)          goto 首建・选种类（0x0041a1fc）
 *           else                     goto 加蓋（0x0041a2b3）
 * ```
 *
 * 收費那一路（0x0041a370）：
 * ```asm
 * 0041a377  if (level == 0) 结束                ; 空地不收
 * 0041a386  if (type == 0 公園) 结束
 * 0041a38f  if (type >= 4 研究所) 结束
 * 0041a3cc  call 0x41d559(地主, 涨价位, 费名)   ; 查封中/同盟中/死神 → 免收
 * 0041a404  按 type 分三路（见 rules/facility.ts）
 * 0041a75e  mov [設施 + 0x30], 實付                ; ★ 记下上次過路費（間諜要用）
 * 0041a768  if (type == 1 旅館) 住店（0x0041a7aa）
 * ```
 *
 * ⚠️ 收費前的三条免收（查封／同盟／死神顯靈）与住宅那条共用 `0x41d559`，
 *   本引擎的住宅那边已在 rules/rent.ts 做了同盟分账；設施这一路**没有同盟分账**
 *   （只一次 pay_money），照原版。查封／死神两条見 Q-FAC-2。
 */
function landOnFacility(state: GameState, topo: MapTopology, fac: FacilityInfo): GameState {
  const me = state.currentPlayer;
  const player = state.players[me];
  if (player === undefined) return { ...state, phase: 'turnEnd' };

  // ── 无主：买不买 ──
  if (fac.owner === 0) {
    // @source 0x0041a86b `cmp [+0x37] 梦游, 0 / jne 结束`；`cmp [+0x3f] 神明, 0xc / je 结束`（土地公）
    const price = facilityBuyPrice(fac.landPrice, state.priceIndex);
    if (price > player.cash || purchaseBlockedBy(player) !== null) return { ...state, phase: 'turnEnd' };
    return {
      ...state,
      phase: 'awaitingDecision',
      pending: { kind: 'buyFacility', facilityId: fac.id, name: fac.name, price },
    };
  }

  // ── 自己的：首建 / 加蓋 ──
  if (fac.owner === me + 1) {
    // @source 0x0041a1de `cmp [+0x37], 0 / jne 结束` —— 梦游中不能建
    if (player.blocking.sleepWalking !== 0) return { ...state, phase: 'turnEnd' };
    if (fac.level === 0) {
      const price = facilityBuildPrice(fac.landPrice, state.priceIndex);
      if (price > player.cash || purchaseBlockedBy(player) !== null) return { ...state, phase: 'turnEnd' };
      // @source 0x0041a21f `cmp who_plays, 1 / jne` —— 不是真人就 `rand() % 4 + 1` 当场定种类
      if ((player.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_HUMAN) {
        const rng = new WatcomRng();
        rng.setState(state.rngState);
        const chosen = aiPickFacilityType(rng.next());
        const bought = purchase(player, price);
        if (!bought.ok) return { ...state, rngState: rng.getState(), phase: 'turnEnd' };
        const paid = withPlayer({ ...state, rngState: rng.getState() }, me, (p) => {
          p.cash = bought.player.cash;
        });
        const facilityType = [...paid.facilityType];
        const facilityLevel = [...paid.facilityLevel];
        facilityType[fac.id] = chosen;
        facilityLevel[fac.id] = 1;
        return { ...paid, facilityType, facilityLevel, phase: 'turnEnd' };
      }
      return {
        ...state,
        phase: 'awaitingDecision',
        pending: {
          kind: 'buildFacility',
          facilityId: fac.id,
          name: fac.name,
          price,
          choices: [0, 1, 2, 3, 4],
        },
      };
    }
    if (!canUpgradeFacility(fac.type, fac.level)) return afterOwnLab({ ...state, phase: 'turnEnd' }, topo, fac.id);
    const cost = facilityUpgradePrice(fac.housePrice, state.priceIndex);
    if (cost > player.cash || purchaseBlockedBy(player) !== null) {
      return afterOwnLab({ ...state, phase: 'turnEnd' }, topo, fac.id);
    }
    return {
      ...state,
      phase: 'awaitingDecision',
      pending: { kind: 'upgradeFacility', facilityId: fac.id, name: fac.name, cost, level: fac.level },
    };
  }

  // ── 别人的：收費 ──
  return settleFacility(state, topo, fac);
}

/**
 * 设施过路费结算（别人的設施）。
 *
 * ★ 与住宅的两处根本差别（见 rules/facility.ts）：
 * - 按 `type` 分三路：1 旅館 / 2 購物中心 是单价 × 轉盤，3 加油站 是**掷骰步数** × 500 × 交通倍率
 * - **没有同盟分账**——原版这条路径只有一次 pay_money，收款方直接取自 `facility.owner`
 *
 * 旅館那一路轉盤转出来的数**既是倍数也是住几天**（@source 0x0041a460 起，
 * 同一个 eax 先乘单价、再写进 `+0x32 days_in_hotel`）。
 */
function settleFacility(state: GameState, topo: MapTopology, fac: FacilityInfo): GameState {
  const payer = state.currentPlayer;
  const me = state.players[payer];
  if (me === undefined) return { ...state, phase: 'turnEnd' };

  const ownerIdx = fac.owner - 1;
  // @source 0x0041a377 空地不收；0x0041a386/0x0041a38f 公園、研究所不收
  if (fac.level === 0) return { ...state, phase: 'turnEnd' };
  if (fac.type === FACILITY_TYPE.park || fac.type === FACILITY_TYPE.lab) return { ...state, phase: 'turnEnd' };
  // @source 0x0041a3cc call 0x41d559 —— 九种免收（設施的查封位未进状态，先用地图静态值）
  const landlord = state.players[ownerIdx];
  if (landlord === undefined || tollExemption(landlord, payer, fac.priceStatus) !== null) return { ...state, phase: 'turnEnd' };

  const rng = new WatcomRng();
  rng.setState(state.rngState);
  let multiplier = 1;
  let hotelDays = 0;
  if (fac.type === FACILITY_TYPE.hotel) {
    multiplier = spinWheel(WHEEL.hotel, rng.next());
    hotelDays = multiplier;
  } else if (fac.type === FACILITY_TYPE.mall) {
    multiplier = spinWheel(WHEEL.mall, rng.next());
  }

  const base = calculateFacilityToll({
    facility: fac,
    rateByLevel: fac.rateByLevel,
    priceIndex: state.priceIndex,
    stepsTotal: state.stepsTotal,
    trafficMethod: me.trafficMethod,
    multiplier,
  });
  const withRng: GameState = { ...state, rngState: rng.getState() };
  if (base === 0) return { ...withRng, phase: 'turnEnd' };

  // 神明在付款前调整金额（与住宅同一条规则）
  const god = adjustTollByGod(base, me.godInfo);
  if (god.toll === 0) return { ...withRng, phase: 'turnEnd' };

  // ★ 尾巴照 0x0041a648 起：嫁禍卡（設施这条没有免費卡）→ 死神顯靈由他人賠償（費 != 0 或是旅館）
  const tail = tollPassiveTail(withRng.players, payer, god.toll, state.priceIndex, false, () => rng.next());
  let players = withRng.players;
  let who = payer;
  if (tail.scapegoat !== -1) {
    players = players.map((p, i) => (i === who ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p));
    who = tail.scapegoat;
  }
  if (god.toll !== 0 || fac.type === FACILITY_TYPE.hotel) {
    const reaper = reaperPayer(players, who);
    if (reaper !== -1) who = reaper;
  }
  const withTail: GameState = { ...withRng, players, rngState: rng.getState() };
  const r = transferMoney(withTail.players, [], withTail.pool, who, ownerIdx, god.toll, 0);
  // @source 0x0041a75e `mov [設施 + 0x30], ebp` —— 记的是**这一笔**，不是累计
  const facilityLastToll = [...withTail.facilityLastToll];
  facilityLastToll[fac.id] = god.toll;
  let paid: GameState = { ...withTail, players: r.players, pool: r.pool, facilityLastToll, phase: 'turnEnd' };

  // @source 0x0041a7aa 旅館：住 N 天、記「本月意外損失」2000×N×物價、倒楣天数 +N
  if (hotelDays > 0 && !r.bankrupted) {
    // ★ 住店的是实际付款的那个人（0x0041a772 起全用 edi）
    paid = withPlayer(paid, who, (p) => {
      // @source 0x0041a7f4 `[+0x32] = 天数 − 1`，为 0 时挂 0x80（当天就出）
      const left = hotelDays - 1;
      p.blocking = { ...p.blocking, inHotel: left === 0 ? RELEASE_PENDING : left };
      p.totalWinterSleepDays += hotelDays;
      p.monthlyPaid += hotelStayLoss(hotelDays, state.priceIndex);
    });
    // @source 0x0041a82d：保險期内由保險公司赔这笔損失
    paid = insureConfinement(paid, topo, who, hotelDays);
  }
  return r.bankrupted ? applyBankruptcy(paid, who, topo) : paid;
}

// ============================================================
//  破产与终局
// ============================================================

/** 在场人数 */
function aliveCount(state: GameState): number {
  return state.players.filter((p) => isAlive(p)).length;
}

/** 人类玩家数 —— 决定终局码（见 rules/bankruptcy.ts） */
function humanCount(state: GameState): number {
  return state.players.filter((p) => (p.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN).length;
}

/**
 * 处理一名玩家破产。
 *
 * ★ 与原版一致的关键一条（见 rules/bankruptcy.ts 的 resolveBankruptcyOutcome）：
 *   **当破产导致对局结束时，地产清算与拍卖被整个跳过**，
 *   破产者名下的地产原样留在地图上。
 *   这条由 `Save0.dat` 实证——最后破产的玩家仍持有 10 块地与 2 张牌。
 *
 * 故此处先判终局，再决定要不要清算。
 */
export function applyBankruptcy(
  state: GameState,
  playerIndex: number,
  topo: MapTopology = { nodes: [] },
): GameState {
  const victim = state.players[playerIndex];
  if (victim === undefined || !isAlive(victim)) return state;

  // ★ 先把身上的物件放回去，再清玩家结构 —— 顺序不能反：
  //   `markPlayerBankrupt` 会把 godInfo/f64 清成 0，清完就再也找不到
  //   它附着的是哪一个物件，那个物件的 `attached` 会永远挂着，
  //   既不会被 `tickGod` 减、也不会被任何人踩到 —— 神明就此**凭空消失**。
  //   实测长局跑到终盘地图上一个物件都不剩，根子就在这。
  // @source 破产处理 VA 0x0040ce2e / 0x0040ce50：先后把 +0x3f 与 +0x40
  //   传给 release_object，然后才 memset 玩家结构。
  let freed: GameState = state;
  const gone = state.players[playerIndex]!;
  for (const handle of [gone.godInfo, gone.f64]) {
    if (handle === 0) continue;
    const r = releaseObject(freed, handle);
    freed = respawnPartner(
      { ...freed, players: r.players, objects: r.objects, tools: r.tools, toolStock: r.toolStock },
      topo,
      r.partner >= 0 ? { partner: r.partner, nearNode: r.formerNode } : null,
    );
  }

  const players = freed.players.map((p, i) => (i === playerIndex ? markPlayerBankrupt(p) : p));
  let next: GameState = { ...freed, players };

  const remaining = players.filter((p) => isAlive(p)).length;
  const outcome = resolveBankruptcyOutcome(remaining, humanCount(state));

  // 樂透号码无论哪条路径都要释放 —— @source 破产处理 VA 0x0040d1a8
  next = { ...next, lottery: releaseTickets(next.lottery, playerIndex) };

  if (outcome.kind === 'gameOver') {
    // ★ 终局路径：**跳过清算**，地产原样留着
    return { ...next, phase: 'gameOver' };
  }

  // 正常路径：变卖持股（钱进公库）、释放名下地产，交给后续拍卖
  //
  // @source 破产处理 VA 0x0040d16f 的循环：对每支非空仓
  //   `sell_stock(player, i, 全部股数, 0)`，末位参数 0 即**进公库**。
  //
  // ⚠️ 该循环在原版里看不出被终局分支绕过（`cmp esi, 3` 那处是后面的
  //   地产拍卖，不是终局判定）。此处沿用与变卖手牌/道具相同的处置——
  //   放在非终局路径上，依据是 rules/bankruptcy.ts 记的 Save0.dat 实证
  //   （最后破产者仍持有 2 张手牌）。终局时钱进不进公库已无影响，
  //   故这一处的不确定性不改变任何可观测结果。
  const liquidated = liquidateStocks(
    next.holdings[playerIndex] ?? [],
    next.market.stocks,
    next.players[playerIndex]!,
  );
  // @source 破產 0x0040d095 / 0x0040d0d6 两个循环：名下地块与設施
  //   `owner = 0`、到期日（+0x30 / +0x34）清零，等级留着
  const mine = (v: number): boolean => v === playerIndex + 1;
  const landOwner = next.landOwner.map((v) => (mine(v) ? 0 : v));
  const landTenure = next.landTenure.map((t, i) => (mine(next.landOwner[i] ?? 0) ? 0 : t));
  const facilityTenure = next.facilityTenure.map((t, i) => (mine(next.facilityOwner[i] ?? 0) ? 0 : t));
  const facilityOwner = next.facilityOwner.map((v) => (mine(v) ? 0 : v));
  // ★ 变卖持股**也要重排企业名次** —— @source 破产那一段的
  //   `call _rich4_sell_stock`（`rich4_player_bankrupt.asm:407`）里就带着
  //   `_rich4_sell_stock` 尾部那条 `call _rich4_update_commercial_owner`
  //   （VA 0x00428eb7）。漏了它，破产者名下的企业会**永远挂在他名下**。
  const soldOut = next.holdings[playerIndex] ?? [];
  let reowned: GameState = {
    ...next,
    landOwner,
    landTenure,
    facilityOwner,
    facilityTenure,
    holdings: next.holdings.map((row, i) => (i === playerIndex ? liquidated.holdings : row)),
    market: { ...next.market, stocks: liquidated.stocks },
    pool: next.pool + liquidated.proceeds,
  };
  for (let stockIndex = 0; stockIndex < soldOut.length; stockIndex++) {
    if ((soldOut[stockIndex]?.amount ?? 0) === 0) continue;
    reowned = reownCommercial(reowned, stockIndex, playerIndex);
  }
  // ★ 变卖手牌与道具 @source `rich4_player_bankrupt.asm:412-417`：
  //   `call _rich4_player_sell_all_tools` / `call _rich4_player_sell_all_the_card`
  //   —— **紧接着**变卖持股那一段，而且**返回值直接丢掉**（人都破产了，
  //   點券不进他口袋）。这一步先前漏了：`markPlayerBankrupt` 只 memset 玩家结构，
  //   碰不到手牌/道具那两张全局数组，于是出局者的卡与道具会**永远留在表里**
  //   （既不能被别人抢，也不再回商店）。实证见 rules/bankruptcy.ts 的注释。
  const soldTools = sellAllTools(
    reowned.players[playerIndex]!,
    reowned.tools,
    reowned.toolStock,
  );
  const soldCards = sellAllCards(soldTools.player, reowned.cardAmount);
  return {
    ...reowned,
    players: reowned.players.map((p, i) => (i === playerIndex ? soldCards.player : p)),
    tools: soldTools.tools,
    toolStock: soldTools.toolStock,
    cardAmount: soldCards.cardAmount,
  };
}

/**
 * 扫描全场，把「现金与存款都见底且负债」的玩家判为破产。
 *
 * ⚠️ 这是一个**收口式**的检查，不是原版的触发方式——原版在
 * `pay_money` 内部两个口袋都空时直接 `call 0x40cd87`。
 * 本引擎里付款是纯函数，故改为付款后由 reducer 统一收口。
 * 两者的判据相同（见 rules/payment.ts 的 debitPlayer）。
 */
export function settleBankruptcies(
  state: GameState,
  bankrupted: readonly number[],
  topo: MapTopology = { nodes: [] },
): GameState {
  let next = state;
  for (const i of bankrupted) {
    next = applyBankruptcy(next, i, topo);
    if (next.phase === 'gameOver') break;
  }
  return next;
}

/** 对局是否已结束 */
export function isGameOver(state: GameState): boolean {
  return state.phase === 'gameOver' || aliveCount(state) <= 1;
}

/**
 * 终局码 —— 与原版 `ref_0046caf8` 同制。
 *
 * 1 = 全员出局、2 = 只剩一人且本局只有一名人类、3 = 只剩一人且多名人类。
 * 返回 0 表示尚未结束。
 *
 * ★ **因勝利條件（遊戲時間／勝利條件）达标而结束**的对局不适用上面那套
 *   「还剩几个人」的推算——原版那条路是拿**赢家是不是真人**定的
 *   （`fcn_0041d89e` 的收尾，见 `rules/victory.ts` 的 `victoryEndCode`），
 *   而且收尾时已经把其余人的 `who_plays` 全清了，之后再也数不出来。
 *   故那座终局码在判定那一刻就存进 `state.victory.code`，这里直接取。
 */
export function gameOverCode(state: GameState): 0 | 1 | 2 | 3 {
  if (state.victory !== null) return state.victory.code;
  const outcome = resolveBankruptcyOutcome(aliveCount(state), humanCount(state));
  return outcome.kind === 'gameOver' ? outcome.code : 0;
}
