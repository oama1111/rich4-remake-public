/*
 * 音频资源
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 好消息：原版的音频**不需要解码**。
 *   `Effect.mkf`（115 项音效）与 `Speaking.mkf`（1374 项角色语音）
 *   里每一项都是**完整的 RIFF/WAVE 文件**，从 mkf 里取出来就能直接喂给
 *   浏览器的 `decodeAudioData`。
 *
 *   背景音乐更简单：25 首是散落在游戏目录里的标准 `.mid` 文件，
 *   播放顺序写在 `Midi.txt` 里（见 `MIDI_PLAYLIST`）。
 *
 * ⚠️ MIDI **浏览器不能原生播放**。现已自带解析（见 `midi.ts`）与
 *   一个 WebAudio 合成器（`@rich4/client` 的 music.ts）：
 *   旋律、节奏、时值是数据，做得到精确；**音色做不到**——
 *   那取决于当年那块声卡的 GM 波表，同一份 .mid 在不同机器上本就不同。
 *   要真还原得另接 SoundFont 播放器并让用户自备音色库。
 */

/** RIFF/WAVE 文件头长度：'RIFF' + 大小 + 'WAVE' */
const RIFF_HEADER = 12;

/** 这段数据是不是一个 RIFF/WAVE 文件 */
export function isWave(data: Uint8Array): boolean {
  if (data.length < RIFF_HEADER) return false;
  return (
    data[0] === 0x52 && // R
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x46 && // F
    data[8] === 0x57 && // W
    data[9] === 0x41 && // A
    data[10] === 0x56 && // V
    data[11] === 0x45 // E
  );
}

export interface WaveInfo {
  /** 声道数 */
  channels: number;
  /** 采样率 */
  sampleRate: number;
  /** 位深 */
  bitsPerSample: number;
  /** RIFF 头里声明的长度（= 文件长 − 8） */
  declaredSize: number;
}

export class WaveFormatError extends Error {}

/**
 * 读出 WAVE 的格式块。
 *
 * 只解 `fmt ` 这一块——播放交给浏览器，这里读格式是为了能在管线里
 * 做体检（例如确认所有音效采样率一致、没有被截断的文件）。
 */
export function readWaveInfo(data: Uint8Array): WaveInfo {
  if (!isWave(data)) throw new WaveFormatError('不是 RIFF/WAVE');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declaredSize = view.getUint32(4, true);

  // 逐块找 'fmt '
  let off = RIFF_HEADER;
  while (off + 8 <= data.length) {
    const id = String.fromCharCode(data[off]!, data[off + 1]!, data[off + 2]!, data[off + 3]!);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      return {
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitsPerSample: view.getUint16(off + 22, true),
        declaredSize,
      };
    }
    // 块长为奇数时有 1 字节补齐
    off += 8 + size + (size & 1);
  }
  throw new WaveFormatError('WAVE 里找不到 fmt 块');
}

/**
 * 音效编号 → 它在原版里什么时候响。
 *
 * ★ 这些是**从调用点反查出来的**：原版播放音效走
 *   `play_sound(id)` @ VA 0x004549cf，共 22 处调用。把每处的
 *   立即数参数与所在函数对上，就得到下表。
 *
 * ⚠️ 只列**能确定所在函数**的那几个。其余调用点的参数是寄存器
 *   （运行时决定）或所在函数尚未定名，故不猜。
 *   编号与 `Effect.mkf` 的资源号是否直接相等**尚未验证**——
 *   有可能还隔着一张表。用之前要先听一下对不对。
 */
export const SOUND_IDS = {
  /** 破产 @source VA 0x0040d1cb `push 5`，在 player_bankrupt 内 */
  BANKRUPT: 5,
  /** 落在银行 @source VA 0x0043674d `push 4`，在银行落点 0x00436668 内 */
  BANK: 4,
  /** 樂透开奖 @source VA 0x004317a7 `push 8`，在开奖流程 0x00431712 内 */
  LOTTERY_DRAW: 8,
  /** 拍卖 @source VA 0x0043c6ca `push 5`，在 run_auction 0x0043bde5 内 */
  AUCTION: 5,
} as const;

/**
 * 背景音乐清单，顺序取自游戏目录里的 `Midi.txt`。
 *
 * ⚠️ 文件名在磁盘上是小写（`midi01.mid`），`Midi.txt` 里是大写。
 *   在大小写敏感的文件系统上要按实际文件名取。
 */
export const MIDI_PLAYLIST: readonly string[] = [
  'Rich08.mid',
  'Rich16.mid',
  'Rich17.mid',
  'Rich18.mid',
  'Rich19.mid',
  'Rich20.mid',
  'Rich21.mid',
  'Rich22.mid',
  'midi01.mid',
  'midi02.mid',
  'midi03.mid',
  'midi04.mid',
  'midi05.mid',
  'midi06.mid',
  'midi07.mid',
  'midi08.mid',
  'midi09.mid',
  'midi10.mid',
  'midi11.mid',
  'midi12.mid',
  'midi13.mid',
  'midi14-1.mid',
  'midi14-2.mid',
  'midi15.mid',
  'midi16.mid',
];
