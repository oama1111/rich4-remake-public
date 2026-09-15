/*
 * 合成一个**最小但合法**的 SoundFont 2 —— 测试夹具
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 仓库里**没有**、也不该有 `.sf2` 素材（不分发原版素材，见
 *   DEVELOPMENT_PLAN §5.6）。所以解析器只能拿「按规范现拼出来的」样本测。
 *   这个文件就是那个拼装器：它按 SF2 2.04 §7 的字段表逐字节写 RIFF，
 *   产出的东西就是一个真正的 sf2。
 *
 * ⚠️ 夹具**故意只造解析器用到的那部分**：`phdr`/`pbag`/`pgen`/`inst`/`ibag`/
 *   `igen`/`shdr` 九张表、`sdta` 一个 `smpl`、`INFO` 一个 `INAM`。
 *   不写调制器内容（解析器本来就跳过 `pmod`/`imod` 的调制器），但终结记录照规范写。
 *
 * 坐标基准：`shdr` 的 start/end/loopStart/loopEnd 都是**整个 smpl 块**里的帧号。
 * 本夹具的每个样本都从第 0 帧开始，故这些值同时也是相对样本起点的偏移。
 */

function bytesOf(parts: readonly (number | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p & 0xff);
    else for (const b of p) out.push(b & 0xff);
  }
  return Uint8Array.from(out);
}

/** 小端 16 位 */
function le16(...vs: number[]): Uint8Array {
  const out = new Uint8Array(vs.length * 2);
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i]! & 0xffff;
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}

function le32(...vs: number[]): Uint8Array {
  const out = new Uint8Array(vs.length * 4);
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i]! >>> 0;
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** UTF-8 编码 —— `INAM` 之类的库名可能是中文，逐 code unit 塞会乱码 */
function uint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 定长名字字段：写满 `len` 字节，不足补 0。
 *
 * ⚠️ 名字用不满时可以留 0（规范如此），但**片段 form 名**（`INFO`/`sdta`/`pdta`）
 *   不能走这里 —— 那些是定长的，必须一字不差。这里只用于 `phdr`/`inst`/`shdr`
 *   的 20 字节名字字段。
 */
function fixed(text: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < Math.min(text.length, len); i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** n 个 0 字节 —— 各种记录末尾的保留字段（`phdr` 12 字节、`shdr` 3 字节） */
function reserved(n: number): Uint8Array {
  return new Uint8Array(n);
}

/** `id + 长度 + 内容`，奇数长度补一个字节 @source RIFF */
function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length % 2 === 1 ? bytesOf([body, 0]) : body;
  return bytesOf([ascii(id), le32(body.length), padded]);
}

function list(form: string, parts: readonly Uint8Array[]): Uint8Array {
  return chunk('LIST', bytesOf([ascii(form), ...parts]));
}

/** 一个 zone 的 generator 列表：`[号, 值]` 对 */
export type GenList = readonly (readonly [number, number])[];

export interface TestSf2Options {
  /** `INFO` 里的 `INAM` */
  name?: string;
  presetName?: string;
  bank?: number;
  program?: number;
  instrumentName?: string;
  sampleName?: string;
  /** sdta 里的 16 位 PCM 帧 */
  pcm?: readonly number[];
  /**
   * 可选的第二份样本（同一段 PCM）。用来测「一个乐器多层 zone 落不同样本」，
   * 例如力度分层。它的采样率与循环点跟第一份一样。
   */
  secondSample?: boolean;
  sampleRate?: number;
  rootKey?: number;
  pitchCorrection?: number;
  /** 循环点，单位是**整个 smpl 块**里的帧号（shdr 里的原始值） */
  loopStart?: number;
  loopEnd?: number;
  /** 预设层 global zone 的 generator（`pgen`），缺省 = 不写这一层 */
  presetGlobal?: GenList;
  /** 预设层 local zone 的 generator（不含 `instrument`，那个自动补） */
  presetZone?: GenList;
  /** 乐器层 global zone 的 generator */
  instrumentGlobal?: GenList;
  /**
   * 乐器层的 local zone 列表（每个不含 `sampleID`，那个按顺序自动补）。
   * 默认一个 zone：`keyRange 0..127`。**多个**用来测 keyRange/velRange 分层。
   */
  instrumentZones?: readonly GenList[];
  /**
   * 再造一个 bank 128 的鼓组：该**音符号**落在一个**独立**的鼓样本上。
   * 用来验证「打击乐走 bank 128、用音符号选预设」。
   */
  drumKit?: boolean;
  /** 鼓组覆盖哪个音符号（默认 35 = Acoustic Bass Drum） */
  drumNote?: number;
}

/**
 * 造一份最小的合法 sf2，返回整个文件的字节。
 *
 * 默认形状：bank 0 / program 0 → 乐器 0 → 样本 0（keyRange 0..127、不循环）。
 */
export function buildTestSf2(options: TestSf2Options = {}): Uint8Array {
  const {
    name = '測試音色庫',
    presetName = 'Piano',
    bank = 0,
    program = 0,
    instrumentName = 'Inst',
    sampleName = 'Smpl',
    pcm = [100, 200, 300, 400, 500, 600, 700, 800],
    secondSample = false,
    sampleRate = 44100,
    rootKey = 69,
    pitchCorrection = 0,
    loopStart = 1,
    loopEnd = 7,
    presetGlobal,
    presetZone = [],
    instrumentGlobal,
    instrumentZones = [[[43, 0x7f00]]], // keyRange 0..127
    drumKit = false,
    drumNote = 35,
  } = options;

  // ---- sdta：一个 smpl，按序码放每个样本的 16 位小端 PCM ----
  // 样本一个接一个排，后面的 start≠0 —— 正好检验「shdr 的偏移是相对
  // smpl 块、而不是相对样本自己」。
  interface Payload {
    name: string;
    pcm: readonly number[];
    root: number;
    loop: readonly [number, number];
  }
  const payloads: Payload[] = [
    { name: sampleName, pcm, root: rootKey, loop: [loopStart, loopEnd] },
  ];
  if (secondSample) payloads.push({ name: 'Smpl2', pcm, root: rootKey, loop: [loopStart, loopEnd] });
  if (drumKit) payloads.push({ name: 'Drum', pcm: [1000, 2000, 3000, 4000], root: 60, loop: [0, 0] });

  const samples: { name: string; pcm: readonly number[]; start: number; end: number; root: number; loop: readonly [number, number] }[] = [];
  let frameAt = 0;
  for (const p of payloads) {
    samples.push({ name: p.name, pcm: p.pcm, start: frameAt, end: frameAt + p.pcm.length, root: p.root, loop: p.loop });
    frameAt += p.pcm.length;
  }
  const sampleCount = samples.length;
  const drumSampleId = sampleCount - 1; // 鼓样本永远是最后一份

  const smplParts: Uint8Array[] = [];
  for (const s of samples) for (const v of s.pcm) smplParts.push(le16(v));
  const sdta = list('sdta', [chunk('smpl', bytesOf(smplParts))]);

  // ---- INFO ----
  const info = list('INFO', [chunk('INAM', uint8(`${name}\0`))]);

  // ---- pdta ----
  const instrumentCount = drumKit ? 2 : 1;
  const presetCount = drumKit ? 2 : 1;

  // --- pgen / pbag ---
  //
  // ⚠️ `pbag` 是**扁平的 zone 表**：每项 4 字节 = 两个 WORD，值是「本 zone 在
  //   `pgen` 里的起点」，区间一直到下一项。所以 `pbag` 的项数 = zone 数 + 1
  //   （末尾是终结哨兵）；而 `phdr` 记录里的 `wPresetBagNdx` 指向的是
  //   **pbag 的下标**，**不是** `pgen` 的下标。
  //   @source SF2 2.04 §7.3/§7.4；参照 csound `sfont.c`：
  //   `first_pbag = phdr[j].wPresetBagNdx`，再 `pbag[k+first_pbag]` 取生成器区间。
  const pgenItems: [number, number][] = [];
  /** `pbag` 每一项里的 generator 起点；项数 = 所有预设的 zone 数 + 1 */
  const pbagGenStart: number[] = [];
  /** 每个预设在 pbag 里的起点（bag 下标） */
  const presetBagNdx: number[] = [];
  for (let p = 0; p < presetCount; p++) {
    presetBagNdx.push(pbagGenStart.length);
    if (p === 0) {
      if (presetGlobal !== undefined) {
        pbagGenStart.push(pgenItems.length);
        pgenItems.push(...presetGlobal.map(([op, v]) => [op, v] as [number, number]));
      }
      pbagGenStart.push(pgenItems.length);
      // local zone：先补上「指向乐器」的 gen 41
      pgenItems.push([41, p]);
      pgenItems.push(...presetZone.map(([op, v]) => [op, v] as [number, number]));
    } else {
      pbagGenStart.push(pgenItems.length);
      pgenItems.push([41, 1]); // 鼓组用第 2 个乐器
    }
  }
  pbagGenStart.push(pgenItems.length);
  pgenItems.push([0, 0]); // 终结 generator
  const pgen = chunk('pgen', Uint8Array.from(pgenItems.flatMap(([op, v]) => [...le16(op, v)])));
  const pbag = chunk('pbag', Uint8Array.from(pbagGenStart.flatMap((v) => [...le16(v, 0)])));

  // --- igen / ibag ---
  const igenItems: [number, number][] = [];
  /** `ibag` 每一项里的 generator 起点；项数 = 所有乐器的 zone 数 + 1 */
  const ibagGenStart: number[] = [];
  /** 每个乐器在 ibag 里的起点（bag 下标） */
  const instBagNdx: number[] = [];
  for (let n = 0; n < instrumentCount; n++) {
    instBagNdx.push(ibagGenStart.length);
    if (n === 0) {
      if (instrumentGlobal !== undefined) {
        ibagGenStart.push(igenItems.length);
        igenItems.push(...instrumentGlobal.map(([op, v]) => [op, v] as [number, number]));
      }
      for (let z = 0; z < instrumentZones.length; z++) {
        // ★ 一个 zone 只推一次 bag 起点（不是每个 generator 一次）
        ibagGenStart.push(igenItems.length);
        igenItems.push(...(instrumentZones[z] ?? []).map(([op, v]) => [op, v] as [number, number]));
        // sampleID 由夹具补：第 z 个 zone 落第 z 个样本（不够就落最后一份）
        igenItems.push([53, Math.min(z, sampleCount - 1)]);
      }
    } else {
      ibagGenStart.push(igenItems.length);
      igenItems.push([43, 0x7f00]); // keyRange 0..127
      igenItems.push([54, 1]); // sampleModes = 1（持续循环）
      igenItems.push([53, drumSampleId]); // sampleID = 鼓样本
    }
  }
  ibagGenStart.push(igenItems.length);
  igenItems.push([0, 0]);
  const igen = chunk('igen', Uint8Array.from(igenItems.flatMap(([op, v]) => [...le16(op, v)])));
  const ibag = chunk('ibag', Uint8Array.from(ibagGenStart.flatMap((v) => [...le16(v, 0)])));

  // --- pmod / imod：终结记录 ---
  const pmod = chunk('pmod', le16(0, 0, 0, 0, 0));
  const imod = chunk('imod', le16(0, 0, 0, 0, 0));

  // --- inst ---
  const instBody: Uint8Array[] = [];
  for (let n = 0; n < instrumentCount; n++) {
    const nm = n === 0 ? instrumentName : 'Drums';
    instBody.push(fixed(nm, 20), le16(instBagNdx[n]!));
  }
  // 终结记录 EInst：`wInstBagNdx` 指向终结 bag 项
  instBody.push(fixed('EOI', 20), le16(ibagGenStart.length - 1));
  const inst = chunk('inst', bytesOf(instBody));

  // --- phdr ---
  const phdrBody: Uint8Array[] = [
    fixed(presetName, 20),
    le16(program, bank, presetBagNdx[0]!),
    reserved(12),
  ];
  if (drumKit) {
    phdrBody.push(fixed('DrumKit', 20), le16(drumNote, 128, presetBagNdx[1]!), reserved(12));
  }
  // 终结记录 EOP：`wPresetBagNdx` 指向终结 bag 项
  phdrBody.push(fixed('EOP', 20), le16(0, 0, pbagGenStart.length - 1), reserved(12));
  const phdr = chunk('phdr', bytesOf(phdrBody));

  // --- shdr ---
  // 一条记录 **46** 字节，照 SF2 2.04 §7.10：
  //   20 名字 + 20 五个 u32 + 1 原始音高 + 2 音分修正 + **3 字节保留**。
  const shdrBody: Uint8Array[] = [];
  for (const s of samples) {
    shdrBody.push(
      fixed(s.name, 20),
      le32(s.start, s.end, s.loop[0], s.loop[1], sampleRate),
      Uint8Array.from([s.root & 0xff]),
      le16(pitchCorrection),
      new Uint8Array(3), // 保留
    );
  }
  shdrBody.push(fixed('EOS', 20), le32(0, 0, 0, 0, 0), Uint8Array.from([0]), le16(0), new Uint8Array(3));
  const shdr = chunk('shdr', bytesOf(shdrBody));

  const pdta = list('pdta', [phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr]);

  // ---- RIFF ----
  // ⚠️ RIFF 是**最外层**的容器，不是 `chunk('RIFF', …)` —— 那样会多套一层头。
  //    规范写法：`'RIFF' + u32(整个文件长度 − 8) + 'sf2' + 各 LIST`。
  const form = bytesOf([ascii('sf2'), info, sdta, pdta]);
  return bytesOf([ascii('RIFF'), le32(form.length), form]);
}
