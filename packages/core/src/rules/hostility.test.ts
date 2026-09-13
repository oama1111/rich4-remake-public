/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 敌意 —— 以 VA 0x0040df69 的分支结构为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { applyHostilityDeltas, breakAlliance, updateHostility } from './hostility.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i }));

describe('updateHostility', () => {
  it('累加到 hostility[对方下标]', () => {
    const r = updateHostility(four(), 0, 2, 150);
    expect(r.players[0]!.hostility).toEqual([0, 0, 150, 0]);
    // 只影响施加方自己的那一行
    expect(r.players[2]!.hostility).toEqual([0, 0, 0, 0]);
  });

  it('★ 对自己无效（原版 cmp edx,ebx / je end）', () => {
    const r = updateHostility(four(), 1, 1, 500);
    expect(r.players[1]!.hostility).toEqual([0, 0, 0, 0]);
  });

  it('下限为 0，无上限', () => {
    let ps = updateHostility(four(), 0, 1, 100).players;
    ps = updateHostility(ps, 0, 1, -300).players;
    expect(ps[0]!.hostility[1]).toBe(0);
    ps = updateHostility(ps, 0, 1, 999999).players;
    expect(ps[0]!.hostility[1]).toBe(999999);
  });

  it('★ 已为 0 时负增量提前返回，结果同样是 0', () => {
    const r = updateHostility(four(), 0, 1, -50);
    expect(r.players[0]!.hostility[1]).toBe(0);
    expect(r.allianceBroken).toBe(false);
  });
});

describe('★ 敌意上升会解除同盟', () => {
  it('对盟友产生正敌意 → 双向解盟', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });

    const r = updateHostility(ps, 0, 1, 200);
    expect(r.allianceBroken).toBe(true);
    expect(r.players[0]!.alliedPlayer).toBe(0);
    expect(r.players[0]!.alliedDays).toBe(0);
    expect(r.players[1]!.alliedPlayer).toBe(0);
    expect(r.players[1]!.alliedDays).toBe(0);
    // 敌意本身照样记上
    expect(r.players[0]!.hostility[1]).toBe(200);
  });

  it('对**非盟友**产生敌意不影响同盟', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });

    const r = updateHostility(ps, 0, 3, 200);
    expect(r.allianceBroken).toBe(false);
    expect(r.players[0]!.alliedPlayer).toBe(2);
  });

  it('★ 负增量不解盟（原版 jle end 在同盟检查之前）', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7, hostility: [0, 500, 0, 0] });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });

    const r = updateHostility(ps, 0, 1, -100);
    expect(r.allianceBroken).toBe(false);
    expect(r.players[0]!.alliedPlayer).toBe(2);
    expect(r.players[0]!.hostility[1]).toBe(400);
  });

  it('增量为 0 也不解盟（jle 含 0）', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });
    expect(updateHostility(ps, 0, 1, 0).allianceBroken).toBe(false);
  });
});

describe('breakAlliance', () => {
  it('没有同盟时是空操作', () => {
    const ps = four();
    expect(breakAlliance(ps, 0)).toEqual(ps);
  });
});

describe('applyHostilityDeltas', () => {
  it('按顺序依次施加', () => {
    const ps = applyHostilityDeltas(four(), [
      { from: 1, to: 0, delta: 100 },
      { from: 2, to: 0, delta: 200 },
      { from: 1, to: 0, delta: 50 },
    ]);
    expect(ps[1]!.hostility[0]).toBe(150);
    expect(ps[2]!.hostility[0]).toBe(200);
  });
});
