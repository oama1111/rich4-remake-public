/*
 * SoundFont（.sf2）解析与选区
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 夹具是**合成**出来的最小 sf2（`sf2-fixture.ts`），仓库里没有真音色库，
 *   也不该有（不分发原版素材）。这些断言是「按 SF2 2.04 规范应该怎样」，
 *   谁改了都得回规范里解释为什么。
 */

import { describe, expect, it } from 'vitest';
import { buildTestSf2 } from './sf2-fixture.ts';
import {
  DRUM_BANK,
  SoundFontError,
  centibelsToGain,
  centsToPlaybackRate,
  parseSoundFont,
  resolveSoundFontZone,
  timecentsToSeconds,
  zoneDetuneCents,
} from './soundfont.ts';

/** 夹具默认：PCM 8 帧、rootKey 69、loop 1..7、keyRange 0..127、不循环 */
const font = (): ReturnType<typeof parseSoundFont> =>
  parseSoundFont(buildTestSf2(), 'fixture.sf2');

describe('SF2 容器解析', () => {
  it('认出 RIFF/sf2，读出 INFO 里的库名与 pdta 三张表', () => {
    const f = font();
    expect(f.name).toBe('測試音色庫');
    expect(f.presets).toHaveLength(1);
    expect(f.instruments).toHaveLength(1);
    expect(f.samples).toHaveLength(1);
    expect(f.presets[0]!.name).toBe('Piano');
    expect(f.instruments[0]!.name).toBe('Inst');
    expect(f.samples[0]!.name).toBe('Smpl');
  });

  it('样本按 shdr 的 start/end 从 smpl 里切出来（16 位小端）', () => {
    const s = font().samples[0]!;
    expect(s.sampleRate).toBe(44100);
    expect(s.rootKey).toBe(69);
    expect([...s.pcm]).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
    expect([s.loopStart, s.loopEnd]).toEqual([1, 7]);
  });

  it('第二份样本的偏移是相对 smpl 块（不是相对自己）—— 鼓组夹具', () => {
    const f = parseSoundFont(buildTestSf2({ drumKit: true }));
    expect(f.samples).toHaveLength(2);
    expect(f.samples[1]!.name).toBe('Drum');
    expect([...f.samples[1]!.pcm]).toEqual([1000, 2000, 3000, 4000]);
  });

  it('不是 RIFF / 不是 sf2 / 缺 pdta 都要报得出来，而不是当成空库', () => {
    expect(() => parseSoundFont(new Uint8Array(0))).toThrow(SoundFontError);
    const notRiff = new Uint8Array(64);
    expect(() => parseSoundFont(notRiff)).toThrow(/RIFF/);
    const sf3 = buildTestSf2();
    sf3[8] = 's'.charCodeAt(0);
    sf3[9] = 'f'.charCodeAt(0);
    sf3[10] = '3'.charCodeAt(0);
    expect(() => parseSoundFont(sf3)).toThrow(/不是 sf2/);
  });

  it('终结记录（EOP/EOI/EOS）不进表', () => {
    const f = font();
    expect(f.presets.some((p) => p.name === 'EOP')).toBe(false);
    expect(f.instruments.some((i) => i.name === 'EOI')).toBe(false);
    expect(f.samples.some((s) => s.name === 'EOS')).toBe(false);
  });
});

describe('generator 的单位换算', () => {
  it('timecents → 秒：`2^(tc/1200)`、0 = 1 秒、−12000 = 1/1024 秒 @source §8.1.3', () => {
    expect(timecentsToSeconds(0)).toBeCloseTo(1, 9);
    // 规范写「−12000 tc = 1 msec」，实际是 2^−10 = 0.9766 ms —— 按公式算
    expect(timecentsToSeconds(-12000)).toBeCloseTo(Math.pow(2, -10), 9);
    expect(timecentsToSeconds(1200)).toBeCloseTo(2, 9);
  });

  it('centibels → 线性增益：0 = 不衰减、100 cB = 40 dB = 1/100 @source §9.6.2', () => {
    expect(centibelsToGain(0)).toBe(1);
    // SF2 的斜率是 **0.4 dB / centibel**（规范 §9.6.2 那条「每十个单位 4 dB」）
    // ⇒ 100 cB = 40 dB → 10^(−40/20) = 0.01；50 cB = 20 dB → 0.1
    expect(centibelsToGain(100)).toBeCloseTo(0.01, 12);
    expect(centibelsToGain(50)).toBeCloseTo(0.1, 12);
  });
});

describe('选区：preset → instrument → sample', () => {
  it('默认夹具命中唯一的 zone', () => {
    const f = font();
    const z = resolveSoundFontZone(f, 0, 60, 100);
    expect(z).not.toBeNull();
    expect(z!.sample).toBe(0);
    expect([z!.keyLo, z!.keyHi]).toEqual([0, 127]);
    expect(z!.loopMode).toBe(0);
  });

  it('找不着的预设/音区返回 null —— 调用方必须能接受（回退或不出声）', () => {
    const f = font();
    expect(resolveSoundFontZone(f, 7, 60, 100)).toBeNull(); // 没有 program 7
    expect(resolveSoundFontZone(f, 0, 60, 100, 1)).toBeNull(); // 没有 bank 1
    const narrow = parseSoundFont(buildTestSf2({ instrumentZones: [[[43, 0x4540]]] })); // 64..69
    expect(resolveSoundFontZone(narrow, 0, 63, 100)).toBeNull();
    expect(resolveSoundFontZone(narrow, 0, 64, 100)).not.toBeNull();
    expect(resolveSoundFontZone(narrow, 0, 69, 100)).not.toBeNull();
    expect(resolveSoundFontZone(narrow, 0, 70, 100)).toBeNull();
  });

  it('keyRange/velRange 决定命中哪一个 zone（低力度软、高力度硬）', () => {
    // 一个乐器两个 zone：力度 0..63 走样本 0，64..127 走样本 1
    const f = parseSoundFont(
      buildTestSf2({
        secondSample: true,
        instrumentZones: [
          [
            [43, 0x7f00], // keyRange 0..127
            [44, 0x3f00], // velRange 0..63
          ],
          [
            [43, 0x7f00],
            [44, 0x7f40], // velRange 64..127
          ],
        ],
      }),
    );
    expect(f.instruments[0]!.zones.map((z) => [z.velLo, z.velHi, z.sample])).toEqual([
      [0, 63, 0],
      [64, 127, 1],
    ]);
    // 低力度软（样本 0）、高力度硬（样本 1）
    expect(resolveSoundFontZone(f, 0, 60, 30)!.sample).toBe(0);
    expect(resolveSoundFontZone(f, 0, 60, 100)!.sample).toBe(1);
  });

  it('预设层与乐器层的 keyRange 取交集', () => {
    const f = parseSoundFont(
      buildTestSf2({
        presetZone: [[43, 0x5040]], // 64..80
        instrumentZones: [[[43, 0x5a46]]], // 70..90
      }),
    );
    const z = resolveSoundFontZone(f, 0, 75, 100)!;
    expect([z.keyLo, z.keyHi]).toEqual([70, 80]);
    expect(resolveSoundFontZone(f, 0, 65, 100)).toBeNull();
  });
});

describe('叠加规则 @source §8.1.3 / §9.4', () => {
  it('乐器没写包络时用规范默认值（−12000 tc）', () => {
    const f = font();
    const z = resolveSoundFontZone(f, 0, 60, 100)!;
    expect(z.attack).toBeCloseTo(timecentsToSeconds(-12000), 9);
    expect(z.hold).toBeCloseTo(timecentsToSeconds(-12000), 9);
    expect(z.decay).toBeCloseTo(timecentsToSeconds(-12000), 9);
    expect(z.release).toBeCloseTo(timecentsToSeconds(-12000), 9);
    expect(z.sustain).toBe(1);
  });

  it('乐器的包络时间以 timecents 为单位：0 tc = 1 秒 @source §8.1.3 gen 34', () => {
    const f = parseSoundFont(buildTestSf2({ instrumentZones: [[[34, 0], [43, 0x7f00]]] }));
    const z = resolveSoundFontZone(f, 0, 60, 100)!;
    expect(z.attack).toBeCloseTo(timecentsToSeconds(0), 6); // 0 tc = 1 秒
  });

  it('预设层的包络时间是**相加**、衰减是**相乘**', () => {
    // 乐器：attack 1 秒（0 tc）、衰减 100 cB；预设：attack +1 秒（1200 tc）、衰减 100 cB
    const f = parseSoundFont(
      buildTestSf2({
        presetZone: [[34, 1200], [48, 100]],
        instrumentZones: [[[34, 0], [48, 100], [43, 0x7f00]]],
      }),
    );
    const z = resolveSoundFontZone(f, 0, 60, 100)!;
    expect(z.attack).toBeCloseTo(timecentsToSeconds(1200) + timecentsToSeconds(0), 6);
    expect(z.initialAttenuation).toBeCloseTo(centibelsToGain(100) * centibelsToGain(100), 9);
  });

  it('乐器 global zone 的项会被 local zone 顶掉，缺的才沿用', () => {
    const f = parseSoundFont(
      buildTestSf2({
        instrumentGlobal: [
          [34, 0], // attack 1 秒
          [48, 100], // 衰减 100 cB
        ],
        instrumentZones: [
          [
            [34, 1200], // attack 2 秒 —— 顶掉 global
            [43, 0x7f00],
          ],
        ],
      }),
    );
    const z = resolveSoundFontZone(f, 0, 60, 100)!;
    expect(z.attack).toBeCloseTo(timecentsToSeconds(1200), 6); // local 赢 = 2 秒
    expect(z.initialAttenuation).toBeCloseTo(centibelsToGain(100), 9); // global 的衰减还在
  });

  it('预设层不认仪器层专属的 generator：sampleModes 在预设层无效 @source §9.4', () => {
    const f = parseSoundFont(
      buildTestSf2({
        presetZone: [[54, 1]], // 想在预设层开循环 —— 无效
        instrumentZones: [[[43, 0x7f00]]], // 乐器层没声明 → 默认 0
      }),
    );
    expect(resolveSoundFontZone(f, 0, 60, 100)!.loopMode).toBe(0);
  });

  it('互斥组（gen 57 `exclusiveClass`）：乐器层声明就读出来、没声明就是 0 @source §8.1.3', () => {
    const withClass = parseSoundFont(
      buildTestSf2({ instrumentZones: [[[57, 7], [43, 0x7f00]]] }),
    );
    expect(resolveSoundFontZone(withClass, 0, 60, 100)!.exclusiveClass).toBe(7);
    const without = parseSoundFont(buildTestSf2({ instrumentZones: [[[43, 0x7f00]]] }));
    expect(resolveSoundFontZone(without, 0, 60, 100)!.exclusiveClass).toBe(0);
  });

  it('互斥组是**仪器层专属**：写在预设层无效（与 sampleModes 同一条规矩）@source §9.4', () => {
    const f = parseSoundFont(
      buildTestSf2({
        presetZone: [[57, 9]], // 预设层想设互斥组 —— 无效
        instrumentZones: [[[43, 0x7f00]]],
      }),
    );
    expect(resolveSoundFontZone(f, 0, 60, 100)!.exclusiveClass).toBe(0);
  });
});

describe('音高、循环与打击乐', () => {
  it('根音差 × scaleTuning 换成音分，再换成播放倍率 @source §7.10', () => {
    const f = font();
    const z = resolveSoundFontZone(f, 0, 69, 100)!;
    expect(zoneDetuneCents(f.samples[0]!, z, 69)).toBe(0);
    // 高一个八度 = +1200 音分 = ×2
    expect(centsToPlaybackRate(zoneDetuneCents(f.samples[0]!, z, 81))).toBeCloseTo(2, 9);
    expect(centsToPlaybackRate(zoneDetuneCents(f.samples[0]!, z, 57))).toBeCloseTo(0.5, 9);
  });

  it('coarseTune / fineTune / pitchCorrection 都进变调 @source §8.1.3 gen 51/52', () => {
    const f = parseSoundFont(
      buildTestSf2({
        pitchCorrection: -50,
        instrumentZones: [
          [
            [43, 0x7f00],
            [51, 12], // +12 半音
            [52, 50], // +50 音分
          ],
        ],
      }),
    );
    const z = resolveSoundFontZone(f, 0, 60, 100)!;
    // (60−69)×100 + 1200 + 50 − (−50) = 400
    expect(zoneDetuneCents(f.samples[0]!, z, 60)).toBeCloseTo(400, 6);
  });

  it('打击乐走 bank 128，用**音符号**当预设号', () => {
    const f = parseSoundFont(buildTestSf2({ drumKit: true }));
    // 音符号 35 = Acoustic Bass Drum
    const z = resolveSoundFontZone(f, 35, 35, 100, DRUM_BANK)!;
    expect(z.sample).toBe(1);
    expect(z.loopMode).toBe(1);
    // 同一条音在 bank 0 上没有对应预设 —— 拿不到就返回 null，不冒充旋律音色
    expect(resolveSoundFontZone(f, 35, 35, 100, 0)).toBeNull();
    // bank 128 上只有 35 这一个预设
    expect(resolveSoundFontZone(f, 38, 38, 100, DRUM_BANK)).toBeNull();
  });
});
