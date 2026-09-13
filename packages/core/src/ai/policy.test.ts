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
} from './policy.ts';
import { makeLand } from '../testing/factories.ts';

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
