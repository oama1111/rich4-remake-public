/* SPDX-License-Identifier: GPL-3.0-or-later */
import { defineConfig, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const gameDir = fileURLToPath(new URL('../../assets/game', import.meta.url));
/**
 * 超分产物（不入库；空目录/不存在时一律 404，客户端回退原图）。
 * `hd` = 4× 母版，`hd-2x` = `pnpm upscale tier` 缩出来的网页档（见 `host.ts` 的 `hdTierDir`）。
 */
const assetsRoot = fileURLToPath(new URL('../../assets', import.meta.url));
/**
 * 超分素材根的覆盖：`RICH4_HD_ROOT=<tools/hd-deploy.ts 的 out>/assets` 时开发服务器端的就是**线上那份**
 * 已验证子集（清单 + 图），验收 / 量性能用；不设就是仓库的 `assets/`（全量产物，若有）。
 */
const hdRoot = process.env['RICH4_HD_ROOT'] ?? assetsRoot;
const HD_TIERS = ['hd', 'hd-2x'] as const;

/**
 * 把原版素材目录挂到 `/assets/game/*`，超分产物挂到 `/assets/hd/*` 与 `/assets/hd-2x/*`
 * （清单在同级的 `<档>-manifest.json`，与 `hdBase()` 的约定一致）。
 *
 * 不用 `publicDir` —— 那会让 vite 在构建时把 237MB 复制一份到 dist。
 * 素材是按需 fetch 的大文件，直接流式返回即可。
 */
function serveGameAssets(): Plugin {
  return {
    name: 'rich4-game-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined) return next();
        const url = req.url.split('?')[0]!;
        const tier = HD_TIERS.find((t) => url === `/assets/${t}-manifest.json`);
        if (tier !== undefined) return streamFile(join(hdRoot, `${tier}-manifest.json`), 'application/json', res, next);
        const hdTier = HD_TIERS.find((t) => url.startsWith(`/assets/${t}/`));
        const mount = url.startsWith('/assets/game/')
          ? { prefix: '/assets/game/', dir: gameDir, type: 'application/octet-stream' }
          : hdTier !== undefined
            ? { prefix: `/assets/${hdTier}/`, dir: join(hdRoot, hdTier), type: url.endsWith('.webp') ? 'image/webp' : 'image/png' }
            : null;
        if (mount === null) return next();

        // 防目录穿越：解码后归一化，只允许留在挂载目录内
        const rel = normalize(decodeURIComponent(url.slice(mount.prefix.length)));
        if (rel.startsWith('..') || rel.includes('\0')) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const file = join(mount.dir, rel);
        if (!file.startsWith(mount.dir)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }
        streamFile(file, mount.type, res, next);
      });
    },
  };
}

/** 文件在就流式返回；不在交给下一个中间件（最终 404） */
function streamFile(
  file: string,
  type: string,
  res: ServerResponse,
  next: () => void,
): void {
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return next();
    size = st.size;
  } catch {
    return next();
  }
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(size));
  createReadStream(file).pipe(res);
}

export default defineConfig({
  plugins: [serveGameAssets()],
  publicDir: false,
  server: {
    fs: { allow: ['../..'] },
  },
});
