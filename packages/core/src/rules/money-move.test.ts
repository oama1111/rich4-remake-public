/*
 * 金钱转移两原语 —— **原版真码回归**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 期望值全部来自 Unicorn 跑原版机器码（`rich4-spec/tests/test_money_move.py`，29/29）：
 *   · `pay_money`  @ `0x0041d2c6`（全局唯一付款通道）
 *   · `give_money` @ `0x0041d3f4`（纯收款，与付款不对称）
 *
 * 本文件专门补 `payment.test.ts` 没有覆盖的两块：
 *   ① `receiveMoney`（此前**一个用例都没有**）
 *   ② `monthlyPaid` / `monthlyReceived` 两个累计字段的**口径**
 *      （付款方记 **实付额**、收款方记收入；企业付款不记）
 */
import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  PARTY_COMPANY_BASE,
  PARTY_POOL,
  companyIndexOf,
  companyParty,
  isCompany,
  receiveMoney,
  transferMoney,
} from './payment.ts';
import type { Company } from './payment.ts';

/** 玩家：现金 1000 / 存款 2000 / 两个累计字段都 0（与原版用例同一初值） */
const fresh = (index: number) => makePlayer({
  index,
  cash: 1000,
  moneyInBank: 2000,
  monthlyPaid: 0,
  monthlyReceived: 0,
});

const four = () => [fresh(0), fresh(1), fresh(2), fresh(3)];

describe('give_money @ 0x41d3f4 —— flags bit0 选落点，且**总是**累计 +0x60', () => {
  it('flags=1 → 进现金', () => {
    const [p] = receiveMoney(four(), 0, 300, true);
    expect([p?.cash, p?.moneyInBank, p?.monthlyPaid, p?.monthlyReceived])
      .toEqual([1300, 2000, 0, 300]);
  });

  it('flags=0 → 进存款', () => {
    const [p] = receiveMoney(four(), 0, 300, false);
    expect([p?.cash, p?.moneyInBank, p?.monthlyPaid, p?.monthlyReceived])
      .toEqual([1000, 2300, 0, 300]);
  });

  it('★ 累计的是 monthlyReceived(+0x60)，**不是** monthlyPaid(+0x5c)', () => {
    const [p] = receiveMoney(four(), 0, 300, true);
    expect(p?.monthlyPaid).toBe(0);
    expect(p?.monthlyReceived).toBe(300);
  });

  it('负数也是纯加法（原版无护栏）', () => {
    const [p] = receiveMoney(four(), 0, -300, true);
    expect([p?.cash, p?.monthlyReceived]).toEqual([700, -300]);
  });

  it('只动收款人，其它玩家不变', () => {
    const next = receiveMoney(four(), 2, 777, true);
    expect(next[2]?.cash).toBe(1777);
    expect(next[2]?.monthlyReceived).toBe(777);
    expect(next[0]).toEqual(fresh(0));
    expect(next[3]).toEqual(fresh(3));
  });
});

describe('pay_money @ 0x0041d2c6 —— 落点与两级级联', () => {
  it('flags=0：付款方现金 −300，收款方**存款** +300', () => {
    const r = transferMoney(four(), [], 0, 0, 1, 300, 0);
    expect([r.players[0]?.cash, r.players[0]?.moneyInBank]).toEqual([700, 2000]);
    expect([r.players[1]?.cash, r.players[1]?.moneyInBank]).toEqual([1000, 2300]);
  });

  it('flags=1：收款方**现金** +300', () => {
    const r = transferMoney(four(), [], 0, 0, 1, 300, 1);
    expect([r.players[1]?.cash, r.players[1]?.moneyInBank]).toEqual([1300, 2000]);
  });

  it('flags=4：付款方**存款**优先 −300', () => {
    const r = transferMoney(four(), [], 0, 0, 1, 300, 4);
    expect([r.players[0]?.cash, r.players[0]?.moneyInBank]).toEqual([1000, 1700]);
  });

  it('现金 500 付 800 → 现金归零、存款扣 300', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, cash: 500, moneyInBank: 2000 });
    const r = transferMoney(ps, [], 0, 0, 1, 800, 0);
    expect([r.players[0]?.cash, r.players[0]?.moneyInBank]).toEqual([0, 1700]);
    expect(r.players[1]?.moneyInBank).toBe(2800);
  });

  it('★ 总额 800 付 1000 → 实付 800（monthlyPaid 记**实付额**）', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, cash: 500, moneyInBank: 300 });
    const r = transferMoney(ps, [], 0, 0, 1, 1000, 0);
    expect(r.paid).toBe(800);
    expect([r.players[0]?.cash, r.players[0]?.moneyInBank]).toEqual([0, 0]);
    expect(r.players[0]?.monthlyPaid).toBe(800);
    // 收款方也只收到 800
    expect(r.players[1]?.moneyInBank).toBe(2800);
    expect(r.players[1]?.monthlyReceived).toBe(800);
  });

  it('总额 800 付 799 → 不破产', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, cash: 500, moneyInBank: 300 });
    const r = transferMoney(ps, [], 0, 0, 1, 799, 0);
    expect([r.players[0]?.cash, r.players[0]?.moneyInBank]).toEqual([0, 1]);
    expect(r.bankrupted).toBe(false);
  });

  it('★ 付款方记 monthlyPaid、收款方记 monthlyReceived —— 别写反', () => {
    const r = transferMoney(four(), [], 0, 0, 1, 300, 0);
    expect(r.players[0]?.monthlyPaid).toBe(300);
    expect(r.players[0]?.monthlyReceived).toBe(0);
    expect(r.players[1]?.monthlyPaid).toBe(0);
    expect(r.players[1]?.monthlyReceived).toBe(300);
  });

  it('payee = −1 → 公库', () => {
    const r = transferMoney(four(), [], 0, 0, PARTY_POOL, 300, 0);
    expect(r.pool).toBe(300);
    expect(r.players[0]?.cash).toBe(700);
    expect(r.players[1]).toEqual(fresh(1));
  });
});

describe('pay_money —— 企业参与方', () => {
  /**
   * ⚠️ 企业数组**下标从 1 开始**（`companies[0]` 不使用）—— 与原件一致：
   *    原版判据 `cmp esi,0x64 / jle 玩家分支`，100 归玩家，最小企业编号 101 → 下标 1。
   *    （本条一度把企业放在下标 0，三个用例全空跑 —— 现在用例自己把这个约定钉住。）
   */
  const DUMMY = { funds: 0, fundsMirror: 0 } as Company;
  const companies = (): Company[] => [DUMMY, { funds: 5000, fundsMirror: 6000 } as Company];

  it('companyIndexOf：101 → 1、102 → 2；100 归玩家', () => {
    expect(companyIndexOf(companyParty(1))).toBe(1);
    expect(companyIndexOf(companyParty(2))).toBe(2);
    expect(isCompany(PARTY_COMPANY_BASE)).toBe(false);
    expect(isCompany(PARTY_COMPANY_BASE + 1)).toBe(true);
  });

  it('★ 企业付款：企业 −0x28/−0x2c，且**不累计** monthlyPaid', () => {
    const r = transferMoney(four(), companies(), 0, companyParty(1), 1, 300, 0);
    expect([r.companies[1]?.funds, r.companies[1]?.fundsMirror]).toEqual([4700, 5700]);
    expect(r.players[0]).toEqual(fresh(0));      // 付款方玩家完全不动
    expect(r.players[1]?.moneyInBank).toBe(2300);
  });

  it('企业收款：企业 +0x28/+0x2c', () => {
    const r = transferMoney(four(), companies(), 0, 0, companyParty(1), 300, 0);
    expect([r.companies[1]?.funds, r.companies[1]?.fundsMirror]).toEqual([5300, 6300]);
    expect(r.players[0]?.monthlyPaid).toBe(300);
  });

  it('企业 → 企业', () => {
    const cs = [...companies(), { funds: 0, fundsMirror: 0 } as Company];
    const r = transferMoney(four(), cs, 0, companyParty(1), companyParty(2), 300, 0);
    expect(r.companies[1]?.funds).toBe(4700);
    expect([r.companies[2]?.funds, r.companies[2]?.fundsMirror]).toEqual([300, 300]);
  });
});
