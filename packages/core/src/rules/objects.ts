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
 * 物件表基址与字段偏移。
 *
 * @source 解請神符（VA 0x0040ead7）时补齐：
 * ```
 * 基址 0x00496d08
 * +0x00  type      物件种类（byte）
 * +0x02  nodeId    所在节点（word），0 表示不在地图上
 * +0x04  state     附身后写入：死神(15) 写 13，其余写 7
 * +0x05  attached  附身于谁（玩家下标 + 1）
 * ```
 * 先前只记了 type 在偏移 0。
 */
export const OBJECTS_INFO_BASE = 0x00496d08;

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
 * 「唯一物件」那一段的**最大类型号** —— 类型 1..15（神明 / 惡犬 / 禮物 / 寶箱 / 死神）。
 *
 * @source `OBJECT_TYPE_TABLE` 的三段结构（下标 0..13 → 1..14 各一个；14..15 → 类型 15 两个）；
 *   16/17/18（路障/地雷/定時炸彈）才是「可反复放置的道具」。
 *
 * ★ 用途：需求方 2026-09-22 要求「路障/地雷/定時炸彈 不能和地图上的神灵重叠」
 *   —— 放置前用 `type <= OBJECT_TYPE_UNIQUE_MAX` 判「这一格有没有唯一物件」。
 */
export const OBJECT_TYPE_UNIQUE_MAX = 15;

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

// ============================================================
//  槽位分区
// ============================================================

/**
 * 物件槽是**按种类分区**的，不是随手找空位。
 *
 * @source `place_object` VA 0x0040e033 开头：
 * ```asm
 * eax = type - 15
 * cmp eax, 3 / ja 单槽
 * jmp [eax*4 + 0x40e023]          ; 四路跳表
 *   type 15 死神:     ebx=0x0e, ecx=0x10    ; 槽 14..15
 *   type 16 路障:     ebx=0x10, ecx=0x1a    ; 槽 16..25
 *   type 17 地雷:     ebx=0x1a, ecx=0x24    ; 槽 26..35
 *   type 18 定時炸彈: ebx=0x24, ecx=0x2e    ; 槽 36..45
 * 单槽:
 *   ebx = type - 1, ecx = type              ; ★ 只有一个槽：type - 1
 * for (i = ebx; i < ecx; i++) if (objects[i].nodeId == 0) { 放这里; break }
 * ```
 *
 * ★ 这正是 `OBJECT_TYPE_TABLE` 的镜像：下标决定种类，种类决定下标，
 *   二者必须一致，否则物件表会自相矛盾。
 *
 * ⚠️ 先前 `tool-effects.ts` 的 `placeObject` 取的是**第一个空槽**，
 *   放一个路障可能占掉 0 号（小財神）槽并把它的种类改写成 16——
 *   表的下标↔种类不变量就此破掉。本表就是为修这个而来。
 */
export interface ObjectSlotRange {
  /** 起始下标（含） */
  from: number;
  /** 结束下标（不含） */
  to: number;
}

export function slotRangeForType(type: number): ObjectSlotRange {
  // @source jmp [eax*4 + 0x40e023] 的四个分支
  switch (type) {
    case 15:
      return { from: 0x0e, to: 0x10 };
    case 16:
      return { from: 0x10, to: 0x1a };
    case 17:
      return { from: 0x1a, to: 0x24 };
    case 18:
      return { from: 0x24, to: 0x2e };
    default:
      // @source lea ebx,[edi-1] / mov ecx,edi —— 唯一物件只有自己那一格
      return { from: type - 1, to: type };
  }
}

// ============================================================
//  神明的三项加成
// ============================================================

/**
 * 附身时加到玩家身上、离身时再减掉的三个修正量。
 *
 * @source 三张**并列**的有符号 word 表，各 18 项，用**种类**（1 基）作下标：
 * ```asm
 * ; attach  VA 0x0040ebcc 起
 * dx = word [type*2 + 0x4749e2] ; add word [player + 0x44], dx
 * dx = word [type*2 + 0x474a06] ; add word [player + 0x46], dx
 * dx = word [type*2 + 0x474a2a] ; add word [player + 0x48], dx
 * ; release VA 0x0040e1ed 起，同三张表，改 sub
 * ```
 *
 * ★ 这解开了 `state/types.ts` 里 `+0x46` 那句「**增减来源尚未定位**」——
 *   来源就是神明附身／离身，除此之外全局再无第二处写入
 *   （`xref 0x496bae` 只有 0x40e205 与 0x40ebec 两条写指令）。
 *
 * 三列各自的含义由读取方钉死：
 * - `+0x44` 衰運：只有一个读者 VA 0x00437d6a，进 AI 的身家估值
 * - `+0x46` 財運：`blessing_level(0, …)`，管**獎金**与**罰金**
 * - `+0x48` 福運：`blessing_level(1, …)`，管**倒霉／逃過此劫**
 *
 * 表本身读起来很像一张设计稿：財神系(1/2)加財運、福神系(3/4)加福運、
 * 窮神系(5/6)扣財運、衰神系(7/8)扣福運，天使(9)两样都加一点、
 * 惡魔(10)两样都扣一点，土地公(12)只把衰運压下去 500，
 * 死神(15)则是 +1000 衰運、両運各 −200 —— 一个人形災難。
 */
export interface GodModifiers {
  /** → player +0x44 衰運 */
  misfortune: number;
  /** → player +0x46 財運 */
  fortune: number;
  /** → player +0x48 福運 */
  luck: number;
}

/** 下标 = 物件**种类**（0 号空置，原版也不用） */
export const GOD_MODIFIERS: readonly GodModifiers[] = [
  /*  0 —      */ { misfortune: 0, fortune: 0, luck: 0 },
  /*  1 小財神 */ { misfortune: -100, fortune: 100, luck: 0 },
  /*  2 大財神 */ { misfortune: -200, fortune: 150, luck: 0 },
  /*  3 小福神 */ { misfortune: -100, fortune: 0, luck: 100 },
  /*  4 大福神 */ { misfortune: -200, fortune: 0, luck: 150 },
  /*  5 小窮神 */ { misfortune: 100, fortune: -60, luck: 0 },
  /*  6 大窮神 */ { misfortune: 200, fortune: -100, luck: 0 },
  /*  7 小衰神 */ { misfortune: 100, fortune: 0, luck: -60 },
  /*  8 大衰神 */ { misfortune: 200, fortune: 0, luck: -100 },
  /*  9 天使   */ { misfortune: -100, fortune: 60, luck: 60 },
  /* 10 惡魔   */ { misfortune: 100, fortune: -60, luck: -60 },
  /* 11 惡犬   */ { misfortune: 0, fortune: 0, luck: 0 },
  /* 12 土地公 */ { misfortune: -500, fortune: 0, luck: 0 },
  /* 13 禮物   */ { misfortune: 0, fortune: 0, luck: 0 },
  /* 14 寶箱   */ { misfortune: 0, fortune: 0, luck: 0 },
  /* 15 死神   */ { misfortune: 1000, fortune: -200, luck: -200 },
  /* 16 路障   */ { misfortune: 0, fortune: 0, luck: 0 },
  /* 17 地雷   */ { misfortune: 0, fortune: 0, luck: 0 },
];

export function godModifiersOf(type: number): GodModifiers {
  return GOD_MODIFIERS[type] ?? { misfortune: 0, fortune: 0, luck: 0 };
}

/**
 * 神明离身后**会换成它的搭档重新出现在地图上**。
 *
 * @source `release_object` 尾部 VA 0x0040e275：
 * ```asm
 * cmp edx, 0xc / jge 结束           ; ★ 只有下标 0..11 有搭档
 * test dl, 1 / je 偶数
 *   ebx = edx - 1                   ; 奇数下标 → 配前一个
 * 偶数:
 *   ebx = edx + 1                   ; 偶数下标 → 配后一个
 * place_object(ebx + 1, pick_node(原节点), 0, 0)
 * ```
 * 即 (0,1)(2,3)(4,5)(6,7)(8,9)(10,11) 六对：
 * 小財神↔大財神、小福神↔大福神、小窮神↔大窮神、小衰神↔大衰神、
 * 天使↔惡魔、惡犬↔土地公。**送走一个小的，来一个大的。**
 *
 * 下标 ≥ 12（禮物/寶箱/死神/路障/地雷/炸彈）没有搭档，走掉就没了。
 */
export const PAIRED_SLOT_LIMIT = 0x0c;

/** 该槽的搭档下标；没有搭档返回 -1 */
export function partnerSlot(slot: number): number {
  if (slot < 0 || slot >= PAIRED_SLOT_LIMIT) return -1;
  return (slot & 1) === 1 ? slot - 1 : slot + 1;
}
