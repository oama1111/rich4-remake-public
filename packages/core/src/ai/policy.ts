/*
 * 电脑玩家
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-4：AI 产出的是**和人类完全一样的 action**，交给同一个
 *   `reduce()`。引擎分不出、也不需要分出来源。这条约束的直接好处是
 *   联机时「电脑玩家」可以跑在任意一端而不影响一致性。
 *
 * ★ C-DET-1：不用 `Math.random()`。需要随机时走引擎的 Watcom PRNG，
 *   且**由调用方推进种子**——否则回放和联机对账会立刻发散。
 *
 * ⚠️ 关于性格：角色表里的 `f23`(0/1/2)、`f24`(0..100)、`f26`(0..45)
 *   看起来就是 AI 性格参数，但**尚未证实**——它们在 exe 里没有可直接
 *   交叉引用的读取点（字段地址无 xref，基址 0x0047e80c 的 4 处引用
 *   都不是决策代码）。故本模块先按**可观测的局面**决策，
 *   把性格留成 `AiPersonality` 接口，等那几个字段解出来再接。
 */

import type { GameState, Player } from '../state/types.ts';
import type { LandInfo, MapNode, Rich4Map } from '../loaders/map.ts';
import type { Action } from '../state/actions.ts';
import { canPurchase, canUpgrade, housingIndexOf } from '../rules/land.ts';
import { isAiControlled } from '../state/types.ts';

/**
 * 性格参数。
 *
 * 目前由调用方给出（或用 `DEFAULT_PERSONALITY`）。
 * 等 `f23/f24/f26` 的语义确认后，这里应改为从角色表推导。
 */
export interface AiPersonality {
  /**
   * 买地的激进度 0..1。
   * 越高越愿意在现金吃紧时仍然买地。
   */
  aggression: number;
  /**
   * 现金安全垫的比例 0..1。
   * 买完之后至少要留下 `初始现金 × 该比例` 这么多，避免下一脚就破产。
   */
  cashReserve: number;
}

export const DEFAULT_PERSONALITY: AiPersonality = { aggression: 0.6, cashReserve: 0.25 };

export interface AiContext {
  state: GameState;
  map: Rich4Map;
  personality?: AiPersonality;
}

/**
 * 该轮到 AI 出手吗。
 *
 * 注意判据是 `isAiControlled`——它同时覆盖「电脑玩家」与
 * 「被托管的人类玩家」（whoPlays 的比特 2），与原版一致。
 */
export function isAiTurn(state: GameState): boolean {
  const p = state.players[state.currentPlayer];
  return p !== undefined && isAiControlled(p);
}

/**
 * 估一块地值不值得买。
 *
 * 用**同区租金总额**作为价值度量，而不是单看地价——大富翁的收益来自
 * 「凑齐同区」，这一点在 `rules/toll.ts` 里已经证实（住宅按同名地块
 * 逐块累加租金）。故已持有同区地块时，再买一块的边际价值明显更高。
 */
export function landAttractiveness(
  land: LandInfo,
  lands: readonly LandInfo[],
  playerIndex: number,
): number {
  const ownerId = playerIndex + 1;
  const sameDistrict = lands.filter((l) => l.name === land.name);
  const mine = sameDistrict.filter((l) => l.owner === ownerId).length;
  // 同区已有几块 → 边际价值加成；整区共几块 → 区块本身的分量
  const synergy = 1 + mine * 0.75;
  // 缺租金表时退而用地价估个数量级。
  // C-DET-3 定向豁免：本函数产出的是**启发式评分**，不是金额——
  // 它只用于 AI 内部比较大小，从不写入任何玩家的钱。
  // eslint-disable-next-line no-restricted-syntax
  const baseRent = land.rentByLevel[1] ?? land.landPrice / 10;
  return baseRent * synergy * sameDistrict.length;
}

/** 买完之后还剩多少现金算安全 */
function reserveFloor(p: Player, personality: AiPersonality): number {
  // 以「现金 + 存款」的比例作为垫底线，避免刚买完地就付不起过路费
  return Math.trunc((p.cash + p.moneyInBank) * personality.cashReserve);
}

/**
 * 决定 AI 在当前局面下的下一个 action。
 *
 * 只在**需要决策**的阶段给出实质选择；其余阶段返回推进用的 action。
 * 返回 null 表示「此刻不该由 AI 动」（例如轮到人类）。
 */
export function decideAction(ctx: AiContext): Action | null {
  const { state, map } = ctx;
  const personality = ctx.personality ?? DEFAULT_PERSONALITY;
  if (!isAiTurn(state)) return null;

  switch (state.phase) {
    case 'turnStart':
      return { type: 'startTurn' };
    case 'awaitingRoll':
      return { type: 'rollDice' };
    case 'moving':
      return { type: 'step' };
    case 'settling':
      return { type: 'settle' };
    case 'turnEnd':
      return { type: 'endTurn' };

    case 'awaitingDirection':
      return decideDirection(ctx);

    case 'awaitingDecision':
      return decideAtLanding(state, map, personality);

    case 'gameOver':
      return null;
    default:
      return null;
  }
}

/**
 * 岔路选择。
 *
 * 朝「本区自己已有地最多」的方向走——与 `landAttractiveness` 同一逻辑：
 * 凑齐同区才是收益来源。
 */
export function decideDirection(ctx: AiContext): Action | null {
  const { state, map } = ctx;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const here = map.nodes[me.nodeId - 1];
  if (here === undefined) return null;

  // 不走回头路：上一个节点排除掉
  const options = here.adjacent.filter((id) => id !== me.lastNodeId);
  const candidates = options.length > 0 ? options : here.adjacent;
  if (candidates.length === 0) return null;

  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const id of candidates) {
    const node = map.nodes[id - 1];
    if (node === undefined) continue;
    const score = scoreNode(node, state, map, me.index);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return { type: 'chooseDirection', nodeId: best };
}

/** 给一个节点打分——越高越想去 */
function scoreNode(node: MapNode, state: GameState, map: Rich4Map, playerIndex: number): number {
  const idx = housingIndexOf(node.type);
  if (idx === null) {
    // 非地产：特殊格略微加分（抽卡/点数多半是好事），其余中性
    return node.specialKind !== 0 ? 1 : 0;
  }
  const tpl = map.lands.find((l) => l.id === idx);
  if (tpl === undefined) return 0;

  const owner = state.landOwner[idx] ?? 0;
  if (owner === 0) {
    // 无主地：想买。除以 1000 只是把租金量级压到和其他评分项可比，
    // C-DET-3 定向豁免同 landAttractiveness——这是评分不是金额。
    // eslint-disable-next-line no-restricted-syntax
    return 10 + landAttractiveness(tpl, map.lands, playerIndex) / 1000;
  }
  if (owner === playerIndex + 1) {
    // 自己的地：可以盖房，略微加分
    return 5;
  }
  // 别人的地：要付过路费，避开——等级越高越要避
  const level = state.landLevel[idx] ?? 0;
  return -5 - level * 3;
}

/**
 * 落点决策：买地 / 盖房 / 放弃。
 *
 * ⚠️ 这里**不重复实现规则**——能不能买、要花多少钱一律问 `canPurchase`
 * 与 `canUpgrade`。AI 只回答「值不值」，不回答「行不行」。
 */
export function decideAtLanding(
  state: GameState,
  map: Rich4Map,
  personality: AiPersonality,
): Action {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return { type: 'declineDecision' };
  const node = map.nodes[me.nodeId - 1];
  if (node === undefined) return { type: 'declineDecision' };

  const idx = housingIndexOf(node.type);
  if (idx === null) return { type: 'declineDecision' };

  const tpl = map.lands.find((l) => l.id === idx);
  if (tpl === undefined) return { type: 'declineDecision' };

  const land: LandInfo = {
    ...tpl,
    owner: state.landOwner[idx] ?? 0,
    level: state.landLevel[idx] ?? 0,
  };

  const floor = reserveFloor(me, personality);

  const buy = canPurchase(land, me, state.priceIndex);
  if (buy.ok) {
    const worth = landAttractiveness(land, map.lands, me.index);
    // 激进度越高，越容易接受「买完现金见底」
    const afterBuy = me.cash - buy.price;
    const affordable = afterBuy >= floor * (1 - personality.aggression);
    // 价值门槛：同区协同越强越值得买
    const worthwhile = worth >= buy.price * (1 - personality.aggression * 0.5);
    // 上面两个比较都是**评分比较**，不产生任何金额，故不受 C-DET-3 约束
    if (affordable && worthwhile) return { type: 'buyLand' };
  }

  const up = canUpgrade(land, me, state.priceIndex);
  if (up.ok) {
    const afterUp = me.cash - up.cost;
    if (afterUp >= floor) return { type: 'upgradeLand' };
  }

  return { type: 'declineDecision' };
}
