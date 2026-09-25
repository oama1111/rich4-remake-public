/*
 * 高清上线的部署暂存（W-80 §8）—— 只挑**已验证**的超分素材，生成线上用的小清单
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   node --experimental-strip-types tools/hd-deploy.ts \
 *        --src <超分产物根，含 hd-2x/ 与 hd-2x-manifest.json> --out <暂存目录（仓库外）> [--tier hd-2x]
 *
 * 产出（`<out>` 下，形状与服务器 `/srv/rich4/deploy/` 一一对应，整棵 rsync 过去即可）：
 *
 *   assets/hd-2x/<档>/<资源>-<图>.png     只含下面 VERIFIED 那几组（过场帧转成 .webp，见 `encode`）
 *   assets/hd-2x-manifest.json(.br/.gz)   只含这几组的瘦清单（客户端 `hdSourceFromManifest` 读的那几个字段）
 *
 * ★ 为什么不直接传整个 `hd-2x/`（1.3 GB、16,141 张）：需求方 2026-09-24 拍板**只上已验证的**——
 *   其余 AI 超分素材（界面 / 建筑 / 其他角色 / 底图…）继续用原图，逐类验证后再加进 VERIFIED。
 *   清单里没有的图客户端根本不会去要（按图回退原图），所以「少传」是安全的。
 *
 * ★ 红线同 `precompress-assets.ts`：这些 PNG 是原版素材的**衍生物** —— 只放服务器磁盘、只在访问密码后面；
 *   不进仓库（暂存目录必须在仓库外，见 `assertOutsideRepo`）、不上公开 CDN。
 *
 * ★ 流量预算（需求方 2026-09-24：现在整局约 130 MB，高清不许变成 GB 级；桌面一局 ≤ ~30 MB、手机 ≤ ~5 MB）：
 *   过场帧 2× PNG 共 197 MB 太重 ⇒ 转有损 WebP（q 80、alpha 无损，`cwebp`）约 16 MB（整段 24+2 段全算），
 *   开场一局（4 人 8 段）约 4 MB；手机平板客户端根本不拉超分过场（`SpriteCache` 的 `hdFlics`）。
 *   WebP 在 Chrome 与 Safari 14+ / iOS 14+ 的 `createImageBitmap` 都能解。清单结果里写 `file`（相对路径），
 *   客户端照它取；没写 `file` 的仍按 `<档>/<资源>-<图>.png`。
 *
 * ★ `outHash` 一律按**暂存里那份文件**现算（sha256 前 16 位，与管线同一口径）：客户端拿它的前 8 位
 *   当 `?v=`，服务器对带版本的图回一年不可变 —— 产物若在清单生成之后被改过（钱夫人重绘就改过好几轮），
 *   用旧哈希会让浏览器永远拿着旧图。
 */

import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
//  已验证的几组（需求方 2026-09-24 拍板；见 docs/tasks/W-80-hd-upgrade.md §8）
// ============================================================

interface VerifiedSet {
  /** 报告里的名字 */
  name: string;
  /** 依据 */
  why: string;
  /** 档案名（清单口径，不带 `.mkf`）+ 资源号；`frames` 给了就核对帧数 */
  resources: { archive: string; resource: number; frames?: number }[];
  /**
   * 覆盖清单里的 `model`（来源记录）：钱夫人那 136 帧是 §6.10–6.12 手工流程重绘后**原地覆盖**的，
   * 来源清单里还挂着全量批次的 SeedVR2 配方，照抄会误导。
   */
  model?: string;
  /** 转码：`webp` = 有损 WebP（过场帧；`WEBP_ARGS`），不给 = 原样拷 PNG */
  encode?: 'webp';
}

/** 过场帧的 WebP 参数：q 80（2× 帧放大到 3× 舞台看不出块）、alpha 无损（FLIC 的透明像素要叠在底图上）、最慢最小的 m 6 */
export const WEBP_ARGS = ['-quiet', '-q', '80', '-alpha_q', '100', '-m', '6'] as const;

/** 角色 0..11 里除了宫本宝藏（6，绿发绿衣被绿幕抠坏、返工中）与钱夫人（3，第一组已单列）以外的 10 位 */
const CHARACTERS_BUT_6 = [0, 1, 2, 4, 5, 7, 8, 9, 10, 11];

export const VERIFIED: readonly VerifiedSet[] = [
  {
    name: '钱夫人整套重绘',
    why: 'W-80 §6.10–6.12：Data#191 站 8 + #192 走 72 + #193 拿骰子 56 = 136 帧（棋子资源 0x80 + 21×3 + 3×交通方式 0）',
    resources: [
      { archive: 'Data', resource: 191, frames: 8 },
      { archive: 'Data', resource: 192, frames: 72 },
      { archive: 'Data', resource: 193, frames: 56 },
    ],
    model: 'qwen-image-2.1-repaint-6x-downscale+tone-fix (W-80 §6.10–6.12)+tier2x',
  },
  {
    name: '全屏过场（V 路线）',
    why: 'W-80 §6.3「过场保留高清」：开场每人一段跳出去 jump#47–58（J01–J12）+ 一段降落伞 jump#59–70（F01–F12）、魔法屋关窗 Panel#20、小游戏入场 Panel#78',
    resources: [
      ...Array.from({ length: 24 }, (_, i) => ({ archive: 'jump', resource: 47 + i })),
      { archive: 'Panel', resource: 20, frames: 25 },
      { archive: 'Panel', resource: 78, frames: 20 },
    ],
    encode: 'webp',
  },
  {
    name: '其余角色走路 / 骰子套',
    why: 'W-80 §6.13–6.15：约翰乔、沙隆巴斯、忍太郎、阿土伯、莎拉公主、糖糖、乌咪、孙小美、小丹尼、金贝贝的站 / 走 / 拿骰子（0x80 + 21×角色 + 0..2）。宫本宝藏（角色 6）绿幕返工中，不上',
    resources: CHARACTERS_BUT_6.flatMap((ch) => [0, 1, 2].map((k) => ({ archive: 'Data', resource: 0x80 + 21 * ch + k }))),
    model: 'qwen-image-2.1-repaint-6x-downscale+tone-fix (W-80 §6.13–6.15)+tier2x',
  },
  {
    name: '角色其余 18 套',
    why: 'W-80 §6.16–6.17：机车 / 汽车 / 推土机 / 快艇（站 + 骑 + 骰子）、另一套走路、乞丐 / 住院 / 囚服（0x80 + 21×角色 + 3..20）；钱夫人也在内。宫本宝藏不上（同上）',
    resources: [...CHARACTERS_BUT_6, 3].flatMap((ch) => Array.from({ length: 18 }, (_, k) => ({ archive: 'Data', resource: 0x80 + 21 * ch + 3 + k }))),
    model: 'qwen-image-2.1-repaint-6x-downscale+tone-fix (W-80 §6.16–6.17)+tier2x',
  },
  {
    name: '四大惡人：小偷、強盜',
    why: 'W-80 §6.16：替身 actor 4/5 = Data 380–383 / 384–387（站、走、快艇、夢遊）；流氓、間諜仍在跑',
    resources: Array.from({ length: 8 }, (_, k) => ({ archive: 'Data', resource: 380 + k })),
    model: 'qwen-image-2.1-repaint-6x-downscale+tone-fix (W-80 §6.16)+tier2x',
  },
];

// ============================================================
//  清单形状（与管线 `UpscaleManifest` 的子集、客户端 `HdManifestLike` 对齐）
// ============================================================

interface Task {
  id: string;
  archive: string;
  resource: number;
  image: number;
  srcWidth?: number;
  srcHeight?: number;
}

interface Result {
  model?: string;
  outWidth: number;
  outHeight: number;
  outAnchorX: number;
  outAnchorY: number;
  outHash?: string;
  /** 产物相对路径（转码过的才写；不写 = `<档>/<资源>-<图>.png`） */
  file?: string;
}

interface Manifest {
  version: number;
  generatedAt?: string;
  tasks: Task[];
  results: Record<string, Result>;
}

const taskIdOf = (archive: string, resource: number, image: number): string =>
  `${archive}/${String(resource).padStart(4, '0')}_${String(image).padStart(3, '0')}`;
const relPathOf = (archive: string, resource: number, image: number): string => `${archive}/${resource}-${image}.png`;

/** PNG 头里的宽高（IHDR 紧跟在 8 字节签名之后） */
function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

/** 同时跑几个 cwebp */
const ENCODE_CONCURRENCY = 8;
let running = 0;
const waiting: (() => void)[] = [];

/** PNG → WebP（`cwebp` 须在 PATH 上：`brew install webp`）*/
async function cwebp(src: string, dst: string): Promise<void> {
  if (running >= ENCODE_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    await new Promise<void>((ok, fail) => {
      const p = spawn('cwebp', [...WEBP_ARGS, src, '-o', dst], { stdio: 'ignore' });
      p.on('error', fail);
      p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`cwebp ${src} 退出碼 ${code}`))));
    });
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const sha16 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

export interface DeployReport {
  sets: { name: string; frames: number; bytes: number }[];
  files: number;
  bytes: number;
  manifestBytes: number;
  hashFixed: number;
}

/**
 * 从超分产物根挑出 VERIFIED 那几组，写进 `<out>/assets/`。
 * @throws 选中的哪一张缺任务 / 缺结果 / 缺文件 / 尺寸与清单不符 —— 宁可不出暂存，也不出一份残的
 */
export async function buildHdDeploy(
  srcRoot: string,
  outRoot: string,
  tier: string,
  sets: readonly VerifiedSet[] = VERIFIED,
): Promise<DeployReport> {
  const manifestPath = resolve(srcRoot, `${tier}-manifest.json`);
  const full = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const byId = new Map(full.tasks.map((t) => [taskIdOf(t.archive, t.resource, t.image), t] as const));

  const outAssets = resolve(outRoot, 'assets');
  const outTier = resolve(outAssets, tier);
  // 暂存目录每次重建：上一轮挑进去、这一轮拿掉的图不能残留（服务器那边 rsync --delete）
  rmSync(outTier, { recursive: true, force: true });
  mkdirSync(outTier, { recursive: true });

  const slim: Manifest = { version: 1, generatedAt: new Date().toISOString(), tasks: [], results: {} };
  const report: DeployReport = { sets: [], files: 0, bytes: 0, manifestBytes: 0, hashFixed: 0 };
  const problems: string[] = [];

  for (const set of sets) {
    let frames = 0;
    let bytes = 0;
    for (const r of set.resources) {
      const ids = full.tasks
        .filter((t) => t.archive === r.archive && t.resource === r.resource)
        .map((t) => taskIdOf(t.archive, t.resource, t.image))
        .sort();
      if (ids.length === 0) problems.push(`${r.archive}#${r.resource}：清单里没有这个资源`);
      if (r.frames !== undefined && ids.length !== r.frames) {
        problems.push(`${r.archive}#${r.resource}：清单里 ${ids.length} 帧，应为 ${r.frames}`);
      }
      const jobs = ids.map(async (id) => {
        const t = byId.get(id)!;
        const res = full.results[id];
        if (res === undefined) {
          problems.push(`${id}：没有结果（没出产物）`);
          return;
        }
        const rel = relPathOf(t.archive, t.resource, t.image);
        const src = resolve(srcRoot, tier, rel);
        if (!existsSync(src)) {
          problems.push(`${id}：缺文件 ${src}`);
          return;
        }
        const data = new Uint8Array(readFileSync(src));
        const px = pngSize(data);
        if (px === null || px.w !== res.outWidth || px.h !== res.outHeight) {
          problems.push(`${id}：PNG ${px?.w}×${px?.h} 与清单 ${res.outWidth}×${res.outHeight} 不符`);
          return;
        }
        const outRel = set.encode === 'webp' ? rel.replace(/\.png$/, '.webp') : rel;
        const dst = resolve(outTier, outRel);
        mkdirSync(dirname(dst), { recursive: true });
        let shipped = data;
        if (set.encode === 'webp') {
          await cwebp(src, dst);
          shipped = new Uint8Array(readFileSync(dst));
        } else {
          copyFileSync(src, dst);
          if (res.outHash !== sha16(data)) report.hashFixed++;
        }
        const hash = sha16(shipped);
        slim.tasks.push({
          id,
          archive: t.archive,
          resource: t.resource,
          image: t.image,
          ...(t.srcWidth === undefined ? {} : { srcWidth: t.srcWidth }),
          ...(t.srcHeight === undefined ? {} : { srcHeight: t.srcHeight }),
        });
        slim.results[id] = {
          ...(set.model !== undefined ? { model: set.model } : res.model === undefined ? {} : { model: res.model }),
          outWidth: res.outWidth,
          outHeight: res.outHeight,
          outAnchorX: res.outAnchorX,
          outAnchorY: res.outAnchorY,
          outHash: hash,
          ...(outRel === rel ? {} : { file: outRel }),
        };
        frames++;
        bytes += shipped.byteLength;
      });
      // 同一资源的帧并行转码（`cwebp` 自己限 8 路）
      await Promise.all(jobs);
    }
    report.sets.push({ name: set.name, frames, bytes });
    report.files += frames;
    report.bytes += bytes;
  }
  slim.tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (problems.length > 0) throw new Error(`暂存没出（${problems.length} 处不对）：\n  ${problems.slice(0, 20).join('\n  ')}`);

  const json = Buffer.from(JSON.stringify(slim) + '\n', 'utf8');
  const mOut = resolve(outAssets, `${tier}-manifest.json`);
  writeFileSync(mOut, json);
  writeFileSync(
    `${mOut}.br`,
    brotliCompressSync(json, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: json.byteLength },
    }),
  );
  writeFileSync(`${mOut}.gz`, gzipSync(json, { level: 9 }));
  report.manifestBytes = json.byteLength;
  return report;
}

// ============================================================
//  命令行
// ============================================================

function argStr(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? null : v;
}

/** ★ 暂存目录不许落在仓库里（衍生素材不入库；`.gitignore` 挡不住别的文件名） */
function assertOutsideRepo(out: string): void {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const rel = relative(repo, out);
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
    console.error(`拒絕：--out（${out}）在倉庫裡面。衍生素材不入庫，請放到倉庫外。`);
    process.exit(2);
  }
}

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = argStr('src');
  const out = argStr('out');
  const tier = argStr('tier') ?? 'hd-2x';
  if (src === null || out === null) {
    console.error('用法：node --experimental-strip-types tools/hd-deploy.ts --src <超分产物根> --out <仓库外的暂存目录> [--tier hd-2x]');
    process.exit(2);
  }
  const outAbs = resolve(out);
  assertOutsideRepo(outAbs);
  const r = await buildHdDeploy(resolve(src), outAbs, tier);
  for (const s of r.sets) console.log(`· ${s.name.padEnd(12)} ${String(s.frames).padStart(5)} 張  ${mb(s.bytes).padStart(9)}`);
  console.log(`合計 ${r.files} 張 ${mb(r.bytes)}；清單 ${(r.manifestBytes / 1024).toFixed(1)} KB（另附 .br/.gz）`);
  if (r.hashFixed > 0) console.log(`（${r.hashFixed} 張的 outHash 與來源清單不同 —— 產物在清單之後改過，已按暫存裡的檔案重算）`);
  console.log('');
  console.log(`暫存：${resolve(outAbs, 'assets')}`);
  console.log(`上傳：rsync -a --delete ${resolve(outAbs, 'assets', tier)}/ <主機>:/srv/rich4/deploy/assets/${tier}/`);
  console.log(`      rsync -a ${resolve(outAbs, 'assets', `${tier}-manifest.json`)}* <主機>:/srv/rich4/deploy/assets/`);
}
