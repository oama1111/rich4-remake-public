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
