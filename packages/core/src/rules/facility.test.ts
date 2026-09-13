/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 设施过路费 —— 以 VA 0x0041a404 的三路分派为准
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { makeFacility } from '../testing/factories.ts';
import { parseMap } from '../loaders/map.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
import {
  FACILITY_TYPE_GAS_STATION,
  FACILITY_TYPE_SHOP_A,
  FACILITY_TYPE_SHOP_B,
  applyPriceStatus,
  calculateFacilityToll,
  shopToll,
  shopUnitPrice,
} from './facility.ts';

const RATES = [100, 200, 400, 800, 1600, 3200];

const input = (over: Partial<Parameters<typeof calculateFacilityToll>[0]> = {}) => ({
  facility: makeFacility({ type: FACILITY_TYPE_SHOP_A, level: 1, priceStatus: 0 }),
  rateByLevel: RATES,
  priceIndex: 1,
  stepsTotal: 3,
  trafficMethod: 1,
  multiplier: 1,
  ...over,
});

describe('★ 涨价标记使费率翻倍', () => {
  it('priceStatus 非 0 → ×2', () => {
    expect(applyPriceStatus(1000, 0)).toBe(1000);
    expect(applyPriceStatus(1000, 1)).toBe(2000);
    expect(applyPriceStatus(1000, 7)).toBe(2000); // 任意非 0 都只翻一倍
  });
});

describe('type 1 / 2：单价 × 转盘倍数', () => {
  it('单价按**等级**查表，再乘物价指数', () => {
    expect(shopUnitPrice(RATES, 0, 1, 0)).toBe(100);
    expect(shopUnitPrice(RATES, 3, 1, 0)).toBe(800);
    expect(shopUnitPrice(RATES, 3, 5, 0)).toBe(4000);
  });

  it('涨价标记再翻倍', () => {
    expect(shopUnitPrice(RATES, 3, 1, 1)).toBe(1600);
  });

  it('总额 = 单价 × 倍数', () => {
    expect(shopToll(800, 3)).toBe(2400);
  });

  it('type 1 与 type 2 的算法相同（只是转盘素材不同）', () => {
    const a = calculateFacilityToll(input({
      facility: makeFacility({ type: FACILITY_TYPE_SHOP_A, level: 2, priceStatus: 0 }),
      multiplier: 3,
    }));
    const b = calculateFacilityToll(input({
      facility: makeFacility({ type: FACILITY_TYPE_SHOP_B, level: 2, priceStatus: 0 }),
      multiplier: 3,
    }));
    expect(a).toBe(b);
    expect(a).toBe(400 * 3);
  });

  it('等级越高越贵', () => {
    const at = (level: number) =>
      calculateFacilityToll(input({
        facility: makeFacility({ type: FACILITY_TYPE_SHOP_A, level, priceStatus: 0 }),
      }));
    expect(at(4)).toBeGreaterThan(at(1));
  });
});

describe('★ type 3 加油站：按掷骰步数与交通工具', () => {
  const gas = (over = {}) =>
    calculateFacilityToll(input({
      facility: makeFacility({ type: FACILITY_TYPE_GAS_STATION, level: 5, priceStatus: 1 }),
      ...over,
    }));

  it('步数 × 500 × 交通倍率 × 物价指数', () => {
    expect(gas({ stepsTotal: 4, trafficMethod: 1, priceIndex: 1 })).toBe(2000);
    expect(gas({ stepsTotal: 4, trafficMethod: 3, priceIndex: 1 })).toBe(8000);
    expect(gas({ stepsTotal: 4, trafficMethod: 1, priceIndex: 3 })).toBe(6000);
  });

  it('★ 完全不看设施的等级与涨价标记', () => {
    const a = calculateFacilityToll(input({
      facility: makeFacility({ type: FACILITY_TYPE_GAS_STATION, level: 0, priceStatus: 0 }),
      stepsTotal: 4, trafficMethod: 1,
    }));
    const b = gas({ stepsTotal: 4, trafficMethod: 1 }); // level 5 + 涨价
    expect(a).toBe(b);
  });

  it('没有交通工具则不收费', () => {
    expect(gas({ trafficMethod: 0 })).toBe(0);
  });

  it('★ 也不看转盘倍数', () => {
    expect(gas({ multiplier: 99 })).toBe(gas({ multiplier: 1 }));
  });
});

describe('未知类型不收费', () => {
  it('type 0 与 type 4 都返回 0', () => {
    for (const type of [0, 4, 9]) {
      expect(calculateFacilityToll(input({
        facility: makeFacility({ type, level: 3 }),
        multiplier: 5,
      }))).toBe(0);
    }
  });
});

// ============================================================
//  真实地图数据交叉验证
// ============================================================

describe('★ rateByLevel 由真实地图数据印证', () => {
  const dir = `${ROOT}/extracted/map`;
  const run = existsSync(dir) ? it : it.skip;

  run('设施 +0x24 处确为 6 项递增的 uint16 费率表', () => {
    let checked = 0;
    for (const f of readdirSync(dir)) {
      let m;
      try {
        m = parseMap(new Uint8Array(readFileSync(`${dir}/${f}`)));
      } catch {
        continue;
      }
      for (const fa of m.facilities ?? []) {
        expect(fa.rateByLevel).toHaveLength(6);
        // housePrice 是 rateByLevel[0] 的别名
        expect(fa.housePrice).toBe(fa.rateByLevel[0]);
        // ★ 只有**下标 1..5**（等级 1..5）是租金，且严格递增。
        //   下标 0 与 housePrice 是同一个 +0x24，跳出序列是正常的。
        for (let i = 2; i < 6; i++) {
          expect(fa.rateByLevel[i]!).toBeGreaterThan(fa.rateByLevel[i - 1]!);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  run('★ 地图数据里所有设施的 type 都是 0（type 由运行时赋予）', () => {
    const types = new Set<number>();
    for (const f of readdirSync(dir)) {
      try {
        const m = parseMap(new Uint8Array(readFileSync(`${dir}/${f}`)));
        for (const fa of m.facilities ?? []) types.add(fa.type);
      } catch {
        continue;
      }
    }
    // 这条断言是**记录现状**，不是期望值：
    // 若日后发现 type 另有来源而使本断言失败，说明找到了答案，
    // 届时应更新 docs 里的 Q-FAC-1 而不是放宽断言。
    expect([...types]).toEqual([0]);
  });
});
