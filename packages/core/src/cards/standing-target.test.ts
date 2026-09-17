/*
 * 目标类别**跟脚下走** —— 换地(4)/换屋(5) 的設施分支 + 拆除(12) 的物件分支
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 缺口（Q-CARD-1）：`targetClassOf` 原先把 0xe0c0202 写死成 'land'，
 *   于是站在設施上的换地/换屋在 core 里根本收不了設施目标；
 *   拆除卡也只给 landOrFacility，收不了路障/地雷/定時炸彈。
 *
 * 本文件按 exe 逐条钉住三条：
 *   换地卡 VA 0x00442685(地块) / 0x004428cc(設施) → 效果 0x00442a09
 *   换屋卡 同形                                      → 效果 0x40b4f8 設施分支
 *   拆除卡 VA 0x00443d22(物件分支) → `_rich4_remove_object` 0x40e14d
 */

import { describe, expect, it } from 'vitest';
import { makeFacility, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { useCard, standingInstanceKind, type UseCardContext } from './registry.ts';
import { targetClassOf, targetClassOfCard } from './target.ts';
import { FACILITY_TYPE_MIN, HOUSING_TYPE_MIN } from '../rules/land.ts';
import { makeObjects, type MapObject } from './summon.ts';
import { OBJECT_COUNT } from '../rules/objects.ts';
import { OBJECT_TYPE_BOMB, OBJECT_TYPE_MINE, OBJECT_TYPE_ROADBLOCK } from '../rules/object-landing.ts';
import { cardImpl } from '@rich4/data';

/** 站位：脚下节点 type 决定「脚下是什么」（housingIndexOf / facilityIndexOf 同一判据） */
function makeCtx(over: Partial<UseCardContext> = {}): UseCardContext {
  return {
    players: [
      makePlayer({ index: 0, cash: 10000, cards: [4, 5, 12], nodeId: 1 }),
      makePlayer({ index: 1, cash: 2000, nodeId: 2 }),
      makePlayer({ index: 2, cash: 3000, nodeId: 3 }),
    ],
    lands: [makeLand({ id: 1, name: '台北市', owner: 3, level: 1 })],
    nodes: [makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1 })],
    currentPlayer: 0,
    priceIndex: 1,
    tools: new Array<number>(60).fill(0),
    toolStock: new Array<number>(14).fill(0),
    objects: [],
    market: { stocks: [], day: 0, history: [], index: 1000, closedDays: 0 },
    marketOpen: true,
    facilities: [],
    actors: [],
    ...over,
  };
}

/** 站在設施 1 上（节点 type = 4000 + 1） */
function onFacility(over: Partial<UseCardContext> = {}): UseCardContext {
  return makeCtx({
    nodes: [makeNode({ id: 1, type: FACILITY_TYPE_MIN + 1 })],
    facilities: [
      makeFacility({ id: 1, name: '我的旅館', owner: 1, level: 2, type: 1 }),
      makeFacility({ id: 2, name: '别人的購物中心', owner: 3, level: 4, type: 2 }),
    ],
    ...over,
  });
}

describe('★ 脚下那一格决定换地/换屋的目标类别', () => {
  it('站在地块上 → land；站在設施上 → facility', () => {
    expect(standingInstanceKind(makeCtx(), 0)).toBe('land');
    expect(standingInstanceKind(onFacility(), 0)).toBe('facility');
    // 路面（type 0）两边都不是
    expect(standingInstanceKind(makeCtx({ nodes: [makeNode({ id: 1, type: 0 })] }), 0)).toBeNull();
  });

  it('卡片级类别随之改变（0xe0c0202 → 0xe0c0204 那一跳）', () => {
    const c4 = cardImpl(4)!;
    const c5 = cardImpl(5)!;
    expect(targetClassOfCard(c4, standingInstanceKind(makeCtx(), 0))).toBe('land');
    expect(targetClassOfCard(c4, standingInstanceKind(onFacility(), 0))).toBe('facility');
    expect(targetClassOfCard(c5, 'facility')).toBe('facility');
    // 0xe0c0204 本身就是「只认設施」那一档
    expect(targetClassOf(0xe0c0204)).toBe('facility');
  });
});

describe('★ 换地卡(4) 站在設施上 —— 能选 / 不能选 / 效果', () => {
  it('能选：选中另一座設施 → 交换归属、扣卡', () => {
    // @source 换地卡設施分支 VA 0x00442a09 只写 +0x19
    const r = useCard(onFacility(), 4, { kind: 'facility', facilityId: 2 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ id: 1, owner: 3, level: 2, type: 1 });
    expect(r.facilities[1]).toMatchObject({ id: 2, owner: 1, level: 4, type: 2 });
    expect(r.players[0]!.cards).toEqual([5, 12]); // 扣掉换地卡
    expect(r.hostilityDeltas).toEqual([]); // 换地不记敌意
  });

  it('不能选：站在設施上时地块目标不收（wrongTargetKind）且不扣卡', () => {
    const r = useCard(onFacility(), 4, { kind: 'entity', entityId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrongTargetKind');
    expect(r.players[0]!.cards).toEqual([4, 5, 12]);
  });

  it('不能选：选中自己脚下那一座 → noEffect 且不扣卡（拾取组 2 就把它挡了）', () => {
    const r = useCard(onFacility(), 4, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([4, 5, 12]);
  });

  it('站在地块上仍只收地块，且不收設施', () => {
    const r = useCard(makeCtx(), 4, { kind: 'entity', entityId: 1 });
    // 脚下地块 1 与目标地块 1 是同一块 → 不生效
    expect(r.error).toBe('noEffect');
    const ctx = makeCtx({
      lands: [
        makeLand({ id: 1, owner: 1, level: 1, name: 'A' }),
        makeLand({ id: 2, owner: 3, level: 4, name: 'B' }),
      ],
    });
    expect(useCard(ctx, 4, { kind: 'entity', entityId: 2 }).ok).toBe(true);
    expect(useCard(ctx, 4, { kind: 'facility', facilityId: 2 }).error).toBe('wrongTargetKind');
  });

  it('脚下既不是地块也不是設施 → notStandingOnLand，不扣卡', () => {
    const ctx = onFacility({ nodes: [makeNode({ id: 1, type: 0 })] });
    const r = useCard(ctx, 4, { kind: 'facility', facilityId: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('notStandingOnLand');
    expect(r.players[0]!.cards).toEqual([4, 5, 12]);
    expect(useCard(ctx, 5, { kind: 'facility', facilityId: 2 }).error).toBe('notStandingOnLand');
  });
});

describe('★ 换屋卡(5) 站在設施上 —— 换种类+等级，归属不动', () => {
  it('能选：选中另一座設施 → +0x18 与 +0x1a 互换、扣卡', () => {
    // @source 助手 0x40b4f8 設施分支 VA 0x0040b880
    const r = useCard(onFacility(), 5, { kind: 'facility', facilityId: 2 });
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ id: 1, owner: 1, level: 4, type: 2 });
    expect(r.facilities[1]).toMatchObject({ id: 2, owner: 3, level: 2, type: 1 });
    expect(r.players[0]!.cards).toEqual([4, 12]);
  });

  it('不能选：站在設施上时地块目标不收且不扣卡', () => {
    const r = useCard(onFacility(), 5, { kind: 'entity', entityId: 1 });
    expect(r.error).toBe('wrongTargetKind');
    expect(r.players[0]!.cards).toEqual([4, 5, 12]);
  });
});

describe('★ 拆除卡(12) 的物件分支 —— 能选 / 不能选 / 效果', () => {
  /** 物件表：slot 16 = handle 17（路障 16）、slot 26 = handle 27（地雷 17）、slot 36 = handle 37（炸彈 18） */
  function withObjects(place: readonly number[]): MapObject[] {
    const objs = makeObjects(OBJECT_COUNT);
    for (const handle of place) {
      const o = objs[handle - 1]!;
      objs[handle - 1] = { ...o, nodeId: 1 };
    }
    return objs;
  }

  it('物件表铺开与种类对齐（前置自检）', () => {
    const objs = makeObjects(OBJECT_COUNT);
    expect(objs[16]!.type).toBe(OBJECT_TYPE_ROADBLOCK);
    expect(objs[26]!.type).toBe(OBJECT_TYPE_MINE);
    expect(objs[36]!.type).toBe(OBJECT_TYPE_BOMB);
  });

  it('类别：0xe0c0626 → landFacilityOrObject', () => {
    expect(targetClassOfCard(cardImpl(12)!)).toBe('landFacilityOrObject');
  });

  it('能选 + 效果：路障被收回、道具 2 库存 +1、物件离图、扣卡、无敌意', () => {
    // @source VA 0x00443d22 → `_rich4_remove_object` 0x40e17f `inc [0x497321]`
    const ctx = makeCtx({ objects: withObjects([17]) });
    const r = useCard(ctx, 12, { kind: 'object', objectIndex: 17 });
    expect(r.ok).toBe(true);
    expect(r.objects[16]).toMatchObject({ nodeId: 0, state: 0, attached: 0 });
    expect(r.toolStock[2]).toBe(1);
    expect(r.players[0]!.cards).toEqual([4, 5]);
    expect(r.hostilityDeltas).toEqual([]);
  });

  it('能选 + 效果：地雷 / 定時炸彈 各自回库存（道具 3 / 4）', () => {
    const mine = useCard(makeCtx({ objects: withObjects([27]) }), 12, {
      kind: 'object', objectIndex: 27,
    });
    expect(mine.ok).toBe(true);
    expect(mine.toolStock[3]).toBe(1);
    const bomb = useCard(makeCtx({ objects: withObjects([37]) }), 12, {
      kind: 'object', objectIndex: 37,
    });
    expect(bomb.ok).toBe(true);
    expect(bomb.toolStock[4]).toBe(1);
  });

  it('不能选：神明类物件（handle 1 = 小財神）→ noEffect 且不扣卡', () => {
    // @source 拾取跳表组 6 VA 0x00446528 只放行 0x10/0x11/0x12
    const ctx = makeCtx({ objects: withObjects([1]) });
    const r = useCard(ctx, 12, { kind: 'object', objectIndex: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([4, 5, 12]);
    expect(r.toolStock.every((n) => n === 0)).toBe(true);
  });

  it('不能选：已不在图上的路障 → noEffect 且不扣卡', () => {
    const ctx = makeCtx({ objects: withObjects([]) });
    const r = useCard(ctx, 12, { kind: 'object', objectIndex: 17 });
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([4, 5, 12]);
  });

  it('越界：handle 47 > 物件表长度 → objectOutOfRange', () => {
    const ctx = makeCtx({ objects: withObjects([17]) });
    expect(useCard(ctx, 12, { kind: 'object', objectIndex: 47 }).error).toBe('objectOutOfRange');
  });

  it('地块 / 設施 两支仍在（类别放宽没有把它们挤掉）', () => {
    const land = useCard(
      makeCtx({ lands: [makeLand({ id: 1, owner: 3, level: 3 })], objects: withObjects([]) }),
      12,
      { kind: 'entity', entityId: 1 },
    );
    expect(land.ok).toBe(true);
    expect(land.lands[0]!.level).toBe(2);
    const fac = useCard(
      makeCtx({
        nodes: [makeNode({ id: 1, type: 0 })],
        facilities: [makeFacility({ id: 1, owner: 3, level: 2, type: 1 })],
      }),
      12,
      { kind: 'facility', facilityId: 1 },
    );
    expect(fac.ok).toBe(true);
    expect(fac.facilities[0]!.level).toBe(1);
  });
});
