/*
 * SoundFont 音符发声 —— `.sf2` 那半的 WebAudio 出口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 解析与选区在 `soundfont.ts`（纯函数、可测），这里只管**把 zone 变成声音**。
 *   薄一点是故意的：这一层没法在 node 下单测，能薄就薄。
 *
 * 每个音一条链：`AudioBufferSourceNode` → `GainNode`（音量包络）→ destination。
 *
 * 几条依据：
 *
 * - **变调**：`AudioBufferSourceNode.playbackRate = 2^(音分/1200)`。
 *   音分由 `zoneDetuneCents()` 算（根音差 × `scaleTuning` + `coarseTune`/`fineTune`
 *   − `pitchCorrection`）@source SF2 2.04 §7.10 / §8.1.3 gen 51/52/56/58。
 * - **循环**：`loop` 打开时把 `loopStart`/`loopEnd` 交给节点自己循环，
 *   等到 note-off（本例是音符时值到点）再用包络把声音收掉。规范里 `sampleModes`
 *   的 1（持续循环）与 3（循环到 note-off）在这里是同一件事 —— 我们**总是**
 *   按 MIDI 的时值结束，不做「一直响到 note-off 事件」（SMF 解析出来的就是时值）。
 *   @source SF2 2.04 §7.10 sampleModes
 * - **包络**：SF2 的音量包络是 **attack（凹曲线）→ hold → decay → sustain**，
 *   再由 release 收尾（§9.6）。这些曲线原版是查表画的，这里用 WebAudio 的
 *   `linearRamp`/`setTargetAtTime` 近似 —— 是近似，不是逐点复刻，登记在 Q8。
 *   时间的单位换算见 `soundfont.ts` 文件头。
 */

import type { MidiNote } from '@rich4/assets-pipeline';
import {
  DRUM_BANK,
  centibelsToGain,
  centsToPlaybackRate,
  resolveSoundFontZone,
  zoneDetuneCents,
  type SoundFont,
  type SoundFontZone,
} from './soundfont.ts';

/** 同时最多响几个音。超了就掐掉最早排出去的那个（最老的声音最不容易被听出来） */
export const MAX_POLYPHONY = 32;

/**
 * 包络各段的下限。
 *
 * ⚠️ 规范给的默认值是 `-12000 tc = 1 ms`。1 ms 的斜坡在 44.1kHz 下只有
 *   44 个采样点，WebAudio 会自己铺开，听感是「啪」的一声 —— 但那是规范值，
 *   不该由我们改。这里只把 release 抬到 5 ms：release 为 0 时 `setTargetAtTime`
 *   的时间常数是 0，在部分实现上会直接跳到 0 产生爆音，5 ms 是能听出区别的
 *   下限。**这是实现下限，不是音色设计**，登记在 Q8。
 */
const MIN_RELEASE_S = 0.005;

/** `setTargetAtTime` 的「到 1/e」时间常数，换算成「基本到 0」的时长 */
const RELEASE_TAU_FACTOR = 4;

interface LiveSource {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /**
   * 这条音所属的**互斥组**（gen 57，0 = 不参与）。@source SF2 2.04 §9.6.3
   *   「同一组里新音一响，旧音**立刻**让位」—— 「立刻」就是新音的起点时刻 `at`；
   *   0 是规范默认值，表示不参与抢占，绝不能拿 0 当一组。
   */
  exclusiveClass: number;
}

/**
 * 「把 MIDI 音符排出去」这件事的接口。
 *
 * `music.ts` 只认这个接口，于是「用 SoundFont」与「用振荡器近似」是**同一层**
 * 的两个实现，换后端不用改排程逻辑。没有音色库时回退到后者 —— 绝不能
 * 因为没音色库就播不出声。
 */
export interface MidiVoice {
  /** 把一个音符排到 AudioContext 时间轴的 `at`（秒） */
  schedule(note: MidiNote, at: number): void;
  /** 立刻掐掉所有已排出去、还没响完的声音 */
  stop(): void;
}

export class SoundFontVoice implements MidiVoice {
  readonly #ctx: AudioContext;
  readonly #dest: AudioNode;
  #font: SoundFont;
  readonly #buffers = new Map<number, AudioBuffer>();
  readonly #live = new Set<LiveSource>();

  constructor(ctx: AudioContext, dest: AudioNode, font: SoundFont) {
    this.#ctx = ctx;
    this.#dest = dest;
    this.#font = font;
  }

  /** 换一份音色库；已排出去的声音等它响完 */
  setFont(font: SoundFont): void {
    this.stop();
    this.#font = font;
    this.#buffers.clear();
  }

  get sampleCount(): number {
    return this.#font.samples.length;
  }

  schedule(note: MidiNote, at: number): void {
    if (note.duration <= 0) return;
    const zone = this.#pick(note);
    // ⚠️ 没命中就**安静地不出声**，不抛也不回退：音色库缺某个音色是
    //   音色库的事，跟排程没关系。缺得多了会听得出来，那就换一份音色库。
    if (zone === null) return;
    const sample = this.#font.samples[zone.sample];
    if (sample === undefined || sample.pcm.length === 0) return;

    if (this.#live.size >= MAX_POLYPHONY) {
      const oldest = this.#live.values().next().value;
      if (oldest !== undefined) this.#silence(oldest, at);
    }

    // ★ **互斥组**（gen 57）：本音一响，同组里还在响的旧音立刻让位 ——
    //   典型就是开镲/闭镲、同一键上的多个力度层。@source SF2 2.04 §9.6.3
    //   `exclusiveClass == 0` 是规范默认值 = 不参与抢占，不组成任何组。
    if (zone.exclusiveClass > 0) {
      for (const entry of [...this.#live]) {
        if (entry.exclusiveClass === zone.exclusiveClass) this.#silence(entry, at);
      }
    }

    const gain = this.#ctx.createGain();
    const peak = this.#peakGain(zone, note.velocity);
    const end = at + note.duration;
    const release = Math.max(zone.release, MIN_RELEASE_S);
    writeEnvelope(gain.gain, at, end, release, peak, zone);

    const src = this.#ctx.createBufferSource();
    src.buffer = this.#bufferFor(zone.sample);
    const cents = zoneDetuneCents(sample, zone, note.note);
    // ★ 弯音（`MidiNote.bend` / `bends`，见 `midi.ts` 文件头）：半音 × 100 叠到音分上，阶跃排。
    //   打击乐通道不弯（原版 25 首里 9 号通道一条弯音都没有）。
    const bent = note.channel !== 9 && (note.bend !== undefined || note.bends !== undefined);
    const onset = bent ? (note.bend ?? 0) * 100 : 0;
    src.playbackRate.value = centsToPlaybackRate(cents + onset);
    if (bent) {
      src.playbackRate.setValueAtTime(centsToPlaybackRate(cents + onset), at);
      for (const b of note.bends ?? []) {
        src.playbackRate.setValueAtTime(centsToPlaybackRate(cents + b.semitones * 100), at + b.at);
      }
    }
    const loop = loopPoints(sample.pcm.length, zone);
    if (loop !== null) {
      src.loop = true;
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
    }
    src.connect(gain).connect(this.#dest);
    src.start(at, Math.max(0, zone.start));
    // 尾巴留一点：包络在 end+release 处才到 0（`stop()` 会被提前掐断）
    src.stop(end + release + 0.02);

    const entry: LiveSource = { src, gain, exclusiveClass: zone.exclusiveClass };
    this.#live.add(entry);
    src.onended = () => {
      this.#live.delete(entry);
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        // 已经断过的节点再断会抛，忽略
      }
    };
  }

  stop(): void {
    for (const entry of this.#live) this.#silence(entry, 0);
  }

  /** 掐掉一个音：包络立刻归零再停，免得「啪」一声 */
  #silence(entry: LiveSource, at: number): void {
    this.#live.delete(entry);
    try {
      entry.gain.gain.cancelScheduledValues(at);
      entry.gain.gain.setValueAtTime(0, at);
      entry.src.stop(at);
    } catch {
      // 没 start 过 / 已停过的节点会抛，忽略
    }
  }

  #pick(note: MidiNote): SoundFontZone | null {
    // ★ 打击乐通道（9）按 GM/SF2 的约定走 bank 128，用**音符号**当预设号；
    //   查不到就交给 `null`（不出声），绝不拿旋律音色去顶鼓
    const drum = note.channel === 9;
    return resolveSoundFontZone(
      this.#font,
      drum ? note.note : note.program,
      note.note,
      note.velocity,
      drum ? DRUM_BANK : 0,
    );
  }

  /**
   * 峰値增益 = 乐器衰减 × 力度增益 × 力度调制。
   *
   * - 力度→音量的默认曲线：本项目**跳过调制器**（`pmod`/`imod` 不解析），
   *   于是用 `(v/127)^2` 近似 GM/SF2 的听感 @source SF2 2.04 §9.6.2
   * - `velocityToAttenuation`（gen 46）声明的「力度越低、额外衰减越多」，
   *   单位是 centibels，力度 127 时为零：
   *   `额外衰减 = 声明值 × (127 − v) / 127`
   */
  #peakGain(zone: SoundFontZone, velocity: number): number {
    const v = Math.max(0, Math.min(127, velocity));
    const vel = (v / 127) * (v / 127);
    const extra = (zone.velocityToAttenuation * (127 - v)) / 127;
    return zone.initialAttenuation * vel * centibelsToGain(extra);
  }

  #bufferFor(index: number): AudioBuffer {
    const hit = this.#buffers.get(index);
    if (hit !== undefined) return hit;
    const sample = this.#font.samples[index];
    if (sample === undefined) throw new RangeError(`音色库没有第 ${index} 个样本`);
    // AudioContext 会自己把 sampleRate 重采样到设备速率
    const buf = this.#ctx.createBuffer(1, sample.pcm.length, sample.sampleRate);
    // `copyToChannel` 要 Float32Array（lib.dom 的类型就是这么写的）；
    // SF2 的样本是 16 位 PCM，按 1/32768 归一化过去。
    const mono = new Float32Array(sample.pcm.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (sample.pcm[i] ?? 0) / 32768;
    buf.copyToChannel(mono, 0);
    this.#buffers.set(index, buf);
    return buf;
  }
}

/**
 * 循环点（**已经减去 sample 起始偏移**，即相对于 `AudioBuffer` 第 0 帧）。
 *
 * `loopStart`/`loopEnd` 是「从 sample 起点算的偏移」，而 sample 在缓冲区里
 * 又从 0 开始，故两处偏移要分别加上 zone 的 start/loop 偏移。
 * 越界或退化（end ≤ start）时返回 `null` = 不循环。
 * @source SF2 2.04 §7.10 sample header（loopStart/loopEnd 的单位与基准）
 */
function loopPoints(length: number, zone: SoundFontZone): { start: number; end: number } | null {
  // 规范：sampleModes 0/2 不循环，1/3 循环（见 `soundfont.ts` 文件头 §4）
  if (zone.loopMode !== 1 && zone.loopMode !== 3) return null;
  const start = zone.start + zone.loopStart;
  const end = zone.start + zone.loopEnd;
  if (!(end > start) || start < 0 || end > length) return null;
  return { start, end };
}

/**
 * 音量包络：0 → peak（attack）→ 保持 peak（hold）→ 降到 sustain（decay）
 * → 保持到音符时值结束 → release 归零。
 *
 * ⚠️ 时间量必须是**单调递增**的：`at + attack + hold` 一旦超过 `end`，
 *   decay 段就没什么可降的了，这里统一 `Math.min` 夹到 `end` 之前，
 *   免得 WebAudio 因为时刻倒序而把整条包络丢掉。
 * @source SF2 2.04 §9.6 音量包络
 */
function writeEnvelope(
  param: AudioParam,
  at: number,
  end: number,
  release: number,
  peak: number,
  zone: SoundFontZone,
): void {
  const sustain = Math.max(0, Math.min(1, zone.sustain));
  const attackEnd = at + Math.min(zone.attack, Math.max(0, end - at));
  const holdEnd = Math.min(attackEnd + zone.hold, end);
  const decayEnd = Math.min(holdEnd + zone.decay, end);

  param.cancelScheduledValues(at);
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(peak, attackEnd);
  param.setValueAtTime(peak, holdEnd);
  if (decayEnd > holdEnd) {
    param.linearRampToValueAtTime(peak * sustain, decayEnd);
  }
  const sustainLevel = decayEnd <= holdEnd ? peak : peak * sustain;
  if (end > decayEnd) {
    param.setValueAtTime(sustainLevel, end);
  }
  // 指数收尾：`setTargetAtTime` 永远到不了 0，所以给一个「基本到 0」的时长
  param.setTargetAtTime(0, Math.max(end, decayEnd), Math.max(release / RELEASE_TAU_FACTOR, 1e-4));
}
