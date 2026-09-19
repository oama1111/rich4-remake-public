/*
 * 樂透那三段 FLIC 影片 —— 钉住「解出来是什么」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 解码器本身在 `flic.ts`（断言在 `flic.test.ts`，那组钉的是掷骰 36 帧）。
 * 这一份只管樂透用的三段，外加**格式辨认**与**源文件名清单** ——
 * 源文件名就写在 FLIC 头后面，等于白送一份「哪段动画是什么」的表。
 *
 * ⚠️ 断言里的几何都是从素材本身量出来的（不是抄别处的输出）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { MkfArchive } from './mkf.ts';
import { decodeFlic, parseFlicInfo } from './flic.ts';

const ROOT = (process.env.RICH4_WORKSPACE ?? '');
const hasAssets = existsSync(`${ROOT}/Rich4/Panel.mkf`);
const d = hasAssets ? describe : describe.skip;

const panel = (): MkfArchive =>
  new MkfArchive(new Uint8Array(readFileSync(`${ROOT}/Rich4/Panel.mkf`)));
const read = (res: number): Uint8Array => panel().read(res, 'none');

/** 不透明像素数 / 包围盒 */
function stats(rgba: Uint8ClampedArray, w: number, h: number): {
  n: number;
  box: [number, number, number, number];
} {
  let n = 0;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] === 0) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { n, box: [x0, y0, x1, y1] };
}

/** 两帧不同的像素数 */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 3] !== b[i + 3]) n++;
  }
  return n;
}

d('★ 三段樂透影片', () => {
  it('#14 獎金燈框：5 帧 213×68，整圈是灯、中间镂空', () => {
    const f = decodeFlic(read(14))!;
    expect(parseFlicInfo(read(14))).toMatchObject({ width: 213, height: 68, frames: 5 });
    expect(f.frames).toHaveLength(5);
    const { n, box } = stats(f.frames[0]!, 213, 68);
    // 灯框：占一半上下，四边都有灯
    expect(n / (213 * 68)).toBeGreaterThan(0.4);
    expect(n / (213 * 68)).toBeLessThan(0.7);
    expect(box[0]).toBeLessThanOrEqual(4);
    expect(box[1]).toBeLessThanOrEqual(4);
    expect(box[2]).toBeGreaterThanOrEqual(208);
    expect(box[3]).toBeGreaterThanOrEqual(63);
    // 帧间在跑（跑马灯）
    expect(diff(f.frames[0]!, f.frames[1]!)).toBeGreaterThan(500);
  });

  it('#16 摇球：42 帧 275×270，整张都画，且帧间动得多', () => {
    const f = decodeFlic(read(16))!;
    expect(parseFlicInfo(read(16))).toMatchObject({ width: 275, height: 270, frames: 42 });
    expect(f.frames).toHaveLength(42);
    expect(stats(f.frames[0]!, 275, 270).n / (275 * 270)).toBeGreaterThan(0.9);
    expect(diff(f.frames[0]!, f.frames[1]!)).toBeGreaterThan(5000);
  });

  it('#17 得主礼花：37 帧 280×480，打底透明、彩带越铺越多', () => {
    const f = decodeFlic(read(17))!;
    expect(parseFlicInfo(read(17))).toMatchObject({ width: 280, height: 480, frames: 37 });
    const first = stats(f.frames[0]!, 280, 480);
    expect(first.n / (280 * 480)).toBeLessThan(0.1);
    const last = stats(f.frames[36]!, 280, 480);
    expect(last.n).toBeGreaterThan(first.n * 3);
  });
});

d('★ 辨认与出处', () => {
  it('三段都认得出是 FLIC；投注屏底图（SMP）不会被误认', () => {
    for (const res of [14, 16, 17]) expect(parseFlicInfo(read(res))).not.toBeNull();
    expect(decodeFlic(read(14))).not.toBeNull();
    // 资源 12/13 是 SMP 精灵表 —— 头不是 0xaf12
    expect(parseFlicInfo(read(12))).toBeNull();
    expect(parseFlicInfo(read(13))).toBeNull();
  });

  it('★ 头后面那段写着源 FLC 的路径 —— 白送的语义表', () => {
    const latin = new TextDecoder('latin1');
    const src = (res: number): string =>
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(read(res).subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(src(14)).toBe('D:\\RICH4\\LOTO\\BONUS1.FLC');
    expect(src(16)).toBe('D:\\RICH4\\LOTOOPEN\\LOTOBALL.FLC');
    expect(src(4)).toBe('C:\\MAKE\\DICE\\DICE1-1.FLC');
  });

  it('★ 帧数据不在 +0x80 —— 头后面先有一段「源文件信息」，得扫签名找', () => {
    const raw = read(14);
    const sig = 0xf1fa;
    let off = -1;
    for (let o = 0x80; o + 8 <= raw.length; o += 2) {
      if ((raw[o + 4]! | (raw[o + 5]! << 8)) === sig) {
        off = o;
        break;
      }
    }
    expect(off).toBeGreaterThan(0x80);
  });

  it('★ 文件里躺着的帧数可能比头里写的多（#14：头里 5、文件里 6）', () => {
    const raw = read(14);
    let off = 0x80;
    while (off + 8 <= raw.length && (raw[off + 4]! | (raw[off + 5]! << 8)) !== 0xf1fa) off += 2;
    let n = 0;
    while (off + 8 <= raw.length) {
      n++;
      const size = (raw[off]! | (raw[off + 1]! << 8) | (raw[off + 2]! << 16) | (raw[off + 3]! << 24)) >>> 0;
      const next = off + size;
      if (next + 8 > raw.length || (raw[next + 4]! | (raw[next + 5]! << 8)) !== 0xf1fa) break;
      off = next;
    }
    expect(n).toBe(6);
    expect(parseFlicInfo(raw)!.frames).toBe(5);
    // 播放器只播头里那个数
    expect(decodeFlic(raw)!.frames).toHaveLength(5);
  });
});
