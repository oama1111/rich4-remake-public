/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 破产与终局接入 reducer —— M2 验收「完整跑完一局至破产结算」
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { WHO_PLAYS_DEAD, isAlive } from './types.ts';
import { applyBankruptcy, gameOverCode, isGameOver, reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = (n = 4) =>
  Array.from({ length: n }, (_, i) => ({ character: i, kind: 'computer' as const }));

const fresh = (n = 4): GameState => newGame({ map: loadMap(), players: players(n), seed: 1 });

describe('破产标记', () => {
  run('出局者 whoPlays 归零、现金清空', () => {
    const s = applyBankruptcy(fresh(), 1);
    expect(isAlive(s.players[1]!)).toBe(false);
    expect(s.players[1]!.cash).toBe(0);
    expect(s.players[1]!.moneyInBank).toBe(0);
  });

  run('不影响其他玩家', () => {
    const before = fresh();
    const s = applyBankruptcy(before, 1);
    expect(s.players[0]!.cash).toBe(before.players[0]!.cash);
  });

  run('已出局者再破产不变', () => {
    const s = applyBankruptcy(fresh(), 1);
    expect(applyBankruptcy(s, 1)).toBe(s);
  });
});

describe('★ 樂透号码无论哪条路径都要释放', () => {
  run('名下号码被清空', () => {
    const base = fresh();
    const lottery = [...base.lottery];
    lottery[3] = 2; // 玩家1 持有
    lottery[9] = 1; // 玩家0 持有
    const s = applyBankruptcy({ ...base, lottery }, 1);
    expect(s.lottery[3]).toBe(0);
    expect(s.lottery[9]).toBe(1); // 别人的不动
  });
});

describe('★ 终局路径会跳过清算 —— 地产原样留着', () => {
  run('只剩一人时破产者仍持有地产', () => {
    const base = fresh();
    // 先让两人出局，只剩玩家 0 与 1
    let s: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i >= 2 ? { ...p, whoPlays: WHO_PLAYS_DEAD } : p,
      ),
    };
    const landOwner = [...s.landOwner];
    landOwner[1] = 2; // 玩家1 有一块地
    s = { ...s, landOwner };

    const after = applyBankruptcy(s, 1);
    expect(after.phase).toBe('gameOver');
    // ★ 地产没有被清算——与 Save0.dat 的实证一致
    expect(after.landOwner[1]).toBe(2);
  });

  run('★ 非终局路径则正常清算', () => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    landOwner[1] = 2;
    const s = applyBankruptcy({ ...base, landOwner }, 1);
    expect(s.phase).not.toBe('gameOver');
    expect(s.landOwner[1]).toBe(0); // 被释放
  });
});

describe('终局判定', () => {
  run('四人在场时未结束', () => {
    const s = fresh();
    expect(isGameOver(s)).toBe(false);
    expect(gameOverCode(s)).toBe(0);
  });

  run('★ 只剩一人即结束', () => {
    const base = fresh();
    const s: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? p : { ...p, whoPlays: WHO_PLAYS_DEAD })),
    };
    expect(isGameOver(s)).toBe(true);
    expect(gameOverCode(s)).toBeGreaterThan(0);
  });

  run('★ 全员出局给出终局码 1', () => {
    const base = fresh();
    const s: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, whoPlays: WHO_PLAYS_DEAD })),
    };
    expect(gameOverCode(s)).toBe(1);
  });
});

describe('★ 付不起过路费会真的破产', () => {
  run('身无分文踩到高级地产 → 出局', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const base = fresh();

    const landNode = map.nodes.find((n) => n.ref.kind === 'land');
    if (landNode === undefined) return;
    const idx = landNode.ref.kind === 'land' ? landNode.ref.index : 0;

    const landOwner = [...base.landOwner];
    const landLevel = [...base.landLevel];
    landOwner[idx] = 2; // 归玩家1
    landLevel[idx] = 5; // 满级

    const s: GameState = {
      ...base,
      landOwner,
      landLevel,
      priceIndex: 50, // 把租金抬到必然付不起
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: landNode.id, cash: 1, moneyInBank: 0 } : p,
      ),
      phase: 'settling',
    };

    const r = reduce(s, { type: 'settle' }, topo);
    expect(isAlive(r.players[0]!)).toBe(false);
  });
});
