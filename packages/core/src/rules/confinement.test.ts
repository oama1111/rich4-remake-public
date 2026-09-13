/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 监狱与医院 —— 以 VA 0x0043d593 / 0x0043ec3f 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { RELEASE_PENDING, tickBlockingCounter } from './blocking.ts';
import {
  CONFINEMENT_SLOTS,
  KNOWN_PRISON_DAYS,
  OBJECT_SLOT_BASE,
  anyoneConfined,
  confine,
  isReleasePending,
  release,
} from './confinement.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
const empty = () => new Array<number>(CONFINEMENT_SLOTS).fill(0);

describe('送进去', () => {
  it('监狱：写计数字段并置占用表', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    expect(r.players[2]!.blocking.inPrison).toBe(5);
    expect(r.occupancy[2]).toBe(1);
    expect(r.extended).toBe(false);
  });

  it('医院：走同一套，只是字段不同', () => {
    const r = confine(four(), empty(), 'hospital', 1, 3);
    expect(r.players[1]!.blocking.inHospital).toBe(3);
    expect(r.players[1]!.blocking.inPrison).toBe(0);
    expect(r.occupancy[1]).toBe(1);
  });

  it('不影响其他玩家', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    expect(r.players.map((p) => p.blocking.inPrison)).toEqual([0, 0, 5, 0]);
  });
});

describe('★ 加刑：已在里面则累加', () => {
  it('累加而非覆盖', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, blocking: { ...ps[2]!.blocking, inPrison: 3 } });
    const r = confine(ps, empty(), 'prison', 2, 4);
    expect(r.extended).toBe(true);
    expect(r.days).toBe(7);
  });

  it('★ 累加结果与 0x7f 相与，防止进位误置「待释放」位', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, blocking: { ...ps[2]!.blocking, inPrison: 0x7e } });
    // 0x7e + 5 = 0x83；& 0x7f = 0x03
    const r = confine(ps, empty(), 'prison', 2, 5);
    expect(r.days).toBe(0x03);
    expect(r.days & RELEASE_PENDING).toBe(0);
  });

  it('新判则直接赋值，不做掩码', () => {
    const r = confine(four(), empty(), 'prison', 2, 0x7e);
    expect(r.days).toBe(0x7e);
    expect(r.extended).toBe(false);
  });
});

describe('占用表', () => {
  it('槽位 8 个，0..3 玩家、4..7 物件', () => {
    expect(CONFINEMENT_SLOTS).toBe(8);
    expect(OBJECT_SLOT_BASE).toBe(4);
  });

  it('★ 无人在押时 anyoneConfined 为 false —— 探监机制的判据', () => {
    expect(anyoneConfined(empty())).toBe(false);
  });

  it('有人在押即为 true', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    expect(anyoneConfined(r.occupancy)).toBe(true);
  });

  it('释放后清空该槽位', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    const after = release(r.occupancy, 2);
    expect(after[2]).toBe(0);
    expect(anyoneConfined(after)).toBe(false);
  });

  it('物件占用也算「有人在押」', () => {
    const occ = empty();
    occ[OBJECT_SLOT_BASE] = 1;
    expect(anyoneConfined(occ)).toBe(true);
  });
});

describe('★ 与递减流程接得上', () => {
  it('关 3 天 → 第 4 次推进才放人', () => {
    let v = confine(four(), empty(), 'prison', 0, 3).players[0]!.blocking.inPrison;
    const releases: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const out = tickBlockingCounter(v);
      v = out.value;
      releases.push(out.release);
    }
    expect(releases).toEqual([false, false, false, true]);
  });

  it('isReleasePending 认出待释放状态', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, blocking: { ...ps[1]!.blocking, inPrison: RELEASE_PENDING } });
    expect(isReleasePending(ps[1]!, 'prison')).toBe(true);
    expect(isReleasePending(ps[1]!, 'hospital')).toBe(false);
  });
});

describe('已知刑期', () => {
  it('★ 陷害自己 4 天、害别人 5 天', () => {
    expect(KNOWN_PRISON_DAYS.self).toBe(4);
    expect(KNOWN_PRISON_DAYS.other).toBe(5);
    expect(KNOWN_PRISON_DAYS.self).toBeLessThan(KNOWN_PRISON_DAYS.other);
  });
});
