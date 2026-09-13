/*
 * 地图物件系统
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编与二进制数据表为准。
 *
 * 神明、路障、地雷等都统一表示为「地图物件」，
 * 玩家结构中的 `god_info`(+0x3f) 与 `f64`(+0x40) 存的是**物件下标 + 1**。
 */

/**
 * 物件总数。
 * @source `rich4_load_map.asm` 的 `memset(objects_info, 0, 0x450)`
 *   与 `cmp ebx, 0x2e`（46），每项 24 字节（0x450 / 46 = 24）。
 */
export const OBJECT_COUNT = 0x2e; // 46
/** 每个物件的结构体大小 @source `byte [eax*8 + objects_info]` 中 eax = i*3 → i*24 */
export const OBJECT_ENTRY_SIZE = 24;

/**
 * 物件的初始类型表（46 项）。
 *
 * ★ 直接从 `rich4.exe` VA 0x0047ed3c 提取，不经任何转录。
 * @source `rich4_load_map.asm`:
 * ```asm
 * mov dl, byte [ebx + ref_0047ed3c]
 * mov byte [eax*8 + objects_info], dl     ; objects_info[i].type = table[i]
 * ```
 *
 * 结构上分三段：
 * - 下标 0..13 → 类型 1..14，**各一个**（唯一物件，含神明）
 * - 下标 14..15 → 类型 15，两个
 * - 下标 16..45 → 类型 16/17/18，**各 10 个**（可反复放置的道具）
 */
export const OBJECT_TYPE_TABLE: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 15, 16, 16, 16, 16,
  16, 16, 16, 16, 16, 16, 17, 17, 17, 17,
  17, 17, 17, 17, 17, 17, 18, 18, 18, 18,
  18, 18, 18, 18, 18, 18,
];

/**
 * 送神符可以送走的物件类型。
 *
 * @source 送神符 VA 0x00444c9f 起的连续比较：
 * ```asm
 * cmp eax, 5  / je  处理
 * cmp eax, 6  / je  处理
 * cmp eax, 7  / je  处理
 * cmp eax, 8  / je  处理
 * cmp eax, 0xa / je 处理
 * cmp eax, 0xf / jne 跳过
 * ```
 *
 * 注意下标 0..13 的物件类型恰为「下标 + 1」，因此
 * `objects_info[god_info - 1].type === god_info`，
 * 即这组判定等价于 `god_info ∈ {5,6,7,8,10,15}`。
 *
 * 结合 `rich4-re/docs` 记载的「1:小财 2:大财 5:小穷 6:大穷」，
 * **送神符只送走「坏」的那几种，财神（1/2）不在其列**——
 * 这符合道具的用途：你不会想把财神请走。
 */
export const DISPELLABLE_TYPES: readonly number[] = [5, 6, 7, 8, 10, 15];

/** 取某个物件下标的类型 */
export function objectTypeOf(objectIndex: number): number {
  return OBJECT_TYPE_TABLE[objectIndex] ?? 0;
}

/**
 * 玩家身上附着的物件是否可被送神符送走。
 *
 * @param godInfo 玩家的 `god_info` 字段（**物件下标 + 1**，0 表示无）
 */
export function canDispel(godInfo: number): boolean {
  if (godInfo === 0) return false;
  return DISPELLABLE_TYPES.includes(objectTypeOf(godInfo - 1));
}

/** 开局时随机放置到地图上的物件下标 */
export const INITIAL_PLACED_OBJECTS: readonly number[] = [1, 3, 5, 7, 9, 11, 13, 14];
