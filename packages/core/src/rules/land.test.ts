/*
 * 地产规则验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  landPurchasePrice,
  upgradeCost,
  canPurchase,
  canUpgrade,
  landingOnLand,
  housingIndexOf,
  HOUSING_TYPE_MIN,
  HOUSING_TYPE_MAX,
  GOD_BLOCKS_PURCHASE,
} from './land.ts';
import { parseMap, MAX_LAND_LEVEL } from '../loaders/map.ts';
import type { LandInfo } from '../loaders/map.ts';
import { makePlayer } from '../testing/factories.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const d = existsSync(MAP0) ? describe : describe.skip;

function land(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1, x: 0, y: 0, name: '测试区',
    priceStatus: 0, type: 0, owner: 0, level: 0, facing: 0,
    landPrice: 1000, housePrice: 200,
    rentByLevel: [200, 500, 1200, 2800, 6000, 10000],
    flast: 0,
    ...over,
  };
}


describe('housingIndexOf —— type 基数 2000', () => {
  it('区间内映射为 type - 2000', () => {
    expect(housingIndexOf(2001)).toBe(1);
    expect(housingIndexOf(2050)).toBe(50);
    expect(housingIndexOf(3999)).toBe(1999);
  });

  it('边界值不算住宅', () => {
    // 原版用 jbe / jae，故 2000 与 4000 本身都被排除
    expect(housingIndexOf(HOUSING_TYPE_MIN)).toBeNull();
    expect(housingIndexOf(HOUSING_TYPE_MAX)).toBeNull();
    expect(housingIndexOf(0)).toBeNull();
    expect(housingIndexOf(4001)).toBeNull(); // 设施，走别的分支
  });
});

describe('landPurchasePrice —— (地价 + 房价×等级) × 物价指数', () => {
  it('空地：只算地价', () => {
    expect(landPurchasePrice(land({ level: 0 }), 1)).toBe(1000);
  });

  it('已开发的地：连同房子一起买', () => {
    expect(landPurchasePrice(land({ level: 3 }), 1)).toBe(1000 + 200 * 3);
  });

  it('满级地块', () => {
    expect(landPurchasePrice(land({ level: 5 }), 1)).toBe(1000 + 200 * 5);
  });

  it('物价指数线性放大', () => {
    expect(landPurchasePrice(land({ level: 2 }), 4)).toBe((1000 + 400) * 4);
  });
});

describe('upgradeCost —— 房价 × 物价指数', () => {
  it('与等级无关', () => {
    expect(upgradeCost(land({ level: 0 }), 1)).toBe(200);
    expect(upgradeCost(land({ level: 4 }), 1)).toBe(200);
  });

  it('物价指数线性放大', () => {
    expect(upgradeCost(land(), 6)).toBe(1200);
  });
});

describe('canPurchase', () => {
  it('无主且钱够 → 可买', () => {
    const r = canPurchase(land(), makePlayer(), 1);
    expect(r.ok).toBe(true);
    expect(r.price).toBe(1000);
  });

  it('已有主 → 不可买', () => {
    expect(canPurchase(land({ owner: 2 }), makePlayer(), 1).reason).toBe('alreadyOwned');
  });

  it('梦游中 → 不可买', () => {
    const p = makePlayer();
    p.blocking.sleepWalking = 3;
    expect(canPurchase(land(), p, 1).reason).toBe('sleepWalking');
  });

  it('特定神明状态（= 土地公 id 12）→ 不可买', () => {
    expect(canPurchase(land(), makePlayer({ godInfo: GOD_BLOCKS_PURCHASE }), 1).reason).toBe('godBlocked');
    // ★ §7.100：那个 12 查出来是**土地公**（`gods.md`：id 12 = 土地公，
    //   「無立即效果；落腳時強佔土地」）⇒ 这道闸 = 「地已经被土地公占走，不必再买」。
    expect(GOD_BLOCKS_PURCHASE).toBe(12);
    expect(GOD_BLOCKS_PURCHASE).toBe(0x0c);
  });

  it('★ 四道闸的**顺序**照原版：已有主 → 梦游 → 土地公 → 现金不足', () => {
    // @source loc_0041a013 的判据序列（0x41a01a 梦游、0x41a027 神明、0x41a053 现金）
    const both = makePlayer({ godInfo: GOD_BLOCKS_PURCHASE, cash: 0 });
    both.blocking.sleepWalking = 2;
    // 四种毛病全占时，先报「已有主」；去掉 owner 报「梦游」；再去掉梦游报「土地公」
    expect(canPurchase(land({ owner: 3 }), both, 1).reason).toBe('alreadyOwned');
    expect(canPurchase(land(), both, 1).reason).toBe('sleepWalking');
    both.blocking.sleepWalking = 0;
    expect(canPurchase(land(), both, 1).reason).toBe('godBlocked');
  });

  it('钱不够 → 不可买', () => {
    const r = canPurchase(land({ landPrice: 50000 }), makePlayer({ cash: 1000 }), 1);
    expect(r.reason).toBe('notEnoughCash');
    expect(r.price).toBe(50000);
  });

  it('物价指数会把买不起的地变得更买不起', () => {
    const p = makePlayer({ cash: 3000 });
    expect(canPurchase(land(), p, 1).ok).toBe(true);
    expect(canPurchase(land(), p, 5).ok).toBe(false); // 1000*5 > 3000
  });
});

describe('canUpgrade', () => {
  it('自有住宅未满级且钱够 → 可建', () => {
    const r = canUpgrade(land({ owner: 1, level: 2 }), makePlayer(), 1);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(200);
  });

  it('不是自己的地 → 不可建', () => {
    expect(canUpgrade(land({ owner: 3 }), makePlayer(), 1).reason).toBe('notOwner');
  });

  it('等级已达上限 → 不可建', () => {
    // @source cmp byte [esi+0x1a], 5 / jae → end
    expect(canUpgrade(land({ owner: 1, level: MAX_LAND_LEVEL }), makePlayer(), 1).reason).toBe('maxLevel');
  });

  it('等级 4 仍可建，5 不可', () => {
    expect(canUpgrade(land({ owner: 1, level: 4 }), makePlayer(), 1).ok).toBe(true);
    expect(canUpgrade(land({ owner: 1, level: 5 }), makePlayer(), 1).ok).toBe(false);
  });

  it('连锁店不可升级', () => {
    expect(canUpgrade(land({ owner: 1, level: 1, type: 1 }), makePlayer(), 1).reason).toBe('chainStore');
  });

  it('梦游中不可建', () => {
    const p = makePlayer();
    p.blocking.sleepWalking = 1;
    expect(canUpgrade(land({ owner: 1 }), p, 1).reason).toBe('sleepWalking');
  });

  it('钱不够不可建', () => {
    expect(canUpgrade(land({ owner: 1, housePrice: 9999 }), makePlayer({ cash: 100 }), 1).reason)
      .toBe('notEnoughCash');
  });
});

describe('landingOnLand —— 三岔判定', () => {
  it('无主 / 自有 / 他人', () => {
    expect(landingOnLand(land({ owner: 0 }), 0)).toBe('unowned');
    expect(landingOnLand(land({ owner: 1 }), 0)).toBe('own');   // owner = index+1
    expect(landingOnLand(land({ owner: 2 }), 0)).toBe('other');
  });
});

d('在真实地图数据上的量级检查', () => {
  it('地图0 台北市：空地价 2500，满级买价 5000', () => {
    const lands = parseMap(new Uint8Array(readFileSync(MAP0))).lands;
    const taipei = lands.find((l) => l.name === '台北市')!;
    expect(landPurchasePrice(taipei, 1)).toBe(2500); // level 0
    expect(landPurchasePrice({ ...taipei, level: 5 }, 1)).toBe(2500 + 500 * 5);
    expect(upgradeCost(taipei, 1)).toBe(500);
  });

  it('把台北市从空地升到满级的总花费', () => {
    const lands = parseMap(new Uint8Array(readFileSync(MAP0))).lands;
    const taipei = lands.find((l) => l.name === '台北市')!;
    // 买地 2500 + 5 次盖房各 500
    const total = landPurchasePrice(taipei, 1) + upgradeCost(taipei, 1) * MAX_LAND_LEVEL;
    expect(total).toBe(2500 + 2500);
    // 满级单块租金 30000，约 6 倍于总投入 —— 与原版「地产滚雪球」手感吻合
    expect(taipei.rentByLevel[MAX_LAND_LEVEL]).toBe(30000);
  });
});
