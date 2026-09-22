/*
 * 一键回报收件箱（`feedback.ts`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEEDBACK_PATH, FeedbackInbox, feedbackFileName, parseReport, type FeedbackFs } from './feedback.ts';
import { createHttpHandler } from './http-server.ts';
import { GATE_COOKIE, Gate } from './gate.ts';

/** 假文件系统：只记账 */
function fakeFs(initial: string[] = []): FeedbackFs & { files: Map<string, string>; removed: string[] } {
  const files = new Map<string, string>(initial.map((f) => [f, '{}']));
  const removed: string[] = [];
  return {
    files,
    removed,
    mkdir: () => undefined,
    write: (file, text) => files.set(file.split('/').pop()!, text),
    remove: (file) => {
      removed.push(file.split('/').pop()!);
      files.delete(file.split('/').pop()!);
    },
    list: () => [...files.keys()],
  };
}

const REPORT = JSON.stringify({ version: 1, reason: 'manual', note: '踩空地没框', trail: [], env: { player: '小明' } });

describe('feedbackFileName', () => {
  it('UTC 时刻 + 原因 + 玩家名；名字里的怪字符换掉、最长 16 个字', () => {
    const d = new Date('2026-09-22T03:04:05.678Z');
    expect(feedbackFileName(d, 'manual', '小明')).toBe('20260922-030405678-manual-小明.json');
    expect(feedbackFileName(d, 'error', '../../etc passwd')).toBe('20260922-030405678-error-______etc_passwd.json');
    expect(feedbackFileName(d, 'WEIRD reason!', '')).toBe('20260922-030405678-unknown-anon.json');
    expect(feedbackFileName(d, 'stall', 'x'.repeat(40))).toBe(`20260922-030405678-stall-${'x'.repeat(16)}.json`);
  });
});

describe('parseReport', () => {
  it('不是 JSON / 不是对象 / 缺字段 ⇒ 400；像报告 ⇒ ok', () => {
    expect(parseReport('nope')).toMatchObject({ ok: false, status: 400 });
    expect(parseReport('[1]')).toMatchObject({ ok: false, status: 400 });
    expect(parseReport('{"version":1}')).toMatchObject({ ok: false, status: 400 });
    expect(parseReport(REPORT)).toMatchObject({ ok: true });
  });
});

describe('FeedbackInbox', () => {
  it('收下 ⇒ 落盘，env 里补 receivedAt / from，其余原样', () => {
    const fs = fakeFs();
    const inbox = new FeedbackInbox({ dir: '/fb', fs, now: () => Date.parse('2026-09-22T03:04:05.678Z') });
    const r = inbox.accept('203.0.113.9', REPORT);
    expect(r).toEqual({ ok: true, file: '20260922-030405678-manual-小明.json' });
    const stored = JSON.parse(fs.files.get('20260922-030405678-manual-小明.json')!);
    expect(stored.note).toBe('踩空地没框');
    expect(stored.env).toMatchObject({ player: '小明', from: '203.0.113.9', receivedAt: '2026-09-22T03:04:05.678Z' });
  });

  it('同一毫秒两份 ⇒ 第二份加序号，不覆盖', () => {
    const fs = fakeFs();
    const inbox = new FeedbackInbox({ dir: '/fb', fs, now: () => 1_000_000 });
    const a = inbox.accept('x', REPORT);
    const b = inbox.accept('x', REPORT);
    expect(a.ok && b.ok && a.file !== b.file).toBe(true);
    expect(fs.files.size).toBe(2);
  });

  it('限流：同一来源一分钟 20 份，第 21 份 429；别的来源不受影响；窗口滚过恢复', () => {
    let now = 0;
    const inbox = new FeedbackInbox({ dir: '/fb', fs: fakeFs(), now: () => now });
    for (let i = 0; i < 20; i++) expect(inbox.accept('a', REPORT).ok).toBe(true);
    expect(inbox.accept('a', REPORT)).toMatchObject({ ok: false, status: 429 });
    expect(inbox.accept('b', REPORT).ok).toBe(true);
    now = 60_000;
    expect(inbox.accept('a', REPORT).ok).toBe(true);
  });

  it('只留最近 keep 份（已有的也算）；超大正文 413；坏正文 400', () => {
    const fs = fakeFs(['0001.json', '0002.json']);
    let now = 1;
    const inbox = new FeedbackInbox({ dir: '/fb', fs, now: () => now++, keep: 3 });
    expect(inbox.count).toBe(2);
    inbox.accept('a', REPORT);
    inbox.accept('a', REPORT);
    expect(inbox.count).toBe(3);
    expect(fs.removed).toEqual(['0001.json']);
    expect(inbox.accept('a', 'x'.repeat(8 * 1024 * 1024 + 1))).toMatchObject({ ok: false, status: 413 });
    expect(inbox.accept('a', 'not json')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('POST /api/feedback（真 http.Server）', () => {
  const leftovers: { close(): void }[] = [];
  const dirs: string[] = [];
  const cleanup = (): void => {
    for (const l of leftovers.splice(0)) l.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  };

  function serve(opts: { feedback?: FeedbackInbox; gate?: Gate }): Promise<number> {
    const assets = mkdtempSync(join(tmpdir(), 'rich4-fb-assets-'));
    dirs.push(assets);
    const server = createServer(createHttpHandler({ assetDir: assets, ...opts }));
    leftovers.push({
      close: () => {
        server.closeAllConnections();
        server.close();
      },
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
  }

  function post(port: number, body: string, headers: Record<string, string> = {}, method = 'POST'): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: FEEDBACK_PATH, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('没配收件箱 ⇒ 404；配了 ⇒ 201 并回文件名；GET ⇒ 405；坏正文 ⇒ 400', async () => {
    try {
      const p0 = await serve({});
      expect((await post(p0, REPORT)).status).toBe(404);

      const dir = mkdtempSync(join(tmpdir(), 'rich4-fb-'));
      dirs.push(dir);
      const inbox = new FeedbackInbox({ dir });
      const p1 = await serve({ feedback: inbox });
      const ok = await post(p1, REPORT);
      expect(ok.status).toBe(201);
      expect(JSON.parse(ok.body).file).toMatch(/-manual-小明\.json$/);
      expect(inbox.count).toBe(1);
      expect((await post(p1, '', {}, 'GET')).status).toBe(405); // （带正文的 GET 会被 Node 的解析器直接 400，与我们无关）
      expect((await post(p1, 'nope')).status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it('★ 门在外面：没票 ⇒ 401，一份都不落盘；带票 ⇒ 201', async () => {
    try {
      const dir = mkdtempSync(join(tmpdir(), 'rich4-fb-'));
      dirs.push(dir);
      const inbox = new FeedbackInbox({ dir });
      const gate = new Gate({ password: 'pw', cookieSecret: 'k'.repeat(32), now: () => 1_000_000 });
      const port = await serve({ feedback: inbox, gate });
      expect((await post(port, REPORT)).status).toBe(401);
      expect(inbox.count).toBe(0);
      expect((await post(port, REPORT, { Cookie: `${GATE_COOKIE}=${gate.issue()}` })).status).toBe(201);
      expect(inbox.count).toBe(1);
    } finally {
      cleanup();
    }
  });
});
