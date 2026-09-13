/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 命運事件效果 —— 方向由控制流可达性确定
 */

import { describe, expect, it } from 'vitest';
import { FORTUNE_EVENTS, fortuneEvent } from '@rich4/data';
import { makePlayer } from '../testing/factories.ts';
import { BANK_BAN_DAYS, DOUBLE_AMOUNT, applyFortuneEffect } from './fortune-effects.ts';

const ctx = (over = {}) => ({
  players: [0, 1, 2, 3].map((i) =>
    makePlayer({ index: i, cash: 100_000, moneyInBank: 0 }),
  ),
  currentPlayer: 0,
  priceIndex: 1,
  pool: 0,
  ...over,
});

describe('★ 罚款：走 pay_money，进公库', () => {
  it('fortune[16] 汽車超速 3000', () => {
    const r = applyFortuneEffect(16, ctx());
    expect(r.players[0]!.cash).toBe(97_000);
    expect(r.pool).toBe(3000);
    expect(r.amount).toBe(3000);
  });

  it('金额随物价指数放大', () => {
    const r = applyFortuneEffect(16, ctx({ priceIndex: 5 }));
    expect(r.amount).toBe(15_000);
  });

  it('★ 现金不够会动用存款', () => {
    const r = applyFortuneEffect(16, ctx({
      players: [makePlayer({ index: 0, cash: 500, moneyInBank: 9000 })],
    }));
    expect(r.players[0]!.cash).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(6500);
    expect(r.bankrupted).toBe(false);
  });

  it('★ 两个口袋都空则破产，公库只收到实付部分', () => {
    const r = applyFortuneEffect(16, ctx({
      players: [makePlayer({ index: 0, cash: 400, moneyInBank: 100 })],
    }));
    expect(r.bankrupted).toBe(true);
    expect(r.amount).toBe(500);
    expect(r.pool).toBe(500);
  });

  it('本月支出被累计', () => {
    const r = applyFortuneEffect(16, ctx());
    expect(r.players[0]!.monthlyPaid).toBe(3000);
  });
});

describe('★ 收钱：走 give_money，直接加现金', () => {
  it('fortune[25] 意外獲得遺產 10000', () => {
    const r = applyFortuneEffect(25, ctx());
    expect(r.players[0]!.cash).toBe(110_000);
    expect(r.amount).toBe(10_000);
  });

  it('★ 进现金而不是存款（调用点 flags = 1）', () => {
    const r = applyFortuneEffect(25, ctx());
    expect(r.players[0]!.moneyInBank).toBe(0);
  });

  it('★ 不可能破产——没有付款方', () => {
    const r = applyFortuneEffect(25, ctx({
      players: [makePlayer({ index: 0, cash: 0, moneyInBank: 0 })],
    }));
    expect(r.bankrupted).toBe(false);
    expect(r.players[0]!.cash).toBe(10_000);
  });

  it('本月收入被累计', () => {
    const r = applyFortuneEffect(25, ctx());
    expect(r.players[0]!.monthlyReceived).toBe(10_000);
  });

  it('公库不变——钱不是从公库出的', () => {
    const r = applyFortuneEffect(25, ctx({ pool: 777 }));
    expect(r.pool).toBe(777);
  });
});

describe('★ 倍率修正', () => {
  it('multiplier 为 2 时金额翻倍', () => {
    const r = applyFortuneEffect(25, ctx({ multiplier: DOUBLE_AMOUNT }));
    expect(r.amount).toBe(20_000);
  });

  it('★ 档位 0 与未知取值都按不变处理', () => {
    expect(applyFortuneEffect(25, ctx({ multiplier: 0 })).amount).toBe(10_000);
    expect(applyFortuneEffect(25, ctx({ multiplier: 3 })).amount).toBe(10_000);
    expect(applyFortuneEffect(25, ctx()).amount).toBe(10_000);
  });
});

describe('★ 坐牢／住院', () => {
  it('★ 天数取自事件表的 literal，不必由调用方给', () => {
    const r = applyFortuneEffect(33, ctx());
    expect(r.unimplemented).toBe(false);
    expect(r.players[0]!.blocking.inPrison).toBe(3);
    expect(r.occupancy[0]).toBe(1);
  });

  it('★ 四个坐牢事件刑期各不相同：3 / 5 / 7 / 9 天', () => {
    const days = [33, 34, 35, 36].map(
      (id) => applyFortuneEffect(id, ctx()).players[0]!.blocking.inPrison,
    );
    expect(days).toEqual([3, 5, 7, 9]);
  });

  it('fortune[12] 走医院而不是监狱', () => {
    const r = applyFortuneEffect(12, ctx());
    expect(r.players[0]!.blocking.inHospital).toBe(3);
    expect(r.players[0]!.blocking.inPrison).toBe(0);
  });

  it('调用方仍可覆盖天数', () => {
    const r = applyFortuneEffect(33, ctx({ days: 99 }));
    expect(r.players[0]!.blocking.inPrison).toBe(99);
  });
});

describe('未实现与越界', () => {
  it('无金额无方向的事件标记为未实现', () => {
    const r = applyFortuneEffect(5, ctx()); // 生日收卡片
    expect(r.unimplemented).toBe(true);
  });

  it('越界 id 标记为未实现且不改状态', () => {
    const c = ctx();
    const r = applyFortuneEffect(99, c);
    expect(r.unimplemented).toBe(true);
    expect(r.players).toEqual(c.players);
  });
});

describe('★ 方向与文案语义一致（表本身的自洽性）', () => {
  it('pay 与 give 互斥，不会同时出现', () => {
    for (const e of FORTUNE_EVENTS) {
      const both = e.effects.includes('pay') && e.effects.includes('give');
      expect(both, `fortune[${e.id}]`).toBe(false);
    }
  });

  it('所有带 factor 的事件都有明确去向', () => {
    for (const e of FORTUNE_EVENTS) {
      if (e.factor === null) continue;
      // ★ fortune[2] 冒貸既不是 pay 也不是 give——它直接加负债
      const hasDir =
        e.effects.includes('pay') || e.effects.includes('give') || e.effects.includes('loan');
      expect(hasDir, `fortune[${e.id}] factor=${e.factor}`).toBe(true);
    }
  });

  it('★ fortune[2] 冒貸：直接加负债，不走付款通道', () => {
    const r = applyFortuneEffect(2, ctx());
    expect(r.players[0]!.loan).toBe(10_000);
    expect(r.players[0]!.cash).toBe(100_000); // 现金不动
    expect(r.pool).toBe(0);
  });

  it('★ fortune[3] 支票跳票：银行拒绝往来 30 天（文案作「一個月」）', () => {
    expect(BANK_BAN_DAYS).toBe(30);
    const r = applyFortuneEffect(3, ctx());
    expect(r.players[0]!.daysRejectedByBank).toBe(30);
  });

  it('坐牢的四个事件都指向 prison', () => {
    for (const id of [33, 34, 35, 36]) {
      expect(fortuneEvent(id)!.effects).toContain('prison');
    }
  });

  it('就醫/住院两个事件都指向 hospital', () => {
    for (const id of [12, 13]) {
      expect(fortuneEvent(id)!.effects).toContain('hospital');
    }
  });
});

describe('★ 倍率归零档（先前漏掉的那一档）', () => {
  it('multiplier = 1 时奖金作廢——一分不给', () => {
    const r = applyFortuneEffect(25, ctx({ multiplier: 1 }));
    expect(r.amount).toBe(0);
    expect(r.players[0]!.cash).toBe(100_000);
  });

  it('★ 同一档位对罚款是「免付」——一分不扣', () => {
    const r = applyFortuneEffect(16, ctx({ multiplier: 1 }));
    expect(r.amount).toBe(0);
    expect(r.players[0]!.cash).toBe(100_000);
    expect(r.pool).toBe(0);
    expect(r.bankrupted).toBe(false);
  });

  it('★ 免付时不会误判破产——哪怕身无分文', () => {
    const r = applyFortuneEffect(16, ctx({
      players: [makePlayer({ index: 0, cash: 0, moneyInBank: 0 })],
      multiplier: 1,
    }));
    expect(r.bankrupted).toBe(false);
  });
});
