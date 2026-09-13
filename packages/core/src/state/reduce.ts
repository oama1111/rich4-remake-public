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
import type { MapNode, LandInfo } from '../loaders/map.ts';
import { housingIndexOf, canPurchase, canUpgrade, landingOnLand } from '../rules/land.ts';
import { collectRent } from '../rules/rent.ts';
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

/**
 * 归约所需的地图静态数据（只读，不进状态，避免快照臃肿）。
 *
 * 地块的**实时**归属与等级存在 `GameState.landOwner` / `landLevel` 里，
 * 这里的 `lands` 只提供不变的模板（名称、地价、房价、租金表）。
 */
export interface MapTopology {
  nodes: readonly MapNode[];
  lands?: readonly LandInfo[];
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

        // TODO(M2): 樂透/銀行/百貨/魔法屋/監獄/醫院/三个小游戏
        //   各自需要独立子系统，见 docs/known-deviations.md
        return next;
      }

      const landIndex = landIndexAtPlayer(state, topo);
      // TODO(M2): 设施(4000+)与企业(6000+)尚未实现
      if (landIndex === null) return { ...state, phase: 'turnEnd' };

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
          return { ...state, players: out.players, phase: 'turnEnd' };
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

      const next = nextAlivePlayer(ticked, state.currentPlayer);
      return {
        ...ticked,
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
    affected: newsTargets(draw.eventId, withDeck, lands),
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
function newsTargets(eventId: number, state: GameState, lands: readonly LandInfo[]): number[] {
  const countOwned = (i: number): number =>
    lands.filter((l) => l.owner === i + 1).length;

  switch (eventId) {
    case 8: {
      // 地产最多者
      let best = 0;
      for (let i = 1; i < state.players.length; i++) {
        if (countOwned(i) > countOwned(best)) best = i;
      }
      return [best];
    }
    case 9: {
      // 地产最少者
      let worst = 0;
      for (let i = 1; i < state.players.length; i++) {
        if (countOwned(i) < countOwned(worst)) worst = i;
      }
      return [worst];
    }
    default:
      return [state.currentPlayer];
  }
}
