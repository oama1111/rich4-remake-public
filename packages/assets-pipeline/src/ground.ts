/*
 * 地图底图（.gnd）解码
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ map.mkf 的资源是**成对**的：偶数号是底图，奇数号是地图结构数据。
 *   `map.mkf[地图编号 * 2]`     → 本模块解的 .gnd 底图
 *   `map.mkf[地图编号 * 2 + 1]` → core 的 `parseMap` 解的节点/地块表
 *   先前只用了奇数号那一半，底图一直没解——棋盘因此只能画色块。
 *
 * 格式（由 0000.gnd 逐字节推出，八张图完全一致）：
 * ```
 * 偏移  长度      内容
 * 0x00  4         魔数 "GND\0"
 * 0x04  2 (u16)   横向块数 = 72
 * 0x06  2 (u16)   纵向块数 = 72
 * 0x08  4 (u32)   块总数 = 5184 = 72 × 72
 * 0x0c  4         恒为 0
 * 0x10  512       调色板：256 项 RGB555（首项为黑，与 SPR 同制）
 * 0x210 5318784   5184 块 × 1026 字节，**按块顺序**排列（先行后列）
 * ```
 * 每块 1026 字节 = **38 × 27** 的 8bpp 调色板索引，块内按行优先。
 * 整图因此是 `72×38 = 2736` 宽、`72×27 = 1944` 高。
 *
 * ★ 38×27 这个块尺寸是**验证过的**，不是猜的：
 *   1026 的因数里只有它能让八张底图都解出连贯画面
 *   （0000.gnd 解出来就是台湾岛，0002.gnd 是中国大陆，依此类推）。
 *   块宽取错会立刻出现斜向撕裂，一眼可辨。
 */

/** 文件魔数 */
export const GND_MAGIC = 'GND\0';
/** 块尺寸 */
export const GND_TILE_WIDTH = 38;
export const GND_TILE_HEIGHT = 27;
/** 每块字节数 */
export const GND_TILE_BYTES = GND_TILE_WIDTH * GND_TILE_HEIGHT; // 1026
/** 调色板项数与字节数 */
export const GND_PALETTE_ENTRIES = 256;
const PALETTE_OFFSET = 0x10;
const PALETTE_BYTES = GND_PALETTE_ENTRIES * 2;
const PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_BYTES; // 0x210

export interface GroundImage {
  /** 整图宽高（像素） */
  width: number;
  height: number;
  /** 横纵块数 */
  tilesX: number;
  tilesY: number;
  /** RGBA8，长度 width × height × 4，全不透明 */
  rgba: Uint8Array;
}

export class GroundFormatError extends Error {}

/** 快速判断一段数据是不是 .gnd */
export function isGround(data: Uint8Array): boolean {
  return (
    data.length > PIXEL_OFFSET &&
    data[0] === 0x47 &&
    data[1] === 0x4e &&
    data[2] === 0x44 &&
    data[3] === 0x00
  );
}

/**
 * 解码一张底图。
 *
 * RGB555 → RGB888 用 `v * 255 / 31`（与 sprite.ts 的 SMP 解码同一套展开），
 * 保证底图与其上的精灵色调一致。
 */
export function decodeGround(data: Uint8Array): GroundImage {
  if (!isGround(data)) throw new GroundFormatError('不是 GND 文件（魔数不符）');

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tilesX = view.getUint16(0x04, true);
  const tilesY = view.getUint16(0x06, true);
  const tileCount = view.getUint32(0x08, true);

  if (tilesX === 0 || tilesY === 0) throw new GroundFormatError('块数为 0');
  if (tilesX * tilesY !== tileCount) {
    throw new GroundFormatError(`块数不自洽：${tilesX}×${tilesY} ≠ ${tileCount}`);
  }
  const need = PIXEL_OFFSET + tileCount * GND_TILE_BYTES;
  if (data.length < need) {
    throw new GroundFormatError(`数据长度 ${data.length} 不足 ${need}`);
  }

  // 调色板：RGB555 → RGB888
  const palR = new Uint8Array(GND_PALETTE_ENTRIES);
  const palG = new Uint8Array(GND_PALETTE_ENTRIES);
  const palB = new Uint8Array(GND_PALETTE_ENTRIES);
  for (let i = 0; i < GND_PALETTE_ENTRIES; i++) {
    const v = view.getUint16(PALETTE_OFFSET + i * 2, true);
    palR[i] = (((v >> 10) & 31) * 255) / 31;
    palG[i] = (((v >> 5) & 31) * 255) / 31;
    palB[i] = ((v & 31) * 255) / 31;
  }

  const width = tilesX * GND_TILE_WIDTH;
  const height = tilesY * GND_TILE_HEIGHT;
  const rgba = new Uint8Array(width * height * 4);

  // 按块展开。块内行优先，块之间也行优先。
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const src = PIXEL_OFFSET + (ty * tilesX + tx) * GND_TILE_BYTES;
      for (let iy = 0; iy < GND_TILE_HEIGHT; iy++) {
        const dstRow = (ty * GND_TILE_HEIGHT + iy) * width + tx * GND_TILE_WIDTH;
        for (let ix = 0; ix < GND_TILE_WIDTH; ix++) {
          const idx = data[src + iy * GND_TILE_WIDTH + ix] ?? 0;
          const o = (dstRow + ix) * 4;
          rgba[o] = palR[idx]!;
          rgba[o + 1] = palG[idx]!;
          rgba[o + 2] = palB[idx]!;
          rgba[o + 3] = 255;
        }
      }
    }
  }

  return { width, height, tilesX, tilesY, rgba };
}

/**
 * ⚠️ **底图与节点坐标的对齐关系尚未解出**（登记为 Q-GND-1）。
 *
 * 节点的 x/y 与底图像素**不是同一个原点**：把 0001.bin 的 103 个节点
 * 原样画到 0000.gnd 上，整条路线偏在岛的西侧海里；平移约 (+510, −230)
 * 之后才严丝合缝地落在岛上（含通往绿岛/兰屿的那串支线）。
 *
 * 但这个偏移**不是常数**——对八张图各自拟合得到的值从 −330 到 +780
 * 散得毫无规律，说明它不是一个全局常量，而多半来自绘制时的摄像机/
 * 世界原点换算，得去 exe 里找。
 *
 * 在解出来之前**不提供任何偏移值**：与其给一个靠颜色启发式拟合出来的
 * 数，不如让调用方明确知道这一层还没对齐。
 */
export const GROUND_ALIGNMENT_UNRESOLVED = true;
