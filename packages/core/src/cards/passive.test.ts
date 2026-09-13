/*
 * 被动卡机制验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  playerHasCard, checkDefensiveCards, consumeCard,
  PASSIVE_CARDS, CARD_SLOTS_PER_PLAYER,
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
