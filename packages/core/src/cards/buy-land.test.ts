/*
 * 购地卡验证 —— 基准为原版 exe 反汇编（VA 0x00442325）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyBuyLandCard, BUY_LAND_HOSTILITY_IS_NOOP, intendedBuyLandHostility,
} from './buy-land.ts';
import { makeLand, makePlayer } from '../testing/factories.ts';

const houseNode = (i: number) => 2000 + i;

describe('购地卡 —— 强制买下他人地产', () => {
  it('价格 = (地价 + 房价 × 等级) × 物价指数', () => {
    const r = applyBuyLandCard(
      houseNode(1),
      makeLand({ owner: 2, level: 3, landPrice: 1000, housePrice: 200 }),
      makePlayer({ index: 0, cash: 999_999 }),
      2,
    );
    expect(r.ok).toBe(true);
    expect(r.price).toBe((1000 + 200 * 3) * 2);
    expect(r.previousOwner).toBe(1);
  });

  it('★ 无主地不可用（要走普通买地流程）', () => {
    const r = applyBuyLandCard(houseNode(1), makeLand({ owner: 0 }), makePlayer(), 1);
    expect(r.reason).toBe('unowned');
  });

  it('★ 不能买自己的地', () => {
    const r = applyBuyLandCard(
      houseNode(1), makeLand({ owner: 1 }), makePlayer({ index: 0 }), 1,
    );
    expect(r.reason).toBe('alreadyMine');
  });

  it('★ 只看现金，不动存款', () => {
    const r = applyBuyLandCard(
      houseNode(1),
      makeLand({ owner: 2, landPrice: 80_000 }),
      makePlayer({ index: 0, cash: 50_000, moneyInBank: 999_999 }),
      1,
    );
    expect(r.reason).toBe('notEnoughCash');
    expect(r.price).toBe(80_000);
  });

  it('非住宅落点失败', () => {
    expect(applyBuyLandCard(0, makeLand({ owner: 2 }), makePlayer(), 1).reason).toBe('notHousingLand');
    expect(applyBuyLandCard(4001, makeLand({ owner: 2 }), makePlayer(), 1).reason).toBe('notHousingLand');
  });
});

describe('★ 原版 bug：敌意更新是空操作', () => {
  it('已登记为空操作', () => {
    expect(BUY_LAND_HOSTILITY_IS_NOOP).toBe(true);
  });

  it('原版意图公式记录在案（但不生效）', () => {
    // land_price × price_index × (level + 2) / 5
    expect(intendedBuyLandHostility(2500, 1, 0)).toBe(1000);
    expect(intendedBuyLandHostility(1000, 3, 2)).toBe(2400);
  });

  it('★ 意图值作为 double 传出时，低 32 位恒为 0', () => {
    // 这正是原版 bug 的成因：调用方压 8 字节 double，
    // 被调方按 4 字节 int 读 [esp+0x14]，取到的是低半部分。
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    let nonZero = 0;
    for (const lp of [1000, 1500, 2000, 2500, 3000, 5000, 8000]) {
      for (let pi = 1; pi <= 20; pi++) {
        for (let lv = 0; lv <= 5; lv++) {
          dv.setFloat64(0, intendedBuyLandHostility(lp, pi, lv), true);
          if (dv.getUint32(0, true) !== 0) nonZero++;
        }
      }
    }
    expect(nonZero).toBe(0);
  });
});
