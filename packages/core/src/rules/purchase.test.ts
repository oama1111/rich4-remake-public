/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 落点消费 —— 只看现金，不动存款
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  OBJECT_NAMES,
  PURCHASE_BLOCKING_GODS,
  aiShouldPurchase,
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

/**
 * ★ 电脑买不买 —— `fcn_0041d7d4`（@source VA 0x0041d7d4）
 *
 * `保留额 = min(trunc(开局资金 × 0.05), 7000) × 物价指数`，
 * `现金 + 存款 − 价 > 保留额` 就买。**没有"值不值得"这一层。**
 */
describe('★ 电脑的买地判定（一条线，不是评分）', () => {
  const DEFAULT = 300_000; // 默认开局资金 → 15000 → 封顶 7000

  it('保留额先截、再封顶 7000，最后才乘物价指数', () => {
    const rich = makePlayer({ cash: 100_000, moneyInBank: 0 });
    // 100000 − 价 > 7000 ⇒ 价 < 93000
    expect(aiShouldPurchase(rich, 92_999, DEFAULT, 1)).toBe(true);
    expect(aiShouldPurchase(rich, 93_000, DEFAULT, 1)).toBe(false);
    // ★ 封顶发生在乘物价指数**之前**：物价 3 时线是 21000，不是 45000
    expect(aiShouldPurchase(rich, 78_999, DEFAULT, 3)).toBe(true);
    expect(aiShouldPurchase(rich, 79_000, DEFAULT, 3)).toBe(false);
  });

  it('★ 存款算作垫底：现金刚够付价时靠存款过线', () => {
    const p = makePlayer({ cash: 5000, moneyInBank: 7001 });
    expect(aiShouldPurchase(p, 5000, DEFAULT, 1)).toBe(true); // 5000 + 7001 − 5000 = 7001 > 7000
    const q = makePlayer({ cash: 5000, moneyInBank: 7000 });
    expect(aiShouldPurchase(q, 5000, DEFAULT, 1)).toBe(false); // 恰好等于 → 不买（jle）
  });

  it('开局资金低时 5% 才是那根线（没到 7000 就不封顶）', () => {
    const p = makePlayer({ cash: 10_000, moneyInBank: 0 });
    // 100000 × 5% = 5000 < 7000 ⇒ 10000 − 价 > 5000 ⇒ 价 < 5000
    expect(aiShouldPurchase(p, 4999, 100_000, 1)).toBe(true);
    expect(aiShouldPurchase(p, 5000, 100_000, 1)).toBe(false);
  });

  it('价为 0 时也照线判（不因"不要钱"就必买）', () => {
    expect(aiShouldPurchase(makePlayer({ cash: 7000, moneyInBank: 0 }), 0, DEFAULT, 1)).toBe(false);
    expect(aiShouldPurchase(makePlayer({ cash: 7001, moneyInBank: 0 }), 0, DEFAULT, 1)).toBe(true);
  });
});
