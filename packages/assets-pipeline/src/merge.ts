/*
 * 回填校验 + Alpha 合并 + 去彩边（T-062）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 外部超分工具把 upscale-queue 里的 rgb/alpha 各自放大后，放进
 * assets/upscale-done/rgb|alpha（同名路径）。本模块负责把成品
 * 盖回 RGBA 帧，并把不合格项拦在门外：
 *
 *   校验（不合格即拒收并列出，C-AST-3 构图不变）：
 *     1. 尺寸 ≠ 原图 × 清单倍率（统一 4×）→ 拒；
 *     2. 缺 rgb 或缺 alpha → 拒；
 *     3. rgb 与 alpha 尺寸互不一致 → 拒；
 *     4. 产物与交出去的输入逐字节相同（哈希不变，疑似没处理
 *        直接把源图复制回来）→ 拒。
 *
 *   合并（每张合格品）：
 *     1. alpha 二值化，阈值 128 —— 放大产生的半透明过渡全是
 *        插值毛边，本作的透明本就是二值的（SPR 索引 0）；
 *     2. mergeFrame 盖回 RGBA；
 *     3. 去彩边：alpha 边界像素（自身不透明、8 邻域有透明）的
 *        RGB 替换为 3×3 邻域内**不透明像素**的逐通道中值——
 *        边缘向外 1px 的串色被多数表决压掉；
 *     4. 透明区 RGB 重 bleed（边缘 1px 内用最近不透明色填），
 *        保证渲染端做线性过滤时不会从黑边取样。
 */

import type { DecodedImage } from './sprite.ts';
import { bleedColors, mergeFrame, type QueueFrame } from './slice.ts';
import { cleanEdges, smoothAlpha } from './edge.ts';

/** alpha 二值化阈值（灰度 ≥ 128 判为不透明） */
export const ALPHA_THRESHOLD = 128;

// ============================================================
//  合并管线（纯函数）
// ============================================================

/**
 * 放大后的 alpha 灰度图 → 二值 alpha 灰度图。
 * 输入是 slice 的等灰 RGB 形式（透明度在 r=g=b），输出同形式。
 *
 * ★ 已经**就是**「全不透明」的规范形（r=g=b ≥ 阈值、a=255）时原样返回输入 ——
 *   二值化的结果与输入逐字节相同，而 9216² 上那份副本是 324MB（地图底图
 *   那一张，Q-GND-4）。判据特意把 a 与 r=g=b 一起查了：只查 r 会漏掉
 *   「a 不是 255」或「三通道不等灰」的非规范输入，那就不是逐字节相同了。
 */
export function binarizeAlpha(alpha: DecodedImage, threshold = ALPHA_THRESHOLD): DecodedImage {
  const n = alpha.width * alpha.height;
  let canonical = true;
  for (let i = 0; i < n && canonical; i++) {
    const o = i * 4;
    const r = alpha.rgba[o]!;
    canonical =
      r >= threshold &&
      r === alpha.rgba[o + 1] &&
      r === alpha.rgba[o + 2] &&
      alpha.rgba[o + 3] === 255;
  }
  if (canonical) return alpha;

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = alpha.rgba[i * 4]! >= threshold ? 255 : 0;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { width: alpha.width, height: alpha.height, anchorX: 0, anchorY: 0, rgba: out };
}

/**
 * 去彩边：alpha 边界像素的 RGB ← 3×3 邻域内不透明像素的逐通道中值。
 *
 * 「边界像素」= 自身不透明（alpha>0）且 8 邻域内有透明像素。
 * 中值取**下中值**（偶数个时取第 n/2 小，下标从 0 起），保证确定性。
 * 邻域内除自己外没有不透明像素（孤立点）时保持原色——中值即自身。
 *
 * ★ **整张全不透明时原样返回 `img`**（连拷贝都不做）：没有边界像素，
 *   输出与输入逐字节相同。地图底图就是这样一张 —— 9216² 上那一份
 *   `new Uint8ClampedArray(rgba)` 是 324MB，白拷一次纯属浪费（Q-GND-4）。
 *   故 `out` 改成**按需分配**：一次都没改到就根本不分配。
 */
export function deFringe(img: DecodedImage): DecodedImage {
  const { width, height, rgba } = img;
  // 按需分配：全不透明（没有边界像素）时一个字节都不拷
  let out: Uint8ClampedArray | null = null;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (rgba[i * 4 + 3] === 0) continue; // 透明像素不管

      // 是否边界：8 邻域有透明
      let boundary = false;
      for (let dy = -1; dy <= 1 && !boundary; dy++) {
        for (let dx = -1; dx <= 1 && !boundary; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (rgba[(ny * width + nx) * 4 + 3] === 0) boundary = true;
        }
      }
      if (!boundary) continue;

      // 3×3 邻域内不透明像素的逐通道下中值
      rs.length = 0;
      gs.length = 0;
      bs.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const j = ny * width + nx;
          if (rgba[j * 4 + 3] === 0) continue;
          rs.push(rgba[j * 4]!);
          gs.push(rgba[j * 4 + 1]!);
          bs.push(rgba[j * 4 + 2]!);
        }
      }
      const mid = (arr: number[]): number => {
        arr.sort((a, b) => a - b);
        return arr[Math.floor((arr.length - 1) / 2)]!;
      };
      out ??= new Uint8ClampedArray(rgba);
      out[i * 4] = mid(rs);
      out[i * 4 + 1] = mid(gs);
      out[i * 4 + 2] = mid(bs);
    }
  }

  if (out === null) return img;
  return { width, height, anchorX: img.anchorX, anchorY: img.anchorY, rgba: out };
}

/**
 * 透明区 RGB 重 bleed：边缘 1px 内（及整个透明区）用最近不透明色填。
 * 不透明像素原样保留。
 *
 * ★ **全不透明时原样返回 `img`**：没有透明像素可填，输出与输入逐字节相同，
 *   连 `bleedColors` 那本 BFS 账都不必开（同上，底图那一张）。
 */
export function rebleedTransparent(img: DecodedImage): DecodedImage {
  const n = img.width * img.height;
  let anyTransparent = false;
  for (let i = 0; i < n; i++) {
    if (img.rgba[i * 4 + 3] === 0) {
      anyTransparent = true;
      break;
    }
  }
  if (!anyTransparent) return img;

  const rgb = bleedColors(img.width, img.height, img.rgba);
  const out = new Uint8ClampedArray(img.rgba);
  for (let i = 0; i < n; i++) {
    if (img.rgba[i * 4 + 3] !== 0) continue;
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
  }
  return { width: img.width, height: img.height, anchorX: img.anchorX, anchorY: img.anchorY, rgba: out };
}

/**
 * 合并一张已放大的 rgb + alpha 回 RGBA 帧：
 * 二值化 → 盖回 → 去彩边 → 透明区重 bleed。
 *
 * @throws rgb 与 alpha 尺寸不一致（调用方应先过 validatePair）
 */
export function mergeUpscaled(
  rgb: DecodedImage,
  alpha: DecodedImage,
  scale?: number,
  /** 交给外部工具之前的那张 rgb（1×，已 bleed）—— 给了才做边缘带重建 */
  original?: DecodedImage,
): DecodedImage {
  // ★ W-80 试点后：给了倍率（≥ 2）与原图就走「轮廓平滑 + 边缘带取原图」（`edge.ts`）——
  //   二值化 + 1 像素中值去彩边只够 1×，4× 下原版渲染背景混进来的那圈残色是 4 个像素宽，
  //   AI 还往里补了纹理（需求方：「周围一圈杂色」）。不给保留旧行为（旧单测与旧产物）。
  if (scale !== undefined && scale >= 2 && original !== undefined) {
    return rebleedTransparent(cleanEdges(mergeFrame(rgb, smoothAlpha(alpha, scale)), original, scale));
  }
  const merged = mergeFrame(rgb, binarizeAlpha(alpha));
  return rebleedTransparent(deFringe(merged));
}

// ============================================================
//  回填校验
// ============================================================

export type MergeRejectReason =
  | 'missing-rgb' // 缺 rgb 产物
  | 'missing-alpha' // 缺 alpha 产物
  | 'size-mismatch' // 尺寸 ≠ 原图 × 清单倍率
  | 'pair-mismatch' // rgb 与 alpha 尺寸互不一致
  | 'unchanged'; // 产物与输入逐字节相同（疑似未处理）

export interface MergeRejection {
  id: string;
  reason: MergeRejectReason;
  detail: string;
}

/** 清单记录的期望输出尺寸（统一 4×，C-AST-3） */
export function expectedSize(frame: QueueFrame): { width: number; height: number } {
  return { width: frame.width * frame.scale, height: frame.height * frame.scale };
}

/**
 * 校验一对回填产物：
 *
 * 返回 { kind: 'ok' }            —— 合格，可以 mergeUpscaled；
 * 返回 { kind: 'absent' }        —— 两张都没交（还没处理，不是错误）；
 * 返回 { kind: 'reject', ... }   —— 不合格，列出原因。
 */
export type PairVerdict =
  | { kind: 'ok' }
  | { kind: 'absent' }
  | { kind: 'reject'; rejection: MergeRejection };

export function validatePair(
  frame: QueueFrame,
  rgb: DecodedImage | null,
  alpha: DecodedImage | null,
  hashes: { rgbSha256?: string; alphaSha256?: string } = {},
): PairVerdict {
  if (rgb === null && alpha === null) return { kind: 'absent' };
  const reject = (reason: MergeRejectReason, detail: string): PairVerdict => ({
    kind: 'reject',
    rejection: { id: frame.id, reason, detail },
  });
  if (rgb === null) return reject('missing-rgb', '有 alpha 产物但缺 rgb');
  if (alpha === null) return reject('missing-alpha', '有 rgb 产物但缺 alpha');
  if (rgb.width !== alpha.width || rgb.height !== alpha.height) {
    return reject(
      'pair-mismatch',
      `rgb ${rgb.width}×${rgb.height} 与 alpha ${alpha.width}×${alpha.height} 尺寸互不一致`,
    );
  }
  const want = expectedSize(frame);
  if (rgb.width !== want.width || rgb.height !== want.height) {
    return reject(
      'size-mismatch',
      `尺寸 ${rgb.width}×${rgb.height} ≠ 原图 ${frame.width}×${frame.height} ×${frame.scale} = ${want.width}×${want.height}`,
    );
  }
  if (hashes.rgbSha256 !== undefined && hashes.rgbSha256 === frame.rgbSha256) {
    return reject('unchanged', 'rgb 产物与交出去的输入逐字节相同（疑似未处理）');
  }
  if (hashes.alphaSha256 !== undefined && hashes.alphaSha256 === frame.alphaSha256) {
    return reject('unchanged', 'alpha 产物与交出去的输入逐字节相同（疑似未处理）');
  }
  return { kind: 'ok' };
}
