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
import { MidiFormatError, parseMidi } from '@rich4/assets-pipeline';
import { FakeAudioContext } from './fake-webaudio.ts';
import { MusicPlayer, OscillatorVoice } from './music.ts';
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
 * | 0.25 s | note 71 起、**9 号通道 note 36 起**（振荡器后端要跳过） |
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
 * node 里没有 `window`，而 `MusicPlayer` 用的是 `window.setInterval`。
 * 只补这两个定时器；真浏览器里当然是本尊。
 */
beforeAll(() => {
  vi.stubGlobal('window', {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: number) => clearInterval(id),
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
    // 三个旋律音；9 号通道那个鼓**不排**
    expect(ctx.sources).toHaveLength(3);
    player.stop();
    expect(player.playing).toBe(false);
  });

  it('GM 音色号按大类选波形 —— 旋律/节奏/时值精确，音色只是近似', () => {
    const { player, ctx } = readyPlayer();
    player.play('test.mid', SONG);
    for (const src of ctx.sources) {
      expect((src as unknown as { type?: string }).type).toBe('triangle');
    }
    expect(player.usingSoundFont).toBe(false);
    player.stop();
  });

  it('音符的起始时刻来自 SMF 的 tick（480 tpqn、120 BPM）', () => {
    const { player, ctx } = readyPlayer();
    player.play('test.mid', SONG);
    const [first, second, third] = ctx.sources;
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
    expect(ctx.sources).toHaveLength(3);

    player.setSoundFont(parseSoundFont(buildTestSf2()));
    expect(player.usingSoundFont).toBe(true);
    // 换了后端要重排这一首（不静音）
    expect(ctx.sources).toHaveLength(6);
    expect(ctx.sources.slice(0, 3).every((s) => s.stopped)).toBe(true);

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
