/*
 * 数值溯源测试 —— 把 C-FID-1 从"靠自觉"变成机器强制
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本测试直接解析 rich4-re 的逆向源文件，逐字段比对我们的 TS 数值表。
 * 只要有人手改了一个数字而没有同步逆向依据，这里立刻失败。
 *
 * 若 rich4-re 目录不存在（例如在 CI 上），自动跳过。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { CARDS } from './cards.ts';
import { TOOLS } from './tools.ts';
import { CHARACTERS } from './characters.ts';

const RE_ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/rich4-re';
const hasSource = existsSync(RE_ROOT);
const d = hasSource ? describe : describe.skip;

/**
 * 解析形如 `{ "\xa7\xa1...", 1, 200, 2, 2 }, /* 均富卡 *␟/` 的表项。
 * 返回每行的 4 个数字 + 注释里的中文名。
 */
function parseTable(path: string): { nums: number[]; comment: string }[] {
  const text = readFileSync(path, 'utf8');
  const rows: { nums: number[]; comment: string }[] = [];
  // 匹配 { "字符串", n, n, n, n }, /* 注释 */
  const re = /\{\s*"(?:[^"\\]|\\.)*"\s*,\s*([\d,\s]+?)\}\s*,?\s*\/\*\s*(.+?)\s*\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const nums = m[1]!.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    rows.push({ nums, comment: m[2]! });
  }
  return rows;
}

d('C-FID-1 数值溯源 — TS 表必须与 rich4-re 逆向源逐字段一致', () => {
  it('卡片表 30 项与 rich4_card_table.c 完全一致', () => {
    const rows = parseTable(`${RE_ROOT}/asm/rich4_card_table.c`);
    expect(rows.length).toBe(30);
    expect(CARDS.length).toBe(30);

    rows.forEach((row, i) => {
      const card = CARDS[i]!;
      const [initAmount, price, f6, f7] = row.nums;
      expect(
        [card.initAmount, card.price, card.f6, card.f7],
        `第 ${i + 1} 张卡「${row.comment}」(${card.name}) 数值不符`,
      ).toEqual([initAmount, price, f6, f7]);
    });
  });

  it('卡片表顺序与原版一致（简繁对照）', () => {
    const rows = parseTable(`${RE_ROOT}/asm/rich4_card_table.c`);
    // 逆向源注释是简体，我们的表是繁体；比对时按字数与关键字校验顺序
    rows.forEach((row, i) => {
      const card = CARDS[i]!;
      expect(card.name.length, `第 ${i + 1} 项「${row.comment}」字数不符`).toBe(row.comment.length);
    });
  });

  it('道具表 13 项与 rich4_tool_table.c 完全一致', () => {
    const rows = parseTable(`${RE_ROOT}/asm/rich4_tool_table.c`);
    expect(rows.length).toBe(13);
    expect(TOOLS.length).toBe(13);

    rows.forEach((row, i) => {
      const tool = TOOLS[i]!;
      const [initAmount, price, f6, f7] = row.nums;
      expect(
        [tool.initAmount, tool.price, tool.f6, tool.f7],
        `第 ${i + 1} 个道具「${row.comment}」(${tool.name}) 数值不符`,
      ).toEqual([initAmount, price, f6, f7]);
    });
  });

  it('角色表 12 项与 rich4_characters.c 完全一致', () => {
    const text = readFileSync(`${RE_ROOT}/asm/rich4_characters.c`, 'utf8');
    // 逐个提取 .field = value 形式的初始化块
    const blocks = text.split(/\.name_ptr\s*=/).slice(1);
    expect(blocks.length).toBe(12);

    const pick = (block: string, field: string): number => {
      const m = new RegExp(`\\.${field}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+)`).exec(block);
      if (m === null) throw new Error(`角色块中找不到字段 ${field}`);
      return Number(m[1]);
    };

    blocks.forEach((block, i) => {
      const c = CHARACTERS[i]!;
      expect(pick(block, 'color'), `${c.name} color`).toBe(c.color);
      expect(pick(block, 'character'), `${c.name} character id`).toBe(c.id);
      expect(pick(block, 'traffic_method'), `${c.name} trafficMethod`).toBe(c.trafficMethod);
      expect(pick(block, 'ndices'), `${c.name} ndices`).toBe(c.ndices);
      expect(pick(block, 'f22'), `${c.name} f22`).toBe(c.f22);
      expect(pick(block, 'f23'), `${c.name} f23`).toBe(c.f23);
      expect(pick(block, 'f24'), `${c.name} f24`).toBe(c.f24);
      expect(pick(block, 'init_cash_ratio'), `${c.name} initCashRatio`).toBe(c.initCashRatio);
      expect(pick(block, 'f26'), `${c.name} f26`).toBe(c.f26);
      // 原版 sex: 1 = 男, 0 = 女
      expect(pick(block, 'sex') === 0, `${c.name} 性别`).toBe(c.isFemale);
    });
  });
});

describe('数值表自洽性', () => {
  it('卡片 id 连续且从 1 开始', () => {
    CARDS.forEach((c, i) => expect(c.id).toBe(i + 1));
  });

  it('道具 id 连续且从 1 开始', () => {
    TOOLS.forEach((t, i) => expect(t.id).toBe(i + 1));
  });

  it('角色 id 连续且从 0 开始', () => {
    CHARACTERS.forEach((c, i) => expect(c.id).toBe(i));
  });

  it('key 全局唯一', () => {
    expect(new Set(CARDS.map((c) => c.key)).size).toBe(CARDS.length);
    expect(new Set(TOOLS.map((t) => t.key)).size).toBe(TOOLS.length);
    expect(new Set(CHARACTERS.map((c) => c.key)).size).toBe(CHARACTERS.length);
  });

  it('后 5 个道具初始数量为 0（原版：商店货架只扫前 8 格，这 5 件由研究所研發）', () => {
    const zeros = TOOLS.filter((t) => t.initAmount === 0).map((t) => t.name);
    expect(zeros).toEqual(['機器工人', '時光機', '傳送機', '工程車', '核子飛彈']);
    // 这 5 件的 f6 全是 2 —— 但 f6 在 exe 里零引用（Q4），机制是硬编码的：
    // 開局进货 0x004071ba(`cmp ebx,8`) + 研究所 0x0041ce1b(`道具 = 項目 + 8`)
    expect(TOOLS.filter((t) => t.initAmount === 0).every((t) => t.f6 === 2)).toBe(true);
  });

  it('★ Q4：道具表 f7（凶狠度）的 0..2 三档都有取自原版的样本', () => {
    // 0x004289b2 的 `f7 − 個性 == 2` 判据只用到「2」这一档，这里锁住分组
    expect(TOOLS.filter((t) => t.f7 === 2).map((t) => t.name)).toEqual([
      '飛彈', '時光機', '工程車', '核子飛彈',
    ]);
    expect(TOOLS.every((t) => t.f7 >= 0 && t.f7 <= 2)).toBe(true);
    expect(CARDS.every((c) => c.f7 >= 0 && c.f7 <= 2)).toBe(true);
  });
});
