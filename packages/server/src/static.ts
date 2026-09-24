/*
 * 静态站与素材的**判据**（W-70）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这个文件只放**纯函数**：白名单、路径安全、缓存策略、内容类型、预压缩选择。
 * 真正的 IO 在 `http-server.ts`。这样拆是为了让「哪些文件能端出去」这套判据
 * 能被单测逐条钉住 —— 它同时也是**唯一**的判据，服务端不再另写一套。
 *
 * ★ 红线：`assets/game/` 里有 `rich4.exe` / `Uninst.exe` / 存档 / `.avi`，
 *   一个都不许端出去。故素材走**白名单**（枚举全部能出网的名字），
 *   而不是「黑名单 + 后缀过滤」—— 后者漏一个就是分发原版程序。
 */

import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// ============================================================
//  素材白名单
// ============================================================

/**
 * 能端出去的原版档案 —— **只有这 7 个**。
 *
 * 名字与客户端 `assets.ts` 的 `ARCHIVES`（5 个）加上 `Speaking.mkf`（语音）
 * 与 `Effect.mkf`（音效）一一对应；`main.ts` 的 `ensureSpeakingArchive()` /
 * `SOUND_IDS` 那一路也要它们。
 */
export const MKF_WHITELIST = [
  'Data.mkf',
  'Panel.mkf',
  'map.mkf',
  'jump.mkf',
  'help.mkf',
  'Speaking.mkf',
  'Effect.mkf',
] as const;

const MKF_LOWER = new Set<string>(MKF_WHITELIST.map((n) => n.toLowerCase()));

/**
 * 配乐：`midi01.mid` / `midi14-1.mid` / `Rich08.mid` 都在磁盘上，
 * 名字是字母数字加 `-` / `_`。其余一律不放行。
 */
const MID_RE = /^[A-Za-z0-9_-]+\.mid$/;

/**
 * ★ W-72：构建期清单。
 *
 * 客户端靠它决定每个档案 URL 上的 `?v=`（sha256 前 8 位）与载入进度条的分母，
 * 所以它**必须**和 7 个 `.mkf` 一样能取到 —— 任务书把它的落点定在
 * 「部署目录的 `/assets/game/` 下」，也就是这里。
 *
 * ⚠️ 它只含文件名、字节数与 sha256，**不含任何原版内容**，端出去没有额外风险；
 *   但白名单仍然**显式**列出它 —— 白名单的规矩是「枚举所有能出网的名字」，
 *   不是「文件名长得像就放行」。
 */
export const MANIFEST_ASSET = 'assets-manifest.json';

/**
 * 这个**请求路径片段**是不是白名单里的素材。
 *
 * ⚠️ 参数是「相对素材根的整段路径」，不是 `basename` —— 模式里没有 `/`，
 *   所以多段路径（`sub/Data.mkf`）自然落选。这也是「整条匹配」的落实。
 * ⚠️ 大小写不敏感：磁盘上是 `midi01.mid`、`Midi.txt` 里写着大写，
 *   而 `main.ts:3339` 是「先试原名再试小写」—— 两种写法都该认。
 */
export function isAllowedAssetName(name: string): boolean {
  if (name === '' || name.includes('/') || name.includes('\\')) return false;
  const lower = name.toLowerCase();
  if (MKF_LOWER.has(lower)) return true;
  if (lower === MANIFEST_ASSET) return true;
  return MID_RE.test(lower);
}

// ============================================================
//  超分素材（W-80 §8：高清上线）
// ============================================================

/**
 * 线上提供的超分档（目录名）。与客户端 `host.ts` 的 `hdTierDir()` 对齐：
 * 网页默认读 `hd-2x`，`?hdtier=4` 读母版 `hd`（线上一般不放母版 —— 不在磁盘上就是 404，客户端退回原图）。
 */
export const HD_TIERS = ['hd-2x', 'hd'] as const;
export type HdTier = (typeof HD_TIERS)[number];

/**
 * 超分图的路径形状：`<档案>/<资源>-<图>.png`（管线 `hdRelativePath`，档案名不带 `.mkf`）。
 *
 * ★ 同样走**白名单**：只认这 5 个档案名 + 纯数字 + `.png`，一段子目录都不多。
 *   这些 PNG 是原版素材的**衍生物**（红线同 `.mkf`：只在服务器磁盘上、只在门后面）。
 */
const HD_PATH_RE = /^(Data|Panel|map|jump|help)\/\d{1,5}-\d{1,5}\.png$/;

export function isAllowedHdPath(rel: string): boolean {
  return HD_PATH_RE.test(rel);
}

/** `/assets/<档>-manifest.json` 那一份的文件名 */
export function hdManifestName(tier: HdTier): string {
  return `${tier}-manifest.json`;
}

export type HdRoute =
  | { kind: 'manifest'; tier: HdTier; file: string }
  | { kind: 'image'; tier: HdTier; rel: string }
  | null;

/**
 * 请求路径是不是超分素材那几条（不是就返回 null，交给后面的路由）：
 * - `/assets/hd-2x-manifest.json` → 清单；
 * - `/assets/hd-2x/Data/191-0.png` → 一张图（`rel` 还**没**过安全校验，调用方先 `safeRelativePath`）。
 */
export function hdRouteOf(path: string): HdRoute {
  for (const tier of HD_TIERS) {
    if (path === `/assets/${hdManifestName(tier)}`) return { kind: 'manifest', tier, file: hdManifestName(tier) };
    const prefix = `/assets/${tier}/`;
    if (path.startsWith(prefix)) return { kind: 'image', tier, rel: path.slice(prefix.length) };
  }
  return null;
}

// ============================================================
//  路径安全
// ============================================================

export type PathCheck = { ok: true; rel: string } | { ok: false; status: 400 };

/**
 * 把 URL 里那一段相对路径解码并做安全校验。
 *
 * 400 的四种情形（任务书 W-70 §3 逐条）：
 *   · `decodeURIComponent` 抛（坏 `%` 转义）；
 *   · 含 `\0`（截断字符串，Node 会直接抛或截到别处）；
 *   · 含 `\`（Windows 分隔符，Linux 上不认但会让判据在两边不一致）；
 *   · 含 `..`（目录穿越）；
 *   · 以 `/` 开头（`/assets/game//etc/passwd` 那种绝对路径注入）。
 */
export function safeRelativePath(raw: string): PathCheck {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes('\0')) return { ok: false, status: 400 };
  if (decoded.includes('\\')) return { ok: false, status: 400 };
  if (decoded.includes('..')) return { ok: false, status: 400 };
  if (decoded.startsWith('/')) return { ok: false, status: 400 };
  return { ok: true, rel: decoded };
}

/**
 * 解析成绝对路径，并确认它**仍在根目录里面**（403 那一档）。
 *
 * ⚠️ 前缀比较必须带 `sep`：`/srv/rich4-assets-x` 不该被 `/srv/rich4-assets` 认下。
 * ⚠️ `rel` 为空时解析结果就是根目录本身 —— 这里判它不在根**里面**而返回 null，
 *   调用方要在那之前把空路径替换成 `index.html`。
 */
export function resolveUnder(root: string, rel: string): string | null {
  const base = resolve(root);
  const abs = resolve(base, rel);
  return abs.startsWith(base + sep) ? abs : null;
}

/**
 * 在目录里按**大小写不敏感**找文件，返回真实存在的那个路径；没有返回 null。
 *
 * 为什么要这一层：`main.ts` 取配乐时先试原名再试小写，而 macOS 的文件系统
 * 本来就不区分大小写、Linux 区分 —— 不显式找一遍，同一份请求在两种系统上
 * 会一个 200 一个 404（macOS 上还会把**请求里写的那个大小写**当路径返回，
 * 于是同一份文件在两种系统上报出两个不同的路径）。
 */
export function findOnDisk(dir: string, name: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  if (entries.includes(name)) return join(dir, name);
  const lower = name.toLowerCase();
  const hit = entries.find((e) => e.toLowerCase() === lower);
  return hit === undefined ? null : join(dir, hit);
}

// ============================================================
//  内容类型与缓存策略
// ============================================================

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  // 原版素材 —— 一律按二进制流给（`nosniff` 保证浏览器不会自作聪明地猜）
  '.mkf': 'application/octet-stream',
  '.mid': 'audio/midi',
};

export function contentTypeFor(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 带哈希的构建产物（vite 出的是 `assets/index-C3t3qLJy.js`）。
 *
 * 只认 8 位以上的哈希段：名字里没有哈希就**不能**标 `immutable`，
 * 否则改了内容浏览器也永远拿旧的。
 */
const HASHED_ASSET_RE = /[-.][0-9A-Za-z_]{8,}\.(?:js|css)$/;

/**
 * 静态站/素材的 `Cache-Control`。
 *
 * · 素材：URL 带 `?v=<sha256 前 8 位>`（W-72），文件名没变内容也不会变
 *   ⇒ 一年不可变。`private` 是因为整站有访问密码，共享缓存不许存。
 * · `index.html`：**必须** `no-cache`，否则发新版本没人拿得到。
 * · 带哈希的 `assets/*.js|css`：不可变。
 * · 其余：`no-cache`（每次带 `ETag` 回源校验，比押错强）。
 */
export function cacheControlFor(kind: 'asset' | 'web' | 'hd', rel: string, versioned = false): string {
  // ★ 超分素材（W-80 §8）：带 `?v=<内容哈希>` 的才一年不可变（客户端按清单里的 `outHash` 拼）；
  //   不带版本的（清单本身、旧客户端）一律 `no-cache` —— 重做过的图不能让浏览器一直拿旧的。
  if (kind === 'hd') return versioned ? 'private, max-age=31536000, immutable' : 'no-cache';
  // ★ 清单是**版本指针**（W-72）：它一变，别的档案的 URL 就全变了 ——
  //   绝不能标 `immutable`，否则发了新版浏览器还拿旧的，客户端会去取一批
  //   已经不存在的 `?v=`。客户端那边也带 `cache: 'no-store'`，两头都堵住。
  if (rel.toLowerCase() === MANIFEST_ASSET) return 'no-cache';
  if (kind === 'asset') return 'private, max-age=31536000, immutable';
  if (rel.startsWith('assets/') && HASHED_ASSET_RE.test(rel)) return 'private, max-age=31536000, immutable';
  return 'no-cache';
}

// ============================================================
//  预压缩（`.br` / `.gz`）
// ============================================================

/** `Accept-Encoding` 里 `token` 的 q 值；没提到就返回 `*` 的 q，都没有返回 −1 */
function encodingQ(header: string, token: string): number {
  let star = -1;
  for (const part of header.split(',')) {
    const segs = part.split(';');
    const name = (segs[0] ?? '').trim().toLowerCase();
    if (name === '') continue;
    let q = 1;
    for (const p of segs.slice(1)) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m !== null) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) q = n;
      }
    }
    if (name === token) return q;
    if (name === '*') star = q;
  }
  return star;
}

/** 客户端接受这种编码吗（`q=0` 是明确拒绝）。token 是**线上**的写法：`br` / `gzip` */
export function acceptsEncoding(header: string | undefined, enc: 'br' | 'gzip'): boolean {
  if (header === undefined || header === '') return false;
  return encodingQ(header, enc) > 0;
}

export interface Precompressed {
  file: string;
  /** ★ `Content-Encoding` 的值 —— gzip 那份文件叫 `.gz`，但线上必须写 `gzip` */
  encoding: 'br' | 'gzip';
}

/**
 * 同目录下有没有预压缩好的那一份。
 *
 * 优先 `br`（比 `gz` 小得多，见任务书 §1 的表格），客户端不接受就退回原文件。
 * 两个都没有返回 null ⇒ 调用方端原文件。
 */
export function precompressedFor(acceptEncoding: string | undefined, abs: string): Precompressed | null {
  if (acceptsEncoding(acceptEncoding, 'br') && existsSync(abs + '.br')) {
    return { file: abs + '.br', encoding: 'br' };
  }
  if (acceptsEncoding(acceptEncoding, 'gzip') && existsSync(abs + '.gz')) {
    return { file: abs + '.gz', encoding: 'gzip' };
  }
  return null;
}

// ============================================================
//  响应头
// ============================================================

/**
 * **每一个**响应都带的三个头（200 / 400 / 403 / 404 / 500 一律）。
 *
 * · `X-Robots-Tag`：任务书 §0 第 1 条「不让搜索引擎收录」的**服务端**落实
 *   （`/robots.txt` 是同一件事的礼貌版，两者都要）；
 * · `nosniff`：素材是二进制，绝不能让浏览器按内容猜类型；
 * · `Referrer-Policy`：邀请链接里带房间码，别泄给外站。
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** `/robots.txt` 的正文 —— 逐字固定，单测钉着 */
export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/** `/assets/game/` 这一段前缀；后面那截才是素材名 */
export const ASSET_PREFIX = '/assets/game/';
