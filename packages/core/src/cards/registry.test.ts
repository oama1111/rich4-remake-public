/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 卡片统一入口 —— 前置校验与「生效才扣卡」
 */

import { describe, expect, it } from 'vitest';
import { makeFacility, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { useCard, type UseCardContext } from './registry.ts';
import { HOUSING_TYPE_MIN, FACILITY_TYPE_MIN } from '../rules/land.ts';
import type { StockMarketState } from '../places/stock-market.ts';
import { applyPriceTick } from '../places/stock-market.ts';
import type { StockState } from '../places/stock.ts';
import { STOCK_COUNT } from '../rules/wealth.ts';
import { initialSpecialActors } from '../rules/special-actors.ts';

const makeStock = (over: Partial<StockState> = {}): StockState => ({
  price: 100, shares: 10_000, f10: 10_000, commercialIndex: 0, f6: 0,
  newsFlag: 0, basePrice: 100, openPrice: 100, volatility: 1, trend: 0, shock: 0,
  ...over,
});

const makeMarket = (over: Partial<StockMarketState> = {}): StockMarketState => ({
  stocks: Array.from({ length: STOCK_COUNT }, () => makeStock()),
  day: 0,
  history: [],
  index: 1000,
  ...over,
});

/** 三块地，id 与 housingIndexOf(节点 type) 对齐 */
function defaultLands() {
  return [
    makeLand({ id: 1, name: '台北市', owner: 0, level: 0, landPrice: 1000, housePrice: 300 }),
    makeLand({ id: 2, name: '台北市', owner: 2, level: 1, landPrice: 1200, housePrice: 400 }),
    makeLand({ id: 3, name: '高雄市', owner: 3, level: 2, landPrice: 1500, housePrice: 500 }),
  ];
}

function makeCtx(over: Partial<UseCardContext> = {}): UseCardContext {
  return {
    players: [
      makePlayer({ index: 0, cash: 10000, cards: [1, 15, 22, 30], nodeId: 1 }),
      makePlayer({ index: 1, cash: 2000 }),
      makePlayer({ index: 2, cash: 3000 }),
      makePlayer({ index: 3, cash: 4000 }),
    ],
    lands: defaultLands(),
    nodes: [makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1 })],
    currentPlayer: 0,
    priceIndex: 1,
    tools: new Array<number>(60).fill(0),
    toolStock: new Array<number>(14).fill(0),
    objects: [],
    market: makeMarket(),
    marketOpen: true,
    facilities: [],
    actors: initialSpecialActors(),
    ...over,
  };
}

describe('前置校验', () => {
  it('手上没有这张卡 → notInHand', () => {
    const r = useCard(makeCtx(), 2, { kind: 'player', index: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('notInHand');
  });

  it('★ 被动卡不能主动使用（原版函数体是 xor eax,eax; ret）', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [18] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 18).error).toBe('passiveCard');
  });

  it('未登记的卡号 → unknownCard', () => {
    expect(useCard(makeCtx(), 99).error).toBe('unknownCard');
  });

  it('需要目标却没给 → targetRequired', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [30] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 30).error).toBe('targetRequired');
  });

  it('不需要目标却给了 → targetNotAllowed', () => {
    expect(useCard(makeCtx(), 1, { kind: 'player', index: 1 }).error).toBe('targetNotAllowed');
  });

  it('目标越界 → playerOutOfRange', () => {
    expect(useCard(makeCtx(), 30, { kind: 'player', index: 9 }).error).toBe('playerOutOfRange');
  });
});

describe('★ 生效才扣卡', () => {
  it('成功使用后手牌少一张', () => {
    const ctx = makeCtx();
    const r = useCard(ctx, 1);
    expect(r.ok).toBe(true);
    expect(r.players[0]!.cards).toEqual([15, 22, 30]);
  });

  it('★ 送神符什么都没送走时不消耗卡片', () => {
    // godInfo / f64 都为 0 → 无可送之物
    const ctx = makeCtx();
    const r = useCard(ctx, 22);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    // 失败时返回的是**原样**的玩家数组，手牌未动
    expect(r.players[0]!.cards).toEqual([1, 15, 22, 30]);
  });

  it('校验失败时状态完全不变', () => {
    const ctx = makeCtx();
    const r = useCard(ctx, 30, { kind: 'player', index: 9 });
    expect(r.players).toEqual(ctx.players);
    expect(r.lands).toEqual(ctx.lands);
  });
});

describe('分发到各卡的效果', () => {
  it('均富卡：全员现金拉平', () => {
    const r = useCard(makeCtx(), 1);
    // (10000 + 2000 + 3000 + 4000) / 4 = 4750
    expect(r.players.map((p) => p.cash)).toEqual([4750, 4750, 4750, 4750]);
    expect(r.hostilityDeltas.length).toBeGreaterThan(0);
  });

  it('冬眠卡：其他在场玩家睡 5 天，自己不睡', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [15], xpos: 10 }),
        makePlayer({ index: 1, xpos: 10 }),
        makePlayer({ index: 2, xpos: 10 }),
        makePlayer({ index: 3, xpos: 10 }),
      ],
    });
    const r = useCard(ctx, 15);
    expect(r.ok).toBe(true);
    expect(r.players.map((p) => p.blocking.sleeping)).toEqual([0, 5, 5, 5]);
  });

  it('乌龟卡：目标进入乌龟状态', () => {
    const r = useCard(makeCtx(), 30, { kind: 'player', index: 2 });
    expect(r.ok).toBe(true);
    expect(r.players[2]!.blocking.tortoiseWalking).toBeGreaterThan(0);
  });
});

describe('地块类卡片', () => {
  it('天使卡给目标地块加一级', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [9] }), makePlayer({ index: 1 })],
    });
    const r = useCard(ctx, 9, { kind: 'entity', entityId: 2 });
    expect(r.ok).toBe(true);
    expect(r.lands.find((l) => l.id === 2)!.level).toBe(2);
  });

  it('★ 涨价卡按**地块名**批量标记同名地块群', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [27] }), makePlayer({ index: 1 })],
    });
    const r = useCard(ctx, 27, { kind: 'entity', entityId: 1 });
    expect(r.ok).toBe(true);
    const status = r.lands.map((l) => l.priceStatus);
    // 台北市两块一起被标记，高雄市不受影响
    expect(status[0]).toBe(status[1]);
    expect(status[2]).not.toBe(status[0]);
  });

  it('目标地块不存在 → landNotFound', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [9] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 9, { kind: 'entity', entityId: 99999 }).error).toBe('landNotFound');
  });

  it('地块卡给了玩家目标 → wrongTargetKind', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [9] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 9, { kind: 'player', index: 1 }).error).toBe('wrongTargetKind');
  });

  it('★ 购地卡：钱从买家现金出，进卖家存款，地块易主', () => {
    const land = makeLand({ id: 1, owner: 2, level: 0, landPrice: 1000, housePrice: 300 });
    const ctx = makeCtx({
      lands: [land],
      nodes: [makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1 })],
      players: [
        makePlayer({ index: 0, cash: 10000, cards: [3], nodeId: 1 }),
        makePlayer({ index: 1, cash: 500, moneyInBank: 0 }),
      ],
    });
    const r = useCard(ctx, 3);
    expect(r.ok).toBe(true);
    expect(r.players[0]!.cash).toBe(9000);
    expect(r.players[1]!.moneyInBank).toBe(1000); // 进存款，不是现金
    expect(r.players[1]!.cash).toBe(500);
    expect(r.lands[0]!.owner).toBe(1); // owner = currentPlayer + 1
  });

  it('购地卡买自己的地 → 不生效、不扣卡', () => {
    const land = makeLand({ id: 1, owner: 1, level: 0, landPrice: 1000 });
    const ctx = makeCtx({
      lands: [land],
      players: [
        makePlayer({ index: 0, cash: 10000, cards: [3], nodeId: 1 }),
        makePlayer({ index: 1 }),
      ],
    });
    const r = useCard(ctx, 3);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([3]);
  });
});

describe('敌意真正落到状态上', () => {
  it('★ 均富卡只让**被拉低**的玩家对出牌者产生敌意', () => {
    // 出牌者是穷人，玩家 2 最富
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cash: 1000, cards: [1] }),
        makePlayer({ index: 1, cash: 1000 }),
        makePlayer({ index: 2, cash: 21000 }),
        makePlayer({ index: 3, cash: 1000 }),
      ],
    });
    const r = useCard(ctx, 1);
    expect(r.players.map((p) => p.cash)).toEqual([6000, 6000, 6000, 6000]);
    // 玩家 2 损失 15000 → 敌意 +150，对象是出牌者 0
    expect(r.players[2]!.hostility[0]).toBe(150);
    // 拿到钱的人不记敌意
    expect(r.players[1]!.hostility).toEqual([0, 0, 0, 0]);
  });

  it('★ 出牌者自己被拉低时不对自己记敌意（a === b 直接返回）', () => {
    const r = useCard(makeCtx(), 1); // 玩家 0 最富且是出牌者
    expect(r.players[0]!.hostility).toEqual([0, 0, 0, 0]);
  });

  it('★ 冬眠卡对盟友产生敌意会当场解除同盟', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [15], xpos: 10 }),
        makePlayer({ index: 1, xpos: 10, alliedPlayer: 1, alliedDays: 7 }),
        makePlayer({ index: 2, xpos: 10 }),
        makePlayer({ index: 3, xpos: 10 }),
      ],
      priceIndex: 2,
    });
    // 玩家 1 与玩家 0 结盟（alliedPlayer = 0 + 1）
    const r = useCard(ctx, 15);
    expect(r.ok).toBe(true);
    expect(r.players[1]!.hostility[0]).toBe(2 * 150);
    expect(r.players[1]!.alliedPlayer).toBe(0);
  });
});

describe('★ 陷害卡经统一入口', () => {
  const withCard = () =>
    makeCtx({
      players: [
        makePlayer({ index: 0, cards: [17] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      priceIndex: 2,
    });

  it('目标入狱，敌意落到状态上，卡片被消耗', () => {
    const r = useCard(withCard(), 17, { kind: 'player', index: 2 });
    expect(r.ok).toBe(true);
    expect(r.players[2]!.blocking.inPrison).toBe(5);
    expect(r.players[2]!.hostility[0]).toBe(2 * 150);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('★ 不能指向自己（0xe0c0710 属 player 类，不含自己）', () => {
    const r = useCard(withCard(), 17, { kind: 'player', index: 0 });
    expect(r.error).toBe('cannotTargetSelf');
  });

  it('目标持免罪卡时记为被防下', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [17] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2, cards: [21] }),
        makePlayer({ index: 3 }),
      ],
    });
    const r = useCard(ctx, 17, { kind: 'player', index: 2 });
    expect(r.ok).toBe(true);
    expect(r.defended).toBe(true);
    expect(r.players[2]!.blocking.inPrison).toBe(0);
  });
});


describe('★ 夢遊卡经统一入口（T-002）', () => {
  const withCard = () =>
    makeCtx({
      players: [
        makePlayer({ index: 0, cards: [16] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
    });

  it('能出：目标梦游 5 天、骰子变 1 颗、交通工具退还成道具，卡片被消耗', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [16] }),
        makePlayer({ index: 1, trafficMethod: 1, ndices: 2 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
    });
    const r = useCard(ctx, 16, { kind: 'player', index: 1 });
    expect(r.ok).toBe(true);
    // @source VA 0x0044435e：对别人 5 天
    expect(r.players[1]!.blocking.sleepWalking).toBe(5);
    expect(r.players[1]!.trafficMethod).toBe(0);
    expect(r.players[1]!.ndices).toBe(1);
    // @source VA 0x0044439b：機車（traffic 1）退还成道具 5
    expect(r.tools[1 * 15 + 5]).toBe(1);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('★ 不能指向自己（0xe0c0710 属 player 类，不含自己）', () => {
    const r = useCard(withCard(), 16, { kind: 'player', index: 0 });
    expect(r.error).toBe('cannotTargetSelf');
    expect(r.players[0]!.cards).toEqual([16]);
  });

  it('目标出局 → 不能出（原版选择列表里没有出局者），不扣卡', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [16] }),
        makePlayer({ index: 1, whoPlays: 0 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
    });
    const r = useCard(ctx, 16, { kind: 'player', index: 1 });
    expect(r.ok).toBe(false);
    expect(r.players[0]!.cards).toEqual([16]);
    expect(r.players[1]!.blocking.sleepWalking).toBe(0);
  });

  it('目标持復仇卡 → 效果反弹给出牌者（自己 4 天）', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [16] }),
        makePlayer({ index: 1, cards: [18] }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
    });
    const r = useCard(ctx, 16, { kind: 'player', index: 1 });
    expect(r.ok).toBe(true);
    // @source VA 0x0044435e：对自己 4 天
    expect(r.players[0]!.blocking.sleepWalking).toBe(4);
    expect(r.players[1]!.blocking.sleepWalking).toBe(0);
  });
});


describe('★ 搶奪卡经统一入口（T-003）', () => {
  it('抢卡路径：对方手牌 −1、自己 +1，敌意 = 被抢卡的价格，卡片被消耗', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [13] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2, cards: [9, 12] }),
        makePlayer({ index: 3 }),
      ],
    });
    const r = useCard(ctx, 13, { kind: 'player', index: 2, steal: { kind: 'card', id: 9 } });
    expect(r.ok).toBe(true);
    expect(r.players[2]!.cards).toEqual([12]);
    expect(r.players[0]!.cards).toEqual([9]); // 搶奪卡被消耗，天使卡入手
    // @source 0x443f1a：敌意增量 = 卡片表 +5（天使卡 price 160）
    expect(r.players[2]!.hostility[0]).toBe(160);
  });

  it('抢道具路径：道具经 take_tool/give_tool 转移，敌意读同一张表（原版如此）', () => {
    const tools = new Array<number>(60).fill(0);
    tools[2 * 15 + 7] = 1; // 玩家 2 有道具 7
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [13] }), makePlayer({ index: 1 }), makePlayer({ index: 2 }), makePlayer({ index: 3 })],
      tools,
    });
    const r = useCard(ctx, 13, { kind: 'player', index: 2, steal: { kind: 'tool', id: 7 } });
    expect(r.ok).toBe(true);
    expect(r.tools[2 * 15 + 7]).toBe(0);
    expect(r.tools[0 * 15 + 7]).toBe(1);
    // @source 0x443f1a：道具路径也按卡片表 +5 记敌意（卡片 7 改建卡 price 15）
    expect(r.players[2]!.hostility[0]).toBe(15);
  });

  it('没给 steal → targetRequired，不扣卡', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [13] }), makePlayer({ index: 1 }), makePlayer({ index: 2 }), makePlayer({ index: 3 })],
    });
    const r = useCard(ctx, 13, { kind: 'player', index: 2 });
    expect(r.error).toBe('targetRequired');
    expect(r.players[0]!.cards).toEqual([13]);
  });

  it('对方没有那张卡 → nothingToRob，不扣卡', () => {
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [13] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2, cards: [5] }),
        makePlayer({ index: 3 }),
      ],
    });
    const r = useCard(ctx, 13, { kind: 'player', index: 2, steal: { kind: 'card', id: 9 } });
    expect(r.ok).toBe(false);
    expect(r.players[0]!.cards).toEqual([13]);
    expect(r.players[2]!.cards).toEqual([5]);
  });
});


describe('★ 請神符经统一入口（T-004）', () => {
  const god = (over: Partial<{ type: number; nodeId: number; attached: number; state: number }> = {}) => ({
    type: over.type ?? 2, // 大財神
    nodeId: over.nodeId ?? 10,
    state: over.state ?? 0,
    attached: over.attached ?? 0,
  });
  const withCard = (objects: ReturnType<typeof god>[]) =>
    makeCtx({
      players: [
        makePlayer({ index: 0, cards: [23], nodeId: 7 }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      objects,
    });

  it('请到：godInfo = 物件 handle、物件跟到身上、三项修正加上，卡片被消耗', () => {
    const r = useCard(withCard([god()]), 23, { kind: 'object', objectIndex: 1 });
    expect(r.ok).toBe(true);
    // @source 0x40eb55：god_info == 入参 handle（下标 + 1）
    expect(r.players[0]!.godInfo).toBe(1);
    expect(r.objects[0]!.attached).toBe(1); // 玩家下标 + 1
    expect(r.objects[0]!.nodeId).toBe(7);   // 跟到玩家所在节点
    expect(r.objects[0]!.state).toBe(7);    // 非死神写 7
    // @source 0x0040ebcc 起：大財神(2) → misfortune −200 / fortune +150
    expect(r.players[0]!.misfortune).toBe(-200);
    expect(r.players[0]!.fortune).toBe(150);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('请不到：物件已被别人附身 → noEffect，不扣卡', () => {
    const ctx = withCard([god({ attached: 2 })]);
    const r = useCard(ctx, 23, { kind: 'object', objectIndex: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([23]);
  });

  it('请不到：物件不在地图上 → noEffect，不扣卡', () => {
    const ctx = withCard([god({ nodeId: 0 })]);
    const r = useCard(ctx, 23, { kind: 'object', objectIndex: 1 });
    expect(r.ok).toBe(false);
    expect(r.players[0]!.cards).toEqual([23]);
  });

  it('物件下标越界 → objectOutOfRange', () => {
    const r = useCard(withCard([god()]), 23, { kind: 'object', objectIndex: 2 });
    expect(r.error).toBe('objectOutOfRange');
  });

  it('★ 身上已有神时旧神先被送走（退修正、清附身），搭档列入 respawns', () => {
    // 身上已有小財神（handle 2 → objects[1]，type 1，已附身于我）
    const ctx = makeCtx({
      players: [
        makePlayer({ index: 0, cards: [23], nodeId: 7, godInfo: 2, misfortune: -100, fortune: 100 }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      objects: [
        god({ type: 2 }),                              // 要请的大財神
        god({ type: 1, attached: 1, state: 7 }),       // 身上的小財神
      ],
    });
    const r = useCard(ctx, 23, { kind: 'object', objectIndex: 1 });
    expect(r.ok).toBe(true);
    expect(r.players[0]!.godInfo).toBe(1);
    // 旧神被释放：清附身、退掉小財神的修正（misfortune −(−100)、fortune −100）
    expect(r.objects[1]!.attached).toBe(0);
    expect(r.objects[1]!.nodeId).toBe(0);
    // −100 +100（退小財神）−200（大財神）= −200；100 −100（退）+150（新）= 150
    expect(r.players[0]!.misfortune).toBe(-200);
    expect(r.players[0]!.fortune).toBe(150);
    // 旧神下标 1 < 12 → 搭档（下标 0）要重新登场，nearNode = 旧神记录的节点
    expect(r.respawns).toEqual([{ partner: 0, nearNode: 10 }]);
  });
});

describe('★ 紅卡/黑卡经统一入口（T-005）', () => {
  const ctxWithCard = (cardId: number, over: Partial<UseCardContext> = {}) =>
    makeCtx({
      players: [makePlayer({ index: 0, cards: [cardId] }), makePlayer({ index: 1 })],
      ...over,
    });

  it('紅卡(24)把目标股 newsFlag 置为 0x20（利多 2 天）并扣卡', () => {
    const r = useCard(ctxWithCard(24), 24, { kind: 'stock', index: 3 });
    expect(r.ok).toBe(true);
    expect(r.market.stocks[3]!.newsFlag).toBe(0x20);
    expect(r.players[0]!.cards).toEqual([]);
    // 其余股票不动
    expect(r.market.stocks.filter((s) => s.newsFlag !== 0).length).toBe(1);
  });

  it('黑卡(25)把目标股 newsFlag 置为 0x02（利空 2 天）并扣卡', () => {
    const r = useCard(ctxWithCard(25), 25, { kind: 'stock', index: 5 });
    expect(r.ok).toBe(true);
    expect(r.market.stocks[5]!.newsFlag).toBe(0x02);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('★ 打完牌**当场**就把当日价按 ±10% 算出来（原版紧跟一句 `call 0x429040`）', () => {
    // @source 真人那一支在股市屏里（`loc_0042b137` 之后 `call 0x429040(row)`）、
    //   AI 那一支在卡函数里（写完 0x00444f88 / 0x004450f6 紧接着
    //   `call 0x429040`，@source 0x00444f91 / 0x004450ff）；
    //   `0x429040` = core 的 `applyStockNews`（也是 `fcn_00428ec5` 的 ±10%）。
    const red = useCard(ctxWithCard(24), 24, { kind: 'stock', index: 3 });
    expect(red.market.stocks[3]!.price).toBe(applyPriceTick(100, 10));
    expect(red.market.stocks[3]!.price).toBeGreaterThan(100);
    expect(red.market.stocks[3]!.trend).toBe(10);

    const black = useCard(ctxWithCard(25), 25, { kind: 'stock', index: 5 });
    expect(black.market.stocks[5]!.price).toBe(applyPriceTick(100, -10));
    expect(black.market.stocks[5]!.price).toBeLessThan(100);
    expect(black.market.stocks[5]!.trend).toBe(-10);

    // 其余股票仍旧纹丝不动
    expect(red.market.stocks[4]!.price).toBe(100);
  });

  it('休市日 fail(marketClosed) 且不扣卡（引擎护栏，原版走股市屏 UI 天然避开）', () => {
    const ctx = ctxWithCard(24, { marketOpen: false });
    const r = useCard(ctx, 24, { kind: 'stock', index: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('marketClosed');
    expect(r.players[0]!.cards).toEqual([24]);
  });

  it('停牌中（f6 ≠ 0）fail(noEffect) 且不扣卡', () => {
    const market = makeMarket();
    market.stocks[3] = makeStock({ f6: 2 });
    const ctx = ctxWithCard(25, { market });
    const r = useCard(ctx, 25, { kind: 'stock', index: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([25]);
  });

  it('股票下标越界 → stockOutOfRange', () => {
    expect(useCard(ctxWithCard(24), 24, { kind: 'stock', index: 99 }).error).toBe('stockOutOfRange');
  });
});

describe('★ 怪獸卡经统一入口（T-006）', () => {
  const ctxWithMonster = (over: Partial<UseCardContext> = {}) =>
    makeCtx({
      players: [
        makePlayer({ index: 0, cards: [11] }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
      ],
      ...over,
    });

  it('地块目标：夷平等级、保留归属、记敌意并扣卡', () => {
    const ctx = ctxWithMonster({
      lands: [makeLand({ id: 1, owner: 3, level: 4 })],
    });
    const r = useCard(ctx, 11, { kind: 'entity', entityId: 1 });
    expect(r.ok).toBe(true);
    expect(r.lands[0]!.level).toBe(0);
    expect(r.lands[0]!.owner).toBe(3);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 4 * 30 * 1 }]);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('設施目标：等级与种类归零、归属保留、敌意同式', () => {
    const ctx = ctxWithMonster({
      facilities: [makeFacility({ id: 1, owner: 3, level: 2, type: 1 })],
    });
    const r = useCard(ctx, 11, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ level: 0, type: 0, owner: 3 });
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 2 * 30 * 1 }]);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('0 级設施 → fail(noEffect) 且不扣卡', () => {
    const ctx = ctxWithMonster({
      facilities: [makeFacility({ id: 1, owner: 3, level: 0 })],
    });
    const r = useCard(ctx, 11, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([11]);
  });

  it('設施下标越界 → facilityOutOfRange', () => {
    const ctx = ctxWithMonster({
      facilities: [makeFacility({ id: 1, level: 2 })],
    });
    expect(useCard(ctx, 11, { kind: 'facility', facilityId: 9 }).error).toBe('facilityOutOfRange');
  });

  it('空地目标 → fail(noEffect)', () => {
    const ctx = ctxWithMonster({ lands: [makeLand({ id: 1, owner: 2, level: 0 })] });
    expect(useCard(ctx, 11, { kind: 'entity', entityId: 1 }).error).toBe('noEffect');
  });
});

describe('★ 拍賣卡经统一入口（T-007，VA 0x00443225）', () => {
  const ctxOnLand = (landOver: Parameters<typeof makeLand>[0], over: Partial<UseCardContext> = {}) =>
    makeCtx({
      players: [
        makePlayer({ index: 0, cards: [8], nodeId: 1 }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
      ],
      nodes: [makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1 })],
      lands: [makeLand({ id: 1, landPrice: 2000, ...landOver })],
      ...over,
    });

  it('站在别人的地 → followUp 挂拍賣 pending，底价/竞价者按原版', () => {
    const r = useCard(ctxOnLand({ owner: 3, level: 2 }), 8);
    expect(r.ok).toBe(true);
    expect(r.followUp).toEqual({
      kind: 'auction',
      entityId: 1,
      // round(2000 × (1 + 2×0.5)) × 1 = 4000
      basePrice: 4000,
      bidders: [0, 1], // 排除地主(玩家2)
    });
    // 敌意是 double 压栈的原版 bug：常规地价恒为 0
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 0 }]);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('★ 自己的地也照拍（原版不挑主，0x00443282 只拦无主记敌意）', () => {
    const r = useCard(ctxOnLand({ owner: 1, level: 0 }), 8);
    expect(r.ok).toBe(true);
    expect(r.followUp).toMatchObject({ kind: 'auction', bidders: [1, 2] }); // 排除自己（地主）
  });

  it('无主地：照拍、不记敌意', () => {
    const r = useCard(ctxOnLand({ owner: 0, level: 0 }), 8);
    expect(r.ok).toBe(true);
    expect(r.hostilityDeltas).toEqual([]);
  });

  it('站在設施格 → 設施拍賣（facility: true）', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [8], nodeId: 1 }), makePlayer({ index: 1 })],
      nodes: [makeNode({ id: 1, type: FACILITY_TYPE_MIN + 1 })],
      lands: [],
      facilities: [makeFacility({ id: 1, owner: 2, level: 1, landPrice: 4000 })],
    });
    const r = useCard(ctx, 8);
    expect(r.ok).toBe(true);
    expect(r.followUp).toEqual({
      kind: 'auction',
      entityId: 1,
      basePrice: 6000, // round(4000 × 1.5) × 1
      bidders: [0],
      facility: true,
    });
  });

  it('脚下不是地块/設施 → fail(notStandingOnLand) 不扣卡', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [8], nodeId: 1 })],
      nodes: [makeNode({ id: 1, type: 0 })],
      lands: [],
    });
    const r = useCard(ctx, 8);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('notStandingOnLand');
    expect(r.players[0]!.cards).toEqual([8]);
  });
});

describe('★ T-008：五张地块卡对設施目标', () => {
  const facCtx = (cardId: number, fac: ReturnType<typeof makeFacility>) =>
    makeCtx({
      players: [makePlayer({ index: 0, cards: [cardId] }), makePlayer({ index: 1 })],
      facilities: [fac],
    });

  it('天使卡：0 级空地按 buildType 首建', () => {
    const ctx = facCtx(9, makeFacility({ id: 1, type: 0, level: 0 }));
    const r = useCard(ctx, 9, { kind: 'facility', facilityId: 1, buildType: 2 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ type: 2, level: 1 });
    expect(r.players[0]!.cards).toEqual([]); // 生效扣卡
  });

  it('天使卡：满级設施不动也不扣卡', () => {
    const ctx = facCtx(9, makeFacility({ id: 1, type: 0, level: 1 })); // 公園 max=1
    const r = useCard(ctx, 9, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([9]);
  });

  it('惡魔卡：夷平設施并按等级记敌意', () => {
    const ctx = facCtx(10, makeFacility({ id: 1, type: 1, level: 3, owner: 2 }));
    const r = useCard(ctx, 10, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ type: 0, level: 0, owner: 2 });
    expect(r.hostilityDeltas).toEqual([{ from: 1, to: 0, delta: 90 }]); // 3×30×pi1
  });

  it('惡魔卡对地块：同區批量夷平、每块有主地各记一笔敌意', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [10] }), makePlayer({ index: 1 })],
      priceIndex: 1,
    });
    // defaultLands：id1 台北市无主 lv0、id2 台北市主2 lv1、id3 高雄市主3 lv2
    const r = useCard(ctx, 10, { kind: 'entity', entityId: 2 });
    expect(r.ok).toBe(true);
    expect(r.lands.find((l) => l.id === 1)!.level).toBe(0);
    expect(r.lands.find((l) => l.id === 2)!.level).toBe(0);
    expect(r.lands.find((l) => l.id === 3)!.level).toBe(2); // 不同区不动
    expect(r.hostilityDeltas).toEqual([{ from: 1, to: 0, delta: 30 }]); // 仅 id2 有主
  });

  it('拆除卡：設施掉一级，敌意平坦 30×物价指数', () => {
    const ctx = facCtx(12, makeFacility({ id: 1, type: 1, level: 2, owner: 2 }));
    const r = useCard(ctx, 12, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ type: 1, level: 1 });
    expect(r.hostilityDeltas).toEqual([{ from: 1, to: 0, delta: 30 }]);
  });

  it('拆除卡：設施拆到 0 级退回公園', () => {
    const ctx = facCtx(12, makeFacility({ id: 1, type: 1, level: 1, owner: 0 }));
    const r = useCard(ctx, 12, { kind: 'facility', facilityId: 1 });
    expect(r.facilities[0]).toMatchObject({ type: 0, level: 0 });
    expect(r.hostilityDeltas).toEqual([]); // 无主不记
  });

  it('漲價卡：設施单个标记 0x50', () => {
    const ctx = facCtx(27, makeFacility({ id: 1, type: 1, level: 2 }));
    const r = useCard(ctx, 27, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]!.priceStatus).toBe(0x50);
    expect(r.researchReset).toEqual([]);
  });

  it('★ 查封卡：封到研究所才清研发天数（+0x1e）', () => {
    const lab = facCtx(28, makeFacility({ id: 1, type: 4, level: 2 }));
    const r1 = useCard(lab, 28, { kind: 'facility', facilityId: 1 });
    expect(r1.facilities[0]!.priceStatus).toBe(0x51);
    expect(r1.researchReset).toEqual([1]);
    // 非研究所：只标记，不清研发
    const hotel = facCtx(28, makeFacility({ id: 1, type: 1, level: 2 }));
    const r2 = useCard(hotel, 28, { kind: 'facility', facilityId: 1 });
    expect(r2.facilities[0]!.priceStatus).toBe(0x51);
    expect(r2.researchReset).toEqual([]);
  });

  it('設施 id 越界 → facilityOutOfRange', () => {
    const ctx = facCtx(9, makeFacility({ id: 1, type: 0, level: 0 }));
    expect(useCard(ctx, 9, { kind: 'facility', facilityId: 9 }).error).toBe('facilityOutOfRange');
  });
});

describe('★ T-010：停留/轉向/烏龜卡对特殊棋子（actor 4..8）', () => {
  // 一个已出场在棋盘上的替身 + 牌在手的玩家
  const actorCtx = (cardId: number, slot: number, over: Partial<UseCardContext> = {}) => {
    const actors = initialSpecialActors().map((a, i) =>
      i === slot ? { ...a, place: 0 as const, nodeId: 12, lastNodeId: 11, direction: 3 } : a,
    );
    return makeCtx({
      players: [makePlayer({ index: 0, cards: [cardId] }), makePlayer({ index: 1 })],
      actors,
      ...over,
    });
  };

  for (const actor of [4, 5, 6, 7, 8]) {
    it(`停留卡(14)：actor ${actor} 的 halted 写成 1（= 停 2 天，与别人同款）`, () => {
      const ctx = actorCtx(14, actor - 4);
      const r = useCard(ctx, 14, { kind: 'actor', actor });
      expect(r.ok).toBe(true);
      expect(r.actors[actor - 4]!.halted).toBe(1);
      expect(r.players[0]!.cards).toEqual([]); // 生效扣卡
      // 玩家数组没被动
      expect(r.players.map((p) => p.blocking.stopping)).toEqual([0, 0]);
    });

    it(`轉向卡(6)：actor ${actor} 的 direction 掉头（3 → 7）`, () => {
      const ctx = actorCtx(6, actor - 4);
      const r = useCard(ctx, 6, { kind: 'actor', actor });
      expect(r.ok).toBe(true);
      expect(r.actors[actor - 4]!.direction).toBe(7);
      expect(r.players.map((p) => p.direction)).toEqual([0, 0]);
    });

    it(`烏龜卡(30)：actor ${actor} 的 singleStep 写成 3`, () => {
      const ctx = actorCtx(30, actor - 4);
      const r = useCard(ctx, 30, { kind: 'actor', actor });
      expect(r.ok).toBe(true);
      expect(r.actors[actor - 4]!.singleStep).toBe(3);
    });
  }

  it('不在棋盘上的 NPC（place ≠ board）→ noEffect 且不扣卡', () => {
    // 初始状态：小偷(actor 4)在監獄
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [14] }), makePlayer({ index: 1 })],
    });
    const r = useCard(ctx, 14, { kind: 'actor', actor: 4 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([14]);
  });

  it('未出场的機器娃娃（actor 8 offBoard）→ noEffect', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [30] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 30, { kind: 'actor', actor: 8 }).error).toBe('noEffect');
  });

  it('actor 越界（9）→ actorOutOfRange', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [14] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 14, { kind: 'actor', actor: 9 }).error).toBe('actorOutOfRange');
  });

  it('其他卡不接受 actor 目标（均富卡）→ targetNotAllowed', () => {
    expect(useCard(makeCtx(), 1, { kind: 'actor', actor: 4 }).error).toBe('targetNotAllowed');
  });

  it('★ 机器娃娃在场时转向卡也生效（0x40c78c 不看种类，只看 ≥4）', () => {
    const ctx = actorCtx(6, 8 - 4);
    const r = useCard(ctx, 6, { kind: 'actor', actor: 8 });
    expect(r.ok).toBe(true);
    expect(r.actors[4]!.direction).toBe(7);
  });
});
