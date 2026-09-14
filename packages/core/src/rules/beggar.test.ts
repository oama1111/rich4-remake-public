/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 乞丐
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_COMPUTER } from '../state/types.ts';
import { ALMS_PER_PRICE_INDEX, almsAmount, beggarAt } from './beggar.ts';

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
