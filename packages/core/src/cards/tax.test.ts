/*
 * 查税卡验证 —— 基准为原版 exe 反汇编（VA 0x004451f0）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyTaxCard, TAX_RATE } from './tax.ts';
import { PASSIVE_CARDS } from './passive.ts';
import { makePlayer } from '../testing/factories.ts';

const four = (cash = 100_000) =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, cash }));

// ★★ 税金必须**转给施卡者**（原版 `0x004453a4` `0x41d2c6(目标, 使用者, tax2, 0)`；
//   旗标 0 ⇒ 目标**现金扣**、施卡者**存款收**，且施卡者 `+0x60` 本月收入累加）。
//   此前 remake 只 `cash - tax`，钱凭空消失、施卡者一分拿不到。
describe('★ 税金转给施卡者（不是凭空消失）', () => {
  it('目标现金 −tax、施卡者存款 +tax、施卡者本月收入 +tax', () => {
    const ps = four(500_000);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(r.players[1]!.cash).toBe(400_000); // 目标现金扣
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + 100_000); // ★ 施卡者存款收
    expect(r.players[0]!.cash).toBe(500_000); // 不进现金（旗标 0）
    expect(r.players[0]!.monthlyReceived).toBe(ps[0]!.monthlyReceived + 100_000); // ★ +0x60
    // 目标的本月支出也累加（0x41d2c6 付款方侧 `add [+0x5c], paid`）
    expect(r.players[1]!.monthlyPaid).toBe(ps[1]!.monthlyPaid + 100_000);
  });

  it('目标现金不足时级联到存款', () => {
    const ps = four(1_000).map((p, i) => (i === 1 ? { ...p, cash: 100, moneyInBank: 10_000 } : p));
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(r.tax).toBe(20); // trunc(100 × 0.2)
    expect(r.players[1]!.cash).toBe(80);
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + 20);
  });
});

// ★ 免費卡(20) 被**消耗**：原版 `0x444a60` 内部 `0x444b30 push 0x14 / call 0x441343`
describe('★ 免費卡(20)：免掉税金且被消耗', () => {
  it('持免費卡则不转账，且该卡被扣掉', () => {
    const ps = four(500_000).map((p, i) =>
      i === 1 ? { ...p, cards: [PASSIVE_CARDS.FREE, 3] } : p,
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(r.defended).toBe(true);
    expect(r.players[1]!.cash).toBe(500_000); // 没扣钱
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank); // 施卡者也没收到
    expect(r.players[1]!.cards).toEqual([3]); // ★ 免費卡没了
    expect(ps[1]!.cards).toContain(PASSIVE_CARDS.FREE); // 原数组不变
  });

  it('★ 敌意照记（原版在免費卡判定**之前**就算好 `tax/100`）', () => {
    const ps = four(500_000).map((p, i) =>
      i === 1 ? { ...p, cards: [PASSIVE_CARDS.FREE] } : p,
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(r.defended).toBe(true);
    expect(r.hostilityDelta).toBe(1000); // 100_000 / 100
  });
});

// ★ 嫁祸卡(19) 分支：**税额 > 2000** 且目标持有 19 时可换目标，
//   且 `tax2` **按最终目标的现金重算**（原版 `0x0044534e` / `0x0044537d`–`0x00445391`）。
describe('★ 查稅卡的嫁祸分支与 tax2 重算', () => {
  it('税额 > 2000 且持嫁祸卡 ⇒ 换目标，金额按**新目标**现金重算', () => {
    // 目标 1：cash 100_000 ⇒ tax 20_000 > 2000；持嫁祸卡
    // 新目标 3：cash 50_000 ⇒ tax2 = 10_000
    const ps = four(0).map((p, i) => {
      if (i === 1) return { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] };
      if (i === 3) return { ...p, cash: 50_000 };
      return { ...p, cash: 10_000 };
    });
    // 期望值**从实际玩家值推导**，不写死 —— 这样测的是"重算"这个行为本身
    const taxOrig = Math.trunc(ps[1]!.cash * 0.2);
    const taxNew = Math.trunc(ps[3]!.cash * 0.2);
    expect(taxOrig).toBeGreaterThan(2000); // 前提：超过嫁祸门槛
    expect(taxNew).not.toBe(taxOrig); // 前提：两个数不同，否则测不出"重算"

    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, () => 3);
    expect(r.tax).toBe(taxNew); // ★ 按**新目标**重算，不是 taxOrig
    expect(r.players[3]!.cash).toBe(ps[3]!.cash - taxNew); // 新目标付钱
    expect(r.players[1]!.cash).toBe(ps[1]!.cash); // 原目标不动
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + taxNew); // 施卡者收款
    expect(r.players[1]!.cards).not.toContain(PASSIVE_CARDS.SCAPEGOAT); // 嫁祸卡被消耗
  });

  it('★ 税额 ≤ 2000 时**不查**嫁祸卡（原版 `jle 0x44536f`）', () => {
    const ps = four(0).map((p, i) =>
      i === 1 ? { ...p, cash: 10_000, cards: [PASSIVE_CARDS.SCAPEGOAT] } : { ...p, cash: 1_000 },
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, () => 3);
    const taxOrig = Math.trunc(ps[1]!.cash * 0.2);
    expect(taxOrig).toBeLessThanOrEqual(2000); // 前提：未过门槛
    expect(r.tax).toBe(taxOrig); // 未换目标 ⇒ 金额不变
    expect(r.players[1]!.cash).toBe(ps[1]!.cash - taxOrig);
    expect(r.players[1]!.cards).toContain(PASSIVE_CARDS.SCAPEGOAT); // 没被消耗
  });

  it('放弃转嫁（-1）⇒ 保持原目标，但嫁祸卡**照样被消耗**', () => {
    const ps = four(0).map((p, i) =>
      i === 1 ? { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] } : { ...p, cash: 1_000 },
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, () => -1);
    expect(r.tax).toBe(Math.trunc(ps[1]!.cash * 0.2));
    expect(r.players[1]!.cards).not.toContain(PASSIVE_CARDS.SCAPEGOAT);
  });

  it('★ 敌意仍按**最初**的税额算（在嫁祸之前，`0x004452fa`）', () => {
    const ps = four(0).map((p, i) => {
      if (i === 1) return { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] };
      if (i === 3) return { ...p, cash: 50_000 };
      return { ...p, cash: 0 };
    });
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, () => 3);
    expect(r.tax).toBe(Math.trunc(ps[3]!.cash * 0.2)); // 转移额是重算后的
    // ★ 但敌意 = **最初**那个税额 / 100（`0x004452fa` 在嫁祸之前）
    expect(r.hostilityDelta).toBe(Math.trunc(Math.trunc(ps[1]!.cash * 0.2) / 100));
  });
});

describe('查税卡', () => {
  it('★ 税率为 20%', () => {
    expect(TAX_RATE).toBe(0.2);
    const r = applyTaxCard(four(500_000), 0, { kind: 'player', index: 1 });
    expect(r.tax).toBe(100_000);
    expect(r.players[1]!.cash).toBe(400_000);
  });

  it('税额向零取整', () => {
    // 999 × 0.2 = 199.8 → 199
    const r = applyTaxCard(four(999), 0, { kind: 'player', index: 1 });
    expect(r.tax).toBe(199);
  });

  it('只影响目标', () => {
    const r = applyTaxCard(four(500_000), 0, { kind: 'player', index: 1 });
    expect(r.players[0]!.cash).toBe(500_000);
    expect(r.players[2]!.cash).toBe(500_000);
  });

  it('敌意 = 税额 / 100', () => {
    const r = applyTaxCard(four(500_000), 0, { kind: 'player', index: 1 });
    expect(r.hostilityDelta).toBe(1_000);
  });

  it('不可对自己使用', () => {
    expect(applyTaxCard(four(), 1, { kind: 'player', index: 1 }).error).toBe('cannotTargetSelf');
  });
});

describe('★ 免费卡防御', () => {
  it('目标持有免费卡时不扣钱', () => {
    // @source push 0x14 (20 = 免费卡) / call has_card
    const ps = four(500_000);
    ps[1] = makePlayer({ index: 1, cash: 500_000, cards: [PASSIVE_CARDS.FREE] });
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(r.defended).toBe(true);
    expect(r.players[1]!.cash).toBe(500_000); // 未被扣
    expect(r.tax).toBe(100_000);               // 但税额仍被算出
  });

  it('持有其他防御卡不管用', () => {
    const ps = four(500_000);
    // 免罪卡(21) 防的是梦游那类，不防查税
    ps[1] = makePlayer({ index: 1, cash: 500_000, cards: [PASSIVE_CARDS.ABSOLUTION] });
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(r.defended).toBe(false);
    expect(r.players[1]!.cash).toBe(400_000);
  });

  it('★ 不同有害卡查不同的防御卡', () => {
    // 查税卡查免费卡(20)；梦游卡查免罪卡(21)与嫁祸卡(19)
    expect(PASSIVE_CARDS.FREE).toBe(20);
    expect(PASSIVE_CARDS.ABSOLUTION).toBe(21);
    expect(PASSIVE_CARDS.SCAPEGOAT).toBe(19);
  });
});

describe('纯净性', () => {
  it('不原地修改入参', () => {
    const ps = four(500_000);
    const snap = JSON.stringify(ps);
    applyTaxCard(ps, 0, { kind: 'player', index: 1 });
    expect(JSON.stringify(ps)).toBe(snap);
  });
});
