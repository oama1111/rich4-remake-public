/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * M2 验收：确定性重放 —— 同种子同操作序列，结果逐字节一致
 *
 * ★ 这是联机的地基（C-DET-4）。一旦这条不成立，所有「两端各自算、
 *   只同步 action」的设计都会在几十回合后悄悄发散。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { reduce, reduceAll, isGameOver } from './reduce.ts';
import { stateFingerprint } from '../net/protocol.ts';
import type { Action } from './actions.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

interface Recorded {
  final: GameState;
  log: Action[];
}

/** 跑一局并把 action 序列录下来 */
function record(seed: number, maxTurns: number): Recorded {
  const map = loadMap();
  const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
  let state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed,
  });
  const log: Action[] = [];
  for (let i = 0; i < 200_000; i++) {
    if (isGameOver(state)) break;
    const a = decideAction({ state, map });
    if (a === null) break;
    const next = reduce(state, a, topo);
    if (next === state) break;
    log.push(a);
    state = next;
    if (state.turnCount >= maxTurns) break;
  }
  return { final: state, log };
}

describe('★ M2 验收：确定性重放', () => {
  run('★ 1000 局同种子同序列，指纹逐局一致', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    // 一局跑 12 回合、跑 1000 遍 —— 覆盖掷骰/走子/买地/事件/日期推进/股市
    const once = (): string => {
      let s = newGame({
        map,
        players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
        seed: 20260913,
      });
      for (let i = 0; i < 20_000 && s.turnCount < 12; i++) {
        const a = decideAction({ state: s, map });
        if (a === null) break;
        const n = reduce(s, a, topo);
        if (n === s) break;
        s = n;
      }
      return stateFingerprint(s);
    };

    const first = once();
    for (let round = 0; round < 1000; round++) {
      expect(once(), `第 ${round} 局与第 0 局不一致`).toBe(first);
    }
  });

  run('★ 录下的 action 序列重放，结果与原局逐字段一致', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const { final, log } = record(4242, 200);

    const fresh = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 4242,
    });
    const replayed = reduceAll(fresh, log, topo);

    expect(stateFingerprint(replayed)).toBe(stateFingerprint(final));
    expect(replayed.rngState).toBe(final.rngState);
    expect(replayed.landOwner).toEqual(final.landOwner);
    expect(replayed.landLevel).toEqual(final.landLevel);
    expect(replayed.market.stocks.map((s) => s.price)).toEqual(
      final.market.stocks.map((s) => s.price),
    );
    expect(replayed.players).toEqual(final.players);
  });

  run('★ 从中途切开重放 —— 前半段 + 后半段 = 整段', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const { final, log } = record(777, 150);
    const fresh = (): GameState =>
      newGame({
        map,
        players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
        seed: 777,
      });

    const half = Math.floor(log.length / 2);
    const mid = reduceAll(fresh(), log.slice(0, half), topo);
    const end = reduceAll(mid, log.slice(half), topo);
    expect(stateFingerprint(end)).toBe(stateFingerprint(final));
  });

  run('★ 不同种子必定产出不同结果 —— 否则「确定性」是因为根本没在用随机数', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      seen.add(stateFingerprint(record(seed, 30).final));
    }
    expect(seen.size).toBe(6);
  });

  run('★ 指纹覆盖了会变的东西 —— 改一个字段指纹就得变', () => {
    const { final } = record(99, 20);
    const base = stateFingerprint(final);
    expect(stateFingerprint({ ...final, priceIndex: final.priceIndex + 1 })).not.toBe(base);
    expect(stateFingerprint({ ...final, pool: final.pool + 1 })).not.toBe(base);
    expect(
      stateFingerprint({
        ...final,
        players: final.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash + 1 } : p)),
      }),
    ).not.toBe(base);
  });
});
