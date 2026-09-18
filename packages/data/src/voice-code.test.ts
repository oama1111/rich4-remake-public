/*
 * `#NNNN` 语音码解析 —— 以 rich4.exe 的两处解析点为基准
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { VOICE_CODE_PREFIX_LEN, parseVoiceCode, stripVoiceCode } from './voice-code.ts';

describe('★ parseVoiceCode：原样取值、无偏移（@source 0x0044fabc / 0x0044ef41）', () => {
  it('前缀恒为 5 个字符（`#` + 4 位）', () => {
    expect(VOICE_CODE_PREFIX_LEN).toBe(5);
  });

  it('★ 低编号**原样**取值，不加任何偏移', () => {
    // 这几个正是「以前永远不播」的那一批（610 个低编号里的代表）
    expect(parseVoiceCode('#0004歡迎下次再來！')).toEqual({ voice: 4, rest: '歡迎下次再來！' });
    expect(parseVoiceCode('#0010謝謝惠顧！')).toEqual({ voice: 10, rest: '謝謝惠顧！' });
    expect(parseVoiceCode('#0036行動要快喔！')).toEqual({ voice: 36, rest: '行動要快喔！' });
    expect(parseVoiceCode('#1049...')).toEqual({ voice: 1049, rest: '...' });
  });

  it('★ 角色台词表的号也是原样取值（1050..1373）', () => {
    expect(parseVoiceCode('#1050別忌妒我！')).toEqual({ voice: 1050, rest: '別忌妒我！' });
    expect(parseVoiceCode('#1347@04')).toEqual({ voice: 1347, rest: '@04' });
    expect(parseVoiceCode('#1373@01')).toEqual({ voice: 1373, rest: '@01' });
  });

  it('★ `#NNNN@DD` 是「播语音 + 画表情」两件事，解析后 `@DD` 留在正文里', () => {
    const r = parseVoiceCode('#1347@04');
    expect(r.voice).toBe(1347); // ★ 照样有语音（原版在表情分支里也 call play_speech）
    expect(r.rest).toBe('@04'); // 表情图号由调用方继续解析
  });

  it('没有前缀时 voice 为 null、正文原样', () => {
    expect(parseVoiceCode('普通台词')).toEqual({ voice: null, rest: '普通台词' });
    expect(parseVoiceCode('')).toEqual({ voice: null, rest: '' });
  });

  it('那 4 位不全是数字 ⇒ 不剥前缀、不猜语音号（有意偏离原版）', () => {
    // 原版会照样算出一个垃圾值再 play_speech；本实现选择"不播 + 保留原文便于排查"
    expect(parseVoiceCode('#12a4abc')).toEqual({ voice: null, rest: '#12a4abc' });
    expect(parseVoiceCode('#12')).toEqual({ voice: null, rest: '#12' });
  });

  it('stripVoiceCode 与 `parseVoiceCode().rest` 等价', () => {
    for (const s of ['#0004x', '#1347@04', '普通', '#12a4']) {
      expect(stripVoiceCode(s)).toBe(parseVoiceCode(s).rest);
    }
  });
});
