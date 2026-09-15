/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 回填校验 + Alpha 合并 + 去彩边（T-062）
 */

import { describe, expect, it } from 'vitest';
import type { DecodedImage } from './sprite.ts';
import { sliceFrame, type QueueFrame } from './slice.ts';
import {
  ALPHA_THRESHOLD,
  binarizeAlpha,
  deFringe,
  expectedSize,
  mergeUpscaled,
  rebleedTransparent,
  validatePair,
} from './merge.ts';

/** RGBA 四元组 → DecodedImage（行优先） */
function makeImage(
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number, number])[],
): DecodedImage {
  expect(pixels.length).toBe(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], i) => rgba.set([r, g, b, a], i * 4));
  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

/** 灰度四元组快捷构造（alpha 灰度图形式：r=g=b=v，a=255） */
function grayImage(
  width: number,
  height: number,
  values: readonly number[],
): DecodedImage {
  expect(values.length).toBe(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  values.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

const T = [0, 0, 0, 0] as const;
const RED = [200, 10, 20, 255] as const;

const frame = (over: Partial<QueueFrame> = {}): QueueFrame => ({
  id: 'Data/0002_000',
  rgb: 'rgb/Data/0002_f000.png',
  alpha: 'alpha/Data/0002_f000.png',
  width: 8,
  height: 8,
  anchorX: 4,
  anchorY: 4,
  category: 'sprite',
  model: 'realesrgan-x4plus-anime',
  scale: 4,
  batch: 'tiny',
  rgbSha256: 'in-rgb',
  alphaSha256: 'in-alpha',
  ...over,
});

describe('binarizeAlpha（阈值 128）', () => {
  it('127 → 0，128 → 255，0/255 原样', () => {
    const a = binarizeAlpha(grayImage(4, 1, [127, 128, 0, 255]));
    expect(a.rgba[0]).toBe(0);
    expect(a.rgba[4]).toBe(255);
    expect(a.rgba[8]).toBe(0);
    expect(a.rgba[12]).toBe(255);
    // 输出仍是等灰 RGB 形式
    expect([...a.rgba.slice(4, 8)]).toEqual([255, 255, 255, 255]);
  });

  it('阈值可覆盖', () => {
    const a = binarizeAlpha(grayImage(2, 1, [99, 101]), 100);
    expect(a.rgba[0]).toBe(0);
    expect(a.rgba[4]).toBe(255);
  });

  it('阈值常量就是 128', () => {
    expect(ALPHA_THRESHOLD).toBe(128);
  });
});

describe('deFringe（alpha 边界像素 3×3 中值）', () => {
  it('边界像素的串色被邻域不透明像素的中值压掉', () => {
    // 3×3：中心是串色（250,100,200），周围 7 红 + 1 透明角
    const FRINGE = [250, 100, 200, 255] as const;
    const img = makeImage(3, 3, [T, RED, RED, RED, FRINGE, RED, RED, RED, RED]);
    const out = deFringe(img);
    // 中心是边界（左上角透明）→ 中值 = 红
    expect([out.rgba[16], out.rgba[17], out.rgba[18]]).toEqual([200, 10, 20]);
  });

  it('内部像素（8 邻域全不透明）原样保留，哪怕是「怪色」', () => {
    const ODD = [99, 88, 77, 255] as const;
    const img = makeImage(3, 3, [RED, RED, RED, RED, ODD, RED, RED, RED, RED]);
    const out = deFringe(img);
    expect([out.rgba[16], out.rgba[17], out.rgba[18]]).toEqual([99, 88, 77]);
  });

  it('透明像素不动', () => {
    const img = makeImage(3, 3, [T, RED, RED, RED, RED, RED, RED, RED, RED]);
    const out = deFringe(img);
    expect([...out.rgba.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it('偶数个邻域取**下中值**（确定性）', () => {
    // 中心 + 仅 1 个不透明邻居 + 其余透明：2 个样本取下中值 = 较小者
    const DARK = [100, 0, 0, 255] as const;
    const img = makeImage(3, 1, [DARK, RED, T]);
    const out = deFringe(img);
    // 中心(RED)是边界；3×3 内不透明 = {DARK, RED}，r 中值 = min(100,200)=100
    expect([out.rgba[4], out.rgba[5], out.rgba[6]]).toEqual([100, 0, 0]);
  });
});

describe('rebleedTransparent（边缘 1px 内 RGB 用最近不透明色填）', () => {
  it('透明像素填最近不透明色，不透明像素原样', () => {
    const img = makeImage(4, 1, [T, T, RED, T]);
    const out = rebleedTransparent(img);
    expect([...out.rgba.slice(0, 3)]).toEqual([200, 10, 20]); // 填色
    expect(out.rgba[3]).toBe(0); // 仍是透明
    expect([...out.rgba.slice(8, 12)]).toEqual([200, 10, 20, 255]); // 原样
  });
});

// ============================================================
//  ★ 全不透明快路径（Q-GND-4 的底图：9216² 上一份副本就是 324MB）
// ============================================================

describe('★ 全不透明的图（地图底图）不产生多余副本', () => {
  it('binarizeAlpha 对**规范**的全不透明输入原样返回（同一个对象）', () => {
    const a = grayImage(3, 1, [255, 255, 255]);
    expect(binarizeAlpha(a)).toBe(a);
  });

  it('★ 非规范输入仍照常归一化（r≥阈值但 a≠255 / 三通道不等灰）', () => {
    const weird = makeImage(2, 1, [
      [255, 255, 255, 0],
      [200, 100, 50, 255],
    ]);
    const out = binarizeAlpha(weird);
    expect(out).not.toBe(weird);
    expect([...out.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...out.rgba.slice(4, 8)]).toEqual([255, 255, 255, 255]);
  });

  it('低于阈值的输入不会被当成「已经二值化」', () => {
    const a = grayImage(2, 1, [0, 255]);
    const out = binarizeAlpha(a);
    expect(out).not.toBe(a);
    expect([out.rgba[0], out.rgba[4]]).toEqual([0, 255]);
  });

  it('★ deFringe / rebleedTransparent 在全不透明图上原样返回（不复制、不改）', () => {
    const merged = makeImage(2, 1, [RED, RED]);
    expect(deFringe(merged)).toBe(merged);
    expect(rebleedTransparent(merged)).toBe(merged);
  });

  it('★ 全不透明图走完 mergeUpscaled：像素一字不变，且没有多出的中间副本', () => {
    const rgb = makeImage(2, 1, [RED, RED]);
    const alpha = grayImage(2, 1, [255, 255]);
    const out = mergeUpscaled(rgb, alpha);
    expect([...out.rgba]).toEqual([...rgb.rgba]);
    // 返回的是 mergeFrame 那一份新数组；deFringe/rebleed 没有再各复制一份
    expect(out.rgba).not.toBe(rgb.rgba);
  });
});

describe('mergeUpscaled（8×8 样本全链路）', () => {
  /** 8×8：中央 4×4 红方块，四周透明 */
  const src8 = makeImage(8, 8, Array.from({ length: 64 }, (_, i) => {
    const x = i % 8;
    const y = Math.floor(i / 8);
    return x >= 2 && x < 6 && y >= 2 && y < 6 ? RED : T;
  }));

  /** 最近邻 ×4 模拟「外部超分」 */
  const nn4 = (img: DecodedImage): DecodedImage => {
    const w = img.width * 4;
    const h = img.height * 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (Math.floor(y / 4) * img.width + Math.floor(x / 4)) * 4;
        rgba.set(img.rgba.subarray(s, s + 4), (y * w + x) * 4);
      }
    }
    return { width: w, height: h, anchorX: 0, anchorY: 0, rgba };
  };

  it('最近邻 ×4 的「超分」产物合并后：形状精确 ×4、alpha 二值、RGB 无串色', () => {
    const { rgb, alpha } = sliceFrame(src8);
    const merged = mergeUpscaled(nn4(rgb), nn4(alpha));
    expect(merged.width).toBe(32);
    expect(merged.height).toBe(32);
    for (let i = 0; i < 32 * 32; i++) {
      const x = i % 32;
      const y = Math.floor(i / 32);
      const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
      const a = merged.rgba[i * 4 + 3];
      if (inside) {
        expect(a).toBe(255);
        // 单色方块：边界中值 = 自身颜色，无串色
        expect([merged.rgba[i * 4], merged.rgba[i * 4 + 1], merged.rgba[i * 4 + 2]]).toEqual([200, 10, 20]);
      } else {
        expect(a).toBe(0);
      }
    }
  });

  it('放大后的半透明过渡被二值化收编', () => {
    // rgb 全红；alpha 一行 [0, 100, 200, 255] → 二值化后 [0,0,255,255]
    const rgb = makeImage(4, 1, [RED, RED, RED, RED]);
    const alpha = grayImage(4, 1, [0, 100, 200, 255]);
    const merged = mergeUpscaled(rgb, alpha);
    // 透明像素的 alpha 必为 0；RGB 被重 bleed 成最近不透明色（防黑边）
    expect(merged.rgba[3]).toBe(0);
    expect(merged.rgba[7]).toBe(0);
    expect([merged.rgba[0], merged.rgba[1], merged.rgba[2]]).toEqual([200, 10, 20]);
    expect([...merged.rgba.slice(8, 12)]).toEqual([200, 10, 20, 255]);
    expect([...merged.rgba.slice(12, 16)]).toEqual([200, 10, 20, 255]);
  });

  it('rgb 与 alpha 尺寸互不一致时抛错', () => {
    const rgb = makeImage(4, 1, [RED, RED, RED, RED]);
    const alpha = grayImage(2, 2, [255, 255, 255, 255]);
    expect(() => mergeUpscaled(rgb, alpha)).toThrow(/尺寸不一致/);
  });
});

describe('validatePair（回填校验）', () => {
  const good32 = makeImage(32, 32, new Array(1024).fill(RED));
  const goodAlpha32 = grayImage(32, 32, new Array(1024).fill(255));

  it('期望尺寸 = 原图 × 清单倍率（8×8 ×4 → 32×32）', () => {
    expect(expectedSize(frame())).toEqual({ width: 32, height: 32 });
  });

  it('两张都没交 → absent（不是错误）', () => {
    expect(validatePair(frame(), null, null)).toEqual({ kind: 'absent' });
  });

  it('缺 rgb / 缺 alpha → 拒', () => {
    expect(validatePair(frame(), null, goodAlpha32)).toMatchObject({
      kind: 'reject',
      rejection: { reason: 'missing-rgb' },
    });
    expect(validatePair(frame(), good32, null)).toMatchObject({
      kind: 'reject',
      rejection: { reason: 'missing-alpha' },
    });
  });

  it('★ 坏尺寸被拒：31×32 ≠ 8×8 ×4', () => {
    const bad = makeImage(31, 32, new Array(31 * 32).fill(RED));
    const badA = grayImage(31, 32, new Array(31 * 32).fill(255));
    const v = validatePair(frame(), bad, badA);
    expect(v).toMatchObject({ kind: 'reject', rejection: { reason: 'size-mismatch' } });
    if (v.kind === 'reject') expect(v.rejection.detail).toContain('32×32');
  });

  it('★ 坏尺寸被拒：只放大了 2 倍（16×16）也不收', () => {
    const half = makeImage(16, 16, new Array(256).fill(RED));
    const halfA = grayImage(16, 16, new Array(256).fill(255));
    expect(validatePair(frame(), half, halfA)).toMatchObject({
      kind: 'reject',
      rejection: { reason: 'size-mismatch' },
    });
  });

  it('rgb 与 alpha 尺寸互不一致 → 拒', () => {
    const a16 = grayImage(16, 16, new Array(256).fill(255));
    expect(validatePair(frame(), good32, a16)).toMatchObject({
      kind: 'reject',
      rejection: { reason: 'pair-mismatch' },
    });
  });

  it('产物与输入哈希相同（疑似没处理）→ 拒；哈希不同 → 收', () => {
    expect(
      validatePair(frame(), good32, goodAlpha32, { rgbSha256: 'in-rgb' }),
    ).toMatchObject({ kind: 'reject', rejection: { reason: 'unchanged' } });
    expect(
      validatePair(frame(), good32, goodAlpha32, { rgbSha256: 'out-rgb', alphaSha256: 'out-alpha' }),
    ).toEqual({ kind: 'ok' });
  });

  it('合格对 → ok', () => {
    expect(validatePair(frame(), good32, goodAlpha32)).toEqual({ kind: 'ok' });
  });

  it('rejection 带上清单 id 便于列出', () => {
    const v = validatePair(frame({ id: 'Panel/0007_002' }), null, goodAlpha32);
    if (v.kind === 'reject') expect(v.rejection.id).toBe('Panel/0007_002');
    else throw new Error('应被拒绝');
  });
});
