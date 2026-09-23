/*
 * 回缩比对自动闸（W-80 §4.1，C-AST-3 放宽后的把关）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * C-AST-3 在 2026-09-22 放宽成「允许 AI 补细节，但不得改变构图、比例、色彩基调、
 * 透明区域形状」。补了多少细节人眼一看就知道，**有没有改构图/改色**却很难靠人
 * 在一万多张里逐张盯出来 —— 这就是本闸的用处：
 *
 *   把 HD 产物**面积平均**缩回原尺寸，再与原图比三样东西：
 *     · alpha 轮廓 IoU      —— 透明区域形状变没变（两边 alpha 都在 128 处二值化）；
 *     · 色差均值 ΔE         —— 色彩基调偏没偏（CIE76，只算两边都不透明的像素）；
 *     · 色差 95 分位 ΔE     —— 有没有一小块被整个画成别的东西（均值会把它摊薄）。
 *   三项全过才算过；人工只看大图与被打回的。
 *
 * ★ 为什么缩回去比、而不是把原图放大了比：「补出来的细节」在原尺寸上会被平均掉，
 *   剩下的恰恰是构图与色调 —— 正是要把关的那两样。反过来放大原图去比，补的细节
 *   全都成了「差异」，阈值就没法定了。
 *
 * ★ 面积平均按**真实覆盖面积**加权（整数运算求重叠，见 `axisTaps`），
 *   非整数倍（外部工具常给 3.97× 这类对齐后的尺寸）同样成立；颜色按 alpha
 *   **预乘**后再平均 —— 透明像素里 merge 重 bleed 出来的填充色不是图像内容，
 *   不能让它掺进边缘的颜色里。
 *
 * ⚠️ 本模块纯函数、不碰文件系统（CLI 负责读图写报告），故浏览器安全、可进 index barrel。
 */

import type { DecodedImage } from './sprite.ts';
import { deltaE76, srgbToLab, type Lab } from './seams.ts';

// ============================================================
//  面积平均缩小
// ============================================================

/** 一个输出像素在某一轴上吃到的源像素：从 `first` 起连续 `weights.length` 个 */
interface AxisTap {
  first: number;
  weights: number[];
}

/**
 * 一条轴上的面积权重表。
 *
 * 输出像素 j 覆盖源区间 [j·src/dst, (j+1)·src/dst)；两边同乘 dst 之后
 * 全是整数：输出 j = [j·src, (j+1)·src)，源 i = [i·dst, (i+1)·dst)。
 * 重叠长度是整数，除以 src 即权重 —— 没有浮点端点误差，每个输出像素的
 * 权重和恰为 1。
 */
function axisTaps(src: number, dst: number): AxisTap[] {
  const taps: AxisTap[] = [];
  for (let j = 0; j < dst; j++) {
    const lo = j * src;
    const hi = (j + 1) * src;
    const first = Math.floor(lo / dst);
    const last = Math.ceil(hi / dst) - 1;
    const weights: number[] = [];
    for (let i = first; i <= last; i++) {
      const overlap = Math.min(hi, (i + 1) * dst) - Math.max(lo, i * dst);
      weights.push(overlap / src);
    }
    taps.push({ first, weights });
  }
  return taps;
}

/**
 * 面积平均缩小到 `width × height`（alpha 预乘）。
 *
 * 逐输出行累加：内存只开一行的累加器（9216² 的底图缩回 2304² 也不必开整幅中间图），
 * 每个源行最多被相邻两个输出行各读一遍。
 *
 * 输出：alpha = 覆盖面积加权的 alpha 均值；颜色 = alpha 加权均值；
 * alpha 取整后为 0 的像素写 (0,0,0,0)，与 decodeImage 的透明规范形一致。
 * 锚点按实际缩放比例同步（C-AST-6，同 `scaleAnchor` 的取整）。
 *
 * @throws 目标尺寸为 0，或任一轴比源图大（本函数**只缩不放**）
 */
export function downscaleArea(img: DecodedImage, width: number, height: number): DecodedImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`目标尺寸 ${width}×${height} 不合法`);
  }
  if (width > img.width || height > img.height) {
    throw new Error(`面积平均只缩不放：${img.width}×${img.height} → ${width}×${height}`);
  }
  const src = img.rgba;
  const out = new Uint8ClampedArray(width * height * 4);
  const tx = axisTaps(img.width, width);
  const ty = axisTaps(img.height, height);
  const acc = new Float64Array(width * 4);

  for (let oy = 0; oy < height; oy++) {
    acc.fill(0);
    const ry = ty[oy]!;
    for (let dy = 0; dy < ry.weights.length; dy++) {
      const wy = ry.weights[dy]!;
      const rowBase = (ry.first + dy) * img.width;
      for (let ox = 0; ox < width; ox++) {
        const rx = tx[ox]!;
        const a4 = ox * 4;
        for (let dx = 0; dx < rx.weights.length; dx++) {
          const s = (rowBase + rx.first + dx) * 4;
          const a = src[s + 3]!;
          if (a === 0) continue; // 预乘后为 0：对颜色和 alpha 都不贡献
          const w = wy * rx.weights[dx]! * a;
          acc[a4] = acc[a4]! + w * src[s]!;
          acc[a4 + 1] = acc[a4 + 1]! + w * src[s + 1]!;
          acc[a4 + 2] = acc[a4 + 2]! + w * src[s + 2]!;
          acc[a4 + 3] = acc[a4 + 3]! + w;
        }
      }
    }
    const rowOut = oy * width * 4;
    for (let ox = 0; ox < width; ox++) {
      const a4 = ox * 4;
      const sumA = acc[a4 + 3]!; // = Σ w·a，权重和为 1，故即 alpha 均值
      const alpha = Math.round(sumA);
      if (alpha === 0) continue; // 规范透明形 (0,0,0,0)
      const o = rowOut + a4;
      out[o] = Math.round(acc[a4]! / sumA);
      out[o + 1] = Math.round(acc[a4 + 1]! / sumA);
      out[o + 2] = Math.round(acc[a4 + 2]! / sumA);
      out[o + 3] = alpha;
    }
  }

  return {
    width,
    height,
    anchorX: Math.round((img.anchorX * width) / img.width),
    anchorY: Math.round((img.anchorY * height) / img.height),
    rgba: out,
  };
}

// ============================================================
//  色差
// ============================================================

/**
 * sRGB（0..255）→ CIE Lab（D65）。
 *
 * ★ 与 `seams.ts` 的接缝判据用的是**同一份**实现（`srgbToLab`）：
 *   两道闸用两套色彩换算，某天一边改了白点另一边没改，阈值就对不上了。
 */
export const rgbToLab: (r: number, g: number, b: number) => Lab = srgbToLab;

// ============================================================
//  比对
// ============================================================

/** alpha 二值化阈值 —— 与 merge 的 `ALPHA_THRESHOLD` 同为 128 */
export const GATE_ALPHA_THRESHOLD = 128;

export interface GateThresholds {
  /** alpha 轮廓 IoU 下限 */
  minIou: number;
  /** 两边都不透明像素上的 ΔE 均值上限 */
  maxMeanDeltaE: number;
  /** 同上，95 分位上限 */
  maxP95DeltaE: number;
}

/**
 * 默认阈值：IoU ≥ 0.97、均值 ΔE ≤ 6、95 分位 ΔE ≤ 15。
 *
 * 口径：ΔE 2.3 是「刚可察觉」，面积平均本身会把 1px 细线抹淡，故均值给到 6
 * （约两三个 JND，「看得出补了细节、看不出换了颜色」）；95 分位 15 拦的是
 * 「一小块被画成了别的东西」。都只是起点，试点（W-80 D3）后按实测调。
 */
export const DEFAULT_GATE_THRESHOLDS: Readonly<GateThresholds> = {
  minIou: 0.97,
  maxMeanDeltaE: 6,
  maxP95DeltaE: 15,
};

export interface GateMetrics {
  /** 比对所在的尺寸（= 原图尺寸） */
  width: number;
  height: number;
  /** alpha 轮廓 IoU；两边都没有不透明像素时定义为 1 */
  iou: number;
  /** 两边都不透明的像素数（ΔE 的样本数） */
  opaqueBoth: number;
  /** ΔE 均值 / 95 分位（样本为 0 时记 0） */
  meanDeltaE: number;
  p95DeltaE: number;
  pass: boolean;
  /** 没过的原因，逐条可读 */
  reasons: string[];
}

/**
 * 回缩比对：把 `hd` 面积平均缩回 `original` 的尺寸，再比 IoU 与 ΔE。
 *
 * `hd` 与原图同尺寸时直接比（测试、或已经缩好的图）。
 *
 * 95 分位取**最近秩**（排好序后第 ⌈0.95·n⌉ 个），确定且不插值。
 *
 * @throws `hd` 任一轴比原图小（见 `downscaleArea`）
 */
export function gateCompare(
  original: DecodedImage,
  hd: DecodedImage,
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS,
): GateMetrics {
  const { width, height } = original;
  const down =
    hd.width === width && hd.height === height ? hd : downscaleArea(hd, width, height);
  const n = width * height;
  const a = original.rgba;
  const b = down.rgba;

  let inter = 0;
  let union = 0;
  const deltas = new Float32Array(n);
  let m = 0;
  let sum = 0;
  // 原图是 256 色调色板出来的，同色像素极多：按颜色缓存 Lab 能省掉大半 cbrt/pow
  const labCache = new Map<number, Lab>();
  const labOf = (r: number, g: number, bl: number): Lab => {
    const key = (r << 16) | (g << 8) | bl;
    let lab = labCache.get(key);
    if (lab === undefined) {
      lab = rgbToLab(r, g, bl);
      if (labCache.size < 1 << 20) labCache.set(key, lab);
    }
    return lab;
  };

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const inA = a[o + 3]! >= GATE_ALPHA_THRESHOLD;
    const inB = b[o + 3]! >= GATE_ALPHA_THRESHOLD;
    if (inA || inB) union++;
    if (!(inA && inB)) continue;
    inter++;
    const d = deltaE76(labOf(a[o]!, a[o + 1]!, a[o + 2]!), labOf(b[o]!, b[o + 1]!, b[o + 2]!));
    deltas[m++] = d;
    sum += d;
  }

  const iou = union === 0 ? 1 : inter / union;
  const meanDeltaE = m === 0 ? 0 : sum / m;
  let p95DeltaE = 0;
  if (m > 0) {
    const sorted = deltas.subarray(0, m).sort();
    p95DeltaE = sorted[Math.max(0, Math.ceil(0.95 * m) - 1)]!;
  }

  const reasons: string[] = [];
  if (iou < thresholds.minIou) reasons.push(`轮廓 IoU ${iou.toFixed(4)} < ${thresholds.minIou}`);
  if (meanDeltaE > thresholds.maxMeanDeltaE) {
    reasons.push(`均值 ΔE ${meanDeltaE.toFixed(2)} > ${thresholds.maxMeanDeltaE}`);
  }
  if (p95DeltaE > thresholds.maxP95DeltaE) {
    reasons.push(`95 分位 ΔE ${p95DeltaE.toFixed(2)} > ${thresholds.maxP95DeltaE}`);
  }

  return {
    width,
    height,
    iou,
    opaqueBoth: m,
    meanDeltaE,
    p95DeltaE,
    pass: reasons.length === 0,
    reasons,
  };
}

// ============================================================
//  报告
// ============================================================

/** 报告里的一行 */
export interface GateRow extends Partial<GateMetrics> {
  id: string;
  /** hd 产物相对路径（hdRelativePath） */
  hd: string;
  pass: boolean;
  reasons: string[];
}

export interface GateReport {
  generatedAt: string;
  thresholds: GateThresholds;
  summary: { checked: number; passed: number; failed: number };
  rows: GateRow[];
}

/**
 * 最差的几条：先按「没过」排前，再按均值 ΔE、再按 IoU（低者差）。
 * 没算出指标的（文件缺失、尺寸不对）排在最前 —— 那是最该先看的。
 */
export function worstRows(rows: readonly GateRow[], limit = 10): GateRow[] {
  const score = (r: GateRow): number =>
    r.meanDeltaE === undefined ? Number.POSITIVE_INFINITY : r.meanDeltaE + (1 - (r.iou ?? 1)) * 100;
  return rows
    .filter((r) => !r.pass)
    .slice()
    .sort((p, q) => score(q) - score(p) || p.id.localeCompare(q.id))
    .slice(0, limit);
}

export function summarizeGate(rows: readonly GateRow[]): GateReport['summary'] {
  const passed = rows.filter((r) => r.pass).length;
  return { checked: rows.length, passed, failed: rows.length - passed };
}
