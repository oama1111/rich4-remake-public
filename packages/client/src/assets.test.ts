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
  loadGround,
  loadHdSource,
  groundLogicalSize,
  SpriteCache,
  type HdSource,
  type LoadedArchives,
  type Sprite,
  characterSetBase,
  CHARACTER_POSE,
} from './assets.ts';
import { assetBase, hdBase } from './host.ts';

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
  entries: Record<string, { anchorX: number; anchorY: number; srcWidth?: number; srcHeight?: number }>,
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

  it('有 HD 记录且产物可用 → 位图用 HD，**逻辑**尺寸与锚点仍是原版表头的', async () => {
    const c = cacheWith({
      hd: fakeHd({ 'Data/0_0': { anchorX: 4, anchorY: 4 } }, { 'Data/0_0': pngOf(8, 8) }),
    });
    const s = await c.get('Data.mkf', 0, 0);
    expect(bitmapSize(s!)).toEqual({ w: 8, h: 8 }); // 2×2 的 4 倍
    // ★ 高清舞台按逻辑坐标画（hd-stage.ts）：锚点若取清单里的 HD 像素值 (4,4)，
    //   精灵会整体偏出去 4 倍
    expect({ w: s!.width, h: s!.height }).toEqual({ w: 2, h: 2 });
    expect({ x: s!.anchorX, y: s!.anchorY }).toEqual({ x: 1, y: 1 });
  });

  it('★ 要换色槽（ring）的图先不走 HD —— 超分后占位色已不是精确值，换不动', async () => {
    const c = cacheWith({
      hd: fakeHd({ 'Data/0_0': { anchorX: 4, anchorY: 4 } }, { 'Data/0_0': pngOf(8, 8) }),
    });
    const s = await c.get('Data.mkf', 0, 0, false, [255, 0, 0]);
    expect(bitmapSize(s!)).toEqual({ w: 2, h: 2 });
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
    expect(bitmapSize(zero!)).toEqual({ w: 12, h: 8 }); // HD 位图
    expect({ x: zero!.anchorX, y: zero!.anchorY, w: zero!.width, h: zero!.height }).toEqual({ x: 2, y: 1, w: 3, h: 2 }); // 逻辑 = 原版表头
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
//  ★ Q-PERF-1：淘汰监听是**列表**，不是「一个可被顶掉的回调」
// ============================================================

describe('★ 淘汰监听（Q-PERF-1）', () => {
  it('addEvictListener 与构造参数 onEvict 是**并存**的，不会互相顶掉', async () => {
    const a: string[] = [];
    const b: string[] = [];
    // 构造参数先挂（模拟 main.ts 传进来的那个）
    const withCtor = cacheWith({
      resources: { 0: spr2x2(), 1: spr3x2(), 2: spr2x2() },
      maxSprites: 2,
      onEvict: (s) => a.push(`${s.width}x${s.height}`),
    });
    withCtor.addEvictListener((s) => b.push(`${s.width}x${s.height}`));

    await withCtor.get('Data.mkf', 0, 0);
    await withCtor.get('Data.mkf', 1, 0);
    await withCtor.get('Data.mkf', 2, 0); // 挤掉第一张

    // ★ 两条都收到 —— 属性式赋值会让后挂的把先挂的挤掉，症状是「有一边的内存放不掉」
    expect(a).toEqual(['2x2']);
    expect(b).toEqual(['2x2']);
    expect(withCtor.size).toBe(2);
  });

  it('null 条目淘汰时不惊动任何监听（它本来就不占内存）', async () => {
    const seen: number[] = [];
    const c = cacheWith({ resources: { 0: spr2x2() }, maxSprites: 1 });
    c.addEvictListener(() => seen.push(1));
    await c.get('Data.mkf', 0, 9); // null
    await c.get('Data.mkf', 0, 0); // 真图，挤掉 null
    expect(seen).toEqual([]);
  });
});

// ============================================================
//  ★ Q-PERF-1：桌面端 HD 的 URL 形状
// ============================================================

describe('★ hdBase —— 桌面壳与浏览器各拼各的前缀，路由两侧对齐', () => {
  const tauriGlobal = (globalThis as unknown as { __TAURI__?: unknown });

  afterEach(() => {
    delete tauriGlobal.__TAURI__;
  });

  it('浏览器：与 /assets/game 同源，换成 /assets/hd', () => {
    expect(assetBase()).toBe('/assets/game');
    expect(hdBase()).toBe('/assets/hd');
  });

  it('★ 桌面壳：rich4://localhost/hd —— Rust 那条 is_hd_path 放行的正是它', () => {
    tauriGlobal.__TAURI__ = { core: { invoke: async () => null } };
    expect(assetBase()).toBe('rich4://localhost');
    expect(hdBase()).toBe('rich4://localhost/hd');
  });

  it('★ 清单 URL 就是把 hd 前缀接上 `-manifest.json`（与产物目录同级）', () => {
    tauriGlobal.__TAURI__ = { core: { invoke: async () => null } };
    // loadHdSource 拉的就是 `${base}-manifest.json`，见 assets.test 的 loadHdSource 一节
    expect(`${hdBase()}-manifest.json`).toBe('rich4://localhost/hd-manifest.json');
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

  it('★ 任务带源图尺寸 → 条目也带上（底图靠它知道 HD 是几倍）', () => {
    const hd = hdSourceFromManifest('/assets/hd', {
      tasks: [{ archive: 'map', resource: 6, image: 0, srcWidth: 2304, srcHeight: 2304 }],
      results: { 'map/0006_000': { outAnchorX: 0, outAnchorY: 0 } },
    });
    expect(hd.entry('map.mkf', 6, 0)).toEqual({ anchorX: 0, anchorY: 0, srcWidth: 2304, srcHeight: 2304 });
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

describe('★ 载具图组（T-049）—— 按交通方式取，与地形无关', () => {
  it('组基号 = 0x80 + 角色×21 + 交通方式×3 @source VA 0x0040bbd8', () => {
    expect(characterSetBase(0, 0)).toBe(0x80);
    expect(characterSetBase(0, 1)).toBe(0x83);
    expect(characterSetBase(0, 2)).toBe(0x86);
    expect(characterSetBase(0, 3)).toBe(0x89); // ★ 船
    expect(characterSetBase(1, 0)).toBe(0x80 + 21);
  });

  it('组内三张 = 站 / 走 / 手持骰子', () => {
    expect(CHARACTER_POSE.stand).toBe(0);
    expect(CHARACTER_POSE.walk).toBe(1);
    expect(CHARACTER_POSE.dice).toBe(2);
    for (let t = 0; t < 4; t++) {
      const base = characterSetBase(3, t);
      expect(base + CHARACTER_POSE.walk - base).toBe(1);
      expect(base + CHARACTER_POSE.dice - base).toBe(2);
    }
  });

  it('交通方式按 `& 3` 回绕（原版 `and al, 3`）', () => {
    expect(characterSetBase(0, 4)).toBe(characterSetBase(0, 0));
    expect(characterSetBase(0, 7)).toBe(characterSetBase(0, 3));
  });

  it('12 个角色 × 21 不越出 Data.mkf 的角色段（0x80..0xEC）', () => {
    expect(characterSetBase(11, 3) + 2).toBe(0x80 + 11 * 21 + 11);
  });
});

// ============================================================
//  ★ 底图的 HD 优先（Q-PERF-GND §三 第 1 条）
//    资源号与 .gnd 同一套：`地图号 × 2`、图号 0
// ============================================================

describe('★ loadGround：有 HD 就用 HD，缺了就按图回退原图', () => {
  /**
   * 造一张**最小的合法 `.gnd`**：1 块（32×32）、调色板全黑、像素全 0。
   *
   * 布局照 `ground.ts` 的常量：魔数 4 + 块数 4 + 调色板 0x10 起 512 字节 +
   * 布局表 → 像素从 `0x2a90` 起，每块 1024 字节。
   * ⇒ 解出来 32×32 —— 与 HD 那张 9216² 一眼能分开。
   */
  const tinyGround = (): Uint8Array => {
    const out = new Uint8Array(0x2a90 + 1024);
    out.set([0x47, 0x4e, 0x44, 0x00], 0); // 'GND\0'
    const view = new DataView(out.buffer);
    view.setUint16(4, 1, true); // tilesX
    view.setUint16(6, 1, true); // tilesY
    view.setUint32(8, 1, true); // tileCount
    return out;
  };

  /** 底图用的假解码器：记下收到的是 Blob（HD）还是 ImageData（原图） */
  const spyDecode = () => {
    const calls: string[] = [];
    const decode = async (src: ImageData | Blob): Promise<ImageBitmap> => {
      calls.push(src instanceof Blob ? 'blob' : 'imagedata');
      if (src instanceof Blob) return { width: 9216, height: 9216 } as unknown as ImageBitmap;
      return { width: src.width, height: src.height } as unknown as ImageBitmap;
    };
    return { decode, calls };
  };

  it('★★ 清单里有 `map/6_0` ⇒ 走 HD（解码器收到的是 PNG 字节的 Blob）', async () => {
    const hd = fakeHd(
      { 'map/6_0': { anchorX: 0, anchorY: 0, srcWidth: 2304, srcHeight: 2304 } },
      { 'map/6_0': new Uint8Array([1, 2, 3]) },
    );
    const { decode, calls } = spyDecode();
    const bmp = await loadGround(fakeArchives({ 6: tinyGround() }), 3, hd, decode);
    expect(calls).toEqual(['blob']);
    expect(bmp!.width).toBe(9216);
    // ★ 棋盘按逻辑尺寸数格子（32 像素一格），不按位图像素
    expect(groundLogicalSize(bmp!)).toEqual({ width: 2304, height: 2304 });
  });

  it('★ 清单条目没有源图尺寸 ⇒ 不知道 HD 是几倍，宁可回退原图', async () => {
    const hd = fakeHd({ 'map/6_0': { anchorX: 0, anchorY: 0 } }, { 'map/6_0': new Uint8Array([1, 2, 3]) });
    const { decode, calls } = spyDecode();
    const bmp = await loadGround(fakeArchives({ 6: tinyGround() }), 3, hd, decode);
    expect(calls).toEqual(['imagedata']);
    expect(groundLogicalSize(bmp!)).toEqual({ width: 32, height: 32 });
  });

  it('★ 清单里没有 ⇒ 现解 `.gnd`（解码器收到 ImageData，尺寸是原图的）', async () => {
    const hd = fakeHd({}, {});
    const { decode, calls } = spyDecode();
    const bmp = await loadGround(fakeArchives({ 6: tinyGround() }), 3, hd, decode);
    expect(calls).toEqual(['imagedata']);
    expect(bmp!.width).toBe(32);
  });

  it('★ 有记录但**拉不到字节**（产物没生成）⇒ 也回退原图', async () => {
    const hd = fakeHd({ 'map/6_0': { anchorX: 0, anchorY: 0 } }, { 'map/6_0': null });
    const { decode, calls } = spyDecode();
    const bmp = await loadGround(fakeArchives({ 6: tinyGround() }), 3, hd, decode);
    expect(calls).toEqual(['imagedata']);
    expect(bmp!.width).toBe(32);
  });

  it('★ HD 解不开（坏图）也不致命：落到原图', async () => {
    const hd = fakeHd(
      { 'map/6_0': { anchorX: 0, anchorY: 0, srcWidth: 32, srcHeight: 32 } },
      { 'map/6_0': new Uint8Array([9]) },
    );
    const calls: string[] = [];
    const decode = async (src: ImageData | Blob): Promise<ImageBitmap> => {
      calls.push(src instanceof Blob ? 'blob' : 'imagedata');
      if (src instanceof Blob) throw new Error('bad png');
      return { width: src.width, height: src.height } as unknown as ImageBitmap;
    };
    const bmp = await loadGround(fakeArchives({ 6: tinyGround() }), 3, hd, decode);
    expect(calls).toEqual(['blob', 'imagedata']);
    expect(bmp!.width).toBe(32);
  });

  it('★ 没给 HD 来源（整包原图）⇒ 直接走 `.gnd`', async () => {
    const { decode, calls } = spyDecode();
    const bmp = await loadGround(fakeArchives({ 6: tinyGround() }), 3, null, decode);
    expect(calls).toEqual(['imagedata']);
    expect(bmp!.width).toBe(32);
  });
});
