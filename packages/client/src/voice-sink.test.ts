/*
 * 语音出口 —— 解析 + 触发播放
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasVoiceSink, playVoiceCode, setVoiceSink } from './voice-sink.ts';

afterEach(() => setVoiceSink(null));

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
