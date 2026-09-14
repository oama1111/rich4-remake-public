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
import { isAlive } from './types.ts';
import { WatcomRng, rollDice } from '../rng/watcom.ts';
import { evaluateTurnStart, turnController } from '../rules/turn-start.ts';
import type { MapNode, LandInfo, FacilityInfo, CommercialInfo } from '../loaders/map.ts';
import { housingIndexOf, canPurchase, canUpgrade, landingOnLand } from '../rules/land.ts';
import { collectRent } from '../rules/rent.ts';
import { receiveMoney, transferMoney } from '../rules/payment.ts';
import {
  markPlayerBankrupt,
  resolveBankruptcyOutcome,
} from '../rules/bankruptcy.ts';
import { LOTTERY_DRAW_DAY, drawLottery, releaseTickets } from '../places/lottery.ts';
import { buyStock, commercialUnitPrice, liquidateStocks, sellStock } from '../places/stock.ts';
import { emptyOwnership, updateCommercialOwner } from '../places/commercial.ts';
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
import { STOCKED_TOOL_MAX_ID, takeTool, toolCount } from '../rules/tools.ts';
import { buyCard, buyTool, sellCard, sellTool } from '../places/shop.ts';
import { CARDS, CHARACTERS, TOOLS } from '@rich4/data';
import type { CardTarget } from '../cards/target.ts';
import { applyHostilityDeltas } from '../rules/hostility.ts';
import {
  objectNodeCandidates,
  pickObjectNode,
  releaseObject,
  resolveArrival,
  tickGod,
} from '../rules/object-landing.ts';
import { demolishLand } from '../rules/land-mutation.ts';
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
import { advanceDate } from '../rules/calendar.ts';
import { settleMonthlyBank } from '../rules/monthly.ts';
import { WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from './types.ts';
import { calculateFacilityToll } from '../rules/facility.ts';
import { adjustTollByGod } from '../rules/god-toll.ts';
import { facilityIndexOf } from '../rules/land.ts';
import { tickBlocking } from '../rules/blocking.ts';
import { purchase } from '../rules/purchase.ts';
import { settleSpecialSquare, addPoints, MAX_HAND_CARDS } from '../rules/special-square.ts';
import { MAX_LAND_LEVEL, SPECIAL_KIND } from '../loaders/map.ts';
import { drawEvent } from '../events/deck.ts';
import { isNewsFeasible } from '../events/news.ts';
import { checkFortune } from '../events/fortune.ts';
import { applyFortuneEffect } from '../events/fortune-effects.ts';
import { applyNewsEffect } from '../events/news-effects.ts';
import { anyoneConfined, confine, type ConfinementKind } from '../rules/confinement.ts';
import { applyBail, bailCandidates, decideBail } from '../rules/visit.ts';
import {
  isUnimplementedPlace,
  needsInteraction,
  unimplementedPlace,
  type PendingInteraction,
} from '../rules/interaction.ts';
import { loanCapacity } from '../places/bank.ts';
import {
  LOTTERY_TICKET_PRICE,
  availableNumbers,
  numbersOf,
} from '../places/lottery.ts';
import { calculatePlayerWealth, updatePriceIndex } from '../rules/wealth.ts';
import type { StockValuation } from '../rules/wealth.ts';
import { DEFAULT_INITIAL_FUND } from '../rules/setup.ts';

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
  };
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
function allEffectiveLands(s: GameState, topo: MapTopology): LandInfo[] {
  if (topo.lands === undefined) return [];
  return topo.lands.map((l) => ({
    ...l,
    owner: s.landOwner[l.id] ?? l.owner,
    level: s.landLevel[l.id] ?? l.level,
  }));
}

/** 浅拷贝玩家，避免原地修改 */
function cloneP(p: Player): Player {
  return { ...p, blocking: { ...p.blocking }, cards: [...p.cards], tools: [...p.tools] };
}

function withPlayer(s: GameState, index: number, fn: (p: Player) => void): GameState {
  const players = s.players.map((p, i) => (i === index ? cloneP(p) : p));
  const target = players[index];
  if (target !== undefined) fn(target);
  return { ...s, players };
}

/**
 * 求出从 `from` 出发、上一步来自 `prev` 时的候选前进节点。
 *
 * 基本规则：不折返。原版另有完整的方向判定（含单向道、转向卡等），
 * TODO: 需对照 `rich4-re/asm/rich4_calculate_direction.asm`(1116 行)
 *       逐条复刻，当前实现仅覆盖「不折返」这一主干规则。
 */
export function nextCandidates(
  topo: MapTopology,
  from: number,
  prev: number,
): number[] {
  const node = topo.nodes[from - 1];
  if (node === undefined) return [];
  const forward = node.adjacent.filter((n) => n !== prev);
  // 死路时允许折返，否则玩家会卡住
  return forward.length > 0 ? forward : [...node.adjacent];
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
      if (result.sleepWalk) {
        // 梦游：原版立即自动掷骰走子，玩家无法干预
        return reduce({ ...state, phase: 'awaitingRoll' }, { type: 'rollDice' }, topo);
      }
      return { ...state, phase: 'awaitingRoll' };
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

      const candidates = nextCandidates(topo, player.nodeId, player.lastNodeId);
      if (candidates.length === 0) return { ...state, phase: 'settling' };
      if (candidates.length > 1) {
        // 岔路：交由玩家（或 AI）选择
        return { ...state, phase: 'awaitingDirection' };
      }

      const next = candidates[0]!;
      const moved = withPlayer(state, state.currentPlayer, (p) => {
        p.lastNodeId = p.nodeId;
        p.nodeId = next;
      });
      const remaining = state.stepsRemaining - 1;
      return applyArrival({
        ...moved,
        stepsRemaining: remaining,
        phase: remaining > 0 ? 'moving' : 'settling',
      }, topo);
    }

    case 'chooseDirection': {
      if (state.phase !== 'awaitingDirection') return state;
      const player = state.players[state.currentPlayer];
      if (player === undefined) return state;

      const candidates = nextCandidates(topo, player.nodeId, player.lastNodeId);
      if (!candidates.includes(action.nodeId)) return state; // 非法选择，忽略

      const moved = withPlayer(state, state.currentPlayer, (p) => {
        p.lastNodeId = p.nodeId;
        p.nodeId = action.nodeId;
      });
      const remaining = state.stepsRemaining - 1;
      return applyArrival({
        ...moved,
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
        if (node.specialKind === SPECIAL_KIND.FORTUNE) return drawAndApplyFortune(next);
        // 魔法屋：两个转盘一转就结算，中间没有玩家决策
        if (node.specialKind === SPECIAL_KIND.MAGIC_HOUSE) return runMagicHouse(next, topo);
        // 小游戏：电脑玩家直接按「不玩」出口结算，真人才挂待决交互
        if (isMinigame(node.specialKind)) return enterMinigame(next, node.specialKind);
        // 探監／探病：同样是电脑自己拿主意、真人才弹窗
        if (
          node.specialKind === SPECIAL_KIND.PRISON ||
          node.specialKind === SPECIAL_KIND.HOSPITAL
        ) {
          return enterVisit(next, node.specialKind);
        }

        // 其余特殊格：交给「待决交互」机制。
        // ★ 这样每一格都**可达**：已实现的给出具体交互，
        //   未实现的给出一个明确的 unimplemented，而不是静默无事发生。
        return { ...next, pending: pendingForSpecial(next, node.specialKind) };
      }

      const landIndex = landIndexAtPlayer(state, topo);
      if (landIndex === null) {
        // 住宅之外：设施走过路费，上市企业问「买多少股」
        const fac = facilityAtPlayer(state, topo);
        if (fac !== null) return settleFacility(state, fac);
        const shares = pendingForCommercial(state, topo, node);
        if (shares !== null) return { ...state, phase: 'turnEnd', pending: shares };
        return { ...state, phase: 'turnEnd' };
      }

      const land = effectiveLand(state, topo, landIndex);
      if (land === null) return { ...state, phase: 'turnEnd' };

      switch (landingOnLand(land, state.currentPlayer)) {
        case 'unowned': {
          // 买不起或被阻止时直接结束，不给决策机会
          return canPurchase(land, player, state.priceIndex).ok
            ? { ...state, phase: 'awaitingDecision' }
            : { ...state, phase: 'turnEnd' };
        }
        case 'own': {
          return canUpgrade(land, player, state.priceIndex).ok
            ? { ...state, phase: 'awaitingDecision' }
            : { ...state, phase: 'turnEnd' };
        }
        case 'other': {
          // 他人地产 → 立即支付过路费。
          // ★ 走 rules/rent.ts：含**同盟分账**、存款级联、破产判定与本月收支累计。
          //   早先这里是裸的 `cash -= toll` / `cash += toll`，四样全缺。
          const out = collectRent(
            state.players,
            allEffectiveLands(state, topo),
            state.currentPlayer,
            land,
            state.priceIndex,
          );
          const paid: GameState = { ...state, players: out.players, phase: 'turnEnd' };
          // ★ 付不起就破产——这是对局能真正结束的唯一途径
          return out.bankrupted ? applyBankruptcy(paid, state.currentPlayer, topo) : paid;
        }
      }
    }

    case 'buyLand': {
      if (state.phase !== 'awaitingDecision') return state;
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
      return { ...paid, landOwner, phase: 'turnEnd' };
    }

    case 'upgradeLand': {
      if (state.phase !== 'awaitingDecision') return state;
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
      return { ...paid, landLevel, phase: 'turnEnd' };
    }

    case 'buyStock':
    case 'sellStock':
      return tradeStock(state, action);

    case 'buyShares':
      return buySharesFromCommercial(state, action.shares);

    case 'useCard':
      return playCard(state, topo, action.cardId, action.target ?? { kind: 'none' });

    case 'useTool':
      return useToolAction(state, topo, action.toolId, action.nodeId ?? 0, action.value ?? 0);

    case 'shop':
      return shopAction(state, action);

    case 'declineDecision': {
      if (state.phase !== 'awaitingDecision') return state;
      return { ...state, phase: 'turnEnd' };
    }

    case 'bail': {
      if (state.pending === null || state.pending.kind !== 'bail') return state;
      const place = state.pending.place;
      const occ = place === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
      const r = applyBail(state.players, occ, place, state.currentPlayer, action.slot);
      if (!r.ok) return { ...state, pending: null, phase: 'turnEnd' };
      const paid: GameState = { ...state, players: r.players, pending: null, phase: 'turnEnd' };
      return place === 'prison'
        ? { ...paid, prisonOccupancy: r.occupancy }
        : { ...paid, hospitalOccupancy: r.occupancy };
    }

    case 'minigame': {
      if (state.pending === null || state.pending.kind !== 'minigame') return state;
      return settleMinigame({ ...state, pending: null }, action.score);
    }

    case 'endTurn': {
      if (state.phase !== 'turnEnd') return state;

      // 递减当前玩家的阻碍计数。
      // ★ 时机已查清（原 TODO）：`00419039 call 0x41c84f`，参数是
      //   `[0x49910c]` 即**当前玩家**，就在回合边界——与此处一致。
      // ★ 语义见 rules/blocking.ts：减到 0 时**挂 0x80 而非清零**，
      //   下一次推进才执行释放流程。先前「保留高位、只减低 7 位」是错的。
      const blocked = withPlayer(state, state.currentPlayer, (p) => {
        p.blocking = tickBlocking(p.blocking).blocking;
      });

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
      const wealthOf = (p: Player): number =>
        calculatePlayerWealth(
          p,
          allEffectiveLands(ticked, topo),
          topo.facilities ?? [],
          valuationsOf(ticked, p.index),
        );
      const priceIndex = updatePriceIndex(
        ticked.players,
        wealthOf,
        DEFAULT_INITIAL_FUND,
        ticked.priceIndex,
      );

      const dayEnd = advanceGameDay({ ...ticked, priceIndex }, topo);

      const next = nextAlivePlayer(dayEnd, state.currentPlayer);
      return {
        ...dayEnd,
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
  const moved = pickObjectNode(spots, rng.next());

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
    next = { ...next, players: c.players, hospitalOccupancy: c.occupancy };
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
  const node = pickObjectNode(spots, rng.next());
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
  const facilities = topo.facilities ?? [];

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
function applyMagicRequest(
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
        const drawn = drawAndApplyFortune({ ...s, currentPlayer: req.player });
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
      return kind === 'prison'
        ? { ...state, players: c.players, prisonOccupancy: c.occupancy }
        : { ...state, players: c.players, hospitalOccupancy: c.occupancy };
    }
    // @source 0x40b110(type)：住宅 level < 5 可建；連鎖店只有 level == 0 时可建
    case 'build': {
      const land = landAtPlayer(state, topo, req.player);
      if (land === null) return state;
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

/** 道具编号 */
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

  return {
    ...state,
    players: applyHostilityDeltas(players, deltas),
    landLevel,
    landOwner,
    hospitalOccupancy: hospital,
    toolStock,
  };
}

/** 某玩家脚下那块住宅；不是住宅返回 null */
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
function enterVisit(state: GameState, specialKind: number): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return { ...state, phase: 'turnEnd' };
  const kind: ConfinementKind = specialKind === SPECIAL_KIND.PRISON ? 'prison' : 'hospital';
  const occ = kind === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
  // @source 占用表全空即返回
  if (!anyoneConfined(occ)) return { ...state, phase: 'turnEnd' };

  const human = (me.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN;
  if (human) {
    return { ...state, pending: pendingForSpecial(state, specialKind) };
  }

  // 电脑：随机数在 reducer 里掷，AI 保持纯函数
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  // decideBail 最多用三个随机数；多备无妨，用几个由它告诉我们
  const rolls = [rng.next(), rng.next(), rng.next()];
  const d = decideBail(me.bailStyle, occ, me.points, rolls);

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
  return commit(sellStock(me, held, stock, action.shares, 'bank'));
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
function useToolAction(
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

  // ── 遙控骰子（8）──
  if (toolId === TOOL_REMOTE_DICE) {
    // @source `test ebx, ebx / je 结束` —— 没给点数就不消耗道具
    if (!isValidRemoteDice(value)) return state;
    return consume({ ...state, forcedDice: value });
  }

  // ── 機器工人（9）：免费加蓋一级 ──
  if (toolId === TOOL_ROBOT_WORKER) {
    const land = landAtNode(state, topo, nodeId);
    if (land === null) return state;
    const b = buildOneLevel(land.type, land.level, MAX_LAND_LEVEL);
    if (!b.ok) return state;
    const landLevel = [...state.landLevel];
    landLevel[land.id] = b.level;
    return consume({ ...state, landLevel });
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
      // 嫁祸的新目标：交给上层决定；没给就放弃转嫁（返回 -1）
      scapegoatPicker: () => -1,
    },
    cardId,
    target,
  );
  if (!r.ok) return state;

  const landOwner = [...state.landOwner];
  const landLevel = [...state.landLevel];
  for (const l of r.lands) {
    landOwner[l.id] = l.owner;
    landLevel[l.id] = l.level;
  }

  // 敌意由 registry 算好，这里按增量落到玩家身上
  const players = applyHostilityDeltas(r.players, r.hostilityDeltas);

  // ★ 送神符之类只清了玩家身上的引用，物件本身要在这里收回：
  //   退还三项修正、清 `attached`、让搭档登场。
  let next: GameState = { ...state, players, landOwner, landLevel };
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
  return next;
}

/**
 * 买入股票之后重排对应企业的持股名次。
 *
 * @source `_rich4_buy_stock` 末尾无条件调 `_rich4_update_commercial_owner`
 *   —— **柜台买入与企业买入都会触发**，不只是后者。
 *
 * ⚠️ 卖出**不触发**（`_rich4_sell_stock` 里没有这一步），故卖光股票
 *   并不会立刻让出企业归属，要等下一次有人买入才重排。照搬原版。
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
 * 信息算齐（单价、余量、现金）。
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
  return {
    kind: 'buyShares',
    commercialId: c.id,
    name: c.name,
    stock: c.stockIndex,
    unitPrice: commercialUnitPrice(c.assetValue),
    available: state.commercialShares[commercialId] ?? 0,
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

  // @source 0041c868 call 0x42915a —— 每日重算可成交量
  let market = refreshTradableShares(state.market, rng);
  // @source 0041cff9 起的 12 次循环
  market = tickStockCountdowns(market);
  // @source 0041d076 call 0x4291d6
  market = tickStockMarket(market, rng, (i) => commercialValueOf(topo, i));

  let players = state.players;
  let lottery = state.lottery;
  let pool = state.pool;

  // @source 0041d080 `and eax, 0xff / cmp eax, 0xf`
  if (date.day === LOTTERY_DRAW_DAY) {
    const draw = drawLottery(lottery, pool, rng);
    lottery = draw.lottery;
    pool = draw.pool;
    // @source give_money(中奖者, 公库, 1) —— 旗标 1 即进现金
    if (draw.winner !== null) players = receiveMoney(players, draw.winner, draw.prize, true);
  }

  // @source 0041d09e call 0x439bfa
  if (newMonth) players = players.map((p) => (isAlive(p) ? settleMonthlyBank(p) : p));

  return {
    ...state,
    ...date,
    players,
    lottery,
    pool,
    market,
    rngState: rng.getState(),
  };
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
function drawAndApplyFortune(state: GameState): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return state;
  const ctx = {
    currentPlayer: me,
    otherPlayers: state.players.filter((_, i) => i !== state.currentPlayer),
    lands: [] as never[],
    stockAmount: new Array<number>(12).fill(0),
    gameStage: 0,
  };

  const draw = drawEvent(state.fortuneDeck, (id) => checkFortune(id, ctx).feasible);
  const withDeck: GameState = { ...state, fortuneDeck: draw.deck };
  if (draw.eventId < 0) return withDeck;

  // ★ checkFortune 可能把事件号**重映射**（交通方式相关的 14/15/16 一组），
  //   施加效果时必须用重映射后的号，否则会施加错事件。
  const effectiveId = checkFortune(draw.eventId, ctx).eventId;

  const out = applyFortuneEffect(effectiveId, {
    players: withDeck.players,
    currentPlayer: withDeck.currentPlayer,
    priceIndex: withDeck.priceIndex,
    pool: withDeck.pool,
    occupancy:
      // 坐牢与住院共用一个入口，故按事件实际走向取对应的占用表
      withDeck.prisonOccupancy,
  });

  return {
    ...withDeck,
    players: out.players,
    pool: out.pool,
    prisonOccupancy: out.occupancy,
    lastEvent: { kind: 'fortune', id: effectiveId },
  };
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

  const out = applyNewsEffect(draw.eventId, {
    players: withDeck.players,
    affected: newsTargets(draw.eventId, withDeck, lands, topo.facilities ?? []),
    priceIndex: withDeck.priceIndex,
    pool: withDeck.pool,
    occupancy: withDeck.prisonOccupancy,
  });

  return {
    ...withDeck,
    players: out.players,
    pool: out.pool,
    prisonOccupancy: out.occupancy,
    lastEvent: { kind: 'news', id: draw.eventId },
  };
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
    default:
      return [state.currentPlayer];
  }
}

// ============================================================
//  落点交互
// ============================================================

/**
 * 这一格要求玩家做什么。
 *
 * ★ 由 core 判定而非 UI —— 见 rules/interaction.ts 顶部说明。
 */
function pendingForSpecial(state: GameState, specialKind: number): PendingInteraction | null {
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
    return { kind: 'bank', wealth, loanCapacity: loanCapacity(wealth, me.loan) };
  }

  if (specialKind === SPECIAL_KIND.LOTTERY) {
    return {
      kind: 'lottery',
      available: availableNumbers(state.lottery),
      price: LOTTERY_TICKET_PRICE,
      owned: numbersOf(state.lottery, state.currentPlayer).length,
    };
  }

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
    };
  }

  if (isUnimplementedPlace(specialKind)) return unimplementedPlace(specialKind);
  return null;
}

/**
 * 在百貨公司买卖。
 *
 * ★ 规则全在 `places/shop.ts`，这里只接驳状态。
 *   成功后**保持 `pending`**——原版的商店是个模态窗口，
 *   一次可以买好几样，直到玩家自己关掉（`declineDecision`）。
 */
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
      const r = buyCard(me, action.id);
      return r.ok ? commit(r.player) : state;
    }
    case 'sellCard': {
      const r = sellCard(me, action.id);
      return r.ok ? commit(r.player) : state;
    }
    case 'buyTool': {
      const r = buyTool(me, state.tools, state.toolStock, action.id);
      return r.ok ? commit(r.player, r.tools, r.stock) : state;
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
  return topo.facilities.find((f) => f.id === idx) ?? null;
}

/**
 * 设施过路费结算。
 *
 * ★ 与住宅的两处根本差别（见 rules/facility.ts）：
 * - 按 `type` 分三路：1/2 是单价 × 转盘倍数，3 是**掷骰步数** × 500 × 交通倍率
 * - **没有同盟分账**——原版这条路径只有一次 pay_money，
 *   收款方直接取自 `facility.owner`
 *
 * ⚠️ type 1/2 需要一个「转盘倍数」，那是 UI（`0x44090e`）。
 *   此处先传 1（等同不加成）——转盘接进来之前，type 1/2 的金额会偏低。
 *   这一点已在 docs/known-deviations.md 记录。
 */
function settleFacility(state: GameState, fac: FacilityInfo): GameState {
  const payer = state.currentPlayer;
  const me = state.players[payer];
  if (me === undefined) return { ...state, phase: 'turnEnd' };

  const ownerIdx = fac.owner - 1;
  // 无主或自己的设施都不收费
  if (fac.owner === 0 || ownerIdx === payer) return { ...state, phase: 'turnEnd' };

  const base = calculateFacilityToll({
    facility: fac,
    rateByLevel: fac.rateByLevel,
    priceIndex: state.priceIndex,
    stepsTotal: state.stepsTotal,
    trafficMethod: me.trafficMethod,
    multiplier: 1,
  });
  if (base === 0) return { ...state, phase: 'turnEnd' };

  // 神明在付款前调整金额（与住宅同一条规则）
  const god = adjustTollByGod(base, me.godInfo);
  if (god.toll === 0) return { ...state, phase: 'turnEnd' };

  const r = transferMoney(state.players, [], state.pool, payer, ownerIdx, god.toll, 0);
  return { ...state, players: r.players, pool: r.pool, phase: 'turnEnd' };
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
  const landOwner = next.landOwner.map((v) => (v === playerIndex + 1 ? 0 : v));
  return {
    ...next,
    landOwner,
    holdings: next.holdings.map((row, i) => (i === playerIndex ? liquidated.holdings : row)),
    market: { ...next.market, stocks: liquidated.stocks },
    pool: next.pool + liquidated.proceeds,
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
 */
export function gameOverCode(state: GameState): 0 | 1 | 2 | 3 {
  const outcome = resolveBankruptcyOutcome(aliveCount(state), humanCount(state));
  return outcome.kind === 'gameOver' ? outcome.code : 0;
}
