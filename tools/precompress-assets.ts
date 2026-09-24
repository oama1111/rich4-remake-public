/*
 * 素材预压缩（W-70 §7）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   node --experimental-strip-types tools/precompress-assets.ts \
 *        [--from assets/game] [--out deploy] [--force] [--only Data.mkf] [--hd <超分素材根>]
 *
 * 对**白名单里的 7 个 `.mkf`** 各生成一份 `.br`（brotli q9）与一份 `.gz`（gzip 9），
 * 落在 `<out>/assets/game/` 下 —— 与 `http-server.ts` 的取法一一对应：
 * 请求头写了 `Accept-Encoding: br` 就发 `.br`，只认 gzip 就发 `.gz`，
 * 都不认就发原文件。
 *
 * ★ 三条红线（任务书 W-70 §7 / W-76 §4）：
 *   ① **不许写进 `assets/game/`** —— 那是只读的原版素材目录，写了就脏了；
 *      这里在启动时直接比对路径，撞上就退出（见 `assertNotSourceDir`）。
 *   ② **不许提交进仓库** —— `.gitignore` 里 `*.br` / `*.gz` 整类忽略（见仓库根）。
 *   ③ 白名单之外一个都不压 —— 与 `static.ts` 的 `isAllowedAssetName` 同一条判据。
 *
 * ⚠️ 这个脚本**只压不复制**：部署目录里那份 `.mkf` 原件由 `docs/deploy.md`
 *   的 `rsync` 那一步放进去（本脚本不替它做，也就不会在仓库里留副本）。
 *
 * ★ 顺手产出 **`assets-manifest.json`**（W-72 §1）：
 *   `{ "version": "<全部 sha256 拼起来再 sha256 的前 12 位>",
 *      "files": [{ "name", "size", "sha256" }] }`
 *   客户端靠它决定 URL 上的 `?v=`（sha256 前 8 位）与进度条的分母（`size`）。
 *   形状必须与 `packages/client/src/asset-loader.ts` 的 `AssetManifest` 逐字对齐 ——
 *   两边各写一份迟早会漂，那边有 19 条单测钉着。
 */

import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANIFEST_NAME } from '../packages/client/src/asset-loader.ts';
import { HD_TIERS, MKF_WHITELIST } from '../packages/server/src/static.ts';

function argStr(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? dflt : v;
}

const fromDir = resolve(argStr('from', 'assets/game'));
const outRoot = resolve(argStr('out', 'deploy'));
const only = argStr('only', '');
/**
 * 超分素材的根（里面是 `hd-2x/` 与 `hd-2x-manifest.json`，`tools/hd-deploy.ts` 的 `<out>/assets`）。
 * 缺省 = `--from` 的上一级（仓库的 `assets/`）。
 */
const hdRoot = resolve(argStr('hd', resolve(fromDir, '..')));
const force = process.argv.includes('--force');

/** 压缩产物落在哪 —— 与站点根下的 `/assets/game/` 对应 */
const outDir = resolve(outRoot, 'assets/game');

/**
 * ★ 红线①：绝不许往原版素材目录里写。
 *
 * 比对的是解析后的绝对路径（`--out` 给相对路径也一样挡住）。
 */
function assertNotSourceDir(): void {
  if (outDir === fromDir) {
    console.error(`拒絕：--out 解析到素材目錄本身（${fromDir}）。那是只讀目錄，請換一個部署目錄。`);
    process.exit(2);
  }
  if (fromDir.startsWith(outDir + '/')) {
    console.error(`拒絕：--from 在 --out 里面（${fromDir} ⊂ ${outDir}），會把產物寫進素材目錄。`);
    process.exit(2);
  }
}

function human(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 一个进清单的档案 */
interface ManifestFile {
  name: string;
  size: number;
  sha256: string;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * 清单里除了 7 个 `.mkf`，还**如实**记下超分清单在不在（W-72 §5 → W-80 §8）：
 * 网页版读到登记就带 `?v=<sha256 前 8 位>` 去拉超分清单（服务器回长期缓存）；没登记也会问一次（404 就整包走原图）。
 *
 * ⚠️ **光有清单不算数**：仓库里那份 `hd-manifest.json`（3.9 MB，只是规划）一直在，但 `assets/hd/` 是空的。
 *   所以判据是「**清单在，而且同名目录里真的有图**」，两条都满足才登记。
 *   分档按 `HD_TIERS`（服务器 `static.ts`）：网页读 `hd-2x`，母版 `hd` 一般不上线。
 */
function hdManifestEntries(): ManifestFile[] {
  const out: ManifestFile[] = [];
  for (const tier of HD_TIERS) {
    const name = `${tier}-manifest.json`;
    const manifestPath = resolve(hdRoot, name);
    const pixelDir = resolve(hdRoot, tier);
    try {
      if (!statSync(manifestPath).isFile()) continue;
      if (readdirSync(pixelDir).length === 0) continue;
      const bytes = readFileSync(manifestPath);
      out.push({ name, size: bytes.byteLength, sha256: sha256Of(bytes) });
    } catch {
      // 没有这一档
    }
  }
  return out;
}

/**
 * 版本号 = **全部 sha256 拼起来再 sha256 的前 12 位**（任务书 W-72 §1 逐字）。
 *
 * 顺序按 `files` 的数组顺序（`mkf` 白名单序 + `hd-manifest.json`），
 * 所以在同一批文件上重跑必得同一个值。
 */
function versionOf(files: readonly ManifestFile[]): string {
  return createHash('sha256').update(files.map((f) => f.sha256).join('')).digest('hex').slice(0, 12);
}

function main(): void {
  assertNotSourceDir();
  mkdirSync(outDir, { recursive: true });
  console.log(`來源：${fromDir}`);
  console.log(`產物：${outDir}`);
  console.log('');

  let rawTotal = 0;
  let brTotal = 0;
  let gzTotal = 0;
  const manifest: ManifestFile[] = [];

  for (const name of MKF_WHITELIST) {
    if (only !== '' && name !== only) continue;
    const src = resolve(fromDir, name);
    let srcStat;
    try {
      srcStat = statSync(src);
    } catch {
      console.log(`· ${name}：來源沒有這一份，跳過`);
      continue;
    }
    const raw = readFileSync(src);
    if (raw.byteLength !== srcStat.size) throw new Error(`${name}: 讀到的長度與 stat 不符`);

    const brPath = resolve(outDir, `${name}.br`);
    const gzPath = resolve(outDir, `${name}.gz`);
    // 已经压过且比源新就跳过 —— q9 压 76 MB 的 map.mkf 要好几分钟，重跑不该白等
    const fresh = (p: string): boolean => {
      try {
        return !force && statSync(p).mtimeMs >= srcStat.mtimeMs;
      } catch {
        return false;
      }
    };

    let br: Buffer;
    if (fresh(brPath)) {
      br = readFileSync(brPath);
    } else {
      br = brotliCompressSync(raw, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
          // ★ 把原始长度告诉编码器：不给它就得自己猜窗口，压出来会大一点
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
        },
      });
      writeFileSync(brPath, br);
    }
    let gz: Buffer;
    if (fresh(gzPath)) {
      gz = readFileSync(gzPath);
    } else {
      gz = gzipSync(raw, { level: 9 });
      writeFileSync(gzPath, gz);
    }

    rawTotal += raw.byteLength;
    brTotal += br.byteLength;
    gzTotal += gz.byteLength;
    manifest.push({ name, size: raw.byteLength, sha256: sha256Of(raw) });
    console.log(
      `· ${name.padEnd(14)} ${human(raw.byteLength).padStart(8)} → br ${human(br.byteLength).padStart(8)} / gz ${human(gz.byteLength).padStart(8)}`,
    );
  }

  const hd = hdManifestEntries();
  manifest.push(...hd);

  if (rawTotal > 0) {
    console.log('');
    console.log(
      `合計 ${human(rawTotal)} → br ${human(brTotal)}（省 ${(100 - (brTotal / rawTotal) * 100).toFixed(1)}%）/ gz ${human(gzTotal)}`,
    );
  }

  // ★ 清单必须与**实际放进去的**那一份一致：少一个档案时客户端会退回「逐个按名字拉」
  //   （见 `asset-loader.ts`），宁可退化成老路，也不给一个分母偏小的进度条。
  const doc = { version: versionOf(manifest), files: manifest };
  writeFileSync(resolve(outDir, MANIFEST_NAME), JSON.stringify(doc, null, 2) + '\n');
  console.log('');
  console.log(`清單：${resolve(outDir, MANIFEST_NAME)}  version=${doc.version}  ${manifest.length} 個檔案`);
  if (manifest.length - hd.length !== MKF_WHITELIST.length) {
    console.log(`⚠ 清單裡只有 ${manifest.length} 個檔案（完整要 ${MKF_WHITELIST.length} 個）：客戶端這版會退回逐個按名字下載。`);
  }
  if (hd.length === 0) console.log(`（${hdRoot} 下沒有超分清單 + 圖 —— 網頁版照樣會問一次超分清單，404 就全走原圖）`);
  else console.log(`超分清單：${hd.map((h) => h.name).join('、')}（網頁版帶 ?v= 拉，長期緩存）`);
  console.log('');
  console.log(`伺服器用法：node --experimental-transform-types packages/server/src/cli.ts --web <站點> --assets ${outDir}`);
}

main();
