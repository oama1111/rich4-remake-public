/*
 * T-075：掷骰本地预测动画
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  DiceRollAnimation,
  rollPips,
  ROLL_FRAME_MS,
  ROLL_TIMEOUT_MS,
} from './dice-anim.ts';

describe('rollPips —— 确定性面序列', () => {
  it('永远落在 1..6', () => {
    for (let frame = 0; frame < 200; frame++) {
      for (let slot = 0; slot < 3; slot++) {
        const p = rollPips(frame, slot);
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(6);
      }
    }
  });

  it('★ 同一 (帧, 颗) 永远同一张脸 —— 表现层不许有随机性', () => {
    expect(rollPips(7, 1)).toBe(rollPips(7, 1));
    expect(rollPips(1234, 0)).toBe(rollPips(1234, 0));
  });

  it('★ 相邻帧会换脸（否则看起来像卡住）', () => {
    let changed = 0;
    for (let frame = 0; frame < 60; frame++) {
      if (rollPips(frame, 0) !== rollPips(frame + 1, 0)) changed++;
    }
    // 换脸率约 5/6；给足余量，只要明显「一直在动」即可
    expect(changed).toBeGreaterThan(40);
  });

  it('几颗骰子不会整齐划一地同点', () => {
    let allSame = 0;
    for (let frame = 0; frame < 60; frame++) {
      const a = rollPips(frame, 0);
      const b = rollPips(frame, 1);
      if (a === b) allSame++;
    }
    expect(allSame).toBeLessThan(30); // 同点约 1/6，不该是常态
  });

  it('六面都用得到（不是只转两三个数）', () => {
    const faces = new Set<number>();
    for (let frame = 0; frame < 300; frame++) faces.add(rollPips(frame, 0));
    expect([...faces].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('DiceRollAnimation', () => {
  it('没开始过 → pipsAt 返回 null（由调用方画权威值）', () => {
    const a = new DiceRollAnimation();
    expect(a.pipsAt(1000)).toBeNull();
    expect(a.rolling).toBe(false);
    expect(a.settled).toBe(false);
  });

  it('★ 点 GO 后立刻就在滚：同一毫秒就有点数可画', () => {
    const a = new DiceRollAnimation();
    a.start(2, 5000);
    const pips = a.pipsAt(5000);
    expect(a.rolling).toBe(true);
    expect(pips).not.toBeNull();
    expect(pips!).toHaveLength(2);
  });

  it('★ 不读 state.dice：滚动期间的点数与真值无关（这里是纯帧号函数）', () => {
    const a = new DiceRollAnimation();
    a.start(1, 0);
    const f0 = a.pipsAt(0);
    // 同一时刻重复问，答案一样（纯函数性，没有内部随机状态在漂）
    expect(a.pipsAt(0)).toEqual(f0);
    // 走到下一帧，点数换成帧号决定的那个
    expect(a.pipsAt(ROLL_FRAME_MS)).toEqual([rollPips(1, 0)]);
  });

  it('★ 服务器回来了就定格到真值，且之后不再变', () => {
    const a = new DiceRollAnimation();
    a.start(2, 0);
    a.settle([3, 6]);

    expect(a.rolling).toBe(false);
    expect(a.settled).toBe(true);
    expect(a.pipsAt(0)).toEqual([3, 6]);
    expect(a.pipsAt(999999)).toEqual([3, 6]); // 时间再走也不动
  });

  it('定格优先于滚动：settle 之后再 tick 也不会回到滚动值', () => {
    const a = new DiceRollAnimation();
    a.start(1, 0);
    const rolling = a.pipsAt(0);
    a.settle([5]);
    expect(a.pipsAt(0)).not.toEqual(rolling);
    expect(a.pipsAt(0)).toEqual([5]);
  });

  it('★ 滚超时 → 交还给权威显示（不假装在滚）', () => {
    const a = new DiceRollAnimation();
    a.start(2, 0);
    expect(a.pipsAt(ROLL_TIMEOUT_MS - 1)).not.toBeNull();
    expect(a.pipsAt(ROLL_TIMEOUT_MS)).toBeNull();
    expect(a.rolling).toBe(false);
    // 超时后即使时间倒回去也不再参与（已彻底收摊）
    expect(a.pipsAt(0)).toBeNull();
  });

  it('cancel 之后彻底不参与', () => {
    const a = new DiceRollAnimation();
    a.start(2, 0);
    a.cancel();
    expect(a.pipsAt(0)).toBeNull();
    expect(a.rolling).toBe(false);
    expect(a.settled).toBe(false);
  });

  it('settle 之后可以再 start（下一次掷骰）', () => {
    const a = new DiceRollAnimation();
    a.start(1, 0);
    a.settle([4]);
    expect(a.pipsAt(0)).toEqual([4]);

    a.start(3, 100);
    expect(a.rolling).toBe(true);
    expect(a.settled).toBe(false);
    expect(a.pipsAt(100)!).toHaveLength(3);
  });

  it('颗数取整且至少一颗（防手滑传 0）', () => {
    const a = new DiceRollAnimation();
    a.start(0, 0);
    expect(a.pipsAt(0)!).toHaveLength(1);

    const b = new DiceRollAnimation();
    b.start(2.7, 0);
    expect(b.pipsAt(0)!).toHaveLength(2);
  });

  it('settle 传进来的数组被复制，外部再改不影响动画', () => {
    const a = new DiceRollAnimation();
    const dice = [1, 2];
    a.settle(dice);
    dice[0] = 6;
    expect(a.pipsAt(0)).toEqual([1, 2]);
  });
});
