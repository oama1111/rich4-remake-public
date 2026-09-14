/*
 * 背景音乐 —— 用 WebAudio 把 MIDI 弹出来
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：只读状态，不含任何规则。
 *
 * 原版的 25 首配乐是磁盘上的标准 .mid（见 `MIDI_PLAYLIST`），
 * 浏览器不能直接播。这里把解析出来的音符表排到 WebAudio 的振荡器上。
 *
 * ⚠️ **这不是还原音色，也不可能是。** 原版听起来什么样取决于当年那块
 *   声卡的 GM 波表；同一份 .mid 在不同机器上本来就不一样。
 *   所以这里明确只做**旋律、节奏、时值**——那些是数据，能做到精确；
 *   音色用几种简单波形按 GM 大类近似，不假装是波表合成。
 *   要真还原，得另外接一个 SoundFont 播放器并让用户自备音色库。
 *
 * ⚠️ 打击乐（9 号通道）**整条跳过**：那个通道上的「音高」是鼓号不是音高，
 *   用振荡器弹出来只会是一串怪叫。宁可没有鼓，也不要错的鼓。
 */

import { parseMidi, DRUM_CHANNEL, type MidiNote, type MidiSong } from '@rich4/assets-pipeline';

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

export class MusicPlayer {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #song: MidiSong | null = null;
  #name = '';
  /** 曲子里下一个还没排的音符下标 */
  #cursor = 0;
  /** 本轮播放在 AudioContext 时间轴上的起点 */
  #startedAt = 0;
  #timer: number | null = null;
  #loop = true;
  #volume = 0.25;
  /**
   * 已经排出去、还没响完的振荡器。
   *
   * ⚠️ 停止必须**真的停**：排程是提前 2 秒做的，光把定时器关掉，
   *   已排出去的音还会继续响两秒。按了停止还在响，那不叫停止。
   */
  readonly #live = new Set<OscillatorNode>();

  get playing(): boolean {
    return this.#timer !== null;
  }
  get current(): string {
    return this.#name;
  }
  get volume(): number {
    return this.#volume;
  }

  setVolume(v: number): void {
    this.#volume = Math.max(0, Math.min(1, v));
    if (this.#master !== null) this.#master.gain.value = this.#volume;
  }

  /** 在用户手势里调用 —— 浏览器不许在此之前出声 */
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
  }

  /** 换一首。`data` 是 .mid 的原始字节 */
  play(name: string, data: Uint8Array): void {
    this.stop();
    if (this.#ctx === null) return;
    try {
      this.#song = parseMidi(data);
    } catch {
      this.#song = null;
      return;
    }
    this.#name = name;
    this.#cursor = 0;
    this.#startedAt = this.#ctx.currentTime + 0.1;
    this.#pump();
    this.#timer = window.setInterval(() => this.#pump(), SCHEDULE_TICK_MS);
  }

  stop(): void {
    if (this.#timer !== null) {
      window.clearInterval(this.#timer);
      this.#timer = null;
    }
    // ★ 把已排出去但还没响完的音一并掐掉
    for (const osc of this.#live) {
      try {
        osc.stop();
      } catch {
        // 已经停过的节点再 stop 会抛，忽略
      }
    }
    this.#live.clear();
    this.#song = null;
    this.#name = '';
  }

  setLoop(v: boolean): void {
    this.#loop = v;
  }

  /** 把未来 SCHEDULE_AHEAD_S 秒内的音排出去 */
  #pump(): void {
    const ctx = this.#ctx;
    const song = this.#song;
    const master = this.#master;
    if (ctx === null || song === null || master === null) return;

    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;
    while (this.#cursor < song.notes.length) {
      const n = song.notes[this.#cursor]!;
      const at = this.#startedAt + n.time;
      if (at > horizon) break;
      this.#cursor++;
      this.#emit(ctx, master, n, at);
    }

    if (this.#cursor >= song.notes.length) {
      const endsAt = this.#startedAt + song.duration;
      if (ctx.currentTime >= endsAt - SCHEDULE_AHEAD_S) {
        if (this.#loop) {
          this.#cursor = 0;
          this.#startedAt = endsAt;
        } else {
          this.stop();
        }
      }
    }
  }

  #emit(ctx: AudioContext, master: GainNode, n: MidiNote, at: number): void {
    // ⚠️ 打击乐通道跳过 —— 见文件头
    if (n.channel === DRUM_CHANNEL) return;
    if (n.duration <= 0) return;

    const osc = ctx.createOscillator();
    osc.type = waveFor(n.program);
    osc.frequency.value = freq(n.note);

    const gain = ctx.createGain();
    // 力度 0..127 → 音量，再留出复音叠加的余量
    const peak = (n.velocity / 127) * 0.18;
    const attack = 0.01;
    const release = Math.min(0.12, n.duration * 0.4);
    const end = at + n.duration;

    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.setValueAtTime(peak, Math.max(at + attack, end - release));
    gain.gain.linearRampToValueAtTime(0, end);

    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(end + 0.02);
    this.#live.add(osc);
    osc.onended = () => {
      this.#live.delete(osc);
    };
  }
}
