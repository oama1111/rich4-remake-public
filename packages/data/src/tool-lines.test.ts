/*
 * 13 件道具的角色台词表（`_tool_strings`）—— 第十一份試玩回報 #3
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版在 `0x480d5a` 有一张 **12 行 × 26 列**的指针表（行距 `0x68` = 26×4），
 * 前 13 列正好是道具 1..13。这里逐条**回 exe 核字节** —— 指针表读出来 → 解 Big5 →
 * 与本仓库的 `TOOL_LINES` 逐字比对（`#NNNN` 语音前缀与角色 11 的 `@DD` 表情码都在串里）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_LINE_COUNT, TOOL_LINES, toolLine } from './tool-lines.ts';

const DGROUP_FILE_OFFSET = 398848;
const DGROUP_VA = 0x463000;
const TABLE_VA = 0x480d5a;
const ROW_STRIDE = 0x68;
const EXE = new URL('../../../../Rich4/rich4.exe', import.meta.url);

const exists = (() => {
  try {
    readFileSync(EXE);
    return true;
  } catch {
    return false;
  }
})();
const run = exists ? it : it.skip;

const toOff = (va: number) => DGROUP_FILE_OFFSET + (va - DGROUP_VA);

describe('★ 道具台词表', () => {
  it('★ 12 个角色 × 13 件道具，一条不缺', () => {
    expect(TOOL_LINES).toHaveLength(12);
    for (const [i, row] of TOOL_LINES.entries()) {
      expect(row, `角色 ${i} 的行`).toHaveLength(TOOL_LINE_COUNT);
      for (const [j, line] of row.entries()) {
        expect(line, `角色 ${i} 道具 ${j + 1}`).not.toBeNull();
        expect(line![1], `角色 ${i} 道具 ${j + 1} 少了 #NNNN 语音码`).toMatch(/^#\d{4}/);
      }
    }
  });

  it('★ 越界返回 null（不抛、不夹取）', () => {
    expect(toolLine(0, 0)).toBeNull();
    expect(toolLine(0, 14)).toBeNull();
    expect(toolLine(12, 1)).toBeNull();
    expect(toolLine(-1, 1)).toBeNull();
    expect(toolLine(0, 1)).not.toBeNull();
  });

  run('★★ 逐条回 exe 核字节：指针表 0x480d5a + 0x68×角色 + 4×(道具−1) 指的那条串', () => {
    const exe = readFileSync(EXE);
    const decoder = new TextDecoder('big5');
    for (let c = 0; c < 12; c++) {
      for (let t = 0; t < TOOL_LINE_COUNT; t++) {
        const slotOff = toOff(TABLE_VA + ROW_STRIDE * c + 4 * t);
        const ptr = exe.readUInt32LE(slotOff);
        const start = toOff(ptr);
        let end = start;
        while (exe[end] !== 0) end++;
        const text = decoder.decode(exe.subarray(start, end));
        const line = TOOL_LINES[c]![t]!;
        // `@DD` 被剥进第一个元素（与 `SpeechLine` 同一形状），回核时拼回去
        const emoji = line[0] === null ? '' : `@${line[0]}`;
        const rebuilt = `${line[1].slice(0, 5)}${emoji}${line[1].slice(5)}`;
        expect(text, `角色 ${c} 道具 ${t + 1}（ptr=0x${ptr.toString(16)}）`).toBe(rebuilt);
      }
    }
  });

  run('★ 角色 11 那三列带 `@DD` 表情码（与 `SpeechLine` 的第一个元素一致）', () => {
    // 原版 `"#NNNN@DD…"`：`@DD` 是表情图号，文本里不带它
    // 原版是 `"#NNNN@DD"`（这一列**没有文本**，只有一张表情图）—— 剥出来之后
    // `text` 只剩 `#NNNN`、`@DD` 落到第一个元素。
    const line = TOOL_LINES[11]![0]!;
    expect(line[1]).toBe('#0410');
    expect(line[0], '表情码要落在第一个元素').toBe(20);
  });
});
