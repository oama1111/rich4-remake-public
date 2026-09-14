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
 * note on/off（力度 0 的 note on 当作 note off）、program change。
 * 不处理：SMPTE 分辨率、格式 2（原版这 25 个文件都用不到）。
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
