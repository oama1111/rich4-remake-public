/*
 * 超分精灵的边缘处理 —— 轮廓平滑 + 背景残色清理（W-80 试点反馈）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 问题（需求方看试点图时指出「周围一圈杂色」）
 *
 * 原版角色是 3D **预渲染**的：渲染时背景是深绿，抗锯齿把一圈背景色混进了边缘像素，
 * 抠图（索引 0 透明）之后这圈「背景残色」留在了角色轮廓上。原图里它只有 1 个像素，
 * 看着像一道深色描边；放大 4× 后变成 4 个像素宽的带子，AI 还往里补了纹理 ⇒ 一圈杂色。
 * 另外 alpha 是按原图像素阶梯放大的，轮廓有「一级 4 像素」的锯齿。
 *
 * ## 做法
 *
 * 1. `smoothAlpha`：放大后的 alpha 先做两遍盒式模糊（≈ 高斯）再按 128 为中心拉陡，
 *    轮廓变圆滑，并留约 2 像素的抗锯齿过渡（高清下不必再强制二值）。
 * 2. `cleanEdges`：离轮廓 1 个原图像素（= `scale` 个高清像素）以内的那一圈，
 *    不再用 AI 画的颜色，改用**原图同一位置的颜色**（双线性放大）：最外侧完全取原图，
 *    往里线性过渡回 AI 的内容。原图边缘是什么样就还是什么样 —— 预渲染角色那道深色
 *    残色仍是一道干净的深色边，界面图标的亮边仍是亮边；去掉的只是 AI 在这一圈画的杂纹。
 *    ⚠️ 先试过「一律压暗成描边」：边缘本来干净的图（图标、道具）会被凭空加一道黑边，
 *      是改画风 —— 比对闸当场打回，弃用。
 * 3. 去背景残色：边缘带里**暗**的像素（Lab 明度 < 40）保留原图的明暗，但色相换成
 *    角色内侧的颜色 —— 深绿残色变成同色系的暗边（紫色角色就是深紫）。亮的边缘
 *    （图标、文字的彩色描边）完全不动。明度 20 以下全换、20–40 之间渐变。
 *
 * ★ 全不透明的图（底图、场所背景）两步都原样返回，一个字节都不拷。
 */

import type { DecodedImage } from './sprite.ts';
import { srgbToLab, type Lab } from './seams.ts';

/** alpha（灰度 r 通道）→ 平滑、带抗锯齿的 alpha（同形式：r=g=b，a=255） */
export function smoothAlpha(alpha: DecodedImage, scale: number): DecodedImage {
  const { width: w, height: h, rgba } = alpha;
  const n = w * h;
  let allOpaque = true;
  for (let i = 0; i < n && allOpaque; i++) allOpaque = rgba[i * 4]! >= 128;
  if (allOpaque) return alpha;

  // ⚠️ 半径只取 scale/4（4× 下为 1）：再大会把原图里「单个像素」的透明孔抹平
  //   （FLIC 帧里调色板 0 号的零星透明点，端到端单测抓到的），形状就变了
  const r = Math.max(1, Math.round(scale / 4));
  let f: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = rgba[i * 4]!;
  for (let pass = 0; pass < 2; pass++) f = boxBlur(boxBlur(f, w, h, r, true), w, h, r, false);

  // 以 128 为中心拉陡 —— 过渡宽度约 2 像素
  const K = 4;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round((f[i]! - 128) * K + 128)));
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba: out };
}

/** 一维盒式模糊（边界夹取） */
function boxBlur(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const at = (line: number, k: number): number => (horizontal ? line * w + k : k * w + line);
  const span = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[at(line, Math.max(0, Math.min(len - 1, k)))]!;
    for (let k = 0; k < len; k++) {
      out[at(line, k)] = sum / span;
      const add = Math.min(len - 1, k + r + 1);
      const sub = Math.max(0, k - r);
      sum += src[at(line, add)]! - src[at(line, sub)]!;
    }
  }
  return out;
}

/**
 * 到轮廓外的距离（高清像素，3-4 倒角近似欧氏距离），只算到 `cap` 为止。
 * alpha < 128 的算「轮廓外」= 0；图外也算轮廓外（精灵贴边的地方也是边缘）。
 *
 * ⚠️ 以 128 为界而不是以 0 为界：`smoothAlpha` 的抗锯齿会让轮廓向外多出一圈半透明像素，
 *   以 0 为界距离整体偏 1，残色带最里面那一列就被当成「内侧颜色」反向涂出去了（单测抓到的）。
 */
export function edgeDistance(img: DecodedImage, cap: number): Float32Array {
  const { width: w, height: h, rgba } = img;
  const INF = (cap + 2) * 3;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = rgba[i * 4 + 3]! < 128 ? 0 : INF;
  const get = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, get(x - 1, y) + 3, get(x, y - 1) + 3, get(x - 1, y - 1) + 4, get(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, get(x + 1, y) + 3, get(x, y + 1) + 3, get(x + 1, y + 1) + 4, get(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] = d[i]! / 3;
  return d;
}

/** 原图（1×，透明处已 bleed 填色）在高清坐标 (x, y) 处的双线性取样 */
function sampleOriginal(orig: DecodedImage, x: number, y: number, kx: number, ky: number, out: number[]): void {
  const fx = Math.max(0, Math.min(orig.width - 1, (x + 0.5) / kx - 0.5));
  const fy = Math.max(0, Math.min(orig.height - 1, (y + 0.5) / ky - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(orig.width - 1, x0 + 1);
  const y1 = Math.min(orig.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const p = orig.rgba;
  for (let c = 0; c < 3; c++) {
    const a = p[(y0 * orig.width + x0) * 4 + c]!;
    const b = p[(y0 * orig.width + x1) * 4 + c]!;
    const d = p[(y1 * orig.width + x0) * 4 + c]!;
    const e = p[(y1 * orig.width + x1) * 4 + c]!;
    out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
}

/** Lab → sRGB（0..255，夹到色域内）—— `seams.ts` 的 `srgbToLab` 的反函数 */
export function labToSrgb(lab: Lab): [number, number, number] {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const d = 6 / 29;
  const inv = (t: number): number => (t > d ? t * t * t : 3 * d * d * (t - 4 / 29));
  const x = 0.95047 * inv(fx);
  const y = inv(fy);
  const z = 1.08883 * inv(fz);
  const lin = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  return lin.map((v) => {
    const c = Math.max(0, Math.min(1, v));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  }) as [number, number, number];
}

/** 暗边去残色：明度 < 20 全换色相、20–40 渐变、以上不动（见文件头第 3 条） */
const DECONTAM_FULL_L = 20;
const DECONTAM_NONE_L = 40;

/**
 * 边缘带重建（见文件头第 2、3 条）。
 *
 * @param img      已盖回 alpha 的超分 RGBA
 * @param original 原图 RGB（**1×**，透明处已按 slice 的 bleed 填色 —— 否则取样会从黑色里混进来）
 */
export function cleanEdges(img: DecodedImage, original: DecodedImage, scale: number): DecodedImage {
  const { width: w, height: h, rgba } = img;
  const n = w * h;
  let anyTransparent = false;
  for (let i = 0; i < n && !anyTransparent; i++) anyTransparent = rgba[i * 4 + 3]! < 128;
  if (!anyTransparent) return img;

  const band = scale;
  // 去残色多管 1 像素：原图 1 像素的残色放大后正好 `scale` 宽，平滑后的轮廓还可能外扩 1 像素；
  // 内侧颜色从再往里 1 像素处取，免得取到的就是残色本身
  const reach = band + 1;
  const d = edgeDistance(img, reach + 1);
  const kx = w / original.width;
  const ky = h / original.height;

  // 内侧颜色：从「边缘带以内」的像素出发，多源 BFS 往外涂满整条边缘带
  const inner = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (d[i]! > reach) {
      inner[i] = i;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (inner[j] !== -1 || rgba[j * 4 + 3] === 0) continue;
      inner[j] = inner[i]!;
      queue[tail++] = j;
    }
  }

  const out = new Uint8ClampedArray(rgba);
  const o = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (rgba[i * 4 + 3] === 0 || d[i]! > reach) continue;
      // ① 边缘带：最外侧（含轮廓外那圈抗锯齿像素）完全取原图，到带宽处完全回到 AI
      if (d[i]! <= band) {
        sampleOriginal(original, x, y, kx, ky, o);
        const t = Math.max(0, d[i]! - 1) / Math.max(1, band - 1);
        for (let c = 0; c < 3; c++) o[c] = o[c]! + (rgba[i * 4 + c]! - o[c]!) * t;
      } else {
        for (let c = 0; c < 3; c++) o[c] = rgba[i * 4 + c]!;
      }
      // ② 去残色：对过渡之后的**最终**颜色做 —— 残色带里 AI 自己也画成了绿色
      const src = inner[i]!;
      if (src >= 0) {
        const lo = srgbToLab(o[0]!, o[1]!, o[2]!);
        const wgt = Math.max(0, Math.min(1, (DECONTAM_NONE_L - lo.l) / (DECONTAM_NONE_L - DECONTAM_FULL_L)));
        if (wgt > 0) {
          const li = srgbToLab(rgba[src * 4]!, rgba[src * 4 + 1]!, rgba[src * 4 + 2]!);
          // 暗处的色度按明度比例收一点，免得深色边被染得过饱和
          const k = li.l > 0 ? Math.min(1, lo.l / li.l) : 0;
          const rgb = labToSrgb({ l: lo.l, a: lo.a + (li.a * k - lo.a) * wgt, b: lo.b + (li.b * k - lo.b) * wgt });
          for (let c = 0; c < 3; c++) o[c] = rgb[c]!;
        }
      }
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(o[c]!);
    }
  }
  return { width: w, height: h, anchorX: img.anchorX, anchorY: img.anchorY, rgba: out };
}
