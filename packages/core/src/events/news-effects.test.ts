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
    expect(r.prisonOccupancy[0]).toBe(1);
  });
});

describe('★ 新聞 0..3：释放／延长在监在院的人 @source rich4_news.asm 的四个循环', () => {
  /** 只盖掉要用的那两位计数器，其余整块沿用工厂默认（`BlockingDays` 是定长结构）*/
  const blocked = (over: Partial<ReturnType<typeof makePlayer>['blocking']> = {}) => ({
    ...makePlayer().blocking,
    ...over,
  });
  /** 造一个「0 号在监狱、2 号在医院」的局面 */
  const sick = (over = {}) =>
    ctx({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({
          index: i,
          cash: 100_000,
          blocking: i === 0 ? blocked({ inPrison: 4 }) : i === 2 ? blocked({ inHospital: 7 }) : blocked(),
        }),
      ),
      prisonOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
      hospitalOccupancy: [0, 0, 1, 0, 0, 0, 0, 0],
      ...over,
    });

  it('★★ news[0] 獄中囚犯無罪開釋：在监的那位挂「待释放」+ 清占用槽', () => {
    const r = applyNewsEffect(0, sick());
    expect(r.unimplemented).toBe(false);
    // 0x80 = 待释放（下一次回合推进才真正走释放流程）
    expect(r.players[0]!.blocking.inPrison).toBe(0x80);
    expect(r.prisonOccupancy[0]).toBe(0);
    // 另一张表、其他人都不许动
    expect(r.hospitalOccupancy).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
    expect(r.players[1]!.blocking.inPrison).toBe(0);
  });

  it('★★ news[2] 住院中病患提前出院：动的是**医院**那张表', () => {
    const r = applyNewsEffect(2, sick());
    expect(r.players[2]!.blocking.inHospital).toBe(0x80);
    expect(r.hospitalOccupancy[2]).toBe(0);
    // ★ 监狱那位不受影响（两条新闻各管一张表）
    expect(r.players[0]!.blocking.inPrison).toBe(4);
    expect(r.prisonOccupancy[0]).toBe(1);
  });

  it('★★ news[1] 獄中囚犯延長刑期%d天：+literal(3)，且 `& 0x7f` 把 0x80 抹掉', () => {
    expect(newsEvent(1)!.literal).toBe(3); // @source `mov ecx, 3`
    const plain = applyNewsEffect(1, sick());
    expect(plain.players[0]!.blocking.inPrison).toBe(7); // 4 + 3
    expect(plain.amount).toBe(3);
    // 本来今天就能出来的（0x80）又被关回去 3 天
    const pending = applyNewsEffect(
      1,
      sick({
        players: [0, 1, 2, 3].map((i) =>
          makePlayer({ index: i, blocking: blocked(i === 0 ? { inPrison: 0x80 } : {}) }),
        ),
      }),
    );
    expect(pending.players[0]!.blocking.inPrison).toBe(3); // (0x80 + 3) & 0x7f
  });

  it('★★ news[3] 住院中病患延長住院%d天：医院表、+3', () => {
    const r = applyNewsEffect(3, sick());
    expect(newsEvent(3)!.literal).toBe(3);
    expect(r.players[2]!.blocking.inHospital).toBe(10); // 7 + 3
    expect(r.players[0]!.blocking.inPrison).toBe(4); // 不动监狱
  });

  it('★ 闸门是**占用表**：表里没有的人即使天数字段非 0 也不动', () => {
    // 0 号有 4 天但占用槽是 0（异常局面）—— 原版按表扫，照样跳过
    const r = applyNewsEffect(1, sick({ prisonOccupancy: [0, 0, 0, 0, 0, 0, 0, 0] }));
    expect(r.players[0]!.blocking.inPrison).toBe(4);
  });

  it('★ 只看玩家槽 0..3：物件槽 4..7 不动（原版循环上界 `cmp ebx, 4`）', () => {
    const r = applyNewsEffect(0, sick({ prisonOccupancy: [1, 0, 0, 0, 1, 0, 0, 0] }));
    expect(r.prisonOccupancy[4]).toBe(1);
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

  it('★ 已实现的是 0..3(释放/延长) / 4(医院) / 8,9,10(固定金额) / 29(监狱) / 11,12,13,23(百分比)', () => {
    // 22 = 銀行擠兌（`loanFreeze`）——它本来就在 `applyNewsEffect` 里实现了，
    // 只是一直没列进这张表（本表没有别的消费者，纯登记）。
    expect(IMPLEMENTED_NEWS_IDS).toEqual([0, 1, 2, 3, 4, 8, 9, 10, 22, 29, 11, 12, 13, 23]);
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
