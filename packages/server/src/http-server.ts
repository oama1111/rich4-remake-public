/*
 * 生产 HTTP 服务器 —— 静态站 + 原版素材 + WebSocket，全在一个进程一个端口里（W-70）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ```
 *   GET /robots.txt              固定正文（不让搜索引擎收录）
 *   GET /assets/game/<白名单>     原版素材（预压缩 .br/.gz 优先）
 *   GET /*                        静态站 = packages/client/dist-web（--web 才开）
 *   WS  /ws                       联机集线器（hub.ts）
 * ```
 *
 * ★ **不引入 express / koa / 任何 web 框架**（任务书 §2）：只用 `node:http`
 *   与现有的 `ws`，依赖一个不加。这一层要做的事少得可怜 —— 路由只有四条，
 *   安全判据全在 `static.ts` 里由单测钉着。
 *
 * ★ 所有判断都走 `static.ts` 的纯函数，本文件只管 IO（读文件、写响应、关连接）。
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  ASSET_PREFIX,
  ROBOTS_TXT,
  SECURITY_HEADERS,
  cacheControlFor,
  contentTypeFor,
  findOnDisk,
  isAllowedAssetName,
  precompressedFor,
  resolveUnder,
  safeRelativePath,
} from './static.ts';
import { WS_PATH, attachWebSocket, type WsEndpoint, type WsServerOptions } from './ws-server.ts';

export interface HttpServerOptions extends WsServerOptions {
  port: number;
  /**
   * 只听这个地址 @default '127.0.0.1'。
   *
   * ★ 缺省**只听本机**是有意的：公网流量由 Caddy 反代进来（任务书 §2），
   *   服务器进程自己不该直接暴露在公网上。
   */
  host?: string;
  /** 静态站目录；**不给就不开静态服务**（只留 /robots.txt 与 /assets/game） */
  webDir?: string;
  /** 原版素材目录（`cli.ts` 缺省 = 仓库的 `assets/game`） */
  assetDir: string;
}

export interface RunningHttpServer {
  hub: WsEndpoint['hub'];
  server: Server;
  /** 实际监听的地址，形如 `http://127.0.0.1:8787` */
  url: string;
  close(): void;
}

export interface HandlerOptions {
  assetDir: string;
  webDir?: string;
}

// ============================================================
//  路由
// ============================================================

/**
 * 造一个请求处理器（不监听端口）。
 *
 * 拆出来是为了让单测能把它挂到任意端口上，也为了 W-71 能在外面套一层门。
 */
export function createHttpHandler(opts: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const assetDir = opts.assetDir;
  const webDir = opts.webDir;
  return (req, res) => {
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) {
      send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }, 'Method Not Allowed', head);
      return;
    }
    const raw = req.url ?? '/';
    const q = raw.indexOf('?');
    const path = q === -1 ? raw : raw.slice(0, q);
    // 源服务器只该收到 origin-form（`/...`）；绝对形式或相对形式一律当坏请求，
    // 免得 `../package.json` 这种被当成「根目录下的相对路径」端出去。
    if (!path.startsWith('/')) {
      send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request', head);
      return;
    }
    if (path === '/robots.txt') {
      send(
        res,
        200,
        { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
        ROBOTS_TXT,
        head,
      );
      return;
    }
    if (path.startsWith(ASSET_PREFIX)) {
      serveAsset(req, res, path.slice(ASSET_PREFIX.length), assetDir, head);
      return;
    }
    if (webDir !== undefined) {
      serveWeb(req, res, path, webDir, head);
      return;
    }
    notFound(res, head);
  };
}

/** `/assets/game/<rel>` —— 白名单 + 预压缩 */
function serveAsset(
  req: IncomingMessage,
  res: ServerResponse,
  rawRel: string,
  assetDir: string,
  head: boolean,
): void {
  const check = safeRelativePath(rawRel);
  if (!check.ok) {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request', head);
    return;
  }
  const rel = check.rel;
  // ★ 白名单之外**一律 404**（不是 403）：`rich4.exe` / 存档 / `.avi` 连
  //   「存在但你不能拿」都不该让人看出来。
  if (!isAllowedAssetName(rel)) {
    notFound(res, head);
    return;
  }
  const abs = resolveUnder(assetDir, rel);
  if (abs === null) {
    send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden', head);
    return;
  }
  const file = findOnDisk(assetDir, rel);
  if (file === null) {
    notFound(res, head);
    return;
  }
  const pre = precompressedFor(req.headers['accept-encoding'], file);
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(rel),
    'Cache-Control': cacheControlFor('asset', rel),
    // 素材整份要，不支持断点续传 —— 明说，省得客户端发 Range 再拿到整份
    'Accept-Ranges': 'none',
  };
  if (pre !== null) {
    headers['Content-Encoding'] = pre.encoding;
    headers['Vary'] = 'Accept-Encoding';
  }
  streamFile(res, pre?.file ?? file, headers, head);
}

/** 静态站 —— `packages/client/dist-web` */
function serveWeb(_req: IncomingMessage, res: ServerResponse, path: string, webDir: string, head: boolean): void {
  const check = safeRelativePath(path.slice(1));
  if (!check.ok) {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request', head);
    return;
  }
  let rel = check.rel;
  // 目录请求落到它自己的 index.html
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const abs = resolveUnder(webDir, rel);
  if (abs === null) {
    send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden', head);
    return;
  }
  let file = abs;
  let size: number;
  try {
    const st = statSync(abs);
    size = st.size;
    if (st.isDirectory()) {
      file = join(abs, 'index.html');
      size = statSync(file).size;
    }
  } catch {
    notFound(res, head);
    return;
  }
  streamFile(res, file, { 'Content-Type': contentTypeFor(file), 'Cache-Control': cacheControlFor('web', rel) }, head, size);
}

// ============================================================
//  响应
// ============================================================

/**
 * 发一个小响应。
 *
 * ★ 三个安全头由 `send` 统一加上 —— 这样 400 / 403 / 404 / 405 也带着它们，
 *   不需要每个分支各写一遍（漏一个就等于没有）。
 */
function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string,
  head: boolean,
): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers, 'Content-Length': String(buf.byteLength) });
  if (head) res.end();
  else res.end(buf);
}

function notFound(res: ServerResponse, head: boolean): void {
  send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found', head);
}

/**
 * 把文件流出去。
 *
 * ⚠️ `Content-Length` 取的是**将要发送的那一份**的大小 —— 命中 `.br` 时是压缩后的，
 *   写错了浏览器会一直等（或截断）。故 `size` 允许调用方传（静态站已经 stat 过）。
 */
function streamFile(
  res: ServerResponse,
  file: string,
  headers: Record<string, string>,
  head: boolean,
  size?: number,
): void {
  let length = size;
  if (length === undefined) {
    try {
      length = statSync(file).size;
    } catch {
      notFound(res, head);
      return;
    }
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': String(length) });
  if (head) {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// ============================================================
//  起服务器
// ============================================================

/**
 * 起一个同时提供静态站、素材与 WebSocket 的服务器（需要已安装 `ws`）。
 *
 * 端口的实际监听地址从 `server.address()` 反查 —— 传 `--port 0` 时能拿到系统分
 * 配的那个号（单测用）。
 */
export async function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  const handler = createHttpHandler(
    opts.webDir === undefined ? { assetDir: opts.assetDir } : { assetDir: opts.assetDir, webDir: opts.webDir },
  );
  const server = createServer(handler);
  const ws = await attachWebSocket(server, opts, WS_PATH);
  const host = opts.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(opts.port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : opts.port;
  return {
    hub: ws.hub,
    server,
    url: `http://${host}:${port}`,
    close: () => {
      ws.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
