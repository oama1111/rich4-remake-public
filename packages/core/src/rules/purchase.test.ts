/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 落点消费 —— 只看现金，不动存款
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  OBJECT_NAMES,
  PURCHASE_BLOCKING_GODS,
  buildHousePrice,
  purchase,
  purchaseBlockedBy,
} from './purchase.ts';

describe('★ 只扣现金，存款不参与', () => {
  it('现金够时直接扣现金', () => {
    const r = purchase(makePlayer({ cash: 5000, moneyInBank: 99999 }), 3000);
    expect(r.ok).toBe(true);
    expect(r.player.cash).toBe(2000);
    expect(r.player.moneyInBank).toBe(99999);
  });

  it('★ 现金不足即失败——哪怕存款绰绰有余', () => {
    const r = purchase(makePlayer({ cash: 100, moneyInBank: 999999 }), 3000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('notEnoughCash');
    expect(r.player.cash).toBe(100);
    expect(r.player.moneyInBank).toBe(999999);
  });

  it('★ 不触发破产（与 transferMoney 的级联不同）', () => {
    const r = purchase(makePlayer({ cash: 0, moneyInBank: 0 }), 1);
    expect(r.ok).toBe(false);
    // 没有 bankrupted 这回事，状态原样返回
    expect(r.player.cash).toBe(0);
  });

  it('恰好够可以买（原版用 jg 而非 jge）', () => {
    const r = purchase(makePlayer({ cash: 3000 }), 3000);
    expect(r.ok).toBe(true);
    expect(r.player.cash).toBe(0);
  });
});

describe('★ 衰神/死神附身时禁止消费', () => {
  it('小衰神(7) / 大衰神(8) / 死神(15) 挡下消费', () => {
    for (const god of PURCHASE_BLOCKING_GODS) {
      const r = purchase(makePlayer({ cash: 999999, godInfo: god }), 100);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('blockedByGod');
      expect(r.blockedBy).toBe(OBJECT_NAMES[god]);
    }
  });

  it('挡路的正是这三个名字', () => {
    expect(PURCHASE_BLOCKING_GODS.map((g) => OBJECT_NAMES[g])).toEqual([
      '小衰神', '大衰神', '死神',
    ]);
  });

  it('★ 财神/福神不挡（只有 7/8/15 三种）', () => {
    for (const god of [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 16]) {
      expect(purchaseBlockedBy(makePlayer({ godInfo: god }))).toBeNull();
    }
  });

  it('★ 先判附身、再判钱——钱不够也报附身', () => {
    const r = purchase(makePlayer({ cash: 0, godInfo: 15 }), 100);
    expect(r.reason).toBe('blockedByGod');
  });
});

describe('盖房价', () => {
  it('房价 × 物价指数', () => {
    expect(buildHousePrice(300, 1)).toBe(300);
    expect(buildHousePrice(300, 7)).toBe(2100);
  });
});
