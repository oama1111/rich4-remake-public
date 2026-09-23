/*
 * 标准 MIDI 文件（SMF）解析
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的 25 首配乐是**磁盘上的标准 .mid 文件**，不在 mkf 里
 *   （播放顺序见 `MIDI_PLAYLIST`）。浏览器不能直接播 MIDI，
 *   所以这里把它拆成「什么时候、哪个音、响多久」的音符表，
 *   再由客户端用 WebAudio 合成（见 `@rich4/client` 的 music.ts）。
 *
 * ⚠️ 本模块**只解析，不合成**。合成是表现层的事，而且注定不可能
 *   与原版的 GM 音源逐音相同——那取决于当年那块声卡的波表。
 *   把这条界线画清楚：旋律、节奏、时值是**数据**，可以做到精确；
 *   音色是**音源**，做不到，也不该假装做到。
 *
 * 覆盖范围：格式 0/1、变长量、running status、tempo 变化、
 * note on/off（力度 0 的 note on 当作 note off）、program change、
 * **弯音**（0xE0 + RPN 0 弯音幅度 + CC121 复位，见 `MidiNote.bend`）。
 * 不处理：SMPTE 分辨率、格式 2（原版这 25 个文件都用不到）。
 *
 * ★★ 弯音是**数据**（与音高、时值同一类），不是音色 —— 先前整条丢掉，
 *   于是靠弯音「换和弦」的长音被弹成**一个死和弦**。最典型的是百貨公司 / 樂透那首
 *   `midi07.mid`（`SCREEN_BGM` id 6）：2 号通道（Synth Strings，program 50）
 *   从头按住 A 大三和弦 **23.9 秒**（音符 61/64/69），靠 2 号通道上 322 条弯音每两小节在
 *   0 与 −8192（= −2 半音，缺省幅度）之间来回扫，跟着低音 D ↔ A 换和弦；
 *   不认弯音 ⇒ 24 秒纹丝不动（第十二份試玩回報「背景音乐卡住了」）。
 *   全部 25 首里有 16 首带弯音（Rich17 一首就上千条），RPN 0 在
 *   Rich08/16/17/20/21 里改过幅度（12 → 2 / 2.44 半音）。
 */

/** 一个音符 */
export interface MidiNote {
  /** 起始时刻，秒 */
  time: number;
  /** 时长，秒 */
  duration: number;
  /** 音高 0..127，60 = 中央 C */
  note: number;
  /** 力度 0..127 */
  velocity: number;
  /** 通道 0..15 —— ★ 9 号是打击乐通道，音高是鼓号不是音高 */
  channel: number;
  /** 发声时该通道的 GM 音色号 */
  program: number;
  /**
   * 起音那一刻该通道的弯音，**半音**（可为小数、可为负）。
   * 只有非 0 才写 —— 不带弯音的音符与先前的形状完全一样。
   */
  bend?: number;
  /**
   * 发声期间该通道的弯音变化：`at` = 相对**起音**的秒数，`semitones` = 从那一刻起的弯音。
   * 只有真的变过才写。MIDI 弯音本身是阶跃事件，合成端按阶跃排（`setValueAtTime`）。
   */
  bends?: MidiBend[];
}

/** 一次弯音变化（相对起音） */
export interface MidiBend {
  at: number;
  semitones: number;
}

export interface MidiSong {
  /** SMF 格式 0 或 1 */
  format: number;
  /** 每四分音符多少 tick */
  ticksPerQuarter: number;
  /** 全曲时长，秒 */
  duration: number;
  notes: MidiNote[];
}

export class MidiFormatError extends Error {}

/** 默认速度：每四分音符 500000 微秒 = 120 BPM @source SMF 规范 */
export const DEFAULT_TEMPO_US = 500_000;

/** 打击乐通道 @source GM 规范 */
export const DRUM_CHANNEL = 9;

/** 弯音幅度缺省 ±2 半音 @source GM1 规范（RPN 0 Pitch Bend Sensitivity 的上电值） */
export const DEFAULT_BEND_RANGE_SEMITONES = 2;

/** 14 位弯音的中点 @source SMF / MIDI 1.0：0xE0 lsb msb，0x2000 = 不弯 */
const BEND_CENTER = 0x2000;
/** RPN 的「未选中」（CC101/CC100 = 127/127）@source MIDI 1.0 RPN null */
const RPN_NULL = 0x3fff;

const u32 = (d: Uint8Array, at: number): number =>
  ((d[at]! << 24) | (d[at + 1]! << 16) | (d[at + 2]! << 8) | d[at + 3]!) >>> 0;
const u16 = (d: Uint8Array, at: number): number => (d[at]! << 8) | d[at + 1]!;
const tag = (d: Uint8Array, at: number): string =>
  String.fromCharCode(d[at]!, d[at + 1]!, d[at + 2]!, d[at + 3]!);

/** 按 tick 排好的原始事件 —— 多轨要先合流再算时间 */
interface RawEvent {
  tick: number;
  /** 同一 tick 上保持原有先后：轨号 * 大数 + 轨内序号 */
  order: number;
  status: number;
  a: number;
  b: number;
  /** 仅 tempo 事件用 */
  tempo: number;
}

/**
 * 读一个变长量（VLQ）。
 * @returns [值, 读了几个字节]
 */
function readVlq(d: Uint8Array, at: number): [number, number] {
  let value = 0;
  let n = 0;
  for (;;) {
    const byte = d[at + n];
    if (byte === undefined) throw new MidiFormatError('变长量越界');
    value = (value << 7) | (byte & 0x7f);
    n++;
    if ((byte & 0x80) === 0) break;
    if (n > 4) throw new MidiFormatError('变长量超过 4 字节');
  }
  return [value, n];
}

/** 拆一条音轨，把事件按绝对 tick 收进 out */
function parseTrack(d: Uint8Array, from: number, to: number, trackIndex: number, out: RawEvent[]): void {
  let at = from;
  let tick = 0;
  let running = 0;
  let seq = 0;

  while (at < to) {
    const [delta, used] = readVlq(d, at);
    at += used;
    tick += delta;

    let status = d[at]!;
    if ((status & 0x80) !== 0) {
      at++;
    } else {
      // ★ running status：省掉状态字节，沿用上一条
      status = running;
      if (status === 0) throw new MidiFormatError('running status 但此前没有状态字节');
    }

    if (status === 0xff) {
      const type = d[at]!;
      at++;
      const [len, n] = readVlq(d, at);
      at += n;
      // @source SMF：FF 51 03 tttttt = 每四分音符的微秒数
      if (type === 0x51 && len === 3) {
        const tempo = (d[at]! << 16) | (d[at + 1]! << 8) | d[at + 2]!;
        out.push({ tick, order: trackIndex * 1e7 + seq++, status: 0xff51, a: 0, b: 0, tempo });
      }
      at += len;
      // FF 2F = 轨尾
      if (type === 0x2f) return;
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const [len, n] = readVlq(d, at);
      at += n + len;
      continue;
    }

    running = status;
    const kind = status & 0xf0;
    // 0xC0 程序改变与 0xD0 通道压力只有一个数据字节
    const oneByte = kind === 0xc0 || kind === 0xd0;
    const a = d[at]!;
    const b = oneByte ? 0 : d[at + 1]!;
    at += oneByte ? 1 : 2;
    out.push({ tick, order: trackIndex * 1e7 + seq++, status, a, b, tempo: 0 });
  }
}

/**
 * 解析一个 SMF 文件。
 *
 * 多轨（格式 1）要先把所有轨的事件按**绝对 tick** 合流再排序，
 * 才能正确应用 tempo 变化——速度写在 0 号轨上，却对所有轨生效。
 */
export function parseMidi(data: Uint8Array): MidiSong {
  if (data.length < 14 || tag(data, 0) !== 'MThd') {
    throw new MidiFormatError('不是 SMF：缺少 MThd');
  }
  const headerLen = u32(data, 4);
  const format = u16(data, 8);
  const ntrks = u16(data, 10);
  const division = u16(data, 12);
  if ((division & 0x8000) !== 0) {
    throw new MidiFormatError('暂不支持 SMPTE 分辨率');
  }
  const ticksPerQuarter = division;

  const events: RawEvent[] = [];
  let at = 8 + headerLen;
  for (let i = 0; i < ntrks && at + 8 <= data.length; i++) {
    if (tag(data, at) !== 'MTrk') break;
    const len = u32(data, at + 4);
    parseTrack(data, at + 8, Math.min(at + 8 + len, data.length), i, events);
    at += 8 + len;
  }

  // 同一 tick 上按原顺序，跨轨按轨号 —— 保证可重现
  events.sort((x, y) => (x.tick - y.tick) || (x.order - y.order));

  const notes: MidiNote[] = [];
  const program = new Array<number>(16).fill(0);
  /** 每通道每音高当前未闭合的那个音符（后来的覆盖先前的，与多数音源一致） */
  const sounding = new Map<number, MidiNote>();

  let tempo = DEFAULT_TEMPO_US;
  let lastTick = 0;
  let seconds = 0;
  const secondsPerTick = (): number => tempo / 1_000_000 / ticksPerQuarter;

  // ★ 弯音：每通道当前弯音（半音）、幅度（RPN 0 = 半音 + 音分）、当前选中的 RPN
  const bendSemis = new Array<number>(16).fill(0);
  const rangeSemis = new Array<number>(16).fill(DEFAULT_BEND_RANGE_SEMITONES);
  const rangeCents = new Array<number>(16).fill(0);
  const rpn = new Array<number>(16).fill(RPN_NULL);

  /** 通道弯音变了：记下来，并给这条通道上**还按着**的音各记一笔 */
  const setBend = (channel: number, semitones: number, at: number): void => {
    if (bendSemis[channel] === semitones) return;
    bendSemis[channel] = semitones;
    for (const n of sounding.values()) {
      if (n.channel !== channel) continue;
      (n.bends ??= []).push({ at: Math.max(0, at - n.time), semitones });
    }
  };

  const closeNote = (channel: number, pitch: number, endAt: number): void => {
    const key = channel * 128 + pitch;
    const n = sounding.get(key);
    if (n === undefined) return;
    n.duration = Math.max(0, endAt - n.time);
    sounding.delete(key);
  };

  for (const e of events) {
    seconds += (e.tick - lastTick) * secondsPerTick();
    lastTick = e.tick;

    if (e.status === 0xff51) {
      tempo = e.tempo > 0 ? e.tempo : DEFAULT_TEMPO_US;
      continue;
    }

    const kind = e.status & 0xf0;
    const channel = e.status & 0x0f;
    if (kind === 0xc0) {
      program[channel] = e.a;
      continue;
    }
    // ★ 弯音 0xE0：14 位值（lsb = a、msb = b），中点 0x2000；半音 = 偏移 / 8192 × 幅度
    if (kind === 0xe0) {
      const raw = ((e.b & 0x7f) << 7) | (e.a & 0x7f);
      const range = (rangeSemis[channel] ?? DEFAULT_BEND_RANGE_SEMITONES) + (rangeCents[channel] ?? 0) / 100;
      setBend(channel, ((raw - BEND_CENTER) / BEND_CENTER) * range, seconds);
      continue;
    }
    if (kind === 0xb0) {
      const cc = e.a;
      const v = e.b & 0x7f;
      // RPN 选择：CC101 = MSB、CC100 = LSB；RPN 0/0 = 弯音幅度
      if (cc === 101) rpn[channel] = (v << 7) | ((rpn[channel] ?? RPN_NULL) & 0x7f);
      else if (cc === 100) rpn[channel] = ((rpn[channel] ?? RPN_NULL) & 0x3f80) | v;
      // Data Entry：MSB = 半音、LSB = 音分（只认 RPN 0；别的 RPN/NRPN 与弯音无关）
      else if (cc === 6 && rpn[channel] === 0) rangeSemis[channel] = v;
      else if (cc === 38 && rpn[channel] === 0) rangeCents[channel] = v;
      // CC121 Reset All Controllers：弯音回中、RPN 回「未选中」（幅度不动）@source GM RP-015
      else if (cc === 121) {
        rpn[channel] = RPN_NULL;
        setBend(channel, 0, seconds);
      }
      continue;
    }
    // ★ 力度 0 的 note on 等同 note off —— 大量文件靠它配合 running status 省字节
    if (kind === 0x80 || (kind === 0x90 && e.b === 0)) {
      closeNote(channel, e.a, seconds);
      continue;
    }
    if (kind === 0x90) {
      closeNote(channel, e.a, seconds); // 同音重击：先收掉前一个
      const n: MidiNote = {
        time: seconds,
        duration: 0,
        note: e.a,
        velocity: e.b,
        channel,
        program: program[channel] ?? 0,
      };
      const bend = bendSemis[channel] ?? 0;
      if (bend !== 0) n.bend = bend;
      sounding.set(channel * 128 + e.a, n);
      notes.push(n);
    }
  }

  // 轨尾还按着的音，给一个收尾时长
  for (const [, n] of sounding) n.duration = Math.max(n.duration, 0.25);

  let duration = 0;
  for (const n of notes) duration = Math.max(duration, n.time + n.duration);

  return { format, ticksPerQuarter, duration, notes };
}
