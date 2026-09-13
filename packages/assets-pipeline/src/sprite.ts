/*
 * 精灵解码：SPR / SMP → RGBA8888
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 实测结论（8 个 mkf 档案、720 个精灵表、约 13000 张图像全量统计）：
 *
 *   SMP = 原始 16bpp RGB555 位图，`gsize === width * height * 2`，不透明
 *   SPR = 原始 8bpp 调色板位图，`gsize === width * height`，索引 0 为透明
 *
 * **两者都没有 RLE 压缩**。SPR 的 2089 张图像 `gsize/(w*h)` 恒为 1.000。
 * 每张图逐行存储，行内从左到右。
 *
 * 调色板：SPR 资源头部的 512 字节 = 256 项 uint16 小端 RGB555。
 */

import type { SpriteSheet, GraphInfo } from './mkf.ts';

/** SPR 中代表透明的调色板索引 */
export const TRANSPARENT_INDEX = 0;

export interface DecodedImage {
  width: number;
  height: number;
  /**
   * 绘制锚点（原版 graph_info 的 x/y）。
   * 实测约为 width/2、height/2，即**精灵中心**。
   * ⚠️ 超分时必须同步缩放（C-AST-6），否则所有精灵定位全错。
   */
  anchorX: number;
  anchorY: number;
  /** RGBA8888，长度 = width * height * 4 */
  rgba: Uint8ClampedArray;
}

/**
 * RGB555 → RGB888。
 * 高位复制到低位，使 31 映射到 255（而非 248），避免整体偏暗。
 */
function expand5(v: number): number {
  return (v << 3) | (v >> 2);
}

/** 把 512 字节调色板解成 256 个 RGB 三元组 */
export function parsePalette(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(256 * 3);
  const view = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  for (let i = 0; i < 256; i++) {
    const c = view.getUint16(i * 2, true);
    out[i * 3 + 0] = expand5((c >> 10) & 0x1f);
    out[i * 3 + 1] = expand5((c >> 5) & 0x1f);
    out[i * 3 + 2] = expand5(c & 0x1f);
  }
  return out;
}

/**
 * 解码精灵表中的一张图像。
 *
 * @param sheet 由 parseSpriteSheet 得到的精灵表
 * @param data  该资源解压后的完整数据（**必须用 pixelFormat: 'none'** 读取，
 *              否则像素已被转成 RGB565，色彩会错）
 * @param index 图像下标
 */
export interface DecodeOptions {
  /**
   * 把 SMP 里的**纯黑**（RGB555 值 0）当作透明色。
   *
   * ★ SMP 本身没有 alpha 通道，但叠在地图上的那些图（特殊格装饰、
   *   `map.mkf` 资源 24 等）确实需要抠掉底色。证据两条：
   *   1. 资源 24 的每张图有 22%~27% 是**纯黑**，且集中在四角，
   *      恰好把中间的椭圆图案框出来——与 SPR 用索引 0 抠图时
   *      18%~29% 的透明占比是同一个量级。
   *   2. 原版截图里这些椭圆是**融进草地**的，没有黑框。
   *
   * ⚠️ 对**整屏背景**那类 SMP（银行内景、640×480 的底图）不要开：
   *   那些图里的黑是真的黑。故这是个显式开关，不是默认行为。
   */
  colorKeyBlack?: boolean;
}

export function decodeImage(
  sheet: SpriteSheet,
  data: Uint8Array,
  index: number,
  options: DecodeOptions = {},
): DecodedImage {
  const info = sheet.images[index];
  if (info === undefined) throw new RangeError(`图像下标越界: ${index}`);

  return sheet.signature === 'SPR'
    ? decodeSpr(info, data, sheet.palette)
    : decodeSmp(info, data, options.colorKeyBlack ?? false);
}

/** SPR：8bpp 调色板，索引 0 透明 */
function decodeSpr(info: GraphInfo, data: Uint8Array, palette: Uint8Array | null): DecodedImage {
  if (palette === null) throw new Error('SPR 资源缺少调色板');
  const { width, height, gsize, dataOffset } = info;
  const expected = width * height;
  if (gsize !== expected) {
    throw new Error(`SPR 图像大小异常: gsize=${gsize} 期望=${expected} (${width}x${height})`);
  }

  const pal = parsePalette(palette);
  const rgba = new Uint8ClampedArray(expected * 4);

  for (let p = 0; p < expected; p++) {
    const idx = data[dataOffset + p] ?? 0;
    if (idx === TRANSPARENT_INDEX) continue; // 留作 (0,0,0,0)
    const o = p * 4;
    const q = idx * 3;
    rgba[o + 0] = pal[q + 0]!;
    rgba[o + 1] = pal[q + 1]!;
    rgba[o + 2] = pal[q + 2]!;
    rgba[o + 3] = 255;
  }

  return { width, height, anchorX: info.x, anchorY: info.y, rgba };
}

/** SMP：原始 16bpp RGB555；默认不透明，可选把纯黑抠成透明 */
function decodeSmp(info: GraphInfo, data: Uint8Array, colorKeyBlack: boolean): DecodedImage {
  const { width, height, gsize, dataOffset } = info;
  const count = width * height;
  if (gsize !== count * 2) {
    throw new Error(`SMP 图像大小异常: gsize=${gsize} 期望=${count * 2} (${width}x${height})`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rgba = new Uint8ClampedArray(count * 4);

  for (let p = 0; p < count; p++) {
    const c = view.getUint16(dataOffset + p * 2, true);
    // @see DecodeOptions.colorKeyBlack —— RGB555 值 0 即纯黑
    if (colorKeyBlack && c === 0) continue; // 留作 (0,0,0,0)
    const o = p * 4;
    rgba[o + 0] = expand5((c >> 10) & 0x1f);
    rgba[o + 1] = expand5((c >> 5) & 0x1f);
    rgba[o + 2] = expand5(c & 0x1f);
    rgba[o + 3] = 255;
  }

  return { width, height, anchorX: info.x, anchorY: info.y, rgba };
}

/**
 * 编码为 PNG。
 *
 * 手写实现以保持 assets-pipeline 的零依赖（避免为一个编码器引入整条图像库链）。
 * 使用 zlib 的 store 模式（不压缩）加 CRC32，产出体积偏大但完全合规，
 * 后续如需压缩可在此替换。
 */
export function encodePng(img: DecodedImage): Uint8Array {
  const { width, height, rgba } = img;

  // 每行前置 1 字节 filter type (0 = None)
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (1 + width * 4);
    raw[dst] = 0;
    raw.set(rgba.subarray(src, src + width * 4), dst + 1);
  }

  const chunks: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr(width, height)),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ];

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function ihdr(width: number, height: number): Uint8Array {
  const b = new Uint8Array(13);
  const v = new DataView(b.buffer);
  v.setUint32(0, width, false);
  v.setUint32(4, height, false);
  b[8] = 8; // bit depth
  b[9] = 6; // color type: RGBA
  b[10] = 0; // deflate
  b[11] = 0; // filter
  b[12] = 0; // no interlace
  return b;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/** zlib 容器 + deflate 的 stored（未压缩）块 */
function zlibStore(data: Uint8Array): Uint8Array {
  const MAX = 0xffff;
  const nBlocks = Math.max(1, Math.ceil(data.length / MAX));
  const out = new Uint8Array(2 + nBlocks * 5 + data.length + 4);
  let at = 0;
  out[at++] = 0x78; // CMF: deflate, 32K window
  out[at++] = 0x01; // FLG

  for (let i = 0; i < nBlocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, data.length - start);
    out[at++] = i === nBlocks - 1 ? 1 : 0; // BFINAL
    out[at++] = len & 0xff;
    out[at++] = (len >> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >> 8) & 0xff;
    out.set(data.subarray(start, start + len), at);
    at += len;
  }

  const a = adler32(data);
  out[at++] = (a >>> 24) & 0xff;
  out[at++] = (a >>> 16) & 0xff;
  out[at++] = (a >>> 8) & 0xff;
  out[at++] = a & 0xff;
  return out.subarray(0, at);
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
