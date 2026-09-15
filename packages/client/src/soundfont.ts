/*
 * SoundFont 2（.sf2）解析 + 选区（preset → instrument → sample）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 本文件**只解析、只选区，不碰 WebAudio** —— 出声那半在 `soundfont-voice.ts`。
 *   这样解析器可以在 node 下用合成出来的夹具直接跑（见 `soundfont.test.ts`），
 *   而这一层正是最容易出错的一层。
 *
 * ★ 为什么有这一层：`music.ts` 的振荡器合成只能还原**旋律/节奏/时值**，
 *   音色做不到。要还原音色就得有一个 SoundFont 播放器 —— 这就是它（Q8）。
 *   **音色库由用户自备，本项目不分发任何 .sf2**（C-LEG / DEVELOPMENT_PLAN §5.6）。
 *
 * ---------------------------------------------------------------------------
 * 依据：SoundFont 2.04 规范（下文 `@source SF2 2.04 §x.y`）
 *
 * 本文件只实现「够放 MIDI 文件」的那一部分，**不实现**调制器（modulators）：
 * `pmod` / `imod` 一律跳过。这会有可听的差别（例如有些音色库用调制器做
 * 力度→亮度），登记在 `docs/known-deviations.md` 的 Q8。
 *
 * 几条容易搞错的、这里按规范定死的：
 *
 * 1. **generator 的叠加规则**（§8.1.3、§9.4，见 [fluid-dev 讨论][fs] 的复述）：
 *    每个 level 内「local zone 覆盖 global zone」，然后 **preset level 的结果
 *    加到 instrument level 的结果上**（preset 层的默认值是 0，不是乐器层的默认值）。
 *    instrument level 没给某一项时用的是 §8.1.3 的默认值。
 *    [fs]: https://lists.gnu.org/archive/html/fluid-dev/2020-06/msg00001.html
 *
 * 2. **preset zone 里合法的 generator 很少**（§9.4 的图 + §8.1.3 的仪器层专属列）：
 *    `keyRange` / `velRange`，以及 `instrument` / 各种 offset / `sampleModes` /
 *    `scaleTuning` / `keynum` 这一类**仪器层专属**的。为避免「照自己的心意实现」，
 *    这里按 §9.4 表里预设层的那一列来取：预设层只认 `keyRange`、`velRange`、
 *    `instrument`、`initialAttenuation`、`pan` 与包络四项（attack/hold/decay/release
 *    的 volume envelope）。**其余一律忽略**，因为它们本来就不该出现在预设层。
 *
 * 3. **音量包络的单位**（§8.1.3 gen 33/34/35/38/39）：
 *    - attack/hold/decay/release = **timecents**，`秒 = 2^(tc/1200)`
 *      （默认 `-12000 tc = 1 ms`，`0 tc = 1 s`）
 *    - sustain = **centibels**（0.1 dB）**衰减量**，0 = 不衰减
 *    本文件把 timecents 换成秒、把 centibels 换成**线性增益**存下来。
 *    dB → 线性用规范 §9.6.2 的 `振幅比 = 10^(dB/20)`；换算成 centibel
 *    即 `× 10^(−0.4/100)`（0.4 dB/cB 是规范里画的那条「4 dB/十个单位」的斜率，
 *    也是 fluidsynth 等实现用的常数，见 [fluid gen.h][fg]）。
 *    [fg]: http://www.nongnu.org/fluid/api/gen_8.h.html
 *
 * 4. **循环语义**（§7.10 `sampleModes`，gen 54）：
 *    `0` 不循环；`1` **持续循环**（一直循环到 note-off）；`2` 不循环但用循环点
 *    决定释放段；`3` **循环到 note-off 为止**（release 阶段才脱离循环）。
 *    规范里 2/3 写着 "reserved"，但 3 是事实标准（几乎所有音色库都用 3），
 *    故 1 与 3 都当循环处理：`loop` 打开，靠停止时刻切断。
 *    `loopStart`/`loopEnd`（gen 0/1）是**从 sample 起点算的偏移**，
 *    单位是 sample（16 位帧），不是字节 —— 见 §7.10 sample header。
 */

/** RIFF 头后面的 FORM 类型必须是这四个字节 */
const SF2_FORM = 'sf2';

/** 本解析器认识的顶层片段 */
const CHUNK_INFO = 'LIST'; // 其 form 为 'INFO' / 'sdta' / 'pdta'

/**
 * `pdta` 下的必需子片段 @source SF2 2.04 §7.2 表：
 * `phdr` / `pbag` / `pmod` / `pgen` / `inst` / `ibag` / `imod` / `igen` / `shdr`。
 *
 * ⚠️ 本解析器**只把缺 `phdr`/`pbag`/`pgen`/`inst`/`ibag`/`igen`/`shdr` 当错**（读的时候
 *   自然就找不到、会返回 null）；`pmod`/`imod` 是调制器表，本实现**刻意跳过**
 *   （见文件头），所以**不校验它们**——不少真实音色库也省略这两个段。
 *   这里只作为「规范要求了哪些段」的记录，不落成常量（免得变成没人用的死值）。
 */

/**
 * generator 号 → 语义。
 *
 * 只列本解析器**会用**的那些；其余（滤波、调制包络、颤音……）在
 * `parseGenerators` 里被安静忽略 —— 不是漏了解析，而是这一层用不上。
 * @source SF2 2.04 §8.1.3 表
 */
const GEN = {
  /** 17 预设层唯一合法的「选哪个乐器」 */
  INSTRUMENT: 41,
  /** 43 keyRange：amount 低字节 = lo，高字节 = hi */
  KEY_RANGE: 43,
  /** 44 velRange：同上 */
  VEL_RANGE: 44,
  /** 初始衰减，centibels */
  INITIAL_ATTENUATION: 48,
  /** 循环模式 @source §7.10 */
  SAMPLE_MODES: 54,
  /** 53 sampleID：指向 shdr 的第几项 */
  SAMPLE_ID: 53,
  /** 58 保音区间的起点偏移（sample 单位） */
  START_ADD_OFFSET: 0,
  START_ADD_COARSE: 4,
  END_ADD_OFFSET: 1,
  END_ADD_COARSE: 12,
  START_LOOP_OFFSET: 2,
  START_LOOP_COARSE: 45,
  END_LOOP_OFFSET: 3,
  END_LOOP_COARSE: 50,
  /** 56 粗调，半音（有符号） */
  COARSE_TUNE: 51,
  /** 57 细调，音分（有符号） */
  FINE_TUNE: 52,
  /** 51 每半音多少个音分，默认 100 */
  SCALE_TUNING: 56,
  /** 27 力度 → 初始衰减的调制深度，centibels */
  VELOCITY_TO_ATTENUATION: 46,
  /** 33..35 / 38 / 39 音量包络 */
  ATTACK_VOL_ENV: 34,
  HOLD_VOL_ENV: 35,
  DECAY_VOL_ENV: 36,
  SUSTAIN_VOL_ENV: 37,
  RELEASE_VOL_ENV: 38,
} as const;

/**
 * 「这一项没给」的哨兵。
 *
 * @source SF2 2.04 §8.1.3：所有 generator 的默认值都是 -1（0xFFFF，
 *   即有符号的 −1），除了下表里另有默认值的那些（0 / 100 / 0.5 之类）。
 *   本解析器用 `undefined` 表示「没给」，比 -1 好认。
 */
const UNSET = -1;

export class SoundFontError extends Error {}

/** 键/力度区间，闭区间（规范里 keyRange 的两个字节就是 lo/hi） */
export interface KeyRange {
  lo: number;
  hi: number;
}

/**
 * 一个「能落到某个 sample 上」的区间 = 乐器层的一个 local zone
 * 加上它所属预设的 local zone 的叠加结果。
 *
 * 下面所有字段都已经是**可直接用的单位**：
 * 秒、线性增益、半音、sample 帧。原始 SF2 的那套 timecent/centibel
 * 已经在解析时换算掉了（依据见文件头）。
 */
export interface SoundFontZone {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  /** 落到的样本下标（`SoundFont.samples` 的下标） */
  sample: number;
  /**
   * 起始偏移（sample 帧，已含 coarse，可正可负）。
   *
   * ⚠️ 这是**偏移**，不是绝对位置 —— 绝对位置是
   * `sample.pcm` 的第 `start` 帧起（`startAddrsOffset/CoarseOffset` 是相对
   * sample 起点的位移）@source SF2 2.04 §8.1.3 gen 0/4。
   */
  start: number;
  /** 结束偏移（sample 帧，**不含**；可正可负，**相对 `shdr` 的 `end`**） */
  end: number;
  /**
   * 循环起点（sample 帧）。
   *
   * ★ 已经把 `shdr` 的 `loopStart` 与 gen 2/45 的偏移加好了 —— 绝对位置。
   *   @source SF2 2.04 §8.1.3 gen 2/45 是**相对 loop start 的偏移**，
   *   默认值 0 表示「就用 sample header 里的那个循环点」。
   */
  loopStart: number;
  /** 循环终点（sample 帧，不含，绝对位置 = `shdr.loopEnd` + gen 3/50） */
  loopEnd: number;
  /** 0 不循环 / 1 持续循环 / 2 用循环点定释放 / 3 循环到 note-off */
  loopMode: number;
  /** 粗调半音 + 细调音分，合成后的**半音**数（可为小数） */
  tuneSemitones: number;
  /** 每半音的音分数，默认 100 */
  scaleTuning: number;
  /** 音量包络：起始衰减量，线性增益（1 = 不衰减） */
  initialAttenuation: number;
  /** 力度 → 衰减的调制深度，centibels（0 = 不随力度变） */
  velocityToAttenuation: number;
  /** timecents → 秒 */
  attack: number;
  hold: number;
  decay: number;
  release: number;
  /** centibels → 线性增益（1 = 不衰减） */
  sustain: number;
}

/** 乐器层的一个 local zone（还没叠 preset 层的量） */
interface InstrumentZone extends SoundFontZone {
  /** 这一项是不是「global zone」（`pgen`/`igen` 段长为 0 的那个） */
  global: boolean;
}

interface Instrument {
  name: string;
  /** 按 `ibag` 顺序的 local zone（global 那个已经先摊进它们了） */
  zones: readonly InstrumentZone[];
}

/** 预设里的一个 local zone：指向某个 instrument，外加预设层的叠加量 */
interface PresetZone {
  instrument: number;
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  /** 预设层的包络/衰减叠加量（缺省为「不叠加」） */
  attenuation: number;
  attack: number;
  hold: number;
  decay: number;
  release: number;
  sustain: number;
}

export interface Preset {
  name: string;
  bank: number;
  program: number;
  zones: readonly PresetZone[];
}

export interface SoundFontSample {
  name: string;
  /** 16 位单声道 PCM，已经按小端解出来 */
  pcm: Int16Array;
  sampleRate: number;
  /** 规范里的「原始音高」，MIDI 音符号 */
  rootKey: number;
  /** 修正量，音分 */
  pitchCorrection: number;
  loopStart: number;
  loopEnd: number;
}

export interface SoundFont {
  name: string;
  presets: readonly Preset[];
  /** 预设层引用到的乐器（全库都留着，诊断与测试要看） */
  instruments: readonly Instrument[];
  samples: readonly SoundFontSample[];
}

// ============================================================
//  RIFF 底座
// ============================================================

function u8(d: Uint8Array, at: number): number {
  const v = d[at];
  if (v === undefined) throw new SoundFontError(`读到文件尾（偏移 ${at}）`);
  return v;
}
function u16(d: Uint8Array, at: number): number {
  return u8(d, at) | (u8(d, at + 1) << 8);
}
function i16(d: Uint8Array, at: number): number {
  const v = u16(d, at);
  return v >= 0x8000 ? v - 0x10000 : v;
}
function u32(d: Uint8Array, at: number): number {
  return (u8(d, at) | (u8(d, at + 1) << 8) | (u8(d, at + 2) << 16) | (u8(d, at + 3) << 24)) >>> 0;
}
/**
 * RIFF 的 FORM 类型。
 *
 * ⚠️ 是**三个**字节 `'sf2'`（不是四个）—— 紧跟其后的 `LIST` 头的第一个字节
 *   常被连读成 `'sf2L'`，是这一层最容易读错的地方。
 * @source SF2 2.04 §7.1：`RIFF( 'sf2' <INFO> <sdta> <pdta> )`
 */
function threecc(d: Uint8Array, at: number): string {
  return String.fromCharCode(u8(d, at), u8(d, at + 1), u8(d, at + 2));
}

function fourcc(d: Uint8Array, at: number): string {
  return String.fromCharCode(u8(d, at), u8(d, at + 1), u8(d, at + 2), u8(d, at + 3));
}

/**
 * RIFF 里的定长名字：定长区 + 结尾 0，读成串时把 0 之后丢掉。
 *
 * ⚠️ 名字**按 UTF-8 解**：规范说这是 ASCII，但实际音色库里中文/日文库名不少，
 *   逐字节 `String.fromCharCode` 会解成乱码（`'測試'` → `'æ¸¬è©¦'`）。
 *   非法字节序列退回 Latin-1 逐字节解，不让整个库名变成空。
 */
function fixedAscii(d: Uint8Array, at: number, len: number): string {
  let end = at;
  const stop = at + len;
  while (end < stop && d[end] !== 0) end++;
  const bytes = d.subarray(at, end);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  }
}

/**
 * 一个 RIFF 片段。
 *
 * ⚠️ **以头为准**：`at` 是「8 字节头的起点」，不是内容起点。这样遍历子片段
 *   时每次前进的量与逻辑一致（`at += 8 + len + 填充`），不会出现「表读的是
 *   内容、遍历按头算」那种错位 —— 那个错位会让 'LIST' 被当成 'IST '。
 */
interface Chunk {
  id: string;
  /** 片段头的起点（内容在 `at + 8`） */
  at: number;
  /** 内容长度（不含头、不含填充） */
  len: number;
  /** 内容起点 = `at + 8` */
  bodyAt: number;
  /** 片段末尾（含填充），下一个兄弟片段从这里开始 */
  end: number;
}

/**
 * 遍历一个 RIFF 容器里的子片段。
 *
 * @source RIFF 规范：每个片段 8 字节头（4 字节 id + 4 字节小端长度），
 *   内容**按偶数字节对齐**（长度为奇时补一个填充字节）。
 */
function* chunks(d: Uint8Array, from: number, to: number): Generator<Chunk> {
  let at = from;
  while (at + 8 <= to) {
    const id = fourcc(d, at);
    // id 必须是四个 ASCII 可见字符，否则说明前面的长度字段读歪了 ——
    // 与其继续啃出一堆「片段 IST 超出文件尾」的迷惑错误，不如就地报清楚
    for (let i = 0; i < 4; i++) {
      const b = u8(d, at + i);
      if (b < 0x20 || b > 0x7e) {
        throw new SoundFontError(`片段头不是四个可见字符（@${at}）—— 长度字段可能读歪了`);
      }
    }
    const len = u32(d, at + 4);
    const end = at + 8 + len + (len & 1);
    if (end > d.length) {
      throw new SoundFontError(`片段 ${id} 超出文件尾（${len} 字节 @${at + 8}）`);
    }
    yield { id, at, len, bodyAt: at + 8, end };
    at = end;
  }
}

function requireChunk(d: Uint8Array, from: number, to: number, id: string): Chunk {
  for (const c of chunks(d, from, to)) if (c.id === id) return c;
  throw new SoundFontError(`缺少必需的片段：${id}`);
}

/**
 * 从一个 `LIST` 片段里取 form。
 *
 * ⚠️ `Chunk.bodyAt` 是**头之后**，也就是 `LIST` 的内容开头 ——
 *   而内容开头是它自己的 form（`'INFO'`/`'sdta'`/`'pdta'`，**4 个字节**），
 *   **不是**子片段头。两处都容易读错：
 *   - 读 3 字节（'INF'）→ 跟 'INFO' 永远比不相等
 *   - 把它当成子片段头 → 读出 'NFOI' 这种错位的 id
 */
function listForm(d: Uint8Array, c: Chunk): string {
  return fourcc(d, c.bodyAt);
}

/** `LIST` 的子片段（跳过内容开头那 4 字节 form） */
function listChunks(d: Uint8Array, c: Chunk): Generator<Chunk> {
  return chunks(d, c.bodyAt + 4, c.end);
}

// ============================================================
//  解析
// ============================================================

/**
 * 解析一个 `.sf2`。
 *
 * 只认 `sf2` 这一种形式；`.sf3`（Vorbis 压缩样本）会被挡在这里，
 * 因为那需要另外一套解码器（登记在 Q8）。
 *
 * @param data 整个文件字节
 * @param name 显示用的名字（日志/诊断），不影响解析
 */
export function parseSoundFont(data: Uint8Array, name = ''): SoundFont {
  if (data.length < 12) throw new SoundFontError('文件太短，不像 RIFF');
  if (fourcc(data, 0) !== 'RIFF') throw new SoundFontError('不是 RIFF 文件（缺 RIFF 头）');
  // ★ FORM 类型只有 3 字节：'sf2'；读 4 字节会把后面 LIST 的 'L' 连进来
  if (threecc(data, 8) !== SF2_FORM) {
    throw new SoundFontError(`不是 sf2（FORM 类型是 ${threecc(data, 8)}）`);
  }

  // ★ `'sf2'` 是 **3** 个字节，所以顶层第一个片段从 **11** 开始，
  //   不是 12 —— 这里少算一字节，后面每一层的 id 都会错开一位
  //   （症状是读出 'NFOI'、'IST ' 这种「像但不对」的 id）。
  //   规整写法：`'RIFF' + u32 + 'sf2' + LIST...` @source SF2 2.04 §7.1
  const firstTop = 8 + SF2_FORM.length;
  const info = findList(data, firstTop, data.length, 'INFO');
  const sdta = findList(data, firstTop, data.length, 'sdta');
  const pdta = findList(data, firstTop, data.length, 'pdta');
  if (pdta === undefined) throw new SoundFontError('没有 pdta 片段 —— 不是 SoundFont');

  const fontName = info === undefined ? name : readInfoName(data, info) || name;
  const smpl = sdta === undefined ? undefined : findChunk(data, sdta, 'smpl');
  return readPdta(data, pdta, smpl, fontName);
}

/** 在 `[from, to)` 里找一个指定 form 的 `LIST` */
function findList(d: Uint8Array, from: number, to: number, form: string): Chunk | undefined {
  for (const c of chunks(d, from, to)) {
    if (c.id !== CHUNK_INFO) continue;
    if (c.len < 4 || listForm(d, c) !== form) continue;
    return c;
  }
  return undefined;
}

/** `LIST` 的直接子片段 */
function findChunk(d: Uint8Array, parent: Chunk, id: string): Chunk | undefined {
  for (const c of listChunks(d, parent)) if (c.id === id) return c;
  return undefined;
}

/** `INFO` 里的 `INAM` 就是音色库名 */
function readInfoName(d: Uint8Array, info: Chunk): string {
  const inam = findChunk(d, info, 'INAM');
  return inam === undefined ? '' : fixedAscii(d, inam.bodyAt, inam.len).trim();
}

/**
 * `pdta` —— 全部结构与 generator 都在这里。
 *
 * @source SF2 2.04 §7.2（子片段一览）、§7.3–§7.10（各表字段）
 */
function readPdta(d: Uint8Array, pdta: Chunk, smpl: Chunk | undefined, name: string): SoundFont {
  const from = pdta.bodyAt + 4;
  const to = pdta.end;
  const get = (id: string): Chunk => requireChunk(d, from, to, id);

  const samples = readSamples(d, get('shdr'), smpl);
  const instruments = readInstruments(d, get('inst'), get('ibag'), get('igen'), samples.length);
  const presets = readPresets(d, get('phdr'), get('pbag'), get('pgen'), instruments.length);
  return { name, presets, instruments, samples };
}

const PHDR_SIZE = 38;
const INST_SIZE = 22;
/**
 * `pbag`/`ibag` 一项的**两项**长度，以及每项里存 `genNdx` 的那 2 字节。
 *
 * ★ 规范里一项是 **4 字节**，但**两个 16 位字段都是 `genNdx`**
 *   （表格里那列写着 `modNdx`，实际值就是 generator 下标；调制器下标在
 *   `pmod`/`imod` 里各条自带）。所以每项只贡献**一个**下标，
 *   而且它在靠近项首的那 2 字节。
 *   @source SF2 2.04 §7.4 pbag / §7.6 ibag
 */
const BAG_SIZE = 4;
const GEN_SIZE = 4;
const SHDR_SIZE = 46;

function tableRows(chunk: Chunk, size: number, what: string): number {
  if (chunk.len % size !== 0) {
    throw new SoundFontError(`${what} 的长度 ${chunk.len} 不是 ${size} 的整数倍`);
  }
  return Math.trunc(chunk.len / size);
}

// ---- shdr / sdta ----

interface RawSampleHeader {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  rootKey: number;
  pitchCorrection: number;
}

function readSampleHeaders(d: Uint8Array, shdr: Chunk): RawSampleHeader[] {
  const rows = tableRows(shdr, SHDR_SIZE, 'shdr');
  // 规范要求最后一项是 EOS 终结记录（名字 "EOS"），不参与引用
  const out: RawSampleHeader[] = [];
  for (let i = 0; i < rows; i++) {
    const at = shdr.bodyAt + i * SHDR_SIZE;
    out.push({
      name: fixedAscii(d, at, 20).trim(),
      start: u32(d, at + 20),
      end: u32(d, at + 24),
      loopStart: u32(d, at + 28),
      loopEnd: u32(d, at + 32),
      sampleRate: u32(d, at + 36),
      rootKey: u8(d, at + 40),
      pitchCorrection: i16(d, at + 41),
    });
  }
  return out;
}

/**
 * `sdta` 的 `smpl` 是一整块 16 位小端单声道 PCM，所有 sample 共用它，
 * 靠 shdr 里的 start/end 切。这里把每个 sample **复制**出来 —— 复制而不是
 * 视图，因为后面要按 1.0/0.5 之类的比例重采样，还得交给 `AudioBuffer` 拷贝。
 * @source SF2 2.04 §7.2 sdta
 */
function readSamples(d: Uint8Array, shdr: Chunk, smpl: Chunk | undefined): SoundFontSample[] {
  const headers = readSampleHeaders(d, shdr);
  const out: SoundFontSample[] = [];
  for (const h of headers) {
    // 终结记录之后就没有样本了；名字为 EOS 或缺数据的一律跳过
    if (h.name === 'EOS' || h.sampleRate === 0 || h.end <= h.start) continue;
    if (smpl === undefined) break;
    const start = h.start;
    const end = h.end;
    if (start * 2 + 2 > smpl.len) {
      throw new SoundFontError(`样本 ${h.name || out.length} 的 start 越界（${start}）`);
    }
    // ⚠️ 不信任 end：有些音色库的终结记录 end 会给一个越界的值
    const usableEnd = Math.min(end, Math.trunc(smpl.len / 2));
    const frames = usableEnd - start;
    const pcm = new Int16Array(frames);
    for (let i = 0; i < frames; i++) pcm[i] = i16(d, smpl.bodyAt + (start + i) * 2);
    out.push({
      name: h.name,
      pcm,
      // AudioBuffer 不接受离谱的采样率；规范里合法的范围是 400..50000
      sampleRate: Math.max(400, Math.min(h.sampleRate, 50000)),
      rootKey: h.rootKey > 127 ? 60 : h.rootKey,
      pitchCorrection: h.pitchCorrection,
      loopStart: Math.max(0, Math.min(h.loopStart - start, frames)),
      loopEnd: Math.max(0, Math.min(h.loopEnd - start, frames)),
    });
  }
  return out;
}

// ---- pgen / igen ----

interface GenValue {
  /** generator 号 */
  op: number;
  /** 原样的 16 位小端**
   *  —— keyRange/velRange 用它的两个字节，其余用它的有符号解释 */
  raw: number;
}

function readGens(d: Uint8Array, gen: Chunk): GenValue[] {
  const rows = tableRows(gen, GEN_SIZE, 'pgen/igen');
  const out: GenValue[] = [];
  for (let i = 0; i < rows; i++) {
    const at = gen.bodyAt + i * GEN_SIZE;
    out.push({ op: u16(d, at), raw: u16(d, at + 2) });
  }
  return out;
}

/**
 * `pbag`/`ibag` 每一项里的 generator 起点下标。
 *
 * ★ 一项是 4 字节 = **两个 WORD**，但两个都是 generator 下标：
 *   `{WORD wGenNdx; WORD wModNdx;}` —— 表里那列写着 `wModNdx`，实际值按规范
 *   就是同一个 generator 下标（调制器下标在 `pmod`/`imod` 各条记录里自带）。
 *   **取第一个 WORD**：这是规范定义的 `wGenNdx` 位置，也是 fluidsynth 读的那一个；
 *   写成 +2（第二个 WORD）会在只写 `[genNdx, 0]` 的正常音色库上读出全 0。
 *   每一项的区间就是「自己到下一项」的值，故这里只读出起点数组。
 * @source SF2 2.04 §7.4 pbag / §7.6 ibag（`{WORD wGenNdx; WORD wModNdx;}`）
 */
function readBagStarts(d: Uint8Array, bag: Chunk, what: string): number[] {
  const rows = tableRows(bag, BAG_SIZE, what);
  const out: number[] = [];
  for (let i = 0; i < rows; i++) out.push(u16(d, bag.bodyAt + i * BAG_SIZE));
  return out;
}

// ---- 把 generator 摊成一份可查表 ----

/**
 * 一层（global 或 local）里的 generator 取值。
 *
 * 只留本解析器认识的那些；其余忽略（不是解析不了，是这一层用不上）。
 * 值统一取**有符号 16 位**解释 —— keyRange/velRange 单独拆字节。
 */
class GenSet {
  readonly #values = new Map<number, number>();

  constructor(gens: readonly GenValue[], from: number, to: number) {
    for (let i = from; i < to; i++) {
      const g = gens[i];
      if (g === undefined) continue;
      const v = g.raw >= 0x8000 ? g.raw - 0x10000 : g.raw;
      this.#values.set(g.op, v);
    }
  }

  /** 这一层写了几个 generator —— 0 个的那个 zone 就是 global zone */
  get size(): number {
    return this.#values.size;
  }

  has(op: number): boolean {
    return this.#values.has(op);
  }

  /** 没给就返回 `fallback` */
  get(op: number, fallback: number): number {
    return this.#values.get(op) ?? fallback;
  }

  /** 规范里默认值是 -1 的那些 generator —— 用作「给了才算数」的判据 */
  given(op: number): number | undefined {
    const v = this.#values.get(op);
    return v === undefined || v === UNSET ? undefined : v;
  }

  /** keyRange / velRange：低字节 lo、高字节 hi；没给返回 undefined */
  range(op: number): KeyRange | undefined {
    const raw = this.#values.get(op);
    if (raw === undefined) return undefined;
    const v = raw >= 0x8000 ? raw - 0x10000 : raw;
    const lo = v & 0xff;
    const hi = (v >> 8) & 0xff;
    if (lo > hi) return undefined;
    return { lo, hi };
  }
}

/** 值域默认：0..127 */
const FULL_RANGE: KeyRange = { lo: 0, hi: 127 };

/** @source §8.1.3：这些 generator 在仪器层的默认值不是 -1 */
const DEFAULT_SCALE_TUNING = 100;
const DEFAULT_ATTACK_VOL_ENV = -12000; // 1 ms
const DEFAULT_HOLD_VOL_ENV = -12000; // 1 ms
const DEFAULT_DECAY_VOL_ENV = -12000; // 1 ms
const DEFAULT_RELEASE_VOL_ENV = -12000; // 1 ms

/** timecents → 秒 @source §8.1.3 gen 34/35/36/38：`2^(tc/1200)` */
export function timecentsToSeconds(tc: number): number {
  const s = Math.pow(2, tc / 1200);
  // 规范允许到 8000 tc = 100 秒；再长就当 100 秒，免得排出离谱的调度
  return Math.min(Math.max(s, 0), 100);
}

/**
 * centibels → 线性增益。
 *
 * @source §9.6.2：`振幅比 = 10^(dB/20)`；SF2 的衰减单位是 centibel，
 *   而规范里那条「十个单位 4 dB」的斜率即 **0.4 dB/cB**，
 *   故 `增益 = 10^(−0.4 × cB / 20)`。
 */
export function centibelsToGain(cb: number): number {
  if (cb <= 0) return 1;
  return Math.pow(10, (-0.4 * cb) / 20);
}

interface EnvelopeAmounts {
  initialAttenuation: number;
  velocityToAttenuation: number;
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

/** 「时间」那一组在乐器层缺省时是 0 秒，补成规范的 1 ms */
function withEnvelopeDefaults(e: EnvelopeAmounts): EnvelopeAmounts {
  return {
    ...e,
    attack: e.attack === 0 ? timecentsToSeconds(DEFAULT_ATTACK_VOL_ENV) : e.attack,
    hold: e.hold === 0 ? timecentsToSeconds(DEFAULT_HOLD_VOL_ENV) : e.hold,
    decay: e.decay === 0 ? timecentsToSeconds(DEFAULT_DECAY_VOL_ENV) : e.decay,
    release: e.release === 0 ? timecentsToSeconds(DEFAULT_RELEASE_VOL_ENV) : e.release,
  };
}

/**
 * 预设层的包络时间：**取值时先换成秒，缺省就是 0 秒**。
 *
 * ⚠️ 与乐器层不同：乐器层缺省要补规范的 `-12000 tc = 1 ms`，预设层缺省是
 *   **加 0**（它只是叠在乐器结果的偏移量）。
 *   @source SF2 2.04 §9.4「the preset zone's generators are added to the
 *   instrument's」；preset 层的默认值是 0 而不是 §8.1.3 的仪器层默认值。
 */
function presetTimecents(tc: number): number {
  return tc === 0 ? 0 : timecentsToSeconds(tc);
}

// ---- 乐器层 ----

/**
 * 一个乐器的 local zone 全部摊平。
 *
 * ★ 叠加规则见文件头 §1：global zone 的每一项先摊到每个 local zone 上，
 *   **local 有就顶掉 global 的**（不是相加），缺的才用 global。
 *
 * ⚠️ 每个记录的 bag 区间是「自己到**下一条记录**的 `first`」—— 不能一路读到
 *   `ibag` 末尾，否则会把后面乐器的 zone 也算进来。终结记录的 `first` 正好
 *   指向终结 bag 项，天然当了上界。
 *   @source SF2 2.04 §7.5 inst / §7.6 ibag / §7.7 imod / §7.8 igen
 */
function readInstruments(
  d: Uint8Array,
  inst: Chunk,
  ibag: Chunk,
  igen: Chunk,
  sampleCount: number,
): Instrument[] {
  const rows = tableRows(inst, INST_SIZE, 'inst');
  const gens = readGens(d, igen);
  const bags = readBagStarts(d, ibag, 'ibag');
  const out: Instrument[] = [];

  for (let i = 0; i + 1 < rows; i++) {
    const at = inst.bodyAt + i * INST_SIZE;
    const name = fixedAscii(d, at, 20).trim();
    const first = u16(d, at + 20);
    const next = u16(d, at + INST_SIZE + 20);
    // ⚠️ `wInstBagNdx` 是 **ibag 的下标**（不是 igen 的），所以上界是
    //   `bags.length - 1`（终结 bag 项的下标）。
    //   @source SF2 2.04 §7.5（`wInstBagNdx`）+ §7.6；参照 csound `sfont.c`：
    //   `first_ibag = inst[num].wInstBagNdx`，之后才拿 ibag 的项去查 igen。
    if (first > next || next > bags.length - 1) {
      throw new SoundFontError(`乐器 ${name || i} 的 ibag 区间越界（${first}..${next}）`);
    }

    // 规范：一个乐器**最多一个** global zone，且必须在最前
    const sets = zoneSets(gens, bags, first, next);
    const globalSet = isGlobal(sets, GEN.SAMPLE_ID);
    const locals = globalSet === undefined ? sets : sets.slice(1);

    const zones: InstrumentZone[] = [];
    for (const local of locals) {
      const zone = instrumentZoneFrom(local, globalSet, sampleCount);
      if (zone !== null) zones.push(zone);
    }
    out.push({ name, zones });
  }
  return out;
}

/**
 * 把一条记录的 bag 区间转换成一组 generator 取值。
 *
 * @param count zone 的个数（= 记录的 `next - first`）：bag 的终结项让 `next`
 *   比最后一个 zone 的起点大一，所以 zone 的个数是那个**差**。
 *   ⚠️ 不能写成「一直读到空区间为止」：终结 generator 若与最后一个 zone 的
 *   起点相同，就会多读出一个幽灵 zone（它的 generator 是空的，于是 keyRange
 *   变成全音域，选区直接选错样本）。
 */
function zoneSets(
  gens: readonly GenValue[],
  bags: readonly number[],
  first: number,
  count: number,
): GenSet[] {
  const out: GenSet[] = [];
  for (let z = 0; z < count; z++) {
    const from = bags[first + z];
    const to = bags[first + z + 1];
    if (from === undefined || to === undefined) break;
    if (to < from || to > gens.length) {
      throw new SoundFontError(`generator 下标越界（${from}..${to}）`);
    }
    out.push(new GenSet(gens, from, to));
  }
  return out;
}

/**
 * 首个 zone 是不是 global zone。
 *
 * @source SF2 2.04 §7.3/§7.5 + §9.4：global zone 的特征是**没有**该层独有的
 *   那个「落点」generator —— 预设层没有 `instrument`(41)、乐器层没有
 *   `sampleID`(53)。**只看有没有这个 generator，不看 zone 有几个**：
 *   「global + 一个 local」的记录里，那个 local 照样带 marker。
 *   （先前写成「head 没有 marker **且** zone 多于一个」，结果把唯一一个
 *   local zone 误判成 global，整条记录一个 zone 都不剩。）
 */
function isGlobal(sets: readonly GenSet[], marker: number): GenSet | undefined {
  const head = sets[0];
  if (head === undefined) return undefined;
  // 空的 generator 列表也是 global zone：global zone 常常**一个字都不写**，
  // 那时它在文件里就是一个 `[0,0]` 终结 generator。若要按 local 处理，
  // 对**预设层**来说它会多叠一次包络默认值（凭空垫一个「0 tc = 1 秒」的 attack），
  // 把整条乐器的包络拉长 —— 这是实测踩到过的坑。
  if (head.size === 0) return head;
  return head.has(marker) ? undefined : head;
}

/** 一个 local zone，叠上 global zone 的同名项 */
function instrumentZoneFrom(
  local: GenSet,
  global: GenSet | undefined,
  sampleCount: number,
): InstrumentZone | null {
  const pick = (op: number): number | undefined => local.given(op) ?? global?.given(op);
  /** 规范默认值不是 -1 的那几项：local → global → 默认 */
  const pickDefault = (op: number, def: number): number =>
    local.given(op) ?? global?.given(op) ?? def;

  const sample = pick(GEN.SAMPLE_ID);
  // 没有 sampleID 的 zone 落不到样本上（global zone 就是这种），丢掉
  if (sample === undefined || sample < 0 || sample >= sampleCount) return null;

  const scaleTuning = pickDefault(GEN.SCALE_TUNING, DEFAULT_SCALE_TUNING);
  // ★ 有 global zone 时，local zone 里没写的项就是 **0**（不是规范默认值）：
  //   global 已经承担了「这一层缺省是多少」，两个都补默认值会叠加两次。
  //   只有**没有** global zone 时，缺省才落到 §8.1.3 的仪器层默认值。
  const def = (op: number, spec: number): number =>
    global === undefined ? spec : 0;
  const env = withEnvelopeDefaults({
    initialAttenuation: centibelsToGain(pick(GEN.INITIAL_ATTENUATION) ?? 0),
    velocityToAttenuation: Math.max(0, pick(GEN.VELOCITY_TO_ATTENUATION) ?? 0),
    attack: timecentsToSeconds(pick(GEN.ATTACK_VOL_ENV) ?? def(GEN.ATTACK_VOL_ENV, DEFAULT_ATTACK_VOL_ENV)),
    hold: timecentsToSeconds(pick(GEN.HOLD_VOL_ENV) ?? def(GEN.HOLD_VOL_ENV, DEFAULT_HOLD_VOL_ENV)),
    decay: timecentsToSeconds(pick(GEN.DECAY_VOL_ENV) ?? def(GEN.DECAY_VOL_ENV, DEFAULT_DECAY_VOL_ENV)),
    sustain: centibelsToGain(pick(GEN.SUSTAIN_VOL_ENV) ?? 0),
    release: timecentsToSeconds(pick(GEN.RELEASE_VOL_ENV) ?? def(GEN.RELEASE_VOL_ENV, DEFAULT_RELEASE_VOL_ENV)),
  });

  const key = localRange(local, global, GEN.KEY_RANGE);
  const vel = localRange(local, global, GEN.VEL_RANGE);

  return {
    global: false,
    keyLo: key.lo,
    keyHi: key.hi,
    velLo: vel.lo,
    velHi: vel.hi,
    sample,
    start: offsetOf(pick(GEN.START_ADD_OFFSET), pick(GEN.START_ADD_COARSE)),
    end: offsetOf(pick(GEN.END_ADD_OFFSET), pick(GEN.END_ADD_COARSE)),
    loopStart: offsetOf(pick(GEN.START_LOOP_OFFSET), pick(GEN.START_LOOP_COARSE)),
    loopEnd: offsetOf(pick(GEN.END_LOOP_OFFSET), pick(GEN.END_LOOP_COARSE)),
    loopMode: pickDefault(GEN.SAMPLE_MODES, 0),
    tuneSemitones: (pick(GEN.COARSE_TUNE) ?? 0) + (pick(GEN.FINE_TUNE) ?? 0) / 100,
    scaleTuning,
    ...env,
  };
}

function localRange(local: GenSet, global: GenSet | undefined, op: number): KeyRange {
  return local.range(op) ?? global?.range(op) ?? FULL_RANGE;
}

/**
 * 偏移类 generator 的两个变体：`xxxOffset`（低 16 位）与 `xxxCoarseOffset`
 * （以 32768 个 sample 为单位）。@source SF2 2.04 §8.1.3 gen 0..4、8/9/12/13、45/46/50/51
 */
function offsetOf(fine: number | undefined, coarse: number | undefined): number {
  return (fine ?? 0) + (coarse ?? 0) * 32768;
}

// ---- 预设层 ----

/**
 * 预设层。
 *
 * ★ 规范 §9.4：预设层**只有少数 generator 合法**（本解析器认的那几个见
 *   文件头 §2）。其余一律忽略 —— 例如 `sampleModes` 出现在预设层是无效的。
 */
function readPresets(
  d: Uint8Array,
  phdr: Chunk,
  pbag: Chunk,
  pgen: Chunk,
  instrumentCount: number,
): Preset[] {
  const rows = tableRows(phdr, PHDR_SIZE, 'phdr');
  const gens = readGens(d, pgen);
  const bags = readBagStarts(d, pbag, 'pbag');
  const out: Preset[] = [];

  for (let i = 0; i + 1 < rows; i++) {
    const at = phdr.bodyAt + i * PHDR_SIZE;
    const name = fixedAscii(d, at, 20).trim();
    const program = u16(d, at + 20);
    const bank = u16(d, at + 22);
    const first = u16(d, at + 24);
    const next = u16(d, at + PHDR_SIZE + 24);
    // ⚠️ 同 `readInstruments`：`wPresetBagNdx` 是 **pbag 的下标**
    if (first > next || next > bags.length - 1) {
      throw new SoundFontError(`预设 ${name || i} 的 pbag 区间越界（${first}..${next}）`);
    }

    const sets = zoneSets(gens, bags, first, next);
    const globalSet = isGlobal(sets, GEN.INSTRUMENT);
    const locals = globalSet === undefined ? sets : sets.slice(1);

    const zones: PresetZone[] = [];
    for (const local of locals) {
      const instrument = local.given(GEN.INSTRUMENT) ?? globalSet?.given(GEN.INSTRUMENT);
      if (instrument === undefined || instrument < 0 || instrument >= instrumentCount) continue;
      const key = local.range(GEN.KEY_RANGE) ?? globalSet?.range(GEN.KEY_RANGE) ?? FULL_RANGE;
      const vel = local.range(GEN.VEL_RANGE) ?? globalSet?.range(GEN.VEL_RANGE) ?? FULL_RANGE;
      const pickup = (op: number, def: number): number =>
        local.given(op) ?? globalSet?.given(op) ?? def;
      zones.push({
        instrument,
        keyLo: key.lo,
        keyHi: key.hi,
        velLo: vel.lo,
        velHi: vel.hi,
        // ★ preset 层的衰减与包络是**叠加量**，缺省是 0（不是乐器层的默认值）
        attenuation: centibelsToGain(pickup(GEN.INITIAL_ATTENUATION, 0)),
        attack: presetTimecents(pickup(GEN.ATTACK_VOL_ENV, 0)),
        hold: presetTimecents(pickup(GEN.HOLD_VOL_ENV, 0)),
        decay: presetTimecents(pickup(GEN.DECAY_VOL_ENV, 0)),
        sustain: centibelsToGain(pickup(GEN.SUSTAIN_VOL_ENV, 0)),
        release: presetTimecents(pickup(GEN.RELEASE_VOL_ENV, 0)),
      });
    }
    out.push({ name, bank, program, zones });
  }
  return out;
}

// ============================================================
//  选区：preset → instrument → sample
// ============================================================

/**
 * 鼓组预设所在的 bank。
 *
 * @source SF2 2.04 §9.4：打击乐预设的 bank 是 128（0x80），
 *   且 MIDI 的 9 号通道按**音符号**选 preset（program 就取音符号）。
 */
export const DRUM_BANK = 128;

/**
 * 挑出「这个音该用哪个 sample、什么包络」。
 *
 * @param font 已解析的音色库
 * @param program GM 音色号 0..127（9 号通道传音符号，bank 传 `DRUM_BANK`）
 * @param note MIDI 音高
 * @param velocity MIDI 力度
 * @param bank 银行号，默认 0
 * @returns 命中的第一个 zone（按「预设 → 乐器 → 样本」的顺序）；
 *          没有命中返回 `null` —— **调用方必须能接受 null**（回退或不出声）
 */
export function resolveSoundFontZone(
  font: SoundFont,
  program: number,
  note: number,
  velocity: number,
  bank = 0,
): SoundFontZone | null {
  const preset = font.presets.find((p) => p.bank === bank && p.program === program);
  if (preset === undefined) return null;

  for (const pz of preset.zones) {
    if (note < pz.keyLo || note > pz.keyHi) continue;
    if (velocity < pz.velLo || velocity > pz.velHi) continue;
    const inst = font.instruments[pz.instrument];
    if (inst === undefined) continue;
    for (const iz of inst.zones) {
      if (note < iz.keyLo || note > iz.keyHi) continue;
      if (velocity < iz.velLo || velocity > iz.velHi) continue;
      const sample = font.samples[iz.sample];
      if (sample === undefined) continue;
      return mergeZone(iz, pz, sample);
    }
  }
  return null;
}

/**
 * 乐器层的 zone + 预设层的叠加量 = 真正要播的那一条。
 *
 * ★ 文件头 §1 的规则：**预设层的结果加到乐器层上**。
 *   音量包络的时间量是**相加**，衰减量是**相乘**（因为已经换成线性增益了，
 *   而 dB 域相加 = 线性域相乘）。
 */
function mergeZone(iz: InstrumentZone, pz: PresetZone, sample: SoundFontSample): SoundFontZone {
  return {
    keyLo: Math.max(iz.keyLo, pz.keyLo),
    keyHi: Math.min(iz.keyHi, pz.keyHi),
    velLo: Math.max(iz.velLo, pz.velLo),
    velHi: Math.min(iz.velHi, pz.velHi),
    sample: iz.sample,
    start: iz.start,
    end: iz.end,
    // ★ 生成器给的是**相对 `shdr` 的偏移**，这里换算成绝对位置
    loopStart: sample.loopStart + iz.loopStart,
    loopEnd: sample.loopEnd + iz.loopEnd,
    loopMode: iz.loopMode,
    tuneSemitones: iz.tuneSemitones,
    scaleTuning: iz.scaleTuning,
    initialAttenuation: iz.initialAttenuation * pz.attenuation,
    velocityToAttenuation: iz.velocityToAttenuation,
    attack: iz.attack + pz.attack,
    hold: iz.hold + pz.hold,
    decay: iz.decay + pz.decay,
    sustain: iz.sustain * pz.sustain,
    release: iz.release + pz.release,
  };
}

/**
 * 根音（`shdr` 的 `originalPitch`，规范叫 original key）换算成半音偏移。
 *
 * @source SF2 2.04 §7.10：`originalPitch` 是「这个样本录的是哪个音高」，
 *   播放时按它与所弹音符的差来变调。`pitchCorrection` 是音分级修正。
 *   本函数返回**要变调多少音分**。
 */
export function zoneDetuneCents(
  sample: SoundFontSample,
  zone: SoundFontZone,
  note: number,
): number {
  // 采样率本身由 AudioBuffer 负责（AudioContext 会重采样），这里只管音高
  const semitone = 100;
  return (
    (note - sample.rootKey) * semitone * (zone.scaleTuning / 100) +
    zone.tuneSemitones * semitone -
    sample.pitchCorrection
  );
}

/** 音分 → 播放倍率（`AudioBufferSourceNode.playbackRate` 的取值） */
export function centsToPlaybackRate(cents: number): number {
  return Math.pow(2, cents / 1200);
}
