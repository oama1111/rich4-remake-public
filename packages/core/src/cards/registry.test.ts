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
