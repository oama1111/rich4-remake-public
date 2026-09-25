/*
 * 银行验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  deposit, withdraw, borrow, repay, loanCapacity, isRejectedByBank,
  addSpecialFinance, removeSpecialFinance,
  cashRatioTarget, rebalanceCashByRatio,
} from './bank.ts';
import { payMoney } from '../rules/bankruptcy.ts';
import { applyMonthlyInterest } from '../rules/monthly.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';


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
    // ★ 审计补：还款额超过 現金+存款 ⇒ 原样不动（0x0043538c cmp edx, 現金+存款 / jle）
    const short = makePlayer({ loan: 10_000, cash: 3_000, moneyInBank: 2_000 });
    expect(repay(short, 6_000)).toBe(short);
    expect(repay(short, 5_000).loan).toBe(5_000);
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

// ============================================================
//  到行重分 —— cashRatio(+0x19) 的唯一读者
//  @source `_rich4_ui_bank_atm_entry` @ VA 0x004379c9 的 `loc_00437acd` 一支
// ============================================================

describe('★ 現金／存款比例重分 @source 0x00437acd', () => {
  it('月中（日 8..25）：目标就是百分比 ÷ 100，落账 = trunc(total × target)', () => {
    // 50% → 0.5；现金 0、存款 1000 → 500 / 500
    const p = rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1000, cashRatio: 50 }), 15);
    expect(p.cash).toBe(500);
    expect(p.moneyInBank).toBe(500);
    // 总资产守恒
    expect(p.cash + p.moneyInBank).toBe(1000);
  });

  it('★ 夹取只在两端：t ≥ 1 → 0.9f、t ≤ 0 → 0.1f（0x3f666666 / 0x3dcccccd）', () => {
    // cashRatio 100 → t = 1.0 → 0.9f = 0.8999999761581421
    //   ⇒ trunc(10000 × 0.9f) = 8999（不是 9000）
    const hi = rebalanceCashByRatio(
      makePlayer({ cash: 0, moneyInBank: 10_000, cashRatio: 100 }),
      15,
    );
    expect(cashRatioTarget(100, 15)).toBe(Math.fround(0.9));
    expect(hi.cash).toBe(8999);
    expect(hi.moneyInBank).toBe(1001);
    // cashRatio 0 → t = 0 → 0.1f = 0.10000000149011612
    //   ⇒ trunc(1000 × 0.1f) = 100
    const lo = rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1000, cashRatio: 0 }), 15);
    expect(cashRatioTarget(0, 15)).toBe(Math.fround(0.1));
    expect(lo.cash).toBe(100);
  });

  it('★ 0 < t < 0.1 不向上夹（原版只在 t ≤ 0 才换 0.1）', () => {
    expect(cashRatioTarget(5, 15)).toBe(Math.fround(0.05));
    expect(cashRatioTarget(9, 15)).toBe(Math.fround(0.09));
    const p = rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1000, cashRatio: 5 }), 15);
    expect(p.cash).toBe(50);
  });

  it('★ 日倍率：日 ≤ 7 ×1.5、日 ≥ 26 ×0.5（0x464c10 / 0x464c18）', () => {
    expect(cashRatioTarget(50, 1)).toBe(0.75);
    expect(cashRatioTarget(50, 7)).toBe(0.75);
    expect(cashRatioTarget(50, 8)).toBe(0.5);
    expect(cashRatioTarget(50, 15)).toBe(0.5);
    expect(cashRatioTarget(50, 25)).toBe(0.5);
    expect(cashRatioTarget(50, 26)).toBe(0.25);
    expect(cashRatioTarget(50, 31)).toBe(0.25);
    // 倍率之后的夹取：100% 在月初 ×1.5 = 1.5 → 夹成 0.9
    expect(cashRatioTarget(100, 1)).toBe(Math.fround(0.9));
    // 50 → 0.75：trunc(1000 × 0.75) = 750
    expect(
      rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1000, cashRatio: 50 }), 7).cash,
    ).toBe(750);
    // 50 → 0.25：trunc(1000 × 0.25) = 250
    expect(
      rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1000, cashRatio: 50 }), 26).cash,
    ).toBe(250);
  });

  it('★ 什么都不做的带：|现状 − 目标| < 0.25 且现金 ≠ 0（0x464c20 / 0x464c28 = ±0.25）', () => {
    const p = makePlayer({ cash: 600, moneyInBank: 400, cashRatio: 50 }); // 0.6 − 0.5 = 0.1
    expect(rebalanceCashByRatio(p, 15)).toBe(p);
    // 边界：diff 恰好 +0.25 → 重分
    const plus = makePlayer({ cash: 750, moneyInBank: 250, cashRatio: 50 }); // 0.75 − 0.5
    expect(rebalanceCashByRatio(plus, 15).cash).toBe(500);
    // 边界：diff 恰好 −0.25 → 重分
    const minus = makePlayer({ cash: 250, moneyInBank: 750, cashRatio: 50 }); // 0.25 − 0.5
    expect(rebalanceCashByRatio(minus, 15).cash).toBe(500);
  });

  it('★ 现金为 0 时即使落在带里也重分（loc_00437bc1 `cmp [player+0x1c], 0`）', () => {
    // 20% 目标、现金 0 ⇒ diff = −0.2（带内），但现金为 0 → 仍重分
    const forced = rebalanceCashByRatio(
      makePlayer({ cash: 0, moneyInBank: 1000, cashRatio: 20 }),
      15,
    );
    expect(forced.cash).toBe(200);
    expect(forced.moneyInBank).toBe(800);
    // 只差「现金不为 0」这一条：现金 1 时同一条 diff 落回带内 → 不动
    const kept = makePlayer({ cash: 1, moneyInBank: 999, cashRatio: 20 });
    expect(rebalanceCashByRatio(kept, 15)).toBe(kept);
  });

  it('★ 向零截断，不是四舍五入', () => {
    // 50 / 日 26 → 0.25；total 1003 → 250.75 ⇒ 250（四舍五入会得 251）
    const a = rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1003, cashRatio: 50 }), 26);
    expect(a.cash).toBe(250);
    expect(a.moneyInBank).toBe(753);
    // 10 → 0.1f；total 1005 → 100.5000015 ⇒ 100（四舍五入会得 101）
    const b = rebalanceCashByRatio(makePlayer({ cash: 0, moneyInBank: 1005, cashRatio: 10 }), 15);
    expect(b.cash).toBe(100);
    expect(b.moneyInBank).toBe(905);
  });

  it('总资产 ≤ 0 原样返回（原版 0/0 = NaN 会把两个字段写成 0x80000000；见 Q-BANK-3）', () => {
    const p = makePlayer({ cash: 0, moneyInBank: 0, cashRatio: 50 });
    expect(rebalanceCashByRatio(p, 15)).toBe(p);
  });
});

describe('★ 接线：非真人落銀行格时重分，真人不重分', () => {
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3], specialKind: SPECIAL_KIND.BANK }),
      makeNode({ id: 3, adjacent: [2] }),
    ],
    lands: [],
  };

  function onBank(whoPlays: number) {
    return makeGameState({
      players: [
        makePlayer({
          index: 0,
          nodeId: 2,
          whoPlays,
          cash: 0,
          moneyInBank: 1000,
          cashRatio: 50,
        }),
        makePlayer({ index: 1, nodeId: 1 }),
      ],
      currentPlayer: 0,
      phase: 'settling',
      day: 15,
    });
  }

  it('电脑（who_plays = 2）：settle 时先重分，再当场走貸款屏的电脑那一支（不挂柜台）', () => {
    const r = reduce(onBank(WHO_PLAYS_COMPUTER), { type: 'settle' }, topo);
    expect(r.players[0]?.cash).toBe(500);
    expect(r.players[0]?.moneyInBank).toBe(500);
    // ★ 2026-09-23：电脑**不开**貸款屏 —— `0x004366a3 cmp byte [+0x15],1 / jne 0x4367ab` 那一支当场还 / 借，
    //   不经 pending（先前这里断言「挂着 bank 柜台」，复述的是让 `decidePending` 代答的旧实现）。
    //   这位 `loanRatio = 0`（`0x004368e1 test bh,bh / je`）⇒ 什么都不借。
    expect(r.pending).toBeNull();
    expect(r.players[0]?.loan).toBe(0);
  });

  it('真人（who_plays = 1）：原版走的是 ATM 对话框那一支，不重分', () => {
    const r = reduce(onBank(WHO_PLAYS_HUMAN), { type: 'settle' }, topo);
    expect(r.players[0]?.cash).toBe(0);
    expect(r.players[0]?.moneyInBank).toBe(1000);
    // ★ 第十三份试玩回报 #2：先挂 ATM 对话框（`0x0041b396 call 0x4379c9` → `0x00437a71` 模态窗），
    //   关掉之后才是柜台（`0x0041b3af call 0x436668`）—— 先前这里断言「直接是柜台」，复述的是漏了 ATM 的旧实现
    expect(r.pending).toEqual({ kind: 'atm', landing: true });
    expect(reduce(r, { type: 'declineDecision' }, topo).pending?.kind).toBe('bank');
  });

  it('被銀行拒绝往来期内（+0x3b ≠ 0）：连柜台都不开，也不重分', () => {
    const s = onBank(WHO_PLAYS_COMPUTER);
    const rejected = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, daysRejectedByBank: 3 } : p)),
    };
    const r = reduce(rejected, { type: 'settle' }, topo);
    expect(r.players[0]?.cash).toBe(0);
    expect(r.pending).toBeNull();
  });
});
