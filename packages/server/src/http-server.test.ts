/*
 * W-70：生产 HTTP 服务器 —— 真 `http.Server`、随机端口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这里**不 mock http**：起真的服务器、真的发请求。理由是这个文件的全部内容
 *   就是「网线上到底回了什么」—— mock 掉等于什么都没测。
 * ★ 素材与静态站都落在 `mkdtemp` 造的临时目录里，不碰仓库里的 `assets/game/`。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Rich4Map } from '@rich4/core';
import { createHttpHandler, startHttpServer, startServer } from './http-server.ts';
import { GATE_COOKIE, Gate } from './gate.ts';
import { MKF_WHITELIST, SECURITY_HEADERS } from './static.ts';

// ============================================================
//  夹具
// ============================================================

interface Served {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const leftovers: { close(): void }[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const s of leftovers.splice(0)) s.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

/** 造一份「像站点、像素材目录」的临时树，并起一个真服务器（`gate` 给了就装门） */
async function withServer(
  seed: (dirs: { web: string; assets: string }) => void,
  fn: (f: { port: number; web: string; assets: string }) => Promise<void>,
  gate?: Gate,
): Promise<void> {
  const web = tempDir('rich4-w70-web-');
  const assets = tempDir('rich4-w70-assets-');
  seed({ web, assets });
  const server = createServer(createHttpHandler({ webDir: web, assetDir: assets, ...(gate === undefined ? {} : { gate }) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  leftovers.push({
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  });
  await fn({ port, web, assets });
}

/**
 * 与 `withServer` 同一套，但**走 `startHttpServer`** —— 只有它挂了 WebSocket 端点。
 * 凡是碰 `/ws` 的用例都必须用这一个（`createServer(createHttpHandler(...))` 的
 * `upgrade` 事件没人接，socket 会被直接关掉）。
 */
async function withWsServer(
  seed: (dirs: { web: string; assets: string }) => void,
  fn: (f: { port: number; web: string; assets: string }) => Promise<void>,
  gate?: Gate,
): Promise<void> {
  const web = tempDir('rich4-w70-web-');
  const assets = tempDir('rich4-w70-assets-');
  seed({ web, assets });
  const running = await startHttpServer({
    port: 0,
    assetDir: assets,
    webDir: web,
    map: STUB_MAP,
    globalMapId: 0,
    seedFor: () => 1,
    ...(gate === undefined ? {} : { gate }),
  });
  leftovers.push({ close: () => running.close() });
  const port = (running.server.address() as AddressInfo).port;
  await fn({ port, web, assets });
}

/** 让临时素材目录里有一套完整的白名单文件，外加几个**绝不该端出去**的 */
function seedAssets(assets: string): void {
  for (const n of MKF_WHITELIST) writeFileSync(join(assets, n), `RAW:${n}`);
  writeFileSync(join(assets, 'midi01.mid'), 'RAW:midi01.mid');
  writeFileSync(join(assets, 'midi14-1.mid'), 'RAW:midi14-1.mid');
  writeFileSync(join(assets, 'rich4.exe'), 'MZ...');
  writeFileSync(join(assets, 'Uninst.exe'), 'MZ...');
  writeFileSync(join(assets, 'Save0.dat'), 'SAVE');
  writeFileSync(join(assets, 'Start.avi'), 'RIFF');
}

function get(
  port: number,
  path: string,
  opts: { headers?: Record<string, string>; method?: string; body?: string } = {},
): Promise<Served> {
  return new Promise<Served>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

/** 表单登录 —— `application/x-www-form-urlencoded` */
function login(port: number, password: string): Promise<Served> {
  return get(port, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(password)}`,
  });
}

/** 原始 socket 发一个升级请求，返回响应头那几行 —— 不经过 http 客户端 */
function upgrade(port: number, path: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const extra = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('');
    const sock = connect(port, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          extra +
          '\r\n',
      );
    });
    let buf = '';
    const done = (): void => {
      sock.destroy();
      resolve(buf);
    };
    sock.on('data', (d: Buffer) => {
      buf += d.toString('latin1');
      if (buf.includes('\r\n\r\n')) done();
    });
    sock.on('error', reject);
    // 服务器不应该晾着我们；真晾着也要有个结果，别把测试挂住
    setTimeout(done, 1500).unref();
  });
}

// ============================================================
//  素材
// ============================================================

describe('★ /assets/game —— 白名单', () => {
  it('7 个 .mkf 与配乐都能取，且带素材那套响应头', async () => {
    await withServer((d) => seedAssets(d.assets), async ({ port, assets }) => {
      for (const n of MKF_WHITELIST) {
        const r = await get(port, `/assets/game/${n}`);
        expect(r.status, n).toBe(200);
        expect(r.body.toString(), n).toBe(`RAW:${n}`);
        expect(r.headers['content-type'], n).toBe('application/octet-stream');
        expect(r.headers['cache-control'], n).toBe('private, max-age=31536000, immutable');
        expect(r.headers['accept-ranges'], n).toBe('none');
        expect(r.headers['content-length'], n).toBe(String(`RAW:${n}`.length));
      }
      for (const n of ['midi01.mid', 'midi14-1.mid']) {
        const r = await get(port, `/assets/game/${n}`);
        expect(r.status, n).toBe(200);
        expect(r.headers['content-type'], n).toBe('audio/midi');
        expect(r.body.toString(), n).toBe(`RAW:${n}`);
      }
      // 磁盘上是小写、客户端按 Midi.txt 里的大写来取，也要能取到
      const upper = await get(port, '/assets/game/MIDI01.MID');
      expect(upper.status).toBe(200);
      expect(upper.body.toString()).toBe('RAW:midi01.mid');
      expect(assets).toContain('rich4-w70-assets-');
    });
  });

  it('★ rich4.exe / Uninst.exe / Save0.dat / Start.avi 一个都取不到（404）', async () => {
    await withServer((d) => seedAssets(d.assets), async ({ port }) => {
      for (const n of ['rich4.exe', 'Uninst.exe', 'Save0.dat', 'Start.avi']) {
        const r = await get(port, `/assets/game/${n}`);
        expect(r.status, n).toBe(404);
        expect(r.body.toString(), n).toBe('Not Found');
      }
    });
  });

  it('目录穿越与绝对路径注入一律非 200', async () => {
    await withServer((d) => seedAssets(d.assets), async ({ port }) => {
      const cases: [string, number][] = [
        ['/assets/game/../package.json', 400],
        ['/assets/game/%2e%2e%2fpackage.json', 400],
        ['/assets/game/%2E%2E/package.json', 400],
        ['/assets/game//etc/passwd', 400],
        ['/assets/game/..%2f..%2fetc%2fpasswd', 400],
        ['/assets/game/%', 400],
        ['/assets/game/sub/Data.mkf', 404],
        ['/assets/game/Data.mkf/../rich4.exe', 400],
      ];
      for (const [path, want] of cases) {
        const r = await get(port, path);
        expect(r.status, path).toBe(want);
      }
    });
  });
});

// ============================================================
//  预压缩
// ============================================================

describe('★ 预压缩 .br / .gz', () => {
  it('带 Accept-Encoding: br 拿 .br 那份；不带就拿原文件', async () => {
    await withServer(
      ({ assets }) => {
        seedAssets(assets);
        writeFileSync(join(assets, 'Data.mkf.br'), 'BROTLI');
        writeFileSync(join(assets, 'Data.mkf.gz'), 'GZIP');
      },
      async ({ port }) => {
        const br = await get(port, '/assets/game/Data.mkf', { headers: { 'Accept-Encoding': 'br' } });
        expect(br.status).toBe(200);
        expect(br.headers['content-encoding']).toBe('br');
        expect(br.headers['vary']).toBe('Accept-Encoding');
        expect(br.body.toString()).toBe('BROTLI');
        // ★ Content-Length 必须是**要发的那一份**的长度，不是原文件的
        expect(br.headers['content-length']).toBe(String('BROTLI'.length));

        const gz = await get(port, '/assets/game/Data.mkf', { headers: { 'Accept-Encoding': 'gzip, deflate' } });
        expect(gz.headers['content-encoding']).toBe('gzip');
        expect(gz.body.toString()).toBe('GZIP');

        const plain = await get(port, '/assets/game/Data.mkf');
        expect(plain.status).toBe(200);
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.headers['vary']).toBeUndefined();
        expect(plain.body.toString()).toBe('RAW:Data.mkf');
      },
    );
  });

  it('只有 .gz 时，只认 br 的客户端拿原文件', async () => {
    await withServer(
      ({ assets }) => {
        seedAssets(assets);
        writeFileSync(join(assets, 'Panel.mkf.gz'), 'GZIP');
      },
      async ({ port }) => {
        const br = await get(port, '/assets/game/Panel.mkf', { headers: { 'Accept-Encoding': 'br' } });
        expect(br.headers['content-encoding']).toBeUndefined();
        expect(br.body.toString()).toBe('RAW:Panel.mkf');
        const gz = await get(port, '/assets/game/Panel.mkf', { headers: { 'Accept-Encoding': 'gzip' } });
        expect(gz.headers['content-encoding']).toBe('gzip');
        expect(gz.body.toString()).toBe('GZIP');
      },
    );
  });
});

// ============================================================
//  静态站
// ============================================================

function seedWeb(web: string): void {
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>rich4</title>');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'assets', 'index-C3t3qLJy.js'), 'export default 1;');
  writeFileSync(join(web, 'assets', 'index-C3t3qLJy.css'), 'body{}');
  writeFileSync(join(web, 'assets', 'app.js'), '// 没哈希');
}

describe('★ 静态站', () => {
  it('/ 给 index.html 且 no-cache；带哈希的产物 immutable、没哈希的 no-cache', async () => {
    await withServer((d) => seedWeb(d.web), async ({ port }) => {
      const root = await get(port, '/');
      expect(root.status).toBe(200);
      expect(root.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(root.headers['cache-control']).toBe('no-cache');
      expect(root.body.toString()).toContain('rich4');

      const hashed = await get(port, '/assets/index-C3t3qLJy.js');
      expect(hashed.status).toBe(200);
      expect(hashed.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(hashed.headers['content-type']).toBe('text/javascript; charset=utf-8');

      const plain = await get(port, '/assets/app.js');
      expect(plain.status).toBe(200);
      expect(plain.headers['cache-control']).toBe('no-cache');

      expect((await get(port, '/no-such-page')).status).toBe(404);
      expect((await get(port, '/assets/../../secret')).status).toBe(400);
    });
  });

  it('没给 --web 时静态站整块不服务（404），素材与 robots.txt 照常', async () => {
    const assets = tempDir('rich4-w70-assets-');
    seedAssets(assets);
    const server = createServer(createHttpHandler({ assetDir: assets }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    leftovers.push({
      close: () => {
        server.closeAllConnections();
        server.close();
      },
    });
    expect((await get(port, '/')).status).toBe(404);
    expect((await get(port, '/robots.txt')).status).toBe(200);
    expect((await get(port, '/assets/game/Data.mkf')).status).toBe(200);
  });

  it('POST 等非 GET/HEAD → 405', async () => {
    await withServer((d) => seedWeb(d.web), async ({ port }) => {
      const r = await get(port, '/', { method: 'POST' });
      expect(r.status).toBe(405);
      expect(r.headers['allow']).toBe('GET, HEAD');
    });
  });

  it('HEAD 有头无体', async () => {
    await withServer((d) => seedAssets(d.assets), async ({ port }) => {
      const r = await get(port, '/assets/game/Data.mkf', { method: 'HEAD' });
      expect(r.status).toBe(200);
      expect(r.headers['content-length']).toBe(String('RAW:Data.mkf'.length));
      expect(r.body.byteLength).toBe(0);
    });
  });
});

// ============================================================
//  robots.txt 与安全头
// ============================================================

describe('★ /robots.txt 与三个安全头', () => {
  it('/robots.txt 正文逐字相等', async () => {
    await withServer((d) => seedAssets(d.assets), async ({ port }) => {
      const r = await get(port, '/robots.txt');
      expect(r.status).toBe(200);
      expect(r.body.toString()).toBe('User-agent: *\nDisallow: /\n');
      expect(r.headers['content-type']).toBe('text/plain; charset=utf-8');
    });
  });

  it('200 / 404 / 403 / 400 上都带着三个安全头', async () => {
    await withServer((d) => seedWeb(d.web), async ({ port }) => {
      // 200
      const ok = await get(port, '/');
      // 404
      const missing = await get(port, '/nope');
      // 403 —— `/.` 解析出来就是站点根目录本身，是**够得着**的那一条 403 分支
      const forbidden = await get(port, '/.');
      // 400
      const bad = await get(port, '/%2e%2e/package.json');

      expect(ok.status).toBe(200);
      expect(missing.status).toBe(404);
      expect(forbidden.status).toBe(403);
      expect(bad.status).toBe(400);

      for (const [label, r] of [['200', ok], ['404', missing], ['403', forbidden], ['400', bad]] as const) {
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
          expect(r.headers[k.toLowerCase()], `${label} ${k}`).toBe(v);
        }
      }
    });
  });
});

// ============================================================
//  startHttpServer：监听与 /ws
// ============================================================

/** `RoomHub` 在开局前不碰地图，故这一份骨架够用（HTTP 这几条用例不开局） */
const STUB_MAP = {
  nodes: [],
  lands: [],
  facilities: [],
  commercials: [],
  landscapes: [],
} as unknown as Rich4Map;

describe('★ startHttpServer 与 /ws', () => {
  it('WS 端点只在 /ws 上握手；别的路径 404，且不动 HTTP 静态站', async () => {
    const assets = tempDir('rich4-w70-assets-');
    const web = tempDir('rich4-w70-web-');
    seedAssets(assets);
    seedWeb(web);
    const running = await startHttpServer({
      port: 0,
      assetDir: assets,
      webDir: web,
      map: STUB_MAP,
      globalMapId: 0,
      seedFor: () => 1,
    });
    leftovers.push({ close: () => running.close() });
    // `--port 0` 时实际端口要从 server.address() 反查；url 里那一个必须是真的
    const port = (running.server.address() as AddressInfo).port;
    expect(running.url).toBe(`http://127.0.0.1:${port}`);

    const ws = await upgrade(port, '/ws');
    expect(ws.startsWith('HTTP/1.1 101')).toBe(true);
    expect(ws.toLowerCase()).toContain('upgrade: websocket');

    const nope = await upgrade(port, '/nope');
    expect(nope.startsWith('HTTP/1.1 404')).toBe(true);

    // 同一个端口上 HTTP 照常
    expect((await get(port, '/robots.txt')).status).toBe(200);
    expect((await get(port, '/')).status).toBe(200);
    expect((await get(port, '/assets/game/Data.mkf')).status).toBe(200);
  });

  it('缺省只听 127.0.0.1（公网由 Caddy 反代）', async () => {
    const assets = tempDir('rich4-w70-assets-');
    seedAssets(assets);
    const running = await startHttpServer({
      port: 0,
      assetDir: assets,
      map: STUB_MAP,
      globalMapId: 0,
      seedFor: () => 1,
    });
    leftovers.push({ close: () => running.close() });
    const addr = running.server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
  });
});

// ============================================================
//  访问密码（W-71）
// ============================================================

const PASSWORD = 'open-sesame-2';
const SECRET = 'k'.repeat(32);

/** 默认**不真睡** —— 500 ms × 十几次会把整个测试套拖慢；要验真实耗时的用例自己建一个 */
function makeGate(extra: { now?: () => number; maxAttempts?: number; windowMs?: number } = {}): Gate {
  return new Gate({ password: PASSWORD, cookieSecret: SECRET, sleep: () => Promise.resolve(), ...extra });
}

/** 从 `Set-Cookie` 里取票值 */
function ticketOf(res: Served): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('没有 Set-Cookie');
  const pair = first.split(';')[0] ?? '';
  return pair.slice(pair.indexOf('=') + 1);
}

describe('★ 访问密码 —— 整站一道门（W-71）', () => {
  it('没带票：浏览器取 / → 303 去 /login，素材 → 401；robots 与 login 免检', async () => {
    const gate = makeGate();
    await withServer(
      (d) => seedAssets(d.assets),
      async ({ port }) => {
        const home = await get(port, '/', { headers: { Accept: 'text/html,application/xhtml+xml' } });
        expect(home.status).toBe(303);
        expect(home.headers['location']).toBe('/login');
        // 三个安全头在 303 上也带着
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(home.headers[k.toLowerCase()]).toBe(v);

        const asset = await get(port, '/assets/game/Data.mkf');
        expect(asset.status).toBe(401);

        const robots = await get(port, '/robots.txt');
        expect(robots.status).toBe(200);
        expect(robots.body.toString()).toBe('User-agent: *\nDisallow: /\n');

        const form = await get(port, '/login');
        expect(form.status).toBe(200);
        expect(form.body.toString()).toContain('type="password"');
        expect(form.body.toString()).toContain('action="/login"');
      },
      gate,
    );
  });

  it('错密码 → 401 同一张表单 +「密碼錯誤」，且**真的**等了 ≥ 450 ms', async () => {
    // 这条用**真** sleep（不给 sleep 注入），验的就是那个常量延迟本身
    const gate = new Gate({ password: PASSWORD, cookieSecret: SECRET });
    await withServer(
      () => undefined,
      async ({ port }) => {
        const t0 = Date.now();
        const bad = await login(port, 'wrong-password');
        const elapsed = Date.now() - t0;
        expect(bad.status).toBe(401);
        expect(bad.body.toString()).toContain('密碼錯誤');
        expect(elapsed).toBeGreaterThanOrEqual(450);
      },
      gate,
    );
  });

  it('窗口内第 6 次 POST → 429（前 5 次照常判密码）', async () => {
    const gate = makeGate();
    await withServer(
      () => undefined,
      async ({ port }) => {
        for (let i = 1; i <= 5; i++) {
          const r = await login(port, 'wrong-password');
          expect(r.status, `第 ${i} 次`).toBe(401);
        }
        // 第 6 次**连对密码都不给试**
        const sixth = await login(port, PASSWORD);
        expect(sixth.status).toBe(429);
        expect(sixth.headers['retry-after']).toBe('60');
      },
      gate,
    );
  });

  it('篡改一位的票 / 过期的票 → 都当没带票', async () => {
    let now = 1_000_000;
    const gate = makeGate({ now: () => now });
    await withServer(
      (d) => seedAssets(d.assets),
      async ({ port }) => {
        const good = gate.issue();
        const tampered = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
        const tamperedRes = await get(port, '/assets/game/Data.mkf', {
          headers: { Cookie: `${GATE_COOKIE}=${tampered}` },
        });
        expect(tamperedRes.status).toBe(401);

        const okRes = await get(port, '/assets/game/Data.mkf', { headers: { Cookie: `${GATE_COOKIE}=${good}` } });
        expect(okRes.status).toBe(200);

        now += 2_592_000 * 1000 + 1; // Max-Age 之后
        const expired = await get(port, '/assets/game/Data.mkf', { headers: { Cookie: `${GATE_COOKIE}=${good}` } });
        expect(expired.status).toBe(401);
      },
      gate,
    );
  });

  it('对密码 → 发一张 HttpOnly/SameSite/Path/Max-Age 的票，之后 / 与素材与 /ws 三样都通', async () => {
    const gate = makeGate();
    await withWsServer(
      (d) => {
        seedAssets(d.assets);
        seedWeb(d.web);
      },
      async ({ port }) => {
        const ok = await login(port, PASSWORD);
        expect(ok.status).toBe(303);
        expect(ok.headers['location']).toBe('/');
        const raw = ok.headers['set-cookie'];
        const cookie = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
        expect(cookie).toContain(`${GATE_COOKIE}=`);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('Max-Age=2592000');
        expect(cookie).not.toContain('Secure'); // 没经 HTTPS 不加

        const jar = { Cookie: `${GATE_COOKIE}=${ticketOf(ok)}` };
        expect((await get(port, '/assets/game/Data.mkf', { headers: jar })).status).toBe(200);
        expect((await get(port, '/', { headers: { Accept: 'text/html', ...jar } })).status).toBe(200);
        const ws = await upgrade(port, '/ws', { ...jar, Origin: `http://127.0.0.1:${port}` });
        expect(ws.startsWith('HTTP/1.1 101')).toBe(true);
      },
      gate,
    );
  });

  it('经 HTTPS（X-Forwarded-Proto）才加 Secure', async () => {
    const gate = makeGate();
    await withServer(
      () => undefined,
      async ({ port }) => {
        const res = await get(port, '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' },
          body: `password=${PASSWORD}`,
        });
        const raw = res.headers['set-cookie'];
        const cookie = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
        expect(cookie).toContain('Secure');
      },
      gate,
    );
  });

  it('WS 升级：没票 → 401；票对了但 Origin 主机名不同 / 干脆没有 Origin → 403', async () => {
    const gate = makeGate();
    await withWsServer(
      () => undefined,
      async ({ port }) => {
        expect((await upgrade(port, '/ws')).startsWith('HTTP/1.1 401')).toBe(true);
        const jar = { Cookie: `${GATE_COOKIE}=${gate.issue()}` };
        expect((await upgrade(port, '/ws', { ...jar, Origin: 'http://evil.example' })).startsWith('HTTP/1.1 403')).toBe(
          true,
        );
        expect((await upgrade(port, '/ws', jar)).startsWith('HTTP/1.1 403')).toBe(true);
        expect(
          (await upgrade(port, '/ws', { ...jar, Origin: `http://127.0.0.1:${port}` })).startsWith('HTTP/1.1 101'),
        ).toBe(true);
      },
      gate,
    );
  });

  it('登录正文：超过 1 KB → 413；不是表单类型 → 400', async () => {
    const gate = makeGate();
    await withServer(
      () => undefined,
      async ({ port }) => {
        const tooBig = await get(port, '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `password=${'x'.repeat(2000)}`,
        });
        expect(tooBig.status).toBe(413);

        const wrongType = await get(port, '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: `password=${PASSWORD}`,
        });
        expect(wrongType.status).toBe(400);
      },
      gate,
    );
  });
});

describe('★ startServer —— 门从环境变量来', () => {
  const base = { port: 0, map: STUB_MAP, globalMapId: 0, seedFor: () => 1 };

  it('缺 RICH4_COOKIE_SECRET → 抛，且**报错文本里不含密码**', async () => {
    const assets = tempDir('rich4-w70-assets-');
    seedAssets(assets);
    let text = '';
    try {
      await startServer({ ...base, assetDir: assets, env: { RICH4_PASSWORD: PASSWORD } });
    } catch (err) {
      text = String(err);
    }
    expect(text).toMatch(/RICH4_COOKIE_SECRET/);
    expect(text).not.toContain(PASSWORD);
  });

  it('缺 RICH4_PASSWORD → 抛', async () => {
    const assets = tempDir('rich4-w70-assets-');
    seedAssets(assets);
    await expect(startServer({ ...base, assetDir: assets, env: { RICH4_COOKIE_SECRET: SECRET } })).rejects.toThrow(
      /RICH4_PASSWORD/,
    );
  });

  it('两个都在 → 装门（不带票取素材得 401）', async () => {
    const assets = tempDir('rich4-w70-assets-');
    seedAssets(assets);
    const running = await startServer({
      ...base,
      assetDir: assets,
      env: { RICH4_PASSWORD: PASSWORD, RICH4_COOKIE_SECRET: SECRET },
    });
    leftovers.push({ close: () => running.close() });
    const port = (running.server.address() as AddressInfo).port;
    expect((await get(port, '/assets/game/Data.mkf')).status).toBe(401);
    expect((await get(port, '/robots.txt')).status).toBe(200);
  });

  it('--no-gate：非本机地址拒绝启动；本机可以，且不受环境变量影响', async () => {
    const assets = tempDir('rich4-w70-assets-');
    seedAssets(assets);
    await expect(startServer({ ...base, assetDir: assets, host: '0.0.0.0', noGate: true, env: {} })).rejects.toThrow(
      /no-gate/,
    );

    const running = await startServer({ ...base, assetDir: assets, noGate: true, env: {} });
    leftovers.push({ close: () => running.close() });
    const port = (running.server.address() as AddressInfo).port;
    expect((await get(port, '/assets/game/Data.mkf')).status).toBe(200);
  });
});
