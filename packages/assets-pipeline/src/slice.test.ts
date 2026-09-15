/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 按帧切片 + Alpha 分离（T-061）
 */

import { describe, expect, it } from 'vitest';
import { type DecodedImage } from './sprite.ts';
import { decodePng, encodePng, PngFormatError } from './png.ts';
import {
  bleedColors,
  buildQueueFrame,
  mergeFrame,
  queuePaths,
  sliceFrame,
  suggestedModel,
  SUGGESTED_MODEL,
} from './slice.ts';
import type { AssetCategory } from './classify.ts';
import type { UpscaleTask } from './upscale.ts';

/** RGBA 四元组 → DecodedImage（行优先） */
function makeImage(
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number, number])[],
  anchorX = 0,
  anchorY = 0,
): DecodedImage {
  expect(pixels.length).toBe(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], i) => {
    rgba.set([r, g, b, a], i * 4);
  });
  return { width, height, anchorX, anchorY, rgba };
}

const T: readonly [number, number, number, number] = [0, 0, 0, 0]; // 规范透明形
const RED = [200, 10, 20, 255] as const;
const GREEN = [10, 200, 20, 255] as const;
const BLUE = [10, 20, 200, 255] as const;
const YELLOW = [220, 210, 30, 255] as const;

describe('bleedColors（透明像素填最近不透明色）', () => {
  it('一维：单侧不透明，透明区全部填该色', () => {
    const img = makeImage(4, 1, [RED, T, T, T]);
    const rgb = bleedColors(img.width, img.height, img.rgba);
    for (let i = 0; i < 4; i++) {
      expect([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]).toEqual([200, 10, 20]);
    }
  });

  it('一维：两侧不同色，按曼哈顿距离就近取色', () => {
    // idx2 距红 2 格、距蓝 2 格 → 等距，由行优先源序（红先入队）赢得
    const img = makeImage(5, 1, [RED, T, T, T, BLUE]);
    const rgb = bleedColors(img.width, img.height, img.rgba);
    const colorAt = (i: number) => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    expect(colorAt(1)).toEqual([200, 10, 20]); // 红
    expect(colorAt(2)).toEqual([200, 10, 20]); // 等距 → 红（确定性）
    expect(colorAt(3)).toEqual([10, 20, 200]); // 蓝
  });

  it('二维：中心与四角等距时，行优先的左上角赢得（确定性 tie-break）', () => {
    const img = makeImage(3, 3, [RED, T, GREEN, T, T, T, BLUE, T, YELLOW]);
    const rgb = bleedColors(img.width, img.height, img.rgba);
    const center = [rgb[4 * 3], rgb[4 * 3 + 1], rgb[4 * 3 + 2]];
    expect(center).toEqual([200, 10, 20]); // 红（左上角）
  });

  it('逐次运行结果完全一致（确定性）', () => {
    const img = makeImage(3, 3, [RED, T, GREEN, T, T, T, BLUE, T, YELLOW]);
    const a = bleedColors(img.width, img.height, img.rgba);
    const b = bleedColors(img.width, img.height, img.rgba);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('全透明图：不崩溃，填 0', () => {
    const img = makeImage(2, 2, [T, T, T, T]);
    const rgb = bleedColors(img.width, img.height, img.rgba);
    expect([...rgb]).toEqual(new Array(12).fill(0));
  });

  it('rgba 长度与尺寸不符时抛错', () => {
    expect(() => bleedColors(2, 2, new Uint8ClampedArray(3 * 4))).toThrow(/不符/);
  });
});

describe('sliceFrame（分离 rgb / alpha）', () => {
  it('alpha 通道以等灰 RGB 形式承载，含半透明值', () => {
    const img = makeImage(3, 1, [RED, T, [1, 2, 3, 128]]);
    const { rgb, alpha } = sliceFrame(img);
    // 灰度值 = 原 alpha
    expect([...alpha.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...alpha.rgba.slice(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...alpha.rgba.slice(8, 12)]).toEqual([128, 128, 128, 255]);
    // rgb 图整体不透明
    expect(rgb.rgba[3]).toBe(255);
    expect(rgb.rgba[7]).toBe(255);
    expect(rgb.rgba[11]).toBe(255);
  });

  it('rgb 图：不透明像素原样，透明像素被 bleed 填充', () => {
    const img = makeImage(3, 1, [RED, T, RED]);
    const { rgb } = sliceFrame(img);
    expect([...rgb.rgba.slice(0, 3)]).toEqual([200, 10, 20]);
    expect([...rgb.rgba.slice(4, 7)]).toEqual([200, 10, 20]); // 填充色
    expect([...rgb.rgba.slice(8, 11)]).toEqual([200, 10, 20]);
  });

  it('锚点：rgb 沿用原图，alpha 归零（真锚点在清单里）', () => {
    const img = makeImage(1, 1, [RED], 7, 9);
    const { rgb, alpha } = sliceFrame(img);
    expect([rgb.anchorX, rgb.anchorY]).toEqual([7, 9]);
    expect([alpha.anchorX, alpha.anchorY]).toEqual([0, 0]);
  });
});

describe('往返：mergeFrame(sliceFrame(img)) 逐字节等于原图（不放大）', () => {
  const cases: Array<[string, DecodedImage]> = [
    ['带空洞的精灵', makeImage(5, 5, [
      T, T, RED, T, T,
      T, RED, RED, RED, T,
      GREEN, RED, T, RED, GREEN,
      T, RED, RED, RED, T,
      T, T, BLUE, T, T,
    ], 2, 3)],
    ['全不透明', makeImage(2, 2, [RED, GREEN, BLUE, YELLOW])],
    ['全透明', makeImage(3, 2, [T, T, T, T, T, T])],
    ['1×1 透明', makeImage(1, 1, [T])],
    ['1×1 不透明', makeImage(1, 1, [RED])],
    ['含半透明像素', makeImage(2, 1, [[1, 2, 3, 128], T])],
  ];

  for (const [name, img] of cases) {
    it(name, () => {
      const merged = mergeFrame(sliceFrame(img).rgb, sliceFrame(img).alpha);
      expect(Buffer.from(merged.rgba).equals(Buffer.from(img.rgba))).toBe(true);
      expect(merged.width).toBe(img.width);
      expect(merged.height).toBe(img.height);
      expect([merged.anchorX, merged.anchorY]).toEqual([img.anchorX, img.anchorY]);
    });
  }

  it('PNG 层面也逐字节相等（encodePng 确定性）', () => {
    const img = makeImage(4, 3, [
      T, RED, T, GREEN,
      RED, T, BLUE, T,
      T, YELLOW, T, T,
    ]);
    const { rgb, alpha } = sliceFrame(img);
    const merged = mergeFrame(rgb, alpha);
    expect(Buffer.from(encodePng(merged)).equals(Buffer.from(encodePng(img)))).toBe(true);
  });

  it('经过 PNG 编解码的完整链路：原图→切片→落盘编码→读回→合并 ≡ 原图', () => {
    const img = makeImage(3, 3, [
      T, RED, T,
      GREEN, T, BLUE,
      T, YELLOW, T,
    ], 1, 1);
    const { rgb, alpha } = sliceFrame(img);
    const rgbBack = decodePng(encodePng(rgb));
    const alphaBack = decodePng(encodePng(alpha));
    const merged = mergeFrame(
      { ...rgbBack, anchorX: img.anchorX, anchorY: img.anchorY },
      alphaBack,
    );
    expect(Buffer.from(merged.rgba).equals(Buffer.from(img.rgba))).toBe(true);
  });
});

describe('mergeFrame 的输入校验', () => {
  it('rgb 与 alpha 尺寸不一致时抛错', () => {
    const rgb = makeImage(2, 2, [RED, RED, RED, RED]);
    const alpha = makeImage(1, 1, [T]);
    expect(() => mergeFrame(rgb, alpha)).toThrow(/尺寸不一致/);
  });
});

describe('decodePng（encodePng 的逆运算）', () => {
  it('含透明像素的图往返一致', () => {
    const img = makeImage(3, 2, [RED, T, GREEN, T, BLUE, T]);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(3);
    expect(back.height).toBe(2);
    expect(Buffer.from(back.rgba).equals(Buffer.from(img.rgba))).toBe(true);
  });

  it('垃圾输入抛 PngFormatError', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(PngFormatError);
    expect(() => decodePng(new Uint8Array(100))).toThrow(PngFormatError);
  });

  it('不支持的色彩类型（3=调色板）抛 PngFormatError', () => {
    const png = encodePng(makeImage(1, 1, [RED]));
    const patched = new Uint8Array(png);
    patched[8 + 8 + 9] = 3; // IHDR 数据的 color type 字节
    expect(() => decodePng(patched)).toThrow(PngFormatError);
  });
});

describe('队列清单（upscale-queue/manifest.json）', () => {
  const task: UpscaleTask = {
    id: 'Data/0004_001',
    archive: 'Data',
    resource: 4,
    image: 1,
    input: 'Data/0004_001.png',
    srcWidth: 48,
    srcHeight: 32,
    srcAnchorX: 24,
    srcAnchorY: 16,
    format: 'SPR',
    category: 'sprite',
    scale: 4,
    batch: 'small',
  };

  it('queuePaths 命名 <档案>/<资源>_f<帧>.png', () => {
    expect(queuePaths(task)).toEqual({
      rgb: 'rgb/Data/0004_f001.png',
      alpha: 'alpha/Data/0004_f001.png',
    });
  });

  it('buildQueueFrame 带上原尺寸、锚点、类别、模型建议与哈希', () => {
    const f = buildQueueFrame(task, { rgbSha256: 'aa', alphaSha256: 'bb' });
    expect(f).toEqual({
      id: 'Data/0004_001',
      rgb: 'rgb/Data/0004_f001.png',
      alpha: 'alpha/Data/0004_f001.png',
      width: 48,
      height: 32,
      anchorX: 24,
      anchorY: 16,
      category: 'sprite',
      model: 'realesrgan-x4plus-anime',
      scale: 4,
      batch: 'small',
      rgbSha256: 'aa',
      alphaSha256: 'bb',
    });
  });

  it('五个类别都有模型建议；字体建议 skip（换高清字体）', () => {
    const categories: AssetCategory[] = ['ui', 'tile', 'sprite', 'background', 'font'];
    for (const c of categories) {
      expect(suggestedModel(c)).toBe(SUGGESTED_MODEL[c]);
      expect(typeof suggestedModel(c)).toBe('string');
      expect(suggestedModel(c).length).toBeGreaterThan(0);
    }
    expect(suggestedModel('font')).toBe('skip');
    expect(suggestedModel('sprite')).toContain('anime');
  });
});

// ============================================================
//  ★ 全不透明快路径（Q-GND-4 的底图）
// ============================================================

describe('★ 全不透明的图（地图底图）走快路径', () => {
  it('bleedColors 直接抄 RGB —— 每个像素自己就是源，BFS 一步都不扩散', () => {
    const img = makeImage(4, 1, [RED, GREEN, BLUE, YELLOW]);
    const rgb = bleedColors(img.width, img.height, img.rgba);
    expect([...rgb]).toEqual([
      200, 10, 20,
      10, 200, 20,
      10, 20, 200,
      220, 210, 30,
    ]);
  });

  it('★ 快路径与 BFS 的结论一致：切片往返仍逐字节相等', () => {
    const img = makeImage(4, 1, [RED, GREEN, BLUE, YELLOW]);
    const { rgb, alpha } = sliceFrame(img);
    // 颜色通道原样；alpha 通道全 255（这幅图没有透明像素）
    expect([...rgb.rgba.slice(0, 12)]).toEqual([200, 10, 20, 255, 10, 200, 20, 255, 10, 20, 200, 255]);
    expect(alpha.rgba[0]).toBe(255);
    expect(mergeFrame(rgb, alpha).rgba).toEqual(img.rgba);
  });
});
