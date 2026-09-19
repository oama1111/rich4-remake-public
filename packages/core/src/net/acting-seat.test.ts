/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * `actingSeat` —— 联机提交权的唯一判据（issue #9）。
 */
import { describe, expect, it } from 'vitest';
import { actingSeat } from './acting-seat.ts';
import type { GameState } from '../state/types.ts';

/** 只造判据读得到的那两格；其余字段 `actingSeat` 不碰 */
const st = (currentPlayer: number, pending: unknown): GameState =>
  ({ currentPlayer, pending }) as unknown as GameState;

const auction = (bidders: number[], seat: number): unknown => ({
  kind: 'auction',
  entityId: 1,
  basePrice: 1000,
  bidders,
  price: 1000,
  top: -1,
  topCash: 0,
  seat,
  status: ['active', 'active', 'active', 'active'],
  limits: [0, 0, 0, 0],
});

describe('actingSeat', () => {
  it('没有待决交互 ⇒ 回合主人', () => {
    expect(actingSeat(st(2, null))).toBe(2);
  });

  it('回合主人自己的交互（買地 / 銀行 …）⇒ 回合主人', () => {
    expect(actingSeat(st(1, { kind: 'buyLand', landId: 3, name: 'x', price: 100 }))).toBe(1);
    expect(actingSeat(st(3, { kind: 'lottery', available: [], price: 0, owned: 0 }))).toBe(3);
  });

  it('★ 竞价 ⇒ 轮到举牌的那位，与回合主人无关（issue #9 的现场：主人 3、举牌者 0）', () => {
    expect(actingSeat(st(3, auction([0, 1, 2, 3], 0)))).toBe(0);
  });

  it('★ `seat` 是 `bidders` 的**下标**，不是玩家号（发起者被排除后两者就岔开）', () => {
    // 1 号发起 ⇒ bidders = [0,2,3]；seat=1 指的是 2 号玩家
    expect(actingSeat(st(1, auction([0, 2, 3], 1)))).toBe(2);
  });

  it('还没补全的「开拍请求」（没有 seat）⇒ 回合主人', () => {
    expect(actingSeat(st(2, { kind: 'auction', entityId: 1, basePrice: 1000, bidders: [0, 1, 3] }))).toBe(2);
  });

  it('`seat` 越界 ⇒ 退回回合主人（不把提交权交给一个不存在的座位）', () => {
    expect(actingSeat(st(2, auction([0, 1], 5)))).toBe(2);
  });

  it('生日卡：`seats[0]` 是**被挑牌的人**，拿主意的仍是寿星 = 回合主人', () => {
    expect(actingSeat(st(0, { kind: 'birthdayCard', seats: [2, 3] }))).toBe(0);
  });
});
