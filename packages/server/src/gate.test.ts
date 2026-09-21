/*
 * W-71：整站访问密码 —— 票、密码比对、限流、环境变量
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一份只测 `gate.ts` 的纯逻辑（不监听端口）；HTTP 与 WebSocket 那两口的
 *   行为在 `http-server.test.ts` 的「★ 访问密码」一节。
 *
 * ★ 有一条断言是**关于没写出去的东西**的：`gateFromEnv` 的报错文本里
 *   **不许**出现密码。那是任务书 W-71 §1 的红线，必须钉住。
 */

import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
  GATE_COOKIE,
  Gate,
  MIN_SECRET_BYTES,
  bareHostname,
  clientIp,
  gateFromEnv,
  isHttps,
  loginPage,
} from './gate.ts';

const SECRET = 'a'.repeat(MIN_SECRET_BYTES);
const PASSWORD = 'open-sesame-2';

function gate(extra: Partial<ConstructorParameters<typeof Gate>[0]> = {}): Gate {
  return new Gate({ password: PASSWORD, cookieSecret: SECRET, ...extra });
}

/** 只要 `headers` 与 `socket.remoteAddress` 的假请求 */
function req(headers: Record<string, string>, remoteAddress = '10.0.0.9'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe('★ gateFromEnv —— 只从环境变量来，缺了就抛', () => {
  it('两个都在 → 造得出门', () => {
    const g = gateFromEnv({ RICH4_PASSWORD: PASSWORD, RICH4_COOKIE_SECRET: SECRET });
    expect(g).toBeInstanceOf(Gate);
  });

  it('缺 RICH4_PASSWORD → 抛，且文案里点名是哪一个变量', () => {
    expect(() => gateFromEnv({ RICH4_COOKIE_SECRET: SECRET })).toThrow(/RICH4_PASSWORD/);
  });

  it('缺 RICH4_COOKIE_SECRET → 抛，且文案里点名是哪一个变量', () => {
    expect(() => gateFromEnv({ RICH4_PASSWORD: PASSWORD })).toThrow(/RICH4_COOKIE_SECRET/);
  });

  it('空串当作没给（不许有缺省密码）', () => {
    expect(() => gateFromEnv({ RICH4_PASSWORD: '', RICH4_COOKIE_SECRET: SECRET })).toThrow(/RICH4_PASSWORD/);
    expect(() => gateFromEnv({ RICH4_PASSWORD: PASSWORD, RICH4_COOKIE_SECRET: '' })).toThrow(/RICH4_COOKIE_SECRET/);
  });

  it('密钥短于 32 字节 → 抛（文案只提长度，不回显值）', () => {
    const short = 'short-secret';
    let text = '';
    try {
      gateFromEnv({ RICH4_PASSWORD: PASSWORD, RICH4_COOKIE_SECRET: short });
    } catch (err) {
      text = String(err);
    }
    expect(text).toMatch(/太短/);
    expect(text).not.toContain(short);
  });

  it('★ 报错文本里**不许**出现密码', () => {
    let text = '';
    try {
      gateFromEnv({ RICH4_PASSWORD: PASSWORD });
    } catch (err) {
      text = String(err);
    }
    expect(text).not.toBe('');
    expect(text).not.toContain(PASSWORD);
  });
});

describe('★ 票（HMAC cookie）', () => {
  it('签出来的票自己认；值形如 <过期时刻>.<64 位 hex>', () => {
    const g = gate({ now: () => 1_000_000 });
    const ticket = g.issue();
    expect(ticket).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(g.validCookieValue(ticket)).toBe(true);
  });

  it('★★ 首席复核：形状不对的 mac **返回 false，不许抛**（64 个非 ASCII 字符曾让 `timingSafeEqual` 抛）', () => {
    const g = gate({ now: () => 1_000_000 });
    for (const mac of ['é'.repeat(64), '\u00e9'.repeat(32) + 'a'.repeat(32), 'G'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64)]) {
      expect(() => g.validCookieValue(`9999999999999.${mac}`)).not.toThrow();
      expect(g.validCookieValue(`9999999999999.${mac}`)).toBe(false);
    }
  });

  it('★ 篡改一位就拒（签名覆盖的是整份过期时刻）', () => {
    const g = gate({ now: () => 1_000_000 });
    const ticket = g.issue();
    const flip = (i: number): string => {
      const c = ticket[i]!;
      return ticket.slice(0, i) + (c === '0' ? '1' : '0') + ticket.slice(i + 1);
    };
    // 过期时刻那一段、签名那一段，各改一位
    expect(g.validCookieValue(flip(0))).toBe(false);
    const dot = ticket.indexOf('.');
    expect(g.validCookieValue(flip(dot + 3))).toBe(false);
    // 原票仍然有效（改的是副本）
    expect(g.validCookieValue(ticket)).toBe(true);
  });

  it('★ 过期就拒（过期时刻已经过去）', () => {
    let now = 1_000_000;
    const g = gate({ now: () => now });
    const ticket = g.issue();
    expect(g.validCookieValue(ticket)).toBe(true);
    now += 2_592_000 * 1000 + 1; // Max-Age 之后
    expect(g.validCookieValue(ticket)).toBe(false);
  });

  it('换一个密钥签的票不认（别人伪造不了）', () => {
    const a = gate({ now: () => 5_000 });
    const b = new Gate({ password: PASSWORD, cookieSecret: 'b'.repeat(MIN_SECRET_BYTES), now: () => 5_000 });
    expect(b.validCookieValue(a.issue())).toBe(false);
  });

  it('形状不对的一律当无效，不抛', () => {
    const g = gate();
    for (const bad of ['', 'no-dot', '.', '123.', '.abc', 'abc.def', '99999999999999999999.aabb', '12.']) {
      expect(g.validCookieValue(bad), bad).toBe(false);
    }
    expect(g.validCookieValue(undefined)).toBe(false);
  });

  it('非法过期时刻（非整数）拒', () => {
    const g = gate({ now: () => 0 });
    expect(g.validCookieValue('1e9.deadbeef')).toBe(false);
    expect(g.validCookieValue('-1.deadbeef')).toBe(false);
    expect(g.validCookieValue('1.5.deadbeef')).toBe(false);
  });
});

describe('★ 从请求上取票', () => {
  it('Cookie 头里有就用；没有/名字不对/段里没等号都当没有', () => {
    const g = gate({ now: () => 1_000 });
    const ticket = g.issue();
    expect(g.allow(req({ cookie: `${GATE_COOKIE}=${ticket}` }))).toBe(true);
    expect(g.allow(req({ cookie: `other=1; ${GATE_COOKIE}=${ticket}; x=2` }))).toBe(true);
    expect(g.allow(req({ cookie: `other=${ticket}` }))).toBe(false);
    expect(g.allow(req({ cookie: 'flag' }))).toBe(false);
    expect(g.allow(req({}))).toBe(false);
  });
});

describe('★ 限流（每分钟 5 次 POST）', () => {
  it('前 5 次放过，第 6 次挡下', () => {
    let now = 0;
    const g = gate({ now: () => now });
    for (let i = 1; i <= 5; i++) expect(g.tryAttempt('1.1.1.1'), `第 ${i} 次`).toBe(true);
    expect(g.tryAttempt('1.1.1.1')).toBe(false);
    expect(g.tryAttempt('1.1.1.1')).toBe(false);
    // 窗口滑过去就重新算
    now += 60_001;
    expect(g.tryAttempt('1.1.1.1')).toBe(true);
  });

  it('窗口滚动之后重新计数，过期的条目会被清掉', () => {
    let now = 0;
    const g = gate({ now: () => now, windowMs: 1000, maxAttempts: 2 });
    expect(g.tryAttempt('1.1.1.1')).toBe(true);
    expect(g.tryAttempt('1.1.1.1')).toBe(true);
    expect(g.tryAttempt('1.1.1.1')).toBe(false);
    expect(g.attemptEntries).toBe(1);
    now += 1001;
    expect(g.tryAttempt('1.1.1.1')).toBe(true);
    expect(g.attemptEntries).toBe(1);
  });

  it('不同 IP 各算各的', () => {
    const g = gate({ now: () => 0, maxAttempts: 1 });
    expect(g.tryAttempt('1.1.1.1')).toBe(true);
    expect(g.tryAttempt('1.1.1.1')).toBe(false);
    expect(g.tryAttempt('2.2.2.2')).toBe(true);
  });

  it('表顶到上限就整表清空（宁可放过一轮，也不让表无限长）', () => {
    let now = 1;
    const g = gate({ now: () => now, maxEntries: 3, windowMs: 1000 });
    now = 999;
    for (let i = 0; i < 5; i++) g.tryAttempt(`10.0.0.${i}`); // 5 条，都还「新鲜」
    expect(g.attemptEntries).toBe(5);
    now = 1000; // 触发清扫：`windowMs` 到了，但这 5 条一条都没过期
    g.tryAttempt('10.0.0.9');
    expect(g.attemptEntries).toBe(1); // 整表清空，只剩刚加的这一条
  });
});

describe('★ 客户端 IP / HTTPS / 主机名', () => {
  it('★ 首席复核续：X-Forwarded-For 只认**反代（本机）**来的，而且取**最右**一段', () => {
    // 经 Caddy：对端是回环，真实来源被**追加在最右**
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, '127.0.0.1'))).toBe('10.0.0.1');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }, '::1'))).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, '::ffff:127.0.0.1'))).toBe('203.0.113.7');
    // 直连（对端不是回环）：**完全不信** XFF
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }, '198.51.100.9'))).toBe('198.51.100.9');
    // 没有 XFF / 空值 ⇒ 用 socket 地址
    expect(clientIp(req({}, '127.0.0.1'))).toBe('127.0.0.1');
    expect(clientIp(req({ 'x-forwarded-for': '' }, '127.0.0.1'))).toBe('127.0.0.1');
  });

  it('★ 伪造 X-Forwarded-For 换不掉限流桶（原来换得掉 —— 每次换一个假值就是一个新桶）', () => {
    const behindProxy = (v: string): string => clientIp(req({ 'x-forwarded-for': v }, '127.0.0.1'));
    // Caddy 把真实来源追加在最右 ⇒ 假值写多少个都落到同一个桶
    expect(behindProxy('1.1.1.1, 203.0.113.9')).toBe('203.0.113.9');
    expect(behindProxy('2.2.2.2, 203.0.113.9')).toBe('203.0.113.9');
    expect(behindProxy('3.3.3.3, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('Secure 只看 X-Forwarded-Proto', () => {
    expect(isHttps(req({ 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isHttps(req({ 'x-forwarded-proto': 'https, http' }))).toBe(true);
    expect(isHttps(req({ 'x-forwarded-proto': 'http' }))).toBe(false);
    expect(isHttps(req({}))).toBe(false);
  });

  it('主机名解析：带端口 / IPv6 / 大小写', () => {
    expect(bareHostname('rich4.example.com:8787')).toBe('rich4.example.com');
    expect(bareHostname('Rich4.Example.COM')).toBe('rich4.example.com');
    expect(bareHostname('localhost')).toBe('localhost');
    expect(bareHostname('[::1]:8787')).toBe('[::1]');
  });
});

describe('★ 登录页', () => {
  it('一个密码框 + 提交，样式内联，没有任何外部资源', () => {
    const html = loginPage(false);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/login"');
    expect(html).toContain('type="password"');
    expect(html).toContain('name="password"');
    expect(html).toContain('<button type="submit"');
    // 没有外链 —— 多一个外链就多一个能泄密的请求
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('密碼錯誤');
  });

  it('出错时多一行「密碼錯誤」，且文案会被转义', () => {
    expect(loginPage(true)).toContain('密碼錯誤');
    expect(loginPage(true, '<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(loginPage(true, '<b>x</b>')).not.toContain('<b>x</b>');
  });
});
