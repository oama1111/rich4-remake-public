/*
 * W-72：网页版素材载入 —— 一次下完 7 个、进 Cache Storage、带真实进度
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ `fetch` 与 `caches` 都是**注入的假货**：这一份测的是「什么时候发请求、
 *   发几次、存不存、进度怎么走」，与网络和浏览器都无关。
 * ★ `Response` 用的是 Node 自带的那个（Node 18+ 有），所以字节流、
 *   `res.body.getReader()`、`Response.clone()` 全是真的 —— 只有传输是假的。
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_NAMES,
  ASSET_CACHE_NAME,
  type AssetManifest,
  type FetchLike,
  type LoadProgress,
  MANIFEST_NAME,
  loadAllArchives,
  loadAssetManifest,
} from './asset-loader.ts';

const BASE = '/assets/game';
const noSleep = (): Promise<void> => Promise.resolve();

/** 第 i 个档案的假 sha256 —— 64 位、互不相同，`?v=` 取前 8 位 */
const shaOf = (i: number): string => String(i).repeat(64);
const versionOf = (i: number): string => shaOf(i).slice(0, 8);

/**
 * 长度各不相同，好让「总字节数」这件事有区分度。
 *
 * ⚠️ 显式写 `Uint8Array<ArrayBuffer>` 是为了能直接喂给 `new Response()` ——
 *   TS 5.7 起裸 `Uint8Array` 是 `Uint8Array<ArrayBufferLike>`，而 `BodyInit`
 *   只收 `ArrayBufferView<ArrayBuffer>`（运行时其实一样）。
 */
function bytesOf(i: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(10 + i * 3).fill(i + 1);
}

/** 造一份完整清单（7 个档案全在） */
function fullManifest(overrides: Record<string, string> = {}, version = 'v1'): AssetManifest {
  return {
    version,
    files: ARCHIVE_NAMES.map((name, i) => ({
      name,
      size: bytesOf(i).byteLength,
      sha256: overrides[name] ?? shaOf(i),
    })),
  };
}

interface FakeNet {
  fetch: FetchLike;
  /** 每个 URL 被请求了几次 */
  calls: Map<string, number>;
  /** 素材请求（不含 manifest）次数 */
  assetCalls(): number;
  /** 同时在飞的请求峰值 */
  peak(): number;
}

/**
 * 假网络。
 *
 * `bodies` 的键是**完整 URL**（含 `?v=`），值是字节或一个能造 `Response` 的函数
 * （要模拟坏响应、非 200 就用函数）。
 */
function fakeNet(
  manifest: AssetManifest | null,
  bodies: Map<string, Uint8Array<ArrayBuffer> | (() => Response)> = new Map(),
): FakeNet {
  const calls = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchLike = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      // 让出一次宏任务，好让并发真的重叠起来（不然峰值恒为 1，测不出上限）
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (url.endsWith(MANIFEST_NAME)) {
        if (manifest === null) return new Response('not found', { status: 404 });
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const body = bodies.get(url);
      if (body === undefined) return new Response('not found', { status: 404 });
      return typeof body === 'function' ? body() : new Response(body);
    } finally {
      inFlight -= 1;
    }
  };
  return {
    fetch,
    calls,
    assetCalls: () => [...calls.entries()].filter(([u]) => !u.endsWith(MANIFEST_NAME)).reduce((s, [, n]) => s + n, 0),
    peak: () => maxInFlight,
  };
}

interface FakeCaches {
  storage: CacheStorage;
  /** 桶里的键 → 响应（真的 `Response`，`match` 时给一份 `clone`） */
  store: Map<string, Response>;
  opened(): number;
}

/** 假 Cache Storage —— 只实现我们用到的那四个方法 */
function fakeCaches(): FakeCaches {
  const store = new Map<string, Response>();
  let openCount = 0;
  const cache = {
    match: (url: string): Promise<Response | undefined> => {
      const hit = store.get(url);
      return Promise.resolve(hit === undefined ? undefined : hit.clone());
    },
    put: (url: string, res: Response): Promise<void> => {
      store.set(url, res);
      return Promise.resolve();
    },
    keys: (): Promise<{ url: string }[]> => Promise.resolve([...store.keys()].map((url) => ({ url }))),
    delete: (url: string): Promise<boolean> => Promise.resolve(store.delete(url)),
  };
  const storage = {
    open: (name: string): Promise<typeof cache> => {
      openCount += 1;
      expect(name).toBe(ASSET_CACHE_NAME);
      return Promise.resolve(cache);
    },
  } as unknown as CacheStorage;
  return { storage, store, opened: () => openCount };
}

/** 把 7 个档案的字节按 `?v=` 后的 URL 放进假网络 */
function netFor(
  manifest: AssetManifest,
  patch: Map<string, Uint8Array<ArrayBuffer> | (() => Response)> = new Map(),
): FakeNet {
  const bodies = new Map<string, Uint8Array<ArrayBuffer> | (() => Response)>();
  for (const f of manifest.files) {
    const i = ARCHIVE_NAMES.indexOf(f.name as (typeof ARCHIVE_NAMES)[number]);
    if (i >= 0) bodies.set(`${BASE}/${f.name}?v=${f.sha256.slice(0, 8)}`, bytesOf(i));
  }
  for (const [k, v] of patch) bodies.set(k, v);
  return fakeNet(manifest, bodies);
}

const totalOf = (m: AssetManifest): number => m.files.reduce((s, f) => s + f.size, 0);

describe('★ 清单', () => {
  it('拿得到就解析；404 / 坏 JSON / 形状不对都当「没有清单」', async () => {
    const m = fullManifest();
    const ok = await loadAssetManifest(BASE, fakeNet(m).fetch);
    expect(ok).toEqual(m);

    expect(await loadAssetManifest(BASE, fakeNet(null).fetch)).toBeNull();
    const broken: FetchLike = () => Promise.resolve(new Response('{', { status: 200 }));
    expect(await loadAssetManifest(BASE, broken)).toBeNull();
    const wrongShape: FetchLike = () => Promise.resolve(new Response('{"files":[]}', { status: 200 }));
    expect(await loadAssetManifest(BASE, wrongShape)).toBeNull();
    const badFile: FetchLike = () =>
      Promise.resolve(new Response('{"version":"v","files":[{"name":1}]}', { status: 200 }));
    expect(await loadAssetManifest(BASE, badFile)).toBeNull();
  });

  it('清单请求带 cache: no-store（版本指针不许被缓存住）', async () => {
    let seen: string | undefined;
    const spy: FetchLike = (_url, init) => {
      seen = init?.cache;
      return Promise.resolve(new Response('{"version":"v","files":[]}', { status: 200 }));
    };
    await loadAssetManifest(BASE, spy);
    expect(seen).toBe('no-store');
  });
});

describe('★ 首次 / 第二次', () => {
  it('首次：7 个都走网络，7 个都 put 进同一个桶', async () => {
    const m = fullManifest();
    const net = netFor(m);
    const cs = fakeCaches();
    const { archives, manifest } = await loadAllArchives(BASE, undefined, {
      fetch: net.fetch,
      caches: cs.storage,
      sleep: noSleep,
    });
    expect(manifest).toEqual(m);
    expect([...archives.keys()].sort()).toEqual([...ARCHIVE_NAMES].sort());
    expect(net.assetCalls()).toBe(7);
    expect(cs.store.size).toBe(7);
    expect(cs.opened()).toBe(1);
    // 存的键带版本号
    for (const f of m.files) {
      expect([...cs.store.keys()]).toContain(`${BASE}/${f.name}?v=${f.sha256.slice(0, 8)}`);
    }
  });

  it('★ 第二次：素材**一次网络都不发**（只剩那一次 manifest 的 no-store 探测）', async () => {
    const m = fullManifest();
    const net = netFor(m);
    const cs = fakeCaches();
    const opts = { fetch: net.fetch, caches: cs.storage, sleep: noSleep };
    await loadAllArchives(BASE, undefined, opts);
    const afterFirst = net.assetCalls();
    expect(afterFirst).toBe(7);

    const second = await loadAllArchives(BASE, undefined, opts);
    expect(net.assetCalls() - afterFirst).toBe(0);
    expect(second.archives.size).toBe(7);
    // 字节也对（缓存里那份是真字节，不是空壳）
    expect(second.archives.get('Data.mkf')).toEqual(bytesOf(0));
  });

  it('★ 版本变了：旧键被删，只有变了的那一个重新下', async () => {
    const v1 = fullManifest();
    const net = netFor(v1);
    const cs = fakeCaches();
    const opts = { fetch: net.fetch, caches: cs.storage, sleep: noSleep };
    await loadAllArchives(BASE, undefined, opts);
    const before = net.assetCalls();

    // 只有 Data.mkf 换了内容（sha 变了 ⇒ URL 变了）
    const v2 = fullManifest({ 'Data.mkf': shaOf(99) }, 'v2');
    const net2 = netFor(v2);
    await loadAllArchives(BASE, undefined, { ...opts, fetch: net2.fetch });
    expect(net2.assetCalls()).toBe(1); // 只重下 Data.mkf
    expect(net.assetCalls()).toBe(before); // 老那个假网络没被再碰

    const keys = [...cs.store.keys()];
    expect(keys.filter((u) => u.includes('Data.mkf'))).toHaveLength(1);
    expect(keys).toContain(`${BASE}/Data.mkf?v=${versionOf(99)}`);
    expect(keys).not.toContain(`${BASE}/Data.mkf?v=${versionOf(0)}`);
    // 没变的那 6 个键原样留着
    expect(keys.filter((u) => u.includes('map.mkf'))).toHaveLength(1);
  });

  it('桶里不带 ?v= 的键不动（不是我们放的）', async () => {
    const m = fullManifest();
    const cs = fakeCaches();
    cs.store.set('/something-else.bin', new Response('x'));
    await loadAllArchives(BASE, undefined, { fetch: netFor(m).fetch, caches: cs.storage, sleep: noSleep });
    expect([...cs.store.keys()]).toContain('/something-else.bin');
  });
});

describe('★ 进度', () => {
  it('单调不减，终值恰好 = 7 个 size 之和', async () => {
    const m = fullManifest();
    const seen: LoadProgress[] = [];
    await loadAllArchives(BASE, (p) => seen.push(p), {
      fetch: netFor(m).fetch,
      caches: fakeCaches().storage,
      sleep: noSleep,
    });
    expect(seen.length).toBeGreaterThan(1);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.loaded, `第 ${i} 次回调`).toBeGreaterThanOrEqual(seen[i - 1]!.loaded);
      expect(seen[i]!.done).toBeGreaterThanOrEqual(seen[i - 1]!.done);
    }
    const last = seen[seen.length - 1]!;
    expect(last.loaded).toBe(totalOf(m));
    expect(last.total).toBe(totalOf(m));
    expect(last.done).toBe(7);
    expect(seen[0]!.loaded).toBe(0);
    expect(seen[0]!.total).toBe(totalOf(m));
  });

  it('命中缓存的那一份也进进度，并记进 cachedHits', async () => {
    const m = fullManifest();
    const net = netFor(m);
    const cs = fakeCaches();
    const opts = { fetch: net.fetch, caches: cs.storage, sleep: noSleep };
    await loadAllArchives(BASE, undefined, opts);

    const seen: LoadProgress[] = [];
    await loadAllArchives(BASE, (p) => seen.push(p), opts);
    const last = seen[seen.length - 1]!;
    expect(last.cachedHits).toBe(7);
    expect(last.loaded).toBe(totalOf(m));
  });

  it('重试不许把进度拉回去', async () => {
    const m = fullManifest();
    // Data.mkf 第一次给半份（触发重试），第二次给对的
    let tries = 0;
    const url = `${BASE}/Data.mkf?v=${versionOf(0)}`;
    const patch = new Map<string, Uint8Array<ArrayBuffer> | (() => Response)>([
      [
        url,
        () => {
          tries += 1;
          return tries === 1 ? new Response(bytesOf(0).slice(0, 4)) : new Response(bytesOf(0));
        },
      ],
    ]);
    const seen: LoadProgress[] = [];
    await loadAllArchives(BASE, (p) => seen.push(p), {
      fetch: netFor(m, patch).fetch,
      caches: fakeCaches().storage,
      sleep: noSleep,
    });
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.loaded).toBeGreaterThanOrEqual(seen[i - 1]!.loaded);
    }
    expect(seen[seen.length - 1]!.loaded).toBe(totalOf(m));
    expect(tries).toBe(2);
  });
});

describe('★ 失败与重试', () => {
  it('★ 长度不符 → 重试 2 次后整体失败（一共请求 3 次）', async () => {
    const m = fullManifest();
    const url = `${BASE}/Data.mkf?v=${versionOf(0)}`;
    const patch = new Map<string, Uint8Array<ArrayBuffer> | (() => Response)>([
      [url, () => new Response(new Uint8Array(5))], // 清单说 10 字节
    ]);
    const net = netFor(m, patch);
    await expect(
      loadAllArchives(BASE, undefined, { fetch: net.fetch, caches: fakeCaches().storage, sleep: noSleep }),
    ).rejects.toThrow(/長度不符/);
    expect(net.calls.get(url)).toBe(3); // 首次 + 两次重试
  });

  it('HTTP 404 也重试，最后还是失败', async () => {
    const m = fullManifest();
    const net = fakeNet(m); // 一个字节都没有 ⇒ 全是 404
    await expect(
      loadAllArchives(BASE, undefined, { fetch: net.fetch, caches: fakeCaches().storage, sleep: noSleep }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('第一次失败、第二次成功（重试真的救了回来）', async () => {
    const m = fullManifest();
    const url = `${BASE}/Data.mkf?v=${versionOf(0)}`;
    let tries = 0;
    const patch = new Map<string, Uint8Array<ArrayBuffer> | (() => Response)>([
      [url, () => (++tries === 1 ? new Response('boom', { status: 500 }) : new Response(bytesOf(0)))],
    ]);
    const net = netFor(m, patch);
    const { archives } = await loadAllArchives(BASE, undefined, {
      fetch: net.fetch,
      caches: fakeCaches().storage,
      sleep: noSleep,
    });
    expect(archives.get('Data.mkf')).toEqual(bytesOf(0));
    expect(tries).toBe(2);
  });

  it('一个失败就不再开新的：并发峰值恒 ≤ 3', async () => {
    const m = fullManifest();
    const net = netFor(m);
    await loadAllArchives(BASE, undefined, { fetch: net.fetch, caches: fakeCaches().storage, sleep: noSleep });
    expect(net.peak()).toBeLessThanOrEqual(3);
    expect(net.peak()).toBeGreaterThan(1); // 确实是并发，不是一条条串着跑
  });
});

describe('★ 没有 Cache Storage / 没有清单', () => {
  it('★ caches 缺席（非安全上下文 / 隐私模式）⇒ 静默降级成纯 fetch，照样成功', async () => {
    const m = fullManifest();
    const net = netFor(m);
    // 不传 `caches`：走 `globalThis.caches`，Node 里本来就没有
    const { archives } = await loadAllArchives(BASE, undefined, { fetch: net.fetch, sleep: noSleep });
    expect(archives.size).toBe(7);
    expect(net.assetCalls()).toBe(7);
    // 再跑一次：没有缓存，就还是 7 次
    await loadAllArchives(BASE, undefined, { fetch: net.fetch, sleep: noSleep });
    expect(net.assetCalls()).toBe(14);
  });

  it('显式 caches: null 同上', async () => {
    const m = fullManifest();
    const net = netFor(m);
    const { archives } = await loadAllArchives(BASE, undefined, {
      fetch: net.fetch,
      caches: null,
      sleep: noSleep,
    });
    expect(archives.size).toBe(7);
  });

  it('没有清单（开发服务器）⇒ 按名字拉，不报错、不缓存、不报进度', async () => {
    const bodies = new Map<string, Uint8Array<ArrayBuffer> | (() => Response)>();
    for (const [i, name] of ARCHIVE_NAMES.entries()) bodies.set(`${BASE}/${name}`, bytesOf(i));
    const net = fakeNet(null, bodies); // manifest 请求回 404
    const cs = fakeCaches();
    const progress: LoadProgress[] = [];
    const { archives, manifest } = await loadAllArchives(BASE, (p) => progress.push(p), {
      fetch: net.fetch,
      caches: cs.storage,
      sleep: noSleep,
    });
    expect(manifest).toBeNull();
    expect(archives.size).toBe(7);
    expect(archives.get('Data.mkf')).toEqual(bytesOf(0));
    expect(cs.store.size).toBe(0); // 不进缓存
    expect(progress).toEqual([]); // 没有分母就不报进度
    expect(net.assetCalls()).toBe(7); // 按名字（不带 ?v=）拉的
    expect([...net.calls.keys()]).toContain(`${BASE}/Data.mkf`);
  });

  it('清单里少一个档案 ⇒ 当「没有清单」处理（分母偏小的进度条会骗人）', async () => {
    const m = fullManifest();
    m.files = m.files.filter((f) => f.name !== 'Effect.mkf');
    const bodies = new Map<string, Uint8Array<ArrayBuffer> | (() => Response)>();
    for (const [i, name] of ARCHIVE_NAMES.entries()) bodies.set(`${BASE}/${name}`, bytesOf(i));
    const net = fakeNet(m, bodies);
    const cs = fakeCaches();
    const progress: LoadProgress[] = [];
    const { archives, manifest } = await loadAllArchives(BASE, (p) => progress.push(p), {
      fetch: net.fetch,
      caches: cs.storage,
      sleep: noSleep,
    });
    expect(manifest).toBeNull();
    expect(archives.size).toBe(7);
    expect(progress).toEqual([]);
    expect(cs.store.size).toBe(0);
  });
});

describe('★ 持久化申请', () => {
  it('拿得到实体就调一次，结果只记日志', async () => {
    const m = fullManifest();
    let called = 0;
    const logs: string[] = [];
    await loadAllArchives(BASE, undefined, {
      fetch: netFor(m).fetch,
      caches: fakeCaches().storage,
      sleep: noSleep,
      persist: () => {
        called += 1;
        return Promise.resolve(true);
      },
      log: (msg) => logs.push(msg),
    });
    expect(called).toBe(1);
    expect(logs.join('\n')).toMatch(/持久/);
  });

  it('申请抛错也不影响载入', async () => {
    const m = fullManifest();
    const { archives } = await loadAllArchives(BASE, undefined, {
      fetch: netFor(m).fetch,
      caches: fakeCaches().storage,
      sleep: noSleep,
      persist: () => Promise.reject(new Error('nope')),
    });
    expect(archives.size).toBe(7);
  });
});

describe('★ 缓存坏掉的那一份', () => {
  it('桶里那份长度不对 ⇒ 删掉这一条并重新下（其余 6 个照旧命中）', async () => {
    const m = fullManifest();
    const cs = fakeCaches();
    const opts = { fetch: netFor(m).fetch, caches: cs.storage, sleep: noSleep };
    await loadAllArchives(BASE, undefined, opts);

    // 把 Data.mkf 那条换成半份
    const key = `${BASE}/Data.mkf?v=${versionOf(0)}`;
    cs.store.set(key, new Response(bytesOf(0).slice(0, 3)));

    const net2 = netFor(m);
    const seen: LoadProgress[] = [];
    const { archives } = await loadAllArchives(BASE, (p) => seen.push(p), { ...opts, fetch: net2.fetch });
    expect(net2.assetCalls()).toBe(1); // 只重下坏的那一个
    expect(archives.get('Data.mkf')).toEqual(bytesOf(0));
    expect(seen[seen.length - 1]!.cachedHits).toBe(6);
    expect(seen[seen.length - 1]!.loaded).toBe(totalOf(m));
  });

  it('★ 重复访问时第一次上报就带上了 cachedHits（「首次」那句不会闪）', async () => {
    const m = fullManifest();
    const cs = fakeCaches();
    const opts = { fetch: netFor(m).fetch, caches: cs.storage, sleep: noSleep };
    await loadAllArchives(BASE, undefined, opts);

    const seen: LoadProgress[] = [];
    await loadAllArchives(BASE, (p) => seen.push(p), opts);
    expect(seen[0]!.cachedHits).toBe(7);
    expect(seen[0]!.loaded).toBe(totalOf(m));
  });
});
