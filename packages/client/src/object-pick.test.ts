/*
 * 請神符（23）的目标选择（Q-PICK-2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版**没有列表 UI**：真人那一支 `fcn_00444d1a` 直接算「离当前玩家最近的
 *   可附身物件」。这里钉的就是那条规则（筛选、距离、等距取谁、没有时返回 0）。
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology } from '@rich4/core';
import {
  SUMMON_CARD_ID,
  nearestSummonableObject,
  pickableObjects,
  summonCardAction,
} from './object-pick.ts';

/** 五个节点排成一条横线，间距 100，另外 y 方向留两个错开的点 */
const topo = {
  nodes: [
    { id: 1, x: 0, y: 0, ref: { kind: 'special' }, adjacent: [] },
    { id: 2, x: 100, y: 0, ref: { kind: 'special' }, adjacent: [] },
    { id: 3, x: 200, y: 0, ref: { kind: 'special' }, adjacent: [] },
    { id: 4, x: 100, y: 100, ref: { kind: 'special' }, adjacent: [] },
    { id: 5, x: 100, y: -100, ref: { kind: 'special' }, adjacent: [] },
  ],
  lands: [],
  facilities: [],
  commercials: [],
} as unknown as MapTopology;

/** 物件表：每项 { type, nodeId, state, attached } */
const obj = (type: number, nodeId: number, attached = 0) => ({
  type,
  nodeId,
  state: attached === 0 ? 0 : 7,
  attached,
});

const stateOf = (
  objects: ReturnType<typeof obj>[],
  playerNode = 1,
): GameState =>
  ({
    players: [{ index: 0, nodeId: playerNode }],
    objects,
    currentPlayer: 0,
  }) as unknown as GameState;

describe('可请的物件 @source `fcn_00444d1a` 的筛选', () => {
  it('★ 不在图上（nodeId 0）与已被附身的都要剔掉', () => {
    const s = stateOf([obj(1, 0), obj(1, 2, 3), obj(1, 3)]);
    expect(pickableObjects(s, topo).map((c) => c.handle)).toEqual([3]);
  });

  it('★ 种类要过 `0x40ea62`（= core 的 canAttach）：惡犬(11)/禮物(13)/寶箱(14) 剔掉', () => {
    const s = stateOf([obj(11, 2), obj(13, 2), obj(14, 2), obj(15, 2), obj(0, 2), obj(12, 2)]);
    // 可附身 = (type <= 12 && type != 11) || type == 15
    expect(pickableObjects(s, topo).map((c) => c.handle)).toEqual([4, 5, 6]);
  });
});

describe('请哪一尊 @source VA 0x00444d1a（最近）', () => {
  it('★ 取**距离最近**的那一件，与物件表顺序无关', () => {
    // 玩家在节点 1(0,0)：节点 3(200,0) 最近的是节点 2(100,0) 那个（handle 3）
    const s = stateOf([obj(1, 3), obj(1, 2), obj(1, 4), obj(1, 5)]);
    expect(nearestSummonableObject(s, topo)).toBe(2);
  });

  it('★ 一个能请的都没有 → 0（原版 `ebp` 停在 0）', () => {
    expect(nearestSummonableObject(stateOf([]), topo)).toBe(0);
    // 全都被附身 / 全都不是可附身种类
    expect(nearestSummonableObject(stateOf([obj(1, 2, 1), obj(11, 2)]), topo)).toBe(0);
  });

  it('★ 等距时取**行序在先**的那一件（近似原版按地图格扫的顺序）', () => {
    // 玩家在 (100,0)：节点 4(100,100) 与节点 5(100,-100) 等距 —— 按 y 升序取 5
    const s = stateOf([obj(1, 4), obj(1, 5)], 2);
    expect(nearestSummonableObject(s, topo)).toBe(2);
    // 同一格上两件（理论上不会）→ 取 handle 小的（handle 1 在 handle 2 之前）
    const same = stateOf([obj(1, 3), obj(1, 3)], 1);
    expect(nearestSummonableObject(same, topo)).toBe(1);
  });
});

describe('选中 → action（形状与 core 的 useCard 一致）', () => {
  it('★ handle → useCard{cardId:23, target:{kind:object, objectIndex}}', () => {
    expect(SUMMON_CARD_ID).toBe(23);
    expect(summonCardAction(4)).toEqual({
      type: 'useCard',
      cardId: 23,
      target: { kind: 'object', objectIndex: 4 },
    });
  });

  it('★ 没得请（0）→ null：**不发 action**，卡不消耗', () => {
    expect(summonCardAction(0)).toBeNull();
    expect(summonCardAction(-1)).toBeNull();
    expect(summonCardAction(1.5)).toBeNull();
  });

  it('★ 「最近的」直接接上 action —— 整条路走通', () => {
    const s = stateOf([obj(1, 3), obj(1, 2)], 1);
    expect(summonCardAction(nearestSummonableObject(s, topo))).toEqual({
      type: 'useCard',
      cardId: 23,
      target: { kind: 'object', objectIndex: 2 },
    });
  });
});
