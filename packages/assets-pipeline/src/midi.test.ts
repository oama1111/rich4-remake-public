/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * SMF 解析
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_BEND_RANGE_SEMITONES, DEFAULT_TEMPO_US, MidiFormatError, parseMidi } from './midi.ts';
import { MIDI_PLAYLIST } from './audio.ts';

const GAME = (process.env.RICH4_WORKSPACE ?? '') + '/rich4-remake/assets/game';
const has = (f: string): boolean => existsSync(`${GAME}/${f}`);
const load = (f: string): Uint8Array => new Uint8Array(readFileSync(`${GAME}/${f}`));
const run = has('midi01.mid') ? it : it.skip;

/** 手工拼一个最小的单轨 SMF */
function buildSmf(trackBytes: number[], ticksPerQuarter = 96, format = 0, ntrks = 1): Uint8Array {
  const head = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, format,
    0, ntrks,
    (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff,
  ];
  const len = trackBytes.length;
  const trk = [
    0x4d, 0x54, 0x72, 0x6b,
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...trackBytes,
  ];
  return new Uint8Array([...head, ...trk]);
}

describe('基本解析', () => {
  it('一个音：note on 之后 96 tick note off —— 恰好一个四分音符', () => {
    // 120BPM 默认速度下，一个四分音符 = 0.5 秒
    const song = parseMidi(
      buildSmf([
        0x00, 0x90, 60, 100, // t=0 note on C4
        0x60, 0x80, 60, 0,   // +96 tick note off
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]).toMatchObject({ note: 60, velocity: 100, channel: 0 });
    expect(song.notes[0]!.time).toBeCloseTo(0, 6);
    expect(song.notes[0]!.duration).toBeCloseTo(0.5, 6);
    expect(song.duration).toBeCloseTo(0.5, 6);
  });

  it('★ 力度 0 的 note on 就是 note off —— 大量文件靠这个省字节', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0x90, 64, 90,
        0x60, 0x90, 64, 0, // ← note on 力度 0
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]!.duration).toBeCloseTo(0.5, 6);
  });

  it('★ running status：省掉状态字节，沿用上一条', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0x90, 60, 100,
        0x00, 62, 100, // ← 没有状态字节
        0x60, 0x80, 60, 0,
        0x00, 0x80, 62, 0,
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes.map((n) => n.note)).toEqual([60, 62]);
  });

  it('★ tempo 变化会改变其后所有事件的时刻', () => {
    // 前半段 120BPM（0.5 秒/四分），中途改成 240BPM（0.25 秒/四分）
    const song = parseMidi(
      buildSmf([
        0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 500000us = 120BPM
        0x00, 0x90, 60, 100,
        0x60, 0x80, 60, 0,                         // +1 四分 → 0.5s
        0x00, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90, // 250000us = 240BPM
        0x00, 0x90, 62, 100,
        0x60, 0x80, 62, 0,                         // +1 四分 → 0.25s
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes[0]!.duration).toBeCloseTo(0.5, 6);
    expect(song.notes[1]!.time).toBeCloseTo(0.5, 6);
    expect(song.notes[1]!.duration).toBeCloseTo(0.25, 6);
  });

  it('program change 记在音符上', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0xc0, 48, // ← 单字节事件
        0x00, 0x90, 60, 100,
        0x60, 0x80, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes[0]!.program).toBe(48);
  });

  it('不是 SMF 就明确报错', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]))).toThrow(MidiFormatError);
    expect(() => parseMidi(new Uint8Array(20))).toThrow(MidiFormatError);
  });

  it('默认速度是 120BPM', () => {
    expect(DEFAULT_TEMPO_US).toBe(500_000);
  });
});

// ============================================================
//  ★ 弯音（第十二份試玩回報「背景音乐卡住了」）
//  先前 0xE0 整条丢掉 ⇒ 靠弯音换和弦的长音被弹成一个死和弦。
//  96 tick / 四分、120 BPM ⇒ 96 tick = 0.5 s
// ============================================================

describe('★ 弯音 0xE0 / RPN 0 / CC121', () => {
  it('缺省幅度 ±2 半音（GM1 上电值）', () => {
    expect(DEFAULT_BEND_RANGE_SEMITONES).toBe(2);
  });

  it('★★ 按住的音：途中的弯音逐条记到音符上（相对起音的秒数 + 半音）', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0x92, 69, 100, // t=0 ch2 note on A4
        0x30, 0xe2, 0x00, 0x00, // +48 tick（0.25 s）弯到最低 0x0000 = −2 半音
        0x30, 0xe2, 0x00, 0x40, // +48 tick（0.5 s）回中 0x2000
        0x30, 0x82, 69, 0, // +48 tick（0.75 s）note off
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes).toHaveLength(1);
    const n = song.notes[0]!;
    expect(n.bend).toBeUndefined(); // 起音时没弯
    expect(n.bends).toHaveLength(2);
    expect(n.bends![0]!.at).toBeCloseTo(0.25, 6);
    expect(n.bends![0]!.semitones).toBeCloseTo(-2, 9);
    expect(n.bends![1]!.at).toBeCloseTo(0.5, 6);
    expect(n.bends![1]!.semitones).toBe(0);
  });

  it('★ 起音前就弯着 ⇒ 记在 `bend` 上；别的通道的弯音不串过来', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0xe1, 0x00, 0x60, // ch1 0x3000 = +1 半音
        0x00, 0xe3, 0x00, 0x00, // ch3 弯到底（不该影响 ch1）
        0x00, 0x91, 60, 100,
        0x60, 0x81, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes[0]!.bend).toBeCloseTo(1, 9);
    expect(song.notes[0]!.bends).toBeUndefined();
  });

  it('★ RPN 0（CC101=0 / CC100=0 / CC6 半音 / CC38 音分）改幅度', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0xb0, 101, 0,
        0x00, 0xb0, 100, 0,
        0x00, 0xb0, 6, 12, // ±12 半音
        0x00, 0xb0, 38, 0,
        0x00, 0xe0, 0x00, 0x00, // 弯到底 ⇒ −12
        0x00, 0x90, 60, 100,
        0x60, 0x80, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes[0]!.bend).toBeCloseTo(-12, 9);
  });

  it('★ CC6 只在 RPN 0 选中时算幅度（选的是别的 RPN ⇒ 不动）', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0xb0, 101, 0,
        0x00, 0xb0, 100, 1, // RPN 0/1 = 微调，不是弯音幅度
        0x00, 0xb0, 6, 12,
        0x00, 0xe0, 0x00, 0x00,
        0x00, 0x90, 60, 100,
        0x60, 0x80, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    expect(song.notes[0]!.bend).toBeCloseTo(-2, 9);
  });

  it('★ CC121（Reset All Controllers）⇒ 弯音回中，按着的音也跟着回来', () => {
    const song = parseMidi(
      buildSmf([
        0x00, 0xe0, 0x00, 0x00, // −2
        0x00, 0x90, 60, 100,
        0x30, 0xb0, 121, 0, // +0.25 s 复位
        0x30, 0x80, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ]),
    );
    const n = song.notes[0]!;
    expect(n.bend).toBeCloseTo(-2, 9);
    expect(n.bends).toEqual([{ at: 0.25, semitones: 0 }]);
  });

  it('不带弯音的音符形状不变（没有 bend / bends 两个键）', () => {
    const song = parseMidi(
      buildSmf([0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00]),
    );
    expect(Object.keys(song.notes[0]!).sort()).toEqual(['channel', 'duration', 'note', 'program', 'time', 'velocity']);
  });

  run('★★ 真值：midi07（百貨公司/樂透）2 号通道那组 23.9 秒长音靠弯音在 A ↔ G 之间来回', () => {
    const song = parseMidi(load('midi07.mid'));
    const pad = song.notes.filter((n) => n.channel === 2 && n.time === 0);
    // 61/64/69 = A 大三和弦，Synth Strings（program 50），从头按住 23.9 秒
    expect(pad.map((n) => n.note).sort((a, b) => a - b)).toEqual([61, 64, 69]);
    for (const n of pad) {
      expect(n.program).toBe(50);
      expect(n.duration).toBeGreaterThan(23);
      const values = (n.bends ?? []).map((b) => b.semitones);
      // 扫到 −2 半音（= G 大三和弦）再回 0 —— 不认弯音就是 24 秒一个死和弦
      expect(Math.min(...values)).toBeCloseTo(-2, 9);
      expect(values).toContain(0);
      expect(values.length).toBeGreaterThan(100);
    }
  });
});

describe('★ 原版那 25 首都能解开', () => {
  run('每一首都解得出音符，时长合理', () => {
    for (const f of MIDI_PLAYLIST) {
      if (!has(f)) continue;
      const song = parseMidi(load(f));
      expect(song.notes.length, f).toBeGreaterThan(0);
      // 背景音乐：几十秒到几分钟之间
      expect(song.duration, f).toBeGreaterThan(1);
      expect(song.duration, f).toBeLessThan(60 * 20);
      for (const n of song.notes) {
        expect(n.note, f).toBeGreaterThanOrEqual(0);
        expect(n.note, f).toBeLessThanOrEqual(127);
        expect(n.duration, f).toBeGreaterThanOrEqual(0);
      }
    }
  });

  run('★ 清单里 25 首一首不少', () => {
    expect(MIDI_PLAYLIST).toHaveLength(25);
    const missing = MIDI_PLAYLIST.filter((f) => !has(f));
    expect(missing, `缺文件：${missing.join(', ')}`).toHaveLength(0);
  });

  run('midi01 是格式 1、120 tick/四分音符', () => {
    const song = parseMidi(load('midi01.mid'));
    expect(song.format).toBe(1);
    expect(song.ticksPerQuarter).toBe(0x78);
  });
});
