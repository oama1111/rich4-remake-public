/*
 * `SoundPlayer.durationOf` —— 给台词队列撑时长用（T-052）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版 `_rich4_player_say` 的收尾是「**等声音停** → 再 `fcn_004544f6(0x3e8)` 等
 * 1000 ms」（VA 0x00454520 起的 `PeekMessage` + `timeGetTime` 循环）。
 * 本引擎的字幕与语音是**并行**的，长句会出现「字先没了、声音还在」——
 * 故 `main.ts` 起播后问一次时长、把这一段撑长（`SpeechQueue.extend`）。
 *
 * 这一条钉的是：**纯查询、不触发加载、缺档案也不炸**。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SoundPlayer, VOICE_RETRIGGER_GAP_MS, VoiceChannel, shouldRetriggerVoice } from './audio.ts';

describe('★ `durationOf` —— 给台词队列撑时长用（T-052 的 Q-SPEECH-6/9）', () => {
  it('没解码好 / 没播过 → null（纯查询，不触发加载）', () => {
    const p = new SoundPlayer();
    expect(p.durationOf('Speaking.mkf', 1050)).toBeNull();
    expect(p.durationOf('Effect.mkf', 0)).toBeNull();
  });

  it('⚠️ 不装档案时 `play` 是安静的、`durationOf` 仍为 null（不炸）', () => {
    const p = new SoundPlayer();
    expect(() => p.play('Speaking.mkf', 1050)).not.toThrow();
    expect(p.durationOf('Speaking.mkf', 1050)).toBeNull();
  });

  it('同一路问两次都是 null（不因为问过就变成 0 或抛错）', () => {
    const p = new SoundPlayer();
    p.durationOf('Speaking.mkf', 1347);
    expect(p.durationOf('Speaking.mkf', 1347)).toBeNull();
  });

  it('`isPlaying`：没解锁/没播过时 false，且是个纯查询（不炸）', () => {
    const p = new SoundPlayer();
    expect(p.isPlaying('Speaking.mkf', 55)).toBe(false);
    expect(() => p.play('Speaking.mkf', 55)).not.toThrow();
    // 未解锁 / 档案没装 ⇒ 播放请求被丢掉，不能反过来把「正在响」记成真
    expect(p.isPlaying('Speaking.mkf', 55)).toBe(false);
    expect(p.isPlaying('Effect.mkf', 55)).toBe(false);
  });
});

/**
 * ★ 用户报的「进入魔法屋后没有女巫语音」。
 *
 * `#NNNN` 的语音触发挂在**绘制**里（原版 `drawText_colorcode` → `play_speech`），
 * 而复刻是整屏每帧重画：实测魔法屋入口台词 2 秒被画 126 次，同一句于是被
 * `Stop → Play` 上百次，永远只响头几十毫秒。这个去抖就是那一条的解药。
 */
describe('★ `#NNNN` 语音去抖 —— 每帧重放不再把同一句踩成静音', () => {
  it('换号立刻放；同一号在间隔内重复请求被忽略；过了间隔允许重起', () => {
    expect(shouldRetriggerVoice(null, 0, 55, 1000, false)).toBe(true);
    // 同一句：16 ms 后（下一帧）不重起
    expect(shouldRetriggerVoice(55, 1000, 55, 1016, false)).toBe(false);
    // 同一号、但已经过了去抖间隔（例如画出屏幕再回来）→ 允许重起
    expect(shouldRetriggerVoice(55, 1000, 55, 1000 + VOICE_RETRIGGER_GAP_MS, false)).toBe(true);
    // 换一句立刻放
    expect(shouldRetriggerVoice(55, 1000, 56, 1016, false)).toBe(true);
  });

  it('★ 同一句**还在响**时，无论隔多久都不重起（长语音不能被砍成结巴）', () => {
    // 实测：4.6 s 的女巫语音只按时间去抖会被每 500 ms 砍掉重放 —— 正是这一条挡住
    expect(shouldRetriggerVoice(55, 1000, 55, 1000 + VOICE_RETRIGGER_GAP_MS, true)).toBe(false);
    expect(shouldRetriggerVoice(55, 1000, 55, 999999, true)).toBe(false);
    // ⚠️ `isPlaying` 问的是**这一次请求的那一号**：同一号响完之后
    //   （`isPlaying === false`）且隔得久了，才允许再放一遍。
    expect(shouldRetriggerVoice(55, 1000, 55, 1000 + VOICE_RETRIGGER_GAP_MS, false)).toBe(true);
  });

  it('间隔默认 500 ms：远大于一帧、远小于一句台词', () => {
    expect(VOICE_RETRIGGER_GAP_MS).toBeGreaterThan(16 * 4);
    expect(VOICE_RETRIGGER_GAP_MS).toBeLessThanOrEqual(1000);
  });
});

/**
 * ★ 主机接线（源码结构断言）—— 与 `bgm-wiring.test.ts` 同一手法：
 *   这两处都在 `main.ts` 的宿主代码里，没有可注入的 env，只能钉住源码那一行。
 */
describe('★ `main.ts` 主机接线 —— 解锁 / 语音出口', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('第一次用户交互就解锁：四种事件 + capture + once，并注册到 boot', () => {
    expect(src).toContain('function bindAudioUnlock()');
    for (const type of ["'pointerdown'", "'keydown'", "'click'", "'touchstart'"]) {
      expect(src, type).toContain(type);
    }
    expect(src).toContain('once: true, capture: true');
    expect(src).toContain('bindAudioUnlock();');
    // 解锁后按屏补播（标题 = MIDI01）
    expect(src).toContain('shouldResumeAfterUnlock(screen, music.current)');
  });

  it('★ 语音出口会按需装载 Speaking.mkf，并按去抖间隔决定重起', () => {
    const at = src.indexOf('setVoiceSink(');
    expect(at).toBeGreaterThan(-1);
    const sinkBlock = src.slice(at, at + 1200);
    // 魔法屋女巫那三句 `#0037/#0038/#0039` 走的就是这个 sink
    expect(sinkBlock, '语音出口要按需拉 Speaking.mkf').toContain('ensureSpeakingArchive();');
    expect(sinkBlock, '同一句不能每帧重起').toContain('shouldRetriggerVoice(');
  });
});

describe('★★ 第二十六份 panel：语音只有一路（`[0x47e750]`；`0x45441a` 起播前 `0x0045442e call 0x454493`）', () => {
  function fake() {
    const playing = new Set<number>();
    const log: string[] = [];
    const ch = new VoiceChannel({
      play: (r) => {
        playing.add(r);
        log.push(`play ${r}`);
      },
      stop: (r) => {
        playing.delete(r);
        log.push(`stop ${r}`);
      },
      isPlaying: (r) => playing.has(r),
    });
    return { ch, playing, log };
  }

  it('起一句新的 ⇒ 正在响的上一句当场停；任何时刻至多一句在响', () => {
    const { ch, playing, log } = fake();
    ch.play(131);
    ch.play(12);
    expect(log).toEqual(['play 131', 'stop 131', 'play 12']);
    expect([...playing]).toEqual([12]);
    expect(ch.current).toBe(12);
  });

  it('上一句已经放完就不再 stop；同一句重起交给播放器自己的 Stop→Play', () => {
    const { ch, playing, log } = fake();
    ch.play(5);
    playing.delete(5); // 自然放完
    ch.play(6);
    ch.play(6);
    expect(log).toEqual(['play 5', 'play 6', 'play 6']);
  });

  it('`busy` / `stop` 只认这一路最近起的那一句（`0x4544b9` / `0x454493`）', () => {
    const { ch, playing } = fake();
    expect(ch.busy()).toBe(false);
    ch.play(37);
    expect(ch.busy()).toBe(true);
    ch.stop();
    expect(ch.busy()).toBe(false);
    expect(playing.size).toBe(0);
    ch.stop(); // 已停：不再重复停
  });
});
