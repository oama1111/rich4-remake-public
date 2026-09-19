/*
 * 卡牌使用者台词表 —— 直接对 rich4.exe 校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 与 `speech.test.ts` / `binary-truth.test.ts` 同一套规矩：表只是「转录」，
 * 真值在 `rich4.exe` 的指针表 **`0x0048123a`**（12 行 × 90 槽，行距 360）里。
 * 本测试逐条读回 360 条（槽 0..29），比对：
 *   ① 文本（`#NNNN` 前缀剥掉）；② 金貝貝那一列的 `@DD` 表情码；
 *   ③ 语音号公式 `426 + 52×角色 + (卡号-1)`。
 *
 * 为什么值得单独立一张表：`SPEECH_LINES`（`0x48084a`，27 槽）装的是「受击/情境」
 * 台词，**用卡时角色那一句不在这里** —— 复刻侧此前整张缺失（gaps §7.89(2)）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CARD_LINES,
  CARD_LINE_COUNT,
  CARD_LINES_PER_CHARACTER,
  CARD_LINE_STRIDE_BYTES,
  CARD_LINE_TABLE_VA,
  CARD_LINE_VOICE_BASE,
  CARD_LINE_VOICE_STRIDE,
  cardLine,
  cardLineVoice,
} from './card-lines.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const hasExe = existsSync(EXE);
const run = hasExe ? it : it.skip;

/** DGROUP：VA 0x463000 → 文件偏移 398848 */
const dataOff = (va: number) => 398848 + (va - 0x463000);
const big5 = new TextDecoder('big5');

function cstr(exe: Buffer, va: number): string {
  const off = dataOff(va);
  return big5.decode(exe.subarray(off, exe.indexOf(0, off)));
}

const CHARACTERS = 12;

describe('卡牌台词表 · 结构', () => {
  it('12 角色 × 30 张卡 = 360 条', () => {
    expect(CARD_LINES).toHaveLength(CHARACTERS);
    for (const row of CARD_LINES) expect(row).toHaveLength(CARD_LINES_PER_CHARACTER);
    expect(CARD_LINE_COUNT).toBe(360);
  });

  it('★ 寻址常量与实际表一致（0x48123a / 360 / 426 / 52）', () => {
    expect(CARD_LINE_TABLE_VA).toBe(0x48123a);
    expect(CARD_LINE_STRIDE_BYTES).toBe(360);
    expect(CARD_LINE_VOICE_BASE).toBe(426);
    expect(CARD_LINE_VOICE_STRIDE).toBe(52);
  });

  it('越界抛 RangeError（角色 0..11 / 卡号 1..30）', () => {
    expect(() => cardLine(12, 1)).toThrow(RangeError);
    expect(() => cardLine(-1, 1)).toThrow(RangeError);
    expect(() => cardLine(0, 0)).toThrow(RangeError);
    expect(() => cardLine(0, 31)).toThrow(RangeError);
    expect(() => cardLine(0, 1.5)).toThrow(RangeError);
  });

  it('抽查：几张「认得出来」的台词', () => {
    expect(cardLine(0, 22)).toEqual([null, '快滾！\n我不需要你！']);
    expect(cardLine(0, 23)).toEqual([null, '快來幫我吧！']);
    expect(cardLine(0, 15)).toEqual([null, '早睡早起\n身體好！']);
    expect(cardLine(1, 23)).toEqual([null, '天靈靈地靈靈！']);
    // 金貝貝那一列全列是表情图
    expect(cardLine(11, 22)).toEqual([11, '@11']);
  });
});

describe('卡牌台词表 · 全量比对 rich4.exe', () => {
  run('★★ 360 条逐条与指针表 `0x48123a` 一致（文本 + 表情码）', () => {
    const exe = readFileSync(EXE);
    const bad: string[] = [];
    for (let ch = 0; ch < CHARACTERS; ch += 1) {
      for (let card = 1; card <= CARD_LINES_PER_CHARACTER; card += 1) {
        const ptr = exe.readUInt32LE(dataOff(CARD_LINE_TABLE_VA) + CARD_LINE_STRIDE_BYTES * ch + 4 * (card - 1));
        const raw = cstr(exe, ptr);
        const text = raw.slice(5);
        const emoji = text.startsWith('@') ? Number(text.slice(1, 3)) : null;
        const want: readonly [number | null, string] = [emoji, text];
        const got = CARD_LINES[ch]![card - 1]!;
        if (got[0] !== want[0] || got[1] !== want[1]) {
          bad.push(`ch${ch} card${card}: 表=${JSON.stringify(got)} exe=${JSON.stringify(want)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  run('★★ 语音号公式 `426 + 52×角色 + (卡号-1)` == 串头 `#NNNN`（360 条）', () => {
    const exe = readFileSync(EXE);
    const bad: number[] = [];
    for (let ch = 0; ch < CHARACTERS; ch += 1) {
      for (let card = 1; card <= CARD_LINES_PER_CHARACTER; card += 1) {
        const ptr = exe.readUInt32LE(dataOff(CARD_LINE_TABLE_VA) + CARD_LINE_STRIDE_BYTES * ch + 4 * (card - 1));
        const raw = cstr(exe, ptr);
        const voice = Number(raw.slice(1, 5));
        if (voice !== cardLineVoice(ch, card)) bad.push(ch * 30 + card);
      }
    }
    expect(bad).toEqual([]);
  });

  run('★ 每角色的语音号是 52 个连续段（角色 0 起 426，角色 11 起 998）', () => {
    expect(cardLineVoice(0, 1)).toBe(426);
    expect(cardLineVoice(0, 30)).toBe(455);
    expect(cardLineVoice(1, 1)).toBe(478);
    expect(cardLineVoice(11, 1)).toBe(998);
    expect(cardLineVoice(11, 30)).toBe(1027);
  });
});

describe('卡牌台词表 · 已知的原版数据瑕疵', () => {
  it('★★ 角色 6 的卡 15/16 以**造字区双字节**结尾 ⇒ 保留 WHATWG 给的 PUA 码位', () => {
    // @source exe VA 0x0046ae77 / 0x0046ae85：串尾是 `\x9d\xdd`（Big5 用户造字区）。
    // WHATWG 表（`TextDecoder('big5')`）把它解成 PUA `U+ECBF`；Python 的 big5 codec
    // 不认这一段（会给出 U+FFFD），故生成脚本走 node 解码 —— 两条必须与运行时一致。
    expect(cardLine(6, 15)).toEqual([null, '晚安～\uECBF']);
    expect(cardLine(6, 16)).toEqual([null, '做個好夢吧～\uECBF']);
  });
});
