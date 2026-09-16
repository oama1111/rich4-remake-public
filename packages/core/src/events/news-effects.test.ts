/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 新聞事件效果
 */

import { describe, expect, it } from 'vitest';
import { NEWS_EVENTS, newsEvent } from '@rich4/data';
import { makePlayer } from '../testing/factories.ts';
import { IMPLEMENTED_NEWS_IDS, applyNewsEffect } from './news-effects.ts';

const ctx = (over = {}) => ({
  players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 })),
  affected: [0],
  priceIndex: 1,
  pool: 0,
  ...over,
});

describe('★ 受影响的人由调用方指定，不默认是抽牌者', () => {
  it('news[8] 表揚第一大地主 —— 奖金给指定的人', () => {
    const r = applyNewsEffect(8, ctx({ affected: [2] }));
    expect(r.players[2]!.cash).toBe(110_000);
    expect(r.players[0]!.cash).toBe(100_000); // 抽牌者没拿到
  });

  it('★ 奖励类事件可一次作用于多人', () => {
    const r = applyNewsEffect(8, ctx({ affected: [1, 2] }));
    expect(r.players[1]!.cash).toBe(110_000);
    expect(r.players[2]!.cash).toBe(110_000);
    expect(r.players[0]!.cash).toBe(100_000);
    expect(r.amount).toBe(20_000); // 两人合计
  });

  it('affected 为空则什么都不做', () => {
    const c = ctx({ affected: [] });
    const r = applyNewsEffect(8, c);
    expect(r.players).toEqual(c.players);
    expect(r.amount).toBe(0);
  });

  it('越界下标被跳过而不是崩溃', () => {
    const r = applyNewsEffect(8, ctx({ affected: [9] }));
    expect(r.unimplemented).toBe(false);
    expect(r.amount).toBe(0);
  });
});

describe('方向与命運一致', () => {
  it('give 直接加现金，不动公库', () => {
    const r = applyNewsEffect(9, ctx({ pool: 500 }));
    expect(r.players[0]!.cash).toBeGreaterThan(100_000);
    expect(r.pool).toBe(500);
  });

  it('★★ 所得稅（11）= 现金 5%，逐人算、缴公库', () => {
    const r = applyNewsEffect(11, ctx({ affected: [0, 1] }));
    // 每人 100000 × 5% = 5000
    expect(r.players[0]!.cash).toBe(95_000);
    expect(r.players[1]!.cash).toBe(95_000);
    expect(r.pool).toBe(10_000);
    expect(r.amount).toBe(10_000);
    expect(r.unimplemented).toBe(false);
  });

  it('★★ 地價稅（12）= 地产原值 5% × 物價指數（trunc 在前）', () => {
    const r = applyNewsEffect(
      12,
      ctx({
        affected: [0],
        priceIndex: 3,
        lands: [
          { id: 0, owner: 1, landPrice: 20, housePrice: 10, level: 0 } as never,
          { id: 1, owner: 2, landPrice: 999, housePrice: 0, level: 0 } as never,
        ],
        facilities: [],
      }),
    );
    // 原值 20 → trunc(20×0.05) = 1 → ×3 = 3（不是 trunc(20×3×0.05) = 3 ——两者同值，
    // 故再取一组能区分的：原值 30、指数 3 ⇒ 原版 1×3 = 3，旧式 trunc(4.5) = 4）
    expect(r.amount).toBe(3);
    const r2 = applyNewsEffect(
      12,
      ctx({
        affected: [0],
        priceIndex: 3,
        lands: [{ id: 0, owner: 1, landPrice: 30, housePrice: 0, level: 0 } as never],
        facilities: [],
      }),
    );
    expect(r2.amount).toBe(3);
  });

  it('★★ 證交稅（13）= 持股市值 5% × 物價指數', () => {
    const r = applyNewsEffect(
      13,
      ctx({
        affected: [0],
        priceIndex: 1,
        holdings: [[100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        prices: [40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    );
    // 100 股 × 40 元 = 4000 → 5% = 200
    expect(r.amount).toBe(200);
  });

  it('★★ 儲金紅利（23）= 存款 10%，是**发钱**（公库不动）', () => {
    expect(newsEvent(23)!.factor).toBeNull();
    const r = applyNewsEffect(
      23,
      ctx({
        pool: 777,
        players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 100_000 })),
      }),
    );
    // 存款 100000 → 红 10000（直接进现金），公库一分不动
    expect(r.players[0]!.cash).toBe(110_000);
    expect(r.pool).toBe(777);
    expect(r.unimplemented).toBe(false);
  });

  it('★ 出局的玩家不收不缴（原版 `who_plays == 0` 跳过）', () => {
    const dead = { ...ctx().players[1]!, whoPlays: 0 };
    const r = applyNewsEffect(
      11,
      ctx({ affected: [0, 1], players: [ctx().players[0]!, dead, ctx().players[2]!, ctx().players[3]!] }),
    );
    expect(r.players[1]!.cash).toBe(dead.cash);
    expect(r.amount).toBe(5000);
  });

  it('news[29] 走监狱', () => {
    const r = applyNewsEffect(29, ctx({ days: 5 }));
    expect(r.players[0]!.blocking.inPrison).toBe(5);
    expect(r.occupancy[0]).toBe(1);
  });
});

describe('未实现', () => {
  it('方向为空的事件标记未实现', () => {
    // news[6] 公告地價調漲３０％ —— 作用于地块，不在本模块
    const r = applyNewsEffect(6, ctx());
    expect(r.unimplemented).toBe(true);
  });

  it('越界 id', () => {
    expect(applyNewsEffect(99, ctx()).unimplemented).toBe(true);
  });

  it('★ 已实现的是 4(医院) / 8,9,10(固定金额) / 29(监狱) / 11,12,13,23(百分比)', () => {
    expect(IMPLEMENTED_NEWS_IDS).toEqual([4, 8, 9, 10, 29, 11, 12, 13, 23]);
  });

  it('★ news[4] 与 29 的文案里没有 %d，天数须由调用方给出', () => {
    for (const id of [4, 29]) {
      expect(newsEvent(id)!.literal, `news[${id}]`).toBeNull();
      expect(newsEvent(id)!.text).not.toContain('%d');
      // 不给 days 就报未实现，而不是默默关 0 天
      expect(applyNewsEffect(id, ctx()).unimplemented, `news[${id}]`).toBe(true);
    }
  });

  it('★ 有方向但未实现的，都是因为金额是百分比', () => {
    const withDir = NEWS_EVENTS.filter((e) => e.effects.length > 0).map((e) => e.id);
    const gap = withDir.filter((id) => !IMPLEMENTED_NEWS_IDS.includes(id));
    for (const id of gap) {
      expect(newsEvent(id)!.factor, `news[${id}]`).toBeNull();
    }
  });

  it('★ news[29] 的天数写死在文案里（全角５），不在 literal', () => {
    const e = newsEvent(29)!;
    expect(e.literal).toBeNull();
    expect(e.text).toContain('坐牢５天');
  });
});
