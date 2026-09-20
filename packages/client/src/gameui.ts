/*
 * 棋盘上的原生控件 —— 訊息框、YES/NO、GO 鈕、骰子
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一屏的图与坐标**全部**来自 exe 与原版素材，不是照截图排的。
 *   顺带又一次确认了 640×480 定屏：
 *
 * | 常量 | 出处 |
 * |---|---|
 * | 訊息框畫在 (220, 140) | VA 0x004191da `[0x48bdb8] = 0xdc − skin.anchorX` |
 * | YES/NO 居中於 (220, 320) | VA 0x00453a69 `x0 = arg − w/2`，调用方 0x00440c7e `push 0x140 / push 0xdc` |
 * | 對話框開在 (0,40)-(440,480) | VA 0x00440bc9 `rect = {0, 0x28, 0x1b8, 0x1e0}` |
 * | GO 鈕可拖动，夹在 640×480 内 | VA 0x00418ac0 `0x280 − w` / 0x00418ae9 `0x1e0 − h` |
 *
 * ★ GO 鈕的**位置**（可拖）不在这里 —— 见 `go-button.ts`（含 Q-UI-6 的取证）。
 */

import type { Sprite } from './assets.ts';
import { LAYOUT } from './stage.ts';

/** 同步取图；未就绪返回 null（宿主会在解码后补一帧） */
export type SpriteFn = (
  archive: 'Data.mkf' | 'Panel.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  訊息框（Data.mkf 资源 517）
// ============================================================

/**
 * 對話框皮肤。
 * @source VA 0x0040807b `[0x48bad8] = load(Data.mkf, 0x205, 0, 0)`
 */
export const DIALOG_SKIN_RESOURCE = 0x205;
/**
 * 訊息框用的是**图 5**（249×170 的金框），不是图 0。
 *
 * @source 画的是 `[0x48bad8] + 0x48`（VA 0x00440c1c）。精灵集从 `+0x0c` 起
 * 每张图 12 字节头，`(0x48 − 0x0c) / 12 = 5`。初始化那段直接印证了这个下标：
 * ```asm
 * 004191df  movsx edx, word [eax + 0x4c]   ; = 图5.anchorX
 * 004191e3  ebx = 0xdc − edx               ; x0 = 220 − anchorX
 * 004191f0  movsx edx, word [eax + 0x4e]   ; = 图5.anchorY
 * 004191f4  ebx = 0x8c − edx               ; y0 = 140 − anchorY
 * 00419201  movsx ebx, word [eax + 0x48]   ; = 图5.width
 * 00419213  movsx edx, word [eax + 0x4a]   ; = 图5.height
 * ```
 * 素材那边也对得上：资源 517 图 5 是 249×170、锚点 (123,101)，
 * 于是框占 (97,39)-(346,209) —— 正好压在棋盘那一栏的上半部。
 */
export const DIALOG_SKIN_IMAGE = 5;
/** 訊息框的锚点落在屏幕的这一点 @source 上面那段的 0xdc / 0x8c */
export const DIALOG_ANCHOR_SCREEN = { x: 0xdc, y: 0x8c } as const;

// ============================================================
//  YES / NO（Data.mkf 资源 440）
// ============================================================

/**
 * @source VA 0x00453a50 `push 0x1b8 / push [0x48a0e4] / call 0x450441`
 *   —— `[0x48a0e4]` 是 Data.mkf（VA 0x00401726 处 `open('data.mkf')`）。
 */
export const YESNO_RESOURCE = 0x1b8;
/**
 * 图 0 两边都暗；图 1 YES 那半亮；图 2 NO 那半亮。
 * ⚠️ 这三张的**含义是目视分的**（左半写 YES、右半写 NO，哪半发亮一看就知道），
 *   不是从代码里读到的。
 */
export const YESNO_IMAGE = { none: 0, yes: 1, no: 2 } as const;
/**
 * 整块 96×48 居中于屏幕这一点。
 * @source 0x00440c7e 把 (0xdc, 0x140) 传进 0x00453a32，后者
 * `x0 = arg − w/2`、`y0 = arg − h/2`（VA 0x00453a69）。
 */
export const YESNO_CENTER_SCREEN = { x: 0xdc, y: 0x140 } as const;
export const YESNO_SIZE = { w: 96, h: 48 } as const;

/** YES / NO 各占左右半块 */
export function yesNoHalves(): { yes: Rect; no: Rect } {
  const x0 = YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2;
  const y0 = YESNO_CENTER_SCREEN.y - YESNO_SIZE.h / 2;
  const half = YESNO_SIZE.w / 2;
  return {
    yes: { x: x0, y: y0, w: half, h: YESNO_SIZE.h },
    no: { x: x0 + half, y: y0, w: half, h: YESNO_SIZE.h },
  };
}

// ============================================================
//  GO 鈕与骰子数切换（Panel.mkf 资源 7）
// ============================================================

/**
 * @source VA 0x0041914a `push 7 / push [0x48a05c] / call 0x450441 → [0x48be04]`
 *   —— `[0x48a05c]` 是 Panel.mkf（VA 0x00401745 处 `open('panel.mkf')`）。
 */
export const GO_RESOURCE = 7;
/**
 * 图 0/1 = GO 暗/亮，2/3 = 禁止通行，4/5 = 烏龜（乌龟卡期间）。
 * ⚠️ 这三对是**目视分的**；代码里只见到「基址 `[0x48bdd4]` + 帧」这种取法
 *   （VA 0x004172b3），那个基址在哪儿改没跟到。记作 Q-UI-4。
 */
export const GO_IMAGE = {
  idle: 0,
  hot: 1,
  blocked: 2,
  blockedHot: 3,
  tortoise: 4,
  tortoiseHot: 5,
} as const;
/** 骰子数切换钮：三对（1/2/3 颗），每对 (暗, 亮) */
export const DICE_TOGGLE_IMAGE: readonly (readonly [number, number])[] = [
  [6, 7],
  [8, 9],
  [10, 11],
];

/**
 * 骰子数切换钮的**纵向排布**，**按交通方式分三支**（W-65）。
 *
 * 原版 @source `0x004172fb jmp [eax*4 + 0x417181]`（`eax = traffic & 3`，
 * 表 = `[0x417302, 0x417353, 0x417401, 0x417302]`）：
 *
 * | `traffic & 3` | 颗数 | 第 i 颗的 y（相对 GO 左上角）| @source |
 * |---|---|---|---|
 * | 0 步行 / 3 | 1 | `0x1a`（26）| `0x00417309 add eax, 0x1a` |
 * | 1 機車 | 2 | `0x10 + 19 × i`（16 / 35）| `0x0041737e..0x00417390`（`i*20 − i` 再 `+0x10`）|
 * | 2 汽車 | 3 | `9 + 16 × i`（9 / 25 / 41）| `0x0041742c mov eax,ebx / shl eax,4 / … / 0x00417437 add eax, 9` |
 *
 * ⚠️ 先前这里只有一套 `{ dx: 7, dy: 0x1a, pitch: 19 }` —— 把**单颗**那一支的 `dy`
 *   与**機車**那一支的步距混成了一套，于是開汽車时三颗按 26/45/64 排、第三颗
 *   （底边 79）冲出 GO 鈕（高 67）。**逐支照抄**，不要合成一条公式。
 */
export const DICE_TOGGLE_LAYOUT: readonly { dy: number; pitch: number }[] = [
  { dy: 0x1a, pitch: 0 }, // 0 步行：1 颗
  { dy: 0x10, pitch: 19 }, // 1 機車：2 颗（16 / 35）
  { dy: 9, pitch: 16 }, // 2 汽車：3 颗（9 / 25 / 41）
  { dy: 0x1a, pitch: 0 }, // 3：与 0 同一支（跳表第 4 项指回 0x417302）
];

/** 切换钮的横向：**亮**的那张贴 `GO.x + 7`、**暗**的那张贴 `GO.x + 8`（三支相同）
 *  @source `0x00417320 add eax,7` / `0x00417345 add eax,8` */
export const DICE_TOGGLE_X = { lit: 7, dim: 8 } as const;
export const DICE_TOGGLE_SIZE = { w: 15, h: 15 } as const;

/**
 * ★ GO 鈕的尺寸与默认位置**搬到了 `go-button.ts`**（那里是位置的真值来源，
 *   拖动也归它管）。这里重新导出一次，免得别处要 import 两个模块。
 */
export { GO_BOUNDS, GO_DEFAULT, GO_SIZE } from './go-button.ts';

// ============================================================
//  骰子（Panel.mkf 资源 3）
// ============================================================

/** @source VA 0x00419130 `push 3 / … → [0x48be14]` */
export const DICE_RESOURCE = 3;
/**
 * 点数图有几个「颗位」—— 资源 3 共 18 张 = 3 颗 × 6 面。
 * 每颗的尺寸与锚点都不同（35×41 / 30×36 / 34×40），见 Q-TURN-1 §4。
 */
export const DICE_SLOTS = 3;
/**
 * 滚骰影片的资源号基值 —— 骰子颗数 n（1/2/3）对应资源 `DICE_FLIC_BASE + n`。
 * @source VA 0x00419192 的加载循环 `[0x48bdf8 + i*4] = read_mkf(panel, i + 4)`
 *   与 `fcn_00419572` 的 `[0x48bdf4 + n*4]`。
 */
export const DICE_FLIC_BASE = 3;
/**
 * 第 `slot` 颗骰子、点数 `pips` 用哪张图。
 * @source VA 0x0041965e：`eax = slot*6 + pips − 1`
 * （`shl 2 / sub / add eax,eax` 就是 ×6），资源 3 共 18 张 = 3 颗 × 6 面。
 */
export function diceImage(slot: number, pips: number): number {
  return slot * 6 + Math.max(1, Math.min(6, pips)) - 1;
}

// ============================================================
//  屏幕坐标 → 棋盘区坐标
// ============================================================

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 上面那些常量都是**屏幕**坐标；棋盘画布的原点在 (0,40)，画之前要减掉 */
export function toBoard(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x - LAYOUT.board.x, y: p.y - LAYOUT.board.y };
}

export function boardRect(r: Rect): Rect {
  return { ...r, x: r.x - LAYOUT.board.x, y: r.y - LAYOUT.board.y };
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
