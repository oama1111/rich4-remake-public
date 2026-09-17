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
import { OBJECT_TYPE_TABLE } from '../rules/objects.ts';
import { newGame } from '../rules/new-game.ts';
import { initialToolStock } from '../rules/tools.ts';
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
    for (const key of ['landOwner', 'rngState']) {
      expect(gaps[key], `${key} 应当有 gap 说明`).toBeTruthy();
    }
    // ★ 2026-09-17：`holdings` / `specialActors` / `market` / `objects` / `toolStock`
    //   **已经能还原** ⇒ 不再挂 gap
    expect(gaps['holdings']).toBeUndefined();
    expect(gaps['specialActors']).toBeUndefined();
    expect(gaps['market']).toBeUndefined();
    expect(gaps['objects']).toBeUndefined();
    // ★ 2026-09-17（第十轮）：行情历史游标、全局道具库存、两个牌堆的洗牌序、
    //   樂透号码表、公库都**从存档读**了
    for (const key of ['marketDay', 'toolStock', 'newsDeck', 'fortuneDeck', 'lottery', 'pool']) {
      expect(gaps[key], `${key} 不该再有 gap`).toBeUndefined();
    }
  });

  withSave('★★ 地图物件**从存档读**（46 项的 type 与静态表逐个相符，8 个在场）', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    expect(save.objects).toHaveLength(46);
    // ① 最强的一条：46 项的 type 与静态表**逐个相符**（偏移/步长错一格就崩）
    expect(save.objects.map((o) => o.type)).toEqual([...OBJECT_TYPE_TABLE]);
    // ② Save0 在场的那 8 个：下标/类型/节点
    const alive = save.objects
      .map((o, i) => ({ i, ...o }))
      .filter((o) => o.nodeId !== 0);
    expect(alive.map((o) => [o.i, o.type, o.nodeId])).toEqual([
      [0, 1, 4],
      [2, 3, 92],
      [4, 5, 78],
      [7, 8, 102],
      [9, 10, 95],
      [10, 11, 48],
      [16, 16, 59],
      [17, 16, 58],
    ]);
    // ③ 导入层：同一批值进 state.objects（没在场上的是 nodeId 0，不是被丢掉）
    const { state } = importOriginalSave(save, loadMap());
    expect(state.objects).toHaveLength(46);
    expect(state.objects[0]).toEqual({ type: 1, nodeId: 4, state: 0, attached: 0 });
    expect(state.objects[7]!.nodeId).toBe(102);
    expect(state.objects[1]!.nodeId).toBe(0);
  });

  withSave('★★ 行情**从存档读**（Save0 实测：0 号股 收盘 109 / 参考 200 / 开盘 121 / 流通 10000）', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    // 解析层：12 支，逐字段对
    expect(save.stocksOnMap).toHaveLength(12);
    const s0 = save.stocksOnMap[0]!;
    expect(s0.commercialIndex).toBe(6);
    expect(s0.price).toBe(109);
    expect(s0.basePrice).toBe(200);
    expect(s0.openPrice).toBe(121);
    expect(s0.shares).toBe(10000);
    expect(s0.volatility).toBe(1);
    expect(s0.trend).toBe(-10);
    expect(s0.shock).toBeCloseTo(-10.6285, 3);
    // 历史：0 号股的前 6 天就是存档里那条上升序列
    expect(save.stockHistory).toHaveLength(12);
    expect(save.stockHistory[0]!.slice(0, 6)).toEqual([256, 273, 288, 298, 327, 337]);
    // 导入层：同一批值进 state.market，指数按 Σ收盘×10 重算
    const { state } = importOriginalSave(save, loadMap());
    expect(state.market.stocks[0]!.price).toBe(109);
    expect(state.market.history[0]!.slice(0, 6)).toEqual([256, 273, 288, 298, 327, 337]);
    // 指数 = trunc(Σ收盘 × 10)，累加与乘法都走 32 位浮点（与 tickStockMarket 同式）
    let total = 0;
    for (const st of state.market.stocks) total = Math.fround(total + st.price);
    expect(state.market.index).toBe(Math.trunc(Math.fround(total * 10)));
    // ★ 2026-09-17（第十轮）：历史**写入游标**也读进来了（`[0x499100]`，平坦 0x6f2）
    expect(state.market.day).toBe(107);
  });

  withSave('★★ 两个牌堆的**洗牌序与游标**从存档读（平坦 0x26fa/0x271e，游标 0x26f2/0x26f6）', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    // 解析层：两档都是合法排列（36 / 37 张）
    expect(save.newsDeck).toHaveLength(36);
    expect(save.fortuneDeck).toHaveLength(37);
    expect([...save.newsDeck].sort((a, b) => a - b)).toEqual(Array.from({ length: 36 }, (_, i) => i));
    expect([...save.fortuneDeck].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(save.newsCursor).toBe(19);
    expect(save.fortuneCursor).toBe(7);
    // 导入层：原样进 state 的两张牌堆（游标也一起），不再是「按顺序重建」
    const { state } = importOriginalSave(save, loadMap());
    expect(state.newsDeck.order).toEqual(save.newsDeck);
    expect(state.newsDeck.cursor).toBe(19);
    expect(state.fortuneDeck.order).toEqual(save.fortuneDeck);
    expect(state.fortuneDeck.cursor).toBe(7);
  });

  withSave('★★ 公库与樂透号码表**从存档读**（0x26ba = `[0x499080]`；0x26be 号码表）', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    // 公库：Save0 实测 3000（罚款/手续费accumulate进公库那一条路）
    expect(save.pool).toBe(3000);
    // 号码表：36 项，两个样本都是全 0（没人买过票）——但结构得读出来
    expect(save.lottery).toHaveLength(36);
    expect(save.lottery.every((v) => v === 0)).toBe(true);
    const { state } = importOriginalSave(save, loadMap());
    expect(state.pool).toBe(3000);
    expect(state.lottery).toHaveLength(36);
    expect(state.lottery.every((v) => v === 0)).toBe(true);
  });

  withSave('★★ 全局道具库存**从存档读**（平坦 0x6ea，`[道具号 - 1]`，> 8 号不限量）', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    // 解析层：8 个限量道具的库存
    expect(save.toolStock).toEqual([9, 1, 10, 10, 9, 9, 5, 1]);
    // 导入层：写进 `state.toolStock[道具号]`（1 基），9..13 号保持初始值（不限量）
    const { state } = importOriginalSave(save, loadMap());
    expect(state.toolStock.slice(1, 9)).toEqual([9, 1, 10, 10, 9, 9, 5, 1]);
    expect(state.toolStock[0]).toBe(0);
    const initial = initialToolStock();
    for (let id = 9; id <= 13; id++) expect(state.toolStock[id]).toBe(initial[id]);
  });

  withSave('★★ 持仓**从存档读**（Save0 的实际数据：玩家 1 持 2 号股 2647 股 @13.74）', () => {
    const save = parseSave(new Uint8Array(readFileSync(ORIGINAL_SAVE)));
    // 先钉解析层：4 人 × 12 支，第 1 位玩家手里那两笔
    expect(save.playerStocks).toHaveLength(4);
    expect(save.playerStocks[0]).toHaveLength(12);
    // float 精度：13.7423496… 是存档里那个 4 字节浮点的真值
    expect(save.playerStocks[1]![2]!.amount).toBe(2647);
    expect(save.playerStocks[1]![2]!.avgCost).toBeCloseTo(13.7423, 4);
    expect(save.playerStocks[1]![5]!.amount).toBe(100);
    // 再钉导入层：同一笔进 `state.holdings`
    const { state } = importOriginalSave(save, loadMap());
    expect(state.holdings[1]![2]!.amount).toBe(2647);
    expect(state.holdings[1]![2]!.avgCost).toBeCloseTo(13.7423, 4);
    // 没持仓的那几支仍是空仓（不是 undefined）
    expect(state.holdings[0]![0]).toEqual({ amount: 0, avgCost: 0 });
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
