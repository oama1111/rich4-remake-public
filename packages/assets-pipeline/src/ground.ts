/*
 * 地图底图（.gnd）解码
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ map.mkf 的资源是**成对**的：偶数号是底图，奇数号是地图结构数据。
 *   `map.mkf[地图编号 * 2]`     → 本模块解的 .gnd 底图
 *   `map.mkf[地图编号 * 2 + 1]` → core 的 `parseMap` 解的节点/地块表
 *
 *   资源号的算法来自原版地图加载代码 VA 0x00407af0：
 *   ```asm
 *   edx = (short)[0x4991b6]      ; game_stage
 *   edx <<= 2
 *   eax = (short)[0x4991b8]      ; game_map
 *   eax += edx                   ; global_map_id = stage*4 + map
 *   eax += eax                   ; ★ 资源号 = global_map_id * 2
 *   call load_resource
 *   ```
 *
 * ## 格式
 *
 * ```
 * 偏移     长度       内容
 * 0x0000   4          魔数 "GND\0"
 * 0x0004   2 (u16)    横向块数 = 72
 * 0x0006   2 (u16)    纵向块数 = 72
 * 0x0008   4 (u32)    块总数 = 5184 = 72 × 72
 * 0x000c   4          恒为 0
 * 0x0010   512        调色板：256 项 RGB555（首项为黑，与 SPR 同制）
 * 0x0210   10368      ★ 块排布表：5184 项 u16，是 0..5183 的一个**排列**
 * 0x2a90   5308416    像素：5184 块 × 1024 字节，每块 32×32 的 8bpp 索引
 * ```
 * 整图 `72×32 = 2304` 见方，恰好 `2304 × 2304 = 5308416` 字节。
 *
 * ## 三个偏移是从原版读出来的，不是猜的
 *
 * 同一段加载代码（VA 0x00407b66 起）把这三处直接写进了全局：
 * ```asm
 * memcpy(0x48b6b4, ground + 0x10, 0x200)   ; ★ 调色板：偏移 0x10，512 字节
 * [0x48bac4] = ground + 0x210              ; ★ 块排布表
 * [0x48bacc] = ground + 0x2a90             ; ★ 像素数据
 * ```
 * `0x2a90 − 0x210 = 0x2880 = 10368 = 5184 × 2`，与「每块一个 u16」严丝合缝。
 *
 * ## ⚠️ 这里走过很长的弯路，值得记下来
 *
 * 在找到上面那段汇编之前，我按「每块 1026 字节」去解——文件长度减去头和
 * 调色板恰好能被 5184 整除得 1026，看着很有说服力。先后试过 38×27、
 * 32×32 加 2 字节等读法，画面**看着**像台湾岛，于是两次都以为解完了，
 * 还据此提了两个并不存在的问题：Q-GND-1「节点坐标需要平移」、
 * Q-GND-2「多出的 2 字节在块首还是块尾」。
 *
 * 真相是：**根本没有「每块 1026 字节」这回事**。1026 = 1024 + 2 是把
 * 「每块 1024 字节像素」和「每块 2 字节排布表项」当成了一条记录。
 * 块之间那圈对不上的 32 像素错位，正是排布表没被用上的直接后果。
 *
 * 教训：**能整除不等于是记录长度**。当时症状都看见了（字母被切开、
 * 接缝 16.4 对块内 9.3），却一直在「这些块该怎么摆」的框架里找答案，
 * 没有回头质疑「块到底是不是 1026 字节」这个前提。
 * 解开它的是去 exe 里读加载代码——一次反汇编胜过十次统计拟合。
 */

/** 文件魔数 */
export const GND_MAGIC = 'GND\0';
/** 块尺寸 —— 32 × 32 像素 */
export const GND_TILE_WIDTH = 32;
export const GND_TILE_HEIGHT = 32;
/** 每块的像素字节数 */
export const GND_TILE_BYTES = GND_TILE_WIDTH * GND_TILE_HEIGHT; // 1024

/** 调色板项数 */
export const GND_PALETTE_ENTRIES = 256;
const PALETTE_OFFSET = 0x10;
const PALETTE_BYTES = GND_PALETTE_ENTRIES * 2;
/** 块排布表 @source `[0x48bac4] = ground + 0x210` */
export const GND_LAYOUT_OFFSET = PALETTE_OFFSET + PALETTE_BYTES; // 0x210
/** 像素数据 @source `[0x48bacc] = ground + 0x2a90` */
export const GND_PIXEL_OFFSET = 0x2a90;

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
    data.length > GND_PIXEL_OFFSET &&
    data[0] === 0x47 &&
    data[1] === 0x4e &&
    data[2] === 0x44 &&
    data[3] === 0x00
  );
}

/**
 * 读出块排布表。
 *
 * `layout[i]` = 网格第 i 格（行优先）该用哪一块像素数据，
 * 取值是 0..块数−1 的一个**排列**（实测八张图都是严格排列）。
 *
 * ⚠️ 不用它就会得到一幅「块内清晰、块间错位」的图——这正是先前两版
 *   解码的病根。
 */
export function readLayout(data: Uint8Array, tileCount: number): Uint16Array {
  const out = new Uint16Array(tileCount);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < tileCount; i++) out[i] = view.getUint16(GND_LAYOUT_OFFSET + i * 2, true);
  return out;
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
  const need = GND_PIXEL_OFFSET + tileCount * GND_TILE_BYTES;
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

  const layout = readLayout(data, tileCount);
  const width = tilesX * GND_TILE_WIDTH;
  const height = tilesY * GND_TILE_HEIGHT;
  const rgba = new Uint8Array(width * height * 4);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // ★ 关键：网格位置要经排布表映射到像素块，不是直接按顺序取
      const block = layout[ty * tilesX + tx] ?? 0;
      const src = GND_PIXEL_OFFSET + block * GND_TILE_BYTES;
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
 * 节点坐标与底图像素**同一个原点，无需任何平移**。
 *
 * 这个常量存在只是为了把「不要再去发明偏移量」写进代码里：
 * 先前那次以为需要 (+510, −230)，根源是块尺寸取错，不是真有偏移。
 */
export const GROUND_ORIGIN = { x: 0, y: 0 } as const;
