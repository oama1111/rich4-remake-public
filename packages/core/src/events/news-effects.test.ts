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
  ALIEN_BLAST_ATTACKER,
  ALIEN_BLAST_FLAGS,
  ALIEN_BLAST_HEAVY,
  ALIEN_BLAST_RADIUS,
  ALIEN_HOSPITAL_DAYS,
  IMPLEMENTED_NEWS_IDS,
  LAND_PRICE_DOWN,
  LAND_PRICE_UP,
  MARKET_CLOSE_DAYS,
  NEWS_CHAIRMAN_PRISON_DAYS,
  STOCK_SUSPEND_DAYS,
  TYPHOON_RADIUS,
  applyNewsEffect,
} from './news-effects.ts';
import { HISTORY_DAYS, type StockMarketState } from '../places/stock-market.ts';
import { WatcomRng } from '../rng/watcom.ts';

const ctx = (over = {}) => ({
  players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 })),
  affected: [0],
  priceIndex: 1,
  pool: 0,
  ...over,
});

/**
 * 1 = 普通格、2 = 监狱、3 = 医院（坐标刻意不同，便于断言「真的搬过去了」）。
 *
 * ★★ 关押格的判据是节点 `type` = 0x1f42/0x1f41（景观基数 8000 + 记录 2/1），
 *   **不是** `specialKind`（那是「落点特殊格」的判据）—— 见
 *   `rules/confinement.ts` 的 `CONFINEMENT_GATE_TYPE`。
 */
const NODES = [
  makeNode({ id: 1, x: 100, y: 200 }),
  makeNode({
    id: 2, x: 1935, y: 1039,
    type: 0x1f42, ref: { kind: 'landscape', index: 2 },
    specialKind: SPECIAL_KIND.PRISON,
  }),
  makeNode({
    id: 3, x: 777, y: 888,
    type: 0x1f41, ref: { kind: 'landscape', index: 1 },
    specialKind: SPECIAL_KIND.HOSPITAL,
  }),
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

  it('★★ 儲金紅利（23）= 存款 10%，是**发钱**（公库不动），且进的是**存款**不是现金', () => {
    expect(newsEvent(23)!.factor).toBeNull();
    const r = applyNewsEffect(
      23,
      ctx({
        pool: 777,
        players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 100_000 })),
      }),
    );
    // 存款 100000 × 0.1（`@source 0x00465734` 的双精度常量 = 0.1）= 红 10000，
    // 公库一分不动。
    // ★ 2026-09-19 订正：这条断言原先写「直接进**现金**」（`cash` 110000）——
    //   **与机器码不符**。@source `fcn_0044aedb`：
    // ```asm
    // 0044af36  mov  ebp, dword ptr [ebx + 0x496b8c]   ; ebp = loan（下面 test/jne 已排除非 0）
    // 0044af44  fild dword ptr [ebx + 0x496b88]        ; ★ +0x20 = money_in_bank
    // 0044af4a  fmul qword ptr [0x465734]              ; = 0.1
    // 0044af50  call 0x457dbc                          ; 向零截断
    // 0044af5c  push ebp                               ; ★ flags = 0
    // 0044af66  call 0x41d3f4                           ; add_money(player, 金额, 0)
    // ```
    //   `0x41d3f4` 的 `test byte [esp+0x10], 1 / je 进存款 / add [player+0x20]`
    //   ⇒ flags = 0 写的是**银行存款** `+0x20`，现金 `+0x1c` 一分不动。
    expect(r.players[0]!.moneyInBank).toBe(110_000);
    expect(r.players[0]!.cash).toBe(100_000);
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

  // ★★ 2026-09 本轮订正：下面两条旧用例**把错误行为钉死了**。
  //   它们原先是 `applyNewsEffect(29, ctx({ days: 5 }))` ⇒ 无脑把 0 号玩家
  //   （= 抽牌者）关 5 天。而原版 `fcn_0044b25b` 关的是**随机抽中的那家企業的
  //   經營者** —— 关抽牌者是「关错人」，比什么都不做更糟。
  //   29 现在走 `companyChairmanPrison`，目标由效果层抽（要消耗一次 `rand()`）。
  it('news[29] 不再把「抽牌者」关起来 —— 没有企業/没有 rng 就什么都不做', () => {
    // ① 没有 rng：不假装随机，报未实现（调用方 bug 要被看见）
    expect(applyNewsEffect(29, ctx({ days: 5 })).unimplemented).toBe(true);
    // ② 有 rng 但一家有主企業都没有 ⇒ 不动任何人、且**不掷随机数**
    let calls = 0;
    const r = applyNewsEffect(29, ctx({
      affected: [0],
      rng: { below: (n: number) => { calls++; return n - 1; } },
      commercials: [],
    }));
    expect(r.players[0]!.blocking.inPrison).toBe(0);
    expect(r.prisonOccupancy[0]).toBe(0);
    expect(r.amount).toBe(0);
    expect(calls).toBe(0);
  });

  it('★ news[29] 坐牢的是**抽中的經營者**，且要送进监狱格', () => {
    const r = applyNewsEffect(29, ctx({
      days: 5,
      nodes: NODES,
      objects: OBJS,
      affected: [0],
      // 只有 1 号企業有主（owner = 3 ⇒ 玩家下标 2）
      commercials: [
        { id: 1, owner: 0 } as never,
        { id: 2, owner: 3 } as never,
      ],
      rng: { below: () => 0 },
    }));
    expect(r.players[2]!.blocking.inPrison).toBe(NEWS_CHAIRMAN_PRISON_DAYS);
    expect(r.players[0]!.blocking.inPrison).toBe(0); // ★ 抽牌者毫发无伤
    expect(r.prisonOccupancy[2]).toBe(1);
    // 关押会把人挪到监狱格（`send_to_prison` 函数体内的事）
    expect(r.players[2]!.nodeId).toBe(2);
    expect(r.players[2]!.xpos).toBe(1935);
    expect(r.objects).toHaveLength(OBJS.length);
    expect(r.chairmanPrison).toEqual({ companyId: 2, chairman: 2, victim: 2, days: 5 });
  });

  // ★★★ 订正（2026-09 本轮）：这条旧用例**把錯誤行为钉死了**。
  //   它原先把新聞 4 当成 `hospital` 效果（`applyNewsEffect(4, ctx({days:3}))`
  //   ⇒ 无脑把 0 号玩家关进医院 3 天），而 `event-table.ts` 里那条 `['hospital']`
  //   本身就是错的：`@source fcn_0044913d` 是
  //   `damage_area(0x64, 0x26, 1, -1)` 一发**重击**，住院只是爆心的**副作用**
  //   （`0x40cd07` 挂 `+0x15 & 0x40` 位 → `send_to_hospital(玩家,3)`，
  //    VA 0x00449279..0x00449285）。原版**没有**「无脑关全体」这条路。
  //   故本用例改成按 exe 真值：范围里的人才住院（且天数恒为立即数 3，不看 `ctx.days`）。
  it('★★ news[4]「外星人攻打地球」：只有**被半径 100 那发重击扫到**的人送医 3 天', () => {
    // 爆心 = 1 号地块（坐标 (100,200)，正是 1 号格）⇒ 站在 1 号格的 0 号玩家被扫到；
    // 4 号玩家站在 (1935,1039)（2 号格，监狱格）⇒ 远在窗外，一动不动。
    const lands = [
      { id: 1, name: 'A', level: 2, type: 0, owner: 1, x: 100, y: 200 },
    ] as never;
    const players = [
      makePlayer({ index: 0, nodeId: 1 }),
      makePlayer({ index: 1, nodeId: 2 }),
      makePlayer({ index: 2, nodeId: 2 }),
      makePlayer({ index: 3, nodeId: 2 }),
    ];
    const r = applyNewsEffect(
      4,
      ctx({ days: 99, nodes: NODES, objects: OBJS, lands, players, rng: { below: () => 0 } }),
    );
    expect(r.unimplemented).toBe(false);
    // ★ 天数不看 `ctx.days`（那 99 是干扰项）—— 原版是 `push 3` 的立即数
    expect(r.players[0]!.blocking.inHospital).toBe(3);
    expect(r.players[0]!.nodeId).toBe(3); // 3 号格是医院
    expect(r.hospitalOccupancy[0]).toBe(1);
    // 窗外的人一个都不许动
    for (const i of [1, 2, 3]) {
      expect(r.players[i]!.blocking.inHospital, `player[${i}]`).toBe(0);
      expect(r.players[i]!.nodeId).toBe(2);
    }
    expect(r.blastedHospital).toEqual([0]);
  });

  it('★ news[4]：**已在住院/坐牢/住宿/消失**的人不挂「被炸」位 ⇒ 不被追加天数', () => {
    // @source `0x40cd07` 的第一道闸 `cmp dword [player+0x32], 0 / jne`：
    //   已在 +0x32..+0x35 任一状态 → 直接返回，那个 0x40 位根本不会设。
    const lands = [{ id: 1, name: 'A', level: 2, type: 0, owner: 1, x: 100, y: 200 }] as never;
    const players = [
      makePlayer({
        index: 0,
        nodeId: 1,
        blocking: { ...makePlayer().blocking, inHospital: 2 },
      }),
      makePlayer({ index: 1, nodeId: 1 }),
      makePlayer({ index: 2, nodeId: 2 }),
      makePlayer({ index: 3, nodeId: 2 }),
    ];
    const r = applyNewsEffect(
      4,
      ctx({ nodes: NODES, objects: OBJS, lands, players, rng: { below: () => 0 } }),
    );
    expect(r.players[0]!.blocking.inHospital).toBe(2); // 原地不动、不加刑
    expect(r.players[0]!.nodeId).toBe(1);
    expect(r.players[1]!.blocking.inHospital).toBe(3); // 同格的健康玩家照打
    expect(r.blastedHospital).toEqual([1]);
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
    expect(r.facilityMutations).toEqual([{ id: 2, level: 0, type: 0, owner: 0, tenure: 0 }]);
  });

  it('★★ news[19] 土地流失：候选=全部、模式 1（清归属）', () => {
    const r = applyNewsEffect(
      19,
      ctx({ lands: [land(1, 'A', 0)], facilities: [], rng: rng0 }),
    );
    // 空地块也能被「流失」（清归属不要求有等级）
    expect(r.landMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 0, tenure: 0 }]);
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

// ============================================================
//  ★★★ 新聞 4「外星人攻打地球」@source `fcn_0044913d`（VA 0x0044913d，355 B）
//  原版事件表 `events_calls_table[4]`。施加阶段：
//    ① 候选表 = level != 0 的地块 + level != 0 的設施，`rand() % n` 挑一处当爆心
//    ② `damage_area(0x64, 0x26, 1, -1)` —— **半径 100 的方窗 + 重击**、不记敌意
//    ③ 被 `0x40cd07` 挂上「被炸」位的人 `send_to_hospital(玩家, 3)`
//  ★ 这一组里最先要钉死的是「`0x64` 是半径、`1` 才是重击」——
//    `state/reduce.ts` 的 `fireMissile` 把两者揉成了一个 `heavy`（heavy ⇒ 全图），
//    照抄那个形状就会把「半径 100 的重击」错做成「全图重击」。
// ============================================================
describe('★★★ 新聞 4「外星人攻打地球」@source fcn_0044913d（VA 0x0044913d）', () => {
  const built = (
    id: number,
    level: number,
    type: number,
    owner: number,
    x: number,
    y: number,
    name = 'A',
  ) => ({ id, name, level, type, owner, x, y, landPrice: 100 }) as never;
  const fac = (id: number, level: number, type: number, owner: number, x: number, y: number) =>
    ({ id, name: `F${id}`, level, type, owner, x, y, flast: 0, landPrice: 100 }) as never;
  /** 只记调用次数的假 RNG —— 用来钉「恰掷一次」 */
  const countingRng = (pick = 0) => {
    let calls = 0;
    return {
      rng: { below: (n: number) => (calls++, pick % n) },
      calls: () => calls,
    };
  };

  it('★ 事件表第 4 项 = 真值：va / effects / literal（不是 `hospital`）', () => {
    const e = newsEvent(4)!;
    expect(e.va).toBe(0x0044913d);
    expect(e.effects).toEqual(['alienBlast']);
    expect(e.effects).not.toContain('hospital');
    expect(e.literal).toBeNull(); // 文案里没有 %d；原版也没写 [0x48c5b4]
    expect(e.text).toContain('外星人攻打地球');
    // 五个立即数逐个钉住（VA 0x00449225..0x0044922d 与 0x00449282）
    expect(ALIEN_BLAST_RADIUS).toBe(0x64); // ★ 半径 100
    expect(ALIEN_BLAST_FLAGS).toBe(0x26); // 住宅 | 設施 | 范围里的人
    expect(ALIEN_BLAST_HEAVY).toBe(1); // ★ 重击（与半径是**两列**）
    expect(ALIEN_BLAST_ATTACKER).toBe(-1); // 攻击者 = 无 ⇒ 不记敌意
    expect(ALIEN_HOSPITAL_DAYS).toBe(3); // push 3 / call 0x43ec3f
    expect(IMPLEMENTED_NEWS_IDS).toContain(4);
  });

  it('★★ 端到端：爆心半径 100 内的住宅/連鎖店/无主地**全清**，窗外的一格不动', () => {
    // 小地图：地 1 在爆心 (1000,1000)、地 2 在 (+50,+50)（窗内）、
    //          地 3 在 (+300,0)（窗外，超过 100）、地 4 在 (5000,5000)（窗外）
    const lands = [
      built(1, 3, 0, 2, 1000, 1000), // 住宅：有主、3 级
      built(2, 1, 1, 3, 1050, 1050), // ★ 連鎖店：有主、1 级
      built(3, 2, 0, 1, 1300, 1000), // ★ |dx| = 300 > 100 ⇒ 窗外
      built(4, 1, 0, 0, 5000, 5000), // 无主地（也在窗外）
    ];
    const r = applyNewsEffect(4, ctx({ lands, facilities: [], rng: { below: () => 0 } }));
    expect(r.unimplemented).toBe(false);
    // 窗内两块**重击**：owner/level/type 全清（連鎖店身份也被抹掉）
    expect(r.landMutations).toEqual([
      { id: 1, level: 0, type: 0, owner: 0, tenure: 0 },
      { id: 2, level: 0, type: 0, owner: 0, tenure: 0 },
    ]);
    // 窗外那两块一个字节都不许动
    expect(r.landMutations?.some((m) => m.id === 3 || m.id === 4)).toBe(false);
    expect(r.amount).toBe(2);
  });

  it('★★★ 半径 100 是**窗**不是全图：heavy=1 不代表打全地图（证伪 `fireMissile` 那个形状）', () => {
    // 只有两块地，第二块离爆心 0x64 + 1 = 101（刚好出窗）
    const lands = [built(1, 2, 0, 1, 0, 0), built(2, 2, 0, 1, 101, 0)];
    const r = applyNewsEffect(4, ctx({ lands, facilities: [], rng: { below: () => 0 } }));
    expect(r.landMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 0, tenure: 0 }]);
    // 距离恰好 100 的还在窗内（`<=`）
    const lands2 = [built(1, 2, 0, 1, 0, 0), built(2, 2, 0, 1, 100, 100)];
    const r2 = applyNewsEffect(4, ctx({ lands: lands2, facilities: [], rng: { below: () => 0 } }));
    expect(r2.landMutations).toEqual([
      { id: 1, level: 0, type: 0, owner: 0, tenure: 0 },
      { id: 2, level: 0, type: 0, owner: 0, tenure: 0 },
    ]);
  });

  it('★★ 爆心只从「盖了房子」的地块/設施里挑（`level != 0`），空地块不进候选', () => {
    // 若候选误收 level==0 的地块，`below(3)=0` 会挑中地 1（坐标 0,0）⇒ 一块都炸不到
    const lands = [
      built(1, 0, 0, 1, 0, 0), // 空地（有主但没盖）—— 不是候选
      built(2, 0, 0, 1, 0, 0), // 同上
      built(3, 2, 0, 1, 9000, 9000), // ★ 唯一候选 = 爆心
      built(4, 1, 0, 1, 9050, 9000), // 窗内
    ];
    const r = applyNewsEffect(4, ctx({ lands, facilities: [], rng: { below: () => 0 } }));
    // 候选 = [地3]（1 个）；空地 1/2 虽然就在 (0,0) 也不受影响
    expect(r.landMutations).toEqual([
      { id: 3, level: 0, type: 0, owner: 0, tenure: 0 },
      { id: 4, level: 0, type: 0, owner: 0, tenure: 0 },
    ]);
  });

  it('★★ 爆心也可以是**設施**（候选表「地先、設施后」）；設施重击 = 四项全清 + `0x40dffa` 放人', () => {
    const lands = [built(1, 2, 0, 1, 0, 0)];
    const facilities = [fac(1, 3, 1, 2, 200, 200), fac(2, 1, 1, 2, 9000, 9000)];
    // 候选 = [地1, 設1, 設2]；below(3) = 1 → 設 1（爆心在 (200,200)）
    const r = applyNewsEffect(
      4,
      ctx({ lands, facilities, rng: { below: (n: number) => 1 % n } }),
    );
    // 窗内：地 1（|Δx| = |Δy| = 200 > 100 ⇒ **不在**窗内）
    expect(r.landMutations).toEqual([]);
    // 設施 1 被重击：owner/level/type 全清（`+0x34` 地契由 mutateFacility 清，见补丁说明）
    expect(r.facilityMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 0, tenure: 0 }]);
    // 9 号設施远在窗外
    expect(r.facilityMutations?.some((m) => m.id === 2)).toBe(false);
  });

  it('★★ 第二十一份：爆心坐标交出去（`0x40af12` → `view_to(x, y, 2)` @ 0x0044921d）；窗外的人不住院', () => {
    // 回报现场的形状：踩上新聞格的人（节点 1，(0,0)）离爆心很远 —— 他不该住院，
    //   但镜头必须移到爆心，否则整幅盖在棋盘上的飛碟影片看着像射中了他
    const lands = [built(1, 1, 0, 2, 5000, 5000)];
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), makeNode({ id: 2, x: 5050, y: 5000 }), NODES[2]!];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: i === 3 ? 2 : 1 }));
    const r = applyNewsEffect(4, ctx({ players, lands, facilities: [], nodes, rng: { below: () => 0 } }));
    expect(r.blastOrigin).toEqual({ x: 5000, y: 5000 });
    // 只有站在窗内（节点 2）的 3 号住院 3 天；踩新聞格的 0 号不在窗里
    expect(r.blastedHospital).toEqual([3]);
    expect(r.players[0]!.blocking.inHospital).toBe(0);
    expect(r.players[3]!.blocking.inHospital).not.toBe(0);
    // 設施当爆心同理（候选表「地先、設施后」）
    const r2 = applyNewsEffect(
      4,
      ctx({ lands: [], facilities: [fac(1, 2, 1, 2, 700, 800)], rng: { below: () => 0 } }),
    );
    expect(r2.blastOrigin).toEqual({ x: 700, y: 800 });
    // 候选集为空（原版 idiv 除零）⇒ 不带
    expect(applyNewsEffect(4, ctx({ lands: [], facilities: [], rng: { below: () => 0 } })).blastOrigin).toBeUndefined();
  });

  it('★★ 設施重击无条件 `0x40dffa`：**全场被关押者**挂「下一天释放」', () => {
    const confined = (i: number, inHotel: number) =>
      makePlayer({ index: i, nodeId: 2, blocking: { ...makePlayer().blocking, inHotel } });
    const r = applyNewsEffect(
      4,
      ctx({
        players: [confined(0, 3), confined(1, 0), confined(2, 7), confined(3, 0)],
        lands: [],
        facilities: [fac(1, 2, 1, 1, 0, 0)],
        rng: { below: () => 0 },
      }),
    );
    expect(r.facilityMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 0, tenure: 0 }]);
    // 0x80 = 待释放（与 news[21] 龍捲風那条同一支）
    expect(r.players[0]!.blocking.inHotel).toBe(0x80);
    expect(r.players[2]!.blocking.inHotel).toBe(0x80);
    expect(r.players[1]!.blocking.inHotel).toBe(0);
  });

  it('★ 恰掷一次随机数（原版这条路上只有 0x004491dd 那一次 `call rand`）', () => {
    const c = countingRng(0);
    applyNewsEffect(
      4,
      ctx({ lands: [built(1, 2, 0, 1, 0, 0)], facilities: [], rng: c.rng }),
    );
    expect(c.calls()).toBe(1);
  });

  it('★ 不产生任何敌意（攻击者 = -1，`damage_area` 里两条 `cmp esi,-1 / je` 都跳过）', () => {
    const r = applyNewsEffect(
      4,
      ctx({ lands: [built(1, 2, 0, 1, 0, 0)], facilities: [], rng: { below: () => 0 } }),
    );
    expect(Object.keys(r)).not.toContain('hostility');
    expect(Object.keys(r)).not.toContain('hostilityDeltas');
  });

  it('★★ 被炸到的座驾撞毁回库存（`0x40cd07` 的 `inc byte [0x497324/5]`）', () => {
    const lands = [built(1, 2, 0, 1, 0, 0)];
    const players = [
      makePlayer({ index: 0, nodeId: 1, trafficMethod: 2, ndices: 3 }), // 汽車 → 道具 6
      makePlayer({ index: 1, nodeId: 9 }), // 窗外
      makePlayer({ index: 2, nodeId: 1, trafficMethod: 1 }), // 機車 → 道具 5
      makePlayer({ index: 3, nodeId: 9 }),
    ];
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), makeNode({ id: 9, x: 9000, y: 9000 })];
    const r = applyNewsEffect(
      4,
      ctx({ lands, players, nodes, toolStock: [0, 0, 0, 0, 0, 0, 0, 0], rng: { below: () => 0 } }),
    );
    expect(r.players[0]!.trafficMethod).toBe(0);
    expect(r.players[0]!.ndices).toBe(1);
    expect(r.players[2]!.trafficMethod).toBe(0);
    expect(r.toolStock?.[6]).toBe(1); // 汽車回库存
    expect(r.toolStock?.[5]).toBe(1); // 機車回库存
    // ★ 不给 `ctx.toolStock` 就不带这个字段（但座驾照样清零）
    const r2 = applyNewsEffect(4, ctx({ lands, players, nodes, rng: { below: () => 0 } }));
    expect(r2.toolStock).toBeUndefined();
    expect(r2.players[0]!.trafficMethod).toBe(0);
  });

  it('★ 没给 rng 时报未实现（不会默默挑第 0 处）', () => {
    const r = applyNewsEffect(4, ctx({ lands: [built(1, 2, 0, 1, 0, 0)] }));
    expect(r.unimplemented).toBe(true);
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

  it('★ news[29] 的文案里没有 %d，天数是 phase 1 的立即数 5（不在 literal）', () => {
    // ⚠️ 订正（2026-09 本轮）：这条原先把 **4 与 29 并列**，并断言
    //   `applyNewsEffect(4, ctx()).unimplemented === true`。新聞 4 的
    //   `literal` 确实是 null、文案里确实没有 `%d`，但它**不走**「天数由调用方给」
    //   那条路 —— 它是 `alienBlast`（见 `ALIEN_HOSPITAL_DAYS`）。旧断言当时
    //   恰好也返回 true（因为 `ctx()` 里连 `rng` 都没有），属于**巧合通过**，
    //   名字与注释都在说谎。
    //   ★★ 本轮再收窄 29：它也不是「缺 days 的 prison」——天数 5 是
    //   `0044b35f push 5` 的立即数，住在 `NEWS_CHAIRMAN_PRISON_DAYS`。
    const e = newsEvent(29)!;
    expect(e.literal).toBeNull();
    expect(e.text).not.toContain('%d');
    expect(NEWS_CHAIRMAN_PRISON_DAYS).toBe(5);
    // 缺 rng 时报未实现（不会默默什么都不做），而**不是**取 literal 当 0 天
    expect(applyNewsEffect(29, ctx()).unimplemented).toBe(true);
  });

  it('★ news[4] 不需要调用方给 days —— 缺的只是 rng（有 rng 就真打一发）', () => {
    const e = newsEvent(4)!;
    expect(e.literal).toBeNull();
    expect(e.text).not.toContain('%d');
    // 没有 rng → 未实现（不会默默什么都不做）
    expect(applyNewsEffect(4, ctx()).unimplemented).toBe(true);
    // ★ 给了 rng（哪怕没有候选）就**不再**是未实现 —— 与 29 的「缺 days」判然两路
    const r = applyNewsEffect(4, ctx({ rng: { below: () => 0 } }));
    expect(r.unimplemented).toBe(false);
    expect(r.amount).toBe(0); // 一处盖了房子的都没有 ⇒ 原版这里 `idiv 0` 崩，本引擎不动
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

describe("★ 拆屋放人（0x40dffa）—— 只在設施支", () => {
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
    // ★★ 2026-09-19 订正（§7.141 E1，通道 2 `test_land_mutation_gates.py` 354/354）：
    //   原版 `0x40dffa` 的三个调用点**全在設施支**（`0x40ac33`/`0x40ac4d`/`0x40ac6c`）；
    //   地块支一次都不调 ⇒ **拆住宅/连锁店不放人**。
    if (r.amount > 0) {
      expect(r.players[0]?.blocking.inHotel).not.toBe(0x80);
      expect(r.landMutations?.length ?? 0).toBeGreaterThan(0);
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
    // 新聞 29 走 `companyChairmanPrison`（目标 = 抽中的企業經營者 = 0 号）
    const players = [hospitalised(0), makePlayer({ index: 1 }),
      makePlayer({ index: 2 }), makePlayer({ index: 3 })];
    const r = applyNewsEffect(29, ctx({
      players,
      affected: [0],
      commercials: [{ id: 1, owner: 1 } as never],
      rng: { below: () => 0 },
      hospitalOccupancy: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(r.prisonOccupancy?.[0]).toBe(1);       // 进监狱表
    expect(r.hospitalOccupancy?.[0]).toBe(0);     // ★ 医院那格被清
    expect(r.players[0]?.blocking.inHospital).toBe(0);
    expect(r.players[0]?.blocking.inPrison).toBe(NEWS_CHAIRMAN_PRISON_DAYS);
  });
});

// ============================================================
//  ★★ 新聞 29「%s違法超貸 經營者%s坐牢５天」@source fcn_0044b25b
//
//  这一组是**逐行**对着 exe 写的（见 `@rich4/data` 的 `companyChairmanPrison`
//  长注释里的汇编）。每一条都能「改坏 → 变红」：
//    · 删掉 5 天 / 改成 ctx.days ⇒ 天数那两条红；
//    · 改成关 currentPlayer ⇒ 「抽牌者毫发无伤」+「关的是抽中的經營者」两条红；
//    · 不消耗 rand（或消耗两次）⇒ WatcomRng 那两条红；
//    · 候选不过滤 owner != 0 ⇒ 「below 收到的 n」那条红；
//    · 免罪/嫁禍 二级判定写反/漏扣卡 ⇒ 对应两条红。
// ============================================================

describe('★★ 新聞 29：隨機挑一家有主企業的經營者关 5 天', () => {
  /** 只有 id/owner 有用（新聞 29 只读 `+0x18`）；其余字段与本事件无关 */
  const co = (id: number, owner: number) => ({ id, owner, name: `C${id}` }) as never;

  it('① 候选只收 `owner != 0` 的企業 —— `rand() % n` 的 n 就是有主企業数', () => {
    const sizes: number[] = [];
    const r = applyNewsEffect(29, ctx({
      // 3 家有主、2 家无主 —— 无主那两家**不能**进候选
      commercials: [co(1, 0), co(2, 2), co(3, 0), co(4, 4), co(5, 3)],
      rng: { below: (n: number) => { sizes.push(n); return 1; } },
    }));
    expect(sizes).toEqual([3]);
    // 候选表 = [2, 4, 5]，挑下标 1 ⇒ 4 号 ⇒ owner 4 ⇒ 玩家下标 3
    expect(r.chairmanPrison).toEqual({ companyId: 4, chairman: 3, victim: 3, days: 5 });
    expect(r.players[3]!.blocking.inPrison).toBe(5);
  });

  it('② `rand()%n` 挑中的那家的 chairman 真的被关 **5** 天（不是 0、不是 3）', () => {
    const r = applyNewsEffect(29, ctx({
      commercials: [co(1, 1), co(2, 3)],
      rng: { below: () => 1 }, // → 2 号企業（owner 3 ⇒ 玩家下标 2）
    }));
    expect(NEWS_CHAIRMAN_PRISON_DAYS).toBe(5);
    expect(r.players.map((p) => p.blocking.inPrison)).toEqual([0, 0, 5, 0]);
    expect(r.prisonOccupancy.slice(0, 4)).toEqual([0, 0, 1, 0]);
    expect(r.amount).toBe(5);
    // ★ 天数**不是**从 ctx.days / entry.literal 来的：给一个别的值也不认
    const r2 = applyNewsEffect(29, ctx({
      days: 99,
      commercials: [co(1, 1), co(2, 3)],
      rng: { below: () => 1 },
    }));
    expect(r2.players[2]!.blocking.inPrison).toBe(5);
  });

  it('③ **恰好消耗一次** `rand()` —— 用真实 WatcomRng 断言 rngState 只前进一格', () => {
    const rng = new WatcomRng(0x1234_5678);
    // 先算出「只走一步」应该到哪个状态
    const probe = new WatcomRng(rng.getState());
    probe.next();
    const afterOne = probe.getState();
    // 再走一步的状态（用来证明「不是两次」）
    const probe2 = new WatcomRng(afterOne);
    probe2.next();
    const afterTwo = probe2.getState();

    const r = applyNewsEffect(29, ctx({
      commercials: [co(1, 1), co(2, 3)],
      rng,
    }));
    expect(r.chairmanPrison?.companyId).toBe(2);
    expect(rng.getState()).toBe(afterOne);
    expect(rng.getState()).not.toBe(afterTwo);
  });

  it('⑥ 无候选企業 ⇒ 不动任何人、**一次随机数都不掷**', () => {
    let calls = 0;
    const rng = new WatcomRng(777);
    const before = rng.getState();
    const r = applyNewsEffect(29, ctx({
      commercials: [co(1, 0), co(2, 0)],
      rng: { below: (n: number) => { calls++; return n - 1; } },
    }));
    expect(calls).toBe(0);
    expect(r.amount).toBe(0);
    expect(r.chairmanPrison).toBeUndefined();
    expect(r.players.map((p) => p.blocking.inPrison)).toEqual([0, 0, 0, 0]);
    expect(rng.getState()).toBe(before);
  });

  it('④ chairman 持免罪卡(21) ⇒ 不关任何人、**卡被消耗**、整条作废', () => {
    const r = applyNewsEffect(29, ctx({
      players: [
        makePlayer({ index: 0, whoPlays: 2, cards: [21, 7] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      commercials: [co(1, 1)],
      rng: { below: () => 0 },
    }));
    expect(r.players[0]!.blocking.inPrison).toBe(0);
    expect(r.players[0]!.cards).toEqual([7]); // ★ 21 被扣掉
    expect(r.prisonOccupancy.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(r.amount).toBe(0);
    // 免罪 ⇒ `0x44b35a cmp eax,-1 / je` 整条作废：**不带** chairmanPrison
    expect(r.chairmanPrison).toBeUndefined();
  });

  it('④b 免罪卡(21) 排在嫁禍卡(19) 前面：两张都持有时只扣 21、19 留着', () => {
    const r = applyNewsEffect(29, ctx({
      players: [
        makePlayer({ index: 0, whoPlays: 2, cards: [21, 19], hostility: [0, 3, 0, 0] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      commercials: [co(1, 1)],
      rng: { below: () => 0 },
    }));
    expect(r.players[0]!.cards).toEqual([19]);
    expect(r.players[1]!.blocking.inPrison).toBe(0);
    expect(r.chairmanPrison).toBeUndefined();
  });

  it('⑤ 持嫁禍卡(19) ⇒ 关到**嫁祸目标**（最恨的人）而不是 chairman，且扣掉 19', () => {
    const rng = new WatcomRng(4242);
    const probe = new WatcomRng(rng.getState());
    probe.next();
    const r = applyNewsEffect(29, ctx({
      players: [
        // ★ `hostility` 是**chairman 自己**对别人的恨意（`me.hostility[b]`，`0x40d2d3`）
        makePlayer({ index: 0, whoPlays: 2, cards: [19], hostility: [0, 0, 5, 0] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      commercials: [co(1, 1)],
      rng,
    }));
    // 最恨的是 2 号（`hostility[2] = 5`）⇒ 替 chairman 坐牢
    expect(r.players[2]!.blocking.inPrison).toBe(5);
    expect(r.players[0]!.blocking.inPrison).toBe(0);
    expect(r.players[0]!.cards).toEqual([]); // ★ 19 被扣
    expect(r.chairmanPrison).toEqual({ companyId: 1, chairman: 0, victim: 2, days: 5 });
    // 最恨的人那条路**不再掷随机**（mode 0 也没有门槛那一次）⇒ 仍只有抽企業那一步
    expect(rng.getState()).toBe(probe.getState());
  });

  it('⑤b 持嫁禍卡(19) 但没有最恨的人 ⇒ 随机挑一个（**第二次** rand）', () => {
    const rng = new WatcomRng(99);
    const probe = new WatcomRng(rng.getState());
    probe.next(); // 抽企業
    const randForPick = probe.next() % 3; // 候选 = [1,2,3] 三个活人
    const afterTwo = probe.getState();
    const r = applyNewsEffect(29, ctx({
      players: [
        makePlayer({ index: 0, whoPlays: 2, cards: [19] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      commercials: [co(1, 1)],
      rng,
    }));
    expect(r.players[1 + randForPick]!.blocking.inPrison).toBe(5);
    expect(r.players[0]!.blocking.inPrison).toBe(0);
    expect(r.players[0]!.cards).toEqual([]);
    expect(rng.getState()).toBe(afterTwo);
  });

  it('⑤c 持嫁禍卡(19) 但**无人可嫁** ⇒ chairman 自己被关、**19 留着**（原版不掉卡）', () => {
    const r = applyNewsEffect(29, ctx({
      players: [
        makePlayer({ index: 0, whoPlays: 2, cards: [19] }),
        makePlayer({ index: 1, whoPlays: 0 }), // 出局
        makePlayer({ index: 2, whoPlays: 0 }),
        makePlayer({ index: 3, whoPlays: 0 }),
      ],
      commercials: [co(1, 1)],
      rng: { below: () => 0 },
    }));
    expect(r.players[0]!.blocking.inPrison).toBe(5); // ★ 嫁祸落空 = 自己坐牢
    expect(r.players[0]!.cards).toEqual([19]);       // ★ 卡不扣（`0x4449e7 je 0x444a53`）
    expect(r.chairmanPrison).toEqual({ companyId: 1, chairman: 0, victim: 0, days: 5 });
  });

  it('⑤d 真人 chairman 持 19 ⇒ 没有确认框，按 D-003 放弃转嫁（自己坐牢、卡留着）', () => {
    const r = applyNewsEffect(29, ctx({
      players: [
        makePlayer({ index: 0, whoPlays: 1, cards: [19], hostility: [0, 0, 9, 0] }), // 真人
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      commercials: [co(1, 1)],
      rng: { below: () => 0 },
    }));
    expect(r.players[2]!.blocking.inPrison).toBe(0); // 最恨的人没被嫁祸
    expect(r.players[0]!.blocking.inPrison).toBe(5);
    expect(r.players[0]!.cards).toEqual([19]);
  });

  it('★ 候选里出现的 owner 越界（>= 玩家数）⇒ 不动，也不崩', () => {
    const r = applyNewsEffect(29, ctx({
      commercials: [co(1, 9)],
      rng: { below: () => 0 },
    }));
    expect(r.amount).toBe(0);
    expect(r.chairmanPrison).toBeUndefined();
    expect(r.unimplemented).toBe(false);
  });
});
