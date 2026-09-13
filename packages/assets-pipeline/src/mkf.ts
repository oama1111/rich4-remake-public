/*
 * mkf 容器读取
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 格式规范 @source rich4-re/csrc/mkf/mkf-format.md
 * 读取逻辑 @source rich4-re/csrc/mkf/mkf.c
 */

import { mkfDecompress } from './mkf-decompress.ts';

/** 资源头，16 字节 = 4 个小端 uint32 */
export interface ChunkHeader {
  /** 解压后的大小 */
  uncompressedSize: number;
  /** 文件中实际存储的大小；与 uncompressedSize 相等表示未压缩 */
  compressedSize: number;
  /** 图像数据在解压后数据中的偏移（非图像资源为 0） */
  imageDataOffset: number;
  /** 图像数据字节数（非图像资源为 0） */
  imageDataSize: number;
}

/**
 * 像素格式转换模式。
 *
 * 原版 `update_pixels()` 会按**当前 DirectDraw 表面格式**改写像素，
 * 把存储的 RGB555 转成屏幕格式。
 *
 * ⚠️ 重制版默认用 `none` —— 保留原始 RGB555，由渲染层自行转换。
 *    注意 `tools/dump_all.c` 用的是 `pixel_fmt = 1`，因此既有 `png/`
 *    目录里的图**已经被转成 RGB565 布局**，不可直接作为色彩基准。
 *
 * @source rich4-re/csrc/mkf/mkf.c update_pixels()
 */
export type PixelFormat = 'none' | 'rgb565' | 'bgr555' | 'rgb444';

export class MkfArchive {
  /** 每个资源在文件中的起始偏移 */
  readonly index: readonly number[];
  readonly #data: Uint8Array;

  constructor(data: Uint8Array) {
    this.#data = data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // 文件头 4 字节 = 索引表偏移
    const indexTableOffset = view.getUint32(0, true);
    if (indexTableOffset < 4 || indexTableOffset >= data.length) {
      throw new Error(`mkf 索引表偏移非法: ${indexTableOffset}`);
    }
    const tableBytes = data.length - indexTableOffset;
    if (tableBytes % 4 !== 0) {
      throw new Error(`mkf 索引表长度 ${tableBytes} 不是 4 的倍数`);
    }

    const index: number[] = [];
    for (let i = 0; i < tableBytes / 4; i++) {
      index.push(view.getUint32(indexTableOffset + i * 4, true));
    }
    this.index = index;
  }

  /** 资源数量 */
  get count(): number {
    return this.index.length;
  }

  /** 读取某个资源的头部 */
  header(i: number): ChunkHeader {
    const off = this.index[i];
    if (off === undefined) throw new RangeError(`资源号越界: ${i}`);
    const view = new DataView(this.#data.buffer, this.#data.byteOffset, this.#data.byteLength);
    return {
      uncompressedSize: view.getUint32(off, true),
      compressedSize: view.getUint32(off + 4, true),
      imageDataOffset: view.getUint32(off + 8, true),
      imageDataSize: view.getUint32(off + 12, true),
    };
  }

  /**
   * 读出并解压某个资源。
   * @param pixelFormat 是否对图像数据做格式转换，默认 `none`（保留原始 RGB555）
   */
  read(i: number, pixelFormat: PixelFormat = 'none'): Uint8Array {
    const off = this.index[i];
    if (off === undefined) throw new RangeError(`资源号越界: ${i}`);
    const h = this.header(i);
    const body = this.#data.subarray(off + 16, off + 16 + h.compressedSize);

    const out =
      h.compressedSize === h.uncompressedSize
        ? body.slice() // 未压缩
        : mkfDecompress(body, h.uncompressedSize);

    if (pixelFormat !== 'none' && h.imageDataSize !== 0) {
      convertPixels(out, h.imageDataOffset, h.imageDataSize, pixelFormat);
    }
    return out;
  }
}

/**
 * 像素格式转换。
 * @source rich4-re/csrc/mkf/mkf.c update_pixels() —— pixel_fmt 取值 1/2/3
 */
export function convertPixels(
  buf: Uint8Array,
  offset: number,
  nbytes: number,
  fmt: PixelFormat,
): void {
  if (fmt === 'none') return;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nw = nbytes >> 1;

  for (let i = 0; i < nw; i++) {
    const at = offset + i * 2;
    const t = view.getUint16(at, true);
    let v: number;
    switch (fmt) {
      case 'rgb565': // pixel_fmt 1：RGB555 → RGB565（绿色最低位补 0）
        v = (t & 0x001f) | ((t * 2) & 0xffc0);
        break;
      case 'bgr555': // pixel_fmt 2：红蓝通道对调
        v = ((t & 0x7c00) >> 10) | ((t & 0x03e0) << 1) | ((t & 0x001f) << 11);
        break;
      case 'rgb444': // pixel_fmt 3：降到每通道 4 位
        v = ((t & 0x7800) >> 3) | ((t & 0x03c0) >> 2) | ((t & 0x001e) >> 1);
        break;
    }
    view.setUint16(at, v & 0xffff, true);
  }
}

/** SPR / SMP 资源中的单张图像描述，12 字节 */
export interface GraphInfo {
  width: number;
  height: number;
  /** 绘制锚点 —— 超分时必须同步缩放，否则精灵定位全错（C-AST-6） */
  x: number;
  y: number;
  /** 该图像数据的字节数 */
  gsize: number;
  /** 图像数据在资源内的起始偏移 */
  dataOffset: number;
}

export interface SpriteSheet {
  signature: 'SPR' | 'SMP';
  images: GraphInfo[];
  /** SPR 资源自带 512 字节调色板；SMP 无 */
  palette: Uint8Array | null;
}

/**
 * 解析 SPR / SMP 资源。
 *
 * @source mkf-format.md §3.1 与 rich4-re/csrc/mkf/mkf.c update_spr_smp_ptr()
 *   SPR: graph_offset[0] = start_offset + 512（前 512 字节是调色板）
 *   SMP: graph_offset[0] = start_offset
 */
export function parseSpriteSheet(data: Uint8Array): SpriteSheet | null {
  if (data.length < 12) return null;
  const sig = String.fromCharCode(data[0]!, data[1]!, data[2]!);
  if (sig !== 'SPR' && sig !== 'SMP') return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numChunks = view.getUint32(4, true);
  const startOffset = view.getUint32(8, true);

  const images: GraphInfo[] = [];
  let dataOffset = sig === 'SPR' ? startOffset + 512 : startOffset;

  for (let i = 0; i < numChunks; i++) {
    const t = 12 + i * 12;
    if (t + 12 > data.length) break;
    const gsize = view.getUint32(t + 8, true);
    images.push({
      width: view.getInt16(t + 0, true),
      height: view.getInt16(t + 2, true),
      x: view.getInt16(t + 4, true),
      y: view.getInt16(t + 6, true),
      gsize,
      dataOffset,
    });
    dataOffset += gsize;
  }

  const palette =
    sig === 'SPR' && startOffset + 512 <= data.length
      ? data.subarray(startOffset, startOffset + 512)
      : null;

  return { signature: sig, images, palette };
}
