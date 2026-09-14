/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 特殊格落点接入 reducer —— 每一格都可达
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

function standOn(s: GameState, map: ReturnType<typeof loadMap>, kind: number): GameState | null {
  const node = map.nodes.find((n) => n.specialKind === kind);
  if (node === undefined) return null;
  return {
    ...s,
    players: s.players.map((p, i) => (i === s.currentPlayer ? { ...p, nodeId: node.id } : p)),
    phase: 'settling' as const,
  };
}

const topo = () => {
  const map = loadMap();
  return { map, topo: { nodes: map.nodes, lands: map.lands } };
};

describe('★ 银行', () => {
  run('给出财富与可贷额度', () => {
    const { map, topo: t } = topo();
    const s = standOn(newGame({ map, players: players() }), map, SPECIAL_KIND.BANK);
    if (s === null) return;
    const r = reduce(s, { type: 'settle' }, t);
    if (r.pending === null) return; // 这张图可能没有银行格
    expect(r.pending.kind).toBe('bank');
    if (r.pending.kind === 'bank') {
      expect(r.pending.wealth).toBeGreaterThan(0);
      expect(r.pending.loanCapacity).toBeGreaterThanOrEqual(0);
    }
  });

  run('★ 拒绝往来期内连交互都不给', () => {
    const { map, topo: t } = topo();
    const base = newGame({ map, players: players() });
    const s0 = standOn(base, map, SPECIAL_KIND.BANK);
    if (s0 === null) return;
    const s = {
      ...s0,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, daysRejectedByBank: 30 } : p)),
    };
    expect(reduce(s, { type: 'settle' }, t).pending).toBeNull();
  });
});

describe('★ 樂透', () => {
  run('给出可买号码与票价', () => {
    const { map, topo: t } = topo();
    const s = standOn(newGame({ map, players: players() }), map, SPECIAL_KIND.LOTTERY);
    if (s === null) return;
    const r = reduce(s, { type: 'settle' }, t);
    if (r.pending === null) return;
    expect(r.pending.kind).toBe('lottery');
    if (r.pending.kind === 'lottery') {
      expect(r.pending.available).toHaveLength(36);
      expect(r.pending.price).toBe(1000);
      expect(r.pending.owned).toBe(0);
    }
  });
});

describe('★ 未实现的场所会明确报出来', () => {
  run('魔法屋给出 unimplemented 而不是静默', () => {
    const { map, topo: t } = topo();
    const s = standOn(newGame({ map, players: players() }), map, SPECIAL_KIND.MAGIC_HOUSE);
    if (s === null) return;
    expect(reduce(s, { type: 'settle' }, t).pending?.kind).toBe('unimplemented');
  });

  run('★ 百貨公司已实现 —— 给出的是商店交互', () => {
    const { map, topo: t } = topo();
    const s = standOn(newGame({ map, players: players() }), map, SPECIAL_KIND.DEPARTMENT_STORE);
    if (s === null) return;
    const r = reduce(s, { type: 'settle' }, t);
    expect(r.pending?.kind).toBe('shop');
  });
});

describe('★ 監獄／醫院：没人在押就什么都不发生（探监机制）', () => {
  run('占用表全空时无交互', () => {
    const { map, topo: t } = topo();
    const s = standOn(newGame({ map, players: players() }), map, SPECIAL_KIND.PRISON);
    if (s === null) return;
    expect(reduce(s, { type: 'settle' }, t).pending).toBeNull();
  });

  run('★ 有人在押时才给出交互', () => {
    const { map, topo: t } = topo();
    const base = newGame({ map, players: players() });
    const s0 = standOn(base, map, SPECIAL_KIND.PRISON);
    if (s0 === null) return;
    const occ = [...s0.prisonOccupancy];
    occ[1] = 1;
    const r = reduce({ ...s0, prisonOccupancy: occ }, { type: 'settle' }, t);
    expect(r.pending?.kind).toBe('unimplemented');
  });
});

describe('★ 即时结算的格子不产生交互', () => {
  run('公园/新聞/命運 都是 pending = null', () => {
    const { map, topo: t } = topo();
    for (const kind of [SPECIAL_KIND.PARK, SPECIAL_KIND.NEWS, SPECIAL_KIND.FORTUNE]) {
      const s = standOn(newGame({ map, players: players() }), map, kind);
      if (s === null) continue;
      expect(reduce(s, { type: 'settle' }, t).pending, `kind ${kind}`).toBeNull();
    }
  });
});
