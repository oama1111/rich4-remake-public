/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 樂透
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  LOTTERY_MAX_PER_PLAYER,
  LOTTERY_NUMBERS,
  LOTTERY_TICKET_PRICE,
  availableNumbers,
  buyTicket,
  emptyLottery,
  numbersOf,
  releaseTickets,
} from './lottery.ts';

describe('号码表', () => {
  it('★ 36 个号码', () => {
    expect(LOTTERY_NUMBERS).toBe(36);
    expect(emptyLottery()).toHaveLength(36);
  });

  it('初始全部未售出', () => {
    expect(availableNumbers(emptyLottery())).toHaveLength(36);
  });

  it('★ 存的是持有者下标 + 1，与地块 owner 同制', () => {
    const r = buyTicket(makePlayer({ index: 2, cash: 5000 }), emptyLottery(), 7);
    expect(r.lottery[7]).toBe(3);
  });
});

describe('买号', () => {
  it('★ 票价 1000，且直接扣现金', () => {
    expect(LOTTERY_TICKET_PRICE).toBe(1000);
    const r = buyTicket(makePlayer({ cash: 5000, moneyInBank: 9999 }), emptyLottery(), 0);
    expect(r.player.cash).toBe(4000);
    expect(r.player.moneyInBank).toBe(9999);
  });

  it('★ 不乘物价指数——与买地、过路费都不同', () => {
    // 票价是与立即数直接比较/相减，没有 imul price_index
    const a = buyTicket(makePlayer({ cash: 5000 }), emptyLottery(), 0);
    expect(5000 - a.player.cash).toBe(LOTTERY_TICKET_PRICE);
  });

  it('★ 只看现金，存款再多也没用', () => {
    const r = buyTicket(makePlayer({ cash: 100, moneyInBank: 999_999 }), emptyLottery(), 0);
    expect(r).toMatchObject({ ok: false, reason: 'notEnoughCash' });
  });

  it('★ 不会破产——就地扣现金，无级联', () => {
    const r = buyTicket(makePlayer({ cash: 999, moneyInBank: 0 }), emptyLottery(), 0);
    expect(r.ok).toBe(false);
    expect(r.player.cash).toBe(999); // 状态不变
  });

  it('已售出的号买不到', () => {
    const t = emptyLottery();
    t[5] = 2;
    expect(buyTicket(makePlayer({ cash: 5000 }), t, 5).reason).toBe('taken');
  });

  it('越界号码被拒', () => {
    const p = makePlayer({ cash: 5000 });
    expect(buyTicket(p, emptyLottery(), -1).reason).toBe('outOfRange');
    expect(buyTicket(p, emptyLottery(), 36).reason).toBe('outOfRange');
    expect(buyTicket(p, emptyLottery(), 1.5).reason).toBe('outOfRange');
  });

  it('★ 每人最多 10 张', () => {
    expect(LOTTERY_MAX_PER_PLAYER).toBe(10);
    let p = makePlayer({ index: 0, cash: 100_000 });
    let t = emptyLottery();
    for (let i = 0; i < 10; i++) {
      const r = buyTicket(p, t, i);
      p = r.player;
      t = r.lottery;
    }
    expect(numbersOf(t, 0)).toHaveLength(10);
    expect(buyTicket(p, t, 20).reason).toBe('tooMany');
  });

  it('不同玩家各自计数', () => {
    const t = emptyLottery();
    for (let i = 0; i < 10; i++) t[i] = 1; // 玩家0 满了
    const r = buyTicket(makePlayer({ index: 1, cash: 5000 }), t, 20);
    expect(r.ok).toBe(true);
  });
});

describe('破产释放', () => {
  it('★ 只清自己的号，别人的不动', () => {
    const t = emptyLottery();
    t[1] = 1; t[2] = 2; t[3] = 1;
    const after = releaseTickets(t, 0);
    expect(after[1]).toBe(0);
    expect(after[3]).toBe(0);
    expect(after[2]).toBe(2);
  });

  it('没买过号也不出错', () => {
    expect(releaseTickets(emptyLottery(), 3)).toEqual(emptyLottery());
  });
});

describe('查询', () => {
  it('numbersOf 列出持有号码', () => {
    const t = emptyLottery();
    t[3] = 2; t[9] = 2; t[15] = 1;
    expect(numbersOf(t, 1)).toEqual([3, 9]);
  });

  it('availableNumbers 排除已售', () => {
    const t = emptyLottery();
    t[0] = 1;
    expect(availableNumbers(t)).not.toContain(0);
    expect(availableNumbers(t)).toHaveLength(35);
  });
});
