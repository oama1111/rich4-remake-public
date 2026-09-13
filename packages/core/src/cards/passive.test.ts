/*
 * 被动卡机制验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  playerHasCard, checkDefensiveCards, consumeCard,
  PASSIVE_CARDS, CARD_SLOTS_PER_PLAYER,
  TOLL_PASSIVE_THRESHOLD_FACTOR, tollTriggersPassive, checkTollPassives,
} from './passive.ts';
import { makePlayer } from '../testing/factories.ts';
import { PASSIVE_CARD_IDS } from '@rich4/data';

describe('手牌查询', () => {
  it('槽位数为 15，与存档布局一致', () => {
    expect(CARD_SLOTS_PER_PLAYER).toBe(15);
  });

  it('持有判定', () => {
    const p = makePlayer({ cards: [3, 21, 7] });
    expect(playerHasCard(p, 21)).toBe(true);
    expect(playerHasCard(p, 19)).toBe(false);
  });
});

describe('被动卡编号与清单一致', () => {
  it('四张被动卡 = 复仇/嫁祸/免费/免罪', () => {
    expect(PASSIVE_CARD_IDS).toEqual([18, 19, 20, 21]);
    expect(PASSIVE_CARDS.REVENGE).toBe(18);
    expect(PASSIVE_CARDS.SCAPEGOAT).toBe(19);
    expect(PASSIVE_CARDS.FREE).toBe(20);
    expect(PASSIVE_CARDS.ABSOLUTION).toBe(21);
  });
});

describe('防御卡检查', () => {
  it('无防御卡时不触发', () => {
    expect(checkDefensiveCards(makePlayer({ cards: [1, 2, 3] }))).toEqual({ kind: 'none' });
  });

  it('持有免罪卡 → 免疫', () => {
    expect(checkDefensiveCards(makePlayer({ cards: [21] }))).toEqual({ kind: 'absolution' });
  });

  it('持有嫁祸卡 → 转嫁', () => {
    expect(checkDefensiveCards(makePlayer({ cards: [19] }))).toEqual({ kind: 'scapegoat' });
  });

  it('★ 检查顺序：免罪卡优先于嫁祸卡', () => {
    // @source 原版先 push 0x15（免罪）再 push 0x13（嫁祸）
    const both = makePlayer({ cards: [19, 21] });
    expect(checkDefensiveCards(both)).toEqual({ kind: 'absolution' });
  });
});

describe('消耗卡片', () => {
  it('移除第一张匹配的', () => {
    const p = consumeCard(makePlayer({ cards: [5, 21, 5] }), 5);
    expect(p.cards).toEqual([21, 5]);
  });

  it('没有该卡时原样返回', () => {
    const p = makePlayer({ cards: [1, 2] });
    expect(consumeCard(p, 9)).toBe(p);
  });

  it('不原地修改入参', () => {
    const p = makePlayer({ cards: [1, 2, 3] });
    consumeCard(p, 2);
    expect(p.cards).toEqual([1, 2, 3]);
  });
});

// ============================================================
//  ★ 第二个触发点：付过路费时（免费卡 20 / 嫁祸卡 19）
// ============================================================

describe('★ 过路费触发门槛', () => {
  const rich = (over = {}) => makePlayer({ cash: 1_000_000, moneyInBank: 0, ...over });

  it('租金达到 物价指数 × 2000 即触发', () => {
    expect(TOLL_PASSIVE_THRESHOLD_FACTOR).toBe(2000);
    expect(tollTriggersPassive(2000, rich(), 1)).toBe(true);
    expect(tollTriggersPassive(1999, rich(), 1)).toBe(false);
    // 物价指数放大门槛
    expect(tollTriggersPassive(2000, rich(), 5)).toBe(false);
    expect(tollTriggersPassive(10_000, rich(), 5)).toBe(true);
  });

  it('★ 或者：付款方现金+存款根本不够（走投无路才掏底牌）', () => {
    const poor = makePlayer({ cash: 100, moneyInBank: 50 });
    expect(tollTriggersPassive(200, poor, 99)).toBe(true); // 远未达门槛，但付不起
    expect(tollTriggersPassive(150, poor, 99)).toBe(false); // 恰好付得起 → 不触发
  });
});

describe('★ 免费卡与嫁祸卡的效果根本不同', () => {
  const payer = (cards: number[]) =>
    makePlayer({ cash: 1_000_000, moneyInBank: 0, cards });

  it('免费卡：租金归零', () => {
    const r = checkTollPassives(5000, payer([PASSIVE_CARDS.FREE]), 1);
    expect(r).toEqual({ kind: 'free' });
  });

  it('★ 嫁祸卡：金额照旧，只是换付款人', () => {
    const r = checkTollPassives(5000, payer([PASSIVE_CARDS.SCAPEGOAT]), 1, () => 2);
    expect(r).toEqual({ kind: 'scapegoat', newPayer: 2 });
  });

  it('免费卡优先于嫁祸卡（原版先查 0x14 再查 0x13）', () => {
    const both = payer([PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.FREE]);
    expect(checkTollPassives(5000, both, 1, () => 2).kind).toBe('free');
  });

  it('嫁祸目标放弃（返回 -1）则不触发', () => {
    const r = checkTollPassives(5000, payer([PASSIVE_CARDS.SCAPEGOAT]), 1, () => -1);
    expect(r).toEqual({ kind: 'none' });
  });

  it('★ 租金未达门槛且付得起时，持卡也不触发', () => {
    const both = payer([PASSIVE_CARDS.FREE, PASSIVE_CARDS.SCAPEGOAT]);
    expect(checkTollPassives(100, both, 1).kind).toBe('none');
  });

  it('★ 免罪卡(21)/复仇卡(18) 不在这条路径上', () => {
    const other = payer([PASSIVE_CARDS.ABSOLUTION, PASSIVE_CARDS.REVENGE]);
    expect(checkTollPassives(999_999, other, 1).kind).toBe('none');
  });
});
