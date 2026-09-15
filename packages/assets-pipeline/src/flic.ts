/*
 * FLIC（Autodesk FLI/FLC）影片解码 —— 掷骰子那段「骰子滚动」用
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么需要它：原版的滚骰**不是贴图序列，是一段 FLIC 影片**。
 *   `Panel.mkf` 资源 4 / 5 / 6 = 1 / 2 / 3 颗骰子的滚动动画，
 *   头部 `magic 0xAF12`、36 帧、189×285、`speed = 14` ms/帧。
 *   原版播它的函数是 `fcn_0045144f`（VA 0x0045144f），
 *   解码分发在 `fcn_00450f04`（VA 0x00450f04）。
 *
 * ★ 本解码器照 **exe 自己的算法**写，不是照 FLI/FLC 公开规范 —— 两者不一样：
 *
 *   | 块类型 | exe 的处理 | 规范 |
 *   |---|---|---|
 *   | 4 COLOR256 | 调色板，**每分量 0..255（不是 0..63）**，`[1 个 WORD 计数][skip][cnt][cnt×3]` | 6-bit |
 *   | 7 DELTA | 见下 | 见下 |
 *   | 15 | RLE（exe VA 0x00450b3a） | FLI_BLACK，无数据 |
 *   | 18 COPY | **整块跳过**（VA 0x00451055 `jmp 0x4510f8`） | 整帧原始像素 |
 *
 * ★ DELTA（块类型 7）的真实格式 —— 与公开规范**有三处不同**，都逐字节验过：
 *
 * ```asm
 * u16 linecount                       ; ★ 只数「真正处理的行」，跳行不算
 * row = 0
 * while (iterations < linecount):
 *   u16 op
 *   if ((op & 0xC000) == 0xC000) { row += (0x10000 - op) & 0xFFFF; continue }  ; ★ 不占一次迭代
 *   if ((op & 0x8000) != 0 || op == 0) { row += 1; iterations += 1; continue }  ; 整行不变
 *   for (op 次):                                                              ; ★ op 就是包数
 *     u8 skip                                ; ★ 单位是**像素**，不是字节
 *     u8 cnt
 *     if (cnt & 0x80) { n = (256 - cnt) * 2; c0 = u8; c1 = u8;                 ; ★ 单位是**成对像素**
 *                       for (n 次) { write(c0/c1 交替) } }
 *     else            { n = cnt * 2; for (n 次) { write(u8) } }
 *   row += 1; iterations += 1
 * ```
 * 三处差异：`skip` 是像素数（exe `eax += skip*2` 是字节步进）、
 * 字面量个数是 `cnt*2`（exe `ebp = bh; ebp += ebp`）、
 * 0xC000 那一支只推进行号、**不计入 linecount**。
 *
 * ★ 透明：索引 0 在原版是「取目标面上的原值」（VA 0x00450758 / 0x00450807
 *   `test bl,bl; je` → `mov bx, word [edx]`），而目标面是**棋盘快照**，
 *   所以它实际就是「露出棋盘」。我们这层的下层是上一帧，故索引 0 直接
 *   落成 alpha = 0 —— 骰子移开后擦掉旧位置靠的就是这一步。
 *
 * ⚠️ 帧 0 的三块（COPY / COLOR256 / BLACK）里 COPY 被原版跳过，剩下的
 *   「BLACK」在 exe 里其实是 RLE（见上表）。实测它只在**前 9 行**画一道
 *   网纹（palette 62/2/127），且第 1 帧之后的 DELTA 从不碰那 9 行 ——
 *   也就是说**如果照 exe 画，那道网纹会一直留到最后**。而用 ffmpeg 按
 *   规范解出的 36 帧里没有它，骰子落点又与 Panel.mkf 资源 3 的点数图
 *   **逐像素吻合**。故本解码器把类型 15 当**清屏**处理（= 规范里 FLI_BLACK
 *   的语义），第 0 帧因此为全透明；差一帧 14 ms。已记进 known-deviations。
 */

/** 一帧的头部大小 */
const FRAME_HEADER = 16;
/** 块头的 `size` 是含本头部的总长；类型在 `size` 之后 */
const CHUNK_HEADER = 6;
/** 帧头部的魔数 */
const FRAME_MAGIC = 0xf1fa;
/** 原版从资源起始 +0x80 处开始找第一帧（VA 0x00450d7b `add eax, 0x80`） */
const SCAN_START = 0x80;

/** 影片头部 */
export interface FlicInfo {
  width: number;
  height: number;
  frames: number;
  /** 每帧停留多少毫秒 —— `fcn_0045144f` 拿它当节拍（VA 0x00450d72） */
  frameMs: number;
}

/** 解好的影片：`frames[i]` 是第 i 帧的 RGBA（索引 0 处 alpha = 0） */
export interface Flic {
  info: FlicInfo;
  frames: Uint8ClampedArray<ArrayBuffer>[];
}

/** 只读头 —— 拿不准是不是 FLIC 时先问它 */
export function parseFlicInfo(data: Uint8Array): FlicInfo | null {
  if (data.length < 20) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(4, true) !== 0xaf12) return null;
  return {
    width: view.getUint16(8, true),
    height: view.getUint16(10, true),
    frames: view.getUint16(6, true),
    frameMs: view.getUint32(16, true),
  };
}

/** 找到第一帧的偏移：从 +0x80 起按块长往前找，直到块类型是 0xF1FA */
function firstFrameOffset(data: Uint8Array, view: DataView): number {
  let p = SCAN_START;
  while (p + CHUNK_HEADER <= data.length) {
    if (view.getUint16(p + 4, true) === FRAME_MAGIC) return p;
    const size = view.getUint32(p, true);
    if (size === 0) break;
    p += size;
  }
  return -1;
}

/** 解出整段影片 */
export function decodeFlic(data: Uint8Array): Flic | null {
  const info = parseFlicInfo(data);
  if (info === null) return null;
  const { width, height, frames } = info;
  if (width <= 0 || height <= 0 || frames <= 0) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = firstFrameOffset(data, view);
  if (p < 0) return null;

  const palette = new Uint8Array(256 * 3);
  // 索引缓冲：0 = 透明。DELTA 是**累积**的（相对上一帧），故整段共用一块
  let buf: Uint8Array<ArrayBuffer> = new Uint8Array(width * height);
  const out: Uint8ClampedArray<ArrayBuffer>[] = [];

  for (let f = 0; f < frames && p + FRAME_HEADER <= data.length; f++) {
    const frameSize = view.getUint32(p, true);
    const chunkCount = view.getUint16(p + 6, true);
    let q = p + FRAME_HEADER;
    for (let c = 0; c < chunkCount && q + CHUNK_HEADER <= data.length; c++) {
      const chunkSize = view.getUint32(q, true);
      const type = view.getUint16(q + 4, true);
      const body = q + CHUNK_HEADER;
      const end = Math.min(q + chunkSize, data.length);
      if (type === 4) readPalette(data, body, end, palette);
      else if (type === 7) buf = readDelta(data, body, end, buf, width, height);
      // 类型 15 = 清屏（见文件头注释）；类型 18 原版整块跳过
      else if (type === 15) buf = new Uint8Array(width * height);
      if (chunkSize < CHUNK_HEADER) break;
      q += chunkSize;
    }
    out.push(toRgba(buf, palette, width, height));
    if (frameSize < FRAME_HEADER) break;
    p += frameSize;
  }

  return { info, frames: out };
}

/**
 * 块类型 4 —— 调色板。
 * `[u16 包数][skip u8][cnt u8][cnt×3 字节]，cnt == 0 表示 256`
 */
function readPalette(data: Uint8Array, from: number, end: number, palette: Uint8Array): void {
  let i = from + 2;
  while (i + 1 < end) {
    const skip = data[i]!;
    let count = data[i + 1]!;
    i += 2;
    if (count === 0) count = 256;
    for (let k = 0; k < count && i + 2 < end; k++, i += 3) {
      const at = (skip + k) * 3;
      if (at + 2 >= palette.length) break;
      palette[at] = data[i]!;
      palette[at + 1] = data[i + 1]!;
      palette[at + 2] = data[i + 2]!;
    }
  }
}

/**
 * 块类型 7 —— 帧间差分。算法见文件头注释（三处与公开规范不同）。
 */
function readDelta(
  data: Uint8Array,
  from: number,
  end: number,
  prev: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(prev);
  if (from + 2 > end) return out;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lineCount = view.getUint16(from, true);

  let i = from + 2;
  let row = 0;
  let done = 0;
  while (done < lineCount && i + 2 <= end) {
    const op = view.getUint16(i, true);
    i += 2;

    if ((op & 0xc000) === 0xc000) {
      // 跳 N 行 —— **不占一次迭代**，与公开规范的「整行同色」完全不同
      row += (0x10000 - op) & 0xffff;
      continue;
    }
    if ((op & 0x8000) !== 0 || op === 0) {
      // 整行不变
      row += 1;
      done += 1;
      continue;
    }

    const base = row * width;
    let x = 0;
    for (let pk = 0; pk < op && i < end; pk++) {
      x += data[i]!;
      i += 1;
      if (i >= end) break;
      const cnt = data[i]!;
      i += 1;
      if ((cnt & 0x80) !== 0) {
        // 成对像素的行程：c0/c1 交替
        const n = (256 - cnt) * 2;
        const c0 = data[i] ?? 0;
        const c1 = data[i + 1] ?? 0;
        i += 2;
        for (let k = 0; k < n; k++) {
          const at = base + x;
          if (at < out.length) out[at] = (k & 1) === 0 ? c0 : c1;
          x += 1;
        }
      } else {
        const n = cnt * 2;
        for (let k = 0; k < n; k++) {
          const v = data[i] ?? 0;
          i += 1;
          const at = base + x;
          // ★ **索引 0 也要写**：原版的目标面是「棋盘快照」，索引 0 = 取回棋盘值
          //   （即露出下层）。我们这层的下层是上一帧累积出来的，所以 0 必须真的
          //   落进去 —— 这正是「骰子移开后擦掉旧位置」的机制。
          if (at < out.length) out[at] = v;
          x += 1;
        }
      }
    }
    row += 1;
    done += 1;
    if (row >= height) break;
  }
  return out;
}

/** 索引缓冲 + 调色板 → RGBA（索引 0 alpha = 0） */
function toRgba(
  index: Uint8Array<ArrayBuffer>,
  palette: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < index.length; p++) {
    const v = index[p]!;
    if (v === 0) continue; // 透明
    const o = p * 4;
    const q = v * 3;
    rgba[o] = palette[q]!;
    rgba[o + 1] = palette[q + 1]!;
    rgba[o + 2] = palette[q + 2]!;
    rgba[o + 3] = 255;
  }
  return rgba;
}
