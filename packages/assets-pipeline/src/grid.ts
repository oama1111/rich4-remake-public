/*
 * 整组拼图：同一资源的动画帧拼成网格送模型、切回（W-80 §4.3）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 为什么要拼：生成式超分对**每张图独立地**补细节。一个角色动作 80–150 帧，
 * 逐帧送进去，每帧补出来的纹理都不一样 —— 放起来就是一闪一闪的（W-80 §0.3）。
 * 把同一 (档案, 资源) 的帧拼进一张大图一起送，模型在同一次推理里看到全部帧，
 * 补出来的细节才会前后一致。
 *
 * ★ 这**不违反** C-AST-5（2026-09-22 已补充，见 DEVELOPMENT_PLAN §5.4）：
 *   拼的是 slice **已经切好**的 rgb/alpha 单帧，格与格之间留足隔离带（gutter），
 *   颜色跨不过去；与「整张精灵图直接放大」（帧紧挨着、互相串色）不是一回事。
 *   隔离带在 rgb 里填**平的中性灰**、在 alpha 里填 0 —— 模型在灰带里补不出
 *   任何东西，切回时也根本不取那一块。
 *
 * ★ 只在格与格**之间**留隔离带，**外圈不留**：单帧成一张的（底图、超过 --max 的
 *   大图）拼出来与原帧逐字节相同，整帧不透明的影片帧外沿也不会被灰边污染。
 *
 * ⚠️ 平灰隔离带的代价（2026-09-22 实测，sips 平滑 4× 放大 Panel#2 的 20×20 图标）：
 *   **整帧不透明**的格子，最外一圈原像素会被模型掺进灰色 —— 与单帧放大相比，
 *   外圈 4px（放大后）逐像素差约 28，内部逐字节相同。精灵不受影响（外圈本就透明）。
 *   故另给一种 `fill: 'edge'`：每格把自己的边缘像素向外延拓**半条**隔离带
 *   （与 slice 的 alpha bleed 同一个思路），外圈不再掺灰；代价是隔离距离减半
 *   （模型的渗色半径须 < 隔离带/2 而不是 < 隔离带）。默认仍是 `flat`。
 *
 * 交接链：slice → **pack** → [外部 AI，任意统一倍率 k] → **unpack** → merge → …
 *   unpack 切回的每一格落在 merge 要读的**同一个**文件名上（队列清单里的
 *   `rgb/<档案>/<资源>_f<帧>.png`），故 merge/assemble 一行不用改。
 *
 * 排布是「货架式」（shelf）：按队列顺序从左到右摆，一行摆不下换行，一张摆不下换张。
 * 行宽取 ⌈√帧数⌉ 个最宽格 —— 帧尺寸一致时（绝大多数动画）即是规整的网格。
 *
 * ⚠️ 本模块纯函数，读写图都走调用方给的回调（CLI 传 fs，测试传内存）。
 */

import type { DecodedImage } from './sprite.ts';

// ============================================================
//  布局
// ============================================================

/** 默认隔离带宽度（原图像素；放大后随之 ×k） */
export const DEFAULT_GUTTER = 8;
/** 默认单张拼图的边长上限（原图像素） */
export const DEFAULT_SHEET_MAX = 2048;
/** rgb 隔离带的填充色：平的中性灰 */
export const GUTTER_RGB: readonly [number, number, number] = [128, 128, 128];
/** alpha 隔离带的填充值：全透明 */
export const GUTTER_ALPHA = 0;

/** 一格：一帧在拼图里的位置（原图像素） */
export interface PackCell {
  /** 队列帧 id（`<档案>/<资源>_<图号>`） */
  id: string;
  /** 队列清单里的 rgb / alpha 相对路径 —— unpack 就切回到 `<upscale-done>/<这个路径>` */
  rgb: string;
  alpha: string;
  x: number;
  y: number;
  /** 帧的原尺寸 */
  width: number;
  height: number;
  /** 队列清单给这帧定的倍率（merge 按它验尺寸；unpack 据此提前警告） */
  scale: number;
}

/** 一张拼图 */
export interface PackSheet {
  /** `<档案>/<资源>-<n>` */
  name: string;
  /** 相对 pack 目录（也相对 pack-done 目录）的路径 */
  rgb: string;
  alpha: string;
  width: number;
  height: number;
  cells: PackCell[];
}

export interface PackLayout {
  version: 1;
  generatedAt: string;
  gutter: number;
  max: number;
  fill: { mode: PackFill; rgb: readonly [number, number, number]; alpha: number };
  sheets: PackSheet[];
}

/** pack 需要的帧信息（QueueFrame 的子集） */
export interface PackFrame {
  id: string;
  rgb: string;
  alpha: string;
  width: number;
  height: number;
  scale: number;
}

/**
 * 隔离带怎么填：
 *   · `flat` —— 平的中性灰 / alpha 0（默认）；隔离距离 = 整条隔离带；
 *   · `edge` —— 每格边缘像素向外延拓半条隔离带，余下（行尾、格下空白）仍填平灰；
 *               整帧不透明的格子外圈不掺灰，隔离距离减半。见模块头注释。
 */
export type PackFill = 'flat' | 'edge';

export interface PackOptions {
  gutter?: number;
  max?: number;
  fill?: PackFill;
}

/**
 * 帧 id → 分组键（`Data/0002_005` → `Data/0002`）。
 * 与 upscale 的 `resourceKeyOf` 同口径：一个资源 = 一张 sprite sheet / 一段影片。
 */
export function groupKeyOf(id: string): string {
  const m = /^(.*)_\d+$/.exec(id);
  if (m === null) throw new Error(`帧 id 不合约定（应为 <档案>/<资源>_<图号>）：${id}`);
  return m[1]!;
}

function sheetOf(group: string, n: number, cells: PackCell[]): PackSheet {
  let width = 0;
  let height = 0;
  for (const c of cells) {
    width = Math.max(width, c.x + c.width);
    height = Math.max(height, c.y + c.height);
  }
  const name = `${group}-${n}`;
  return { name, rgb: `rgb/${name}.png`, alpha: `alpha/${name}.png`, width, height, cells };
}

/**
 * 排布：按 (档案, 资源) 分组、组内货架式摆放、超过 `max` 就另起一张。
 *
 * 保证：每张边长 ≤ `max`（单帧就比 `max` 大的除外 —— 它独占一张，列进 `oversize`）；
 * 任意两格之间在 x 或 y 方向上至少隔 `gutter` 像素；分组与帧的先后顺序同队列。
 */
export function planPack(
  frames: readonly PackFrame[],
  opts: PackOptions = {},
): { sheets: PackSheet[]; oversize: string[] } {
  const gutter = opts.gutter ?? DEFAULT_GUTTER;
  const max = opts.max ?? DEFAULT_SHEET_MAX;
  if (!Number.isInteger(gutter) || gutter < 0) throw new Error(`--gutter 必须是非负整数：${gutter}`);
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max 必须是正整数：${max}`);

  // Map 保插入顺序 —— 组的先后即队列里首帧的先后
  const groups = new Map<string, PackFrame[]>();
  for (const f of frames) {
    const k = groupKeyOf(f.id);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [f]);
    else list.push(f);
  }

  const sheets: PackSheet[] = [];
  const oversize: string[] = [];
  for (const [group, list] of groups) {
    let n = 0;
    const flush = (cells: PackCell[]): void => {
      if (cells.length > 0) sheets.push(sheetOf(group, n++, cells));
    };

    const maxW = Math.max(...list.map((f) => f.width));
    // 行宽：⌈√帧数⌉ 个最宽格 —— 同尺寸帧即规整网格；夹在 [最宽帧, max] 之间
    const cols = Math.ceil(Math.sqrt(list.length));
    const rowLimit = Math.min(max, Math.max(maxW, cols * (maxW + gutter) - gutter));

    let cells: PackCell[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const f of list) {
      const cell = (cx: number, cy: number): PackCell => ({
        id: f.id,
        rgb: f.rgb,
        alpha: f.alpha,
        x: cx,
        y: cy,
        width: f.width,
        height: f.height,
        scale: f.scale,
      });
      if (f.width > max || f.height > max) {
        // 单帧就超限：独占一张，不与任何帧同处（底图 2304² 就是这种）
        flush(cells);
        cells = [];
        x = 0;
        y = 0;
        rowH = 0;
        flush([cell(0, 0)]);
        oversize.push(f.id);
        continue;
      }
      if (x > 0 && x + f.width > rowLimit) {
        // 换行
        y += rowH + gutter;
        x = 0;
        rowH = 0;
      }
      if (cells.length > 0 && y + f.height > max) {
        // 换张
        flush(cells);
        cells = [];
        x = 0;
        y = 0;
        rowH = 0;
      }
      cells.push(cell(x, y));
      x += f.width + gutter;
      rowH = Math.max(rowH, f.height);
    }
    flush(cells);
  }
  return { sheets, oversize };
}

// ============================================================
//  拼 / 切
// ============================================================

export type PackKind = 'rgb' | 'alpha';

/**
 * 拼出一张图。`read` 按格给出该帧的 rgb 或 alpha 图（slice 的产物，尺寸须与格一致）。
 *
 * 空白处（隔离带、行尾、格内比行高矮的那截）：rgb 填中性灰、alpha 填 0。
 * alpha 图沿用 slice 的「等灰 RGB」形式（r=g=b=透明度，自身 alpha 恒 255）。
 *
 * @throws 某帧的实际尺寸与布局不符（队列清单与磁盘上的图对不上）
 */
export function renderSheet(
  sheet: PackSheet,
  kind: PackKind,
  read: (cell: PackCell) => DecodedImage,
  edge?: { gutter: number },
): DecodedImage {
  const { width, height } = sheet;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const [fr, fg, fb] = kind === 'rgb' ? GUTTER_RGB : [GUTTER_ALPHA, GUTTER_ALPHA, GUTTER_ALPHA];
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = fr;
    rgba[i * 4 + 1] = fg;
    rgba[i * 4 + 2] = fb;
    rgba[i * 4 + 3] = 255;
  }
  for (const cell of sheet.cells) {
    const img = read(cell);
    if (img.width !== cell.width || img.height !== cell.height) {
      throw new Error(
        `${cell.id}：${kind} 图 ${img.width}×${img.height} 与布局 ${cell.width}×${cell.height} 不符`,
      );
    }
    for (let y = 0; y < cell.height; y++) {
      const src = y * cell.width * 4;
      rgba.set(img.rgba.subarray(src, src + cell.width * 4), ((cell.y + y) * width + cell.x) * 4);
    }
    if (edge !== undefined) extendEdges(rgba, width, height, cell, img, Math.floor(edge.gutter / 2));
  }
  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

/**
 * `fill: 'edge'`：把一格的边缘像素（钳位取最近的格内像素）向外延拓 `e` 像素。
 *
 * 任意两格至少隔 `gutter`，各延 ⌊gutter/2⌋，两格的延拓区不会互相盖住，
 * 更盖不到对方的格子 —— 延拓只写隔离带，从不改任何一格的内容。
 */
function extendEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  cell: PackCell,
  img: DecodedImage,
  e: number,
): void {
  if (e <= 0) return;
  const x0 = Math.max(0, cell.x - e);
  const x1 = Math.min(width, cell.x + cell.width + e);
  const y0 = Math.max(0, cell.y - e);
  const y1 = Math.min(height, cell.y + cell.height + e);
  for (let y = y0; y < y1; y++) {
    const sy = Math.min(cell.height - 1, Math.max(0, y - cell.y));
    const inRow = y >= cell.y && y < cell.y + cell.height;
    for (let x = x0; x < x1; x++) {
      if (inRow && x >= cell.x && x < cell.x + cell.width) continue; // 格内不动
      const sx = Math.min(cell.width - 1, Math.max(0, x - cell.x));
      const s = (sy * cell.width + sx) * 4;
      rgba.set(img.rgba.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
}

/** 拼图回传的尺寸不合规 —— 整张拒收（一格都不切） */
export class PackScaleError extends Error {}

/**
 * 由回传拼图的尺寸推倍率 k：必须恰为布局尺寸的**同一个正整数**倍。
 *
 * ★ 不猜、不容差：宽 ×4 高 ×3.97 这种图切出来每格都会错位，而错位量随格号累积，
 *   左上角那格看着对、右下角那格偏了好几像素 —— 必须整张拒收并说清楚。
 */
export function inferSheetScale(sheet: PackSheet, width: number, height: number): number {
  const want = `${sheet.width}×${sheet.height}`;
  if (width % sheet.width !== 0 || height % sheet.height !== 0) {
    throw new PackScaleError(
      `${sheet.name}：回传 ${width}×${height} 不是布局 ${want} 的整数倍（倍率必须是统一的正整数）`,
    );
  }
  const kx = width / sheet.width;
  const ky = height / sheet.height;
  if (kx !== ky) {
    throw new PackScaleError(`${sheet.name}：回传 ${width}×${height} 宽 ×${kx}、高 ×${ky}，两轴倍率不一致`);
  }
  if (kx < 1) throw new PackScaleError(`${sheet.name}：回传 ${width}×${height} 比布局 ${want} 还小`);
  return kx;
}

/** 从 k 倍拼图里切回一格（k 倍尺寸） */
export function cutCell(sheetImg: DecodedImage, cell: PackCell, k: number): DecodedImage {
  const w = cell.width * k;
  const h = cell.height * k;
  const x0 = cell.x * k;
  const y0 = cell.y * k;
  if (x0 + w > sheetImg.width || y0 + h > sheetImg.height) {
    throw new PackScaleError(`${cell.id}：格 (${x0},${y0}) ${w}×${h} 超出拼图 ${sheetImg.width}×${sheetImg.height}`);
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * sheetImg.width + x0) * 4;
    rgba.set(sheetImg.rgba.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba };
}

/**
 * 回传的一对拼图（rgb + alpha）能不能切：两张必须同尺寸，且恰为布局的同一整数倍。
 *
 * 只看尺寸 —— CLI 用它在**解码之前**就拒收（读 IHDR 即可，8192² 的图不必白解两张）。
 *
 * @returns 倍率 k
 * @throws PackScaleError 尺寸不合规（整张拒收）
 */
export function checkSheetSizes(
  sheet: PackSheet,
  rgb: { width: number; height: number },
  alpha: { width: number; height: number },
): number {
  if (rgb.width !== alpha.width || rgb.height !== alpha.height) {
    throw new PackScaleError(
      `${sheet.name}：rgb ${rgb.width}×${rgb.height} 与 alpha ${alpha.width}×${alpha.height} 尺寸互不一致`,
    );
  }
  return inferSheetScale(sheet, rgb.width, rgb.height);
}

/**
 * 切回一整张：rgb 与 alpha 两张必须同尺寸、同倍率。
 *
 * @returns 倍率 k 与逐格的 rgb/alpha
 * @throws PackScaleError 尺寸不合规（整张拒收）
 */
export function unpackSheet(
  sheet: PackSheet,
  rgb: DecodedImage,
  alpha: DecodedImage,
): { k: number; cells: { cell: PackCell; rgb: DecodedImage; alpha: DecodedImage }[] } {
  const k = checkSheetSizes(sheet, rgb, alpha);
  return {
    k,
    cells: sheet.cells.map((cell) => ({ cell, rgb: cutCell(rgb, cell, k), alpha: cutCell(alpha, cell, k) })),
  };
}
