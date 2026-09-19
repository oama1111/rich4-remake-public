/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 音频资源
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { MkfArchive } from './mkf.ts';
import { MIDI_PLAYLIST, BGM_FILES, SCREEN_BGM, bgmTrackIdOf, bgmAssetFileFor, bgmFileFor, bgmEnabled, isWave, readWaveInfo, WaveFormatError, DICE_AT, DICE_AT_BASE, DICE_SOUND, MOVE_SOUND, PLACE_TOOL_SOUND, SOUND_IDS } from './audio.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';

const RICH4 = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4';
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
    // ★ 2026-09-17：**按屏取曲**那张表（`fcn_004549cf(id)` 用的），逐字节对照 exe
    expect(BGM_FILES).toHaveLength(13);
    expect(BGM_FILES[0]).toBe('MIDI01.MID');
    expect(BGM_FILES[12]).toBe('MIDI13.MID');
    // 月結屏那一处：`fcn_004549cf(9)` → MIDI10.MID
    expect(bgmFileFor(9)).toBe('MIDI10.MID');
    expect(bgmFileFor(13)).toBeNull();
    // 配置闸门：`[0x49715a] == 0` ⇒ 整条不做
    expect(bgmEnabled(0)).toBe(false);
    expect(bgmEnabled(1)).toBe(true);
    // ★ 22 处调用点的实参表（逐处读出的 push 立即数）
    expect(SCREEN_BGM.monthly).toBe(9);
    expect(bgmFileFor(bgmTrackIdOf(SCREEN_BGM.monthly!))).toBe('MIDI10.MID');
    // 0x8000 是旗标：0x8001 → 1（MIDI02）、0x8006 → 6（MIDI07）
    expect(bgmTrackIdOf(0x8001)).toBe(1);
    expect(bgmTrackIdOf(0x8006)).toBe(6);
    expect(bgmFileFor(bgmTrackIdOf(SCREEN_BGM.newGame!))).toBe('MIDI02.MID');
    expect(bgmFileFor(bgmTrackIdOf(SCREEN_BGM.newGameAlt!))).toBe('MIDI07.MID');
    // ⚠️ 監獄/醫院那两处**超出 13 项表** ⇒ `bgmFileFor` 必须老实返 null（不替它猜）
    expect(SCREEN_BGM.prison).toBe(0xf);
    expect(SCREEN_BGM.hospital).toBe(0x10);
    expect(bgmFileFor(SCREEN_BGM.prison!)).toBeNull();
    expect(bgmFileFor(SCREEN_BGM.hospital!)).toBeNull();
    // ★ 磁盘上是小写（`Rich4/midi01.mid`）；exe 那张表里是大写
    expect(bgmAssetFileFor(9)).toBe('midi10.mid');
    expect(bgmAssetFileFor(99)).toBeNull();
    const RICH4 = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4';
    if (existsSync(RICH4)) {
      // 抽两支：`bgmAssetFileFor` 给出的小写名**就是目录里那条真实条目名**
      //   ⚠️ 别用 `existsSync(大写)` 当反证 —— macOS 默认文件系统不区分大小写，
      //     那样断言会误报；要看**目录里列出来的名字**才算数。
      const entries = new Set(readdirSync(RICH4));
      for (const id of [0, 9]) {
        const f = bgmAssetFileFor(id)!;
        expect(entries.has(f), `目录里应当有 ${f}`).toBe(true);
      }
    }
    if (existsSync(EXE)) {
      const buf = readFileSync(EXE);
      const at = (va: number) => 398848 + (va - 0x463000); // 该 exe 的 VA→文件偏移换算
      // 表 0x47e793 的 13 个指针，各自指向的串必须就是 BGM_FILES[i]
      for (let i = 0; i < BGM_FILES.length; i++) {
        const ptr = buf.readUInt32LE(at(0x47e793) + i * 4);
        const end = buf.indexOf(0, at(ptr));
        expect(buf.subarray(at(ptr), end).toString('latin1')).toBe(BGM_FILES[i]);
      }
    }
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

describe('★ 標題／選單音效 —— 照 exe 的编号', () => {
  it('悬停 = 0、确认 = 1（`[0x48231a]` / `[0x482322]`）', () => {
    expect(SOUND_IDS.TITLE_HOVER).toBe(0);
    expect(SOUND_IDS.TITLE_CLICK).toBe(1);
  });
});

describe('★ 機器娃娃（道具 1）的音效 —— 38，而且是 exe 里那张表查出来的', () => {
  it('使用那一下 = 音效 38 @source VA 0x0040ded3（`fcn_0040dd1f` 的 actor 8 分支）', () => {
    expect(SOUND_IDS.DOLL).toBe(38);
  });

  it('★ 它不是移动音效那四个 —— 娃娃那一支**不查**交通方式，索引写死 9', () => {
    expect(MOVE_SOUND).not.toContain(SOUND_IDS.DOLL);
    // 走路 44 / 機車 45 / 汽車 46 / 船 53 是 0x48234a 的 11..14 项，不是第 9 项
    expect(MOVE_SOUND.indexOf(SOUND_IDS.DOLL)).toBe(-1);
  });

  /**
   * ★ 溯源：直接回 `rich4.exe` 的数据段读那张表，而不是只在测试里抄一遍注释。
   *
   * `fcn_0040dd1f` 的 actor 8 分支是 `eax = 0x48234a + 0x48`（= 第 9 项，每项 8 字节）
   * 然后把 `[eax]` 当音效号传给 `rich4_play_sound_effect`（VA 0x0040ded3..0x0040dedc）。
   * 本 PE 的节表 VirtualSize 全为 0，故 VA → 文件偏移要用 SizeOfRawData 那套换算
   * （与 `tools/disasm.py` 的 SECTIONS 一致）：
   *   DGROUP VA `0x463000` ↔ 文件偏移 `398848`。
   */
  have('rich4.exe')('★ 表 0x48234a 的第 9 项读出来就是 SOUND_IDS.DOLL', () => {
    const DGROUP_VA = 0x463000;
    const DGROUP_OFF = 398848;
    const exe = readFileSync(`${RICH4}/rich4.exe`);
    const at = DGROUP_OFF + (0x48234a + 9 * 8 - DGROUP_VA);
    expect(exe.readUInt32LE(at)).toBe(SOUND_IDS.DOLL);
  });
});

describe('★ 放置類道具落地的音效 —— 照 exe 的表（`0x48231a`，8 字节一项）', () => {
  it('路障 33 / 地雷 34 / 定時炸彈 10', () => {
    // @source VA 0x00446c58 push 0x48236a（表项 10）、0x00446d39 push 0x482372（表项 11）、
    //         0x00446e1a push 0x48235a（表项 8）
    expect(SOUND_IDS.PLACE_BARRIER).toBe(33);
    expect(SOUND_IDS.PLACE_MINE).toBe(34);
    expect(SOUND_IDS.PLACE_TIMEBOMB).toBe(10);
  });

  it('★ 三件是**连号**的 33/34，定時炸彈借用 10（与掷骰同一号）', () => {
    expect(SOUND_IDS.PLACE_MINE).toBe(SOUND_IDS.PLACE_BARRIER + 1);
    expect(SOUND_IDS.PLACE_TIMEBOMB).toBe(DICE_SOUND);
  });

  it('道具号 → 音效号：2→33、3→34、4→10，且**不碰**别的道具', () => {
    expect(PLACE_TOOL_SOUND.get(2)).toBe(33);
    expect(PLACE_TOOL_SOUND.get(3)).toBe(34);
    expect(PLACE_TOOL_SOUND.get(4)).toBe(10);
    expect(PLACE_TOOL_SOUND.size).toBe(3);
    // 1 機器娃娃 / 5 機車 那些不是放置類，不该有落地音
    expect(PLACE_TOOL_SOUND.has(1)).toBe(false);
    expect(PLACE_TOOL_SOUND.has(5)).toBe(false);
  });
});
