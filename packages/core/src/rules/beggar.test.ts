/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 乞丐
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_COMPUTER } from '../state/types.ts';
import { ALMS_PER_PRICE_INDEX, almsAmount, beggarAt } from './beggar.ts';
import { runtimeOccupiedNodes } from './object-landing.ts';
import { giveAlmsIfBeggar } from '../state/reduce.ts';
import type { MapTopology } from '../state/reduce.ts';

const alive = (i: number, node: number) =>
  makePlayer({ index: i, nodeId: node, whoPlays: WHO_PLAYS_COMPUTER });
const dead = (i: number, node: number) => makePlayer({ index: i, nodeId: node, whoPlays: 0 });

describe('施捨金额', () => {
  it('物价指数 × 1000', () => {
    expect(ALMS_PER_PRICE_INDEX).toBe(1000);
    expect(almsAmount(1)).toBe(1000);
    expect(almsAmount(7)).toBe(7000);
  });
});

describe('谁是乞丐', () => {
  const players = [alive(0, 5), dead(1, 5), alive(2, 9), dead(3, 9)];

  it('同格的出局者就是乞丐', () => {
    expect(beggarAt(players, 5, 0)).toBe(1);
  });

  it('同格没别人 → 没有', () => {
    expect(beggarAt(players, 12, 0)).toBe(-1);
  });

  it('★ 只看下标最小的那一个 —— 他还活着就直接跳过，不往下找', () => {
    // 9 号格上有活着的 2 与出局的 3；原版取最低位 → 2，活着 → 不施捨
    expect(beggarAt(players, 9, 0)).toBe(-1);
  });

  it('自己不算自己的乞丐', () => {
    expect(beggarAt([dead(0, 5), alive(1, 5)], 5, 1)).toBe(0);
    expect(beggarAt([dead(0, 5)], 5, 0)).toBe(-1);
  });
});

describe('★ 运行时占用位：玩家与物件都要算（@source 0x40aa6c 的 0x80ffff00）', () => {
  it('玩家（含出局者）与「在地图上的」物件都算；附身的物件不算', () => {
    const occ = runtimeOccupiedNodes(
      [{ nodeId: 5 }, { nodeId: 0 }, { nodeId: 7 }],
      [
        { nodeId: 9, attached: 0 }, // 地图上的神明
        { nodeId: 11, attached: 3 }, // 附在人身上 → 不在图上
        { nodeId: 0, attached: 0 }, // 未登场
      ],
    );
    expect([...occ].sort((a, b) => a - b)).toEqual([5, 7, 9]);
  });
});

describe('★★ 乞丐换位不能落到有人/有物件的格子上', () => {
  /**
   * 三格小地图：1 = 我站着（也是乞丐待的那格）、2 = 另一个玩家站着、3 = 有神明。
   * 按原版 `0x40aa6c` 的筛选（`test [node+0x24], 0x80ffff00`），三格全被占，
   * ⇒ **一个候选都没有 ⇒ 乞丐原地不动**。
   * 先前只排除「自己那一格」，于是会挪到 2 或 3 上（与玩家/神明叠格）。
   */
  const topo: MapTopology = {
    nodes: [1, 2, 3].map((id) =>
      makeNode({ id, adjacent: [id], walkable: true, noObjects: false, type: 0 }),
    ),
  };
  const state = makeGameState({
    players: [
      makePlayer({ index: 0, nodeId: 1, whoPlays: WHO_PLAYS_COMPUTER, cash: 50_000, moneyInBank: 0 }),
      makePlayer({ index: 1, nodeId: 1, whoPlays: 0 }), // ★ 乞丐（出局者）与我同格
      makePlayer({ index: 2, nodeId: 2, whoPlays: WHO_PLAYS_COMPUTER }), // 别人站着
    ],
    currentPlayer: 0,
    stepsRemaining: 0,
    priceIndex: 1,
    pool: 0,
    objects: [{ type: 1, nodeId: 3, state: 0, attached: 0 }], // 3 号格有神明
  });

  it('三格全被占 → 乞丐原地不动，但施捨照付', () => {
    const after = giveAlmsIfBeggar(state, topo, 1);
    expect(after.players[1]!.nodeId, '乞丐不该挪到有人/有神明的格子上').toBe(1);
    expect(after.pool, '施捨进公库').toBe(almsAmount(1));
    expect(after.players[0]!.cash).toBe(50_000 - almsAmount(1));
  });
});
