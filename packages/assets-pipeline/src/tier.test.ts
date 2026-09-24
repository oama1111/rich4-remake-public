/*
 * 分档输出（W-80 §4.5）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 内存夹具：tier 的读写走 TierIo，与 assemble 同一个做法，不造临时目录。
 */

import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from './png.ts';
import type { DecodedImage } from './sprite.ts';
import { tierHd, tierModel, tierResult, tierSize, type TierIo } from './tier.ts';
import {
  emptyManifest,
  hdRelativePath,
  planUpscale,
  recordResult,
  type AssetEntryLike,
  type UpscaleManifest,
} from './upscale.ts';

// ============================================================
//  夹具
// ============================================================

function entry(over: Partial<AssetEntryLike> = {}): AssetEntryLike {
  return {
    archive: 'Data',
    resource: 2,
    image: 0,
    file: 'Data/0002_000.png',
    width: 8,
    height: 6,
    anchorX: 3,
    anchorY: 5,
    format: 'SPR',
    ...over,
  };
}

/** 左半红右半蓝、底行透明的一张图 */
function img(width: number, height: number): DecodedImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y >= height - Math.max(1, height / 6)) continue; // 底下一截透明
      rgba.set(x < width / 2 ? [200, 20, 30, 255] : [20, 40, 220, 255], (y * width + x) * 4);
    }
  }
  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

function memIo(files: Record<string, Uint8Array>): TierIo & { written: Record<string, Uint8Array> } {
  const written: Record<string, Uint8Array> = {};
  return {
    written,
    readMaster: (rel) => files[rel] ?? null,
    write: (rel, bytes) => {
      written[rel] = bytes;
    },
    hash: (bytes) => `len${bytes.length}-${bytes[bytes.length - 20] ?? 0}`,
  };
}

/** 一份「母版」：给的每条 entry 都有 4× 产物与结果 */
function master(entries: AssetEntryLike[], outScale = 4): { manifest: UpscaleManifest; files: Record<string, Uint8Array> } {
  const tasks = planUpscale(entries);
  const m = emptyManifest(tasks);
  const files: Record<string, Uint8Array> = {};
  for (const t of tasks) {
    const w = t.srcWidth * outScale;
    const h = t.srcHeight * outScale;
    files[hdRelativePath(t.archive, t.resource, t.image)] = encodePng(img(w, h));
    m.results[t.id] = recordResult(t, {
      model: 'flux-tile',
      params: { seed: 7 },
      outWidth: w,
      outHeight: h,
      srcHash: `src-${t.id}`,
      outHash: `out-${t.id}`,
    });
  }
  return { manifest: m, files };
}

// ============================================================
//  纯计算
// ============================================================

describe('tierSize', () => {
  const task = { srcWidth: 10, srcHeight: 6 };

  it('4× 母版 → 2× 档：缩到 原图 × 2', () => {
    expect(tierSize(task, 40, 24, 2)).toEqual({ width: 20, height: 12, copy: false });
  });

  it('★ 只缩不放：产物本就不大于目标 → 原样拷', () => {
    expect(tierSize(task, 20, 12, 2)).toEqual({ width: 20, height: 12, copy: true });
    expect(tierSize(task, 15, 9, 2)).toEqual({ width: 15, height: 9, copy: true });
  });

  it('某一轴本就更小：那一轴不动，另一轴缩', () => {
    expect(tierSize(task, 40, 10, 2)).toEqual({ width: 20, height: 10, copy: false });
  });

  it('非整数档位按四舍五入取整像素', () => {
    expect(tierSize({ srcWidth: 5, srcHeight: 3 }, 20, 12, 1.5)).toEqual({ width: 8, height: 5, copy: false });
  });

  it('倍率必须是正数', () => {
    expect(() => tierSize(task, 40, 24, 0)).toThrow(/正数/);
    expect(() => tierSize(task, 40, 24, Number.NaN)).toThrow(/正数/);
  });
});

describe('tierResult', () => {
  it('★ 锚点按这一档的实际尺寸重算（C-AST-6）；模型名带后缀；参数与源哈希沿用母版', () => {
    const task = planUpscale([entry()])[0]!;
    const m = recordResult(task, { model: 'm', params: { seed: 1 }, outWidth: 32, outHeight: 24, srcHash: 's', outHash: 'o' });
    expect({ x: m.outAnchorX, y: m.outAnchorY }).toEqual({ x: 12, y: 20 });
    const r = tierResult(task, m, { width: 16, height: 12, hash: 'h2' }, 2);
    expect(r).toEqual({
      id: task.id,
      model: 'm+tier2x',
      params: { seed: 1 },
      outWidth: 16,
      outHeight: 12,
      outAnchorX: 6,
      outAnchorY: 10,
      srcHash: 's',
      outHash: 'h2',
    });
    expect(tierModel('realesrgan', 1.5)).toBe('realesrgan+tier1.5x');
  });
});

// ============================================================
//  整档派生
// ============================================================

describe('tierHd', () => {
  it('★ 4× → 2×：写到同一个 hdRelativePath，尺寸 = 原图 × 2，清单同一批任务', () => {
    const { manifest, files } = master([entry(), entry({ resource: 3, file: 'Data/0003_000.png', width: 4, height: 4 })]);
    const io = memIo(files);
    const { manifest: out, report } = tierHd(manifest, 2, io, new Date('2026-09-22T00:00:00Z'));

    expect(report.scaled).toEqual(['Data/0002_000', 'Data/0003_000']);
    expect(report.copied).toEqual([]);
    expect(Object.keys(io.written)).toEqual(['Data/2-0.png', 'Data/3-0.png']);
    const a = decodePng(io.written['Data/2-0.png']!);
    expect({ w: a.width, h: a.height }).toEqual({ w: 16, h: 12 });

    expect(out.tasks).toBe(manifest.tasks);
    expect(out.generatedAt).toBe('2026-09-22T00:00:00.000Z');
    expect(out.results['Data/0002_000']).toMatchObject({
      model: 'flux-tile+tier2x',
      outWidth: 16,
      outHeight: 12,
      outAnchorX: 6,
      outAnchorY: 10,
      srcHash: 'src-Data/0002_000',
      outHash: io.hash(io.written['Data/2-0.png']!),
    });
  });

  it('缩出来的颜色就是母版块的均值（同一把 downscaleArea）', () => {
    const { manifest, files } = master([entry()]);
    const io = memIo(files);
    tierHd(manifest, 1, io);
    const d = decodePng(io.written['Data/2-0.png']!);
    // 母版 32×24 左半红右半蓝 → 1× 档 8×6：左上角纯红、右上角纯蓝
    expect([...d.rgba.subarray(0, 4)]).toEqual([200, 20, 30, 255]);
    expect([...d.rgba.subarray(7 * 4, 8 * 4)]).toEqual([20, 40, 220, 255]);
  });

  it('★ 母版本就不大于目标（只有 2×）：原样拷，一个字节不动', () => {
    const { manifest, files } = master([entry()], 2);
    const io = memIo(files);
    const { report } = tierHd(manifest, 2, io);
    expect(report.copied).toEqual(['Data/0002_000']);
    expect(io.written['Data/2-0.png']).toBe(files['Data/2-0.png']);
  });

  it('母版缺图 / 坏图：不写、不记账，列进 missing', () => {
    const { manifest, files } = master([entry(), entry({ resource: 3, file: 'Data/0003_000.png' })]);
    delete files['Data/2-0.png'];
    files['Data/3-0.png'] = new Uint8Array([1, 2, 3]);
    const io = memIo(files);
    const { manifest: out, report } = tierHd(manifest, 2, io);
    expect(report.missing.map((m) => m.id)).toEqual(['Data/0002_000', 'Data/0003_000']);
    expect(out.results).toEqual({});
    expect(io.written).toEqual({});
  });

  it('没有结果的任务不碰', () => {
    const { manifest, files } = master([entry()]);
    const io = memIo(files);
    const { manifest: out } = tierHd({ ...manifest, results: {} }, 2, io);
    expect(out.results).toEqual({});
    expect(io.written).toEqual({});
  });
});
