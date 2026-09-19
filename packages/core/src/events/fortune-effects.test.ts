/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 命運事件效果 —— 方向由控制流可达性确定
 */

import { describe, expect, it } from 'vitest';
import { FORTUNE_EVENTS, fortuneEvent } from '@rich4/data';
import { cardPrice } from '../rules/inventory.ts';
import { makeNode, makePlayer } from '../testing/factories.ts';
import { makeObjects } from '../cards/summon.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { PASSIVE_CARDS } from '../cards/passive.ts';
import {
  BANK_BAN_DAYS,
  DOUBLE_AMOUNT,
  FORTUNE_ABDUCTED,
  FORTUNE_TRIP_ABROAD,
  IMPLEMENTED_FORTUNE_IDS,
  applyFortuneEffect,
} from './fortune-effects.ts';

const ctx = (over = {}) => ({
  players: [0, 1, 2, 3].map((i) =>
    makePlayer({ index: i, cash: 100_000, moneyInBank: 0 }),
  ),
  currentPlayer: 0,
  priceIndex: 1,
  pool: 0,
  // ★ 二级判定（免罪 21 / 嫁禍 19）的挑人要用随机出口。给一条**定死**的流：
  //   本组绝大多数用例的玩家手里没牌 ⇒ 一个随机数都不会掷，
  //   故它只是为了让类型成立、并给「随机挑人」那两条一个可复现的目标。
  rng: new WatcomRng(1234),
  ...over,
});

/** 1 = 普通格、2 = 监狱、3 = 医院（坐标刻意不同，便于断言「真的搬过去了」） */
const NODES = [
  makeNode({ id: 1, x: 100, y: 200 }),
  makeNode({ id: 2, x: 1935, y: 1039, specialKind: SPECIAL_KIND.PRISON }),
  makeNode({ id: 3, x: 777, y: 888, specialKind: SPECIAL_KIND.HOSPITAL }),
];
const OBJS = makeObjects(46);

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
    expect(r.prisonOccupancy[0]).toBe(1);          // 事件 33 = 坐牢 ⇒ 监狱表
    expect(r.hospitalOccupancy[0]).toBe(0);
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
    // ★ 5（生日收卡片）现在**不是**未实现了（T-055）；换一条真正没有效果的：
    //   事件 0「拆除房屋」的效果走 id 分派、`effects` 为空且不在特殊名单里。
    const id = FORTUNE_EVENTS.findIndex((e) => e.effects.length === 0);
    expect(id).toBeGreaterThanOrEqual(0);
    const r = applyFortuneEffect(id, ctx());
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
  /**
   * ⚠️ **本条先前把一张错的表钉死了**（第 37 条订正）：当时只有 16 条，
   *   而且 19 记成 `reward`（实走 penalty 尾）、22 记成 `misfortune`（实走 reward 尾），
   *   20/21/23..31 等 12 条**漏记**。
   *
   * 完整 28 条的逐项校验**不在本文件**，而在 `@rich4/data` 的
   * `event-table.test.ts` —— 它**直接读 exe**：从每个调用点取出
   * `6a <arg1> 6a <arg0> e8 <rel32>` 自行判定用法，因此不会随表一起漂。
   * 这里只留「数量 + 几处易错点」的粗筛，避免出现第二份会漂的硬编码表。
   */
  it('★ 事件表里的 `blessing`：28 条，且 19/20/22 的用法已订正', () => {
    const table: Record<number, string> = {};
    for (const e of FORTUNE_EVENTS) if (e.blessing !== undefined) table[e.id] = e.blessing;
    expect(Object.keys(table)).toHaveLength(28);
    expect(table[19]).toBe('penalty'); // 罰款 → penalty 尾
    expect(table[20]).toBe('reward'); // 撿到錢 → reward 尾
    expect(table[22]).toBe('reward');
    expect(table[16]).toBeUndefined(); // ★ 原版**没接**加持的那一个
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
    expect(escaped.prisonOccupancy.every((v: number) => v === 0)).toBe(true);
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

describe('★ 事件 32「變賣所有卡片道具」@source fcn_0044d677', () => {
  /** 造一份「玩家 0 的道具表」：下标 = player*15 + toolId */
  const toolsFor = (counts: Record<number, number>): number[] => {
    const out = new Array<number>(60).fill(0);
    for (const [id, n] of Object.entries(counts)) out[Number(id)] = n;
    return out;
  };

  it('★★ 道具与手牌全卖光，所得进**點券**（不是现金）', () => {
    const r = applyFortuneEffect(
      32,
      ctx({
        players: [
          makePlayer({ index: 0, cash: 1000, points: 0, cards: [1], trafficMethod: 1 }),
        ],
        tools: toolsFor({ 3: 2 }), // 地雷 25×2
        toolStock: new Array<number>(14).fill(0),
        cardAmount: new Array<number>(30).fill(0),
      }),
    );
    expect(r.cancelled).toBe(false);
    // 機車 80 + 地雷 25×2 + 卡片 1 的原价
    const card = cardPrice(1);
    expect(r.points).toBe(80 + 50 + card);
    // 卖光
    expect(r.tools!.every((v) => v === 0)).toBe(true);
    expect(r.players[0]!.cards).toEqual([]);
    expect(r.players[0]!.trafficMethod).toBe(0);
    expect(r.players[0]!.ndices).toBe(1);
    // ★ 现金一分没动（原版加的是 +0x30 點券）
    expect(r.players[0]!.cash).toBe(1000);
    // 回商店库存
    expect(r.toolStock![3]).toBe(2);
    expect(r.cardAmount![0]).toBe(1);
  });

  it('★ 檔位 1（逃過此劫）⇒ 什么都不卖', () => {
    const r = applyFortuneEffect(
      32,
      ctx({
        multiplier: 1,
        players: [makePlayer({ index: 0, points: 0, cards: [1] })],
        tools: toolsFor({ 3: 2 }),
        cardAmount: new Array<number>(30).fill(0),
      }),
    );
    expect(r.cancelled).toBe(true);
    expect(r.tools).toBeNull();
    expect(r.cardAmount).toBeNull();
    expect(r.points).toBe(0);
  });
});

describe('★ 命運 6/7：強迫出國觀光 / 被外星人綁架 @source fcn_0044c5d8 / fcn_0044c6ed', () => {
  it('★★ 写 `days_disappearing` = 天數 | (原因 << 6)（低 6 位天數、高 2 位原因）', () => {
    // @source `fcn_0040d375`：`al = 原因 << 6; ah = 天數; or ah, al`
    const trip = applyFortuneEffect(FORTUNE_TRIP_ABROAD, ctx());
    expect(trip.unimplemented).toBe(false);
    expect(trip.players[0]!.blocking.disappearing).toBe(3); // 3 天 | 原因 0
    expect(trip.amount).toBe(3);

    const abducted = applyFortuneEffect(FORTUNE_ABDUCTED, ctx());
    expect(abducted.players[0]!.blocking.disappearing).toBe(3 | (1 << 6)); // 0x43
  });

  it('★ 天數取事件表的 literal（6/7 都是 3）', () => {
    expect(fortuneEvent(FORTUNE_TRIP_ABROAD)!.literal).toBe(3);
    expect(fortuneEvent(FORTUNE_ABDUCTED)!.literal).toBe(3);
  });

  it('★ 神明加持同坐牢那一支：档位 1 逃過此劫（整条作废）、档位 2 天數翻倍', () => {
    expect(applyFortuneEffect(FORTUNE_TRIP_ABROAD, ctx({ multiplier: 1 })).cancelled).toBe(true);
    const doubled = applyFortuneEffect(FORTUNE_TRIP_ABROAD, ctx({ multiplier: 2 }));
    expect(doubled.players[0]!.blocking.disappearing).toBe(6);
  });

  it('★ 已经在外的人不再重写（原版 `cmp [+0x33], 0 / jne 出去`）', () => {
    const players = [makePlayer({ index: 0 }), makePlayer({ index: 1 })];
    players[0] = { ...players[0]!, blocking: { ...players[0]!.blocking, disappearing: 5 } };
    const r = applyFortuneEffect(FORTUNE_ABDUCTED, ctx({ players }));
    expect(r.players[0]!.blocking.disappearing).toBe(5);
    expect(r.amount).toBe(0);
  });

  // ★ 本次补（2026-09-18）：`fcn_0040d375` 除了写 `+0x33`，还在**首次**分支里
  //   `add byte ptr [ebx + 0x496baa], al`（VA 0x0040d431，al = 天數）——
  //   即累加「本月倒楣天數」+0x42。加刑分支（0x40d4c5）**不加**，而命运这一支
  //   本来就把「已在外」的人整个跳过，所以这里恒等于「首次」。
  it('★★ 首次消失同时累加「本月倒楣天數」+0x42（天数，非天数×2 之外的其它量）', () => {
    // @source 0x0040d431 `add byte ptr [ebx + 0x496baa], al`
    const players = [makePlayer({ index: 0, totalWinterSleepDays: 4 }), makePlayer({ index: 1 })];
    const trip = applyFortuneEffect(FORTUNE_TRIP_ABROAD, ctx({ players }));
    expect(trip.players[0]!.totalWinterSleepDays).toBe(7); // 4 + 3 天

    const doubled = applyFortuneEffect(FORTUNE_TRIP_ABROAD, ctx({ players, multiplier: 2 }));
    expect(doubled.players[0]!.totalWinterSleepDays).toBe(10); // 4 + 6 天（翻倍后的值）
  });

  it('★ 神明档位 1「逃過此劫」时一天都不算', () => {
    const players = [makePlayer({ index: 0, totalWinterSleepDays: 4 }), makePlayer({ index: 1 })];
    const r = applyFortuneEffect(FORTUNE_TRIP_ABROAD, ctx({ players, multiplier: 1 }));
    expect(r.cancelled).toBe(true);
    expect(r.players[0]!.totalWinterSleepDays).toBe(4);
  });
});

describe('★ `IMPLEMENTED_FORTUNE_IDS` 不再漏掉「按事件号分派」的那几条', () => {
  it('★★ 8/9/10/11/32 与坐牢/住院/冒貸/拒絕往來/出國觀光都在名单里', () => {
    // 这五条在 `applyFortuneEffect` 里是按 id 分派的（事件表 `effects` 为空是命运这一支的写法）
    for (const id of [8, 9, 10, 11, 32]) {
      expect(IMPLEMENTED_FORTUNE_IDS, `fortune[${id}]`).toContain(id);
    }
    // 靠 `effects` 分派的那几类
    expect(IMPLEMENTED_FORTUNE_IDS).toContain(FORTUNE_TRIP_ABROAD);
    expect(IMPLEMENTED_FORTUNE_IDS).toContain(FORTUNE_ABDUCTED);
    // 坐牢 33..36 与住院 12/13
    for (const id of [12, 13, 33, 34, 35, 36]) {
      expect(IMPLEMENTED_FORTUNE_IDS, `fortune[${id}]`).toContain(id);
    }
    // ★ 2026-09-17：5「今天是你生日」也接上了（真人那条按近似走随机抽，
    //   见 `known-deviations`），所以现在**37 条全在名单里**
    expect(IMPLEMENTED_FORTUNE_IDS).toContain(5);
    expect(IMPLEMENTED_FORTUNE_IDS).toHaveLength(FORTUNE_EVENTS.length);
  });
});

describe('★ 命運 5：今天是你生日 向每人收取一張卡片 @source fcn_0044c3b7', () => {
  /** 固定序列的假 RNG（`next()` 只要够用） */
  const rng = (picks: number[]) => {
    let i = 0;
    return { next: () => picks[i++] ?? 0 };
  };

  it('★★ 电脑当寿星：逐人收一张（跳过自己 / 出局 / 空手），收来的牌进自己手里', () => {
    const r = applyFortuneEffect(
      5,
      ctx({
        players: [
          // ★ 电脑寿星才走「当场随机抽」这一支；真人那一支是**分帧**的（见下面 describe）
          makePlayer({ index: 0, cards: [], whoPlays: WHO_PLAYS_COMPUTER }),
          makePlayer({ index: 1, cards: [3, 7] }),
          makePlayer({ index: 2, cards: [] }), // 空手 → 跳过
          makePlayer({ index: 3, whoPlays: 0, cards: [9] }), // 出局 → 跳过
        ],
        rng: rng([1, 0]),
      }),
    );
    // 电脑寿星不分帧
    expect(r.birthdaySeats).toBeNull();
    expect(r.unimplemented).toBe(false);
    // 只从 1 号收了 1 张（2/3 号跳过）；`rand() % 2 = 1` → 手牌 [3,7] 的第 2 张 = 7
    expect(r.players[0]!.cards).toEqual([7]);
    expect(r.players[1]!.cards).toEqual([3]);
    expect(r.players[3]!.cards).toEqual([9]);
    expect(r.amount).toBe(1);
  });

  it('★★ 满手时先弃**最便宜**的一张（复用 `giveCard` = `receive_card` 0x4412e4）', () => {
    const full = Array.from({ length: 15 }, () => 30); // 30 = 均富卡（便宜的）
    full[3] = 24; // 紅卡，比 30 便宜 ⇒ 应被弃掉
    const r = applyFortuneEffect(
      5,
      ctx({
        players: [
          makePlayer({ index: 0, cards: full, whoPlays: WHO_PLAYS_COMPUTER }),
          makePlayer({ index: 1, cards: [1] }),
        ],
        rng: rng([0]),
      }),
    );
    expect(r.players[0]!.cards).toHaveLength(15);
    expect(r.players[0]!.cards).not.toContain(24);
    expect(r.players[0]!.cards).toContain(1);
  });

  it('★ 电脑当寿星但没给 rng 时报未实现（不会静默白拿）', () => {
    const r = applyFortuneEffect(
      5,
      // ★ `ctx()` 现在带一条默认随机流（供免罪/嫁禍的挑人用）⇒ 这里显式撤掉它，
      //   才是"没给 rng"那条路。
      ctx({
        rng: undefined,
        players: [
          makePlayer({ index: 0, whoPlays: WHO_PLAYS_COMPUTER }),
          makePlayer({ index: 1, cards: [1] }),
        ],
      }),
    );
    expect(r.unimplemented).toBe(true);
  });

  it('★★ **真人**当寿星：一位都不收，把座位交出去（`birthdaySeats`）—— T-055', () => {
    const r = applyFortuneEffect(
      5,
      ctx({
        players: [
          makePlayer({ index: 0, cards: [] }), // 真人寿星（默认 whoPlays = 1）
          makePlayer({ index: 1, cards: [3, 7] }),
          makePlayer({ index: 2, cards: [] }), // 空手 → 不进座位表
          makePlayer({ index: 3, whoPlays: 0, cards: [9] }), // 出局 → 不进座位表
        ],
      }),
    );
    expect(r.unimplemented).toBe(false);
    expect(r.birthdaySeats).toEqual([1]);
    // 一个字都没改（卡片与原版一样要等真人挑完才动）
    expect(r.players[1]!.cards).toEqual([3, 7]);
    expect(r.players[0]!.cards).toEqual([]);
    // 原版计数 `edi` = 合格人数（与挑没挑到无关），故 amount = 座位数
    expect(r.amount).toBe(1);
  });

  it('★ 真人寿星但全场只有他没牌 → 座位表空，`amount = 0`（原版 edi = 0，不报台词）', () => {
    const r = applyFortuneEffect(
      5,
      ctx({ players: [makePlayer({ index: 0, cards: [] }), makePlayer({ index: 1, cards: [] })], rng: rng([0]) }),
    );
    expect(r.birthdaySeats).toBeNull();
    expect(r.amount).toBe(0);
    expect(r.players[1]!.cards).toEqual([]);
  });

  it('★ 托管（AUTOPILOT）算电脑 —— 不分帧', () => {
    const r = applyFortuneEffect(
      5,
      ctx({
        players: [
          makePlayer({ index: 0, cards: [], whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }),
          makePlayer({ index: 1, cards: [3] }),
        ],
        rng: rng([0]),
      }),
    );
    expect(r.birthdaySeats).toBeNull();
    expect(r.players[0]!.cards).toEqual([3]);
  });
});

// ============================================================
//  ★★ 2026 本轮修的两处（原版真码：rich4-spec/tests/test_confinement_release.py 15/15）
// ============================================================

describe('★ 命運的「坐牢／住院」要落**对应的**占用表', () => {
  const occupied = (i: number, over = {}) =>
    makePlayer({ index: i, ...over });

  it('事件 12「住院」→ 写**医院**表，监狱表不动（此前一律写监狱表）', () => {
    const r = applyFortuneEffect(12, ctx());
    expect(r.hospitalOccupancy[0]).toBe(1);
    expect(r.prisonOccupancy[0]).toBe(0);
  });

  it('事件 33「坐牢」→ 写**监狱**表，医院表不动', () => {
    const r = applyFortuneEffect(33, ctx());
    expect(r.prisonOccupancy[0]).toBe(1);
    expect(r.hospitalOccupancy[0]).toBe(0);
  });

  it('★ 首次关押要清**另一张**表（原版 `0x40d761` 的两道闸）', () => {
    // 0 号正在住院（医院表占着 0 号格）→ 又被判坐牢
    const players = [occupied(0, { blocking: { ...makePlayer().blocking, inHospital: 5 } }),
      occupied(1), occupied(2), occupied(3)];
    const r = applyFortuneEffect(33, ctx({
      players,
      hospitalOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(r.prisonOccupancy[0]).toBe(1);        // 进监狱表
    expect(r.hospitalOccupancy[0]).toBe(0);      // ★ 医院那格被清
    expect(r.players[0]?.blocking.inHospital).toBe(0);   // ★ 计数器也清
    expect(r.players[0]?.blocking.inPrison).toBe(3);
  });

  // ★★ 2026-09-18：原版 `send_to_prison`/`send_to_hospital` 的**函数体内**含
  //   「传送到监狱／医院格 + 跟班搬家」（`@source 0x43d601`..`0x43d674`），
  //   所以命運这条路的受害者**不在原地**。差分证据：
  //   `rich4-spec/tests/test_confinement_teleport.py`（48/48）。
  it('★ 命運 33「坐牢」要把人**送进监狱格**（并带回新的物件表）', () => {
    const r = applyFortuneEffect(33, ctx({ nodes: NODES, objects: OBJS }));
    expect(r.players[0]?.nodeId).toBe(2);            // 2 号格是监狱
    expect(r.players[0]?.xpos).toBe(1935);
    expect(r.objects).toHaveLength(OBJS.length);
  });

  it('★ 命運 12「住院」把人送进医院格；加刑分支不传送', () => {
    const r = applyFortuneEffect(12, ctx({ nodes: NODES, objects: OBJS }));
    expect(r.players[0]?.nodeId).toBe(3);            // 3 号格是医院
    const again = applyFortuneEffect(12, ctx({
      nodes: NODES,
      objects: OBJS,
      players: [occupied(0, { blocking: { ...makePlayer().blocking, inHospital: 2 } }),
        occupied(1), occupied(2), occupied(3)],
    }));
    expect(again.players[0]?.blocking.inHospital).toBe(5);
    expect(again.players[0]?.nodeId).toBe(1);        // ★ 原地不动
  });

  it('★ 不传 nodes/objects（老单元测试的用法）⇒ 只写计数，不传送', () => {
    const r = applyFortuneEffect(33, ctx());
    expect(r.players[0]?.nodeId).toBe(1);
  });
});

describe('★ 首次「消失」也要先清掉别的关押状态（原版 `0x40d3ad call 0x40d761`）', () => {
  it('住院中被綁架 → inHospital 清 0 且**医院床位释放**', () => {
    const players = [makePlayer({
      index: 0,
      blocking: { ...makePlayer().blocking, inHospital: 5 },
    }), makePlayer({ index: 1 }), makePlayer({ index: 2 }), makePlayer({ index: 3 })];
    const r = applyFortuneEffect(FORTUNE_ABDUCTED, ctx({
      players,
      hospitalOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(r.players[0]?.blocking.disappearing).not.toBe(0);
    expect(r.players[0]?.blocking.inHospital).toBe(0);
    expect(r.hospitalOccupancy[0]).toBe(0);
  });

  it('坐牢中被綁架 → 监狱床位也释放', () => {
    const players = [makePlayer({
      index: 0,
      blocking: { ...makePlayer().blocking, inPrison: 4, inHotel: 2 },
    }), makePlayer({ index: 1 }), makePlayer({ index: 2 }), makePlayer({ index: 3 })];
    const r = applyFortuneEffect(FORTUNE_ABDUCTED, ctx({
      players,
      prisonOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(r.prisonOccupancy[0]).toBe(0);
    expect(r.players[0]?.blocking.inPrison).toBe(0);
    expect(r.players[0]?.blocking.inHotel).toBe(0);      // 四个计数器一起清
  });

  it('本来没被关 → 两张表都不动（不影响正常绑架）', () => {
    const r = applyFortuneEffect(FORTUNE_ABDUCTED, ctx({
      prisonOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
      hospitalOccupancy: [0, 1, 0, 0, 0, 0, 0, 0],
    }));
    expect([r.prisonOccupancy[0], r.hospitalOccupancy[1]]).toEqual([1, 1]);
    expect(r.players[0]?.blocking.disappearing).not.toBe(0);
  });
});

// ============================================================
//  ★★ 命運这 4 条路上的「免罪卡(21) → 嫁禍卡(19)」二级判定
//     `fcn_00441210`（82 B）的 5 个调用点里，新聞 29 那一个在
//     `news-effects.test.ts` 覆盖；这里覆盖**命運的 4 个**：
//       · 命運 7 `0x44c6c5`（出國·綁架，`0x40d375`）
//       · 命運 8 `0x44c7d7`（同上，共用 `0x44c6d8` 起的尾巴）
//       · 命運 12 `0x44cd41`（就醫，`0x43ec3f`）
//       · 命運 33 `0x44d8a9`（酒醉坐牢，`0x43d593`）
//
//  ★ 三条最容易做错的地方（都在 `secondaryJudgement` 的 @source 块里钉过）：
//    1. 二级判定在**神明闸门之后** —— 档位 1「逃過此劫」时 21/19 **一张不扣**；
//    2. `0x44476a` 的第二参（mode）**恒为 0** ⇒ 挑人规则是「最恨的人 → 随机」，
//       不是 `rules/toll-flow.ts` 的 `aiScapegoat`（那个是 mode 1、多掷一格）；
//    3. **只有真的换人才扣 19**；真人那一条按 D-003/D-008 一律放弃转嫁，
//       于是既不扣卡**也不掷随机**（原版 `0x4447ae` 支本来也不掷）。
// ============================================================

describe('★★ 命運的免罪(21) → 嫁禍(19) 二级判定 @source fcn_00441210', () => {
  /** 造一组玩家：把 `over` 里的下标改成指定字段 */
  function scene(
    over: Record<number, Partial<ReturnType<typeof makePlayer>>> = {},
  ): ReturnType<typeof makePlayer>[] {
    return [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, whoPlays: WHO_PLAYS_COMPUTER, ...(over[i] ?? {}) }),
    );
  }

  /** 命运 4 条路：坐牢（33）/ 住院（12）/ 出國（6）/ 綁架（7） */
  const PRISON_EVENTS = [33, 12, FORTUNE_TRIP_ABROAD, FORTUNE_ABDUCTED] as const;

  /** 数一条随机流前进了几格 */
  function stepsOf(state: number, rng: WatcomRng): number {
    const probe = new WatcomRng(state);
    let n = 0;
    while (probe.getState() !== rng.getState() && n < 64) {
      probe.next();
      n++;
    }
    return n;
  }

  it('★ 事件表里的 4 条路确实都是「关押/消失」类（否则本组测不到点子上）', () => {
    for (const id of PRISON_EVENTS) {
      const e = fortuneEvent(id);
      expect(
        e?.effects.includes('prison') ||
          e?.effects.includes('hospital') ||
          e?.effects.includes('disappear'),
      ).toBe(true);
    }
  });

  // ── ① 持 21：整条作废 + 21 被消耗 ─────────────────────────────
  for (const id of PRISON_EVENTS) {
    it(`★ 命運 ${id}：持免罪卡(21) ⇒ 不关人/不消失、21 被消耗、` +
       '`fortuneVictim === null`（整条作废）', () => {
      const rng = new WatcomRng(12345);
      const before = rng.getState();
      const r = applyFortuneEffect(id, ctx({
        players: scene({ 0: { cards: [PASSIVE_CARDS.ABSOLUTION] } }),
        nodes: NODES,
        objects: OBJS,
        rng,
      }));
      // ★ 21 被扣（`0x441226 push esi / call 0x444bb2`）
      expect(r.players[0]!.cards).toEqual([]);
      // ★ 整条作废：坐牢/住院的天数为 0；出國/綁架不写 disappearing
      expect(r.players[0]!.blocking.inPrison).toBe(0);
      expect(r.players[0]!.blocking.inHospital).toBe(0);
      expect(r.players[0]!.blocking.disappearing).toBe(0);
      expect(r.prisonOccupancy[0]).toBe(0);
      expect(r.hospitalOccupancy[0]).toBe(0);
      // ★ 原地不动（`send_to_*` 都没被调）
      expect(r.players[0]!.nodeId).toBe(1);
      expect(r.amount).toBe(0);
      // ★ `fortuneVictim === null` = 免罪命中 ⇒ 上层**不赔保險**
      expect(r.fortuneVictim).toBeNull();
      // ★ 免罪支一个随机数都不掷
      expect(rng.getState()).toBe(before);
    });
  }

  // ── ② 持 19：转嫁（AI 支）────────────────────────────────────
  it('★ 電腦持嫁禍卡(19)：①最恨的人（hostility 最大且 > 0）替他挨罚、19 被消耗、'
    + '受害者的那张占用表被写', () => {
    const rng = new WatcomRng(999);
    const r = applyFortuneEffect(33, ctx({
      players: scene({
        0: { cards: [PASSIVE_CARDS.SCAPEGOAT], hostility: [0, 0, 7, 0] },
      }),
      nodes: NODES,
      objects: OBJS,
      rng,
    }));
    // ★ 挨罚的是 2 号
    expect(r.players[2]!.blocking.inPrison).toBe(3);
    expect(r.prisonOccupancy[2]).toBe(1);
    // ★ 本人毫发无伤、**牌已被扣**
    expect(r.players[0]!.blocking.inPrison).toBe(0);
    expect(r.prisonOccupancy[0]).toBe(0);
    expect(r.players[0]!.cards).toEqual([]);
    expect(r.fortuneVictim).toBe(2);
  });

  it('★ 電腦持 19 但**没有最恨的人** ⇒ 走 `0x4448c0 call 0x40d31c` 随机挑一个、'
    + '**恰好掷一格**、19 被消耗', () => {
    const rng = new WatcomRng(4242);
    const before = rng.getState();
    const r = applyFortuneEffect(12, ctx({
      players: scene({ 0: { cards: [PASSIVE_CARDS.SCAPEGOAT] } }),
      nodes: NODES,
      objects: OBJS,
      rng,
    }));
    // ★ 随机恰好前进一格（`0x40d355 call 0x456f2d`）
    const after = rng.getState();
    expect(stepsOf(before, rng)).toBe(1);
    expect(after).not.toBe(before);
    // 受害者是别人、本人没事、牌被扣
    expect(r.fortuneVictim).not.toBeNull();
    expect(r.fortuneVictim).not.toBe(0);
    const v = r.fortuneVictim!;
    expect(r.players[v]!.blocking.inHospital).toBe(3);
    expect(r.hospitalOccupancy[v]).toBe(1);
    expect(r.players[0]!.blocking.inHospital).toBe(0);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('★ 電腦持 19 但**无人可嫁**（只有自己还活着）⇒ 本人照常挨罚、'
    + '19 **留在手里**、随机流一格不动（`0x4449e7 cmp ebx,-1 / je`）', () => {
    const dead = { whoPlays: 0 as const };
    const rng = new WatcomRng(31337);
    const before = rng.getState();
    const r = applyFortuneEffect(33, ctx({
      players: scene({
        0: { cards: [PASSIVE_CARDS.SCAPEGOAT] },
        1: dead,
        2: dead,
        3: dead,
      }),
      rng,
    }));
    expect(r.players[0]!.blocking.inPrison).toBe(3);
    expect(r.prisonOccupancy[0]).toBe(1);
    expect(r.players[0]!.cards).toEqual([PASSIVE_CARDS.SCAPEGOAT]);
    expect(r.fortuneVictim).toBe(0);
    expect(rng.getState()).toBe(before);
  });

  // ── ③ 都不持：现状不变 ───────────────────────────────────────
  for (const id of PRISON_EVENTS) {
    it(`★ 命運 ${id}：一张卡都不持 ⇒ 本人照常、随机流一格不动`, () => {
      const rng = new WatcomRng(555);
      const before = rng.getState();
      const r = applyFortuneEffect(id, ctx({
        players: scene(),
        nodes: NODES,
        objects: OBJS,
        rng,
      }));
      expect(r.players[0]!.cards).toEqual([]);
      // 坐牢/住院走 inPrison/inHospital；出國/綁架走 disappearing
      const confined =
        r.players[0]!.blocking.inPrison + r.players[0]!.blocking.inHospital;
      const gone = r.players[0]!.blocking.disappearing;
      expect(confined + gone).not.toBe(0);
      expect(r.fortuneVictim).toBe(0);
      expect(rng.getState()).toBe(before);
    });
  }

  // ── ④ 真人持 19：一律放弃转嫁（D-003/D-008）─────────────────
  it('★★ 真人持 19：一律放弃转嫁 ⇒ **19 不消耗、本人坐牢、随机流一格不动**', () => {
    const rng = new WatcomRng(777);
    const before = rng.getState();
    const r = applyFortuneEffect(33, ctx({
      players: scene({
        0: { whoPlays: WHO_PLAYS_HUMAN, cards: [PASSIVE_CARDS.SCAPEGOAT] },
      }),
      nodes: NODES,
      objects: OBJS,
      rng,
    }));
    expect(r.players[0]!.blocking.inPrison).toBe(3);
    expect(r.prisonOccupancy[0]).toBe(1);
    // ★ 卡留在手里 —— 原版这时弹的是确认框/选人窗（`0x440ba8`/`0x440e1a`），
    //   扣卡点在 `0x4449ef`、在「真的换人」之后；本引擎没有那两个框。
    expect(r.players[0]!.cards).toEqual([PASSIVE_CARDS.SCAPEGOAT]);
    expect(r.fortuneVictim).toBe(0);
    expect(rng.getState()).toBe(before);
  });

  it('★★ 托管（AUTOPILOT）算**电脑** —— 与新聞 29 同一口径，会真的转嫁', () => {
    const rng = new WatcomRng(2024);
    const r = applyFortuneEffect(33, ctx({
      players: scene({
        0: {
          whoPlays: WHO_PLAYS_AUTOPILOT,
          cards: [PASSIVE_CARDS.SCAPEGOAT],
          hostility: [0, 5, 0, 0],
        },
      }),
      nodes: NODES,
      objects: OBJS,
      rng,
    }));
    expect(r.fortuneVictim).toBe(1);
    expect(r.players[1]!.blocking.inPrison).toBe(3);
    expect(r.players[0]!.cards).toEqual([]);
  });

  // ── ⑤ 21 与 19 同时在手：先 21 ──────────────────────────────
  it('★ 21 与 19 同时在手 ⇒ 只用 21（命中即止）、**19 留在手里**', () => {
    const r = applyFortuneEffect(33, ctx({
      players: scene({
        0: { cards: [PASSIVE_CARDS.ABSOLUTION, PASSIVE_CARDS.SCAPEGOAT] },
      }),
      nodes: NODES,
      objects: OBJS,
      rng: new WatcomRng(1),
    }));
    expect(r.players[0]!.cards).toEqual([PASSIVE_CARDS.SCAPEGOAT]);
    expect(r.fortuneVictim).toBeNull();
    expect(r.players[0]!.blocking.inPrison).toBe(0);
  });

  // ── ⑥ 二级判定在神明闸门**之后** ────────────────────────────
  it('★ 神明档位 1「逃過此劫」⇒ 在 `0x441210` **之前**就返回，21/19 一张不扣',
    () => {
      const withAbs = applyFortuneEffect(33, ctx({
        multiplier: 1,
        players: scene({ 0: { cards: [PASSIVE_CARDS.ABSOLUTION] } }),
      }));
      expect(withAbs.cancelled).toBe(true);
      expect(withAbs.players[0]!.cards).toEqual([PASSIVE_CARDS.ABSOLUTION]);
      expect(withAbs.fortuneVictim).toBeNull();

      const withScape = applyFortuneEffect(FORTUNE_ABDUCTED, ctx({
        multiplier: 1,
        players: scene({ 0: { cards: [PASSIVE_CARDS.SCAPEGOAT] } }),
      }));
      expect(withScape.cancelled).toBe(true);
      expect(withScape.players[0]!.cards).toEqual([PASSIVE_CARDS.SCAPEGOAT]);
    });

  it('★ `multiplier: 2`（按阶数算 = 天数翻倍）⇒ 转嫁之后**天数照翻**', () => {
    // ⚠️ 别把 `Player.luck` 也设成 > 100 —— 对「劫难」那一条用法（`blessingFieldOf`
    //   读的是 `luck`）高值意味着档位 **1 = 逃過此劫**，整条会先作废、根本轮不到
    //    二级判定。这里直接给 `multiplier`（施加阶段已经算好的档位）才测得到点子上。
    const r = applyFortuneEffect(33, ctx({
      multiplier: 2,
      players: scene({ 0: { cards: [PASSIVE_CARDS.SCAPEGOAT], hostility: [0, 0, 9, 0] } }),
    }));
    expect(r.fortuneVictim).toBe(2);
    expect(r.players[2]!.blocking.inPrison).toBe(6); // 3 × 2
    expect(r.players[0]!.cards).toEqual([]);
  });
});
