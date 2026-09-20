/*
 * 「惡魔顯靈拆屋」那一段影片 —— 全部照 exe（W-55 行 4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「这一拍要不要播、规格是什么、此刻画第几帧」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history**。
 *
 * 起因（第五份试玩回报）：惡魔顯靈把房子拆掉那一下，客户端**一段影片都没播**。
 * 复核 `rich4.exe`：惡魔那一支（`fcn_0040f381` 的 `0x0040f521`，`god_info == 10`）
 * 在拆完之后确实又播了一段 FLIC，本引擎一段都没接：
 *
 * ```asm
 * ; ── 惡魔那一支的尾段（VA 0x0040f5d0 起，全在 `fcn_0040f381` 内）
 * 0040f5d0  cmp  dword [esp+0x88], 0        ; 本函数的局部「拆成功了吗」标记
 * 0040f5d8  je   0x40f8b3                   ; 没拆 → 整段返回
 * 0040f5de  push 0                          ; arg4 = 0
 * 0040f5e0  imul eax, [0x49910c], 0x68
 * 0040f5e7  xor  edx, edx / mov dx, word [eax + 0x496b72]   ; 玩家 y（屏幕）
 * 0040f5f0  push edx
 * 0040f5f1  mov  ax, word [eax + 0x496b70]                  ; 玩家 x（屏幕）
 * 0040f5fd  push eax
 * 0040f5fe  call 0x41d476                   ; view_to(玩家) —— 对准行动者
 * 0040f606  push 0x5dc / push 0x4634d7 / call 0x440cac      ; 訊息框「惡魔顯靈…」
 * 0040f618  push 0 / push esi / call 0x40ab4a               ; 拆一级
 * 0040f623  push 0                          ; arg5 = 0（0x40b066 的可选出参）
 * 0040f625  lea  eax, [esp+0x88] / push eax                 ; &y
 * 0040f62d  lea  eax, [esp+0x88] / push eax                 ; &x
 * 0040f635  push esi / call 0x40b066        ; ★ 目标格的**屏幕坐标**（见下）
 * 0040f642  push 0x20e                      ; ★ read_mkf(Data.mkf, 0x20e)
 * 0040f647  mov  eax, [0x48a0e4] / push eax
 * 0040f64d  call 0x450441
 * 0040f657  push 0x5f                       ; arg5 = 音效号（Effect.mkf 95）
 * 0040f659  push 0x30001                    ; arg4 = flags
 * 0040f65e  mov  eax, [esp+0x8c] / sub eax, 0x37 / push eax ; arg3 = y = 格.y − 55
 * 0040f669  mov  eax, [esp+0x8c] / sub eax, 0x37 / push eax ; arg2 = x = 格.x − 55
 * 0040f674  push ebx / call 0x45144f        ; fcn_0045144f（阻塞播放）
 * 0040f67d  push ebx / call 0x456e11        ; libc_free
 * ```
 *
 * ## 为什么落点是「目标格屏幕坐标 − 0x37」
 *
 * `0x40b066(实体编码, &x, &y)` 去表 `0x48a850`（每项 12 字节：`+0` 实体编码、
 * `+4` word x、`+6` word y）里查那个实体的**屏幕坐标**。
 * 而这一段影片是 `Data.mkf` **0x20e**，逐字节核过资源头：**110×110**（见下），
 * `0x37` = **55** = 110 的一半 ⇒ 原版就是把这段 110×110 的爆破解成**居中盖在那一格**上。
 * （与神明/住院那 12 段 440×440 的「整块棋盘 @(0,40x28)」**不是一类**。）
 *
 * ## 影片规格（逐字节核过 `Data.mkf` 0x20e 的 FLIC 头）
 *
 * | 项 | 值 | @source |
 * |---|---|---|
 * | 帧数 | **8** | 资源头 `+0x06`（`parseFlicInfo`） |
 * | 宽×高 | **110×110** | 资源头 `+0x08` / `+0x0a` |
 * | 每帧毫秒 | **114** | 资源头 `+0x10`（`[0x48c870]`，VA 0x00450d72） |
 * | 嵌入源路径 | `D:\RICH4\FLCS\BOMB2.FLC` | 资源头后 0x80..0x1200 的 ASCII |
 *
 * ⇒ 总长 = 8 × 114 = **912 ms**，不循环、不重复。
 * `flags = 0x30001` 的 **bit1 = 0** ⇒ 原版这 0.912 秒**点不掉**（同 `dog-fx.ts`）。
 *
 * ⚠️ **接线已补上**（收尾时做的，`main.ts` 的 `startDevilFx`，在 `startActionFx` 里
 *   排在神明附身影片之后）。当时 W-55 的交办范围只到「模块 + 纯触发器 + 测试」，
 *   而落点是**逐格**的（`BoardFilmSpec.x/y` 是起播时定死的静态值），
 *   所以宿主在起播那一刻用 `worldToScreen` 现算：
 *
 * ```ts
 * if (devilDemolishFxTrigger(before, after)) {
 *   const me = after.players[after.currentPlayer];
 *   const node = map.nodes[me.nodeId - 1];
 *   const p = worldToScreen(node.x, node.y, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h });
 *   if (p === null) return;
 *   deferredBoardBefore = after;   // ★ 拆完才播 ⇒ 棋盘按 after 画（与其它几段相反）
 *   startBoardFilm(devilDemolishFilmAt(p.x + LAYOUT.board.x, p.y + LAYOUT.board.y));
 * }
 * ```
 * ⚠️ `worldToScreen` 给的是**棋盘局部**坐标，而 `BoardFilmSpec` 用的是原版的
 *   **屏幕**坐标（`currentBoardFilmFrame` 起播时会再减 `LAYOUT.board.y`）——
 *   所以要在这里加回棋盘原点。`devil-fx.test.ts` 有一条源码钉把这套接线钉住。
 */

import type { BoardFilmSpec } from './board-film.ts';

/** 这一段在 Data.mkf @source VA 0x0040f647 `[0x48a0e4]` */
export const DEVIL_FX_ARCHIVE = 'Data.mkf';

/** 影片资源号 @source VA 0x0040f642 `push 0x20e` */
export const DEVIL_FX_RESOURCE = 0x20e;

/** 尺寸 = 110×110 @source Data.mkf 0x20e 资源头 `+0x08` / `+0x0a`（= `BOMB2.FLC`）*/
export const DEVIL_FX_W = 110;
export const DEVIL_FX_H = 110;

/**
 * 落点偏移 —— 原版两个 `sub eax, 0x37` @source VA 0x0040f665 / 0x0040f670。
 *
 * `0x37` = **55** = `DEVIL_FX_W / 2` = `DEVIL_FX_H / 2` ⇒ 影片**居中**在目标格上。
 * ★ 这条关系本身就是取证：照着 `0x37` 写 55 是抄立即数，写成「半个宽」是同一个数
 *   且改尺寸时会跟着对（`devil-fx.test.ts` 把两者钉成相等）。
 */
export const DEVIL_FX_HALF = 0x37;

/**
 * 帧数 @source Data.mkf 0x20e 资源头 `+0x06`（`disasm.py dump`/`parseFlicInfo` 同一算法）。
 *
 * ★ **不许 hand-wave**：`devil-fx.test.ts` 有一条用例拿 `parseFlicInfo` 读真资源头，
 *   与这两个常量逐项比 —— 改错一位就红。
 */
export const DEVIL_DEMOLISH_FRAMES = 8;
/** 每帧毫秒 @source 同一个资源头 `+0x10` */
export const DEVIL_DEMOLISH_FRAME_MS = 114;

/** 随影片一起响的音效号（`Effect.mkf` 0x5f = 95）@source VA 0x0040f657 `push 0x5f` */
export const DEVIL_FX_SOUND = 0x5f;
/** @source VA 0x0040f659 `push 0x30001`（bit1 = 0 ⇒ 点不掉）*/
export const DEVIL_FX_FLAGS = 0x30001;

/**
 * 「惡魔顯靈拆屋」那一段的规格。
 *
 * ⚠️ `x`/`y` 是**占位 0** —— 真正的落点是**目标格**的屏幕坐标减 55，
 *   由 `devilDemolishFilmAt()` 现算（原版也是每次落地现查 `0x40b066`）。
 */
export const DEVIL_DEMOLISH_FILM: BoardFilmSpec = {
  id: 'devil-demolish',
  archive: DEVIL_FX_ARCHIVE,
  resource: DEVIL_FX_RESOURCE,
  frames: DEVIL_DEMOLISH_FRAMES,
  width: DEVIL_FX_W,
  height: DEVIL_FX_H,
  frameMs: DEVIL_DEMOLISH_FRAME_MS,
  x: 0,
  y: 0,
  sound: DEVIL_FX_SOUND,
  flags: DEVIL_FX_FLAGS,
};

/**
 * 把落点挪到目标格 —— 原版 `fcn_0045144f(影片, 格.x − 0x37, 格.y − 0x37, …)`。
 *
 * @param x / y 目标格（那处被拆的房）在**屏幕**上的坐标；
 *   宿主拿 `worldToScreen(node.x, node.y, camera, viewport)` 现算（与 `0x40b066` 同义）。
 */
export function devilDemolishFilmAt(x: number, y: number): BoardFilmSpec {
  return { ...DEVIL_DEMOLISH_FILM, x: x - DEVIL_FX_HALF, y: y - DEVIL_FX_HALF };
}

/** 这一段影片总共播多久（毫秒）= 8 × 114 = **912** */
export function devilDemolishTotalMs(): number {
  return DEVIL_DEMOLISH_FRAMES * DEVIL_DEMOLISH_FRAME_MS;
}

/**
 * 这一拍要不要播惡魔拆屋片 —— 判据 = **`notices` 里新出现 `god.demolish`**。
 *
 * ★ 为什么用訊息框当判据而不是看 `landLevel/facilityLevel` 变没变：
 *   原版这一段的**唯一入口**是 `fcn_0040f381` 惡魔那一支，而那一支在真拆成功之后
 *   **一定**弹一扇 `0x4634d7`（= core 的 `god.demolish`，VA 0x0040f606）**才**播影片
 *   （0x0040f642 在 0x0040f610 之后）。core 的 `appendNotice` 只在真拆成功时追加
 *   （`level === 0` 那一支 `0x0040f538 je` 直接返回），且每次都是**新数组** ⇒
 *   引用变了 = 本 action 弹的。
 *
 * ★ 用**计数**而不是只看引用：`notices` 会被别的框一起追加（同一条 action 里
 *   可能有第二扇），只看「数组里有没有」会把上一条 action 留下的那条也算进来。
 *
 * @param before / after 同一拍的前后状态（只读 `notices[].key`）
 */
export function devilDemolishFxTrigger(
  before: { notices: readonly { key: string }[] },
  after: { notices: readonly { key: string }[] },
): boolean {
  return countDemolish(after.notices) > countDemolish(before.notices);
}

function countDemolish(notices: readonly { key: string }[]): number {
  let n = 0;
  for (const notice of notices) if (notice.key === 'god.demolish') n += 1;
  return n;
}
