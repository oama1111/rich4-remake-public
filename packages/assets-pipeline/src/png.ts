/*
 * PNG 编解码 —— **Node 专用**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ 本模块用了 `node:zlib`，**不能进前端包**（见 Q-BUILD-1）。
 *   前端要读 PNG 就交给浏览器原生解码（`createImageBitmap(new Blob([bytes]))`），
 *   不要 import 这里。故它**不在** index.ts 的 barrel 里，只经 `@rich4/assets-pipeline/node` 暴露。
 *
 * 从 sprite.ts 拆出来是为了让那个 barrel 保持浏览器安全 —— sprite.ts 里除此之外
 * 全是纯 Uint8Array 运算，两边都跑得。
 */

import { inflateSync } from 'node:zlib';
import type { DecodedImage } from './sprite.ts';

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

// ============================================================
//  PNG 解码 —— encodePng 的逆运算，供切片/回填读图
// ============================================================

export class PngFormatError extends Error {}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 各色彩类型的每像素字节数（仅支持 8bit：0=灰度 2=RGB 4=灰度+Alpha 6=RGBA） */
const COLOR_TYPE_BPP: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * 解码 PNG → RGBA8888。
 *
 * 支持非交错的 8bit 灰度/RGB/灰度+Alpha/RGBA，五种 scanline filter
 * 全部还原（自己 encodePng 的产物恒为 filter 0 + zlib store，
 * 但外部超分工具回传的图会用真压缩与各类 filter，必须都能读）。
 *
 * 锚点无处可得（PNG 不存），恒为 0/0——锚点以 manifest 为准。
 */
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new PngFormatError('不是 PNG（签名不符）');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idatParts: Uint8Array[] = [];
  let sawIend = false;

  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = u32be(bytes, at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (data.length < len) throw new PngFormatError(`块 ${type} 长度越界`);
    if (type === 'IHDR') {
      if (len !== 13) throw new PngFormatError('IHDR 长度不是 13');
      width = u32be(data, 0);
      height = u32be(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new PngFormatError('不支持交错（interlaced）PNG');
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }
    at += 12 + len;
  }
  if (!sawIend) throw new PngFormatError('缺少 IEND');
  if (width === 0 || height === 0) throw new PngFormatError('缺少 IHDR 或尺寸为 0');
  if (bitDepth !== 8) throw new PngFormatError(`仅支持 8bit PNG（收到 ${bitDepth}bit）`);
  const bpp = COLOR_TYPE_BPP[colorType];
  if (bpp === undefined) throw new PngFormatError(`不支持的色彩类型 ${colorType}`);

  const compressed = new Uint8Array(idatParts.reduce((s, p) => s + p.length, 0));
  {
    let o = 0;
    for (const p of idatParts) {
      compressed.set(p, o);
      o += p.length;
    }
  }
  const raw = new Uint8Array(inflateSync(compressed));

  const stride = width * bpp;
  const expected = height * (1 + stride);
  if (raw.length < expected) {
    throw new PngFormatError(`像素数据不足：${raw.length} < ${expected}`);
  }

  // 还原 scanline filter（0=None 1=Sub 2=Up 3=Average 4=Paeth）
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + stride)]!;
    const rowIn = y * (1 + stride) + 1;
    const rowOut = y * stride;
    const prevOut = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowIn + x]!;
      const a = x >= bpp ? px[rowOut + x - bpp]! : 0; // 左
      const b = y > 0 ? px[prevOut + x]! : 0; // 上
      const c = x >= bpp && y > 0 ? px[prevOut + x - bpp]! : 0; // 左上
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4:
          out = v + paeth(a, b, c);
          break;
        default:
          throw new PngFormatError(`未知 filter 类型 ${filter}（第 ${y} 行）`);
      }
      px[rowOut + x] = out & 0xff;
    }
  }

  // 统一到 RGBA8888
  const n = width * height;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const s = i * bpp;
    const o = i * 4;
    if (colorType === 0) {
      const g = px[s]!;
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = 255;
    } else if (colorType === 2) {
      rgba[o] = px[s]!;
      rgba[o + 1] = px[s + 1]!;
      rgba[o + 2] = px[s + 2]!;
      rgba[o + 3] = 255;
    } else if (colorType === 4) {
      const g = px[s]!;
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = px[s + 1]!;
    } else {
      rgba[o] = px[s]!;
      rgba[o + 1] = px[s + 1]!;
      rgba[o + 2] = px[s + 2]!;
      rgba[o + 3] = px[s + 3]!;
    }
  }

  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 大端读 uint32（Uint8Array 没有 Buffer 的 readUInt32BE） */
function u32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}
