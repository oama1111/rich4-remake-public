/*
 * 银行验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  deposit, withdraw, borrow, repay, loanCapacity, isRejectedByBank,
  addSpecialFinance, removeSpecialFinance,
} from './bank.ts';
import { payMoney } from '../rules/bankruptcy.ts';
import { applyMonthlyInterest } from '../rules/monthly.ts';
import { makePlayer } from '../testing/factories.ts';


describe('存取款', () => {
  it('存款：现金 → 银行', () => {
    const p = deposit(makePlayer(), 30_000);
    expect(p.cash).toBe(70_000);
    expect(p.moneyInBank).toBe(80_000);
  });

  it('取款：银行 → 现金', () => {
    const p = withdraw(makePlayer(), 20_000);
    expect(p.cash).toBe(120_000);
    expect(p.moneyInBank).toBe(30_000);
  });

  it('存取总额守恒', () => {
    const p0 = makePlayer();
    const total = p0.cash + p0.moneyInBank;
    const p1 = deposit(p0, 40_000);
    expect(p1.cash + p1.moneyInBank).toBe(total);
    const p2 = withdraw(p1, 90_000);
    expect(p2.cash + p2.moneyInBank).toBe(total);
  });

  it('超额被限制在可用余额内', () => {
    expect(deposit(makePlayer(), 999_999).cash).toBe(0);
    expect(withdraw(makePlayer(), 999_999).moneyInBank).toBe(0);
  });

  it('非正金额无变化', () => {
    const p = makePlayer();
    expect(deposit(p, 0)).toBe(p);
    expect(withdraw(p, -1)).toBe(p);
  });
});

describe('贷款', () => {
  it('★ 上限 = 玩家总资产', () => {
    expect(loanCapacity(500_000, 0)).toBe(500_000);
    expect(loanCapacity(500_000, 200_000)).toBe(300_000);
  });

  it('负债达到总资产后不可再借', () => {
    expect(loanCapacity(500_000, 500_000)).toBe(0);
    expect(loanCapacity(500_000, 600_000)).toBe(0);
    expect(borrow(makePlayer({ loan: 500_000 }), 1, 500_000).borrowed).toBe(0);
  });

  it('★ 借到的钱进存款，不是现金', () => {
    const r = borrow(makePlayer(), 100_000, 500_000);
    expect(r.borrowed).toBe(100_000);
    expect(r.player.moneyInBank).toBe(150_000); // 50000 + 100000
    expect(r.player.cash).toBe(100_000);         // 现金不变
    expect(r.player.loan).toBe(100_000);
  });

  it('借款额被上限截断', () => {
    const r = borrow(makePlayer(), 999_999, 300_000);
    expect(r.borrowed).toBe(300_000);
    expect(r.player.loan).toBe(300_000);
  });

  it('★ 被银行拒绝期间不能贷款', () => {
    const p = makePlayer({ daysRejectedByBank: 3 });
    expect(isRejectedByBank(p)).toBe(true);
    expect(borrow(p, 100_000, 500_000).borrowed).toBe(0);
  });
});

describe('还款', () => {
  it('★ 级联顺序与付款相反：先扣存款，不足再扣现金', () => {
    const p = repay(makePlayer({ loan: 80_000 }), 80_000);
    expect(p.moneyInBank).toBe(0);       // 5 万存款被掏空
    expect(p.cash).toBe(70_000);          // 差的 3 万从现金补
    expect(p.loan).toBe(0);
  });

  it('对比：付款是先扣现金后扣存款', () => {
    const paid = payMoney(makePlayer(), 80_000);
    expect(paid.player.cash).toBe(20_000);      // 先动现金
    expect(paid.player.moneyInBank).toBe(50_000); // 存款不动
  });

  it('存款够时不动现金', () => {
    const p = repay(makePlayer({ loan: 30_000 }), 30_000);
    expect(p.moneyInBank).toBe(20_000);
    expect(p.cash).toBe(100_000);
  });

  it('还款额被负债截断', () => {
    const p = repay(makePlayer({ loan: 10_000 }), 999_999);
    expect(p.loan).toBe(0);
    expect(p.moneyInBank).toBe(40_000); // 只扣了 1 万
  });

  it('★ 还清时 loanDueDate 被清零', () => {
    const p = repay(makePlayer({ loan: 10_000, loanDueDate: 12345 }), 10_000);
    expect(p.loan).toBe(0);
    expect(p.loanDueDate).toBe(0);
  });

  it('未还清时 loanDueDate 保留', () => {
    const p = repay(makePlayer({ loan: 50_000, loanDueDate: 12345 }), 10_000);
    expect(p.loan).toBe(40_000);
    expect(p.loanDueDate).toBe(12345);
  });

  it('无负债时不产生变化', () => {
    const p = makePlayer();
    expect(repay(p, 1000)).toBe(p);
  });
});

describe('贷款与月息的交互', () => {
  it('★ 有贷款则当月不发利息', () => {
    const p = borrow(makePlayer(), 100_000, 500_000).player;
    expect(applyMonthlyInterest(p.moneyInBank, p.loan)).toBe(p.moneyInBank);
  });

  it('还清后恢复计息', () => {
    let p = borrow(makePlayer(), 100_000, 500_000).player;
    p = repay(p, 100_000);
    expect(p.loan).toBe(0);
    expect(applyMonthlyInterest(p.moneyInBank, p.loan)).toBe(
      Math.trunc(p.moneyInBank * 1.1),
    );
  });
});

describe('特别融资', () => {
  it('存入同时计入存款与 specialFinance', () => {
    const p = addSpecialFinance(makePlayer(), 60_000);
    expect(p.moneyInBank).toBe(110_000);
    expect(p.specialFinance).toBe(60_000);
  });

  it('取出先扣存款，不足从现金补', () => {
    const p = removeSpecialFinance(makePlayer({ specialFinance: 80_000 }), 80_000);
    expect(p.moneyInBank).toBe(0);
    expect(p.cash).toBe(70_000);
    expect(p.specialFinance).toBe(0);
  });

  it('取出额被 specialFinance 截断', () => {
    const p = removeSpecialFinance(makePlayer({ specialFinance: 10_000 }), 999);
    expect(p.specialFinance).toBe(10_000 - 999);
  });
});
