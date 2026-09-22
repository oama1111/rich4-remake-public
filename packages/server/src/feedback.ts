/*
 * 一键回报（`POST /api/feedback`）—— 把客户端的飞行记录仪报告落到服务器磁盘
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-22：试玩的朋友点左下角的按钮就能上报，我定期从服务器拉回来看。
 * 报告的**内容**由客户端的 `flight-recorder.ts` 定（起点快照 + 之后每条 action + 最后 120 行日志 +
 * 截图），本文件只管**收**：校验、限流、落盘。`tools/replay-report.ts` 能重放这里存下的每一份。
 *
 * ★ 门在外面：这条路由与其它路由一样先过 W-71 的 cookie 门；没登录的人打不到它。
 * ★ 不信任正文：只要求「是个 JSON 对象、有 `version` / `reason` / `trail`」，其余原样落盘 ——
 *   服务器不解释报告，解释是拉回来之后 `replay-report.ts` 的事。
 */

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FEEDBACK_PATH = '/api/feedback';
/** 正文上限：截图（640×480 PNG base64 ≈ 数百 KB）+ 起点快照 + 轨迹 —— 8 MiB 绰绰有余 */
export const FEEDBACK_BODY_LIMIT = 8 * 1024 * 1024;
/** 同一来源每分钟最多几份（点着玩的人也刷不爆磁盘） */
export const FEEDBACK_MAX_PER_MIN = 20;
/** 磁盘上最多留多少份；超了删最老的（一份 ≤ 8 MiB ⇒ 上限约 4 GB，实际远小于此） */
export const FEEDBACK_KEEP = 500;

/** 落盘用的那几个文件系统操作 —— 单测注入假的 */
export interface FeedbackFs {
  mkdir(dir: string): void;
  write(file: string, text: string): void;
  remove(file: string): void;
  list(dir: string): string[];
}

export type FeedbackReject = { ok: false; status: 400 | 413 | 429; message: string };
export type FeedbackAccept = { ok: true; file: string };

/** 报告里我们**要看一眼**的那几个字段 —— 只用来起文件名与拒绝明显不是报告的东西 */
interface ReportShape {
  version?: unknown;
  reason?: unknown;
  trail?: unknown;
  note?: unknown;
  env?: Record<string, unknown>;
}

/**
 * 文件名：`<UTC 时刻>-<原因>-<玩家名>.json`。
 *
 * 玩家名只留字母数字与中日韩文字（其余换成 `_`），最长 16 个字符 —— 文件名里不许有路径分隔符、
 * 控制字符、空白。时刻精确到毫秒，同一毫秒两份就给后面那份加序号（`写入`那一层保证）。
 */
export function feedbackFileName(now: Date, reason: string, player: string): string {
  const ts = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '$1');
  const r = /^[a-z]{1,10}$/.test(reason) ? reason : 'unknown';
  const p = [...player.replace(/[^\p{L}\p{N}_-]/gu, '_')].slice(0, 16).join('') || 'anon';
  return `${ts}-${r}-${p}.json`;
}

/** 正文是不是一份能收的报告；是就返回解析后的对象 */
export function parseReport(body: string): { ok: true; report: ReportShape } | FeedbackReject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, message: '不是 JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, message: '不是 JSON 对象' };
  }
  const r = parsed as ReportShape;
  if (typeof r.version !== 'number' || typeof r.reason !== 'string' || !Array.isArray(r.trail)) {
    return { ok: false, status: 400, message: '缺 version / reason / trail —— 不是飞行记录仪的报告' };
  }
  return { ok: true, report: r };
}

/**
 * 收件箱：限流 + 落盘 + 只留最近 `keep` 份。
 *
 * 时钟与文件系统都可注入（单测不碰真盘、不真睡）。
 */
export class FeedbackInbox {
  readonly #dir: string;
  readonly #now: () => number;
  readonly #keep: number;
  readonly #maxPerMin: number;
  readonly #attempts = new Map<string, { count: number; windowStart: number }>();
  readonly #files: string[] = [];
  readonly #fs: FeedbackFs;

  constructor(opts: {
    dir: string;
    now?: () => number;
    keep?: number;
    maxPerMin?: number;
    fs?: FeedbackFs;
  }) {
    this.#dir = opts.dir;
    this.#now = opts.now ?? (() => Date.now());
    this.#keep = opts.keep ?? FEEDBACK_KEEP;
    this.#maxPerMin = opts.maxPerMin ?? FEEDBACK_MAX_PER_MIN;
    this.#fs = opts.fs ?? realFs;
    this.#fs.mkdir(this.#dir);
    // 已有的报告也算进「最多留几份」
    for (const f of this.#fs.list(this.#dir).filter((f) => f.endsWith('.json')).sort()) this.#files.push(f);
  }

  /** 这一份收不收；收下返回文件名 */
  accept(from: string, body: string): FeedbackAccept | FeedbackReject {
    if (Buffer.byteLength(body, 'utf8') > FEEDBACK_BODY_LIMIT) {
      return { ok: false, status: 413, message: '报告太大' };
    }
    if (!this.#allow(from)) return { ok: false, status: 429, message: '一分钟内上报太多，稍后再试' };
    const parsed = parseReport(body);
    if (!parsed.ok) return parsed;
    const env = parsed.report.env ?? {};
    const player = typeof env['player'] === 'string' ? env['player'] : 'anon';
    let name = feedbackFileName(new Date(this.#now()), parsed.report.reason as string, player);
    // 同一毫秒两份：后面那份加序号
    let n = 1;
    while (this.#files.includes(name)) name = name.replace(/(\.\d+)?\.json$/, `.${n++}.json`);
    // 原样落盘，只补两个字段进 env（`replay-report.ts` 读的是 base / trail / finalState，不看它们）
    const stored = { ...parsed.report, env: { ...env, receivedAt: new Date(this.#now()).toISOString(), from } };
    this.#fs.write(join(this.#dir, name), JSON.stringify(stored));
    this.#files.push(name);
    while (this.#files.length > this.#keep) {
      const old = this.#files.shift()!;
      this.#fs.remove(join(this.#dir, old));
    }
    return { ok: true, file: name };
  }

  /** 磁盘上现在有几份（测试 / 监控） */
  get count(): number {
    return this.#files.length;
  }

  #allow(from: string): boolean {
    const now = this.#now();
    let rec = this.#attempts.get(from);
    if (rec === undefined || now - rec.windowStart >= 60_000) {
      rec = { count: 0, windowStart: now };
      this.#attempts.set(from, rec);
    }
    rec.count += 1;
    if (this.#attempts.size > 10_000) this.#attempts.clear();
    return rec.count <= this.#maxPerMin;
  }
}

const realFs: FeedbackFs = {
  mkdir: (dir) => mkdirSync(dir, { recursive: true, mode: 0o750 }),
  write: (file, text) => writeFileSync(file, text, { mode: 0o640 }),
  remove: (file) => {
    try {
      unlinkSync(file);
    } catch {
      /* 已经不在了 */
    }
  },
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
};
