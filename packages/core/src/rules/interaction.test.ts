/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 落点交互
 */

import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '../loaders/map.ts';
import {
  isUnimplementedPlace,
  needsInteraction,
  responseMatches,
  unimplementedPlace,
  type PendingInteraction,
} from './interaction.ts';

describe('★ 哪些格子需要玩家做决定', () => {
  it('公园与普通格不需要', () => {
    expect(needsInteraction(SPECIAL_KIND.NONE)).toBe(false);
    expect(needsInteraction(SPECIAL_KIND.PARK)).toBe(false);
  });

  it('★ 新聞/命運是即时结算，不需要决定', () => {
    expect(needsInteraction(SPECIAL_KIND.NEWS)).toBe(false);
    expect(needsInteraction(SPECIAL_KIND.FORTUNE)).toBe(false);
  });

  it('★ 點數与抽卡也是即时的', () => {
    for (const k of [
      SPECIAL_KIND.POINTS_50,
      SPECIAL_KIND.POINTS_30,
      SPECIAL_KIND.POINTS_10,
      SPECIAL_KIND.CARD,
    ]) {
      expect(needsInteraction(k), `kind ${k}`).toBe(false);
    }
  });

  it('银行/乐透/百货/魔法屋需要', () => {
    for (const k of [
      SPECIAL_KIND.BANK,
      SPECIAL_KIND.LOTTERY,
      SPECIAL_KIND.DEPARTMENT_STORE,
      SPECIAL_KIND.MAGIC_HOUSE,
    ]) {
      expect(needsInteraction(k), `kind ${k}`).toBe(true);
    }
  });
});

describe('★ 未实现的场所会明确报出来，而不是静默无事发生', () => {
  it('百货与魔法屋标为未实现', () => {
    expect(isUnimplementedPlace(SPECIAL_KIND.DEPARTMENT_STORE)).toBe(true);
    expect(isUnimplementedPlace(SPECIAL_KIND.MAGIC_HOUSE)).toBe(true);
  });

  it('带可读场所名', () => {
    const p = unimplementedPlace(SPECIAL_KIND.MAGIC_HOUSE);
    expect(p).toMatchObject({ kind: 'unimplemented', place: '魔法屋' });
  });

  it('三个小游戏也在列', () => {
    for (const k of [
      SPECIAL_KIND.PENGUIN_DIG,
      SPECIAL_KIND.BALLOON,
      SPECIAL_KIND.GIFT_FROM_SKY,
    ]) {
      expect(isUnimplementedPlace(k), `kind ${k}`).toBe(true);
    }
  });

  it('★ 银行与乐透**不**在未实现之列——它们有规则了', () => {
    expect(isUnimplementedPlace(SPECIAL_KIND.BANK)).toBe(false);
    expect(isUnimplementedPlace(SPECIAL_KIND.LOTTERY)).toBe(false);
  });
});

describe('★ 答复必须与待决交互配套', () => {
  const bank: PendingInteraction = { kind: 'bank', wealth: 1000, loanCapacity: 500 };
  const lottery: PendingInteraction = { kind: 'lottery', available: [1, 2], price: 1000, owned: 0 };

  it('放弃总是合法', () => {
    expect(responseMatches(bank, { kind: 'decline' })).toBe(true);
    expect(responseMatches(lottery, { kind: 'decline' })).toBe(true);
  });

  it('银行交互接受各种银行操作', () => {
    expect(responseMatches(bank, { kind: 'bankDeposit', amount: 100 })).toBe(true);
    expect(responseMatches(bank, { kind: 'bankBorrow', amount: 100 })).toBe(true);
  });

  it('★ 驴唇不对马嘴的答复会被挡下', () => {
    expect(responseMatches(bank, { kind: 'lotteryBuy', number: 3 })).toBe(false);
    expect(responseMatches(lottery, { kind: 'bankDeposit', amount: 1 })).toBe(false);
    expect(responseMatches(lottery, { kind: 'buyLand' })).toBe(false);
  });

  it('未实现的场所不接受任何实质答复', () => {
    const p = unimplementedPlace(SPECIAL_KIND.MAGIC_HOUSE);
    expect(responseMatches(p, { kind: 'buyLand' })).toBe(false);
    expect(responseMatches(p, { kind: 'decline' })).toBe(true);
  });
});

describe('魔法屋', () => {
  it('★ 未实现，但把 12 个选项名一并报出来 —— 缺口具体到条', () => {
    const p = unimplementedPlace(SPECIAL_KIND.MAGIC_HOUSE);
    expect(p.kind).toBe('unimplemented');
    if (p.kind !== 'unimplemented') return;
    expect(p.place).toBe('魔法屋');
    expect(p.options).toHaveLength(12);
    expect(p.options).toContain('立刻坐牢三天');
    expect(p.options).toContain('拍賣當格土地');
  });

  it('其他未实现场所没有选项表', () => {
    const p = unimplementedPlace(SPECIAL_KIND.DEPARTMENT_STORE);
    if (p.kind !== 'unimplemented') return;
    expect(p.options).toBeUndefined();
  });
});
