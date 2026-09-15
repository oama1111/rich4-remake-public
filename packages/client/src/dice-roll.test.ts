/*
 * 掷骰那一段的三段时序
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉住的是**时长与顺序**，不是点数 —— 点数由 core 决定，这里只负责「什么时候画」。
 */
import { describe, expect, it } from 'vitest';
import { DICE_HOLD_MS, DiceRollFx } from './dice-roll.ts';
import type { LoadedFlic } from './assets.ts';

/** 造一段假影片：`n` 帧、每帧 `ms` 毫秒 */
function fakeFlic(n: number, ms: number): LoadedFlic {
  return {
    frames: Array.from({ length: n }, () => ({}) as unknown as ImageBitmap),
    width: 189,
    height: 285,
    frameMs: ms,
    close: () => {},
  };
}

const TICK = 80;

describe('DiceRollFx —— 预动作 → 滚骰 → 定格', () => {
  it('★ 预动作要整整 `每向帧数` 个 tick 才算数满（走路 = 9）', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 1);
    expect(fx.phase).toBe('anticipate');
    expect(fx.wantsRoll).toBe(true);
    // 数到第 8 个 tick 还没到
    expect(fx.anticipationDone(1000 + 8 * TICK)).toBe(false);
    // 第 9 个 tick 到点
    expect(fx.anticipationDone(1000 + 9 * TICK)).toBe(true);
  });

  it('★ 催过一次就不会重复催 —— 一个回合只掷一次', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.markRollRequested();
    expect(fx.wantsRoll).toBe(false);
  });

  it('★ 滚骰时长 = 帧数 × FLIC 头里的每帧毫秒（36 × 14 = 504）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 2);
    fx.markRollRequested();
    fx.roll(0, [3, 5], fakeFlic(36, 14));
    expect(fx.phase).toBe('tumble');
    expect(fx.tumbleMs()).toBe(504);
  });

  it('★ 影片逐帧推进，**播完停下**（flags bit2 没置位 = 不循环）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [4], fakeFlic(36, 14));
    expect(fx.flicFrame(0)).toBe(0);
    expect(fx.flicFrame(14)).toBe(1);
    expect(fx.flicFrame(35 * 14)).toBe(35);
    // 播完停在最后一帧，不会绕回 0
    expect(fx.flicFrame(36 * 14 - 1)).toBe(35);
  });

  it('★ 滚完之后盖点数、留 500 ms（@source VA 0x004196da）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 2);
    fx.roll(0, [2, 6], fakeFlic(36, 14));
    // 滚骰中不画点数
    expect(fx.pips(200)).toBeNull();
    // 滚完进定格
    expect(fx.pips(504)).toEqual([2, 6]);
    expect(fx.pips(504 + DICE_HOLD_MS - 1)).toEqual([2, 6]);
    expect(DICE_HOLD_MS).toBe(500);
  });

  it('★ 500 ms 定格走完就自动收摊，走子才能开始', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [5], fakeFlic(36, 14));
    expect(fx.phase).toBe('tumble');
    expect(fx.active).toBe(true);
    expect(fx.pips(504)).toEqual([5]);
    expect(fx.phase).toBe('hold');
    expect(fx.done(504 + DICE_HOLD_MS)).toBe(true);
    expect(fx.active).toBe(false);
    expect(fx.pips(504 + DICE_HOLD_MS)).toBeNull();
  });

  it('★ 整段期间角色都摆「手持骰子」那一组（原版切成走子是在 500 ms 之后）', () => {
    const fx = new DiceRollFx();
    expect(fx.characterPose).toBeNull();
    fx.begin(0, 9, TICK, 1);
    expect(fx.characterPose).toBe('dice');
    fx.roll(0, [1], fakeFlic(36, 14));
    expect(fx.characterPose).toBe('dice');
    fx.pips(504);
    expect(fx.characterPose).toBe('dice');
    fx.done(504 + DICE_HOLD_MS);
    expect(fx.characterPose).toBeNull();
  });

  it('影片还没到货时不炸，也不画影片', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [1], null);
    expect(fx.flicFrame(100)).toBeNull();
    expect(fx.flicBitmap(100)).toBeNull();
    expect(fx.tumbleMs()).toBe(0);
  });

  it('收摊后一切归零', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [1], fakeFlic(36, 14));
    fx.cancel();
    expect(fx.active).toBe(false);
    expect(fx.pips(1000)).toBeNull();
    expect(fx.flicFrame(1000)).toBeNull();
  });
});
