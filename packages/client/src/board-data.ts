/*
 * 佈告欄的**資料契約**（`/board.json`）—— 客户端解析、`tools/build-board.mjs` 生成，共用同一份
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 左侧佈告欄（公告 + 更新日誌）的内容**不进 640×480 舞台**，是页面上的普通 DOM；
 * 它的数据是一份同源静态 JSON，部署时由 `tools/build-board.mjs` 现生成到
 * `packages/client/dist-web/board.json`（`dist-web/` 是 `--delete` 同步的，
 * 手放进去的文件下次部署就没了 —— 必须由脚本每次生成）。
 *
 * ```jsonc
 * {
 *   "announcement": { "text": "…手写的一段话（可含换行）…", "updatedAt": "2026-09-25" },
 *   "highlights": ["…手写的玩家可读亮点，最新在前…"],
 *   "changelog": [ { "date": "2026-09-25", "items": ["…从 git 主题行洗出来的条目…"] } ]
 * }
 * ```
 *
 * ★ 本模块**只放纯函数**：不碰 DOM、不碰 `fetch`、不碰文件系统 —— 这样
 *   ① 客户端与生成脚本用的是同一套判据（不会一边收一边漏）；
 *   ② 每条规则都能被 vitest 直接钉住（见 `board-data.test.ts`）。
 * ★ 客户端那边**永远**用 `textContent` 写进 DOM（见 `board-panel.ts`），
 *   这份 JSON 里的任何字符都不会被当成 HTML 解析。
 */

/** 同源静态 JSON 的路径（`dist-web/board.json`） */
export const BOARD_JSON_PATH = '/board.json';

/** 公告：一段手写文字 + 它最后一次改动的日期（ISO `YYYY-MM-DD`，没有就是空串） */
export interface BoardAnnouncement {
  readonly text: string;
  readonly updatedAt: string;
}

/** 更新日誌里的一天 */
export interface BoardChangelogDay {
  readonly date: string;
  readonly items: readonly string[];
}

/** `/board.json` 的完整形状 */
export interface BoardData {
  readonly announcement: BoardAnnouncement;
  readonly highlights: readonly string[];
  readonly changelog: readonly BoardChangelogDay[];
}

// ============================================================
//  手写输入（`docs/board/*.md`）
// ============================================================

/**
 * `docs/board/highlights.md` → 亮点条目。
 *
 * 只认**以 `- ` 开头**的行（手写文件里还有标题与说明，那些不该出现在网页上）；
 * 去掉 `- ` 之后是空的行丢掉；行内的换行不存在（一行一条）。
 * 顺序照文件里写的（最新的写在最上面，由写的人负责）。
 */
export function parseHighlights(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*-\s+(.*)$/.exec(line);
    if (m === null) continue;
    const text = (m[1] ?? '').trim();
    if (text !== '') out.push(text);
  }
  return out;
}

/**
 * `docs/board/announcement.md` → 公告正文。
 *
 * ★ 正文**逐字保留**（含换行）—— 需求方怎么写就怎么显示，网页那边 `white-space: pre-wrap`。
 *   只做两件事：丢掉开头的 markdown 标题行（`# …`，那是给写的人看的），
 *   以及把结尾多出来的空行去掉。中间的空行保留（段落间隔）。
 */
export function parseAnnouncement(md: string): string {
  const lines = md.split(/\r?\n/);
  while (lines.length > 0 && /^\s*#/.test(lines[0] ?? '')) lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  return lines.join('\n');
}

// ============================================================
//  git 主题行 → 更新日誌条目
// ============================================================

/** 一条提交（只取日期与主题行 —— 正文 / 哈希 / 作者都不进这份 JSON） */
export interface CommitEntry {
  /** ISO `YYYY-MM-DD`（`git log --date=short`） */
  readonly date: string;
  readonly subject: string;
}

/** 更新日誌最多收多少条 */
export const CHANGELOG_LIMIT = 60;
/** 更新日誌最多收多少个日期分组（`CHANGELOG_LIMIT` 与它谁先到算谁） */
export const CHANGELOG_DAYS = 14;
/** 单条主题行显示到多长（再长就截断加 `…`） */
export const SUBJECT_MAX = 160;

/** 合并提交 —— 一律不进更新日誌（`Merge branch …` / `Merge pull request …` 对玩家没有意义） */
export function isMergeSubject(subject: string): boolean {
  return /^merge\b/i.test(subject.trim());
}

/**
 * 去掉开头的 conventional-commit 前缀（`fix(scope): ` / `chore(net): ` / `docs(audit): ` / `test: ` …），
 * 剩下的就是那句中文。认不出来的前缀原样保留。
 */
export function stripCommitPrefix(subject: string): string {
  return subject.replace(
    /^(?:feat|fix|docs|chore|test|perf|refactor|build|ci|style|revert)(?:\([^)]*\))?!?:\s*/i,
    '',
  );
}

/**
 * 去掉主题行后面那段**取证尾巴**（`… —— 0x0044c0e3 jmp 0x44bf46 …`）。
 *
 * ★ 本仓库的提交约定是 `type(scope): 做了什么 -- 关键证据`，而那半段是给复核者看的
 *   反汇编位址。佈告欄是给玩家看的公开页面（需求方原话：亮点里「不要位址、不要内部术语」），
 *   所以默认砍掉 ` -- ` 之后的一切。想留全（复核用）就传 `keepEvidence: true`。
 */
export function stripEvidenceTail(subject: string): string {
  const at = subject.indexOf(' -- ');
  return at < 0 ? subject : subject.slice(0, at);
}

/** 太长就截断（佈告欄一行放不下那么长） */
export function clipSubject(text: string, max: number = SUBJECT_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** 主题行 → 佈告欄上那一行（去前缀、去取证尾巴、截断、压掉多余空白） */
export function boardItemText(
  subject: string,
  opts: { readonly keepEvidence?: boolean } = {},
): string {
  const stripped = stripCommitPrefix(subject.trim());
  const body = opts.keepEvidence === true ? stripped : stripEvidenceTail(stripped);
  return clipSubject(body.replace(/\s+/g, ' ').trim());
}

/** 日期是不是 ISO `YYYY-MM-DD`（分组键；形状不对的整条丢掉，宁可少一行也不要页面上出乱码） */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * `git log --date=short --pretty=format:%ad%x1f%s` 的输出 → 提交表。
 *
 * `%x1f` = 单元分隔符：主题行里可能有中文括号、`|`、`:`，用制表符 / 空格都不保险。
 * 形状不对的行（没有分隔符、日期不是 ISO）直接丢。
 */
export function readGitLog(raw: string): CommitEntry[] {
  const out: CommitEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf('\u001f');
    if (at < 0) continue;
    const date = line.slice(0, at).trim();
    const subject = line.slice(at + 1).trim();
    if (subject === '' || !isIsoDate(date)) continue;
    out.push({ date, subject });
  }
  return out;
}

/**
 * 提交表 → 按天分组的更新日誌（新到旧）。
 *
 * · 合并提交丢掉；
 * · 按日期**倒序**排（输入本来就是新到旧，同日之内保持原顺序）；
 * · `limit` 条 与 `days` 个日期分组，**谁先到算谁**；
 * · 每天一个 ISO 日期。
 */
export function changelogFromCommits(
  entries: readonly CommitEntry[],
  opts: { readonly limit?: number; readonly days?: number; readonly keepEvidence?: boolean } = {},
): BoardChangelogDay[] {
  const limit = opts.limit ?? CHANGELOG_LIMIT;
  const days = opts.days ?? CHANGELOG_DAYS;
  if (limit <= 0 || days <= 0) return [];

  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const out: { date: string; items: string[] }[] = [];
  let group: { date: string; items: string[] } | null = null;
  let count = 0;
  for (const e of sorted) {
    if (isMergeSubject(e.subject)) continue;
    if (!isIsoDate(e.date)) continue; // 日期形状不对 ⇒ 整条丢掉（分组键就是它，坏了没法显示）
    const text = boardItemText(e.subject, opts.keepEvidence === true ? { keepEvidence: true } : {});
    if (text === '') continue;
    if (group === null || group.date !== e.date) {
      if (out.length >= days) break; // 已经收满 days 个日期
      group = { date: e.date, items: [] };
      out.push(group);
    }
    group.items.push(text);
    count += 1;
    if (count >= limit) break;
  }
  return out;
}

// ============================================================
//  `/board.json` → `BoardData`
// ============================================================

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (text !== '') out.push(text);
  }
  return out;
}

function parseAnnouncementJson(v: unknown): BoardAnnouncement | null {
  const o = asRecord(v);
  if (o === null) return null;
  const text = o['text'];
  if (typeof text !== 'string') return null;
  const updatedAt = o['updatedAt'];
  return { text, updatedAt: typeof updatedAt === 'string' ? updatedAt : '' };
}

function parseChangelogJson(v: unknown): BoardChangelogDay[] | null {
  if (!Array.isArray(v)) return null;
  const out: BoardChangelogDay[] = [];
  for (const item of v) {
    const o = asRecord(item);
    if (o === null) continue;
    const date = o['date'];
    if (typeof date !== 'string' || !isIsoDate(date)) continue;
    const items = stringArray(o['items']);
    if (items === null || items.length === 0) continue;
    out.push({ date, items });
  }
  return out;
}

/**
 * `/board.json` 的原文 → `BoardData`；**任何**不对的地方一律 `null`（调用方据此把整块面板收起来）。
 *
 * 严格的是「形状」：外层得是对象、`announcement.text` 得是字符串、
 * `highlights` / `changelog` 得是数组。数组**里面**不合规矩的条目丢掉而不是整份作废
 * —— 少一行总比玩家看到一页乱码好。
 */
export function parseBoard(text: string): BoardData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const o = asRecord(raw);
  if (o === null) return null;
  const announcement = parseAnnouncementJson(o['announcement']);
  if (announcement === null) return null;
  const highlights = stringArray(o['highlights']);
  if (highlights === null) return null;
  const changelog = parseChangelogJson(o['changelog']);
  if (changelog === null) return null;
  return { announcement, highlights, changelog };
}

/** 这份数据有没有东西可显示（三块全空 ⇒ 面板没必要出现） */
export function hasBoardContent(data: BoardData): boolean {
  return (
    data.announcement.text.trim() !== '' || data.highlights.length > 0 || data.changelog.length > 0
  );
}
