/*
 * 事件牌堆验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  shuffleDeck,
  createDeck,
  drawEvent,
  NEWS_DECK_SIZE,
  FORTUNE_DECK_SIZE,
} from './deck.ts';
import { WatcomRng } from '../rng/watcom.ts';

describe('洗牌', () => {
  it('牌堆大小：新聞 36、命運 37', () => {
    expect(NEWS_DECK_SIZE).toBe(36);
    expect(FORTUNE_DECK_SIZE).toBe(37);
  });

  it('产出 0..n-1 的一个排列（不重不漏）', () => {
    for (const size of [NEWS_DECK_SIZE, FORTUNE_DECK_SIZE]) {
      const deck = shuffleDeck(new WatcomRng(1), size);
      expect(deck.length).toBe(size);
      expect([...deck].sort((a, b) => a - b)).toEqual(
        Array.from({ length: size }, (_, i) => i),
      );
    }
  });

  it('★ 恰好消耗 size 次 rand()', () => {
    // 这一点关系到后续所有随机结果的对齐——多消耗或少消耗都会让序列偏移
    const a = new WatcomRng(1);
    shuffleDeck(a, NEWS_DECK_SIZE);

    const b = new WatcomRng(1);
    for (let i = 0; i < NEWS_DECK_SIZE; i++) b.next();

    expect(a.getState()).toBe(b.getState());
  });

  it('同种子产出相同排列', () => {
    expect(shuffleDeck(new WatcomRng(42), 36)).toEqual(shuffleDeck(new WatcomRng(42), 36));
  });

  it('不同种子产出不同排列', () => {
    expect(shuffleDeck(new WatcomRng(1), 36)).not.toEqual(shuffleDeck(new WatcomRng(2), 36));
  });

  it('排列分布大体均匀（首张牌覆盖多种可能）', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      firsts.add(shuffleDeck(new WatcomRng(seed), 36)[0]!);
    }
    // 200 次不同种子应当出现相当多种不同的首张
    expect(firsts.size).toBeGreaterThan(15);
  });

  it('createDeck 初始游标为 0', () => {
    // @source 洗牌函数末尾 mov dword [ref_004990e0], 0
    expect(createDeck(new WatcomRng(1), 36).cursor).toBe(0);
  });
});

describe('取用事件', () => {
  const deck = { order: [5, 7, 11, 13], cursor: 0 };

  it('全部可行时按顺序取，游标前进', () => {
    const r = drawEvent(deck, () => true);
    expect(r.eventId).toBe(5);
    expect(r.deck.cursor).toBe(1);
    expect(r.skipped).toBe(0);
  });

  it('★ 不可行的事件被跳过，游标仍然前进', () => {
    // 只有 11 可行
    const r = drawEvent(deck, (id) => id === 11);
    expect(r.eventId).toBe(11);
    expect(r.deck.cursor).toBe(3); // 跳过了 5、7
    expect(r.skipped).toBe(2);
  });

  it('游标到底后回绕', () => {
    const r = drawEvent({ order: [1, 2, 3], cursor: 2 }, () => true);
    expect(r.eventId).toBe(3);
    expect(r.deck.cursor).toBe(0);
  });

  it('从中途游标开始查找并回绕', () => {
    const r = drawEvent({ order: [5, 7, 11, 13], cursor: 3 }, (id) => id === 7);
    expect(r.eventId).toBe(7);
    expect(r.deck.cursor).toBe(2);
    expect(r.skipped).toBe(2); // 跳过 13、5
  });

  it('整副牌都不可行时返回 -1（原版此处会死循环）', () => {
    const r = drawEvent(deck, () => false);
    expect(r.eventId).toBe(-1);
    expect(r.skipped).toBe(4);
  });

  it('连续取用会遍历整副牌', () => {
    let d = createDeck(new WatcomRng(7), 36);
    const seen: number[] = [];
    for (let i = 0; i < 36; i++) {
      const r = drawEvent(d, () => true);
      seen.push(r.eventId);
      d = r.deck;
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 36 }, (_, i) => i),
    );
    expect(d.cursor).toBe(0); // 正好回到起点
  });
});
