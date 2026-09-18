/*
 * 购地卡验证 —— 基准为原版 exe 反汇编（VA 0x00442325）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyBuyLandCard, buyLandCardHostility, intendedBuyLandHostility,
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

describe('★★ 原版 bug：敌意按 double 压栈、被调方只读低 32 位', () => {
  it('★★ "整齐"地价也**不是**全为 0：840 组里有 15 组低 32 位 = −1', () => {
    // `(地价×物价) × ((等级+2)/5)` 里 `(等级+2)/5` 本身就带舍入误差，
    // 乘回去可能落在"整齐值"的下一格（低 32 位 = −1）。
    // ⚠️ 这类值**增量 ≤ 0**，在原版里被 `0x40df83`「当前值 0 且增量为负 ⇒ 直接返回」
    //   挡掉，所以**看不出副作用** —— 但"恒为 0"的说法仍然是错的。
    const lows = new Set<number>();
    for (const lp of [1000, 1500, 2000, 2500, 3000, 5000, 8000]) {
      for (let pi = 1; pi <= 20; pi++) {
        for (let lv = 0; lv <= 5; lv++) {
          const v = buyLandCardHostility(lp, pi, lv);
          if (v !== 0) lows.add(v);
        }
      }
    }
    expect([...lows]).toEqual([-1]);
  });

  it('★★ 地价不是"整齐"数时，低 32 位是**巨大的正数**（原版真写垃圾值）', () => {
    // 原版实测（rich4-spec/tests/test_land_auction_cards.py，真跑 0x40df69）：
    // (地价 1001、物价 1、等级 2) ⇒ (1001×1) × (4/5) = 800.8 ⇒ 低 32 位 = +1717986919
    expect(buyLandCardHostility(1001, 1, 2)).toBe(1_717_986_919);
    expect(buyLandCardHostility(1001, 1, 1)).toBeLessThan(0);
  });

  it('★ 原版计数中间量（保留对照）', () => {
    expect(intendedBuyLandHostility(2500, 1, 0)).toBe(1000);
    expect(intendedBuyLandHostility(1000, 3, 2)).toBe(2400);
  });
});
