/*
 * 访问密码 —— 整站一道门（W-71）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **这是给朋友用的共享密码，不是账号系统**（任务书 W-71 开头）：
 *   不做注册、不做找回、不存用户表。整份实现就是一个密码 + 一张签名 cookie。
 *
 * ★ 三条「不许」：
 *   ① **不许**有缺省密码；两个值只从环境变量来，缺一个就拒绝启动（`gateFromEnv`）；
 *   ② **不许**把密码 / 密钥写进仓库、日志、报错文本 —— 本文件里所有抛出的文案
 *      只提**变量名**，从不回显值；
 *   ③ **不许**用 `===` 比密码 —— 长度与内容都会从耗时里漏出去（`timingSafeEqual`
 *      前先各自 SHA-256，两边定长，连长度差也一并抹平）。
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { SECURITY_HEADERS } from './static.ts';

/** cookie 名 —— 名字里带 `rich4` 是为了同域下别的服务不撞车 */
export const GATE_COOKIE = 'rich4_gate';
/** 票的有效期（秒）—— 30 天。任务书钉死 `Max-Age=2592000` */
export const GATE_MAX_AGE_S = 2_592_000;
/** 登录页与免检路径 */
export const LOGIN_PATH = '/login';
export const ROBOTS_PATH = '/robots.txt';
/** 正文上限（字节）—— 表单只有一个密码框，1 KB 绰绰有余 */
export const LOGIN_BODY_LIMIT = 1024;
/** 密钥最短长度（字节） */
export const MIN_SECRET_BYTES = 32;

export interface GateOptions {
  password: string;
  cookieSecret: string;
  /** 现在几点 @default `Date.now` —— 测试注入 */
  now?: () => number;
  /** 密码错时的固定延迟 @default 500（毫秒） */
  failDelayMs?: number;
  /** 延迟怎么睡 @default 真 `setTimeout` —— 测试注入，别真睡 */
  sleep?: (ms: number) => Promise<void>;
  /** 限流窗口 @default 60000（毫秒） */
  windowMs?: number;
  /** 一个窗口内最多几次 POST @default 5 */
  maxAttempts?: number;
  /** 限流表上限 @default 10000；超了**整表清空** */
  maxEntries?: number;
}

interface Attempt {
  count: number;
  windowStart: number;
}

/**
 * 一道门。
 *
 * 生命周期：`createHttpHandler` 在每个请求上问它两句 ——
 *   · `allow(req)`：这张票有效吗；
 *   · `handleLogin(req, res)`：这是 `/login`，你来答。
 * WebSocket 升级走 `allowUpgrade(req, socket)`（顺带验 `Origin`）。
 */
export class Gate {
  readonly #password: string;
  readonly #secret: string;
  readonly #now: () => number;
  readonly #failDelayMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #windowMs: number;
  readonly #maxAttempts: number;
  readonly #maxEntries: number;
  readonly #attempts = new Map<string, Attempt>();
  #lastSweep = 0;

  constructor(opts: GateOptions) {
    this.#password = opts.password;
    this.#secret = opts.cookieSecret;
    this.#now = opts.now ?? (() => Date.now());
    this.#failDelayMs = opts.failDelayMs ?? 500;
    this.#sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.#windowMs = opts.windowMs ?? 60_000;
    this.#maxAttempts = opts.maxAttempts ?? 5;
    this.#maxEntries = opts.maxEntries ?? 10_000;
  }

  // ----------------------------------------------------------
  //  票
  // ----------------------------------------------------------

  /** 签一张到期时刻为 `expiryMs` 的票（`<过期时刻>.<HMAC>`） */
  #sign(expiryMs: number): string {
    const expiry = String(Math.trunc(expiryMs));
    return `${expiry}.${this.#hmac(expiry)}`;
  }

  #hmac(expiry: string): string {
    return createHmac('sha256', this.#secret).update(expiry).digest('hex');
  }

  /** 现在签一张有效票 —— 测试与「登录成功」都用这一条，签名逻辑只有一份 */
  issue(now: number = this.#now()): string {
    return this.#sign(now + GATE_MAX_AGE_S * 1000);
  }

  /**
   * cookie 值有效吗。
   *
   * 两道：HMAC 对得上（定长 hex，先比长度再 `timingSafeEqual`）、还没过期。
   * 任何形状不对（缺 `.`、过期时刻不是整数、多一段）一律当无效，不抛。
   */
  validCookieValue(value: string | undefined): boolean {
    if (value === undefined || value === '') return false;
    const dot = value.indexOf('.');
    if (dot <= 0 || dot === value.length - 1) return false;
    const expiry = value.slice(0, dot);
    const mac = value.slice(dot + 1);
    if (!/^\d+$/.test(expiry)) return false;
    // ★★ 首席复核（2026-09-20）：**先钉死形状再比**。`timingSafeEqual` 在两边**字节数**不同时会**抛**
    //   （`ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`），而原先只比了**字符数** —— 64 个 `0xE9`（latin1 头）
    //   是 64 个字符、128 个 UTF-8 字节 ⇒ 抛。HTTP 那条有 `route().catch` 兜着（回 500），
    //   **WebSocket 升级口没有** ⇒ 一条没登录的请求就能把整个进程带走（实测复现）。
    if (!/^[0-9a-f]{64}$/.test(mac)) return false;
    const expected = this.#hmac(expiry);
    if (!timingSafeEqual(Buffer.from(mac, 'latin1'), Buffer.from(expected, 'latin1'))) return false;
    return Number(expiry) > this.#now();
  }

  #cookieOf(req: IncomingMessage): string | undefined {
    const raw = req.headers.cookie;
    if (raw === undefined) return undefined;
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === GATE_COOKIE) return part.slice(eq + 1).trim();
    }
    return undefined;
  }

  /** 这条请求带着有效票吗 */
  allow(req: IncomingMessage): boolean {
    return this.validCookieValue(this.#cookieOf(req));
  }

  // ----------------------------------------------------------
  //  /login
  // ----------------------------------------------------------

  /**
   * 答一次 `/login`（GET 给表单、POST 验密码）。
   *
   * ⚠️ 密码错时**固定睡 `failDelayMs` 再回** —— 这一条是给「拿本字典狂试」的人
   *   加的常量成本，也是任务书钉死的 500 ms。
   */
  async handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendHtml(res, 200, loginPage(false), req.method === 'HEAD');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD, POST', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }
    const ip = clientIp(req);
    if (!this.tryAttempt(ip)) {
      res.writeHead(429, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': String(Math.ceil(this.#windowMs / 1000)),
      });
      res.end(loginPage(true, '嘗試次數過多，請稍後再試'));
      return;
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/x-www-form-urlencoded') {
      res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }
    const body = await readBody(req, LOGIN_BODY_LIMIT);
    if (body === null) {
      res.writeHead(413, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Payload Too Large');
      return;
    }
    const submitted = new URLSearchParams(body).get('password') ?? '';
    if (!this.#passwordMatches(submitted)) {
      await this.#sleep(this.#failDelayMs);
      sendHtml(res, 401, loginPage(true, '密碼錯誤'));
      return;
    }
    const cookie = [
      `${GATE_COOKIE}=${this.issue()}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${GATE_MAX_AGE_S}`,
      ...(isHttps(req) ? ['Secure'] : []),
    ].join('; ');
    res.writeHead(303, { ...SECURITY_HEADERS, 'Set-Cookie': cookie, Location: '/' });
    res.end();
  }

  /**
   * 密码对不对。
   *
   * ★ 两边**先各自 SHA-256 再比**（任务书 W-71 §2）：摘要定长 32 字节，
   *   于是 `timingSafeEqual` 不会因为长度不同提前返回 —— 连「密码多长」都漏不出去。
   */
  #passwordMatches(submitted: string): boolean {
    const a = createHash('sha256').update(submitted, 'utf8').digest();
    const b = createHash('sha256').update(this.#password, 'utf8').digest();
    return timingSafeEqual(a, b);
  }

  /**
   * 记一次尝试；返回 false = 这一发超了限额。
   *
   * 表是内存里的一张 `Map<IP, {次数, 窗口起点}>`；每分钟清一遍过期的，
   * 条数顶到上限就**整表清空**（宁可放过一轮，也不让表无限长）。
   *
   * ★ 公开（不是 `#`）是有意的：`handleLogin` 只是它众多调用者之一，
   *   单测与将来的监控都要能直接推时间验窗口滚动。
   */
  tryAttempt(ip: string): boolean {
    const now = this.#now();
    if (now - this.#lastSweep >= this.#windowMs) {
      this.#lastSweep = now;
      for (const [key, rec] of this.#attempts) {
        if (now - rec.windowStart >= this.#windowMs) this.#attempts.delete(key);
      }
      if (this.#attempts.size > this.#maxEntries) this.#attempts.clear();
    }
    let rec = this.#attempts.get(ip);
    if (rec === undefined || now - rec.windowStart >= this.#windowMs) {
      rec = { count: 0, windowStart: now };
      this.#attempts.set(ip, rec);
    }
    rec.count += 1;
    return rec.count <= this.#maxAttempts;
  }

  /** 供测试/监控：限流表里现在有几条 */
  get attemptEntries(): number {
    return this.#attempts.size;
  }

  // ----------------------------------------------------------
  //  WebSocket 升级
  // ----------------------------------------------------------

  /**
   * 升级口的闸。返回 false = **已经**把响应写进 socket 并销毁了，调用方别再碰。
   *
   * 两道（任务书 W-71 §4）：
   *   ① 票得有效（`Cookie` 头浏览器会自动带上，和 HTTP 那条同一个）；
   *   ② `Origin` 的**主机名**要等于 `Host` 的主机名 —— 挡跨站 WebSocket 劫持。
   */
  allowUpgrade(req: IncomingMessage, socket: Duplex): boolean {
    if (!this.allow(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return false;
    }
    if (!this.#sameHost(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return false;
    }
    return true;
  }

  /**
   * ★ 比的是**主机名**，不是 `host:port`。
   *
   * 理由：开发时页面在 `localhost:5173`（vite）、WebSocket 直连 `localhost:8787`
   *   —— 端口本来就不同，比 `host` 会把 `tools/net-e2e.js` 这条开发路径也一起拒掉。
   *   而「挡跨站劫持」要的只是**主机名不同就拒**（`evil.example` → `rich4.example`）。
   *   若首席要更严（连端口也比），改 `bareHostname` 这一处即可 —— 见 escalations E-27。
   *
   * `Origin` 缺席一律拒（fail closed）：浏览器发 WebSocket 一定带它，
   *   不带的基本都是脚本客户端 —— 那时候「跨站劫持」这个威胁本来也不成立，
   *   但放行等于给了一个不用 Origin 就能进来的口子，不值。
   */
  #sameHost(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (typeof origin !== 'string' || origin === '') return false;
    if (typeof host !== 'string' || host === '') return false;
    let originHost: string;
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      return false;
    }
    return originHost === bareHostname(host);
  }
}

// ============================================================
//  环境变量
// ============================================================

/**
 * 从环境变量造门。**缺变量就抛**（`cli.ts` 靠这个拒绝启动）。
 *
 * ★ 报错文本里只有**变量名**与用法提示，绝不含任何一个值 —— 哪怕是缺的那个
 *   （它本来就没有值，但保持这条规矩能让「以后多加一个变量」时也不出错）。
 */
export function gateFromEnv(
  env: Record<string, string | undefined>,
  opts: Omit<GateOptions, 'password' | 'cookieSecret'> = {},
): Gate {
  const password = env['RICH4_PASSWORD'];
  if (password === undefined || password === '') {
    throw new Error('缺少環境變數 RICH4_PASSWORD：整站訪問密碼（沒有缺省值，也不許寫進倉庫）');
  }
  const secret = env['RICH4_COOKIE_SECRET'];
  if (secret === undefined || secret === '') {
    throw new Error('缺少環境變數 RICH4_COOKIE_SECRET：簽票用的隨機串（openssl rand -hex 32）');
  }
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(`RICH4_COOKIE_SECRET 太短：至少要 ${MIN_SECRET_BYTES} 位元組（openssl rand -hex 32 給 64 位元組）`);
  }
  return new Gate({ password, cookieSecret: secret, ...opts });
}

// ============================================================
//  小工具
// ============================================================

/**
 * 这个地址是不是「本机」（我们的反代就在本机）。
 *
 * 部署形态见 `docs/deploy.md`：`--host 127.0.0.1` + Caddy 在同一台机器上。
 * IPv6 回环可能是 `::1`，也可能是 v4-mapped 的 `::ffff:127.0.0.1`。
 */
function isLoopback(address: string): boolean {
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.');
}

/**
 * 客户端 IP —— **登录限流按它分桶**。
 *
 * ★★ 首席复核续（DeepSeek）：原来是「`X-Forwarded-For` **最左**一段」。**那一段是客户端
 *   自己写的**：Caddy 是**追加**（`<客户端自带的>, <真实来源>`），所以最左那段攻击者随便填 ——
 *   每次换一个假值就等于每次换一个限流桶，**登录限流（唯一的防爆破手段）形同虚设**。
 *   实测复现（`gate.test.ts` 里那条「伪造 X-Forwarded-For」）。
 *
 * 现在两条：
 *   ① **只认来自回环对端的 `X-Forwarded-For`** —— 直连进来的请求（没起反代）一律用
 *      socket 地址，别的一概不看（否则攻击者又能自己造桶）；
 *   ② 取**最右**一段：那是紧挨着我们的那个反代写进去的。
 *
 * ⚠️ 这与任务书 W-71 §2 写的「最左一段」**相反** —— 见 escalations **E-37**。
 */
export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (!isLoopback(peer)) return peer;
  const raw = req.headers['x-forwarded-for'];
  const text = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof text !== 'string' || text === '') return peer;
  const parts = text.split(',');
  const last = parts[parts.length - 1]?.trim();
  return last !== undefined && last !== '' ? last : peer;
}

/** 经 Caddy 反代进来的 HTTPS 请求 —— `Secure` 只在这种时候加 */
export function isHttps(req: IncomingMessage): boolean {
  const proto = req.headers['x-forwarded-proto'];
  const text = Array.isArray(proto) ? proto[0] : proto;
  return typeof text === 'string' && text.split(',')[0]?.trim().toLowerCase() === 'https';
}

/** `example.com:8787` / `[::1]:8787` / `localhost` → 主机名（小写） */
export function bareHostname(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * 读正文，超 `limit` 返回 null。
 *
 * ⚠️ 先看 `Content-Length` 再收 —— 光靠累加也能挡住（下面也累加），
 *   但提前拒绝可以省掉「先读 100 MB 再报错」。
 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limit) {
      resolve(null);
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      size += c.byteLength;
      if (size > limit) {
        over = true;
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(over ? null : ''));
    req.on('close', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
  });
}

function sendHtml(res: ServerResponse, status: number, body: string, head = false): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(buf.byteLength),
  });
  if (head) res.end();
  else res.end(buf);
}

/**
 * 登录页 —— 一张最朴素的表单，**样式全部内联、没有任何外部资源**
 * （任务书 W-71 §2）。多一个外链就等于多一个能泄密的请求。
 */
export function loginPage(error: boolean, message = '密碼錯誤'): string {
  const err =
    error
      ? `<p style="margin:0 0 14px;color:#ff9d9d;font-size:14px">${escapeHtml(message)}</p>`
      : '';
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>大富翁4 重製版</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f2138;color:#e9eef7;font-family:system-ui,-apple-system,'Noto Sans TC','PingFang TC',sans-serif">
<form method="post" action="/login" style="background:#17304f;border:1px solid #2b4a70;padding:28px 26px;border-radius:10px;min-width:280px;box-shadow:0 8px 28px rgba(0,0,0,.35)">
<h1 style="margin:0 0 18px;font-size:19px;font-weight:600;letter-spacing:1px">大富翁4 重製版</h1>
${err}<label style="display:block;font-size:13px;margin:0 0 6px;color:#a9bcd4" for="password">訪問密碼</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required
 style="width:100%;box-sizing:border-box;padding:9px 10px;font-size:15px;border-radius:6px;border:1px solid #3a5a83;background:#0e2138;color:#e9eef7">
<button type="submit"
 style="width:100%;margin-top:16px;padding:10px;font-size:15px;border:0;border-radius:6px;background:#2f7ad6;color:#fff;cursor:pointer">進入</button>
</form>
</body>
</html>
`;
}

/** 表单里回显的东西一律转义（现在只有固定文案，但规矩先立着） */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
