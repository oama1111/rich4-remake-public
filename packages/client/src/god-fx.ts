/*
 * 神明**降臨／發威**那一段影片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「该播哪一段、此刻画第几帧」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history**。
 *
 * 原版 `_rich4_attach_god`（VA 0x0040ea62 那一支）在**附身那一刻**按神明编号
 * 查跳表 `ref_0040ea9b`（VA 0x0040ea9b，**15** 项）调 12 个函数，
 * 每个函数干的事完全同形（以第 1 尊 `fcn_0040ec14` 为例）：
 *
 * ```asm
 * 0040ec14  cmp byte [0x497159], 0        ; ★ RICH4.CFG+1 = 「動畫過程」
 * 0040ec1b  je  short 0x40ec5e            ;    关掉 → **整段不播**
 * 0040ec21  push 0x21c / push Data.mkf / call 0x450441     ; read_mkf
 * 0040ec3c  push 0x66                     ; arg5 = 音效号（Effect.mkf）102
 * 0040ec3e  push 1                        ; arg4 = flags
 * 0040ec40  push 0x28                     ; arg3 = y = 40
 * 0040ec42  push 0                       ; arg2 = x = 0
 * 0040ec44  call 0x45144f                 ; fcn_0045144f（阻塞播放）
 * ```
 *
 * ## 编号 → 资源 / 音效（跳表逐项 dump）
 *
 * | 编号 | 函数 | 资源 | 音效 | 影片 |
 * |---|---|---|---|---|
 * | 1..10 | `fcn_0040ec14` … `fcn_0040f258` | `0x21c`..`0x225` | 102..111 | ✓ |
 * | 11 | `fcn_0040ece6` | — | — | ✗ |
 * | 12 | `fcn_0040f2a0` | `0x226` | 112 | ✓ |
 * | 13 / 14 | `fcn_0040ece6` | — | — | ✗ |
 * | 15 | `fcn_0040f2eb` | `0x227` | 113 | ✓ |
 *
 * 即**资源 = 0x21b + 名次**、**音效 = 101 + 名次**（名次 = 该行在「有影片那 12 行」
 * 里的序号 1..12）。进门还有一道闸 `fcn_0040ea62`：
 *
 * ```asm
 * 0040ea6f  dec ecx                       ; 编号 − 1 = 物件下标
 * 0040ea83  mov al, byte [objects_info + 下标*24]   ; = 神明种类
 * 0040ea8d  cmp eax, 0xc / jg  …           ; > 12
 * 0040ea92  cmp eax, 0xb / jne → 放行       ; ≠ 11
 * 0040ea8d  cmp eax, 0xf / jne → 不放行      ; = 15 才放行
 * ```
 * ⇒ **放行集合 = {1..10, 12, 15}**，恰好就是「有影片那 12 行」。
 * （`@rich4/core` 的 `OBJECT_TYPE_TABLE` 里下标 0..13 的类型就是下标 + 1，
 *  所以这里「编号」= `player.godInfo` = `objects[godInfo−1].type` —— 三者在
 *  神明这一段上是同一个数。13/14 是禮物/寶箱、11 是惡犬，本来就不附身，故无影片。）
 *
 * 12 段影片全是 440×440 @ (0, 40)，与建屋/住院/入獄那几段共用 `fcn_0045144f`，
 * 播放规则见 `board-film.ts`。`flags = 1` ⇒ **bit1 = 0 ⇒ 点不掉**。
 */

import { boardFilmSkippable, type BoardFilmSpec } from './board-film.ts';

/** 12 段影片都在 Data.mkf @source 各函数的 `push [_rich4_data_mkf]` */
export const GOD_FX_ARCHIVE = 'Data.mkf';

/** 影片落点 —— **屏幕** `(0, 0x28)` = 棋盘左上角 @source 各函数 `push 0x28 / push 0` */
export const GOD_FX_X = 0;
export const GOD_FX_Y = 0x28;

/** 尺寸 = 整块棋盘 440×440（12 段都一样，逐段核过资源头 `+8/+0xa`）*/
export const GOD_FX_W = 440;
export const GOD_FX_H = 440;

/** 12 段影片的帧数（按名次 1..12，逐段读资源头 `+0x06`）*/
export const GOD_FX_FRAMES: readonly number[] = [21, 21, 21, 35, 28, 30, 14, 19, 16, 12, 23, 15];
/**
 * 每帧毫秒（按名次 1..12，逐段读资源头 `+0x10`）。
 *
 * ⚠️ **不是同一个值**：名次 3（`0x21e`）是 **128**、名次 11（`0x226`）是 **71**，
 *   其余 10 段都是 100 —— 用统一常量会把这 2 段播快/播慢（共 0.7 s 的差）。
 */
export const GOD_FX_FRAME_MS: readonly number[] = [100, 100, 128, 100, 100, 100, 100, 100, 100, 100, 71, 100];

/** 有影片的神明编号（放行集合 {1..10, 12, 15}，按跳表顺序）*/
export const GOD_FX_IDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];

/**
 * 编号 → 名次（1..12）；没有影片的编号返回 `null`。
 *
 * @source 跳表 `ref_0040ea9b` 的 15 项：第 11/13/14 项指向 `fcn_0040ece6`（空壳），
 *   其余 12 项各对应一段影片。
 */
export function godFilmRank(id: number): number | null {
  const at = GOD_FX_IDS.indexOf(id);
  return at < 0 ? null : at + 1;
}

/** 编号 → 资源号；没有影片返回 `null` */
export function godFilmResource(id: number): number | null {
  const rank = godFilmRank(id);
  return rank === null ? null : 0x21b + rank;
}

/**
 * 每段影片的音效号（按名次 1..12，逐个 dump 自各函数的 `push`）。
 *
 * ⚠️ **名次 10 与 11 是反的**：`0x225`（`fcn_0040f258`）放 **112（0x70）**、
 *   `0x226`（`fcn_0040f2a0`）放 **111（0x6f）** —— 不是 `101 + 名次`。
 *   原版跳表里这两尊的先后如此，照抄。
 */
export const GOD_FX_SOUNDS: readonly number[] = [102, 103, 104, 105, 106, 107, 108, 109, 110, 112, 111, 113];

/** 编号 → 音效号；没有影片返回 `null` */
export function godFilmSound(id: number): number | null {
  const rank = godFilmRank(id);
  return rank === null ? null : (GOD_FX_SOUNDS[rank - 1] ?? null);
}

/** 编号 → 影片规格；没有影片返回 `null` */
export function godFilmSpec(id: number): BoardFilmSpec | null {
  const rank = godFilmRank(id);
  if (rank === null) return null;
  return {
    id: `god-${id}`,
    archive: GOD_FX_ARCHIVE,
    resource: godFilmResource(id)!,
    frames: GOD_FX_FRAMES[rank - 1] ?? 0,
    width: GOD_FX_W,
    height: GOD_FX_H,
    frameMs: GOD_FX_FRAME_MS[rank - 1] ?? 100,
    x: GOD_FX_X,
    y: GOD_FX_Y,
    sound: godFilmSound(id)!,
    flags: 1,
  };
}

/** 这一段能不能点掉 —— `flags = 1` ⇒ bit1 = 0 ⇒ **原版也点不掉** */
export function godFilmSkippable(id: number): boolean {
  const spec = godFilmSpec(id);
  return spec !== null && boardFilmSkippable(spec);
}

/**
 * 这一次状态变化要不要播、播哪一段。
 *
 * 判据：**神明刚附身到某人身上** —— `player.godInfo` 由「别的值」变成一个新的
 * 非 0 值（`godInfo` 存的是**物件下标 + 1**，真正的种类在 `objects[godInfo−1].type`；
 * 神明这一段上两者相等，见文件头）。
 *
 * ⚠️ 换神（旧神被送走、新神附身）也会触发 —— 原版 `_rich4_attach_god` 每次都播。
 *
 * @param before / after 同一拍的前后状态（只读 `players` 与 `objects`）
 */
export function godFxTrigger(
  before: {
    players: readonly { godInfo: number }[];
    objects: readonly { type: number }[];
  },
  after: {
    players: readonly { godInfo: number }[];
    objects: readonly { type: number }[];
  },
): number | null {
  for (let i = 0; i < after.players.length; i++) {
    const a = after.players[i];
    const b = before.players[i];
    if (a === undefined || b === undefined) continue;
    if (a.godInfo === 0 || a.godInfo === b.godInfo) continue;
    // `godInfo` = 物件下标 + 1；种类在物件表里（神明这一段两者相等）
    const id = after.objects[a.godInfo - 1]?.type ?? a.godInfo;
    if (godFilmSpec(id) !== null) return id;
  }
  return null;
}
