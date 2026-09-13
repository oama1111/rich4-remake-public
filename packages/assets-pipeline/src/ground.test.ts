/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * .gnd 底图解码
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  GND_TILE_BYTES,
  GND_TILE_HEIGHT,
  GND_TILE_WIDTH,
  GroundFormatError,
  decodeGround,
  isGround,
} from './ground.ts';

const DIR = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/assets-clean/map';
const groundPath = (mapId: number): string => `${DIR}/${String(mapId * 2).padStart(4, '0')}.gnd`;
const have = existsSync(groundPath(0)) ? it : it.skip;
const load = (mapId: number): Uint8Array => new Uint8Array(readFileSync(groundPath(mapId)));

describe('识别', () => {
  have('★ 八张底图都带 GND 魔数', () => {
    for (let m = 0; m < 8; m++) expect(isGround(load(m)), `地图 ${m}`).toBe(true);
  });

  it('不是 GND 的数据被认出来', () => {
    expect(isGround(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(isGround(new Uint8Array(0))).toBe(false);
  });

  it('魔数不符时抛错', () => {
    expect(() => decodeGround(new Uint8Array(1024))).toThrow(GroundFormatError);
  });
});

describe('块尺寸', () => {
  it('★ 38 × 27 = 1026 字节', () => {
    expect(GND_TILE_WIDTH * GND_TILE_HEIGHT).toBe(GND_TILE_BYTES);
    expect(GND_TILE_BYTES).toBe(1026);
  });

  have('★ 文件长度正好是 头 + 调色板 + 块数×1026 —— 一字节不多不少', () => {
    for (let m = 0; m < 8; m++) {
      const d = load(m);
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const tilesX = view.getUint16(4, true);
      const tilesY = view.getUint16(6, true);
      expect(d.length, `地图 ${m}`).toBe(0x10 + 512 + tilesX * tilesY * GND_TILE_BYTES);
    }
  });

  have('★ 八张图都是 72 × 72 块', () => {
    for (let m = 0; m < 8; m++) {
      const g = decodeGround(load(m));
      expect([g.tilesX, g.tilesY], `地图 ${m}`).toEqual([72, 72]);
      expect([g.width, g.height]).toEqual([2736, 1944]);
    }
  });
});

describe('解码', () => {
  have('★ 输出 RGBA 长度正确且全不透明', () => {
    const g = decodeGround(load(0));
    expect(g.rgba.length).toBe(g.width * g.height * 4);
    for (let i = 3; i < g.rgba.length; i += 4 * 9973) {
      expect(g.rgba[i]).toBe(255);
    }
  });

  have('★ 调色板首项为黑 —— 与 SPR 同制', () => {
    const d = load(0);
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    expect(view.getUint16(0x10, true)).toBe(0);
  });

  have('★ 调色板 256 项无重复、无高位 —— 确证是 RGB555 而非别的编码', () => {
    const d = load(0);
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const seen = new Set<number>();
    for (let i = 0; i < 256; i++) {
      const v = view.getUint16(0x10 + i * 2, true);
      expect(v & 0x8000, `第 ${i} 项置了最高位`).toBe(0);
      seen.add(v);
    }
    expect(seen.size).toBe(256);
  });

  have('★ 解出来的是一幅连贯图像，不是噪声', () => {
    // 判据：**相邻像素高度相关**。块宽取错会产生斜向撕裂，
    // 横向相邻差会显著变大 —— 这正是当初定下 38 而非 27/54 的依据。
    const g = decodeGround(load(0));
    const sample = (x: number, y: number): number => g.rgba[(y * g.width + x) * 4]!;
    let adjacent = 0;
    let distant = 0;
    let n = 0;
    for (let y = 100; y < g.height - 100; y += 37) {
      for (let x = 100; x < g.width - 200; x += 41) {
        adjacent += Math.abs(sample(x, y) - sample(x + 1, y));
        distant += Math.abs(sample(x, y) - sample(x + 137, y));
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
    // 相邻差应当远小于远距离差
    expect(adjacent / n).toBeLessThan(distant / n / 2);
  });

  have('★ 八张底图各不相同 —— 不是同一张图重复了八遍', () => {
    const digests = new Set<string>();
    for (let m = 0; m < 8; m++) {
      const g = decodeGround(load(m));
      let h = 0;
      for (let i = 0; i < g.rgba.length; i += 1021) h = (Math.imul(h, 31) + g.rgba[i]!) | 0;
      digests.add(String(h));
    }
    expect(digests.size).toBe(8);
  });

  have('地图 0 的底图以深蓝（海）为主 —— 台湾岛四面环海', () => {
    const g = decodeGround(load(0));
    let sea = 0;
    let total = 0;
    for (let i = 0; i < g.rgba.length; i += 4 * 997) {
      const r = g.rgba[i]!;
      const gg = g.rgba[i + 1]!;
      const b = g.rgba[i + 2]!;
      if (b > r + 20 && b > gg + 20) sea++;
      total++;
    }
    expect(sea / total).toBeGreaterThan(0.4);
  });
});
