/*
 * 精灵解码验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { MkfArchive, parseSpriteSheet } from './mkf.ts';
import { decodeImage, decodeRaw555, parsePalette, TRANSPARENT_INDEX } from './sprite.ts';
import { encodePng } from './png.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const hasAssets = existsSync(`${ROOT}/Rich4/map.mkf`);
const d = hasAssets ? describe : describe.skip;

const ARCHIVES = ['help.mkf', 'jump.mkf', 'Panel.mkf', 'map.mkf', 'Data.mkf'] as const;

function loadArchive(file: string): MkfArchive {
  return new MkfArchive(new Uint8Array(readFileSync(`${ROOT}/Rich4/${file}`)));
}

d('像素格式结论验证', () => {
  it('SPR 恒为 8bpp（gsize === w*h），SMP 恒为 16bpp（gsize === w*h*2）', () => {
    let spr = 0;
    let smp = 0;
    for (const file of ARCHIVES) {
      const a = loadArchive(file);
      for (let i = 0; i < a.count; i++) {
        const sheet = parseSpriteSheet(a.read(i, 'none'));
        if (sheet === null) continue;
        for (const g of sheet.images) {
          if (sheet.signature === 'SPR') {
            expect(g.gsize, `${file}#${i} SPR 应为 8bpp`).toBe(g.width * g.height);
            spr++;
          } else {
            expect(g.gsize, `${file}#${i} SMP 应为 16bpp`).toBe(g.width * g.height * 2);
            smp++;
          }
        }
      }
    }
    console.log(`  验证 SPR ${spr} 张, SMP ${smp} 张 —— 全部为未压缩位图`);
    expect(spr).toBeGreaterThan(2000);
    expect(smp).toBeGreaterThan(0);
  });

  it('SPR 调色板首项为黑，索引 0 用作透明', () => {
    const a = loadArchive('map.mkf');
    for (let i = 0; i < a.count; i++) {
      const data = a.read(i, 'none');
      const sheet = parseSpriteSheet(data);
      if (sheet?.signature !== 'SPR') continue;
      const pal = parsePalette(sheet.palette!);
      expect([pal[0], pal[1], pal[2]]).toEqual([0, 0, 0]);

      // 四角应当是透明索引
      const g = sheet.images[0]!;
      const px = data.subarray(g.dataOffset, g.dataOffset + g.gsize);
      expect(px[0]).toBe(TRANSPARENT_INDEX);
      return;
    }
    throw new Error('未找到 SPR 资源');
  });
});

d('decodeImage', () => {
  it('SPR 解码：尺寸正确、透明区 alpha 为 0、非透明区 alpha 为 255', () => {
    const a = loadArchive('map.mkf');
    for (let i = 0; i < a.count; i++) {
      const data = a.read(i, 'none');
      const sheet = parseSpriteSheet(data);
      if (sheet?.signature !== 'SPR') continue;

      const img = decodeImage(sheet, data, 0);
      const g = sheet.images[0]!;
      expect(img.width).toBe(g.width);
      expect(img.height).toBe(g.height);
      expect(img.rgba.length).toBe(g.width * g.height * 4);

      const px = data.subarray(g.dataOffset, g.dataOffset + g.gsize);
      let transparent = 0;
      let opaque = 0;
      for (let p = 0; p < g.width * g.height; p++) {
        const alpha = img.rgba[p * 4 + 3];
        if (px[p] === TRANSPARENT_INDEX) {
          expect(alpha).toBe(0);
          transparent++;
        } else {
          expect(alpha).toBe(255);
          opaque++;
        }
      }
      expect(transparent).toBeGreaterThan(0);
      expect(opaque).toBeGreaterThan(0);
      return;
    }
    throw new Error('未找到 SPR 资源');
  });

  it('SMP 解码：全不透明，色值为 RGB555 扩展', () => {
    const a = loadArchive('help.mkf');
    const data = a.read(0, 'none');
    const sheet = parseSpriteSheet(data)!;
    expect(sheet.signature).toBe('SMP');

    const img = decodeImage(sheet, data, 0);
    expect(img.width).toBe(400);
    expect(img.height).toBe(400);
    for (let p = 0; p < img.width * img.height; p++) {
      expect(img.rgba[p * 4 + 3]).toBe(255);
    }
  });

  it('锚点被保留，且约为图像中心', () => {
    const a = loadArchive('Data.mkf');
    let checked = 0;
    let centered = 0;
    for (let i = 0; i < a.count && checked < 200; i++) {
      const data = a.read(i, 'none');
      const sheet = parseSpriteSheet(data);
      if (sheet === null) continue;
      for (let k = 0; k < sheet.images.length && checked < 200; k++) {
        const g = sheet.images[k]!;
        if (g.x === 0 && g.y === 0) continue;
        const img = decodeImage(sheet, data, k);
        expect(img.anchorX).toBe(g.x);
        expect(img.anchorY).toBe(g.y);
        checked++;
        // 锚点接近中心（容忍 ±25%）
        if (Math.abs(g.x - g.width / 2) < g.width * 0.25) centered++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(centered / checked, '锚点应以中心为主').toBeGreaterThan(0.7);
  });

  it('能解码全部档案的每一张图像而不抛错', () => {
    let total = 0;
    for (const file of ARCHIVES) {
      const a = loadArchive(file);
      for (let i = 0; i < a.count; i++) {
        const data = a.read(i, 'none');
        const sheet = parseSpriteSheet(data);
        if (sheet === null) continue;
        for (let k = 0; k < sheet.images.length; k++) {
          const img = decodeImage(sheet, data, k);
          expect(img.rgba.length).toBe(img.width * img.height * 4);
          total++;
        }
      }
    }
    console.log(`  成功解码 ${total} 张图像`);
    expect(total).toBeGreaterThan(10000);
  });
});

d('encodePng', () => {
  it('产出合法 PNG：签名、IHDR 尺寸、IEND 结尾', () => {
    const a = loadArchive('map.mkf');
    for (let i = 0; i < a.count; i++) {
      const data = a.read(i, 'none');
      const sheet = parseSpriteSheet(data);
      if (sheet?.signature !== 'SPR') continue;
      const img = decodeImage(sheet, data, 0);
      const png = encodePng(img);

      expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
      expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
      expect(v.getUint32(16, false)).toBe(img.width);
      expect(v.getUint32(20, false)).toBe(img.height);
      expect(png[24]).toBe(8); // bit depth
      expect(png[25]).toBe(6); // RGBA
      expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
      return;
    }
    throw new Error('未找到 SPR 资源');
  });
});

describe('SMP 抠黑', () => {
  const MAPMKF = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/map.mkf';
  const has = existsSync(MAPMKF) ? it : it.skip;

  has('★ 特殊格装饰图的纯黑占两成多，且集中在四角 —— 那是抠图用的底色', () => {
    const arc = new MkfArchive(new Uint8Array(readFileSync(MAPMKF)));
    const data = arc.read(24);
    const sheet = parseSpriteSheet(data);
    expect(sheet).not.toBeNull();
    if (sheet === null) return;
    expect(sheet.signature).toBe('SMP');

    const img = decodeImage(sheet, data, 0, { colorKeyBlack: true });
    const total = img.width * img.height;
    let clear = 0;
    for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] === 0) clear++;
    // 与 SPR 用索引 0 抠图时的占比同一量级
    expect(clear / total).toBeGreaterThan(0.15);
    expect(clear / total).toBeLessThan(0.45);

    // 四角必须被抠掉（椭圆图案的外侧）
    const alphaAt = (x: number, y: number): number => img.rgba[(y * img.width + x) * 4 + 3]!;
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(img.width - 1, 0)).toBe(0);
    expect(alphaAt(0, img.height - 1)).toBe(0);
    expect(alphaAt(img.width - 1, img.height - 1)).toBe(0);
    // 正中必须留着（图案本体）
    expect(alphaAt(img.width >> 1, img.height >> 1)).toBe(255);
  });

  has('★ 不开抠黑时仍然全不透明 —— 默认行为没变', () => {
    const arc = new MkfArchive(new Uint8Array(readFileSync(MAPMKF)));
    const data = arc.read(24);
    const sheet = parseSpriteSheet(data);
    if (sheet === null) return;
    const img = decodeImage(sheet, data, 0);
    for (let i = 3; i < img.rgba.length; i += 4 * 337) expect(img.rgba[i]).toBe(255);
  });
});

describe('裸 16bpp 位图（節日插画那类，没有 SPR/SMP 头）', () => {
  /** 造一个 W×H 的 RGB555 块；取值 = 该像素的序号（塞进 15 位里） */
  const block = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(w * h * 2);
    for (let p = 0; p < w * h; p++) {
      b[p * 2] = p & 0xff;
      b[p * 2 + 1] = (p >> 8) & 0x7f;
    }
    return b;
  };

  it('★ 尺寸来自调用方，不来自数据 —— 解出来就是 W×H', () => {
    const img = decodeRaw555(4, 3, block(4, 3));
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.rgba.length).toBe(4 * 3 * 4);
  });

  it('★ RGB555 逐位展开：通道 5 位 → 8 位（末位补满，不是简单左移）', () => {
    // 纯红 = 0x7C00、纯绿 = 0x03E0、纯蓝 = 0x001F
    const raw = new Uint8Array([0x00, 0x7c, 0xe0, 0x03, 0x1f, 0x00]);
    const img = decodeRaw555(3, 1, raw);
    expect(Array.from(img.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(img.rgba.slice(4, 8))).toEqual([0, 255, 0, 255]);
    expect(Array.from(img.rgba.slice(8, 12))).toEqual([0, 0, 255, 255]);
  });

  it('默认全不透明；开抠黑才把 RGB555 的 0 抠成透明', () => {
    const raw = new Uint8Array([0x00, 0x00, 0x00, 0x7c]);
    expect(Array.from(decodeRaw555(2, 1, raw).rgba.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(decodeRaw555(2, 1, raw, true).rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('字节数对不上就抛 —— 别拿错资源当图画出个花屏', () => {
    expect(() => decodeRaw555(4, 3, block(4, 3).subarray(0, 20))).toThrow(/裸 16bpp/);
  });
});
