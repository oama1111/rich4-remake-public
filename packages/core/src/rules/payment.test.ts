/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 金钱转移 —— 以 VA 0x0041d2c6 的分支结构为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  PARTY_POOL,
  PAY_FLAG_CREDIT_TO_CASH,
  PAY_FLAG_DEBIT_FROM_BANK,
  companyParty,
  debitPlayer,
  isCompany,
  transferMoney,
  type Company,
} from './payment.ts';

const ps = (a: Partial<Parameters<typeof makePlayer>[0]>, b: Partial<Parameters<typeof makePlayer>[0]>) => [
  makePlayer({ index: 0, ...a }),
  makePlayer({ index: 1, ...b }),
];

describe('debitPlayer —— 两级级联', () => {
  it('现金够时只动现金', () => {
    expect(debitPlayer(1000, 500, 300, false)).toEqual({
      cash: 700, bank: 500, paid: 300, bankrupted: false,
    });
  });

  it('现金不足时缺口转入存款，现金清零', () => {
    // 现金 100 - 300 = -200 → 存款 500 + (-200) = 300
    expect(debitPlayer(100, 500, 300, false)).toEqual({
      cash: 0, bank: 300, paid: 300, bankrupted: false,
    });
  });

  it('两个口袋都不足 → 实付被削减且判定破产', () => {
    // 现金 100 + 存款 50 = 150，要付 300 → 实付 150，缺 150
    expect(debitPlayer(100, 50, 300, false)).toEqual({
      cash: 0, bank: 0, paid: 150, bankrupted: true,
    });
  });

  it('★ 一分钱都没有时实付为 0，但仍判破产', () => {
    // @source `test ebx,ebx / jge / xor ebx,ebx` 在 call 0x40cd87 之前
    expect(debitPlayer(0, 0, 300, false)).toEqual({
      cash: 0, bank: 0, paid: 0, bankrupted: true,
    });
  });

  it('PAY_FLAG_DEBIT_FROM_BANK：先扣存款，分支完全对称', () => {
    expect(debitPlayer(1000, 500, 300, true)).toEqual({
      cash: 1000, bank: 200, paid: 300, bankrupted: false,
    });
    // 存款 500 - 800 = -300 → 现金 1000 - 300 = 700
    expect(debitPlayer(1000, 500, 800, true)).toEqual({
      cash: 700, bank: 0, paid: 800, bankrupted: false,
    });
  });

  it('恰好付清不触发破产（原版用 jge，0 属于「够」）', () => {
    expect(debitPlayer(100, 200, 300, false)).toEqual({
      cash: 0, bank: 0, paid: 300, bankrupted: false,
    });
  });
});

describe('transferMoney —— 玩家之间', () => {
  it('flags = 0：付款方扣现金，收款方进存款', () => {
    const r = transferMoney(ps({ cash: 1000 }, { cash: 10, moneyInBank: 20 }), [], 0, 0, 1, 300, 0);
    expect(r.players[0]!.cash).toBe(700);
    expect(r.players[1]!.cash).toBe(10);
    expect(r.players[1]!.moneyInBank).toBe(320);
    expect(r.paid).toBe(300);
  });

  it('PAY_FLAG_CREDIT_TO_CASH：收款方进现金', () => {
    const r = transferMoney(
      ps({ cash: 1000 }, { cash: 10, moneyInBank: 20 }), [], 0, 0, 1, 300,
      PAY_FLAG_CREDIT_TO_CASH,
    );
    expect(r.players[1]!.cash).toBe(310);
    expect(r.players[1]!.moneyInBank).toBe(20);
  });

  it('★ 付款方钱不够时，收款方只收到实付部分', () => {
    const r = transferMoney(ps({ cash: 100, moneyInBank: 50 }, { moneyInBank: 0 }), [], 0, 0, 1, 300);
    expect(r.paid).toBe(150);
    expect(r.players[1]!.moneyInBank).toBe(150); // 不是 300
    expect(r.bankrupted).toBe(true);
  });

  it('PAY_FLAG_DEBIT_FROM_BANK：付款方先动存款', () => {
    const r = transferMoney(
      ps({ cash: 1000, moneyInBank: 800 }, {}), [], 0, 0, 1, 300,
      PAY_FLAG_DEBIT_FROM_BANK,
    );
    expect(r.players[0]!.cash).toBe(1000);
    expect(r.players[0]!.moneyInBank).toBe(500);
  });

  it('本月收支累计的是实付额', () => {
    const r = transferMoney(ps({ cash: 100, moneyInBank: 50 }, {}), [], 0, 0, 1, 300);
    expect(r.players[0]!.monthlyPaid).toBe(150);
    expect(r.players[1]!.monthlyReceived).toBe(150);
  });
});

describe('transferMoney —— 公库与企业', () => {
  const companies: Company[] = [
    { funds: 1000, fundsMirror: 1000 },
    { funds: 2000, fundsMirror: 2000 },
  ];

  it('收款方为 -1 时进公库', () => {
    const r = transferMoney(ps({ cash: 1000 }, {}), [], 5000, 0, PARTY_POOL, 300);
    expect(r.pool).toBe(5300);
    expect(r.players[0]!.cash).toBe(700);
  });

  it('编号 > 100 是企业，两个资金字段同增同减', () => {
    expect(isCompany(companyParty(1))).toBe(true);
    const r = transferMoney(ps({ cash: 1000 }, {}), companies, 0, 0, companyParty(1), 300);
    expect(r.companies[1]).toEqual({ funds: 2300, fundsMirror: 2300 });
  });

  it('★ 100 本身走玩家分支（原版是 jle 不是 jl）', () => {
    expect(isCompany(100)).toBe(false);
    expect(isCompany(101)).toBe(true);
  });

  it('★ 企业付款不触发破产，资金可为负', () => {
    const r = transferMoney(ps({}, {}), companies, 0, companyParty(1), PARTY_POOL, 5000);
    expect(r.companies[1]).toEqual({ funds: -3000, fundsMirror: -3000 });
    expect(r.bankrupted).toBe(false);
    // 企业付款不削减实付额，公库收到全额
    expect(r.pool).toBe(5000);
  });
});
