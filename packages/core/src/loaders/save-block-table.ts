/*
 * 原版存档「状态块」的 42 个静态块 —— **机械提取，不要手改**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `rich4-spec/docs/systems/save-format.md` §二「权威块序」
 *   该表由 `fread`/`fwrite` 序列的 `count × size` 逐行累加得出，
 *   并与两份真实存档的文件大小闭合（见该文档 §一）。
 *
 * 生成：`python3 tools/scratch/gen-save-block-table.py`（校验了 42 块 / 10,055 字节 /
 *   末块结束于 0x274b = 状态块大小 10,059）。
 */

/** 版本标识的 4 字节 @source `0x00402fd7 mov dword [esp+0x28], 0x26` */
export const ORIGINAL_SAVE_HEADER = 0x26;

/**
 * 状态块总长 = 10,059 字节（= 4 字节版本标识 + 42 个静态块 10,055 字节）。
 * @source `parseSave` 的 `OFFSET.mapData = 0x274b`，与本表末块结束位置**精确相等**。
 */
export const ORIGINAL_STATE_BLOCK_SIZE = 0x274b;

/** 每玩家的「時光機」快照 @source `0x2718` */
export const ORIGINAL_PLAYER_SNAPSHOT_SIZE = 0x2718;

export interface SaveBlock {
  /** 块在状态块内的偏移 */
  offset: number;
  /** `fread`/`fwrite` 的字面 count */
  count: number;
  /** `fread`/`fwrite` 的字面 size */
  size: number;
  /** 字节数 = count × size */
  bytes: number;
  /** 目标全局（`.bss`/DGROUP 地址），用于与其它规格交叉引用 */
  global: number;
}

/** 42 个静态块，**按写档顺序**（与读档顺序逐项配对，见 save-format.md §二之二） */
export const ORIGINAL_SAVE_BLOCKS: readonly SaveBlock[] = [
  { offset: 0x0004, count: 1, size: 4, bytes: 4, global: 0x00497160 },
  { offset: 0x0008, count: 1, size: 2, bytes: 2, global: 0x004991b8 },
  { offset: 0x000a, count: 1, size: 2, bytes: 2, global: 0x004991b6 },
  { offset: 0x000c, count: 1, size: 4, bytes: 4, global: 0x00499114 },
  { offset: 0x0010, count: 4, size: 104, bytes: 416, global: 0x00496b68 },
  { offset: 0x01b0, count: 1, size: 4, bytes: 4, global: 0x00499104 },
  { offset: 0x01b4, count: 5, size: 16, bytes: 80, global: 0x00498e28 },
  { offset: 0x0204, count: 46, size: 24, bytes: 1104, global: 0x00496d08 },
  { offset: 0x0654, count: 60, size: 1, bytes: 60, global: 0x00499120 },
  { offset: 0x0690, count: 60, size: 1, bytes: 60, global: 0x0049915c },
  { offset: 0x06cc, count: 30, size: 1, bytes: 30, global: 0x00499198 },
  { offset: 0x06ea, count: 8, size: 1, bytes: 8, global: 0x00497320 },
  { offset: 0x06f2, count: 1, size: 4, bytes: 4, global: 0x00499100 },
  { offset: 0x06f6, count: 1728, size: 4, bytes: 6912, global: 0x00497328 },
  { offset: 0x21f6, count: 48, size: 8, bytes: 384, global: 0x004971a0 },
  { offset: 0x2376, count: 12, size: 36, bytes: 432, global: 0x00496980 },
  { offset: 0x2526, count: 28, size: 12, bytes: 336, global: 0x004967e0 },
  { offset: 0x2676, count: 1, size: 4, bytes: 4, global: 0x0049910c },
  { offset: 0x267a, count: 1, size: 4, bytes: 4, global: 0x00499118 },
  { offset: 0x267e, count: 1, size: 4, bytes: 4, global: 0x00499110 },
  { offset: 0x2682, count: 1, size: 4, bytes: 4, global: 0x0049911c },
  { offset: 0x2686, count: 1, size: 4, bytes: 4, global: 0x00499108 },
  { offset: 0x268a, count: 1, size: 4, bytes: 4, global: 0x0049908c },
  { offset: 0x268e, count: 1, size: 4, bytes: 4, global: 0x004990e8 },
  { offset: 0x2692, count: 1, size: 4, bytes: 4, global: 0x004990e4 },
  { offset: 0x2696, count: 1, size: 4, bytes: 4, global: 0x00499084 },
  { offset: 0x269a, count: 1, size: 4, bytes: 4, global: 0x004990dc },
  { offset: 0x269e, count: 1, size: 4, bytes: 4, global: 0x0049907c },
  { offset: 0x26a2, count: 1, size: 4, bytes: 4, global: 0x00499078 },
  { offset: 0x26a6, count: 1, size: 4, bytes: 4, global: 0x004990ec },
  { offset: 0x26aa, count: 4, size: 1, bytes: 4, global: 0x004990f0 },
  { offset: 0x26ae, count: 12, size: 1, bytes: 12, global: 0x004990f4 },
  { offset: 0x26ba, count: 1, size: 4, bytes: 4, global: 0x00499080 },
  { offset: 0x26be, count: 36, size: 1, bytes: 36, global: 0x004990b8 },
  { offset: 0x26e2, count: 8, size: 1, bytes: 8, global: 0x00496b30 },
  { offset: 0x26ea, count: 8, size: 1, bytes: 8, global: 0x00496b60 },
  { offset: 0x26f2, count: 1, size: 4, bytes: 4, global: 0x004990e0 },
  { offset: 0x26f6, count: 1, size: 4, bytes: 4, global: 0x004990b4 },
  { offset: 0x26fa, count: 36, size: 1, bytes: 36, global: 0x00499090 },
  { offset: 0x271e, count: 37, size: 1, bytes: 37, global: 0x00496b38 },
  { offset: 0x2743, count: 1, size: 4, bytes: 4, global: 0x00499088 },
  { offset: 0x2747, count: 1, size: 4, bytes: 4, global: 0x00498e94 },
];
