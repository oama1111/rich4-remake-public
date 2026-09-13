/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 长局冒烟：让四个电脑玩家真打一局，看整套系统是否咬合
 *
 * 这类测试和单元测试的作用不同——它抓的是「各部分单独都对、
 * 合起来却跑不动」的问题：状态机卡死、事件永不触发、
 * 钱凭空出现或消失。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

interface SoakResult {
  state: GameState;
  steps: number;
  events: { news: number; fortune: number };
}

function soak(seed: number, maxTurns: number): SoakResult {
  const map = loadMap();
  const topo = { nodes: map.nodes, lands: map.lands };
  let state = newGame({ map, players: players(), seed });
  const events = { news: 0, fortune: 0 };
  let lastNews = state.newsDeck.cursor;
  let lastFortune = state.fortuneDeck.cursor;

  let steps = 0;
  for (; steps < 200_000; steps++) {
    const a = decideAction({ state, map });
    if (a === null) break;
    const next = reduce(state, a, topo);
    if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
    state = next;

    if (state.newsDeck.cursor !== lastNews) {
      events.news++;
      lastNews = state.newsDeck.cursor;
    }
    if (state.fortuneDeck.cursor !== lastFortune) {
      events.fortune++;
      lastFortune = state.fortuneDeck.cursor;
    }
    if (state.turnCount >= maxTurns) break;
  }
  return { state, steps, events };
}

describe('★ 长局冒烟', () => {
  run('300 回合不卡死', () => {
    const r = soak(2024, 300);
    expect(r.state.turnCount).toBeGreaterThanOrEqual(300);
    expect(r.steps).toBeLessThan(200_000);
  });

  run('★ 新聞与命運事件确实会触发', () => {
    const r = soak(2024, 300);
    expect(r.events.news + r.events.fortune).toBeGreaterThan(0);
  });

  run('★ 有人买地、有人盖房', () => {
    const r = soak(2024, 300);
    expect(r.state.landOwner.filter((v) => v !== 0).length).toBeGreaterThan(0);
    expect(r.state.landLevel.some((v) => v > 0)).toBe(true);
  });

  run('★ 钱不会凭空出现——净值 + 公库守恒于初始总额附近', () => {
    const r = soak(2024, 200);
    const netWorth = r.state.players.reduce((t, p) => t + p.cash + p.moneyInBank, 0);
    const initial = 300_000 * 4;
    // 买地会把钱变成地产，故净值只会**减少**；公库收走罚款。
    // 两者之和不应**超过**初始总额——超过就意味着凭空造钱。
    expect(netWorth + r.state.pool).toBeLessThanOrEqual(initial);
  });

  run('★ 同种子可完整复现', () => {
    const a = soak(31337, 150);
    const b = soak(31337, 150);
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(a.state.landOwner).toEqual(b.state.landOwner);
    expect(a.state.players.map((p) => p.cash)).toEqual(b.state.players.map((p) => p.cash));
    expect(a.events).toEqual(b.events);
  });

  run('多个种子都能跑完', () => {
    for (const seed of [1, 7, 12345]) {
      const r = soak(seed, 120);
      expect(r.state.turnCount, `seed ${seed}`).toBeGreaterThanOrEqual(120);
    }
  });
});
