/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 卡片统一入口 —— 前置校验与「生效才扣卡」
 */

import { describe, expect, it } from 'vitest';
import { makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { useCard, type UseCardContext } from './registry.ts';
import { HOUSING_TYPE_MIN } from '../rules/land.ts';

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
