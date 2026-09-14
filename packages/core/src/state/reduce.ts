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
  PLACEMENT_TOOLS,
  VEHICLE_TOOLS,
  isToolImplemented,
  placeObject,
  useVehicleTool,
} from '../rules/tool-effects.ts';
import { takeTool, toolCount } from '../rules/tools.ts';
import type { CardTarget } from '../cards/target.ts';
import { applyHostilityDeltas } from '../rules/hostility.ts';
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
import { SPECIAL_KIND } from '../loaders/map.ts';
import { drawEvent } from '../events/deck.ts';
import { isNewsFeasible } from '../events/news.ts';
import { checkFortune } from '../events/fortune.ts';
import { applyFortuneEffect } from '../events/fortune-effects.ts';
import { applyNewsEffect } from '../events/news-effects.ts';
import { anyoneConfined } from '../rules/confinement.ts';
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
      const { dice, sum } = rollDice(rng, player.ndices, action.forced ?? 0);

      return {
        ...state,
        rngState: rng.getState(),
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
      return {
        ...moved,
        stepsRemaining: remaining,
        phase: remaining > 0 ? 'moving' : 'settling',
      };
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
      return {
        ...moved,
        stepsRemaining: remaining,
        phase: remaining > 0 ? 'moving' : 'settling',
      };
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
          return out.bankrupted ? applyBankruptcy(paid, state.currentPlayer) : paid;
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
      return useToolAction(state, action.toolId, action.nodeId ?? 0);

    case 'declineDecision': {
      if (state.phase !== 'awaitingDecision') return state;
      return { ...state, phase: 'turnEnd' };
    }

    case 'endTurn': {
      if (state.phase !== 'turnEnd') return state;

      // 递减当前玩家的阻碍计数。
      // ★ 时机已查清（原 TODO）：`00419039 call 0x41c84f`，参数是
      //   `[0x49910c]` 即**当前玩家**，就在回合边界——与此处一致。
      // ★ 语义见 rules/blocking.ts：减到 0 时**挂 0x80 而非清零**，
      //   下一次推进才执行释放流程。先前「保留高位、只减低 7 位」是错的。
      const ticked = withPlayer(state, state.currentPlayer, (p) => {
        p.blocking = tickBlocking(p.blocking).blocking;
      });

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
function useToolAction(state: GameState, toolId: number, nodeId: number): GameState {
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me)) return state;
  if (!isToolImplemented(toolId)) return state;
  if (toolCount(state.tools, me.index, toolId) <= 0) return state;

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

  return { ...state, players, landOwner, landLevel };
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
  if (specialKind === SPECIAL_KIND.PRISON) {
    return anyoneConfined(state.prisonOccupancy) ? unimplementedPlace(specialKind) : null;
  }
  if (specialKind === SPECIAL_KIND.HOSPITAL) {
    return anyoneConfined(state.hospitalOccupancy) ? unimplementedPlace(specialKind) : null;
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

  if (isUnimplementedPlace(specialKind)) return unimplementedPlace(specialKind);
  return null;
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
export function applyBankruptcy(state: GameState, playerIndex: number): GameState {
  const victim = state.players[playerIndex];
  if (victim === undefined || !isAlive(victim)) return state;

  const players = state.players.map((p, i) => (i === playerIndex ? markPlayerBankrupt(p) : p));
  let next: GameState = { ...state, players };

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
export function settleBankruptcies(state: GameState, bankrupted: readonly number[]): GameState {
  let next = state;
  for (const i of bankrupted) {
    next = applyBankruptcy(next, i);
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
