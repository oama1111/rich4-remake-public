/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 新聞／命運格接入 reducer
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

/** 把当前玩家直接放到某种特殊格上，进入 settling */
function standOn(state: GameState, map: ReturnType<typeof loadMap>, kind: number): GameState | null {
  const node = map.nodes.find((n) => n.specialKind === kind);
  if (node === undefined) return null;
  const players2 = state.players.map((p, i) =>
    i === state.currentPlayer ? { ...p, nodeId: node.id } : p,
  );
  return { ...state, players: players2, phase: 'settling' as const };
}

describe('★ 牌堆在开局就洗好', () => {
  run('两副牌各自完整且不重复', () => {
    const s = newGame({ map: loadMap(), players: players(), seed: 42 });
    expect(s.newsDeck.order).toHaveLength(36);
    expect(s.fortuneDeck.order).toHaveLength(37);
    expect(new Set(s.newsDeck.order).size).toBe(36);
    expect(new Set(s.fortuneDeck.order).size).toBe(37);
  });

  run('★ 洗牌消耗了随机数——rngState 不再等于种子', () => {
    const s = newGame({ map: loadMap(), players: players(), seed: 42 });
    expect(s.rngState).not.toBe(42);
  });

  run('同种子洗出同样的牌堆', () => {
    const a = newGame({ map: loadMap(), players: players(), seed: 9 });
    const b = newGame({ map: loadMap(), players: players(), seed: 9 });
    expect(a.newsDeck.order).toEqual(b.newsDeck.order);
    expect(a.fortuneDeck.order).toEqual(b.fortuneDeck.order);
  });

  run('不同种子洗出不同牌堆', () => {
    const a = newGame({ map: loadMap(), players: players(), seed: 1 });
    const b = newGame({ map: loadMap(), players: players(), seed: 2 });
    expect(a.newsDeck.order).not.toEqual(b.newsDeck.order);
  });
});

describe('★ 落在命運格会真的抽牌并施加', () => {
  run('游标前进且记下了事件', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (s1 === null) return; // 这张图没有命運格

    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.fortuneDeck.cursor).not.toBe(s1.fortuneDeck.cursor);
    expect(s2.lastEvent?.kind).toBe('fortune');
    expect(s2.phase).toBe('turnEnd');
  });

  run('★ 连续抽不会反复抽到同一张——游标确实在走', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    let s = newGame({ map, players: players(), seed: 5 });
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const on = standOn(s, map, SPECIAL_KIND.FORTUNE);
      if (on === null) return;
      s = reduce(on, { type: 'settle' }, topo);
      if (s.lastEvent !== null) seen.push(s.lastEvent.id);
      s = { ...s, phase: 'turnEnd' };
    }
    // 至少抽到过两种不同的事件
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe('★ 落在新聞格会抽牌', () => {
  run('游标前进且记下事件', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null) return;

    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.newsDeck.cursor).not.toBe(s1.newsDeck.cursor);
    expect(s2.lastEvent?.kind).toBe('news');
  });
});

describe('★ 公园格仍然什么都不发生（原版行为）', () => {
  run('状态除 phase 外不变', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.PARK);
    if (s1 === null) return;
    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.players).toEqual(s1.players);
    expect(s2.pool).toBe(s1.pool);
    expect(s2.lastEvent).toBeNull();
  });
});
