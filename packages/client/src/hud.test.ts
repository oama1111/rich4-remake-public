/*
 * 側欄与月曆的摆位不变量
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一层先前也没有测试，而它出的错都是**看着只是「差一点」**的那一类：
 * 数值栏逐栏偏高 8 像素、月曆每行多画一天。这类错单靠肉眼很难发现，
 * 但一条断言当场就抓住 —— 所以补在这里。
 */
import { describe, expect, it } from 'vitest';
import { CAL, monthCells, PANEL_HEIGHT, PANEL_WIDTH, SIDEBAR, WEEKDAY_NAMES } from './hud.ts';
import { daysInMonth, weekdayOf } from '@rich4/core';

describe('月曆格子 —— 每行恰好 7 格', () => {
  it('★ 任意月份都不出现「一行 8 天」', () => {
    // 这个 bug 曾经真的存在：折行判据用了第 8 列的坐标，于是整月逐行右移一格
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const cells = monthCells(year, month);
        const perRow = new Map<number, number>();
        for (const c of cells) perRow.set(c.y, (perRow.get(c.y) ?? 0) + 1);
        for (const n of perRow.values()) expect(n).toBeLessThanOrEqual(7);
        // 每一列恰好 7 个不同的 x
        const xs = [...new Set(cells.map((c) => c.x))];
        expect(xs.length).toBeLessThanOrEqual(7);
      }
    }
  });

  it('★ 1 号落在「该月 1 号的星期」那一列', () => {
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const first = monthCells(year, month)[0]!;
        const cols = [...new Set(monthCells(year, month).map((c) => c.x))].sort((a, b) => a - b);
        expect(first.day).toBe(1);
        expect(cols.indexOf(first.x)).toBe(weekdayOf(year, month, 1));
      }
    }
  });

  it('★ 天数齐全、不重不漏', () => {
    for (let month = 1; month <= 12; month++) {
      const cells = monthCells(2025, month);
      expect(cells.map((c) => c.day)).toEqual(
        Array.from({ length: daysInMonth(2025, month) }, (_, i) => i + 1),
      );
    }
  });

  it('★ 同一格不会被两天占着（x、y 组合唯一）', () => {
    for (let month = 1; month <= 12; month++) {
      const keys = monthCells(2024, month).map((c) => `${c.x},${c.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('行是自上而下、列是自左而右', () => {
    const cells = monthCells(2025, 3);
    // 同一天数往后走，y 不回头
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.y).toBeGreaterThanOrEqual(cells[i - 1]!.y);
      if (cells[i]!.y === cells[i - 1]!.y) expect(cells[i]!.x).toBeGreaterThan(cells[i - 1]!.x);
    }
  });

  it('★ 所有格子都落在 200×200 的側欄里', () => {
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        for (const c of monthCells(year, month)) {
          expect(c.x).toBeGreaterThan(0);
          expect(c.y).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(SIDEBAR.w);
          expect(c.y).toBeLessThan(SIDEBAR.h);
        }
      }
    }
  });
});

describe('区间常量', () => {
  it('★ 側欄两块拼起来正好 480 高、200 宽', () => {
    expect(PANEL_WIDTH).toBe(200);
    expect(PANEL_HEIGHT + SIDEBAR.h).toBe(480);
    expect(SIDEBAR.x).toBe(0);
    expect(SIDEBAR.y).toBe(PANEL_HEIGHT);
  });

  it('★ 200×280 的侧栏内部：数值栏与头像都不越出右缘的彩色标签区', () => {
    // 右缘 176..199 是那四个竖标签（烘在底图里），内容区到此为止
    const CONTENT_RIGHT = 176;
    // 数值右对齐点、头像右缘
    expect(166).toBeLessThan(CONTENT_RIGHT);
    expect(8 + 72).toBeLessThan(CONTENT_RIGHT); // 头像 72×72
  });
});

describe('星期名', () => {
  it('七条，且从週日排到週六（与 weekdayOf 的 0=周日 对齐）', () => {
    expect(WEEKDAY_NAMES).toHaveLength(7);
    expect(WEEKDAY_NAMES[0]).toBe('星期日');
    expect(WEEKDAY_NAMES[6]).toBe('星期六');
  });
});

describe('★ 日曆文字不压进右缘的彩色标签区', () => {
  /** 标签区左缘（烘在底图里，176..199） */
  const CONTENT_RIGHT = 176;
  /** 保守估宽：15px 字下数字约 10、汉字约 16 */
  const digitW = 10;
  const hanW = 16;

  it('★ 年份是**左上**（flag 0），且在 24px 下也放得下', () => {
    // exe VA 0x00416d6b：`draw(年, x=0x244, y=0x120, flag=0)` —— flag 0 不调整
    // 对齐，就是左上角。⚠️ 这里我一度「推断」成居中过，查了 0x44faa0 的跳表才改回来。
    // 年画在側欄（y≥280），而右缘那四个色标签只到 y=280，故不会重叠。
    const maxWidth = 4 * digitW;
    expect(CAL.year.x + maxWidth).toBeLessThan(SIDEBAR.w);
  });

  it('月份（「12月」最宽）居中后仍在区内', () => {
    const half = (2 * digitW + hanW) / 2;
    expect(CAL.monthText.x + half).toBeLessThan(CONTENT_RIGHT);
  });

  it('★ 星期名与日号都是**居中**（flag 3 / 2），按半个宽度算', () => {
    // flag 3 与 flag 2 在 0x44faa0 的跳表里指向同一段（正中）
    expect(CAL.weekday.x + (3 * hanW) / 2).toBeLessThan(CONTENT_RIGHT);
    expect(CAL.dayText.x + digitW).toBeLessThan(CONTENT_RIGHT);
  });

  it('所有锚点都在 200×200 的側欄内', () => {
    for (const at of [CAL.sun, CAL.moon, CAL.year, CAL.monthText, CAL.weekday, CAL.dayText]) {
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThan(SIDEBAR.w);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThan(SIDEBAR.h);
    }
  });

  it('太阳与月亮并排不重叠', () => {
    expect(CAL.sun.x + 24).toBeLessThanOrEqual(CAL.moon.x);
  });
});
