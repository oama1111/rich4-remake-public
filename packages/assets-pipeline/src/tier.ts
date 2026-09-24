/*
 * 分档输出：由 4× 母版派生较低倍率的一档（W-80 §4.5）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 母版是 `assets/hd/`（统一 4×，C-AST-3）；桌面随包带 4×，网页默认 2×
 * （体积约四分之一，首屏等待短得多）。client 在网页上拉 `/assets/hd-2x`、
 * 桌面拉 `/assets/hd` —— 两档用**同一套** `hdRelativePath` 命名，读侧只换前缀。
 *
 *   tier assets/hd assets/hd-2x 2
 *     → assets/hd-2x/<档案>/<资源>-<图>.png    面积平均缩到 原图 × 2
 *     → assets/hd-2x-manifest.json            同一批任务；结果的尺寸/锚点按实际重算，
 *                                               模型名后缀 `+tier2x`（一看就知道是派生档）
 *
 * ★ 缩小用 gate 的 `downscaleArea`（面积平均、alpha 预乘）：与回缩比对自动闸是同一把尺子，
 *   过了闸的母版缩出来的这一档不会在颜色上另起炉灶。
 *
 * ★ **只缩不放**：产物本来就 ≤ 目标尺寸（比如 ingest 进来的某张只有 2×）就原样拷过去，
 *   绝不为了凑倍率再放大一遍。
 *
 * ★ 锚点仍经 `recordResult` 按**实际**尺寸重算（C-AST-6）—— 与 assemble 同一条代码路径。
 *
 * ⚠️ 引 png.ts（`node:zlib`），故只走 `@rich4/assets-pipeline/node`（Q-BUILD-1）；
 *   文件读写走调用方给的 `TierIo`，同 assemble 的做法，便于内存夹具测试。
 */

import { decodePng, encodePng } from './png.ts';
import type { DecodedImage } from './sprite.ts';
import { downscaleArea } from './gate.ts';
import { hdRelativePath, recordResult, type UpscaleManifest, type UpscaleResult, type UpscaleTask } from './upscale.ts';

// ============================================================
//  纯计算
// ============================================================

/**
 * 这一档里某张图该有多大。
 *
 * 目标 = 原图 × `scale`（四舍五入到整像素）；产物两轴都不超过目标 → `copy`（原样拷），
 * 否则缩到「目标与产物取小」（某一轴本就更小的，那一轴不动 —— 只缩不放）。
 */
export function tierSize(
  task: Pick<UpscaleTask, 'srcWidth' | 'srcHeight'>,
  hdWidth: number,
  hdHeight: number,
  scale: number,
): { width: number; height: number; copy: boolean } {
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error(`档位倍率必须是正数：${scale}`);
  const tw = Math.max(1, Math.round(task.srcWidth * scale));
  const th = Math.max(1, Math.round(task.srcHeight * scale));
  if (hdWidth <= tw && hdHeight <= th) return { width: hdWidth, height: hdHeight, copy: true };
  return { width: Math.min(tw, hdWidth), height: Math.min(th, hdHeight), copy: false };
}

/** 派生档的模型名：`<母版模型>+tier<倍率>x` */
export function tierModel(model: string, scale: number): string {
  return `${model}+tier${scale}x`;
}

/**
 * 派生档的一条结果：尺寸是这一档的实际尺寸，锚点经 `recordResult` 重算，
 * 参数与源哈希沿用母版（配方可追溯到同一次超分）。
 */
export function tierResult(
  task: UpscaleTask,
  master: UpscaleResult,
  out: { width: number; height: number; hash: string },
  scale: number,
): UpscaleResult {
  return recordResult(task, {
    model: tierModel(master.model, scale),
    params: master.params,
    outWidth: out.width,
    outHeight: out.height,
    srcHash: master.srcHash,
    outHash: out.hash,
  });
}

// ============================================================
//  整档派生
// ============================================================

/** tier 需要的外部动作；CLI 传真实 fs，测试传内存实现 */
export interface TierIo {
  /** 读母版产物（参数是 hdRelativePath）；不存在返回 null */
  readMaster(rel: string): Uint8Array | null;
  /** 写这一档的产物 */
  write(rel: string, bytes: Uint8Array): void;
  /** 内容哈希（与 cli-upscale 的约定一致） */
  hash(bytes: Uint8Array): string;
}

export interface TierReport {
  /** 缩过的 */
  scaled: string[];
  /** 本就不大于目标、原样拷的 */
  copied: string[];
  /** 清单有结果、母版文件却不在（或坏了） */
  missing: { id: string; detail: string }[];
}

/**
 * 由母版清单派生一档。
 *
 * 返回的清单：`tasks` 原样、`results` 只含**成功写出**的那些 —— 母版缺图的不记，
 * 免得 client 按清单去拉一张不存在的图。
 */
export function tierHd(
  master: UpscaleManifest,
  scale: number,
  io: TierIo,
  now = new Date(),
): { manifest: UpscaleManifest; report: TierReport } {
  const report: TierReport = { scaled: [], copied: [], missing: [] };
  const results: Record<string, UpscaleResult> = {};

  // 按 tasks 的顺序走（不按 results 的键序 —— C-DET-5 的习惯，输出顺序稳定）
  for (const task of master.tasks) {
    const res = master.results[task.id];
    if (res === undefined) continue;
    const rel = hdRelativePath(task.archive, task.resource, task.image);
    const bytes = io.readMaster(rel);
    if (bytes === null) {
      report.missing.push({ id: task.id, detail: `母版缺 ${rel}` });
      continue;
    }
    let img: DecodedImage;
    try {
      img = decodePng(bytes);
    } catch (e) {
      report.missing.push({ id: task.id, detail: `${rel}：${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const size = tierSize(task, img.width, img.height, scale);
    const outBytes = size.copy ? bytes : encodePng(downscaleArea(img, size.width, size.height));
    io.write(rel, outBytes);
    results[task.id] = tierResult(task, res, { width: size.width, height: size.height, hash: io.hash(outBytes) }, scale);
    (size.copy ? report.copied : report.scaled).push(task.id);
  }

  return {
    manifest: { version: 1, generatedAt: now.toISOString(), tasks: master.tasks, results },
    report,
  };
}
