/*
 * 背景音乐 —— 用 WebAudio 把 MIDI 弹出来
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：只读状态，不含任何规则。
 *
 * 原版的 25 首配乐是磁盘上的标准 .mid（见 `MIDI_PLAYLIST`），
 * 浏览器不能直接播。这里把解析出来的音符表排到 WebAudio 上。
 *
 * ★ 两个后端，**同一层**（`MidiVoice`，定义在 `soundfont-voice.ts`）：
 *
 *   | 后端 | 谁在用 | 音色 |
 *   |---|---|---|
 *   | `SoundFontVoice` | 用户给了 `.sf2` 音色库 | 音色库里的采样 |
 *   | `OscillatorVoice` | **没有**音色库（默认） | 几种波形按 GM 大类近似 |
 *
 *   ⚠️ **绝不能因为没音色库就播不出声**：没有音色库时一路回退到振荡器，
 *   旋律/节奏/时值照旧（这些是数据，本来就精确）。
 *   ⚠️ 音色库**不分发**（C-LEG / DEVELOPMENT_PLAN §5.6），由用户自备。
 *   装载入口见 `soundfont-pick.ts`；Q8 / Q-MUSIC-1。
 *
 * ★ 打击乐（9 号通道）：本文件**曾经**把整条通道跳过，理由是「那个通道上的
 *   「音高」是鼓号不是音高，用振荡器弹出来只会是一串怪叫」。代价是律动的骨架
 *   没了 —— 用户实测感受就是「节拍拖沓、比正常的拉长了很多」。
 *   （实测：`midi01.mid` 解析出 46.55 s，文件 tempo `0xFF51` = 363636 µs/四分
 *   = 165 BPM；不读 tempo 才是 64.06 s。所以**时值本身是对的**，缺的是鼓。）
 *   现在按 GM 鼓号合成一小套打击乐（`drumKindFor()` / `drumSpec()`），
 *   整条通道不再丢。有音色库的仍走 bank 128 的鼓组（`SoundFontVoice`）。
 */

import {
  DRUM_CHANNEL,
  MIDI_PLAYLIST,
  parseMidi,
  type MidiNote,
  type MidiSong,
} from '@rich4/assets-pipeline';
import { SoundFontVoice, type MidiVoice } from './soundfont-voice.ts';
import type { SoundFont } from './soundfont.ts';

/**
 * GM 音色号 → 波形。
 *
 * 按 GM 的八个一组分类粗分：
 * - 0..7 钢琴、8..15 色彩打击 → 偏硬的三角波
 * - 16..23 风琴、24..31 吉他 → 方波
 * - 32..39 贝斯 → 三角波（低频听着更实）
 * - 40..55 弦乐/合奏 → 锯齿
 * - 56..79 铜管/簧管/笛 → 锯齿（亮）
 * - 其余 → 三角
 */
function waveFor(program: number): OscillatorType {
  if (program < 16) return 'triangle';
  if (program < 32) return 'square';
  if (program < 40) return 'triangle';
  if (program < 80) return 'sawtooth';
  return 'triangle';
}

/** MIDI 音高 → 频率。69 = A4 = 440Hz */
function freq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** 弯音（半音）→ 频率倍数 */
export function bendRatio(semitones: number): number {
  return semitones === 0 ? 1 : Math.pow(2, semitones / 12);
}

/**
 * 一次最多同时排多少个音。
 *
 * 有些曲子几千个音符，全部提前排到 AudioContext 上会一次性建出
 * 几千个振荡器节点——Safari 上直接卡住。故改为**滚动排程**：
 * 只排未来这几秒的，播着播着再往后排。
 */
const SCHEDULE_AHEAD_S = 2.0;
/** 排程器的心跳 */
const SCHEDULE_TICK_MS = 500;

// ------------------------------------------------------------
//  兜底后端的打击乐（9 号通道）
// ------------------------------------------------------------

/**
 * 合成打击乐的音色类别。
 *
 * 名字是**我们这套兜底合成器**的分类，不是 GM 的名字 —— GM 的 47 个鼓号
 * 在这里归成十来类，每类一个小合成器（噪声 burst + 音调 + 包络）。
 * @source GM1 打击乐键位表（channel 10 / 0 基通道 9）。
 */
export type DrumKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'stick'
  | 'hat'
  | 'openhat'
  | 'tom'
  | 'crash'
  | 'ride'
  | 'metal'
  | 'shaker';

/**
 * GM 鼓号 → 抄近路的音色类别。
 *
 * ⚠️ 没列的鼓号**不丢**，一律落到 `'shaker'`（一声短促的噪声）——
 *   宁可听感粗糙，也不能再出现「整条通道没有声」。
 */
export function drumKindFor(note: number): DrumKind {
  switch (note) {
    // 35 Acoustic Bass Drum / 36 Bass Drum 1
    case 35:
    case 36:
      return 'kick';
    // 38 Acoustic Snare / 40 Electric Snare
    case 38:
    case 40:
      return 'snare';
    case 39: // Hand Clap
      return 'clap';
    case 37: // Side Stick
      return 'stick';
    // 42 Closed Hi-Hat / 44 Pedal Hi-Hat
    case 42:
    case 44:
      return 'hat';
    case 46: // Open Hi-Hat
      return 'openhat';
    // 41 Low Floor / 43 High Floor / 45 Low / 47 Low-Mid / 48 Hi-Mid / 50 High Tom
    case 41:
    case 43:
    case 45:
    case 47:
    case 48:
    case 50:
      return 'tom';
    // 49 Crash 1 / 52 Chinese / 55 Splash / 57 Crash 2
    case 49:
    case 52:
    case 55:
    case 57:
      return 'crash';
    // 51 Ride 1 / 53 Ride Bell / 59 Ride 2
    case 51:
    case 53:
    case 59:
      return 'ride';
    // 56 Cowbell / 67 High Agogo / 68 Low Agogo / 76 Hi Wood Block / 77 Low Wood Block
    case 56:
    case 67:
    case 68:
    case 76:
    case 77:
      return 'metal';
    // 54 Tambourine / 69 Cabasa / 70 Maracas / 75 Claves / 80,81 Triangle
    default:
      return 'shaker';
  }
}

/** 音调那一面的参数（`null` = 这一类没有音调，纯噪声） */
interface DrumTone {
  wave: OscillatorType;
  /** 起音频率（Hz） */
  from: number;
  /** 收音频率（Hz）—— 与 `from` 不同就是一次下滑/上滑 */
  to: number;
  /** 从 `from` 滑到 `to` 要多久（秒） */
  sweep: number;
}

/**
 * 一类鼓的合成配方。
 *
 * ★ `decay` 是**这一类鼓自己的余韵**，与 MIDI 音符的 `duration` 无关 ——
 *   鼓是敲一下，不是按住。原先的实现把鼓整条丢了，这里不再按时值收。
 */
export interface DrumSpec {
  /** 余韵（秒）—— 节点排到 `at + decay` 收 */
  decay: number;
  /** 力度 127 时的峰値增益 */
  peak: number;
  /** attack（秒）—— 打击乐要短而明确 */
  attack: number;
  /** 噪声那一面的混合量（0 = 没有；1 = 全噪声） */
  noise: number;
  /** 音调那一面 */
  tone: DrumTone | null;
}

/**
 * 鼓号 → 合成配方。
 *
 * 音调类（kick / tom / metal）跟着**鼓号**走，所以同一类里的不同鼓号
 * 音高不同（低音桶鼓与高音桶鼓分得出来）。
 */
export function drumSpec(kind: DrumKind): DrumSpec {
  switch (kind) {
    case 'kick':
      // 低频正弦从 ~150Hz 掉到 ~45Hz —— 「咚」
      return { decay: 0.28, peak: 0.5, attack: 0.002, noise: 0, tone: { wave: 'sine', from: 150, to: 45, sweep: 0.09 } };
    case 'snare':
      // 噪声 + 一个短音调 —— 「啪」
      return { decay: 0.18, peak: 0.32, attack: 0.001, noise: 0.7, tone: { wave: 'triangle', from: 190, to: 130, sweep: 0.05 } };
    case 'clap':
      return { decay: 0.16, peak: 0.3, attack: 0.001, noise: 0.95, tone: null };
    case 'stick':
      return { decay: 0.06, peak: 0.26, attack: 0.001, noise: 0.5, tone: { wave: 'triangle', from: 1100, to: 800, sweep: 0.02 } };
    case 'hat':
      // 闭合 hi-hat：极短的噪声
      return { decay: 0.045, peak: 0.22, attack: 0.001, noise: 1, tone: null };
    case 'openhat':
      return { decay: 0.3, peak: 0.2, attack: 0.001, noise: 1, tone: null };
    case 'crash':
      return { decay: 0.9, peak: 0.2, attack: 0.002, noise: 1, tone: null };
    case 'ride':
      return { decay: 0.5, peak: 0.16, attack: 0.002, noise: 0.55, tone: { wave: 'triangle', from: 520, to: 500, sweep: 0.05 } };
    case 'tom':
      // 桶鼓音高按鼓号（41..50 ⇒ 87..147 Hz），收尾往下掉一点
      return { decay: 0.22, peak: 0.36, attack: 0.002, noise: 0.12, tone: { wave: 'sine', from: 0, to: 0, sweep: 0.08 } };
    case 'metal':
      // 牛铃 / 木鱼 / 阿哥哥：方波，音高按鼓号
      return { decay: 0.12, peak: 0.24, attack: 0.001, noise: 0.18, tone: { wave: 'square', from: 0, to: 0, sweep: 0.03 } };
    case 'shaker':
      return { decay: 0.07, peak: 0.18, attack: 0.005, noise: 1, tone: null };
  }
}

/** 能跟 `setTargetAtTime` 一起用的一只音量参数（真 WebAudio 与假实现都有） */
interface EnvelopeParam {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, tau: number): unknown;
}

/**
 * 打击乐包络：0 → peak（attack）→ 指数收到 0。
 *
 * `setTargetAtTime` 永远到不了 0，所以节点排 `at + decay` 收 ——
 * 听感上的「有效时长」就是 `decay`，这正是用来跟旋律音区分的量。
 */
function writePercEnvelope(param: EnvelopeParam, at: number, decay: number, peak: number, attack: number): void {
  const attackEnd = at + Math.min(attack, decay);
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(peak, attackEnd);
  param.setTargetAtTime(0, attackEnd, Math.max((at + decay - attackEnd) / 4, 0.005));
}

/**
 * 没有音色库时的兜底后端：几种波形按 GM 大类近似 + 一套合成打击乐。
 *
 * 旋律只做**旋律、节奏、时值**——那些是数据，能做到精确；音色是近似。
 * 原版听起来什么样取决于当年那块声卡的 GM 波表，同一份 .mid 在不同机器上
 * 本来就不一样，不存在一个可供比对的「原版音色」。
 */
export class OscillatorVoice implements MidiVoice {
  readonly #ctx: AudioContext;
  readonly #dest: AudioNode;
  /**
   * 已经排出去、还没响完的节点。
   *
   * ⚠️ 停止必须**真的停**：排程是提前 2 秒做的，光把定时器关掉，
   *   已排出去的音还会继续响两秒。按了停止还在响，那不叫停止。
   */
  readonly #live = new Set<AudioScheduledSourceNode>();
  /** 噪声 buffer（白噪声）只建一次，所有噪声类打击乐共用 */
  #noise: AudioBuffer | null = null;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.#ctx = ctx;
    this.#dest = dest;
  }

  schedule(n: MidiNote, at: number): void {
    // ★ 打击乐**先于时值判定**：鼓是敲一下，MIDI 里那个 duration 只是
    //   「记谱长度」，敲下去的余韵归鼓自己。故 `duration <= 0` 也照排。
    if (n.channel === DRUM_CHANNEL) {
      this.#scheduleDrum(n, at);
      return;
    }
    if (n.duration <= 0) return;

    const osc = this.#ctx.createOscillator();
    osc.type = waveFor(n.program);
    const base = freq(n.note);
    osc.frequency.value = base * bendRatio(n.bend ?? 0);
    // ★ 弯音（`MidiNote.bend` / `bends`，解析见 `midi.ts` 文件头）：阶跃排到频率上。
    //   没有弯音的音符一条都不多排（形状与先前一样）。
    if (n.bend !== undefined || n.bends !== undefined) {
      osc.frequency.setValueAtTime(base * bendRatio(n.bend ?? 0), at);
      for (const b of n.bends ?? []) osc.frequency.setValueAtTime(base * bendRatio(b.semitones), at + b.at);
    }

    const gain = this.#ctx.createGain();
    // 力度 0..127 → 音量；再按**当前同时在响的音数**收一收，别几十路叠爆
    const peak = (n.velocity / 127) * 0.18 * this.#duck();
    const attack = 0.008;
    // ★ 收尾要短：原先 0.12 s 的 release 在几十路复音下糊成一团（用户听感
    //   是「噪音」）。取时值的 1/4，上限 60 ms。
    const release = Math.min(0.06, n.duration * 0.25);
    const end = at + n.duration;

    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.setValueAtTime(peak, Math.max(at + attack, end - release));
    gain.gain.linearRampToValueAtTime(0, end);

    osc.connect(gain).connect(this.#dest);
    osc.start(at);
    osc.stop(end + 0.02);
    this.#track(osc, gain);
  }

  stop(): void {
    for (const node of this.#live) {
      try {
        node.stop();
      } catch {
        // 已经停过的节点再 stop 会抛，忽略
      }
    }
    this.#live.clear();
  }

  /**
   * 排一个鼓。
   *
   * 音调面（kick / tom / metal …）与噪声面（hat / snare / crash …）是两条
   * 并行的节点链，各自走同一个包络；两者都有时就是「音调 + 噪声」的合成。
   */
  #scheduleDrum(n: MidiNote, at: number): void {
    const kind = drumKindFor(n.note);
    const spec = drumSpec(kind);
    const vel = Math.max(0, Math.min(127, n.velocity)) / 127;
    const peak = spec.peak * vel * this.#duck();
    const end = at + spec.decay;

    if (spec.noise > 0) {
      const src = this.#ctx.createBufferSource();
      src.buffer = this.#noiseBuffer();
      const gain = this.#ctx.createGain();
      writePercEnvelope(gain.gain, at, spec.decay, peak * spec.noise, spec.attack);
      src.connect(gain).connect(this.#dest);
      src.start(at);
      src.stop(end + 0.01);
      this.#track(src, gain);
    }

    if (spec.tone !== null) {
      const osc = this.#ctx.createOscillator();
      osc.type = spec.tone.wave;
      // ★ 音调类（tom / metal）的「配方」里频率是 0：那是占位，真正的音高由
      //   **鼓号**定（低音桶鼓与高音桶鼓要分得出来）。
      const from = spec.tone.from > 0 ? spec.tone.from : freq(n.note);
      const to = spec.tone.to > 0 ? spec.tone.to : from * 0.8;
      osc.frequency.setValueAtTime(from, at);
      osc.frequency.linearRampToValueAtTime(to, at + spec.tone.sweep);
      const gain = this.#ctx.createGain();
      writePercEnvelope(gain.gain, at, spec.decay, peak, spec.attack);
      osc.connect(gain).connect(this.#dest);
      osc.start(at);
      osc.stop(end + 0.01);
      this.#track(osc, gain);
    }
  }

  /**
   * 同时发声音数 → 音量缩放。
   *
   * `1/sqrt(n)`（`n` = 这一声排进去之后的总路数）：能量按路数线性叠加、
   * 振幅按平方根，听感上不会「几十路一起爆」。只有一路时就是 1
   * （不改单音的听感）。
   */
  #duck(): number {
    return 1 / Math.sqrt(this.#live.size + 1);
  }

  /** 白噪声 buffer —— 确定性 LCG，不用 `Math.random`（可复现，也便于测试） */
  #noiseBuffer(): AudioBuffer {
    if (this.#noise !== null) return this.#noise;
    const sampleRate = this.#ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * 0.5));
    const buf = this.#ctx.createBuffer(1, length, sampleRate);
    const data = new Float32Array(length);
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0x100000000) * 2 - 1;
    }
    buf.copyToChannel(data, 0);
    this.#noise = buf;
    return buf;
  }

  /**
   * 登记一个已排出去的节点，响完自己摘牌。
   *
   * ★ 第十九份（iPhone 发烫）：响完的那一对（音源 + 包络增益）**从图上拆下来**。
   *   不拆的话它们一直挂在主增益上，要等 GC 才离开渲染图（一首曲子每秒几十个音，
   *   WebKit 上渲染线程每个量子都要走过这一串已经没声的节点）。拆的时刻在 `ended`
   *   之后 —— 声音早已结束，听感不变。
   */
  #track(node: AudioScheduledSourceNode, gain: AudioNode): void {
    this.#live.add(node);
    node.onended = () => {
      this.#live.delete(node);
      node.disconnect();
      gain.disconnect();
    };
  }
}

/**
 * 解锁（第一次用户手势）之后该补播哪一首。
 *
 * 浏览器不许在用户手势之前出声，而「一进标题就点 MIDI01」
 * （`@source 0x004549cf(0)` / `ui_main.asm:187`）发生在那之前 ——
 * 不补播的话，解锁了也是一片安静（用户报的「要点击一下才播放」）。
 *
 * @param screen 当前屏（`main.ts` 的 `Screen`）
 * @param currentTrack 播放器此刻已经拿到的曲名（`MusicPlayer.current`，`''` = 还没有）
 * @returns 要补播的 `.mid` 文件名；`null` = 不用补（已经有一首在等着/在放，别打断它）
 */
export function shouldResumeAfterUnlock(screen: string, currentTrack: string): string | null {
  if (currentTrack !== '') return null;
  // 標題那一首是点名的（id 0）；别的屏没有点名曲目时退回 `Midi.txt` 清单第一首。
  return screen === 'title' ? 'midi01.mid' : (MIDI_PLAYLIST[0] ?? null);
}

export class MusicPlayer {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  /** 当前用的后端。默认振荡器；给了音色库就换成 SoundFont */
  #voice: MidiVoice | null = null;
  /** 用户给的音色库；null = 没有（用振荡器兜底） */
  #font: SoundFont | null = null;
  #song: MidiSong | null = null;
  #name = '';
  /**
   * 解锁**之前**收到的那次 `play()`。
   *
   * ⚠️ 原版一进標題就点 MIDI01，而浏览器要求先有用户手势 —— 中间那段
   *   「还没解锁」的窗口里 `play()` 不能白调。这里把它记下来，`unlock()`
   *   时立刻从这一首的头上排出去（`playing` 随即变 true）。
   */
  #pending = false;
  /** 曲子里下一个还没排的音符下标 */
  #cursor = 0;
  /** 本轮播放在 AudioContext 时间轴上的起点 */
  #startedAt = 0;
  #timer: number | null = null;
  #loop = true;
  /** 这一次 `play()` 从曲子的第几秒起（原版 `play mid from %d`：背景曲被场所打断后接着放）*/
  #fromS = 0;
  /**
   * 一首**不循环**的曲子放完时调（`setLoop(false)` 才会到这里）。
   * 原版靠 `MM_MCINOTIFY` 做同一件事：背景曲放完换下一首（`sub_00454d2c` → `sub_00454d91(0)`）。
   */
  onEnded: (() => void) | null = null;

  /** 当前曲子放到第几秒了（没在放 = 0）—— 场所打断背景曲时记下来，回棋盘接着放 */
  get positionS(): number {
    if (this.#ctx === null || this.#song === null || this.#timer === null) return 0;
    const t = this.#ctx.currentTime - this.#startedAt;
    return Math.max(0, Math.min(t, this.#song.duration));
  }
  #volume = 0.25;

  get playing(): boolean {
    return this.#timer !== null;
  }
  /** 解锁后建好的音频上下文（音效 `SoundPlayer.attach` 共用这一个；没解锁 = null） */
  get context(): AudioContext | null {
    return this.#ctx;
  }

  /**
   * ★ 第十九份（iPhone 发烫）：页面切到后台 / 回到前台。
   *
   * 后台时把**整个**音频上下文挂起（音乐与共用这个上下文的音效一起停；排程器的时间轴
   * `currentTime` 也跟着停住，所以回前台时曲子从停下的那一拍接着放，不跳、不补）。
   * 手机上一个 running 的 AudioContext 会让音频硬件一直开着 —— 看不见的页面没理由占着它。
   *
   * @returns 回前台时：上下文是否已经恢复运行（iOS 偶尔要再等一次手势，调用方据此补挂监听）
   */
  async setBackground(hidden: boolean): Promise<boolean> {
    const ctx = this.#ctx;
    if (ctx === null) return true;
    try {
      if (hidden) {
        if (ctx.state === 'running') await ctx.suspend();
        return false;
      }
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      return false;
    }
    return ctx.state === 'running';
  }
  get current(): string {
    return this.#name;
  }
  get volume(): number {
    return this.#volume;
  }
  /** 解锁前收到过点播、正等第一次手势补播 */
  get pending(): boolean {
    return this.#pending;
  }
  /** 现在用的是不是音色库（面板/日志要如实说） */
  get usingSoundFont(): boolean {
    return this.#font !== null;
  }
  /** 音色库名；没装返回 null */
  get soundFontName(): string | null {
    return this.#font?.name ?? null;
  }

  setVolume(v: number): void {
    this.#volume = Math.max(0, Math.min(1, v));
    if (this.#master !== null) this.#master.gain.value = this.#volume;
  }

  /** 在用户手势里调用 —— 浏览器不许在此之前出声；解锁前记下的那一首在这里补播 */
  unlock(): void {
    if (this.#ctx !== null) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    this.#ctx = new Ctor();
    this.#master = this.#ctx.createGain();
    this.#master.gain.value = this.#volume;
    this.#master.connect(this.#ctx.destination);
    void this.#ctx.resume();
    this.#voice = this.#makeVoice();
    // ★ 解锁前点过的那一首现在补播 —— 不需要再 fetch 一次
    if (this.#pending) {
      this.#pending = false;
      this.#begin();
    }
  }

  /**
   * 直接挂一个已经建好的 `AudioContext`。
   *
   * `unlock()` 只能在**用户手势里**调（浏览器不许在此之前出声），而测试或
   * 别的宿主可能已经有一个现成的 context。挂上去之后按当前有没有音色库建后端。
   */
  attach(ctx: AudioContext, dest: GainNode): void {
    this.#ctx = ctx;
    this.#master = dest;
    dest.gain.value = this.#volume;
    this.#voice = this.#makeVoice();
  }

  /**
   * 装一份音色库（用户自备）。
   *
   * ★ 正在放的话**当场换后端重排**：先从当前曲子的头重新排一遍。
   *   `startedAt` 放在现在，所以听感是「这一首从头再来」，不是静音。
   *   没在放就只是记下来，下一次 `play()` 用。
   */
  setSoundFont(font: SoundFont): void {
    this.#font = font;
    if (this.#ctx === null || this.#master === null) return; // 还没解锁，等 unlock
    const song = this.#song;
    this.#voice?.stop();
    this.#voice = this.#makeVoice();
    if (song !== null) {
      this.#cursor = 0;
      this.#startedAt = this.#ctx.currentTime + 0.1;
      this.#pump();
    }
  }

  /** 把装着的音色库卸掉，退回振荡器 */
  clearSoundFont(): void {
    if (this.#font === null) return;
    this.#font = null;
    if (this.#ctx === null) return;
    const song = this.#song;
    this.#voice?.stop();
    this.#voice = this.#makeVoice();
    if (song !== null) {
      this.#cursor = 0;
      this.#startedAt = this.#ctx.currentTime + 0.1;
      this.#pump();
    }
  }

  #makeVoice(): MidiVoice {
    const ctx = this.#ctx;
    const master = this.#master;
    if (ctx === null || master === null) throw new Error('AudioContext 还没解锁');
    if (this.#font !== null) return new SoundFontVoice(ctx, master, this.#font);
    return new OscillatorVoice(ctx, master);
  }

  /**
   * 换一首。`data` 是 .mid 的原始字节。
   *
   * 还没解锁时**只记下来**（解析仍然当场做，坏字节不留假状态），
   * 等 `unlock()` 里补播 —— 见 `#pending`。
   */
  play(name: string, data: Uint8Array, fromS = 0): void {
    this.stop();
    this.#fromS = Math.max(0, fromS);
    let song: MidiSong;
    try {
      song = parseMidi(data);
    } catch {
      this.#song = null;
      this.#name = '';
      this.#pending = false;
      return;
    }
    this.#song = song;
    this.#name = name;
    if (this.#ctx === null) {
      this.#pending = true;
      return;
    }
    this.#begin();
  }

  stop(): void {
    if (this.#timer !== null) {
      window.clearInterval(this.#timer);
      this.#timer = null;
    }
    // ★ 把已排出去但还没响完的音一并掐掉
    this.#voice?.stop();
    this.#song = null;
    this.#name = '';
    this.#pending = false;
  }

  setLoop(v: boolean): void {
    this.#loop = v;
  }

  /**
   * 从当前 `#song` 的头部开始排程 —— `play()`（已解锁）与 `unlock()`（补播）
   * 共用这一份，免得两条路各写一遍。
   */
  #begin(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#song === null) return;
    // 正常路径上 `unlock()` 已经建好后端；这里兜一层是为了「context 就绪但还没
    // 建后端」（例如测试注入了一个现成的 ctx）时也照样出声
    this.#voice ??= this.#makeVoice();
    // 从 `#fromS` 秒起：起点往回挪这么多，游标跳到第一个还没到点的音
    const from = Math.min(this.#fromS, this.#song.duration);
    this.#fromS = 0;
    const notes = this.#song.notes;
    let cursor = 0;
    while (cursor < notes.length && notes[cursor]!.time < from) cursor++;
    this.#cursor = cursor;
    this.#startedAt = ctx.currentTime + 0.1 - from;
    this.#pump();
    this.#timer = window.setInterval(() => this.#pump(), SCHEDULE_TICK_MS);
  }

  /** 把未来 SCHEDULE_AHEAD_S 秒内的音排出去 */
  #pump(): void {
    const ctx = this.#ctx;
    const song = this.#song;
    const voice = this.#voice;
    if (ctx === null || song === null || voice === null) return;

    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;
    while (this.#cursor < song.notes.length) {
      const n = song.notes[this.#cursor]!;
      const at = this.#startedAt + n.time;
      if (at > horizon) break;
      this.#cursor++;
      voice.schedule(n, at);
    }

    if (this.#cursor >= song.notes.length) {
      const endsAt = this.#startedAt + song.duration;
      if (ctx.currentTime >= endsAt - SCHEDULE_AHEAD_S) {
        if (this.#loop) {
          this.#cursor = 0;
          this.#startedAt = endsAt;
        } else if (ctx.currentTime >= endsAt) {
          // ★ 真放完了才收（上面那道闸提前了一个排程窗口，只为循环时无缝接上）
          this.stop();
          this.onEnded?.();
        }
      }
    }
  }
}
