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
  x87Round,
} from './percentage.ts';

describe('税率', () => {
  it('三种新聞税都是 5%，红利是 10%', () => {
    expect(NEWS_TAX_RATE).toBe(0.05);
    expect(BANK_DIVIDEND_RATE).toBe(0.1);
  });
});

describe('★ x87 就近取偶，与 Math.round 在 .5 处不同', () => {
  it('非 .5 时与常规四舍五入一致', () => {
    expect(x87Round(1.2)).toBe(1);
    expect(x87Round(1.8)).toBe(2);
    expect(x87Round(-0.2)).toBe(0);
  });

  it('★ 恰好 .5 时取偶数，而不是一律向上', () => {
    expect(x87Round(0.5)).toBe(0);
    expect(x87Round(1.5)).toBe(2);
    expect(x87Round(2.5)).toBe(2);
    expect(x87Round(3.5)).toBe(4);
    // 对照：Math.round 在这几个点会给出 1/2/3/4
    expect(Math.round(2.5)).toBe(3);
  });

  it('★ 实际会撞上：现金 150 的 5% 恰好是 7.5', () => {
    expect(150 * 0.05).toBe(7.5);
    expect(percentageOf(150, NEWS_TAX_RATE)).toBe(8); // 7.5 → 取偶 → 8
    expect(percentageOf(50, NEWS_TAX_RATE)).toBe(2); // 2.5 → 取偶 → 2
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

  it('空仓无税', () => {
    expect(stockTax([], [])).toBe(0);
  });
});

describe('★ 与查税卡不是同一套机制', () => {
  it('新聞税 5% 且就近取偶；查税卡 20% 且整数截断', async () => {
    const { TAX_RATE: cardRate } = await import('../cards/tax.ts');
    expect(NEWS_TAX_RATE).toBe(0.05);
    expect(cardRate).toBe(0.2);

    // 同样的现金，两者结果差得很远，且取整方式也不同
    const cash = 1050;
    expect(percentageOf(cash, NEWS_TAX_RATE)).toBe(52); // 52.5 → 取偶 → 52
    expect(Math.trunc(cash * cardRate)).toBe(210);
  });
});
