/*
 * 按帧切片 + Alpha 分离 —— 产出 upscale-queue/
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 为什么要把一张图拆成 rgb + alpha 两张再交给外部超分工具：
 *
 *   C-AST-4（透明通道）：禁止让模型在 RGB 与 Alpha 混合的图上直接
 *   放大——透明区的颜色会渗进边缘，产生彩色毛边。故：
 *     · rgb/   纯颜色图，**透明像素填入最近的不透明色**（alpha bleed），
 *              模型放大时边缘向外自然延拓，不会出现黑边；
 *     · alpha/ 单通道灰度图（以等灰 RGB 形式存储，任何工具都能读），
 *              透明区域的形状由它单独承载，放大后再盖回去。
 *
 *   C-AST-5（精灵按帧）：动画必须逐帧放大，禁止整图直放（跨帧串色）。
 *   帧在 cli-extract 解包时已逐帧落盘（<资源>_<帧>.png），故这里的
 *   输入一图即一帧；队列文件名沿用 `<id>_f<n>` 约定保留帧号语义。
 *
 * 往返不变量（本模块的测试基石）：
 *   mergeFrame(sliceFrame(img)) 与 img **逐字节相等**。
 *   依赖两条本管线的既定约定：
 *     1. decodeImage 把透明像素规范为 (0,0,0,0)；
 *     2. mergeFrame 对 alpha==0 的像素同样写回 (0,0,0,0)，
 *        而不是写回 bleed 后的填充色（填充色只为超分模型服务，
 *        不属于图像内容）。
 */

import type { DecodedImage } from './sprite.ts';
import type { AssetCategory } from './classify.ts';
import type { UpscaleTask } from './upscale.ts';

// ============================================================
//  切片 / 合并
// ============================================================

/** 一帧的切片结果：不透明颜色图 + 灰度透明度图 */
export interface SlicedFrame {
  /** 颜色通道；透明像素已填最近不透明色；alpha 恒 255；锚点沿用原图 */
  rgb: DecodedImage;
  /**
   * 透明度通道，以等灰 RGB 形式存储（r=g=b=原 alpha，自身 alpha 恒 255）。
   * 锚点无意义，恒 0/0（真正的锚点以队列清单为准）。
   */
  alpha: DecodedImage;
}

/**
 * 把一帧切成 rgb + alpha 两张图。
 */
export function sliceFrame(img: DecodedImage): SlicedFrame {
  const { width, height, rgba } = img;
  const n = width * height;
  const rgbData = bleedColors(width, height, rgba);

  const rgbRgba = new Uint8ClampedArray(n * 4);
  const alphaRgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const q = i * 3;
    rgbRgba[o] = rgbData[q]!;
    rgbRgba[o + 1] = rgbData[q + 1]!;
    rgbRgba[o + 2] = rgbData[q + 2]!;
    rgbRgba[o + 3] = 255;

    const a = rgba[o + 3]!;
    alphaRgba[o] = a;
    alphaRgba[o + 1] = a;
    alphaRgba[o + 2] = a;
    alphaRgba[o + 3] = 255;
  }

  return {
    rgb: { width, height, anchorX: img.anchorX, anchorY: img.anchorY, rgba: rgbRgba },
    alpha: { width, height, anchorX: 0, anchorY: 0, rgba: alphaRgba },
  };
}

/**
 * 把（可能已被外部放大的）rgb + alpha 盖回一张 RGBA 图。
 *
 * ⚠️ alpha==0 的像素写 (0,0,0,0) 而不是 rgb 图里的填充色——
 *    填充色是给超分模型看的延拓色，不是图像内容；写 (0,0,0,0)
 *    也正好与 decodeImage 的透明像素规范形一致，保证不放大时
 *    往返逐字节相等。
 *
 * @throws 两张图尺寸不一致
 */
export function mergeFrame(rgb: DecodedImage, alpha: DecodedImage): DecodedImage {
  if (rgb.width !== alpha.width || rgb.height !== alpha.height) {
    throw new Error(
      `rgb 与 alpha 尺寸不一致：${rgb.width}×${rgb.height} vs ${alpha.width}×${alpha.height}`,
    );
  }
  const n = rgb.width * rgb.height;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = alpha.rgba[o]!; // 灰度存于 r（=g=b）
    if (a === 0) continue; // 规范透明形 (0,0,0,0)，见模块头注释
    out[o] = rgb.rgba[o]!;
    out[o + 1] = rgb.rgba[o + 1]!;
    out[o + 2] = rgb.rgba[o + 2]!;
    out[o + 3] = a;
  }
  return { width: rgb.width, height: rgb.height, anchorX: rgb.anchorX, anchorY: rgb.anchorY, rgba: out };
}

// ============================================================
//  Alpha bleed：透明像素填最近不透明色
// ============================================================

/**
 * 提取颜色通道（RGB888，长度 = width*height*3），透明像素取
 * **最近不透明像素**的颜色（多源 BFS，曼哈顿距离最近者胜；
 * 等距时按「源像素行优先序、邻居按 上下左右 序」确定性tie-break）。
 *
 * 全图无不透明像素时返回全 0——rgb 图整体透明，内容本就为空。
 */
export function bleedColors(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const n = width * height;
  if (rgba.length !== n * 4) {
    throw new Error(`rgba 长度 ${rgba.length} 与 ${width}×${height} 不符`);
  }

  const rgb = new Uint8Array(n * 3);
  const visited = new Uint8Array(n);
  const queue: number[] = [];

  // 多源 BFS：所有不透明像素都是第 0 层源，行优先入队保证确定性
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3]! > 0) {
      visited[i] = 1;
      rgb[i * 3] = rgba[i * 4]!;
      rgb[i * 3 + 1] = rgba[i * 4 + 1]!;
      rgb[i * 3 + 2] = rgba[i * 4 + 2]!;
      queue.push(i);
    }
  }

  // 邻居顺序固定：上、下、左、右（决定等距时的确定性 tie-break）
  const DIRS = [-width, width, -1, 1] as const;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const x = idx % width;
    for (let d = 0; d < DIRS.length; d++) {
      const nb = idx + DIRS[d]!;
      // 左/右移动需防跨行回绕
      if (d === 2 && x === 0) continue;
      if (d === 3 && x === width - 1) continue;
      if (nb < 0 || nb >= n || visited[nb] === 1) continue;
      visited[nb] = 1;
      rgb[nb * 3] = rgb[idx * 3]!;
      rgb[nb * 3 + 1] = rgb[idx * 3 + 1]!;
      rgb[nb * 3 + 2] = rgb[idx * 3 + 2]!;
      queue.push(nb);
    }
  }

  return rgb;
}

// ============================================================
//  模型建议（按素材类别，DEVELOPMENT_PLAN §6 分类处理策略）
// ============================================================

/**
 * 各类素材的建议超分模型。**只是建议**：清单消费者可以无视它
 * 换任何工具；'skip' 表示该类别不建议走超分（字体直接换高清
 * 字体，UI 优先矢量重绘——效果都远好于像素超分）。
 */
export const SUGGESTED_MODEL: Readonly<Record<AssetCategory, string>> = {
  sprite: 'realesrgan-x4plus-anime',
  tile: 'realesrgan-x4plus', // 放大后需过 T-064 接缝检查
  background: 'realesrgan-x4plus',
  ui: 'realesrgan-x4plus', // 矢量重绘优先；超分仅兜底
  font: 'skip', // 中文字体直接换高清字体，不做超分
};

export function suggestedModel(category: AssetCategory): string {
  return SUGGESTED_MODEL[category];
}

// ============================================================
//  upscale-queue 清单
// ============================================================

/** 队列中一帧的记录 */
export interface QueueFrame {
  /** 稳定标识 `<档案>/<资源>_<图号>`，与 UpscaleTask.id 一致，贯穿回填/重拼 */
  id: string;
  /** 相对队列根目录的 rgb / alpha 图路径 */
  rgb: string;
  alpha: string;
  /** 原尺寸与锚点（回填校验、锚点缩放的基准） */
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** 素材类别（T-060）与模型建议 */
  category: AssetCategory;
  model: string;
  /** 建议倍率与批次（来自 planUpscale 的 BATCH_RULES） */
  scale: number;
  batch: string;
  /**
   * 交出去的 rgb / alpha 两张图的 sha256（前 16 位，与 cli-upscale 的
   * 哈希约定一致）。回填校验（T-062）据此判断回传产物是否对得上
   * 本批次输入，队列重生成后过期的产物会被拒收。
   */
  rgbSha256: string;
  alphaSha256: string;
}

export interface QueueManifest {
  version: 1;
  generatedAt: string;
  frames: QueueFrame[];
}

/**
 * 队列文件命名：`<archive>/<资源4位>_f<帧3位>.png`
 * （卡片契约 `<id>_f<n>`；id 取到资源号一级，n 为帧号，与
 * cli-extract 的 `<资源>_<帧>` 命名一一对应、可互推）。
 */
export function queuePaths(task: Pick<UpscaleTask, 'archive' | 'resource' | 'image'>): {
  rgb: string;
  alpha: string;
} {
  const base = `${task.archive}/${String(task.resource).padStart(4, '0')}_f${String(task.image).padStart(3, '0')}`;
  return { rgb: `rgb/${base}.png`, alpha: `alpha/${base}.png` };
}

/** 由超分任务 + 两张产出图的内容哈希，组装一条队列记录 */
export function buildQueueFrame(
  task: UpscaleTask,
  hashes: { rgbSha256: string; alphaSha256: string },
): QueueFrame {
  const paths = queuePaths(task);
  return {
    id: task.id,
    rgb: paths.rgb,
    alpha: paths.alpha,
    width: task.srcWidth,
    height: task.srcHeight,
    anchorX: task.srcAnchorX,
    anchorY: task.srcAnchorY,
    category: task.category,
    model: suggestedModel(task.category),
    scale: task.scale,
    batch: task.batch,
    rgbSha256: hashes.rgbSha256,
    alphaSha256: hashes.alphaSha256,
  };
}
