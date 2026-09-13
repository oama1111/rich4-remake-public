/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 事件表 —— 直接对 rich4.exe 校验
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  FORTUNE_EVENTS,
  NEWS_EVENTS,
  eventAmount,
  fortuneEvent,
  newsEvent,
} from './event-table.ts';

const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
const run = existsSync(EXE) ? it : it.skip;

/** DGROUP：VA 0x463000 → 文件偏移 398848 */
const dataOff = (va: number) => 398848 + (va - 0x463000);
/** AUTO：VA 0x401000 → 文件偏移 1024 */
const codeOff = (va: number) => 1024 + (va - 0x401000);

describe('表的规模', () => {
  it('新聞 36 项、命運 37 项', () => {
    expect(NEWS_EVENTS).toHaveLength(36);
    expect(FORTUNE_EVENTS).toHaveLength(37);
  });

  it('id 连续且与下标一致', () => {
    NEWS_EVENTS.forEach((e, i) => expect(e.id).toBe(i));
    FORTUNE_EVENTS.forEach((e, i) => expect(e.id).toBe(i));
  });
});

describe('★ 直接对 exe 的函数指针表校验', () => {
  run('新聞事件的 va 与 0x00475e24 表逐项一致', () => {
    const d = readFileSync(EXE);
    NEWS_EVENTS.forEach((e, i) => {
      expect(d.readUInt32LE(dataOff(0x475e24) + i * 4), `news[${i}]`).toBe(e.va);
    });
  });

  run('命運事件的 va 与 0x00475ef0 表逐项一致', () => {
    const d = readFileSync(EXE);
    FORTUNE_EVENTS.forEach((e, i) => {
      expect(d.readUInt32LE(dataOff(0x475ef0) + i * 4), `fortune[${i}]`).toBe(e.va);
    });
  });

  run('每个 va 都落在代码段内', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      expect(e.va).toBeGreaterThanOrEqual(0x401000);
      expect(e.va).toBeLessThan(0x401000 + 394240);
    }
  });

  run('★ 绝大多数以 push 开头，两处例外已核实', () => {
    const d = readFileSync(EXE);
    const odd: number[] = [];
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (![0x53, 0x56, 0x57, 0x55].includes(d[codeOff(e.va)]!)) odd.push(e.va);
    }
    // news[26] 与 fortune[3] 以 `mov`(0x8b) 开头——不压寄存器直接取参，
    // 是合法的序跋变体，不是表读错了。
    expect(odd).toEqual([0x0044b0a0, 0x0044c229]);
  });

  run('地址两两不同', () => {
    const all = [...NEWS_EVENTS, ...FORTUNE_EVENTS].map((e) => e.va);
    expect(new Set(all).size).toBe(all.length);
  });

  run('★ textVa 都指向数据段里可解码的 BIG5 字符串', () => {
    const d = readFileSync(EXE);
    let checked = 0;
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.textVa === 0) continue;
      const o = dataOff(e.textVa);
      expect(e.textVa).toBeGreaterThanOrEqual(0x463000);
      const end = d.indexOf(0, o);
      expect(end).toBeGreaterThan(o); // 非空
      // 文案自带 `#NNNN` 四位编号前缀
      expect(d[o]).toBe(0x23); // '#'
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe('金额系数', () => {
  it('金额 = 物价指数 × factor', () => {
    const e = fortuneEvent(22)!;
    expect(e.factor).toBe(3000);
    expect(eventAmount(e, 1)).toBe(3000);
    expect(eventAmount(e, 7)).toBe(21_000);
  });

  it('factor 为 null 时金额为 0', () => {
    const e = fortuneEvent(0)!;
    expect(e.factor).toBeNull();
    expect(eventAmount(e, 9)).toBe(0);
  });

  it('★ 所有 factor 都是正整数（移位链还原正确的必要条件）', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null) continue;
      expect(Number.isInteger(e.factor), `event ${e.id}`).toBe(true);
      expect(e.factor, `event ${e.id}`).toBeGreaterThan(0);
    }
  });

  it('★ factor 都是整百的数——原版的金额都取整齐值', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null) continue;
      expect(e.factor % 100, `event ${e.id} factor=${e.factor}`).toBe(0);
    }
  });
});

describe('查找', () => {
  it('按 id 取得', () => {
    expect(newsEvent(29)?.id).toBe(29);
    expect(fortuneEvent(33)?.id).toBe(33);
  });

  it('越界返回 undefined', () => {
    expect(newsEvent(99)).toBeUndefined();
    expect(fortuneEvent(-1)).toBeUndefined();
  });
});
