/*
 * 小地圖／大地圖上的**归属色块** —— 有主的地、設施、企業各画一块地主的专属色
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 第十三份試玩回報（「小地图还有个问题，应该是用专属色块标注地图上已经被玩家购买的土地和建筑」）。
 *
 * ## 原版：`fcn_0040a4e1(which)`（VA 0x0040a4e1）
 *
 * `which` = 0 侧栏那张 200×200、1 大地圖那张 400×400。它**不直接画屏**，而是
 * 把底图的原始副本拷回工作面、再把色块烙上去 —— 侧栏（`fcn_00416e6d` 的 0x00416ed7）
 * 与大地圖（WM_PAINT 0x0040a887）贴的都是这张工作面：
 *
 * ```asm
 * 0040a4ed  src = [0x48bad0] 图 which ; 原始副本
 * 0040a503  dst = [0x48badc] 图 which ; 工作面
 * 0040a50f  call 0x456280             ; 整张拷回（先抹掉上一次的色块）
 * ; ① 住宅地（含連鎖店）：表 [0x498e84]，步长 0x34，1..[0x498e98]
 * 0040a531  cmp byte [ebx+0x19], 0 / je 下一块        ; owner（1 基）
 * 0040a53f  x = movsx word [ebx]   × 89 >> (which ? 9 : 10)
 * 0040a559  y = movsx word [ebx+2] × 89 >> (which ? 9 : 10)
 * 0040a574  图 = (byte [ebx+0x1b] & 1) + (which ? 0x1a : 0x16)
 * ; ② 設施（商業用地）：表 [0x498e88]，步长 0x38，1..[0x498e8c]，owner 同在 +0x19
 * 0040a66c  图 = (byte [ebx+0x1b] & 1) + (which ? 0x1c : 0x18)
 * ; ③ 企業：表 [0x498e7c]，步长 0x34，1..[0x498e90]，★ owner 在 **+0x18**
 * 0040a7aa  图 = (byte [ebx+0x1b] & 1) + (which ? 0x1c : 0x18)
 * ; 三处都是：
 * 0040a5c5  ebp = (owner − 1) × 0x68
 * 0040a5cd  push [ebp + 0x496b6c]      ; ★ 地主 player+0x04 = 角色专属色
 * 0040a5d5  图集 = [0x48bad8]          ; Data.mkf 资源 517（0x205）
 * 0040a601  call 0x456384(dst, 图, x, y, 色)
 * ```
 *
 * `fcn_00456384`（VA 0x00456384）= **按锚点摆、非 0 像素一律写成那一种颜色**
 * （`sub x, [图+4] / sub y, [图+6]` 减锚点；`lodsw / or ax,ax / je 跳过 / mov [edi], bx`），
 * 即拿图当**剪影**、整块涂成地主色。图 22..29 实测（`assets-clean/Data/0517_0NN.png`）：
 *
 * | 图 | 尺寸 | 形状 | 用在 |
 * |---|---|---|---|
 * | 22 / 23 | 3×3 / 5×5 | 方 / 菱 | 侧栏·地 |
 * | 24 / 25 | 7×7 / 11×11 | 方 / 菱 | 侧栏·設施、企業 |
 * | 26 / 27 | 9×9 / 11×11 | 方 / 菱 | 大地圖·地 |
 * | 28 / 29 | 17×17 / 23×23 | 方 / 菱 | 大地圖·設施、企業 |
 *
 * `+0x1b` 是建筑朝向（0..7，见 `LandInfo.facing`）⇒ 奇数朝向（斜 45°）用菱形。
 * 坐标**不加**旋转视角（`[0x499088]`）—— 小地图底图本身也不随视角转。
 *
 * 画的顺序即烙的顺序：地 → 設施 → 企業，后画的盖前画的。
 * 何时重烙：原版在归属可能变的 20 余处各调一次（买地、拍卖、卡片、破产…，
 * `python3 tools/disasm.py callers 0x40a4e1`）；本引擎每帧按当前状态画，结果相同。
 */

import type { GameState } from '@rich4/core';
import { CHARACTERS, characterColorRgb } from '@rich4/data';
import type { Sprite } from './assets.ts';
import { markStaticSource } from './display-list.ts';

/** 色块图集 = `Data.mkf` 资源 517 @source `[0x48bad8]`（0x0040a5d5）*/
export const MINIMAP_MARK_RESOURCE = 0x205;

/** 两张图、三张表各自的图号基数（再加 `朝向 & 1`）@source 0x0040a574 / 0x0040a66c / 0x0040a7aa 一带 */
export const MINIMAP_MARK_IMAGE = {
  /** 侧栏 200×200（`which = 0`）*/
  small: { land: 0x16, facility: 0x18, commercial: 0x18 },
  /** 大地圖 400×400（`which = 1`）*/
  big: { land: 0x1a, facility: 0x1c, commercial: 0x1c },
} as const;

/**
 * 世界 → 图内坐标的右移位数：`× 89 >> 10`（侧栏）/ `× 89 >> 9`（大地圖）。
 * @source 0x0040a597 `shl ecx, 6 / sar ecx, 0x10`（侧栏）与 0x0040a553 `shl ecx, 7 / sar ecx, 0x10`（大地圖）
 *   —— 与 `hud.ts` 的 `minimapAt`、`big-map-screen.ts` 的 `bigMapAt` 是同一段定点乘法。
 */
export const MINIMAP_MARK_SHIFT = { small: 10, big: 9 } as const;

export type MinimapMarkSize = keyof typeof MINIMAP_MARK_IMAGE;

/** 一块色块（纯数据，便于单测）*/
export interface MinimapMark {
  /** `Data.mkf` 517 的图号 */
  image: number;
  /** **图内**坐标（锚点由绘制那一步减掉）*/
  x: number;
  y: number;
  /** 地主（1 基，同 `landOwner`）*/
  owner: number;
  /** 地主的专属色 `0xRRGGBB`（`player+0x04`，即角色表的 `color`）*/
  color: number;
}

/** 三张表里本模块用得到的那几个字段 */
interface Placed {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly facing?: number;
}

export interface MinimapMarkTopo {
  readonly lands?: readonly Placed[];
  readonly facilities?: readonly Placed[];
  readonly commercials?: readonly Placed[];
}

/**
 * 这一帧要烙的色块，按原版的顺序（地 → 設施 → 企業）。
 *
 * 归属一律取**运行时**的值（地图模板里恒 0）：`landOwner` / `facilityOwner` /
 * `commercialOwners[].owner`。
 */
export function minimapMarks(state: GameState, topo: MinimapMarkTopo, size: MinimapMarkSize): MinimapMark[] {
  const base = MINIMAP_MARK_IMAGE[size];
  const shift = MINIMAP_MARK_SHIFT[size];
  const out: MinimapMark[] = [];
  const push = (p: Placed, owner: number, imageBase: number): void => {
    if (owner === 0) return;
    const who = state.players[owner - 1];
    out.push({
      image: imageBase + ((p.facing ?? 0) & 1),
      x: (p.x * 89) >> shift,
      y: (p.y * 89) >> shift,
      owner,
      color: CHARACTERS[who?.character ?? -1]?.color ?? 0,
    });
  };
  for (const l of topo.lands ?? []) push(l, state.landOwner[l.id] ?? 0, base.land);
  for (const f of topo.facilities ?? []) push(f, state.facilityOwner[f.id] ?? 0, base.facility);
  for (const c of topo.commercials ?? []) push(c, state.commercialOwners[c.id]?.owner ?? 0, base.commercial);
  return out;
}

// ============================================================
//  绘制：图当剪影，整块涂成地主色（`fcn_00456384`）
// ============================================================

/** 剪影缓存：同一张位图 × 同一种颜色只涂一次（位图被淘汰重载后自然换新键）*/
const tinted = new WeakMap<ImageBitmap, Map<number, CanvasImageSource>>();

function silhouette(s: Sprite, color: number): CanvasImageSource | null {
  let byColor = tinted.get(s.bitmap);
  if (byColor === undefined) {
    byColor = new Map();
    tinted.set(s.bitmap, byColor);
  }
  const hit = byColor.get(color);
  if (hit !== undefined) return hit;
  const w = s.bitmap.width;
  const h = s.bitmap.height;
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  } else return null;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (c === null) return null;
  c.drawImage(s.bitmap, 0, 0);
  // 非 0（= 非透明）像素一律写成地主色 —— `0x004563df mov word [edi], bx`
  c.globalCompositeOperation = 'source-in';
  const [r, g, b] = characterColorRgb(color);
  c.fillStyle = `rgb(${r},${g},${b})`;
  c.fillRect(0, 0, w, h);
  // 画完就不再改 ⇒ 绘制指令去重可按身份比（`display-list.ts`）
  markStaticSource(canvas);
  byColor.set(color, canvas);
  return canvas;
}

/**
 * 把色块画到 `ctx` 上，图内原点落在 `(ox, oy)`。
 *
 * @param sprite 取 `Data.mkf` 517 图 N（**抠黑**：图里的 0 像素原版就跳过）
 */
export function drawMinimapMarks(
  ctx: CanvasRenderingContext2D,
  sprite: (image: number) => Sprite | null,
  marks: readonly MinimapMark[],
  ox: number,
  oy: number,
): void {
  for (const m of marks) {
    const s = sprite(m.image);
    if (s === null) continue;
    const img = silhouette(s, m.color);
    if (img === null) continue;
    ctx.drawImage(img, ox + m.x - s.anchorX, oy + m.y - s.anchorY);
  }
}
