/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 道具发放 —— 以 give_tool（VA 0x00445a4d）为准
 */

import { describe, expect, it } from 'vitest';
import { TOOLS } from '@rich4/data';
import {
  MAX_TOOL_COUNT,
  MAX_TOOL_ID,
  STARTING_TOOLS,
  STOCKED_TOOL_MAX_ID,
  TOOL_SLOTS_PER_PLAYER,
  emptyTools,
  giveTool,
  toolCount,
  toolsOf,
} from './tools.ts';

const stock = (n = 99) => new Array<number>(MAX_TOOL_ID + 1).fill(n);

describe('★ 槽位是 15/人，不是 13', () => {
  it('道具编号 1..13，槽 0 与 14 不用', () => {
    expect(TOOL_SLOTS_PER_PLAYER).toBe(15);
    expect(TOOLS).toHaveLength(13);
    expect(Math.max(...TOOLS.map((t) => t.id))).toBe(MAX_TOOL_ID);
  });

  it('★ 13 号核子飛彈能正常寻址——按 13 长度会越界', () => {
    const r = giveTool(emptyTools(4), stock(), 3, 13);
    expect(r.given).toBe(true);
    expect(toolCount(r.tools, 3, 13)).toBe(1);
  });

  it('不同玩家互不干扰', () => {
    let t = emptyTools(4);
    t = giveTool(t, stock(), 0, 5).tools;
    expect(toolCount(t, 0, 5)).toBe(1);
    expect(toolCount(t, 1, 5)).toBe(0);
  });
});

describe('★ 每种道具上限 9', () => {
  it('发到 9 个就不再发', () => {
    let t = emptyTools(2);
    let s = stock();
    for (let i = 0; i < 12; i++) {
      const r = giveTool(t, s, 0, 9); // 9 号不受库存限制
      t = r.tools;
      s = r.stock;
    }
    expect(toolCount(t, 0, 9)).toBe(MAX_TOOL_COUNT);
  });

  it('★ 已满时不白白消耗库存——上限检查在扣库存之前', () => {
    let t = emptyTools(2);
    let s = stock(50);
    for (let i = 0; i < 9; i++) {
      const r = giveTool(t, s, 0, 1);
      t = r.tools;
      s = r.stock;
    }
    const before = s[1]!;
    const r = giveTool(t, s, 0, 1); // 第 10 次
    expect(r.given).toBe(false);
    expect(r.stock[1]).toBe(before); // 库存没动
  });
});

describe('★ 编号 ≤ 8 才受全局库存限制', () => {
  it('库存为 0 时发不出来', () => {
    const s = stock(0);
    expect(giveTool(emptyTools(2), s, 0, 3).given).toBe(false);
  });

  it('发一个扣一个', () => {
    const r = giveTool(emptyTools(2), stock(5), 0, 3);
    expect(r.stock[3]).toBe(4);
  });

  it('★ 编号 > 8 不查库存——库存为 0 也照发', () => {
    expect(STOCKED_TOOL_MAX_ID).toBe(8);
    const s = stock(0);
    expect(giveTool(emptyTools(2), s, 0, 9).given).toBe(true);
    expect(giveTool(emptyTools(2), s, 0, 13).given).toBe(true);
  });

  it('边界：8 查库存，9 不查', () => {
    const s = stock(0);
    expect(giveTool(emptyTools(2), s, 0, 8).given).toBe(false);
    expect(giveTool(emptyTools(2), s, 0, 9).given).toBe(true);
  });
});

describe('开局道具', () => {
  it('★ 是 機器娃娃/路障/地雷/定時炸彈', () => {
    expect(STARTING_TOOLS).toEqual([1, 2, 3, 4]);
    const names = STARTING_TOOLS.map((id) => TOOLS.find((t) => t.id === id)?.name);
    expect(names).toEqual(['機器娃娃', '路障', '地雷', '定時炸彈']);
  });
});

describe('越界编号', () => {
  it('0 与 14 都不发', () => {
    expect(giveTool(emptyTools(2), stock(), 0, 0).given).toBe(false);
    expect(giveTool(emptyTools(2), stock(), 0, 14).given).toBe(false);
  });
});

describe('toolsOf', () => {
  it('只列非零项', () => {
    let t = emptyTools(2);
    t = giveTool(t, stock(), 1, 2).tools;
    t = giveTool(t, stock(), 1, 2).tools;
    t = giveTool(t, stock(), 1, 7).tools;
    expect([...toolsOf(t, 1).entries()].sort((a, b) => a[0] - b[0])).toEqual([[2, 2], [7, 1]]);
    expect(toolsOf(t, 0).size).toBe(0);
  });
});
