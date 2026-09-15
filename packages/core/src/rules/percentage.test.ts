/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 比例类事件金额 —— 税率与基数均由 exe 反汇编确认
 */

import { describe, expect, it } from 'vitest';
import { makeFacility, makeLand, makePlayer } from '../testing/factories.ts';
import {
  BANK_DIVIDEND_RATE,
  NEWS_TAX_RATE,
  bankDividend,
  incomeTax,
  percentageOf,
  propertyTax,
  propertyValue,
  stockTax,
  stockValue,
} from './percentage.ts';
import { truncTowardZero } from './rounding.ts';

describe('税率', () => {
  it('三种新聞税都是 5%，红利是 10%', () => {
    expect(NEWS_TAX_RATE).toBe(0.05);
    expect(BANK_DIVIDEND_RATE).toBe(0.1);
  });
});

describe('★ 0x457dbc 是「向零截断」，不是就近取偶、也不是 Math.round', () => {
  it('非 .5 时与常规四舍五入一致', () => {
    expect(truncTowardZero(1.2)).toBe(1);
    expect(truncTowardZero(1.8)).toBe(1);
    expect(truncTowardZero(-1.2)).toBe(-1);
  });

  it('★ 恰好 .5 时一律向零，不取偶', () => {
    expect(truncTowardZero(0.5)).toBe(0);
    expect(truncTowardZero(1.5)).toBe(1);
    expect(truncTowardZero(2.5)).toBe(2);
    expect(truncTowardZero(3.5)).toBe(3);
    // 对照：就近取偶会给 0/2/2/4，Math.round 会给 1/2/3/4
    expect(Math.round(2.5)).toBe(3);
    // 反例（旧的 x87Round 误读会给 2）：
    expect(truncTowardZero(1.5)).not.toBe(2);
  });

  it('★ 负数方向：向零截断 ≠ 向下取整、也 ≠ Math.round', () => {
    // -2.5：截断 -2、floor -3、round -2（-3.5 才和 round 分开）
    expect(truncTowardZero(-2.5)).toBe(-2);
    expect(Math.floor(-2.5)).toBe(-3);
    // -3.5：截断 -3、floor -4、round -3（-4.5 时 round 给 -4、截断给 -4）
    expect(truncTowardZero(-3.5)).toBe(-3);
    expect(Math.floor(-3.5)).toBe(-4);
    // -2.6：截断 -2、Math.round -3 —— 这一条才是实战里真会分叉的
    expect(truncTowardZero(-2.6)).toBe(-2);
    expect(Math.round(-2.6)).toBe(-3);
  });
});

describe('★ percentageOf = trunc(基数 × 税率)', () => {
  it('★ 实际会撞上：现金 150 的 5% 恰好是 7.5', () => {
    expect(150 * 0.05).toBe(7.5);
    // 原版：7.5 → 向零截断 → 7（就近取偶会给 8）
    expect(percentageOf(150, NEWS_TAX_RATE)).toBe(7);
    expect(percentageOf(150, NEWS_TAX_RATE)).toBe(truncTowardZero(150 * 0.05));
  });

  it('★ 其它恰好 .5 的基数（cash = 20k+10）', () => {
    expect(10 * 0.05).toBe(0.5);
    expect(30 * 0.05).toBe(1.5);
    expect(50 * 0.05).toBe(2.5);
    expect(90 * 0.05).toBe(4.5);
    expect(percentageOf(10, NEWS_TAX_RATE)).toBe(0);
    expect(percentageOf(30, NEWS_TAX_RATE)).toBe(1);
    expect(percentageOf(50, NEWS_TAX_RATE)).toBe(2);
    expect(percentageOf(90, NEWS_TAX_RATE)).toBe(4);
  });

  it('★ 红利 10% 的恰好 .5（存款 = 10k+5）', () => {
    expect(5 * 0.1).toBe(0.5);
    expect(15 * 0.1).toBe(1.5);
    expect(25 * 0.1).toBe(2.5);
    expect(percentageOf(5, BANK_DIVIDEND_RATE)).toBe(0);
    expect(percentageOf(15, BANK_DIVIDEND_RATE)).toBe(1);
    expect(percentageOf(25, BANK_DIVIDEND_RATE)).toBe(2);
    expect(bankDividend(makePlayer({ moneyInBank: 5 }))).toBe(0);
    expect(bankDividend(makePlayer({ moneyInBank: 15 }))).toBe(1);
  });

  it('★ 与 truncTowardZero 逐点一致（含负数）', () => {
    for (const base of [0, 7, 10, 29, 30, 31, 50, 90, 150, 1050, 12345]) {
      expect(percentageOf(base, NEWS_TAX_RATE)).toBe(truncTowardZero(base * NEWS_TAX_RATE));
    }
    // 负数（原版那几处基数不会是负的，但函数本身必须按同一语义走）
    expect(percentageOf(-150, NEWS_TAX_RATE)).toBe(-7);
    expect(percentageOf(-150, NEWS_TAX_RATE)).toBe(truncTowardZero(-150 * NEWS_TAX_RATE));
  });
});

describe('★ 所得稅的基数是现金余额，不是收入', () => {
  it('按 cash 算', () => {
    expect(incomeTax(makePlayer({ cash: 100_000 }))).toBe(5000);
  });

  it('★ 存款不计入', () => {
    const a = incomeTax(makePlayer({ cash: 100_000, moneyInBank: 0 }));
    const b = incomeTax(makePlayer({ cash: 100_000, moneyInBank: 999_999 }));
    expect(a).toBe(b);
  });

  it('本月收入也不计入——名字容易误导', () => {
    const p = makePlayer({ cash: 1000, monthlyReceived: 500_000 });
    expect(incomeTax(p)).toBe(50);
  });
});

describe('儲金紅利按存款的 10%', () => {
  it('按 moneyInBank 算', () => {
    expect(bankDividend(makePlayer({ moneyInBank: 50_000 }))).toBe(5000);
  });

  it('现金不计入', () => {
    expect(bankDividend(makePlayer({ cash: 999_999, moneyInBank: 0 }))).toBe(0);
  });
});

describe('地價稅', () => {
  const lands = () => [
    makeLand({ id: 1, owner: 1, level: 2, landPrice: 1000, housePrice: 300 }),
    makeLand({ id: 2, owner: 2, level: 3, landPrice: 2000, housePrice: 500 }),
  ];
  const facs = () => [makeFacility({ id: 1, owner: 1, level: 1, landPrice: 4000, housePrice: 400 })];

  it('地价 + 房价×等级，逐项累加', () => {
    // 玩家0 拥有 land1 (1000 + 300*2 = 1600) 与 fac1 (4000 + 400*1 = 4400)
    expect(propertyValue(0, lands(), facs(), 1)).toBe(6000);
  });

  it('★ 只算自己名下的', () => {
    expect(propertyValue(1, lands(), [], 1)).toBe(2000 + 500 * 3);
  });

  it('再乘物价指数', () => {
    expect(propertyValue(0, lands(), facs(), 3)).toBe(18_000);
  });

  it('税额是估值的 5%', () => {
    expect(propertyTax(0, lands(), facs(), 1)).toBe(300);
  });

  it('★ 恰好 .5 时向零截断：原值 30 → 1.5 → 1', () => {
    const one = [makeLand({ id: 9, owner: 1, level: 1, landPrice: 10, housePrice: 20 })];
    expect(propertyValue(0, one, [], 1)).toBe(30);
    expect(propertyTax(0, one, [], 1)).toBe(1); // 就近取偶会给 2
    expect(propertyTax(0, one, [], 1)).toBe(truncTowardZero(30 * NEWS_TAX_RATE));
  });

  it('无地产则无税', () => {
    expect(propertyTax(3, lands(), facs(), 1)).toBe(0);
  });
});

describe('證交稅', () => {
  it('持股数 × 股价 累加', () => {
    expect(stockValue([10, 20, 0], [100, 50, 999])).toBe(2000);
  });

  it('长度不齐时按缺省 0 处理', () => {
    expect(stockValue([10, 20], [100])).toBe(1000);
  });

  it('税额是市值的 5%', () => {
    expect(stockTax([10, 20, 0], [100, 50, 999])).toBe(100);
  });

  it('★ 恰好 .5 时向零截断：市值 30 → 1.5 → 1', () => {
    // 市值 10 → 0.5：截断与取偶都是 0，当边界锚点
    expect(stockTax([1], [10])).toBe(0);
    // 市值 30 → 1.5：截断 1、就近取偶 2 —— 这一条才分叉
    expect(stockTax([3], [10])).toBe(1);
    expect(stockTax([3], [10])).toBe(truncTowardZero(30 * NEWS_TAX_RATE));
    expect(stockTax([5], [10])).toBe(2); // 2.5 → 2
  });

  it('空仓无税', () => {
    expect(stockTax([], [])).toBe(0);
  });
});

describe('★ 与查税卡不是同一套机制', () => {
  it('新聞税 5% 且向零截断；查税卡 20% 且整数截断', async () => {
    const { TAX_RATE: cardRate } = await import('../cards/tax.ts');
    expect(NEWS_TAX_RATE).toBe(0.05);
    expect(cardRate).toBe(0.2);

    // 同样的现金，两者结果差得很远；取整方式同为「向零」但来源不同
    // （新聞税走 0x457dbc，查税卡走整数乘除）
    const cash = 1050;
    expect(percentageOf(cash, NEWS_TAX_RATE)).toBe(52); // 52.5 → 截断 → 52
    expect(Math.trunc(cash * cardRate)).toBe(210);
  });
});
