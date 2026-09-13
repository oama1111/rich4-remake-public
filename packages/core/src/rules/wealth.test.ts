/*
 * 总资产与物价指数验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { calculatePlayerWealth, updatePriceIndex, STOCK_COUNT } from './wealth.ts';
import type { StockHolding } from './wealth.ts';
import { parseMap } from '../loaders/map.ts';
import { parseSave } from '../loaders/save.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { WHO_PLAYS_HUMAN, WHO_PLAYS_DEAD, WHO_PLAYS_COMPUTER } from '../state/types.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const SAVE0 = `${ROOT}/Rich4/Save0.dat`;

function player(over: Partial<Player> = {}): Player {
  return {
    index: 0, character: 0, whoPlays: WHO_PLAYS_HUMAN,
    nodeId: 1, lastNodeId: 0, direction: 0, ndices: 1,
    cash: 0, moneyInBank: 0, loan: 0, points: 0,
    blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: 0 },
    godInfo: 0, cards: [], tools: new Array<number>(13).fill(0),
    alliedPlayer: 0, alliedDays: 0,
    ...over,
  };
}

function land(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1, x: 0, y: 0, name: 'A', priceStatus: 0, type: 0, owner: 0, level: 0,
    landPrice: 1000, housePrice: 200, rentByLevel: [200, 500, 1200, 2800, 6000, 10000],
    flast: 0, ...over,
  };
}

function facility(over: Partial<FacilityInfo> = {}): FacilityInfo {
  return {
    id: 1, x: 0, y: 0, name: 'F', type: 0, owner: 0, level: 0,
    priceStatus: 0, landPrice: 5000, housePrice: 1000, ...over,
  };
}

describe('calculatePlayerWealth', () => {
  it('基础：现金 + 存款 − 贷款', () => {
    const p = player({ cash: 10000, moneyInBank: 5000, loan: 3000 });
    expect(calculatePlayerWealth(p, [], [])).toBe(12000);
  });

  it('贷款为负资产', () => {
    const p = player({ cash: 100, loan: 5000 });
    expect(calculatePlayerWealth(p, [], [])).toBe(-4900);
  });

  it('住宅：地价 + 等级 × 房价', () => {
    const p = player({ cash: 0 });
    const lands = [land({ owner: 1, level: 3 })];
    expect(calculatePlayerWealth(p, lands, [])).toBe(1000 + 3 * 200);
  });

  it('空地只算地价', () => {
    expect(calculatePlayerWealth(player(), [land({ owner: 1, level: 0 })], [])).toBe(1000);
  });

  it('★ 连锁店与住宅不对称：连锁店加一份房价，不乘等级', () => {
    // @source cmp byte [eax+0x18], 0 / jne → 直接加 house_price
    const chain = [land({ owner: 1, type: 1, level: 5 })];
    expect(calculatePlayerWealth(player(), chain, [])).toBe(1000 + 200); // 不是 1000 + 5*200
    const house = [land({ owner: 1, type: 0, level: 5 })];
    expect(calculatePlayerWealth(player(), house, [])).toBe(1000 + 5 * 200);
  });

  it('只算自己的地产', () => {
    const lands = [land({ id: 1, owner: 1 }), land({ id: 2, owner: 2 }), land({ id: 3, owner: 0 })];
    expect(calculatePlayerWealth(player(), lands, [])).toBe(1000);
  });

  it('设施：地价 + 等级 × 房价', () => {
    const facs = [facility({ owner: 1, level: 2 })];
    expect(calculatePlayerWealth(player(), [], facs)).toBe(5000 + 2 * 1000);
  });

  it('多项资产累加', () => {
    const p = player({ cash: 50000, moneyInBank: 10000, loan: 20000 });
    const lands = [land({ id: 1, owner: 1, level: 2 }), land({ id: 2, owner: 1, type: 1 })];
    const facs = [facility({ owner: 1, level: 1 })];
    expect(calculatePlayerWealth(p, lands, facs)).toBe(
      50000 + 10000 - 20000 + (1000 + 2 * 200) + (1000 + 200) + (5000 + 1000),
    );
  });

  it('股票按持股 × 股价计入', () => {
    const stocks: StockHolding[] = [{ amount: 10, price: 100 }];
    expect(calculatePlayerWealth(player({ cash: 500 }), [], [], stocks)).toBe(500 + 1000);
  });

  it('★ 股票逐支截断（非最后统一取整）', () => {
    // 原版每支算完就 fistp 截断。两支各 0.6 元：
    //   逐支截断: trunc(0.6+0)=0, trunc(0.6+0)=0 → 0
    //   统一取整: trunc(0.6+0.6)=1
    const stocks: StockHolding[] = [
      { amount: 1, price: 0.6 },
      { amount: 1, price: 0.6 },
    ];
    expect(calculatePlayerWealth(player({ cash: 0 }), [], [], stocks)).toBe(0);
  });

  it('固定 12 支股票', () => {
    expect(STOCK_COUNT).toBe(12);
    // 超出 12 支的部分被忽略
    const stocks: StockHolding[] = Array.from({ length: 20 }, () => ({ amount: 1, price: 100 }));
    expect(calculatePlayerWealth(player(), [], [], stocks)).toBe(12 * 100);
  });
});

describe('updatePriceIndex', () => {
  const wealth = (map: Map<number, number>) => (p: Player) => map.get(p.index) ?? 0;

  it('平均总资产 ÷ 初始资金', () => {
    const players = [player({ index: 0 }), player({ index: 1 })];
    const w = wealth(new Map([[0, 300_000], [1, 500_000]])); // 平均 400000
    expect(updatePriceIndex(players, w, 100_000, 1)).toBe(4);
  });

  it('★ 只升不降', () => {
    const players = [player({ index: 0 })];
    const w = wealth(new Map([[0, 100_000]])); // 新指数 = 1
    expect(updatePriceIndex(players, w, 100_000, 5)).toBe(5); // 保持 5，不降到 1
  });

  it('已出局玩家不计入', () => {
    const players = [
      player({ index: 0 }),
      player({ index: 1, whoPlays: WHO_PLAYS_DEAD }),
    ];
    const w = wealth(new Map([[0, 600_000], [1, 0]]));
    // 只算玩家0 → 平均 600000 / 100000 = 6
    expect(updatePriceIndex(players, w, 100_000, 1)).toBe(6);
  });

  it('电脑玩家同样计入', () => {
    const players = [player({ index: 0 }), player({ index: 1, whoPlays: WHO_PLAYS_COMPUTER })];
    const w = wealth(new Map([[0, 200_000], [1, 200_000]]));
    expect(updatePriceIndex(players, w, 100_000, 1)).toBe(2);
  });

  it('整数除法向零取整', () => {
    const players = [player({ index: 0 })];
    // 199999 / 100000 = 1.99999 → 1
    expect(updatePriceIndex(players, wealth(new Map([[0, 199_999]])), 100_000, 0)).toBe(1);
  });

  it('全员出局时保持原值', () => {
    const players = [player({ index: 0, whoPlays: WHO_PLAYS_DEAD })];
    expect(updatePriceIndex(players, () => 0, 100_000, 3)).toBe(3);
  });

  it('初始资金为 0 时保持原值（避免除零）', () => {
    expect(updatePriceIndex([player()], () => 100, 0, 2)).toBe(2);
  });

  it('负总资产不会把指数拉低', () => {
    const players = [player({ index: 0 })];
    expect(updatePriceIndex(players, () => -500_000, 100_000, 3)).toBe(3);
  });
});

describe.skipIf(!existsSync(MAP0) || !existsSync(SAVE0))('真实存档交叉验证', () => {
  it('用 Save0.dat 的玩家与地产算总资产', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE0)));
    const map = parseMap(save.mapData);
    const alive = save.players.filter((p) => p.isAlive);
    expect(alive.length).toBeGreaterThan(0);

    for (const sp of alive) {
      const p = player({
        index: sp.index,
        cash: sp.cash,
        moneyInBank: sp.moneyInBank,
        loan: sp.loan,
      });
      const w = calculatePlayerWealth(p, map.lands, map.facilities);
      // 总资产应当 ≥ 现金+存款−贷款（地产只会增加）
      expect(w).toBeGreaterThanOrEqual(sp.cash + sp.moneyInBank - sp.loan);
      const owned = map.lands.filter((l) => l.owner === sp.index + 1).length;
      console.log(
        `  玩家${sp.index}: 现金${sp.cash} 存款${sp.moneyInBank} 地产${owned}处 → 总资产 ${w}`,
      );
    }
  });

  it('存档中的物价指数与推算结果方向一致（只升不降）', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE0)));
    const map = parseMap(save.mapData);
    const players = save.players
      .filter((p) => p.isAlive)
      .map((sp) => player({ index: sp.index, cash: sp.cash, moneyInBank: sp.moneyInBank, loan: sp.loan }));

    const next = updatePriceIndex(
      players,
      (p) => calculatePlayerWealth(p, map.lands, map.facilities),
      150_000, // SAVE1 显示新开局为 150000 现金，推测初始资金量级
      save.priceIndex,
    );
    // 只升不降：结果不可能小于存档里记录的值
    expect(next).toBeGreaterThanOrEqual(save.priceIndex);
    console.log(`  存档物价指数 ${save.priceIndex} → 推算 ${next}`);
  });
});
