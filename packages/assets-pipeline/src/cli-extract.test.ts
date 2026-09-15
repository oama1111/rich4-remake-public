/*
 * Q-GND-4：地图底图（`.gnd`）要解成 PNG 进超分清单
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一条先前是**没有**的：`cli-extract` 把底图整块原样落成 `map/0000.gnd`，
 * 于是它不在 `manifest.json` 的 `images` 里，`planUpscale` 不为它建任务，
 * T-063 的 hd 回填与 T-064 的接缝检查都没有真实输入。
 *
 * 这里用**内存里的合成底图**（2×2 块）钉死解包这一段：真的跑一次
 * `encodePng`/`decodePng` 往返，不是打桩。
 */

import { describe, expect, it } from 'vitest';
import { groundAsset } from './cli-extract.ts';
import { decodePng } from './png.ts';
import {
  GND_LAYOUT_OFFSET,
  GND_PIXEL_OFFSET,
  GND_TILE_BYTES,
  GND_TILE_HEIGHT,
  GND_TILE_WIDTH,
  decodeGround,
  isGround,
} from './ground.ts';

const TILES = 4; // 2 × 2

/**
 * 造一张 2×2 块的合成底图：块 0/1/2/3 分别是黑/红/绿/蓝纯色，
 * 而**排布表是倒序**的 —— 于是「解码有没有走排布表」一眼可验。
 */
function syntheticGnd(): Uint8Array {
  const buf = new Uint8Array(GND_PIXEL_OFFSET + TILES * GND_TILE_BYTES);
  const view = new DataView(buf.buffer);
  buf.set([0x47, 0x4e, 0x44, 0x00]); // 'GND\0'
  view.setUint16(0x04, 2, true); // 横 2 块
  view.setUint16(0x06, 2, true); // 纵 2 块
  view.setUint32(0x08, TILES, true);
  view.setUint32(0x0c, 0, true);

  view.setUint16(0x10 + 0 * 2, 0x0000, true);
  view.setUint16(0x10 + 1 * 2, 0x7c00, true);
  view.setUint16(0x10 + 2 * 2, 0x03e0, true);
  view.setUint16(0x10 + 3 * 2, 0x001f, true);

  // 排布表：网格 0→块3、1→块2、2→块1、3→块0
  view.setUint16(GND_LAYOUT_OFFSET + 0 * 2, 3, true);
  view.setUint16(GND_LAYOUT_OFFSET + 1 * 2, 2, true);
  view.setUint16(GND_LAYOUT_OFFSET + 2 * 2, 1, true);
  view.setUint16(GND_LAYOUT_OFFSET + 3 * 2, 0, true);

  for (let b = 0; b < TILES; b++) {
    // 块 b 用调色板索引 b：0 黑 / 1 红 / 2 绿 / 3 蓝
    buf.fill(b, GND_PIXEL_OFFSET + b * GND_TILE_BYTES, GND_PIXEL_OFFSET + (b + 1) * GND_TILE_BYTES);
  }
  return buf;
}

/** 取某个网格格心的 RGB（经排布表解码后）—— 两种 RGBA 类型都收 */
function gridRgb(
  g: { width: number; rgba: Uint8Array | Uint8ClampedArray },
  tx: number,
  ty: number,
): number[] {
  const x = tx * GND_TILE_WIDTH + Math.floor(GND_TILE_WIDTH / 2);
  const y = ty * GND_TILE_HEIGHT + Math.floor(GND_TILE_HEIGHT / 2);
  const o = (y * g.width + x) * 4;
  return [g.rgba[o]!, g.rgba[o + 1]!, g.rgba[o + 2]!];
}

describe('★ Q-GND-4：底图被认出来是 GND', () => {
  it('合成数据通过魔数判据，尺寸 = 块数 × 32', () => {
    const data = syntheticGnd();
    expect(isGround(data)).toBe(true);
    const g = decodeGround(data);
    expect({ w: g.width, h: g.height }).toEqual({ w: 64, h: 64 });
  });

  it('排布表确实被用上了（网格 0 取到块 3 = 蓝）', () => {
    expect(gridRgb(decodeGround(syntheticGnd()), 0, 0)).toEqual([0, 0, 255]);
    expect(gridRgb(decodeGround(syntheticGnd()), 1, 0)).toEqual([0, 255, 0]);
  });
});

describe('★ Q-GND-4：groundAsset 产出可直接进清单的一条', () => {
  it('文件名与清单字段照 extract 的约定（<资源>_000.png、image = 0、format = GND）', () => {
    const a = groundAsset(syntheticGnd(), 'map', 4);
    expect(a.file).toBe('0004_000.png');
    expect(a.entry).toEqual({
      archive: 'map',
      resource: 4,
      image: 0,
      file: 'map/0004_000.png',
      width: 64,
      height: 64,
      anchorX: 0,
      anchorY: 0,
      format: 'GND',
    });
  });

  it('★ 锚点是 0/0 —— 底图整幅贴，原版没有「以某点为原点」这回事', () => {
    expect(groundAsset(syntheticGnd(), 'map', 0).entry.anchorX).toBe(0);
    expect(groundAsset(syntheticGnd(), 'map', 0).entry.anchorY).toBe(0);
  });

  it('★ 落盘的 PNG 解回来与 decodeGround 逐像素相同（含排布表）', () => {
    const data = syntheticGnd();
    const png = decodePng(groundAsset(data, 'map', 0).png);
    const g = decodeGround(data);

    expect({ w: png.width, h: png.height }).toEqual({ w: g.width, h: g.height });
    // 整幅逐字节 —— 走 PNG 往返（encodePng 是 store 模式，无损）
    expect([...png.rgba]).toEqual([...g.rgba]);
    // 顺带确认排布表在 PNG 里也生效了（不是「碰巧全同色」）
    expect(gridRgb(png, 0, 0)).toEqual([0, 0, 255]);
  });

  it('不是底图就抛错（别的资源不能冒充）', () => {
    expect(() => groundAsset(new Uint8Array(8).fill(1), 'map', 0)).toThrow(/GND/);
  });

  it('截断的底图也抛错（长度不足 = 数据不完整，不能默默解一半）', () => {
    const data = syntheticGnd();
    expect(() => groundAsset(data.subarray(0, 100), 'map', 0)).toThrow(/GND/);
  });
});
