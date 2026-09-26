/*
 * 背景音乐排程 —— 回退路径与 SoundFont 切换
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一支测的是**排程**：有没有把音符排出去、后端换了没有。
 *   node 里没有真 AudioContext，用 `fake-webaudio.ts` 记账。
 *
 * 重点关注的一条：**没有音色库也必须出声** —— 这是 Q8 的硬要求
 * （「绝不能因为没音色库就播不出声」）。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MidiFormatError, MIDI_PLAYLIST, parseMidi } from '@rich4/assets-pipeline';
import { FakeAudioContext, type FakeOscillator, type FakeSource } from './fake-webaudio.ts';
import { MusicPlayer, OscillatorVoice, drumKindFor, drumSpec, shouldResumeAfterUnlock } from './music.ts';
import { buildTestSf2 } from './sf2-fixture.ts';
import { parseSoundFont } from './soundfont.ts';
import { SoundFontVoice } from './soundfont-voice.ts';

// ------------------------------------------------------------
//  手搓一份最小 SMF（不依赖任何素材）
// ------------------------------------------------------------

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  return out;
}

interface TestMidiEvent {
  /** 距离上一个事件的 tick 数 */
  delta: number;
  bytes: readonly number[];
}

function trackChunk(events: readonly TestMidiEvent[]): Uint8Array {
  const data: number[] = [];
  for (const e of events) data.push(...vlq(e.delta), ...e.bytes);
  data.push(...vlq(0), 0xff, 0x2f, 0x00); // End of Track
  const out: number[] = [];
  out.push(0x4d, 0x54, 0x72, 0x6b); // 'MTrk'
  out.push(
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
  );
  out.push(...data);
  return Uint8Array.from(out);
}

/** 单轨、480 tpqn、120 BPM（一个四分音符 = 500 ms），用来卡时值 */
function wrapMidi(track: Uint8Array): Uint8Array {
  const head = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0, 0, 0, 6, // 长度 6
    0, 0, // 格式 0
    0, 1, // 1 条轨
    0x01, 0xe0, // 480 tpqn
  ];
  return Uint8Array.from([...head, ...track]);
}

/**
 * ⚠️ 状态字节 = `0x90 | channel`：**9 号打击乐通道是 `0x99`**。
 *   写成 `[0x90, 9, 36, 100]` 不是「9 号通道」，而是「0 号通道弹 9 号音、力度 36」
 *   后面再跟一个 100 的裸字节 —— 整条流的对齐就此错开，非常难查。
 */
const noteOn = (channel: number, note: number, velocity: number): number[] => [
  0x90 | channel,
  note,
  velocity,
];
const noteOff = (channel: number, note: number): number[] => [0x80 | channel, note, 0x40];
const program = (channel: number, program: number): number[] => [0xc0 | channel, program];

/**
 * 布局（480 tpqn、120 BPM ⇒ 480 tick = 0.5 s）：
 *
 * | 时刻 | 事件 |
 * |---|---|
 * | 0.00 s | program 0 + note 69 起 |
 * | 0.25 s | note 71 起、**9 号通道 note 36 起**（kick；振荡器后端按 GM 鼓号合成） |
 * | 1.00 s | note 73 起 |
 * | 1.25 s | 69 / 71 / 鼓 收 |
 * | 1.75 s | 73 收 |
 */
const SONG = wrapMidi(
  trackChunk([
    { delta: 0, bytes: program(0, 0) }, // Acoustic Grand Piano
    { delta: 0, bytes: noteOn(0, 69, 100) },
    { delta: 240, bytes: noteOn(0, 71, 80) }, // +0.25 s
    { delta: 0, bytes: noteOn(9, 36, 100) }, // ★ 打击乐（通道 9）
    { delta: 720, bytes: noteOn(0, 73, 60) }, // +1.0 s
    { delta: 240, bytes: noteOff(0, 69) }, // +1.25 s
    { delta: 0, bytes: noteOff(0, 71) },
    { delta: 0, bytes: noteOff(9, 36) },
    { delta: 240, bytes: noteOff(0, 73) }, // +1.75 s
  ]),
);

/**
 * node 里没有 `window`，而 `MusicPlayer` 用的是 `window.setInterval`；
 * `unlock()` 还要 `window.AudioContext`（浏览器手势那一条，测试里用假的顶上）。
 * 只补这三个；真浏览器里当然是本尊。
 */
beforeAll(() => {
  vi.stubGlobal('window', {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: number) => clearInterval(id),
    AudioContext: FakeAudioContext,
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** 把假 AudioContext 挂到播放器（`unlock()` 要真的浏览器手势，测试里绕过） */
function readyPlayer(): { player: MusicPlayer; ctx: FakeAudioContext } {
  const player = new MusicPlayer();
  const ctx = new FakeAudioContext();
  const master = ctx.createGain();
  player.attach(ctx as unknown as AudioContext, master as unknown as GainNode);
  return { player, ctx };
}

describe('回退路径：没有音色库也要出声', () => {
  it('默认（没装音色库）用振荡器后端，音符照排', () => {
    const { player, ctx } = readyPlayer();
    expect(player.usingSoundFont).toBe(false);
    player.play('test.mid', SONG);
    expect(player.playing).toBe(true);
    expect(player.current).toBe('test.mid');
    // 三个旋律音 + **9 号通道那一个鼓**（kick = 一个下滑正弦，见下一组测试）
    expect(ctx.sources).toHaveLength(4);
    player.stop();
    expect(player.playing).toBe(false);
  });

  it('GM 音色号按大类选波形 —— 旋律/节奏/时值精确，音色只是近似', () => {
    const { player, ctx } = readyPlayer();
    player.play('test.mid', SONG);
    // 只挑旋律音（0/1/3 号节点；2 号是 9 号通道的鼓，见下一组）
    for (const src of [ctx.sources[0], ctx.sources[1], ctx.sources[3]]) {
      expect((src as unknown as { type?: string }).type).toBe('triangle');
    }
    expect(player.usingSoundFont).toBe(false);
    player.stop();
  });

  it('音符的起始时刻来自 SMF 的 tick（480 tpqn、120 BPM）', () => {
    const { player, ctx } = readyPlayer();
    player.play('test.mid', SONG);
    const [first, second, , third] = ctx.sources;
    expect(first!.starts[0]!.when).toBeCloseTo(0.1, 6); // startedAt = currentTime + 0.1
    expect(second!.starts[0]!.when).toBeCloseTo(0.35, 6); // + 240 tick = 0.25 s
    expect(third!.starts[0]!.when - first!.starts[0]!.when).toBeCloseTo(1.0, 6);
    player.stop();
  });

  it('频率按 69 = A4 = 440Hz 算', () => {
    const { player, ctx } = readyPlayer();
    player.play('test.mid', SONG);
    const freq = (ctx.sources[0] as unknown as { frequency: { value: number } }).frequency.value;
    expect(freq).toBeCloseTo(440, 6);
    player.stop();
  });

  it('解析不了的字节不让播放器抛，也不留个「在放」的假状态', () => {
    const { player, ctx } = readyPlayer();
    expect(() => player.play('bad.mid', Uint8Array.from([1, 2, 3]))).not.toThrow();
    // 解析失败就**不留「在放」的假状态**：什么都不排、`playing` 也是假
    expect(player.playing).toBe(false);
    expect(player.current).toBe('');
    expect(ctx.sources).toHaveLength(0);
    player.stop();
  });

  it('parseMidi 的夹具本身是合法的（否则上面几条都测不到东西）', () => {
    const song = parseMidi(SONG);
    expect(song.format).toBe(0);
    expect(song.ticksPerQuarter).toBe(480);
    expect(song.notes).toHaveLength(4);
    expect(song.notes[0]).toMatchObject({ note: 69, velocity: 100, channel: 0, program: 0 });
    expect(song.notes[0]!.time).toBeCloseTo(0, 9);
    expect(song.notes[0]!.duration).toBeCloseTo(1.25, 6);
    expect(song.notes[2]!.channel).toBe(9);
    expect(song.notes[3]!.time).toBeCloseTo(1, 6);
    expect(() => parseMidi(Uint8Array.from([0, 1, 2, 3]))).toThrow(MidiFormatError);
  });
});

describe('SoundFont 后端', () => {
  it('装了音色库就用 SoundFontVoice，并按采样率建 AudioBuffer', () => {
    const { player, ctx } = readyPlayer();
    const font = parseSoundFont(buildTestSf2({ sampleRate: 22050 }));
    player.setSoundFont(font);
    expect(player.usingSoundFont).toBe(true);
    expect(player.soundFontName).toBe('測試音色庫');
    player.play('test.mid', SONG);
    // 三个旋律音都落同一个样本（只是音高不同），缓冲只建一次
    expect(ctx.buffers).toHaveLength(1);
    expect(ctx.buffers[0]!.sampleRate).toBe(22050);
    expect(ctx.sources).toHaveLength(3);
    expect(ctx.sources[0]!.buffer).toBe(ctx.buffers[0]);
    player.stop();
  });

  it('变调交给 playbackRate（根音 69 → 弹 69 就是 1.0）', () => {
    const { player, ctx } = readyPlayer();
    player.setSoundFont(parseSoundFont(buildTestSf2({ rootKey: 69 })));
    player.play('test.mid', SONG);
    expect(ctx.sources[0]!.playbackRate.value).toBeCloseTo(1, 9); // 弹 69
    expect(ctx.sources[1]!.playbackRate.value).toBeCloseTo(Math.pow(2, 2 / 12), 9); // 弹 71
    expect(ctx.sources[2]!.playbackRate.value).toBeCloseTo(Math.pow(2, 4 / 12), 9); // 弹 73
    player.stop();
  });

  it('sampleModes 1/3 才开循环，循环点已经换算到缓冲区坐标', () => {
    const { player, ctx } = readyPlayer();
    const font = parseSoundFont(
      buildTestSf2({
        instrumentZones: [[[43, 0x7f00], [54, 1]]],
        loopStart: 2,
        loopEnd: 6,
      }),
    );
    player.setSoundFont(font);
    player.play('test.mid', SONG);
    const src = ctx.sources[0]!;
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBe(2);
    expect(src.loopEnd).toBe(6);
    player.stop();
  });

  it('没有音区/没对应预设的音**安静地不出声**，不抛也不冒充', () => {
    const { player, ctx } = readyPlayer();
    // 预设只在 bank 0；9 号通道的音要 bank 128 —— 音色库里没有 → 不出声
    player.setSoundFont(parseSoundFont(buildTestSf2()));
    player.play('test.mid', SONG);
    expect(ctx.sources).toHaveLength(3);
    player.stop();
  });

  it('打击乐走 bank 128 的鼓组（有对应音符号时才排得出来）', () => {
    const { player, ctx } = readyPlayer();
    // 鼓组预设的音符号是 35，而曲子里那个鼓是 36 → 命中不了，仍只有 3 个旋律音
    player.setSoundFont(parseSoundFont(buildTestSf2({ drumKit: true, drumNote: 35 })));
    player.play('test.mid', SONG);
    expect(ctx.sources).toHaveLength(3);
    player.stop();

    // 把鼓组改成音符号 36 → 多出那一个鼓
    const { player: p2, ctx: c2 } = readyPlayer();
    p2.setSoundFont(parseSoundFont(buildTestSf2({ drumKit: true, drumNote: 36 })));
    p2.play('test.mid', SONG);
    expect(c2.sources).toHaveLength(4);
    p2.stop();
  });

  it('stop() 真的把已排出去的音掐掉（不是只关定时器）', () => {
    const { player, ctx } = readyPlayer();
    player.setSoundFont(parseSoundFont(buildTestSf2()));
    player.play('test.mid', SONG);
    expect(ctx.sources.every((s) => !s.stopped)).toBe(true);
    player.stop();
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
  });

  it('播放中换音色库：从头重排，且换回振荡器也照排', () => {
    const { player, ctx } = readyPlayer();
    player.play('test.mid', SONG);
    // 振荡器：3 个旋律 + 1 个鼓
    expect(ctx.sources).toHaveLength(4);

    player.setSoundFont(parseSoundFont(buildTestSf2()));
    expect(player.usingSoundFont).toBe(true);
    // 换了后端要重排这一首（不静音）：音色库没有鼓组 ⇒ 只排 3 个旋律音
    expect(ctx.sources).toHaveLength(7);
    expect(ctx.sources.slice(0, 4).every((s) => s.stopped)).toBe(true);

    player.clearSoundFont();
    expect(player.usingSoundFont).toBe(false);
    player.stop();
  });

  it('两个后端都实现同一个 MidiVoice 接口（可互换）', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = new OscillatorVoice(
      ctx as unknown as AudioContext,
      dest as unknown as AudioNode,
    );
    expect(typeof voice.schedule).toBe('function');
    const sf = new SoundFontVoice(
      ctx as unknown as AudioContext,
      dest as unknown as AudioNode,
      parseSoundFont(buildTestSf2()),
    );
    expect(typeof sf.schedule).toBe('function');
    sf.schedule(
      { time: 0, duration: 0.5, note: 60, velocity: 100, channel: 0, program: 0 },
      0,
    );
    expect(ctx.sources).toHaveLength(1);
    sf.stop();
    expect(ctx.sources[0]!.stopped).toBe(true);
  });

  it('★ 互斥组（gen 57）：同组新音一响，旧音在**新音起点**让位（开镲切闭镲）', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    // 乐器层带 gen 57 = 3；两条音都用这一条 zone
    const voice = new SoundFontVoice(
      ctx as unknown as AudioContext,
      dest as unknown as AudioNode,
      parseSoundFont(buildTestSf2({ instrumentZones: [[[57, 3], [43, 0x7f00]]] })),
    );
    const note = { time: 0, duration: 1, note: 60, velocity: 100, channel: 0, program: 0 };
    voice.schedule(note, 0); // 第一声（开镲）
    voice.schedule(note, 0.25); // 0.25 s 后同组第二声（闭镲）→ 第一声必须停在 0.25
    expect(ctx.sources).toHaveLength(2);
    const [first, second] = ctx.sources;
    // 第一声被掐：`stop(0.25)`（排程时排的是 1.02 那个收尾时刻，另记在 stops 里）
    expect(first!.stops).toContain(0.25);
    // 包络也在 0.25 归零（`#silence` 先 cancel 再 setValueAtTime(0)）。
    // ⚠️ `ctx.gains[0]` 是 destination 那只，音自己的包络从 1 号起。
    const zero = ctx.gains
      .flatMap((g) => g.gain.events)
      .find((e) => e.kind === 'set' && e.value === 0 && e.time === 0.25);
    expect(zero, '旧音的包络要在 0.25 归零').toBeDefined();
    // 第二声照常响、没有被打断
    expect(second!.stops.some((t) => t > 1)).toBe(true);
  });

  it('★ 互斥组 0（规范默认）= 不参与抢占：两声照旧各响各的 @source §9.6.3', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const voice = new SoundFontVoice(
      ctx as unknown as AudioContext,
      dest as unknown as AudioNode,
      parseSoundFont(buildTestSf2()), // 没声明 gen 57
    );
    const note = { time: 0, duration: 1, note: 60, velocity: 100, channel: 0, program: 0 };
    voice.schedule(note, 0);
    voice.schedule(note, 0.25);
    const [first] = ctx.sources;
    // 第一声仍然只被排了「音符尾巴」那一次 stop（1.02），没有被 0.25 掐
    expect(first!.stops).not.toContain(0.25);
  });
});

// ------------------------------------------------------------
//  ★ 兜底后端的打击乐 —— 9 号通道不再被丢（用户报的「节拍拖沓」）
// ------------------------------------------------------------

function drumVoice(): { voice: OscillatorVoice; ctx: FakeAudioContext } {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();
  const voice = new OscillatorVoice(ctx as unknown as AudioContext, dest as unknown as AudioNode);
  return { voice, ctx };
}

/** 一个 9 号通道（打击乐）音符 */
const drumNote = (note: number, duration = 1) => ({
  time: 0,
  duration,
  note,
  velocity: 100,
  channel: 9,
  program: 0,
});

/** 一个节点从起播到收尾的排程长度（秒） */
function lifetime(s: FakeSource): number {
  return Math.max(...s.stops) - s.starts[0]!.when;
}

describe('★ 兜底后端的打击乐（9 号通道）', () => {
  it('GM 鼓号归到合成音色类别；没列出的鼓号也**不丢**', () => {
    expect(drumKindFor(36)).toBe('kick');
    expect(drumKindFor(38)).toBe('snare');
    expect(drumKindFor(42)).toBe('hat');
    expect(drumKindFor(46)).toBe('openhat');
    expect(drumKindFor(45)).toBe('tom');
    expect(drumKindFor(49)).toBe('crash');
    // ⚠️ 兜底类别（以前整条通道返回 ⇒ 0 个节点）
    expect(drumKindFor(31)).toBe('shaker');
  });

  it('打击乐配方：attack 短、decay 有限（鼓是敲一下，不是按住）', () => {
    const kinds = ['kick', 'snare', 'clap', 'stick', 'hat', 'openhat', 'tom', 'crash', 'ride', 'metal', 'shaker'] as const;
    for (const kind of kinds) {
      const spec = drumSpec(kind);
      expect(spec.attack, kind).toBeLessThanOrEqual(0.01);
      expect(spec.decay, kind).toBeLessThanOrEqual(1);
      expect(spec.peak, kind).toBeGreaterThan(0);
      // 每一类都得有**至少一个**发声面（噪声或音调），否则就是「排了但没声」
      expect(spec.noise > 0 || spec.tone !== null, kind).toBe(true);
    }
  });

  it('★ kick（36）排出一条低频下滑的正弦 —— 不再是 0 个节点', () => {
    const { voice, ctx } = drumVoice();
    voice.schedule(drumNote(36), 0);
    expect(ctx.sources).toHaveLength(1);
    const osc = ctx.sources[0] as FakeOscillator;
    expect(osc.type).toBe('sine');
    const freqs = osc.frequency.events.map((e) => e.value);
    expect(freqs[0]!).toBeGreaterThan(freqs[freqs.length - 1]!);
    voice.stop();
  });

  it('snare（38）是「噪声 + 音调」两面；hat（42）只有噪声', () => {
    const { voice, ctx } = drumVoice();
    voice.schedule(drumNote(38), 0);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources.filter((s) => s.buffer !== null)).toHaveLength(1);
    expect(ctx.sources.filter((s) => (s as FakeOscillator).type !== undefined)).toHaveLength(1);
    voice.stop();

    const { voice: v2, ctx: c2 } = drumVoice();
    v2.schedule(drumNote(42), 0);
    expect(c2.sources).toHaveLength(1);
    expect(c2.sources[0]!.buffer).not.toBeNull();
    v2.stop();
  });

  it('★ 打击乐的有效时长远短于旋律音（鼓按自己的余韵收，不跟 MIDI 时值）', () => {
    const { voice, ctx } = drumVoice();
    voice.schedule(drumNote(36, 4), 0); // 4 秒的「长」鼓
    voice.schedule({ time: 0, duration: 4, note: 60, velocity: 100, channel: 0, program: 0 }, 0);
    const drumLife = lifetime(ctx.sources[0]!);
    const melodyLife = lifetime(ctx.sources[1]!);
    expect(drumLife).toBeLessThan(0.35);
    expect(melodyLife).toBeGreaterThan(3.9);
    expect(melodyLife / drumLife).toBeGreaterThan(10);
    voice.stop();
  });

  it('整条通道的鼓号都能排出节点（改回「跳过通道 9」这一条立刻变红）', () => {
    const { voice, ctx } = drumVoice();
    for (const n of [36, 38, 42, 46, 45, 49, 51, 56, 70]) voice.schedule(drumNote(n), 0);
    expect(ctx.sources.length).toBeGreaterThanOrEqual(9);
    voice.stop();
  });

  it('同时发声音数越多峰値越低（`1/sqrt(n)` 的 duck）', () => {
    const { voice, ctx } = drumVoice();
    voice.schedule(drumNote(36), 0);
    voice.schedule(drumNote(36), 0.1);
    const peaks = ctx.gains
      .flatMap((g) => g.gain.events)
      .filter((e) => e.kind === 'linear')
      .map((e) => e.value);
    expect(peaks).toHaveLength(2);
    expect(peaks[1]!).toBeLessThan(peaks[0]!);
    voice.stop();
  });
});

// ------------------------------------------------------------
//  ★ 解锁前点播 → 解锁后立刻补播（用户报的「BGM 要点击一下才播」）
// ------------------------------------------------------------

describe('★ 解锁后立刻补播（autoplay 政策）', () => {
  it('`shouldResumeAfterUnlock`：标题点 MIDI01，其它屏退回清单第一首，已有曲子不打断', () => {
    expect(shouldResumeAfterUnlock('title', '')).toBe('midi01.mid');
    expect(shouldResumeAfterUnlock('game', '')).toBe(MIDI_PLAYLIST[0]);
    expect(shouldResumeAfterUnlock('title', 'midi08.mid')).toBeNull();
    expect(shouldResumeAfterUnlock('game', 'Rich16.mid')).toBeNull();
  });

  it('★ 未解锁时 `play()` 记下曲子；`unlock()` 后立刻 `playing === true` 且音符已排', () => {
    const spy = vi.spyOn(FakeAudioContext.prototype, 'createOscillator');
    const player = new MusicPlayer();
    // 浏览器手势之外不许出声：这时点播只能**记下来**
    player.play('midi01.mid', SONG);
    expect(player.current).toBe('midi01.mid');
    expect(player.pending).toBe(true);
    expect(player.playing).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    player.unlock(); // ← 模拟第一次用户手势
    expect(player.pending).toBe(false);
    expect(player.playing).toBe(true);
    expect(player.current).toBe('midi01.mid');
    // 「立刻拿到一首曲子」不只是状态：音符真的排到了 AudioContext 上
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    player.stop();
    expect(player.playing).toBe(false);
  });

  it('解锁前的点播被后一首覆盖（旧的那首不会冒出来）', () => {
    const player = new MusicPlayer();
    player.play('a.mid', SONG);
    player.play('b.mid', SONG);
    expect(player.current).toBe('b.mid');
    player.unlock();
    expect(player.current).toBe('b.mid');
    expect(player.playing).toBe(true);
    player.stop();
  });

  it('坏字节不留 pending（解锁后也不会诈尸出声）', () => {
    const player = new MusicPlayer();
    player.play('bad.mid', Uint8Array.from([1, 2, 3]));
    expect(player.pending).toBe(false);
    expect(player.current).toBe('');
    player.unlock();
    expect(player.playing).toBe(false);
    player.stop();
  });
});

describe('★ 背景曲要用的三样：从半路放起 / 放到哪儿了 / 放完通知（2026-09-19）', () => {
  const setNow = (ctx: FakeAudioContext, t: number): void => {
    (ctx as unknown as { currentTime: number }).currentTime = t;
  };

  it('`play(name, data, fromS)`：起点往回挪 fromS，之前的音不排 @source `play mid from %d`', () => {
    const { player, ctx } = readyPlayer();
    player.play('bg.mid', SONG, 0.3);
    // SONG 的旋律音在 0 / 0.25 / 1.0 秒；从 0.3 秒放起 ⇒ 前两个不排
    const whens = ctx.sources.map((s) => s.starts[0]!.when);
    expect(whens.length).toBeLessThan(4);
    // 1.0 秒那个音落在 (0.1 − 0.3) + 1.0 = 0.8
    expect(whens.some((w) => Math.abs(w - 0.8) < 1e-6)).toBe(true);
    expect(whens.every((w) => w >= 0.1 - 1e-9)).toBe(true);
    player.stop();
  });

  it('`positionS`：放到第几秒（没在放 = 0）—— 场所打断背景曲时记的就是它', () => {
    const { player, ctx } = readyPlayer();
    expect(player.positionS).toBe(0);
    // 背景曲是**不循环**的（放完换下一首）。循环曲在最后一个排程窗口里起点会提前跳到下一轮，
    //   那时的「位置」没有意义 —— 也用不到（只有背景曲才记位置）。
    player.setLoop(false);
    player.play('bg.mid', SONG);
    setNow(ctx, 0.6);
    expect(player.positionS).toBeCloseTo(0.5, 6); // startedAt = 0.1
    player.stop();
    expect(player.positionS).toBe(0);
    // 从半路放起的，位置也从那儿算
    player.play('bg.mid', SONG, 0.4);
    expect(player.positionS).toBeCloseTo(0.3, 6); // (0 − (0.1 − 0.4))
    player.stop();
  });

  it('★ 不循环的曲子**真放完**才收并通知；循环的不通知', () => {
    vi.useFakeTimers();
    try {
      const { player, ctx } = readyPlayer();
      const dur = parseMidi(SONG).duration;
      let ended = 0;
      player.onEnded = () => { ended++; };
      player.setLoop(false);
      player.play('bg.mid', SONG);
      // 还差一点没放完 —— 先前这里会**提前一个排程窗口（2 秒）**就把曲子掐掉
      setNow(ctx, 0.1 + dur - 0.05);
      vi.advanceTimersByTime(600);
      expect(player.playing).toBe(true);
      expect(ended).toBe(0);
      setNow(ctx, 0.1 + dur + 0.01);
      vi.advanceTimersByTime(600);
      expect(player.playing).toBe(false);
      expect(ended).toBe(1);

      // 循环：到点回到曲头，不通知
      player.setLoop(true);
      player.play('venue.mid', SONG);
      setNow(ctx, 0.1 + dur + 5);
      vi.advanceTimersByTime(600);
      expect(player.playing).toBe(true);
      expect(ended).toBe(1);
      player.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ------------------------------------------------------------
//  ★ 弯音（第十二份試玩回報「背景音乐卡住了」）—— 解析见 `midi.ts` 文件头
//    midi07（百貨公司 / 樂透）那组 23.9 秒长音靠弯音换和弦；两个后端都得把它排到音高上。
// ------------------------------------------------------------

describe('★ 弯音排到音高上（两个后端）', () => {
  const bentNote = {
    time: 0,
    duration: 2,
    note: 69,
    velocity: 100,
    channel: 2,
    program: 50,
    bend: -1,
    bends: [
      { at: 0.5, semitones: -2 },
      { at: 1.5, semitones: 0 },
    ],
  };

  it('★★ 振荡器：起音按 `bend`、途中每条 `bends` 在「起音 + at」阶跃到对应频率', () => {
    const { voice, ctx } = drumVoice();
    voice.schedule(bentNote, 10);
    const osc = ctx.sources[0] as FakeOscillator;
    const sets = osc.frequency.events.filter((e) => e.kind === 'set');
    expect(sets.map((e) => e.time)).toEqual([10, 10.5, 11.5]);
    expect(sets[0]!.value).toBeCloseTo(440 * Math.pow(2, -1 / 12), 6);
    expect(sets[1]!.value).toBeCloseTo(440 * Math.pow(2, -2 / 12), 6);
    expect(sets[2]!.value).toBeCloseTo(440, 6);
    voice.stop();
  });

  it('振荡器：不带弯音的音符不多排任何频率事件（形状与先前一样）', () => {
    const { voice, ctx } = drumVoice();
    voice.schedule({ time: 0, duration: 1, note: 69, velocity: 100, channel: 0, program: 0 }, 0);
    const osc = ctx.sources[0] as FakeOscillator;
    expect(osc.frequency.value).toBeCloseTo(440, 6);
    expect(osc.frequency.events).toHaveLength(0);
    voice.stop();
  });

  it('★★ 音色库：弯音 × 100 音分叠到 playbackRate 上（根音 69 ⇒ 不弯 = 1.0）', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const sf = new SoundFontVoice(
      ctx as unknown as AudioContext,
      dest as unknown as AudioNode,
      parseSoundFont(buildTestSf2({ rootKey: 69 })),
    );
    // 测试音色库只有 0 号预设 ⇒ 换成 program 0（弯音与音色无关）
    sf.schedule({ ...bentNote, program: 0 }, 10);
    const src = ctx.sources[0]!;
    const sets = src.playbackRate.events.filter((e) => e.kind === 'set');
    expect(sets.map((e) => e.time)).toEqual([10, 10.5, 11.5]);
    expect(sets[0]!.value).toBeCloseTo(Math.pow(2, -1 / 12), 9);
    expect(sets[1]!.value).toBeCloseTo(Math.pow(2, -2 / 12), 9);
    expect(sets[2]!.value).toBeCloseTo(1, 9);
    sf.stop();
  });

  it('★ 经 MusicPlayer 整条链路：与 midi07 同形的长音真的被排了弯音（不再是死和弦）', () => {
    // 手搓一份与 midi07 同形的最小片段：按住 A、两拍后弯到 −2、再回中
    const song = wrapMidi(
      trackChunk([
        { delta: 0, bytes: [0xc2, 50] },
        { delta: 0, bytes: [0x92, 69, 76] },
        { delta: 960, bytes: [0xe2, 0x00, 0x00] },
        { delta: 960, bytes: [0xe2, 0x00, 0x40] },
        { delta: 960, bytes: [0x82, 69, 0] },
      ]),
    );
    const { player, ctx } = readyPlayer();
    player.play('midi07.mid', song);
    const osc = ctx.sources[0] as FakeOscillator;
    const sets = osc.frequency.events.filter((e) => e.kind === 'set');
    // 起音那一刻（不弯）+ 两次变化
    expect(sets).toHaveLength(3);
    expect(sets[0]!.time).toBeCloseTo(osc.starts[0]!.when, 9);
    expect(sets[0]!.value).toBeCloseTo(440, 6);
    expect(sets[1]!.time - osc.starts[0]!.when).toBeCloseTo(1, 6); // 960 tick = 2 拍 = 1 s
    expect(sets[1]!.value).toBeCloseTo(440 * Math.pow(2, -2 / 12), 6);
    expect(sets[2]!.value).toBeCloseTo(440, 6);
    player.stop();
  });
});
