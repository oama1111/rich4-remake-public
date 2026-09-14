/*
 * 画质升级管线：切片、清单、回填
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 设计要点在于**不把成品塞进仓库**（见 docs/assets.md）：
 *   版本化的是「配方」——每张图用了哪个模型、什么参数、
 *   输入输出哈希各是多少。成品按配方重跑即可复现。
 *
 * ★ C-AST-6（最容易踩的一条）：**锚点必须与图像同步缩放**。
 *   原版精灵靠 graph_info 的 x/y 对齐，超分后若锚点还是原值，
 *   所有精灵的定位会整体偏移——而且偏得很均匀，看起来像「美术做歪了」
 *   而不像 bug，极难排查。故本模块把锚点缩放做成清单的一部分，
 *   由代码保证，不依赖人工记得。
 */

import { classifyAsset, type AssetCategory, type AssetEntry as ClassifyAssetEntry } from './classify.ts';

/** 单张图的超分任务 */
export interface UpscaleTask {
  /** 稳定标识：`档案/资源_图号`，与 extract 产出的文件名一致 */
  id: string;
  archive: string;
  resource: number;
  image: number;
  /** 相对于切片根目录的输入路径 */
  input: string;
  srcWidth: number;
  srcHeight: number;
  srcAnchorX: number;
  srcAnchorY: number;
  format: 'SPR' | 'SMP';
  /**
   * 素材类别（ui/tile/sprite/background/font）—— 决定超分策略
   * （DEVELOPMENT_PLAN §6 分类处理策略），见 classify.ts。
   */
  category: AssetCategory;
  /** 建议的放大倍率 */
  scale: number;
  /** 分到哪一批 */
  batch: string;
}

/** 超分完成后回填的记录 */
export interface UpscaleResult {
  id: string;
  /** 用了什么模型（自由文本，例如 `realesrgan-x4plus-anime`） */
  model: string;
  /** 参数快照，原样记录，便于复现 */
  params: Record<string, string | number | boolean>;
  outWidth: number;
  outHeight: number;
  /** ★ 已按实际放大倍率同步缩放过的锚点 */
  outAnchorX: number;
  outAnchorY: number;
  /** 输入/输出内容哈希，用来判断是否需要重跑 */
  srcHash: string;
  outHash: string;
}

export interface UpscaleManifest {
  version: 1;
  generatedAt: string;
  tasks: UpscaleTask[];
  results: Record<string, UpscaleResult>;
}

// ============================================================
//  批次划分
// ============================================================

/**
 * 按尺寸把图分批。
 *
 * 为什么要分批而不是一股脑全丢给模型：
 * 1. **小图和大图该用不同倍率**。13,034 张里面积中位数只有 4013 px
 *    （约 63×63），而最大的是 640×480 的全屏图。对 640×480 再放 4 倍
 *    是 2560×1920，既没必要又拖慢一个数量级。
 * 2. 动漫风格的超分模型对**极小图**（边长 ≤ 8）往往产出糊边，
 *    这类图单独成批，便于换模型或干脆用最近邻放大。
 */
export const BATCH_RULES = [
  { batch: 'tiny', maxArea: 64, scale: 4 },
  { batch: 'small', maxArea: 16_384, scale: 4 },
  { batch: 'medium', maxArea: 65_536, scale: 3 },
  { batch: 'large', maxArea: Number.POSITIVE_INFINITY, scale: 2 },
] as const;

export function classify(width: number, height: number): { batch: string; scale: number } {
  const area = width * height;
  for (const r of BATCH_RULES) {
    if (area <= r.maxArea) return { batch: r.batch, scale: r.scale };
  }
  // BATCH_RULES 最后一条是 Infinity，走不到这里
  return { batch: 'large', scale: 2 };
}

/** extract 产出的素材条目（manifest.json 的 images 项） */
export interface AssetEntryLike {
  archive: string;
  resource: number;
  image: number;
  file: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  format: 'SPR' | 'SMP';
  /** 同一张 sprite sheet 的帧数（缺省按 1 计，分类用） */
  frames?: number;
  /** 调色板/来源种类（'spr'/'smp'/'gnd'/'font'，缺省按 format 小写计） */
  paletteKind?: string;
}

/** AssetEntryLike → 分类器输入（T-060 的接线处） */
export function toClassifyEntry(e: AssetEntryLike): ClassifyAssetEntry {
  return {
    archive: e.archive,
    index: e.resource,
    w: e.width,
    h: e.height,
    x: e.anchorX,
    y: e.anchorY,
    frames: e.frames ?? 1,
    paletteKind: e.paletteKind ?? e.format.toLowerCase(),
  };
}

export function taskIdOf(e: { archive: string; resource: number; image: number }): string {
  return `${e.archive}/${String(e.resource).padStart(4, '0')}_${String(e.image).padStart(3, '0')}`;
}

/** 由素材清单生成超分任务列表 */
export function planUpscale(entries: readonly AssetEntryLike[]): UpscaleTask[] {
  return entries.map((e) => {
    const { batch, scale } = classify(e.width, e.height);
    return {
      id: taskIdOf(e),
      archive: e.archive,
      resource: e.resource,
      image: e.image,
      input: e.file,
      srcWidth: e.width,
      srcHeight: e.height,
      srcAnchorX: e.anchorX,
      srcAnchorY: e.anchorY,
      format: e.format,
      category: classifyAsset(toClassifyEntry(e)),
      scale,
      batch,
    };
  });
}

// ============================================================
//  锚点缩放 —— C-AST-6
// ============================================================

/**
 * 按**实际**输出尺寸缩放锚点。
 *
 * ⚠️ 用实际尺寸而不是请求的 `scale`：不少超分工具会把结果对齐到
 * 偶数或 4 的倍数，实际倍率因此与请求值不完全相等。
 * 若按请求值算锚点，会出现半像素到数像素的系统性偏移。
 *
 * 取整用 `Math.round`——锚点是显示用的像素坐标，不是金额，
 * 不受 C-DET-3 的整数除法约束。
 */
export function scaleAnchor(
  srcAnchorX: number,
  srcAnchorY: number,
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
): { anchorX: number; anchorY: number } {
  if (srcWidth === 0 || srcHeight === 0) return { anchorX: 0, anchorY: 0 };
  // 这两处是**像素坐标**的比例，不是金额，故不受 C-DET-3 约束
  const kx = outWidth / srcWidth;
  const ky = outHeight / srcHeight;
  return {
    anchorX: Math.round(srcAnchorX * kx),
    anchorY: Math.round(srcAnchorY * ky),
  };
}

/**
 * 记录一条超分结果，并**自动**算好锚点。
 *
 * 调用方只需给出模型、参数与实际输出尺寸；锚点由本函数负责，
 * 从而把 C-AST-6 变成代码保证而不是人工纪律。
 */
export function recordResult(
  task: UpscaleTask,
  out: {
    model: string;
    params?: Record<string, string | number | boolean>;
    outWidth: number;
    outHeight: number;
    srcHash: string;
    outHash: string;
  },
): UpscaleResult {
  const anchor = scaleAnchor(
    task.srcAnchorX,
    task.srcAnchorY,
    task.srcWidth,
    task.srcHeight,
    out.outWidth,
    out.outHeight,
  );
  return {
    id: task.id,
    model: out.model,
    params: out.params ?? {},
    outWidth: out.outWidth,
    outHeight: out.outHeight,
    outAnchorX: anchor.anchorX,
    outAnchorY: anchor.anchorY,
    srcHash: out.srcHash,
    outHash: out.outHash,
  };
}

// ============================================================
//  增量：哪些还需要跑
// ============================================================

/**
 * 挑出需要（重新）超分的任务。
 *
 * 判据只有两条：没做过，或者**源图变了**（哈希对不上）。
 * 换模型时把 `model` 传进来，模型不同的也会被挑出来重跑。
 */
export function pendingTasks(
  manifest: UpscaleManifest,
  srcHashes: ReadonlyMap<string, string>,
  model?: string,
): UpscaleTask[] {
  return manifest.tasks.filter((t) => {
    const done = manifest.results[t.id];
    if (done === undefined) return true;
    if (model !== undefined && done.model !== model) return true;
    const cur = srcHashes.get(t.id);
    return cur !== undefined && cur !== done.srcHash;
  });
}

/** 空清单 */
export function emptyManifest(tasks: UpscaleTask[], now = new Date()): UpscaleManifest {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    tasks,
    results: {},
  };
}

/** 批次统计——交给外部工具前先看看规模 */
export function summarize(tasks: readonly UpscaleTask[]): Record<string, { count: number; scale: number }> {
  const out: Record<string, { count: number; scale: number }> = {};
  for (const t of tasks) {
    const e = (out[t.batch] ??= { count: 0, scale: t.scale });
    e.count++;
  }
  return out;
}
