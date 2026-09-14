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
  it('★ 名单只剩三个小游戏 —— 百貨公司与魔法屋都已实现', () => {
    // 百貨公司接上了（places/shop.ts）、魔法屋接上了（places/magic-house.ts），
    // 两者都从未实现名单里摘掉了
    expect(isUnimplementedPlace(SPECIAL_KIND.DEPARTMENT_STORE)).toBe(false);
    expect(isUnimplementedPlace(SPECIAL_KIND.MAGIC_HOUSE)).toBe(false);
  });

  it('带可读场所名', () => {
    const p = unimplementedPlace(SPECIAL_KIND.PENGUIN_DIG);
    expect(p).toMatchObject({ kind: 'unimplemented', place: '企鵝挖寶' });
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
  // 这一条先前是「未实现，但把 12 个选项名报出来」。效果与目标两张跳表
  // 都解出来之后（places/magic-house.ts），魔法屋改为**即时结算**，
  // 不再产生任何待决交互——与新聞/命運同类。
  it('★ 已实现 —— 不再报 unimplemented', () => {
    expect(isUnimplementedPlace(SPECIAL_KIND.MAGIC_HOUSE)).toBe(false);
  });

  it('尚未实现的场所没有选项表', () => {
    const p = unimplementedPlace(SPECIAL_KIND.BALLOON);
    if (p.kind !== 'unimplemented') return;
    expect(p.options).toBeUndefined();
  });
});
