/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 樂透
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  LOTTERY_DRAW_DAY,
  LOTTERY_NUMBERS,
  LOTTERY_RIG_THRESHOLD,
  LOTTERY_TICKET_PRICE,
  availableNumbers,
  buyTicket,
  drawLottery,
  emptyLottery,
  numbersOf,
  releaseTickets,
} from './lottery.ts';
import { WatcomRng } from '../rng/watcom.ts';

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

  it('★ 原版不限持号数 —— 10 那个门槛管的是开奖方式，不是购买', () => {
    expect(LOTTERY_RIG_THRESHOLD).toBe(10);
    let p = makePlayer({ index: 0, cash: 100_000 });
    let t = emptyLottery();
    for (let i = 0; i < 12; i++) {
      const r = buyTicket(p, t, i);
      expect(r.ok).toBe(true);
      p = r.player;
      t = r.lottery;
    }
    expect(numbersOf(t, 0)).toHaveLength(12);
  });

  it('★ 票钱进公库', () => {
    const r = buyTicket(makePlayer({ cash: 5000 }), emptyLottery(), 7);
    expect(r.toPool).toBe(LOTTERY_TICKET_PRICE);
    expect(r.player.cash).toBe(5000 - LOTTERY_TICKET_PRICE);
  });

  it('买不成时不进公库', () => {
    expect(buyTicket(makePlayer({ cash: 10 }), emptyLottery(), 7).toPool).toBe(0);
  });
});

describe('开奖', () => {
  const rng = (state: number) => new WatcomRng(state);

  it('每月 15 号开奖', () => {
    expect(LOTTERY_DRAW_DAY).toBe(15);
  });

  it('★ 一张票都没卖出就不开奖', () => {
    const r = drawLottery(emptyLottery(), 999_999, rng(1));
    expect(r.number).toBeNull();
    expect(r.winner).toBeNull();
    expect(r.pool).toBe(999_999);
  });

  it('★ 中奖者拿走整个公库，号码表清空', () => {
    // 12 张全是玩家 0 的 → 超过门槛，必定从已售号码里开
    const t = emptyLottery();
    for (let i = 0; i < 12; i++) t[i] = 1;
    const r = drawLottery(t, 250_000, rng(12345));
    expect(r.rigged).toBe(true);
    expect(r.winner).toBe(0);
    expect(r.prize).toBe(250_000);
    expect(r.pool).toBe(0);
    expect(r.lottery.every((v) => v === 0)).toBe(true);
  });

  it('★ 超过门槛时中奖号必定是已售出的', () => {
    const t = emptyLottery();
    for (let i = 0; i < 11; i++) t[i * 3] = 1;
    for (let seed = 1; seed <= 50; seed++) {
      const r = drawLottery(t, 1000, rng(seed));
      expect(r.rigged).toBe(true);
      expect(t[r.number!]).not.toBe(0);
      expect(r.winner).toBe(0);
    }
  });

  it('★ 未超门槛时可能开出没人买的号 —— 此时奖金滚存、号码保留', () => {
    const t = emptyLottery();
    t[0] = 1;
    let missed = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = drawLottery(t, 1000, rng(seed));
      expect(r.rigged).toBe(false);
      if (r.winner === null) {
        missed++;
        expect(r.pool).toBe(1000);
        expect(r.lottery[0]).toBe(1);
      }
    }
    // 36 个号里只卖出 1 个，绝大多数种子都该落空
    expect(missed).toBeGreaterThan(40);
  });

  it('门槛按**单人**持号数判定，不是总数', () => {
    const t = emptyLottery();
    // 三人各 8 张，共 24 张，但没有任何一人超过 10
    for (let i = 0; i < 24; i++) t[i] = (i % 3) + 1;
    expect(drawLottery(t, 1000, rng(7)).rigged).toBe(false);
  });

  it('★ 同种子可复现', () => {
    const t = emptyLottery();
    for (let i = 0; i < 12; i++) t[i] = 1;
    expect(drawLottery(t, 5000, rng(99)).number).toBe(drawLottery(t, 5000, rng(99)).number);
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
