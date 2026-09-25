/*
 * 语音出口 —— 解析 + 触发播放
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CAPTION_MIN_MS,
  captionExpired,
  hasVoiceSink,
  playVoiceCode,
  setVoiceBusyProbe,
  setVoiceSink,
} from './voice-sink.ts';

afterEach(() => {
  setVoiceSink(null);
  setVoiceBusyProbe(null);
});

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const runExe = existsSync(EXE) ? it : it.skip;
/** VA → 字节（代码段 / 数据段，与 `tools/disasm.py` 的 `SECTIONS` 同一套）*/
function exeHex(va: number, n: number): string {
  const d = readFileSync(EXE);
  const off = va < 0x463000 ? 1024 + (va - 0x401000) : 398848 + (va - 0x463000);
  return [...d.subarray(off, off + n)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}
const callTo = (va: number): number => {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  expect(d[off]).toBe(0xe8);
  return va + 5 + d.readInt32LE(off + 1);
};

describe('★★ 第二十六份 panel #2：字框到期 `fcn_0044ee18(0)` —— max(2000 ms, 语音放完)；音效关着恰好 2000 ms', () => {
  runExe('exe 钉：`cmp eax, 0x7d0` → 音效档 `[0x49715b]` 闸 → `call 0x4544b9`（语音还在响）；出厂音效档 4', () => {
    // 0044ee3f call timeGetTime / 0044ee46 mov ecx,[0x4762c4] / sub eax,ecx / cmp eax,0x7d0 / jb
    // 0044ee55 xor esi,esi / mov [0x4762c4],esi / jmp · 0044ee5f test ecx,ecx / jne
    // 0044ee63 cmp byte [0x49715b],0 / je · 0044ee6c call 0x4544b9 / mov [0x4762c4],eax
    expect(exeHex(0x44ee3f, 0x37)).toBe(
      '2e ff 15 6c 24 46 00 8b 0d c4 62 47 00 29 c8 3d d0 07 00 00 72 0a 31 f6 89 35 c4 62 47 00 eb 04 85 c9 75 13 80 3d 5b 71 49 00 00 74 0a e8 48 56 00 00 a3 c4 62 47 00',
    );
    expect(callTo(0x44ee6c)).toBe(0x4544b9);
    // 出厂：00411ee8 mov dh,4 / mov [0x49715a],dh / mov [0x49715b],dh（音乐 / 音效档都是 4）
    expect(exeHex(0x411ee8, 0xe)).toBe('b6 04 88 35 5a 71 49 00 88 35 5b 71 49 00');
    // `#NNNN`：0x44fabc 画字时认 '#'（0044fb00 cmp ah,0x23）→ 0044fb4e call 0x45441a（放语音）
    expect(exeHex(0x44fb00, 3)).toBe('80 fc 23');
    expect(callTo(0x44fb4e)).toBe(0x45441a);
    // 对照：訊息框 0x440cac 是死时长 —— 00440de7 push esi(毫秒) / call 0x4528b9（不问语音）
    expect(exeHex(0x440de7, 1)).toBe('56');
    expect(callTo(0x440de8)).toBe(0x4528b9);
  });

  it('`captionExpired`：不满 2000 ms 一律挂着；满了看语音', () => {
    expect(CAPTION_MIN_MS).toBe(2000);
    expect(captionExpired(1000, 2999, false)).toBe(false);
    expect(captionExpired(1000, 3000, false)).toBe(true);
    expect(captionExpired(1000, 3000, true)).toBe(false);
    expect(captionExpired(1000, 9000, true)).toBe(false);
    expect(captionExpired(1000, 9000, false)).toBe(true);
  });

  it('缺省问注册进来的 `voiceBusy`（未注册 = 不在响 ⇒ 恰好 2000 ms）', () => {
    expect(captionExpired(0, 2000)).toBe(true);
    let busy = true;
    setVoiceBusyProbe(() => busy);
    expect(captionExpired(0, 5000)).toBe(false);
    busy = false;
    expect(captionExpired(0, 5000)).toBe(true);
  });

  it('main.ts：「语音还在响」带音效档闸（`[0x49715b] == 0` ⇒ 不问）；各屏接上同一条判据', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain("() => options.sound > 0 && lastVoiceCode !== null && sound.isPlaying('Speaking.mkf', lastVoiceCode),");
    expect(main).toContain("if (bubble === null || captionExpired(loanBubbleAt, now)) {");
    expect(main).toContain('reminderTick(reminderUi, now, reminderName(), voiceBusy())');
    expect(main).toContain('shopBubbleExpired(ui.bubble, ui.closing, now, voiceBusy())');
    expect(main).toContain('if (bailClerk !== null && now >= bailClerk.until && !voiceBusy()) {');
    // 音效档 0 时连按时长撑也不撑（原版那时根本不放语音）
    expect(main).toMatch(/function voiceDurationOf\(text: string\): number \| null \{\n[^\n]*\n  if \(options\.sound <= 0\) return null;/);
  });
});

describe('★ playVoiceCode：解析 + 播语音 + 返回正文', () => {
  it('★ 低编号（< 1050）也会播 —— 这正是以前一声不响的那批', () => {
    const played: number[] = [];
    setVoiceSink((v) => played.push(v));
    expect(playVoiceCode('#0004歡迎下次再來！')).toBe('歡迎下次再來！');
    expect(playVoiceCode('#0010謝謝惠顧！')).toBe('謝謝惠顧！');
    expect(playVoiceCode('#0036行動要快喔！')).toBe('行動要快喔！');
    expect(played).toEqual([4, 10, 36]); // ★ 原样取值、无偏移
  });

  it('★ `#NNNN@DD` 照样播语音，`@DD` 留在正文里', () => {
    const played: number[] = [];
    setVoiceSink((v) => played.push(v));
    expect(playVoiceCode('#1347@04')).toBe('@04');
    expect(played).toEqual([1347]);
  });

  it('没有前缀 ⇒ 不播、正文原样', () => {
    const played: number[] = [];
    setVoiceSink((v) => played.push(v));
    expect(playVoiceCode('普通台词')).toBe('普通台词');
    expect(played).toEqual([]);
  });

  it('未注册 sink 时静默但正文照剥（单测 / headless 场景）', () => {
    expect(hasVoiceSink()).toBe(false);
    expect(playVoiceCode('#0004x')).toBe('x');
  });
});
