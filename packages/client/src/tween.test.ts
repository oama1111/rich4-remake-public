/*
 * 走子补间 —— 帧数与端点
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 帧数公式是**照 exe 抄的**（`帧数 = trunc(屏幕距离 × 0.125) + 1`），
 * 所以这里连数值一起钉住：改了 0.125 或那个 +1，走路节奏就与原版不一样了。
 */
import { describe, expect, it } from 'vitest';
import { TWEEN_FRAME_MS, framesFor, tweenDurationMs, tweenFrameCount } from './tween.ts';

describe('tweenFrameCount —— 照 exe 的帧数公式', () => {
  it('★ 就是 trunc(距离 × 0.125) + 1', () => {
    // 距离 0 → 1 帧（原版：即使原地也是 1 帧）
    expect(tweenFrameCount(0, 0)).toBe(1);
    // 距离 8 → trunc(1) + 1 = 2
    expect(tweenFrameCount(8, 0)).toBe(2);
    // 距离 16 → 2 + 1 = 3
    expect(tweenFrameCount(0, 16)).toBe(3);
    // 一格的屏幕距离约 40 → trunc(5) + 1 = 6
    expect(tweenFrameCount(40, 0)).toBe(6);
    expect(tweenFrameCount(0, 40)).toBe(6);
    // 取整是**向零**（原版 round_toward_zero）：7.99 → 0
    expect(tweenFrameCount(7.99, 0)).toBe(1);
  });

  it('合成距离按欧氏算（√(dx²+dy²)）', () => {
    // 3-4-5：距离 5 → trunc(0.625) + 1 = 1
    expect(tweenFrameCount(3, 4)).toBe(1);
    expect(tweenFrameCount(30, 40)).toBe(tweenFrameCount(50, 0));
    expect(tweenFrameCount(30, 40)).toBe(7); // trunc(6.25)+1
  });
});

describe('framesFor —— 线性等分', () => {
  it('★ 最后一帧**正好落在终点**（原版 curX = from + N 步 = to）', () => {
    const frames = framesFor({ x: 10, y: 20 }, { x: 90, y: 20 });
    const last = frames[frames.length - 1]!;
    expect(last.x).toBeCloseTo(90, 6);
    expect(last.y).toBeCloseTo(20, 6);
  });

  it('★ 第一帧**已经离起点一步**（原版 curX = fromX + stepX，不是 from）', () => {
    const frames = framesFor({ x: 0, y: 0 }, { x: 48, y: 0 });
    expect(frames.length).toBe(tweenFrameCount(48, 0));
    expect(frames[0]!.x).toBeCloseTo(48 / frames.length, 6);
    expect(frames[0]!.x).toBeGreaterThan(0);
  });

  it('各帧单调、等距', () => {
    const frames = framesFor({ x: 0, y: 0 }, { x: 0, y: 90 });
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.y).toBeGreaterThan(frames[i - 1]!.y);
      if (i > 1) {
        expect(frames[i]!.y - frames[i - 1]!.y).toBeCloseTo(
          frames[1]!.y - frames[0]!.y,
          6,
        );
      }
    }
  });

  it('★ 「動畫過程」关掉 → 0 帧（原版干脆不调那个函数）', () => {
    expect(framesFor({ x: 0, y: 0 }, { x: 100, y: 100 }, false)).toEqual([]);
  });

  it('原地不动也要 1 帧', () => {
    expect(framesFor({ x: 5, y: 5 }, { x: 5, y: 5 })).toHaveLength(1);
  });
});

describe('时长', () => {
  it('★ 每帧固定 24 ms（@source VA 0x0040e96a 的 0x18）', () => {
    expect(TWEEN_FRAME_MS).toBe(0x18);
    expect(tweenDurationMs(6)).toBe(144);
    expect(tweenDurationMs(0)).toBe(0);
  });

  it('一格（屏幕距离约 40）走约 150 ms', () => {
    const ms = tweenDurationMs(tweenFrameCount(40, 0));
    expect(ms).toBe(144);
  });
});
