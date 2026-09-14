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
import type { LandInfo, Rich4Map } from '../loaders/map.ts';
import type { Action } from '../state/actions.ts';
import { canPurchase, canUpgrade, housingIndexOf } from '../rules/land.ts';
import { purchaseBlockedBy } from '../rules/purchase.ts';
import { buyTool } from '../places/shop.ts';
import { isAiControlled, isAlive } from '../state/types.ts';
import { useCard } from '../cards/registry.ts';
import type { CardTarget } from '../cards/target.ts';
import { TRAFFIC_CAR, TRAFFIC_MOTORCYCLE, buildOneLevel } from '../rules/tool-effects.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import { aiCanUseCards, aiCanUseTools, autoLoanAmount } from './personality.ts';
import { toolCount } from '../rules/tools.ts';
import { autoAction } from '../state/reduce.ts';
import { decideStockTrade } from './stock-policy.ts';

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
  // ★ 出局者的回合由引擎推进，不经过策略——见 state/reduce.ts 的 autoAction。
  //   放在 isAiTurn 之前：出局者恰恰**不满足** isAiControlled。
  const auto = autoAction(state);
  if (auto !== null) return auto;
  if (!isAiTurn(state)) return null;

  switch (state.phase) {
    case 'turnStart':
      return { type: 'startTurn' };
    case 'awaitingRoll':
      // ★ 掷骰前是出牌/用道具/炒股的时机 —— 原版也是在这个阶段
      return decideCard(ctx) ?? decideTool(ctx) ?? decideStockTrade(state) ?? { type: 'rollDice' };
    case 'moving':
      return { type: 'step' };
    case 'settling':
      return { type: 'settle' };
    case 'turnEnd':
      // 落点可能留下一个待决交互（例如落在上市企业上），先把它答掉
      return decidePending(state) ?? { type: 'endTurn' };

    case 'awaitingDecision':
      return decideAtLanding(state, map, personality);

    case 'gameOver':
      return null;
    default:
      return null;
  }
}

/**
 * 该不该出张牌，出哪张。
 *
 * ★ 这是**策略**不是规则：能不能出、出了会怎样一律由
 *   `cards/registry.ts` 说了算，这里只回答「值不值」。
 *
 * ⚠️ 原版的出牌时机与取舍由 AI 性格决定（角色表的 f23/f24/f26，
 *   语义尚未证实，见本文件顶部），故这里先给一套**保守而讲道理**的规则：
 *   只在能明确得利时出牌，不为出而出。
 */
export function decideCard(ctx: AiContext): Action | null {
  const { state, map } = ctx;
  const me = state.players[state.currentPlayer];
  if (me === undefined || me.cards.length === 0) return null;
  // @source `test byte [player + 0x16], 1 / je 跳过`（VA 0x00441d09）
  //   角色表的 f22 第 0 位：这个 AI 会不会出牌
  if (!aiCanUseCards(me.aiFlags)) return null;

  /**
   * ★ 出牌前**先空跑一遍规则**，只有确定会生效才真出。
   *
   * 这不是保险起见——是必须的：`useCard` 失败时 reduce 原样返回状态，
   * 而 AI 是纯函数（为了可回放，见 C-DET-4），下一帧会**再提议同一张牌**，
   * 于是活锁。既有的买地/盖房走的也是这条路子（问 `canPurchase`），
   * 出牌照办即可，规则仍只有 registry 一份。
   */
  const willWork = (cardId: number, target: CardTarget): boolean =>
    useCard(
      {
        players: state.players,
        lands: map.lands.map((l) => ({
          ...l,
          owner: state.landOwner[l.id] ?? l.owner,
          level: state.landLevel[l.id] ?? l.level,
        })),
        nodes: map.nodes,
        currentPlayer: state.currentPlayer,
        priceIndex: state.priceIndex,
        scapegoatPicker: () => -1,
      },
      cardId,
      target,
    ).ok;

  const play = (cardId: number, target: CardTarget = { kind: 'none' }): Action | null =>
    willWork(cardId, target) ? { type: 'useCard', cardId, target } : null;

  const has = (id: number): boolean => me.cards.includes(id);
  const rivals = state.players.filter((p) => p.index !== me.index && isAlive(p));
  if (rivals.length === 0) return null;

  const wealth = (p: Player): number => p.cash + p.moneyInBank;
  const richest = rivals.reduce((a, b) => (wealth(b) > wealth(a) ? b : a));
  const myCash = me.cash;

  // ── 均富卡：自己比平均穷才划算 ──
  if (has(1)) {
    const alive = state.players.filter((p) => isAlive(p));
    // C-DET-3 定向豁免：这是**策略比较**，不写入任何玩家的钱。
    // 为免歧义仍显式取整。
    const avg = Math.trunc(alive.reduce((t, p) => t + p.cash, 0) / alive.length);
    if (myCash * 5 < avg * 4) {
      const a = play(1);
      if (a !== null) return a;
    }
  }

  // ── 均貧卡：把最富的拉下来 ──
  if (has(2) && wealth(richest) > wealth(me) * 1.5) {
    const a = play(2, { kind: 'player', index: richest.index });
    if (a !== null) return a;
  }

  // ── 購地卡：站在别人的地上且买得起 ──
  const here = map.nodes[me.nodeId - 1];
  const landIdx = here === undefined ? null : housingIndexOf(here.type);
  if (has(3) && landIdx !== null) {
    const owner = state.landOwner[landIdx] ?? 0;
    const tpl = map.lands.find((l) => l.id === landIdx);
    if (owner !== 0 && owner !== me.index + 1 && tpl !== undefined) {
      const level = state.landLevel[landIdx] ?? 0;
      const price = (tpl.landPrice + tpl.housePrice * level) * state.priceIndex;
      if (price <= myCash) {
        const a = play(3);
        if (a !== null) return a;
      }
    }
  }

  // ── 改建卡：站在自己没满级的地上 ──
  if (has(7) && landIdx !== null && (state.landOwner[landIdx] ?? 0) === me.index + 1) {
    if ((state.landLevel[landIdx] ?? 0) < 5) {
      const a = play(7);
      if (a !== null) return a;
    }
  }

  // ── 停留 / 烏龜：拖住最富的那个 ──
  if (has(14)) {
    const a = play(14, { kind: 'player', index: richest.index });
    if (a !== null) return a;
  }
  if (has(30)) {
    const a = play(30, { kind: 'player', index: richest.index });
    if (a !== null) return a;
  }

  // ── 查稅卡：查最富的 ──
  if (has(26)) {
    const a = play(26, { kind: 'player', index: richest.index });
    if (a !== null) return a;
  }

  // ── 送神符：身上有神就送走（好坏由 core 判，这里只在有附身时试） ──
  if (has(22) && me.godInfo !== 0) {
    const a = play(22);
    if (a !== null) return a;
  }

  return null;
}

/**
 * 该不该用道具。
 *
 * ⚠️ 与出牌同理，这里只回答「值不值」；能不能用由
 *   `rules/tool-effects.ts` 说了算。
 *
 * 目前只接**交通工具**：升级到骰子更多的车总是划算的，判据明确。
 * 放置类（路障/地雷/定時炸彈）要选格子、还要判断放哪儿有用，
 * 那是战术问题，留到性格字段解出来之后再说（M3）。
 */
export function decideTool(ctx: AiContext): Action | null {
  const { state } = ctx;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  // @source `test byte [player + 0x16], 2 / je 跳过`（VA 0x00447f87）
  if (!aiCanUseTools(me.aiFlags)) return null;

  // 骰子数越多越好：汽車(3) > 機車(2) > 步行(1)
  const better: readonly { tool: number; traffic: number }[] = [
    { tool: 6, traffic: TRAFFIC_CAR },
    { tool: 5, traffic: TRAFFIC_MOTORCYCLE },
  ];
  for (const b of better) {
    if (me.trafficMethod === b.traffic) break; // 已经是更好的了
    if (toolCount(state.tools, me.index, b.tool) > 0) {
      return { type: 'useTool', toolId: b.tool };
    }
  }

  // ★ 機器工人：站在自己的地上就免费加一级，纯赚。
  //   ⚠️ 必须**先预演**——满级的地盖不上去，reduce 会原样退回，
  //   而 AI 是纯函数，退回一次就会原样重提，卡死在 awaitingRoll。
  if (toolCount(state.tools, me.index, TOOL_ROBOT_WORKER) > 0) {
    const node = ctx.map.nodes[me.nodeId - 1];
    const idx = node === undefined ? null : housingIndexOf(node.type);
    if (idx !== null) {
      const tpl = ctx.map.lands.find((l) => l.id === idx);
      const owner = state.landOwner[idx] ?? 0;
      const level = state.landLevel[idx] ?? 0;
      if (tpl !== undefined && owner === me.index + 1) {
        if (buildOneLevel(tpl.type, level, MAX_LAND_LEVEL).ok) {
          return { type: 'useTool', toolId: TOOL_ROBOT_WORKER, nodeId: me.nodeId };
        }
      }
    }
  }

  return null;
}

/** 機器工人的道具编号 */
const TOOL_ROBOT_WORKER = 9;

/**
 * 回答落点留下的待决交互。
 *
 * ⚠️ 只处理**已实现**的那几种；其余返回 null，由调用方继续推进回合——
 *   未实现的场所会以 `unimplemented` 留在 `pending` 里，上层看得见。
 */
export function decidePending(state: GameState): Action | null {
  const p = state.pending;
  if (p === null) return null;
  if (p.kind === 'shop') {
    // ★ 优先把交通工具买到手：骰子从 1 变 3，是全局最划算的一笔。
    //   其次补放置类道具。都买不起就关门（由调用方发 declineDecision）。
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    // ★ 不能只看「买得起 + 有货」——`buyTool` 还会因**每人每种上限 9**
    //   而拒绝（`give_tool` 的 `toolLimit`）。AI 是纯函数，提一个 reducer
    //   必拒的 action 就会被原样重提，卡死在 turnEnd/shop。
    //   与卡片、买地两次事故同一类，处理办法也一样：**先预演一遍**。
    const canBuy = (id: number): boolean =>
      buyTool(me, state.tools, state.toolStock, id).ok;
    // 已有更好的车就别买了
    if (me.trafficMethod !== TRAFFIC_CAR && canBuy(6)) {
      return { type: 'shop', op: 'buyTool', id: 6 };
    }
    if (
      me.trafficMethod !== TRAFFIC_CAR &&
      me.trafficMethod !== TRAFFIC_MOTORCYCLE &&
      canBuy(5)
    ) {
      return { type: 'shop', op: 'buyTool', id: 5 };
    }
    return null;
  }
  // ★ 小游戏：AI 从来不玩（原版 `who_plays != 1` 直接走「不玩」出口）。
  //   真人被托管时也走这条——托管的意思就是让 AI 替你打，不该弹出玩法。
  if (p.kind === 'minigame') return { type: 'minigame', score: null };
  // ★ 保釋：电脑玩家那条路在 reducer 里就掷完了（随机数不能进 AI），
  //   走到这里的只会是**被托管的真人**。按 `personality` 的精神保守处理：
  //   救得起同伴就救，不去放犯人。
  if (p.kind === 'bail') {
    const cheap = p.candidates
      .filter((c) => c.affordable && c.player >= 0)
      .sort((a, b) => a.cost - b.cost)[0];
    return cheap === undefined ? null : { type: 'bail', slot: cheap.slot };
  }
  // ★ 银行：按角色的**借贷激进度**（f24）一次性借出身家的某个百分比。
  // @source 银行落点的 AI 分支 VA 0x004368db，见 ai/personality.ts。
  // ⚠️ 原版那一句是**赋值** `loan = trunc(身家 × f24 / 100)`，既不叠加
  //   也不查额度上限；本引擎的 `bankBorrow` 会按额度拦，故这里先夹一次，
  //   免得提一个必被拒的 action 把自己卡死。
  if (p.kind === 'bank') {
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    const want = Math.min(autoLoanAmount(p.wealth, me.loanRatio), p.loanCapacity);
    return want > 0 ? { type: 'bank', op: 'borrow', amount: want } : null;
  }
  // 樂透：有余钱就随便买一个号码。
  // ⚠️ 号码得**确定性**地挑：AI 不能碰随机源（那是 reducer 的事），
  //   故取可选号码里的第一个，而不是随机一个。原版 AI 是随机挑的，
  //   这是一处明确的策略差异，不影响规则。
  if (p.kind === 'lottery') {
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    const n = p.available[0];
    if (n === undefined) return null;
    // 留够安全垫再买，别为了一张彩票把自己买穿
    if (me.cash < p.price * 4) return null;
    return { type: 'lottery', number: n };
  }
  // ★ 設施：買/加蓋 按与買地同一套「留够安全垫」的口径；
  //   首建（选建筑种类）**不在这里**——原版 AI 是 `rand() % 4 + 1`，
  //   随机数不能进 AI，故 reducer 对电脑玩家直接抽（见 landOnFacility）。
  if (p.kind === 'buyFacility' || p.kind === 'upgradeFacility') {
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    const cost = p.kind === 'buyFacility' ? p.price : p.cost;
    // decidePending 拿不到 ctx.personality —— 与其余 pending 一样按默认性格算安全垫
    const personality = DEFAULT_PERSONALITY;
    const floor = reserveFloor(me, personality);
    const after = me.cash - cost;
    const affordable = after >= floor * (1 - personality.aggression);
    if (!affordable) return { type: 'declineDecision' };
    return p.kind === 'buyFacility' ? { type: 'buyFacility' } : { type: 'upgradeFacility' };
  }
  if (p.kind === 'buildFacility') {
    // 走到这里的只会是被托管的真人（电脑在 reducer 里已抽完）：照电脑的口味，
    // 不蓋公園，取可选里最小的非 0 种类 —— 确定性的
    const t = p.choices.find((c) => c !== 0) ?? p.choices[0];
    return t === undefined ? null : { type: 'buildFacility', facilityType: t };
  }
  if (p.kind === 'buyShares') {
    // 简单策略：留够安全垫，剩下的钱买得起多少买多少，且不超过企业余量。
    // ★ 这是**策略**不是规则——买不买、买多少原版由 AI 性格决定（M3），
    //   这里先给一个不会把自己买破产的保守解。
    if (p.unitPrice <= 0) return null;
    const spendable = Math.trunc(p.cash / 2);
    const want = Math.min(Math.trunc(spendable / p.unitPrice), p.available);
    return want > 0 ? { type: 'buyShares', shares: want } : null;
  }
  return null;
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

  // ★ 衰神/大衰神/死神附身时**一切消费都被拦**（`call 0x40fa61`），
  //   而 `canPurchase` 查的是另一处（土地公只挡买无主地）。
  //   AI 是纯函数：提一个 reducer 必拒的 action 会被原样重提，
  //   直接卡死在 awaitingDecision —— 与当初卡片那次是同一类事故。
  //   故这里先照 `purchase` 的规矩预演一遍。
  if (purchaseBlockedBy(me) !== null) return { type: 'declineDecision' };

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
