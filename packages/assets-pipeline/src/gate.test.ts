/*
 * 回缩比对自动闸（W-80 §4.1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事：面积平均缩小本身算得对（含非整数倍、alpha 预乘）；色彩换算与接缝那道闸
 * 是同一把尺子；忠实放大必过、挪了位或换了色必被打回。
 */

import { describe, expect, it } from 'vitest';
import type { DecodedImage } from './sprite.ts';
import { srgbToLab } from './seams.ts';
import {
  DEFAULT_GATE_THRESHOLDS,
  downscaleArea,
  gateCompare,
  rgbToLab,
  summarizeGate,
  worstRows,
  type GateRow,
} from './gate.ts';

// ============================================================
//  夹具
// ============================================================

type Px = readonly [number, number, number, number];

function image(width: number, height: number, at: (x: number, y: number) => Px, anchorX = 0, anchorY = 0): DecodedImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(at(x, y), (y * width + x) * 4);
  return { width, height, anchorX, anchorY, rgba };
}

const px = (img: DecodedImage, x: number, y: number): number[] =>
  [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

/** 最近邻放大（可非整数倍）—— 「忠实放大、没补任何东西」 */
function nearest(img: DecodedImage, w: number, h: number): DecodedImage {
  return image(w, h, (x, y) => {
    const sx = Math.min(img.width - 1, Math.floor((x * img.width) / w));
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
    return px(img, sx, sy) as unknown as Px;
  });
}

const T: Px = [0, 0, 0, 0];

/** 一张 16×12 的「精灵」：透明底上一个两色的块，边上带一圈别的颜色 */
function sprite(): DecodedImage {
  return image(16, 12, (x, y) => {
    if (x < 3 || x > 12 || y < 2 || y > 10) return T;
    if (x === 3 || x === 12) return [240, 200, 40, 255];
    return y < 6 ? [200, 30, 40, 255] : [30, 60, 200, 255];
  });
}

// ============================================================
//  downscaleArea
// ============================================================

describe('downscaleArea（面积平均缩小）', () => {
  it('整数倍：每个输出像素是 k×k 块的均值', () => {
    const img = image(4, 2, (x) => (x < 2 ? [0, 0, 0, 255] : [100, 200, 40, 255]));
    // 左块全 0，右块全 (100,200,40)；2×2 → 1 像素
    const d = downscaleArea(img, 2, 1);
    expect(px(d, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(d, 1, 0)).toEqual([100, 200, 40, 255]);

    const mixed = image(2, 2, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0, 255] : [200, 100, 50, 255]));
    expect(px(downscaleArea(mixed, 1, 1), 0, 0)).toEqual([100, 50, 25, 255]);
  });

  it('★ 非整数倍（3 → 2）：按真实覆盖面积加权（1 + ½ 与 ½ + 1）', () => {
    const img = image(3, 1, (x) => [[0, 0, 0, 255], [90, 90, 90, 255], [180, 180, 180, 255]][x] as unknown as Px);
    const d = downscaleArea(img, 2, 1);
    // 输出 0 覆盖 [0,1.5)：0×(2/3) + 90×(1/3) = 30；输出 1 覆盖 [1.5,3)：90×(1/3) + 180×(2/3) = 150
    expect(px(d, 0, 0)).toEqual([30, 30, 30, 255]);
    expect(px(d, 1, 0)).toEqual([150, 150, 150, 255]);
  });

  it('非整数倍（10 → 4，每个输出吃 2.5 个源像素）：分界落在 2.5 的整数倍上时逐像素还原', () => {
    const img = image(10, 3, (x) => (x < 5 ? [10, 20, 30, 255] : [200, 150, 100, 255]));
    const d = downscaleArea(img, 4, 1);
    expect([0, 1, 2, 3].map((x) => px(d, x, 0))).toEqual([
      [10, 20, 30, 255],
      [10, 20, 30, 255],
      [200, 150, 100, 255],
      [200, 150, 100, 255],
    ]);
  });

  it('★ alpha 预乘：透明像素里的填充色不掺进颜色', () => {
    // 左半不透明红、右半透明但 RGB 是 bleed 出来的「垃圾绿」
    const img = image(2, 1, (x) => (x === 0 ? [200, 0, 0, 255] : [0, 255, 0, 0]));
    const d = downscaleArea(img, 1, 1);
    expect(px(d, 0, 0)).toEqual([200, 0, 0, 128]); // 颜色纯红，alpha 为面积均值
  });

  it('全透明区域写规范透明形 (0,0,0,0)', () => {
    const img = image(4, 4, () => [50, 60, 70, 0]);
    expect([...downscaleArea(img, 2, 2).rgba]).toEqual(new Array(16).fill(0));
  });

  it('锚点按实际比例同步缩放（C-AST-6）', () => {
    const img = image(8, 8, () => [1, 2, 3, 255], 6, 2);
    const d = downscaleArea(img, 2, 2);
    expect({ x: d.anchorX, y: d.anchorY }).toEqual({ x: 2, y: 1 });
  });

  it('只缩不放；尺寸不合法就抛', () => {
    const img = image(4, 4, () => [0, 0, 0, 255]);
    expect(() => downscaleArea(img, 5, 4)).toThrow(/只缩不放/);
    expect(() => downscaleArea(img, 0, 4)).toThrow(/不合法/);
    expect(() => downscaleArea(img, 2.5, 2)).toThrow(/不合法/);
  });
});

// ============================================================
//  rgbToLab
// ============================================================

describe('rgbToLab（sRGB → CIE Lab D65）', () => {
  it('白 / 黑 / 纯红与公认参考值一致', () => {
    const w = rgbToLab(255, 255, 255);
    expect(w.l).toBeCloseTo(100, 2);
    expect(w.a).toBeCloseTo(0, 2);
    expect(w.b).toBeCloseTo(0, 2);
    const k = rgbToLab(0, 0, 0);
    expect(k.l).toBeCloseTo(0, 6);
    expect(k.a).toBeCloseTo(0, 6);
    expect(k.b).toBeCloseTo(0, 6);
    const r = rgbToLab(255, 0, 0);
    expect(r.l).toBeCloseTo(53.24, 1);
    expect(r.a).toBeCloseTo(80.09, 1);
    expect(r.b).toBeCloseTo(67.2, 1);
  });

  it('★ 与接缝检查用的是同一份实现（两道闸一把尺子）', () => {
    expect(rgbToLab).toBe(srgbToLab);
  });
});

// ============================================================
//  gateCompare
// ============================================================

describe('gateCompare（回缩比对）', () => {
  it('★ 忠实的最近邻 4×：IoU = 1、ΔE = 0，过', () => {
    const src = sprite();
    const m = gateCompare(src, nearest(src, 64, 48));
    expect(m.iou).toBe(1);
    expect(m.meanDeltaE).toBe(0);
    expect(m.p95DeltaE).toBe(0);
    expect(m.opaqueBoth).toBe(10 * 9);
    expect(m.pass).toBe(true);
    expect(m.reasons).toEqual([]);
  });

  it('★ 非整数倍（外部工具对齐成 2.5×）同样过', () => {
    // 平滑渐变的精灵：2.5× 最近邻缩回去时，跨界的那半个像素只掺进相邻的近色，
    // 透明边上掺进来的那一份被 alpha 预乘挡掉、二值化后轮廓不变
    const src = image(16, 12, (x, y) =>
      x < 3 || x > 12 || y < 2 || y > 10 ? T : [100 + 5 * x, 80 + 4 * y, 150 - 3 * x, 255],
    );
    const m = gateCompare(src, nearest(src, 40, 30));
    expect(m.iou).toBe(1);
    expect(m.meanDeltaE).toBeLessThan(2);
    expect(m.pass).toBe(true);
  });

  it('补了细节（块内加噪、块均值不变）：仍过', () => {
    const src = sprite();
    const up = nearest(src, 64, 48);
    // 每个 4×4 块里 ±12 的棋盘噪声：细节变了，缩回去的均值不变
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const o = (y * 64 + x) * 4;
        if (up.rgba[o + 3] === 0) continue;
        const s = (x + y) % 2 === 0 ? 12 : -12;
        for (let c = 0; c < 3; c++) up.rgba[o + c] = up.rgba[o + c]! + s;
      }
    }
    const m = gateCompare(src, up);
    expect(m.iou).toBe(1);
    expect(m.meanDeltaE).toBeLessThan(1);
    expect(m.pass).toBe(true);
  });

  it('★ 挪了位（整体右移 2 个原像素）：IoU 掉下去，打回', () => {
    const src = sprite();
    const shifted = image(16, 12, (x, y) => (x >= 2 ? (px(src, x - 2, y) as unknown as Px) : T));
    const m = gateCompare(src, nearest(shifted, 64, 48));
    expect(m.iou).toBeLessThan(DEFAULT_GATE_THRESHOLDS.minIou);
    expect(m.pass).toBe(false);
    expect(m.reasons.some((r) => r.includes('IoU'))).toBe(true);
  });

  it('★ 换了色（红 → 绿）：轮廓不变，ΔE 超标，打回', () => {
    const src = sprite();
    const recolored = image(16, 12, (x, y) => {
      const p = px(src, x, y);
      return p[0] === 200 ? [30, 200, 40, 255] : (p as unknown as Px);
    });
    const m = gateCompare(src, nearest(recolored, 64, 48));
    expect(m.iou).toBe(1);
    expect(m.meanDeltaE).toBeGreaterThan(DEFAULT_GATE_THRESHOLDS.maxMeanDeltaE);
    expect(m.pass).toBe(false);
    expect(m.reasons.some((r) => r.includes('均值'))).toBe(true);
  });

  it('★ 一小块被画成别的东西：均值被摊薄也过不了 95 分位', () => {
    const src = image(20, 20, () => [120, 120, 120, 255]);
    // 5% 以上的像素（一整列 20 + 半列）换成亮黄
    const damaged = image(20, 20, (x, y) => (x === 0 || (x === 1 && y < 10) ? [250, 240, 20, 255] : [120, 120, 120, 255]));
    const m = gateCompare(src, nearest(damaged, 80, 80), { minIou: 0.97, maxMeanDeltaE: 100, maxP95DeltaE: 15 });
    expect(m.p95DeltaE).toBeGreaterThan(15);
    expect(m.pass).toBe(false);
    expect(m.reasons.some((r) => r.includes('95'))).toBe(true);
  });

  it('两边都全透明：IoU 定义为 1、无色差样本，过', () => {
    const empty = image(4, 4, () => T);
    const m = gateCompare(empty, image(16, 16, () => T));
    expect(m).toMatchObject({ iou: 1, opaqueBoth: 0, meanDeltaE: 0, p95DeltaE: 0, pass: true });
  });

  it('一边全透明、另一边有东西：IoU = 0，打回', () => {
    const empty = image(4, 4, () => T);
    const m = gateCompare(empty, image(16, 16, () => [9, 9, 9, 255]));
    expect(m.iou).toBe(0);
    expect(m.pass).toBe(false);
  });

  it('HD 比原图还小：抛（CLI 记为打回）', () => {
    expect(() => gateCompare(sprite(), image(8, 6, () => T))).toThrow(/只缩不放/);
  });
});

// ============================================================
//  报告
// ============================================================

describe('报告汇总', () => {
  const rows: GateRow[] = [
    { id: 'a', hd: 'a', pass: true, reasons: [], iou: 1, meanDeltaE: 0.5, p95DeltaE: 1 },
    { id: 'b', hd: 'b', pass: false, reasons: ['x'], iou: 0.99, meanDeltaE: 9, p95DeltaE: 20 },
    { id: 'c', hd: 'c', pass: false, reasons: ['缺 hd 产物'] },
    { id: 'd', hd: 'd', pass: false, reasons: ['y'], iou: 0.5, meanDeltaE: 1, p95DeltaE: 2 },
  ];

  it('计数', () => {
    expect(summarizeGate(rows)).toEqual({ checked: 4, passed: 1, failed: 3 });
  });

  it('最差的排前：没算出指标的最前，其次 IoU 塌掉的，再次色差大的；过了的不列', () => {
    expect(worstRows(rows).map((r) => r.id)).toEqual(['c', 'd', 'b']);
    expect(worstRows(rows, 1).map((r) => r.id)).toEqual(['c']);
  });
});
