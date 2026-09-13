/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * .gnd 底图解码
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  GND_LAYOUT_OFFSET,
  GND_PIXEL_OFFSET,
  GND_TILE_BYTES,
  GND_TILE_HEIGHT,
  GND_TILE_WIDTH,
  GroundFormatError,
  decodeGround,
  isGround,
  readLayout,
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

describe('布局', () => {
  it('★ 三个偏移与原版加载代码一致', () => {
    // @source memcpy(…, ground+0x10, 0x200)
    //         [0x48bac4] = ground + 0x210
    //         [0x48bacc] = ground + 0x2a90
    expect(GND_LAYOUT_OFFSET).toBe(0x210);
    expect(GND_PIXEL_OFFSET).toBe(0x2a90);
    // 排布表正好占满两者之间：5184 项 × 2 字节
    expect(GND_PIXEL_OFFSET - GND_LAYOUT_OFFSET).toBe(5184 * 2);
  });

  it('★ 块是 32 × 32 = 1024 字节', () => {
    expect(GND_TILE_WIDTH * GND_TILE_HEIGHT).toBe(GND_TILE_BYTES);
    expect(GND_TILE_BYTES).toBe(1024);
  });

  have('★ 文件长度 = 像素起点 + 块数×1024 —— 一字节不多不少', () => {
    for (let m = 0; m < 8; m++) {
      const d = load(m);
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const tiles = view.getUint16(4, true) * view.getUint16(6, true);
      expect(d.length, `地图 ${m}`).toBe(GND_PIXEL_OFFSET + tiles * GND_TILE_BYTES);
    }
  });

  have('★ 八张图都是 72 × 72 块 = 2304 见方', () => {
    for (let m = 0; m < 8; m++) {
      const g = decodeGround(load(m));
      expect([g.tilesX, g.tilesY], `地图 ${m}`).toEqual([72, 72]);
      expect([g.width, g.height]).toEqual([2304, 2304]);
      // 像素区恰好铺满整图
      expect(g.width * g.height).toBe(5184 * GND_TILE_BYTES);
    }
  });

  have('★ 排布表是 0..5183 的严格排列 —— 八张图都是', () => {
    for (let m = 0; m < 8; m++) {
      const layout = readLayout(load(m), 5184);
      expect(new Set(layout).size, `地图 ${m}`).toBe(5184);
      expect(Math.min(...layout)).toBe(0);
      expect(Math.max(...layout)).toBe(5183);
    }
  });
});

describe('解码', () => {
  have('★ 输出 RGBA 长度正确且全不透明', () => {
    const g = decodeGround(load(0));
    expect(g.rgba.length).toBe(g.width * g.height * 4);
    for (let i = 3; i < g.rgba.length; i += 4 * 9973) expect(g.rgba[i]).toBe(255);
  });

  have('★ 调色板首项为黑 —— 与 SPR 同制', () => {
    const d = load(0);
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    expect(view.getUint16(0x10, true)).toBe(0);
  });

  have('★ 调色板 256 项无重复、无高位 —— 确证是 RGB555', () => {
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

  have('★ 块间接缝与块内一样连贯 —— 用上排布表之后才成立', () => {
    // ★ 这是整个格式正确性的**核心判据**，也是先前两版解码栽的地方：
    //   不用排布表时，块内相邻像素差 9.3 而块边界接缝高达 16.4，
    //   画面上表现为每 32 像素一圈错位（字母被切开）。
    //   用上排布表后，接缝应当落回块内的水平。
    const g = decodeGround(load(0));
    const sample = (x: number, y: number): number => g.rgba[(y * g.width + x) * 4]!;

    let inner = 0;
    let ni = 0;
    let seam = 0;
    let ns = 0;
    for (let y = 64; y < g.height - 64; y += 7) {
      for (let x = 64; x < g.width - 64; x += 5) {
        if (x % 32 === 31) {
          seam += Math.abs(sample(x, y) - sample(x + 1, y));
          ns++;
        } else {
          inner += Math.abs(sample(x, y) - sample(x + 1, y));
          ni++;
        }
      }
    }
    expect(ns).toBeGreaterThan(300);
    expect(seam / ns).toBeLessThan((inner / ni) * 1.25);
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
