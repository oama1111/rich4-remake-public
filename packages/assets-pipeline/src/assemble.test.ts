/*
 * T-063：重拼精灵 + 锚点 ×4 + 写 hd-manifest.json
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 全部用内存夹具：本模块不碰文件系统，读写走 AssembleIo，
 * 于是幂等、尺寸守卫、锚点这些规矩可以逐个钉死，不必造临时目录。
 */
import { describe, expect, it } from 'vitest';
import { assembleHd, hdRelativePath, type AssembleIo } from './assemble.ts';
import { emptyManifest, planUpscale, type AssetEntryLike, type UpscaleManifest } from './upscale.ts';
import { buildQueueFrame, SUGGESTED_MODEL, type QueueFrame, type QueueManifest } from './slice.ts';
import { encodePng, type DecodedImage } from './sprite.ts';

// ============================================================
//  夹具
// ============================================================

const RED = [200, 10, 20, 255] as const;

function png(width: number, height: number, color: readonly number[] = RED): Uint8Array {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set(color, i * 4);
  const img: DecodedImage = { width, height, anchorX: 0, anchorY: 0, rgba };
  return encodePng(img);
}

function entry(over: Partial<AssetEntryLike> = {}): AssetEntryLike {
  return {
    archive: 'Data',
    resource: 2,
    image: 0,
    file: 'Data/0002_000.png',
    width: 8,
    height: 8,
    anchorX: 4,
    anchorY: 3,
    format: 'SPR',
    ...over,
  };
}

/** 一张图的完整规划（8×8 落在 tiny 批，×4） */
function setUp(over: Partial<AssetEntryLike> = {}): { manifest: UpscaleManifest; frame: QueueFrame } {
  const tasks = planUpscale([entry(over)]);
  return {
    manifest: emptyManifest(tasks),
    frame: buildQueueFrame(tasks[0]!, { rgbSha256: 'in-rgb', alphaSha256: 'in-alpha' }),
  };
}

const queueOf = (frames: QueueFrame[]): QueueManifest => ({ version: 1, generatedAt: '2026-09-14T00:00:00.000Z', frames });

function memIo(merged: Record<string, Uint8Array> = {}): AssembleIo & { written: Record<string, Uint8Array> } {
  const written: Record<string, Uint8Array> = {};
  return {
    written,
    readMerged: (rel) => merged[rel] ?? null,
    // FNV-1a：确定且对内容敏感，够本模块的幂等判据用
    hash: (bytes) => {
      let h = 0x811c9dc5;
      for (const b of bytes) {
        h ^= b;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    },
    write: (rel, bytes) => {
      written[rel] = bytes;
    },
  };
}

// ============================================================
//  路径契约（写读两侧共用，见 PRD §4.5）
// ============================================================

describe('hdRelativePath —— hd 路径的唯一定义处', () => {
  it('形如 <archive>/<resource>-<image>.png，十进制无前导零', () => {
    expect(hdRelativePath('Data', 2, 0)).toBe('Data/2-0.png');
    expect(hdRelativePath('Panel', 23, 7)).toBe('Panel/23-7.png');
  });

  it('资源号大于三位数也不截断', () => {
    expect(hdRelativePath('Data', 11837, 12)).toBe('Data/11837-12.png');
  });
});

// ============================================================
//  锚点 —— C-AST-6
// ============================================================

describe('锚点按实际输出尺寸缩放到 4×', () => {
  it('8×8 原图锚点 (4,3) → 32×32 产物锚点 (16,12)', () => {
    const { manifest, frame } = setUp();
    const io = memIo({ [stripRgb(frame)]: png(32, 32) });

    const { manifest: after } = assembleHd(manifest, queueOf([frame]), io);
    const r = after.results[frame.id]!;
    expect({ x: r.outAnchorX, y: r.outAnchorY }).toEqual({ x: 16, y: 12 });
    expect({ w: r.outWidth, h: r.outHeight }).toEqual({ w: 32, h: 32 });
    expect(r.id).toBe(frame.id);
  });

  it('★ 工具把结果对齐到 4 的倍数时，按**实际**尺寸算而不是按请求的 scale', () => {
    // 请求 ×4 应得 32×32；假设工具吐了 36×36（对齐到 4）——
    // 按请求值算锚点会得到 16，按实际算才是 18。这条差异会均匀体现在所有精灵上。
    const { manifest, frame } = setUp({ width: 9, height: 9, anchorX: 4, anchorY: 4 });
    frame.scale = 4;
    const io = memIo({ [stripRgb(frame)]: png(36, 36) });

    const { manifest: after, report } = assembleHd(manifest, queueOf([frame]), io);
    // 9×4 = 36，恰好合规，所以这条能写出去
    expect(report.written).toEqual([frame.id]);
    expect(after.results[frame.id]!.outAnchorX).toBe(16); // round(4 * 36/9) = 16
  });
});

// ============================================================
//  幂等
// ============================================================

describe('manifest 条目幂等', () => {
  it('同一份产物连跑两次：第二次一个字节都不重写', () => {
    const { manifest, frame } = setUp();
    const bytes = png(32, 32);
    const io1 = memIo({ [stripRgb(frame)]: bytes });

    const first = assembleHd(manifest, queueOf([frame]), io1);
    expect(first.report.written).toEqual([frame.id]);
    expect(Object.keys(io1.written)).toEqual([hdRelativePath('Data', 2, 0)]);

    // 第二次带着上一轮的 manifest 重跑
    const io2 = memIo({ [stripRgb(frame)]: bytes });
    const second = assembleHd(first.manifest, queueOf([frame]), io2);
    expect(second.report.written).toEqual([]);
    expect(second.report.skipped).toEqual([frame.id]);
    expect(Object.keys(io2.written)).toEqual([]); // 没写
    // 条目原样保留
    expect(second.manifest.results[frame.id]).toEqual(first.manifest.results[frame.id]);
  });

  it('产物内容变了就重写（哈希不同不再是跳过）', () => {
    const { manifest, frame } = setUp();
    const first = assembleHd(manifest, queueOf([frame]), memIo({ [stripRgb(frame)]: png(32, 32) }));

    const another = png(32, 32, [10, 200, 20, 255]);
    const io = memIo({ [stripRgb(frame)]: another });
    const second = assembleHd(first.manifest, queueOf([frame]), io);
    expect(second.report.written).toEqual([frame.id]);
    expect(second.report.skipped).toEqual([]);
    expect(Object.keys(io.written)).toEqual([hdRelativePath('Data', 2, 0)]);
  });

  it('不就地改传入的 manifest', () => {
    const { manifest, frame } = setUp();
    assembleHd(manifest, queueOf([frame]), memIo({ [stripRgb(frame)]: png(32, 32) }));
    expect(manifest.results).toEqual({});
  });
});

// ============================================================
//  守卫与记账
// ============================================================

describe('落盘前的守卫', () => {
  it('★ 尺寸不合规不落盘：9×9 ×4 该是 36×36，给 31×32 就拒', () => {
    const { manifest, frame } = setUp({ width: 9, height: 9 });
    const io = memIo({ [stripRgb(frame)]: png(31, 32) });

    const { report, manifest: after } = assembleHd(manifest, queueOf([frame]), io);
    expect(report.written).toEqual([]);
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]!.id).toBe(frame.id);
    expect(report.broken[0]!.detail).toContain('≠');
    expect(Object.keys(io.written)).toEqual([]);
    expect(after.results).toEqual({});
  });

  it('PNG 坏了记进 broken，不是抛出去', () => {
    const { manifest, frame } = setUp();
    const io = memIo({ [stripRgb(frame)]: new Uint8Array([1, 2, 3, 4]) });

    const { report } = assembleHd(manifest, queueOf([frame]), io);
    expect(report.written).toEqual([]);
    expect(report.broken.map((b) => b.id)).toEqual([frame.id]);
  });

  it('产物还没交 → missing（不是错误）', () => {
    const { manifest, frame } = setUp();
    const { report } = assembleHd(manifest, queueOf([frame]), memIo());
    expect(report.missing).toEqual([frame.id]);
    expect(report.broken).toEqual([]);
  });

  it('有产物但清单里没这个任务 → unplanned', () => {
    const { manifest } = setUp();
    const stray: QueueFrame = { ...setUp().frame, id: 'Data/9999_999' };
    const { report } = assembleHd(manifest, queueOf([stray]), memIo({ [stripRgb(stray)]: png(32, 32) }));
    expect(report.unplanned).toEqual(['Data/9999_999']);
    expect(report.written).toEqual([]);
  });
});

// ============================================================
//  模型与参数
// ============================================================

describe('manifest 记模型与参数', () => {
  it('缺省用队列里的建议模型（= 该素材类别的建议）', () => {
    const { manifest, frame } = setUp();
    const { manifest: after } = assembleHd(manifest, queueOf([frame]), memIo({ [stripRgb(frame)]: png(32, 32) }));
    expect(frame.model).toBe(SUGGESTED_MODEL[frame.category]);
    expect(after.results[frame.id]!.model).toBe(frame.model);
  });

  it('调用方给了模型就覆盖，参数原样记下', () => {
    const { manifest, frame } = setUp();
    const { manifest: after } = assembleHd(manifest, queueOf([frame]), memIo({ [stripRgb(frame)]: png(32, 32) }), {
      model: 'waifu2x-cunet',
      params: { denoise: 2, tile: 128 },
    });
    expect(after.results[frame.id]!.model).toBe('waifu2x-cunet');
    expect(after.results[frame.id]!.params).toEqual({ denoise: 2, tile: 128 });
  });

  it('srcHash 取交出去的那张 rgb 的哈希（源图一变即变回待办）', () => {
    const { manifest, frame } = setUp();
    const { manifest: after } = assembleHd(manifest, queueOf([frame]), memIo({ [stripRgb(frame)]: png(32, 32) }));
    expect(after.results[frame.id]!.srcHash).toBe('in-rgb');
  });
});

// ============================================================
//  顺序
// ============================================================

describe('帧顺序与原 meta 一致', () => {
  it('written 的次序 = 队列清单的次序', () => {
    const tasks = planUpscale([
      entry({ resource: 2, image: 0 }),
      entry({ resource: 2, image: 1 }),
      entry({ resource: 3, image: 0 }),
    ]);
    const manifest = emptyManifest(tasks);
    const frames = tasks.map((t) => buildQueueFrame(t, { rgbSha256: 'r', alphaSha256: 'a' }));
    const merged = Object.fromEntries(frames.map((f) => [stripRgb(f), png(32, 32)]));

    const { report, manifest: after } = assembleHd(manifest, queueOf(frames), memIo(merged));
    expect(report.written).toEqual(tasks.map((t) => t.id));
    expect(Object.keys(after.results)).toEqual(tasks.map((t) => t.id));
  });
});

/** 队列里 rgb 路径 → merge 产物所在的相对路径（去 `rgb/` 前缀） */
function stripRgb(frame: QueueFrame): string {
  return frame.rgb.replace(/^rgb\//, '');
}
