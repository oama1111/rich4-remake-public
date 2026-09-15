/*
 * T-065：SpriteCache 按图优先读 hd，缺则回退原图
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Node 里没有 ImageData / createImageBitmap / 真素材，故三样都注入：
 * ImageData 用最小替身补全局，位图工厂与 HD 来源走 SpriteCache 的注入口。
 * 于是「按图回退」「LRU」这些最容易写错的规矩可以逐条钉死。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { type DecodedImage, type MkfArchive } from '@rich4/assets-pipeline';
// PNG 编解码走 Node 专用出口（用了 node:zlib，不能进前端包）—— 测试跑在 Node 下，够用
import { decodePng, encodePng } from '@rich4/assets-pipeline/node';
import {
  archiveKey,
  hdSourceFromManifest,
  loadHdSource,
  SpriteCache,
  type HdSource,
  type LoadedArchives,
  type Sprite,
} from './assets.ts';

// ============================================================
//  浏览器全局的最小替身
// ============================================================

class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

beforeEach(() => {
  (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;
});

/**
 * 假的位图工厂 —— 模拟浏览器的 `createImageBitmap`。
 *
 * ★ 两条分支都必要：原图走 ImageData（尺寸现成），**HD 走 Blob**
 *   （T-065 改成把 PNG 字节交给浏览器原生解码，不再自己 `decodePng`）。
 *   Blob 这条就真解一次 PNG 拿尺寸 —— 与浏览器实际做的事等价。
 */
const fakeBitmapOf = async (source: ImageData | Blob): Promise<ImageBitmap> => {
  // ★ 把像素一并带上：换色（Q-LAYOUT-8）这类改像素的功能要靠它断言
  if (source instanceof Blob) {
    const img = decodePng(new Uint8Array(await source.arrayBuffer()));
    return { width: img.width, height: img.height, rgba: img.rgba } as unknown as ImageBitmap;
  }
  return { width: source.width, height: source.height, rgba: source.data } as unknown as ImageBitmap;
};

/** 取假位图里第 i 个像素的 RGB */
const rgbAt = (s: Sprite, i: number): number[] => {
  const b = s.bitmap as unknown as { rgba: Uint8ClampedArray };
  return [b.rgba[i * 4]!, b.rgba[i * 4 + 1]!, b.rgba[i * 4 + 2]!];
};

const bitmapSize = (s: Sprite): { w: number; h: number } => {
  const b = s.bitmap as unknown as { width: number; height: number };
  return { w: b.width, h: b.height };
};

// ============================================================
//  最小 SPR 夹具
// ============================================================

/**
 * 造一张 2×2 的 SPR：索引 0 透明、索引 1 白。
 * 布局 = 'SPR' + 块数 + 调色板偏移 + 12 字节块头，随后 512 字节调色板、像素。
 */
function spr2x2(): Uint8Array {
  const startOffset = 12 + 12;
  const gsize = 4;
  const buf = new Uint8Array(startOffset + 512 + gsize);
  const view = new DataView(buf.buffer);
  buf.set([0x53, 0x50, 0x52]); // 'SPR'
  view.setUint32(4, 1, true); // 块数
  view.setUint32(8, startOffset, true);
  // 块头：宽 2 高 2，锚点 (1,1)，像素字节数 4
  view.setInt16(12, 2, true);
  view.setInt16(14, 2, true);
  view.setInt16(16, 1, true);
  view.setInt16(18, 1, true);
  view.setUint32(20, gsize, true);
  // 调色板：0 号黑（透明），1 号白（RGB555 = 0x7FFF）
  view.setUint16(startOffset + 0 * 2, 0x0000, true);
  view.setUint16(startOffset + 1 * 2, 0x7fff, true);
  // 像素
  buf.set([1, 0, 0, 1], startOffset + 512);
  return buf;
}

/** 另一张不同尺寸的 SPR：3×2（单帧） */
function spr3x2(): Uint8Array {
  const startOffset = 24;
  const gsize = 6;
  const buf = new Uint8Array(startOffset + 512 + gsize);
  const view = new DataView(buf.buffer);
  buf.set([0x53, 0x50, 0x52]);
  view.setUint32(4, 1, true);
  view.setUint32(8, startOffset, true);
  view.setInt16(12, 3, true);
  view.setInt16(14, 2, true);
  view.setInt16(16, 2, true);
  view.setInt16(18, 1, true);
  view.setUint32(20, gsize, true);
  view.setUint16(startOffset, 0x0000, true);
  view.setUint16(startOffset + 2, 0x7fff, true);
  buf.set([1, 1, 0, 0, 1, 1], startOffset + 512);
  return buf;
}

/**
 * 双帧 SPR：帧 0 是 3×2（锚点 2,1），帧 1 是 2×2（锚点 1,1）。
 * 「同一资源里一张有 HD、一张没有」要靠它才测得出来。
 */
function sprTwoFrames(): Uint8Array {
  const startOffset = 36; // 12 头 + 2×12 块头
  const g0 = 3 * 2;
  const g1 = 2 * 2;
  const buf = new Uint8Array(startOffset + 512 + g0 + g1);
  const view = new DataView(buf.buffer);
  buf.set([0x53, 0x50, 0x52]);
  view.setUint32(4, 2, true); // 两块
  view.setUint32(8, startOffset, true);

  view.setInt16(12, 3, true);
  view.setInt16(14, 2, true);
  view.setInt16(16, 2, true);
  view.setInt16(18, 1, true);
  view.setUint32(20, g0, true);

  view.setInt16(24, 2, true);
  view.setInt16(26, 2, true);
  view.setInt16(28, 1, true);
  view.setInt16(30, 1, true);
  view.setUint32(32, g1, true);

  view.setUint16(startOffset, 0x0000, true);
  view.setUint16(startOffset + 2, 0x7fff, true);
  buf.set([1, 1, 0, 0, 1, 1], startOffset + 512);
  buf.set([1, 0, 0, 1], startOffset + 512 + g0);
  return buf;
}

function fakeArchives(byResource: Record<number, Uint8Array>): LoadedArchives {
  return {
    get: () =>
      ({
        read: (i: number) => {
          const d = byResource[i];
          if (d === undefined) throw new Error(`空槽 ${i}`);
          return d;
        },
      }) as unknown as MkfArchive,
  };
}

const pngOf = (width: number, height: number): Uint8Array =>
  encodePng({
    width,
    height,
    anchorX: 0,
    anchorY: 0,
    rgba: new Uint8ClampedArray(width * height * 4).fill(255),
  } satisfies DecodedImage);

/** 一个只认识给定几条记录的假 HD 来源 */
function fakeHd(
  entries: Record<string, { anchorX: number; anchorY: number }>,
  bytes: Record<string, Uint8Array | null> = {},
): HdSource {
  const idOf = (archive: string, resource: number, image: number): string =>
    `${archive}/${resource}_${image}`;
  return {
    entry: (archive, resource, image) => entries[idOf(archiveKey(archive), resource, image)] ?? null,
    fetchBytes: (archive, resource, image) => {
      const key = idOf(archiveKey(archive), resource, image);
      return Promise.resolve(bytes[key] ?? null);
    },
  };
}

function cacheWith(opts: {
  resources?: Record<number, Uint8Array>;
  hd?: HdSource;
  maxSprites?: number;
  maxBytes?: number;
  onEvict?: (s: Sprite) => void;
}): SpriteCache {
  const base = {
    createBitmap: fakeBitmapOf,
  };
  return new SpriteCache(fakeArchives(opts.resources ?? { 0: spr2x2() }), {
    ...base,
    ...(opts.hd === undefined ? {} : { hd: opts.hd }),
    ...(opts.maxSprites === undefined ? {} : { maxSprites: opts.maxSprites }),
    ...(opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes }),
    ...(opts.onEvict === undefined ? {} : { onEvict: opts.onEvict }),
  });
}

// ============================================================
//  档案名
// ============================================================

describe('archiveKey —— 档案名与清单对齐', () => {
  it('去掉 .mkf 后缀（清单里存的是 Data 而不是 Data.mkf）', () => {
    expect(archiveKey('Data.mkf')).toBe('Data');
    expect(archiveKey('Panel.mkf')).toBe('Panel');
    expect(archiveKey('map.mkf')).toBe('map');
  });
});

// ============================================================
//  回退路径
// ============================================================

describe('HD 优先、按图回退原图', () => {
  it('没有 HD 来源 → 整包走原图，锚点来自原图', async () => {
    const c = cacheWith({});
    const s = await c.get('Data.mkf', 0, 0);
    expect(s).not.toBeNull();
    expect(bitmapSize(s!)).toEqual({ w: 2, h: 2 });
    expect({ x: s!.anchorX, y: s!.anchorY }).toEqual({ x: 1, y: 1 });
  });

  it('有 HD 记录且产物可用 → 用 HD：尺寸与锚点都来自 HD 侧', async () => {
    const c = cacheWith({
      hd: fakeHd({ 'Data/0_0': { anchorX: 4, anchorY: 4 } }, { 'Data/0_0': pngOf(8, 8) }),
    });
    const s = await c.get('Data.mkf', 0, 0);
    expect(bitmapSize(s!)).toEqual({ w: 8, h: 8 }); // 2×2 的 4 倍
    expect({ x: s!.anchorX, y: s!.anchorY }).toEqual({ x: 4, y: 4 }); // 清单给的，不是自己乘的
  });

  it('★ 有记录但产物拉不到 → 回退原图（不是报错、也不是空白）', async () => {
    const c = cacheWith({ hd: fakeHd({ 'Data/0_0': { anchorX: 4, anchorY: 4 } }) });
    const s = await c.get('Data.mkf', 0, 0);
    expect(bitmapSize(s!)).toEqual({ w: 2, h: 2 });
    expect({ x: s!.anchorX, y: s!.anchorY }).toEqual({ x: 1, y: 1 });
  });

  it('★ 产物是坏 PNG → 回退原图，不抛错', async () => {
    const c = cacheWith({
      hd: fakeHd({ 'Data/0_0': { anchorX: 4, anchorY: 4 } }, { 'Data/0_0': new Uint8Array([1, 2, 3]) }),
    });
    const s = await c.get('Data.mkf', 0, 0);
    expect(bitmapSize(s!)).toEqual({ w: 2, h: 2 });
  });

  it('★ 按图回退：同一资源里一帧有 HD、一帧没有，各走各的', async () => {
    // 帧 0 有 HD，帧 1 没有 —— 整包回退是错的，那样帧 0 也会被降级
    const c = cacheWith({
      resources: { 0: sprTwoFrames() },
      hd: fakeHd({ 'Data/0_0': { anchorX: 8, anchorY: 4 } }, { 'Data/0_0': pngOf(12, 8) }),
    });
    const zero = await c.get('Data.mkf', 0, 0);
    const one = await c.get('Data.mkf', 0, 1);
    expect(bitmapSize(zero!)).toEqual({ w: 12, h: 8 }); // HD（3×2 的 4 倍）
    expect({ x: zero!.anchorX, y: zero!.anchorY }).toEqual({ x: 8, y: 4 });
    expect(bitmapSize(one!)).toEqual({ w: 2, h: 2 }); // 原图
    expect({ x: one!.anchorX, y: one!.anchorY }).toEqual({ x: 1, y: 1 });
  });

  it('资源或图号不存在 → null（原版空槽很常见）', async () => {
    const c = cacheWith({ resources: {} });
    expect(await c.get('Data.mkf', 0, 0)).toBeNull();
    expect(await c.get('Data.mkf', 0, 9)).toBeNull();
  });

  it('同一张图第二次取走缓存（位图工厂只调一次）', async () => {
    const createBitmap = vi.fn(fakeBitmapOf);
    const c = new SpriteCache(fakeArchives({ 0: spr2x2() }), { createBitmap });
    await c.get('Data.mkf', 0, 0);
    await c.get('Data.mkf', 0, 0);
    expect(createBitmap).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
//  内存上限（C-PERF-2）
// ============================================================

describe('LRU 上限', () => {
  it('精灵数不超过上限', async () => {
    const c = cacheWith({ resources: { 0: spr2x2(), 1: spr3x2() }, maxSprites: 2 });
    await c.get('Data.mkf', 0, 0);
    await c.get('Data.mkf', 1, 0);
    await c.get('Data.mkf', 0, 0);
    expect(c.size).toBeLessThanOrEqual(2);
  });

  it('★ 淘汰的是最久未用的：反复用到的不会被淘汰', async () => {
    const evicted: string[] = [];
    const c = cacheWith({
      resources: { 0: spr2x2(), 1: spr3x2() },
      maxSprites: 2,
      onEvict: (s) => evicted.push(`${s.width}x${s.height}`),
    });

    await c.get('Data.mkf', 0, 0); // A (2x2)
    await c.get('Data.mkf', 1, 0); // B (3x2)
    await c.get('Data.mkf', 0, 0); // 再取 A —— A 变成最近使用
    await c.get('Data.mkf', 1, 0); // 再取 B
    await c.get('Data.mkf', 0, 0); // 再取 A

    // 上限 2、只用了两张，一张都不该被淘汰
    expect(evicted).toEqual([]);
    expect(c.size).toBe(2);
  });

  it('超出上限时最久未用的那张被淘汰，且回调拿到它', async () => {
    const evicted: string[] = [];
    const resources = { 0: spr2x2(), 1: spr3x2(), 2: spr2x2() };
    const c = cacheWith({ resources, maxSprites: 2, onEvict: (s) => evicted.push(`${s.width}x${s.height}`) });

    await c.get('Data.mkf', 0, 0); // A (2x2) —— 最久未用
    await c.get('Data.mkf', 1, 0); // B (3x2)
    await c.get('Data.mkf', 2, 0); // C (2x2) —— 挤掉 A

    expect(evicted).toEqual(['2x2']);
    expect(c.size).toBe(2);
  });

  it('★ null 条目也占额度：「这里没有这张图」的结论本身也不该无限堆积', async () => {
    const evicted: string[] = [];
    const c = cacheWith({
      resources: { 0: spr2x2() },
      maxSprites: 1,
      onEvict: (s) => evicted.push(`${s.width}x${s.height}`),
    });
    await c.get('Data.mkf', 0, 0); // 真图，size = 1
    await c.get('Data.mkf', 0, 9); // null 条目，size = 2 > 1 → 挤掉真图
    expect(c.size).toBe(1);
    expect(evicted).toEqual(['2x2']);

    // 反过来：先塞 null 再塞真图，被挤掉的是 null，回调不该被调
    evicted.length = 0;
    const c2 = cacheWith({ resources: { 0: spr2x2() }, maxSprites: 1, onEvict: (s) => evicted.push(`${s.width}x${s.height}`) });
    await c2.get('Data.mkf', 0, 9); // null
    await c2.get('Data.mkf', 0, 0); // 真图，挤掉 null
    expect(evicted).toEqual([]);
  });

  it('字节缓存也受上限约束', async () => {
    const resources: Record<number, Uint8Array> = {};
    for (let i = 0; i < 6; i++) resources[i] = spr2x2();
    const c = cacheWith({ resources, maxBytes: 3 });
    for (let i = 0; i < 6; i++) await c.get('Data.mkf', i, 0);
    expect(c.byteSize).toBeLessThanOrEqual(3);
  });
});

// ============================================================
//  清单 → HdSource
// ============================================================

describe('hdSourceFromManifest', () => {
  it('★ 只有任务、没有结果 → 不算有 HD（「规划过」不等于「有产物」）', () => {
    const hd = hdSourceFromManifest('/assets/hd', {
      tasks: [{ archive: 'Data', resource: 0, image: 0 }],
      results: {},
    });
    expect(hd.entry('Data.mkf', 0, 0)).toBeNull();
  });

  it('有结果 → 给出锚点（已按实际输出尺寸缩放好）', () => {
    const hd = hdSourceFromManifest('/assets/hd', {
      tasks: [{ archive: 'Data', resource: 2, image: 3 }],
      results: { 'Data/0002_003': { outAnchorX: 16, outAnchorY: 12 } },
    });
    expect(hd.entry('Data.mkf', 2, 3)).toEqual({ anchorX: 16, anchorY: 12 });
    expect(hd.entry('Data.mkf', 2, 4)).toBeNull();
    expect(hd.entry('Panel.mkf', 2, 3)).toBeNull();
  });

  it('★ 取产物用的是 hdRelativePath 的命名（写读两侧同一函数）', async () => {
    const hd = hdSourceFromManifest('https://x/assets/hd', {
      tasks: [{ archive: 'Panel', resource: 23, image: 7 }],
      results: { 'Panel/0023_007': { outAnchorX: 1, outAnchorY: 1 } },
    });
    const seen: string[] = [];
    const fetchStub = vi.fn((url: string) => {
      seen.push(url);
      return Promise.resolve({ ok: false } as Response);
    });
    const original = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = fetchStub;
    try {
      await hd.fetchBytes('Panel.mkf', 23, 7);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = original;
    }
    expect(seen).toEqual(['https://x/assets/hd/Panel/23-7.png']);
  });

  it('产物缺失（404）→ null，交由调用方回退', async () => {
    const hd = hdSourceFromManifest('/assets/hd', {
      tasks: [{ archive: 'Data', resource: 0, image: 0 }],
      results: { 'Data/0000_000': { outAnchorX: 0, outAnchorY: 0 } },
    });
    const original = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: false, status: 404 } as Response);
    try {
      expect(await hd.fetchBytes('Data.mkf', 0, 0)).toBeNull();
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = original;
    }
  });
});

describe('loadHdSource', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  });

  it('清单取不到 → null（整包走原图，属正常状态）', async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = () => Promise.resolve({ ok: false } as Response);
    expect(await loadHdSource('/assets/hd')).toBeNull();
  });

  it('清单在 hd 目录的**同级**、名字是 <目录名>-manifest.json', async () => {
    const seen: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: string) => {
      seen.push(url);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tasks: [], results: {} }),
      } as unknown as Response);
    });
    await loadHdSource('/assets/hd');
    expect(seen).toEqual(['/assets/hd-manifest.json']);
  });
});

// ============================================================
//  归属线换色（Q-LAYOUT-8）
// ============================================================

describe('★ 建筑外圈那圈线按所有者的角色色换色', () => {
  /**
   * 造一张 2×2 的 SPR：调色板 #1 = 青、**#255 = 白**（占位色），
   * 像素用 [#255, #1, #255, #1] —— 正好隔一个。
   */
  function sprRing(): Uint8Array {
    const startOffset = 24;
    const gsize = 4;
    const buf = new Uint8Array(startOffset + 512 + gsize);
    const view = new DataView(buf.buffer);
    buf.set([0x53, 0x50, 0x52]);
    view.setUint32(4, 1, true);
    view.setUint32(8, startOffset, true);
    view.setInt16(12, 2, true);
    view.setInt16(14, 2, true);
    view.setInt16(16, 1, true);
    view.setInt16(18, 1, true);
    view.setUint32(20, gsize, true);
    view.setUint16(startOffset + 0 * 2, 0x0000, true); // #0 黑（索引 0 = 透明）
    view.setUint16(startOffset + 1 * 2, 0x03ff, true); // #1 青（RGB555 0x3FF，与真实建筑精灵的占位色同值）
    view.setUint16(startOffset + 255 * 2, 0x7fff, true); // ★ #255 白 = 可换色槽
    buf.set([255, 1, 255, 1], startOffset + 512);
    return buf;
  }

  it('★ 不给 ring → 保持占位色（#255 白、#1 青）', async () => {
    const cache = cacheWith({ resources: { 0: sprRing() } });
    const s = await cache.get('Data.mkf', 0, 0);
    expect(rgbAt(s!, 0)).toEqual([255, 255, 255]); // 槽位像素 = 占位色
    expect(rgbAt(s!, 1)).toEqual([0, 255, 255]); // 普通像素不受影响
  });

  it('★ 给了 ring → 只把占位色那批像素换成角色色，别的不动', async () => {
    const cache = cacheWith({ resources: { 0: sprRing() } });
    const s = await cache.get('Data.mkf', 0, 0, false, [0x94, 0x61, 0x26]); // 約翰喬色
    expect(rgbAt(s!, 0)).toEqual([0x94, 0x61, 0x26]); // 槽位像素被换
    expect(rgbAt(s!, 2)).toEqual([0x94, 0x61, 0x26]); // 另一个槽位像素也被换
    expect(rgbAt(s!, 1)).toEqual([0, 255, 255]); // ★ 普通像素**原样**
  });

  it('★ 同一张图、不同 ring 走不同缓存键（不会互相串色）', async () => {
    const calls: string[] = [];
    const factory = async (src: ImageData | Blob): Promise<ImageBitmap> => {
      calls.push(src instanceof Blob ? 'blob' : `${src.width}x${src.height}`);
      return fakeBitmapOf(src);
    };
    const cache = new SpriteCache(fakeArchives({ 0: sprRing() }), { createBitmap: factory });
    const a = await cache.get('Data.mkf', 0, 0, false, [1, 2, 3]);
    const b = await cache.get('Data.mkf', 0, 0, false, [4, 5, 6]);
    await cache.get('Data.mkf', 0, 0, false, [1, 2, 3]); // 命中，不该再解码
    expect(calls).toHaveLength(2);
    expect(rgbAt(a!, 0)).toEqual([1, 2, 3]);
    expect(rgbAt(b!, 0)).toEqual([4, 5, 6]);
  });
});
