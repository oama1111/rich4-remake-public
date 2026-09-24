/* SPDX-License-Identifier: GPL-3.0-or-later */
import { defineConfig, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const gameDir = fileURLToPath(new URL('../../assets/game', import.meta.url));
/** 超分产物（不入库；空目录/不存在时一律 404，客户端回退原图） */
const hdDir = fileURLToPath(new URL('../../assets/hd', import.meta.url));
const hdManifest = fileURLToPath(new URL('../../assets/hd-manifest.json', import.meta.url));

/**
 * 把原版素材目录挂到 `/assets/game/*`，超分产物挂到 `/assets/hd/*`
 * （清单在 `/assets/hd-manifest.json`，与 `hdBase()` 的约定一致）。
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
        if (url === '/assets/hd-manifest.json') return streamFile(hdManifest, 'application/json', res, next);
        const mount = url.startsWith('/assets/game/')
          ? { prefix: '/assets/game/', dir: gameDir, type: 'application/octet-stream' }
          : url.startsWith('/assets/hd/')
            ? { prefix: '/assets/hd/', dir: hdDir, type: 'image/png' }
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
