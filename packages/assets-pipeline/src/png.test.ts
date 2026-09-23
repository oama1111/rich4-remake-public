/*
 * PNG 编解码 —— 真压缩后仍逐字节无损
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from './png.ts';

function image(width: number, height: number, px: (x: number, y: number) => [number, number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set(px(x, y), (y * width + x) * 4);
  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

describe('encodePng', () => {
  it('★ 往返逐字节相同（渐变 + 半透明 + 噪点，五种 filter 都会被选到）', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 0xff;
    const img = image(67, 41, (x, y) => (y % 3 === 0 ? [rnd(), rnd(), rnd(), rnd()] : [x * 3, y * 5, (x + y) & 0xff, 128 + (x & 1)]));
    const back = decodePng(encodePng(img));
    expect({ w: back.width, h: back.height }).toEqual({ w: 67, h: 41 });
    expect(Buffer.from(back.rgba).equals(Buffer.from(img.rgba))).toBe(true);
  });

  it('★ 真压缩：平滑图远小于未压缩体积（先前是 zlib store，体积 ≈ 像素字节数）', () => {
    const img = image(256, 256, (x, y) => [x, y, 128, 255]);
    const bytes = encodePng(img);
    expect(bytes.length).toBeLessThan((256 * 256 * 4) / 10);
  });
});
