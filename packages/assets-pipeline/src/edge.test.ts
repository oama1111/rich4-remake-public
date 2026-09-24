/*
 * 超分精灵边缘处理 —— 轮廓平滑 + 背景残色清理
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { cleanEdges, edgeDistance, labToSrgb, smoothAlpha } from './edge.ts';
import { srgbToLab } from './seams.ts';
import { mergeUpscaled } from './merge.ts';
import type { DecodedImage } from './sprite.ts';

const img = (w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): DecodedImage => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(px(x, y), (y * w + x) * 4);
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba };
};
/** 最近邻放大 k 倍（模拟「原图按像素阶梯放大」） */
const nn = (src: DecodedImage, k: number): DecodedImage =>
  img(src.width * k, src.height * k, (x, y) => {
    const i = (Math.floor(y / k) * src.width + Math.floor(x / k)) * 4;
    return [src.rgba[i]!, src.rgba[i + 1]!, src.rgba[i + 2]!, src.rgba[i + 3]!];
  });
const gray = (v: (x: number, y: number) => number, w: number, h: number): DecodedImage =>
  img(w, h, (x, y) => {
    const g = v(x, y);
    return [g, g, g, 255];
  });
const at = (im: DecodedImage, x: number, y: number): number[] => [...im.rgba.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];

const PURPLE: [number, number, number] = [120, 60, 200];
const GREEN_FRINGE: [number, number, number] = [20, 60, 20];
/**
 * 12×12 的「预渲染精灵」：中间 8×8 紫色、外面一圈 1 像素的深绿背景残色、再外面透明。
 */
const sprite1x = img(12, 12, (x, y) => {
  const d = Math.min(x, y, 11 - x, 11 - y);
  if (d === 0) return [0, 0, 0, 0];
  if (d === 1) return [...GREEN_FRINGE, 255];
  return [...PURPLE, 255];
});

describe('smoothAlpha', () => {
  it('★ 全不透明 → 原样返回同一个对象（底图那种 9216² 的不拷）', () => {
    const a = gray(() => 255, 8, 8);
    expect(smoothAlpha(a, 4)).toBe(a);
  });

  it('★ 阶梯轮廓变圆滑：4× 最近邻的斜边，每行 128 等值线的位置不再「一级跳 4 像素」', () => {
    // 1× 的对角线：x ≥ y 为不透明
    const a1 = gray((x, y) => (x >= y ? 255 : 0), 16, 16);
    const s = smoothAlpha(nn(a1, 4), 4);
    const edgeX = (y: number): number => {
      for (let x = 0; x < s.width; x++) if (s.rgba[(y * s.width + x) * 4]! >= 128) return x;
      return s.width;
    };
    let maxJump = 0;
    for (let y = 9; y < 50; y++) maxJump = Math.max(maxJump, Math.abs(edgeX(y + 1) - edgeX(y)));
    expect(maxJump).toBeLessThanOrEqual(2);
    // 有抗锯齿过渡（既不是全 0 也不是全 255 的像素存在）
    let mid = 0;
    for (let i = 0; i < s.width * s.height; i++) if (s.rgba[i * 4]! > 0 && s.rgba[i * 4]! < 255) mid++;
    expect(mid).toBeGreaterThan(0);
  });
});

describe('cleanEdges', () => {
  /** slice 交出去的那张：透明处 bleed 成最近的不透明色 */
  const bleed1x = img(12, 12, (x, y) => {
    const d = Math.min(x, y, 11 - x, 11 - y);
    return d <= 1 ? [...GREEN_FRINGE, 255] : [...PURPLE, 255];
  });
  const alpha1x = img(12, 12, (x, y) => {
    const a = sprite1x.rgba[(y * 12 + x) * 4 + 3]!;
    return [a, a, a, 255];
  });
  /** 模拟 AI：残色带里画满了杂色（红绿相间），内部是紫色 */
  const aiNoisy = img(48, 48, (x, y) => {
    const d = Math.min(Math.floor(x / 4), Math.floor(y / 4), Math.floor((47 - x) / 4), Math.floor((47 - y) / 4));
    if (d === 1) return (x + y) % 2 === 0 ? [250, 20, 20, 255] : [20, 250, 20, 255];
    return [...PURPLE, 255];
  });

  it('★ 边缘带里 AI 画的杂色被原图同位置的颜色替掉（原图是深色残色，就还是那道深色边）', () => {
    const merged = mergeUpscaled(aiNoisy, nn(alpha1x, 4), 4, bleed1x);
    const y = 24;
    let x = 0;
    while (merged.rgba[(y * merged.width + x) * 4 + 3]! < 128) x++;
    const [r, g, b] = at(merged, x, y);
    // 最外侧：明暗取原图那道暗边，色相换成内侧的紫 —— 不再是红/亮绿的杂纹，也不再偏绿
    expect(b!).toBeGreaterThan(g!);
    expect(r! + g! + b!).toBeLessThan(250); // 仍是暗边
    const lab = srgbToLab(r!, g!, b!);
    expect(Math.abs(lab.l - srgbToLab(...GREEN_FRINGE).l)).toBeLessThan(6); // 明暗跟原图
    // 深处（带宽以外）是 AI 的内容，不动
    expect(at(merged, 24, 24).slice(0, 3)).toEqual(PURPLE);
  });

  it('★ 边缘本来干净的图（亮色图标）不会被凭空加一道深色边', () => {
    const bright1x = img(8, 8, (x, y) => (Math.min(x, y, 7 - x, 7 - y) === 0 ? [0, 0, 0, 0] : [250, 220, 40, 255]));
    const brightBleed = img(8, 8, () => [250, 220, 40, 255]);
    const a = img(8, 8, (x, y) => {
      const v = bright1x.rgba[(y * 8 + x) * 4 + 3]!;
      return [v, v, v, 255];
    });
    const merged = mergeUpscaled(nn(brightBleed, 4), nn(a, 4), 4, brightBleed);
    for (let i = 0; i < merged.width * merged.height; i++) {
      if (merged.rgba[i * 4 + 3]! >= 128) expect(merged.rgba[i * 4]!).toBeGreaterThan(200);
    }
  });

  it('★ 全不透明 → 原样返回同一个对象', () => {
    const opaque = img(8, 8, () => [1, 2, 3, 255]);
    expect(cleanEdges(opaque, img(2, 2, () => [1, 2, 3, 255]), 4)).toBe(opaque);
  });
});

describe('labToSrgb', () => {
  it('是 srgbToLab 的反函数（往返误差 ≤ 1）', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [120, 60, 200], [20, 60, 20], [250, 220, 40]] as const) {
      const back = labToSrgb(srgbToLab(c[0], c[1], c[2]));
      back.forEach((v, k) => expect(Math.abs(v - c[k]!)).toBeLessThanOrEqual(1));
    }
  });
});

describe('edgeDistance', () => {
  it('透明处 0；越往里越大；图外算透明；半透明（< 128）算轮廓外', () => {
    const im = img(7, 7, () => [0, 0, 0, 255]);
    expect([...edgeDistance(im, 10)].slice(21, 28)).toEqual([1, 2, 3, 4, 3, 2, 1]);
    const soft = img(3, 3, (x) => [0, 0, 0, x === 0 ? 100 : 255]);
    expect(edgeDistance(soft, 10)[3]).toBe(0);
  });
});
