/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 设施落点接入 reducer
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { FACILITY_TYPE_MIN, facilityIndexOf } from '../rules/land.ts';
import { reduce } from './reduce.ts';
import { makeFacility } from '../testing/factories.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

describe('设施下标', () => {
  it('4000 之外不是设施', () => {
    expect(facilityIndexOf(4000)).toBeNull();
    expect(facilityIndexOf(6000)).toBeNull();
    expect(facilityIndexOf(2001)).toBeNull();
  });

  it('4001 → 下标 1', () => {
    expect(facilityIndexOf(FACILITY_TYPE_MIN + 1)).toBe(1);
  });
});

/** 造一张只含一个设施格的极小地图拓扑 */
function scene(over: { type?: number; owner?: number; traffic?: number; steps?: number } = {}) {
  const map = loadMap();
  const facNode = map.nodes.find((n) => facilityIndexOf(n.type) !== null);
  if (facNode === undefined) return null;
  const idx = facilityIndexOf(facNode.type)!;

  const fac = makeFacility({
    id: idx,
    type: over.type ?? 3, // 加油站
    owner: over.owner ?? 2,
    level: 1,
    priceStatus: 0,
    rateByLevel: [100, 200, 400, 800, 1600, 3200],
  });

  const base = newGame({ map, players: players(), seed: 1 });
  const state: GameState = {
    ...base,
    players: base.players.map((p, i) =>
      i === 0
        ? { ...p, nodeId: facNode.id, trafficMethod: over.traffic ?? 1, cash: 100_000, moneyInBank: 0 }
        : { ...p, cash: 100_000, moneyInBank: 0 },
    ),
    stepsTotal: over.steps ?? 4,
    phase: 'settling',
  };
  return { state, topo: { nodes: map.nodes, lands: map.lands, facilities: [fac] }, fac };
}

describe('★ 加油站（type 3）按掷骰步数收费', () => {
  run('步数 × 500 × 交通倍率 × 物价指数', () => {
    const s = scene({ steps: 4, traffic: 1 });
    if (s === null) return;
    const r = reduce(s.state, { type: 'settle' }, s.topo);
    expect(100_000 - r.players[0]!.cash).toBe(4 * 500 * 1 * 1);
  });

  run('★ 交通工具越好收得越贵', () => {
    const a = scene({ steps: 4, traffic: 1 });
    const b = scene({ steps: 4, traffic: 3 });
    if (a === null || b === null) return;
    const ra = reduce(a.state, { type: 'settle' }, a.topo);
    const rb = reduce(b.state, { type: 'settle' }, b.topo);
    expect(100_000 - rb.players[0]!.cash).toBeGreaterThan(100_000 - ra.players[0]!.cash);
  });

  run('★ 没有交通工具则不收费', () => {
    const s = scene({ steps: 4, traffic: 0 });
    if (s === null) return;
    const r = reduce(s.state, { type: 'settle' }, s.topo);
    expect(r.players[0]!.cash).toBe(100_000);
  });

  run('★ 与住宅不同：钱进的是地主账上，且没有同盟分账', () => {
    const s = scene({ steps: 4, traffic: 1, owner: 2 });
    if (s === null) return;
    const r = reduce(s.state, { type: 'settle' }, s.topo);
    expect(r.players[1]!.moneyInBank).toBe(2000);
    // 其他人分文未得
    expect(r.players[2]!.moneyInBank).toBe(0);
    expect(r.players[3]!.moneyInBank).toBe(0);
  });
});

describe('不收费的情形', () => {
  run('无主设施', () => {
    const s = scene({ owner: 0 });
    if (s === null) return;
    expect(reduce(s.state, { type: 'settle' }, s.topo).players[0]!.cash).toBe(100_000);
  });

  run('自己的设施', () => {
    const s = scene({ owner: 1 });
    if (s === null) return;
    expect(reduce(s.state, { type: 'settle' }, s.topo).players[0]!.cash).toBe(100_000);
  });

  run('未知 type 不收费', () => {
    const s = scene({ type: 9 });
    if (s === null) return;
    expect(reduce(s.state, { type: 'settle' }, s.topo).players[0]!.cash).toBe(100_000);
  });
});

describe('★ 神明同样作用于设施过路费', () => {
  run('大財神全免', () => {
    const s = scene({ steps: 4, traffic: 1 });
    if (s === null) return;
    const st = {
      ...s.state,
      players: s.state.players.map((p, i) => (i === 0 ? { ...p, godInfo: 2 } : p)),
    };
    expect(reduce(st, { type: 'settle' }, s.topo).players[0]!.cash).toBe(100_000);
  });

  run('大窮神加倍', () => {
    const s = scene({ steps: 4, traffic: 1 });
    if (s === null) return;
    const st = {
      ...s.state,
      players: s.state.players.map((p, i) => (i === 0 ? { ...p, godInfo: 6 } : p)),
    };
    expect(100_000 - reduce(st, { type: 'settle' }, s.topo).players[0]!.cash).toBe(4000);
  });
});
