/*
 * 佈告欄的数据契约（`/board.json`）—— 手写解析 / git 主题行清洗 / JSON 校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一层是 `tools/build-board.mjs` 与 `board-panel.ts` **共用**的判据，所以每条规则都在这里钉死：
 *   · 手写文件怎么读（亮点只认 `- ` 行；公告逐字保留）；
 *   · git 主题行怎么洗（去 conventional 前缀、去取证尾巴、丢合并、按天分组、封顶）；
 *   · `/board.json` 怎么校验（坏了就 `null` ⇒ 客户端把整块面板收起来）。
 *
 * ★ 可证伪性：把 `stripEvidenceTail` 去掉、让合并提交进列表、日期分组反序、
 *   `parseBoard` 对坏形状放行 —— 下面都会当场红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHANGELOG_DAYS,
  CHANGELOG_LIMIT,
  BOARD_JSON_PATH,
  boardItemText,
  changelogFromCommits,
  clipSubject,
  hasBoardContent,
  isIsoDate,
  isMergeSubject,
  parseAnnouncement,
  parseBoard,
  parseHighlights,
  readGitLog,
  stripCommitPrefix,
  stripEvidenceTail,
  type CommitEntry,
} from './board-data.ts';

// ============================================================
//  手写输入
// ============================================================

describe('parseHighlights —— `docs/board/highlights.md` 只认 `- ` 行', () => {
  it('标题 / 说明 / 空行都不算条目', () => {
    const md = ['# 更新亮點（手寫）', '', '> 这段说明是给协调方看的', '', '- 第一条', '- 第二条', '', ''].join('\n');
    expect(parseHighlights(md)).toEqual(['第一条', '第二条']);
  });

  it('顺序照文件里写的（最新在前由写的人负责）', () => {
    expect(parseHighlights('- 新\n- 旧')).toEqual(['新', '旧']);
  });

  it('`-` 后面必须有空格；条目内空白压掉；空条目丢掉', () => {
    expect(parseHighlights('-好的\n-   \n-   trimmed  \n  - 缩进也算')).toEqual(['trimmed', '缩进也算']);
  });

  it('空文件 / 没有条目 ⇒ 空数组（不是抛）', () => {
    expect(parseHighlights('')).toEqual([]);
    expect(parseHighlights('# 只有标题\n')).toEqual([]);
  });

  it('★ 仓库里那份真的 highlights.md 至少有一条', () => {
    const md = readFileSync(new URL('../../../docs/board/highlights.md', import.meta.url), 'utf8');
    const items = parseHighlights(md);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // 玩家页面上不该出现位址 / 内部代号
    expect(items.filter((t) => /0x[0-9a-f]{4,}/i.test(t))).toEqual([]);
  });
});

describe('parseAnnouncement —— 公告逐字保留', () => {
  it('开头的 markdown 标题行丢掉，正文（含段落空行）原样', () => {
    expect(parseAnnouncement('# 公告\n\n第一段\n\n第二段\n')).toBe('第一段\n\n第二段');
  });

  it('没有标题也行；结尾多出来的空行去掉', () => {
    expect(parseAnnouncement('只有一段\n\n\n')).toBe('只有一段');
  });

  it('单换行也保留（页面用 white-space: pre-wrap 显示）', () => {
    expect(parseAnnouncement('第一行\n第二行')).toBe('第一行\n第二行');
  });

  it('★ 仓库里那份真的 announcement.md 不是空的', () => {
    const md = readFileSync(new URL('../../../docs/board/announcement.md', import.meta.url), 'utf8');
    expect(parseAnnouncement(md).length).toBeGreaterThan(10);
  });
});

// ============================================================
//  git 主题行
// ============================================================

describe('主题行清洗', () => {
  it('合并提交认得出来', () => {
    expect(isMergeSubject('Merge branch \'ds/x\' into ds/y')).toBe(true);
    expect(isMergeSubject('Merge pull request #12 from x/y')).toBe(true);
    expect(isMergeSubject('merge remote-tracking branch')).toBe(true);
    expect(isMergeSubject('fix(client): 合并两处调用')).toBe(false);
    // 「Merge」开头的普通词不算（`\b` 才认）
    expect(isMergeSubject('Merged the two panels')).toBe(false);
  });

  it('conventional 前缀去掉（fix(scope) / chore(net) / docs(audit) / test: / feat! )', () => {
    expect(stripCommitPrefix('fix(client): 修好了')).toBe('修好了');
    expect(stripCommitPrefix('chore(net): PROTOCOL_VERSION 13 → 14')).toBe('PROTOCOL_VERSION 13 → 14');
    expect(stripCommitPrefix('docs(audit): 全项目遗留问题清单')).toBe('全项目遗留问题清单');
    expect(stripCommitPrefix('test: 删掉临时诊断')).toBe('删掉临时诊断');
    expect(stripCommitPrefix('feat(web)!: 换了入口')).toBe('换了入口');
    // 认不出来的原样留着（宁可多几个字，也不要吃掉正文）
    expect(stripCommitPrefix('订正三处注释')).toBe('订正三处注释');
    expect(stripCommitPrefix('feature(x): 不算')).toBe('feature(x): 不算');
  });

  it('★ 取证尾巴（` -- 0x…`）默认砍掉；要留就得明说', () => {
    const subject = 'fix(client): 命運 1 补上倒霉台词 -- 0x0044c0e3 jmp 0x44bf46 / call 0x451985';
    expect(stripEvidenceTail(subject)).toBe('fix(client): 命運 1 补上倒霉台词');
    expect(boardItemText(subject)).toBe('命運 1 补上倒霉台词');
    expect(boardItemText(subject, { keepEvidence: true })).toContain('0x0044c0e3');
    // 没有尾巴的照旧
    expect(boardItemText('test: 删掉临时诊断')).toBe('删掉临时诊断');
  });

  it('太长就截断（截断处补 `…`）', () => {
    const long = 'x'.repeat(500);
    expect(clipSubject(long, 10)).toBe(`${'x'.repeat(9)}…`);
    expect(clipSubject('短', 10)).toBe('短');
    expect(boardItemText(`fix: ${'y'.repeat(400)}`).length).toBeLessThanOrEqual(160);
  });

  it('连续空白压成一个空格（主题行里的换行 / 制表符不该带进 JSON）', () => {
    expect(boardItemText('fix:  a\t\t b')).toBe('a b');
  });
});

describe('readGitLog —— `%ad\\x1f%s` 的输出', () => {
  it('日期与主题行分开，中文 / 括号 / 竖线都照收', () => {
    const raw = ['2026-09-25\u001ffix(net): 指纹补上位置 | 惡人表', '2026-09-24\u001fdocs: 一份清单'].join('\n');
    expect(readGitLog(raw)).toEqual([
      { date: '2026-09-25', subject: 'fix(net): 指纹补上位置 | 惡人表' },
      { date: '2026-09-24', subject: 'docs: 一份清单' },
    ]);
  });

  it('没有分隔符 / 日期不像日期 / 空主题 —— 整行丢掉', () => {
    expect(readGitLog('乱码一行\n2026-9-5\u001f日期形状不对\n\n')).toEqual([]);
  });

  it('末尾的换行不会造出一条空记录', () => {
    expect(readGitLog('2026-09-25\u001f一条\n')).toHaveLength(1);
  });
});

describe('changelogFromCommits —— 分组、次序、封顶', () => {
  const entries: CommitEntry[] = [
    { date: '2026-09-25', subject: 'fix(client): 25 号第一件' },
    { date: '2026-09-25', subject: 'Merge branch \'a\' into b' },
    { date: '2026-09-25', subject: 'test: 25 号第二件' },
    { date: '2026-09-24', subject: 'docs: 24 号那件' },
    { date: '2026-09-23', subject: 'chore: 23 号那件' },
  ];

  it('丢合并、按天分组、新的在前、天内的次序照旧', () => {
    expect(changelogFromCommits(entries)).toEqual([
      { date: '2026-09-25', items: ['25 号第一件', '25 号第二件'] },
      { date: '2026-09-24', items: ['24 号那件'] },
      { date: '2026-09-23', items: ['23 号那件'] },
    ]);
  });

  it('日期乱序的输入也按日期倒序排', () => {
    const out = changelogFromCommits([
      { date: '2026-09-23', subject: 'a' },
      { date: '2026-09-25', subject: 'b' },
      { date: '2026-09-24', subject: 'c' },
    ]);
    expect(out.map((d) => d.date)).toEqual(['2026-09-25', '2026-09-24', '2026-09-23']);
  });

  it('`limit` 条与 `days` 天谁先到算谁', () => {
    const many: CommitEntry[] = [];
    for (let day = 25; day >= 1; day -= 1) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      many.push({ date, subject: `第 ${day} 天第一件` }, { date, subject: `第 ${day} 天第二件` });
    }
    const byItems = changelogFromCommits(many, { limit: 3, days: 14 });
    expect(byItems).toHaveLength(2); // 3 条 = 两天（2 + 1）
    expect(byItems.reduce((n, d) => n + d.items.length, 0)).toBe(3);

    const byDays = changelogFromCommits(many, { limit: 60, days: 2 });
    expect(byDays.map((d) => d.date)).toEqual(['2026-09-25', '2026-09-24']);
    expect(byDays.reduce((n, d) => n + d.items.length, 0)).toBe(4);
  });

  it('缺省上限就是那两个常量', () => {
    expect(CHANGELOG_LIMIT).toBe(60);
    expect(CHANGELOG_DAYS).toBe(14);
    const many: CommitEntry[] = [];
    for (let i = 0; i < 200; i += 1) many.push({ date: '2026-09-25', subject: `第 ${i} 件` });
    expect(changelogFromCommits(many)).toHaveLength(1);
    expect(changelogFromCommits(many)[0]?.items).toHaveLength(CHANGELOG_LIMIT);
  });

  it('日期形状不对的条目丢掉（宁可少一条，也不要页面上出现乱码）', () => {
    expect(changelogFromCommits([{ date: '昨天', subject: 'a' }])).toEqual([]);
    expect(isIsoDate('2026-09-25')).toBe(true);
    expect(isIsoDate('2026-9-5')).toBe(false);
  });

  it('★ 洗出来的条目里没有哈希、没有文件路径、没有 Co-Authored-By（本仓库真实格式）', () => {
    const raw = [
      '2026-09-25\u001ffix(client): 修好某个面板 -- 0x0044c0e3 jmp 0x44bf46',
      '2026-09-25\u001fMerge branch \'ds/x\' into ds/y',
      '2026-09-25\u001fchore: 收口 -- packages/client/src/main.ts 那一段',
    ].join('\n');
    const out = changelogFromCommits(readGitLog(raw));
    const items = out.flatMap((d) => d.items);
    expect(items).toEqual(['修好某个面板', '收口']);
    for (const t of items) {
      expect(t).not.toMatch(/0x[0-9a-f]{4,}/i);
      expect(t).not.toContain('Co-Authored-By');
      expect(t).not.toContain('/');
      expect(t).not.toMatch(/\b[0-9a-f]{7,40}\b/);
    }
  });
});

// ============================================================
//  `/board.json`
// ============================================================

const GOOD = JSON.stringify({
  announcement: { text: '第一行\n第二行', updatedAt: '2026-09-25' },
  highlights: ['亮点一', '亮点二'],
  changelog: [{ date: '2026-09-25', items: ['条目一'] }],
});

describe('parseBoard —— 坏了就 null（客户端据此收起整块面板）', () => {
  it('路径就是同源的 /board.json', () => {
    expect(BOARD_JSON_PATH).toBe('/board.json');
  });

  it('正常的一份原样解析出来', () => {
    expect(parseBoard(GOOD)).toEqual({
      announcement: { text: '第一行\n第二行', updatedAt: '2026-09-25' },
      highlights: ['亮点一', '亮点二'],
      changelog: [{ date: '2026-09-25', items: ['条目一'] }],
    });
  });

  it('★ 不是 JSON / 是数组 / 是 null ⇒ null', () => {
    expect(parseBoard('')).toBeNull();
    expect(parseBoard('<html>404</html>')).toBeNull();
    expect(parseBoard('[]')).toBeNull();
    expect(parseBoard('null')).toBeNull();
    expect(parseBoard('"一句话"')).toBeNull();
  });

  it('★ 少一块 / 类型不对 ⇒ null', () => {
    expect(parseBoard(JSON.stringify({ highlights: [], changelog: [] }))).toBeNull();
    expect(parseBoard(JSON.stringify({ announcement: { text: 1 }, highlights: [], changelog: [] }))).toBeNull();
    expect(parseBoard(JSON.stringify({ announcement: { text: '' }, highlights: 'x', changelog: [] }))).toBeNull();
    expect(parseBoard(JSON.stringify({ announcement: { text: '' }, highlights: [], changelog: {} }))).toBeNull();
  });

  it('`updatedAt` 缺了 / 不是字符串 ⇒ 空串（日期那一行不显示而已）', () => {
    expect(parseBoard(JSON.stringify({ announcement: { text: '公告' }, highlights: [], changelog: [] }))).toEqual({
      announcement: { text: '公告', updatedAt: '' },
      highlights: [],
      changelog: [],
    });
    const weird = parseBoard(
      JSON.stringify({ announcement: { text: '公告', updatedAt: 20260925 }, highlights: [], changelog: [] }),
    );
    expect(weird?.announcement.updatedAt).toBe('');
  });

  it('数组里面不合规矩的**条目**丢掉，不牵连整份', () => {
    const data = parseBoard(
      JSON.stringify({
        announcement: { text: '公告', updatedAt: '2026-09-25' },
        highlights: ['好的', 42, '', '  另一个  '],
        changelog: [
          { date: '2026-09-25', items: ['a', null, 'b'] },
          { date: '昨天', items: ['日期形状不对'] },
          { date: '2026-09-24', items: [] },
          '不是对象',
        ],
      }),
    );
    expect(data?.highlights).toEqual(['好的', '另一个']);
    expect(data?.changelog).toEqual([{ date: '2026-09-25', items: ['a', 'b'] }]);
  });

  it('三块全空 ⇒ `hasBoardContent` 假（面板没必要出现）', () => {
    const empty = parseBoard(JSON.stringify({ announcement: { text: '  ' }, highlights: [], changelog: [] }));
    expect(empty).not.toBeNull();
    expect(hasBoardContent(empty!)).toBe(false);
    const full = parseBoard(GOOD);
    expect(hasBoardContent(full!)).toBe(true);
  });

  it('★ 生成脚本写出来的那一份（真的跑一遍 build-board）能通过校验', () => {
    // 与 tools/build-board.mjs 同一套纯函数拼一份，形状必须与 parseBoard 对得上
    const data = {
      announcement: { text: parseAnnouncement('# 公告\n\n正文'), updatedAt: '2026-09-25' },
      highlights: parseHighlights('- 亮点'),
      changelog: changelogFromCommits([{ date: '2026-09-25', subject: 'fix: 一条' }]),
    };
    const round = parseBoard(JSON.stringify(data, null, 2));
    expect(round).toEqual(data);
    expect(hasBoardContent(round!)).toBe(true);
  });
});
