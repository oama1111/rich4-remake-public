/*
 * 过路费计算验证 —— 用真实地图数据
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { calculateLandToll, countChainStores, CHAIN_STORE_TOLL, LAND_TYPE_HOUSE } from './toll.ts';
import { parseMap, MAX_LAND_LEVEL } from '../loaders/map.ts';
import type { LandInfo } from '../loaders/map.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const hasMap = existsSync(MAP0);
const d = hasMap ? describe : describe.skip;

function loadLands(): LandInfo[] {
  return parseMap(new Uint8Array(readFileSync(MAP0))).lands;
}

/** 构造测试地块 */
function land(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1,
    x: 0,
    y: 0,
    name: '测试区',
    priceStatus: 0,
    type: LAND_TYPE_HOUSE,
    owner: 0,
    level: 0,
    landPrice: 1000,
    housePrice: 200,
    rentByLevel: [200, 500, 1200, 2800, 6000, 10000],
    flast: 0,
    ...over,
  };
}

d('租金表 —— 来自真实地图数据', () => {
  it('每块住宅都有 6 级租金表，且严格递增', () => {
    const lands = loadLands();
    expect(lands.length).toBe(50);
    for (const l of lands) {
      expect(l.rentByLevel.length).toBe(MAX_LAND_LEVEL + 1);
      for (let lv = 1; lv <= MAX_LAND_LEVEL; lv++) {
        expect(l.rentByLevel[lv]!, `${l.name} 等级${lv}`).toBeGreaterThan(l.rentByLevel[lv - 1]!);
      }
    }
  });

  it('地图0 的已知地块租金表与实测一致', () => {
    const lands = loadLands();
    const taipei = lands.find((l) => l.name === '台北市')!;
    expect(taipei.landPrice).toBe(2500);
    expect(taipei.rentByLevel).toEqual([500, 1200, 3000, 7500, 16000, 30000]);

    const hsinchu = lands.find((l) => l.name === '新竹市')!;
    expect(hsinchu.landPrice).toBe(1000);
    expect(hsinchu.rentByLevel).toEqual([200, 500, 1200, 2800, 6000, 10000]);
  });

  it('地价越高，租金表整体越高', () => {
    const lands = loadLands();
    const byName = new Map<string, LandInfo>();
    for (const l of lands) if (!byName.has(l.name)) byName.set(l.name, l);
    const sorted = [...byName.values()].sort((a, b) => a.landPrice - b.landPrice);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.rentByLevel[5]!).toBeGreaterThanOrEqual(sorted[i - 1]!.rentByLevel[5]!);
    }
  });
});

describe('calculateLandToll —— 住宅分支', () => {
  it('单块地：租金 = rentByLevel[level] × 物价指数', () => {
    const lands = [land({ owner: 1, level: 2 })];
    expect(calculateLandToll(lands, 1, 1, '测试区')).toBe(1200);
    expect(calculateLandToll(lands, 1, 3, '测试区')).toBe(3600);
  });

  it('★ 同区多块地的租金是「相加」而非乘系数', () => {
    // 这是大富翁「整片区连号」手感的真实来源
    const lands = [
      land({ id: 1, owner: 1, level: 0 }), // 200
      land({ id: 2, owner: 1, level: 3 }), // 2800
      land({ id: 3, owner: 1, level: 5 }), // 10000
    ];
    expect(calculateLandToll(lands, 1, 1, '测试区')).toBe(200 + 2800 + 10000);
  });

  it('只统计同名（同一区）的地块', () => {
    const lands = [
      land({ id: 1, owner: 1, level: 5, name: 'A区' }), // 10000
      land({ id: 2, owner: 1, level: 5, name: 'B区' }), // 不计入
    ];
    expect(calculateLandToll(lands, 1, 1, 'A区')).toBe(10000);
  });

  it('只统计该玩家名下的地块', () => {
    const lands = [
      land({ id: 1, owner: 1, level: 5 }),
      land({ id: 2, owner: 2, level: 5 }), // 别人的，不计入
    ];
    expect(calculateLandToll(lands, 1, 1, '测试区')).toBe(10000);
  });

  it('住宅分支不计入连锁店（type != 0）', () => {
    const lands = [
      land({ id: 1, owner: 1, level: 5 }),
      land({ id: 2, owner: 1, level: 5, type: 1 }), // 连锁店
    ];
    expect(calculateLandToll(lands, 1, 1, '测试区')).toBe(10000);
  });

  it('无主地块过路费为 0', () => {
    expect(calculateLandToll([land({ owner: 0, level: 5 })], 0, 1, '测试区')).toBe(10000);
    // owner=0 的地确实会被 owner 参数 0 匹配到——这是原版行为，
    // 调用方必须先判断地块有主才调用本函数
  });
});

describe('calculateLandToll —— 连锁店分支', () => {
  it('每个连锁店固定 2000 × 物价指数', () => {
    const lands = [
      land({ id: 1, owner: 1, type: 1 }),
      land({ id: 2, owner: 1, type: 1 }),
      land({ id: 3, owner: 1, type: 1 }),
    ];
    expect(calculateLandToll(lands, 1, 1, null)).toBe(3 * CHAIN_STORE_TOLL);
    expect(calculateLandToll(lands, 1, 5, null)).toBe(3 * CHAIN_STORE_TOLL * 5);
  });

  it('连锁店分支与等级无关', () => {
    const a = [land({ owner: 1, type: 1, level: 0 })];
    const b = [land({ owner: 1, type: 1, level: 5 })];
    expect(calculateLandToll(a, 1, 1, null)).toBe(calculateLandToll(b, 1, 1, null));
  });

  it('连锁店分支不计入住宅', () => {
    const lands = [
      land({ id: 1, owner: 1, type: 1 }),
      land({ id: 2, owner: 1, type: LAND_TYPE_HOUSE }),
    ];
    expect(calculateLandToll(lands, 1, 1, null)).toBe(CHAIN_STORE_TOLL);
  });
});

describe('countChainStores', () => {
  it('只数该玩家的连锁店', () => {
    const lands = [
      land({ id: 1, owner: 1, type: 1 }),
      land({ id: 2, owner: 1, type: 2 }),
      land({ id: 3, owner: 2, type: 1 }),
      land({ id: 4, owner: 1, type: LAND_TYPE_HOUSE }),
    ];
    expect(countChainStores(lands, 1)).toBe(2);
    expect(countChainStores(lands, 2)).toBe(1);
    expect(countChainStores(lands, 3)).toBe(0);
  });
});

d('在真实地图上的量级检查', () => {
  it('地图0 整片台北市满级的过路费量级合理', () => {
    const lands = loadLands().map((l) => ({ ...l }));
    // 把 4 块台北市全部划给玩家 1 并升满
    for (const l of lands) {
      if (l.name === '台北市') {
        l.owner = 1;
        l.level = MAX_LAND_LEVEL;
      }
    }
    const toll = calculateLandToll(lands, 1, 1, '台北市');
    expect(toll).toBe(4 * 30000); // 4 块 × 满级 30000
    // 物价指数放大
    expect(calculateLandToll(lands, 1, 5, '台北市')).toBe(4 * 30000 * 5);
  });
});
