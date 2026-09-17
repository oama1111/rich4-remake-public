/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 存读档
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  SAVE_FORMAT_VERSION,
  SAVE_MAGIC,
  SaveFormatError,
  deserializeGame,
  importOriginalSave,
  serializeGame,
} from './savegame.ts';
import { OFFSET, parseSave } from './save.ts';
import { parseMap } from './map.ts';
import { ACTOR_PLACE } from '../rules/special-actors.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { reduce } from '../state/reduce.ts';
import type { GameState } from '../state/types.ts';
import { makeGameState } from '../testing/factories.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const ORIGINAL_SAVE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/Save0.dat';
const withMap = existsSync(MAP) ? it : it.skip;
const withSave = existsSync(MAP) && existsSync(ORIGINAL_SAVE) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

/** 跑 n 回合，拿到一个「有内容」的局面 */
function played(seed: number, turns: number): { state: GameState; topo: ReturnType<typeof topoOf> } {
  const map = loadMap();
  const topo = topoOf(map);
  let state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed,
  });
  for (let i = 0; i < 200_000 && state.turnCount < turns; i++) {
    const a = decideAction({ state, map });
    if (a === null) break;
    const next = reduce(state, a, topo);
    if (next === state) break;
    state = next;
  }
  return { state, topo };
}

function topoOf(map: ReturnType<typeof loadMap>) {
  return { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
}

describe('新格式', () => {
  it('★ 写出的是带魔数与版本号的 JSON', () => {
    const parsed = JSON.parse(serializeGame(makeGameState())) as Record<string, unknown>;
    expect(parsed['magic']).toBe(SAVE_MAGIC);
    expect(parsed['version']).toBe(SAVE_FORMAT_VERSION);
  });

  it('★ 存了再读回来，状态一模一样', () => {
    const s = makeGameState({ priceIndex: 7, pool: 12_345, rngState: 0xdeadbeef });
    expect(deserializeGame(serializeGame(s))).toEqual(s);
  });

  withMap('★ 跑过一段的局面也能无损往返', () => {
    const { state } = played(2024, 60);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  withMap('★ 读档后续跑的结果与不存档完全一致 —— 这是存档唯一的硬指标', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const { state } = played(2024, 60);

    const advance = (from: GameState, steps: number): GameState => {
      let s = from;
      for (let i = 0; i < steps; i++) {
        const a = decideAction({ state: s, map });
        if (a === null) break;
        const next = reduce(s, a, topo);
        if (next === s) break;
        s = next;
      }
      return s;
    };

    const direct = advance(state, 3000);
    const viaSave = advance(deserializeGame(serializeGame(state)), 3000);

    expect(viaSave.rngState).toBe(direct.rngState);
    expect(viaSave.turnCount).toBe(direct.turnCount);
    expect(viaSave.landOwner).toEqual(direct.landOwner);
    expect(viaSave.players.map((p) => [p.cash, p.moneyInBank])).toEqual(
      direct.players.map((p) => [p.cash, p.moneyInBank]),
    );
    expect(viaSave.market.stocks.map((s) => s.price)).toEqual(
      direct.market.stocks.map((s) => s.price),
    );
  });

  it('★ rngState 必须入档 —— 否则读档后就发散了', () => {
    const s = makeGameState({ rngState: 0x12345678 });
    expect(deserializeGame(serializeGame(s)).rngState).toBe(0x12345678);
  });

  describe('拒绝坏存档', () => {
    it('不是 JSON', () => {
      expect(() => deserializeGame('这不是 json')).toThrow(SaveFormatError);
    });

    it('魔数不对 —— 不吃别人家的存档', () => {
      expect(() => deserializeGame('{"magic":"OTHER","version":1,"state":{}}')).toThrow(
        /不是 rich4-remake/,
      );
    });

    it('★ 版本比程序新时明确报错，而不是读进来跑飞', () => {
      const s = JSON.stringify({ magic: SAVE_MAGIC, version: 999, state: makeGameState() });
      expect(() => deserializeGame(s)).toThrow(/999/);
    });

    it('缺字段时报出是哪个字段', () => {
      const broken = JSON.parse(serializeGame(makeGameState())) as { state: Record<string, unknown> };
      delete broken.state['market'];
      expect(() => deserializeGame(JSON.stringify(broken))).toThrow(/market/);
    });

    it('当前玩家越界被拦下', () => {
      const s = JSON.parse(serializeGame(makeGameState())) as { state: Record<string, unknown> };
      s.state['currentPlayer'] = 99;
      expect(() => deserializeGame(JSON.stringify(s))).toThrow(/越界/);
    });

    it('持仓表与玩家数对不上被拦下', () => {
      const s = JSON.parse(serializeGame(makeGameState())) as { state: Record<string, unknown> };
      s.state['holdings'] = [];
      expect(() => deserializeGame(JSON.stringify(s))).toThrow(/持仓表/);
    });
  });
});

describe('原版存档导入', () => {
  withSave('★ 能把 Save0.dat 读成一个可用的局面', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    const { state } = importOriginalSave(save, loadMap());

    expect(state.players).toHaveLength(save.players.length);
    expect([state.year, state.month, state.day]).toEqual([save.year, save.month, save.day]);
    expect(state.priceIndex).toBe(save.priceIndex);
    expect(state.players.map((p) => p.cash)).toEqual(save.players.map((p) => p.cash));
    expect(state.players.map((p) => p.moneyInBank)).toEqual(
      save.players.map((p) => p.moneyInBank),
    );
  });

  withSave('★ 导进来的局面能直接接着跑', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    const map = loadMap();
    const { state } = importOriginalSave(save, map);
    const topo = topoOf(map);

    let s = state;
    for (let i = 0; i < 5000; i++) {
      const a = decideAction({ state: s, map });
      if (a === null) break;
      const next = reduce(s, a, topo);
      if (next === s) break;
      s = next;
    }
    expect(s.turnCount).toBeGreaterThan(0);
  });

  withSave('★ 没能还原的东西被明确列出来，而不是悄悄补零', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    const { gaps } = importOriginalSave(save, loadMap());
    // 这些是**已知**还原不了的，每一条都得有说法
    for (const key of ['landOwner', 'lottery', 'market', 'holdings', 'pool', 'rngState']) {
      expect(gaps[key], `${key} 应当有 gap 说明`).toBeTruthy();
    }
  });

  withSave('★ hostility 只取前 4 项，第 5/6 项是月度金额', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    const { state } = importOriginalSave(save, loadMap());
    for (let i = 0; i < state.players.length; i++) {
      expect(state.players[i]!.hostility).toHaveLength(4);
      expect(state.players[i]!.monthlyPaid).toBe(save.players[i]!.hostility[4]);
      expect(state.players[i]!.monthlyReceived).toBe(save.players[i]!.hostility[5]);
    }
  });

  withSave('★ 道具被搬到引擎那张步长 15 的扁平表里', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    const { state } = importOriginalSave(save, loadMap());
    const total = state.tools.reduce((a, b) => a + b, 0);
    const originalTotal = save.players.reduce(
      (a, p) => a + p.tools.reduce((x, y) => x + y, 0),
      0,
    );
    expect(total).toBe(originalTotal);
  });

  withSave('导入的状态也能存成新格式再读回来', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    const { state } = importOriginalSave(save, loadMap());
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe('★ 替身表（小偷/強盜/流氓/間諜/機器娃娃）从存档导入', () => {
  withSave('★★ 真存档：布局读得通，且占用表由替身表推出来（两处一致）', () => {
    const map = loadMap();
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    // 5 条记录都读出来了
    expect(save.specialPlayers).toHaveLength(5);
    const { state } = importOriginalSave(save, map);
    expect(state.specialActors).toHaveLength(5);
    // 占用表与替身表**必须一致** —— 否则会出现「探得到却放不出来」。
    // ⚠️ 占用表只有 8 格（0..7），而替身是 5 个（槽 4..8）⇒ 機器娃娃（槽 8）
    //    本来就不在表里，只查前 4 个。
    expect(state.prisonOccupancy).toHaveLength(8);
    for (let i = 0; i < 4; i++) {
      const a = state.specialActors[i]!;
      const slot = 4 + i; // SPECIAL_ACTOR_BASE = 4
      expect(state.prisonOccupancy[slot], `槽 ${slot} 监狱`).toBe(
        a.place === ACTOR_PLACE.prison ? 1 : 0,
      );
      expect(state.hospitalOccupancy[slot], `槽 ${slot} 医院`).toBe(
        a.place === ACTOR_PLACE.hospital ? 1 : 0,
      );
    }
  });

  withSave('★★ 把存档里某条替身记录改成「在棋盘上走」→ 导入后就是棋盘态，且带出天数', () => {
    const map = loadMap();
    const bytes = new Uint8Array(readFileSync(ORIGINAL_SAVE));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 第 0 条（小偷）：nodeId = 42、owner = 1、direction = 3、冬眠 2 天、夢遊 5 天、停留 1
    const o = OFFSET.specialPlayers;
    view.setUint16(o + 4, 42, true); // node_id
    view.setUint16(o + 6, 41, true); // last_node_id
    bytes[o + 8] = 1; // owner
    bytes[o + 9] = 3; // direction
    bytes[o + 12] = 2; // days_winter_sleep
    bytes[o + 13] = 5; // days_sleep_walking
    bytes[o + 14] = 1; // days_stopping
    const saved = parseSave(bytes);
    expect(saved.specialPlayers[0]!.nodeId).toBe(42);
    const { state } = importOriginalSave(saved, map);
    const a = state.specialActors[0]!;
    expect(a.nodeId).toBe(42);
    expect(a.lastNodeId).toBe(41);
    expect(a.owner).toBe(1);
    expect(a.direction).toBe(3);
    expect(a.hibernating).toBe(2);
    expect(a.sleepwalkDays).toBe(5);
    expect(a.halted).toBe(1);
    // 在棋盘上走 ⇒ 不再算「关在医院/监狱」，占用表那一格也空出来
    expect(state.prisonOccupancy[4]).toBe(0);
    expect(state.hospitalOccupancy[4]).toBe(0);
  });
});
