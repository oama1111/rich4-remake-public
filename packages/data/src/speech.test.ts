/*
 * Speaking.mkf 語音索引 —— 直接对 rich4.exe / Speaking.mkf 校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 与 `binary-truth.test.ts` 同一套规矩：表格只是「转录」，真值在两个二进制里。
 *   ① `rich4.exe` 的 **角色台词指针表** `0x0048084a`（12 行 × 27 列，行距 108）
 *      —— 逐条读出串、解析 `#NNNN`，与 `speechIndex()` 比对（324 条全量）。
 *   ② `Speaking.mkf` 的**条目数** —— 公式的最大值必须正好落在最后一个条目上。
 *
 * ★ 任务卡 T-051 写的硬约束是「1375 段」，那是把 `extracted/Speaking/meta.json`
 *   也算进 `ls` 的结果；`Speaking.mkf` 自己的索引表与 `meta.json` 的 `nchunks`
 *   都是 **1374**（见下面「条目数」那条）。公式最大值 1373 = 1374 − 1，恰好吃满。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  SPEAKING_CHUNK_COUNT,
  SPEECH_BASE_INDEX,
  SPEECH_CHARACTER_COUNT,
  SPEECH_EMOJI_AT,
  SPEECH_EMOJI_IMAGE_COUNT,
  SPEECH_EMOJI_RESOURCE,
  SPEECH_EVENTS,
  SPEECH_EVENTS_PER_CHARACTER,
  SPEECH_LINES,
  SPEECH_MAX_INDEX,
  SPEECH_STRIDE_BYTES,
  SPEECH_TABLE_VA,
  speechEmojiImage,
  speechEvent,
  speechIndex,
  speechLine,
} from './speech.ts';
import { CHARACTERS } from './characters.ts';
import { FORTUNE_EVENTS, NEWS_EVENTS } from './event-table.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Speaking.mkf';
const hasExe = existsSync(EXE);
const hasMkf = existsSync(MKF);
const run = hasExe ? it : it.skip;

/** 金貝貝的角色号 —— 唯一一个**不说话**、台词整列是表情图的角色（`characters.ts` id 11）*/
const JINBEIBEI = 11;

/** DGROUP：VA 0x463000 → 文件偏移 398848 */
const dataOff = (va: number) => 398848 + (va - 0x463000);
/** AUTO：VA 0x401000 → 文件偏移 1024 */
const codeOff = (va: number) => 1024 + (va - 0x401000);
const DGROUP_SIZE = 158720;
const AUTO_SIZE = 394240;

const big5 = new TextDecoder('big5');

/** 读 `va` 处的 BIG5 串（**不做任何去空格处理** —— 台词里可能有空白） */
function lineAt(exe: Buffer, va: number): string {
  const off = dataOff(va);
  const end = exe.indexOf(0, off);
  return big5.decode(exe.subarray(off, end));
}

/** 读指针表 [角色][事件] */
function pointer(exe: Buffer, character: number, event: number): number {
  return exe.readUInt32LE(dataOff(SPEECH_TABLE_VA) + SPEECH_STRIDE_BYTES * character + 4 * event);
}

/** `#NNNN` → NNNN；不是这个形状就返回 null */
function voiceOf(line: string): number | null {
  const m = /^#(\d{4})/.exec(line);
  return m === null ? null : Number(m[1]);
}

// ============================================================
//  公式与规模
// ============================================================

describe('公式 `1050 + 27×角色 + 事件`', () => {
  it('规模常量', () => {
    expect(SPEECH_BASE_INDEX).toBe(1050);
    expect(SPEECH_EVENTS_PER_CHARACTER).toBe(27);
    expect(SPEECH_CHARACTER_COUNT).toBe(12);
    expect(SPEECH_STRIDE_BYTES).toBe(SPEECH_EVENTS_PER_CHARACTER * 4);
    expect(SPEECH_MAX_INDEX).toBe(SPEECH_BASE_INDEX + 27 * 11 + 26);
    expect(SPEECH_MAX_INDEX).toBe(1373);
  });

  it('★ 角色表就是 characters.ts 的那 12 个（行序 = id 序）', () => {
    expect(SPEECH_CHARACTER_COUNT).toBe(CHARACTERS.length);
    expect(CHARACTERS.map((c) => c.id)).toEqual([...Array(12).keys()]);
  });

  it('手算抽样 1：角色 3（錢夫人）事件 19 → 1150', () => {
    // 1050 + 27×3 + 19 = 1050 + 81 + 19 = 1150
    expect(speechIndex(3, 19)).toBe(1150);
  });

  it('手算抽样 2：角色 8（烏咪）事件 18 → 1284', () => {
    // 1050 + 27×8 + 18 = 1050 + 216 + 18 = 1284
    expect(speechIndex(8, 18)).toBe(1284);
  });

  it('手算抽样 3：每一行的首项 = 1050 + 27×角色', () => {
    for (let c = 0; c < 12; c++) {
      expect(speechIndex(c, 0), `角色 ${c}`).toBe(1050 + 27 * c);
      expect(speechIndex(c, 26), `角色 ${c}`).toBe(1050 + 27 * c + 26);
    }
  });

  it('整表 324 项互不相同且落在 [1050, 1373]', () => {
    const all = new Set<number>();
    for (let c = 0; c < 12; c++) {
      for (let e = 0; e < 27; e++) all.add(speechIndex(c, e));
    }
    expect(all.size).toBe(324);
    expect(Math.min(...all)).toBe(SPEECH_BASE_INDEX);
    expect(Math.max(...all)).toBe(SPEECH_MAX_INDEX);
    expect(SPEECH_MAX_INDEX - SPEECH_BASE_INDEX + 1).toBe(324);
  });
});

// ============================================================
//  边界：原版不夹取，本项目抛 RangeError
// ============================================================

describe('★ 越界判据 = 抛错（原版没有夹取，夹取属改良）', () => {
  it('角色越界 -1 / 12 抛 RangeError', () => {
    expect(() => speechIndex(-1, 0)).toThrow(RangeError);
    expect(() => speechIndex(12, 0)).toThrow(RangeError);
    expect(() => speechIndex(99, 0)).toThrow(RangeError);
  });

  it('事件越界 -1 / 27 抛 RangeError', () => {
    expect(() => speechIndex(0, -1)).toThrow(RangeError);
    expect(() => speechIndex(0, 27)).toThrow(RangeError);
    expect(() => speechIndex(11, 100)).toThrow(RangeError);
  });

  it('非整数也抛（原版是整数下标）', () => {
    expect(() => speechIndex(1.5, 0)).toThrow(RangeError);
    expect(() => speechIndex(0, Number.NaN)).toThrow(RangeError);
  });

  it('四个角刚好合法', () => {
    expect(speechIndex(0, 0)).toBe(1050);
    expect(speechIndex(0, 26)).toBe(1076);
    expect(speechIndex(11, 0)).toBe(1347);
    expect(speechIndex(11, 26)).toBe(1373);
  });

  it('speechEvent 越界返回 undefined（与 newsEvent 同风格）', () => {
    expect(speechEvent(0)?.id).toBe(0);
    expect(speechEvent(26)?.id).toBe(26);
    expect(speechEvent(-1)).toBeUndefined();
    expect(speechEvent(27)).toBeUndefined();
  });
});

// ============================================================
//  事件表自身
// ============================================================

describe('事件表', () => {
  it('27 项、id 连续 = 下标、voice = 1050 + id', () => {
    expect(SPEECH_EVENTS).toHaveLength(27);
    expect(SPEECH_EVENTS).toHaveLength(SPEECH_EVENTS_PER_CHARACTER);
    SPEECH_EVENTS.forEach((e, i) => {
      expect(e.id).toBe(i);
      expect(e.voice).toBe(SPEECH_BASE_INDEX + i);
      expect(voiceOf(e.line)).toBe(e.voice);
      expect(e.gloss.length).toBeGreaterThan(0);
    });
  });

  it('lineVa 都落在数据段、sites 都落在代码段', () => {
    for (const e of SPEECH_EVENTS) {
      expect(e.lineVa, `事件 ${e.id}`).toBeGreaterThanOrEqual(0x463000);
      expect(e.lineVa, `事件 ${e.id}`).toBeLessThan(0x463000 + DGROUP_SIZE);
      for (const s of e.sites) {
        expect(s, `事件 ${e.id} 的调用点`).toBeGreaterThanOrEqual(0x401000);
        expect(s, `事件 ${e.id} 的调用点`).toBeLessThan(0x401000 + AUTO_SIZE);
      }
    }
  });

  it('每个槽位都至少有一个取用点（随机伙伴与配对方共用同一条指令）', () => {
    for (const e of SPEECH_EVENTS) {
      expect(e.sites.length, `事件 ${e.id} 没有取用点`).toBeGreaterThan(0);
    }
    // 列 1/4/7/10 是「随机二选一」的后者：取用点必是配对前者那一条指令
    for (const id of [1, 4, 7, 10]) {
      const prev = speechEvent(id - 1)!.sites;
      const own = speechEvent(id)!.sites;
      expect(own.some((s) => prev.includes(s)), `事件 ${id} 与 ${id - 1} 不共用取用点`).toBe(
        true,
      );
    }
  });

  run('★ sites 指向的指令确实在取本槽位（或它的随机伙伴）的串', () => {
    const exe = readFileSync(EXE);
    for (const e of SPEECH_EVENTS) {
      for (const s of e.sites) {
        const off = codeOff(s);
        // 这些取串指令形如 `mov reg, [base + idx*4|8 + disp32]`
        // （8B /r + SIB + disp32），disp32 落在指令第 4 字节。
        const disp = exe.readUInt32LE(off + 3);
        const own = SPEECH_TABLE_VA + 4 * e.id;
        // 随机二选一的那条指令用的是「配对两列」的首地址
        const pair = SPEECH_TABLE_VA + 4 * (e.id - 1);
        expect(
          disp === own || disp === pair,
          `事件 ${e.id} 的调用点 0x${s.toString(16)} 的位移是 0x${disp.toString(16)}，` +
            `期望 0x${own.toString(16)}`,
        ).toBe(true);
      }
    }
  });
});

// ============================================================
//  ★ 对 exe 逐条比对：324 条串
// ============================================================

describe('★ 直接对 rich4.exe 的角色台词指针表校验', () => {
  run('PE 校验：确认是预期的可执行文件', () => {
    const exe = readFileSync(EXE);
    expect(exe.length).toBe(602_112);
    expect(exe.readUInt32LE(exe.readUInt32LE(0x3c) + 24 + 28)).toBe(0x400000);
  });

  run('★ 12 × 27 = 324 条串的 `#NNNN` 全部等于 speechIndex(角色,事件)', () => {
    const exe = readFileSync(EXE);
    let checked = 0;
    for (let c = 0; c < SPEECH_CHARACTER_COUNT; c++) {
      for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
        const ptr = pointer(exe, c, e);
        expect(ptr, `角色 ${c} 事件 ${e} 的指针为 0`).toBeGreaterThan(0);
        const line = lineAt(exe, ptr);
        expect(line.startsWith('#'), `角色 ${c} 事件 ${e} 的串没有 # 前缀`).toBe(true);
        expect(voiceOf(line), `角色 ${c} 事件 ${e}`).toBe(speechIndex(c, e));
        checked++;
      }
    }
    expect(checked).toBe(324);
  });

  run('★ 事件表里角色 0 那 27 条与 exe 逐字一致', () => {
    const exe = readFileSync(EXE);
    for (const e of SPEECH_EVENTS) {
      expect(pointer(exe, 0, e.id), `事件 ${e.id} 指针`).toBe(e.lineVa);
      expect(lineAt(exe, e.lineVa), `事件 ${e.id} 台词`).toBe(e.line);
    }
  });

  run('★ 12 行首项就是 speech.ts 头注释列的那 12 个地址', () => {
    const exe = readFileSync(EXE);
    const rowStart = [
      0x00466bd8, 0x00466dcd, 0x0046701a, 0x00467242, 0x0046744c, 0x00467610,
      0x00467854, 0x00467ae3, 0x00467cd4, 0x00467edf, 0x004680e3, 0x0046828e,
    ];
    expect(rowStart).toHaveLength(SPEECH_CHARACTER_COUNT);
    rowStart.forEach((va, c) => {
      expect(pointer(exe, c, 0), `角色 ${c} 首项`).toBe(va);
      expect(voiceOf(lineAt(exe, va)), `角色 ${c} 首项语音号`).toBe(SPEECH_BASE_INDEX + 27 * c);
    });
  });

  run('★ 第 12 行起不再是这套台词 —— 证明行数恰为 12', () => {
    const exe = readFileSync(EXE);
    // 第 12 行首项 = `#0236替我除掉障礙物！`（语音号 236，落在公式区间之外）
    const line = lineAt(exe, pointer(exe, 12, 0));
    expect(voiceOf(line)).toBe(236);
    expect(voiceOf(line)).not.toBe(speechIndex(0, 0));
    // 整行的语音号都不该落进 [1050, 1373]
    for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
      const v = voiceOf(lineAt(exe, pointer(exe, 12, e)));
      if (v === null) continue;
      expect(v >= SPEECH_BASE_INDEX && v <= SPEECH_MAX_INDEX, `第 12 行第 ${e} 项`).toBe(false);
    }
  });

  run('★ 每一行的 27 条串都互不相同（没有 copy-paste 造成的重复行）', () => {
    const exe = readFileSync(EXE);
    for (let c = 0; c < SPEECH_CHARACTER_COUNT; c++) {
      const lines = new Set<string>();
      for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
        lines.add(lineAt(exe, pointer(exe, c, e)));
      }
      expect(lines.size, `角色 ${c}`).toBe(SPEECH_EVENTS_PER_CHARACTER);
    }
  });

  run('★ 串文本与角色对得上：錢夫人(3)/烏咪(8) 自称出现的位置正确', () => {
    const exe = readFileSync(EXE);
    const all = (c: number) =>
      [...Array(27).keys()].map((e) => lineAt(exe, pointer(exe, c, e))).join('');
    expect(all(3)).toContain('錢夫人');
    expect(all(8)).toContain('烏咪');
    expect(all(5)).toContain('本公主'); // 莎拉公主
    expect(all(0)).not.toContain('烏咪');
  });
});

// ============================================================
//  ★ 硬约束：Speaking.mkf 条目数
// ============================================================

const runMkf = hasMkf ? it : it.skip;

describe('★ Speaking.mkf 条目数（硬约束）', () => {
  runMkf('头 4 字节 = 索引表偏移，条目数 = (文件长 − 偏移) / 4', () => {
    const mkf = readFileSync(MKF);
    const tableOffset = mkf.readUInt32LE(0);
    expect(tableOffset).toBe(56_948_030);
    expect(mkf.length).toBe(56_953_526);
    const count = (mkf.length - tableOffset) / 4;
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBe(SPEAKING_CHUNK_COUNT);
    expect(count).toBe(1374);
    // 索引表单调递增；第 0 项的 4 就是**第一个条目的头**的位置
    // （文件头只有 4 字节的「索引表偏移」，紧接着从 4 起就是 条目头+数据）。
    let prev = -1;
    for (let i = 0; i < count; i++) {
      const v = mkf.readUInt32LE(tableOffset + 4 * i);
      expect(v, `索引表第 ${i} 项`).toBeGreaterThan(prev);
      prev = v;
    }
    expect(mkf.readUInt32LE(tableOffset)).toBe(4);
    // 条目 0 的头：解压后大小 = meta.json 里的 40970，其后紧跟 "RIFF"
    expect(mkf.readUInt32LE(4)).toBe(40_970);
    expect(mkf.subarray(20, 24).toString('latin1')).toBe('RIFF');
  });

  it('★ 公式的最大值正好是最后一个条目号（1374 − 1）', () => {
    expect(SPEECH_MAX_INDEX).toBe(SPEAKING_CHUNK_COUNT - 1);
  });

  it('★ 12×27 恰好是条目表的末段：1050 .. 1373', () => {
    expect(SPEECH_BASE_INDEX).toBe(SPEAKING_CHUNK_COUNT - 27 * 12);
    expect(SPEECH_MAX_INDEX).toBe(SPEAKING_CHUNK_COUNT - 1);
  });

  runMkf('★ 这 324 个条目在档案里都存在（读得到索引项）', () => {
    const mkf = readFileSync(MKF);
    const tableOffset = mkf.readUInt32LE(0);
    const count = (mkf.length - tableOffset) / 4;
    for (let c = 0; c < SPEECH_CHARACTER_COUNT; c++) {
      for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
        const idx = speechIndex(c, e);
        expect(idx, `角色 ${c} 事件 ${e}`).toBeLessThan(count);
        const off = mkf.readUInt32LE(tableOffset + 4 * idx);
        expect(off, `资源号 ${idx} 的偏移`).toBeGreaterThan(0);
        expect(off, `资源号 ${idx} 的偏移`).toBeLessThan(tableOffset);
      }
    }
  });
});

// ============================================================
//  ★ 324 条**逐条**与 rich4.exe 比对（每个角色自己那一列）
// ============================================================

/**
 * 指针表读出来的**原始**一列 —— 保留 `#NNNN` 前缀与 `@DD` 原样，不做任何裁剪。
 *
 * ⚠️ 与表里的 `line` 比时必须先剥掉 `#NNNN` / `@DD` 前缀（那是**语音号／表情码**，
 *   不是台词本身）。`SPEECH_LINES` 存的正是剥掉之后的样子。
 */
function rawLineAt(exe: Buffer, character: number, event: number): string {
  return lineAt(exe, pointer(exe, character, event));
}

/**
 * 从**原始**串里剥出 `[表情码, 要显示的文本]` —— 与 `tools/gen-speech.py` 同一套判据：
 *   ① 去掉开头的 `#NNNN`（**语音号**，不是台词）；
 *   ② 剩下的若形如 `@DD`，DD 就是**表情码**，文本字段仍保留 `@DD` 原文
 *      （渲染时由 `speechEmojiImage()` 换算成图号，不再当文字画）。
 */
function splitRaw(raw: string): { text: string; emoji: number | null } {
  const body = /^#\d{4}/.test(raw) ? raw.slice(5) : raw;
  const m = /^@(\d{2})$/.exec(body);
  return { text: body, emoji: m === null ? null : Number(m[1]) };
}

describe('★ SPEECH_LINES 全量比对（12 × 27 = 324 条）', () => {
  it('形状：12 行、每行 27 条、每条是 [表情码, 文本]', () => {
    expect(SPEECH_LINES).toHaveLength(SPEECH_CHARACTER_COUNT);
    for (const [c, row] of SPEECH_LINES.entries()) {
      expect(row, `角色 ${c}`).toHaveLength(SPEECH_EVENTS_PER_CHARACTER);
      for (const [e, item] of row.entries()) {
        expect(item.length, `角色 ${c} 事件 ${e}`).toBe(2);
        expect(typeof item[1], `角色 ${c} 事件 ${e}`).toBe('string');
      }
    }
  });

  run('★ 324 条文本逐字节等于 exe 指针表里的那一列（BIG5）', () => {
    const exe = readFileSync(EXE);
    for (let c = 0; c < SPEECH_CHARACTER_COUNT; c++) {
      for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
        const raw = rawLineAt(exe, c, e);
        const want = splitRaw(raw);
        const got = speechLine(c, e);
        expect(got[1], `角色 ${c}（${CHARACTERS[c]!.name}）事件 ${e}`).toBe(want.text);
        expect(got[0], `角色 ${c} 事件 ${e} 的表情码`).toBe(want.emoji);
      }
    }
  });

  run('★ 除金貝貝外，每一列都是普通台词（`#NNNN` + 纯文本，表情码 null）', () => {
    const exe = readFileSync(EXE);
    for (let c = 0; c < SPEECH_CHARACTER_COUNT; c++) {
      const emojiCount = SPEECH_LINES[c]!.filter((x) => x[0] !== null).length;
      if (c === JINBEIBEI) {
        // 它**整整一列**都是表情
        expect(emojiCount, '金貝貝应当整列都是表情码').toBe(SPEECH_EVENTS_PER_CHARACTER);
        continue;
      }
      expect(emojiCount, `角色 ${c}（${CHARACTERS[c]!.name}）不该有表情码`).toBe(0);
      // 而且每条都带 `#NNNN` 语音号
      for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
        expect(rawLineAt(exe, c, e), `角色 ${c} 事件 ${e}`).toMatch(/^#\d{4}/);
      }
    }
  });

  run('★ 金貝貝那一列：27 条都是 `#NNNN@DD`，且表情码与文本字段一致', () => {
    const exe = readFileSync(EXE);
    for (let e = 0; e < SPEECH_EVENTS_PER_CHARACTER; e++) {
      const raw = rawLineAt(exe, JINBEIBEI, e);
      const m = /^#(\d{4})@(\d{2})$/.exec(raw);
      expect(m, `金貝貝事件 ${e} 的原始串：${raw}`).not.toBeNull();
      expect(Number(m![1]), `金貝貝事件 ${e} 的语音号`).toBe(speechIndex(JINBEIBEI, e));
      expect(speechLine(JINBEIBEI, e)[0], `金貝貝事件 ${e} 的表情码`).toBe(Number(m![2]));
    }
  });

  it('★ 文本里没有残留的 `#NNNN` 语音号（那是号码，不是台词）', () => {
    for (const [c, row] of SPEECH_LINES.entries()) {
      for (const [e, [emoji, text]] of row.entries()) {
        expect(text, `角色 ${c} 事件 ${e}`).not.toMatch(/^#\d{4}/);
        if (emoji === null) expect(text, `角色 ${c} 事件 ${e}`).not.toMatch(/^@\d{2}$/);
        else expect(text, `角色 ${c} 事件 ${e}`).toBe(`@${String(emoji).padStart(2, '0')}`);
      }
    }
  });

  it('★ 槽位语义同号同义：角色 0 那一列必须与 SPEECH_EVENTS 的 `line` 逐条相等', () => {
    // SPEECH_EVENTS 的 `line` 存的就是角色 0 的原始串（含 #NNNN），故按同样的剥法比。
    for (const ev of SPEECH_EVENTS) {
      const want = splitRaw(ev.line);
      expect(speechLine(0, ev.id), `槽位 ${ev.id}（${ev.gloss}）`).toEqual([want.emoji, want.text]);
    }
  });

  it('★ 每个角色都**真的**有自己的台词：324 条里互不相同的文本 ≥ 300', () => {
    // 抄同一份表会立刻在这里露馅（原版 12 个角色的用词几乎不重样）。
    const texts = new Set<string>();
    for (const row of SPEECH_LINES) for (const [, t] of row) texts.add(t);
    expect(texts.size).toBeGreaterThanOrEqual(300);
    // 角色 9（孫小美）与角色 10（忍太郎）同为「洋涇浜」风格，但用词不同：
    expect(speechLine(9, 0)[1]).not.toBe(speechLine(10, 0)[1]);
  });

  it('越界抛 RangeError（与 speechIndex 同一套约定）', () => {
    expect(() => speechLine(-1, 0)).toThrow(RangeError);
    expect(() => speechLine(12, 0)).toThrow(RangeError);
    expect(() => speechLine(0, -1)).toThrow(RangeError);
    expect(() => speechLine(0, 27)).toThrow(RangeError);
  });
});

describe('★ 金貝貝的表情图（`@DD` 那一支）', () => {
  it('资源号 = Data.mkf #0x207 @source rich4_load_map.asm:578', () => {
    expect(SPEECH_EMOJI_RESOURCE).toBe(0x207);
  });

  it('落点 (0xf0, 0x82) @source rich4.asm 的两条 push', () => {
    expect(SPEECH_EMOJI_AT).toEqual({ x: 0xf0, y: 0x82 });
  });

  it('图号算式 = 3×十位 + 个位 − 1', () => {
    // @source rich4.asm:23646-23660 的整数算式（逐条照机器码抄）：
    //   `ecx = 十位−1` → `eax = ecx×5` → `eax += eax` ⇒ `eax = 10×十位 − 10`
    //   `eax += 个位` ⇒ `eax = 10×十位 + 个位 − 10`
    //   `edx = eax−1` → `eax = edx×3` ⇒ **图号 = 3×(图内码 − 10)**
    //   代回：`3×(10×十位 + 个位 − 10) = 3×十位 + 个位 − 1`（= 上式的另一写法）。
    //   —— 别被那个 `×3` 骗了：`图内码` 是**按十位分组的 10 步**，不是 code 本身。
    expect(speechEmojiImage(1)).toBe(0);
    expect(speechEmojiImage(2)).toBe(1);
    expect(speechEmojiImage(9)).toBe(8);
    expect(speechEmojiImage(10)).toBe(2);
    expect(speechEmojiImage(11)).toBe(3);
    expect(speechEmojiImage(19)).toBe(11);
    expect(speechEmojiImage(20)).toBe(5);
    expect(speechEmojiImage(21)).toBe(6);
    // 全表：code 01..21 → 0..11，**12 个互不相同**（都在 21 张图的范围内）
    const all = [...Array(21).keys()].map((i) => speechEmojiImage(i + 1));
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 5, 6]);
    expect(new Set(all).size).toBe(12);
    expect(Math.min(...all)).toBe(0);
    expect(Math.max(...all)).toBe(11);
  });

  it('★ 用到的 code 全部落在图号空间内（图片数硬约束）', () => {
    // 0x207 共 21 张 → 图号必须落在 0..20，且金貝貝那一列用到的 15 个 code 全部合法
    const used = new Set<number>();
    for (const [emoji] of SPEECH_LINES[JINBEIBEI]!) used.add(emoji!);
    expect(used.size).toBe(15);
    for (const code of used) {
      const img = speechEmojiImage(code);
      expect(Number.isInteger(img), `code ${code}`).toBe(true);
      expect(img, `code ${code}`).toBeGreaterThanOrEqual(0);
      expect(img, `code ${code}`).toBeLessThan(SPEECH_EMOJI_IMAGE_COUNT);
    }
  });

  run('★ 图号空间 = assets-clean/Data/0519_*.png 的张数（21）', () => {
    const dir = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/Data';
    const pngs = readdirSync(dir).filter((f) => /^0519_\d{3}\.png$/.test(f));
    expect(pngs.length).toBe(SPEECH_EMOJI_IMAGE_COUNT);
    expect(SPEECH_EMOJI_IMAGE_COUNT).toBe(21);
  });
});

// ============================================================
//  ★ 与既有文案表交叉验证（同一套 Speaking.mkf 编号空间）
// ============================================================

describe('★ 与 event-table.ts 的 #NNNN 对齐', () => {
  it('新聞／命運的語音號都落在 Speaking.mkf 之内，且不与角色段重叠', () => {
    const all = [...NEWS_EVENTS, ...FORTUNE_EVENTS];
    expect(all).toHaveLength(73);
    for (const e of all) {
      const v = voiceOf(e.text);
      expect(v, `${e.text}`).not.toBeNull();
      expect(v!, `新聞/命運 ${e.id}`).toBeLessThan(SPEAKING_CHUNK_COUNT);
      // 149..221 vs 角色段 1050..1373：两段不重叠
      expect(v! < SPEECH_BASE_INDEX || v! > SPEECH_MAX_INDEX, `${e.text}`).toBe(true);
    }
    // 新聞 149..184、命運 185..221 —— 连号
    expect(voiceOf(NEWS_EVENTS[0]!.text)).toBe(149);
    expect(voiceOf(NEWS_EVENTS[35]!.text)).toBe(184);
    expect(voiceOf(FORTUNE_EVENTS[0]!.text)).toBe(185);
    expect(voiceOf(FORTUNE_EVENTS[36]!.text)).toBe(221);
  });

  it('角色段之前的号（< 1050）另有 1050 个条目，属别的语音', () => {
    // 只是把「公式没覆盖的空间」写成断言，防止将来有人把它当漏项
    expect(SPEAKING_CHUNK_COUNT - 324).toBe(1050);
    expect(SPEECH_BASE_INDEX).toBe(1050);
  });
});
