#!/usr/bin/env node
/*
 * 画质升级 CLI —— 与外部超分工具的交接
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   plan     <assets-clean> <hd>            生成待办清单
 *   slice    <assets-clean> <queue> [N] [--only 档案/资源,…]  按帧切片 + Alpha 分离（T-061）
 *   pack     <queue> <pack-dir> [--gutter 8] [--max 2048] [--fill flat|edge]
 *                                           同一资源的帧拼成网格（W-80 §4.3，防帧间闪烁）
 *   unpack   <pack-dir> <pack-done> <upscale-done>
 *                                           按格切回，落成 merge 要的逐帧文件名
 *   merge    <queue> <upscale-done>         回填校验 + Alpha 合并（T-062）
 *   assemble <queue> <upscale-done> <hd>    落进 assets/hd + 写清单（T-063）[模型]
 *   gate     <hd> <assets-clean> [--iou 0.97] [--mean-de 6] [--p95-de 15]
 *                                           回缩比对自动闸（W-80 §4.1，C-AST-3）
 *   seams    <hd> <assets-clean> [地图号…]  地图底图的接缝检查（T-064，真实输入）
 *   review   <hd> <assets-clean> [输出]     生成并排过审页（T-066）
 *   tier     <hd> <out> <倍率>              由 4× 母版派生一档（W-80 §4.5，如网页的 2×）
 *   status   <hd>                           看进度
 *   ingest   <assets-clean> <hd> [模型]     回填已完成的产物（旧路径，见下）
 *
 * 交接链：plan → slice → [pack → 外部 AI → unpack] → merge → assemble → gate → seams → review → tier。
 *   方括号那段三步一体：不拼图时就是「外部 AI 直接处理 <queue>/rgb|alpha、产物放进 <upscale-done>」，
 *   与拼图时 unpack 的产出位置完全相同，故 merge 往后一行不用改。
 * `ingest` 保留给「产物直接放进 hd 目录」的旧路径，与 assemble 二选一；按素材原名放进来的
 * 会被挪到 client 读的 `hdRelativePath`（W-80 §4.7）。
 *
 * ★ 交接方式刻意做成「文件 + 清单」而不是直接调某个模型的 API：
 *   这样你可以用任何工具（Real-ESRGAN、waifu2x、某个在线服务、
 *   甚至手工重绘）来处理，本管线只负责**切片、定倍率、回填、
 *   以及把锚点算对**（C-AST-6）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, renameSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import {
  emptyManifest,
  hdRelativePath,
  locateIngestOutput,
  pendingTasks,
  planUpscale,
  recordResult,
  summarize,
  type AssetEntryLike,
  type UpscaleManifest,
} from './upscale.ts';
import {
  GATE_PROFILES,
  profileForModel,
  gateCompare,
  summarizeGate,
  worstRows,
  type GateReport,
  type GateRow,
  type GateThresholds,
} from './gate.ts';
import {
  checkSheetSizes,
  cutCell,
  PackScaleError,
  planPack,
  renderSheet,
  DEFAULT_GUTTER,
  DEFAULT_SHEET_MAX,
  GUTTER_ALPHA,
  GUTTER_RGB,
  type PackLayout,
  type PackOptions,
} from './grid.ts';
import { tierHd, type TierIo } from './tier.ts';
import { decodePng, encodePng } from './png.ts';
import { buildQueueFrame, sliceFrame, type QueueManifest } from './slice.ts';
import { mergeUpscaled, validatePair, type MergeRejection } from './merge.ts';
import { assembleHd, type AssembleIo } from './assemble.ts';
import { buildReviewRows, renderReviewHtml } from './review.ts';
import { compareAllSeams, compareTileSeams, type AllSeamHit } from './seams.ts';
import { asGroundImage, GND_TILE_HEIGHT, GND_TILE_WIDTH } from './ground.ts';

/**
 * 由 hd 目录推出清单路径：与之**同级**、不在其内。
 *
 * ★ 这是刻意的：`assets/hd/` 被 .gitignore 排除（成品不入库），
 *   而清单恰恰是唯一要入库的东西——它是「配方」。
 *   放在里面会连同成品一起被忽略掉。
 */
function manifestPath(hdDir: string): string {
  return join(dirname(hdDir), `${basename(hdDir)}-manifest.json`);
}

function sha256(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/** 读 PNG 的 IHDR 取尺寸——不必解码整张图 */
function pngSize(path: string): { width: number; height: number } | null {
  const b = readFileSync(path);
  if (b.length < 24) return null;
  // 8 字节签名 + 4 长度 + 4 'IHDR' 之后才是宽高
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function loadSourceManifest(cleanDir: string): AssetEntryLike[] {
  const p = join(cleanDir, 'manifest.json');
  if (!existsSync(p)) {
    throw new Error(`找不到素材清单 ${p}。先跑 cli-extract 解包。`);
  }
  const m = JSON.parse(readFileSync(p, 'utf8')) as { images: AssetEntryLike[] };
  return m.images;
}

function loadManifest(hdDir: string): UpscaleManifest {
  const p = manifestPath(hdDir);
  if (!existsSync(p)) throw new Error(`找不到 ${p}，先跑 plan。`);
  return JSON.parse(readFileSync(p, 'utf8')) as UpscaleManifest;
}

function saveManifest(hdDir: string, m: UpscaleManifest): void {
  mkdirSync(hdDir, { recursive: true });
  mkdirSync(dirname(manifestPath(hdDir)), { recursive: true });
  writeFileSync(manifestPath(hdDir), `${JSON.stringify(m, null, 2)}\n`);
}

// ============================================================
//  plan
// ============================================================

export function cmdPlan(cleanDir: string, hdDir: string): void {
  const entries = loadSourceManifest(cleanDir);
  const tasks = planUpscale(entries);
  const manifest = emptyManifest(tasks);
  saveManifest(hdDir, manifest);

  const s = summarize(tasks);
  console.log(`已规划 ${tasks.length} 张图：`);
  for (const [batch, info] of Object.entries(s)) {
    console.log(`  ${batch.padEnd(7)} ${String(info.count).padStart(6)} 张  ×${info.scale}`);
  }
  console.log(`\n清单：${manifestPath(hdDir)}`);
  console.log(`\n下一步（推荐链路）：`);
  console.log(`  1. slice   把 ${cleanDir} 切成 rgb/alpha 交出：upscale slice ${cleanDir} <queue>`);
  console.log(`  2. pack    同一资源的帧拼成网格（生成式模型防帧间闪烁）：upscale pack <queue> <pack>`);
  console.log(`  3. 用你的 AI 工具把 <pack>/rgb 与 <pack>/alpha 各自放大 4×（倍率必须一致），`);
  console.log(`     产物按同名路径放进 <pack-done>/rgb|alpha，然后 upscale unpack <pack> <pack-done> <upscale-done>`);
  console.log(`     （不拼图也行：直接放大 <queue>/rgb|alpha，产物同名放进 <upscale-done>/rgb|alpha）`);
  console.log(`  4. merge   校验并合并：upscale merge <queue> <upscale-done>`);
  console.log(`  5. assemble 落进 ${hdDir}/ 并记账：upscale assemble <queue> <upscale-done> ${hdDir}`);
  console.log(`  6. gate    回缩比对自动闸：upscale gate ${hdDir} ${cleanDir}`);
  console.log(`  7. seams / review 人工过审；tier 派生网页档：upscale tier ${hdDir} ${hdDir}-2x 2`);
  console.log(`（旧路径：把产物直接放进 ${hdDir}/（原名或 hdRelativePath 均可），然后跑 ingest 回填）`);
}

// ============================================================
//  slice —— 按帧切片 + Alpha 分离，产出 upscale-queue/（T-061）
// ============================================================

/**
 * 把 assets-clean 的每张图切成 rgb + alpha 两张，写入队列目录：
 *   <queueDir>/rgb/<档案>/<资源>_f<帧>.png
 *   <queueDir>/alpha/<档案>/<资源>_f<帧>.png
 *   <queueDir>/manifest.json   原尺寸、锚点、类别、模型建议、两张图的 sha256
 *
 * 外部超分工具分别放大 rgb 与 alpha（倍率必须一致），产物由
 * T-062 校验、T-063 盖回重拼。
 *
 * @param limit 只切前 N 张（试跑/抽查用；不传则全量）
 */
/**
 * 按 `档案/资源号` 挑任务（试点只切几组资源用）。
 * `only` 形如 `['Data/381', 'Panel/0']`；空数组 = 不筛。
 *
 * @throws 某一项写错（不是「档案/非负整数」）或一个任务都没命中 —— 试点批次选错了要当场知道
 */
export function selectTasks<T extends { archive: string; resource: number }>(tasks: readonly T[], only: readonly string[]): T[] {
  if (only.length === 0) return [...tasks];
  const want = new Set<string>();
  for (const item of only) {
    const m = /^([A-Za-z]+)\/(\d+)$/.exec(item.trim());
    if (m === null) throw new Error(`--only 的每一项要写成「档案/资源号」，如 Data/381，收到 ${item}`);
    want.add(`${m[1]}/${Number(m[2])}`);
  }
  const out = tasks.filter((t) => want.has(`${t.archive}/${t.resource}`));
  if (out.length === 0) throw new Error(`--only ${only.join(',')} 一个任务都没命中`);
  return out;
}

export function cmdSlice(cleanDir: string, queueDir: string, limit?: number, only: readonly string[] = []): void {
  const entries = loadSourceManifest(cleanDir);
  const tasks = selectTasks(planUpscale(entries), only);
  const chosen = limit === undefined ? tasks : tasks.slice(0, limit);

  const frames: QueueManifest['frames'] = [];
  let done = 0;
  for (const task of chosen) {
    const img = decodePng(new Uint8Array(readFileSync(join(cleanDir, task.input))));
    const { rgb, alpha } = sliceFrame(img);
    const rgbPng = encodePng(rgb);
    const alphaPng = encodePng(alpha);

    const frame = buildQueueFrame(task, {
      rgbSha256: sha256Bytes(rgbPng),
      alphaSha256: sha256Bytes(alphaPng),
    });
    const rgbPath = join(queueDir, frame.rgb);
    const alphaPath = join(queueDir, frame.alpha);
    mkdirSync(dirname(rgbPath), { recursive: true });
    mkdirSync(dirname(alphaPath), { recursive: true });
    writeFileSync(rgbPath, rgbPng);
    writeFileSync(alphaPath, alphaPng);
    frames.push(frame);
    done++;
    if (done % 1000 === 0) console.log(`  …已切 ${done} / ${chosen.length}`);
  }

  const manifest: QueueManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    frames,
  };
  mkdirSync(queueDir, { recursive: true });
  const manifestFile = join(queueDir, 'manifest.json');
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`已切 ${frames.length} 帧 → ${queueDir}/（rgb/ + alpha/）`);
  const byCategory = new Map<string, number>();
  for (const f of frames) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  for (const [category, n] of byCategory) {
    console.log(`  ${category.padEnd(10)} ${String(n).padStart(6)} 帧  建议模型 ${frames.find((f) => f.category === category)!.model}`);
  }
  console.log(`清单：${manifestFile}`);
}

// ============================================================
//  pack / unpack —— 整组拼图（W-80 §4.3）
// ============================================================

function loadQueue(queueDir: string): QueueManifest {
  const p = join(queueDir, 'manifest.json');
  if (!existsSync(p)) throw new Error(`找不到 ${p}，先跑 slice。`);
  return JSON.parse(readFileSync(p, 'utf8')) as QueueManifest;
}

/**
 * 把队列里同一 (档案, 资源) 的帧拼成网格图，交给外部 AI 一起处理：
 *   <packDir>/rgb/<档案>/<资源>-<n>.png
 *   <packDir>/alpha/<档案>/<资源>-<n>.png
 *   <packDir>/layout.json      每格的位置、原尺寸、队列文件名、隔离带宽度
 *
 * 外部工具把 rgb/ 与 alpha/ 各自放大（**任意统一整数倍**，两者一致），产物按同名
 * 放进 <pack-done>/rgb|alpha，然后跑 unpack。
 */
export function cmdPack(queueDir: string, packDir: string, opts: PackOptions = {}): PackLayout {
  const queue = loadQueue(queueDir);
  const { sheets, oversize } = planPack(queue.frames, opts);

  for (const sheet of sheets) {
    for (const kind of ['rgb', 'alpha'] as const) {
      const img = renderSheet(
        sheet,
        kind,
        (cell) => decodePng(new Uint8Array(readFileSync(join(queueDir, kind === 'rgb' ? cell.rgb : cell.alpha)))),
        opts.fill === 'edge' ? { gutter: opts.gutter ?? DEFAULT_GUTTER } : undefined,
      );
      const out = join(packDir, kind === 'rgb' ? sheet.rgb : sheet.alpha);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, encodePng(img));
    }
  }

  const layout: PackLayout = {
    version: 1,
    generatedAt: new Date().toISOString(),
    gutter: opts.gutter ?? DEFAULT_GUTTER,
    max: opts.max ?? DEFAULT_SHEET_MAX,
    fill: { mode: opts.fill ?? 'flat', rgb: GUTTER_RGB, alpha: GUTTER_ALPHA },
    sheets,
  };
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);

  const groups = new Set(sheets.map((s) => s.name.replace(/-\d+$/, '')));
  console.log(
    `已拼 ${queue.frames.length} 帧 → ${sheets.length} 张拼图（${groups.size} 组，隔离带 ${layout.gutter}px ${layout.fill.mode}，` +
      `边长上限 ${layout.max}px）→ ${packDir}/`,
  );
  if (oversize.length > 0) {
    console.log(`\n⚠️ ${oversize.length} 帧单帧就超过 ${layout.max}px，各自独占一张：`);
    for (const id of oversize.slice(0, 10)) console.log(`  ${id}`);
    if (oversize.length > 10) console.log(`  …还有 ${oversize.length - 10} 帧`);
  }
  console.log(`布局：${join(packDir, 'layout.json')}`);
  console.log(`下一步：把 ${packDir}/rgb 与 ${packDir}/alpha 各自放大（倍率一致），同名放进 <pack-done>，`);
  console.log(`        然后 upscale unpack ${packDir} <pack-done> <upscale-done>`);
  return layout;
}

/**
 * 分片：环境变量 `RICH4_SHARD=i/n`（0 ≤ i < n）时本进程只做第 i 份，n 个进程并行跑同一条命令。
 * 不设 = 全做。unpack 按拼图、merge 按帧取模分；merge 的超大帧（底图）一律归 0 号，
 * 免得几个进程同时各开一张 9216² 把内存撑爆。
 */
export function shardFromEnv(env: string | undefined = process.env['RICH4_SHARD']): { index: number; count: number } | null {
  if (env === undefined || env === '') return null;
  const m = /^(\d+)\/(\d+)$/.exec(env);
  if (m === null || Number(m[1]) >= Number(m[2])) throw new Error(`RICH4_SHARD 应为 i/n（0 ≤ i < n），收到 ${env}`);
  return { index: Number(m[1]), count: Number(m[2]) };
}

/** 超过这个输出像素数的帧只归 0 号分片（9216² 底图 ≈ 85M；普通 4× 帧都在 5M 以内） */
const SHARD_HUGE_PX = 16_000_000;

export interface UnpackReport {
  /** 切回的帧数 */
  frames: number;
  /** 切过的拼图 */
  sheets: number;
  /** rgb 与 alpha 都还没交的拼图 */
  absent: number;
  /** 整张拒收的拼图 */
  rejected: { sheet: string; detail: string }[];
  /** 切是切了，但倍率与队列定的不同 —— merge 会按尺寸拒收 */
  scaleWarnings: string[];
}

/**
 * 读回传的拼图，按 layout 切回每一格，落到 <upscale-done>/<队列里的 rgb|alpha 路径>
 * —— 与不拼图时外部工具直接交的产物**同名同位置**，merge 照常读。
 *
 * 倍率 k 由拼图尺寸 ÷ 布局尺寸推出，必须两轴一致、是正整数，且 rgb 与 alpha 一致；
 * 不合规的**整张拒收**，一格都不切（错位量随格号累积，切出来只会是坏图）。
 */
export function cmdUnpack(packDir: string, packDoneDir: string, doneDir: string): UnpackReport {
  const layoutPath = join(packDir, 'layout.json');
  if (!existsSync(layoutPath)) throw new Error(`找不到 ${layoutPath}，先跑 pack。`);
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8')) as PackLayout;

  const report: UnpackReport = { frames: 0, sheets: 0, absent: 0, rejected: [], scaleWarnings: [] };
  const shard = shardFromEnv();
  for (const [si, sheet] of layout.sheets.entries()) {
    if (shard !== null && si % shard.count !== shard.index) continue;
    const rgbPath = join(packDoneDir, sheet.rgb);
    const alphaPath = join(packDoneDir, sheet.alpha);
    const hasRgb = existsSync(rgbPath);
    const hasAlpha = existsSync(alphaPath);
    if (!hasRgb && !hasAlpha) {
      report.absent++;
      continue;
    }
    if (!hasRgb || !hasAlpha) {
      report.rejected.push({ sheet: sheet.name, detail: `缺 ${hasRgb ? 'alpha' : 'rgb'} 拼图` });
      continue;
    }

    // 先只读 IHDR 验尺寸：不合规的整张拒收，不必白解两张大图
    const rgbSize = pngSize(rgbPath);
    const alphaSize = pngSize(alphaPath);
    if (rgbSize === null || alphaSize === null) {
      report.rejected.push({ sheet: sheet.name, detail: `${rgbSize === null ? 'rgb' : 'alpha'} 拼图不是合法 PNG` });
      continue;
    }
    let k: number;
    try {
      k = checkSheetSizes(sheet, rgbSize, alphaSize);
    } catch (e) {
      if (!(e instanceof PackScaleError)) throw e;
      report.rejected.push({ sheet: sheet.name, detail: e.message });
      continue;
    }
    const offScale = [...new Set(sheet.cells.filter((c) => c.scale !== k).map((c) => c.scale))];
    if (offScale.length > 0) {
      report.scaleWarnings.push(`${sheet.name}：回传 ×${k}，队列定的是 ×${offScale.join('/')}（merge 会按尺寸拒收）`);
    }

    // rgb 与 alpha 先后各解一张、切完即放手 —— 峰值只有一张大图
    for (const kind of ['rgb', 'alpha'] as const) {
      const img = decodePng(new Uint8Array(readFileSync(kind === 'rgb' ? rgbPath : alphaPath)));
      for (const cell of sheet.cells) {
        const out = join(doneDir, kind === 'rgb' ? cell.rgb : cell.alpha);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, encodePng(cutCell(img, cell, k)));
      }
    }
    report.sheets++;
    report.frames += sheet.cells.length;
  }

  console.log(`切回 ${report.frames} 帧（${report.sheets} / ${layout.sheets.length} 张拼图）→ ${doneDir}/`);
  if (report.absent > 0) console.log(`${report.absent} 张拼图尚未交回。`);
  if (report.rejected.length > 0) {
    console.log(`\n⚠️ 拒收 ${report.rejected.length} 张拼图：`);
    for (const r of report.rejected.slice(0, 20)) console.log(`  ${r.sheet}  ${r.detail}`);
    if (report.rejected.length > 20) console.log(`  …还有 ${report.rejected.length - 20} 张`);
  }
  if (report.scaleWarnings.length > 0) {
    console.log(`\n⚠️ 倍率与队列不符：`);
    for (const w of report.scaleWarnings.slice(0, 20)) console.log(`  ${w}`);
  }
  console.log(`下一步：upscale merge <queue> ${doneDir}`);
  return report;
}

// ============================================================
//  merge —— 回填校验 + Alpha 合并 + 去彩边（T-062）
// ============================================================

/**
 * 校验并合并 <doneDir>/rgb|alpha 里的超分产物：
 *   <doneDir>/merged/<档案>/<资源>_f<帧>.png   合格的 RGBA 帧（锚点已 ×倍率）
 *   <doneDir>/merge-report.json               合格/拒收/缺漏全名单
 *
 * 不合格的一律不合并、不写出，只在报告里列出原因（尺寸错、
 * 缺 alpha、rgb/alpha 互不一致、产物与输入哈希相同）。
 */
export function cmdMerge(queueDir: string, doneDir: string): void {
  const queueManifestPath = join(queueDir, 'manifest.json');
  if (!existsSync(queueManifestPath)) {
    throw new Error(`找不到 ${queueManifestPath}，先跑 slice。`);
  }
  const queue = JSON.parse(readFileSync(queueManifestPath, 'utf8')) as QueueManifest;

  const rejections: MergeRejection[] = [];
  const mergedIds: string[] = [];
  let absent = 0;
  const shard = shardFromEnv();

  for (const [fi, frame] of queue.frames.entries()) {
    if (shard !== null) {
      const huge = frame.width * frame.height * frame.scale * frame.scale > SHARD_HUGE_PX;
      if (huge ? shard.index !== 0 : fi % shard.count !== shard.index) continue;
    }
    const rgbRel = frame.rgb.replace(/^rgb\//, '');
    const alphaRel = frame.alpha.replace(/^alpha\//, '');
    const rgbPath = join(doneDir, 'rgb', rgbRel);
    const alphaPath = join(doneDir, 'alpha', alphaRel);
    let rgb = existsSync(rgbPath) ? decodePng(new Uint8Array(readFileSync(rgbPath))) : null;
    let alpha = existsSync(alphaPath) ? decodePng(new Uint8Array(readFileSync(alphaPath))) : null;

    // exactOptionalPropertyTypes：不能塞 undefined，只能不给这个键。
    const hashes: { rgbSha256?: string; alphaSha256?: string } = {};
    if (rgb !== null) hashes.rgbSha256 = sha256(rgbPath);
    if (alpha !== null) hashes.alphaSha256 = sha256(alphaPath);
    const verdict = validatePair(frame, rgb, alpha, hashes);
    if (verdict.kind === 'absent') {
      absent++;
      continue;
    }
    if (verdict.kind === 'reject') {
      rejections.push(verdict.rejection);
      continue;
    }

    // 交出去的那张 1× rgb（已 bleed）—— 边缘带取它的颜色（`edge.ts`）
    const origPath = join(queueDir, frame.rgb);
    const original = existsSync(origPath) ? decodePng(new Uint8Array(readFileSync(origPath))) : undefined;
    const merged = mergeUpscaled(rgb!, alpha!, frame.scale, original);
    // ★ 合并完就把交出去的那两张解开的图放掉（Q-GND-4 的底图：9216² 每张 324MB）。
    //   下面 encodePng 自己还要开一份整幅的缓冲，两者叠起来就是这一步的峰值 ——
    //   实测（底图 9216²）：不放手时 arrayBuffers 峰值 2030MB，放手后少 648MB。
    //   顺带一提：`mergeUpscaled` 已经把像素抄进 merged 了，这里不碰它们。
    rgb = null;
    alpha = null;
    // 锚点同步 ×倍率（C-AST-6）；尺寸已经校验恰为 原图×scale
    const anchored = {
      ...merged,
      anchorX: frame.anchorX * frame.scale,
      anchorY: frame.anchorY * frame.scale,
    };
    const outPath = join(doneDir, 'merged', rgbRel);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, encodePng(anchored));
    mergedIds.push(frame.id);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    merged: mergedIds,
    rejected: rejections,
    absent,
  };
  mkdirSync(doneDir, { recursive: true });
  // 分片跑时各写各的报告（merge-report.2of6.json），不互相覆盖
  const reportName = shard === null ? 'merge-report.json' : `merge-report.${shard.index}of${shard.count}.json`;
  writeFileSync(join(doneDir, reportName), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`合并 ${mergedIds.length} 帧 → ${join(doneDir, 'merged')}/`);
  if (rejections.length > 0) {
    console.log(`\n⚠️ 拒收 ${rejections.length} 项：`);
    for (const r of rejections.slice(0, 20)) console.log(`  ${r.id}  [${r.reason}] ${r.detail}`);
    if (rejections.length > 20) console.log(`  …还有 ${rejections.length - 20} 项`);
  }
  if (absent > 0) console.log(`\n${absent} 帧尚未交出产物。`);
  console.log(`报告：${join(doneDir, reportName)}`);
}

// ============================================================
//  assemble —— 落进 assets/hd + 写清单（T-063）
// ============================================================

/**
 * 把 merge 的产物摆进 `assets/hd/<档案>/<资源>-<图>.png`，并把 manifest 记账。
 *
 * 与 merge 的分工：merge 只管像素（校验 + 盖回 RGBA），本步管**命名与记账**
 * ——两套命名（队列的 `<资源>_f<帧>` 与 client 要读的 `<资源>-<图>`）之间的
 * 翻译只在这里发生一次。
 *
 * @param model 覆盖模型名；不给就用队列里记的每帧建议模型
 */
export function cmdAssemble(queueDir: string, doneDir: string, hdDir: string, model?: string): void {
  const queueManifestPath = join(queueDir, 'manifest.json');
  if (!existsSync(queueManifestPath)) {
    throw new Error(`找不到 ${queueManifestPath}，先跑 slice。`);
  }
  const queue = JSON.parse(readFileSync(queueManifestPath, 'utf8')) as QueueManifest;

  const io: AssembleIo = {
    readMerged: (rel) => {
      const p = join(doneDir, 'merged', rel);
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
    hash: sha256Bytes,
    write: (rel, bytes) => {
      const p = join(hdDir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    },
  };

  const before = loadManifest(hdDir);
  // exactOptionalPropertyTypes：model 缺省时不给这个键
  const { manifest, report } = assembleHd(before, queue, io, model === undefined ? {} : { model });
  saveManifest(hdDir, manifest);

  console.log(`落盘 ${report.written.length} 张 → ${hdDir}/`);
  if (report.skipped.length > 0) console.log(`跳过 ${report.skipped.length} 张（产物哈希未变，一个字节都没重写）。`);
  if (report.missing.length > 0) console.log(`${report.missing.length} 帧尚未交出产物。`);
  if (report.unplanned.length > 0) {
    console.log(`\n⚠️ ${report.unplanned.length} 帧在清单里没有对应任务（队列换过版本？）：`);
    for (const id of report.unplanned.slice(0, 10)) console.log(`  ${id}`);
  }
  if (report.broken.length > 0) {
    console.log(`\n⚠️ ${report.broken.length} 帧产物不可用（未落盘）：`);
    for (const b of report.broken.slice(0, 20)) console.log(`  ${b.id}  ${b.detail}`);
    if (report.broken.length > 20) console.log(`  …还有 ${report.broken.length - 20} 项`);
  }
  console.log(`\n清单：${manifestPath(hdDir)}`);
}

// ============================================================
//  gate —— 回缩比对自动闸（W-80 §4.1）
// ============================================================

/** gate 报告：与 hd 目录**同级**，同清单的放法（`<hd>-gate-report.json`） */
function gateReportPath(hdDir: string): string {
  return join(dirname(hdDir), `${basename(hdDir)}-gate-report.json`);
}

/**
 * 把清单里每张有结果的 HD 产物面积平均缩回原尺寸，与 assets-clean 的原图比
 * 轮廓 IoU 与色差（见 `gate.ts`）。结果写 `<hd>-gate-report.json`，并打印最差的几条。
 *
 * 文件缺失、比原图还小的产物一律记为不过 —— 它们也是「要人去看」的。
 *
 * @returns 报告（CLI 入口据 `summary.failed` 决定退出码；函数本身不动 process）
 */
export function cmdGate(
  hdDir: string,
  cleanDir: string,
  /** 给了就全批一个口径；不给 = 按每张记录的模型名自动分档（`profileForModel`） */
  thresholds?: GateThresholds,
): GateReport {
  const manifest = loadManifest(hdDir);
  const rows: GateRow[] = [];
  const withResult = manifest.tasks.filter((t) => manifest.results[t.id] !== undefined);

  for (const task of withResult) {
    const rel = hdRelativePath(task.archive, task.resource, task.image);
    const hdPath = join(hdDir, rel);
    const srcPath = join(cleanDir, task.input);
    const fail = (reason: string): void => {
      rows.push({ id: task.id, hd: rel, pass: false, reasons: [reason] });
    };
    if (!existsSync(hdPath)) {
      fail(`缺 hd 产物 ${rel}`);
      continue;
    }
    if (!existsSync(srcPath)) {
      fail(`缺原图 ${task.input}`);
      continue;
    }
    try {
      const original = decodePng(new Uint8Array(readFileSync(srcPath)));
      const hd = decodePng(new Uint8Array(readFileSync(hdPath)));
      const t = thresholds ?? GATE_PROFILES[profileForModel(manifest.results[task.id]?.model ?? '')];
      rows.push({ id: task.id, hd: rel, ...gateCompare(original, hd, t) });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    if (rows.length % 500 === 0) console.log(`  …已比 ${rows.length} / ${withResult.length}`);
  }

  const report: GateReport = {
    generatedAt: new Date().toISOString(),
    thresholds: thresholds ?? GATE_PROFILES.faithful,
    summary: summarizeGate(rows),
    rows,
  };
  writeFileSync(gateReportPath(hdDir), `${JSON.stringify(report, null, 2)}\n`);

  const s = report.summary;
  console.log(
    `回缩比对 ${s.checked} 张：过 ${s.passed}、打回 ${s.failed}` +
      (thresholds === undefined
        ? '（按做法分档：忠实 8 / 25、重绘 10 / 30，IoU ≥ 0.97）'
        : `（阈值 IoU ≥ ${thresholds.minIou}、均值 ΔE ≤ ${thresholds.maxMeanDeltaE}、95 分位 ΔE ≤ ${thresholds.maxP95DeltaE}）`),
  );
  if (withResult.length < manifest.tasks.length) {
    console.log(`  另有 ${manifest.tasks.length - withResult.length} 张还没有产物，未比。`);
  }
  const worst = worstRows(rows);
  if (worst.length > 0) {
    console.log(`\n⚠️ 最差的 ${worst.length} 张：`);
    for (const r of worst) {
      const metrics =
        r.iou === undefined
          ? ''
          : `IoU ${r.iou.toFixed(4)}  ΔE 均 ${r.meanDeltaE!.toFixed(2)} / p95 ${r.p95DeltaE!.toFixed(2)}  `;
      console.log(`  ${r.id}  ${metrics}${r.reasons.join('；')}`);
    }
  }
  console.log(`报告：${gateReportPath(hdDir)}`);
  return report;
}

// ============================================================
//  seams —— 底图的接缝检查（T-064，真实输入）
// ============================================================

/** 一张底图查完的结果 */
export interface GroundSeamSummary {
  /** 地图号（`global_map_id` = 资源号 / 2） */
  map: number;
  id: string;
  width: number;
  height: number;
  scale: number;
  /** 32px 格线上比了多少条（`compareTileSeams`） */
  gridChecked: number;
  /** 格线上报出的新增接缝 */
  gridSeams: number;
  /** 逐列/逐行全扫比了多少条（`compareAllSeams`） */
  allChecked: number;
  /** 全扫报出的新增接缝（含格线上的） */
  allSeams: number;
  /** ★ **非**格线上的新增接缝 —— 逐块放大那条路根本查不到的东西 */
  offGridSeams: number;
  /** 增量最大的一条 */
  worst: AllSeamHit | null;
}

/**
 * 底图的接缝检查 —— **T-064 一直缺的那个「真实输入」**（Q-GND-4）。
 *
 * 之所以要单独一步，是因为接缝判据是**相对**的：必须同时拿到**原图**与**放大图**
 * 两张才能算「放大后变差了多少」。`review` 只管并排看，`merge` 只管像素合格与否，
 * 都不看接缝。
 *
 * 两套口径各跑一遍（见 `seams.ts`）：
 *   · `compareTileSeams` —— 原版 32px 格线，逐块放大那条路的判据；
 *   · `compareAllSeams`  —— 逐列/逐行全扫，**整张放大**这条路的判据
 *     （模型内部分块线不在 32px 网格上，前者一条也查不到）。
 *
 * @param maps 只查这几张地图；不给就查全部有产物的底图
 */
export function cmdSeams(hdDir: string, cleanDir: string, maps?: readonly number[]): GroundSeamSummary[] {
  const manifest = loadManifest(hdDir);
  const grounds = manifest.tasks.filter(
    (t) => t.format === 'GND' && (maps === undefined || maps.includes(Math.floor(t.resource / 2))),
  );

  if (grounds.length === 0) {
    console.log('清单里没有底图任务 —— 先重新跑 cli-extract（底图从 Q-GND-4 起才进清单）再 plan。');
    return [];
  }

  const out: GroundSeamSummary[] = [];
  for (const task of grounds) {
    const map = Math.floor(task.resource / 2);
    const srcPath = join(cleanDir, task.input);
    const hdPath = join(hdDir, hdRelativePath(task.archive, task.resource, task.image));

    if (manifest.results[task.id] === undefined || !existsSync(hdPath)) {
      console.log(`  地图 ${map}：还没有放大产物（${hdRelativePath(task.archive, task.resource, task.image)}），跳过。`);
      continue;
    }
    if (!existsSync(srcPath)) {
      console.log(`  地图 ${map}：找不到原图 ${srcPath}，跳过。`);
      continue;
    }

    try {
      const origPng = decodePng(new Uint8Array(readFileSync(srcPath)));
      const upPng = decodePng(new Uint8Array(readFileSync(hdPath)));
      // `decodePng` 只给像素与尺寸；两条接缝判据要的 `tilesX/tilesY` 是**原版 32px 格**，
      // 由原图尺寸推出来（底图恒为 2304 = 72×32）——放大图只借用同一套格号。
      const tilesX = Math.round(origPng.width / GND_TILE_WIDTH);
      const tilesY = Math.round(origPng.height / GND_TILE_HEIGHT);
      const orig = asGroundImage(origPng, tilesX, tilesY);
      const up = asGroundImage(upPng, tilesX, tilesY);
      const grid = compareTileSeams(orig, up, { tilesX, tilesY });
      const all = compareAllSeams(orig, up);
      const offGrid = all.seams.filter((s) => !s.onGrid);
      const summary: GroundSeamSummary = {
        map,
        id: task.id,
        width: up.width,
        height: up.height,
        scale: all.scale,
        gridChecked: grid.checked,
        gridSeams: grid.seams.length,
        allChecked: all.checkedX + all.checkedY,
        allSeams: all.seams.length,
        offGridSeams: offGrid.length,
        worst: all.seams[0] ?? null,
      };
      out.push(summary);
      reportGround(summary);
    } catch (e) {
      // 尺寸不合规（不是恰好 ×scale）会让 compareTileSeams 抛错 —— 那是产物的问题，
      // 报出来而不是让整条命令炸掉，否则一张坏图会把其余地图的检查也挡住。
      console.log(`  地图 ${map}：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const bad = out.filter((s) => s.allSeams > 0);
  console.log(
    `\n查了 ${out.length} 张底图；${bad.length} 张有新增接缝` +
      `（其中 ${out.reduce((n, s) => n + s.offGridSeams, 0)} 条落在**非** 32px 格线上）。`,
  );
  return out;
}

/** 单张底图的检查结论 —— 有非格线接缝时把这一行顶出来 */
function reportGround(s: GroundSeamSummary): void {
  const mark = s.offGridSeams > 0 ? '★' : ' ';
  const tail =
    s.worst === null
      ? '未见新增接缝'
      : `最差 +${s.worst.increase.toFixed(2)} ΔE @ (${s.worst.pixel.x},${s.worst.pixel.y})${s.worst.onGrid ? '' : ' [非格线]'}`;
  console.log(
    `  ${mark} 地图 ${s.map}  ${s.width}×${s.height}（×${s.scale}）：` +
      `格线 ${s.gridSeams}/${s.gridChecked}、全扫 ${s.allSeams}/${s.allChecked}` +
      `（非格线 ${s.offGridSeams}）　${tail}`,
  );
}

// ============================================================
//  review —— 并排比对页（T-066）
// ============================================================

/**
 * 生成静态过审页：左原图（浏览器最近邻 4×）右 HD 产物。
 *
 * 输出默认放在 hd 目录**同级**的 `hd-review.html`，图片按相对路径引用，
 * 故直接双击打开即可（`file://` 也能看）。
 *
 * @param outFile 不给就写 `<hd 目录的同级>/hd-review.html`
 */
export function cmdReview(hdDir: string, cleanDir: string, outFile?: string): void {
  const manifest = loadManifest(hdDir);
  const out = outFile ?? join(dirname(hdDir), 'hd-review.html');

  // 图片相对**输出文件所在目录**引用，挪动 HTML 时整目录一起挪
  const outDir = dirname(out);
  const hdBase = relative(outDir, hdDir).replace(/\\/g, '/');
  const cleanBase = relative(outDir, cleanDir).replace(/\\/g, '/');

  const rows = buildReviewRows(manifest, {
    hdBase: hdBase === '' ? '.' : hdBase,
    cleanBase: cleanBase === '' ? '.' : cleanBase,
  });
  writeFileSync(out, renderReviewHtml(rows));

  console.log(`过审页：${out}　（${rows.length} / ${manifest.tasks.length} 张有产物）`);
  if (manifest.tasks.length > rows.length) {
    console.log(`  还有 ${manifest.tasks.length - rows.length} 张没有产物，未列入。`);
  }
}

// ============================================================
//  tier —— 分档输出（W-80 §4.5）
// ============================================================

/**
 * 由 4× 母版派生一档：`tier assets/hd assets/hd-2x 2`
 *   → `<out>/<hdRelativePath>`（面积平均缩到 原图 × 倍率；本就不大于的原样拷）
 *   → `<out>-manifest.json`（同一批任务，尺寸/锚点重算，模型名后缀 `+tier<倍率>x`）
 *
 * 只出 PNG（不引新依赖）；网页要 WebP 另行转码。
 */
export function cmdTier(hdDir: string, outDir: string, scale: number): void {
  const master = loadManifest(hdDir);
  const io: TierIo = {
    readMaster: (rel) => {
      const p = join(hdDir, rel);
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
    write: (rel, bytes) => {
      const p = join(outDir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    },
    hash: sha256Bytes,
  };
  const { manifest, report } = tierHd(master, scale, io);
  saveManifest(outDir, manifest);

  console.log(`派生 ×${scale} 档 → ${outDir}/：缩 ${report.scaled.length} 张、原样拷 ${report.copied.length} 张`);
  if (report.missing.length > 0) {
    console.log(`\n⚠️ ${report.missing.length} 张母版不可用（未写出、未记账）：`);
    for (const m of report.missing.slice(0, 20)) console.log(`  ${m.id}  ${m.detail}`);
    if (report.missing.length > 20) console.log(`  …还有 ${report.missing.length - 20} 张`);
  }
  console.log(`清单：${manifestPath(outDir)}`);
}

// ============================================================
//  status
// ============================================================

export function cmdStatus(hdDir: string): void {
  const m = loadManifest(hdDir);
  const done = Object.keys(m.results).length;
  const total = m.tasks.length;
  console.log(`进度 ${done} / ${total}（${total === 0 ? 0 : Math.round((done / total) * 100)}%）`);

  const byModel = new Map<string, number>();
  for (const r of Object.values(m.results)) {
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
  }
  if (byModel.size > 0) {
    console.log('已用模型：');
    for (const [model, n] of byModel) console.log(`  ${model}  ${n} 张`);
  }

  const remaining = m.tasks.filter((t) => m.results[t.id] === undefined);
  const s = summarize(remaining);
  if (remaining.length > 0) {
    console.log('待办：');
    for (const [batch, info] of Object.entries(s)) {
      console.log(`  ${batch.padEnd(7)} ${String(info.count).padStart(6)} 张  ×${info.scale}`);
    }
  }
}

// ============================================================
//  ingest
// ============================================================

/** 递归列出目录下的 PNG */
function listPngs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.toLowerCase().endsWith('.png')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * 回填「直接放进 hd 目录」的产物（旧路径，与 slice → … → assemble 二选一）。
 *
 * ★ W-80 §4.7 的修法：产物按素材原名（`Data/0000_000.png`）或按 client 读的名字
 *   （`hdRelativePath`，`Data/0-0.png`）放进来都认；按原名的**先挪到** `hdRelativePath`
 *   再记账（定位逻辑见 `locateIngestOutput`）。先前只认原名、也不挪，于是记了账的图
 *   client 一张都拉不到。
 *
 * ★ 幂等：挪过一次之后旧名文件就没了，重跑只会看到 canonical 那份；
 *   产物哈希与已记的结果相同就**不改记录**—— 否则 `assemble` 落的图会被
 *   ingest 用默认模型名 `unknown` 重记一遍，把配方冲掉。
 */
export function cmdIngest(cleanDir: string, hdDir: string, model: string): void {
  const m = loadManifest(hdDir);
  const exists = (rel: string): boolean => existsSync(join(hdDir, rel));

  let ingested = 0;
  let moved = 0;
  let unchanged = 0;
  const claimed = new Set<string>();
  const problems: string[] = [];

  for (const task of m.tasks) {
    const loc = locateIngestOutput(task, exists);
    if (loc.kind === 'absent') continue;
    const rel = loc.kind === 'legacy' ? loc.from : loc.rel;
    const file = join(hdDir, rel);
    claimed.add(rel);

    const size = pngSize(file);
    if (size === null) {
      problems.push(`${rel}: 不是合法 PNG`);
      continue;
    }
    // 放大后不该变小——这类错误多半是把源图复制过来了
    if (size.width < task.srcWidth || size.height < task.srcHeight) {
      problems.push(
        `${rel}: 输出 ${size.width}×${size.height} 小于源图 ${task.srcWidth}×${task.srcHeight}`,
      );
      continue;
    }

    // 校验过了才挪：不合格的留在原地，免得把一张坏图顶到 client 读的位置上
    let finalPath = file;
    if (loc.kind === 'legacy') {
      finalPath = join(hdDir, loc.to);
      mkdirSync(dirname(finalPath), { recursive: true });
      renameSync(file, finalPath);
      claimed.add(loc.to);
      moved++;
    }

    const outHash = sha256(finalPath);
    if (m.results[task.id]?.outHash === outHash) {
      unchanged++;
      continue;
    }
    const srcPath = join(cleanDir, task.input);
    m.results[task.id] = recordResult(task, {
      model,
      outWidth: size.width,
      outHeight: size.height,
      srcHash: existsSync(srcPath) ? sha256(srcPath) : '',
      outHash,
    });
    ingested++;
  }

  const skipped = listPngs(hdDir).filter((f) => !claimed.has(relative(hdDir, f).replace(/\\/g, '/'))).length;

  saveManifest(hdDir, m);
  console.log(
    `回填 ${ingested} 张（其中 ${moved} 张由原名挪到 hdRelativePath），` +
      `${unchanged} 张产物未变沿用旧记录，忽略 ${skipped} 个无对应任务的文件。`,
  );
  if (problems.length > 0) {
    console.log(`\n⚠️ ${problems.length} 个有问题：`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  …还有 ${problems.length - 20} 个`);
  }

  const srcHashes = new Map<string, string>();
  // 不按本次模型名筛：分路线跑时别的路线做完的也算做完（否则 Q 路线 ingest 会把 S/V/G 全报成待处理）
  const still = pendingTasks(m, srcHashes);
  console.log(`\n仍待处理 ${still.length} 张。`);
}

// ============================================================
//  入口
// ============================================================

/**
 * 把 `--名字 值`（或 `--名字=值`）形式的参数摘出来，余下的按原顺序当位置参数。
 * `numeric` 里的必须是数；`text` 里的必须是 `choices[名字]` 之一。
 *
 * @throws 未知的 `--名字`、缺值、值不是数或不在可选项里
 */
export function parseFlags(
  args: readonly string[],
  numeric: readonly string[],
  choices: Readonly<Record<string, readonly string[]>> = {},
): { positional: string[]; flags: Record<string, number>; text: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, number> = {};
  const text: Record<string, string> = {};
  const known = [...numeric, ...Object.keys(choices)];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    if (!known.includes(name)) throw new Error(`未知参数 --${name}（可用：${known.map((k) => `--${k}`).join(' ')}）`);
    const raw = inline ?? args[++i];
    const allowed = choices[name];
    if (allowed !== undefined) {
      if (raw === undefined || !allowed.includes(raw)) {
        throw new Error(`--${name} 只能是 ${allowed.join(' / ')}，收到 ${String(raw)}`);
      }
      text[name] = raw;
      continue;
    }
    const v = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(v)) throw new Error(`--${name} 需要一个数，收到 ${String(raw)}`);
    flags[name] = v;
  }
  return { positional, flags, text };
}

function main(argv: string[]): void {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'pack': {
      const { positional, flags, text } = parseFlags(rest, ['gutter', 'max'], { fill: ['flat', 'edge'] });
      if (positional.length < 2) {
        throw new Error('用法: pack <upscale-queue> <pack-dir> [--gutter 8] [--max 2048] [--fill flat|edge]');
      }
      const opts: PackOptions = {};
      if (flags['gutter'] !== undefined) opts.gutter = flags['gutter'];
      if (flags['max'] !== undefined) opts.max = flags['max'];
      if (text['fill'] === 'edge' || text['fill'] === 'flat') opts.fill = text['fill'];
      cmdPack(positional[0]!, positional[1]!, opts);
      break;
    }
    case 'unpack': {
      if (rest.length < 3) throw new Error('用法: unpack <pack-dir> <pack-done> <upscale-done>');
      const r = cmdUnpack(rest[0]!, rest[1]!, rest[2]!);
      if (r.rejected.length > 0) process.exitCode = 1;
      break;
    }
    case 'gate': {
      const { positional, flags } = parseFlags(rest, ['iou', 'mean-de', 'p95-de']);
      if (positional.length < 2) {
        throw new Error('用法: gate <hd> <assets-clean> [--iou 0.97] [--mean-de 8] [--p95-de 25]（不给 = 按模型名分档）');
      }
      // 一个阈值都没给 ⇒ 按模型名自动分档；给了任意一个 ⇒ 全批用这一套（缺的取忠实档）
      const custom = flags['iou'] !== undefined || flags['mean-de'] !== undefined || flags['p95-de'] !== undefined;
      const report = cmdGate(
        positional[0]!,
        positional[1]!,
        custom
          ? {
              minIou: flags['iou'] ?? GATE_PROFILES.faithful.minIou,
              maxMeanDeltaE: flags['mean-de'] ?? GATE_PROFILES.faithful.maxMeanDeltaE,
              maxP95DeltaE: flags['p95-de'] ?? GATE_PROFILES.faithful.maxP95DeltaE,
            }
          : undefined,
      );
      if (report.summary.failed > 0) process.exitCode = 1;
      break;
    }
    case 'tier': {
      if (rest.length < 3) throw new Error('用法: tier <hd> <out> <倍率>   例：tier assets/hd assets/hd-2x 2');
      const scale = Number(rest[2]);
      if (!(scale > 0) || !Number.isFinite(scale)) throw new Error(`倍率必须是正数：${rest[2]}`);
      cmdTier(rest[0]!, rest[1]!, scale);
      break;
    }
    case 'plan':
      if (rest.length < 2) throw new Error('用法: plan <assets-clean> <hd>');
      cmdPlan(rest[0]!, rest[1]!);
      break;
    case 'slice': {
      // `--only Data/381,Panel/0` —— 试点只切这几组（值是列表，不走 parseFlags）
      const at = rest.indexOf('--only');
      const only = at < 0 ? [] : (rest[at + 1] ?? '').split(',').filter((x) => x !== '');
      const args = at < 0 ? rest : [...rest.slice(0, at), ...rest.slice(at + 2)];
      if (args.length < 2) throw new Error('用法: slice <assets-clean> <upscale-queue> [前N张] [--only 档案/资源,…]');
      cmdSlice(args[0]!, args[1]!, args[2] === undefined ? undefined : Number(args[2]), only);
      break;
    }
    case 'merge':
      if (rest.length < 2) throw new Error('用法: merge <upscale-queue> <upscale-done>');
      cmdMerge(rest[0]!, rest[1]!);
      break;
    case 'assemble':
      if (rest.length < 3) throw new Error('用法: assemble <upscale-queue> <upscale-done> <hd> [模型名]');
      cmdAssemble(rest[0]!, rest[1]!, rest[2]!, rest[3]);
      break;
    case 'seams':
      if (rest.length < 2) throw new Error('用法: seams <hd> <assets-clean> [地图号…]');
      cmdSeams(
        rest[0]!,
        rest[1]!,
        rest.length > 2 ? rest.slice(2).map((n) => Number(n)) : undefined,
      );
      break;
    case 'review':
      if (rest.length < 2) throw new Error('用法: review <hd> <assets-clean> [输出.html]');
      cmdReview(rest[0]!, rest[1]!, rest[2]);
      break;
    case 'status':
      if (rest.length < 1) throw new Error('用法: status <hd>');
      cmdStatus(rest[0]!);
      break;
    case 'ingest':
      if (rest.length < 2) throw new Error('用法: ingest <assets-clean> <hd> [模型名]');
      cmdIngest(rest[0]!, rest[1]!, rest[2] ?? 'unknown');
      break;
    default:
      console.log(
        [
          '画质升级管线',
          '',
          '  plan     <assets-clean> <hd>            生成待办清单',
          '  slice    <assets-clean> <queue> [N] [--only 档案/资源,…]  按帧切片 + Alpha 分离（T-061）',
          '  pack     <queue> <pack-dir> [--gutter 8] [--max 2048] [--fill flat|edge]   同资源帧拼网格（防帧间闪烁）',
          '  unpack   <pack-dir> <pack-done> <upscale-done>          拼图按格切回逐帧',
          '  merge    <queue> <upscale-done>         回填校验 + Alpha 合并（T-062）',
          '  assemble <queue> <upscale-done> <hd>    落进 assets/hd + 写清单（T-063）[模型]',
          '  gate     <hd> <assets-clean> [--iou 0.97] [--mean-de 6] [--p95-de 15]   回缩比对自动闸',
          '  seams    <hd> <assets-clean> [地图号…]  地图底图的接缝检查（T-064，真实输入）',
          '  review   <hd> <assets-clean> [输出]     生成并排过审页（T-066）',
          '  tier     <hd> <out> <倍率>              由 4× 母版派生一档（如网页 2×）',
          '  status   <hd>                           看进度',
          '  ingest   <assets-clean> <hd> [模型]     回填已完成的产物（旧路径）',
          '',
          '  链路：plan → slice → [pack → 外部 AI → unpack] → merge → assemble → gate → seams → review → tier',
        ].join('\n'),
      );
  }
}

if (process.argv[1]?.endsWith('cli-upscale.ts')) {
  main(process.argv.slice(2));
}
