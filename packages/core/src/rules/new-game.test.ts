/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 开新局
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';
import { newGame, UNVERIFIED_CARDS_PER_KIND } from './new-game.ts';
import { DEFAULT_INITIAL_FUND, GAME_INITIAL_FUNDS, startingMoney } from './setup.ts';
import { INITIAL_PRICE_INDEX } from './wealth.ts';
import { STARTING_TOOLS, toolCount, toolsOf } from './tools.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const setup = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    character: i,
    kind: (i === 0 ? 'human' : 'computer') as 'human' | 'computer',
  }));

describe('开局资金', () => {
  run('★ 按角色的 initCashRatio 分配现金/存款', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      const expected = startingMoney(p.character, DEFAULT_INITIAL_FUND);
      expect(p.cash, `角色${p.character}`).toBe(expected.cash);
      expect(p.moneyInBank, `角色${p.character}`).toBe(expected.moneyInBank);
    }
  });

  run('★ 每人现金+存款都等于初始资金', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      expect(p.cash + p.moneyInBank).toBe(DEFAULT_INITIAL_FUND);
    }
  });

  run('可以选别的资金档位', () => {
    const fund = GAME_INITIAL_FUNDS[3]!;
    const s = newGame({ map: loadMap(), players: setup(2), initialFund: fund });
    for (const p of s.players) expect(p.cash + p.moneyInBank).toBe(fund);
  });

  run('★ 不同角色的现金比例确实不同（不是都一样）', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    const ratios = new Set(s.players.map((p) => p.cash));
    expect(ratios.size).toBeGreaterThan(1);
  });
});

describe('初始状态', () => {
  run('物价指数取原版开局值 1', () => {
    expect(newGame({ map: loadMap(), players: setup(2) }).priceIndex).toBe(INITIAL_PRICE_INDEX);
  });

  run('★ 地产全部无主、等级为 0，且长度覆盖全部地块', () => {
    const map = loadMap();
    const s = newGame({ map, players: setup(4) });
    expect(s.landOwner).toHaveLength(map.lands.length + 1);
    expect(s.landOwner.every((v) => v === 0)).toBe(true);
    expect(s.landLevel.every((v) => v === 0)).toBe(true);
  });

  run('人机身份按配置设置', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    expect(s.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(s.players[1]!.whoPlays).toBe(WHO_PLAYS_COMPUTER);
  });

  run('牌堆按占位值填满', () => {
    const s = newGame({ map: loadMap(), players: setup(2) });
    expect(s.cardAmount).toHaveLength(30);
    expect(s.cardAmount.every((v) => v === UNVERIFIED_CARDS_PER_KIND)).toBe(true);
  });

  run('★ 开局每人发 機器娃娃/路障/地雷/定時炸彈 各一个', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (let i = 0; i < 4; i++) {
      for (const toolId of STARTING_TOOLS) {
        expect(toolCount(s.tools, i, toolId), `玩家${i} 道具${toolId}`).toBe(1);
      }
      // 只发这四样，其余为 0
      expect([...toolsOf(s.tools, i).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    }
  });

  run('★ 道具槽位是 15/人——13 号核子飛彈不会越界', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    expect(s.tools).toHaveLength(4 * 15);
    expect(toolCount(s.tools, 3, 13)).toBe(0); // 能读到而不是 undefined
  });

  run('★ 无人持牌、无债务、无阻碍', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      expect(p.cards).toEqual([]);
      expect(p.loan).toBe(0);
      expect(p.blocking.inPrison).toBe(0);
      expect(p.hostility).toEqual([0, 0, 0, 0]);
    }
  });

  run('★ 种子决定整个开局 —— 联机必须由服务器统一下发', () => {
    const a = newGame({ map: loadMap(), players: setup(2), seed: 12345 });
    const b = newGame({ map: loadMap(), players: setup(2), seed: 12345 });
    expect(a.rngState).toBe(b.rngState);
    expect(a.newsDeck.order).toEqual(b.newsDeck.order);

    const c = newGame({ map: loadMap(), players: setup(2), seed: 999 });
    expect(c.rngState).not.toBe(a.rngState);
  });

  run('★ rngState 不等于种子——开局洗两副牌已消耗随机数', () => {
    // 这条是有意钉住的：若哪天洗牌被挪走或顺序变了，它会立刻失效提醒
    expect(newGame({ map: loadMap(), players: setup(2), seed: 12345 }).rngState).not.toBe(12345);
  });
});

describe('参数校验', () => {
  run('玩家数少于 2 或多于 4 都拒绝', () => {
    const map = loadMap();
    expect(() => newGame({ map, players: setup(1) })).toThrow(/2\.\.4/);
    expect(() => newGame({ map, players: setup(5) })).toThrow(/2\.\.4/);
  });

  run('2 人局也能开', () => {
    expect(newGame({ map: loadMap(), players: setup(2) }).players).toHaveLength(2);
  });
});
