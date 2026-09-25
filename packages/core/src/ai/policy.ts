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

import { cardPassiveHolder } from '../rules/interaction.ts';
import { WatcomRng } from '../rng/watcom.ts';
import type { GameState } from '../state/types.ts';
import type { LandInfo } from '../loaders/map.ts';
import type { Action } from '../state/actions.ts';
import { canPurchase, canUpgrade, facilityIndexOf, housingIndexOf } from '../rules/land.ts';
import { isAiControlled } from '../state/types.ts';
import { canUseCard } from '../state/preview.ts';
import type { CardTarget } from '../cards/target.ts';
import {
  PLACEMENT_TOOLS,
  VEHICLE_TOOLS,
  buildOneLevel,
  placeObject,
  useVehicleTool,
} from '../rules/tool-effects.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import { pickFacingAt } from '../rules/teleport.ts';
import { canUpgradeFacility } from '../rules/facility.ts';
import { aiShouldPurchase } from '../rules/purchase.ts';
import { aiCommercialShareCount, aiPickConstructionTarget } from '../places/company.ts';
import { auctionActiveSeatCount, auctionAiChoice, auctionSeatWaitsForHuman } from '../rules/auction.ts';
import { DEFAULT_INITIAL_FUND } from '../rules/setup.ts';

/**
 * 本局的**开局资金档位** —— AI 买地保留额的基数。
 *
 * @source `aiShouldPurchase` 的基数就是全局 `[0x49908c]`（= `_rich4_game_initial_fund`），
 *   不是固定的 30 万。见 `state/types.ts` 的 `GameState.initialFund`。
 *   兜底用 `DEFAULT_INITIAL_FUND` 只为兼容「老存档/测试替身没这个字段」。
 */
function initialFundOf(state: { initialFund?: number }): number {
  return state.initialFund ?? DEFAULT_INITIAL_FUND;
}
import { CARDS, TOOLS } from '@rich4/data';
import { aiCanUseCards, aiCanUseTools, personalityAllowsLazy } from './personality.ts';
import {
  aiCardChoice,
  type AiRoll,
  cardLoopEsiAfterFill,
  cardsToConsider,
  type AiCardChoice,
  type CardAiView,
} from './card-policy.ts';
import { aiToolChoice, toolsToConsider, TOOL_RING_SALT, type AiToolChoice } from './tool-policy.ts';
import { aiRand } from './rand.ts';
import {
  allEffectiveFacilities,
  allEffectiveLands,
  effectiveFacility,
  effectiveLand,
  type MapTopology,
  orphanedAuction,
} from '../state/reduce.ts';
import { MAX_TOOL_ID, MIN_TOOL_ID, toolCount } from '../rules/tools.ts';
import { autoAction } from '../state/reduce.ts';
import { placementBlockedAt } from '../rules/object-landing.ts';

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
  /**
   * 地图拓扑。策略层只读 `nodes` / `lands` / `facilities` / `commercials` / `landscapes`
   * （`MapTopology` 那几项）—— 取 `MapTopology` 而不是 `Rich4Map`，是为了让 **reducer**
   * 也能在同一局面复算这一手（FU-2：reducer 里补掷时手上只有 `topo`）。
   */
  map: MapTopology;
  personality?: AiPersonality;
  /**
   * ★★ FU-2（2026-09-25 审计）：这一次决策的**真随机流**（`WatcomRng` 的包装）。
   *
   * 原版电脑那一支的每一次 `rand()`（出牌起点、個性闸门 `%3`、卡/道具判定里的 `%4`/`%n`、
   * 前瞻岔路、骰子数 `&1`）都走**全局序列**。生产路径（客户端 / 服务器 / reducer 的补掷）
   * 必传它 —— 流从 `state.rngState` 播种，掷完由调用方把末态写回；直接单测某个判定函数时
   * 才可以不给（那时退回 `aiRoll` 的确定性替身，见 `ai/rand.ts`）。
   */
  roll?: AiRoll;
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
 * 决定 AI 在当前局面下的下一个 action。
 *
 * 只在**需要决策**的阶段给出实质选择；其余阶段返回推进用的 action。
 * 返回 null 表示「此刻不该由 AI 动」（例如轮到人类）。
 */
export function decideAction(ctx: AiContext): Action | null {
  // ★★ FU-2（2026-09-25 审计）：没显式给流时**自己从 `state.rngState` 播种一条真随机流** ——
  //   原版电脑那一支的每次 `rand()` 都走全局序列，单机 / 联机 / reducer 的补掷必须同一条。
  //   流是本地的、用完即弃：掷掉的数由 `reduce` 的 `aiDecisionRollAdvance` 在**同一局面**
  //   上复算并写回。（显式传 `roll` 只留给想钉住某一串掷数的测试。）
  const ctx2: AiContext = ctx.roll === undefined ? { ...ctx, roll: localAiRoll(ctx.state) } : ctx;
  const { state, map } = ctx2;
  // ⚠️ 落点那两支（買地/買設施/加蓋）**不读性格** —— 原版那层是
  //   `fcn_0041d7d4` 的一条线，见 `rules/purchase.ts`。性格在
  //   `decideCard`/`decideTool`（`personalityAllows`）与借贷比例里起作用。
  // ★ 出局者的回合由引擎推进，不经过策略——见 state/reduce.ts 的 autoAction。
  //   放在 isAiTurn 之前：出局者恰恰**不满足** isAiControlled。
  const auto = autoAction(state);
  if (auto !== null) return auto;

  // ★ **只有一种情形要在 `isAiTurn` 之前接手竞价**：当前玩家已经出局
  //   （`orphanedAuction`）。竞价轮转判的是 `pending.seat`，与「轮到谁」无关，
  //   可它终究属于当前回合 —— 真人坐在桌上时那块屏才是驱动者，core 要让位
  //   （既有契约，见 `ai/policy.test.ts` 的「让位给屏」一条）。
  //   出局者这一边则**两头都没人管**：`autoAction` 不认竞价，屏也不会为出局者
  //   出现。破产清算的拍卖恰好开在这个缝里（破产者出局后仍是 currentPlayer），
  //   先前整局就停在 `awaitingDecision`（实测种子 42 第 1236 回合）。
  //   真人座位依旧不受影响：`auctionNextBid` 自己判 `isAiControlled`，
  //   是真人就返回 null，照旧交给屏。
  if (state.phase !== 'gameOver' && orphanedAuction(state)) {
    const p = state.pending;
    if (p !== null && p.kind === 'auction') {
      const bid = auctionNextBid(state, p);
      if (bid !== null) return bid;
    }
  }

  // ★★ 卡片路径里持卡人那一问（免費卡 / 嫁禍卡）归**持卡人**答，与轮到谁无关（core `actingSeat`）：
  //   持卡人是真人 ⇒ 交给他的屏（返回 null）；被託管了 ⇒ `null` 答复 = reducer 按电脑那一支判
  //   （随机数不能进 AI）。
  const holder = cardPassiveHolder(state.pending);
  if (holder >= 0 && state.phase === 'awaitingDecision') {
    const h = state.players[holder];
    if (h === undefined || !isAiControlled(h)) return null;
    return state.pending?.kind === 'freeCard'
      ? { type: 'answerFreeCard', use: null }
      : { type: 'answerScapegoat', target: null };
  }

  if (!isAiTurn(state)) return null;

  switch (state.phase) {
    case 'turnStart':
      // ★ 回合开始时挂着的还款提醒窗（真人开着窗被托管）先答掉，否则 `startTurn` 被原样退回、卡死
      if (state.pending?.kind === 'loanReminder') return decidePending(state, map);
      return { type: 'startTurn' };
    case 'awaitingRoll':
      // ★ 掷骰前的顺序照 0x00418dc6：买股 → 卖股 → [特別融資收回 → 公佈欄 → rand&1] → 用卡 | 用道具 → 掷骰
      //   ★★ 审计（provenance-ai-econ）：买股、卖股两步也挪进 reducer 的 aiAdvance —— 原版这两段
      //   都要掷全局 `rand()`（买股入口 `0x0042bf14` 每回合必掷），策略层碰不得随机数（C-DET-1）。
      //   这里在第 0、1 步只发 `aiNext`，由 reducer 按原版买 / 卖；第 2 步起才是策略的活。
      switch (state.aiStep) {
        case 0:
        case 1:
          return { type: 'aiNext' };
        case 2:
          return (state.aiBranch === 1 ? decideCard(ctx2) : decideTool(ctx2)) ?? { type: 'aiNext' };
        default:
          // ★ 第二十一份：起步前按 `fcn_004221c0` 改骰子数（VA 0x00418e70，紧接着才
          //   `0x00418e75 call 0x40dd1f` 起步）—— 背着定時炸彈、引信 < 15 只掷 1 颗等，见 `dice-policy.ts`。
          //   ★★ FU-2（2026-09-25 审计）：这一步**在 reducer 的 `aiAdvance` 第 3 步里算**
          //   （`0x4221c0` 一回合只算一次：前瞻岔路与 `rand()&1` 都掷全局流）；
          //   策略层到这里只剩「掷骰」这一手。
          return { type: 'rollDice' };
      }
    case 'moving':
      // ★ 路过銀行的 ATM 窗（`pending.kind === 'atm'`）只给**恰好** who_plays == 1 的真人开；
      //   走到这里说明他开着窗被托管了（60 s 没动 → AI 接管）—— 替他关窗（原版模态窗返回 0 = 不办），
      //   否则 `step` 会被 reducer 原样退回、AI 反复提同一手 → 卡死。
      if (state.pending?.kind === 'atm') return { type: 'declineDecision' };
      return { type: 'step' };
    case 'settling':
      return { type: 'settle' };
    case 'turnEnd':
      // 落点可能留下一个待决交互（例如落在上市企业上），先把它答掉。
      // ★ 拍賣例外：轮到真人举牌时 core 不替他把竞价「答掉」（那会清空 pending、
      //   把屏顶掉）。返回 null 让表现层收那一手 —— 见下面 awaitingDecision。
      if (state.pending?.kind === 'auction') return decidePending(state, map);
      return decidePending(state, map) ?? { type: 'endTurn' };

    case 'awaitingDecision': {
      // ★ 設施那三种（買/首建/加蓋）是 pending 而不是地块决策，先让 decidePending 答；
      //   只有真正的買地/盖房才轮到 decideAtLanding。
      const answered = decidePending(state, map);
      if (answered !== null) return answered;
      const kind = state.pending?.kind;
      // ★ 其余 pending（研究所面板、未实现的场所）**不能**掉进 decideAtLanding
      //   —— 那等于拿脚下那块地的决定去顶掉这个交互。引擎也拒这种张冠李戴
      //   （`buyLand` 必须 `pending.kind === 'buyLand'`），拒了就变成 AI 反复提
      //   同一个被拒的 action → 卡死。故这里退出这一格。
      if (kind === undefined || kind === 'buyLand' || kind === 'upgradeLand') {
        return decideAtLanding(state, map);
      }
      // ★ 拍賣同样**不能**回 `declineDecision`：那一条会把 pending 清空
      //   （`state/reduce.ts` 的 declineDecision），整场拍卖就此消失、卡白扣。
      //   `decidePending` 已经处理了「轮到电脑」那一手（返回 auctionBid），
      //   走到这里说明**轮到真人** —— 交给屏（`client/auction-screen.ts`）。
      if (kind === 'auction') return null;
      return { type: 'declineDecision' };
    }

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
 * 流程照原版 AI 回合的出牌段（VA 0x00441d09..0x00441e07）：
 *   1. `aiCanUseCards`（角色表 f22 bit0）；
 *   2. `cardsToConsider`：手牌 > 8 时从随机起点环形取 8 张；
 *   3. 每张先过個性闸门 `personalityAllows`（0x0041e69e），再问该卡的判定函数
 *      `aiCardChoice`（跳表 0x475324，见 card-policy.ts）；
 *   4. 第一张肯出的就打，**一回合最多一张**。
 *
 * ⚠️ 引擎目前接不住的目标（設施/股票/物件，Q-CARD-2）与 registry 尚未接线的卡
 *   会被 `willWork` 拦下，此时顺延到下一张 —— 原版会直接打出，属已知偏差。
 */
export function decideCard(ctx: AiContext): Action | null {
  const { state, map } = ctx;
  const me = state.players[state.currentPlayer];
  if (me === undefined || me.cards.length === 0) return null;
  // @source `test byte [player + 0x16], 1 / je 跳过`（VA 0x00441d09）
  //   角色表的 f22 第 0 位：这个 AI 会不会出牌
  if (!aiCanUseCards(me.aiFlags)) return null;

  const topo: MapTopology = map;
  const lands = allEffectiveLands(state, topo);
  const facilities = allEffectiveFacilities(state, topo);

  /**
   * ★ 出牌前**先空跑一遍规则**，只有确定会生效才真出。
   *
   * 这不是保险起见——是必须的：`useCard` 失败时 reduce 原样返回状态，
   * 而 AI 是纯函数（为了可回放，见 C-DET-4），下一帧会**再提议同一张牌**，
   * 于是活锁。既有的买地/盖房走的也是这条路子（问 `canPurchase`），
   * 出牌照办即可，规则仍只有 registry 一份。
   */
  const willWork = (cardId: number, target: CardTarget): boolean =>
    canUseCard(state, topo, cardId, target);

  // ★ 個性闸门（VA 0x0041e69e）：f7 − 個性 ≥ 2 从不、== 1 三分之一、≤ 0 照做
  //   ★ FU-2：那次 `rand() % 3` **只在差一档时掷**（`0x0041e6c9 cmp edx,1 / jne`），
  //   故用懒求值版本 —— 急切求值会多掷、与原版错位。
  const gated = (cardId: number): boolean => {
    const f7 = CARDS.find((c) => c.id === cardId)?.f7 ?? 0;
    return personalityAllowsLazy(f7, me.personality, () => gateRand(state, ctx.roll, cardId));
  };

  // @source 0x00441d4a：手牌 > 8 时 `rand() % 张数` 当起点
  const roll = aiRand(state, ctx.roll, 0x441d4a, me.cards.length);
  const hand = cardsToConsider(me.cards, roll);
  // 填表之后 `esi` 的残值 —— 漲價卡的設施一支会读到它（见 card-policy.ts 的 `zhangjia`）
  const cardLoopEsi = cardLoopEsiAfterFill(me.cards.length, me.cards.length > 8 ? roll % me.cards.length : 0);
  const view: CardAiView = {
    state,
    topo,
    meIndex: state.currentPlayer,
    me,
    lands,
    facilities,
    cardLoopEsi,
    ...(ctx.roll === undefined ? {} : { roll: ctx.roll }),
  };
  for (const cardId of hand) {
    if (!gated(cardId)) continue;
    const choice = aiCardChoice(cardId, view);
    if (choice === null) continue;
    const target = toCardTarget(choice, state.currentPlayer);
    if (willWork(cardId, target)) return { type: 'useCard', cardId, target };
  }
  return null;
}

/**
 * AI 目标 → 引擎目标。
 *
 * T-009：registry 已接得住設施（T-006 怪獸 / T-008 五卡）、股票（T-005
 * 紅黑卡）、物件（T-004 請神符），不再有任何类别返回 null —— Q-CARD-2
 * 的「接不住就顺延」过滤随之撤掉，判定函数说打就打（只剩 `willWork`
 * 空跑一道，那是防活锁，不是目标过滤）。
 *
 * 两个挂在 choice 上的附加参数在这里折进 CardTarget：
 * - 搶奪卡的 `stealCard` → player 目标的 `steal`（@source `[0x48be5c]`）；
 * - 改建卡的 `facilityType` → `none` 目标（打脚下設施）的 `facilityType`，
 *   或 facility 目标的 `buildType`（天使卡首建走后者）。
 */
export function toCardTarget(choice: AiCardChoice, meIndex: number): CardTarget {
  const t = choice.target;
  switch (t.kind) {
    case 'none':
      // ★ 改建卡（7）打在**脚下那栋設施**上时目标就是 `none`，种类单独挂在
      //   `facilityType` 上（原版 `[0x48be58]`，见 card-policy.ts 的 gaijian）。
      return choice.facilityType !== undefined
        ? { kind: 'none', facilityType: choice.facilityType }
        : { kind: 'none' };
    case 'self':
      return { kind: 'player', index: meIndex };
    case 'player':
      return choice.stealCard !== undefined
        ? { kind: 'player', index: t.index, steal: { kind: 'card', id: choice.stealCard } }
        : { kind: 'player', index: t.index };
    case 'land':
      return { kind: 'entity', entityId: t.landId };
    case 'facility':
      return choice.facilityType !== undefined
        ? { kind: 'facility', facilityId: t.facilityId, buildType: choice.facilityType }
        : { kind: 'facility', facilityId: t.facilityId };
    case 'stock':
      return { kind: 'stock', index: t.index };
    case 'object':
      return { kind: 'object', objectIndex: t.objectIndex };
  }
}

/**
 * 该不该用道具，用哪件。
 *
 * ★ 与出牌同理，这里只回答「值不值」；能不能用由 reduce 的
 *   `useToolAction` 说了算。
 *
 * 流程照原版 AI 回合的道具段（VA 0x00447f82 起，详见 ai/tool-policy.ts 头部）：
 *   1. `aiCanUseTools`（角色表 f22 bit1）；
 *   2. 扫 13 格道具栏收集持有的编号（**跳过 10 時光機**——原版跳过槽下标 9）；
 *   3. `toolsToConsider`：种类 > 4 时从随机起点**环形取 4 件**；
 *   4. 每件先过個性闸门（0x420e9a 前半，与卡片同一道），再问跳表判定
 *      `aiToolChoice`（0x475324 的 31..43 项）；
 *   5. 第一件肯用、且**预演能生效**的才真用，一回合最多一件。
 */
export function decideTool(ctx: AiContext): Action | null {
  const { state, map } = ctx;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  // @source `test byte [player + 0x16], 2 / je 跳过`（VA 0x00447f87）
  if (!aiCanUseTools(me.aiFlags)) return null;

  // @source 0x447fa1..0x447fea：扫 13 格道具栏（槽序即编号序），跳过時光機
  const owned: number[] = [];
  for (let id = MIN_TOOL_ID; id <= MAX_TOOL_ID; id++) {
    if (id === TOOL_TIME_MACHINE) continue;
    if (toolCount(state.tools, me.index, id) > 0) owned.push(id);
  }
  if (owned.length === 0) return null;

  const topo: MapTopology = map;
  const view: CardAiView = {
    state,
    topo,
    meIndex: state.currentPlayer,
    me,
    lands: allEffectiveLands(state, topo),
    facilities: allEffectiveFacilities(state, topo),
    ...(ctx.roll === undefined ? {} : { roll: ctx.roll }),
  };

  // ★ 同一道個性闸门也管道具（0x420e9a：f7 − 個性，≥2 从不、==1 时三分之一）
  //   ★ FU-2：与卡片同一句 `0x420eca call rand / idiv 3`，同样只在差一档时掷。
  const gatedTool = (toolId: number): boolean => {
    const f7 = TOOLS.find((t) => t.id === toolId)?.f7 ?? 0;
    return personalityAllowsLazy(f7, me.personality, () => gateRand(state, ctx.roll, 30 + toolId));
  };

  for (const toolId of toolsToConsider(owned, aiRand(state, ctx.roll, TOOL_RING_SALT, owned.length))) {
    if (!gatedTool(toolId)) continue;
    const choice = aiToolChoice(toolId, view);
    if (choice === null) continue;
    const action = toToolAction(toolId, choice, ctx);
    if (action !== null) return action;
  }
  return null;
}

/** 時光機的道具编号——AI 永不主动用（跳表项是 `xor eax,eax; ret`） */
const TOOL_TIME_MACHINE = 10;

/**
 * AI 的选择 → 引擎 action；预演不通过的给 null（顺延下一件）。
 *
 * ★ 与 decideCard 的 `willWork` 同一动机：AI 是纯函数，reduce 拒收会原样重提 →
 *   活锁（买地/卡片/机器人加盖都踩过）。原版判定过了就直接执行；本引擎
 *   「肯用但执行不了」时顺延下一件，属已知偏差，与 Q-CARD-2 同一类。
 */
function toToolAction(toolId: number, choice: AiToolChoice, ctx: AiContext): Action | null {
  const { state, map } = ctx;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  switch (choice.kind) {
    case 'plain':
      // 换乘同种车原版 `jmp 结束`、不消耗道具（useVehicleTool 的 ok:false）——那就别出
      if (VEHICLE_TOOLS.has(toolId) && !useVehicleTool(me, state.tools, toolId).ok) return null;
      return { type: 'useTool', toolId };
    case 'place': {
      const objectType = PLACEMENT_TOOLS.get(toolId);
      if (objectType === undefined) return null;
      // 没有空物件槽时 placeObject 拒收（槽按种类分区，见 rules/objects.ts）
      if (!placeObject(state.objects, choice.nodeId, objectType).ok) return null;
      // ★★ 引擎拒收「有人 / 惡人 / 物件」的格子（`reduce.ts` → `placementBlockedAt`，
      //   @source 0x00409f7c `test [node+0x24], 0xffff00`）。策略侧的候选本来就照原版
      //   （0x409ef9）滤掉了这些格；这里是**保险丝**：同判据再挡一道，少了它 `reduce` 会原样退回、
      //   AI 每次都重提同一个目标 ⇒ **活锁**（第九份 #4 那一轮实测 1..300 里 2 个种子卡死）。
      //   ★ 放在这个**唯一收口**上：`toToolAction` 是三种放置类道具所有分支的必经之路。
      if (placementBlockedAt(state, choice.nodeId)) return null;
      return { type: 'useTool', toolId, nodeId: choice.nodeId };
    }
    case 'missile':
      // fireMissile 只在目标节点不存在时拒收
      return map.nodes[choice.nodeId - 1] === undefined
        ? null
        : { type: 'useTool', toolId, nodeId: choice.nodeId };
    case 'dice':
      // 步数恒在 1..6 ⊂ isValidRemoteDice 的 1..18
      return { type: 'useTool', toolId, value: choice.steps };
    case 'build': {
      const node = map.nodes[choice.nodeId - 1];
      if (node === undefined) return null;
      const li = housingIndexOf(node.type);
      if (li !== null) {
        // ★ 种类/等级读**状态**（effectiveLand 已合并 landType）：改建卡把住宅翻成
        //   連鎖店之后模板还是 0，读模板会预演出「能盖」而被 reducer 拒掉
        const land = effectiveLand(state, map, li);
        if (land === null) return null;
        return buildOneLevel(land.type, land.level, MAX_LAND_LEVEL).ok
          ? { type: 'useTool', toolId, nodeId: choice.nodeId }
          : null;
      }
      const fi = facilityIndexOf(node.type);
      if (fi === null) return null;
      const fac = effectiveFacility(state, map, fi);
      if (fac === null) return null;
      // 与 freeBuildFacilityById 同口径：0 级走「定种类首建」，其余查种类上限
      if (fac.level !== 0 && !canUpgradeFacility(fac.type, fac.level)) return null;
      return { type: 'useTool', toolId, nodeId: choice.nodeId };
    }
    case 'teleportSelf': {
      // teleportPlayer 的两种拒收：原地不动 / 目标格没有可走的朝向
      if (choice.nodeId === me.nodeId) return null;
      if (pickFacingAt(map.nodes, choice.nodeId, me.direction) === null) return null;
      // 搬人那一路：source = 玩家下标 + 1，target = 节点号（rules/teleport.ts）
      return { type: 'useTool', toolId, nodeId: me.index + 1, value: choice.nodeId };
    }
  }
}

/** 从 `state.rngState` 播种一条本地真随机流（生产路径的默认值，见 `decideAction`） */
function localAiRoll(state: GameState): AiRoll {
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  return () => rng.next();
}

/**
 * 闸门里那次 `rand() % 3`（`0x0041e6ce call 0x456f2d / idiv 3`）——
 * 有真随机流就掷它，没有才退回替身（`ai/rand.ts` 的 `aiRand`）。记 D-004 / FU-2。
 */
function gateRand(state: GameState, roll: AiRoll | undefined, action: number): number {
  return aiRand(state, roll, action, 3);
}

/**
 * 拍賣：轮到 `pending.seat` 上那一位时，他这一口怎么出（电脑）。
 *
 * @source 拍賣窗口的刷新循环 `loc_0043c4f5` 一带：
 *   1. `test byte [player + 0x15], 6 / je` 判**是不是电脑**（真人那支等点钮）；
 *   2. `word [0x48c436 + 槽] == 0` 判**这一家还没出过价**；
 *   3. `fcn_00439f0d(实体编码, 玩家)` 的心理价位 + `loc_0043b124` 挑档
 *      + `loc_0043b183` 压价 → 一口。
 *
 * ⚠️ **判的是 `pending.seat`，不是 `currentPlayer`**：原版的竞价轮转与回合
 *   玩家无关（整场拍卖挂在出卡人那个回合里，四家轮流举牌）。
 * ⚠️ 真人座位返回 `null` —— 他在屏上自己点钮（`client/auction-screen.ts`
 *   收那一手，`auctionBid` 送回 core 落账）。
 *
 * 导出是**故意的**：屏上那条「电脑那一手」也走这一个函数
 * （不能两条循环各算各的 —— 那是 Q-AUC-1 要消掉的风险）。
 */
export function auctionNextBid(
  state: GameState,
  pending: Extract<NonNullable<GameState['pending']>, { kind: 'auction' }>,
): Action | null {
  const bidder = pending.bidders[pending.seat];
  if (bidder === undefined) return null;
  // @source `word [0x48c436 + 槽] == 0` —— 出过价 / 放弃过的座位不再轮到他
  if ((pending.status[bidder] ?? 'active') !== 'active') return null;
  const who = state.players[bidder];
  // 出局者没有座位（`0x0043c11f cmp byte [p+0x15],0`）
  if (who === undefined || who.whoPlays === 0) return null;
  // ★ 2026-09-25 审计订正（AUC-22 / AUC-23）：出价那一刻判真人用的是**整字节 == 1**
  //   （`0x0043b001 cmp byte [p+0x15], 1 / jne 0x43b0a0`）—— 带走回棋盘 0x10 / 被挪 0x20 位的真人走**电脑支**
  //   （开拍时没给他算心理价位 ⇒ 限价 0 ⇒ 出得起就 PASS）。
  //   真人那一支还先看钱：`0x0043b06c mov edx,[现价] / cmp edx,[現金] / jle 0x43b08a`（等他点），
  //   否则 `0x0043b07a..0x0043b085` 直接替他按「放棄」（钮 6）——先前会一直等一个只能 PASS 的穷真人。
  if (auctionSeatWaitsForHuman(who, pending.price)) return null;
  if (who.whoPlays === 1) return { type: 'auctionBid', bidder, status: 'giveUp', step: 0 };
  // @source `loc_0043b183` 的压价线：最高出价者现金 + 500（出价时记下的快照）
  const topWho = pending.top < 0 ? undefined : state.players[pending.top];
  const choice = auctionAiChoice({
    limit: pending.limits[bidder] ?? 0,
    price: pending.price,
    cash: who.cash,
    topCash: topWho === undefined ? null : pending.topCash,
    // @source 0x43b219 `cmp byte [0x48c4b1],1 / mov ebx,1`：只剩一个可出价座位时
    //   档位被压成最小档。`0x48c4b1` 全场只在开拍时写一次 ⇒ 必须用**开拍时**的底价与座位
    //   （`0x43a36c` 抄的是 `0x113` 的实参）。
    activeSeats: auctionActiveSeatCount(
      state.players,
      pending.bidders,
      pending.basePrice,
      pending.seller ?? -1,
    ),
  });
  return { type: 'auctionBid', bidder, status: choice.kind, step: choice.step };
}

/**
 * 回答落点留下的待决交互。
 *
 * ⚠️ 只处理**已实现**的那几种；其余返回 null，由调用方继续推进回合——
 *   未实现的场所会以 `unimplemented` 留在 `pending` 里，上层看得见。
 */
export function decidePending(state: GameState, map?: MapTopology): Action | null {
  const p = state.pending;
  if (p === null) return null;
  // ★ 落点那台 ATM（`landing`，phase = turnEnd）只给**恰好** who_plays == 1 的真人开；走到这里说明他开着窗
  //   被托管了 —— 与路过那台同样替他关窗（模态窗返回 0 = 不办），core 随即换成貸款屏再由下面那支答。
  //   不答的话调用方会发 `endTurn`，把 ATM 连同后面的貸款屏一起跳掉。
  if (p.kind === 'atm') return { type: 'declineDecision' };
  // ★★ 第二十六份：电脑 / 托管**不会**再收到 `pending{shop}` —— 原版那一支当场买卖完就走
  //   （`0x0042ea2b cmp byte [player+0x15], 1 / jne 0x42ed8d`，见 `places/ai-shop.ts`，reducer 的 `enterShop` 直接跑）。
  //   走到这里的只会是**开着商店窗被托管的真人**：原版的窗口是模态的、托管位在窗里不会冒出来 ⇒
  //   按「关窗」处理（返回 null，调用方发 `declineDecision`），不替他花點券。
  //   （先前这里是自拟的「车优先、點券全花」—— 150 點就买汽車，原版要 ≥ 461 點才轮得到，已删。）
  if (p.kind === 'shop') return null;
  // ★ 拍賣（Q-AUC-1）：竞价循环归 core —— 这一支按原版拍賣窗口的刷新循环
  //   （`loc_0043c4f5` 一带）决定**这一口**加价多少 / PASS。
  //   座位状态、心理价位、现价、轮到谁都在 `pending` 里（reduce 开拍时建好）。
  if (p.kind === 'auction' && 'seat' in p) return auctionNextBid(state, p);
  // ★ 小游戏：AI 从来不玩（原版 `who_plays != 1` 直接走「不玩」出口）。
  //   真人被托管时也走这条——托管的意思就是让 AI 替你打，不该弹出玩法。
  if (p.kind === 'minigame') return { type: 'minigame', score: null };
  // ★ 魔法屋：电脑在原版里**不开女巫窗口**（`0x0043381b cmp [player+0x15],1 / jne 0x43390b`），
  //   两个转盘都 rand() —— 走到这里的只会是**被託管的真人**（窗口已挂出）。
  //   `option: null` = 让 reducer 按电脑那一支掷效果（随机数不能进 AI）。
  if (p.kind === 'magicHouse') return { type: 'magicHouse', option: null };
  // ★ 第十四份：收費那一段的被动卡 —— 走到这里的只会是**被託管的真人**（电脑那一支在 reducer 里当场判完）。
  //   `null` = 让 reducer 按电脑那一支判（`aiUsesFreeCard` / `aiScapegoat`，随机数不能进 AI）。
  if (p.kind === 'freeCard') return { type: 'answerFreeCard', use: null };
  if (p.kind === 'scapegoat') return { type: 'answerScapegoat', target: null };
  // ★ 保釋：电脑玩家那条路在 reducer 里就掷完了（`enterVisit`，`0x0043d3d8` 起 rand&1 / 個性 / rand%n），
  //   走到这里的只会是**开着保釋窗被托管的真人**。
  //   ★★ 审计（ai-move）：先前这里是自拟的「挑最便宜的、救得起的同伴」—— 原版没有这条规则。
  //   原版保釋窗（`0x0043d33e..0x0043d3d3`）是模态的，托管位在窗里冒不出来；与商店 / ATM 同一口径
  //   按「关窗 = 不保釋」处理（窗口的離開键，不花點券）。
  if (p.kind === 'bail') return { type: 'declineDecision' };
  // ★ 貸款屏：电脑（与托管）**收不到**这一扇 —— 原版 `0x004366a3 cmp byte [+0x15],1 / jne 0x4367ab`
  //   让它们当场走电脑那一支（提前还贷 / `rand()%10` 放款，reducer 的 `aiBankRoom`），不开窗。
  //   走到这里的只会是**开着貸款屏被托管的真人** —— 托管就是由电脑代打 ⇒ 按电脑那一支替他办完
  //   （`op: 'auto'`，随机数在 reducer 里掷）。
  if (p.kind === 'bank') return { type: 'bank', op: 'auto', amount: 0 };
  // ★ 还款提醒窗（`0x436034`）：只有「恰好真人」才开，窗里没有任何选择 —— 被托管就替他关窗，
  //   core 随即走完这一天的回合边界（`0x41c84f` 的其余部分）。
  if (p.kind === 'loanReminder') return { type: 'declineDecision' };
  // 樂透**没有**分支：电脑在原版里根本没得挑（`rich4_ui_letou_bar_entry`
  // 的电脑那支一口气买完、不弹屏），所以它在落点当场就结掉了 —— 见
  // `state/reduce.ts` 的 `landOnLottery`，号码与是否出手都由 reducer 定
  // （@source VA 0x0043169e：现金 > 1000 才买，号码 `rand() % 未售出数`）。
  // ★ 故电脑永远收不到 `kind: 'lottery'` 的待决交互。
  // ★ 買設施与買地**同一条判定**（原版两家都 `push 价; call fcn_0041d7d4`）：
  //   0x0041a8d1 是設施那支，0x0041a0c0 是地块那支。
  //   加蓋（`upgradeFacility`）原版**没有**这条判定 —— 落点那条分支里
  //   够钱扣款就盖（见 `landOnFacility`），故这里也不额外设门槛。
  //   ★ 首建（选建筑种类）**不在这里**——原版 AI 是 `rand() % 4 + 1`，
  //   随机数不能进 AI，故 reducer 对电脑玩家直接抽（见 landOnFacility）。
  if (p.kind === 'buyFacility') {
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    return aiShouldPurchase(me, p.price, initialFundOf(state), state.priceIndex)
      ? { type: 'buyFacility' }
      : { type: 'declineDecision' };
  }
  if (p.kind === 'upgradeFacility') {
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    return { type: 'upgradeFacility' };
  }
  if (p.kind === 'chooseBuildTarget') {
    // ★★ 审计（provenance-ai-econ）：走到这里的只会是**开着选地窗被托管的真人**（电脑在 reducer 里当场挑）。
    //   原版那扇窗是模态的、托管位冒不出来，没有「窗开着被托管」这回事 ⇒ 按座位现在的身份走**电脑那一支**：
    //   `0x0041ad12 call 0x40b455`（自家公司 `0x0041aa3c` 同一个函数）—— 自己的住宅地挑当前等级租金最高的、
    //   設施挑地價最高的（`aiPickConstructionTarget`）。先前这里是自拟的「取第一个可选」。
    //   挑不出（或不在可选里）就关窗。
    if (map === undefined) return { type: 'declineDecision' };
    const t = aiPickConstructionTarget(
      state.currentPlayer, map.lands ?? [], state.landOwner, state.landLevel, state.landType,
      map.facilities ?? [], state.facilityOwner, state.facilityLevel, state.facilityType,
    );
    return t !== 0 && p.choices.includes(t) ? { type: 'buildTarget', entityId: t } : { type: 'declineDecision' };
  }
  if (p.kind === 'buildFacility') {
    // ★★ 审计（provenance-ai-econ）：同上，只会是**开着选种类窗被托管的真人**。按电脑那一支定种类
    //   （付费首建 `0x0041a23e` / 神明代蓋 `0x0040b1c5`：`rand()%4+1`）—— 随机数不能进 AI，交 `null` 由 reducer 掷。
    //   先前这里是自拟的「不蓋公園、取最小的非 0 种类」（恒为旅館）。
    return { type: 'buildFacility', facilityType: null };
  }
  if (p.kind === 'buyShares') {
    // ★ 照原版电脑那支（pt27-stock「忍太郎怎么一下就买了3000股保险公司？」）：
    //   `0x0041d267 push esi / push ecx / call 0x41d839` —— 上限 esi 就是真人填数窗那个
    //   `min(1000, 現金 ÷ 單價, 企業餘量)`（`p.max`），再扣 30% 开局资金×物價 的安全垫。
    //   先前这里是自拟的「现金一半能买多少买多少、只夹企業餘量」，一口气买下 3000 股。
    const me = state.players[state.currentPlayer];
    if (me === undefined) return null;
    const n = aiCommercialShareCount(p.unitPrice, p.max, me.cash, initialFundOf(state), state.priceIndex);
    // `0x0041d273 test edi, edi / je 0x41d2bb` —— 0 股 = 不买
    return n > 0 ? { type: 'buyShares', shares: n } : { type: 'declineDecision' };
  }
  return null;
}


/**
 * 落点决策：买地 / 盖房 / 放弃。
 *
 * ⚠️ 这里**不重复实现规则**——能不能买、要花多少钱一律问 `canPurchase`
 * 与 `canUpgrade`；「买不买」这一问，原版有**专门的一条判定**（见下）。
 *
 * ★ 原版落点里电脑那两支（`0x0041a0c0` 地块 / `0x0041a8d1` 設施）问的是
 *   `fcn_0041d7d4(价)`，加蓋那两支（`loc_004198b9` 自有地 / `loc_0041a2b3`
 *   设施）**根本不问**——`价 > 现金` 才放弃，够钱就扣钱盖。
 *   故这里也照办：買地/買設施 过 `aiShouldPurchase`，加蓋只看 `canUpgrade`。
 *   ⚠️ 原版这一层**没有性格、没有"值不值得"**（`fcn_0041d7d4` 只收一个价），
 *   早先那套 `landAttractiveness` + `reserveFloor` 是自造的，已去掉。
 */
export function decideAtLanding(state: GameState, map: MapTopology): Action {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return { type: 'declineDecision' };
  const node = map.nodes[me.nodeId - 1];
  if (node === undefined) return { type: 'declineDecision' };

  const idx = housingIndexOf(node.type);
  if (idx === null) return { type: 'declineDecision' };

  const tpl = (map.lands ?? []).find((l) => l.id === idx);
  if (tpl === undefined) return { type: 'declineDecision' };

  const land: LandInfo = {
    ...tpl,
    owner: state.landOwner[idx] ?? 0,
    level: state.landLevel[idx] ?? 0,
  };

  // ★★ 2026-09-24（第十九份试玩回报「小衰神显灵投资失败的弹窗没显示」）：
  //   这里原先有一道「衰神/大衰神/死神附身 ⇒ 直接放弃」的短路 —— 那是当年 reducer
  //   **拒收**被拦的 `buyLand` 时防卡死用的。现在 reducer 把被拦的消费收成
  //   「弹 `god.blockPurchase` + 回合结束」（`godBlockedPurchase`），短路反而让电脑
  //   **永远不去碰** `0x40fa61`，那扇「%s顯靈 投資失敗！」就再也弹不出来。
  //   原版电脑两支都是**先照常决定、再过衰神闸**：
  //   - 買地 `0x0041a089 call 0x41d7d4`（想买 ⇒ edi=1）→ `0x0041a0c7 call 0x40fa61`；
  //   - 加蓋 `0x00419976 test [player+0x15],6 / jne 0x4199a7` → `0x004199ae call 0x40fa61`
  //     （电脑不问，够钱就直接进闸）。
  //   故这里不再预演 `purchase`，照常出手，由 reducer 弹框收场。
  const buy = canPurchase(land, me, state.priceIndex);
  if (buy.ok && aiShouldPurchase(me, buy.price, initialFundOf(state), state.priceIndex)) {
    return { type: 'buyLand' };
  }

  // @source loc_004198b9 自有地分支：够钱就盖，不留保留额
  if (canUpgrade(land, me, state.priceIndex).ok) return { type: 'upgradeLand' };

  return { type: 'declineDecision' };
}
