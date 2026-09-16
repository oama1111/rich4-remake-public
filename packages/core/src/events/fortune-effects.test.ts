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

// ============================================================
//  ★ 神明加持的接线（2026-09-16）：命运事件施加前先问 `fcn_0044b896`
// ============================================================

describe('★ 神明加持：三条问法与档位语义 @source VA 0x0044b896', () => {
  it('★ 事件表里的 `blessing` 与 asm 的压栈组合逐条对上', () => {
    // 奖励 (0,0) / 罚金 (0,1) / 劫难 (1,1)
    const table: Record<number, string> = {};
    for (const e of FORTUNE_EVENTS) if (e.blessing !== undefined) table[e.id] = e.blessing;
    expect(table).toEqual({
      2: 'penalty',
      3: 'penalty',
      6: 'misfortune',
      7: 'misfortune',
      8: 'penalty',
      9: 'penalty',
      10: 'misfortune',
      11: 'misfortune',
      12: 'misfortune',
      14: 'penalty',
      15: 'penalty',
      17: 'penalty',
      19: 'reward',
      22: 'misfortune',
      32: 'misfortune',
      33: 'misfortune',
    });
  });

  it('★ 档位 1 对罚款是「免付」——一分不付、公库也收不到', () => {
    const r = applyFortuneEffect(16, ctx({ multiplier: 1 }));
    expect(r.amount).toBe(0);
    expect(r.players[0]!.cash).toBe(100_000);
    expect(r.pool).toBe(0);
  });

  it('★ 档位 2 对罚款是「加倍」（`(0,0)` 那一支的原版语义）', () => {
    const r = applyFortuneEffect(16, ctx({ multiplier: 2 }));
    expect(r.amount).toBe(6000);
  });

  it('★ 坐牢/住院：档位 1 = 逃過此劫（不关人）、档位 2 = 天数翻倍', () => {
    const escaped = applyFortuneEffect(12, ctx({ multiplier: 1 }));
    expect(escaped.cancelled).toBe(true);
    expect(escaped.occupancy.every((v) => v === 0)).toBe(true);
    const doubled = applyFortuneEffect(12, ctx({ multiplier: 2 }));
    expect(doubled.amount).toBe(6); // literal 3 → ×2
  });
});

describe('★ 事件 8/9：卖股票（含尾巴的特別融资收回）', () => {
  const market = {
    stocks: Array.from({ length: 12 }, (_, i) => ({
      price: 100 + i,
      shares: 1000,
      f10: 1000,
      commercialIndex: 0,
      f6: 0,
    })),
  } as never;

  it('★ 事件 8：每支按 literal%（10%）卖掉，钱进**公库**', () => {
    const holdings = Array.from({ length: 12 }, (_, i) => ({ amount: 100 + i, avgCost: 50 }));
    const r = applyFortuneEffect(
      8,
      ctx({
        market,
        holdings,
        sellDestination: 'pool',
        players: [makePlayer({ index: 0, cash: 0, moneyInBank: 0 })],
      }),
    );
    // 第 0 支：100 的 10% = 10 股 × 100 元 = 1000 —— 进公库，不进玩家口袋
    expect(r.holdings![0]!.amount).toBe(90);
    expect(r.players[0]!.moneyInBank).toBe(0);
    expect(r.pool).toBeGreaterThan(0);
    expect(r.recallFinance).toBe(true);
    expect(r.reown.length).toBeGreaterThan(0);
  });

  it('★ 事件 9：全部卖掉，钱进**存款**', () => {
    const holdings = Array.from({ length: 12 }, () => ({ amount: 20, avgCost: 50 }));
    const r = applyFortuneEffect(
      9,
      ctx({ market, holdings, sellDestination: 'bank' }),
    );
    expect(r.holdings!.every((h) => h.amount === 0)).toBe(true);
    expect(r.players[0]!.moneyInBank).toBeGreaterThan(0);
    expect(r.recallFinance).toBe(true);
  });

  it('★ 档位 1（免付）⇒ 股票一股不卖、也不收回特別融资', () => {
    const holdings = Array.from({ length: 12 }, () => ({ amount: 20, avgCost: 50 }));
    const r = applyFortuneEffect(9, ctx({ market, holdings, multiplier: 1 }));
    expect(r.cancelled).toBe(true);
    expect(r.holdings).toBeNull();
    expect(r.recallFinance).toBe(false);
  });
});

describe('★ 事件 10/11：座驾被偷 / 撞毁', () => {
  it('★ 機車被偷：traffic_method 清零、ndices 归 1、**機車**（道具 5）回库存', () => {
    const r = applyFortuneEffect(
      10,
      ctx({
        players: [makePlayer({ index: 0, trafficMethod: 3, ndices: 3 })],
        toolStock: [0, 5, 5, 5, 5, 5, 5],
      }),
    );
    expect(r.players[0]!.trafficMethod).toBe(0);
    expect(r.players[0]!.ndices).toBe(1);
    expect(r.toolStock![5]).toBe(6);
    expect(r.toolStock![6]).toBe(5);
  });

  it('★ 汽車撞毀：還的是**汽車**（道具 6）', () => {
    const r = applyFortuneEffect(
      11,
      ctx({
        players: [makePlayer({ index: 0, trafficMethod: 2, ndices: 2 })],
        toolStock: [0, 5, 5, 5, 5, 5, 5],
      }),
    );
    expect(r.toolStock![5]).toBe(5);
    expect(r.toolStock![6]).toBe(6);
  });

  it('★ 原版不看当前座驾：开著汽車抽到「機車被偷」照样清零、并把機車库存 +1', () => {
    const r = applyFortuneEffect(
      10,
      ctx({
        players: [makePlayer({ index: 0, trafficMethod: 2, ndices: 3 })],
        toolStock: [0, 5, 5, 5, 5, 5, 5],
      }),
    );
    expect(r.players[0]!.trafficMethod).toBe(0);
    expect(r.toolStock![5]).toBe(6);
  });

  it('★ 档位 1 ⇒ 逃過此劫：车还在、库存不动', () => {
    const r = applyFortuneEffect(
      10,
      ctx({
        players: [makePlayer({ index: 0, trafficMethod: 1, ndices: 3 })],
        toolStock: [0, 5, 5, 5, 5, 5, 5],
        multiplier: 1,
      }),
    );
    expect(r.cancelled).toBe(true);
    expect(r.players[0]!.trafficMethod).toBe(1);
    expect(r.toolStock).toBeNull();
  });
});
