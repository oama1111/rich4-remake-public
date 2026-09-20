/*
 * 网页版素材载入 —— 一次下完 7 个档案，带真实进度与 Cache Storage（W-72）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 两个不变式（任务书 W-72 的全部要点都从这两条推出来）：
 *   ① **对局中途不走网络**：7 个档案在进標題畫面之前**全部**到齐（含 Speaking / Effect），
 *      于是打到一半换曲、第一次说话都不会再去 fetch 一个 57 MB 的档案；
 *   ② **第二次打开 0 流量**：下完的字节进 Cache Storage，下次先用 manifest 的
 *      `?v=<sha256 前 8 位>` 去 `match`，命中就不发请求。
 *
 * ★ 本文件**纯逻辑**：`fetch` / `caches` / 时钟全部可注入，所以能在 Node 里单测，
 *   不需要浏览器、也不需要 Service Worker（任务书明令不许引 SW）。
 * ★ 这里只管「把字节拿回来」；开归档（`MkfArchive`）在 `assets.ts` 里 —— 解码器一行不动。
 */

/** 要一次下完的 7 个档案 —— 与 `static.ts` 的素材白名单一一对应 */
export const ARCHIVE_NAMES = [
  'Data.mkf',
  'Panel.mkf',
  'map.mkf',
  'jump.mkf',
  'help.mkf',
  'Speaking.mkf',
  'Effect.mkf',
] as const;

/** Cache Storage 里的桶名。带版本号是有意的：将来格式变了可以直接换名字 */
export const ASSET_CACHE_NAME = 'rich4-assets-v1';
/** 构建期产出的清单名（`tools/precompress-assets.ts`，落在部署目录的 `/assets/game/` 下） */
export const MANIFEST_NAME = 'assets-manifest.json';
/** 并发几路 —— 7 个一起拉会互相抢带宽，进度条也乱跳 */
export const DEFAULT_CONCURRENCY = 3;
/** 单个档案失败后的重试间隔（毫秒）；两次都用完还失败就整体失败 */
export const DEFAULT_RETRY_DELAYS_MS = [1000, 3000] as const;

export interface AssetManifestFile {
  name: string;
  /** **原始**（未压缩）字节数 —— 进度的分母就是它 */
  size: number;
  sha256: string;
}

export interface AssetManifest {
  /** 全部 sha256 拼起来再 sha256 的前 12 位 */
  version: string;
  files: AssetManifestFile[];
}

export interface LoadProgress {
  /**
   * 已读到的**解码后**字节数（`Content-Encoding` 时 `Content-Length` 是压缩后的，不能用）。
   * 单调不减，结束时**恰好**等于 `total`。
   */
  loaded: number;
  /** 分母 = manifest 里 7 个 `.mkf` 的 `size` 之和 */
  total: number;
  /** 到此刻为止有几个档案是**从 Cache Storage** 命中的 */
  cachedHits: number;
  /** 已经收完的档案数（0..7） */
  done: number;
}

/** 我们只用到 `fetch` 的这一小截 —— 测试注入假的 */
export type FetchLike = (url: string, init?: { cache?: 'no-store' | 'default' }) => Promise<Response>;

export interface AssetLoaderOptions {
  /** @default `globalThis.fetch` */
  fetch?: FetchLike;
  /**
   * Cache Storage @default `globalThis.caches`。
   *
   * 显式传 `null` = 装作「浏览器没有 `caches`」（非安全上下文 / 隐私模式）⇒
   * 静默降级成纯 `fetch`，不报错。
   */
  caches?: CacheStorage | null;
  /** 收尾时申请持久化 @default `navigator.storage.persist`；没有就不调 */
  persist?: (() => Promise<boolean>) | null;
  /** @default 3 */
  concurrency?: number;
  /** @default `[1000, 3000]` */
  retryDelaysMs?: readonly number[];
  /** 重试之间怎么等 @default 真 `setTimeout` —— 测试注入，别真睡 */
  sleep?: (ms: number) => Promise<void>;
  /** @default `rich4-assets-v1` */
  cacheName?: string;
  /** 记一行日志（持久化申请的结果就靠它） */
  log?: (message: string) => void;
}

export interface LoadedAssets {
  /** 7 个档案的**原始字节**；manifest 缺席时是「照名字拉的」那一份 */
  archives: Map<string, Uint8Array>;
  /** 拿到的清单；开发服务器没有它就是 `null` */
  manifest: AssetManifest | null;
}

/**
 * 拉清单。**任何异常都当「没有清单」** —— 开发服务器上它本来就不存在，
 * 那是正常状态不是错误（任务书 W-72 §2）。
 *
 * `cache: 'no-store'` 是有意的：清单是「这一版有哪些文件」的**指针**，
 * 缓存住它就等于把版本钉死，发了新版也永远拿旧的。
 */
export async function loadAssetManifest(base: string, doFetch: FetchLike): Promise<AssetManifest | null> {
  try {
    const res = await doFetch(`${base}/${MANIFEST_NAME}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return asManifest((await res.json()) as unknown);
  } catch {
    return null;
  }
}

/** 形状不对就当没有 */
function asManifest(data: unknown): AssetManifest | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as { version?: unknown; files?: unknown };
  if (typeof obj.version !== 'string' || !Array.isArray(obj.files)) return null;
  const files: AssetManifestFile[] = [];
  for (const raw of obj.files) {
    if (typeof raw !== 'object' || raw === null) return null;
    const f = raw as { name?: unknown; size?: unknown; sha256?: unknown };
    if (typeof f.name !== 'string' || typeof f.size !== 'number' || typeof f.sha256 !== 'string') return null;
    if (!Number.isFinite(f.size) || f.size < 0) return null;
    files.push({ name: f.name, size: f.size, sha256: f.sha256 });
  }
  return { version: obj.version, files };
}

/**
 * 把 7 个档案一次下完。
 *
 * 两条路：
 * · **有 manifest**（生产）：URL 带 `?v=`、字节进 Cache Storage、进度按原始字节算；
 * · **没有 manifest**（`vite` 开发服务器）：按名字直接拉，不缓存、不报错（任务书 W-72 §2）。
 *   这一路**不报进度**（没有 `size` 就没有分母），载入屏显示不定量的那一行。
 */
export async function loadAllArchives(
  base: string,
  onProgress?: (p: LoadProgress) => void,
  opts: AssetLoaderOptions = {},
): Promise<LoadedAssets> {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = opts.log ?? ((): void => {});
  const cacheName = opts.cacheName ?? ASSET_CACHE_NAME;

  const manifest = await loadAssetManifest(base, doFetch);
  const wanted = manifest === null ? [] : orderFiles(manifest);

  // ── 退回老路：按名字拉，不缓存、不报进度 ──
  // ★ 「清单里少一个」也走这一路：半份清单会让 `total` 是个偏小的分母，
  //   进度条永远走到 100%，而实际还在下 —— 宁可不显示进度。
  if (manifest === null || wanted.length !== ARCHIVE_NAMES.length) {
    const archives = new Map<string, Uint8Array>();
    await runPool([...ARCHIVE_NAMES], concurrency, async (name) => {
      archives.set(name, await fetchBytes(doFetch, `${base}/${name}`, null, retryDelays, sleep));
    });
    if (manifest !== null) log('⚠ 清單不完整，退回逐個按名字下載（不進快取）');
    return { archives, manifest: null };
  }

  const store = opts.caches === undefined ? (globalThis.caches ?? null) : opts.caches;
  const cache = store === null ? null : await store.open(cacheName);
  if (cache === null) log('⚠ 這個環境沒有 Cache Storage：每次都會重新下載');

  const total = wanted.reduce((sum, f) => sum + f.size, 0);
  const archives = new Map<string, Uint8Array>();
  /** 本次尝试每个档案读了多少（重试时清零） */
  const read = new Map<string, number>();
  /** 已经**上报过**的高水位 —— 进度只许往上走，重试不许把进度条拉回去 */
  const shown = new Map<string, number>();
  let cachedHits = 0;
  let done = 0;

  const report = (): void => {
    if (onProgress === undefined) return;
    let sum = 0;
    for (const f of wanted) sum += shown.get(f.name) ?? 0;
    onProgress({ loaded: Math.min(sum, total), total, cachedHits, done });
  };

  /** 读到新的一段：更新「本次」与「高水位」，只有真的往上走才上报 */
  const bump = (name: string, bytes: number): void => {
    const now = (read.get(name) ?? 0) + bytes;
    read.set(name, now);
    if (now > (shown.get(name) ?? 0)) {
      shown.set(name, now);
      report();
    }
  };

  const urlOf = (f: AssetManifestFile): string => `${base}/${f.name}?v=${f.sha256.slice(0, 8)}`;

  // ── 先把 7 个都去缓存里问一遍（**在第一次上报之前**）──
  // ★ 为什么要提前问：`cachedHits` 是「首次载入约 130 MB」那句话的判据。
  //   边下边问的话，重复访问时那句话会先闪一下再消失。
  const misses: AssetManifestFile[] = [];
  if (cache !== null) {
    for (const f of wanted) {
      const hit = await cache.match(urlOf(f));
      if (hit === undefined) {
        misses.push(f);
        continue;
      }
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if (bytes.byteLength !== f.size) {
        // 长度不对 = 缓存坏了（半份 / 被别人覆盖）⇒ 删掉重下
        await cache.delete(urlOf(f));
        misses.push(f);
        log(`⚠ 快取裡的 ${f.name} 長度不對，重新下載`);
        continue;
      }
      // 缓存命中：整份一次记进进度（不走网络，也就没有逐块回调）
      shown.set(f.name, bytes.byteLength);
      read.set(f.name, bytes.byteLength);
      archives.set(f.name, bytes);
      cachedHits += 1;
      done += 1;
    }
  } else {
    misses.push(...wanted);
  }

  report();

  await runPool(misses, concurrency, async (file) => {
    const url = urlOf(file);
    const bytes = await fetchBytes(doFetch, url, file, retryDelays, sleep, bump, () => read.set(file.name, 0));
    archives.set(file.name, bytes);
    done += 1;
    if (cache !== null) {
      await cache.put(url, new Response(bodyOf(bytes), { headers: { 'Content-Type': 'application/octet-stream' } }));
    }
    report();
  });

  if (cache !== null) await pruneCache(cache, wanted);
  await requestPersist(opts.persist, log);
  return { archives, manifest };
}

/** 按 `ARCHIVE_NAMES` 的顺序排出 7 条（清单里的顺序不保证），并滤掉不相干的（如 `hd-manifest.json`） */
function orderFiles(manifest: AssetManifest): AssetManifestFile[] {
  const out: AssetManifestFile[] = [];
  for (const name of ARCHIVE_NAMES) {
    const hit = manifest.files.find((f) => f.name === name);
    if (hit !== undefined) out.push(hit);
  }
  return out;
}

/**
 * 拉一个档案的字节。
 *
 * ★ 逐块读（`res.body.getReader()`）而不是 `arrayBuffer()`：后者要等整份到齐才
 *   报得出进度，而最大的 `map.mkf` 有 76 MB —— 进度条会一直停在 0 然后跳到 100%。
 * ★ 带 `Content-Encoding` 时 `Content-Length` 是**压缩后**的，所以分母只能用
 *   manifest 的 `size`（原始字节），分子只能用读到的解码后字节数。
 * ★ 长度不等**就当失败**（任务书 W-72 §2 明写不校验 sha256：247 MB 在主线程算哈希
 *   本身就是一次卡顿）。
 */
async function fetchBytes(
  doFetch: FetchLike,
  url: string,
  file: AssetManifestFile | null,
  retryDelays: readonly number[],
  sleep: (ms: number) => Promise<void>,
  onChunk?: (name: string, bytes: number) => void,
  onRetry?: () => void,
): Promise<Uint8Array> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelays[attempt - 1] ?? 0);
      onRetry?.();
    }
    try {
      const res = await doFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}：${url}`);
      if (res.body === null) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (file !== null) {
          onChunk?.(file.name, bytes.byteLength);
          checkLength(bytes.byteLength, file, url);
        }
        return bytes;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        const value = step.value;
        if (value === undefined) continue;
        chunks.push(value);
        size += value.byteLength;
        if (file !== null) onChunk?.(file.name, value.byteLength);
      }
      if (file !== null) checkLength(size, file, url);
      return concat(chunks, size);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function checkLength(got: number, file: AssetManifestFile, url: string): void {
  if (got !== file.size) throw new Error(`長度不符：${file.name} 拿到 ${got}，清單寫 ${file.size}（${url}）`);
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * `Uint8Array` → `Response` 的正文。
 *
 * ⚠️ 需要这一转只是因为类型定义比实现严：TypeScript 5.7 起 `Uint8Array` 带了
 *   `ArrayBufferLike` 参数，而 DOM 的 `BodyInit` 只收 `ArrayBufferView<ArrayBuffer>`。
 *   **运行时完全一样**，`new Response(uint8array)` 是标准用法。
 * ⚠️ 也不要改成 `bytes.slice().buffer` —— 那会**再复制一份** 76 MB 的 `map.mkf`。
 */
function bodyOf(bytes: Uint8Array): BodyInit {
  return bytes as unknown as BodyInit;
}

/**
 * 清掉**过时**的缓存项。
 *
 * 判据只看「文件名 + `?v=` 那一段」而不是整串 URL：真 `Cache` 里存的是**绝对** URL
 * （浏览器会把 `/assets/game/…` 补成 `https://host/assets/game/…`），拿相对 URL 去比
 * 会把每一条都判成过时而整桶删掉 —— 那第二次打开就白干了。
 * 不带 `?v=` 的键不动（不是我们放的）。
 */
async function pruneCache(cache: Cache, wanted: readonly AssetManifestFile[]): Promise<void> {
  const want = new Map(wanted.map((f) => [f.name, f.sha256.slice(0, 8)] as const));
  let keys: readonly Request[];
  try {
    keys = await cache.keys();
  } catch {
    return;
  }
  for (const req of keys) {
    const url = typeof req === 'string' ? req : req.url;
    const at = url.indexOf('?v=');
    if (at === -1) continue;
    const version = url.slice(at + 3).split('&')[0] ?? '';
    const slash = url.lastIndexOf('/', at);
    const name = url.slice(slash + 1, at);
    if (want.get(name) === version) continue;
    await cache.delete(url);
  }
}

/** 申请持久化 —— 结果**只记日志**（拿不到也不影响这一局） */
async function requestPersist(persist: (() => Promise<boolean>) | null | undefined, log: (m: string) => void): Promise<void> {
  const fn = persist === undefined ? defaultPersist() : persist;
  if (fn === null || fn === undefined) return;
  try {
    const granted = await fn();
    log(granted ? '素材快取：已獲准持久保存' : '素材快取：未獲准持久保存（可能會被瀏覽器清掉）');
  } catch (err) {
    log(`素材快取：持久化申請失敗（${String(err)}）`);
  }
}

function defaultPersist(): (() => Promise<boolean>) | null {
  const nav = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }).navigator;
  const storage = nav?.storage;
  if (storage === undefined || typeof storage.persist !== 'function') return null;
  return () => storage.persist!();
}

/**
 * 固定并发跑一批活。
 *
 * ★ 一个失败就**不再开新的**，但也不打断已经跑起来的那几个（它们会自己收尾）——
 *   所以并发峰值恒 ≤ `limit`，不会因为某一条重试而多开一路。
 */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (firstError !== null) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i]!);
      } catch (err) {
        firstError ??= err;
        return;
      }
    }
  });
  await Promise.all(runners);
  if (firstError !== null) throw firstError instanceof Error ? firstError : new Error(String(firstError));
}
