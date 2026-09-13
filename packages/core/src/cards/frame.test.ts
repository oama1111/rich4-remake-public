/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 陷害卡 —— 以 VA 0x004444bf 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { PASSIVE_CARDS } from './passive.ts';
import {
  FRAME_DAYS_OTHER,
  FRAME_DAYS_SELF,
  FRAME_HOSTILITY_FACTOR,
  applyFrameCard,
} from './frame.ts';

const four = (cards: number[][] = [[], [], [], []]) =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, cards: cards[i] ?? [] }));

const tgt = (index: number) => ({ kind: 'player' as const, index });

describe('基本效果', () => {
  it('把目标关进监狱 5 天', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.ok).toBe(true);
    expect(r.players[2]!.blocking.inPrison).toBe(FRAME_DAYS_OTHER);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 2, days: 5, redirected: false });
  });

  it('★ 敌意 = 物价指数 × 150（与冬眠卡同系数）', () => {
    expect(FRAME_HOSTILITY_FACTOR).toBe(150);
    const r = applyFrameCard(four(), 0, tgt(2), 4);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 600 }]);
  });

  it('只有目标进监狱，其他人不受影响', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.players.map((p) => p.blocking.inPrison)).toEqual([0, 0, 5, 0]);
  });
});

describe('★ 免罪卡(21)：免疫，无人入狱', () => {
  it('目标持免罪卡则不入狱', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.ok).toBe(true);
    expect(r.outcome).toEqual({ kind: 'absolved', absolvedBy: 2 });
    expect(r.players.every((p) => p.blocking.inPrison === 0)).toBe(true);
  });

  it('★ 敌意照记——免疫与否都记', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 2);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 300 }]);
  });

  it('★ 免罪卡优先于嫁祸卡（原版先查 0x15 再查 0x13）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 3);
    expect(r.outcome!.kind).toBe('absolved');
    expect(r.players[3]!.blocking.inPrison).toBe(0);
  });
});

describe('★ 嫁祸卡(19)：把牢饭转给别人', () => {
  it('目标持嫁祸卡则由新目标入狱', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 3);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 3, days: 5, redirected: true });
    expect(r.players[2]!.blocking.inPrison).toBe(0);
    expect(r.players[3]!.blocking.inPrison).toBe(5);
  });

  it('放弃转嫁（返回 -1）则原目标照进', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => -1);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 2, days: 5, redirected: false });
  });

  it('★ 转嫁回出牌者时刑期变 4 天（比较发生在改写之后）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 0);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 0, days: FRAME_DAYS_SELF, redirected: true });
    expect(r.players[0]!.blocking.inPrison).toBe(4);
  });
});

describe('★ 陷害自己只关 4 天', () => {
  it('直接把自己作为目标', () => {
    const r = applyFrameCard(four(), 1, tgt(1), 1);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 1, days: 4, redirected: false });
  });

  it('4 天确实少于 5 天', () => {
    expect(FRAME_DAYS_SELF).toBeLessThan(FRAME_DAYS_OTHER);
  });
});

describe('目标校验', () => {
  it('地块目标 → wrongTargetKind', () => {
    const r = applyFrameCard(four(), 0, { kind: 'entity', entityId: 1 }, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrongTargetKind');
  });

  it('越界 → playerOutOfRange', () => {
    expect(applyFrameCard(four(), 0, tgt(9), 1).error).toBe('playerOutOfRange');
  });

  it('失败时状态不变', () => {
    const ps = four();
    const r = applyFrameCard(ps, 0, tgt(9), 1);
    expect(r.players).toEqual(ps);
    expect(r.hostilityDeltas).toEqual([]);
  });
});

describe('★ 接上 confinement：占用表与加刑', () => {
  it('入狱后占用表被置位', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.occupancy[2]).toBe(1);
  });

  it('免疫时占用表不动', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.occupancy.every((v) => v === 0)).toBe(true);
  });

  it('★ 对已在狱中的人再陷害 → 加刑而非覆盖', () => {
    const ps = four();
    ps[2] = makePlayer({
      index: 2,
      blocking: { ...ps[2]!.blocking, inPrison: 3 },
    });
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.outcome).toMatchObject({ kind: 'imprisoned', victim: 2, days: 8 });
    expect(r.players[2]!.blocking.inPrison).toBe(8);
  });
});
