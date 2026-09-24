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
import type {
  BuildUpgradeHint,
  BuildUpgradeSource,
  GameState,
  LotteryDrawHint,
  MagicBeat,
  NoticeHint,
  NoticeKey,
  Player,
} from './types.ts';
import type { SpecialActor } from '../rules/special-actors.ts';
import { isAiControlled, isAlive } from './types.ts';
import { WatcomRng, drawRandomCard, rollDice } from '../rng/watcom.ts';
import { applyNpcEvents, runNpc, type NpcEvent } from '../rules/npc-walk.ts';
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
import type { BlockReason } from '../rules/turn-start.ts';
import type {
  MapNode,
  LandInfo,
  FacilityInfo,
  CommercialInfo,
  LandscapeInfo,
} from '../loaders/map.ts';
import { housingIndexOf, canPurchase, canUpgrade, landingOnLand } from '../rules/land.ts';
import { collectRent, LAND_TOLL_FEE_NAME } from '../rules/rent.ts';
import { PARTY_POOL, PAY_FLAG_CREDIT_TO_CASH, companyParty, receiveMoney, transferMoney, type Company } from '../rules/payment.ts';
import {
  aiScapegoat,
  aiUsesFreeCard,
  reaperPayer,
  tollExemption,
  type TollExemption,
} from '../rules/toll-flow.ts';
import { PASSIVE_CARDS, consumeCard, playerHasCard, tollTriggersPassive } from '../cards/passive.ts';
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
import { placeOnNode } from '../rules/position.ts';
import { rotateViewBy } from '../rules/view.ts';
import { applyRobCardCard, giveCard, priceOf } from '../cards/rob.ts';
import { GOD_BIG_LUCK, godPowerOf, type GodPower } from '../rules/god-power.ts';
import {
  MISSILE_DEMOLISH_HOSTILITY,
  MISSILE_HOSPITAL_DAYS,
  MISSILE_HOSTILITY_FACTOR,
  MISSILE_RADIUS,
  PLACEMENT_TOOLS,
  VEHICLE_TOOLS,
  blastLand,
  buildOneLevel,
  buildUpgradeBit7,
  isToolImplemented,
  isValidRemoteDice,
  placeObject,
  useVehicleTool,
} from '../rules/tool-effects.ts';
import { STOCKED_TOOL_MAX_ID, TOOL_SLOTS_PER_PLAYER, giveTool, takeTool, toolCount, toolsOf } from '../rules/tools.ts';
// ★ 需求方 2026-09-22：放置类道具不许和「唯一物件」同格（见 `hasUniqueObjectAt`）
import { OBJECT_TYPE_UNIQUE_MAX } from '../rules/objects.ts';import {
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
  encodeEstate,
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
  facilityFeeNameOf,
  feeNameOf,
  industryUsesWheel,
  shareWindowLimit,
} from '../places/company.ts';
import { tickInsuranceDays } from '../rules/blocking.ts';
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
import { CARDS, CHARACTERS, MAGIC_HOUSE_OPTIONS, TOOLS, eventAmount, fortuneEvent, godNameOf, newsEvent, objectNameOf, stocksOfMap } from '@rich4/data';
import type { CardTarget } from '../cards/target.ts';
import { applyHostilityDeltas, breakAlliance, updateHostility } from '../rules/hostility.ts';
import {
  objectNodeCandidates,
  runtimeOccupiedNodes,
  pickObjectNodeDistant,
  releaseObject,
  resolveArrival,
  tickGod,
  drawGiftTool,
  giftToolBagEmpty,
  OBJECT_TYPE_ROADBLOCK,
} from '../rules/object-landing.ts';
import type { MapObject } from '../cards/summon.ts';
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
  MAGIC_EFFECT_COUNT,
  MAGIC_TARGET_NAMES,
  applyMagicEffect,
  localizable as magicLocalizable,
  rollMagicCriterion,
  rollMagicOption,
  type MagicEffectResult,
  type MagicNodeInfo,
  type MagicRequest,
  type MagicTargetContext,
} from '../places/magic-house.ts';
import type { TradeResult } from '../places/stock.ts';
import {
  refreshTradableShares,
  tickStockCountdowns,
  tickStockMarket,
} from '../places/stock-market.ts';
import { advanceDate, daysInMonth, packDate } from '../rules/calendar.ts';
import { misfortuneDaysAfter, settleMonthlyBank } from '../rules/monthly.ts';
import {
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_MASK,
  WHO_PLAYS_RELOCATED,
  WHO_PLAYS_RETURN_TO_BOARD,
} from './types.ts';
import {
  FACILITY_TYPE,
  WHEEL,
  aiPickFacilityType,
  RESEARCH_MAX_PROJECT,
  RESEARCH_MIN_PROJECT,
  aiPickResearchProject,
  calculateFacilityToll,
  FACILITY_NAMES,
  startResearch,
  tickResearch,
  canUpgradeFacility,
  facilityBuildPrice,
  facilityBuyPrice,
  facilityUpgradePrice,
  hotelStayLoss,
  shopUnitPrice,
  spinWheel,
  tenureExpiresToday,
  tenureExpiry,
} from '../rules/facility.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { adjustTollByGod } from '../rules/god-toll.ts';
import { MUTATE_DEMOLISH_ONE, mutateFacility, mutateLand } from '../cards/monster.ts';
import {
  DEVIL_HOSTILITY_FACTOR,
  isLuckyGod,
  manifestKindOf,
  seizeHostilityDelta,
} from '../rules/god-manifest.ts';
import { facilityIndexOf } from '../rules/land.ts';
import { tickBlocking, tickTurnCounters } from '../rules/blocking.ts';
import { releaseConfinedPlayers } from '../rules/blocking.ts';
import { DISAPPEARING_MASK, displayRemainingDays } from '../rules/blocking.ts';
import { wakeFromSleepwalk } from '../cards/sleepwalk.ts';
import { OBJECT_NAMES, purchase, purchaseBlockedBy, type PurchaseFailure } from '../rules/purchase.ts';
import { settleSpecialSquare, addPoints } from '../rules/special-square.ts';
import { MAX_LAND_LEVEL, SPECIAL_KIND } from '../loaders/map.ts';
import { drawEvent } from '../events/deck.ts';
import { isNewsFeasible } from '../events/news.ts';
import { checkFortune } from '../events/fortune.ts';
import {
  FORTUNE_GIVE_TAIL_IDS,
  FORTUNE_PAY_TAIL_IDS,
  FORTUNE_STOCK_LIQUIDATE,
  applyFortuneEffect,
  fortuneBlessingNotice,
} from '../events/fortune-effects.ts';
import {
  blessingLevelWithDraw,
} from '../rules/blessing.ts';
import { sellAllCards, sellAllTools } from '../rules/inventory.ts';
import { ALIEN_HOSPITAL_DAYS, applyNewsEffect, type CompanyMutation, type LandMutation, type PriceChange } from '../events/news-effects.ts';
// ★ 第 160 条：飛彈/核彈那一路**不再**用 `mutateFacility` —— `damage_area` 的
//   設施轻击是另一份内联逻辑（`level == 0` 时照样清种类 + 放人，见 `fireMissile`）。
import {
  anyoneConfined,
  anyPlayerConfined,
  confinementGateNodeId,
  OBJECT_SLOT_BASE,
  release,
  sendToConfinement,
  type ConfinementKind,
} from '../rules/confinement.ts';
import { INMATE_NAMES, applyBail, bailCandidates, decideBail } from '../rules/visit.ts';
import {
  isUnimplementedPlace,
  needsInteraction,
  unimplementedPlace,
  type AuctionPending,
  type AuctionRequest,
  type PendingInteraction,
  type TollTailCtx,
} from '../rules/interaction.ts';
import {
  aiBorrowGate,
  aiRepaysLoan,
  borrow,
  deposit,
  forceLoanRepayment,
  loanCapacity,
  loanDueStep,
  rebalanceCashByRatio,
  repay,
  withLoanDueDate,
  withdraw,
} from '../places/bank.ts';
import { autoLoanAmount } from '../ai/personality.ts';
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
  auctionBasePrice,
  auctionCanAfford,
  auctionFinished,
  auctionFirstSeat,
  auctionOutcome,
  auctionSeatStatus,
  eligibleBidders,
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
  /**
   * 特殊景观表（綠島／醫院大樓…）。
   *
   * ★ 首次关押时玩家的**屏幕坐标**取自这里（原版
   * `0x43d63e mov eax,[0x498e78] / mov si,word[eax+0x38]`）：監獄 = 记录 2（綠島）、
   * 醫院 = 记录 1。缺省时退回节点坐标（旧行为）。见 `rules/confinement.ts`。
   */
  landscapes?: readonly LandscapeInfo[];
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
    landPrice: s.facilityPrice?.[facilityId] ?? tpl.landPrice,
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
    // ★ 地价会被新聞 6/14 改（×1.3 / ×0.7），故也走状态
    // ⚠️ `?.` 是**兼容老存档/半成品夹具**：这两格是后加的，缺了要回退到地图初值，
    //   不能抛 TypeError
    landPrice: s.landPrice?.[landIndex] ?? tpl.landPrice,
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
  rand01: () => number,
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

  // ★★ 卖家 = 待拍实体的**现主**（1 基编码 → −1 得玩家下标；0 = 无主）。
  //   原版建表时给卖家那一格写状态 **7**，绕圈因此永远跳过它
  //   （`loc_0043c110` 的 `cmp ebx, [esp+0xac]` 那一支）—— 起拍那一口
  //   不可能落在卖家头上。本引擎的 `status` 里没有「7」这一档，
  //   所以把卖家**显式**传给 `auctionFirstSeat` 让它跳过。
  //   ⚠️ 不这么做时，**无主地**自拍会出问题：`eligibleBidders` 不排除任何人
  //   （`entity.owner === 0` 谁都匹配不上）⇒ 名单里含卖家自己、状态是 `'active'`
  //   ⇒ 开场席位落回卖家（外部审查 A-3 实测到的卡死）。
  //   无主时卖家就是当前行动者（拍賣卡/魔法屋都只拍「自己脚下」那块）。
  // ★★ 第 160 条（A2）：`seller` **就是原版的 arg0**（= 发起者：拍賣卡是用卡者、
  //   魔法屋是中签者、新聞 7 与破产清算是 −1），**不是**「待拍实体的现主」。
  //   原版建表时给「玩家号 == arg0」那一格写状态 7（`0x43c23c mov word [座位+2],7`），
  //   出价循环因此永远跳过他；地主反而**可以**举牌把自己的地买回来
  //   （`0x43c11f` 只看 `+0x15`，从不看 owner）。
  //   ⚠️ 旧实现在这里用「现主」兜底 ⇒ 把地主当成了 arg0：地主被排除、用卡者能举牌，
  //   落槌款也付给了地主（见 `settleAuctionExplicit`）。
  //   现在三条调用点都必须显式给 `seller`（缺省 −1 = 谁都不排除）。
  const seller = pending.seller ?? -1;

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
    // ★ 心理价位要**消费全局随机流**（原版 `0x439f0d` 开头就 `call rand` 一次，
    //   每家正好一次）；`rngState` 的回写由 `startAuction` 负责，见那里的说明。
    limits: (() => {
      const s2 = auctionSeatStatus(state.players, pending.bidders, pending.basePrice);
      return auctionAiLimits(entity, state.players, pending.bidders, s2, seller, rand01);
    })(),
  };
}

/**
 * 把一场拍卖**挂成待决交互** —— 拍賣卡、魔法屋、新聞 7 三条路共用。
 *
 * ★ 一开拍就没人出得起底价（全体 `givenUp`）时**当场流标**：原版窗口也是
 *   这个下场（`loc_0043b295` 的 `esi == edi` 那一条），而引擎里若不在这里结掉，
 *   `decidePending` 会拿不到座位（`seat` 落空），pending 就永远挂着。
 */
function startAuction(state: GameState, topo: MapTopology, request: AuctionRequest): GameState {
  // ★ 已经挂着一场时，把新的排到队尾，等前一场落槌再开。
  //   原版的 `0x43bde5` 是**阻塞调用**，同一流程里连着开多场是正常的
  //   （破产清算挑 3 处连拍、魔法屋每位中签者一场）；本引擎的拍卖是待决
  //   交互，一次只能挂一场，故用 `pendingQueue` 接续。
  //   早先没有这条队列时，第二次 `startAuction` 会**直接覆盖**第一场 ——
  //   前一场的竞价进度与待决状态凭空消失。
  if (state.pending !== null) {
    return { ...state, pendingQueue: [...state.pendingQueue, request] };
  }
  // ★★ 开拍要**推进全局随机流** —— 原版每个「可出价的电脑座位」在建表时
  //   调一次 `0x439f0d`，而它开头就是 `call rand`（@source 0x00439f1c）。
  //   不推的话，之后所有随机事件（命運/新聞/骰子/魔法屋）都会与原版错位一次。
  //   ⚠️ 早先这里用 `rngState ^ 实体号` 派生一条独立序列（旧 D-T034-5），
  //   理由是「怕联机两端对不上」—— 那个理由不成立：开拍在 reducer 里发生，
  //   两端对同一串 action 跑同一个 reducer，消费同样的次数就不会漂；
  //   而竞价屏只读 `pending.limits`、从不重算（`client/auction-screen.ts`）。
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  // 15 位 → [0,1)：`auctionAiLimit` 自己再乘回 32768（随机数归一化，非金额计算）
  // eslint-disable-next-line no-restricted-syntax -- C-DET-3 的定向豁免
  const opened = openAuction(state, topo, request, () => rng.next() / 32768);
  const advanced: GameState = { ...state, rngState: rng.getState() };
  if (auctionFinished(opened)) {
    const out = auctionOutcome(opened);
    return settleAuctionExplicit(advanced, topo, opened, out.winner, out.price);
  }
  return { ...advanced, pending: opened, phase: 'awaitingDecision' };
}

/**
 * 一场拍卖落槌后的**收尾**：结算完就看看队列里还有没有排队的拍卖。
 *
 * ★ 这是所有拍卖结束路径的**唯一汇合点** —— `settleAuctionPending`（竞价循环
 *   收尾）、兼容入口 `{ type: 'auction', winner, price }`、以及
 *   `startAuction` 里「一开拍就全体放弃」的当场流标，全都经过它。
 *   所以接续逻辑只写在这里一处即可，不会漏。
 */
function chainQueuedAuction(state: GameState, topo: MapTopology): GameState {
  const next = state.pendingQueue[0];
  if (next === undefined) {
    // ★ 推日期时开出的那串拍卖打完了 ⇒ 这才轮到新当前玩家的 `0x41c84f`（见 `afterDayRollover`）
    const who = state.deferredTurnStart ?? null;
    if (who !== null && state.pending === null && state.phase !== 'gameOver') {
      return startActorTurn({ ...state, currentPlayer: who, phase: 'turnStart' }, topo, who);
    }
    return state;
  }
  return startAuction({ ...state, pendingQueue: state.pendingQueue.slice(1) }, topo, next);
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
/** 复制一份数组并把某一格换成新值（拍卖写到期日用）。 */
function withTenure(src: readonly number[], index: number, value: number): number[] {
  const out = [...src];
  out[index] = value;
  return out;
}

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
    if (fac === null) return chainQueuedAuction({ ...state, pending: null, phase: 'turnEnd' }, topo);
    // @source 0x43c844 `mov ecx,[esp+0xb4]`（= arg0）→ `0x43c855 call 0x41d2c6`
    //   ⇒ 落槌款付给**发起拍卖者**（$payee$），不是公库；`0x43c7d3..0x43c804`
    //   另写設施到期日 `+0x34`（三个闸门见 `settleFacilityAuction` 的 `tenure`）。
    const fr = settleFacilityAuction(state.players, fac, { winner: w, price: p }, state.pool, [], {
      payee: pending.seller ?? -1,
      expiry: tenureExpiry(packDate(state), state.landTenureIndex),
    });
    const facilityOwner = [...state.facilityOwner];
    facilityOwner[entityId] = fr.facility.owner;
    const settled: GameState = {
      ...state,
      players: fr.players,
      facilityOwner,
      ...(fr.tenure === 0 ? {} : { facilityTenure: withTenure(state.facilityTenure, entityId, fr.tenure) }),
      pool: fr.pool,
      pending: null,
      phase: 'turnEnd',
    };
    // 中标者若因付款破产，破产流程本身会把该结的都结掉，队列交给它继续
    return fr.bankrupted ? applyBankruptcy(settled, w, topo) : chainQueuedAuction(settled, topo);
  }

  const land = effectiveLand(state, topo, entityId);
  if (land === null) return chainQueuedAuction({ ...state, pending: null, phase: 'turnEnd' }, topo);
  // @source 同上：`+0x30`（地產到期日）在「得标者≠原地主 ∧ 权限≠無限期 ∧ **原为无主**」
  //   时才写（`0x43c77b` / `0x43c799` / `0x43c7a8` 三道闸），闸门收在 `settleAuction` 里。
  const r = settleAuction(state.players, land, { winner: w, price: p }, state.pool, [], {
    payee: pending.seller ?? -1,
    expiry: tenureExpiry(packDate(state), state.landTenureIndex),
  });
  const landOwner = [...state.landOwner];
  landOwner[entityId] = r.land.owner;
  const settled: GameState = {
    ...state,
    players: r.players,
    landOwner,
    ...(r.tenure === 0 ? {} : { landTenure: withTenure(state.landTenure, entityId, r.tenure) }),
    pool: r.pool,
    pending: null,
    phase: 'turnEnd',
  };
  return r.bankrupted ? applyBankruptcy(settled, w, topo) : chainQueuedAuction(settled, topo);
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
  // ★ 2026-09-23：垫付之前弹「銀行資金準備\n\n不足%d元\n\n由經營者%s墊付！」（**2500 ms**）
  //   @source `0x00436c03 push 0x464b75`（`%d` = 缺口 esi、`%s` = 董事長名）→ `0x00436c15 push 0x9c4` → `0x00436c1f call 0x440cac`
  const next: GameState = appendFreshNotice(
    { ...s, players },
    { key: 'bank.reserveShortfall', args: [call.shortfall, playerName(s, call.chairman)], holdMs: 0x9c4 },
  );
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
    landPrice: s.landPrice?.[l.id] ?? l.landPrice,
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
  // ★★ 簇 C 修复（2026-09-17）：**候选只有 1 个时也必须掷一次**。
  //
  //   原版的判据只看「有没有候选」，不看「有几个」：
  //   ```asm
  //   0040c17c  test esi, esi        ; esi = 候选个数
  //   0040c17e  jne  0x40c196       ; ★ >=1 就跳到 rand 那一段
  //   0040c180  …                    ; 只有 0 个候选才走「回上一格」
  //   0040c196  call 0x456f2d       ; rand()
  //   0040c1a0  idiv esi            ; eax % esi
  //   0040c1a5  movsx edi, word [esp + edi]
  //   ```
  //   所以 `1 个候选` 与 `n 个候选` 一样消耗**一次** `rand()`。
  //
  //   此前写成 `if (candidates.length === 1) return candidates[0]!` —— 少掷一次。
  //   这是**流量最大**的一处随机流错位：几乎每走一格都会与后续随机事件
  //   （新闻/命运/卡片/AI）整体错位一步。`rng.next() % 1 === 0`，
  //   故对 1 个候选无需特判，直接走同一条式子即可。
  //   （见 `docs/gaps/05-loop-minigames-ai.md` 6.3 #1。）
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
  // ★★ **零位移没有特例**（第 91 条通道 2 订正）。
  //   先前这里写 `if (dx === 0 && dy === 0) return 0`，依据是内层
  //   `atan2_16bit` 在 `0x00454fe5`（`or esi,ecx / je 0x45502b`）会提前 `ret`。
  //   但那只是**内层**的提前返回（返回 `ax = 0`），外层 `0x00454fb4` 拿到 0 之后
  //   **照样**走完 `shr ax,0xc / inc ax / shr ax,1 / and eax,7 / movzx [eax+0x482414]`
  //   —— 八分圆 0 查表得 **2**。通道 2 实测 `0x454fb4(0, 0) = 2`
  //   （`tests/test_walk_step.py` §A 末条）。
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
  // ★ 小偷五种战利品那一句「小偷偷得%s\n\n給%s！」（见 `npcNotices`）
  const notices = npcNotices(state, walk.events, ticked.owner);
  let next = put(
    // ★ 覆写（不累积）：这一条 action 只走了一个惡人，表现层就只该看到一个
    {
      ...settled.state,
      rngState: rng.getState(),
      lastNpcWalks: [{ slot, path: walk.path, steps }],
      ...(notices.length > 0 ? { notices } : {}),
    },
    walk.actor,
  );
  const home = walk.events.find((e) => e.kind === 'home');
  if (home !== undefined) {
    const back = [...(home.place === 'prison' ? next.prisonOccupancy : next.hospitalOccupancy)];
    back[actorId] = 1;
    next = home.place === 'prison' ? { ...next, prisonOccupancy: back } : { ...next, hospitalOccupancy: back };
  }
  // ★ 踩到地雷被送进医院（@source 0x41be5f 的玩家分支 `call 0x43ec3f(actor, 3)`）：
  //   替身记录进医院 ⇒ 占用表也要跟着置上，否则「探病里看不到他、他却躺着」。
  if (walk.events.some((e) => e.kind === 'trap' && e.hospital)) {
    const back = [...next.hospitalOccupancy];
    back[actorId] = 1;
    next = { ...next, hospitalOccupancy: back };
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
  // ★ 推日期里开出了拍卖（分紅打破產的下線拍卖）⇒ 拍卖先打，`0x41c84f` 押到拍卖链收尾（见 `afterDayRollover`）
  if (rolled.pending !== null || rolled.pendingQueue.length > 0) {
    return {
      ...rolled,
      currentPlayer: next,
      phase: 'awaitingDecision',
      deferredTurnStart: next,
      dice: [],
      stepsRemaining: 0,
      stepsTotal: 0,
      turnCount: state.turnCount + 1,
    };
  }
  // ★ 下一位玩家由**调用方**算好传进来（`endTurn` 里已经算过 `nextAlivePlayer`）——
  //   在这一段里再算一遍会看到惡人段开始之后才变化的状态，与原版那条游标不同。
  //   ⚠️ 「给新玩家走一天」由**调用方**补：`endTurn`（同一 action 内走完）或
  //   `npcStep`（跨 action 走完）—— 两处都必须调 `beginActorTurn`（第 85 条）。
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
 * 给**即将行动**的那位走一天 —— `0x418ebd` 里 `0x419033`/`0x419039` 那一步。
 *
 * @source
 * ```asm
 * 00418f95  inc  esi / mov [0x49910c], esi   ; ★ 游标先 ++（所以下面用的是新玩家）
 * 0041902e  call 0x41cf67                    ;   绕回 0 号那一次：推日期/物价/行情/開獎/月結
 * 00419033  mov  eax, dword [0x49910c]
 * 00419039  call 0x41c84f                    ; ★ 递减阻碍计数（`+0x32..+0x35`）
 * 0041caf4  …                                ;   同一个函数的后半段：冬眠/梦游/龜行/停留/拒貸/同盟/保險
 * 0041cc6c  …                                ;   神明任期也在这里
 * ```
 *
 * ⚠️ **两条进入「下一位玩家」的路径都必须调它**：`endTurn`（常规）与
 * `npcRoundStep` 的收尾（惡人段走完）。第 85 条就是因为在后者漏了这一步，
 * 导致**每一輪**都少给一位玩家走一天（在押/住宿/冬眠永不到期）。
 */
function beginActorTurn(state: GameState, topo: MapTopology, index: number): GameState {
  // ★ 0x41c84f 的第二句 `0x0041c86d call 0x436a5a` —— 还款日检查排在**一切计数之前**
  //   （第一句 `0x42915a` 是股市可成交量，本引擎在日推进里做）。
  const due = checkLoanDue(state, topo, index);
  // 真人还款提醒窗（`0x43695e` 是模态的）：剩下那一段等窗关了（`declineDecision`）才走
  if (due.pending?.kind === 'loanReminder' || due.phase === 'gameOver') return due;
  // @source `0x0041c875 cmp byte [player+0x15], 0 / je 0x41cf5d` —— 强制执行把人扣破產了 ⇒ 后面全不走
  const me = due.players[index];
  if (me === undefined || !isAlive(me)) return due;
  return tickActorDay(due, topo, index);
}

/**
 * 推完日期（`0x41cf67`）之后轮到 `next`：`currentPlayer` / `turnCount` 等已摆好。
 *
 * - 推日期里开出了拍卖（`pending` / `pendingQueue` 非空）⇒ 相位 `awaitingDecision` 先打拍卖，
 *   记下 `deferredTurnStart = next`，由拍卖链收尾（`chainQueuedAuction`）再走 `0x41c84f`；
 * - 否则当场走 `0x41c84f`（`beginActorTurn`），相位回 `turnStart`
 *   （新回合自己开出的下線拍卖 / 还款提醒窗照原样留着）。
 */
function afterDayRollover(state: GameState, topo: MapTopology, next: number): GameState {
  if (state.phase === 'gameOver') return state;
  if (state.pending !== null || state.pendingQueue.length > 0) {
    return { ...state, phase: 'awaitingDecision', deferredTurnStart: next };
  }
  return startActorTurn(state, topo, next);
}

/** 当场给 `next` 走 `0x41c84f` 并进 `turnStart`（新回合自己开出来的 pending 照原样留着）*/
function startActorTurn(state: GameState, topo: MapTopology, next: number): GameState {
  const ticked = beginActorTurn({ ...state, pending: null, deferredTurnStart: null }, topo, next);
  if (ticked.phase === 'gameOver') return ticked;
  // 下線拍卖（`awaitingDecision`）照原样；其余（含还款提醒窗）都停在 `turnStart`
  return { ...ticked, phase: ticked.phase === 'awaitingDecision' ? 'awaitingDecision' : 'turnStart' };
}

/**
 * 还款日检查 `fcn_00436a5a`（`0x41c84f` 回合边界里 `0x0041c86d` 那一句）—— 判据见 `places/bank.ts` 的 `loanDueStep`。
 *
 * - 0 天：框「貸款到期日\n\n強制執行！」（`0x00436aa0 push 0x464b2c` / `0x00436a9b push 0x5dc` = 1500 ms）
 *   → `0x00436abe call 0x433bd8(player, loan)`（打穿即破產）→ `0x00436acf` 贷款、还款日两格清零；
 * - 1 / 2 天：框「距貸款到期日\n\n還剩１天！/ ２天！」（`0x00436ae4` / `0x00436afa`，1500 ms）；
 * - 3 天：`0x00436b01 call 0x43695e` —— **恰好** `who_plays == 1`（`0x00436969 cmp byte [+0x15], 1`）
 *   才开还款提醒窗（`0x004369ec push 0x436034`，模态）⇒ 挂 `pending {kind:'loanReminder'}`，
 *   相位留在 `turnStart`；其余玩家什么都不做。
 *
 * ⚠️ 用的是 `[0x49910c]`（= 即将行动的这一位，与 `0x41c84f` 的参数同一人）。
 */
function checkLoanDue(state: GameState, topo: MapTopology, index: number): GameState {
  const me = state.players[index];
  if (me === undefined) return state;
  const step = loanDueStep(me, state);
  if (step === null) return state;
  if (step === 'oneDay' || step === 'twoDays') {
    return appendFreshNotice(state, { key: step === 'oneDay' ? 'bank.loanDueOneDay' : 'bank.loanDueTwoDays', args: [] });
  }
  if (step === 'reminder') {
    return (me.whoPlays & 0xff) === WHO_PLAYS_HUMAN && state.pending === null
      ? { ...state, pending: { kind: 'loanReminder' } }
      : state;
  }
  // 'forced'：先弹框、再扣钱（`0x00436aa5 call 0x440cac` 在 `0x00436abe call 0x433bd8` 之前）
  const boxed = appendFreshNotice(state, { key: 'bank.loanDueForced', args: [] });
  const r = forceLoanRepayment(me);
  const paid = withPlayer(boxed, index, (p) => {
    p.cash = r.player.cash;
    p.moneyInBank = r.player.moneyInBank;
    p.loan = 0;
    p.loanDueDate = 0;
  });
  // @source `0x00433c11 push player / call 0x40cd87`
  return r.bankrupt ? applyBankruptcy(paid, index, topo) : paid;
}

/**
 * `0x41c84f` 在还款日检查之后的那一大段：阻碍计数 → 释放 → 其余回合计数 → 神明任期。
 *
 * ★ 与 `beginActorTurn` 拆开，是因为真人的还款提醒窗（`0x43695e`）是**模态**的 ——
 *   窗开着时这一段还没走；关窗（`declineDecision`）之后才接着走。
 */
function tickActorDay(state: GameState, topo: MapTopology, index: number): GameState {
  const tick = tickBlocking(state.players[index]!.blocking);
  let afterTick = withPlayer(state, index, (p) => {
    p.blocking = tick.blocking;
  });
  // ★★ 簇 A 修复（2026-09-17）：**把 `released` 接上**。
  //
  //   释放函数（监狱 `0x0043d7bf` / 医院 `0x0043ee6e`）做两件事：
  //     ```asm
  //     ; @source 0x0043d7bf（索引 < 4 的玩家分支）
  //     0043d7cb  call 0x40d6be          ; ① 回棋盘（见下）
  //     0043d7d5  mov byte ptr [ebx + 0x496b30], al   ; al=0 ② 清**占用表**
  //     ```
  //   而 `0x40d6be` 里是：
  //     ```asm
  //     0040d6d1  or  byte ptr [ebx + 0x496b7d], 0x10   ; p[+0x15] |= 0x10（走回棋盘标记）
  //     0040d717  mov byte ptr [ebx + 0x496b78], al     ; p[+0x10] = 朝目标节点的方向
  //     0040d737  or  dword ptr [edx + eax*8 + 0x24], esi ; node[目标].+0x24 |= 1<<idx（登记到场）
  //     ```
  //
  //   此前 remake **把 `released` 丢掉了**（只取 `.blocking`），于是
  //   `prisonOccupancy` / `hospitalOccupancy` **永不清零**，
  //   `anyoneConfined()` 恒为真 ⇒ 監獄／醫院落点永远认为"里面有人"，
  //   已出狱者可以被**反复保释**（幽灵保释），刑满者也不回棋盘。
  for (const key of tick.released) {
    if (key === 'inPrison') {
      afterTick = { ...afterTick, prisonOccupancy: release(afterTick.prisonOccupancy, index) };
    } else if (key === 'inHospital') {
      afterTick = { ...afterTick, hospitalOccupancy: release(afterTick.hospitalOccupancy, index) };
    }
  }
  // ★★ 2026-09-18（第 84 条）：释放还要**置「走回棋盘」标记** —— 住宿／监狱／
  //   医院三支的释放函数都走 `0x40d6be`，它第一句就是
  //   `0040d6d1 or byte [player + 0x15], 0x10`；**消失**那一支（`0x40d4e5`）
  //   没有这句。标记由 `startTurn` 消费 = 整回合不掷骰，即「刑满之后还要
  //   白丢一回合」，与状态栏显示的 `(raw & 0x7f) + 1` 对得上。
  //   通道 2 证据：`rich4-spec/tests/test_day_tick.py`（28/28）。
  if (tick.released.some((key) => key !== 'disappearing')) {
    afterTick = withPlayer(afterTick, index, (p) => {
      p.whoPlays |= WHO_PLAYS_RETURN_TO_BOARD;
    });
  }
  // ★ 回合边界的后半段（`0x41caf4` 起）：冬眠/梦游/停留/龜行/拒貸/同盟/保險各走一天
  const blocked = tickDailyCounters(afterTick, index);
  // ★ 神明的任期也在这里走一天 —— 原版就紧挨着阻碍计数
  //   （tick_blocking @ 0x41c8d5，神明 @ 0x41cc6c，同一个函数）。
  //   附身写的 7（死神 13）是天数，减到 0 神明自己走人，搭档登场。
  const g = tickGod(blocked, index);
  return respawnPartner(
    { ...blocked, players: g.players, objects: g.objects, tools: g.tools, toolStock: g.toolStock },
    topo,
    g.respawn,
  );
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
  if (reduceDepth === 0) staleNoticeLists.add(state.notices);
  reduceDepth++;
  let raw: GameState;
  try {
    raw = reduceCore(state, action, topo);
  } finally {
    reduceDepth--;
  }
  // ★ 不可信输入（联机）：不认识的 action type 会让那个 `switch` 穿底、返回 `undefined`，
  //   服务器靠这个判「被拒」（`server/hub.test.ts`）—— 原样交还，别在这里解引用。
  if ((raw as GameState | undefined) === undefined) return raw;
  // ★★ 瞬态提示 `lastViewTarget` 只活**一条 action**（W-54，见 `GameState.lastViewTarget`）。
  //
  //   原版的标记（`[0x48be18]`）由 `view_to` 写、由 `refresh_screen` 清 —— 生命周期
  //   正好是「这条 action 的演出」。本引擎的 action 是原子批，所以在这里统一收：
  //   凡是**改动了状态**、但**没有新写** `lastViewTarget`（引用没换）的 action ⇒ 清成 null。
  //   `playCard` / 飛彈 这些真的设了目标的 action 会放一个**新建的对象**进去 ⇒ 引用不同 ⇒ 保留。
  //
  //   ⚠️ 两个恒等性约束（既有测试是这么钉的，不许放松）：
  //   · `raw === state`（没生效的 action，如失败的 `useCard` / 买不起的股票）⇒ **原样返回**，
  //     连对象都不换（`use-card.test.ts` / `stock-trading.test.ts` 的 `toBe(state)`）；
  //   · 其余情况只多换一层对象，字段值不变。
  //
  //   ★ W-55：同一套规矩也用在 `lastGodLine` / `lastGodPower` 上（两条都是「刚发生了什么」，
  //     只活一条 action）。**逐字段**判：谁被这一条 action 新写了（引用换了）就保留，
  //     没新写的清成 null。没东西要清时**原样返回 `raw`**（保持上面的恒等性）。
  const staleView = raw !== state && raw.lastViewTarget === state.lastViewTarget;
  const staleLine = raw !== state && raw.lastGodLine === state.lastGodLine;
  const stalePower = raw !== state && raw.lastGodPower === state.lastGodPower;
  // ★ W-67-a：同一套规矩也用在 `lastShopGift` 上（董事長赠礼那一条台词）。
  const staleGift = raw !== state && raw.lastShopGift === state.lastShopGift;
  // ★ W-69：`lastTollLands` 也一样（過路費那段「一起閃一遍」的演出提示）。
  const staleToll = raw !== state && raw.lastTollLands === state.lastTollLands;
  // ★ 第十二份試玩回報：`lastLotteryDraw`（开奖屏的「本期号码」）也一样，只活一条 action。
  //   已经是 null 的不算「要清」（保持「没东西要清就原样返回 `raw`」的恒等性）。
  const staleDraw =
    raw !== state && raw.lastLotteryDraw !== null && raw.lastLotteryDraw === state.lastLotteryDraw;
  // ★ 魔法屋逐人演出分段（`lastMagicBeats`）同一套：只活一条 action。
  const staleBeats =
    raw !== state && (raw.lastMagicBeats ?? null) !== null && raw.lastMagicBeats === state.lastMagicBeats;
  // ★ 第十三份試玩回報：回合开始被挡那几句（`lastBlockedSays`）同一套：只活一条 action。
  const staleSays =
    raw !== state && (raw.lastBlockedSays ?? null) !== null && raw.lastBlockedSays === state.lastBlockedSays;
  // ★ 第十四份：「進帳」台词那几笔（`lastGainSays`）同一套：只活一条 action。
  const staleGain =
    raw !== state && (raw.lastGainSays ?? null) !== null && raw.lastGainSays === state.lastGainSays;
  const staleAway =
    raw !== state && (raw.lastDisappearSay ?? null) !== null && raw.lastDisappearSay === state.lastDisappearSay;
  const next =
    staleView || staleLine || stalePower || staleGift || staleToll || staleDraw || staleBeats || staleSays || staleGain || staleAway
      ? {
          ...raw,
          ...(staleView ? { lastViewTarget: null } : {}),
          ...(staleLine ? { lastGodLine: null } : {}),
          ...(stalePower ? { lastGodPower: null } : {}),
          ...(staleGift ? { lastShopGift: null } : {}),
          ...(staleToll ? { lastTollLands: null } : {}),
          ...(staleDraw ? { lastLotteryDraw: null } : {}),
          ...(staleBeats ? { lastMagicBeats: null } : {}),
          ...(staleSays ? { lastBlockedSays: null } : {}),
          ...(staleGain ? { lastGainSays: null } : {}),
          ...(staleAway ? { lastDisappearSay: null } : {}),
        }
      : raw;
  // ★ 落点例程的**尾块**（`0x0041b077`）：買地 / 升級 / 收费各支收完之后神明顯靈，再轮到研究所面板
  if (!landingTailDue(state, next, action, topo)) return next;
  return labPanelTail(manifestGodOnLanding(state, next, topo), topo);
}

/**
 * 尾块的最后一段：站在自己的研究所上就开研究所面板（`afterOwnLab`）。
 *
 * ★★ 第十六份試玩回報（「研究所修完后是不是马上可以选择开始研究什么东西」）：**是**。
 *   付費首建（`0x0041a25a` 起：`inc [+0x1a]` → `0x0041a2ae jmp 0x419a48`）→ 福神 `0x00419a48 call 0x40f8be`
 *   → `0x00419a4d jmp 0x41b074`（`add esp,8`）→ 落进尾块 `0x0041b077`：
 * ```asm
 * 0041b086  call 0x40f381        ; 顯靈（天使加蓋 / 惡魔拆 / 土地公佔）
 * 0041b09d  call 0x448a7e
 * 0041b0b3  ...                  ; 設施、我的、没夢遊、type == 4 且 level != 0、没被查封
 * 0041b109  call 0x44101d        ; ★ 研究所面板（真人点选 / 电脑 `0x4411e7` 当场开一项）
 * ```
 *   ⇒ 刚蓋好的 1 级研究所当场就问研發項目；加蓋 / 谢绝加蓋 / 满级 / 被衰神挡掉也都走到这里。
 *   面板排在**顯靈之后**：天使先加一层（项目多一档）、惡魔先拆（拆到 0 级就不问）。
 *   神明代蓋那扇免费选种类框（`pending.free`）就在尾块里面，选完接着走到这一段（见 `buildFacility`）。
 */
function labPanelTail(state: GameState, topo: MapTopology): GameState {
  if (state.phase !== 'turnEnd' || state.pending !== null) return state;
  const fac = facilityAtPlayer(state, topo);
  return fac === null ? state : afterOwnLab(state, topo, fac.id);
}

/**
 * 回合开始时「被阻碍」那五扇訊息框（`○○住院中／還剩 N 天！`）。
 *
 * @source `fcn_0040c912`（VA 0x0040c912，`rich4.asm:6561`）—— **对当前玩家无条件弹**，
 *   不分真人与电脑（电脑 `who_plays = 2`，`2 & 0x30 == 0`，`0x0040c969` 那个闸门
 *   说的是「走回棋盘 0x10 / 被外力挪过 0x20」，与是不是电脑无关）。
 *   判定顺序（= 本表的键序，`blockReason()` 同序）：
 *   `rich4.asm:6596(住宿) → 6607(消失) → 6624(坐牢) → 6660(住院) → 6702(冬眠)`。
 *   推串点见 `@rich4/data` 的 `CONFINEMENT`（`0x4631e0` / `0x4631f5` / `0x46320a`
 *   / `0x46321f` / `0x463234`）；框时长 = `push 0x5dc`（1500 ms，缺省即此）。
 *
 * ⚠️ 消失那一项用 `DISAPPEARING_MASK = 0x3f` 算天数，其余用 `0x7f`
 *   （@source `rich4.asm:27908-27952`；`rules/blocking.ts` 的同名常量）。
 *
 * ⚠️ `special`（`who_plays & 0x30`）与 `notAlive` **不在表内** —— 原版这两支不弹框。
 */
const CONFINEMENT_NOTICE: Readonly<
  Partial<Record<BlockReason, { key: NoticeKey; field: keyof Player['blocking']; mask: number }>>
> = {
  inHotel: { key: 'confinement.hotel', field: 'inHotel', mask: 0x7f },
  disappearing: { key: 'confinement.disappearing', field: 'disappearing', mask: DISAPPEARING_MASK },
  inPrison: { key: 'confinement.prison', field: 'inPrison', mask: 0x7f },
  inHospital: { key: 'confinement.hospital', field: 'inHospital', mask: 0x7f },
  sleeping: { key: 'confinement.sleeping', field: 'sleeping', mask: 0x7f },
};

/**
 * 当前玩家这一回合「被阻碍」时要弹的那一扇；不该弹（`special` / `notAlive` / 可行动）时 `null`。
 *
 * `args` 顺序 = 原版 `sprintf` 的顺序：[玩家名, 剩余天数]。
 */
function confinementNotice(state: GameState, reason: BlockReason | null): NoticeHint | null {
  if (reason === null) return null;
  const spec = CONFINEMENT_NOTICE[reason];
  const player = state.players[state.currentPlayer];
  if (spec === undefined || player === undefined) return null;
  return {
    key: spec.key,
    args: [
      playerName(state, state.currentPlayer),
      displayRemainingDays(player.blocking[spec.field], spec.mask),
    ],
  };
}

/**
 * 回合开始被挡：坐牢 / 住院 / 冬眠三句台词各自的 1/2 判定（见 `GameState.lastBlockedSays`）。
 *
 * @source `fcn_0040c912`：
 * ```asm
 * 0040ca17  cmp byte [p+0x34], 0 / je     ; 坐牢
 * 0040ca20  call rand / test al,1 / je    ; ⇒ 事件 19（0x480896）
 * 0040ca90  cmp byte [p+0x35], 0 / je     ; 住院
 * 0040ca99  call rand / test al,1 / je    ; ⇒ 事件 20（0x48089a）
 * 0040cb09  cmp byte [p+0x36], 0 / je     ; 冬眠
 * 0040cb12  cmp dword [p+0x32], 0 / jne   ; 住宿/消失/坐牢/住院有一个非 0 ⇒ 不掷
 * 0040cb1b  call rand / test al,1 / je    ; ⇒ 事件 21（0x48089e）
 * ```
 */
export function rollBlockedSays(
  rngState: number,
  b: Player['blocking'],
): { rngState: number; says: number[] } {
  const rng = new WatcomRng();
  rng.setState(rngState);
  const says: number[] = [];
  if (b.inPrison !== 0 && (rng.next() & 1) !== 0) says.push(19);
  if (b.inHospital !== 0 && (rng.next() & 1) !== 0) says.push(20);
  if (b.sleeping !== 0 && (b.inHotel | b.disappearing | b.inPrison | b.inHospital) === 0 && (rng.next() & 1) !== 0) {
    says.push(21);
  }
  return { rngState: rng.getState(), says };
}

function reduceCore(state: GameState, action: Action, topo: MapTopology): GameState {
  switch (action.type) {
    case 'reseed': {
      // 唯一的非确定性入口，且其值已被记入 action 日志
      return { ...state, rngState: action.seed >>> 0 };
    }

    case 'startTurn': {
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;
      // ★ 还款提醒窗还开着（`0x43695e` 模态，在 `0x41c84f` 里）⇒ 回合还没真正开始，先关窗
      if (state.pending?.kind === 'loanReminder') return state;

      // ★★ 2026-09-18（第 84 条）：**「走回棋盘」那一回合**。
      //   释放后 `+0x15 |= 0x10`（`0x40d6be`），这一回合整回合不掷骰
      //   （`00418f8e jmp 0x419058`），`00418f87 and byte [player+0x15], 0xf` 清标记；
      //   四个阻碍计数则由**走路例程** `0x40c05c` 在
      //   `0040c3cf mov dword [player+0x32], 0` 一次清光。
      //   本引擎的移动是原子的（没有"动画中途"），故把"清账"折叠到这一回合的入口。
      //   ★ 必须在 `evaluateTurnStart` **之前**判：原版这一支走的是
      //   `0x418ebd` 的 `test [+0x15], 0x30`（与计数无关），而 `evaluateTurnStart`
      //   只在"有计数"时才把 `0x30` 当跳过理由。
      if ((player.whoPlays & WHO_PLAYS_RETURN_TO_BOARD) !== 0) {
        // ★★ 第 86 条：这一回合的**终点**是"走回監獄/醫院格" —— 原版走路例程
        //   边走边把 `x/y` 逐帧改回节点坐标；本引擎的移动是原子的，故在这里
        //   一次落定：`x/y` 重新同步成该节点坐标（`nodeId` 一直是那一格）。
        //   不这么做，被关押期间写的**景观坐标**（綠島/醫院大樓）会一直挂到
        //   下一次掷骰，位置不变量也就没法保持严格。
        //   ⚠️ `withPlayer` 的回调是**原地改**（返回 `void`），别写成 `return …`。
        // ★★ E-41（第十一份試玩回報 #12）：`0x10` **不在这里**清 —— 原版由这一回合的
        //   收尾 `0x418ebd` 消费（`00418f87 and byte [player+0x15], 0xf`），
        //   并且**不推进游标**（`00418f8e jmp 0x419058`）。见 `endTurn` 开头那一支。
        const cleared = withPlayer(state, state.currentPlayer, (p) => {
          p.blocking = {
            ...p.blocking,
            inHotel: 0,
            disappearing: 0,
            inPrison: 0,
            inHospital: 0,
          };
          const gate = topo.nodes[p.nodeId - 1];
          if (gate !== undefined) {
            p.xpos = gate.x;
            p.ypos = gate.y;
            // ★★ 朝向也要重算（`docs/escalations.md` E-13）：原版释放那一支
            //   `0x0043d7cb call 0x40d6be` 除了 `or byte [player+0x15], 0x10`
            //   （= 起步「走回棋盘」）之外，还算了一次朝向：
            // ```asm
            // 0040d6da  dx = word [player + 0x18]          ; ★ +0x18 = nodeId
            // 0040d6e8  edx = [0x498e80]                   ; 景观表
            // 0040d6ee  ecx = word [edx + nodeId*40]       ; 景观 +0x00 = x
            // 0040d6f2  edi = word [edx + nodeId*40 + 2]   ; 景观 +0x02 = y
            // 0040d6f9  dx  = word [player + 0x08]         ; player x
            // 0040d700  sub ecx, edx                       ; dx = 景观x − playerx
            // 0040d704  ax  = word [player + 0x0a]         ; player y
            // 0040d70b  sub edi, eax                       ; dy = 景观y − playery
            // 0040d70f  call 0x454fb4                      ; ★ 八分圆朝向
            // 0040d717  mov byte [player + 0x10], al       ; ← 写 direction
            // ```
            //   ⇒ 朝向 = `directionOf(景观位 − 玩家位)`，指针从**景观**指向**關押格**。
            //   不写这一条，棋子会拿关押前的旧朝向走回棋盘（E-13 报的那一条）。
            //   `0x454fb4` 就是本文件的 `directionOf`（同一支；零位移也不特例，见那里的注）。
            // ⚠️ 判据里的 `gate` 是外层那个 `MapNode`；这个回调的形参叫 `p`，
            //   别把它 shadow 成 `gate`（先前那一版就是这么写出 TS2339 的）。
            const ref = gate.ref;
            const land =
              ref.kind === 'landscape'
                ? topo.landscapes?.find((l) => l.id === ref.index)
                : undefined;
            // ★★ 2026-09-22（第十一份試玩回報 #13「从监狱和医院出来时为什么都是背对着路倒退出来」）：
            //   原版 `0x0040d6ee/f2` 读 node[關押格].x/y，`0x0040d6f9/704` 读 player.xpos/ypos
            //   （在押期間 = 綠島/醫院大樓的景觀座標），然後 `sub ecx,edx` / `sub edi,eax`
            //   ⇒ `directionOf(**關押格 − 景觀位**)`，`0x40d717` 寫進 `player+0x10`。
            //   先前兩個減數寫反 ⇒ 棋子朝景觀位（背對棋盤）倒退走出去。
            if (land !== undefined) p.direction = directionOf(gate.x - land.x, gate.y - land.y);
          }
        });
        // ★★ 第十五份試玩回報（「从监狱里出来那一步为什么没有踩到天使上身？」）：
        //   走回棋盘那一步**照样跑落点处理** `fcn_0041b42d`（关押格上的神明 / 禮物 / 寶箱 / 惡犬…）。
        // ```asm
        // 0040dd37  test byte [player+0x15], 0x30 / je  ; 带 0x10/0x20 的人：
        // 0040dd40  mov  dword [0x48baf8], 1            ;   剩余步数 = 1
        // 0040dd4a  mov  byte  [回合记录+2], 1           ;   直接进走子态（不掷骰）
        // ; 主循环 0x40d7c6 的走子态（跳表 0x40d7b4[1] = 0x40d8d3）：
        // 0040d950  call 0x40c05c                       ; 走路例程（0x10 支：景观位 → 關押格）
        // 0040d959  mov  byte [0x48bb00], 1             ;   走完这一格 ⇒ 置「到格」
        // 0040d960  dec  dword [0x48baf8]               ;   剩余步数 1 → 0
        // 0040d932  cmp  byte [0x48bb00], 0 / je        ; 下一轮：到格了 ⇒
        // 0040d942  call 0x41b42d                       ;   ★ 落点处理（`[0x48baf8] == 0` = 停下来了）
        // ; 0x41b42d 里物件派发 0x41b800 `jmp [种类−1 *4 + 0x41b3e5]`，神明那一支
        // 0041b807  cmp edx(当前行动者), 4 / jge 跳过
        // 0041b816  cmp dword [0x48baf8], 0 / jne 跳过
        // 0041b82d  call 0x40ead7                       ;   ★ 附身 —— 全程不看 +0x15 的 0x10/0x30
        // ```
        //   ⇒ 与普通走子「停在这一格」同一条出口：本引擎就是 `applyArrival`（剩余步数 0）。
        //   关押格本身（格值 0x1f41/0x1f42）不在地产 / 特殊格区间，别的落点结算一律不触发。
        //   惡犬 / 地雷把人送进醫院时，`send_to_hospital` 自己 `and +0x15, 0xf`（`sendToConfinement`）
        //   ⇒ 标记没了，收尾照常换人（与原版 `0x418f07` 同一判据）。
        const landed = applyArrival({ ...cleared, stepsRemaining: 0 }, topo);
        if (landed.phase === 'gameOver') return landed;
        return { ...landed, phase: 'turnEnd' };
      }

      const result = evaluateTurnStart(player);
      const who = turnController(result);

      if (who === 'skip') {
        // 被阻碍或已出局 → 直接进入回合结束（天数递减在 endTurn 处理）
        // ★ 原版在这里**弹一扇框**写「○○住院中／還剩 N 天！」（`fcn_0040c912`，
        //   对当前玩家无条件弹，不分真人与电脑）。`special`（走回棋盘 / 被外力挪过）
        //   与 `notAlive` 两支原版不弹 ⇒ `confinementNotice` 查不到就 `null`。
        const notice = confinementNotice(state, result.blockedBy);
        if (notice === null) return { ...state, phase: 'turnEnd' as const };
        // ★ 第十三份試玩回報：框之前那几句台词**各有 1/2 概率**（见 `GameState.lastBlockedSays`）。
        //   与弹框同一个闸（`special` / `notAlive` 两支原版走 `0x40dd1f` / 直接返回，不掷）。
        const rolled = rollBlockedSays(state.rngState, player.blocking);
        const end = {
          ...state,
          rngState: rolled.rngState,
          lastBlockedSays: rolled.says,
          phase: 'turnEnd' as const,
        };
        return appendNotice(state, end, notice);
      }
      // ★ 時光機的后悔药：真人回合开局先拍一张快照（@source VA 0x004480a0）
      //   电脑的调度步归零（公佈欄那一步挪到了 aiAdvance：原版是买股卖股之后才轮到它）
      let snapped: GameState = { ...snapshotOnTurnStart(state), aiStep: 0, aiBranch: 0 };
      // @source 0x0041cc4b：保險期每日 −1，归零挂 0x80，下一次推进清掉 —— 与阻碍计数同一套
      snapped = withPlayer(snapped, snapped.currentPlayer, (p) => {
        // ★★ 2026-09-19 修（§7.141，通道 2 `test_insurance_richest.py`）：
        //   保险期用**自己那支**递减（无 `0x80 → 清零+释放` 分支）——
        //   原版 `0x41cc4b..0x41cc66` 是整字节递减，`0x80 → 0x7f`，
        //   于是保险期**永不归零**、闸门等于"买过就永久理赔"。
        //   先前借用了阻碍计数器的 `tickBlockingCounter`（`0x80 → 0`），
        //   复刻会在次日停赔。见 `rules/blocking.ts` 的 `tickInsuranceDays`。
        p.insuranceDays = tickInsuranceDays(p.insuranceDays);
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

    case 'rotateView': {
      // ★ 纯表现状态，但**必须进状态**：原版把它存进存档（`+0x2743`），
      //   读档要还原。客户端只负责把按键翻译成这条 action（D-06）。
      const viewRotation = rotateViewBy(state.viewRotation, action.delta);
      return viewRotation === state.viewRotation ? state : { ...state, viewRotation };
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

      // ★★ 第九份试玩回报 #3（Charles，2026-09-22）：「豪雨特報 行人休息一回合」。
      //
      //   目標選擇本來就是對的 —— `events/news-effects.ts` 的 `stopPedestrians` 分支
      //   **遍歷全體**玩家、只跳過出局者與交通方式不符者（回報者自己的 dump 也證實
      //   四人 `trafficMethod=0` 全部寫成 `stopping = 128`）。**缺的是「讀」這一側**：
      //   `blocking.stopping` 全倉只有 寫 / 遞減 / 清零 / 存讀檔 / GO 鈕圖 五類引用，
      //   沒有一個判據把它當成「本回合不走」⇒ 其實**誰都沒停**。
      //   而唯一會隨它變的行為是 GO 鈕被畫成「禁止通行」（`main.ts` 的 `goImageOf`），
      //   只有輪到的那一位（人類）有 GO 鈕 ⇒ 玩家看到的是「只有我自己停了」。
      //
      // @source `0x4012a7`（`rich4_keyboard_hook.asm:251`）
      //   `cmp byte [eax + 0x496ba0], 0 / jne loc_00401523` —— 非 0 直接 return（本回合不移動）；
      //   `fcn_0040dd1f`（`rich4_player_utils.asm:1016-1021`）同形：`+0x38 != 0` ⇒ 走子狀態寫 0。
      //   兩處都在**真正走子**那一步，而不是回合開始的 `fcn_0040c912` ⇒ 閘門放在這裡。
      //   （AI 的股票 / 卡片 / 道具決策在原版裡排在 `fcn_0040dd1f` **之前**，
      //     放進 `startTurn` 會把那些也一併省掉 —— 那是過度。）
      //
      // ★ 判據用 `!== 0` 而不是 `=== 1`：引擎的遞減在舊玩家的 `endTurn` 裡對
      //   **新**當前玩家做（`tickDailyCounters`），新聞寫下的 `1` 輪到他時已經被減成
      //   `0x80`（待釋放），而 `tickBlockingCounter` 的 `0x80 → 0` 要再一輪
      //   （兩段式照抄自 `0x41c895..0x41c8ea`）⇒ `!== 0` 恰好只丟**一個**回合。
      //   同一條閘也順帶讓「停留卡」不再是空卡（`docs/gaps/02-cards.md:110` 列的阻斷級缺口）。
      //
      // ⚠️ 放在 `rng` 之前 ⇒ **不消耗隨機數**（原版這道閘也在 `rand()` 之前，
      //   C-DET-4 的同種子重放一致性不能被這一條打亂）。
      if (player.blocking.stopping !== 0) {
        return { ...state, phase: 'turnEnd' };
      }

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
      // ★ 路过銀行开着 ATM（`pending.kind === 'atm'`）时不许再走：原版那扇窗是模态的，走子在它后面
      if (state.pending !== null && state.pending.kind !== 'none') return state;
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
        // ★★ `xpos/ypos` 必须跟着 `node_id` 走（见 rules/position.ts）：
        //   冬眠卡的「在不在盘上」判据读的就是 `xpos`（`@source 0x0044415d`）。
        //   原版这里写的是**本步的位移方向**（`@source 0x0040d639` 的 atan2），
        //   本引擎按节点移动，故直接取目标格坐标。
        if (to !== undefined) {
          p.xpos = to.x;
          p.ypos = to.y;
        }
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
        // ★★ 2026-09-19 补：**夢遊中的落点闸门**（原版分派器开头的第一道判据）。
        //
        // ```asm
        // 0041986c  imul eax, dword ptr [0x49910c], 0x68   ; eax = 当前玩家
        // 00419873  cmp  byte ptr [eax + 0x496b9f], 0      ; ★ player+0x37 = 夢遊天數
        // 0041987a  je   0x419884                          ; == 0 ⇒ 照常分派
        // 0041987c  test ebx, ebx                          ; ebx = [node+0x24] & 0xff = 格子类型
        // 0041987e  jne  0x41b3d0                           ; ★ 类型 != 0 ⇒ **整段直接返回**
        // ```
        //
        // ⇒ 夢遊中的玩家踩到**任何 type != 0 的格子**（新聞 / 命運 / 監獄 / 醫院 /
        //   樂透 / 得點 / 抽卡 / 銀行 / 百貨 / 魔法屋 / 三个小游戏）**什么都不发生**；
        //   只有 type == 0（住宅/設施/企業的买卖与过路费）照旧结算。
        //   `+0x37` 就是 `days_sleep_walking`（写者 `0x44441d mov byte [eax+0x496b9f], 5`
        //   与 `0x444369`；`0x40cba5` 用它把回合判成「夢遊跳過」并 `call 0x40dd1f`
        //   auto_move —— 走得动，但落点这一支被上面那道闸挡掉）。
        //
        // ⚠️ 先前 `docs/gaps/05-loop-minigames-ai.md` 里的「梦游由 turn-start 提前拦掉、
        //   落点根本不进」是**读错了**：`startTurn` 的夢遊支只是**立刻掷骰并自动走完**
        //   （本引擎在 `startTurn` 里当场掷骰，之后只剩机械的 `step` / `settle`），落点照进。
        //   （2026-09-23：此前 `turnController` 把夢遊的 −1 归成 `skip`，夢遊者其实原地不动 ——
        //   见 `rules/turn-start.ts`。）少了这道闸，夢遊期間会照抽
        //   新聞/命運（正是试玩回报里「事件重复触发」的那一类观感）。
        if (player.blocking.sleepWalking !== 0) return { ...state, phase: 'turnEnd' };
        const out = settleSpecialSquare(
          node.specialKind,
          player,
          state.cardAmount,
          state.rngState,
        );
        let next: GameState = { ...state, rngState: out.rngState, phase: 'turnEnd' };
        // ★ 得５０點那一格选台词的随机数已在 `settleSpecialSquare` 里按原版用掉
        //   （@source 0x0041b1f8），这里只把选中的下标交给表现层。
        if (out.phraseIndex !== undefined) {
          next = {
            ...next,
            lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex: out.phraseIndex },
          };
        }
        if (out.pointsDelta !== 0) {
          next = withPlayer(next, state.currentPlayer, (p) => {
            p.points = addPoints(p.points, out.pointsDelta);
          });
          // ★★ 得点格的棕色訊息框 —— 三档的串**把金额写死在文本里**（没有 `%d`）：
          // ```asm
          // 0041b1be  push 0x3e8             ; ★ 1000 ms，不是 1500
          // 0041b1c3  push 0x463a81          ; 得點券５０點
          // 0041b1c8  call 0x440cac
          // ```
          //   30 點（0x41b25d / 0x41b258）与 10 點（0x41b2e1 / 0x41b2dc）同形。
          const key = POINT_SQUARE_NOTICE[node.specialKind];
          if (key !== undefined) {
            next = { ...next, notices: [{ key, args: [], holdMs: POINT_SQUARE_HOLD_MS }] };
          }
        }
        if (out.cardDrawn !== 0) {
          const cardAmount = [...next.cardAmount];
          const at = out.cardDrawn - 1;
          cardAmount[at] = Math.max(0, (cardAmount[at] ?? 0) - 1);
          // ★ 满手牌口径修正（2026-09-17）：原版抽卡走 `giveCard`（`0x004412e4`，
          //   `0x00441e12` 的抽卡格在 `0x00441e64` 正是 `call 0x4412e4`）——
          //   **满了先丢最便宜的一张再收新的**，不是"满了就不发"。
          //   见 `cards/rob.ts` 的 `giveCard`（照 `0x0044128f` 实现）。
          next = withPlayer({ ...next, cardAmount }, state.currentPlayer, (p) => {
            Object.assign(p, giveCard(p, out.cardDrawn));
          });
          // ★★ 抽卡格的棕色訊息框「得到%s！」—— `%s` = 抽到的**卡片名**：
          //   @source 0x0041b355 `mov edi, [eax*8 + 0x47fdea]`（卡片表第 0 项 =
          //   name 指针，1 基编号 ⇒ `0x47fdea + id*8` 正是 `0x47fdf2 + id*8`）
          //   + 0x0041b35d `push 0x463aa8` + 0x0041b36f..0x41b372（sprintf / 弹框前）
          //   + 0x0041b968 `push 0x5dc`（1500 ms）
          next = { ...next, notices: [{ key: 'points.card', args: [cardNameOf(out.cardDrawn)] }] };
          // ★ 抽卡格尾部的**条件性**随机消耗（原版 `0x0041b37b`–`0x0041b38c`）：
          //   `0x0041b37b mov al, [card*8 + 0x47fdef]`（卡价）→ `call 0x44f230(player, 价格)`，
          //   而 `0x44f230` 里只有 **`50 < 价格 <= 100`** 这一支会：
          //   ```asm
          //   0044f23f  cmp  edx, 0x64
          //   0044f242  jle  0x44f262        ; > 100 → 取台词[事件 0]，**无 rand**
          //   0044f262  cmp  edx, 0x32
          //   0044f265  jle  0x44f292        ; <= 50 → 另一支，**无 rand**
          //   0044f280  call 0x456f2d        ; ★ rand()
          //   0044f285  and  eax, 1
          //   0044f288  mov  edi, [角色*0x6C + eax*4 + 0x48084a]
          //   ```
          //   受影响的卡只有 3 张：11 怪獸(60)、15 冬眠(100)、30 烏龜(70)。
          //   ⚠️ `0x44f230` 全库共有 **6 个**调用点（`0x40ee46`/`0x452753`/`0x42ea23`/
          //   `0x41b98b`/`0x41bafa`/`0x41b38c`），本条只接了**抽卡格**这一个；
          //   其余 5 处（含百貨公司 `0x42e931`）的同一消耗**未接**，见差距日志。
          const price = priceOf(out.cardDrawn);
          if (price > 0x32 && price <= 0x64) {
            const rng = new WatcomRng();
            rng.setState(next.rngState);
            const phraseIndex = rng.next() & 1;
            next = {
              ...next,
              rngState: rng.getState(),
              lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex },
            };
          }
        }
        // 新聞／命運：抽一张可行的事件并施加其效果
        // ★ 新聞有一部分效果**要用随机**（27/28 抽股票），走引擎那条 PRNG 流：
        //   单机可完整复现、联机两端一致（C-DET-4）。
        if (node.specialKind === SPECIAL_KIND.NEWS) {
          const rng = new WatcomRng();
          rng.setState(next.rngState);
          const applied = drawAndApplyNews(next, topo, rng);
          return { ...applied, rngState: rng.getState() };
        }
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

        // ★ 銀行：落点先走 **ATM 入口**（`0x0041b396 call 0x4379c9`），再进貸款屏（`0x0041b3af call 0x436668`）。
        //   - 拒絕往來：ATM 入口弹框 1000 ms，貸款屏入口 `0x0043667b` 也直接返回 ⇒ 什么交互都不给；
        //   - **恰好** who_plays == 1 的真人：先挂 ATM（`pending {kind:'atm', landing:true}`），
        //     答掉之后才换成貸款屏（第十三份试玩回报 #2，见 `enterBankRoom`）；
        //   - 其余（电脑 / 托管）：按 `cashRatio`(+0x19) 重分現金／存款（`loc_00437acd`），再进柜台。
        if (node.specialKind === SPECIAL_KIND.BANK) {
          next = bankAtmEntry(next, true);
          if (next.pending?.kind === 'atm') return next;
          // ★ ATM 入口返回 ⇒ `0x0041b3af call 0x436668`：真人开貸款屏，其余当场走电脑那一支
          return enterBankRoom(next, topo);
        }

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
          // ★★ 2026-09-22 订正（第八份试玩回报 #10）：上面那段话的**结论**是错的。原版五处消费点的次序都是
          //   「现金够不够 → 弹確認框（真人 YES/NO `0x440ba8` / 电脑 `0x41d7d4`）→ **然后**才 `call 0x40fa61`
          //   查衰神/死神 → 中了就弹「%s顯靈 拘資失敗！」（`0x463514`，1500 ms）并放弃」
          //   （買地 `0x0041a0ab → 0x0041a0c7`、加蓋 `0x00419996 → 0x004199ae`、買設施 `0x0041a8ec → 0x0041a908`、
          //   設施首建 `0x0041a261`、設施加蓋 `0x0041a31e → 0x0041a336`）。
          //   ⇒ 框**要弹**；点了「買下」才被神明拦下并**告诉你为什么**。先前这里提前拦、又不弹任何提示，
          //   玩家看到的就是「踩到空地什么都不发生」。拦截与提示统一在 `godBlockedPurchase()`。
          const buy = canPurchase(land, player, state.priceIndex);
          if (!buy.ok) {
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
          if (!up.ok) {
            // ★ 2026-09-23：前几道闸都过了、只差现金 ⇒ 弹「您的現金不足！」（1500 ms，真人电脑都弹）
            //   @source `0x0041994b cmp ebp, [現金] / jg 0x419a52` → `0x00419a52 push 0x5dc` /
            //   `0x00419a57 mov eax, 0x46398b` → `0x00419a5d call 0x440cac`
            if (up.reason === 'notEnoughCash') {
              return appendFreshNotice({ ...state, phase: 'turnEnd' }, { key: 'land.cashShort', args: [] });
            }
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
          const exemption =
            landlord === undefined
              ? null
              : tollExemption(landlord, state.currentPlayer, land.priceStatus);
          if (landlord === undefined || exemption !== null) {
            // ★★ 免收那一路**也弹棕色訊息框**（试玩第四份回报第 8 条）：
            //   `0x41d559` 的每条免收支都先 `call 0x457110`（sprintf）一句，
            //   再跳到同一处弹框：
            // ```asm
            // 0041d6a4  push 0x5dc              ; 1500 ms（与租金框同一个数）
            // 0041d6a9  lea  eax, [esp + 4]    ; sprintf 出来的那一句
            // 0041d6ad  push eax
            // 0041d6ae  call 0x440cac          ; ★ 通用訊息框
            // 0041d6e5  mov  eax, ebx          ; ebx = 0 ⇒ 返回「免收」
            // ```
            //   参数顺序 = 原版 `sprintf(fmt, 地主名, 費名)`：地主名由函数开头
            //   `0x41d57d call 0x452946`（跳过空格的拷名）填好，費名是第 3 个实参
            //   （住宅这条路 = `[0x47517c]` 第 0 项「過路費」，见 rules/rent.ts）。
            //   ⚠️ **九种不是同一个参数表**：查封（0x41d59f）与死神（0x41d5fa）
            //   只推了 `esi`（費名）一个实参，所以那两句只有一个 `%s`；
            //   同盟（0x41d5ce）与住宿/消失/坐牢/住院/冬眠/夢遊 是「名字 + 費名」
            //   两个实参。见 `exemptionNotice` 的 @source。
            const notice = exemption === null ? null : exemptionNotice(
              exemption,
              playerName(state, land.owner - 1),
              LAND_TOLL_FEE_NAME,
              state.currentPlayer,
            );
            if (notice === null) return { ...state, phase: 'turnEnd' };
            return { ...state, notices: [notice], phase: 'turnEnd' };
          }
          const lands = allEffectiveLands(state, topo);
          // 先算出費额（collectRent 是纯函数，预演一遍只为拿 total）
          const preview = collectRent(state.players, lands, state.currentPlayer, land, state.priceIndex);
          // ★★ 棕色訊息框（issue #18）—— @source 0x00419d50 `push 0x5dc / call 0x440cac`
          //   一格都没跳：框在**免費卡/嫁禍卡/死神**那一段（0x00419e36 起）**之前**弹，
          //   所以免费卡那一路也照样弹（金额仍是原价）。
          //   `%d` 用的是 `baseTotal`（= 地主份 + 同盟份，已含涨价翻倍），
          //   **神明调整之前**那一笔；`preview.total` 是调过之后的，别拿它来显示。
          const notice: NoticeHint =
            landlord.alliedPlayer === 0
              // @source 0x00419d3e `push 0x4639b3`（地產名 / 地主名 / 金额 / 費名）
              ? {
                  key: 'rent.payOneOwner',
                  args: [land.name, playerName(state, land.owner - 1), preview.baseTotal, LAND_TOLL_FEE_NAME],
                }
              // @source 0x00419d1a `push 0x46399a`（地產名 / 地主名 / 同盟名 / 金额 / 費名）
              : {
                  key: 'rent.payTwoOwners',
                  args: [
                    land.name,
                    playerName(state, land.owner - 1),
                    playerName(state, landlord.alliedPlayer - 1),
                    preview.baseTotal,
                    LAND_TOLL_FEE_NAME,
                  ],
                };
          // ★★ **一 action 两扇框**：租金框之后原版还会弹**死神框**
          //   （@source 0x00419f04 `push 0x4639cc` + 0x00419f16 `push 0x5dc /
          //   call 0x440cac`）——所以这里是数组，不是单个字段（见 types.ts 的 `notices`）。
          const notices: NoticeHint[] = [notice];
          // ★ 第十四份：租金框之后 `0x00419d70 call 0x41d709` —— 付款方身上的財神 / 窮神改了金额就再弹一扇
          const godNotice = godTollNotice(
            state.players[state.currentPlayer]?.godInfo ?? 0,
            preview.baseTotal,
            preview.total,
            LAND_TOLL_FEE_NAME,
            state.currentPlayer,
          );
          if (godNotice !== null) notices.push(godNotice);
          // ★★ W-69：这一段演出要「把算进这笔过路费的每一块地一起闪一遍」——
          //   原版在弹費用訊息框**之前**把这些格标进 id 图（`0x00419b9e` 起），
          //   塊數 ≤ 1 時整段跳過（`0x00419c79 cmp [esp+0xe8],1 / jle`）。
          //   瞬态字段，规矩同 `lastCardPlay`（见 types.ts 的 `lastTollLands`）。
          const tollLandsHint = preview.counted.length > 1 ? preview.counted : null;
          let pre: GameState = { ...state, lastTollLands: tollLandsHint };
          for (const n of notices) pre = appendFreshNotice(pre, n);
          // ★ 尾巴照 0x00419e36 起：免費卡 → 嫁禍卡 → 死神顯靈由他人賠償 → 付钱（`runTollTail`）
          return runTollTail(pre, topo, {
            route: { path: 'rent', landId: land.id },
            payer: state.currentPlayer,
            who: state.currentPlayer,
            toll: preview.total,
            feeName: LAND_TOLL_FEE_NAME,
            freeDone: false,
          });
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
      if (!bought.ok) return godBlockedPurchase(state, bought.reason);
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const landOwner = [...paid.landOwner];
      landOwner[landIndex] = state.currentPlayer + 1;
      // @source 0x0041a108：土地權限非無限期时写到期日（flast）
      const landTenure = [...paid.landTenure];
      landTenure[landIndex] = tenureExpiry(packDate(state), state.landTenureIndex);
      const boughtLand: GameState = { ...paid, landOwner, landTenure, pending: null, phase: 'turnEnd' };
      // ★★ 2026-09-22 订正（第九份试玩回报第 2 条）：福神附身时**買地也白送一级**。
      //   買地这一支收尾**不是**回 `0x41b077`，而是 `jmp near loc_00419a48`
      //   （`rich4_player_core_actions.asm:1079`，`0x0041a013` 那一路：`:1041` 写 owner、
      //   `:1069` 扣钱之后直接跳）⇒ 与「升級房子」那一支**同一个** `call fcn_0040f8be`
      //   （`rich4_gods.asm:1589`，只放行 god 3/4）⇒ 再走 `0x40b110` 加一级。
      //   ⚠️ 同一支 `jmp` 共**四个**源（旧注释只认升級那一个，是错的）：
      //     買地 `:1079` / 付費首建設施 `:1169` / 付費加蓋設施 `:1218`（jmp `loc_00419a39`）/
      //     買設施 `:1726`。
      //   实体号与 `upgradeLand` 那处一致（地块 = `0x7d0 + landIndex`）。
      return luckyGodBonus(state, boughtLand, topo, 0x7d0 + landIndex);
    }

    // ── 設施：買 / 首建（选种类）/ 加蓋 ──
    // @source 0x0041a86b / 0x0041a1f2 / 0x0041a2b3，三条各自查一遍衰神拦截
    case 'buyFacility': {
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'buyFacility') return state;
      const player = state.players[state.currentPlayer];
      const fac = facilityAtPlayer(state, topo);
      if (player === undefined || fac === null || fac.owner !== 0) return state;
      const bought = purchase(player, facilityBuyPrice(fac.landPrice, state.priceIndex));
      if (!bought.ok) return godBlockedPurchase(state, bought.reason);
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const facilityOwner = [...paid.facilityOwner];
      facilityOwner[fac.id] = state.currentPlayer + 1;
      // @source 0x0041a978 `mov [設施 + 0x34], eax`
      const facilityTenure = [...paid.facilityTenure];
      facilityTenure[fac.id] = tenureExpiry(packDate(state), state.landTenureIndex);
      const boughtFacility: GameState = { ...paid, facilityOwner, facilityTenure, pending: null, phase: 'turnEnd' };
      // ★★ 2026-09-22 订正：買設施收尾同样 `jmp near loc_00419a48`
      //   （`rich4_player_core_actions.asm:1726`：`loc_0041a97b` 扣完钱直接跳）
      //   ⇒ 福神再白送一级（等級 0 的設施原版会在 `0x40b110` 里当场弹选种类框，
      //   即 `godFreeBuild` 的 `free: true` 那一支）。
      return luckyGodBonus(state, boughtFacility, topo, 0xfa0 + fac.id);
    }

    case 'buildFacility': {
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'buildFacility') return state;
      const player = state.players[state.currentPlayer];
      const fac = facilityAtPlayer(state, topo);
      if (player === undefined || fac === null) return state;
      if (state.pending.free === true) {
        // ★ 神明顯靈代蓋的那一次（`0x40b110` 里的 `0x0040b1e4 call 0x440aac`）：
        //   **不收钱、不看归属、不过衰神闸**（`0x40b110` 整支没有 `call 0x40fa61`）
        if (!state.pending.choices.includes(action.facilityType)) return state;
        const built = freeBuildFacilityById(state, topo, fac.id, action.facilityType);
        if (built === null) return labPanelTail({ ...state, pending: null, phase: 'turnEnd' }, topo);
        // 这扇框在尾块里（福神 `0x40f8be` / 天使 `0x40f381` 都在 `0x0041b0b3` 之前）⇒ 选完接着问研究所
        return labPanelTail(
          withSingleBuildUpgrade({ ...built.state, pending: null, phase: 'turnEnd' }, buildHintOf(built, 'godManifest')),
          topo,
        );
      }
      if (fac.owner !== state.currentPlayer + 1 || fac.level !== 0) return state;
      if (!state.pending.choices.includes(action.facilityType)) return state;
      const bought = purchase(player, facilityBuildPrice(fac.landPrice, state.priceIndex));
      if (!bought.ok) return godBlockedPurchase(state, bought.reason);
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const facilityType = [...paid.facilityType];
      const facilityLevel = [...paid.facilityLevel];
      facilityType[fac.id] = action.facilityType;
      facilityLevel[fac.id] = 1;
      // ★★ W-55 行 3 的**第 4 个**音效点：**付费首建設施（0 → 1 级）**也响
      //   `Effect.mkf` 50（`0x4823da`）—— 先前只接了天使/福神/自己加蓋三处。
      //   @source `0x0041a27c inc byte [eax + 0x1a]` → `0x0041a27f call 0x41d476`
      //     → `0x0041a289 push 0x4823da / call 0x4542ce`（`disasm.py va 0x41a240 50`）。
      //   ★ 这一支**没有** `0x229`（大锤）、也没有 bit7 —— 原版首建那一支
      //     （`0x40b1f4 mov eax,1 / inc byte [...] / ret`）本就不置位，所以
      //     `reachedMaxLevel: false` ⇒ 不播任何影片，只响那一声
      //     （这正是 `manifestSoundFor` 注释里说的「与影片闸无关」）。
      const builtFacility = withSingleBuildUpgrade(
        { ...paid, facilityType, facilityLevel, pending: null, phase: 'turnEnd' },
        { entity: 0xfa0 + fac.id, reachedMaxLevel: false, source: 'facilityFirstBuild' },
      );
      // ★★ 2026-09-22 订正：付費首建（0 → 1）收尾也 `jmp near loc_00419a48`
      //   （`rich4_player_core_actions.asm:1169`：`0x41a25a` 那一路 `inc [+0x1a]` 后直接跳）
      //   ⇒ 福神再送一级到 2 级。首建 0 → 1 不可能到 5，故没有 `cmp dh,5` 的绕过。
      return luckyGodBonus(state, builtFacility, topo, 0xfa0 + fac.id);
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
      // ★ 第十五份：自家公司（`charge` 为假）蓋两次（`ownCompanyBuild`）；别人的公司一次
      const built = pend.charge
        ? freeBuildEntity(state, topo, action.entityId, -1)
        : ownCompanyBuild(state, topo, action.entityId);
      if (built === null) return state;
      // ⚠️ 建設公司这一支在原版里也播 0x229 大锤 + 消费 bit7
      //   （@source 0x0041ad7e → 0x0041ad99 call 0x45144f（大锤）→ 0x0041adaa
      //   test byte [esp+0xbc], 0x80 → 0x0041adb4 call 0x40b0cd）。
      //   ⇒ 与機器工人同构（先大锤、再 bit7 时 0x20b），客户端按 `companyBuild` 播。
      // ★ 第十一份回报 #7：镜头先移到**待修建的那一处**（原版 `0x41aadf call 0x41d476`，
      //   在 `0x41aae8` 加蓋与 `0x41ab10` 大锤**之前**）；`syncViewTarget` 会一直停在那儿
      //   直到大锤影片与台词演完（`stageBusy` 含 `buildFx`）再收回。
      const viewTarget = entityViewTarget(state, topo, action.entityId);
      let next: GameState = {
        ...withSingleBuildUpgrade(built.state, buildHintOf(built, 'companyBuild')),
        pending: null,
        ...(viewTarget === null ? {} : { lastViewTarget: viewTarget }),
      };
      if (pend.charge) {
        // @source 0x0041adc0：工程費 = 那处地的地價 × 物價，付给公司
        //   ★ 第十四份：选完之后走的是同一段收費（框 `0x0041aeaa` → 神明 `0x0041aec5`，见 `chargeCompanyFee`）
        const fee = entityLandPrice(next, topo, action.entityId) * next.priceIndex;
        const c = topo.commercials?.find((x) => x.id === pend.commercialId);
        if (c !== undefined) return chargeCompanyFee(next, topo, state.currentPlayer, c, fee);
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
      if (!bought.ok) return godBlockedPurchase(state, bought.reason);
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = bought.player.cash;
      });
      const facilityLevel = [...paid.facilityLevel];
      facilityLevel[fac.id] = fac.level + 1;
      const upgradedFacility: GameState = { ...paid, facilityLevel, pending: null, phase: 'turnEnd' };
      // ★★ 2026-09-22 订正：付費加蓋（`loc_0041a2b3`）收尾 `jmp near loc_00419a39`
      //   （`rich4_player_core_actions.asm:1218`）⇒ 与「升級房子」同构地进 `0x40f8be`。
      //   剛好到 5 级那一支 `cmp dh,5 / je near loc_004199f1` **绕过**福神（照抄，与
      //   `upgradeLand` 的 `land.level + 1 === MAX_LAND_LEVEL` 同一条规矩）。
      // 研究所面板在尾块里（顯靈之后），由 `labPanelTail` 统一接
      return fac.level + 1 === 5 ? upgradedFacility : luckyGodBonus(state, upgradedFacility, topo, 0xfa0 + fac.id);
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
      if (!built.ok) return godBlockedPurchase(state, built.reason);
      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash = built.player.cash;
      });
      const landLevel = [...paid.landLevel];
      landLevel[landIndex] = land.level + 1;
      // ★ 落点「升級房子」那一支**也要记提示**（§7.143(1b) 的「E6 剩余」里点名的
      //   `0x004198b9` 那个未接线消费点）：
      //   `0x004199eb cmp byte [esi + 0x1a], 5` → `0x00419a21 call 0x40b0cd`
      //   ⇒ 剛好升到 5 級时播 `Data.mkf` 0x20b（放烟花）。
      //   这一支**不走 `0x40b110`**（`0x004199d1 inc byte [esi + 0x1a]` 直接加 1），
      //   函数体里也**没有** `push 0x229` ⇒ **绝不播大锤**（大锤全 exe 只有 4 处：
      //   `0x0041aab8` / `0x0041ad4d` / `0x00432028` / `0x0044731a`）。
      //   客户端据此把 `source = 'ownUpgrade'` 映射成「只播 0x20b」。
      const upgraded = withSingleBuildUpgrade({ ...paid, landLevel, pending: null, phase: 'turnEnd' }, {
        entity: 0x7d0 + landIndex,
        reachedMaxLevel: buildUpgradeBit7(land.level, land.level + 1),
        source: 'ownUpgrade',
      });
      // ★ 福神「蓋房子投資加倍」：没到 5 级才轮到它（到 5 级那支 `0x00419a26 jmp 0x41b077` 绕过）
      //   @source `0x004199eb cmp byte [esi+0x1a],5 / jne 0x419a2b` → `0x00419a48 call 0x40f8be`
      if (land.level + 1 === MAX_LAND_LEVEL) return upgraded;
      return luckyGodBonus(state, upgraded, topo, 0x7d0 + landIndex);
    }

    case 'buyStock':
    case 'sellStock': {
      let traded = tradeStock(state, action);
      // ★ 2026-09-23：**电脑**买 / 卖股各弹一扇「%s\n\n買進%s%d張」/「賣出」（1500 ms）——
      //   `[玩家名, 股名 [股*36+0x496980], 张数]`。真人在股市柜台（`0x0042afc6`）买卖**不弹**。
      //   @source 买 `0x0042c770 push 0x464186` → `0x0042c78c call 0x440cac`；
      //           卖 `0x0042d076 push 0x4641cc` → `0x0042d092 call 0x440cac`
      const trader = state.players[state.currentPlayer];
      if (traded !== state && trader !== undefined && isAiControlled(trader)) {
        traded = appendFreshNotice(traded, {
          key: action.type === 'buyStock' ? 'stock.aiBuy' : 'stock.aiSell',
          args: [
            playerName(state, state.currentPlayer),
            stocksOfMap(state.globalMapId)[action.stock]?.name ?? '',
            action.shares,
          ],
        });
      }
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
      return buySharesFromCommercial(state, action.shares, topo);

    case 'useCard':
      return afterAiStep(state, playCard(state, topo, action.cardId, action.target ?? { kind: 'none' }), topo, 3);

    case 'useTool': {
      const used = useToolAction(state, topo, action.toolId, action.nodeId ?? 0, action.value ?? 0);
      // ★★ 第十一份試玩回報 #3：道具台词（原版 `player_say(角色, 0, _tool_strings[角色][道具号−1])`，
      //   在 human/AI 分流**之前** ⇒ 电脑也说）。
      //   与 `lastCardPlay` 同一条规矩：**真的用出去了**才写（`used === state` = 没生效 ⇒ 不说）。
      let stamped: GameState =
        used === state
          ? used
          : { ...used, lastToolUsed: { player: state.currentPlayer, toolId: action.toolId } };
      // ★ 2026-09-23：**电脑**用道具先弹「使用%s」（`%s` = 道具名 `[id*8+0x47feda]`，1500 ms），再施加 ——
      //   排在道具自己的影片（飛彈 / 機器工人…）**之前** ⇒ `beforeFilms`。
      //   @source 电脑道具循环 `0x00448039 call 0x420e9a`（要不要用）→ `0x00448054 push 0x4653e5` →
      //   `0x00448066 push 0x5dc` → `0x00448070 call 0x440cac`；真人走道具欄，不弹。
      const user = state.players[state.currentPlayer];
      if (used !== state && user !== undefined && isAiControlled(user)) {
        // 排在道具自己可能弹的框之前（这一扇在施加之前）
        const own = staleNoticeLists.has(stamped.notices) ? [] : stamped.notices;
        stamped = {
          ...stamped,
          notices: [{ key: 'tool.aiUse', args: [toolNameOf(action.toolId)], beforeFilms: true }, ...own],
        };
      }
      return afterAiStep(state, stamped, topo, 3);
    }

    case 'shop':
      return shopAction(state, action);

    case 'noticeBoard':
      return noticeBoardAction(state, topo, action);

    case 'declineDecision': {
      // ★ 「不了」对**任何**待决交互都合法（rules/interaction.ts 的
      //   `responseMatches` 第一句就是这个），故不只在 awaitingDecision 生效：
      //   银行、樂透、百貨这些柜台也得有办法关门走人。
      //
      // ★★ 免费代蓋那一支（天使/福神顯靈 + 真人 + 0 级設施）**有意偏离原版**：
      //   原版 `0x0040b1e4 call 0x440aac` 取回选類別窗的结果后
      //   `0x0040b1ec mov byte [ebx+0x18], al` 把**低字节**直接写进种类，
      //   紧接着 `0x0040b1f4 inc byte [ebx+0x1a]` 加一级 —— **没有** `cmp al,0xff`
      //   拦截（对照加蓋卡 `0x004431d7 cmp eax,-1 / jne`）。而那扇窗**确实能取消**
      //   （右键 `0x205` 支与自定义消息 `0x401` 都返回 −1，见 E-20 的证据表）
      //   ⇒ 原版取消后会盖出一栋**种类 = 0xff（越界）** 的設施。
      //   复刻保留「取消 = 不蓋」并登记为有意偏离（原版那一路写越界 type，
      //   状态校验会在别处炸开；玩家按取消的意图也是不建）。
      // ★ 第十四份：收費那一段的被动卡 —— NO / 右键 = 不用（免費卡 `0x00444afe cmp eax,1 / jne`；
      //   嫁禍卡 `0x00444863 mov ebx,-1` / 选人窗右键 −1），**收費照走**（不是结束回合）
      if (state.phase === 'awaitingDecision' && state.pending?.kind === 'freeCard') {
        return runTollTail(state, topo, state.pending.tail, { free: false });
      }
      if (state.phase === 'awaitingDecision' && state.pending?.kind === 'scapegoat') {
        return runTollTail(state, topo, state.pending.tail, { scapegoat: -1 });
      }
      if (state.phase === 'awaitingDecision') {
        // 不加蓋也照样走到落点尾块：自己的研究所要问研發（0x0041b0b3，由 `labPanelTail` 接）
        return { ...state, pending: null, phase: 'turnEnd' };
      }
      if (state.pending === null) return state;
      // ★ 还款提醒窗（`0x436034`）关了 ⇒ `0x43695e` 返回、`0x436a5a` 返回，`0x41c84f` 接着走完这一天
      //   （阻碍计数 → 释放 → 其余回合计数 → 神明任期），相位仍是 `turnStart`。
      if (state.pending.kind === 'loanReminder') {
        return tickActorDay({ ...state, pending: null }, topo, state.currentPlayer);
      }
      // ★ 路过銀行的 ATM 窗在**走子中途**弹出：关窗只是关窗，剩下的步数照走（原版 `fcn_0041b42d` 那一支
      //   `call 0x4379c9` 返回后接着往下处理这一步，不结束回合）
      //   ★ 落点那台（`landing`）关窗 = ATM 入口返回 ⇒ 接着进貸款屏（`0x0041b3af call 0x436668`）
      if (state.pending.kind === 'atm') {
        return state.pending.landing === true ? enterBankRoom(state, topo) : { ...state, pending: null };
      }
      // ★ 魔法屋的女巫窗口**没有取消**（原版状态 7 只收 1..13 格的左键，右键只在
      //   状态 < 3 跳过开场白，@source 0x00432e64 / 0x00432e8e）——「不了」不能让这一趟
      //   什么都不发生。按託管处理：电脑那一支替他掷效果（见 `answerMagicHouse`）。
      if (state.pending.kind === 'magicHouse') return answerMagicHouse(state, topo, null);
      return { ...state, pending: null, phase: 'turnEnd' };
    }

    case 'bank': {
      // ★ 路过銀行的 ATM（`pending.kind === 'atm'`）只收存款 / 提款，办完一笔就关（原版 ATM 窗是模态的）
      //   落点那台（`landing`）办完这一笔接着进貸款屏（见 `enterBankRoom`）。
      if (state.pending?.kind === 'atm') {
        if (action.op !== 'deposit' && action.op !== 'withdraw') return state;
        const who = state.players[state.currentPlayer];
        if (who === undefined || !isAlive(who)) return state;
        // ★ 銀行暫停放款期内 ATM 只给「存款」：`0x00437028 mov [0x48c3f0],1`（模式 = 存款）且
        //   `0x004371e5 cmp byte [+0x3c],0 / 0x004371ee mov ebx,[0x48c3f0]` 把「点提款钮」换成当前模式 ⇒ 提不了
        if (action.op === 'withdraw' && who.bankFreezeDays !== 0) return state;
        const moved = action.op === 'deposit' ? deposit(who, action.amount) : withdraw(who, action.amount);
        if (moved === who) return state;
        const after = withPlayer(state, state.currentPlayer, (p) => {
          p.cash = moved.cash;
          p.moneyInBank = moved.moneyInBank;
        });
        const settled = action.op === 'withdraw' ? settleBankReserve(after, topo) : after;
        return state.pending.landing === true ? enterBankRoom(settled, topo) : { ...settled, pending: null };
      }
      if (state.pending === null || state.pending.kind !== 'bank') return state;
      const me = state.players[state.currentPlayer];
      if (me === undefined || !isAlive(me)) return state;
      // ★ 貸款屏开着时被托管：座位已归电脑 ⇒ 按电脑那一支（`0x004367ab`）办完、关屏。
      //   恰好真人（`who_plays == 1`）不认这一手 —— 他的选择只能是屏上那几颗钮。
      if (action.op === 'auto') {
        if ((me.whoPlays & 0xff) === WHO_PLAYS_HUMAN) return state;
        return aiBankRoom({ ...state, pending: null }, topo);
      }
      const wealth = state.pending.wealth;
      let next: Player;
      // ★ 貸款屏**没有**存款 / 提款：原版那扇窗（`fcn_00435062`）的命中表 `0x4757f8` 只有四颗
      //   —— EXIT / 申請貸款(週轉現金) / 償還貸款(歸還款項) / 窗(特別融資)；存提只在它前面那台
      //   ATM（`0x0041b396 call 0x4379c9`，本引擎的 `pending.kind === 'atm'`）里办。
      //   故 `deposit` / `withdraw` 在这里落进 default（原样返回）。
      switch (action.op) {
        case 'borrow': {
          const r = borrow(me, action.amount, wealth);
          // @source `0x0043526d call 0x433b7e` —— 借到手（额 ≠ 0，`0x0043524f test eax,eax / je`）就定还款日
          next = r.borrowed === 0 ? r.player : withLoanDueDate(r.player, state, state.globalMapId);
          break;
        }
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
      // （取款之后那次特別融資对账 `0x0043784d push 1 / call 0x436b0a` 在 ATM 那一支，见上）

      // 刷新柜台上显示的数字（额度会随贷款与融资变）
      const refreshed: GameState = {
        ...after,
        pending: {
          kind: 'bank',
          wealth,
          loanCapacity: loanCapacity(wealth, next.loan),
          specialFinance: specialFinanceOf(after, topo, state.currentPlayer),
        },
      };
      // ★ 2026-09-23：**电脑**在柜台贷款之后弹「%s\n\n向銀行貸款\n\n%d元」（`%d` = 贷款字段 `[+0x24]`，1500 ms —
      //   原版电脑支只在 `loan == 0` 时借（`0x004367ab`），所以那就是这一笔）；
      //   真人走貸款屏的填数窗，不弹。@source `0x00436906 add [存款], eax` → `0x0043692f push 0x464b0c` →
      //   `0x00436941 push 0x5dc` → `0x0043694b call 0x440cac`
      if (action.op === 'borrow' && isAiControlled(me) && next.loan > me.loan) {
        return appendFreshNotice(refreshed, {
          key: 'bank.aiBorrow',
          // @source `0x00436921 mov ecx, [eax + 0x496b8c]`（+0x24 = 贷款）
          args: [playerName(state, state.currentPlayer), next.loan],
        });
      }
      return refreshed;
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
        // ★★ 第 160 条（N2）：**每一口成功加价都把四个座位状态清 0**
        // ```asm
        // 0043a6a4  mov eax,[0x48c4a4] / 0043a6a9 mov [0x48c4a8], eax  ; top ← 当前槽
        // 0043a6ae  xor ebx,ebx
        // 0043a6b0  mov esi,ebx / mov eax,ebx / shl eax,2 / add eax,ebx / xor esi,ebx
        // 0043a6bb  mov word ptr [eax*4 + 0x48c436], si               ; ★ 四个状态全写 0
        // 0043a6c3  inc ebx / cmp ebx,4 / jl 0x43a6b0
        // 0043a6c9  or byte ptr [0x48c4a5], 1
        // ```
        //   ⇒ 刚 PASS 过的人**下一口又活了**（可以重新举牌）。
        //   ⚠️ 但「出不起（按钮 6 = 放棄）」是**把座位整个摘掉**
        //   （`0x43a462 mov word [eax*4+0x48c434], dx`，清的是座位**玩家号** +0），
        //   所以那种座位**不会**被这一轮清零复活 —— 下面按状态区分。
        for (const b of pending.bidders) {
          if (status[b] === 'passed') status[b] = 'active';
        }
      } else {
        // @source PASS 0x43a426 写 1（保留座位）/ 出不起 0x43a43a 清座位 +0（摘掉）
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
          const notices = npcNotices(state, walk.events, npc.owner);
          paid = {
            ...settled.state,
            specialActors,
            rngState: rng.getState(),
            lastNpcWalks: [{ slot: slotIdx, path: walk.path, steps: npc.stepsRemaining }],
            ...(notices.length > 0 ? { notices } : {}),
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
          // ★ 半路踩到地雷被送医（@source 0x41be5f → `0x43ec3f(actor, 3)`）：
          //   出狱的那张表照旧（源已清），**医院表要置上**。
          if (walk.events.some((e) => e.kind === 'trap' && e.hospital)) {
            const back = [...after.hospitalOccupancy];
            back[action.slot] = 1;
            after = { ...after, hospitalOccupancy: back };
          }
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
    case 'birthdayCard':
      return answerBirthdayCard(state, action.seat, action.cardId);

    // ★ 第十四份（D-008 收口）：真人答收費那一段的被动卡
    case 'answerFreeCard':
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'freeCard') return state;
      return runTollTail(state, topo, state.pending.tail, { free: action.use });

    case 'answerScapegoat': {
      if (state.phase !== 'awaitingDecision' || state.pending?.kind !== 'scapegoat') return state;
      const pend = state.pending;
      // 只认候选里的人；−1 = 不嫁禍（卡留着）
      if (action.target !== null && action.target !== -1 && !pend.candidates.includes(action.target)) return state;
      return runTollTail(state, topo, pend.tail, { scapegoat: action.target });
    }

    case 'magicHouse':
      return answerMagicHouse(state, topo, action.option);

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
      const after = npcRoundStep(state, topo, nextAlivePlayer(state, state.currentPlayer));
      // ★★ 第 85 条：惡人段**在这一条 action 里走完**的 ⇒ 该给下一位玩家走一天了。
      //   递减/释放/神明任期本来在 `endTurn` 里做，而惡人段把"轮到下一位"交给了
      //   `npcStep` —— 这里不补，**每一輪**都会漏掉这位玩家的一天
      //   （在押/住宿/冬眠永不到期）。走完的标志是 `npcRoundStep` 切到了 `turnStart`。
      if (after.phase !== 'turnStart') return after;
      return startActorTurn(after, topo, after.currentPlayer);
    }

    case 'endTurn': {
      if (state.phase !== 'turnEnd') return state;
      // ★ 惡人段没走完之前不许 `endTurn`：那会把同一輪的惡人再走一遍
      //   （计数被 tick 两次、`lastNpcWalks` 被覆写成第二批）。这段时间属于
      //   `npcStep` —— 见 `npcRoundStep` 与 `autoAction` 的注释（D-T047-5）。
      if ((state.pendingNpcSlots ?? []).length > 0) return state;

      // ★★ 第 92 条：给**正要离场的那位**清掉「位置被外力挪过」（`+0x15 & 0x20`）。
      //   @source 0x00418ebd 的「被阻碍」支：`00418f87 and byte [player+0x15], 0xf`
      //   —— 判的是**当班者**（`ecx = [0x49910c]`，就在推进游标**之前**），
      //   即「这一位自己的回合边界上把标记消费掉」。`0x20` 由 `0x40d5a5`（挪到旅館）
      //   置位，唯一的规则后果在回合开始判定 `0x40c912`：
      //   `dword[+0x32] != 0 && (who & 0x30)` ⇒ `call 0x40dd1f`（auto_move）
      //   **而不显示「住宿中還剩 N 天」**（通道 2：`test_turn_start.py` §C/§D）。
      const departing = state.players[state.currentPlayer];

      // ★★ E-41（第十一份試玩回報 #12「出狱应该等到我行动时才播走出来的动画，
      //   而不是前一回合就出来了、下一回合才能动」）：「走回棋盘」是一个**纯演出回合、不换人**。
      //   @source 0x00418ebd：
      //   ```asm
      //   00418f07  test byte [eax + 0x496b7d], 0x30   ; 当班者（游标推进之前）带 0x10/0x20？
      //   00418f87  and  byte [eax + 0x496b7d], 0xf    ; 两位一起消费
      //   00418f8e  jmp  0x419058                      ; ★ 不 inc 游标、不 call 0x41c84f
      //   ```
      //   ⇒ 同一位**立刻**再得一回合（`0x40dd1f` 这回没有 0x30 ⇒ 正常掷骰），其间没有别人行动，
      //   也不走一天（阻碍计数、保險期等都不 tick）。先前这里照常推进 ⇒ 刑满者演完走回
      //   棋盘还要再等一整轮。
      //   ⚠️ 实际只有 0x10 会走到这里：0x20（被挪到旅館）在走路例程**半程**就被抹掉了
      //   （`0040c3d7 and dl, 0xf / mov [player+0x15], dl`；0x10 那一支在同一处只清计数、
      //   不清位），回合末 `0x418f07` 看不到它 ⇒ 照常换人，即下面第 92 条那条路。
      if (departing !== undefined && (departing.whoPlays & WHO_PLAYS_RETURN_TO_BOARD) !== 0) {
        const again = withPlayer(state, state.currentPlayer, (p) => {
          p.whoPlays &= ~(WHO_PLAYS_RETURN_TO_BOARD | WHO_PLAYS_RELOCATED);
        });
        return {
          ...again,
          phase: 'turnStart',
          pending: null,
          dice: [],
          stepsRemaining: 0,
          stepsTotal: 0,
          turnCount: state.turnCount + 1,
        };
      }

      // ★ 待决交互属于**那个玩家的那个回合**，不能带进下一回合（商店这类模态窗口尤其明显：
      //   不清掉，下家一上来就站在别人的柜台前）。⇒ **推日期之前**就清掉离场那位的；
      //   推日期里开出来的（分紅打破產的下線拍卖）与新回合开出来的（还款提醒窗）都要留着。
      const leaving: GameState = { ...state, pending: null };
      const cleared: GameState =
        departing === undefined || (departing.whoPlays & WHO_PLAYS_RELOCATED) === 0
          ? leaving
          : withPlayer(leaving, state.currentPlayer, (p) => {
              p.whoPlays &= ~WHO_PLAYS_RELOCATED;
            });

      // ★★ 第 84 条**订正了顺序**（`@source 0x00418f93..0x00419039`）：
      //   ① `00418f95 inc esi / mov [0x49910c], esi` —— 先把游标推进到下一位；
      //   ② `0041902e call 0x41cf67` —— **绕回 0 号那一次**才推日期/物价/行情/開獎/月結；
      //   ③ `00419033 mov eax,[0x49910c] / 00419039 call 0x41c84f` —— **然后**才给
      //      新当前玩家走一天（阻碍计数 → 释放 → 其余回合计数 → 神明任期）。
      //   ⇒ 递减／释放／「走回棋盘」标记都落在**即将行动的那位**头上，于是
      //     「释放」与「走回棋盘那一回合」正好是同一个回合（原版如此）。
      //   此前本引擎把它记成"递减当前（旧）玩家"，会让刑满者多关一回合。
      const next = nextAlivePlayer(cleared, cleared.currentPlayer);
      const wraps = next <= cleared.currentPlayer;
      // ①②：惡人段逐个走 / 推日期 —— 都在 tick 之前
      let base: GameState = cleared;
      if (wraps) {
        // ★ 惡人段**逐个**走（T-047 的 D-T047-5，2026-09-16）：
        //   先把「这一輪还有哪些惡人」记进相位，然后当场走**第一个**；
        //   队列还非空就停在 `turnEnd` 等 `npcStep`（表现层据此一趟一趟播），
        //   走完最后一个才由 `npcRoundStep` 推日期并轮到下一位玩家。
        //   原版 `[0x49910c]` 那条游标就是逐个停的（`rich4.asm:11766-11832`）。
        const queue = activeNpcSlots(cleared);
        if (queue.length > 0) {
          const first = npcRoundStep({ ...cleared, pendingNpcSlots: queue }, topo, next);
          if (first.phase === 'gameOver') return first;
          // 还有惡人没走 —— 停在 turnEnd，等 `npcStep`；**不**换玩家、**不**推日期
          if ((first.pendingNpcSlots ?? []).length > 0) {
            return { ...first, phase: 'turnEnd', pending: null };
          }
          // 一轮的惡人已经走完（`npcRoundStep` 已推日期并轮到下一位玩家）
          base = first;
        } else {
          // 没有惡人在盘上 —— 照旧直接推日期
          const roundEnd = advanceGameDay({ ...cleared, pendingNpcSlots: [] }, topo);
          // ★ 勝利條件（遊戲時間／勝利條件）达标 → 当天就结束，不再进下一回合。
          //   @source 0x0041cfb1 `call 0x41d89e` / 0x0041cfb9 `je 0x41d1a5`
          if (roundEnd.phase === 'gameOver') return roundEnd;
          base = roundEnd;
        }
      }

      // ★ 物价指数在回合边界采样一次 —— 已在 `advanceGameDay` 内部（② 那一步，
      //   @source `0041902e call 0x41cf67` → `0x41cfbf call 0x423acf`），
      //   且在勝負判定**之后**：达标那天不再更新物价指数。
      const moved: GameState = {
        ...base,
        pendingNpcSlots: [],
        currentPlayer: next,
        dice: [],
        stepsRemaining: 0,
        stepsTotal: 0,
        turnCount: cleared.turnCount + 1,
      };
      // ③ 给**新**当前玩家走一天（阻碍计数 → 释放 → 其余回合计数 → 神明任期）。
      //   与惡人段那条路径共用 `beginActorTurn`（第 85 条：两处都不能漏）。
      //   ★ 推日期里开了拍卖（`0x41cf67` 里分紅打破產 → 下線拍卖，原版是**阻塞**调用，
      //   跑完才轮到 `0x419039 call 0x41c84f`）⇒ 先把拍卖打完，`0x41c84f` 押到拍卖链收尾再走。
      return afterDayRollover(moved, topo, next);
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

// ============================================================
//  落点尾块：神明顯靈（`fcn_0040f381`）与福神加倍（`fcn_0040f8be`）
//  判据与取证全文见 `rules/god-manifest.ts` 的文件头
// ============================================================

/**
 * 落点问出来的那几种待决交互 —— 它们**收掉**（买 / 不买都算）就等于原版走到了尾块 `0x0041b077`。
 * 企業格的 `buyShares` 不在表里：格值 6001.. 不在 `0x40f381` 三支的任何区间，必为空操作。
 */
const LANDING_PENDING_KINDS: ReadonlySet<string> = new Set([
  // ★ 第十四份：收費那一段问完被动卡 ⇒ 接着走到落点尾块（`0x0041b077`）
  'freeCard',
  'scapegoat',
  'buyLand',
  'upgradeLand',
  'buyFacility',
  'buildFacility',
  'upgradeFacility',
  // ★ 第十六份：`research` 不在表里 —— 研究所面板是尾块的**最后一段**（`0x0041b109`，顯靈之后），
  //   它收掉时顯靈已经跑过了（见 `labPanelTail`）
]);

/** 当前玩家脚下那一格的**格值**（`0x7d0+地块` / `0xfa0+設施`）；不是这两类返回 null */
function estateEntityAtPlayer(state: GameState, topo: MapTopology): number | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const node = topo.nodes[me.nodeId - 1];
  // @source 0x004198b2 的跳表：只有类型 0 会到尾块
  if (node === undefined || node.specialKind !== 0) return null;
  const landIndex = landIndexAtPlayer(state, topo);
  if (landIndex !== null) return encodeEstate('land', landIndex);
  const fac = facilityAtPlayer(state, topo);
  return fac === null ? null : encodeEstate('facility', fac.id);
}

/**
 * 这一条 action 是不是让**落点例程走到了尾块**。
 *
 * 本引擎把原版那一个函数拆成了 `settle` +（可选的）一条待决交互，所以判据是
 * 「落点这一段刚刚收完」：`settle` 直接落到 `turnEnd`，或落点问出来的那个交互被收掉。
 * 神明加蓋那扇免费的設施种类框（`pending.free`）收掉时**不再**触发 —— 它本身就在尾块里。
 */
function landingTailDue(before: GameState, next: GameState, action: Action, topo: MapTopology): boolean {
  if (next === before || next.phase !== 'turnEnd' || before.phase === 'turnEnd') return false;
  if (next.currentPlayer !== before.currentPlayer || next.pending !== null) return false;
  const fromSettle = action.type === 'settle' && before.phase === 'settling';
  const pend = before.pending;
  const fromDecision =
    before.phase === 'awaitingDecision' &&
    pend !== null &&
    LANDING_PENDING_KINDS.has(pend.kind) &&
    !(pend.kind === 'buildFacility' && pend.free === true);
  if (!fromSettle && !fromDecision) return false;
  return estateEntityAtPlayer(next, topo) !== null;
}

/** 追加一扇訊息框：本 action 已经弹过的排在前面（原版就是先收费框、后顯靈框）*/
/**
 * 消费被衰神/死神拦下（`purchase()` 的 `blockedByGod`）：收掉待决交互、回合结束，并弹原版那扇框。
 *
 * @source `fcn_0040fa61`：`0x0040fa9b mov esi,[eax*4+0x47ed76]`（物件名）→ `0x0040faa3 push 0x463514`
 *   （格式串 `%s顯靈\n\n拘資失敗！` —— 「拘」是原版的错字，照抄）→ `0x0040fab5 push 0x5dc`（1500 ms）
 *   `call 0x440cac`（訊息框）→ 返回 1 ⇒ 调用方放弃这次消费。
 *   五个调用点都在**確認框之后**（见 `landing` 那段注释），所以这里是「答了 YES 之后」的出口。
 *
 * 现金不够（`notEnoughCash`）到不了这里 —— 框只在现金够时才弹；真到了就原样返回（交互留着），
 * 与先前一致。
 */
function godBlockedPurchase(state: GameState, reason: PurchaseFailure | null): GameState {
  if (reason !== 'blockedByGod') return state;
  const player = state.players[state.currentPlayer];
  const who = player === undefined ? null : purchaseBlockedBy(player);
  if (who === null) return state;
  return { ...state, pending: null, phase: 'turnEnd', notices: [{ key: 'god.blockPurchase', args: [who], holdMs: 1500 }] };
}

/**
 * ★ 第十四份：过路费神明调整那一扇（`fcn_0041d709`）。金额没变不弹（`0x0041d79e cmp ebx,esi / je`）；
 *   抹成 0 时付款方说「逃过一劫」那一档（`0x0041d7b4 test ebx,ebx / jne` → `0x0041d7c1 call 0x44f567(付款方, 原额)`）。
 *
 * @source 跳表 `0x0041d6f1`：1 小財神 `0x0041d742 push 0x463c67` / 2 大財神 `0x0041d759 push 0x463c80` /
 *   5 小窮神 `0x0041d770 push 0x463c95` / 6 大窮神 `0x0041d789 push 0x463cae`；框 `0x0041d7a2 push 0x5dc`。
 */
function godTollNotice(godInfo: number, before: number, after: number, feeName: string, payer: number): NoticeHint | null {
  if (after === before) return null;
  const key = GOD_TOLL_NOTICE_KEYS.get(godInfo);
  if (key === undefined) return null;
  return { key, args: [feeName], ...(after === 0 ? { say: { player: payer, reliefAmount: before } } : {}) };
}

const GOD_TOLL_NOTICE_KEYS: ReadonlyMap<number, NoticeKey> = new Map<number, NoticeKey>([
  [1, 'god.tollHalf'],
  [2, 'god.tollFree'],
  [5, 'god.tollPlusHalf'],
  [6, 'god.tollDouble'],
]);

/**
 * ★ 第十四份：**上一条 action 留下来的** `notices` 数组（`reduce` 入口登记，只登记最外层那一次）。
 *   `insurancePayoutTo` 这类被很多处调用、手里没有「动作前状态」的函数，靠它判断
 *   `state.notices` 是本 action 自己弹的（接着往后排）还是上一条留下的（从空开始）。
 *   纯表现（notices 不进指纹、不进存档）。
 */
const staleNoticeLists = new WeakSet<readonly NoticeHint[]>();
let reduceDepth = 0;

function appendFreshNotice(state: GameState, notice: NoticeHint): GameState {
  const own = staleNoticeLists.has(state.notices) ? [] : state.notices;
  return { ...state, notices: [...own, notice] };
}

function appendNotice(before: GameState, next: GameState, notice: NoticeHint): GameState {
  const own = next.notices !== before.notices ? next.notices : [];
  return { ...next, notices: [...own, notice] };
}

/** 追加一条加蓋提示：本 action 自己记的（如 `ownUpgrade`）保留，上一条 action 留下的丢掉 */
function appendBuildUpgrade(before: GameState, next: GameState, hint: BuildUpgradeHint): GameState {
  const own = next.lastBuildUpgrades !== before.lastBuildUpgrades ? (next.lastBuildUpgrades ?? []) : [];
  return { ...next, lastBuildUpgrades: [...own, hint] };
}

/**
 * `0x40b110(格值)` 由神明代劳的那一次：天使（`0x0040f492`）/ 福神（`0x0040f983`）共用。
 *
 * ★ 真人 + 等级 0 的設施：原版在 `0x40b110` 里当场弹种类框（`0x0040b1e4 call 0x440aac`）。
 *   本引擎把它做成一条**免费**的 `buildFacility` 待决交互（`free: true`），选完才蓋。
 */
function godFreeBuild(
  before: GameState,
  next: GameState,
  topo: MapTopology,
  entity: number,
  godInfo: number,
): GameState {
  const me = next.players[next.currentPlayer];
  if (me === undefined) return next;
  const notice: NoticeHint = { key: 'god.build', args: [godNameOf(godInfo)] };
  const e = decodeEstate(entity);
  if (e.kind === 'facility') {
    const fac = effectiveFacility(next, topo, e.index);
    if (fac === null) return next;
    if (fac.level === 0 && (me.whoPlays & 0x06) === 0) {
      // @source 0x0040f455 / 0x0040f93c：等级 0 的設施**先**弹顯靈框（`0x800` 标记），再进 `0x40b110`
      return {
        ...appendNotice(before, next, notice),
        phase: 'awaitingDecision',
        pending: {
          kind: 'buildFacility',
          facilityId: fac.id,
          name: fac.name,
          price: 0,
          choices: [0, 1, 2, 3, 4],
          free: true,
        },
      };
    }
  }
  const built = freeBuildEntity(next, topo, entity, -1);
  // @source 0x0040f4a2 `test byte [esp+0x88],1 / je` —— 蓋不成（满级 / 連鎖店已建）什么都不弹
  if (built === null) return next;
  const withNotice = appendNotice(before, { ...built.state, phase: next.phase, pending: next.pending }, notice);
  return appendBuildUpgrade(before, withNotice, buildHintOf(built, 'godManifest'));
}

/**
 * 福神「蓋房子投資加倍」—— 自己地升級成功、且**没到 5 级**时再白送一级。
 *
 * @source `0x004199eb cmp byte [esi+0x1a],5 / jne 0x419a2b` → `0x00419a48 call 0x40f8be`；
 *   到 5 级那一支 `0x00419a26 jmp 0x41b077` **绕过**了它。
 *   成功且没到 5 级时 `0x0040fa49 call rand / and eax,1` 挑一句台词 ⇒ **多消费一次随机数**。
 */
function luckyGodBonus(before: GameState, next: GameState, topo: MapTopology, entity: number): GameState {
  const me = next.players[next.currentPlayer];
  if (me === undefined || !isLuckyGod(me.godInfo)) return next;
  const out = godFreeBuild(before, next, topo, entity, me.godInfo);
  const hints = out.lastBuildUpgrades ?? [];
  const last = hints[hints.length - 1];
  if (out === next || last === undefined || last.source !== 'godManifest' || last.reachedMaxLevel) return out;
  const rng = new WatcomRng();
  rng.setState(out.rngState);
  // ★★ W-55 行 6：原版把这次 `rand()` 的**低一位**当台词槽位 ——
  //   `0x0040fa49 call 0x456f2d`（rand）/ `0x0040fa4e and eax,1` /
  //   `0x0040fa51 mov esi,[ebx + eax*4 + 0x48084a]`（角色台词表[角色][0|1]）。
  //   先前这里只把 `rngState` 写回去、那个 0/1 直接丢掉 ⇒ 这一句复刻不出来。
  //   现在原样交给 `GameState.lastGodLine`（纯表现瞬态，见那个字段的注释）。
  const line = rng.next();
  return {
    ...out,
    rngState: rng.getState(),
    lastGodLine: { player: next.currentPlayer, event: line & 1 },
  };
}

/** 尾块本体 —— `fcn_0040f381(当前玩家, 脚下那一格)` */
function manifestGodOnLanding(before: GameState, next: GameState, topo: MapTopology): GameState {
  const meIndex = next.currentPlayer;
  const me = next.players[meIndex];
  if (me === undefined) return next;
  // @source 0x0040f39e `cmp byte [player+0x32],0 / jne 返回`（住宿中）；0x0040f3ab 出局返回
  if (me.blocking.inHotel !== 0 || !isAlive(me)) return next;
  const kind = manifestKindOf(me.godInfo);
  const entity = estateEntityAtPlayer(next, topo);
  if (kind === null || entity === null) return next;

  if (kind === 'build') return godFreeBuild(before, next, topo, entity, me.godInfo);

  const e = decodeEstate(entity);
  const land = e.kind === 'land' ? effectiveLand(next, topo, e.index) : null;
  const fac = e.kind === 'facility' ? effectiveFacility(next, topo, e.index) : null;
  const target = land ?? fac;
  if (target === null) return next;

  if (kind === 'demolish') {
    // @source 0x0040f538 / 0x0040f59c `cmp byte [+0x1a],0 / je 0x40f5d0`（[esp+0x88] 恒 0 ⇒ 返回）
    if (target.level === 0) return next;
    let players = next.players;
    // @source 0x0040f545 / 0x0040f5a2：有主才记敌意 —— **不排除自己的地**
    //   （`update_hostility` 自己在 `a == b` 时返回，拆照拆）
    if (target.owner !== 0) {
      players = updateHostility(players, target.owner - 1, meIndex, DEVIL_HOSTILITY_FACTOR * next.priceIndex).players;
    }
    let out: GameState = { ...next, players };
    if (land !== null) {
      const m = mutateLand(land, MUTATE_DEMOLISH_ONE);
      const landLevel = [...out.landLevel];
      const landType = [...out.landType];
      landLevel[land.id] = m.land.level;
      landType[land.id] = m.land.type;
      out = { ...out, landLevel, landType };
      if (m.releasesConfined) out = { ...out, players: releaseConfinedPlayers(out.players) };
    } else if (fac !== null) {
      const m = mutateFacility(fac, MUTATE_DEMOLISH_ONE);
      const facilityLevel = [...out.facilityLevel];
      const facilityType = [...out.facilityType];
      facilityLevel[fac.id] = m.facility.level;
      facilityType[fac.id] = m.facility.type;
      out = { ...out, facilityLevel, facilityType };
      if (m.releasesConfined) out = { ...out, players: releaseConfinedPlayers(out.players) };
    }
    return appendNotice(before, out, { key: 'god.demolish', args: [] });
  }

  // ── 土地公 @source 0x0040f68b ──
  // @source 0x0040f6b4 / 0x0040f792：已经是我的 ⇒ `[esp+0x88]` 仍为 0 ⇒ 不弹不改
  if (target.owner === meIndex + 1) return next;
  let players = next.players;
  if (target.owner !== 0) {
    const delta = seizeHostilityDelta(target.landPrice, next.priceIndex, target.level);
    players = updateHostility(players, target.owner - 1, meIndex, delta).players;
  }
  // @source 0x0040f718 / 0x0040f7fd：土地權限非無限期、且**原先无主**才写到期日（抢别人的沿用原到期日）
  const stamp = next.landTenureIndex !== 0 && target.owner === 0;
  const expiry = stamp ? tenureExpiry(packDate(next), next.landTenureIndex) : 0;
  let out: GameState = { ...next, players };
  if (land !== null) {
    const landOwner = [...out.landOwner];
    landOwner[land.id] = meIndex + 1;
    out = { ...out, landOwner, ...(stamp ? { landTenure: withTenure(out.landTenure, land.id, expiry) } : {}) };
  } else if (fac !== null) {
    const facilityOwner = [...out.facilityOwner];
    facilityOwner[fac.id] = meIndex + 1;
    out = {
      ...out,
      facilityOwner,
      ...(stamp ? { facilityTenure: withTenure(out.facilityTenure, fac.id, expiry) } : {}),
    };
  }
  return appendNotice(before, out, { key: 'god.seize', args: [] });
}

/**
 * 站在这一格上的物件 handle（下标 + 1）；0 表示这格没有物件。
 *
 * ⚠️ 判定条件是 **`nodeId` 相同且 `attached === 0`**。
 *   已经附身或被人带着走的物件，`nodeId` 会跟着主人跑
 *   （`attach_object` 明写 `objects[i].nodeId = player.nodeId`），
 *   光比 `nodeId` 会把别人身上的財神当成地上的財神再踩一次。
 *   原版靠地图格里那一字节（node +0x26）区分，附身时会把它抹掉。
 *
 * ★★ 2026-09-22（第九份试玩回报 #5「路障和神灵重合时经过路障没有把我阻拦下来」）：
 *   同格有**多件**时取**槽号最大的那一件**，不再取下标最小的。
 *
 *   原版并不扫物件表，而是读地图节点里的**反向索引** `node+0x26`
 *   （`_rich4_player_move_one_step_done` VA 0x0041b4b4：
 *   `mov eax,[eax+0x24] / and eax,0xff0000 / shr eax,0x10` ⇒ 第 3 字节 = 槽号+1）；
 *   而 `place_object` 往那一字节里**按位或**槽号（`rich4_objects.asm:118-126`
 *   `lea edx,[ebx+1] / shl edx,0x10 / or [eax+0x24],edx`）。
 *
 *   ⇒ 神明占槽 0..11（handle 1..12）、路障占槽 16..25（handle 17..26），
 *     两件同格时 OR 的结果落在**路障**那一侧（`1 | 17 = 17`）——
 *     所以原版在神明格上放路障**照样拦人**。
 *     取下标最小者（= 恒取神明）等于让路障分支永远进不去：神明那一支带
 *     `if (moving) return`（`rules/object-landing.ts` 的 default 分支，
 *     @source `0x41c164`），于是路过时**什么都不发生** —— 既不被拦、也不附身。
 *
 *   ⚠️ 这是**近似**而非逐位复刻：真正的 OR 在极端组合下会落到第三件物件
 *     （例：同一个格上两个神明 handle 1|2 = 3 ⇒ 槽 2）。可实际构造出来的重叠
 *     （路障 17 压神明 1、路障 17 | 地雷 27 = 27、路障 17 | 炸彈 19 = 19）
 *     取最大值与 OR 结果一致。要逐位复刻得在 state 里加一张「每格一件」的反向索引
 *     （见 `docs/gaps/04-events-places-gods.md` 的 G26），那是独立的一步。
 */
function objectHandleAt(state: GameState, nodeId: number): number {
  let found = 0;
  for (let i = 0; i < state.objects.length; i++) {
    const o = state.objects[i];
    if (o !== undefined && o.nodeId === nodeId && o.attached === 0) found = i + 1;
  }
  return found;
}

/**
 * 踩到破产者的棋子 —— 施捨一笔，然后他换个地方待着。
 *
 * @source VA 0x0041b5fd，见 `rules/beggar.ts`。
 *
 * ⚠️ 乞丐的新位置由 `0x40cc56` → `pick_object_node(原节点)` 挑，
 *   带**离原地至少 300 像素**的重抽条件，本引擎未接（Q-OBJ-2）。
 */
export function giveAlmsIfBeggar(state: GameState, topo: MapTopology, nodeId: number): GameState {
  // @source cmp dword [0x48baf8], 0 / jne 跳过 —— 路过不算
  if (state.stepsRemaining > 0) return state;
  const who = beggarAt(state.players, nodeId, state.currentPlayer);
  if (who < 0) return state;

  const amount = almsAmount(state.priceIndex);
  // @source `0x41b655 push ebx`（金额）+ `0x41b656 push 0x463ab1`（`施捨給乞丐%d元`）
  //   + `0x41b668 push 0x5dc / 0x41b672 call 0x440cac` —— 弹框在 pay_money**之前**
  //   （`0x41b686 call 0x41d2c6`），金额就是 `almsAmount`，core 这里已经知道确切值
  const notices: NoticeHint[] = [{ key: 'beggar.alms', args: [amount] }];
  // @source pay_money(我, -1, 金额, 0) —— 收款方 -1 即公库
  const r = transferMoney(state.players, [], state.pool, state.currentPlayer, -1, amount, 0);

  // @source call 0x40cc56 —— 清掉原格的占位，再挑一格把乞丐挪过去
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  // ★ 挑格走的是 `0x40aa6c`（物件投放那个挑格器），它的筛选是
  //   `test dword [node + 0x24], 0x80ffff00` —— **玩家与物件一起跳过**。
  //   只看物件（或只看自己那一格）会漏：乞丐会落到「有人站着」或
  //   「已经有神明」的格子上，原版不可能出现。见 `rules/beggar.ts`、
  //   `rich4-spec/docs/systems/places.md` §5b.4。
  const occupied = runtimeOccupiedNodes(r.players, state.objects, state.specialActors);
  const spots = objectNodeCandidates(topo.nodes).filter((n) => !occupied.has(n));
  // ★ 走**远距**那一支：原版 `fcn_0040cc56` 把玩家当前节点当参照点传给
  //   `_rich4_find_random_unoccupied_distant_node`（`rich4.asm:6843` 的 `push eax`）
  //   —— 刚被施捨过的那一格不该立刻又冒出乞丐。
  const moved = pickObjectNodeDistant(spots, nodeId, nodeXyOf(topo), () => rng.next());

  const players = r.players.map((p, i) => {
    if (i !== who || moved === 0) return p;
    // ★ 位置三元组一起走（`@source 0x0040cc56` 把乞丐挪到另一格）
    return placeOnNode({ ...p, lastNodeId: p.nodeId }, topo.nodes[moved - 1]);
  });
  const paid: GameState = { ...state, players, pool: r.pool, rngState: rng.getState(), notices };
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
function applyArrival(state0: GameState, topo: MapTopology): GameState {
  const me0 = state0.players[state0.currentPlayer];
  if (me0 === undefined || !isAlive(me0)) return state0;

  // ★ 第八份试玩回报 #4：**路过銀行**（还有步数）先过 ATM 入口 `0x4379c9`（在乞丐 `0x0041b5fd` 之前）
  const state = passingBank(state0, topo);
  const me = state.players[state.currentPlayer]!;

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

  // ★★ 禮物 / 寶箱 那两句訊息框 —— 都在「停下来才生效」的那一支里
  //   （`cmp [0x48baf8],0 / jne` 已由 `applyObjectAt` 判过，没生效就没有事件）：
  // ```asm
  // 0041b94e  ecx = [道具*8 + 0x47feda]  ; 道具名
  // 0041b956  push 0x463aa8              ; 得到%s！
  // 0041b968  push 0x5dc / call 0x440cac ; 1500 ms
  // 0041bb49  push 0x5dc                 ; 寶箱那一句
  // 0041bb4e  push 0x463ad3              ; 得到５００點券！（串里写死 500）
  // 0041bb53  call 0x440cac
  // ```
  //   两者都排在 `add word [player+0x30], 0x1f4` / `give_tool` **之前**，
  //   且每条路都只用一帧框，所以这里最多一条。
  const arrivalNotices: NoticeHint[] = [];
  for (const ev of r.events) {
    if (ev.kind === 'gift') {
      arrivalNotices.push({ key: 'object.gift', args: [toolNameOf(ev.toolId)] });
    } else if (ev.kind === 'treasure') {
      arrivalNotices.push({ key: 'object.treasure', args: [] });
    }
  }
  if (arrivalNotices.length > 0) next = { ...next, notices: arrivalNotices };

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
    const c = sendToConfinement(
      next.players,
      next.objects,
      topo.nodes,
      next.hospitalOccupancy,
      'hospital',
      me.index,
      r.hospitalDays,
      // ★ 首次关押会清掉"另一张"占用表（原版 `call 0x40d761`，@source 0x0043d5e7）
      next.prisonOccupancy,
      topo.landscapes,
    );
    next = insureConfinement(
      {
        ...next,
        players: c.players,
        objects: c.objects,
        hospitalOccupancy: c.occupancy,
        ...(c.otherOccupancy === undefined ? {} : { prisonOccupancy: c.otherOccupancy }),
      },
      topo,
      me.index,
      r.hospitalDays,
    );
  }

  // 神明离场后，搭档换上来
  const withPartner = respawnPartner(next, topo, r.respawn);
  // ★ 神明**附身那一刻**的發威（跳表 `ref_0040ea9b`，见 rules/god-power.ts）
  return applyGodPowerOnAttach(state, withPartner, topo);
}

/**
 * 神明**刚附身**时执行那位神的「發威」。
 *
 * @source `_rich4_attach_god` VA 0x0040ebfa：`jmp dword [種類−1 *4 + 0x40ea9b]`
 *   —— 三項修正写完**紧接着**就是它，落点/請神符两条附身路径**共用**。
 *   逐神的语义与 VA 见 `rules/god-power.ts` 的文件头。
 *
 * 判据：**新附身**（`godInfo` 从别的值变成非 0 的新值）。换神（旧神被挤走、
 * 新神附身）也算 —— 原版每次 `_rich4_attach_god` 都跑一遍發威。
 *
 * ⚠️ 金额型（小財神/大財神/小窮神/大窮神）会消耗随机数：原版是那扇窗里
 *   `rand()%10` 掷四次拼一个数（真人点击时机决定重掷几次）——
 *   按 D-003 用**一次**四次当替身，故这里要把 `rngState` 写回去（C-DET-1）。
 *   福神/衰神/死神**不**掷（原版那扇窗根本没开），`rng.getState()` 原样写回。
 */
function applyGodPowerOnAttach(
  before: GameState,
  after: GameState,
  topo: MapTopology,
): GameState {
  const host = after.currentPlayer;
  const was = before.players[host];
  const now = after.players[host];
  if (was === undefined || now === undefined) return after;
  // 没换神（含 0 → 0）：不跑發威
  if (now.godInfo === 0 || now.godInfo === was.godInfo) return after;
  const god = after.objects[now.godInfo - 1];
  if (god === undefined) return after;

  const rng = new WatcomRng();
  rng.setState(after.rngState);
  const power = godPowerOf(god.type, rng);
  if (power.kind === 'none') return after;
  const out = applyGodPower(after, topo, host, power, rng);
  // ★★ W-55 行 7：把这次掷出来的**金额**交给表现层 —— 財神那两支的额外台词
  //   都以它为闸门（小財神 `0x0040eca4 cmp esi,0x2bc`、
  //   大財神 `0x0040ed74 cmp esi, 5000×物價`），而这个数先前掷完就丢。
  //   只有**带金额**的四位（`GodPower` 的 `amount` 那四项）才有得交；
  //   福神/衰神/死神那几支不掷数，`lastGodPower` 保持上一条 action 的引用
  //   ⇒ 由 `reduce` 出口清成 null（引用相等 = 没新写）。
  const withRng: GameState = { ...out, rngState: rng.getState() };
  return 'amount' in power
    ? { ...withRng, lastGodPower: { player: host, type: god.type, amount: power.amount } }
    : withRng;
}

/** 把一位神明的發威落到状态上（纯计算；付款/收卡全走既有助手）*/
function applyGodPower(
  state: GameState,
  topo: MapTopology,
  host: number,
  power: GodPower,
  rng: WatcomRng,
): GameState {
  switch (power.kind) {
    // ── 小財神：每個對手付給附身者（**現金**）@source 0x0040ec99 ──
    case 'collectFromOpponents': {
      let players = state.players;
      let pool = state.pool;
      let out = state;
      for (let i = 0; i < players.length; i++) {
        if (i === host) continue;
        const p = players[i];
        // @source `cmp byte [player+0x15], 0 / je 跳过` —— 出局/托管为 0 的不收
        if (p === undefined || !isAlive(p) || p.whoPlays === 0) continue;
        const r = transferMoney(players, [], pool, i, host, power.amount, PAY_FLAG_CREDIT_TO_CASH);
        players = r.players;
        pool = r.pool;
        out = { ...out, players, pool };
        // @source 每次 `pay_money` 内部就地破产；随后 `cmp [0x46caf8],0 / jne 跳出`
        if (r.bankrupted) {
          out = applyBankruptcy(out, i, topo);
          break;
        }
      }
      return out;
    }

    // ── 大財神：附身者進帳（**現金**）@source 0x0040ed4c ──
    case 'gain':
      return { ...state, players: receiveMoney(state.players, host, power.amount, true) };

    // ── 小窮神：附身者付給每個對手（進對方**存款**）@source 0x0040efd9 ──
    case 'payOpponents': {
      let players = state.players;
      let pool = state.pool;
      let out = state;
      for (let i = 0; i < players.length; i++) {
        if (i === host) continue;
        const p = players[i];
        if (p === undefined || !isAlive(p) || p.whoPlays === 0) continue;
        // flags = 0 ⇒ 進**存款**（`fcn_0041d2c6` 的 arg4 = 0）
        const r = transferMoney(players, [], pool, host, i, power.amount, 0);
        players = r.players;
        pool = r.pool;
        out = { ...out, players, pool };
        if (r.bankrupted) {
          out = applyBankruptcy(out, host, topo);
          break;
        }
      }
      return out;
    }

    // ── 大窮神：附身者付給**銀行** @source 0x0040f076 ──
    case 'payBank': {
      const r = transferMoney(state.players, [], state.pool, host, PARTY_POOL, power.amount, 0);
      const paid: GameState = { ...state, players: r.players, pool: r.pool };
      return r.bankrupted ? applyBankruptcy(paid, host, topo) : paid;
    }

    // ── 福神：得 1 / 2 张随机卡 @source 0x0040ede7 / 0x0040eea8 ──
    case 'receiveCards': {
      let players = state.players;
      const cardAmount = [...state.cardAmount];
      const godInfo = state.players[host]?.godInfo ?? 0;
      const godType = godInfo > 0 ? (state.objects[godInfo - 1]?.type ?? 0) : 0;
      // ★ 第八份试玩回报 #5：得卡时弹訊息框，`%s` = 神明名 `[0x47ed76 + 種類*4]`、
      //   卡名 `[卡表 + 卡号*8]`；袋空（`0x441e12` 返回 0，`0x0040edf9 je`）就停手。
      //   `cardId` 交给表现层配那句好消息台词
      //   （`0x0040ee39 mov al,[ebx+0x47fdef]`（卡的點數价）→ `0x0040ee46 call 0x44f230`）。
      /** 这一趟**真正抽到**的卡号，顺序即抽出顺序（袋空就到此为止）*/
      const drawn: number[] = [];
      for (let k = 0; k < power.count; k++) {
        // @source `_rich4_player_receive_random_card` 0x441e12：袋空返回 0
        const id = drawRandomCard(rng, cardAmount);
        if (id === 0) break;
        cardAmount[id - 1] = Math.max(0, (cardAmount[id - 1] ?? 0) - 1);
        players = players.map((p, i) => (i === host ? giveCard(p, id) : p));
        drawn.push(id);
      }
      if (drawn.length === 0) return { ...state, players, cardAmount };
      // ★★ 大福神（種類 4）拿到**两张**时，原版弹的是**一扇两卡名**的框，不是两扇：
      //   `0x0040eed7 push 0x463353`（`大福神附身\n\n得到%s及%s！`）+
      //   `0x0040eee9 push 0x5dc`（1500 ms），两个 `%s` = `[ebx]`（先抽到）× `[esi]`（後抽到）
      //   —— **不含神明名**（格式串自己写着「大福神」）。
      //   小福神（種類 3）那条是 `0x0040ee13 push 0x4632fd`（`%s附身\n\n得到%s！`，1500 ms），
      //   每一张各弹一扇 ⇒ 两条形状不同，不能合并。
      if (godType === GOD_BIG_LUCK && drawn.length === 2) {
        const [first = 0, second = 0] = drawn;
        return {
          ...state,
          players,
          cardAmount,
          notices: [
            {
              key: 'god.gotCardTwo',
              args: [cardNameOf(first), cardNameOf(second)],
              holdMs: 1500,
            },
          ],
        };
      }
      // 其余情形（小福神 / 大福神但只拿到一张 / 其它调用方）保持原样：一扇一卡
      const notices: NoticeHint[] = drawn.map(
        (id): NoticeHint => ({
          key: 'god.gotCard',
          args: [godNameOf(godType), cardNameOf(id)],
          holdMs: 1500,
          cardId: id,
        }),
      );
      return { ...state, players, cardAmount, notices };
    }

    // ── 衰神：丢卡 @source 0x0040f10c（随机一张）/ 0x0040f1de（一半）──
    case 'dropCards': {
      const me = state.players[host];
      if (me === undefined) return state;
      // 丢掉的卡**回牌堆**（`_rich4_consume_card` 里 `inc byte [dl + 0x499197]`）
      const cardAmount = [...state.cardAmount];
      const cards = [...me.cards];
      /** 移除**首个匹配的卡号**（原版 `_rich4_consume_card` 0x00441343 的语义） */
      const consumeFirst = (id: number): void => {
        const at = cards.indexOf(id);
        if (at >= 0) cards.splice(at, 1);
      };
      if (power.mode === 'one') {
        if (cards.length === 0) return state;
        // @source 0x00441e8e `call rand` / 0x00441e98 `idiv esi`（esi = 张数）
        //   ⇒ 索引 = `rand() % 张数`；@source 0x00441eae `mov bl,[索引 + 手牌]`
        //   ⇒ 先取**那一格上的卡号**；@source 0x00441ec1 `call 0x441343`
        //   ⇒ 再 `consume_card(卡号)`（移除**首个匹配**，不是第 `索引` 格）。
        //   ⚠️ G40：卡号有重复时，两者结果**不同**（G40 的用例钉住了这一点）。
        const at = rng.below(cards.length);
        const id = cards[at] ?? 0;
        consumeFirst(id);
        if (id > 0) cardAmount[id - 1] = (cardAmount[id - 1] ?? 0) + 1;
        // ★ 2026-09-23（神明对话框反查）：丢了卡就弹一扇訊息框「小衰神附身\n\n遺失%s！」——
        //   @source `0x0040f114 call 0x441e77` → `0x0040f11c test eax,eax / je 0x40ece6`（没丢就不弹）→
        //   `0x0040f124 mov esi,[eax*8 + 0x47fdea]`（卡名）→ `0x0040f12c push 0x4633ab` →
        //   `0x0040f13e push 0x5dc`（1500 ms）→ `0x0040f148 call 0x440cac`。先前这一扇**整个没弹**。
        if (id > 0) {
          return {
            ...state,
            players: state.players.map((p, i) => (i === host ? { ...p, cards } : p)),
            cardAmount,
            notices: [{ key: 'god.lostCard', args: [cardNameOf(id)], holdMs: 1500 }],
          };
        }
      } else {
        const n = cards.length;
        // @source `cmp eax, 1 / jle 直接返回` —— 只有 0/1 张时什么都不丢
        if (n <= 1) return state;
        // @source `_rich4_player_drop_half_the_card`（0x00441ece）：
        //   `edi = 0x441262(玩家)`（**循环外**算一次）、`sar eax,1`（n/2）、
        //   循环体 `mov al,[ebx + eax + 0x499120]` 读的是**当前手牌的第 i 格**
        //   （`consume_card` 每次把整条手牌左移，所以 `i` 指向的已经不是原来那一张），
        //   然后 `call 0x441343` = **移除首个匹配的卡号**。
        //   ⚠️ G40：本引擎先前写的是 `cards.splice(i, 1)`（移除第 i 格）——
        //   卡号唯一时两者等价，**卡号有重复时不等价**（`god-power.test.ts` 有用例）。
        for (let i = 0; i < Math.trunc(n / 2); i++) {
          const id = cards[i] ?? 0;
          consumeFirst(id);
          if (id > 0) cardAmount[id - 1] = (cardAmount[id - 1] ?? 0) + 1;
        }
      }
      return {
        ...state,
        players: state.players.map((p, i) => (i === host ? { ...p, cards } : p)),
        cardAmount,
      };
    }

    // 只演出那几种（天使／惡魔／土地公）：状态一个字节都不动
    case 'none':
      return state;

    // ── 死神：道具 + 卡片全部没收（**不折點券**）@source 0x0040f2eb ──
    case 'sellEverything': {
      const me = state.players[host];
      if (me === undefined) return state;
      const t = sellAllTools(me, state.tools, state.toolStock);
      const c = sellAllCards(t.player, state.cardAmount);
      // ★★ G42 订正：死神这一支把两个返回值（折得的點券）**都丢了** ——
      //   `0x0040f36e call 0x445b3f / add esp,4 / push ebp / 0x0040f377 call 0x441f21 /
      //   0x0040f37c jmp 0x40f250`，中间没有 `add word [player+0x30], ax`；
      //   `0x445b3f` / `0x441f21` 本体也不写 `+0x30`（只 `mov eax, ebx / ret`）。
      //   对照魔法屋「變賣」那两支才有 `0x00431d3d` / `0x00431f62 add word [player+0x30],ax`。
      //   ⇒ 纯惩罚：道具、卡片清空回库，**點券一分不给**。
      return {
        ...state,
        players: state.players.map((p, i) => (i === host ? c.player : p)),
        tools: t.tools,
        toolStock: t.toolStock,
        cardAmount: c.cardAmount,
      };
    }
  }
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

  // 别叠在已有物件**或玩家**身上 —— 原版 `test dword [node + 0x24], 0x80ffff00`
  // 把两者一起跳过（`rules/object-landing.ts` 的 `runtimeOccupiedNodes`）。
  // ⚠️ 先前这里只反查物件表：搭档登场时会**落到有人站着的格子上**。
  const occupied = runtimeOccupiedNodes(state.players, objects, state.specialActors);
  const spots = objectNodeCandidates(topo.nodes).filter((n) => !occupied.has(n));
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const node = pickObjectNodeDistant(spots, respawn.nearNode, nodeXyOf(topo), () => rng.next());
  if (node === 0) return state;

  partner.nodeId = node;
  return { ...state, objects, rngState: rng.getState() };
}

/** 目标转盘要的那几个计数（与 `places/magic-house.ts` 的 `MagicTargetContext` 同形）*/
function magicTargetContext(state: GameState, topo: MapTopology): MagicTargetContext {
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

  return {
    players: state.players,
    landCountOf: (i: number) => owns(i, false),
    houseCountOf: (i: number) => owns(i, true),
    wealthOf: (i: number) => {
      const p = state.players[i];
      if (p === undefined) return 0;
      return calculatePlayerWealth(p, lands, facilities, valuationsOf(state, i));
    },
  };
}

/**
 * 魔法屋 —— 先转**目标转盘**，再定效果、对被点到的人逐一施加。
 *
 * ★★ 2026-09-23 订正（第十二份试玩回报「选所有女生存入现金，金貝貝不受影响」
 *   「为什么默认就展示就地拆除房屋」）：**真人那一支的效果是玩家自己点的**，
 *   不是 `rand()`。先前这里对真人也掷了效果转盘，于是玩家在屏上点「存入所有現金」，
 *   core 实际施加的却是它自己掷出的「就地拆除房屋」（屏上开场就在转向那一格）。
 *
 * @source 入口 `0x0043380a`：
 * ```asm
 * 0043381b  cmp  byte [player + 0x15], 1   ; ★ who_plays == 1？
 * 00433822  jne  0x43390b                  ; 否 → 电脑：两个转盘都 rand()
 * 004338af  call 0x4018e7(0x4325c2)         ; 是 → 女巫窗口（状态 4 里转目标转盘，
 *                                          ;       状态 7 等玩家点 1..12 格）
 * 004338b7  mov  esi, eax                  ; ★ 效果号 = 窗口返回值（格号 − 1）
 * 004339c5  push esi / call 0x431caa        ; 两支汇合：逐人施加
 * ```
 *   ⇒ 真人：本函数只转目标转盘，挂 `pending{magicHouse}` 等 `{type:'magicHouse', option}`；
 *     电脑：照旧当场转完两个转盘并结算（`0x0043390b..0x0043397e`）。
 *   ⚠️ 判的是 `who_plays == 1` **整字节相等**（不是 `& 6`）：带託管位的真人（1|4）走电脑那一支。
 */
function runMagicHouse(state: GameState, topo: MapTopology): GameState {
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const rolled = rollMagicCriterion(magicTargetContext(state, topo), () => rng.next());
  const me = state.players[state.currentPlayer];
  if (me !== undefined && me.whoPlays === WHO_PLAYS_HUMAN) {
    return {
      ...state,
      rngState: rng.getState(),
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: rolled.criterion, targets: [...rolled.targets] },
    };
  }
  const { option } = rollMagicOption(rolled.targets, state.currentPlayer, () => rng.next());
  // ★ 电脑那一支先弹「条件\n\n效果」（0x004339b3 `push 0x5dc / call 0x440cac`）再进 `0x431caa`
  return applyMagicHouse({ ...state, rngState: rng.getState() }, topo, rolled.criterion, rolled.targets, option, rng, true);
}

/**
 * 真人在女巫窗口里点定了效果（或被託管、由电脑替他掷）—— 汇合到 `0x431caa`。
 * 见 `actions.ts` 的 `magicHouse`。
 */
function answerMagicHouse(state: GameState, topo: MapTopology, option: number | null): GameState {
  const p = state.pending;
  if (p === null || p.kind !== 'magicHouse') return state;
  if (state.phase !== 'turnEnd') return state;
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  let chosen: number;
  if (option === null) {
    // 託管：借电脑那一支的效果转盘（@source 0x00433934..0x0043397e）
    chosen = rollMagicOption(p.targets, state.currentPlayer, () => rng.next()).option;
  } else {
    // @source 0x004320cf `cmp esi, 0xb / ja` —— 0..11 之外的效果号原版直接不做
    if (!Number.isInteger(option) || option < 0 || option >= MAGIC_EFFECT_COUNT) return state;
    chosen = option;
  }
  return applyMagicHouse(
    { ...state, pending: null, rngState: rng.getState() },
    topo,
    p.criterion,
    [...p.targets],
    chosen,
    rng,
  );
}

/**
 * 效果派发 `0x431caa`：对名单里的人**逐一**施加 `option`，并交出逐人的演出分段（`lastMagicBeats`）。
 *
 * @source 效果派发 0x00431caa 的逐人循环：
 * ```asm
 * 00431cbd  mov [0x48be18], 0                  ; 清小地图标记（之后的 0x41906a 居中于当前玩家）
 * 00431cc8  [esp+0xb0] = [0x49910c]            ; 记下施法者
 * 004320b4  cmp byte [edi + 0x48c380], 0 / je 结束
 * 004320c9  dec eax / mov [0x49910c], eax      ; ★ 当前玩家 = 这位中签者（整支都按他算）
 * 004320d6  jmp [option*4 + 0x431c7a]          ; 闸 → 0x41906a(1) → 訊息框 → 施加 / 影片 → 台词
 * 004320aa  inc edi / cmp edi, 4 / jge 结束
 * 004324fa  mov [0x49910c], [esp+0xb0]         ; 还原施法者
 * ```
 * ⇒ **一个人整支演完才轮到下一个**（框 → 镜头 → 影片 → 台词），而且那一支里「当前玩家」就是他
 *   （`0x40b110` 的建设施种类、`0x44db81` 抽命運的主角、`0x41906a` 重画时的侧栏与居中都跟着他）。
 *   本函数照此逐人施加（先前是先把十二支的状态一起改完、再逐个跑子流程 —— 同一个随机流次序，
 *   但当前玩家一直是施法者）。
 *
 * 每一段 `{ before, after }` 是**那一段演出前后的完整状态**（当前玩家 = 中签者），表现层逐段演；
 * 最终状态的当前玩家还原为施法者（0x004324fa）。
 */
function applyMagicHouse(
  state: GameState,
  topo: MapTopology,
  criterion: number,
  targets: readonly number[],
  option: number,
  rng: WatcomRng,
  /** 电脑那一支（`0x0043390b`）：`0x431caa` 之前先弹「条件\n\n效果」那一扇 */
  spinNotice = false,
): GameState {
  const caster = state.currentPlayer;
  const effectName = MAGIC_HOUSE_OPTIONS[option]?.name ?? '';
  // ★ 把「抽中哪个条件、点到谁」交给表现层（id = 效果号，真人点的 / 电脑掷的）
  const ev = { kind: 'magicHouse' as const, id: option, criterion, targets: [...targets] };
  const beats: MagicBeat[] = [];
  const allNotices: NoticeHint[] = [];
  const allUpgrades: BuildUpgradeHint[] = [];
  let lastView: { x: number; y: number } | null = null;

  let cur: GameState = { ...state, rngState: rng.getState(), phase: 'turnEnd', lastEvent: ev };
  if (spinNotice) {
    const spin: NoticeHint = {
      key: 'magic.spin',
      args: [MAGIC_TARGET_NAMES[criterion] ?? '', effectName],
      beforeFilms: true,
    };
    allNotices.push(spin);
    const after: GameState = { ...cur, notices: [spin] };
    beats.push({ before: cur, after });
    cur = after;
  }

  const finish = (s: GameState): GameState => ({
    ...s,
    currentPlayer: caster,
    lastEvent: ev,
    notices: allNotices.length > 0 ? allNotices : state.notices,
    // ★ 本趟的「加蓋」事件（每位中签者各一条，`0x00431f67..0x00432094` 各跑一遍）
    lastBuildUpgrades: allUpgrades,
    lastViewTarget: lastView ?? s.lastViewTarget,
    lastMagicBeats: beats,
  });

  for (const who of targets) {
    const p0 = cur.players[who];
    if (p0 === undefined || !isAlive(p0)) continue;
    // 0x004320c9：这一支里「当前玩家」= 中签者
    const before: GameState = { ...cur, currentPlayer: who };
    const nodeOf = (playerIndex: number): MagicNodeInfo | null => {
      const p = before.players[playerIndex];
      if (p === undefined) return null;
      const n = topo.nodes[p.nodeId - 1];
      if (n === undefined) return null;
      // @source cmp ebx, 0x7d0 / jle 跳过；cmp ebx, 0x1770 / jge 跳过
      //   住宅(2000..4000) 与设施(4000..6000) 都算，景观与特殊格不算
      const buildable = housingIndexOf(n.type) !== null || facilityIndexOf(n.type) !== null;
      return { type: n.type, buildable };
    };
    rng.setState(before.rngState);
    const r = applyMagicEffect(option, [who], {
      players: before.players,
      cardAmount: before.cardAmount,
      tools: before.tools,
      toolStock: before.toolStock,
      priceIndex: before.priceIndex,
      initiator: caster,
      nodeOf,
      nextRandom: () => rng.next(),
    });
    const notice = magicNoticeFor(before, who, option, r);
    let s: GameState = {
      ...before,
      rngState: rng.getState(),
      players: applyHostilityDeltas(r.players, r.hostilityDeltas),
      cardAmount: r.cardAmount,
      tools: r.tools,
      toolStock: r.toolStock,
      lastEvent: { ...ev, targets: [who] },
      lastBuildUpgrades: [],
      lastViewTarget: null,
      ...(notice === null ? {} : { notices: [notice] }),
    };
    // 闸没过（5/9/11/7 那几支）：整支跳过 —— 没有框、没有重画、状态一个字节不动
    if (notice === null && r.requests.length === 0) continue;
    if (notice !== null) allNotices.push(notice);

    for (const req of r.requests) {
      if (req.kind === 'drawFortune') {
        // ★ 抽命運三張：先把「名字\n\n抽取命運三張」那一扇演完，再**一张一段**（`0x00431dbc` 循环三次 `0x44db81`，
        //   每一张都是完整的命運演出，主角 = 当前玩家 = 中签者）
        beats.push({ before, after: s });
        for (let i = 0; i < req.amount; i++) {
          const prev = s;
          // ★ 第十五份：每一张各弹各的框 —— 先前上一张的框（「搶得%s的%s」、加持框…）留在 `notices` 里，
          //   下一张的段落又交出去一遍，表现层把它们**再弹一次**（原版 `0x44db81` 每次只画自己这一张的）。
          //   交一份「本 action 已作废」的空表进去，`appendFreshNotice` 就从空表起算。
          const own: NoticeHint[] = [];
          staleNoticeLists.add(own);
          s = { ...drawAndApplyFortune({ ...s, currentPlayer: who, notices: own }, topo), currentPlayer: who };
          if (s.notices !== prev.notices) allNotices.push(...s.notices);
          beats.push({ before: prev, after: s });
          if (s.phase === 'gameOver') return finish(s);
        }
        s = { ...s, phase: s.phase === 'gameOver' ? s.phase : 'turnEnd' };
        continue;
      }
      // ★ 加蓋 / 拆除两支在施加之前 `0x40af12(格型别, &x, &y)` + `0x41d476(x, y, 0)` = view_to 那块地
      //   （0x00432050 / 0x00432341）—— 那两段影片（0x229 / 0x211）贴在棋盘正中，全靠镜头对准那块地。
      const tp = s.players[req.player];
      if ((req.kind === 'build' || req.kind === 'demolish') && tp !== undefined) {
        const vt = nodeViewTarget(s, topo, tp.nodeId);
        if (vt !== null) {
          s = { ...s, lastViewTarget: vt };
          lastView = vt;
        }
      }
      const upgradesBefore = s.lastBuildUpgrades?.length ?? 0;
      const noticesBefore = s.notices;
      s = applyMagicRequest(s, topo, req);
      if (s.notices !== noticesBefore) {
        // 子流程（關押 / 拍賣…）自己又弹了框、把 `notices` 整个换掉 ⇒ 魔法屋那一扇排在前面
        const own = notice === null ? [] : [notice];
        const extra = s.notices.filter((n) => n !== notice);
        allNotices.push(...extra);
        s = { ...s, notices: [...own, ...extra] };
      }
      // ★ 大锤影片是**无条件**播的：`0x00432059 call 0x40b110` 之后紧接着 `0x00432074 call 0x45144f`，
      //   不看 0x40b110 盖没盖动（满级 / 連鎖店已有 / 真人的空設施没选种类）——只有 bit7 那段 0x20b 看返回值。
      //   ⇒ 没盖动也交一条提示（等级不变），让表现层照样播那一段大锤。
      if (req.kind === 'build' && tp !== undefined && (s.lastBuildUpgrades?.length ?? 0) === upgradesBefore) {
        const node = topo.nodes[tp.nodeId - 1];
        if (node !== undefined) {
          s = withBuildUpgrade(s, { entity: node.type, reachedMaxLevel: false, source: 'magicHouse' });
        }
      }
      if (s.phase === 'gameOver') {
        beats.push({ before, after: s });
        return finish(s);
      }
    }
    if (option !== 1) beats.push({ before, after: s });
    allUpgrades.push(...(s.lastBuildUpgrades ?? []));
    cur = s;
  }
  return finish(cur);
}

/**
 * 这位中签者要弹的那一扇訊息框；这一支有闸而闸没过 ⇒ `null`（整支不做、不弹）。
 *
 * @source
 * - `0x431caa` 每一支开头：`sprintf(0x46482a "%s\n\n", [player+0] 名字)` + `strcat([0x475724 + 16*效果] 效果名)`
 *   → `0x440cac(…, 0x5dc)`；「得一張卡片」那一支（0x004320dd）先发卡、再 `sprintf(0x464839 "得到%s！", 卡名)`；
 * - **哪几支先有闸**：5 就地加蓋 / 9 就地拆除 / 11 拍賣 —— `cmp dword [player+0x32], 0 / jne` + 格型别
 *   `(0x7d0, 0x1770)`（0x00431f67 / 0x00432259 / 0x0043242b，都在 `push 1 / call 0x41906a` 与弹框**之前**）；
 *   7 向後轉 —— 只有 `[player+0x32]` 那一道（0x00432160）。其余各支无闸，一律弹。
 * - 电脑那一支另有「条件\n\n效果」（`0x00433981..0x004339b8`，`0x464842 "%s\n\n%s"`），见 `applyMagicHouse`。
 */
function magicNoticeFor(state: GameState, who: number, option: number, r: MagicEffectResult): NoticeHint | null {
  const p = state.players[who];
  if (p === undefined) return null;
  const name = playerName(state, who);
  const effectName = MAGIC_HOUSE_OPTIONS[option]?.name ?? '';
  if (option === 5 || option === 9 || option === 11) {
    // 闸 = `applyMagicEffect` 交出 build / demolish / auction 请求的那一道（同一段判据）
    if (!r.requests.some((q) => q.player === who)) return null;
  } else if (option === 7) {
    if (!magicLocalizable(p)) return null;
  } else if (option === 6) {
    const got = r.log.find((l) => l.player === who && l.note === '得一張卡片');
    // ⚠️ 牌堆抽空（`0x441e12` 没发出卡）时原版照样弹、卡名取 `[0x47fdea + 8*0]`（表外）——
    //   这一格读不出有意义的字，本引擎不弹（登记于 T-037 D-MAGIC-16）。
    if (got === undefined) return null;
    return { key: 'magic.gotCard', args: [name, cardNameOf(got.value)], beforeFilms: true };
  }
  const afterMs = MAGIC_NOTICE_AFTER_MS[option];
  return afterMs === undefined
    ? { key: 'magic.effect', args: [name, effectName], beforeFilms: true }
    : { key: 'magic.effect', args: [name, effectName], beforeFilms: true, afterMs };
}

/**
 * 魔法屋几支在施加之后的**空等**（`fcn_0045285e(ms)`，忙等、点不掉）。
 *
 * @source 0 變賣卡片 / 8 變賣道具 → `0x00431d3a` → `0x00431d53 push 0xc8`；
 *   4 存入現金 → `jmp 0x431d4b` → 同一句 `push 0xc8`；
 *   7 向後轉 → `0x004321e6 push 0x1f4` → `jmp 0x431d58`。其余各支没有。
 */
const MAGIC_NOTICE_AFTER_MS: Readonly<Record<number, number>> = { 0: 0xc8, 4: 0xc8, 7: 0x1f4, 8: 0xc8 };

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
      // ★ 首次关押清"另一张"占用表（原版 `call 0x40d761`，@source 0x0043d5e7）
      const otherOcc = kind === 'prison' ? state.hospitalOccupancy : state.prisonOccupancy;
      const c = sendToConfinement(
        state.players,
        state.objects,
        topo.nodes,
        occ,
        kind,
        req.player,
        req.amount,
        otherOcc,
        // ★ 首次关押的屏幕坐标取特殊景观记录（綠島／醫院大樓）—— 见 confinement.ts
        topo.landscapes,
      );
      const confined: GameState = kind === 'prison'
        ? {
            ...state,
            players: c.players,
            objects: c.objects,
            prisonOccupancy: c.occupancy,
            ...(c.otherOccupancy === undefined ? {} : { hospitalOccupancy: c.otherOccupancy }),
          }
        : {
            ...state,
            players: c.players,
            objects: c.objects,
            hospitalOccupancy: c.occupancy,
            ...(c.otherOccupancy === undefined ? {} : { prisonOccupancy: c.otherOccupancy }),
          };
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
        return built === null ? state : withBuildUpgrade(built.state, buildHintOf(built, 'magicHouse'));
      }
      // @source 0x40b138 `cmp byte [land+0x18], 0` / `jne`（非住宅跳过 level<5 那关）
      //          0x40b14c `cmp cl, 1` / `jne`（★ 连锁店判据是 **type == 1**）
      //          0x40b15d `test eax,eax / je 跳过`（type ≥ 2 两关都不满足 ⇒ **不可建**）
      // ★★ 2026-09-19 订正（§7.141 E7，通道 2 `test_land_mutation_gates.py` 354/354）：
      //   先前写成 `type !== 0` ⇒ `type ≥ 2 且 level == 0` 时复刻会蓋、原版不蓋。
      const buildable =
        land.type === 0 ? land.level < MAX_LAND_LEVEL
        : land.type === 1 ? land.level === 0
        : false;
      if (!buildable) return state;
      const landLevel = [...state.landLevel];
      landLevel[land.id] = land.level + 1;
      // ★ `0x00432085 test byte [esp+0xa8], 0x80 / je / call 0x40b0cd` ——
      //   魔法屋这一支同样消费 bit7（与機器工人同构：先 0x229 大锤、再 0x20b）。
      //   等级比较在 core 用同一个契约（`buildUpgradeBit7`），客户端只读提示。
      return withBuildUpgrade({ ...state, landLevel }, {
        entity: 0x7d0 + land.id,
        reachedMaxLevel: buildUpgradeBit7(land.level, land.level + 1),
        source: 'magicHouse',
      });
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
    case 'auction': {
      // @source 魔法屋 VA 0x0043242b..0x004324d5：
      // ```asm
      // imul ebx, [0x49910c], 0x68            ; 当前行动者（＝本次中签者）
      // cmp  dword [ebx + 0x496b9a], 0
      // jne  跳过                             ; +0x35 非 0 → 不拍（出局/未上场）
      // mov  ax, word [ebx + 0x496b74]        ; 他所在的**节点号**
      // ebx  = 5*node / shl 3                 ; 节点记录步长 0x28
      // mov  bx, word [0x498e80 + ebx*8 + 0x20]  ; ★ 节点 +0x20 = 该格的 type
      // cmp  ebx, 0x7d0 / jle 跳过
      // cmp  ebx, 0x1770 / jge 跳过            ; 必须落在 (2000,6000) = 地产/設施
      // push 1 / push ebx / push [0x49910c]
      // call 0x43bde5                          ; ★ 卖方 = 该玩家自己
      // ```
      // ★ 拍的是**他脚下这一格的产业**，不是随机挑一块；款子归**他**（卖方席位是他）。
      //   ⚠️ 先前这里是 `return state` —— 空转：魔法屋转到「拍賣」什么都不发生。
      const who = state.players[req.player];
      if (who === undefined) return state;
      const node = topo.nodes[who.nodeId - 1];
      if (node === undefined) return state;
      const entity =
        node.ref.kind === 'land'
          ? effectiveLand(state, topo, node.ref.index)
          : node.ref.kind === 'facility'
            ? effectiveFacility(state, topo, node.ref.index)
            : null;
      if (entity === null) return state;
      return startAuction(state, topo, {
        kind: 'auction',
        entityId: entity.id,
        basePrice: auctionBasePrice(entity, state.priceIndex),
        // @source 0x4324d4 `push [0x49910c]`？—— 魔法屋这一支的 arg0 = **中签者**
        //   （`0x4324d4` 附近的压栈），与原版建表 `0x43c22a cmp ebx,ebp` 同义。
        bidders: eligibleBidders(state.players, entity, req.player),
        seller: req.player,
        ...(node.ref.kind === 'facility' ? { facility: true } : {}),
      });
    }
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
 *
 * ★★ 这一格是**关押格**（节点 `type` = 0x1f41/0x1f42，即監獄/醫院景观所在的那一格），
 *   **不是**带保釋菜单的監獄/醫院**落点特殊格**（`specialKind` 4/5）—— 两者在
 *   0001.bin 上是不同的节点（1 / 23 vs 12 / 16）。判据与理由见
 *   `rules/confinement.ts` 的 `CONFINEMENT_GATE_TYPE`。
 *
 * ★ 首次关押的「传送到这一格」由 `rules/confinement.ts` 的
 *   `sendToConfinement` 负责（原版那几行写在 `send_to_prison` 函数体内）。
 *   本函数只剩「释放回棋盘」等地方在用。
 */
function gateNodeOf(topo: MapTopology, kind: ConfinementKind): number {
  return confinementGateNodeId(topo.nodes, kind);
}

/**
 * 九种免收 → 棕色訊息框（键 + 实参）—— **九种全接**。
 *
 * @source `0x0041d559`：每条免收支各自 `push 格式串`，然后汇到同一段
 *   `call 0x457110`（sprintf）+ `0x41d6a4 push 0x5dc / call 0x440cac`（彈框）。
 *   九条的推串点与**实参个数**（cdecl：最后推的是第一个实参）：
 * ```asm
 * 0041d59f  push 0x463bb8   ; 房屋查封中\n\n免收%s！          ← 只推 esi（費名）
 * 0041d5d7  push 0x463bcd   ; 與%s同盟中\n\n免收%s！          ← 推 名字, esi（費名）
 * 0041d5fa  push 0x463be2   ; 死神顯靈\n\n免收%s！            ← 只推 esi（費名）
 * 0041d613  push 0x463bf5   ; %s住宿中\n\n免收%s！
 * 0041d62c  push 0x463c08   ; %s消失中\n\n免收%s！
 * 0041d645  push 0x463c1b   ; %s坐牢中\n\n免收%s！
 * 0041d65e  push 0x463c2e   ; %s住院中\n\n免收%s！
 * 0041d67a  push 0x463c41   ; %s冬眠中\n\n免收%s！
 * 0041d696  push 0x463c54   ; %s夢遊中\n\n免收%s！
 * ```
 *   「名字」= 函数开头 `0x41d57d lea eax,[esp+0x84] / call 0x452946` 用
 *   **第 1 个实参（地主下标）**填出来的缓冲；两条单 `%s` 的支（查封、死神）
 *   用的是同一个缓冲区地址，只是**没有把它推进栈** —— 所以只有費名一个实参。
 *   ⚠️ 同盟那一条的第一个 `%s` 也是**地主名**（同一个缓冲区），不是同盟者名。
 *
 * @param landlordName 地主名（`playerName(state, 地主下标)`）
 * @param feeName      費名 —— 住宅 = `[0x47517c]` 第 0 项「過路費」；
 *                     設施 = `facilityFeeNameOf(type)`（`0x47528b` 表）
 */
function exemptionNotice(
  exemption: TollExemption,
  landlordName: string,
  feeName: string,
  payer: number,
): NoticeHint {
  // ★ 第十四份：九种免收**都**汇到 `0x0041d6a0`：`0x0041d6a4 call 0x440cac(…, 0x5dc)` 弹完框，
  //   `0x0041d6d2 mov edx,[… + 0x48087e]`（事件 **13**）→ `0x0041d6dd player_say([0x49910c], 3, …)`
  //   —— 当前玩家（= 付款方）庆幸一句。
  return { ...exemptionNoticeText(exemption, landlordName, feeName), say: { player: payer, event: 13 } };
}

function exemptionNoticeText(
  exemption: TollExemption,
  landlordName: string,
  feeName: string,
): NoticeHint {
  switch (exemption) {
    case 'sealed':
      // @source 0x0041d59f（只有一个 `%s` = 費名）
      return { key: 'rent.freeSealed', args: [feeName] };
    case 'ally':
      // @source 0x0041d5d7（地主名 + 費名）
      return { key: 'rent.freeAllied', args: [landlordName, feeName] };
    case 'reaper':
      // @source 0x0041d5fa（只有一个 `%s` = 費名）
      return { key: 'rent.freeReaper', args: [feeName] };
    case 'hotel':
      return { key: 'rent.freeHotel', args: [landlordName, feeName] };
    case 'disappearing':
      return { key: 'rent.freeVanished', args: [landlordName, feeName] };
    case 'prison':
      return { key: 'rent.freePrison', args: [landlordName, feeName] };
    case 'hospital':
      return { key: 'rent.freeHospital', args: [landlordName, feeName] };
    case 'sleeping':
      return { key: 'rent.freeWinterSleep', args: [landlordName, feeName] };
    case 'sleepWalking':
      return { key: 'rent.freeSleepwalk', args: [landlordName, feeName] };
  }
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
  // ★★ 第 160 条（README §7.142(5) 的 E9 #6/#7）：种类与地契也要落到状态。
  //   先前只写 level/owner ⇒ `blastLand` 算出来的 `type` **被丢弃**：
  //   飛彈打連鎖店时原版「夷平成普通 0 级住宅」，复刻仍是「0 级連鎖店」；
  //   核彈重击后那格还带着連鎖店身份与地契到期日（`sweepTenure` 里会"到期"）。
  //   @source 住宅轻击 `0x40ad2a cmp byte [ebx+0x18],0 / je` → `0x40ad30 [ebx+0x1a]=0 / [ebx+0x18]=0`
  //          住宅重击 `0x40ad6b..0x40ad77`：`[+0x19]/[+0x1a]/[+0x18]` 与 **`+0x30`（地契）**全清
  const landType = [...state.landType];
  const landTenure = [...state.landTenure];
  const facilityLevel = [...state.facilityLevel];
  const facilityOwner = [...state.facilityOwner];
  const facilityType = [...state.facilityType];
  const facilityTenure = [...state.facilityTenure];
  const deltas: { from: number; to: number; delta: number }[] = [];
  const hitNodes = new Set<number>();
  // ★ 拆到 0 级时原版 `mutate_facility` 尾部会 `call 0x40dffa`（全场放人）；
  //   重击設施那一支（`0x40ae58`）也是无条件 `call 0x40dffa`。
  let releaseFlag = false;

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
    // ★ 种类必须落回：轻击把連鎖店夷平成 0 级住宅（`out.type = 0`），
    //   重击连地契一起烧（`+0x30`）。
    landType[land.id] = out.type;
    if (heavy) landTenure[land.id] = 0;
    if (out.hostility !== 0 && land.owner !== 0) {
      deltas.push({ from: land.owner - 1, to: state.currentPlayer, delta: out.hostility });
    }
  }

  // @source flags & 4 —— 設施（`MISSILE_FLAGS = 0x26` 里那一位）
  //   ★ 先前漏了这一支：飛彈/核彈打下企業時，原版会把設施也拆了。
  //   設施那一支的写法与地块**不同**：轻击是「等级 −1，归零才清种类」
  //   （地块是「种类非 0 就直接夷平」），重击是「归属/等级/种类/租期全清」，
  //   见 `damage_area` VA 0x0040ad88..0x0040ae67 与 `cards/monster.ts` 的
  //   `mutateFacility`（mode 0/1 正是这两支）。
  for (const n of topo.nodes) {
    if (!inBlast(n)) continue;
    const fid = facilityIndexOf(n.type);
    if (fid === null) continue;
    const fac = effectiveFacility(state, topo, fid);
    if (fac === null) continue;
    if (heavy) {
      // @source 重击：敌意 = level × 30 × 物價，随后 owner/level/type/+0x34 全清
      if (fac.owner !== 0) {
        deltas.push({
          from: fac.owner - 1,
          to: state.currentPlayer,
          delta: fac.level * MISSILE_DEMOLISH_HOSTILITY * state.priceIndex,
        });
      }
      facilityOwner[fac.id] = 0;
      facilityLevel[fac.id] = 0;
      facilityType[fac.id] = 0;
      facilityTenure[fac.id] = 0;
      // ★★ 第 160 条订正：重击設施也 **无条件** `call 0x40dffa`（放人）。
      //   @source `0x40ae45..0x40ae58`：`[+0x19]=0 / [+0x1a]=0 / [+0x18]=0 /
      //           [+0x34]=0` 之后紧接着 `call 0x40dffa`（然后是 `0x40a4e1(0)`）。
      //   先前这一支**漏了放人**（`test_damage_area.py` 的 #12 裁决表写成
      //   "四项 + releaseFlag"，与字节不符 —— 又一次「测试写了不等于对」）。
      releaseFlag = true;
    } else {
      // @source 轻击：敌意固定 30 × 物價
      if (fac.owner !== 0) {
        deltas.push({
          from: fac.owner - 1,
          to: state.currentPlayer,
          delta: MISSILE_DEMOLISH_HOSTILITY * state.priceIndex,
        });
      }
      // ★★ 第 160 条（E9 #11）：**不能**用 `mutateFacility(MUTATE_DEMOLISH_ONE)`。
      //   那支复刻的是 `0x40ab4a` 的 mode 0 —— 它在 `level == 0` 时**直接返回"不变"**
      //   （`0x40ac23 test bh,bh / je 0x40ac76`）。而 `damage_area` 是**另一份**
      //   内联逻辑，收尾判据读的是**减完之后**的等级：
      // ```asm
      // 0040adf5  mov cl,[ebx+0x1a]      ; level
      // 0040adf8  test cl,cl / je 0x40ae03
      // 0040adfc  dec ch / mov [ebx+0x1a],ch
      // 0040ae03  mov al,[ebx+0x1a]      ; ★ 再读一次
      // 0040ae06  test al,al / jne 结束   ; 还不为 0 → 什么都不做
      // 0040ae0a  mov [ebx+0x18],al      ; ★ 为 0（刚减到 / 本来就是）→ 种类清 0
      // 0040ae0d  call 0x40dffa          ; ★ 并且放人
      // ```
      //   ⇒ `level == 0` 的設施（拆一级留下的那种记录）照样被清种类**并放人**。
      const nextLevel = fac.level > 0 ? fac.level - 1 : 0;
      facilityLevel[fac.id] = nextLevel;
      if (nextLevel === 0) {
        facilityType[fac.id] = 0;
        releaseFlag = true;
      }
    }
  }

  // @source flags & 0x20 —— 范围里的人：毁车 + 挂上「被炸」标志
  //   随后统一 `敌意 += 90 × 物价指数` 并送医 3 天（VA 0x004470a1 的循环）
  // ⚠️ 必须**按下标**改一个工作数组：`confine` 返回的是新数组，
  //   若边遍历原数组边替换，后面几个人的改动会写到已被丢弃的旧对象上。
  //   核彈打全图时四个人都在范围里，这个坑一踩一个准。
  let players: Player[] = state.players.map((p) => ({ ...p }));
  // ★ 同一次「送医」里跟班也要搬到医院格（见 `applyConfinementTeleport` 的注释）。
  let objects: MapObject[] = state.objects.map((o) => ({ ...o }));
  // ★ 原版在**改记录**时就顺手放人了（`mutate_facility` 尾部），与后面的
  //   「送医」互不影响 —— 这里按同样顺序：先按 releaseFlag 放人，再走送医。
  if (releaseFlag) players = releaseConfinedPlayers(players);
  let hospital = [...state.hospitalOccupancy];
  // ★ 首次入院会清"另一张"占用表（原版 `call 0x40d761`，@source 0x0043d5e7）
  let prison = [...state.prisonOccupancy];
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
    // ★ 与「送医院」同一支：首次也要传送到医院格 + 跟班跟着搬
    //   （`send_to_hospital` 全都在函数体内，见 rules/confinement.ts 的 `sendToConfinement`）
    const c = sendToConfinement(
      players,
      objects,
      topo.nodes,
      hospital,
      'hospital',
      i,
      MISSILE_HOSPITAL_DAYS,
      prison,
      topo.landscapes,
    );
    players = c.players.map((q) => ({ ...q }));
    objects = c.objects;
    hospital = c.occupancy;
    if (c.otherOccupancy !== undefined) prison = c.otherOccupancy;
  }
  // 保險：住院的意外損失（send_to_hospital 里 0x0043edf8）
  const insured = new Set<number>();
  players.forEach((q, i) => {
    if (q.blocking.inHospital !== 0 && state.players[i]?.blocking.inHospital === 0) insured.add(i);
  });

  let out: GameState = {
    ...state,
    players: applyHostilityDeltas(players, deltas),
    prisonOccupancy: prison,
    landLevel,
    landOwner,
    landType,
    landTenure,
    facilityLevel,
    facilityOwner,
    facilityType,
    facilityTenure,
    hospitalOccupancy: hospital,
    toolStock,
    objects,
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
  // @source cmp byte [player + 0x15], 1 / jne 不玩 —— ★ 整字节比较：託管（1|4）也走「不玩」（2026-09-23 订正，先前按低 2 位比）
  const human = isPlainHuman(me);
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
  // ★ 小游戏「不玩」出口固定消耗 **2** 次随机数（原版 `0x00415457` + `0x004154b6`）：
  //   ① `0x00415457 call 0x456f2d` → `idiv 0x14` → `add edx,0x32` = 得分 `50 + rand()%20`
  //   ② `0x004154b6 call 0x456f2d` → `and eax,1` → 从**角色台词表** `0x48084a`
  //      取事件 0／1 的台词并 `player_say`
  //   此前 remake 只掷 ① ，于是这一支之后的所有随机事件整体错开一步。
  //   ★ 这一支**电脑玩家也走**（`0x004154b6` 在两类玩家的公共出口上），
  //     所以第二次掷与"谁在玩"无关。
  let phraseIndex: number | undefined;
  if (score === null) {
    const rng = new WatcomRng();
    rng.setState(rngState);
    gained = autoMinigameScore(rng.next());
    phraseIndex = rng.next() & 1; // @source 0x004154b6
    rngState = rng.getState();
  } else {
    gained = clampMinigameScore(score);
  }
  // @source add word [player + 0x30], ax
  const next = withPlayer({ ...state, rngState }, state.currentPlayer, (p) => {
    p.points = addPoints(p.points, gained);
  });
  return {
    ...next,
    phase: 'turnEnd',
    // 台词交给表现层（core 只负责"按原版把随机数用掉"并交出选中的下标）
    ...(phraseIndex === undefined
      ? {}
      : {
          lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex },
          // ★ 第八份试玩回报 #9：「不玩」那一支先弹「得點券%d點」再说台词
          //   @source `0x00415472 push 0x463797` / `0x00415484 push 0x7d0`（**2000 ms**，不是常见的 1500）
          //   → `0x0041548e call 0x440cac` → 之后才 `0x004154b6` 掷台词。玩过的那一支（`score !== null`）
          //   分数由小遊戲屏自己亮 2 秒（`MINI_END_MS`），不走这扇框。
          notices: [{ key: 'points.minigame', args: [gained], holdMs: 2000 }],
        }),
  };
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

  // @source 監獄 `0x0043d331` / 醫院 `0x0043e9d1 cmp byte [player + 0x15], 1 / jne 电脑支` —— ★ 整字节：託管走电脑那一支
  const human = isPlainHuman(me);
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
  // ★ 2026-09-23：电脑保釋先弹「保釋%s」（1500 ms）—— `%s` = 玩家名（槽 < 4，`[槽*0x68 + 0x496b68]`）
  //   或犯人名（`[槽*4 + 0x47ed5a]`）。@source 監獄 `0x0043d534 push 0x465169` / `0x0043d550 call 0x440cac`；
  //   醫院 `0x0043ebe0 push 0x465207` / `0x0043ebfc call 0x440cac`
  const bailed = d.slot < OBJECT_SLOT_BASE ? playerName(rolled, d.slot) : (INMATE_NAMES[d.slot - OBJECT_SLOT_BASE] ?? '');
  const paid: GameState = appendFreshNotice(
    { ...rolled, players: r.players },
    { key: kind === 'prison' ? 'bail.prison' : 'bail.hospital', args: [bailed] },
  );
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
  if (
    !marketOpenOn(
      state.globalMapId,
      state.year,
      state.month,
      state.day,
      // ★ 新聞 26「股市暫停交易１０天」写的就是这个计数（`0x4990dc`）
      state.market.closedDays,
    )
  ) {
    return state;
  }
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
    // ★ 顺手清掉加蓋提示：快照是 `JSON.stringify` 存的（`rules/time-machine.ts`），
    //   里面**带着**当时那份 `lastBuildUpgrades`，`JSON.parse` 回来是一个**新数组**
    //   ⇒ 客户端的「引用变了 = 本 action 有加蓋」会误判，凭空播一段大锤/0x20b。
    //   倒退一回合本来就不该播任何加蓋动效（C-DET-4：纯表现提示不参与重放）。
    return { ...back, lastBuildUpgrades: [], tools: taken.tools, toolStock: taken.stock };
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
      // ★ 试玩3 #11：连同 `cleared`（哪一件在哪一格被扫掉）一起交出去 ——
      //   客户端靠它把被扫的物件**留在原地直到补间走到那一格**，
      //   否则那几件在补间第一帧就整个消失（= 报的「没有扫走动画」）。
      lastNpcWalks: [
        { slot: specialSlotOf(ACTOR_DOLL), path: swept.path, steps: doll.stepsRemaining, cleared: swept.cleared },
      ],
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
      // ★ bit7 = `0x40b110` 返回值的 bit7，原版在 0x0044736d 消费它。
      //   `buildOneLevel` 已经把「剛好到 5 級」算好了（`b.reachedMaxLevel`），
      //   表现层只读这一条，不再自己比等级（C-ARC-2）。
      // ★★ W-54：`0x0044733c call 0x41d476` —— 大锤影片**之前**先把镜头对准
      //   被盖的那一格（`0x0044730e call 0x40af12` 取的就是这个坐标）。
      return consume(
        withSingleBuildUpgrade(
          { ...state, landLevel, lastViewTarget: { x: land.x, y: land.y } },
          {
            entity: 0x7d0 + land.id,
            reachedMaxLevel: b.reachedMaxLevel,
            source: 'robotWorker',
          },
        ),
      );
    }
    // 設施也吃这一件（`0x40b110` 对 0xfa0..0x1770 那一段）：
    //   等级 0 → 定种类再蓋第一级；等级 ≥ 1 → 不超过该种类上限就 +1
    //   ★ 等级 ≥ 1 的設施到 5 级时**照样置 bit7**（`0x0040b21a mov eax, 0x81`）。
    const built = freeBuildFacility(state, topo, nodeId, value);
    if (built === null) return state;
    return consume(
      withSingleBuildUpgrade(
        { ...built.state, lastViewTarget: nodeViewTarget(state, topo, nodeId) },
        buildHintOf(built, 'robotWorker'),
      ),
    );
  }

  // ── 飛彈（7）／核子飛彈（13）──
  if (toolId === TOOL_MISSILE || toolId === TOOL_NUKE) {
    const fired = fireMissile(state, topo, toolId === TOOL_NUKE, nodeId);
    if (fired === null) return state;
    // ★★ W-54：`0x00447b77 call 0x41d476`（爆心）在 `0x00447b86` 的
    //   0x212 爆炸影片**之前** —— 远处那一格要先看得见。
    return consume({ ...fired, lastViewTarget: nodeViewTarget(state, topo, nodeId) });
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
    // ★★ 需求方 2026-09-22（第九份試玩回報 #4）：「放置路障不能和地图上的神灵重叠」。
    //   三个放置类道具（路障 2 / 地雷 3 / 定時炸彈 4）**不许**放在已经有唯一物件
    //   （神明 / 惡犬 / 禮物 / 寶箱 / 死神 —— 类型 1..15）的格子上。
    //
    //   ⚠️ 这一条是**主动偏离原版**，需求方明确拍板（「按这个改」）：
    //     · 原版放置侧**没有任何占用校验** —— `rich4-spec/docs/systems/tools.md:496`
    //       「合法目标：任意格（无范围检查）」，`place_object` 只在自己 10 个槽里找空位；
    //     · 原版靠地图节点反向索引 `node+0x26` **按位或**槽号（`rich4_objects.asm:118-126`），
    //       所以重叠时读到的是路障、照样拦人 —— 原版**允许**重叠且两个都会画。
    //   ⇒ 登记为有意偏离（见 PR 描述）。
    //
    // ★ 放在 core 里就够了：客户端拾取走 `canUseTool`（= `useToolAction(...) !== state`，
    //   见 `state/preview.ts:86-94`），被这一条挡掉的格子**自动**不进候选、光标点不了。
    if (hasUniqueObjectAt(state, nodeId)) return state;
    const r = placeObject(state.objects, nodeId, objectType);
    if (!r.ok) return state; // 没有空物件槽
    const taken = takeTool(state.tools, state.toolStock, me.index, toolId);
    return { ...state, objects: r.objects, tools: taken.tools, toolStock: taken.stock };
  }

  return state;
}

/**
 * 这一格上有没有**唯一物件**（神明 / 惡犬 / 禮物 / 寶箱 / 死神 —— 类型 1..15）。
 *
 * 与 `objectHandleAt` 同一套可见性判据（`nodeId` 相同且 `attached === 0`）：
 * 已经附身或被人带着走的物件跟着主人跑，不算「站在这一格」。
 */
function hasUniqueObjectAt(state: GameState, nodeId: number): boolean {
  for (const o of state.objects) {
    if (o !== undefined && o.nodeId === nodeId && o.attached === 0 && o.type <= OBJECT_TYPE_UNIQUE_MAX) {
      return true;
    }
  }
  return false;
}

/**
 * 天使卡（9）—— `@rich4/data` 的 `CARDS` 里 `{ id: 9, key: 'tianshi' }`。
 *
 * ★ 本文件要**单独认它**，因为只有这张卡会把地块/設施等级推上去，
 *   也就是只有它会撞到 `0x40b110` 返回值的 bit7（E6）。
 *   @source 卡表 `0x474f5c + 9*4 = 0x004434c0`（`0x4436e0` = 惡魔卡 10，可对表）
 */
const ANGEL_CARD_ID = 9;

/**
 * ★★ 「这张卡要把镜头移到哪里」—— `view_to`（VA 0x0041d476）的**移动**那一支。
 *
 * 首席取证（W-54）：实参 `flags & 1` 的调用**只重画、不动镜头**（表里 38 处都是这一类），
 * 所以要接的只有实参形如 `(x, y, 0)` / `(x, y, 2)` / `(x, y, 3)` 的那几处：
 *
 * | 原版调用点 | 什么卡/什么动作 | 目标 |
 * |---|---|---|
 * | `0x0040d3e6` | 「坏消息」那一段 | 当事人自己 ⇒ 清标记（**不用接**）|
 * | `0x0040e384` | 神明離身（`0x40e32c`）| 同上 ⇒ 不用接 |
 * | `0x0040f427` / `0x0040f5fe` / `0x0040f866` | 神明落脚顯靈（`0x40f381`）| 行动者自己 ⇒ 不用接 |
 * | `0x0041aadf` | 对**企業**（`0x41ab63` 那一支）| 企業所在格 |
 * | `0x0041ad75` | 对**設施**（`0x41adb4`）| 設施所在格 |
 * | `0x004446b8` / `0x00444799` | 对**玩家**的卡（`cards.md`「把镜头移到该玩家」）| 目标玩家所在格 |
 * | `0x0044607a` | 对**地块**的卡（拆除/怪獸/天使/查封/漲價/改建/換地…）| 目标地块坐标 |
 * | `0x0044733c` | **機器工人** | 被盖的那一格 |
 * | `0x0044a32f`…`0x0044ae2c` 一族 | 命運/新聞里对**别人**的处置 | 目标坐标 |
 * | `0x0044c19c`…`0x0044ce4c` 一族（`flags = 3`）| 新聞/命運的场地镜头 | 目标坐标 |
 *
 * ★ 本函数只接**卡**那一路（`useCard`）—— 它是「远处生效」最典型的一类，
 *   而 `CardTarget` 已经把目标写成了 `{kind}`，判据干净。
 *   ⚠️ `r.patches` 里那一族**地块/設施**卡的效果目标与 `target` 可能不同
 *   （例如「改建卡」改的是**另一块**），故这里对 `kind === 'none'` 的卡**返回 null**
 *   （= 不动镜头），不猜。
 *
 * ★ **没接的**（表里找不到对应的「会动镜头」的行，或引擎里没有对应分支）：
 *   `kind === 'stock'`（紅/黑卡：原版不切镜头）、`'actor'`（四大惡人/機器娃娃）、
 *   `'object'`、`'commercial'`、`'none'` —— 一律返回 `null`。
 */
function cardViewTarget(
  state: GameState,
  topo: MapTopology,
  target: CardTarget,
): { x: number; y: number } | null {
  switch (target.kind) {
    case 'entity': {
      // 住宅/連鎖店 —— `entityId` = `land.id`（见 `cards/target.ts` 与 `picking.ts`）
      const land = effectiveLand(state, topo, target.entityId);
      return land === null ? null : { x: land.x, y: land.y };
    }
    case 'facility': {
      const fac = effectiveFacility(state, topo, target.facilityId);
      return fac === null ? null : { x: fac.x, y: fac.y };
    }
    case 'node': {
      const node = topo.nodes[target.nodeId - 1];
      return node === undefined ? null : { x: node.x, y: node.y };
    }
    case 'player': {
      // 「把镜头移到该玩家」（`cards.md:2844`）：用**他自己的**世界坐标
      //   （原版读 `player+0x08/+0x0a`，关押期间那是景观坐标 —— 那正是要看见的地方）
      const who = state.players[target.index];
      return who === undefined ? null : { x: who.xpos, y: who.ypos };
    }
    default:
      // 原版那一支是不是真的动镜头没取证 ⇒ 不动（不猜）
      return null;
  }
}

/**
 * 某一格的中心坐标 —— `view_to` 要的那个坐标。
 *
 * @source `fcn_0040af12`（VA 0x0040af12）：按**实体号**查表（< 0x7d0 住宅、
 *   0x7d0..0xfa0 企業、0xfa0..0x1770 設施、0x1770..0x1f40 景观、…），
 *   取表项头两个 `int16` = `(x, y)`。原版 `view_to` 的实参就是这么来的
 *   （例：機器工人 `0x0044730e call 0x40af12` → `0x0044733c call 0x41d476`）。
 *
 * ★ 本引擎按**节点**给目标（`useTool` 的参数是 `nodeId`），所以这里做一次反查：
 *   该节点若是住宅/連鎖店就取它的表项坐标、是設施就取設施表项坐标，
 *   都不是（景观/空地）则退回节点自己的坐标。
 */
function nodeViewTarget(
  state: GameState,
  topo: MapTopology,
  nodeId: number,
): { x: number; y: number } | null {
  const node = topo.nodes[nodeId - 1];
  if (node === undefined) return null;
  const li = housingIndexOf(node.type);
  if (li !== null) {
    const land = effectiveLand(state, topo, li);
    if (land !== null) return { x: land.x, y: land.y };
  }
  const fi = facilityIndexOf(node.type);
  if (fi !== null) {
    const fac = effectiveFacility(state, topo, fi);
    if (fac !== null) return { x: fac.x, y: fac.y };
  }
  return { x: node.x, y: node.y };
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
  const facilities = allEffectiveFacilities(state, topo);
  // ★ 卡牌路径里也有随机消费（轉向卡掉头后重挑「来路」，原版 `0x40c834 call 0x456f2d`）
  //   ⇒ 与其它随机出口同一套：传 `rng` 进去、出口之后把 `rngState` 写回。
  const rng = new WatcomRng();
  rng.setState(state.rngState);
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
      // ★ 黑卡尾部敌意循环要读持股（原版 `0x497198 + p*96 + n*8`）
      holdings: state.holdings,
      marketOpen: marketOpenOn(
        state.globalMapId,
        state.year,
        state.month,
        state.day,
        state.market.closedDays,
      ),
      facilities,
      actors: state.specialActors,
      // ★★ 2026 本轮：嫁禍/復仇卡入狱要**占床位**（客户端关押动效靠 0→1 跳变触发），
      //   且首次入狱要清医院那一格 —— 这两张表以前根本没进卡牌路径。
      prisonOccupancy: state.prisonOccupancy,
      hospitalOccupancy: state.hospitalOccupancy,
      // 嫁祸的新目标：交给上层决定；没给就放弃转嫁（返回 -1）
      scapegoatPicker: () => -1,
      // 轉向卡要的那一次 `rand()`（只在真有候选时被调用）
      rng,
    },
    cardId,
    target,
  );
  // ★ `ok === false` ⟺ 原版卡片函数返回 0 ⟺ **卡还在手上、状态一点不动**。
  //   这条等价关系是机械核验过的：`rich4-spec/tools/scratch/consume_invariant_check.py`
  //   证明「30 张卡从 `remove_card` 之后的每一条出口都返回非 0」。
  //   所以「已扣卡但没生效」那类情形在 registry 里是 `ok: true` + 什么都不改
  //   （`noEffect()`），不会走到这里。
  if (!r.ok) {
    // ★ 2026-09-23：購地卡只差现金 ⇒ 弹「您的現金不足！」（1500 ms），卡**不扣**、状态不动
    //   @source `0x004423bb jg 0x4425f1` → `0x004425f1 push 0x5dc / push 0x46530c / call 0x440cac` → `0x00442618 mov eax, esi`（0）
    if (cardId === 3 && r.error === 'notEnoughCash') {
      return appendFreshNotice(state, { key: 'card.cashShort', args: [] });
    }
    return state;
  }

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

  // ★★ 敌意**不在这里再落一次** —— `useCard`（`cards/registry.ts` 尾部）已经
  //   用 `applyHostilityDeltas(r.players, r.hostilityDeltas)` 落过了，返回值里的
  //   `players` 就是「已含敌意」的那一份。先前这里又落了一遍 ⇒ **全引擎的卡片敌意
  //   被加了两次**（梦遊/冬眠/陷害/查稅/黑卡都翻倍；黑卡那笔还是「double 低 32 位」
  //   的垃圾值，翻倍后差异极大）。2026-09-19 由黑卡的通道 2 差分测试连带发现
  //   （`test_stock_alliance_cards.py` 的 [D] 段 + `use-card.test.ts` 的回归用例）。
  //   ⚠️ `r.hostilityDeltas` 仍然保留在返回值里，供调用方**知情/展示**，不要重复应用。
  const players = r.players;

  // ★ 送神符之类只清了玩家身上的引用，物件本身要在这里收回：
  //   退还三项修正、清 `attached`、让搭档登场。
  // ★ `rngState` 一并写回：轉向卡可能吃掉一次 `rand()`（C-DET-4：回放要一致）
  // ★ 纯表现提示：把「刚刚谁用出了哪张卡」交给表现层（原版卡片函数里那句
  //   `player_say(出牌者, flag, 卡牌台词表[角色][卡号-1])` 是**调用点参数**，
  //   状态差分推不出来）。只保留最近一次、不进指纹/存档/快照，见 `CardPlayHint`。
  let next: GameState = { ...state, lastBuildUpgrades: [], lastCardPlay: { player: state.currentPlayer, cardId }, lastViewTarget: cardViewTarget(state, topo, target), players, rngState: rng.getState(), landOwner, landLevel, landType, landPriceStatus, facilityOwner, facilityLevel, facilityType, facilityPriceStatus, facilityResearchDays, specialActors: r.actors, tools: r.tools, toolStock: r.toolStock, objects: r.objects, market: r.market, prisonOccupancy: r.prisonOccupancy, hospitalOccupancy: r.hospitalOccupancy };
  // ★★ 天使卡（9）是**唯一**会把地块/設施等级推上去的卡，也就是唯一会撞到
  //   `0x40b110` 返回值的 bit7 的那张 —— README §7.142(5) E6 的第 2 条消费点。
  //
  //   它的两条支路在原版里形状不同：
  //   · **地块支是内联的**（不走 `0x40b110`）：
  //     `0x004435cb inc byte [ebx+0x1a]` → `0x004435ce cmp byte [ebx+0x18], 0`
  //     / `jne`（★ 只认住宅）→ `0x004435d4 cmp byte [ebx+0x1a], 5` / `jne`
  //     → `0x004435da mov dword [esp], 1`（置局部标志）；
  //   · **設施支**走 `0x004436ad call 0x40b110` + `0x004436b5 test al, 0x80`
  //     → `0x004436b9 mov dword [esp], 1`。
  //   两条最后都汇到 `0x004436ce cmp dword [esp], 0` / `0x004436d4 call 0x40b0cd`
  //   （= 播 Data.mkf 0x20b + Effect.mkf 0x5a）。
  //   判据**同形**：等级真的变了、且新等级正好是 5（`buildUpgradeBit7`）。
  //   ⚠️ 天使卡整支里**没有** `push 0x229` / `call 0x450441` / `call 0x45144f`
  //   —— 它**不播大锤**，只有 0x20b（见 `BuildUpgradeSource`）。
  //
  //   `cards/land-cards.ts` 的 `applyAngelFacilityCard` 其实已经算出 `0x81`
  //   （`resultCode`），但 `cards/registry.ts` 只取 `r.facility`、把它丢了，
  //   而那两个文件不在本次改动范围内 —— 故这里用同一个 core 契约从 before→after
  //   把它取回来（客户端仍然一个等级都不比，C-ARC-2）。
  if (cardId === ANGEL_CARD_ID) {
    const facBefore = new Map(facilities.map((f) => [f.id, f] as const));
    for (const after of r.facilities) {
      const before = facBefore.get(after.id);
      if (before === undefined || before.level === after.level) continue;
      next = withBuildUpgrade(next, {
        entity: 0xfa0 + after.id,
        reachedMaxLevel: buildUpgradeBit7(before.level, after.level),
        source: 'angelCard',
      });
    }
    const landBefore = new Map(lands.map((l) => [l.id, l] as const));
    for (const after of r.lands) {
      const before = landBefore.get(after.id);
      if (before === undefined || before.level === after.level) continue;
      next = withBuildUpgrade(next, {
        entity: 0x7d0 + after.id,
        reachedMaxLevel: buildUpgradeBit7(before.level, after.level),
        source: 'angelCard',
      });
    }
  }
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
  // ★ 2026-09-23（框模板反查）：卡片函数**里面**弹的那几扇訊息框（1500 ms）
  const cardNotice = cardEffectNotice(state, cardId, target, r.taxed);
  if (cardNotice !== null) next = appendFreshNotice(next, cardNotice);
  // 拍賣卡：把竞价挂成待决交互。★ Q-AUC-1 之后竞价循环归 core ——
  //   挂出来时就把座位表、心理价位、现价、轮到谁一并建好（见 openAuction）。
  if (r.followUp !== null) {
    if (r.followUp.kind === 'auction') {
      return startAuction(next, topo, r.followUp);
    } else {
      next = { ...next, pending: r.followUp, phase: 'awaitingDecision' };
    }
  }
  // ★ 請神符把神明**附身**上去那一刻的發威 —— 与落点那条走同一个助手
  //   （原版两条都汇到 `_rich4_attach_god` 的跳表，见 rules/god-power.ts）
  return applyGodPowerOnAttach(state, next, topo);
}

/**
 * 卡片函数里面那几扇訊息框（都在效果落地的同一段里，1500 ms）：
 * - 搶奪卡（13）**电脑**抢到一张卡：「搶得%s的\n\n%s」`[受害者, 卡名]`
 *   @source `0x00441942 cmp [+0x15],1 / jne 0x441a5d`（电脑支）→ `0x00441a95 push 0x4652f8` → `0x00441ab1 call 0x440cac`；
 *   真人支在选牌窗里挑，不弹（`0x00441a5b jmp 0x441ab9`）。`%s`#2 取的是**卡片表**（`[esi*8+0x47fdea]`），
 *   ⇒ 只在抢到**卡**时弹（抢道具那一路原版读出来的是卡片表外的指针，不复刻）。
 * - 紅卡（24）/ 黑卡（25）**电脑**：「對%s使用%s！」`[股名, 卡名]`
 *   @source 紅 `0x00444f6a cmp [+0x15],1 / je`（真人走股市屏）→ `0x00444fbf push 0x4653ae` → `0x00444fdb`；
 *           黑 `0x00445138` → `0x00445154`
 * - 查稅卡（26）真的收到税：「抽取%s\n\n%d元稅金！」`[被查的人, 税额]`（真人电脑都弹）
 *   @source `0x00445375 cmp ebx, 当前 / je 跳过` → `0x004453d3 push 0x4653c0` → `0x004453ef call 0x440cac`
 */
function cardEffectNotice(
  state: GameState,
  cardId: number,
  target: CardTarget,
  taxed: { victim: number; amount: number } | undefined,
): NoticeHint | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const ai = isAiControlled(me);
  if (cardId === 13 && ai && target.kind === 'player' && target.steal?.kind === 'card') {
    return { key: 'card.robbed', args: [playerName(state, target.index), cardNameOf(target.steal.id)] };
  }
  if ((cardId === 24 || cardId === 25) && ai && target.kind === 'stock') {
    return {
      key: 'card.useOnStock',
      args: [stocksOfMap(state.globalMapId)[target.index]?.name ?? '', cardNameOf(cardId)],
    };
  }
  if (cardId === 26 && taxed !== undefined) {
    return { key: 'card.taxed', args: [playerName(state, taxed.victim), taxed.amount] };
  }
  return null;
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
function buySharesFromCommercial(state: GameState, shares: number, topo: MapTopology): GameState {
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
  const reowned = reownCommercial(next, pending.stock, state.currentPlayer);
  // ★ 2026-09-23：認購之后**易主**（`0x428d2a` → `0x4294d5` 返回 1）就弹一扇：
  //   門派（行業 0xc）「恭喜您成為幫主！」、其余「恭喜您獲得經營權！」（1500 ms）
  //   @source `0x0041d289 cmp eax,1 / jne` → `0x0041d28e cmp byte [企業+0x1a], 0xc` →
  //   `0x0041d299 push 0x463b94` / `0x0041d2a5 push 0x463ba5` → `0x0041d2aa call 0x440cac`
  const cid = state.market.stocks[pending.stock]?.commercialIndex ?? pending.commercialId;
  const before = state.commercialOwners[cid]?.owner ?? 0;
  const after = reowned.commercialOwners[cid]?.owner ?? 0;
  if (after === before) return reowned;
  const type = topo.commercials?.find((x) => x.id === cid)?.type;
  return appendFreshNotice(reowned, {
    key: type === INDUSTRY.sect ? 'shares.becameBoss' : 'shares.becameChairman',
    args: [],
  });
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
  const victory = checkVictory(
    state.players, wealthOf, state.winConditions, totalDays, state.humanPlayers,
  );
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
  //   ★ 休市日（星期日、節日、**新聞 26 的全股市暂停**）当天**不走行情**
  //   ⚠️ 这里读的是**推进过倒数之后**的 `market.closedDays`（`0041cff9` 那一段就在
  //     `tickStockCountdowns` 里）—— 与原版的先后次序一致。
  if (marketOpenOn(state.globalMapId, date.year, date.month, date.day, market.closedDays)) {
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
  // ★ 开奖屏要显示的「本期号码」—— 只有 core 知道（见 `GameState.lastLotteryDraw`）
  let lotteryHint: LotteryDrawHint | null = null;
  if (date.day === LOTTERY_DRAW_DAY) {
    const draw = drawLottery(lottery, pool, rng);
    // @source 0x00431729 `cmp eax,0x24 / je` —— 一张票都没卖出去就不开屏，也就没有号码可显示
    if (draw.number !== null) {
      lotteryHint = { number: draw.number, winner: draw.winner, pool, sold: [...lottery] };
    }
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
    // 纯表现提示：只在开了奖的那一天写（其余日子沿用，`reduce` 出口会把旧的清掉）
    ...(lotteryHint !== null ? { lastLotteryDraw: lotteryHint } : {}),
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

/**
 * 「挂着一场拍卖，而当前玩家已经出局」—— 这种局面**没人会去答竞价**。
 *
 * ★ `autoAction` 不认竞价（它只负责把出局者的回合推走），而真人那块竞价屏
 *   （`client/auction-screen.ts`）属于**当前玩家**的回合、不会为出局者出现。
 *   破产清算开的那几场拍卖正好落在这个缝里 —— 破产者当场出局，却还是
 *   `currentPlayer`。实测：种子 42 第 1236 回合整局停在 `awaitingDecision`。
 *
 * 调用方（AI 调度 `client/main.ts`、无头驱动）据此判断「该不该替在场的电脑
 * 座位举牌」：是 → 照常去问 `decideAction`；不是 → 让位给竞价屏。
 */
export function orphanedAuction(state: GameState): boolean {
  const me = state.players[state.currentPlayer];
  if (me !== undefined && isAlive(me)) return false;
  const p = state.pending;
  return p !== null && p.kind === 'auction' && 'seat' in p;
}

/**
 * 轮转到下一个在场玩家；无人在场时保持原样。
 *
 * @source `0x418f93`..`0x418fec` 那条游标：
 * ```asm
 * 00418ff5  cmp  byte [player + 0x496b7d], 0   ; whoPlays
 * 00418ffc  jne  0x419008                      ; != 0 → 收下这一位
 * 00418ffe  cmp  word [player + 0x496b70], 0   ; xpos
 * 00419006  jne  0x418f95                      ; ★ whoPlays==0 且 xpos!=0 → 跳过
 * ```
 * ⚠️ 原版这条判据**不是**"whoPlays==0 就跳过"：还要 `xpos != 0`。
 * `whoPlays==0 且 xpos==0` 的玩家**会被收下**，不过紧随其后的 `0x41c84f`
 * 开头就有 `cmp whoPlays,0 / je 返回`，对他们什么也不会发生
 * ⇒ 本引擎简化成"跳过所有出局者"，可观测结果一致。
 * 通道 2 证据：`rich4-spec/tests/test_turn_cursor.py`（31/31）。
 */
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
    // ★★ 2026-09-19 修（§7.141，通道 2 `test_event_dispatch.py` 259/259 的 D1）：
    //   原版 `@source 0x0044bb4b` 的 id 33..36 读的是 `word[0x4991b6]` = **关卡高半部**
    //   （`global_map_id = [0x4991b6]*4 + [0x4991b8]`，见 `map-format.md`）。
    //   先前**写死 0** ⇒ 在地图 4..7 上复刻会抽到原版**永不抽**的命運 33..36
    //   （坐牢 3/5/7/9 天）—— 玩家可能因原版不会发生的事件坐牢。
    gameStage: state.globalMapId >> 2,
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
  // ★★ 只有 `50 < 加持值 ≤ 100` 这一档才掷一次 `rand() & 1`。
  //   @source `0x44b8c1` 的分档：`cmp si,0x64 / jle 查50`（>100 直接定档、**不掷**）
  //   → `cmp si,0x32 / jle 查负`（≤50 也**不掷**）→ 只有落在中间才 `call 0x456f2d`。
  //   ⚠️ 先前这里**无条件** `rng.next()`：于是每一次带神明加持的命運事件都会让
  //      随机序列多走一步（`rngState` 又写回了状态）⇒ 之后所有随机事件整体错位。
  //      这正是本文件第 8/9/10 条修过的同一类错误（簇 C）。
  let blessLevel = 0;
  if (blessKind !== undefined) {
    // ★ 门槛与「按需掷一次」都收在 `blessingLevelWithDraw` 里（唯一一份）——
    //   先前这里自己写了一遍 `> 50 && <= 100`，与 `rules/blessing.ts` 的
    //    `blessingLevel` 是**两份门槛**，任一处改动都会悄悄分叉。
    blessLevel = blessingLevelWithDraw(me, blessKind, () => rng.next() & 1);
  }

  const out = applyFortuneEffect(effectiveId, {
    players: withDeck.players,
    currentPlayer: withDeck.currentPlayer,
    // ★ 首次关押要传送到监狱／医院格 + 跟班搬家（`send_to_prison` 函数体内的事），
    //   屏幕坐标取特殊景观记录（綠島／醫院大樓）
    objects: withDeck.objects,
    nodes: topo.nodes,
    landscapes: topo.landscapes,
    priceIndex: withDeck.priceIndex,
    pool: withDeck.pool,
    // ★★ 2026 本轮：**两张表都传** —— 先前这里无条件传 `prisonOccupancy`，
    //   于是「命運 住院」把病人记进了**监狱**表（`0x496b30`），医院表永远空着。
    //   与 `news-effects.ts` 2026-09-17 修的是同一个错（那边叫"单一 occupancy"）。
    prisonOccupancy: withDeck.prisonOccupancy,
    hospitalOccupancy: withDeck.hospitalOccupancy,
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
    // 事件 5「生日收卡」在电脑那一支要随机抽一张（走同一条 rng，rngState 已在下面写回）
    rng,
    // ★★ 第九份 #6：事件 0/1（強制拆除 / 強制徵收）要按 owner + level 逐块筛候选。
    //   ⚠️⚠️ 这里**必须**传**运行时**地块表（`allEffectiveLands`），不能传 `topo.lands` ——
    //   `topo.lands` 是 `map.mkf` 解出来的**静态模板**，`owner` / `level` **恒为 0**
    //   （8 张图实测：`owner != 0` 0 块、`level != 0` 0 块），
    //   而 `applyFortuneEffect` 正是用这两个字段筛候选 ⇒ 候选恒空 ⇒ 恒 `unimplemented`、
    //   恒 `demolished: null` ⇒ **事件 0/1 在真机上永远不生效**（第十一份回报 #5/#19 查出来的）。
    //   注意 `checkFortune`（可行性判定）那边用的是 `state.landOwner/landLevel`，
    //   先前这里用了静态模板 ⇒ **判定与生效读的是两份地权数据**。单测因为喂了带运行时值的
    //   合成地块表所以没抓住 —— 见 `fortune-demolish.test.ts` 新增的那条闸。
    lands: allEffectiveLands(withDeck, topo),
  });

  // ★ 第十四份：命運 9 / 10 / 11 / 32 施加完（没被神明挡掉）当前玩家说的那一句 —— 角色台词表的事件号。
  //   @source 9 `0x0044ca1f mov ecx,[… + 0x48085e]`（事件 5）→ `0x0044ca30 call 0x44ef41`；
  //   10 `0x0044cb28 call rand / and eax,1` → `0x0044cb30 mov edi,[… + eax*4 + 0x480856]`（事件 3|4）→ `0x0044cb41`；
  //   11 `0x0044cc36 mov ebp,[… + 0x480856]`（事件 3）→ `0x0044cc41`；
  //   32 `0x0044d76c mov esi,[… + 0x480856]`（事件 3）→ `0x0044d777`。
  //   10 那一次 `rand()` 走的是同一个发生器（`0x456f2d`）⇒ 在这里掷，所有客户端一致。
  const fortuneLine = out.cancelled || out.unimplemented ? undefined : FORTUNE_LINE_EVENT.get(effectiveId);
  const phraseIndex =
    fortuneLine === undefined ? undefined : effectiveId === FORTUNE_MOTORBIKE_STOLEN ? 3 + (rng.next() & 1) : fortuneLine;
  // ★ 第十四份：命運 6/7 真的把人送走了（`fcn_0040d375` 首次那一支）⇒ `0x0040d3f8` 那一句（同一个发生器）
  const awayEntry = fortuneEvent(effectiveId);
  const awayVictim =
    awayEntry !== undefined && awayEntry.effects.includes('disappear') && !out.cancelled && !out.unimplemented && out.amount > 0
      ? (out.fortuneVictim ?? withDeck.currentPlayer)
      : null;
  const awaySay = awayVictim === null ? null : disappearSay(awayVictim, out.amount, rng);

  let applied: GameState = {
    ...withDeck,
    rngState: rng.getState(),
    players: out.players,
    pool: out.pool,
    // ★ 跟班物件表可能被「首次关押」搬过（`0x40fc00`）
    objects: out.objects,
    prisonOccupancy: out.prisonOccupancy,
    hospitalOccupancy: out.hospitalOccupancy,
    lastEvent: { kind: 'fortune', id: effectiveId, ...(phraseIndex === undefined ? {} : { phraseIndex }) },
    ...(awaySay === null ? {} : { lastDisappearSay: awaySay }),
  };
  // ★ 第十四份：神明加持那一扇（`fcn_0044b896` 返回 1/2 时调用方弹 `[0x48c5b8]`，1500 ms）——
  //   施加阶段的第一件事（在付款 / 入獄之前）。`%s` = `[0x47ed76 + god_info*4]`。
  const blessEntry = fortuneEvent(effectiveId);
  if (blessKind !== undefined && blessEntry !== undefined && me !== undefined) {
    const blessNotice = fortuneBlessingNotice(
      effectiveId,
      blessKind,
      blessLevel,
      OBJECT_NAMES[me.godInfo] ?? '',
      withDeck.currentPlayer,
      // 免付那一句用的是**没乘倍率**的原额 `[0x48c5b4]`（`0x0044d01b mov ebp,[0x48c5b4]`）
      blessEntry.factor === null ? 0 : eventAmount(blessEntry, withDeck.priceIndex),
    );
    if (blessNotice !== null) applied = appendFreshNotice(applied, blessNotice);
  }

  // ★★ 第 160 条：**命運 `pay` 支的破产结算**（README §7.142(5) 的 E3）。
  //   @source `0x44cec2 call 0x41d2c6`（`pay_money`：现金 → 存款 → **破产**），
  //   紧接 `0x44ced1 mov al,[player+0x15] / test al,al / je 尾声`：
  //   一旦两个口袋都掏空，`0x40cd87` 当场把 `who_plays` 清 0，回到事件后
  //   **跳过第二句台词与整段理赔**（`0x44cf11 call 0x44ba63`）——
  //   即「付不出 ⇒ 出局、一分不赔」，「截断实付额」与「意外理赔」在原版里
  //   **永远不会同时发生**。
  //   ⚠️ 复刻先前只把 `out.bankrupted` 算出来（`fortune-effects.ts:587`）
  //   却**从无人读**，于是变成「付多少赔多少、还活着」。
  //   也正因为有这条早退，下面理赔用的 `out.amount`（= 实付额）在「能理赔」
  //   的那条路上**恒等于请求额 `[0x48c5b4]`** —— 与 `0x44cf11` 的口径一致。
  if (out.bankrupted) {
    return applyBankruptcy(applied, withDeck.currentPlayer, topo);
  }
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
  // ★★ 第九份試玩回報 #6：事件 0/1 拆掉 / 征收掉的那一块写回。
  //   `level` 与 `type` 一起清 0，**owner 不动**（原版 `0x0044bf3e` / `0x0044bf42`：
  //   `mov byte [ebx+0x1a],0` / `mov byte [ebx+0x18],0`，`+0x19` 一个字都不碰）。
  //   同时把镜头交给表现层：`lastViewTarget` 是「只活一条 action」的瞬态提示，
  //   客户端 `syncViewTarget()` 会居中、演出收完自动复位
  //   —— 对应原版 `0x0044bee8 call 0x41d476(x, y, 2)` 与 `0x0044bf51` 的复位。
  if (out.demolished !== null) {
    const { landId, x, y } = out.demolished;
    const landLevel = [...applied.landLevel];
    const landType = [...applied.landType];
    landLevel[landId] = 0;
    landType[landId] = 0;
    applied = { ...applied, landLevel, landType, lastViewTarget: { x, y } };
  }
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
          i === applied.currentPlayer ? { ...p, points: addPoints(p.points, out.points) } : p,
        ),
      };
    }
  }
  // ★ 事件 8/9 尾巴的特別融資收回：`push 0 / call 0x436b0a`
  if (out.recallFinance) applied = sweepSpecialFinance(applied, topo);
  // ★ 2026-09-23：生日收卡（电脑寿星）每收一张弹一扇「搶得%s的\n\n%s」（`fcn_0044192a` 电脑支 `0x00441ab1`）
  for (const rb of out.robbed ?? []) {
    applied = appendFreshNotice(applied, { key: 'card.robbed', args: [playerName(applied, rb.victim), cardNameOf(rb.card)] });
  }
  // ★ 保險理賠的三处命運调用点：坐牢/住院走 send_to_*（0x0043d749 / 0x0043edf8）；
  //   「冒貸」（id 2，0x0044c218）与**命運罰款共用尾巴**（0x0044cf11）直接赔金额。
  // ★★ 第十四份試玩回報 #1：`0x0044cf11` 不只「行人闖越馬路罰款」（14）一条 ——
  //   14/15/16/17/18/19/23/24/26/30 十条都落在同一条尾巴上（`FORTUNE_PAY_TAIL_IDS`）。
  const entry = fortuneEvent(effectiveId);
  if (entry !== undefined && !out.unimplemented) {
    const me = withDeck.currentPlayer;
    if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
      // ★★ 2026-09-19：关的可能是**替死鬼**（`0x441210` 的嫁禍 19 支），
      //   而保險理赔在 `send_to_prison`/`send_to_hospital` **函数体内**
      //   （`0x43d749` / `0x43edf8` 的 `call 0x44ba63`）—— **关谁赔谁**。
      //   免罪 21 命中时 `fortuneVictim` 是 null（整条作废、没关人、也没得赔）。
      //   与新聞 29 的 `out.chairmanPrison.victim` 同一口径。
      const victim = out.fortuneVictim ?? me;
      applied = insureConfinement(applied, topo, victim, out.amount);
    } else if (awayVictim !== null) {
      // ★ 第十四份：出國 / 綁架同样理赔（`0x0040d425 call 0x44ba63(玩家, 2000×天×物價, 0)`，在 `0x40d375` 里）
      applied = insureConfinement(applied, topo, awayVictim, out.amount);
    } else if (entry.effects.includes('loan') || FORTUNE_PAY_TAIL_IDS.has(effectiveId)) {
      // ★ 命運「冒貸」：`0x0044c1fa add [player+0x24], edx` 紧接着 `0x0044c201 call 0x433b7e` 定还款日
      //   （神明作廢那一支 `0x0044c194 jne` 之前就 `jmp 0x44c220`，碰不到这两句 ⇒ 看贷款真的变了没有）
      const before = withDeck.players[me];
      const after = applied.players[me];
      if (entry.effects.includes('loan') && before !== undefined && after !== undefined && after.loan !== before.loan) {
        const dated = withLoanDueDate(after, applied, applied.globalMapId);
        applied = withPlayer(applied, me, (p) => {
          p.loanDueDate = dated.loanDueDate;
        });
      }
      applied = insurancePayoutTo(applied, topo, me, out.amount);
    }
    // ★ 第十四份：「進帳」那一族没被作廢 ⇒ `0x0044d334 call 0x44f354(当前玩家, 金额)`（6/7/8）
    if (FORTUNE_GIVE_TAIL_IDS.has(effectiveId) && out.amount > 0) {
      applied = { ...applied, lastGainSays: [{ player: me, amount: out.amount }] };
    }
  }
  // ★ 命運 5 生日收卡：寿星是真人 ⇒ 效果**一位都没收**，把座位挂成待决交互，
  //   由客户端逐个开选牌窗（T-055）。电脑寿星那一支在上面已经当场收完了。
  if (out.birthdaySeats !== null) {
    applied = {
      ...applied,
      pending: { kind: 'birthdayCard', seats: out.birthdaySeats },
      // ★ 与其它待决交互同一个阶段（`awaitingDecision`）—— 否则 `endTurn`
      //   会在真人还没挑之前把这一回合推走（`endTurn` 只查相位与惡人段）。
      phase: 'awaitingDecision',
    };
  }
  return applied;
}

/**
 * 命運 5 生日收卡：真人挑完一位（T-055）。
 *
 * @source `fcn_0044c3b7` 的循环体（`rich4_fortune.asm:541` 起）——
 *   `fcn_0044192a` 返回之后**调用方不看返回值**，一律 `mov edi, ebp`（计数 +1）
 *   再 `inc ebx` 走下一位 ⇒ **取消（右键，返回 0）也要推进**，只是这位不交牌。
 *
 * 落码走 `applyRobCardCard`（= `consume_card(对方)` + `receive_card(自己)`，0x441343 / 0x4412e4）
 * —— 与搶奪卡卡片路径**同一个** exe 组合；满手时先弃最便宜的一张由 `giveCard` 管。
 *
 * 只认队首：`seat !== pending.seats[0]` 一律原样返回（陈旧 / 乱序的答复不动状态）。
 */
function answerBirthdayCard(state: GameState, seat: number, cardId: number): GameState {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'birthdayCard') return state;
  if (pending.seats[0] !== seat) return state;
  let players = state.players;
  // `cardId = 0` = 取消（跳过这位，不交牌）；卡已经不在手上也当跳过
  if (cardId > 0) {
    const r = applyRobCardCard(players, state.currentPlayer, seat, cardId);
    if (r.ok) players = r.players;
  }
  const rest = pending.seats.slice(1);
  // ★ 最后一位答完要把相位放回 `turnEnd` —— 否则 `endTurn`（它只认这一相位）
  //   永远轮不到，回合卡死在这里。
  if (rest.length === 0) return { ...state, players, pending: null, phase: 'turnEnd' };
  return { ...state, players, pending: { kind: 'birthdayCard', seats: rest } };
}

/**
 * 抽一张新聞事件并施加。
 *
 * ⚠️ 与命運的关键差别：新聞的**受影响者未必是抽牌人**
 * （「表揚第一大地主」的受益者是地主）。谁符合条件属于**选择**，
 * 此处按事件语义现场挑；尚不能判定的事件由 applyNewsEffect
 * 标记 unimplemented，状态不变。
 */
/** 第十四份：命運 9 / 10 / 11 / 32 施加后那一句的事件号（10 是 3|4 二选一，见 `drawAndApplyFortune`）*/
const FORTUNE_LINE_EVENT: ReadonlyMap<number, number> = new Map([[9, 5], [10, 3], [11, 3], [32, 3]]);
const FORTUNE_MOTORBIKE_STOLEN = 10;

/** 新聞「公開表揚 / 補助」那三条（8/9/10）—— 受奖人说進帳台词，见 `drawAndApplyNews` */
const NEWS_AWARD_IDS: ReadonlySet<number> = new Set([8, 9, 10]);

function drawAndApplyNews(state: GameState, topo: MapTopology, rng?: WatcomRng): GameState {
  const lands = allEffectiveLands(state, topo);
  // ★★ 2026-09-19 修（§7.141，通道 2 `test_event_dispatch.py` 259/259 的 D2–D5）：
  //   先前这里给「設施 / 持股 / 企業 / 停牌」全传了空数组、`checkCommercialOwner` 恒 false
  //   ⇒ **新聞 4/5/15、7、8/9/12、10/13、28、29、35 这几条永远抽不到**
  //   （判据函数本身是对的，错在传给它的 ctx）。下面按原版的判据逐项接上真数据。
  const facilities = allEffectiveFacilities(state, topo);
  const draw = drawEvent(state.newsDeck, (id) =>
    isNewsFeasible(id, {
      players: state.players,
      lands,
      facilities,
      // @source 新聞 10/13：`0x4971a0 + cur*0x60 + i*8` 的持股（只读 +0 = 股数）
      stockAmount: state.holdings.map((row) => row.map((h) => h.amount)),
      // @source 新聞 29/35：企業表 `[0x498e7c]`+i*0x34 的 owner(+0x18) / funds(+0x28)
      // ★★ 2026-09 本轮订正：`owner` 是**运行时**字段 —— 地图模板里的 `+0x18`
      //   恒为 0，真实归属住在 `state.commercialOwners[i].owner`（只有存档自带的
      //   地图块才会把归属写回模板，见 `loaders/map-state.ts`）。
      //   先前这里直接读 `c.owner`（模板值，恒 0）⇒ `isNewsFeasible(29)` **恒 false**
      //   —— 新聞 29 的判据（`commercials.some(c => c.owner !== 0 && …)`）永远不成立，
      //   那条新闻从来抽不到。按运行时表取归属后它才真的能出现。
      commercials: (topo.commercials ?? []).map((c) => ({
        owner: state.commercialOwners[c.id]?.owner ?? c.owner,
        // ★★ 第 160 条续：`+0x28`（企業资金）也**是运行时字段**。
        //   `new-game.ts` 把 `companyFunds` 全部初始化为 0（地图模板里的 `+0x28`
        //   也是 0）⇒ 先前读模板值让 `isNewsFeasible(35)` 的
        //   `dword[com+0x28] > 10000`（@source `0x44b5f5` 的判据）**恒 false**，
        //   新闻 35「%s獲利調高一倍」从来抽不到。
        //   ★ 效果侧本来就读运行时表（`news-effects.ts` 的 `funds[c.id]`），
        //   只有这一处判据在读模板 —— 两边现在同源。
        field0x28: state.companyFunds[c.id] ?? c.funds,
      })),
      // @source 新聞 28：`byte[i*36 + 0x496986]` = stock_info.f6（停牌天数）
      stockF6: state.market.stocks.map((s) => s.f6),
      // ★ 新闻的前置条件只看**槽 0..3（玩家）** —— 原版是 `cmp dword [0x496b30], 0`
      //   一次比 4 字节（@source 0x00448c99），与落点的 8 槽扫描**不同**。
      //   见 rules/confinement.ts 的 anyPlayerConfined。
      prisonOccupied: anyPlayerConfined(state.prisonOccupancy) ? 1 : 0,
      hospitalOccupied: anyPlayerConfined(state.hospitalOccupancy) ? 1 : 0,
      // @source `fcn_0040d73f(owner-1)`：`whoPlays(+0x15) != 0`（**整字节**）
      //   且 `dword[+0x32] == 0`（住店/消失/坐牢/住院四项全 0）才算「能当董事長」。
      checkCommercialOwner: (i) => {
        const p = state.players[i];
        if (p === undefined || p.whoPlays === 0) return false;
        const b = p.blocking;
        return (b.inHotel | b.disappearing | b.inPrison | b.inHospital) === 0;
      },
    }),
  );
  const withDeck: GameState = { ...state, newsDeck: draw.deck };
  if (draw.eventId < 0) return withDeck;

  const affected = newsTargets(draw.eventId, withDeck, lands, facilities);
  const out = applyNewsEffect(draw.eventId, {
    players: withDeck.players,
    affected,
    priceIndex: withDeck.priceIndex,
    pool: withDeck.pool,
    // ★ 首次关押要传送到监狱／医院格 + 跟班搬家（`send_to_prison` 函数体内的事），
    //   屏幕坐标取特殊景观记录（綠島／醫院大樓）
    objects: withDeck.objects,
    nodes: topo.nodes,
    landscapes: topo.landscapes,
    // ★ 两张占用表分开传：`prison` 效果写 `0x496b30`、`hospital` 写 `0x496b60`
    //   （先前一律传监狱表 ⇒ 新聞 4「外星人攻打地球」把住院的人记进监狱表）
    prisonOccupancy: withDeck.prisonOccupancy,
    hospitalOccupancy: withDeck.hospitalOccupancy,
    // 百分比类（11 所得稅 / 12 地價稅 / 13 證交稅 / 23 儲金紅利）要的三样
    lands,
    facilities,
    holdings: withDeck.holdings.map((row) => row.map((h) => h.amount)),
    prices: withDeck.market.stocks.map((st) => st.price),
    // 新聞 24/25/26/27/28 会改行情（`newsFlag` / `closedDays` / 停牌）
    market: withDeck.market,
    // 新聞 30..35 要按企業取股票下标、并改两张盈余表
    // ★ 新聞 29 还要 `+0x18` 的**运行时**归属（挑有主企業）—— 同 `isNewsFeasible`
    //   那一处：地图模板的 `owner` 恒 0，真值在 `state.commercialOwners`。
    commercials: (topo.commercials ?? []).map((c) => ({
      ...c,
      owner: withDeck.commercialOwners[c.id]?.owner ?? c.owner,
    })),
    companyFunds: withDeck.companyFunds,
    companyProfit: withDeck.companyProfit,
    // ★ 新聞 4：被爆风掀掉的座驾要回**全局库存**（`0x40cd07` 那一道，与命運 10/11 同一约定）
    toolStock: withDeck.toolStock,
    ...(rng === undefined ? {} : { rng }),
  });

  let applied: GameState = {
    ...withDeck,
    players: out.players,
    pool: out.pool,
    market: out.market ?? withDeck.market,
    // ★ 跟班物件表可能被「首次关押」搬过（`0x40fc00`）
    objects: out.objects,
    prisonOccupancy: out.prisonOccupancy,
    hospitalOccupancy: out.hospitalOccupancy,
    // ★ 新聞 6/14 改过的地价（只带改动过的那几条，按 id 覆盖）
    landPrice: applyPriceOverrides(withDeck.landPrice ?? [], out.landPrice),
    facilityPrice: applyPriceOverrides(withDeck.facilityPrice ?? [], out.facilityPrice),
    ...applyCompanyMutations(withDeck, out.companyMutations),
    ...applyMutations(withDeck, out),
    // ★ 新聞 4 掀掉的机車/汽車回全局库存（照抄命運那条 `out.toolStock` 的写回）
    ...(out.toolStock === undefined ? {} : { toolStock: out.toolStock }),
    // ★ 百分比类那四条把「先算好」的逐人金额一起带上（表现层要按原版顺序逐行画）
    lastEvent: {
      kind: 'news',
      id: draw.eventId,
      ...(out.shares === undefined ? {} : { shares: out.shares }),
      // ★ 第十二份試玩回報：「龙卷风摧毁房屋没有看到具体哪个房子受影响」——
      //   「随机挑一处建筑」那一族（5 / 15 / 19 / 20 / 21）挑中的是哪一处（地名 / 房主）
      ...(out.place === undefined ? {} : { place: { entity: out.place.entity, owner: out.place.owner } }),
    },
    // ★ 第十四份：新聞 8/9/10 的受奖人 —— 共用尾巴 `0x00449a24`：`0x00449a5c call 0x41d3f4`（进现金）
    //   → `0x00449a80 call 0x44f354([0x48c59c], [0x48c5a0])`（進帳台词 6/7/8）。
    //   入口：8 `0x004498c6` / 9 `0x00449a9d` / 10 `0x00449baf` `jne 0x449a24`。
    ...(NEWS_AWARD_IDS.has(draw.eventId) && !out.unimplemented && affected[0] !== undefined && out.amount > 0
      ? { lastGainSays: [{ player: affected[0], amount: out.amount }] }
      : {}),
  };
  // ★ 同上：镜头移到挑中的那一处 —— 这一族的施加阶段都是
  //   `0x40af12(实体)` 取坐标 → `view_to(x, y, 2)`（flags 无 bit0 ⇒ 真的移镜头），
  //   然后才 `mutate_land` / `damage_area` + 影片：
  //   新聞 5 `0x00449424/0x0044943e`、15 `0x0044a52e`（直接读地块 +0/+2）、
  //   19 `0x0044aa5b/0x0044aa75`、20 `0x0044ac19/0x0044ac33`、21 `0x0044add3/0x0044aded`。
  //   与命運 0 那一支（上面 `out.demolished`）同一条通道：客户端 `syncViewTarget()`
  //   居中、演出收完自动复位（= 原版 `refresh_screen`）。
  if (out.place !== undefined) {
    const vt = entityViewTarget(applied, topo, out.place.entity);
    if (vt !== null) applied = { ...applied, lastViewTarget: vt };
  }
  // 新聞的坐牢/住院也走 send_to_*，保險期内赔 2000×天×物價
  const entry = newsEvent(draw.eventId);
  if (entry !== undefined && !out.unimplemented && (entry.effects.includes('prison') || entry.effects.includes('hospital'))) {
    for (const who of newsTargets(draw.eventId, withDeck, lands, allEffectiveFacilities(state, topo))) {
      applied = insureConfinement(applied, topo, who, out.amount);
    }
  }
  // ★ 新聞 29「違法超貸」：真正被关的是**效果层随机抽出来、再过了免罪/嫁禍**的那位
  //   （`NewsEffectResult.chairmanPrison`），保险理赔照走 `send_to_prison` 函数体内的
  //   `0x43edf8 call 0x44ba63`（关谁赔谁）。
  //   ⚠️ 上面那个循环的 `newsTargets(29, …)` 会给**抽牌者**理赔 —— 与 29 的实际受害者
  //     毫无关系。29 现在记作 `companyChairmanPrison`（不再是 `prison`），自然不进那个
  //     循环，理赔只走这一支。天数用效果层带出来的 `days`（= 5）。
  if (!out.unimplemented && out.chairmanPrison !== undefined) {
    applied = insureConfinement(applied, topo, out.chairmanPrison.victim, out.chairmanPrison.days);
  }
  // ★ 新聞 4「外星人攻打地球」：被爆心扫到而住院的人也要走 `0x43ec3f` 函数体内的
  //   `0x43edf8 call 0x44ba63`（保險理赔）—— 名单由效果层带出，天数是常量 3。
  if (entry !== undefined && !out.unimplemented && out.blastedHospital !== undefined) {
    for (const who of out.blastedHospital) {
      applied = insureConfinement(applied, topo, who, ALIEN_HOSPITAL_DAYS);
    }
  }
  // 新聞 7「公開拍賣公有土地一處」：挑中的那处**当场开拍**
  //   @source phase 2 `auction_entry(-1, target, 1)` —— 第一参 −1 = **没有卖家席位**，
  //   故显式传 `seller: -1`（否则 `openAuction` 会把当前行动者当卖家跳过）。
  if (out.publicAuction !== undefined) {
    const { entityId, facility } = out.publicAuction;
    const entity = facility
      ? effectiveFacility(applied, topo, entityId)
      : effectiveLand(applied, topo, entityId);
    if (entity !== null) {
      applied = startAuction(applied, topo, {
        kind: 'auction',
        entityId,
        basePrice: auctionBasePrice(entity, applied.priceIndex),
        // @source 0x44989f 新聞 7「公開拍賣」传 **−1**（没有发起者）⇒ 谁都不排除
        bidders: eligibleBidders(applied.players, entity, -1),
        seller: -1,
        ...(facility ? { facility: true } : {}),
      });
    }
  }
  return applied;
}

/**
 * 把新聞 30..35 的企業盈余改动落到两张表上。
 *   没改动时返回空对象。
 */
function applyCompanyMutations(
  base: GameState,
  mutations: readonly CompanyMutation[] | undefined,
): Partial<GameState> {
  if (mutations === undefined || mutations.length === 0) return {};
  const companyFunds = [...(base.companyFunds ?? [])];
  const companyProfit = [...(base.companyProfit ?? [])];
  for (const m of mutations) {
    companyFunds[m.id] = m.funds;
    companyProfit[m.id] = m.profit;
  }
  return { companyFunds, companyProfit };
}

/**
 * 把新聞的 `mutate_land` 改动（新聞 5/15/19/21）落到状态的四张表上。
 *   没改动时返回空对象（保持 `applied` 的其余字段不变）。
 */
function applyMutations(
  base: GameState,
  out: { landMutations?: readonly LandMutation[]; facilityMutations?: readonly LandMutation[] },
): Partial<GameState> {
  const patch: Partial<GameState> = {};
  if (out.landMutations !== undefined && out.landMutations.length > 0) {
    const level = [...(base.landLevel ?? [])];
    const type = [...(base.landType ?? [])];
    const owner = [...(base.landOwner ?? [])];
    for (const m of out.landMutations) {
      level[m.id] = m.level;
      type[m.id] = m.type;
      owner[m.id] = m.owner;
    }
    patch.landLevel = level;
    patch.landType = type;
    patch.landOwner = owner;
  }
  if (out.facilityMutations !== undefined && out.facilityMutations.length > 0) {
    const level = [...(base.facilityLevel ?? [])];
    const type = [...(base.facilityType ?? [])];
    const owner = [...(base.facilityOwner ?? [])];
    for (const m of out.facilityMutations) {
      level[m.id] = m.level;
      type[m.id] = m.type;
      owner[m.id] = m.owner;
    }
    patch.facilityLevel = level;
    patch.facilityType = type;
    patch.facilityOwner = owner;
  }
  return patch;
}

/**
 * 把「只带改动条目的地价表」覆盖回状态里的地价数组。
 *   `overrides` 为空时**原样返回**（不新建数组，免得每次抽新闻都换引用）。
 */
function applyPriceOverrides(
  base: readonly number[],
  overrides: readonly PriceChange[] | undefined,
): number[] {
  if (overrides === undefined) return [...base];
  const out = [...base];
  // ★ 有序数组（不用 `Object.keys/entries`，见 C-DET-5）
  for (const c of overrides) out[c.id] = c.price;
  return out;
}

/**
 * 新聞事件的受影响者。
 *
 * @source 文案里的 `%s` 指明了对象：
 *   8「第一大地主」/ 9「土地最少者」/ 10「股市第一大戶」
 * 其余按抽牌人处理。
 *
 * ⚠️ **例外**：29「違法超貸」的目标是**随机抽中的那家企業的經營者**，这里返回空表
 *   （见下方 `case 29`）。它的目标是 `applyNewsEffect` 内部抽的，`affected` 不参与
 *   —— 因为抽那个人**要消耗一次 `rand()`**，只能由效果层（能拿到 PRNG 的那一层）做。
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
    // ★★ 2026-09-19 修：新聞 10「公開表揚股市第一大戶 %s獲得%d元獎勵」——
    //   `%s` 是**持股市值（股数）最多**的那位，**不是抽牌者**。
    //   先前这一档没有 case，落到 `default` ⇒ 奖金发给了抽到新闻的人
    //   （表现层还会把 `%s` 填成抽牌者的名字）。
    //   @source `fcn_00449b9c`：
    // ```asm
    // 00449bd6  mov  eax, esi / shl eax,2 / sub eax,esi / shl eax,5  ; player*0x60
    // 00449be2  mov  eax, dword ptr [eax + ebx*8 + 0x4971a0]         ; ★ 第 ebx 支的**股数**
    // 00449be9  add  dword ptr [esp + esi*4 + 0x94], eax             ; 累加到该玩家
    // 00449bf1  cmp  ecx, 0xc / jl 0x449bd6                          ; ebx = 0..11
    // 00449c05  imul eax, esi, 0x68
    // 00449c08  cmp  byte ptr [eax + 0x496b7d], 0                    ; ★ 出局者不参评
    // 00449c0f  je   0x449c29
    // 00449c1d  cmp  ecx, ebx / 00449c1f jge 0x449c29                ; 严格 `>` 才更新
    // 00449c21  mov  ecx, ebx / mov dword ptr [0x48c59c], esi        ; ⇒ 并列取**第一个**
    // ```
    //   ⚠️ 奖金额仍是 `10000 * 物價指數`（`0x00449c4a` 的移位序列），
    //   发放走 news[8] 的收尾（`0x00449c77 jmp 0x4499c1` ⇒ pass 1 才 `add_money`）。
    case 10: {
      // 股市第一大户：12 支**股数**之和最大者（并列取第一个）
      let best = alive[0]!;
      let bestHeld = -1;
      for (const i of alive) {
        const held = (state.holdings[i] ?? []).reduce((s, h) => s + h.amount, 0);
        if (held > bestHeld) {
          bestHeld = held;
          best = i;
        }
      }
      return [best];
    }
    // ★ 「所有人」那一类：11 所得稅 / 12 地價稅 / 13 證交稅。
    //   原版这三支都是**两层循环扫全部玩家**，且跳过出局者
    //   （`cmp byte [player+0x15], 0 / je`）—— 与 `alive` 同一个口径。
    case 11:
    case 12:
    case 13:
      return alive;
    // ★ 23 儲金紅利**不是**「所有人」：原版那一支的循环里多一道闸 ——
    //   有贷款的人**不发**。@source `fcn_0044aedb`：
    // ```asm
    // 0044af26  imul ebx, esi, 0x68
    // 0044af29  cmp  byte ptr [ebx + 0x496b7d], 0   ; 出局跳过
    // 0044af30  je   0x44b004
    // 0044af36  mov  ebp, dword ptr [ebx + 0x496b8c] ; ★ +0x24 = loan
    // 0044af3c  test ebp, ebp
    // 0044af3e  jne  0x44b004                        ; ★ 有贷款 → 跳过（不发也不画那一行）
    // 0044af44  fild dword ptr [ebx + 0x496b88]      ; 存款 ×0.1（常量 0x465734 = 0.1）
    // 0044af5c  push ebp（= 0） / 0044af66 call 0x41d3f4   ; flags 0 ⇒ 进存款
    // ```
    case 23:
      return alive.filter((i) => (state.players[i]?.loan ?? 0) === 0);
    // ★ 2026-09 本轮：新聞 29「違法超貸」的目標**不由這裡挑** —— 它是在企業表裡
    //   隨機抽一家有主企業（**要消耗一次 `rand()`**），再走免罪(21)→嫁禍(19) 二級判定，
    //   整條住在 `events/news-effects.ts` 的 `companyChairmanPrison` 那一支。
    //   這裡返回空表是**刻意的**：免得將來有人把 `affected` 接到那條路上，把
    //   「隨機抽中的經營者」變成「抽牌者」—— 那是**比 no-op 更糟**的結果
    //   （原版那張新聞從來不關抽牌者）。
    case 29:
      return [];
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
 * 走子途中**经过**銀行格（第八份试玩回报 #4）—— 原版走子每到一格都调 `fcn_0041b42d`，其中：
 * ```asm
 * 0041b53f  cmp dword [esp+0xa0], 0xe          ; 这一格的特殊種類 = 14 銀行
 * 0041b550  cmp byte [player+0x37], 0 / jne    ; 夢遊中不弹
 * 0041b55d  cmp dword [0x48baf8], 0 / je       ; ★ 还有步数才算「路过」（落点走 0x41b3af 那一支）
 * 0041b56a  cmp dword [esp+0x9c], 0x10 / je    ; 格上的物件是路障（16）⇒ 不弹（人会被拦下）
 * 0041b5ab  call 0x4379c9                       ; ATM 入口：拒絕往來 → 框；真人 → ATM 窗；电脑 → 按 cashRatio 重分
 * ```
 * 之后**接着**走乞丐 / 物件那一段（`0x41b5bd` 起）—— 本函数只做 ATM 这一层。
 */
function passingBank(state: GameState, topo: MapTopology): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return state;
  const node = topo.nodes[me.nodeId - 1];
  if (node === undefined || node.specialKind !== SPECIAL_KIND.BANK) return state;
  if (me.blocking.sleepWalking !== 0) return state;
  if (state.stepsRemaining <= 0) return state;
  const handle = objectHandleAt(state, me.nodeId);
  if (handle !== 0 && state.objects[handle - 1]?.type === OBJECT_TYPE_ROADBLOCK) return state;
  return bankAtmEntry(state, false);
}

/**
 * **ATM 入口** `fcn_004379c9`（`_rich4_ui_bank_atm_entry`）—— 路过（`0x0041b5ab`）与落点（`0x0041b396`）
 * 共用的那一个函数。三支：
 * ```asm
 * 004379da  mov  ah, [player+0x3b] / test ah,ah / je 0x437a18   ; 拒絕往來？
 * 004379e6  and  al, 0x7f / … / inc eax                          ; ★ 天数 = (+0x3b & 0x7f) + 1
 * 004379ef  push 0x464bed / … / push 0x3e8 / call 0x440cac       ; 訊息框 1000 ms，然后返回
 * 00437a18  mov  cl, [player+0x15] / cmp cl,1 / jne 0x437acd      ; **恰好** who_plays == 1 的真人
 * 00437a71  push 0x436ef8 / call 0x4018e7                        ; → 模态 ATM 窗（办一笔或关窗就返回）
 * 00437acd  …                                                    ; 其余 → 按 cashRatio 重分現金/存款
 * ```
 * ATM 窗 `0x401`（`0x00436fdd`）：`+0x3c`（銀行暫停放款）!= 0 ⇒ `PostMessage(0x408)`，
 * 那一支弹「銀行暫停放款\n\n還剩%d天！」（`0x464bd4`，1500 ms）盖在 ATM 上 ⇒ 与 pending 同一条 action 交出去。
 *
 * @param landing 落点那台（关掉之后接着进貸款屏）；`false` = 路过那台
 */
function bankAtmEntry(state: GameState, landing: boolean): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return state;
  if (me.daysRejectedByBank !== 0) {
    return {
      ...state,
      notices: [{ key: 'bank.rejected', args: [displayRemainingDays(me.daysRejectedByBank)], holdMs: 1000 }],
    };
  }
  if ((me.whoPlays & 0xff) === WHO_PLAYS_HUMAN) {
    const opened: GameState = { ...state, pending: landing ? { kind: 'atm', landing: true } : { kind: 'atm' } };
    if (me.bankFreezeDays === 0) return opened;
    return { ...opened, notices: [{ key: 'bank.frozen', args: [displayRemainingDays(me.bankFreezeDays)] }] };
  }
  return rebalanceBankOnArrival(state);
}

/**
 * 落点那台 ATM 关掉之后 —— 进**貸款屏**（`_rich4_ui_bank_entry` @ 0x436668）。
 *
 * @source `0x0041b39b cmp byte [0x46caf8], 0 / jne 0x41b3d0`：终局码非 0（ATM 里提款触发的
 *   特別融資垫付把人拖破产、刚好分出胜负）就不进；否则 `0x0041b3af call 0x436668` ——
 *   它进门先 `0x0043668f call 0x4239b9` 取**这一刻**的身家快照（`[0x48c3b0]`），所以额度在 ATM 之后才算。
 */
function enterBankRoom(state: GameState, topo: MapTopology): GameState {
  if (state.phase === 'gameOver') return { ...state, pending: null };
  const who = state.players[state.currentPlayer];
  // @source `0x0043667b cmp byte [player+0x3b], 0 / jne 0x436953` —— 拒絕往來期内整个入口直接返回
  if (who === undefined || who.daysRejectedByBank !== 0) return { ...state, pending: null };
  // @source `0x004366a3 cmp byte [player+0x15], 1 / jne 0x4367ab` —— **恰好**真人才开窗；
  //   电脑 / 托管（含 ATM 开着时被托管的真人）当场走电脑那一支，不经 pending（要掷 `rand()`）。
  if ((who.whoPlays & 0xff) !== WHO_PLAYS_HUMAN) return aiBankRoom({ ...state, pending: null }, topo);
  const opened: GameState = { ...state, pending: pendingForSpecial(state, topo, SPECIAL_KIND.BANK) };
  // ★ 2026-09-23：貸款屏开窗那一拍（`0x405`）正暫停放款 ⇒ 先弹「銀行暫停放款\n\n還剩%d天！」，
  //   **整扇右移 100**（`0x800005dc`），然后才是那一句招呼。只有**恰好**真人才开这扇窗
  //   （`0x004366a3 cmp byte [+0x15], 1 / jne` 电脑支）。
  //   @source `0x00435197 cmp byte [player+0x3c], 0 / je 0x435200` → `0x004351ce (+0x3c & 0x7f) + 1` →
  //   `0x004351dc push 0x464ad5` → `0x004351ee push 0x800005dc` → `0x004351f8 call 0x440cac`
  const me = opened.players[opened.currentPlayer];
  if (opened.pending?.kind === 'bank' && me !== undefined && isPlainHuman(me) && me.bankFreezeDays !== 0) {
    return appendFreshNotice(opened, {
      key: 'bank.loanFrozen',
      args: [displayRemainingDays(me.bankFreezeDays)],
      shiftRight: true,
    });
  }
  return opened;
}

/** 某位玩家此刻的全口径身家（`fcn_004239b9`）—— 现金 + 存款 − 贷款 + 持股市值 + 名下地产与設施 */
function fullWealthOf(state: GameState, topo: MapTopology, index: number): number {
  const p = state.players[index];
  if (p === undefined) return 0;
  return calculatePlayerWealth(p, allEffectiveLands(state, topo), allEffectiveFacilities(state, topo), valuationsOf(state, index));
}

/**
 * 电脑的貸款屏 —— `_rich4_ui_bank_entry` 的 `0x004367ab` 那一支（**不开窗**）。
 *
 * @source VA 0x00436668..0x00436953：
 * ```asm
 * 0043668f  call 0x4239b9 → [0x48c3b0]                 ; 身家快照（放款用）
 * 004367ab  cmp [player+0x24], 0 / je 0x436893
 * ; ── 有贷款：要不要全额提前还（判据见 places/bank.ts 的 aiRepaysLoan）──
 * 0043683e  call 0x433bd8(player, loan)                 ; 先存款后现金，打穿即破產
 * 0043685b  push 0x464af5 / … / 0x0043686d push 0x5dc / call 0x440cac   ; 「%s\n\n償還銀行貸款\n\n%d元」
 * 00436888  mov [player+0x24], 0                         ; ★ 只清贷款，**不清** +0x2c 还款日
 * ; ── 没贷款：要不要放款（闸见 aiBorrowGate）──
 * 00436893  call 0x456f2d（rand）…
 * 004368fc  mov [player+0x24], trunc(比例 × 身家 / 100)   ; ★ 赋值
 * 00436902  test eax, eax / je 返回
 * 00436906  add [player+0x20], eax                       ; 进存款
 * 00436912  call 0x433b7e(player)                         ; 定还款日
 * 0043692f  push 0x464b0c / … / 0x00436941 push 0x5dc / call 0x440cac   ; 「%s\n\n向銀行貸款\n\n%d元」
 * ```
 */
function aiBankRoom(state: GameState, topo: MapTopology): GameState {
  const index = state.currentPlayer;
  const me = state.players[index];
  if (me === undefined || !isAlive(me)) return state;

  if (me.loan !== 0) {
    if (!aiRepaysLoan(me, state)) return state;
    const r = payFromBank(me, me.loan);
    let s = withPlayer(state, index, (p) => {
      p.cash = r.player.cash;
      p.moneyInBank = r.player.moneyInBank;
    });
    if (r.bankrupt) s = applyBankruptcy(s, index, topo);
    // @source `0x0043684d mov ecx, [eax + 0x496b8c]` —— 框里的数是 `0x433bd8` **之后**读的贷款字段
    s = appendFreshNotice(s, { key: 'bank.aiRepay', args: [playerName(s, index), s.players[index]?.loan ?? 0] });
    return withPlayer(s, index, (p) => {
      p.loan = 0;
    });
  }

  // @source 0x00436893 —— 这一支才掷 `rand()`
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const roll = rng.next();
  const rolled: GameState = { ...state, rngState: rng.getState() };
  if (!aiBorrowGate(roll, me)) return rolled;
  // @source 0x004368e9 `imul edx, [0x48c3b0]` / `idiv 100`（快照取自 `0x0043668f`）
  const amount = autoLoanAmount(fullWealthOf(state, topo, index), me.loanRatio);
  if (amount === 0) return rolled;
  const borrowed = withLoanDueDate(
    { ...me, loan: amount, moneyInBank: me.moneyInBank + amount },
    state,
    state.globalMapId,
  );
  const s = withPlayer(rolled, index, (p) => {
    p.loan = borrowed.loan;
    p.moneyInBank = borrowed.moneyInBank;
    p.loanDueDate = borrowed.loanDueDate;
  });
  // @source `0x00436921 mov ecx, [eax + 0x496b8c]`（+0x24 = 贷款）
  return appendFreshNotice(s, { key: 'bank.aiBorrow', args: [playerName(s, index), borrowed.loan] });
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
    // @source `0x0043668f call 0x4239b9` → `[0x48c3b0]`：**全口径**身家（现金 + 存款 − 贷款 + 持股 + 地产 + 設施），
    //   与月结/勝負判定同一个函数。先前这里传了空地块表与空持股 ⇒ 额度只算了现金 + 存款 − 贷款。
    const wealth = fullWealthOf(state, topo, state.currentPlayer);
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
    // ★ 2026-09-23：每收回一位先弹两扇（各 1500 ms）：「銀行經營權易主！」→「%s\n\n強制償還%d元\n\n銀行特別融資！」
    //   @source `0x00436cc6 push 0x464b9e` / `0x00436ccb call 0x440cac` →
    //   `0x00436ce1 push 0x464baf`（`%s` = 那人、`%d` = 欠额 `[+0x28]`）/ `0x00436cfd call 0x440cac`
    s = appendFreshNotice(s, { key: 'bank.chairmanChanged', args: [] });
    s = appendFreshNotice(s, { key: 'bank.forcedSpecialRepay', args: [playerName(s, i), p.specialFinance] });
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
    // ★ 類型 2（地產/設施）：把**挂牌那一刻**的 `+0x18`/`+0x1a` 快照进槽
    //   @source 0x00424785 / 0x0042478f —— 原版存的是当时那一份，
    //   挂完之后地主加盖或改建，公佈欄上显示的仍是挂牌时的等级。
    let estate: { estateType: number; estateLevel: number } | null = null;
    if (action.kind === LISTING.estate) {
      const e = decodeEstate(action.id);
      const rec =
        e.kind === 'land'
          ? effectiveLand(state, topo, e.index)
          : effectiveFacility(state, topo, e.index);
      if (rec !== null) estate = { estateType: rec.type, estateLevel: rec.level };
    }
    const col = listItem(mine, {
      kind: action.kind as ListingKind,
      id: action.id,
      price: Math.trunc(action.price),
      amount: Math.trunc(action.amount ?? 0),
      ...(estate ?? {}),
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
  const settled: GameState = {
    ...moved,
    players,
    noticeBoard: moved.noticeBoard.map((c, i) => (i === seller ? (col ?? c) : c)),
  };
  // ★★ 2026 本轮：买**股票**挂牌之后要**重排企业持股名次**。
  //   原版就在这条路上：`0x0042571e call 0x4294d5`
  //   （实参 = `push [槽+0x4967e2]`（股票号）+ `push [0x49910c]`（买家））。
  //   持股从卖家转给买家会改变"谁持股最多"⇒ 企業老闆要跟着换；
  //   此前这条路**一次都没重排**，`commercialOwners` 会一直是旧的。
  return item.kind === LISTING.stock
    ? reownCommercial(settled, item.id, state.currentPlayer)
    : settled;
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
  /**
   * ★★ W-67-a：董事長送出的那一件（`0` = 什么都没送）。
   *
   * @source `_rich4_ui_shop_entry` `0x0042e97d..0x0042ea28`：真的送出去了才
   *   `sprintf(buf, 0x464378, 名字)` → `push 0x5dc / call 0x440cac`（棕色訊息框 1500 ms）
   *   → `call 0x44f230(玩家, 那件的**點數价**)`（「好消息」台词阶梯），
   *   而商店窗是**框之后**才开的（`0x0042ea28` 之后）。
   */
  let gift: { kind: 'tool' | 'card'; id: number; name: string; points: number } | null = null;

  // ① 董事長進門有禮
  if (chairmanOfIndustry(next, topo.commercials, STORE_INDUSTRY) === me) {
    if ((rng.next() & 1) !== 0) {
      // ★★ 2026-09-19 修（§7.142）：空袋**不掷** rand（原版 `0x445b0e je` 在 `call rand` 之前）。
      //   先前 `drawGiftTool(stock, rng.next())` 的实参先求值 ⇒ 库存全空时也推进随机流。
      const toolId = giftToolBagEmpty(next.toolStock) ? 0 : drawGiftTool(next.toolStock, rng.next());
      if (toolId !== 0) {
        const g = giveTool(next.tools, next.toolStock, me, toolId);
        next = { ...next, tools: g.tools, toolStock: g.stock };
        gift = {
          kind: 'tool',
          id: toolId,
          name: TOOLS.find((x) => x.id === toolId)?.name ?? `道具${toolId}`,
          points: toolPrice(toolId),
        };
      }
    } else {
      const cardId = drawRandomCard(rng, next.cardAmount);
      if (cardId !== 0) {
        const cardAmount = [...next.cardAmount];
        cardAmount[cardId - 1] = (cardAmount[cardId - 1] ?? 0) - 1;
        // ★ 同上：满手牌时先丢最便宜的再收（原版统一走 `giveCard` 0x004412e4）
        next = withPlayer({ ...next, cardAmount }, me, (p) => {
          Object.assign(p, giveCard(p, cardId));
        });
        gift = {
          kind: 'card',
          id: cardId,
          name: CARDS.find((c) => c.id === cardId)?.name ?? `卡${cardId}`,
          points: cardPrice(cardId),
        };
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
    // ★★ W-67-a：送成了才有这两样 —— 訊息框（表现层弹）+ 台词用的瞬态提示（`lastShopGift`）。
    //   没送成（库存与牌堆都空）**框和台词都不出**（原版那两支 `je` 直接跳过）。
    ...(gift === null
      ? {}
      : {
          notices: [{ key: 'shop.chairmanGift' as const, args: [gift.name] }],
          lastShopGift: { kind: gift.kind, id: gift.id, points: gift.points },
        }),
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
 * 一次免费加蓋的结果 —— **状态 + `0x40b110` 返回值的那两位**。
 *
 * ★ 原版 `0x40b110` 的返回值被三条支路消费（bit7 → 再接播 0x20b），
 *   所以「新状态」与「bit7」必须一起从加蓋函数里出来，不能再丢。
 *   `source`（谁发起的）由**调用方**补 —— 同一个 `freeBuildFacilityById`
 *   既服务機器工人也服务魔法屋/建設公司，只有调用方知道是哪一条。
 *   见 `state/types.ts` 的 `BuildUpgradeHint` 与 README §7.142(5) E6。
 */
interface FreeBuildOutcome {
  state: GameState;
  /** 被加蓋的实体编码（`0x7d0 + 地块下标` / `0xfa0 + 設施下标`）*/
  entity: number;
  /** `0x40b110` 返回值的 bit7：剛好升到 5 級 */
  reachedMaxLevel: boolean;
}

/** 把 `FreeBuildOutcome` 变成一条提示（补上 source —— 只有调用方知道是谁发起的）*/
function buildHintOf(out: FreeBuildOutcome, source: BuildUpgradeSource): BuildUpgradeHint {
  return { entity: out.entity, reachedMaxLevel: out.reachedMaxLevel, source };
}

/**
 * ★★ 第十五份：**自家**建設公司代蓋 —— 原版蓋**两次**（第一次没到 5 级才蓋第二次）。
 *
 * @source 自家那一支（`0x0041aa3c`，董事長 = 自己）：
 * ```asm
 * 0041aae7  push edi / call 0x40b110          ; 第一次
 * 0041aaf0  mov [esp+0xbc], eax               ; ★ 只存第一次的返回值
 * 0041aaf7  test al, 0x80 / jne 0x41ab04      ; 第一次剛好到 5 ⇒ 不蓋第二次
 * 0041aafb  push edi / call 0x40b110          ; 第二次（返回值丢弃）
 * 0041ab04  … 0x0041ab10 call 0x45144f        ; 大锤 0x229 —— **只播一次**
 * 0041ab21  test byte [esp+0xbc], 0x80 / je   ; 台词（事件 15，`0x0041ab5b`）与 0x20b（`0x0041ab63`）只看**第一次**的 bit7
 * ```
 * 别人的建設公司（`0x0041acd1` 那一支）只蓋一次：`0x0041ad7e call 0x40b110` → `0x0041ad99` 大锤，没有第二次。
 * ⇒ 返回第二次之后的局面，但 `reachedMaxLevel` 取**第一次**的（第二次才到 5 级时既不说也不放烟花）。
 */
function ownCompanyBuild(state: GameState, topo: MapTopology, entity: number): FreeBuildOutcome | null {
  const first = freeBuildEntity(state, topo, entity, -1);
  if (first === null || first.reachedMaxLevel) return first;
  const second = freeBuildEntity(first.state, topo, entity, -1);
  return second === null ? first : { ...second, reachedMaxLevel: first.reachedMaxLevel };
}

/**
 * 本 action 的加蓋事件表**从空开始**。
 *
 * ★★ 这一步**不能省**：`reduce` 里大量 `{ ...state, … }` 会把上一条 action 留下的
 *   提示原样带过来。若直接往上面 append，就会出现
 *   「上一次 4→5 置了 bit7、这一次 2→3 没置 ⇒ 表里两条，而表现层 `some(bit7)`
 *   仍为真 ⇒ **多播一段 0x20b**」这种幽灵播放。
 */
function clearBuildUpgrades(state: GameState): GameState {
  return { ...state, lastBuildUpgrades: [] };
}

/**
 * 把一次加蓋事件**追加**进本 action 的提示表。
 *
 * ★ 追加而不是覆盖：魔法屋那一条 action 里可能有**多位**中签者各蓋一级
 *   （@source `0x004320aa inc edi / cmp edi,4 / jge`），天使卡也可能同區批量。
 *   「本 action」的边界由各 flow 自己立桩 —— 魔法屋在 `runMagicHouse` 入口
 *   写 `lastBuildUpgrades: []`、`playCard` 在装配 `next` 时写 `[]`；
 *   单次加蓋的流程用下面的 `withSingleBuildUpgrade`。
 * ★ 纯表现 —— 不进指纹（`stateFingerprint` 的形参是显式字段表）、不进 history。
 */
function withBuildUpgrade(state: GameState, hint: BuildUpgradeHint): GameState {
  return { ...state, lastBuildUpgrades: [...(state.lastBuildUpgrades ?? []), hint] };
}

/**
 * **单次**加蓋的流程（機器工人 / 建設公司那两条）：先清空再记。
 *
 * ★ 等价于「本 action 恰好一次加蓋」—— 那些调用点各自只产生一轮加蓋事件，
 *   所以不该继承上一条 action 留下的 bit7。
 */
function withSingleBuildUpgrade(state: GameState, hint: BuildUpgradeHint): GameState {
  return withBuildUpgrade(clearBuildUpgrades(state), hint);
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
 * 0040b215    cmp dl, 5 / jne 0x40b21f
 * 0040b21a    mov eax, 0x81                              ; ★★ 等級 ≥ 1 的設施**照样置 bit7**
 *           }
 * ```
 * ★ 与住宅那段一样**不看归属**——给别人的地也盖；只是电脑替别人盖的时候一律盖公園。
 * ★★ 「設施支不置 bit7」是**错的**：只有 `level == 0 → 定种类首建` 那一条
 *   （`0x0040b1f4 mov eax, 1 / inc byte [ebx+0x1a] / ret`）没有 bit7；
 *   等级 ≥ 1 走 `0x0040b1f9` 那一支，到 5 级时是 `mov eax, 0x81`。
 *
 * @param chosenType 真人对等级 0 的設施要给的种类（0..4）；不给就失败（UI 属 P2-14）
 */
function freeBuildFacility(
  state: GameState,
  topo: MapTopology,
  nodeId: number,
  chosenType: number,
): FreeBuildOutcome | null {
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
): FreeBuildOutcome | null {
  const fac = effectiveFacility(state, topo, idx);
  if (fac === null) return null;
  const me = state.currentPlayer;
  const player = state.players[me];
  if (player === undefined) return null;

  const entity = 0xfa0 + idx;
  const facilityLevel = [...state.facilityLevel];
  const facilityType = [...state.facilityType];
  if (fac.level === 0) {
    let type: number;
    let rngState = state.rngState;
    // ★★ 2026-09-19 修（§7.141 E2，通道 2 `test_land_mutation_gates.py` 354/354）：
    //   原版 `0x40b1ad test byte [player + 0x15], 6 / je 真人支` —— 掩码是 **6**
    //   （bit1 电脑 | bit2 托管），**不是** `& 3`。两档因此不同：
    //   `whoPlays = 5`（真人|托管，掉线代打，`actions.ts:237` 可达）原版按**电脑**
    //   规则（随机种类），旧实现走真人支且 `chosenType = -1` ⇒ **蓋不成**；
    //   `whoPlays = 0` 原版走真人支、旧实现走电脑支。
    if ((player.whoPlays & 0x06) !== 0) {
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
    // ★ 首建那一条（0x0040b1f4）**没有** `or al, 0x80` / `mov eax, 0x81`
    //   —— 它 `mov eax, 1 / inc / ret`，所以 bit7 恒为 0。
    return {
      state: { ...state, facilityType, facilityLevel, rngState },
      entity,
      reachedMaxLevel: buildUpgradeBit7(fac.level, 1),
    };
  }
  if (!canUpgradeFacility(fac.type, fac.level)) return null;
  const next = fac.level + 1;
  facilityLevel[idx] = next;
  // @source 0x0040b215 `cmp dl, 5 / jne 0x40b21f` / 0x0040b21a `mov eax, 0x81`
  return {
    state: { ...state, facilityLevel },
    entity,
    reachedMaxLevel: buildUpgradeBit7(fac.level, next),
  };
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
): FreeBuildOutcome | null {
  const e = decodeEstate(entityId);
  if (e.kind === 'land') {
    const land = effectiveLand(state, topo, e.index);
    if (land === null) return null;
    const b = buildOneLevel(land.type, land.level, MAX_LAND_LEVEL);
    if (!b.ok) return null;
    const landLevel = [...state.landLevel];
    landLevel[land.id] = b.level;
    return {
      state: { ...state, landLevel },
      entity: 0x7d0 + land.id,
      reachedMaxLevel: b.reachedMaxLevel,
    };
  }
  return freeBuildFacilityById(state, topo, e.index, chosenType);
}

/** 实体（地块/設施）的地價 —— 建設公司算工程費用 @source 0x0041adc7 / 0x0041ade3 */
/**
 * 某个实体（`0x7d0 + land.id` / `0xfa0 + facility.id`）的**屏幕坐标** —— 给 `lastViewTarget` 用。
 *
 * @source 原版 `fcn_0040af12(entity, &x, &y)`：建設公司两支在**加蓋之前**用它取坐标，
 *   紧接着 `call 0x41d476`（`view_to`）把镜头移过去 —— 自家支
 *   `0x0041aaac call 0x40af12` → `0x0041aadf call 0x41d476`（arg3=0）→ `0x0041aae8` 加蓋
 *   → `0x0041ab10` 大锤 → `0x0041ab5b` 台词；别人公司那一支同形
 *   （`0x0041ad41` / `0x0041ad75` / `0x0041ad7e` / `0x0041ad99`）。
 *   机械清单：`docs/tasks/view-to-callsites.md` 第 22/23 列。
 *
 * ★★ 2026-09-22（第十一份試玩回報 #7「NPC走到建筑公司时…镜头应该转移到待修建的建筑为中心」）：
 *   先前这一族（真人 `buildTarget` + AI 两支）**一条都没写 `lastViewTarget`**，
 *   而同族的機器工人（`useTool` 那一支）写了 ⇒ 镜头留在建筑公司（＝行动者所在格）。
 */
function entityViewTarget(
  state: GameState,
  topo: MapTopology,
  entityId: number,
): { x: number; y: number } | null {
  const e = decodeEstate(entityId);
  if (e.kind === 'land') {
    const land = effectiveLand(state, topo, e.index);
    return land === null ? null : { x: land.x, y: land.y };
  }
  const fac = effectiveFacility(state, topo, e.index);
  return fac === null ? null : { x: fac.x, y: fac.y };
}

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
 * 命運罰款共用尾巴（0x0044cf11；十条事件共用，见 `FORTUNE_PAY_TAIL_IDS`）。
 * ⚠️ 没有保險公司的地图上原版**照样赔玩家**，只是把扣款写到「企业家数 + 1」那个**越界槽**
 *   （`0x44bad8 pay_money(100 + ebx, …)`，`ebx = 家数 + 1`）—— Q-INS-2 的真值。
 *   2026-09-19 订正（§7.141，通道 2 `test_insurance_richest.py` 135/135）：
 *   复刻**保留「玩家照赔」这一半**（现金 `+0x1c` 与 `+0x60` 都加），
 *   只**不复刻越界写**（读/写越界内存不该被复刻）。
 */
export function insurancePayoutTo(state: GameState, topo: MapTopology, index: number, loss: number): GameState {
  const p = state.players[index];
  if (p === undefined || !isAlive(p) || p.insuranceDays === 0 || loss <= 0) return state;
  // ★ 第十四份：理賠那一扇 `0x0044baa5 push 0x4658fa` / `0x0044bab7 push 0x7d0`（2000 ms），在付钱**之前**弹
  return insurancePayoutMoney(appendFreshNotice(state, { key: 'insurance.payout', args: [loss], holdMs: 0x7d0 }), topo, index, loss);
}

function insurancePayoutMoney(state: GameState, topo: MapTopology, index: number, loss: number): GameState {
  const co = (topo.commercials ?? []).find((c) => c.type === INDUSTRY.insurance);
  if (co === undefined) {
    // @source 0x0044bad8：玩家侧可见效果 = 现金 += loss、本月意外之財 += loss
    //   （`flags = 1` ⇒ 一律进现金；`+0x60` 那一句在付款函数里）。
    const paid = state.players.map((q, i) =>
      i === index ? { ...q, cash: q.cash + loss, monthlyReceived: q.monthlyReceived + loss } : q,
    );
    return { ...state, players: paid };
  }
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

/**
 * 住店／坐牢／住院的「意外損失」= 2000 × 天 × 物價，保險期内由保險公司赔
 * @source `0x0040d402` / `0x0043d72c` / `0x0043edd9`
 *
 * ⚠️ **旅館这一支的原版天数字段是一处未初始化读**（2026-09-18 查清，见
 *   `rich4-spec/docs/systems/game-loop.md` §四之二末）：
 * ```asm
 * 0041a807  mov  edx, dword ptr [esp + 0xd4]   ; ★ 旅館路径上此槽**没有写点**
 * …2000×edx×物價…  0041a82d  call 0x44ba63    ; 保险理赔
 * ```
 *   `sub_0041982d`（落点分派器，帧 `sub esp,0xf8`）里 `[esp+0xd4]` 全函数只有
 *   **6 个写点**（`0x41a503` 加油站交通倍率 / `0x41aa09`、`0x41aa85`、`0x41ac47`、
 *   `0x41acb1`、`0x41ad1a` 各公司支线），**都不在旅館路径上**；而同一路径的
 *   住宿天数明明在 `[esp+0xd0]`（`0x41a460` 写入，`0x41a7e8`/`0x41a838` 都在读它）。
 *   ⇒ 原版索赔金额取的是一个**残留/未初始化的栈槽**。
 *
 *   **复刻的处置（有意偏离）**：沿用 `[esp+0xd0]` 的天数（= 转盘值），即
 *   「住几天就赔几天」。理由是原版那一格取不到确定值，逐位对齐无意义。
 *   登记在 `docs/gaps/README.md` §7.56。
 */
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

/**
 * ★ 第十四份：别人的企業收費那一段（`0x0041ae37` 起，按行業費 / 保費 / 工程費三路汇到这里）：
 * ```asm
 * 0041ae37  test ebp, ebp / je 0x41b067              ; 費 0 ⇒ 不弹、不收
 * 0041ae86/0041ae98  push 0x463a6a / 0x463a31       ; 幫主 / 董事長那一句
 * 0041aeaa  push 0x5dc / call 0x440cac               ; 框（金额 = 神明调整**之前**）
 * 0041aec5  call 0x41d709(当前玩家, 費名, ebp)       ; ★ 神明调整（小財神減半 / 大財神免付 / 窮神加付）
 * 0041b006  call 0x44f42d(付款人, ebp)               ; 付款人的台词（调整之后的金额）
 * 0041b022  call 0x41d2c6(付款人, 企業, ebp, 0)      ; 付钱
 * ```
 * 先前本引擎这一路**没调神明**（大財神附身照付、窮神附身不加付）。
 *
 * ★ 第十四份：神明之后那一段被动卡 / 死神（与住宅 `0x00419e01..0x00419f28` 逐条同构，共用 `runTollTail`）：
 * ```asm
 * 0041aef3  cmp ecx, 2000×物價 / jge ; 或 0041af08 cmp ecx, 现金+存款 / jle 跳过   ; 触发门槛
 * 0041af0f  call 0x4413ad(付款人, 0x14)  → 0041af20 call 0x444a60(付款人, −1, ebp)  ; 免費卡 ⇒ ebp = 0
 *           （地主参数 −1：企業没有「地主说一句」那一支，`0x00444b6d cmp ecx,-1 / je`）
 * 0041af65  call 0x4413ad(付款人, 0x13)  → 0041af75 call 0x44476a(付款人, 1, ebp)   ; 嫁禍卡 ⇒ edi = 替死鬼
 * 0041af84  test ebp,ebp / jne ;  或 行業 1 且旅遊天数 != 0（0x0041af88 / 0x0041af8e）
 * 0041af99  call 0x40fbb8(edi)           → 0041afd0 push 0x4639cc（死神框，%s = 死神名 + 費名 esi）
 * 0041affb  cmp edi,[0x49910c] / jne     ; ★ 付款人的台词只在**当前玩家自己付**时说
 * 0041b022  call 0x41d2c6(edi, 企業, ebp, 0)
 * ```
 * ⚠️ 真人那两问（免費卡 `0x00444ad8` Yes/No、嫁禍卡选人）与住宅 / 設施两条路一样，仍按电脑规则替真人决定（D-008）。
 * 框里 `%s` 依次是 企業名（`lea eax,[ebx+4]`）、董事長名（`0x0041ae41`）、費名（`[行業 + 0x47528e]` 查 `0x47517c`）。
 * 工程費那一路（建設公司，真人选完 / 电脑自选）原版也走这一段 —— 先前没弹框，一并接上。
 * ⚠️ 仍未接：`0x0041af0c` 起的免費卡 / 嫁禍卡 / 死神那一段（与本条无关，另记）。
 */
function chargeCompanyFee(
  state: GameState,
  topo: MapTopology,
  payer: number,
  c: { id: number; name: string; type: number },
  amount: number,
  travelDays = 0,
): GameState {
  // @source 0x0041ae37 `test ebp,ebp / je 0x41b067` —— 費 0：不弹、不收，直接到出口
  if (amount === 0) return companyExit(state, topo, payer, c.id);
  const chairman = ownerOf(state.commercialOwners[c.id] ?? emptyOwnership());
  const feeName = feeNameOf(c.type);
  const notices: NoticeHint[] = [
    {
      key: c.type === INDUSTRY.sect ? 'rent.payBoss' : 'rent.payChairman',
      args: [c.name, playerName(state, chairman), amount, feeName],
    },
  ];
  const godInfo = state.players[payer]?.godInfo ?? 0;
  const adjusted = adjustTollByGod(amount, godInfo).toll;
  const godNotice = godTollNotice(godInfo, amount, adjusted, feeName, payer);
  if (godNotice !== null) notices.push(godNotice);
  // ── 被动卡 / 死神 / 付钱（`0x0041aed7` 起，与住宅同一段尾巴）──
  let pre: GameState = state;
  for (const n of notices) pre = appendFreshNotice(pre, n);
  return runTollTail(pre, topo, {
    route: { path: 'company', commercialId: c.id, travelDays },
    payer,
    who: payer,
    toll: adjusted,
    feeName,
    freeDone: false,
  });
}

// ============================================================
//  ★ 第十四份：收費那一段的被动卡尾巴（D-008 收口）—— 三条路共用
// ============================================================

/** 是不是**恰好**真人（原版 `cmp byte [+0x15], 1`：託管 / 电脑都不是 1）*/
function isPlainHuman(p: Player | undefined): boolean {
  return p !== undefined && p.whoPlays === WHO_PLAYS_HUMAN;
}

/**
 * 神明调整之后、付钱之前那一段：免費卡 → 嫁禍卡 → 死神 → 付钱（→ 各路自己的收尾）。
 *
 * ```asm
 * ; 住宅 0x00419e01..0x00419f28 / 企業 0x0041aed7..0x0041afd0（設施 0x0041a648 起只有嫁禍卡那一段）
 * cmp ebp, 2000×物價 / jge 问 ; cmp ebp, 现金+存款 / jle 不问          ; 触发门槛（两道取或）
 * call 0x4413ad(当前玩家, 0x14) / cmp eax,1 → call 0x444a60(当前玩家, 地主|−1, ebp) ; 免費卡 ⇒ ebp = 0
 * （同一道门槛，用**新的** ebp 再判一次）
 * call 0x4413ad(当前玩家, 0x13) / cmp eax,1 → call 0x44476a(当前玩家, 1, ebp)      ; 嫁禍卡 ⇒ edi = 替死鬼
 * ```
 * `fcn_00444a60` / `fcn_0044476a` 都先 `view_to(付款方)`，再按 `who_plays == 1` 分两支：
 *   - 真人：免費卡问「%s\n\n是否使用免費卡？」（`0x00444af4`）；嫁禍卡**先亮牌**「%s\n\n嫁禍卡生效！」
 *     再问（一位候选 YES/NO `0x00444849`，否则选人窗 `0x004448a1`）—— 这里交成待决交互（`freeCard` /
 *     `scapegoat`），答复（`answerFreeCard` / `answerScapegoat`）回来再从断点接着走；
 *   - 电脑：`aiUsesFreeCard` / `aiScapegoat`（用同一个发生器掷）。
 * 用了卡：`0x00441343` 扣卡、出牌者说卡牌台词（免費卡槽 19 `0x00444b5e` / 嫁禍卡槽 18 `0x00444a1d`），
 *   再由地主（免費卡，槽 79）/ 替死鬼（嫁禍卡，槽 78）回一句。
 */
function runTollTail(
  state: GameState,
  topo: MapTopology,
  ctx: TollTailCtx,
  answer: { free?: boolean | null; scapegoat?: number | null } = {},
): GameState {
  let s = state;
  let c: TollTailCtx = { ...ctx };
  const rng = new WatcomRng();
  rng.setState(s.rngState);
  const payer = (): Player => s.players[c.payer]!;

  // ── 免費卡 ──
  if (!c.freeDone) {
    c = { ...c, freeDone: true };
    const p = payer();
    if (tollTriggersPassive(c.toll, p, s.priceIndex) && playerHasCard(p, PASSIVE_CARDS.FREE)) {
      let use: boolean;
      if (isPlainHuman(p) && answer.free !== null) {
        if (answer.free === undefined) {
          return {
            ...s,
            phase: 'awaitingDecision',
            pending: { kind: 'freeCard', name: playerName(s, c.payer), tail: { ...c, freeDone: false } },
          };
        }
        use = answer.free;
      } else {
        use = aiUsesFreeCard(c.toll, p, s.priceIndex, rng.next());
      }
      if (use) {
        const owner = c.route.path === 'rent' ? rentOwnerOf(s, topo, c.route.landId) : -1;
        s = withPlayer(s, c.payer, (q) => {
          Object.assign(q, consumeCard(q, PASSIVE_CARDS.FREE));
        });
        s = appendFreshNotice(s, {
          key: 'card.use',
          args: [CARDS.find((d) => d.id === PASSIVE_CARDS.FREE)?.name ?? ''],
          card: PASSIVE_CARDS.FREE,
        });
        s = {
          ...s,
          lastCardPlay: {
            player: c.payer,
            cardId: PASSIVE_CARDS.FREE,
            popup: false,
            ...(owner >= 0 ? { answeredBy: owner } : {}),
          },
        };
        c = { ...c, toll: 0 };
      }
    }
  }

  // ── 嫁禍卡 ──
  {
    const p = payer();
    if (tollTriggersPassive(c.toll, p, s.priceIndex) && playerHasCard(p, PASSIVE_CARDS.SCAPEGOAT)) {
      let target = -1;
      if (isPlainHuman(p) && answer.scapegoat !== null) {
        if (answer.scapegoat === undefined) {
          // @source 0x004447b2..0x004447d5：候选 = who_plays != 0 且不是自己，按下标序
          const candidates = s.players.flatMap((q, i) => (i !== c.payer && isAlive(q) ? [i] : []));
          // 真人那一支**先亮牌**再问（`0x004447ff` / `0x00444889 call 0x441f73`）
          const shown = appendFreshNotice(s, {
            key: 'card.scapegoatOn',
            args: [playerName(s, c.payer)],
            card: PASSIVE_CARDS.SCAPEGOAT,
          });
          return {
            ...shown,
            rngState: rng.getState(),
            phase: 'awaitingDecision',
            pending: {
              kind: 'scapegoat',
              candidates,
              names: candidates.map((i) => playerName(s, i)),
              tail: c,
            },
          };
        }
        target = answer.scapegoat;
      } else {
        target = aiScapegoat(s.players, c.payer, c.toll, s.priceIndex, () => rng.next());
        if (target !== -1) {
          // @source 0x00444982..0x004449df：电脑那一支 亮牌 → 「嫁禍給%s！」1500 ms
          //   （託管的真人：亮牌在挂出那一问时已经亮过，不亮第二遍）
          if (answer.scapegoat !== null) {
            s = appendFreshNotice(s, {
              key: 'card.scapegoatOn',
              args: [playerName(s, c.payer)],
              card: PASSIVE_CARDS.SCAPEGOAT,
            });
          }
          s = appendFreshNotice(s, { key: 'card.scapegoatTo', args: [playerName(s, target)] });
        }
      }
      if (target !== -1) {
        s = withPlayer(s, c.payer, (q) => {
          Object.assign(q, consumeCard(q, PASSIVE_CARDS.SCAPEGOAT));
        });
        s = { ...s, lastCardPlay: { player: c.payer, cardId: PASSIVE_CARDS.SCAPEGOAT, popup: false, answeredBy: target } };
        c = { ...c, who: target };
      }
    }
  }
  s = { ...s, rngState: rng.getState(), pending: null };
  return finishToll(s, topo, c);
}

/** 住宅那一路的地主下标（`[esi+0x19] − 1`）；拿不到给 −1 */
function rentOwnerOf(state: GameState, topo: MapTopology, landId: number): number {
  const land = effectiveLand(state, topo, landId);
  return land === null ? -1 : land.owner - 1;
}

/** 被动卡之后：死神 → 付钱 → 各路自己的收尾 */
function finishToll(s: GameState, topo: MapTopology, c: TollTailCtx): GameState {
  const route = c.route;
  let who = c.who;
  const reaperNotice = (reaper: number): NoticeHint => ({ key: 'rent.reaperPays', args: [playerName(s, reaper), c.feeName] });

  if (route.path === 'rent') {
    const land = effectiveLand(s, topo, route.landId);
    if (land === null) return { ...s, phase: 'turnEnd' };
    if (c.toll === 0) {
      // @source 免費卡抹成 0 后不付；0x0041a00b 仍记这一笔 = 0
      const landLastToll = [...s.landLastToll];
      landLastToll[land.id] = 0;
      return { ...s, landLastToll, phase: 'turnEnd' };
    }
    // @source 0x00419ec7 `test ebp,ebp / je` → 0x00419ecc call 0x40fbb8(edi)；費名写死「過路費」（0x00419ef5）
    const reaper = reaperPayer(s.players, who);
    if (reaper !== -1) {
      s = appendFreshNotice(s, reaperNotice(reaper));
      who = reaper;
    }
    const landlord = s.players[land.owner - 1];
    // ★ 付的是**神明调整之后**的那一笔（`ebp`），不按替死鬼 / 死神身上的神明再调一次
    const out = collectRent(s.players, allEffectiveLands(s, topo), who, land, s.priceIndex, [], c.toll);
    // @source 0x0041a00b `mov [land + 0x2c], ebp` —— 记下这一笔（間諜要用）
    const landLastToll = [...s.landLastToll];
    landLastToll[land.id] = out.total;
    // ★ 第十四份：地主的「進帳」台词（`0x00419fa1` / `0x00419ff0 call 0x44f354(地主, 地主那份)`）——
    //   付款人（嫁禍 / 死神换过之后的 `edi`）就是地主或同盟时整段跳过（`0x00419f32` / `0x00419f42`）
    const ownerIdx = land.owner - 1;
    const gainSays =
      out.total !== 0 && who !== ownerIdx && who !== (landlord?.alliedPlayer ?? 0) - 1
        ? [{ player: ownerIdx, amount: out.ownerDue }]
        : null;
    const paid: GameState = {
      ...s,
      players: out.players,
      landLastToll,
      phase: 'turnEnd',
      ...(gainSays === null ? {} : { lastGainSays: gainSays }),
    };
    // ★ 付不起就破产——这是对局能真正结束的唯一途径
    return out.bankrupted ? applyBankruptcy(paid, who, topo) : paid;
  }

  if (route.path === 'facility') {
    const fac = effectiveFacility(s, topo, route.facilityId);
    if (fac === null) return { ...s, phase: 'turnEnd' };
    const ownerIdx = fac.owner - 1;
    const hotelDays = route.hotelDays;
    const god = { toll: c.toll };
    if (god.toll !== 0 || fac.type === FACILITY_TYPE.hotel) {
      const reaper = reaperPayer(s.players, who);
      if (reaper !== -1) {
        // @source 0x0041a6d6 `push 0x4639cc` + 0x0041a6f2 `push 0x5dc / call 0x440cac`
        s = appendFreshNotice(s, reaperNotice(reaper));
        who = reaper;
      }
    }
    const r = transferMoney(s.players, [], s.pool, who, ownerIdx, god.toll, 0);
    // @source 0x0041a75e `mov [設施 + 0x30], ebp` —— 记的是**这一笔**，不是累计
    const facilityLastToll = [...s.facilityLastToll];
    facilityLastToll[fac.id] = god.toll;
    // ★ 第十四份：設施主人的「進帳」台词 `0x0041a735 call 0x44f354(主人, ebp)`（付款人就是主人时 `0x0041a70b je` 跳过）
    const gainSays = who !== ownerIdx ? [{ player: ownerIdx, amount: god.toll }] : null;
    let paid: GameState = {
      ...s,
      players: r.players,
      pool: r.pool,
      facilityLastToll,
      phase: 'turnEnd',
      ...(gainSays === null ? {} : { lastGainSays: gainSays }),
    };
  // @source 0x0041a7aa 旅館：住 N 天、記「本月意外損失」2000×N×物價、倒楣天数 +N
  if (hotelDays > 0 && !r.bankrupted) {
    // ★ 住店的是实际付款的那个人（0x0041a772 起全用 edi）
    paid = withPlayer(paid, who, (p) => {
      // @source 0x0041a7f4 `[+0x32] = 天数 − 1`，为 0 时挂 0x80（当天就出）
      const left = hotelDays - 1;
      p.blocking = { ...p.blocking, inHotel: left === 0 ? RELEASE_PENDING : left };
      // @source 0x0041a83f `add byte ptr [eax + 0x496baa], dl` —— 8 位累加「本月倒楣天數」
      p.totalWinterSleepDays = misfortuneDaysAfter(p.totalWinterSleepDays, hotelDays);
      p.monthlyPaid += hotelStayLoss(hotelDays, s.priceIndex);
      // ★★ 第 88 条：住店时**贴图位置**要挪到**旅館設施**上（不是格子坐标）
      //   @source `0x41a85e call 0x40d5a5(玩家, 原节点, 設施号)` → 支 A：
      //   `or [player+0x15], 0x20` + 按 `设施 x/y − 玩家 x/y` 重算朝向 + `call 0x40dd1f`
      //   由走路例程把 `x/y` 挪到設施坐标；`nodeId` **不变**（人还在旅館格上）。
      //   ⇒ 与关押那一段同一个机制（貼图位置 ≠ 所在格），见 `rules/position.ts` 的例外。
      //   通道 2 证据：`rich4-spec/tests/test_relocate_to_facility.py`（22/22）。
      // ★★ 第 92 条补：`0x40d5a5` **两支都置 `+0x15 |= 0x20`**（「位置被外力挪过」）。
      //   它在原版里有两处消费：① 走路例程走「被挪支」（从当前格走向 `設施[+0x4a]`，
      //   半程时把这一位抹掉 `0x40c3dc`）；② 回合开始判定 `0x40c912` 在
      //   `dword[+0x32] != 0 && (who & 0x30)` 时改走 `call 0x40dd1f`（auto_move）
      //   **而不显示「住宿中還剩 N 天」那行字**。通道 2：
      //   `rich4-spec/tests/test_turn_start.py` §C/§D、`test_walk_step.py` §I。
      //   本引擎在这一行置位、在 `endTurn` 给离场者清掉（原版清在**当班者**的
      //   回合边界上 —— `0x418ebd` 的 `and byte [player+0x15], 0xf`）。
      p.whoPlays |= WHO_PLAYS_RELOCATED;
      // ⚠️ `fac` 是 `effectiveFacility()` 合成的记录，**自带 x/y**（来自地图模板）。
      //   别去 `topo.facilities[fac.id]` 取 —— 那张表是 0 基数组、`id` 是 1 基，
      //   按下标取会取到**下一家設施**（本行第一版就写错了）。
      p.xpos = fac.x;
      p.ypos = fac.y;
    });
    // @source 0x0041a82d：保險期内由保險公司赔这笔損失
    paid = insureConfinement(paid, topo, who, hotelDays);
  }
    return r.bankrupted ? applyBankruptcy(paid, who, topo) : paid;
  }

  // ── 企業 ──
  const cid = route.commercialId;
  const co = topo.commercials?.find((x) => x.id === cid);
  // @source 0x0041af84 `test ebp,ebp / jne` 或 行業 1 且旅遊天数 != 0（0x0041af88 / 0x0041af8e）
  if (c.toll !== 0 || (co?.type === INDUSTRY.airline && route.travelDays !== 0)) {
    const reaper = reaperPayer(s.players, who);
    if (reaper !== -1) {
      s = appendFreshNotice(s, reaperNotice(reaper));
      who = reaper;
    }
  }
  let next = payCompany({ ...s, phase: 'turnEnd' }, topo, who, cid, c.toll);
  // ★ 第十四份：航空的旅遊 —— `0x0041b02a cmp byte [企業+0x1a],1` / `0x0041b030 [esp+0xd0] != 0`（天数）/
  //   `0x0041b03d 付款人 who_plays != 0` / `0x0041b046 终局码 == 0` → `0x0041b05a call 0x40d375(付款人, 天数, 0)`。
  //   付款人是**最后付钱的那个**（嫁禍 / 死神换过之后的 `edi`）；免費卡抹成 0 也照样出國。
  if (co?.type === INDUSTRY.airline && route.travelDays !== 0 && next.phase !== 'gameOver' && isAlive(next.players[who]!)) {
    next = sendAway(next, topo, who, route.travelDays, 0 /* DISAPPEAR_REASON_ABROAD：`0x0041b04f push 0` */);
  }
  return companyExit(next, topo, c.payer, cid);
}

/**
 * ★ 第十四份：`fcn_0040d375(玩家, 天数, 原因)` —— 「消失」（出國 / 被綁架）的施加。
 *
 * ```asm
 * 0040d39e  ah = [+0x33] / test / jne 0x40d4c5   ; 已经在外：天数累加（低 6 位 + 新值，原因位跟着新值）
 * 0040d3ad  call 0x40d761                        ; 首次：清监狱 / 医院占用与四个计数
 * 0040d3e6  call 0x41d476(玩家 x, y, 0)          ; 镜头到当事人（是当前玩家时 = 复位）
 * 0040d3f8  call 0x44f2c2(玩家, 天数)            ; 小额损失台词 3/4/5（4..6 天那一档 rand()&1）
 * 0040d425  call 0x44ba63(玩家, 2000×天×物價, 0)  ; 保險理賠
 * 0040d431  add [+0x42], 天数                     ; 本月倒楣天数
 * 0040d43a  [+0x33] = 天数 | 原因 << 6
 * 0040d44b  原因 0 → 影片 0x22e（飛機）/ 1 → 0x215（飛碟）（客户端 `disappear-fx.ts` 按 `+0x33` 的跃迁播）
 * ```
 */
function sendAway(state: GameState, topo: MapTopology, victim: number, days: number, reason: number): GameState {
  const p = state.players[victim];
  if (p === undefined) return state;
  const packed = ((days & 0x3f) | (reason << 6)) & 0xff;
  if (p.blocking.disappearing !== 0) {
    // @source 0x0040d4c5 `dl = ah & 0x3f` / `0x0040d4d5 add dh, al`
    return withPlayer(state, victim, (q) => {
      q.blocking = { ...q.blocking, disappearing: ((p.blocking.disappearing & 0x3f) + packed) & 0xff };
    });
  }
  const prisonOccupancy = [...state.prisonOccupancy];
  const hospitalOccupancy = [...state.hospitalOccupancy];
  if (p.blocking.inPrison !== 0) prisonOccupancy[victim] = 0;
  if (p.blocking.inHospital !== 0) hospitalOccupancy[victim] = 0;
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const say = disappearSay(victim, days, rng);
  let next: GameState = {
    ...state,
    prisonOccupancy,
    hospitalOccupancy,
    rngState: rng.getState(),
    ...(say === null ? {} : { lastDisappearSay: say }),
    // `0x0040d3e6 view_to(玩家 +0x08, +0x0a)`：是当前玩家时就是复位（不写）；否则移到他站的那一格
    ...(victim === state.currentPlayer || topo.nodes[p.nodeId - 1] === undefined
      ? {}
      : { lastViewTarget: { x: topo.nodes[p.nodeId - 1]!.x, y: topo.nodes[p.nodeId - 1]!.y } }),
  };
  next = insureConfinement(next, topo, victim, days);
  return withPlayer(next, victim, (q) => {
    q.totalWinterSleepDays = misfortuneDaysAfter(q.totalWinterSleepDays, days);
    q.blocking = { ...q.blocking, inHotel: 0, inPrison: 0, inHospital: 0, disappearing: packed };
  });
}

/**
 * `0x0040d3f8 call 0x44f2c2(玩家, 天数)` 那一句（`fcn_0044f2c2`：>6 → 事件 3；>3 → 3|4 `rand()&1`；≠0 → 5）。
 * ★ 中间档那一次 `rand()` 走的是同一个发生器 ⇒ 在这里掷（与旅館住店那一处的既有口径不同，见 T-052）。
 */
function disappearSay(player: number, days: number, rng: WatcomRng): { player: number; event: number } | null {
  if (days > 6) return { player, event: 3 };
  if (days > 3) return { player, event: 3 + (rng.next() & 1) };
  if (days !== 0) return { player, event: 5 };
  return null;
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
  // @source `0x0041aa3c` / `0x0041acd1 cmp byte [+0x15], 1` —— ★ 整字节：託管走电脑那一支（2026-09-23 订正）
  const human = isPlainHuman(player);
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
        if (target !== 0) {
          // ★ 建設公司这一支的动效（0x229 大锤 + bit7→0x20b）已按提示播放。
          // ★ 第十五份：自家公司蓋两次（`0x0041aae8` / `0x0041aafb`，见 `ownCompanyBuild`）
          const built = ownCompanyBuild(next, topo, target);
          if (built !== null) {
            const vt = entityViewTarget(next, topo, target);
            next = {
              ...withSingleBuildUpgrade(built.state, buildHintOf(built, 'companyBuild')),
              ...(vt === null ? {} : { lastViewTarget: vt }),
            };
          }
        }
      } else {
        // ★ 2026-09-23：真人先弹「%s\n\n請選擇欲加蓋地點」（`%s` = 企業名，1500 ms）再选地
        //   @source 自己的建設公司 `0x0041aa3c cmp [+0x15],1` → `0x0041aa46 push 0x463a4a` → `0x0041aa62 call 0x440cac`
        next = appendFreshNotice(next, { key: 'company.pickBuildSite', args: [c.name] });
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
  // 收費那一段（框 / 神明调整 / 付款）见 `chargeCompanyFee`
  // ★ 第十四份：收費那一段可能停在真人那一问（免費卡 / 嫁禍卡）⇒ `chargeCompanyFee` 自己走到出口
  //   （認購那一问 `afterCompany`），这里直接交出去，别再往下盖掉它的 `pending`。
  let next: GameState = { ...state, rngState: rng.getState() };
  // ★ 2026-09-23：航空公司转盘转到 0 ⇒ 弹「不用出國！」（1500 ms），之后没有收費那一段
  //   @source `0x0041abd4 test eax,eax / je 0x41abe6` → `0x0041abe6 push 0x5dc / push 0x463a5f / call 0x440cac`
  if (fee.kind === 'none' && c.type === INDUSTRY.airline) {
    next = appendFreshNotice(next, { key: 'company.noTravel', args: [] });
  }
  if (fee.kind === 'fee') {
    return chargeCompanyFee(next, topo, me, c, fee.amount, fee.days ?? 0);
  } else if (fee.kind === 'insurance') {
    next = withPlayer(next, me, (p) => {
      p.insuranceDays = addInsuranceDays(p.insuranceDays, fee.days);
    });
    return chargeCompanyFee(next, topo, me, c, fee.amount);
  } else if (fee.kind === 'construction') {
    // ⚠️ 这一支**没有接**訊息框：金额要等「选哪一处地」定下来（真人走
    //   `pending.chooseBuildTarget`），落点这一刻 core 还不知道。
    //   原版的框在 `loc_0041ae37`（选完之后），见最终报告的「没做的」一节。
    if (!human) {
      const target = aiPickConstructionTarget(
        me, topo.lands ?? [], next.landOwner, next.landLevel, next.landType,
        topo.facilities ?? [], next.facilityOwner, next.facilityLevel, next.facilityType,
      );
      if (target !== 0) {
        const built = freeBuildEntity(next, topo, target, -1);
        if (built !== null) {
          // ★ 建設公司这一支的动效（同上）已按提示播放。
          const vt = entityViewTarget(built.state, topo, target);
          const pre: GameState = {
            ...withSingleBuildUpgrade(built.state, buildHintOf(built, 'companyBuild')),
            ...(vt === null ? {} : { lastViewTarget: vt }),
          };
          return chargeCompanyFee(pre, topo, me, c, entityLandPrice(built.state, topo, target) * built.state.priceIndex);
        }
      }
    } else {
      // ★ 2026-09-23：别人的建設公司同一句（`0x0041acd1 cmp [+0x15],1` → `0x0041acdb push 0x463a4a` → `0x0041acf7`）
      next = appendFreshNotice(next, { key: 'company.pickBuildSite', args: [c.name] });
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
  return companyExit(next, topo, me, c.id);
}

/** 企業落点的出口：付費付到破產就收在 turnEnd；否则再问一次認購（`0x0041b067 → 0x41d1a9`）*/
function companyExit(next: GameState, topo: MapTopology, me: number, commercialId: number): GameState {
  // 付費付到破產：人已出局，但阶段得收到 turnEnd，否则没人能推进这个回合
  if (next.phase === 'gameOver') return next;
  if (!isAlive(next.players[me]!)) return { ...next, phase: 'turnEnd', pending: null };
  return afterCompany(next, topo, commercialId);
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
  const done: NoticeHint[] = [];
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
      // ★ 2026-09-23：先弹「%s開發完成！」（`%s` = 道具名 `[項目*8 + 0x47ff1a]`，1500 ms）再发道具
      //   @source `0x0041cdea mov ebp,[eax*8+0x47ff1a]` → `0x0041cdf2 push 0x463b68` → `0x0041ce0e call 0x440cac`
      done.push({ key: 'research.done', args: [toolNameOf(r.produced)] });
      // @source 0x0041ce25 give_tool —— 不查上限，給不出去就凭空消失（与搶奪卡同理）
      const g = giveTool(tools, toolStock, me, r.produced);
      tools = g.tools;
      toolStock = g.stock;
    }
  }
  if (!touched) return state;
  let next: GameState = { ...state, tools, toolStock, facilityResearchProject: project, facilityResearchDays: days };
  for (const n of done) next = appendFreshNotice(next, n);
  return next;
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
  // @source `0x0044102f cmp byte [+0x15], 1 / jne 0x4411e7` —— ★ 整字节：託管走电脑那一支（2026-09-23 订正）
  if (!isPlainHuman(player)) {
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
    if (price > player.cash) return { ...state, phase: 'turnEnd' };
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
      if (price > player.cash) return { ...state, phase: 'turnEnd' };
      // @source 0x0041a21f `cmp byte [player+0x15], 1 / jne` —— ★ 是**整字节**
      //   「等于 1 才算真人」（§7.141 E2 订正）：`whoPlays = 5`（真人|托管）原版
      //   走电脑支、旧实现 `& 3 == 1` 走了真人支。
      if (player.whoPlays !== 1) {
        const rng = new WatcomRng();
        rng.setState(state.rngState);
        const chosen = aiPickFacilityType(rng.next());
        const bought = purchase(player, price);
        if (!bought.ok) return godBlockedPurchase({ ...state, rngState: rng.getState() }, bought.reason);
        const paid = withPlayer({ ...state, rngState: rng.getState() }, me, (p) => {
          p.cash = bought.player.cash;
        });
        const facilityType = [...paid.facilityType];
        const facilityLevel = [...paid.facilityLevel];
        facilityType[fac.id] = chosen;
        facilityLevel[fac.id] = 1;
        // ★ 第十六份：电脑这一支（`0x0041a23e` rand）与真人那一支在 `0x0041a25a` **汇合**，之后同一段：
        //   `0x0041a27c inc [+0x1a]` → `0x0041a289 push 0x4823da / call 0x4542ce`（音效 50）→
        //   `0x0041a2ae jmp 0x419a48`（福神 `0x40f8be`）→ 尾块（顯靈 → 研究所 `0x0041b109`）。
        //   先前这里只写了种类与等级，音效与福神都漏了（与 `buildFacility` 那条 case 对齐）。
        const builtByAi = withSingleBuildUpgrade(
          { ...paid, facilityType, facilityLevel, phase: 'turnEnd' },
          { entity: 0xfa0 + fac.id, reachedMaxLevel: false, source: 'facilityFirstBuild' },
        );
        return luckyGodBonus(state, builtByAi, topo, 0xfa0 + fac.id);
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
    // 蓋满了 / 钱不够：直接进尾块（研究所面板由 `labPanelTail` 接）
    if (!canUpgradeFacility(fac.type, fac.level)) return { ...state, phase: 'turnEnd' };
    const cost = facilityUpgradePrice(fac.housePrice, state.priceIndex);
    if (cost > player.cash) return { ...state, phase: 'turnEnd' };
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
  // @source 0x0041a3cc call 0x41d559 —— 九种免收
  // ★★ 設施这条**也弹**同一族的框，但費名**不是**住宅那个「過路費」，
  //   而是查 `[0x47528b + type]` → `0x47517c` 那张表：
  // ```asm
  // 0041a3b0  esi = movzx byte [type + 0x47528b]   ; ★ type → 費名下标
  // 0041a3b7  esi = [esi*4 + 0x47517c]             ; 住宿費/購物費/加油費/…
  // 0041a3cc  call 0x41d559(地主, 涨价位, esi)
  // ```
  //   见 `places/company.ts` 的 `facilityFeeNameOf`。
  const feeName = facilityFeeNameOf(fac.type);
  const landlord = state.players[ownerIdx];
  const exemption = landlord === undefined ? null : tollExemption(landlord, payer, fac.priceStatus);
  if (landlord === undefined || exemption !== null) {
    const notice = exemption === null ? null : exemptionNotice(exemption, playerName(state, ownerIdx), feeName, payer);
    if (notice === null) return { ...state, phase: 'turnEnd' };
    return { ...state, notices: [notice], phase: 'turnEnd' };
  }

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

  // ── ★★ 設施过路费的棕色訊息框 @source 0x0041a56f `push 0x5dc / call 0x440cac` ──
  //   三段 `sprintf` 各自在 0x41a46e（旅館）/ 0x41a4c4（購物中心）/ 0x41a55d（加油站），
  //   然后**汇到同一处弹框**；弹框在神明调整（`0x41a581 call 0x41d709`）**之前** ——
  //   所以框里的金额是**神明调整之前**的 `base`。
  const notices: NoticeHint[] = [];
  if (fac.type === FACILITY_TYPE.hotel) {
    // @source 0x0041a46e `push 0x4639ff`：%d#1 = 轉盤倍數（= 住几天）、%d#2 = 倍數 × 單價
    //   （`0x41a467 ebp = eax(倍數); 0x41a469 imul ebp, ebx(單價)`）
    notices.push({ key: 'facility.hotel', args: [multiplier, base] });
  } else if (fac.type === FACILITY_TYPE.mall) {
    // @source 0x0041a4c4 `push 0x463a14`：%d#1 = 單價（ebx）、%d#2 = 轉盤倍數（eax）、
    //   %d#3 = 總額（ebp = 倍數 × 單價）—— 推栈顺序 `push ebp / push eax / push ebx /
    //   push fmt`，故第一个 `%d` 是 ebx（單價）
    notices.push({
      key: 'facility.mall',
      args: [shopUnitPrice(fac.rateByLevel, fac.level, state.priceIndex, fac.priceStatus), multiplier, base],
    });
  } else if (fac.type === FACILITY_TYPE.gasStation && base !== 0) {
    // @source 0x0041a4ed `test dh,3 / je 0x41a581` —— 没有交通工具时**不弹**（连 sprintf 都不走）
    // @source 0x0041a530 `push 0x46385e` + `0x41a53d call 0x457d96`（strcpy）
    //   ⇒ 第一个 `%s` 是**常量「加油站」**，不是地名（与 `FACILITY_NAMES[3]` 同一地址）
    // @source 0x0041a545 `mov ebx,[0x475184]`（= `0x47517c + 8` = 第 2 项「加油費」）
    //   ⇒ 第四个 `%s` 就是 `facilityFeeNameOf(3)`（本表 `[3]` = 2 = 加油費，同一个串）
    //   参数顺序 = `sprintf(fmt, "加油站", 地主名, 总额, 費名)`
    notices.push({
      key: 'facility.gasStation',
      args: [
        FACILITY_NAMES[FACILITY_TYPE.gasStation] ?? '',
        playerName(state, ownerIdx),
        base,
        feeName,
      ],
    });
  }
  // 神明调整之前就把框弹出来 ⇒ base 为 0 时框照样在（旅館/購物中心那两路）
  // ★ 一扇都没有（加油站没有交通工具：`0x41a4ed je 0x41a581`）时**不碰** `notices`
  //   —— 免得平白换一个空数组的引用（客户端靠引用判「这一条 action 弹没弹」）。
  if (base === 0) {
    return notices.length > 0 ? { ...withRng, notices, phase: 'turnEnd' } : { ...withRng, phase: 'turnEnd' };
  }

  // 神明在付款前调整金额（与住宅同一条规则）
  const god = adjustTollByGod(base, me.godInfo);
  // ★ 第十四份：`0x0041a58a call 0x41d709` 改了金额就弹那一扇（抹成 0 时付款方再庆幸一句）
  const godNotice = godTollNotice(me.godInfo, base, god.toll, feeName, payer);
  if (godNotice !== null) notices.push(godNotice);
  if (god.toll === 0) return { ...withRng, notices, phase: 'turnEnd' };

  // ★ 尾巴照 0x0041a648 起：嫁禍卡（設施这条没有免費卡）→ 死神顯靈由他人賠償（費 != 0 或是旅館）→ 付钱（`runTollTail`）
  let pre: GameState = { ...withRng, rngState: rng.getState() };
  for (const n of notices) pre = appendFreshNotice(pre, n);
  return runTollTail(pre, topo, {
    route: { path: 'facility', facilityId: fac.id, hotelDays },
    payer,
    who: payer,
    toll: god.toll,
    feeName,
    freeDone: true, // @source 0x0041a648：設施这一路没有免費卡那一问
  });
}

// ============================================================
//  破产与终局
// ============================================================

/**
 * 玩家下标 → 角色名 —— 付費訊息框那几个 `%s` 用的就是它。
 *
 * @source 原版那几处都是 `dec 下标 / imul 0x68 / push [eax + 0x496b68]`
 *   （`0x00419c8d`、`0x00419ce4`、`0x0041ae41`），再把那个名字指针
 *   `call 0x452946` 拷进缓冲区 —— `+0x496b68` 就是玩家记录里的角色名指针，
 *   与本引擎的 `CHARACTERS[player.character].name` 同源。
 *   取不到（下标越界）给空串，与 `formatOriginal` 的「多余占位符留空」一致。
 */
function playerName(state: GameState, index: number): string {
  const p = state.players[index];
  if (p === undefined) return '';
  return CHARACTERS[p.character]?.name ?? '';
}

/**
 * 得点格（`specialKind` 10/11/12）的訊息框键。
 *
 * @source `0x0041b1c3 push 0x463a81`（50 點）/ `0x0041b25d push 0x463a8e`（30 點）/
 *   `0x0041b2e1 push 0x463a9b`（10 點）—— 三句都**没有占位符**，金额写在串里。
 */
const POINT_SQUARE_NOTICE: Readonly<Record<number, NoticeKey>> = {
  [SPECIAL_KIND.POINTS_50]: 'points.50',
  [SPECIAL_KIND.POINTS_30]: 'points.30',
  [SPECIAL_KIND.POINTS_10]: 'points.10',
};

/**
 * 得点格那三扇框的时长 = 1000 ms。
 * @source `0x0041b1be` / `0x0041b258` / `0x0041b2dc` 三处都是 `push 0x3e8`
 *   （与租金那一族的 `0x5dc` 不同 —— 照抄，不统一）。
 */
const POINT_SQUARE_HOLD_MS = 0x3e8;

/**
 * 卡片编号（1 基） → 卡片名 —— 抽卡格「得到%s！」那个 `%s`。
 *
 * @source `0x41b355 mov edi, [eax*8 + 0x47fdea]`：`0x441e12` 返回**1 基**编号，
 *   卡片表基址是 `0x47fdf2`（1 基 name 地址 = `0x47fdfa`…），而 `0x47fdea + 1*8 =
 *   0x47fdf2` —— 即表里那一项的 name 指针。与 `priceOf` 同一张表。
 */
function cardNameOf(cardId: number): string {
  return CARDS[cardId - 1]?.name ?? '';
}

/**
 * 道具编号（1 基） → 道具名 —— 禮物「得到%s！」那个 `%s`。
 *
 * @source `0x41b94e mov ecx, [ebx*8 + 0x47feda]`：`0x445ada` 返回**1 基**道具编号，
 *   `0x47feda + 1*8 = 0x47fee2` = 道具表第 1 项的 name 指针。
 */
function toolNameOf(toolId: number): string {
  return TOOLS[toolId - 1]?.name ?? '';
}

/**
 * 惡人这一趟里要弹的訊息框 —— 目前只接**小偷的五种战利品**那一句。
 *
 * @source `0x00463ac0 小偷偷得%s\n\n給%s！`，五处推串点
 *   （`0x41ba0a`/`0x41bc21`/`0x41bde0`/`0x41bf91`/`0x41c0ec`，推完就
 *   `push 0x5dc / call 0x440cac`）：
 * ```asm
 * 0041b99b  cmp [0x49910c], 4 / jne  ; ★ 只有小偷（actor 4）
 * 0041b9b6  push 0xd / call 0x40e14d ; 禮物(13)
 * 0041bc21  push 0x463ac0            ; 寶箱(14)
 * 0041bde0  push 0x463ac0            ; 路障(16) + give_tool(主人, 2)
 * 0041bf91  push 0x463ac0            ; 地雷(17) + give_tool(主人, 3)
 * 0041c0ec  push 0x463ac0            ; 定時炸彈(18) + give_tool(主人, 4)
 * ```
 *   `%s`#1 = 物件名（`objectNameOf`，同一张 `0x47edaa` 表）、`%s`#2 = 主人名。
 *
 * ★ 2026-09-23（框模板反查）：同一支函数里另外那六句也接上了（格式串在 `NOTICE_BOX`）——
 *   每句都在对应的 `pay_money` / 转移**之前**弹，所以名字、金额取的都是事件里记的那一笔：
 *   · 偷點券 `0x0041c239 push 0x463ae4` + `push 0x3e8`（**1000 ms**）`[受害者, 點數]`；
 *   · 奪卡 `0x0041c2ce push 0x463af7` + `push 0x3e8`（1000 ms）`[受害者, 卡名 [eax*8+0x47fdea]]`；
 *   · 搶銀行 `0x0041c3f9 push 0x463b02` + `push 0x7d0`（**2000 ms**）`[各笔之和, 主人]` —— 循环走完才弹；
 *   · 勒索 `0x0041c552` / `0x0041c676 push 0x463b21`（1500 ms）`[地主, 金额]`；
 *   · 間諜取過路費 `0x0041c5b9` / `0x0041c6d2 push 0x463b36`、取盈餘 `0x0041c75c push 0x463b49`（1500 ms）`[金额]`。
 */
export function npcNotices(state: GameState, events: readonly NpcEvent[], owner: number): NoticeHint[] {
  const out: NoticeHint[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'loot':
        out.push({ key: 'thief.loot', args: [objectNameOf(e.objectType), playerName(state, owner)] });
        break;
      case 'points':
        out.push({ key: 'npc.stealPoints', args: [playerName(state, e.victim), e.amount], holdMs: 0x3e8 });
        break;
      case 'card':
        out.push({ key: 'npc.stealCard', args: [playerName(state, e.victim), cardNameOf(e.card)], holdMs: 0x3e8 });
        break;
      case 'robBankDone':
        out.push({ key: 'npc.robBank', args: [e.total, playerName(state, owner)], holdMs: 0x7d0 });
        break;
      case 'protection':
        out.push({ key: 'npc.protection', args: [playerName(state, e.landlord), e.amount] });
        break;
      case 'toll':
        out.push({ key: 'npc.spyToll', args: [e.amount] });
        break;
      case 'surplus':
        out.push({ key: 'npc.spySurplus', args: [e.amount] });
        break;
      default:
        break;
    }
  }
  return out;
}

/** 在场人数 */
function aliveCount(state: GameState): number {
  return state.players.filter((p) => isAlive(p)).length;
}

/**
 * 人类玩家数 —— 决定终局码（见 rules/bankruptcy.ts）。
 *
 * ★★ 读的是**开局存下的** `state.humanPlayers`（= 原版全局 `[0x499104]`），
 *   **不是**现数 `whoPlays`。原版那个全局只在开新局时写一次，破产处理
 *   `0x40cd87` **不写它**（实测：2 人局把 0 号破产后它仍是 2，
 *   而 `whoPlays==1` 已只剩 1 人）⇒ 现数会在「多人局里有人先出局」的
 *   对局上把终局码从 3 算成 2。见 `state/types.ts` 的 `humanPlayers`。
 */
function humanCount(state: GameState): number {
  return state.humanPlayers;
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
  // ★★ 2026 本轮：破产还要**腾出监狱/医院的床位**。原版在清玩家结构**之前**
  //   就把两张占用表的那一格清了（**按玩家号**索引）：
  //   ```asm
  //   0040ce19  mov edx, [esp + 0x418]          ; player
  //   0040ce22  mov byte [edx + 0x496b30], bl   ; 在狱表[player] = 0
  //   0040ce28  mov byte [edx + 0x496b60], bl   ; 入院表[player] = 0
  //   ```
  //   此前 remake 只清玩家结构里的四个计数器（`markPlayerBankrupt`）⇒
  //   破产者的床位**永远占着**，監獄／醫院格会显示幽灵占用（4 人局里越攒越多）。
  const prisonOccupancy = [...freed.prisonOccupancy];
  const hospitalOccupancy = [...freed.hospitalOccupancy];
  if (playerIndex < prisonOccupancy.length) prisonOccupancy[playerIndex] = 0;
  if (playerIndex < hospitalOccupancy.length) hospitalOccupancy[playerIndex] = 0;
  let next: GameState = { ...freed, players, prisonOccupancy, hospitalOccupancy };

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
  // ★ 被释放的实体要**记下来**：原版在同一个循环里把它们（地块 `i + 0x7d0`、
  //   設施 `i + 0xfa0`）收进一张局部表 `[esp + esi*2]`，随后据此开拍
  //   （@source 0x40d0c4 / 0x40d105）。漏了这张表就没有下線拍卖。
  const releasedLands: number[] = [];
  const releasedFacilities: number[] = [];
  const landOwner = next.landOwner.map((v, i) => {
    if (!mine(v)) return v;
    releasedLands.push(i);
    return 0;
  });
  const landTenure = next.landTenure.map((t, i) => (mine(next.landOwner[i] ?? 0) ? 0 : t));
  const facilityTenure = next.facilityTenure.map((t, i) => (mine(next.facilityOwner[i] ?? 0) ? 0 : t));
  const facilityOwner = next.facilityOwner.map((v, i) => {
    if (!mine(v)) return v;
    releasedFacilities.push(i);
    return 0;
  });
  // ★ 企业归属**无条件**清成 0 —— @source 破产清算 0x40d10d..0x40d137 那个循环
  //   只看 `commercial + 0x18 == 玩家 + 1`，**不看持股**。清算持股的那一圈
  //   （0x40d143 起 `call _rich4_sell_stock`）在它**之后**，靠
  //   `_rich4_update_commercial_owner` 按新的持股把名次与董事长重算一遍。
  //   于是「挂着董事长名头却一股不剩」那种状态在原版里也会被清掉，
  //   而先前本引擎只在持股非空时才重排，漏掉了这一支。
  const commercialOwners = next.commercialOwners.map((o) =>
    o.owner === playerIndex + 1 ? { ...o, owner: 0 } : o,
  );
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
    commercialOwners,
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
  return queueBankruptcyAuctions(
    {
      ...reowned,
      players: reowned.players.map((p, i) => (i === playerIndex ? soldCards.player : p)),
      tools: soldTools.tools,
      toolStock: soldTools.toolStock,
      cardAmount: soldCards.cardAmount,
    },
    topo,
    releasedLands,
    releasedFacilities,
  );
}

/**
 * 破产清算的**下線拍卖** —— 释放的地产超过 3 处时，随机挑 3 处连拍。
 *
 * @source 破产清算 VA 0x0040d1c6..0x0040d20f：
 * ```asm
 * 0040d1c6  cmp  esi, 3                ; esi = 被释放的实体数（地块 + 設施）
 * 0040d1c9  jle  0x40d211             ; ★ ≤3 处：一场都不拍，直接收尾
 * 0040d1cb  push 5 / call 0x4549cf     ; 显示提示（纯表现）
 * 0040d1d5  xor  ebx, ebx             ; ebx = 已拍场次
 * 0040d1d7  jmp  0x40d1f7
 * 0040d1d9:
 *   push 0 / mov ax, dx / push eax
 *   push -1                           ; ★ 卖方 = -1 ⇒ 成交款进**公库**
 *   call 0x43bde5                     ; 开拍（同一场跑完才返回）
 *   [esp + edi] = 0                   ; 从候选表里划掉
 *   inc  ebx / cmp ebx, 3 / jge 0x40d211
 * 0040d1f7:
 *   call rand / idiv esi              ; ★ rand() % 实体数
 *   lea  edi, [edx + edx]             ; 字表下标
 *   mov  dx, [esp + edi]
 *   test dx, dx / je 0x40d1f7         ; 抽到空槽（已被划掉）就重抽
 *   jmp  0x40d1d9
 * ```
 *
 * ★ 三条容易做错的：
 *   1. **只有 > 3 处才拍**，且**只拍 3 场** —— 不是把释放的地全拍了；
 *   2. 候选表里地块与設施**同一张**，抽签分母是两者之和；
 *   3. 每抽一场就把它划掉（置 0），重复抽到空槽要**重新掷**（`je 0x40d1f7`）——
 *      这一步消耗随机数，不能图省事用「洗牌取前 3」代替。
 */
function queueBankruptcyAuctions(
  state: GameState,
  topo: MapTopology,
  lands: readonly number[],
  facilities: readonly number[],
): GameState {
  // @source cmp esi, 3 / jle —— ≤3 处不拍
  const total = lands.length + facilities.length;
  if (total <= 3) return state;

  const slots: ({ kind: 'land' | 'facility'; index: number } | 0)[] = [
    ...lands.map((index) => ({ kind: 'land' as const, index })),
    ...facilities.map((index) => ({ kind: 'facility' as const, index })),
  ];

  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const picked: { kind: 'land' | 'facility'; index: number }[] = [];
  while (picked.length < 3) {
    // @source 0x40d1f7..0x40d20f：抽到空槽就重抽（每次重抽都真正消耗一个随机数）
    //
    // ⚠️ 原版的重抽是**无界**的（`test dx,dx / je 0x40d1f7`）——它能这么写，
    //   是因为上一句 `cmp esi,3 / jle` 保证了至少还剩一个非空槽。
    //   这里给它加一道**上限**：真到了「一个非空槽都没有」的地步就收手，
    //   宁可少拍一场也不能把整局卡死（引擎里死循环比拍错更糟）。
    //   在能走到的那条路上（total > 3、最多拍 3 场）上限永不触发，
    //   抽签次数与原版**逐次相同**，故随机序列不受影响。
    let at = -1;
    for (let tries = 0; tries < slots.length; tries++) {
      const c = rng.next() % slots.length;
      if (slots[c] !== 0) {
        at = c;
        break;
      }
    }
    if (at < 0) break;
    const hit = slots[at];
    if (hit === undefined || hit === 0) break; // 不可达；仅为类型收窄
    picked.push(hit);
    slots[at] = 0;
  }

  let out: GameState = { ...state, rngState: rng.getState() };
  for (const p of picked) {
    const entity =
      p.kind === 'land' ? effectiveLand(out, topo, p.index) : effectiveFacility(out, topo, p.index);
    if (entity === null) continue;
    out = startAuction(out, topo, {
      kind: 'auction',
      entityId: entity.id,
      basePrice: auctionBasePrice(entity, out.priceIndex),
      // @source 0x40d1e1 破产清算传 **−1** ⇒ 谁都不排除（连破产者都不在 `out.players` 的在场集合里）
      bidders: eligibleBidders(out.players, entity, -1),
      // @source push -1 —— 没有发起者（破产者已出局），成交款进公库
      seller: -1,
      ...(p.kind === 'facility' ? { facility: true } : {}),
    });
  }
  return out;
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
