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
import { calculateLandToll } from '../rules/toll.ts';

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

      const landIndex = landIndexAtPlayer(state, topo);
      // TODO(M2): 特殊格（specialKind 1..16）与设施/企业尚未实现，
      //   对照 _rich4_handle_player_land_on_node 的 17 路跳表 @0x4197e9
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
          // 他人地产 → 立即支付过路费
          const toll = calculateLandToll(
            allEffectiveLands(state, topo),
            land.owner,
            state.priceIndex,
            land.name,
          );
          const ownerIndex = land.owner - 1;
          const players = state.players.map((p, i) => {
            if (i === state.currentPlayer) return { ...cloneP(p), cash: p.cash - toll };
            if (i === ownerIndex) return { ...cloneP(p), cash: p.cash + toll };
            return p;
          });
          return { ...state, players, phase: 'turnEnd' };
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

      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash -= check.price;
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

      const paid = withPlayer(state, state.currentPlayer, (p) => {
        p.cash -= check.cost;
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

      // 递减被阻碍玩家的天数计数
      // ⚠️ 高位是标志位，只递减低 7 位
      // TODO(M2): 确认递减时机究竟在回合开始还是结束
      //   （原版在 fcn_0040c912 之外的某处，需定位）
      const ticked = withPlayer(state, state.currentPlayer, (p) => {
        const b = p.blocking;
        for (const k of ['inHotel', 'inPrison', 'inHospital', 'sleeping', 'sleepWalking'] as const) {
          const raw = b[k];
          if (raw === 0) continue;
          const days = raw & 0x7f;
          b[k] = days > 0 ? (raw & 0x80) | (days - 1) : 0;
        }
        const dis = b.disappearing;
        if (dis !== 0) {
          const days = dis & 0x3f;
          b.disappearing = days > 0 ? (dis & 0xc0) | (days - 1) : 0;
        }
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
