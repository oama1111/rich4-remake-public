/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 音频资源
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive } from './mkf.ts';
import { MIDI_PLAYLIST, isWave, readWaveInfo, WaveFormatError, DICE_AT, DICE_AT_BASE, DICE_SOUND, MOVE_SOUND } from './audio.ts';

const RICH4 = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4';
const have = (f: string) => (existsSync(`${RICH4}/${f}`) ? it : it.skip);
const open = (f: string) => new MkfArchive(new Uint8Array(readFileSync(`${RICH4}/${f}`)));

describe('识别', () => {
  it('非 WAVE 数据被认出来', () => {
    expect(isWave(new Uint8Array(4))).toBe(false);
    expect(isWave(new Uint8Array(0))).toBe(false);
    expect(() => readWaveInfo(new Uint8Array(16))).toThrow(WaveFormatError);
  });
});

describe('★ Effect.mkf —— 音效', () => {
  have('Effect.mkf')('★ 每一项都是完整的 RIFF/WAVE，取出来就能直接播', () => {
    const a = open('Effect.mkf');
    expect(a.count).toBeGreaterThan(100);
    let checked = 0;
    for (let i = 0; i < a.count; i++) {
      let d: Uint8Array;
      try {
        d = a.read(i);
      } catch {
        continue; // 空槽在原版档案里很常见，不是错误
      }
      if (d.length === 0) continue;
      expect(isWave(d), `资源 ${i} 不是 WAVE`).toBe(true);
      const info = readWaveInfo(d);
      // RIFF 声明的长度应当与实际数据吻合（= 文件长 − 8）
      expect(info.declaredSize, `资源 ${i} 长度对不上`).toBe(d.length - 8);
      expect([1, 2]).toContain(info.channels);
      expect(info.sampleRate).toBeGreaterThan(4000);
      checked++;
    }
    // 115 个槽里 99 个有内容，其余是空槽 —— 原版档案里很常见
    expect(checked).toBe(99);
  });
});

describe('★ Speaking.mkf —— 角色语音', () => {
  have('Speaking.mkf')('★ 1300 多条语音也都是 WAVE', () => {
    const a = open('Speaking.mkf');
    expect(a.count).toBeGreaterThan(1000);
    // 全量读 57MB 太慢，抽样即可
    let checked = 0;
    for (let i = 0; i < a.count; i += 37) {
      let d: Uint8Array;
      try {
        d = a.read(i);
      } catch {
        continue;
      }
      if (d.length === 0) continue;
      expect(isWave(d), `资源 ${i} 不是 WAVE`).toBe(true);
      expect(readWaveInfo(d).declaredSize).toBe(d.length - 8);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('★ 背景音乐', () => {
  it('清单有 25 首，与 Midi.txt 同序', () => {
    expect(MIDI_PLAYLIST).toHaveLength(25);
  });

  it('★ 清单里的文件在游戏目录里都存在', () => {
    if (!existsSync(RICH4)) return;
    for (const f of MIDI_PLAYLIST) {
      expect(existsSync(`${RICH4}/${f}`), `缺 ${f}`).toBe(true);
    }
  });

  it('★ 每首都是标准 MIDI（MThd 头）—— 不需要解码', () => {
    if (!existsSync(RICH4)) return;
    for (const f of MIDI_PLAYLIST) {
      const d = readFileSync(`${RICH4}/${f}`);
      expect(d.subarray(0, 4).toString('latin1'), `${f} 不是 MIDI`).toBe('MThd');
    }
  });
});

describe('★ 移动/掷骰音效与骰子落点 —— 照 exe 的表', () => {
  it('移动音效按交通方式：走路/機車/汽車/船', () => {
    expect([...MOVE_SOUND]).toEqual([44, 45, 46, 53]);
    expect(MOVE_SOUND).toHaveLength(4);
  });

  it('★ 不是表里 0..3 项 —— 那四个是别的音效（先前差点取错行）', () => {
    // 索引来自 `[0x4749d4] = 0xb + 交通方式`，不是 0..3
    expect(MOVE_SOUND).not.toContain(7);
    expect(MOVE_SOUND).not.toContain(32);
  });

  it('掷骰音效是 10（表 0x48235a = 索引 2）', () => {
    expect(DICE_SOUND).toBe(10);
  });

  it('★ 骰子落点 = 基准 (221,193) + 朝向偏移，八向各一项', () => {
    expect(DICE_AT_BASE).toEqual({ x: 221, y: 193 });
    expect(DICE_AT).toHaveLength(8);
    for (const [dx, dy] of DICE_AT) {
      // 都在基准点附近一小圈内（骰子落在棋盘中央偏玩家面朝那侧）
      expect(Math.abs(dx)).toBeLessThanOrEqual(32);
      expect(Math.abs(dy)).toBeLessThanOrEqual(32);
    }
    // 逐向各不同，不是常数表
    const keys = new Set(DICE_AT.map(([x, y]) => `${x},${y}`));
    expect(keys.size).toBe(8);
  });
});
