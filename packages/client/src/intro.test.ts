/*
 * 開局跳伞过场的时序与跳过
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 帧数/每帧时长都是从 avi 的 avih 头读出来的（`dwTotalFrames` / `dwMicroSecPerFrame`），
 * 这里连数值一起钉住 —— 改了就等于改了过场时长。
 */
import { describe, expect, it } from 'vitest';
import { INTRO_FRAME_US, INTRO_FRAMES, INTRO_SIZE, introDone, introMs } from './intro.ts';

describe('過場時序 @source Airplane.avi 的 avih', () => {
  it('尺寸 312×160、15 帧、每帧 66667 µs', () => {
    expect(INTRO_SIZE).toEqual({ w: 312, h: 160 });
    expect(INTRO_FRAMES).toBe(15);
    expect(INTRO_FRAME_US).toBe(0x1046b);
    expect(INTRO_FRAME_US).toBe(66667);
  });

  it('整段约 1 秒（15 × 66.667 ms）', () => {
    expect(Math.round(introMs())).toBe(1000);
  });

  it('★ 放完就结束', () => {
    expect(introDone(0, 0, false)).toBe(false);
    expect(introDone(0, introMs() - 1, false)).toBe(false);
    expect(introDone(0, introMs(), false)).toBe(true);
  });

  it('★ 跳过立刻结束（不必等放完）', () => {
    expect(introDone(0, 0, true)).toBe(true);
  });

  it('帧数可覆盖（少了就早点结束）', () => {
    expect(introMs(3)).toBeCloseTo(200, 2);   // 3 × 66.667 = 200.001
    expect(introDone(0, 201, false, 3)).toBe(true);
  });
});
