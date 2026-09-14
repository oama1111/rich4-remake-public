/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 企业持股排名与归属
 */

import { describe, expect, it } from 'vitest';
import {
  RANK_SLOTS,
  emptyOwnership,
  ownerOf,
  updateCommercialOwner,
} from './commercial.ts';

/** 用一张「玩家 → 持股数」的表来驱动 */
const shares = (m: Record<number, number>) => (i: number): number => m[i] ?? 0;

describe('排名表', () => {
  it('4 个槽，初始全空、无主', () => {
    const o = emptyOwnership();
    expect(o.ranking).toHaveLength(RANK_SLOTS);
    expect(o.ranking.every((v) => v === 0)).toBe(true);
    expect(ownerOf(o)).toBe(-1);
  });
});

describe('买入后重排', () => {
  it('★ 第一个买家直接成为老板', () => {
    const r = updateCommercialOwner(emptyOwnership(), 0, shares({ 0: 100 }));
    expect(r.ownership.ranking[0]).toBe(1); // 玩家 0 → 编码 1
    expect(ownerOf(r.ownership)).toBe(0);
    expect(r.changed).toBe(true);
  });

  it('★ 持股更多的人挤到前面并夺走归属', () => {
    const o = updateCommercialOwner(emptyOwnership(), 0, shares({ 0: 100 })).ownership;
    const r = updateCommercialOwner(o, 1, shares({ 0: 100, 1: 500 }));
    expect(r.ownership.ranking.slice(0, 2)).toEqual([2, 1]); // 玩家1 在前
    expect(ownerOf(r.ownership)).toBe(1);
    expect(r.changed).toBe(true);
  });

  it('★ 持股较少的人排在后面，归属不变', () => {
    const o = updateCommercialOwner(emptyOwnership(), 0, shares({ 0: 500 })).ownership;
    const r = updateCommercialOwner(o, 1, shares({ 0: 500, 1: 100 }));
    expect(r.ownership.ranking.slice(0, 2)).toEqual([1, 2]);
    expect(ownerOf(r.ownership)).toBe(0);
    // 老板没换 → 原版据此决定不刷新显示
    expect(r.changed).toBe(false);
  });

  it('★ 同一个人再买不会在表里出现两次 —— 先摘掉再插回', () => {
    let o = updateCommercialOwner(emptyOwnership(), 0, shares({ 0: 100 })).ownership;
    o = updateCommercialOwner(o, 1, shares({ 0: 100, 1: 50 })).ownership;
    // 玩家 0 加仓，仍是第一
    o = updateCommercialOwner(o, 0, shares({ 0: 900, 1: 50 })).ownership;
    expect(o.ranking.filter((v) => v === 1)).toHaveLength(1);
    expect(o.ranking.slice(0, 2)).toEqual([1, 2]);
  });

  it('★ 加仓反超时名次会翻转', () => {
    let o = updateCommercialOwner(emptyOwnership(), 0, shares({ 0: 500 })).ownership;
    o = updateCommercialOwner(o, 1, shares({ 0: 500, 1: 100 })).ownership;
    expect(o.ranking.slice(0, 2)).toEqual([1, 2]);
    // 玩家 1 加到 900，超过玩家 0
    const r = updateCommercialOwner(o, 1, shares({ 0: 500, 1: 900 }));
    expect(r.ownership.ranking.slice(0, 2)).toEqual([2, 1]);
    expect(ownerOf(r.ownership)).toBe(1);
    expect(r.changed).toBe(true);
  });

  it('四个人各就各位，按持股降序', () => {
    let o = emptyOwnership();
    const held = { 0: 100, 1: 400, 2: 200, 3: 300 };
    for (const p of [0, 1, 2, 3]) o = updateCommercialOwner(o, p, shares(held)).ownership;
    // 400 > 300 > 200 > 100 → 玩家 1、3、2、0
    expect(o.ranking).toEqual([2, 4, 3, 1]);
    expect(ownerOf(o)).toBe(1);
  });

  it('★ 持股为 0 的人只会被摘掉，不会插回', () => {
    const o = updateCommercialOwner(emptyOwnership(), 0, shares({ 0: 100 })).ownership;
    const r = updateCommercialOwner(o, 0, shares({ 0: 0 }));
    expect(r.ownership.ranking.every((v) => v === 0)).toBe(true);
    expect(ownerOf(r.ownership)).toBe(-1);
    expect(r.changed).toBe(true);
  });
});
