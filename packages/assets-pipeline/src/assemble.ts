/*
 * 重拼精灵 + 锚点 ×4 + 写 hd-manifest.json（T-063）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 交接链的最后一公里。前面几步各管一段：
 *   plan      出清单
 *   slice     切成 rgb/alpha 交出去（C-AST-4/5）
 *   merge     校验回传产物、盖回 RGBA，写到 <done>/merged/
 *   assemble  ← 本模块：把 merged/ 摆进 assets/hd/ 并记账
 *
 * 为什么还要单独一步，而不让 merge 顺便写了：
 *   merge 的产物是**目录内部**的中间物，命名沿用队列（`<资源>_f<帧>`）；
 *   而 client 要读的是另一套命名（`<资源>-<图>`，PRD §4.5）。两套命名之间
 *   的翻译、以及 manifest 记账，都不是像素活，混进 merge 会让「校验」这件事
 *   不再纯粹。分开之后，merge 出问题就是产物不对，assemble 出问题就是记账不对。
 *
 * ★ 锚点按**实际输出尺寸**重算（C-AST-6），复用 upscale 的 recordResult：
 *   超分工具常把结果对齐到 4 的倍数，按请求的 scale 乘一下会得到系统性偏移
 *   ——而且偏得很均匀，看起来像「美术做歪了」而不像 bug，极难排查。
 *
 * ★ 幂等：产物哈希与上次记录相同就整帧跳过，**一个字节都不重写**。
 *   管线要能反复跑（补几张、换几张）而不产生无谓的改动。
 *
 * ⚠️ 本模块不碰文件系统：读写都走调用方给的 `AssembleIo`。这样幂等、
 *   尺寸守卫、锚点这些规矩可以用内存夹具钉死，不必造临时目录。
 */

import { decodePng } from './png.ts';
import { hdRelativePath, recordResult, type UpscaleManifest, type UpscaleResult } from './upscale.ts';
import type { QueueFrame, QueueManifest } from './slice.ts';

// 路径契约（hdRelativePath）已挪到 upscale.ts —— 前端也要用它算 URL，
// 而 assemble 这条线在 node 出口上（见 Q-BUILD-1）。

// ============================================================
//  IO 口子
// ============================================================

/** assemble 需要的全部外部动作；CLI 传真实 fs，测试传内存实现 */
export interface AssembleIo {
  /**
   * 读 merge 的产物（参数是队列清单里的 rgb 相对路径，`rgb/` 前缀已去掉）。
   * 还没有这个文件就返回 null —— 「外部工具还没交」不是错误。
   */
  readMerged(rgbRel: string): Uint8Array | null;
  /** 内容哈希（与 cli-upscale 的约定一致：sha256 前 16 位十六进制） */
  hash(bytes: Uint8Array): string;
  /** 写 hd 产物（参数是 hdRelativePath 的返回值） */
  write(rel: string, bytes: Uint8Array): void;
}

// ============================================================
//  记账
// ============================================================

export interface AssembleProblem {
  id: string;
  detail: string;
}

export interface AssembleReport {
  /** 新写出（或哈希变了需重写）的帧 id */
  written: string[];
  /** 产物哈希未变、按幂等跳过重写的帧 id */
  skipped: string[];
  /** merged/ 里还没有产物（外部工具还没交到这帧） */
  missing: string[];
  /** 有产物，但清单里没有对应的任务（多半是队列换过一版） */
  unplanned: string[];
  /** 产物存在但不可用（PNG 坏了、尺寸不合规） */
  broken: AssembleProblem[];
}

export interface AssembleOptions {
  /** 覆盖模型名；缺省用队列里记录的每帧建议模型 */
  model?: string;
  /** 参数快照，原样记进 manifest 便于复现 */
  params?: Record<string, string | number | boolean>;
}

/**
 * 把 merge 的产物摆进 `assets/hd/` 并写 manifest 条目。
 *
 * 纯函数式：返回**新的** manifest（不就地改传入的那个），调用方决定何时落盘。
 *
 * @returns manifest 更新后的副本 + 逐帧结果报告
 */
export function assembleHd(
  manifest: UpscaleManifest,
  queue: QueueManifest,
  io: AssembleIo,
  opts: AssembleOptions = {},
): { manifest: UpscaleManifest; report: AssembleReport } {
  // 数字身份（archive/resource/image）与原尺寸/原锚点都在 tasks 里，
  // 队列帧只有合并产物相关的信息。两者按 id 对齐，谁也不独占真相。
  const taskById = new Map(manifest.tasks.map((t) => [t.id, t]));

  const results: Record<string, UpscaleResult> = { ...manifest.results };
  const report: AssembleReport = { written: [], skipped: [], missing: [], unplanned: [], broken: [] };

  // 按队列顺序遍历 —— 顺序即原素材清单顺序（卡片要求「帧顺序与原 meta 一致」）
  for (const frame of queue.frames) {
    const task = taskById.get(frame.id);
    if (task === undefined) {
      report.unplanned.push(frame.id);
      continue;
    }

    const bytes = io.readMerged(stripPrefix(frame));
    if (bytes === null) {
      report.missing.push(frame.id);
      continue;
    }

    const outHash = io.hash(bytes);
    const prev = results[frame.id];
    if (prev !== undefined && prev.outHash === outHash) {
      report.skipped.push(frame.id);
      continue;
    }

    const img = decodeSafely(bytes, frame.id, report);
    if (img === null) continue;

    // 与 T-062 同一条规则：产物必须恰好是 原图 × scale。
    // 这里是**最后一道**门 —— hd/ 是 client 直接消费的东西，放进去就晚了。
    const wantW = frame.width * frame.scale;
    const wantH = frame.height * frame.scale;
    if (img.width !== wantW || img.height !== wantH) {
      report.broken.push({
        id: frame.id,
        detail: `尺寸 ${img.width}×${img.height} ≠ 原图 ${frame.width}×${frame.height} ×${frame.scale} = ${wantW}×${wantH}`,
      });
      continue;
    }

    io.write(hdRelativePath(task.archive, task.resource, task.image), bytes);
    results[frame.id] = recordResult(task, {
      model: opts.model ?? frame.model,
      params: opts.params ?? {},
      outWidth: img.width,
      outHeight: img.height,
      // 交出去的那张 rgb 的哈希：源图一变，slice 会重切、这个哈希随之变，
      // 这条结果于是自动变回「待办」（pendingTasks 的判据）。
      srcHash: frame.rgbSha256,
      outHash,
    });
    report.written.push(frame.id);
  }

  return { manifest: { ...manifest, results }, report };
}

// ============================================================
//  内部
// ============================================================

/** 队列里的 rgb 路径形如 `rgb/<档案>/<资源>_f<帧>.png`；产物在 `<done>/rgb/…` 下同构 */
function stripPrefix(frame: QueueFrame): string {
  return frame.rgb.replace(/^rgb\//, '');
}

function decodeSafely(
  bytes: Uint8Array,
  id: string,
  report: AssembleReport,
): ReturnType<typeof decodePng> | null {
  try {
    return decodePng(bytes);
  } catch (e) {
    report.broken.push({ id, detail: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
