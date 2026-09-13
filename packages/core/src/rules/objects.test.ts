/*
 * 地图物件系统验证 —— 基准为 rich4.exe 的数据表与反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  OBJECT_TYPE_TABLE, OBJECT_COUNT, OBJECT_ENTRY_SIZE,
  DISPELLABLE_TYPES, objectTypeOf, canDispel,
} from './objects.ts';

const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';

describe('物件类型表', () => {
  it('46 项，每项 24 字节（0x450 / 46）', () => {
    expect(OBJECT_COUNT).toBe(46);
    expect(OBJECT_ENTRY_SIZE).toBe(24);
    expect(OBJECT_COUNT * OBJECT_ENTRY_SIZE).toBe(0x450);
    expect(OBJECT_TYPE_TABLE.length).toBe(46);
  });

  it('★ 三段结构：唯一物件 / 类型15两个 / 类型16-18各十个', () => {
    // 下标 0..13 → 类型 1..14，各一个
    for (let i = 0; i < 14; i++) expect(OBJECT_TYPE_TABLE[i]).toBe(i + 1);
    // 类型 15 两个
    expect(OBJECT_TYPE_TABLE.filter((t) => t === 15).length).toBe(2);
    // 类型 16/17/18 各十个
    for (const t of [16, 17, 18]) {
      expect(OBJECT_TYPE_TABLE.filter((x) => x === t).length).toBe(10);
    }
  });

  it('objectTypeOf 越界返回 0', () => {
    expect(objectTypeOf(0)).toBe(1);
    expect(objectTypeOf(45)).toBe(18);
    expect(objectTypeOf(99)).toBe(0);
  });
});

describe.skipIf(!existsSync(EXE))('★ 与 rich4.exe 的二进制表逐项比对', () => {
  it('VA 0x0047ed3c 的 46 字节与 TS 表完全一致', () => {
    const exe = readFileSync(EXE);
    const off = 398848 + (0x47ed3c - 0x463000);
    for (let i = 0; i < 46; i++) {
      expect(exe[off + i], `下标 ${i}`).toBe(OBJECT_TYPE_TABLE[i]);
    }
  });
});

describe('送神符的可送走类型', () => {
  it('★ 类型集合 = {5,6,7,8,10,15}', () => {
    // @source cmp eax,5 / 6 / 7 / 8 / 0xa / 0xf
    expect([...DISPELLABLE_TYPES].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 10, 15]);
  });

  it('★ 财神（类型 1、2）不可被送走', () => {
    // docs 记载 1:小财 2:大财；送神符的类型集合里没有它们
    expect(canDispel(1)).toBe(false);
    expect(canDispel(2)).toBe(false);
  });

  it('★ 穷神（类型 5、6）可被送走', () => {
    // docs 记载 5:小穷 6:大穷
    expect(canDispel(5)).toBe(true);
    expect(canDispel(6)).toBe(true);
  });

  it('god_info 为 0（无附身）时不可送', () => {
    expect(canDispel(0)).toBe(false);
  });

  it('下标 0..13 的类型恰为「下标 + 1」，故判定等价于 god_info ∈ 该集合', () => {
    for (const g of [5, 6, 7, 8, 10, 15]) {
      expect(objectTypeOf(g - 1)).toBe(g);
      expect(canDispel(g)).toBe(true);
    }
    for (const g of [1, 2, 3, 4, 9, 11, 12, 13, 14]) {
      expect(canDispel(g)).toBe(false);
    }
  });
});
