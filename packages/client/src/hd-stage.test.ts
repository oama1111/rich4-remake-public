/*
 * 高清舞台 —— 精灵按逻辑尺寸画、离屏画布按倍率开像素
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  drawSprite,
  drawSpriteRegion,
  drawSurface,
  hdRatio,
  hdStageRequested,
  sizeSurface,
  surfaceScaleFor,
  surfaceScaleCap,
  TOUCH_SURFACE_SCALE_CAP,
  MAX_SURFACE_SCALE,
  surfaceScaleOf,
} from './hd-stage.ts';

/** 记下每一次 drawImage 的参数与当时的平滑开关 */
function fakeCtx() {
  const calls: { args: unknown[]; smoothing: boolean }[] = [];
  const transforms: number[][] = [];
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    drawImage(...args: unknown[]) {
      calls.push({ args, smoothing: this.imageSmoothingEnabled });
    },
    setTransform(...m: number[]) {
      transforms.push(m);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, transforms, raw: ctx };
}

const bmp = (w: number, h: number) => ({ width: w, height: h }) as unknown as ImageBitmap;
/** 原版 20×10 */
const original = { bitmap: bmp(20, 10), width: 20, height: 10 };
/** 同一张图的 4× 超分 */
const hd4 = { bitmap: bmp(80, 40), width: 20, height: 10 };

describe('hdRatio', () => {
  it('原图 → null；超分图 → 两个方向各自的倍率', () => {
    expect(hdRatio(original)).toBeNull();
    expect(hdRatio(hd4)).toEqual({ x: 4, y: 4 });
    // 工具把结果对齐到 4 的倍数 —— 两个方向倍率不一定相等
    expect(hdRatio({ bitmap: bmp(84, 40), width: 20, height: 10 })).toEqual({ x: 4.2, y: 4 });
  });

  it('★ 测试里的假位图（没有 width）→ 当原图，不许当成超分', () => {
    expect(hdRatio({ bitmap: {} as unknown as ImageBitmap, width: 20, height: 10 })).toBeNull();
    expect(hdRatio({ bitmap: bmp(80, 40), width: 0, height: 0 })).toBeNull();
  });
});

describe('drawSprite', () => {
  it('★ 原图：参数与改造前逐字相同（3 参就是 3 参）', () => {
    const { ctx, calls } = fakeCtx();
    drawSprite(ctx, original, 5, 6);
    drawSprite(ctx, original, 5, 6, 40, 20);
    expect(calls.map((c) => c.args)).toEqual([
      [original.bitmap, 5, 6],
      [original.bitmap, 5, 6, 40, 20],
    ]);
    expect(calls.every((c) => !c.smoothing)).toBe(true);
  });

  it('★ 超分图：塞回逻辑框（不是按位图的 80×40 画），且这一次开平滑、画完还原', () => {
    const { ctx, calls, raw } = fakeCtx();
    drawSprite(ctx, hd4, 5, 6);
    expect(calls[0]!.args).toEqual([hd4.bitmap, 5, 6, 20, 10]);
    expect(calls[0]!.smoothing).toBe(true);
    expect(raw.imageSmoothingEnabled).toBe(false);
    drawSprite(ctx, hd4, 5, 6, 40, 20);
    expect(calls[1]!.args).toEqual([hd4.bitmap, 5, 6, 40, 20]);
  });
});

describe('drawSpriteRegion', () => {
  it('原图：9 参原样', () => {
    const { ctx, calls } = fakeCtx();
    drawSpriteRegion(ctx, original, 1, 2, 3, 4, 5, 6, 7, 8);
    expect(calls[0]!.args).toEqual([original.bitmap, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('★ 超分图：源矩形是**逻辑**坐标，按倍率换算到位图上；目标矩形不变', () => {
    const { ctx, calls } = fakeCtx();
    drawSpriteRegion(ctx, hd4, 1, 2, 3, 4, 5, 6, 7, 8);
    expect(calls[0]!.args).toEqual([hd4.bitmap, 4, 8, 12, 16, 5, 6, 7, 8]);
    expect(calls[0]!.smoothing).toBe(true);
  });
});

describe('surfaceScaleFor', () => {
  it('★ 关着恒为 1 —— 线上默认行为不变', () => {
    expect(surfaceScaleFor(3, false)).toBe(1);
  });

  it('开着：直接取窗口倍数（可以是小数 —— 贴屏才是 1:1、不重采样），封顶 4', () => {
    expect(surfaceScaleFor(1, true)).toBe(1);
    expect(surfaceScaleFor(2, true)).toBe(2);
    expect(surfaceScaleFor(2.4, true)).toBe(2.4);
    expect(surfaceScaleFor(6, true)).toBe(4);
    expect(surfaceScaleFor(Number.NaN, true)).toBe(1);
  });

  it('★ 触屏封顶 2（iPhone 横屏窗口倍数 ≈ 2.44 ⇒ 2），桌面仍封顶 4', () => {
    const touch = surfaceScaleCap({ coarsePointer: true, maxTouchPoints: 5 });
    const ipad = surfaceScaleCap({ coarsePointer: false, maxTouchPoints: 5 });
    const desk = surfaceScaleCap({ coarsePointer: false, maxTouchPoints: 0 });
    expect([touch, ipad, desk]).toEqual([TOUCH_SURFACE_SCALE_CAP, TOUCH_SURFACE_SCALE_CAP, MAX_SURFACE_SCALE]);
    expect(surfaceScaleFor(2.4375, true, touch)).toBe(2);
    expect(surfaceScaleFor(1.6, true, touch)).toBe(1.6);
    expect(surfaceScaleFor(3, true, desk)).toBe(3);
    expect(surfaceScaleFor(3, false, desk)).toBe(1);
  });
});

describe('sizeSurface / drawSurface', () => {
  it('像素 = 逻辑 × s，并挂 s 倍变换', () => {
    const { ctx, transforms } = fakeCtx();
    const canvas = { width: 640, height: 480 } as HTMLCanvasElement;
    expect(sizeSurface({ canvas, ctx }, 640, 480, 3)).toBe(true);
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 1920, h: 1440 });
    expect(transforms.at(-1)).toEqual([3, 0, 0, 3, 0, 0]);
    // 倍率没变就不动尺寸（改 width 会清空画布、重置上下文）
    expect(sizeSurface({ canvas, ctx }, 640, 480, 3)).toBe(false);
  });

  it('★ s = 1 时贴离屏画布仍是 3 参（与改造前相同）；s > 1 按逻辑尺寸贴', () => {
    const { ctx, calls } = fakeCtx();
    const src = {} as HTMLCanvasElement;
    drawSurface(ctx, src, 0, 40, 439, 440, 1);
    drawSurface(ctx, src, 0, 40, 439, 440, 2);
    expect(calls.map((c) => c.args)).toEqual([
      [src, 0, 40],
      [src, 0, 40, 439, 440],
    ]);
  });
});

describe('surfaceScaleOf', () => {
  it('读当前变换的 a；假上下文（没有 getTransform）按 1', () => {
    expect(surfaceScaleOf({} as CanvasRenderingContext2D)).toBe(1);
    const ctx = { getTransform: () => ({ a: 3 }) as DOMMatrix } as unknown as CanvasRenderingContext2D;
    expect(surfaceScaleOf(ctx)).toBe(3);
  });
});

describe('hdStageRequested', () => {
  it('★ 默认开（2026-09-24 上线）；?hd=0 关、?hd=1 开（URL 优先于 localStorage）', () => {
    expect(hdStageRequested('', null)).toBe(true);
    expect(hdStageRequested('?hd=1', '0')).toBe(true);
    expect(hdStageRequested('?hd=0', '1')).toBe(false);
    expect(hdStageRequested('?hd=false', null)).toBe(false);
    expect(hdStageRequested('?humans=1', '1')).toBe(true);
    // 本机记过「关」
    expect(hdStageRequested('?humans=1', '0')).toBe(false);
    expect(hdStageRequested('', '0')).toBe(false);
  });
});
