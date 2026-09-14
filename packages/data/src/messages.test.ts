/*
 * 文案的二进制校验 —— 逐条回 rich4.exe 对字
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `messages.ts` 里的每一条都带着它在 exe 里的虚拟地址。这个测试把那些
 * 地址上的 Big5 串读出来，与 TS 里的字符串比对。
 *
 * 它挡的是这么一类事：有人觉得「費用:%d元」该写成「費用：%d元」（半角冒号
 * 改全角），或者把「現  金」中间那个全角空格「顺手」改成一个半角的。
 * 这些改动看着无害，但界面就不再是原版的样子了。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ALL_TEXTS, BUTTON, FIELD, PROMPT, RENT, formatOriginal } from './messages.ts';

const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
const d = existsSync(EXE) ? describe : describe.skip;

/** @source 与 binary-truth.test.ts 同一张节表 */
const DGROUP_VA = 0x463000;
const DGROUP_OFF = 398848;
const DGROUP_SIZE = 158720;

d('原版文案', () => {
  const exe = readFileSync(EXE);
  const decoder = new TextDecoder('big5');

  /** 读 VA 处的 Big5 C 串 */
  const readString = (va: number): string => {
    expect(va).toBeGreaterThanOrEqual(DGROUP_VA);
    expect(va).toBeLessThan(DGROUP_VA + DGROUP_SIZE);
    const start = DGROUP_OFF + (va - DGROUP_VA);
    let end = start;
    while (end < exe.length && exe[end] !== 0) end++;
    return decoder.decode(exe.subarray(start, end));
  };

  it('每一条都与 exe 里那个地址上的串逐字相同', () => {
    const mismatches: string[] = [];
    for (const { text, va } of ALL_TEXTS) {
      const actual = readString(va);
      if (actual !== text) {
        mismatches.push(`0x${va.toString(16)}: 期望 ${JSON.stringify(text)} 实得 ${JSON.stringify(actual)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('地址各不相同的条目，文本也确实来自不同地址（没有复制粘贴串位）', () => {
    // 同一个地址出现两次是允许的（原版本来就有重复串），但
    // 「地址不同而我们写了同一段文字」通常是抄错了地址
    const byText = new Map<string, Set<number>>();
    for (const { text, va } of ALL_TEXTS) {
      const set = byText.get(text) ?? new Set<number>();
      set.add(va);
      byText.set(text, set);
    }
    for (const [text, vas] of byText) {
      if (vas.size <= 1) continue;
      // 允许重复，但两个地址上的串必须真的一样
      for (const va of vas) expect(readString(va)).toBe(text);
    }
  });
});

describe('文案的用法', () => {
  it('格式串里的占位符数量与我们打算填的参数对得上', () => {
    // 买地要 地名 + 价钱
    expect(PROMPT.buyLand.text.match(/%[sd]/g)).toEqual(['%s', '%d']);
    expect(PROMPT.upgradeLand.text.match(/%[sd]/g)).toEqual(['%s', '%d']);
    expect(PROMPT.buyShares.text.match(/%[sd]/g)).toEqual(['%s', '%d']);
    // 两个地主那条要四个
    expect(RENT.payTwoOwners.text.match(/%[sd]/g)).toEqual(['%s', '%s', '%s', '%d', '%s']);
  });

  it('formatOriginal 按顺序填，多余的占位符留空而不是印出 undefined', () => {
    expect(formatOriginal(PROMPT.buyLand.text, '台北市', 3200)).toBe(
      '台北市\n\n費用:3200元\n\n是否買下此地？',
    );
    expect(formatOriginal('%s/%d/%s', 'a')).toBe('a//');
  });

  it('按钮就是两个字，没有多余空白', () => {
    expect(BUTTON.ok.text).toBe('確定');
    expect(BUTTON.cancel.text).toBe('取消');
  });

  it('字段名中间是**两个半角空格**，不是全角，也不是一个', () => {
    // 原版按等宽格排版：「現」「空」「空」「金」四个位。看着像全角空格，
    // 实际是 Big5 里两个 0x20。别「顺手」改成一个全角的。
    expect(FIELD.cash.text).toBe('現  金');
    expect(FIELD.deposit.text).toBe('存  款');
    expect([...FIELD.cash.text].map((c) => c.codePointAt(0))).toEqual([0x73fe, 0x20, 0x20, 0x91d1]);
  });
});
