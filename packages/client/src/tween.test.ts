/*
 * 走子补间 —— tick 数与端点
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 数值全部**照 exe 抄的**（`fcn_0040c05c`，VA 0x0040c05c）：
 * `tick 数 = trunc(屏幕距离 / 走子速度)`，速度表 `[8, 12, 16, 8]` 像素/tick。
 * 所以这里连数值一起钉住：改了速度表或那个截断，走路节奏就与原版不一样了。
 *
 * ⚠️ 上一版这里钉的是 `trunc(距离 × 0.125) + 1` / 24 ms —— 那是把出处挂到了
 *   `_rich4_animate_object`（道具飞行动画）上，两个字都不是玩家走子的规格。
 *   见 `known-deviations.md` Q-TURN-1 §6。
 */
import { describe, expect, it } from 'vitest';
import { WALK_SPEED_PX_PER_TICK, framesFor, tweenTickCount } from './tween.ts';

describe('WALK_SPEED_PX_PER_TICK —— 照 exe 的速度表', () => {
  it('★ 表就是 [8, 12, 16, 8]（走路/機車/汽車/船）@source VA 0x004749d8', () => {
    expect([...WALK_SPEED_PX_PER_TICK]).toEqual([8, 12, 16, 8]);
  });
});

describe('tweenTickCount —— 照 exe 的 tick 数公式', () => {
  it('★ 就是 trunc(距离 / 速度)，**没有 +1**', () => {
    // 一格屏幕距离中位数约 50 px，走路 8 px/tick → 6
    expect(tweenTickCount(50, 0, 0)).toBe(6);
    // 機車 12 → 4
    expect(tweenTickCount(50, 0, 1)).toBe(4);
    // 汽車 16 → 3
    expect(tweenTickCount(50, 0, 2)).toBe(3);
    // 船 8 → 6
    expect(tweenTickCount(50, 0, 3)).toBe(6);
  });

  it('取整是**向零**（@source fcn_00457dbc 把 FPU 舍入位置成 11b）', () => {
    // 79 / 8 = 9.875 → 9（不是 10）
    expect(tweenTickCount(79, 0, 0)).toBe(9);
    // 7 / 8 = 0.875 → 0 → 但 N==0 要钳到 1（@source VA 0x0040c31f）
    expect(tweenTickCount(7, 0, 0)).toBe(1);
    expect(tweenTickCount(0, 0, 0)).toBe(1);
  });

  it('合成距离按欧氏算（√(dx²+dy²)）', () => {
    expect(tweenTickCount(30, 40, 0)).toBe(tweenTickCount(50, 0, 0));
    expect(tweenTickCount(30, 40, 0)).toBe(6);
  });

  it('★ 特殊态走 dist × 0.125 那一支（乘骑 / 被抬走）', () => {
    // 0.125 的倒数就是 8 —— 与走路同速，所以拿 8 那档对一下
    expect(tweenTickCount(50, 0, 2, true)).toBe(tweenTickCount(50, 0, 0));
    expect(tweenTickCount(50, 0, 1, true)).toBe(6);
  });
});

describe('framesFor —— 线性等分', () => {
  it('★ 最后一帧**正好落在终点**（原版 curX = from + N 步 = to）', () => {
    const frames = framesFor({ x: 10, y: 20 }, { x: 90, y: 20 }, 6);
    const last = frames[frames.length - 1]!;
    expect(last.x).toBeCloseTo(90, 6);
    expect(last.y).toBeCloseTo(20, 6);
  });

  it('★ 第一帧**已经离起点一步**（原版 curX = fromX + stepX，不是 from）', () => {
    const frames = framesFor({ x: 0, y: 0 }, { x: 48, y: 0 }, 6);
    expect(frames).toHaveLength(6);
    expect(frames[0]!.x).toBeCloseTo(8, 6);
    expect(frames[0]!.x).toBeGreaterThan(0);
  });

  it('各帧单调、等距', () => {
    const frames = framesFor({ x: 0, y: 0 }, { x: 0, y: 90 }, 5);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.y).toBeGreaterThan(frames[i - 1]!.y);
      if (i > 1) {
        expect(frames[i]!.y - frames[i - 1]!.y).toBeCloseTo(frames[1]!.y - frames[0]!.y, 6);
      }
    }
  });

  it('★ tick 数为 0 → 0 帧（「動畫過程」关掉时调用方根本不放补间）', () => {
    expect(framesFor({ x: 0, y: 0 }, { x: 100, y: 100 }, 0)).toEqual([]);
  });

  it('原地不动也要 1 帧', () => {
    expect(framesFor({ x: 5, y: 5 }, { x: 5, y: 5 }, 1)).toHaveLength(1);
  });
});
