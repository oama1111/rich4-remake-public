#!/usr/bin/env node
/*
 * 生成佈告欄資料 `packages/client/dist-web/board.json`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ── 什么时候跑 ──────────────────────────────────────────────
 * **每次 `pnpm --filter @rich4/client build` 之后**。`dist-web/` 是 `rsync --delete`
 * 同步到服务器上的，手放进去的文件下次部署就没了 —— 这份 JSON 必须由本脚本现生成。
 *
 * ```
 * pnpm --filter @rich4/client build && node --experimental-strip-types tools/build-board.mjs
 * # 或者：pnpm board   （package.json 里的同名脚本）
 * ```
 *
 * ── 数据从哪来 ──────────────────────────────────────────────
 * · `docs/board/announcement.md` —— 公告正文（手写；**逐字**进 JSON，含换行）；
 * · `docs/board/highlights.md`   —— 亮点（手写；只认以 `- ` 开头的行，最新在前）；
 * · `git log`                    —— 更新日誌（自动；只取**主题行**，见下）。
 *
 * 页面上没有编辑器：需求方把文字发给协调方，协调方改这两个 `.md` 再重跑本脚本。
 *
 * ── 更新日誌的规矩 ──────────────────────────────────────────
 * · 只取主题行 —— 正文、哈希、文件路径、`Co-Authored-By` 一概不进；
 * · 去掉开头 conventional-commit 前缀（`fix(scope): ` / `chore(net): ` / `test: ` …）；
 * · ★ 再去掉 ` -- ` 后面那段**取证尾巴**（`0x0044c0e3 jmp …`）—— 那是给复核者看的，
 *   而这块面板是玩家页面（与手写亮点同一条口径：不要位址、不要内部术语）。
 *   要保留全串（复核用）加 `--keep-evidence`；
 * · 丢掉合并提交；按日期倒序分组，每天一个 ISO 日期；
 * · 上限：`--limit` 条 与 `--days` 个日期，**谁先到算谁**（缺省 60 / 14）。
 *
 * 纯逻辑全在 `packages/client/src/board-data.ts`（与客户端共用同一份判据，也被 vitest 钉住），
 * 本脚本只负责读文件、跑 git、写 JSON。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHANGELOG_DAYS,
  CHANGELOG_LIMIT,
  changelogFromCommits,
  parseAnnouncement,
  parseHighlights,
  readGitLog,
} from '../packages/client/src/board-data.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================
//  参数
// ============================================================

function usage() {
  return [
    '用法：node --experimental-strip-types tools/build-board.mjs [选项]',
    '',
    '  --out <文件>     输出路径（缺省 packages/client/dist-web/board.json）',
    `  --limit <条数>   更新日誌最多收几条（缺省 ${CHANGELOG_LIMIT}）`,
    `  --days <天数>    更新日誌最多收几天（缺省 ${CHANGELOG_DAYS}）`,
    '  --keep-evidence  保留主题行里 ` -- ` 之后的取证尾巴（复核用；玩家页面上不该有）',
    '  --print          只把 JSON 打到标准输出，不写文件',
    '  -h, --help       这份说明',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    out: join(repoRoot, 'packages/client/dist-web/board.json'),
    limit: CHANGELOG_LIMIT,
    days: CHANGELOG_DAYS,
    keepEvidence: false,
    print: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else if (a === '--out') {
      const v = argv[++i];
      if (v === undefined || v === '') throw new Error('--out 缺参数');
      opts.out = resolve(process.cwd(), v);
    } else if (a === '--limit') {
      opts.limit = Number(argv[++i]);
      if (!Number.isInteger(opts.limit) || opts.limit <= 0) throw new Error('--limit 要是正整数');
    } else if (a === '--days') {
      opts.days = Number(argv[++i]);
      if (!Number.isInteger(opts.days) || opts.days <= 0) throw new Error('--days 要是正整数');
    } else if (a === '--keep-evidence') {
      opts.keepEvidence = true;
    } else if (a === '--print') {
      opts.print = true;
    } else {
      throw new Error(`不认识的参数：${a}\n\n${usage()}`);
    }
  }
  return opts;
}

// ============================================================
//  读输入
// ============================================================

function readText(file) {
  if (!existsSync(file)) throw new Error(`缺少文件：${file}`);
  return readFileSync(file, 'utf8');
}

/**
 * `git log` 那一段 —— 拿不到 git（没有 .git、没装 git）不算致命：
 * 手写的公告与亮点照发，只是没有自动那一段，并**明确说出来**。
 */
function readCommits(limit) {
  // 按条数封顶之外还要按天数封顶 ⇒ 得比 limit 多留一些（本仓库一天几十条提交）。
  const n = Math.max(limit * 4, 600);
  try {
    const out = execFileSync(
      'git',
      ['log', '-n', String(n), '--no-merges', '--date=short', '--pretty=format:%ad%x1f%s'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return readGitLog(out);
  } catch (err) {
    process.stderr.write(`⚠ 读不到 git 历史（${err.message.split('\n')[0]}）—— 更新日誌这一节留空\n`);
    return [];
  }
}

/**
 * 公告最后改动的日期。
 *
 * ★ 刻意**不看挂钟**：同一份输入重复跑必须得到同一份 JSON（不然每次构建的产物都不一样，
 *   复核时 diff 一片红）。取「最后一次改动 `docs/board/` 的那个提交的日期」，
 *   拿不到就退回更新日誌里最新的一天，再不行就是空串。
 */
function announcementDate(changelog) {
  try {
    const out = execFileSync('git', ['log', '-1', '--date=short', '--pretty=format:%ad', '--', 'docs/board'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    /* 下面兜底 */
  }
  return changelog[0]?.date ?? '';
}

// ============================================================
//  组装
// ============================================================

export function buildBoard(opts) {
  const announcement = parseAnnouncement(readText(join(repoRoot, 'docs/board/announcement.md')));
  const highlights = parseHighlights(readText(join(repoRoot, 'docs/board/highlights.md')));
  const changelog = changelogFromCommits(readCommits(opts.limit), {
    limit: opts.limit,
    days: opts.days,
    keepEvidence: opts.keepEvidence,
  });
  return {
    announcement: { text: announcement, updatedAt: announcementDate(changelog) },
    highlights,
    changelog,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const data = buildBoard(opts);
  const json = `${JSON.stringify(data, null, 2)}\n`;

  if (!opts.print) {
    // dist-web/ 不在 = 还没构建。**在这里停下**：写进一个没人同步的目录等于这次部署没有佈告欄，
    // 而且事后很难看出来。空目录（构建过但没产物）同样拦。
    const dir = dirname(opts.out);
    if (!existsSync(dir) && !existsSync(join(repoRoot, 'packages/client/dist-web'))) {
      process.stderr.write(
        '✖ packages/client/dist-web 不存在 —— 先跑 `pnpm --filter @rich4/client build` 再生成佈告欄\n' +
          '  （dist-web/ 是 rsync --delete 同步的，手放的 board.json 下次部署就没了）\n',
      );
      process.exit(1);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(opts.out, json, 'utf8');
  } else {
    process.stdout.write(json);
    return;
  }

  const items = data.changelog.reduce((n, d) => n + d.items.length, 0);
  process.stdout.write(
    `✔ ${opts.out}\n` +
      `  公告 ${data.announcement.text.length} 字（改于 ${data.announcement.updatedAt || '未知'}）` +
      `｜亮点 ${data.highlights.length} 条` +
      `｜更新日誌 ${items} 条 / ${data.changelog.length} 天\n`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
