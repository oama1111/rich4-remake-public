/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 阻碍状态递减 —— 以 VA 0x0041c8d5 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  DISAPPEARING_MASK,
  RELEASE_PENDING,
  displayRemainingDays,
  tickBlocking,
  tickBlockingCounter,
} from './blocking.ts';

describe('★ 两段式：先减到 0 挂 0x80，下一次才释放', () => {
  it('普通递减', () => {
    expect(tickBlockingCounter(3)).toEqual({ value: 2, release: false });
    expect(tickBlockingCounter(2)).toEqual({ value: 1, release: false });
  });

  it('★ 减到 0 时不清零，而是置 0x80', () => {
    expect(tickBlockingCounter(1)).toEqual({ value: RELEASE_PENDING, release: false });
  });

  it('★ 下一次看到 0x80 才真正释放', () => {
    expect(tickBlockingCounter(RELEASE_PENDING)).toEqual({ value: 0, release: true });
  });

  it('为 0 时什么都不做', () => {
    expect(tickBlockingCounter(0)).toEqual({ value: 0, release: false });
  });

  it('★ 完整生命周期：3 天牢 → 第 4 次推进才出狱', () => {
    let v = 3;
    const releases: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const out = tickBlockingCounter(v);
      v = out.value;
      releases.push(out.release);
    }
    expect(releases).toEqual([false, false, false, true]);
    expect(v).toBe(0);
  });
});

describe('★ 整字节递减，不做掩码', () => {
  it('高位以外的值原样减 1', () => {
    // 先前的错误模型会把 0x7f 当成「低 7 位」特殊处理
    expect(tickBlockingCounter(0x7f)).toEqual({ value: 0x7e, release: false });
  });
});

describe('★ days_disappearing 的归零判据用 0x3f', () => {
  it('掩码是 0x3f', () => {
    expect(DISAPPEARING_MASK).toBe(0x3f);
  });

  it('低 6 位归零即挂待释放，哪怕整字节非 0', () => {
    // 0x41 - 1 = 0x40；0x40 & 0x3f == 0 → 挂 0x80
    expect(tickBlockingCounter(0x41, DISAPPEARING_MASK)).toEqual({
      value: 0x40 | RELEASE_PENDING,
      release: false,
    });
  });

  it('同样的值用整字节判据则不挂', () => {
    expect(tickBlockingCounter(0x41, 0xff)).toEqual({ value: 0x40, release: false });
  });
});

describe('★ 只递减 住宿/消失/监狱/医院 四项', () => {
  const b = () =>
    makePlayer({
      blocking: {
        inHotel: 5,
        disappearing: 2,
        inPrison: 2,
        inHospital: 1,
        sleeping: 5,
        sleepWalking: 3,
        stopping: 4,
        tortoiseWalking: 6,
      },
    }).blocking;

  it('四项递减', () => {
    const r = tickBlocking(b());
    expect(r.blocking.inHotel).toBe(4);
    expect(r.blocking.disappearing).toBe(1);
    expect(r.blocking.inPrison).toBe(1);
    expect(r.blocking.inHospital).toBe(RELEASE_PENDING);
  });

  it('★ 冬眠/梦游/停留/乌龟**不在此处递减**', () => {
    const r = tickBlocking(b());
    expect(r.blocking.sleeping).toBe(5);
    expect(r.blocking.sleepWalking).toBe(3);
    expect(r.blocking.stopping).toBe(4);
    expect(r.blocking.tortoiseWalking).toBe(6);
  });

  it('报告需要释放的项', () => {
    const start = { ...b(), inPrison: RELEASE_PENDING, inHospital: RELEASE_PENDING };
    const r = tickBlocking(start);
    expect(r.released).toEqual(['inPrison', 'inHospital']);
    expect(r.blocking.inPrison).toBe(0);
    expect(r.blocking.inHospital).toBe(0);
  });
});

describe('显示值', () => {
  it('(value & 0x7f) + 1', () => {
    expect(displayRemainingDays(3)).toBe(4);
    expect(displayRemainingDays(RELEASE_PENDING)).toBe(1);
  });

  it('disappearing 用 0x3f', () => {
    expect(displayRemainingDays(0x42, DISAPPEARING_MASK)).toBe(3);
  });
});
