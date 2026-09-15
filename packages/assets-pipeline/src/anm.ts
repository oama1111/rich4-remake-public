/*
 * Deluxe Paint `.ANM` 动画的解码
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这是**第三种**素材格式（前两种是 SPR / SMP）。全游戏一共 105 个：
 *   `Panel.mkf` 8 个、`Data.mkf` 72 个、`jump.mkf` 25 个。
 *
 * ★ **源文件名就写在头后面**（当年是从 Autodesk Animator 的 `.FLC` 转过来的），
 *   等于白送一份语义表。抽查几个：
 * ```
 *   Panel#4/5/6   36 帧 189×285  C:\MAKE\DICE\DICE{1,2,3}-1.FLC  = 骰子
 *   Panel#14       5 帧 213×68   D:\RICH4\LOTO\BONUS1.FLC        = 樂透投注屏的獎金燈框
 *   Panel#16      42 帧 275×270  D:\RICH4\LOTOOPEN\LOTOBALL.FLC  = 樂透開獎屏玻璃球里的球翻滚
 *   Panel#17      37 帧 280×480  C:\256_S\A01.FLC               = 開獎屏得主的彩带礼花
 *   Data#416..439                D:\R4-ALL\B01WIN/LOSE…B12…     = 12 个角色胜负动画
 *   Data#523..570                FIRE/BOMB/NUCLEAR/UFO/DOG/…    = 卡片特效
 *   jump#47..70                   J01..J12 / F01..F12           = 角色跳跃过场
 * ```
 *
 * 格式（按 `rich4.exe` 的播放器 `fcn_00450ced` / `fcn_00450f04` 反解，
 * 并用「每条记录声明的长度是否被精确吃干」逐帧验过 —— 见 `anm.test.ts`）：
 *
 * ```
 * 头 128 字节
 *   +0  u32  文件总长            （实测 = 文件长度）
 *   +4  u16  magic = 0xaf12      （播放器 `cmp word [eax+4], 0xaf12`）
 *   +6  u16  帧数                → [0x48c86c]
 *   +8  u16  宽                  → [0x48c878]
 *   +10 u16  高                  → [0x48c87c]
 *   +12 u16  8                   （像是位深）
 *   +14 u16  3                   （像是版本）
 *   +16 u32  每帧间隔            → [0x48c870]（播放器只存不用）
 * 头后面是**一段变长的「源文件信息」**（FLC 路径 + 分块参数，实测 2778 字节），
 * 然后才是帧数据 —— 所以**不能用固定偏移找帧**，要像原版那样扫签名：
 *   +0  u32  本帧总长（含这 16 字节头）
 *   +4  u16  0xf1fa              ★ 帧签名（不是就往前挪 2 字节重找）
 *   +6  u16  记录数
 *   +0x10 起是「记录」序列，每条：
 *      +0 u32 本条总长（含这 6 字节头）
 *      +4 u16 命令码
 *      +6    负载
 * ```
 *
 * 命令码（`0x0045105a` 那张跳表）：
 * ```
 *   4  (0x04) 调色板   —— N × {起始索引, 个数, RGB888 × 个数} → 写全局调色板
 *   7  (0x07) 逐行差值 —— 索引流（见 readRowDelta 的说明）
 *   12 (0x0c) 另两种  —— 与 15/16 同族但**未实装**（没找到用的地方）
 *   15 (0x0f) 整帧     —— 按行 RLE 的索引位图（每帧的第一条就是它）
 *   16 (0x10) 同上
 *   其它      播放器直接跳过（实测每帧第一条是 0x12，被忽略）
 * ```
 *
 * ★ **索引 0 = 不动**：播放器是在**屏幕上就地**改写（`fcn_00450f04` 里
 *   目标与源指针指向同一块面），所以调色板索引 0 的像素保留原来的内容。
 *   本模块把「本动画写过的像素」记下来，没写过的输出 alpha=0（UI 叠加语义）。
 *
 * ⚠️ 两个已知的怪处：
 *   1. **文件里躺着的帧数可能比头里写的多**：`Panel#14` 头里 5、文件里 6 帧。
 *      播放器只播头里那个数（`cmp [0x48c874], [0x48c86c]`），照它。
 *   2. 只实装了播放器的**一条路径**：`fcn_00450ced` 的 flags 第 0 位为 1 时
 *      走的那条（樂透这几块传的是 flags=5 / 8 / 1）。flags bit0=0 时播放器
 *      换一套处理函数、源指针也不一样，那套**没反解**。碰到了再补。
 */

/** 帧签名 —— 播放器凭它找帧头 */
const FRAME_SIG = 0xf1fa;
/** 头里的 magic */
const MAGIC = 0xaf12;
/** 帧数据的起点 */
const DATA_OFFSET = 0x80;

export interface AnmHeader {
  /** 文件总长（头里的 +0，实测等于数据长度）*/
  size: number;
  frames: number;
  width: number;
  height: number;
  /** 头里的 +12，实测 8 —— 看着像位深 */
  bitDepth: number;
  /** 头里的 +14，实测 3 —— 看着像版本 */
  version: number;
  /** 头里的 +16 —— 播放器把它当「每帧间隔」存进 `[0x48c870]` */
  frameDelay: number;
}

export interface AnmFrame {
  width: number;
  height: number;
  /** RGBA8888；调色板索引 0（=「不动」）的像素 alpha 为 0 */
  rgba: Uint8ClampedArray;
}

export class AnmFormatError extends Error {}

/** RGB555 → RGB888，高位复制到低位（与 `sprite.ts` 的 expand5 同一口径）*/
const expand5 = (v: number): number => (v << 3) | (v >> 2);

function u16(d: Uint8Array, o: number): number {
  return d[o]! | (d[o + 1]! << 8);
}
function u32(d: Uint8Array, o: number): number {
  return (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;
}

/** 只认头，不碰帧数据 —— 给「这是不是 ANM」用 */
export function parseAnmHeader(data: Uint8Array): AnmHeader | null {
  if (data.length < DATA_OFFSET) return null;
  if (u16(data, 4) !== MAGIC) return null;
  return {
    size: u32(data, 0),
    frames: u16(data, 6),
    width: u16(data, 8),
    height: u16(data, 10),
    bitDepth: u16(data, 12),
    version: u16(data, 14),
    frameDelay: u32(data, 16),
  };
}

export function isAnm(data: Uint8Array): boolean {
  return parseAnmHeader(data) !== null;
}

/**
 * 解码整段动画。逐帧返回 RGBA。
 *
 * 解析是**严格**的：某条记录吃不完/吃过界、或帧长与记录之和对不上，都会抛
 * `AnmFormatError` —— 这样「跑通不抛」本身就等于「框定与 exe 一致」。
 */
export function decodeAnm(data: Uint8Array): AnmFrame[] {
  const h = parseAnmHeader(data);
  if (h === null) throw new AnmFormatError('不是 ANM（magic != 0xaf12）');
  if (h.frames === 0 || h.width === 0 || h.height === 0) {
    throw new AnmFormatError(`ANM 头不合理: ${h.frames} 帧 ${h.width}x${h.height}`);
  }

  const w = h.width;
  const hgt = h.height;
  const npix = w * hgt;
  /** 全局调色板（RGB555）—— 命令 4 往里写 */
  const pal = new Uint16Array(256);
  /** 就地累积的画布：索引 0 = 不动 */
  const canvas = new Uint16Array(npix);
  const owned = new Uint8Array(npix);
  const out: AnmFrame[] = [];

  let cur = DATA_OFFSET;
  for (let fi = 0; fi < h.frames; fi++) {
    // 对齐到帧签名：原版也是这么往前挪的（帧之间可能有填充）
    while (cur + 8 <= data.length && u16(data, cur + 4) !== FRAME_SIG) cur += 2;
    if (cur + 8 > data.length) throw new AnmFormatError(`第 ${fi} 帧找不到签名 0xf1fa`);
    const frameSize = u32(data, cur);
    const nrec = u16(data, cur + 6);
    let p = cur + 0x10;
    const frameEnd = cur + frameSize;
    if (frameSize < 0x10 || frameEnd > data.length) {
      throw new AnmFormatError(`第 ${fi} 帧长度越界: ${frameSize}`);
    }

    for (let r = 0; r < nrec; r++) {
      if (p + 6 > frameEnd) throw new AnmFormatError(`第 ${fi} 帧第 ${r} 条记录越出帧尾`);
      const recSize = u32(data, p);
      const cmd = u16(data, p + 4);
      const payload = p + 6;
      const recEnd = p + recSize;
      if (recSize < 6 || recEnd > frameEnd) {
        throw new AnmFormatError(`第 ${fi} 帧第 ${r} 条记录长度越界: ${recSize}`);
      }
      switch (cmd) {
        case 4:
          readPalette(data, payload, recEnd, pal);
          break;
        case 7:
          readRowDelta(data, payload, recEnd, w, hgt, pal, canvas, owned);
          break;
        case 15:
          readFullFrame(data, payload, recEnd, w, hgt, pal, canvas, owned);
          break;
        case 12:
        case 16:
          throw new AnmFormatError(`命令 ${cmd} (0x${cmd.toString(16)}) 还没实装`);
        default:
          // 原版对不认的命令就是跳过（`Panel#14` 帧 0 的 0x12 就是这样）
          break;
      }
      p = recEnd;
    }
    if (p !== frameEnd) {
      throw new AnmFormatError(`第 ${fi} 帧记录之和对不上帧长（${p - cur} ≠ ${frameSize}）`);
    }

    out.push({ width: w, height: hgt, rgba: toRgba(canvas, owned, npix) });
    cur = frameEnd;
  }

  return out;
}

/** 命令 4：`u16 N` + N × `{u8 起始索引, u8 个数(0=256), 个数 × RGB888}` */
function readPalette(
  data: Uint8Array,
  start: number,
  end: number,
  pal: Uint16Array,
): void {
  let p = start;
  const n = u16(data, p);
  p += 2;
  for (let i = 0; i < n; i++) {
    if (p + 2 > end) throw new AnmFormatError('调色板记录越界');
    const at = data[p]!;
    let count = data[p + 1]!;
    p += 2;
    if (count === 0) count = 256;
    if (p + count * 3 > end) throw new AnmFormatError('调色板颜色数据越界');
    for (let k = 0; k < count; k++) {
      const r = data[p]!;
      const g = data[p + 1]!;
      const b = data[p + 2]!;
      p += 3;
      // 原版在这里就转成了显示格式（默认 RGB555）—— 照做，免得颜色比原版亮一档
      pal[(at + k) & 0xff] = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    }
  }
  if (p !== end) throw new AnmFormatError(`调色板记录吃不完（${p - start}/${end - start}）`);
}

/** 一块像素：索引 0 = 不动，其余查调色板 */
function put(
  canvas: Uint16Array,
  owned: Uint8Array,
  at: number,
  index: number,
  pal: Uint16Array,
): void {
  if (at < 0 || at >= canvas.length) return;
  if (index === 0) return; // 不动
  canvas[at] = pal[index]!;
  owned[at] = 1;
}

/**
 * 命令 7：逐行差值。
 *
 * ```
 * u16 条目数 N
 * N × {                        每条**处理一行**，处理完自动下移一行
 *     u16 控制字
 *     …
 * }
 * ```
 *
 * 控制字三种：
 * - `(ctl & 0xc000) == 0xc000`：**跳过 −ctl 行**（ctl 按 int16 看就是负数），
 *   然后**继续读同一个条目里的下一个控制字**
 * - `ctl & 0x8000`：本条到此为止（纯跳行，不画东西）
 * - 否则 `ctl` = 本条里的步数，读 ctl 组 `{u8 跳过, u8 操作码, …}`
 *
 * 步里的操作码：
 * - < 0x80：字面量，**操作码 × 2** 个像素，每像素 1 字节索引
 * - ≥ 0x80：游程，`256 − 操作码` 个像素，后面 2 个值字节
 *   （两个都非 0 → 两色交替；否则单色，0 表示不动）
 *
 * ⚠️ 每条都从**本行第 0 列**开始（原版把行指针重置成行首）。
 * @source `fcn_004506c7`（VA 0x004506c7）
 */
function readRowDelta(
  data: Uint8Array,
  start: number,
  end: number,
  w: number,
  h: number,
  pal: Uint16Array,
  canvas: Uint16Array,
  owned: Uint8Array,
): void {
  let p = start;
  const entries = u16(data, p);
  p += 2;
  let row = 0;
  for (let e = 0; e < entries; e++) {
    for (;;) {
      if (p + 2 > end) throw new AnmFormatError('差值记录：控制字越界');
      const ctl = u16(data, p);
      p += 2;
      if ((ctl & 0xc000) === 0xc000) {
        // 跳行：ctl 当 int16 看是负数，取反就是行数
        row += (ctl & 0xffff) >= 0x8000 ? 0x10000 - ctl : ctl;
        continue;
      }
      if ((ctl & 0x8000) !== 0) break;
      let x = row * w;
      for (let s = 0; s < ctl; s++) {
        if (p + 2 > end) throw new AnmFormatError('差值记录：步越界');
        const skip = data[p]!;
        const op = data[p + 1]!;
        p += 2;
        x += skip;
        if (op < 0x80) {
          const n = op * 2;
          if (p + n > end) throw new AnmFormatError('差值记录：字面量越界');
          for (let i = 0; i < n; i++) put(canvas, owned, x++, data[p++]!, pal);
        } else {
          const n = 256 - op;
          if (p + 2 > end) throw new AnmFormatError('差值记录：游程越界');
          const a = data[p]!;
          const b = data[p + 1]!;
          p += 2;
          for (let i = 0; i < n; i++) {
            if (a !== 0 && b !== 0) put(canvas, owned, x++, i % 2 === 0 ? a : b, pal);
            else if (a !== 0) put(canvas, owned, x++, a, pal);
            else x++;
          }
        }
      }
      break;
    }
    row += 1;
  }
  if (p !== end) throw new AnmFormatError(`差值记录吃不完（${p - start}/${end - start}）`);
}

/**
 * 命令 15：整帧索引位图，按行 RLE。
 *
 * 每行开头 1 字节（跳过），然后到行满为止：`u8 c` ——
 * `c ≤ 0x80` 是游程（后面 1 个索引，重复 c 次）；`c > 0x80` 是字面量
 * （后面 `256 − c` 个索引）。索引 0 = 不动。
 *
 * @source `fcn_00450b3a`（VA 0x00450b3a）
 */
function readFullFrame(
  data: Uint8Array,
  start: number,
  end: number,
  w: number,
  h: number,
  pal: Uint16Array,
  canvas: Uint16Array,
  owned: Uint8Array,
): void {
  let p = start;
  for (let row = 0; row < h; row++) {
    p += 1; // 行首那一个字节
    let x = row * w;
    let filled = 0;
    while (filled < w) {
      if (p + 1 > end) throw new AnmFormatError('整帧记录越界');
      const c = data[p++]!;
      if (c <= 0x80) {
        if (p + 1 > end) throw new AnmFormatError('整帧记录：游程越界');
        const v = data[p++]!;
        for (let i = 0; i < c && filled < w; i++, filled++) put(canvas, owned, x++, v, pal);
        x += 0;
      } else {
        const n = 256 - c;
        if (p + n > end) throw new AnmFormatError('整帧记录：字面量越界');
        for (let i = 0; i < n && filled < w; i++, filled++) put(canvas, owned, x++, data[p++]!, pal);
      }
    }
  }
  if (p !== end) throw new AnmFormatError(`整帧记录吃不完（${p - start}/${end - start}）`);
}

function toRgba(canvas: Uint16Array, owned: Uint8Array, npix: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(npix * 4);
  for (let i = 0; i < npix; i++) {
    if (owned[i] === 0) continue; // alpha 留 0 = 透明（底下那层露出来）
    const c = canvas[i]!;
    rgba[i * 4 + 0] = expand5((c >> 10) & 0x1f);
    rgba[i * 4 + 1] = expand5((c >> 5) & 0x1f);
    rgba[i * 4 + 2] = expand5(c & 0x1f);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
