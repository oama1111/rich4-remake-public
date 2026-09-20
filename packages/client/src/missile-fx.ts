/*
 * 「飛彈 / 核子飛彈爆炸」那两段影片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「什么道具该播哪一段、规格是什么」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history**。
 *
 * 起因：W-54 接「`view_to` 把镜头切到爆心」时发现的 —— 原版在 `view_to` 之后
 * **确实还播一段 FLIC**，而复刻一段都没接（飛彈只看到镜头移过去、棋盘上什么都不炸）。
 *
 * ## 两个分支（**都在同一个跳表里**，工具号见下）
 *
 * 工具函数表 @ VA `0x00475df1`（4 字节一项，项号 = `工具号 − 7`；`機器工人`（9）
 * 在项 2 = `0x00447295` 可对照）：
 *
 * | 项 | 工具号 | 函数 | 这一段做什么 |
 * |---|---|---|---|
 * | 0 | **7 飛彈** | `0x00446fbc` | `missile` 那一支 |
 * | 6 | **13 核彈** | `0x00447ace` | 全图那一支 |
 *
 * ```asm
 * ; ── 飛彈 @0x00446fbc（`disasm.py va 0x446fbc 70`）
 * 00446fe3  call 0x44ef41                 ; 出招台词（工具台词表 0x480d…，arg2 = 0）
 * 00447043  push 0x210                    ; ★ read_mkf(Data.mkf, 0x210)
 * 0044704f  call 0x450441
 * 00447065  call 0x41d476                 ; view_to(目标格屏幕坐标, flags = 0) ⇒ **镜头移过去**
 * 00447076  push 0x26 / push 0x64         ; damage_area(flags = 0x26, 半径 = 0x64)
 * 0044707a  call 0x40ac7b                 ; ★ 效果本体：**在播片之前**
 * 00447082  push 0x51                     ; arg5 = 音效号（Effect.mkf 81）
 * 00447084  push 0x90001                  ; arg4 = flags
 * 00447089  push 0x28 / push 0            ; arg3 = y = 40、arg2 = x = 0（= 棋盘左上角）
 * 0044708e  call 0x45144f                 ; fcn_0045144f（阻塞播放）
 *
 * ; ── 核彈 @0x00447ace（`disasm.py va 0x447ace 100`）
 * 00447af5  call 0x44ef41                 ; 出招台词
 * 00447b04  cmp byte [eax + 0x496b7d], 1  ; ★ 只有**真人**（who_plays == 1）才开目标选择窗
 * 00447b12  call 0x446ae8                 ;   模态选格（0x400c0）
 * 00447b55  push 0x212                    ; ★ read_mkf(Data.mkf, 0x212)
 * 00447b61  call 0x450441
 * 00447b77  call 0x41d476                 ; view_to(目标格, flags = 0)
 * 00447b88  push 0x26 / push -1           ; damage_area(flags = 0x26, 半径 = **-1** = 全图)
 * 00447b8c  call 0x40ac7b
 * 00447b94  push 0x53                     ; arg5 = 音效号（Effect.mkf 83）
 * 00447b96  push 0x80090001               ; arg4 = flags
 * 00447b9b  push 0x28 / push 0            ; 屏幕 (0, 40)
 * 00447ba0  call 0x45144f
 * ```
 *
 * ⚠️ 两支都**没有** `cmp byte [0x497159], 0`（「動畫過程」那道闸）—— 与惡犬那一支同一条
 *   规矩：原版不管开关都播（`disasm.py va 0x446fbc 120` / `va 0x447ace 100` 里 grep
 *   `0x497159` 零命中），故本模块的宿主接线**不加** `options.animation`。
 *
 * ## 影片规格（逐字节读 `Data.mkf` 的资源头，`parseFlicInfo` 同一算法）
 *
 * | 资源 | 帧数 | 宽×高 | 每帧 | 总长 | 音效 | flags | 嵌入源路径 |
 * |---|---|---|---|---|---|---|---|
 * | `0x210` 飛彈 | **19** | 440×440 | **114 ms** | **2166 ms** | `0x51` = 81 | `0x90001` | `D:\RICH4\BOOT\MISSLE-n.FLC` |
 * | `0x212` 核彈 | **26** | 440×440 | **114 ms** | **2964 ms** | `0x53` = 83 | `0x80090001` | `D:\RICH4\FLCS\NUCLEAR.FLC` |
 *
 * 落点 **(0, 0x28)** = 屏幕 (0,40) = **棋盘左上角**（与住院/入獄/神明那几段同类：
 * 整幅 440×440 盖住棋盘），**不是**逐格坐标 —— 镜头由 `view_to` 移过去，
 * 影片本身固定在画面里。
 *
 * ★ `flags` 的 bit1 = 0 ⇒ 这 2.2 / 3.0 秒**点不掉**（同 `dog-fx.ts` / `devil-fx.ts`）。
 */

import type { BoardFilmSpec } from './board-film.ts';

/** 飛彈 @source 工具号（`rules/tools.ts` 的 `TOOL_MISSILE`）*/
export const MISSILE_TOOL_ID = 7;
/** 核子飛彈 @source 工具号（`rules/tools.ts` 的 `TOOL_NUKE`）*/
export const NUKE_TOOL_ID = 13;

/** 这一段在 Data.mkf @source VA 0x0044704e `[0x48a0e4]`（与其它影片同一个档案句柄）*/
export const MISSILE_FX_ARCHIVE = 'Data.mkf';

/** 飛彈影片资源号 @source VA 0x00447043 `push 0x210` */
export const MISSILE_FX_RESOURCE = 0x210;
/** 核彈影片资源号 @source VA 0x00447b55 `push 0x212` */
export const NUKE_FX_RESOURCE = 0x212;

/** 飛彈：19 帧 @source `Data.mkf` 0x210 资源头 `+0x06` */
export const MISSILE_FRAMES = 19;
/** 核彈：26 帧 @source `Data.mkf` 0x212 资源头 `+0x06` */
export const NUKE_FRAMES = 26;
/** 两段都是每帧 114 ms @source 资源头 `+0x10`（`[0x48c870]`，VA 0x00450d72）*/
export const MISSILE_FRAME_MS = 114;

/** 两段都是 440×440 @source 资源头 `+0x08` / `+0x0a` */
export const MISSILE_FX_W = 440;
export const MISSILE_FX_H = 440;

/** 飛彈音效 @source VA 0x00447082 `push 0x51`（= `Effect.mkf` 81）*/
export const MISSILE_FX_SOUND = 0x51;
/** 核彈音效 @source VA 0x00447b94 `push 0x53`（= `Effect.mkf` 83）*/
export const NUKE_FX_SOUND = 0x53;

/** 飛彈 flags @source VA 0x00447084 `push 0x90001` */
export const MISSILE_FX_FLAGS = 0x90001;
/** 核彈 flags @source VA 0x00447b96 `push 0x80090001` */
export const NUKE_FX_FLAGS = 0x80090001;

/**
 * 落点 —— **屏幕 (0, 0x28)**，整幅盖住棋盘。
 *
 * @source 两支的 `push 0x28 / push 0`（VA 0x00447089 / 0x00447b9b）——
 *   与住院/入獄/神明那几段同一个落点，**不是**逐格坐标（对比 `devil-fx.ts` 的 110×110）。
 */
export const MISSILE_FX_X = 0;
export const MISSILE_FX_Y = 0x28;

function base(resource: number, frames: number, sound: number, flags: number): BoardFilmSpec {
  return {
    id: `missile:0x${resource.toString(16)}`,
    archive: MISSILE_FX_ARCHIVE,
    resource,
    frames,
    width: MISSILE_FX_W,
    height: MISSILE_FX_H,
    frameMs: MISSILE_FRAME_MS,
    x: MISSILE_FX_X,
    y: MISSILE_FX_Y,
    sound,
    flags,
  };
}

/** 飛彈那一支的影片规格（19 帧 × 114 ms = 2166 ms，音效 81，落 (0,40)）*/
export const MISSILE_EXPLOSION_FILM: BoardFilmSpec = base(
  MISSILE_FX_RESOURCE,
  MISSILE_FRAMES,
  MISSILE_FX_SOUND,
  MISSILE_FX_FLAGS,
);

/** 核彈那一支的影片规格（26 帧 × 114 ms = 2964 ms，音效 83，落 (0,40)）*/
export const NUKE_EXPLOSION_FILM: BoardFilmSpec = base(
  NUKE_FX_RESOURCE,
  NUKE_FRAMES,
  NUKE_FX_SOUND,
  NUKE_FX_FLAGS,
);

/**
 * 这个道具号该播哪一段影片；不是飛彈/核彈就返回 `null`。
 *
 * ★ 判据就是**道具号**本身（原版两支各自是一整个函数，`view_to` 与影片都写死在
 *   自己那一段里）；不需要看「炸到了什么」—— 核彈半径 -1 打全图也照样是这一段片。
 */
export function missileFilmFor(toolId: number): BoardFilmSpec | null {
  if (toolId === MISSILE_TOOL_ID) return MISSILE_EXPLOSION_FILM;
  if (toolId === NUKE_TOOL_ID) return NUKE_EXPLOSION_FILM;
  return null;
}

/** 这一段影片总共播多久（毫秒）：飛彈 19×114 = **2166**、核彈 26×114 = **2964** */
export function missileTotalMs(toolId: number): number | null {
  const spec = missileFilmFor(toolId);
  return spec === null ? null : spec.frames * spec.frameMs;
}
