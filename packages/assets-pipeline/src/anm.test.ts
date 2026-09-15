/*
 * Deluxe Paint `.ANM` 解码验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 标本是 `Panel.mkf` 里那三块樂透用的动画：
 *   #14 `LOTO\BONUS1.FLC`     5 帧 213×68  —— 投注屏的獎金燈框（跑马灯）
 *   #16 `LOTOOPEN\LOTOBALL.FLC` 42 帧 275×270 —— 開獎屏玻璃球里的球翻滚
 *   #17 `256_S\A01.FLC`       37 帧 280×480 —— 開獎屏得主的彩带礼花
 *
 * 解码器是**严格**的：记录吃不完、吃过界、帧长与记录之和对不上都抛 ——
 * 所以「跑通不抛」本身就等于「框定与 exe 里的播放器一致」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { MkfArchive } from './mkf.ts';
import { AnmFormatError, decodeAnm, isAnm, parseAnmHeader } from './anm.ts';
import type { AnmFrame } from './anm.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const hasAssets = existsSync(`${ROOT}/Rich4/Panel.mkf`);
const d = hasAssets ? describe : describe.skip;

const panel = (): MkfArchive =>
  new MkfArchive(new Uint8Array(readFileSync(`${ROOT}/Rich4/Panel.mkf`)));
const read = (res: number): Uint8Array => panel().read(res, 'none');

/** 不透明像素数与包围盒 */
function opaqueStats(f: AnmFrame): { count: number; box: [number, number, number, number] } {
  let count = 0;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      if (f.rgba[(y * f.width + x) * 4 + 3] === 0) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { count, box: [x0, y0, x1, y1] };
}

/** 两帧不同的像素数 */
function frameDiff(a: AnmFrame, b: AnmFrame): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 3] !== b.rgba[i + 3]) n++;
  }
  return n;
}

const u16 = (d: Uint8Array, o: number): number => d[o]! | (d[o + 1]! << 8);
const u32 = (d: Uint8Array, o: number): number =>
  (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;

/** 按播放器的规则往前找帧头（帧之间可能有源信息块/填充）*/
function firstFrameOffset(data: Uint8Array): number {
  for (let o = 0x80; o + 8 <= data.length; o += 2) {
    if (u16(data, o + 4) === 0xf1fa) return o;
  }
  return -1;
}

d('ANM 头', () => {
  it('★ 樂透那三块都是 ANM，头字段对得上', () => {
    expect(parseAnmHeader(read(14))).toMatchObject({
      frames: 5, width: 213, height: 68, bitDepth: 8, version: 3, frameDelay: 71,
    });
    expect(parseAnmHeader(read(16))).toMatchObject({ frames: 42, width: 275, height: 270 });
    expect(parseAnmHeader(read(17))).toMatchObject({ frames: 37, width: 280, height: 480 });
  });

  it('★ 不把 SPR/SMP 当 ANM，也不把 ANM 当 SPR/SMP', () => {
    expect(isAnm(read(14))).toBe(true);
    expect(isAnm(read(12))).toBe(false); // 投注屏底图是 SMP
    expect(parseAnmHeader(read(12))).toBeNull();
  });

  it('★ 帧数据不在 +0x80 —— 头后面还有一段「源文件信息」，得扫帧签名找', () => {
    const off = firstFrameOffset(read(14));
    expect(off).toBeGreaterThan(0x80);
    // 那一段里写着它当年是从哪个 FLC 转过来的
    expect(new TextDecoder('latin1').decode(read(14).subarray(0x80, 0x1200))).toContain(
      'LOTO\\BONUS1.FLC',
    );
  });
});

d('樂透的三块动画', () => {
  it('★ #14 獎金燈框：整圈是灯、中间镂空（索引 0 = 不动）', () => {
    const f = decodeAnm(read(14))[0]!;
    const { count, box } = opaqueStats(f);
    // 灯框：占一半左右，铺满整张（四周都有灯）
    expect(count / (213 * 68)).toBeGreaterThan(0.4);
    expect(count / (213 * 68)).toBeLessThan(0.65);
    expect(box[0]).toBeLessThanOrEqual(4);
    expect(box[1]).toBeLessThanOrEqual(4);
    expect(box[2]).toBeGreaterThanOrEqual(208);
    expect(box[3]).toBeGreaterThanOrEqual(63);
    // 正中那条是给金额牌留的，一个灯都不许有
    let inside = 0;
    for (let y = 24; y < 44; y++) {
      for (let x = 42; x < 171; x++) if (f.rgba[(y * 213 + x) * 4 + 3] !== 0) inside++;
    }
    expect(inside).toBe(0);
  });

  it('★ #14 在动：5 帧逐帧都不一样（跑马灯）', () => {
    const F = decodeAnm(read(14));
    expect(F).toHaveLength(5);
    for (let i = 1; i < F.length; i++) {
      expect(frameDiff(F[i - 1]!, F[i]!), `帧 ${i - 1}↔${i}`).toBeGreaterThan(500);
    }
  });

  it('★ #16 摇球：42 帧、整张都画（球在玻璃球里翻）', () => {
    const F = decodeAnm(read(16));
    expect(F).toHaveLength(42);
    const { count } = opaqueStats(F[0]!);
    expect(count / (275 * 270)).toBeGreaterThan(0.9);
    // 帧间差异很大 —— 球是滚的，不是原位闪
    expect(frameDiff(F[0]!, F[1]!)).toBeGreaterThan(5000);
    expect(frameDiff(F[20]!, F[21]!)).toBeGreaterThan(5000);
  });

  it('★ #17 得主礼花：整片透明打底，只在中间炸出彩带', () => {
    const F = decodeAnm(read(17));
    expect(F).toHaveLength(37);
    const first = opaqueStats(F[0]!);
    // 第 0 帧只有顶上那两颗红球
    expect(first.count / (280 * 480)).toBeLessThan(0.1);
    expect(first.box[1]).toBeLessThan(140);
    // 到后面彩带铺满整列
    const last = opaqueStats(F[36]!);
    expect(last.count).toBeGreaterThan(first.count * 3);
    expect(last.box[3]).toBeGreaterThan(400);
  });
});

d('★ 解析是严格的：坏数据要抛，不能悄悄画错', () => {
  const raw = (): Uint8Array => read(14);

  it('magic 不对就抛', () => {
    const bad = raw();
    bad[4] = 0;
    expect(() => decodeAnm(bad)).toThrow(AnmFormatError);
  });

  it('把第一条记录的长度改小 → 帧长与记录之和对不上，抛', () => {
    const bad = raw();
    const off = firstFrameOffset(bad);
    // 帧头 16 字节之后是第一条记录，它的 u32 长度在 +0
    bad[off + 0x10] = bad[off + 0x10]! - 4;
    expect(() => decodeAnm(bad)).toThrow(AnmFormatError);
  });

  it('★ 帧签名坏了会像原版一样「往前找下一个」—— 于是少一帧、整体错位', () => {
    const good = decodeAnm(raw());
    const bad = raw();
    const off = firstFrameOffset(bad);
    bad[off + 4] = 0;
    bad[off + 5] = 0;
    const skipped = decodeAnm(bad);
    expect(skipped).toHaveLength(5);
    // 跳掉的那一帧带着「整帧 + 调色板」，所以后面几帧全成了黑 —— 这正说明重同步发生了
    let lit = 0;
    for (const f of skipped) {
      for (let i = 0; i < f.rgba.length; i += 4) if (f.rgba[i]! > 8) lit++;
    }
    expect(lit).toBe(0);
    expect(good[0]!.rgba.some((v, i) => i % 4 === 0 && v > 8)).toBe(true);
  });

  it('数据被截断 → 抛（帧长越界）', () => {
    expect(() => decodeAnm(raw().slice(0, 0x80 + 2000))).toThrow(AnmFormatError);
  });

  it('★ 文件里躺着 6 帧，头里只写 5 —— 播放器只播头里那个数', () => {
    const data = raw();
    let off = firstFrameOffset(data);
    let n = 0;
    while (off > 0) {
      n++;
      const next = off + u32(data, off);
      if (next + 8 > data.length || u16(data, next + 4) !== 0xf1fa) break;
      off = next;
    }
    expect(n).toBe(6);
    expect(parseAnmHeader(data)!.frames).toBe(5);
    expect(decodeAnm(data)).toHaveLength(5);
  });

  it('把帧宽高改成 0 → 头不合理，抛', () => {
    const bad = raw();
    bad[8] = 0;
    bad[9] = 0;
    expect(() => decodeAnm(bad)).toThrow(AnmFormatError);
  });
});
