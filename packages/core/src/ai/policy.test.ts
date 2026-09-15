/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 电脑玩家决策
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, type Rich4Map } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from '../state/reduce.ts';
import {
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_HUMAN,
  type Player,
} from '../state/types.ts';
import {
  DEFAULT_PERSONALITY,
  auctionNextBid,
  decideAction,
  decideAtLanding,
  isAiTurn,
  toCardTarget,
} from './policy.ts';
import type { AiCardChoice } from './card-policy.ts';
import { useCard, type UseCardContext } from '../cards/registry.ts';
import { initialSpecialActors } from '../rules/special-actors.ts';
import { STOCK_COUNT } from '../rules/wealth.ts';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const allComputer = () =>
  [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

describe('轮到谁', () => {
  run('全电脑局里每一手都该 AI 出', () => {
    const map = loadMap();
    const state = newGame({ map, players: allComputer() });
    expect(isAiTurn(state)).toBe(true);
  });

  run('人类回合 AI 不出手', () => {
    const map = loadMap();
    const state = newGame({
      map,
      players: [
        { character: 0, kind: 'human' },
        { character: 1, kind: 'computer' },
      ],
    });
    expect(isAiTurn(state)).toBe(false);
    expect(decideAction({ state, map })).toBeNull();
  });

  run('★ 被托管的人类也由 AI 接手（whoPlays 比特 2）', () => {
    const map = loadMap();
    const state = newGame({ map, players: [{ character: 0, kind: 'human' }, { character: 1, kind: 'computer' }] });
    state.players[0]!.whoPlays = WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT;
    expect(isAiTurn(state)).toBe(true);
  });
});

/**
 * ★ 落点的买地判定照原版 `fcn_0041d7d4`，**不是**评分。
 *
 * @source VA 0x0041d7d4：
 *   `保留额 = min(trunc(开局资金 × 0.05), 7000) × 物价指数`，
 *   `现金 + 存款 − 价 > 保留额` 才买。默认开局资金 300000 → 15000 → **封顶 7000**。
 * ⚠️ 早先这里用 `landAttractiveness`（同区协同评分）+ 性格保留额，两样都是自造的。
 */
describe('★ 买地判定：一条「买完还剩多少」的线', () => {
  const LAND = 1;
  const topo: Rich4Map = {
    nodes: [makeNode({ id: 1, adjacent: [1], type: 0x7d0 + LAND, ref: { kind: 'land', index: LAND } })],
    lands: [makeLand({ id: LAND, name: '測試地', landPrice: 1000, housePrice: 200 })],
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  };
  // 价 = 地價 × 物價 = 1000
  const at = (over: Partial<Player> = {}) =>
    makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, cash: 0, moneyInBank: 0, ...over })],
      phase: 'awaitingDecision',
    });

  it('恰好等于保留额 → 不买（原版是 `jle`，边界归不买）', () => {
    expect(decideAtLanding(at({ cash: 8000 }), topo)).toEqual({ type: 'declineDecision' });
  });

  it('多一块钱 → 买', () => {
    expect(decideAtLanding(at({ cash: 8001 }), topo)).toEqual({ type: 'buyLand' });
  });

  it('★ 存款算作垫底：现金刚够付价，靠存款过线', () => {
    expect(decideAtLanding(at({ cash: 1000, moneyInBank: 7001 }), topo)).toEqual({ type: 'buyLand' });
  });

  it('现金不够付价 → 放弃（这一条是 canPurchase 挡的，先于上面那条判定）', () => {
    expect(decideAtLanding(at({ cash: 999, moneyInBank: 999_999 }), topo)).toEqual({
      type: 'declineDecision',
    });
  });

  it('★ 原版那一层没有性格：换性格不改买地结论', () => {
    // 同一个局面，两种性格（激进度/保留额）都得到同一答案 —— 判定只读钱
    const s = at({ cash: 8001, whoPlays: WHO_PLAYS_COMPUTER });
    const timid = decideAction({ state: s, map: topo, personality: { aggression: 0, cashReserve: 0.9 } });
    const bold = decideAction({ state: s, map: topo, personality: { aggression: 1, cashReserve: 0 } });
    expect(timid).toEqual({ type: 'buyLand' });
    expect(bold).toEqual({ type: 'buyLand' });
  });
});

describe('★ AI 产出的是普通 action，引擎照常消费', () => {
  run('全电脑局能连续自走多个回合而不卡死', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    let state = newGame({ map, players: allComputer(), seed: 7 });

    let steps = 0;
    for (; steps < 4000; steps++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      const next = reduce(state, a, topo);
      // 决策若不能推进状态，说明 AI 给了一个非法 action —— 应当暴露
      if (next === state) throw new Error(`AI 在 ${state.phase} 给出无效 action ${a.type}`);
      state = next;
      if (state.turnCount >= 40) break;
    }

    expect(state.turnCount).toBeGreaterThanOrEqual(40);
    expect(steps).toBeLessThan(4000);
  });

  run('★ 同一种子跑两遍结果完全一致（确定性）', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const play = () => {
      let s = newGame({ map, players: allComputer(), seed: 99 });
      for (let i = 0; i < 600; i++) {
        const a = decideAction({ state: s, map });
        if (a === null) break;
        s = reduce(s, a, topo);
        if (s.turnCount >= 20) break;
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(a.players.map((p) => [p.cash, p.moneyInBank, p.nodeId])).toEqual(
      b.players.map((p) => [p.cash, p.moneyInBank, p.nodeId]),
    );
    expect(a.landOwner).toEqual(b.landOwner);
    expect(a.rngState).toBe(b.rngState);
  });

  run('★ 跑完之后确实买下了地——不是一路放弃', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    let state = newGame({ map, players: allComputer(), seed: 3 });
    for (let i = 0; i < 3000; i++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      state = reduce(state, a, topo);
      if (state.turnCount >= 60) break;
    }
    const owned = state.landOwner.filter((v) => v !== 0).length;
    expect(owned).toBeGreaterThan(0);
  });
});

describe('性格', () => {
  it('默认性格取值合理', () => {
    expect(DEFAULT_PERSONALITY.aggression).toBeGreaterThan(0);
    expect(DEFAULT_PERSONALITY.aggression).toBeLessThanOrEqual(1);
    expect(DEFAULT_PERSONALITY.cashReserve).toBeGreaterThan(0);
    expect(DEFAULT_PERSONALITY.cashReserve).toBeLessThanOrEqual(1);
  });

  // ⚠️ 这里原本有一条「激进的 AI 比保守的买得多」。
  //   原版落点的买地判定（`fcn_0041d7d4`）**不读性格**，那条断言已不成立，
  //   故删掉 —— 性格仍然作用于用卡/用道具（`personalityAllows`）与借贷比例。
});

// ============================================================
//  ★ 掷骰前的调度顺序 @source VA 0x00418dc6
// ============================================================

describe('★ 电脑回合掷骰前的调度步（aiStep）', () => {
  const topoOf = (map: ReturnType<typeof loadMap>) => ({ nodes: map.nodes, lands: map.lands, commercials: map.commercials });

  run('买股 → 卖股 → 用卡|用道具 → 掷骰，每步至多一个 action，真人不走这套', () => {
    const map = loadMap();
    const topo = topoOf(map);
    let s = newGame({ map, players: allComputer(), seed: 5 });
    s = reduce(s, { type: 'startTurn' }, topo);
    expect(s.phase).toBe('awaitingRoll');
    expect(s.aiStep).toBe(0);
    const seen: string[] = [];
    for (let guard = 0; guard < 12 && s.phase === 'awaitingRoll'; guard++) {
      const a = decideAction({ state: s, map });
      if (a === null) throw new Error('awaitingRoll 没有决策');
      seen.push(`${s.aiStep}:${a.type}`);
      const next = reduce(s, a, topo);
      if (next === s) throw new Error(`第 ${s.aiStep} 步的 ${a.type} 没生效`);
      s = next;
    }
    // 最后一定是掷骰，且掷骰前 aiStep 已到 3
    expect(seen[seen.length - 1]).toMatch(/^3:rollDice$/);
    // 步数单调不减
    const steps = seen.map((x) => Number(x.split(':')[0]));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]!);
    expect(s.phase).toBe('moving');
  });

  it('aiNext：只有电脑在 awaitingRoll 时合法；真人/别的阶段原样返回', () => {
    const human = makeGameState({ phase: 'awaitingRoll' });
    expect(reduce(human, { type: 'aiNext' }, { nodes: [] })).toBe(human);
    const ai = makeGameState({
      phase: 'awaitingRoll',
      players: [0, 1].map((i) => makePlayer({ index: i, whoPlays: 2 })),
    });
    expect(reduce(ai, { type: 'aiNext' }, { nodes: [] }).aiStep).toBe(1);
    const moving = { ...ai, phase: 'moving' as const };
    expect(reduce(moving, { type: 'aiNext' }, { nodes: [] })).toBe(moving);
  });

  it('★ 跨进第 2 步时才掷 rand()&1 定用卡还是用道具，且只掷一次', () => {
    const ai = makeGameState({
      phase: 'awaitingRoll',
      players: [0, 1].map((i) => makePlayer({ index: i, whoPlays: 2 })),
      rngState: 12345,
    });
    const s1 = reduce(ai, { type: 'aiNext' }, { nodes: [] });
    expect(s1.rngState).toBe(ai.rngState); // 0 → 1 不碰随机
    const s2 = reduce(s1, { type: 'aiNext' }, { nodes: [] });
    expect(s2.aiStep).toBe(2);
    expect(s2.rngState).not.toBe(s1.rngState);
    expect([0, 1]).toContain(s2.aiBranch);
    const s3 = reduce(s2, { type: 'aiNext' }, { nodes: [] });
    expect(s3.aiStep).toBe(3);
    expect(s3.rngState).toBe(s2.rngState); // 2 → 3 不再掷
    // 第 2 步：策略只在 aiBranch 对应的那一侧找
    const a = decideAction({ state: { ...s2, aiBranch: 1 }, map: { nodes: [], lands: [], facilities: [], commercials: [], landscapes: [], dataSize: 0 } as never });
    expect(a).toEqual({ type: 'aiNext' }); // 没牌可出 → 推进
    expect(decideAction({ state: s3, map: { nodes: [], lands: [], facilities: [], commercials: [], landscapes: [], dataSize: 0 } as never })).toEqual({ type: 'rollDice' });
  });

  it('★ 特別融資收回：跨进第 2 步时，不是銀行董事長却欠着的人当场全额扣回 @source 0x00436c6d', () => {
    const s = makeGameState({
      phase: 'awaitingRoll',
      players: [0, 1, 2].map((i) =>
        makePlayer({ index: i, whoPlays: 2, cash: 1000, moneyInBank: 3000, specialFinance: i === 1 ? 2500 : 0 }),
      ),
      aiStep: 1,
    });
    // 没有銀行企業 → 没有董事長 → 人人都收
    const after = reduce(s, { type: 'aiNext' }, { nodes: [] });
    expect(after.aiStep).toBe(2);
    expect(after.players[1]).toMatchObject({ specialFinance: 0, moneyInBank: 500, cash: 1000 });
    expect(after.players[0]).toMatchObject({ moneyInBank: 3000 });
  });

  it('特別融資收回：存款不够动现金；现金也不够就破產', () => {
    const s = makeGameState({
      phase: 'awaitingRoll',
      players: [0, 1].map((i) =>
        makePlayer({ index: i, whoPlays: 2, cash: 100, moneyInBank: 50, specialFinance: i === 1 ? 120 : 0 }),
      ),
      aiStep: 1,
    });
    const partial = reduce(s, { type: 'aiNext' }, { nodes: [] });
    expect(partial.players[1]).toMatchObject({ moneyInBank: 0, cash: 30, specialFinance: 0 });
    const broke = reduce({ ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, specialFinance: 500 } : p)) }, { type: 'aiNext' }, { nodes: [] });
    expect(broke.players[1]!.whoPlays).toBe(0);
  });
});

describe('★ T-009：toCardTarget 覆盖全部目标类型，AI 选中 → useCard ok', () => {
  // 一个能接住各目标类别的 useCard 场景
  const stock = () => ({
    price: 100, shares: 10_000, f10: 10_000, commercialIndex: 0, f6: 0,
    newsFlag: 0, basePrice: 100, openPrice: 100, volatility: 1, trend: 0, shock: 0,
  });
  const ctx = (over: Partial<UseCardContext> = {}): UseCardContext => ({
    players: [
      makePlayer({ index: 0, cash: 10000, cards: [12, 13, 23, 24] }),
      makePlayer({ index: 1, cash: 2000, cards: [9] }),
    ],
    lands: [makeLand({ id: 1, name: '台北市' })],
    nodes: [makeNode({ id: 1, type: 1 })],
    currentPlayer: 0,
    priceIndex: 1,
    tools: new Array<number>(60).fill(0),
    toolStock: new Array<number>(14).fill(0),
    objects: [{ type: 0, nodeId: 5, state: 0, attached: 0 }],
    market: { stocks: Array.from({ length: STOCK_COUNT }, stock), day: 0, history: [], index: 1000 },
    marketOpen: true,
    facilities: [makeFacility({ id: 1, type: 1, level: 2, owner: 2 })],
    actors: initialSpecialActors(),
    ...over,
  });

  it('none / self / player / land 照旧映射', () => {
    expect(toCardTarget({ target: { kind: 'none' } }, 0)).toEqual({ kind: 'none' });
    expect(toCardTarget({ target: { kind: 'self' } }, 2)).toEqual({ kind: 'player', index: 2 });
    expect(toCardTarget({ target: { kind: 'player', index: 1 } }, 0)).toEqual({ kind: 'player', index: 1 });
    expect(toCardTarget({ target: { kind: 'land', landId: 3 } }, 0)).toEqual({ kind: 'entity', entityId: 3 });
  });

  it('★ 不再有任何类别返回 null（Q-CARD-2 的顺延过滤撤掉）', () => {
    const choices: AiCardChoice[] = [
      { target: { kind: 'facility', facilityId: 1 } },
      { target: { kind: 'stock', index: 0 } },
      { target: { kind: 'object', objectIndex: 1 } },
      { target: { kind: 'player', index: 1 }, stealCard: 9 },
    ];
    for (const c of choices) expect(toCardTarget(c, 0)).not.toBeNull();
  });

  it('搶奪卡：stealCard 折进 player 目标的 steal，useCard ok', () => {
    const t = toCardTarget({ target: { kind: 'player', index: 1 }, stealCard: 9 }, 0);
    expect(t).toEqual({ kind: 'player', index: 1, steal: { kind: 'card', id: 9 } });
    expect(useCard(ctx(), 13, t).ok).toBe(true);
  });

  it('設施目标：拆除卡 useCard ok；facilityType 折成 buildType', () => {
    const t = toCardTarget({ target: { kind: 'facility', facilityId: 1 } }, 0);
    expect(t).toEqual({ kind: 'facility', facilityId: 1 });
    expect(useCard(ctx(), 12, t).ok).toBe(true);
    expect(toCardTarget({ target: { kind: 'facility', facilityId: 1 }, facilityType: 2 }, 0))
      .toEqual({ kind: 'facility', facilityId: 1, buildType: 2 });
  });

  it('股票目标：紅卡 useCard ok', () => {
    const t = toCardTarget({ target: { kind: 'stock', index: 3 } }, 0);
    expect(t).toEqual({ kind: 'stock', index: 3 });
    expect(useCard(ctx(), 24, t).ok).toBe(true);
  });

  it('物件目标：請神符 useCard ok', () => {
    const t = toCardTarget({ target: { kind: 'object', objectIndex: 1 } }, 0);
    expect(t).toEqual({ kind: 'object', objectIndex: 1 });
    expect(useCard(ctx(), 23, t).ok).toBe(true);
  });
});

// ============================================================
//  ★ Q-AUC-1：拍賣那一手 —— 电脑必须出价/PASS，而不是退出这一格
// ============================================================

describe('★ 拍賣：电脑那一手不再走 declineDecision', () => {
  const LAND = 1;
  const topo: Rich4Map = {
    nodes: [
      makeNode({
        id: 1,
        adjacent: [1],
        type: 0x7d0 + LAND,
        ref: { kind: 'land', index: LAND },
      }),
    ],
    lands: [makeLand({ id: LAND, name: '測試地', landPrice: 3000, housePrice: 500, owner: 1 })],
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  };

  /**
   * 手搭一个完整的 `pending{auction}`（字段与 `reduce.openAuction` 同形）。
   *
   * ⚠️ `seat` 是**座位下标**（`bidders` 的下标），不是玩家号 —— 与 reducer 同口径。
   */
  const pendingAuction = (over: {
    seat: number;
    /** 默认两个座位：0 号玩家与 1 号玩家 */
    bidders?: number[];
    limits: number[];
    status?: ('active' | 'passed' | 'givenUp')[];
    price?: number;
    top?: number;
    topCash?: number;
  }) => {
    const bidders = over.bidders ?? [0, 1];
    const seatPlayer = bidders[over.seat] ?? bidders[0]!;
    return {
      kind: 'auction' as const,
      entityId: LAND,
      basePrice: 3000,
      bidders,
      price: over.price ?? 3000,
      top: over.top ?? -1,
      topCash: over.topCash ?? 0,
      seat: over.seat,
      status:
        over.status ??
        [0, 1, 2, 3].map((i) => (i === seatPlayer ? ('active' as const) : ('passed' as const))),
      limits: over.limits,
    };
  };

  const at = (pending: ReturnType<typeof pendingAuction>, players: Partial<Player>[] = []) =>
    makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, nodeId: 1, cash: 60_000, ...(players[i] ?? {}) }),
      ),
      currentPlayer: 0,
      pending,
      phase: 'awaitingDecision',
    });

  it('★ 轮到电脑 → 给 auctionBid（不是 declineDecision）', () => {
    const s = at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [20_000, 20_000] }), [
      { whoPlays: WHO_PLAYS_COMPUTER },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    const a = decideAction({ state: s, map: topo });
    expect(a?.type).toBe('auctionBid');
    if (a?.type !== 'auctionBid') throw new Error('not a bid');
    expect(a.bidder).toBe(0);
    expect(a.status).toBe('raise');
    expect(a.step).toBeGreaterThan(0);
  });

  it('★ 出价不超过心理价位、也不超过现金', () => {
    const s = at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [5200, 9999] }), [
      { whoPlays: WHO_PLAYS_COMPUTER, cash: 100_000 },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    const a = decideAction({ state: s, map: topo });
    if (a?.type !== 'auctionBid') throw new Error('not a bid');
    expect(3000 + a.step).toBeLessThanOrEqual(5200);
    expect(3000 + a.step).toBeLessThanOrEqual(100_000);
  });

  it('★ 出不起/心理价位为 0 → PASS（仍然不是 declineDecision）', () => {
    const s = at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [0, 20_000] }), [
      { whoPlays: WHO_PLAYS_COMPUTER, cash: 5000 },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    expect(decideAction({ state: s, map: topo })).toEqual({
      type: 'auctionBid',
      bidder: 0,
      status: 'pass',
      step: 0,
    });
  });

  it('★ 现金 ≤ 现价 → PASS（@source 0x43b10c 的 `cmp / jle`）', () => {
    const s = at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [20_000, 20_000], price: 9000 }), [
      { whoPlays: WHO_PLAYS_COMPUTER, cash: 3000 },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    expect(decideAction({ state: s, map: topo })).toMatchObject({ status: 'pass', step: 0 });
  });

  it('★ 轮到真人 → 交给屏（返回 null，绝不替他把竞价答掉）', () => {
    const s = at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [20_000, 20_000] }), [
      { whoPlays: WHO_PLAYS_HUMAN },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    expect(decideAction({ state: s, map: topo })).toBeNull();
  });

  it('★ 被托管的人类座位照打（whoPlays 比特 2）', () => {
    const s = at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [20_000, 20_000] }), [
      { whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    expect(decideAction({ state: s, map: topo })?.type).toBe('auctionBid');
  });

  it('★ 判的是 pending.seat 那一位，不是 currentPlayer', () => {
    // currentPlayer = 0（电脑 A），但轮到 seat = 1（电脑 B）
    const s = at(pendingAuction({ seat: 1, bidders: [0, 1], limits: [0, 20_000] }), [
      { whoPlays: WHO_PLAYS_COMPUTER },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    const a = decideAction({ state: s, map: topo });
    expect(a?.type).toBe('auctionBid');
    if (a?.type !== 'auctionBid') throw new Error('not a bid');
    expect(a.bidder).toBe(1); // 不是 currentPlayer(0)
  });

  it('★ 轮到真人举牌、且开拍人是电脑时：decideAction 让位给屏，屏问 auctionNextBid', () => {
    // 真人出卡 → currentPlayer 是真人 → `isAiTurn` 为假、`decideAction` 返回 null
    // 但竞价里轮到的是电脑 B（seat=1）—— 屏必须能拿到他那一口
    const s = at(pendingAuction({ seat: 1, bidders: [0, 1], limits: [0, 20_000] }), [
      { whoPlays: WHO_PLAYS_HUMAN },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]);
    expect(decideAction({ state: s, map: topo })).toBeNull();
    const p = s.pending;
    if (p?.kind !== 'auction' || !('seat' in p)) throw new Error('no auction');
    const a = auctionNextBid(s, p);
    expect(a?.type).toBe('auctionBid');
    if (a?.type !== 'auctionBid') throw new Error('not a bid');
    expect(a.bidder).toBe(1);
  });

  it('auctionNextBid：座位不是电脑（真人/出局）时返回 null', () => {
    const p = pendingAuction({ seat: 0, bidders: [0, 1], limits: [20_000, 20_000] });
    const human = at(p, [{ whoPlays: WHO_PLAYS_HUMAN }, { whoPlays: WHO_PLAYS_COMPUTER }]);
    expect(auctionNextBid(human, p)).toBeNull();
    const dead = at(p, [{ whoPlays: 0 }, { whoPlays: WHO_PLAYS_COMPUTER }]);
    expect(auctionNextBid(dead, p)).toBeNull();
  });

  it('auctionNextBid：已 PASS / 已放棄的座位返回 null', () => {
    const p = pendingAuction({
      seat: 0,
      bidders: [0, 1],
      limits: [20_000, 20_000],
      status: ['passed', 'active'],
    });
    const s = at(p, [{ whoPlays: WHO_PLAYS_COMPUTER }, { whoPlays: WHO_PLAYS_COMPUTER }]);
    expect(auctionNextBid(s, p)).toBeNull();
  });

  it('★ turnEnd 阶段也照样出价（不能回落成 endTurn 把拍卖清掉）', () => {
    const s = { ...at(pendingAuction({ seat: 0, bidders: [0, 1], limits: [20_000, 20_000] }), [
      { whoPlays: WHO_PLAYS_COMPUTER },
      { whoPlays: WHO_PLAYS_COMPUTER },
    ]), phase: 'turnEnd' as const };
    expect(decideAction({ state: s, map: topo })?.type).toBe('auctionBid');
  });
});
