/* SPDX-License-Identifier: GPL-3.0-or-later */
import { defineConfig, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = fileURLToPath(new URL('../../assets/game', import.meta.url));

/**
 * 把原版素材目录挂到 `/assets/game/*`。
 *
 * 不用 `publicDir` —— 那会让 vite 在构建时把 237MB 复制一份到 dist。
 * 素材是按需 fetch 的大文件，直接流式返回即可。
 */
function serveGameAssets(): Plugin {
  const prefix = '/assets/game/';
  return {
    name: 'rich4-game-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined || !req.url.startsWith(prefix)) return next();

        // 防目录穿越：解码后归一化，只允许留在 gameDir 内
        const rel = normalize(decodeURIComponent(req.url.slice(prefix.length)));
        if (rel.startsWith('..') || rel.includes('\0')) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const file = join(gameDir, rel);
        if (!file.startsWith(gameDir)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }

        let size: number;
        try {
          const st = statSync(file);
          if (!st.isFile()) return next();
          size = st.size;
        } catch {
          return next();
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveGameAssets()],
  publicDir: false,
  server: {
    fs: { allow: ['../..'] },
  },
});
