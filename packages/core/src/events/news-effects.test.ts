/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 新聞事件效果
 */

import { describe, expect, it } from 'vitest';
import { NEWS_EVENTS, newsEvent } from '@rich4/data';
import { makeNode, makePlayer } from '../testing/factories.ts';
import { makeObjects } from '../cards/summon.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import {
  IMPLEMENTED_NEWS_IDS,
  LAND_PRICE_DOWN,
  LAND_PRICE_UP,
  MARKET_CLOSE_DAYS,
  STOCK_SUSPEND_DAYS,
  TYPHOON_RADIUS,
  applyNewsEffect,
} from './news-effects.ts';
import { HISTORY_DAYS, type StockMarketState } from '../places/stock-market.ts';

const ctx = (over = {}) => ({
  players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 })),
  affected: [0],
  priceIndex: 1,
  pool: 0,
  ...over,
});

/** 1 = 普通格、2 = 监狱、3 = 医院（坐标刻意不同，便于断言「真的搬过去了」） */
const NODES = [
  makeNode({ id: 1, x: 100, y: 200 }),
  makeNode({ id: 2, x: 1935, y: 1039, specialKind: SPECIAL_KIND.PRISON }),
  makeNode({ id: 3, x: 777, y: 888, specialKind: SPECIAL_KIND.HOSPITAL }),
];
const OBJS = makeObjects(46);

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
    // ★ 「先算好」那一趟逐人带出来（表现层按它逐行画：`%s繳交%d元`）
    expect(r.shares).toEqual([
      { player: 0, amount: 5000 },
      { player: 1, amount: 5000 },
    ]);
  });

  it('★★ `shares` 是「先算好」那一趟：**含 0**（原版算出 0 只是不画那行）、出局者不进表', () => {
    const r = applyNewsEffect(
      11,
      ctx({
        affected: [0, 1, 2],
        players: [
          makePlayer({ index: 0, cash: 100_000 }),
          makePlayer({ index: 1, cash: 0 }), // 5% = 0 → 进表但金额 0
          makePlayer({ index: 2, cash: 100_000, whoPlays: 0 }), // 出局 → 不进表
        ],
      }),
    );
    expect(r.shares).toEqual([
      { player: 0, amount: 5000 },
      { player: 1, amount: 0 },
    ]);
    // 0 的那位一分钱不动、也不进公库
    expect(r.players[1]!.cash).toBe(0);
    expect(r.pool).toBe(5000);
  });

  it('★ 其余新闻**不带** `shares`（只有百分比那四条有）', () => {
    // 16 汽車超速 = 固定金额那条
    expect(applyNewsEffect(16, ctx()).shares).toBeUndefined();
    // 23 儲金紅利也有
    expect(applyNewsEffect(23, ctx()).shares).toBeDefined();
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

  // ★★ 2026-09-18：原版 `send_to_prison`/`send_to_hospital` 的**函数体内**含
  //   「传送到监狱／医院格 + 跟班搬家」（`@source 0x43d601`..`0x43d674`），
  //   所以新聞这条路的受害者**不在原地**。差分证据：
  //   `rich4-spec/tests/test_confinement_teleport.py`（48/48）。
  it('★ news[29] 坐牢要把人**送进监狱格**（并带回新的物件表）', () => {
    const r = applyNewsEffect(29, ctx({ days: 5, nodes: NODES, objects: OBJS }));
    expect(r.players[0]!.nodeId).toBe(2); // 2 号格是监狱
    expect(r.players[0]!.xpos).toBe(1935);
    expect(r.objects).toHaveLength(OBJS.length);
  });

  it('★ 新聞 4「外星人攻打地球」住院 → 送进医院格；已是病人则原地加刑', () => {
    const r = applyNewsEffect(4, ctx({ days: 3, nodes: NODES, objects: OBJS }));
    expect(r.players[0]!.blocking.inHospital).toBe(3);
    expect(r.players[0]!.nodeId).toBe(3); // 3 号格是医院
    const again = applyNewsEffect(4, ctx({
      days: 3,
      nodes: NODES,
      objects: OBJS,
      players: [makePlayer({ index: 0, blocking: { ...makePlayer().blocking, inHospital: 2 } }),
        ...ctx().players.slice(1)],
    }));
    expect(again.players[0]!.blocking.inHospital).toBe(5);
    expect(again.players[0]!.nodeId).toBe(1); // ★ 原地不动
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

describe('★ 新聞 16/17：行人／車輛休息一回合 @source rich4_news.asm 的两个循环', () => {
  /** 0 号走路（行人）、1 号有座驾、2 号出局 */
  const traffic = () =>
    ctx({
      players: [
        makePlayer({ index: 0, trafficMethod: 0 }),
        makePlayer({ index: 1, trafficMethod: 1 }),
        makePlayer({ index: 2, whoPlays: 0 }),
      ],
    });

  it('★★ news[16] 豪雨特報：只打**行人**（`traffic_method == 0`），`+0x38 = 1`', () => {
    const r = applyNewsEffect(16, traffic());
    expect(r.unimplemented).toBe(false);
    expect(r.players[0]!.blocking.stopping).toBe(1);
    expect(r.players[1]!.blocking.stopping).toBe(0); // 有座驾 → 不打
    expect(r.players[2]!.blocking.stopping).toBe(0); // 出局 → 不打
  });

  it('★★ news[17] 交通阻塞：只打**非行人**（判据恰好相反）', () => {
    const r = applyNewsEffect(17, traffic());
    expect(r.players[0]!.blocking.stopping).toBe(0);
    expect(r.players[1]!.blocking.stopping).toBe(1);
  });
});

describe('★ 新聞 24/25/26：股市三连 @source rich4_news.asm:2939 / VA 0x0044b035 起', () => {
  const mkt = (over: Partial<StockMarketState> = {}): StockMarketState => ({
    stocks: Array.from({ length: 3 }, () => ({ newsFlag: 0x21, f6: 0 }) as never),
    day: 0,
    history: [],
    index: 0,
    closedDays: 0,
    ...over,
  });

  it('★★ news[24] 崩盤：12 支全部**赋值** `newsFlag = 1`（低半字节 = 利空 1 天）', () => {
    const r = applyNewsEffect(24, ctx({ market: mkt() }));
    expect(r.unimplemented).toBe(false);
    // 是赋值不是置位：原来的 0x21 被冲掉
    expect(r.market?.stocks.map((s) => s.newsFlag)).toEqual([1, 1, 1]);
  });

  it('★★ news[25] 全面上漲：全部赋值 `newsFlag = 0x10`（高半字节 = 利多 1 天）', () => {
    const r = applyNewsEffect(25, ctx({ market: mkt() }));
    expect(r.market?.stocks.map((s) => s.newsFlag)).toEqual([0x10, 0x10, 0x10]);
  });

  it('★★ news[26] 股市暫停交易：`closedDays = 10` @source VA 0x0044b0c6', () => {
    const r = applyNewsEffect(26, ctx({ market: mkt() }));
    expect(MARKET_CLOSE_DAYS).toBe(0xa);
    expect(r.market?.closedDays).toBe(10);
    // 不动个股
    expect(r.market?.stocks.map((s) => s.newsFlag)).toEqual([0x21, 0x21, 0x21]);
  });

  it('★ 没给 market 时报未实现，不会默默什么都不做', () => {
    for (const id of [24, 25, 26]) {
      expect(applyNewsEffect(id, ctx()).unimplemented, `news[${id}]`).toBe(true);
    }
  });
});

describe('★ 新聞 6/14：同名地块地价 ×1.3 / ×0.7 @source fcn_004494e0 / fcn_0044a220', () => {
  const land = (id: number, name: string, landPrice: number) =>
    ({ id, name, landPrice, owner: 0, level: 0, type: 0 }) as never;
  const two = () => [land(1, '忠孝東路', 1000), land(2, '忠孝東路', 500), land(3, '仁愛路', 300)];
  const fac = (id: number, name: string, landPrice: number) =>
    ({ id, name, landPrice }) as never;

  it('★★ news[6]：挑中一块地 → **所有同名**地块 ×1.3（截断），其它不动', () => {
    // 挑中 0 号（忠孝東路）→ 1、2 两块同名都改
    const r = applyNewsEffect(6, ctx({ lands: two(), facilities: [], rng: { below: () => 0 } }));
    expect(r.unimplemented).toBe(false);
    expect(LAND_PRICE_UP).toBe(1.3);
    expect(r.landPrice).toEqual([{ id: 1, price: 1300 }, { id: 2, price: 650 }]);
    expect(r.facilityPrice).toBeUndefined();
  });

  it('★★ news[14]：同名地块 ×0.7', () => {
    const r = applyNewsEffect(14, ctx({ lands: two(), facilities: [], rng: { below: () => 1 } }));
    expect(LAND_PRICE_DOWN).toBe(0.7);
    // 挑中 1 号（忠孝東路）→ 两张同名各 ×0.7
    expect(r.landPrice).toEqual([{ id: 1, price: 700 }, { id: 2, price: 350 }]);
  });

  it('★★ 挑中設施时**只改那一处**（原版設施那一支不扫同名）@source VA 0x004496f6', () => {
    // 地 3 块 + 設施 2 处 ⇒ rand() % 5；给 4 → 第二处設施（下标 1）
    const r = applyNewsEffect(
      6,
      ctx({
        lands: two(),
        facilities: [fac(1, '銀行', 2000), fac(2, '銀行', 4000)],
        rng: { below: () => 4 },
      }),
    );
    expect(r.facilityPrice).toEqual([{ id: 2, price: 5200 }]); // 只改 2 号那一处
    expect(r.landPrice).toBeUndefined();
  });

  it('★ 越界的 rand 值会被取模（与原版 `idiv` 同语义）', () => {
    // `below` 在真实 WatcomRng 里已经取过模；这里模拟一个「返回超大值」的假实现
    const r = applyNewsEffect(
      6,
      ctx({ lands: two(), facilities: [], rng: { below: (n: number) => 7 % n } }),
    );
    expect(r.landPrice).toEqual([{ id: 1, price: 1300 }, { id: 2, price: 650 }]); // 7 % 3 = 1 → 忠孝東路
  });

  it('★ 没给 rng / 地图空时报未实现', () => {
    expect(applyNewsEffect(6, ctx({ lands: two() })).unimplemented).toBe(true);
    expect(applyNewsEffect(6, ctx({ lands: [], facilities: [], rng: { below: () => 0 } })).unimplemented).toBe(true);
  });
});

describe('★ 新聞 5/15/19/21：随机拆一处建筑 / 土地流失 @source fcn_004492a0 / a453 / a91e / ac99', () => {
  const land = (id: number, name: string, level: number, type = 0, owner = 1) =>
    ({ id, name, level, type, owner, landPrice: 100 }) as never;
  const fac = (id: number, name: string, level: number, type = 1, owner = 1) =>
    ({ id, name, level, type, owner, landPrice: 100 }) as never;
  const rng0 = { below: () => 0 };

  it('★★ news[15] 民宅失火：候选**只地块**、只挑有等级的，模式 0（拆一级）', () => {
    // 0 号地是空的（level 0）⇒ 不在候选里；候选 = [1 号] ⇒ below(1) 必中 1 号
    const lands = [land(1, 'A', 0), land(2, 'B', 3), land(3, 'C', 1)];
    const r = applyNewsEffect(15, ctx({ lands, facilities: [fac(1, '銀行', 4)], rng: rng0 }));
    expect(r.unimplemented).toBe(false);
    expect(r.landMutations).toEqual([{ id: 2, level: 2, type: 0, owner: 1 }]);
    // ★ 設施**不在候选**（原版这个函数只有地块那一圈）
    expect(r.facilityMutations).toBeUndefined();
  });

  it('★★ news[21] 龍捲風：候选=全部（地块+設施），模式 0；挑中空地块就什么都不发生', () => {
    const lands = [land(1, 'A', 0)];
    const facilities = [fac(1, '銀行', 2)];
    // rand() % 2 = 0 → 地块（level 0）⇒ `mutate_land` mode 0 返回 changed=false
    const r0 = applyNewsEffect(21, ctx({ lands, facilities, rng: rng0 }));
    expect(r0.landMutations).toBeUndefined();
    expect(r0.amount).toBe(0);
    // rand() % 2 = 1 → 設施那一支 ⇒ 2 级 → 1 级
    const r1 = applyNewsEffect(21, ctx({ lands, facilities, rng: { below: () => 1 } }));
    expect(r1.facilityMutations).toEqual([{ id: 1, level: 1, type: 1, owner: 1 }]);
  });

  it('★★ news[5] 外星怪獸摧毀建築：候选=**有等级**的地块+設施，模式 1（清归属）', () => {
    const lands = [land(1, 'A', 0), land(2, 'B', 2)];
    const facilities = [fac(1, '銀行', 0), fac(2, '醫院', 3)];
    const r = applyNewsEffect(5, ctx({ lands, facilities, rng: { below: () => 1 } }));
    // 候选 = [地2, 設2] ⇒ below(2)=1 → 設施 2 号
    expect(r.facilityMutations).toEqual([{ id: 2, level: 0, type: 0, owner: 0 }]);
  });

  it('★★ news[19] 土地流失：候选=全部、模式 1（清归属）', () => {
    const r = applyNewsEffect(
      19,
      ctx({ lands: [land(1, 'A', 0)], facilities: [], rng: rng0 }),
    );
    // 空地块也能被「流失」（清归属不要求有等级）
    expect(r.landMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 0 }]);
  });

  it('★★ news[20] 颱風：以挑中那一处为心、半径 100 内的住宅与設施各拆一级（不打人、无敌意）', () => {
    // 坐标：0 号在 (0,0)，1 号在 (30,30)（范围内），2 号在 (500,500)（范围外）
    const lands = [
      { id: 1, name: 'A', level: 2, type: 0, owner: 1, x: 0, y: 0 },
      { id: 2, name: 'B', level: 1, type: 0, owner: 1, x: 30, y: 30 },
      { id: 3, name: 'C', level: 1, type: 0, owner: 1, x: 500, y: 500 },
    ] as never;
    const facilities = [
      { id: 1, name: '銀行', level: 3, type: 1, owner: 1, x: 10, y: 10 },
      { id: 2, name: '醫院', level: 2, type: 1, owner: 1, x: 4000, y: 4000 },
    ] as never;
    expect(TYPHOON_RADIUS).toBe(0x64);
    // rand() % 5 = 0 → 挑中 0 号地块（原点）
    const r = applyNewsEffect(20, ctx({ lands, facilities, rng: rng0 }));
    expect(r.landMutations).toEqual([
      { id: 1, level: 1, type: 0, owner: 1 },
      { id: 2, level: 0, type: 0, owner: 1 },
    ]);
    // 范围内的設施也掉一级；范围外的两个都不动
    expect(r.facilityMutations).toEqual([{ id: 1, level: 2, type: 1, owner: 1 }]);
    expect(r.amount).toBe(3);
    // ★ 不发敌意：结果里没有任何 hostility 字段（敌意由 `applyNewsEffect` 之外的路径处理）
    expect(Object.keys(r)).not.toContain('hostility');
  });

  it('★★ news[18] 地震：**同名地块全拆一级**（挑中設施时只拆那一处）', () => {
    const lands = [land(1, '忠孝東路', 3), land(2, '忠孝東路', 1), land(3, '仁愛路', 2)];
    // rand() % 3 = 0 → 挑中 1 号（忠孝東路）⇒ 1、2 两块同名各降一级
    const r = applyNewsEffect(18, ctx({ lands, facilities: [], rng: rng0 }));
    expect(r.landMutations).toEqual([
      { id: 1, level: 2, type: 0, owner: 1 },
      { id: 2, level: 0, type: 0, owner: 1 },
    ]);
    // 挑中設施那一支只拆它自己
    const r2 = applyNewsEffect(
      18,
      ctx({ lands, facilities: [fac(1, '銀行', 2)], rng: { below: () => 3 } }),
    );
    expect(r2.facilityMutations).toEqual([{ id: 1, level: 1, type: 1, owner: 1 }]);
    expect(r2.landMutations).toBeUndefined();
  });

  it('★ 候选集为空时什么都不做（原版这里 `idiv 0` 除零崩）', () => {
    for (const id of [5, 15]) {
      const r = applyNewsEffect(id, ctx({ lands: [land(1, 'A', 0)], facilities: [], rng: rng0 }));
      expect(r.unimplemented, `news[${id}]`).toBe(false);
      expect(r.amount).toBe(0);
      expect(r.landMutations).toBeUndefined();
    }
  });

  it('★ 没给 rng 时报未实现', () => {
    for (const id of [5, 15, 19, 21]) {
      expect(
        applyNewsEffect(id, ctx({ lands: [land(1, 'A', 2)], facilities: [] })).unimplemented,
        `news[${id}]`,
      ).toBe(true);
    }
  });
});

describe('★ 新聞 7：公開拍賣公有土地一處 @source fcn_00449735', () => {
  const land = (id: number, owner: number) => ({ id, name: `L${id}`, owner, level: 0, type: 0, landPrice: 100, x: 0, y: 0 }) as never;
  const fac = (id: number, owner: number) => ({ id, name: `F${id}`, owner, level: 0, type: 1, landPrice: 100, x: 0, y: 0 }) as never;

  it('★★ 候选**只有无主的**（地块与設施各收一遍），挑中的那处带出去开拍', () => {
    const lands = [land(1, 1), land(2, 0), land(3, 0)];
    const facilities = [fac(1, 2), fac(2, 0)];
    // 候选 = [地2, 地3, 設2]；below(3) = 0 → 地 2
    const r0 = applyNewsEffect(7, ctx({ lands, facilities, rng: { below: () => 0 } }));
    expect(r0.unimplemented).toBe(false);
    expect(r0.publicAuction).toEqual({ entityId: 2, facility: false });
    // below(3) = 2 → 設 2
    const r2 = applyNewsEffect(7, ctx({ lands, facilities, rng: { below: (n: number) => n - 1 } }));
    expect(r2.publicAuction).toEqual({ entityId: 2, facility: true });
  });

  it('★ 一块无主地都没有时什么都不做（原版 `idiv 0` 除零崩）', () => {
    const r = applyNewsEffect(7, ctx({ lands: [land(1, 1)], facilities: [fac(1, 1)], rng: { below: () => 0 } }));
    expect(r.unimplemented).toBe(false);
    expect(r.publicAuction).toBeUndefined();
    expect(r.amount).toBe(0);
  });

  it('★ 没给 rng 时报未实现', () => {
    expect(applyNewsEffect(7, ctx({ lands: [land(1, 0)] })).unimplemented).toBe(true);
  });
});

describe('★ 新聞 30..35：企業罰款／海外投資／獲利調高一倍 @source fcn_0044b374 等六支', () => {
  const stocks = () =>
    Array.from({ length: 12 }, () => ({ newsFlag: 0, f6: 0, openPrice: 10, price: 10 }) as never);
  const mkt = (): StockMarketState => ({
    stocks: stocks(),
    day: 0,
    history: Array.from({ length: 12 }, () => new Array<number>(HISTORY_DAYS).fill(0)),
    index: 0,
    closedDays: 0,
  });
  /** 1 号企業对应 0 号股票、2 号企業对应 11 号股票、3 号企業没股票（stockIndex >= 0xc） */
  const commercial = (id: number, stockIndex: number) =>
    ({ id, name: `C${id}`, stockIndex, x: 0, y: 0 }) as never;
  const companies = (funds: number[]) => ({
    commercials: [commercial(1, 0), commercial(2, 11), commercial(3, 12)],
    companyFunds: [0, ...funds],
    companyProfit: [0, ...funds.map((f) => f + 1000)],
    market: mkt(),
    // 总是挑第 0 个候选（= 1 号企業）
    rng: { below: () => 0 },
  });

  it('★★ news[30] 工廠排放污水 罰款10000：两家 −10000，股票 `newsFlag = 3`', () => {
    expect(newsEvent(30)!.companyAmount).toBe(10000);
    const r = applyNewsEffect(30, ctx(companies([50000, 50000, 50000])));
    // funds 50000→40000、profit 51000→41000（helper 把 profit 设成 funds+1000）
    expect(r.companyMutations).toEqual([{ id: 1, funds: 40000, profit: 41000 }]);
    expect(r.market?.stocks[0]!.newsFlag).toBe(3);
    // 没对应的股票（stockIndex 12）不动任何股
    expect(r.market?.stocks[11]!.newsFlag).toBe(0);
  });

  it('★★ news[31] 海外投資獲利20000：两家 +20000，股票 `newsFlag = 0x30`', () => {
    expect(newsEvent(31)!.companyAmount).toBe(20000);
    const base = companies([50000, 50000, 50000]);
    const r = applyNewsEffect(31, ctx({ ...base, companyProfit: [0, 1000, 1000, 1000] }));
    expect(r.companyMutations).toEqual([{ id: 1, funds: 70000, profit: 21000 }]);
    expect(r.market?.stocks[0]!.newsFlag).toBe(0x30);
  });

  it('★★ news[32] 海外投資虧損20000：两家 −20000，股票 `newsFlag = 4`', () => {
    const r = applyNewsEffect(32, ctx(companies([50000, 50000, 50000])));
    expect(r.companyMutations).toEqual([{ id: 1, funds: 30000, profit: 31000 }]);
    expect(r.market?.stocks[0]!.newsFlag).toBe(4);
  });

  it('★★ news[33]/[34]：同一条 `companyPenalty` 路径，金额分别 10000 / 5000、flag 同为 3', () => {
    expect(newsEvent(33)!.companyAmount).toBe(10000);
    expect(newsEvent(34)!.companyAmount).toBe(5000);
    const r33 = applyNewsEffect(33, ctx(companies([50000, 50000, 50000])));
    expect(r33.companyMutations).toEqual([{ id: 1, funds: 40000, profit: 41000 }]);
    const r34 = applyNewsEffect(34, ctx(companies([50000, 50000, 50000])));
    expect(r34.companyMutations).toEqual([{ id: 1, funds: 45000, profit: 46000 }]);
    expect(r34.market?.stocks[0]!.newsFlag).toBe(3);
  });

  it('★★ news[35] 獲利調高一倍：`+0x28` 翻倍、`+0x2c` 加上新值、flag = `(x/10000)<<4`', () => {
    const r = applyNewsEffect(
      35,
      ctx({ ...companies([30000, 30000, 30000]), companyProfit: [0, 1000, 1000, 1000] }),
    );
    // 30000 → 60000；累計 1000 + 60000 = 61000
    expect(r.companyMutations).toEqual([{ id: 1, funds: 60000, profit: 61000 }]);
    // (30000/10000)<<4 = 3<<4 = 0x30
    expect(r.market?.stocks[0]!.newsFlag).toBe(0x30);
  });

  it('★ news[35] 的候选集**只收 `+0x28 > 10000`** 的企業（一家都没有就什么都不做，不除零崩）', () => {
    const r = applyNewsEffect(
      35,
      ctx({ ...companies([10000, 10000, 10000]), companyProfit: [0, 0, 0, 0] }),
    );
    expect(r.unimplemented).toBe(false);
    expect(r.companyMutations).toBeUndefined();
    expect(r.amount).toBe(0);
  });

  it('★ 没给 commercials/rng 时报未实现', () => {
    for (const id of [30, 31, 32, 33, 34, 35]) {
      expect(applyNewsEffect(id, ctx()).unimplemented, `news[${id}]`).toBe(true);
    }
  });
});

describe('★ 新聞 27/28：随机一支股票停牌／恢复 @source VA 0x0044b0f8 / 0x0044b1c3', () => {
  /** 固定序列的假 RNG —— 只实现 `below`，方便钉住「挑中了哪一支」 */
  const fakeRng = (picks: number[]) => {
    let i = 0;
    return { below: (n: number) => (picks[i++] ?? 0) % n };
  };
  const stocks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      openPrice: 100 + i,
      price: 100 + i,
      f6: 0,
      newsFlag: 0,
    }) as never);
  const mkt = (n: number, over: Partial<StockMarketState> = {}): StockMarketState => ({
    stocks: stocks(n),
    day: 5,
    history: Array.from({ length: n }, () => new Array<number>(HISTORY_DAYS).fill(0)),
    index: 0,
    closedDays: 0,
    ...over,
  });

  it('★★ news[27]：挑中的那支 `f6 = 0xf`、`price ← openPrice`、写回 `history[day-1]`', () => {
    const m = mkt(12, { history: Array.from({ length: 12 }, () => new Array<number>(HISTORY_DAYS).fill(9)) });
    const r = applyNewsEffect(27, ctx({ market: m, rng: fakeRng([3]) }));
    expect(r.unimplemented).toBe(false);
    expect(STOCK_SUSPEND_DAYS).toBe(0xf); // ★ 文案说 10 天，立即数是 15
    expect(r.market?.stocks[3]!.f6).toBe(0xf);
    expect(r.market?.stocks[3]!.price).toBe(103); // = 它自己的 openPrice
    expect(r.market?.history[3]![4]).toBe(103); // day-1 = 4
    // 别的股票一动不动
    expect(r.market?.stocks[0]!.f6).toBe(0);
    expect(r.market?.history[0]![4]).toBe(9);
  });

  it('★ news[27] 的 day 为 0 时回绕到 0x8f（环形历史）', () => {
    const r = applyNewsEffect(27, ctx({ market: mkt(3, { day: 0 }), rng: fakeRng([1]) }));
    expect(r.market?.history[1]![HISTORY_DAYS - 1]).toBe(101);
  });

  it('★★ news[28]：只在**已停牌**的股票里挑（`f6 = 0`）', () => {
    const m = mkt(4);
    const withSuspended: StockMarketState = {
      ...m,
      stocks: m.stocks.map((s, i) => (i === 2 ? { ...s, f6: 0xf } : s)) as never,
    };
    // 停牌集合 = [2]，故 below(1) 必中 2
    const r = applyNewsEffect(28, ctx({ market: withSuspended, rng: fakeRng([0]) }));
    expect(r.market?.stocks[2]!.f6).toBe(0);
    expect(r.unimplemented).toBe(false);
  });

  it('★ news[28] 在**一支都没停牌**时什么都不做（不照抄原版的 `idiv 0` 除零崩）', () => {
    const m = mkt(4);
    const r = applyNewsEffect(28, ctx({ market: m, rng: fakeRng([0]) }));
    expect(r.unimplemented).toBe(false);
    expect(r.amount).toBe(0);
    // 行情原样（`market` 字段不带 ⇒ 调用方沿用原值）
    expect(r.market).toBeUndefined();
    expect(m.stocks.every((s) => s.f6 === 0)).toBe(true);
  });

  it('★ 没给 rng 时报未实现（不会静默挑第 0 支）', () => {
    for (const id of [27, 28]) {
      expect(applyNewsEffect(id, ctx({ market: mkt(4) })).unimplemented, `news[${id}]`).toBe(true);
    }
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
    // 16/17 = 行人/車輛休息一回合、24/25/26 = 股市三连（2026-09-17 接）
    expect(IMPLEMENTED_NEWS_IDS).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26,
      27, 28, 29, 30, 31, 32, 33, 34, 35, 11, 12, 13, 23,
    ]);
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

// ============================================================
//  ★★ 原版 mutate 尾部的 `0x40dffa`：拆屋会把**全场被关押者**放出来
//  差分证据：rich4-spec/tests/test_mutate_release.py（7/7）
// ============================================================

describe('★ 拆屋顺带放人（0x40dffa）', () => {
  const hotel = (id: number, level: number) =>
    ({ id, name: '旅館', level, type: 6, owner: 1, landPrice: 100 }) as never;
  const land2 = (id: number, level: number) =>
    ({ id, name: 'A', level, type: 0, owner: 1, landPrice: 100 }) as never;
  const confined = (i: number, inHotel: number, whoPlays = 1) =>
    makePlayer({ index: i, whoPlays, blocking: { ...makePlayer().blocking, inHotel } });

  it('★ 設施拆到 0 级 ⇒ 全场在场且被关的人置 0x80（出局者不动）', () => {
    // news[21] 龍捲風：候选含設施；rand()%2=1 → 走設施那支；level 1 → 0
    const r = applyNewsEffect(21, ctx({
      players: [confined(0, 3), confined(1, 0), confined(2, 5, 0), confined(3, 7)],
      lands: [land2(1, 1)],
      facilities: [hotel(1, 1)],
      rng: { below: () => 1 },
    }));
    expect(r.facilityMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 1 }]);
    expect(r.players.map((p) => p.blocking.inHotel)).toEqual([0x80, 0, 5, 0x80]);
  });

  it('★ 只拆到 1 级（没归零）⇒ **不放人**', () => {
    const r = applyNewsEffect(21, ctx({
      players: [confined(0, 3), confined(1, 0), confined(2, 0), confined(3, 7)],
      lands: [land2(1, 1)],
      facilities: [hotel(1, 2)],
      rng: { below: () => 1 },
    }));
    expect(r.facilityMutations).toEqual([{ id: 1, level: 1, type: 6, owner: 1 }]);
    expect(r.players.map((p) => p.blocking.inHotel)).toEqual([3, 0, 0, 7]);
  });

  it('★ 地块 mode 1（清归属）无条件放人', () => {
    // news[19]「土地流失」类走 clearOwner；用 21 的 mode 0 不够，这里直接挑 news 5/19
    const r = applyNewsEffect(19, ctx({
      players: [confined(0, 4), confined(1, 0), confined(2, 0), confined(3, 0)],
      lands: [land2(1, 2)],
      facilities: [],
      rng: { below: () => 0 },
    }));
    // 只要这次确实改了记录，就该放人；若该 news 走的是别的 mode，本断言会暴露
    if (r.amount > 0) {
      expect(r.players[0]?.blocking.inHotel).toBe(0x80);
    }
  });
});

// ============================================================
//  ★★ 2026 本轮：新聞关押也要清"另一张"占用表（原版 `0x40d761` 的两道闸）
//  差分证据：rich4-spec/tests/test_confinement_release.py（15/15）
// ============================================================

describe('★ 新聞入狱要清医院那一格', () => {
  const hospitalised = (i: number) =>
    makePlayer({ index: i, blocking: { ...makePlayer().blocking, inHospital: 5 } });

  it('住院中被新聞判入狱 → 医院床位释放 + 计数器清 0', () => {
    // 29 = 「違法超貸 經營者坐牢５天」（effects: ['prison']，literal 5）
    const players = [hospitalised(0), makePlayer({ index: 1 }),
      makePlayer({ index: 2 }), makePlayer({ index: 3 })];
    // ⚠️ news 29 的 `literal` 是 null（天数由公告阶段给）⇒ 必须在 ctx 里给 `days`
    const r = applyNewsEffect(29, ctx({
      players,
      affected: [0],
      days: 5,
      hospitalOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(r.prisonOccupancy?.[0]).toBe(1);       // 进监狱表
    expect(r.hospitalOccupancy?.[0]).toBe(0);     // ★ 医院那格被清
    expect(r.players[0]?.blocking.inHospital).toBe(0);
    expect(r.players[0]?.blocking.inPrison).toBe(5);
  });
});
