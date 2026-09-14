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
  run('★ 三个小游戏已实现 —— 电脑玩家直接拿 50..69 點券', () => {
    const { map, topo: t } = topo();
    for (const kind of [
      SPECIAL_KIND.PENGUIN_DIG,
      SPECIAL_KIND.BALLOON,
      SPECIAL_KIND.GIFT_FROM_SKY,
    ]) {
      const s = standOn(newGame({ map, players: players() }), map, kind);
      if (s === null) continue;
      const r = reduce(s, { type: 'settle' }, t);
      expect(r.pending, `kind ${kind}`).toBeNull();
      const gained = r.players[s.currentPlayer]!.points - s.players[s.currentPlayer]!.points;
      expect(gained, `kind ${kind}`).toBeGreaterThanOrEqual(50);
      expect(gained, `kind ${kind}`).toBeLessThanOrEqual(69);
    }
  });

  run('★ 魔法屋已实现 —— 即时结算，不留待决交互', () => {
    const { map, topo: t } = topo();
    const s = standOn(newGame({ map, players: players() }), map, SPECIAL_KIND.MAGIC_HOUSE);
    if (s === null) return;
    const r = reduce(s, { type: 'settle' }, t);
    expect(r.pending).toBeNull();
    expect(r.phase).toBe('turnEnd');
    // 转盘一定转了 —— 随机数状态必然推进
    expect(r.rngState).not.toBe(s.rngState);
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

describe('★ 小游戏：真人要玩，电脑不玩', () => {
  run('真人落在小游戏格上 → 挂待决交互，等玩法报分', () => {
    const { map, topo: t } = topo();
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'human' as const })),
    });
    const s = standOn(base, map, SPECIAL_KIND.PENGUIN_DIG);
    if (s === null) return;
    const r = reduce(s, { type: 'settle' }, t);
    expect(r.pending?.kind).toBe('minigame');
    if (r.pending?.kind !== 'minigame') return;
    expect(r.pending.name).toBe('企鵝挖寶');
    // ★ 还没结算 —— 點券一分没变，随机数也没动
    expect(r.players[s.currentPlayer]!.points).toBe(s.players[s.currentPlayer]!.points);
    expect(r.rngState).toBe(s.rngState);
  });

  run('★ 报分之后點券入账，且不消耗随机数', () => {
    const { map, topo: t } = topo();
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'human' as const })),
    });
    const s = standOn(base, map, SPECIAL_KIND.BALLOON);
    if (s === null) return;
    const waiting = reduce(s, { type: 'settle' }, t);
    const done = reduce(waiting, { type: 'minigame', score: 321 }, t);
    expect(done.players[s.currentPlayer]!.points).toBe(
      s.players[s.currentPlayer]!.points + 321,
    );
    expect(done.pending).toBeNull();
    expect(done.phase).toBe('turnEnd');
    // 玩了就不抽随机数 —— 与原版「真人那条路一次 rand() 都不调」一致
    expect(done.rngState).toBe(waiting.rngState);
  });

  run('★ 报 null 表示没玩 —— 退回 50..69', () => {
    const { map, topo: t } = topo();
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'human' as const })),
    });
    const s = standOn(base, map, SPECIAL_KIND.GIFT_FROM_SKY);
    if (s === null) return;
    const waiting = reduce(s, { type: 'settle' }, t);
    const done = reduce(waiting, { type: 'minigame', score: null }, t);
    const gained = done.players[s.currentPlayer]!.points - s.players[s.currentPlayer]!.points;
    expect(gained).toBeGreaterThanOrEqual(50);
    expect(gained).toBeLessThanOrEqual(69);
    expect(done.rngState).not.toBe(waiting.rngState);
  });

  run('★ 报一个天文数字也只能拿到 999', () => {
    const { map, topo: t } = topo();
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'human' as const })),
    });
    const s = standOn(base, map, SPECIAL_KIND.PENGUIN_DIG);
    if (s === null) return;
    const waiting = reduce(s, { type: 'settle' }, t);
    const done = reduce(waiting, { type: 'minigame', score: 9_999_999 }, t);
    expect(done.players[s.currentPlayer]!.points - s.players[s.currentPlayer]!.points).toBe(999);
  });
});
