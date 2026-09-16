/*
 * 開局跳伞过场的时序与跳过
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 帧数/每帧时长都是从 avi 的 avih 头读出来的（`dwTotalFrames` / `dwMicroSecPerFrame`），
 * 这里连数值一起钉住 —— 改了就等于改了过场时长。
 */
import { describe, expect, it } from 'vitest';
import {
  INTRO_FRAME_US,
  INTRO_FRAMES,
  INTRO_HINT,
  INTRO_SIZE,
  drawIntro,
  introDone,
  introMs,
} from './intro.ts';

/** 只收 `fillText` 的文字的最小假 canvas */
function fakeCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = {
    canvas: { width: 640, height: 480 },
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    fillText: (t: string) => texts.push(t),
    strokeText: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

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

describe('★ 过场画给玩家看的东西里不许有内部编号', () => {
  it('★ 提示串本身不含 `Q-xxx` / `T-xxx` 这类 issue 号', () => {
    // 先前这里是「開場動畫（原版為 AIRPLANE.AVI，見 Q-INTRO-1）—— 按任意鍵跳過」，
    // 把内部编号漏到了玩家面前。见 `docs/known-deviations.md` Q-INTRO-1。
    expect(INTRO_HINT).not.toMatch(/[QT]-\d/);
    expect(INTRO_HINT).toContain('按任意鍵');
  });

  it('★ `drawIntro` 真正画出去的文字也不含内部编号（且位置/时长没变）', () => {
    const { ctx, texts } = fakeCtx();
    drawIntro(ctx, 0);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t, `畫出去的字「${t}」帶著內部編號`).not.toMatch(/[QT]-\d/);
    }
    // 几何行为照旧：312×160 居中
    expect(INTRO_SIZE).toEqual({ w: 312, h: 160 });
    drawIntro(ctx, introMs(), INTRO_FRAMES);
  });
});
