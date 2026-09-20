/*
 * 素材预压缩（W-70 §7）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   node --experimental-strip-types tools/precompress-assets.ts \
 *        [--from assets/game] [--out deploy] [--force] [--only Data.mkf]
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
 */

import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MKF_WHITELIST } from '../packages/server/src/static.ts';

function argStr(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? dflt : v;
}

const fromDir = resolve(argStr('from', 'assets/game'));
const outRoot = resolve(argStr('out', 'deploy'));
const only = argStr('only', '');
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

function main(): void {
  assertNotSourceDir();
  mkdirSync(outDir, { recursive: true });
  console.log(`來源：${fromDir}`);
  console.log(`產物：${outDir}`);
  console.log('');

  let rawTotal = 0;
  let brTotal = 0;
  let gzTotal = 0;

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
    console.log(
      `· ${name.padEnd(14)} ${human(raw.byteLength).padStart(8)} → br ${human(br.byteLength).padStart(8)} / gz ${human(gz.byteLength).padStart(8)}`,
    );
  }

  if (rawTotal > 0) {
    console.log('');
    console.log(
      `合計 ${human(rawTotal)} → br ${human(brTotal)}（省 ${(100 - (brTotal / rawTotal) * 100).toFixed(1)}%）/ gz ${human(gzTotal)}`,
    );
  }
  console.log('');
  console.log(`伺服器用法：node --experimental-transform-types packages/server/src/cli.ts --web <站點> --assets ${outDir}`);
}

main();
