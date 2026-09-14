/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 电脑玩家决策
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from '../state/reduce.ts';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_HUMAN } from '../state/types.ts';
import {
  DEFAULT_PERSONALITY,
  decideAction,
  isAiTurn,
  landAttractiveness,
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

describe('★ 地块估值以「同区协同」为核心', () => {
  const district = (mineCount: number) => {
    const lands = [
      makeLand({ id: 1, name: '台北市', rentByLevel: [0, 1000, 0, 0, 0, 0], landPrice: 2000 }),
      makeLand({ id: 2, name: '台北市', rentByLevel: [0, 1000, 0, 0, 0, 0], landPrice: 2000 }),
      makeLand({ id: 3, name: '台北市', rentByLevel: [0, 1000, 0, 0, 0, 0], landPrice: 2000 }),
    ];
    for (let i = 0; i < mineCount; i++) lands[i]!.owner = 1;
    return lands;
  };

  it('同区已持有越多，下一块越值钱', () => {
    const a = landAttractiveness(district(0)[2]!, district(0), 0);
    const b = landAttractiveness(district(2)[2]!, district(2), 0);
    expect(b).toBeGreaterThan(a);
  });

  it('区块越大整体分量越高', () => {
    const small = [makeLand({ id: 1, name: 'A', rentByLevel: [0, 1000, 0, 0, 0, 0] })];
    const big = [1, 2, 3, 4].map((id) =>
      makeLand({ id, name: 'B', rentByLevel: [0, 1000, 0, 0, 0, 0] }),
    );
    expect(landAttractiveness(big[0]!, big, 0)).toBeGreaterThan(
      landAttractiveness(small[0]!, small, 0),
    );
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

  run('★ 激进的 AI 比保守的买得多', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const play = (aggression: number) => {
      let s = newGame({ map, players: allComputer(), seed: 11 });
      const personality = { aggression, cashReserve: 0.3 };
      for (let i = 0; i < 3000; i++) {
        const a = decideAction({ state: s, map, personality });
        if (a === null) break;
        s = reduce(s, a, topo);
        if (s.turnCount >= 60) break;
      }
      return s.landOwner.filter((v) => v !== 0).length;
    };
    expect(play(0.95)).toBeGreaterThanOrEqual(play(0.05));
  });
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
