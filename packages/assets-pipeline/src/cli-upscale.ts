#!/usr/bin/env node
/*
 * 画质升级 CLI —— 与外部超分工具的交接
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   plan     <assets-clean> <hd>            生成待办清单
 *   slice    <assets-clean> <queue> [N]     按帧切片 + Alpha 分离（T-061）
 *   merge    <queue> <upscale-done>         回填校验 + Alpha 合并（T-062）
 *   assemble <queue> <upscale-done> <hd>    落进 assets/hd + 写清单（T-063）[模型]
 *   status   <hd>                           看进度
 *   ingest   <assets-clean> <hd> [模型]     回填已完成的产物（旧路径，见下）
 *
 * 交接链：plan → slice → [外部超分 4×] → merge → assemble。
 * `ingest` 保留给「产物直接按原名放进 hd 目录」的旧路径，与 assemble 二选一。
 *
 * ★ 交接方式刻意做成「文件 + 清单」而不是直接调某个模型的 API：
 *   这样你可以用任何工具（Real-ESRGAN、waifu2x、某个在线服务、
 *   甚至手工重绘）来处理，本管线只负责**切片、定倍率、回填、
 *   以及把锚点算对**（C-AST-6）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import {
  emptyManifest,
  pendingTasks,
  planUpscale,
  recordResult,
  summarize,
  type AssetEntryLike,
  type UpscaleManifest,
} from './upscale.ts';
import { decodePng, encodePng } from './sprite.ts';
import { buildQueueFrame, sliceFrame, type QueueManifest } from './slice.ts';
import { mergeUpscaled, validatePair, type MergeRejection } from './merge.ts';
import { assembleHd, type AssembleIo } from './assemble.ts';

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
  console.log(`  2. 用你的超分工具把 <queue>/rgb 与 <queue>/alpha 各自放大 4×（倍率必须一致），`);
  console.log(`     产物按同名路径放进 <upscale-done>/rgb 与 <upscale-done>/alpha`);
  console.log(`  3. merge   校验并合并：upscale merge <queue> <upscale-done>`);
  console.log(`  4. assemble 落进 ${hdDir}/ 并记账：upscale assemble <queue> <upscale-done> ${hdDir}`);
  console.log(`（旧路径：把产物直接按原名放进 ${hdDir}/<档案>/<同名文件>，然后跑 ingest 回填）`);
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
export function cmdSlice(cleanDir: string, queueDir: string, limit?: number): void {
  const entries = loadSourceManifest(cleanDir);
  const tasks = planUpscale(entries);
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

  for (const frame of queue.frames) {
    const rgbRel = frame.rgb.replace(/^rgb\//, '');
    const alphaRel = frame.alpha.replace(/^alpha\//, '');
    const rgbPath = join(doneDir, 'rgb', rgbRel);
    const alphaPath = join(doneDir, 'alpha', alphaRel);
    const rgb = existsSync(rgbPath) ? decodePng(new Uint8Array(readFileSync(rgbPath))) : null;
    const alpha = existsSync(alphaPath) ? decodePng(new Uint8Array(readFileSync(alphaPath))) : null;

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

    const merged = mergeUpscaled(rgb!, alpha!);
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
  writeFileSync(join(doneDir, 'merge-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`合并 ${mergedIds.length} 帧 → ${join(doneDir, 'merged')}/`);
  if (rejections.length > 0) {
    console.log(`\n⚠️ 拒收 ${rejections.length} 项：`);
    for (const r of rejections.slice(0, 20)) console.log(`  ${r.id}  [${r.reason}] ${r.detail}`);
    if (rejections.length > 20) console.log(`  …还有 ${rejections.length - 20} 项`);
  }
  if (absent > 0) console.log(`\n${absent} 帧尚未交出产物。`);
  console.log(`报告：${join(doneDir, 'merge-report.json')}`);
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

export function cmdIngest(cleanDir: string, hdDir: string, model: string): void {
  const m = loadManifest(hdDir);
  const byInput = new Map(m.tasks.map((t) => [t.input.replace(/\\/g, '/'), t]));

  let ingested = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const file of listPngs(hdDir)) {
    const rel = relative(hdDir, file).replace(/\\/g, '/');
    const task = byInput.get(rel);
    if (task === undefined) {
      skipped++;
      continue;
    }

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

    const srcPath = join(cleanDir, task.input);
    m.results[task.id] = recordResult(task, {
      model,
      outWidth: size.width,
      outHeight: size.height,
      srcHash: existsSync(srcPath) ? sha256(srcPath) : '',
      outHash: sha256(file),
    });
    ingested++;
  }

  saveManifest(hdDir, m);
  console.log(`回填 ${ingested} 张，忽略 ${skipped} 个无对应任务的文件。`);
  if (problems.length > 0) {
    console.log(`\n⚠️ ${problems.length} 个有问题：`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  …还有 ${problems.length - 20} 个`);
  }

  const srcHashes = new Map<string, string>();
  const still = pendingTasks(m, srcHashes, model);
  console.log(`\n仍待处理 ${still.length} 张。`);
}

// ============================================================
//  入口
// ============================================================

function main(argv: string[]): void {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'plan':
      if (rest.length < 2) throw new Error('用法: plan <assets-clean> <hd>');
      cmdPlan(rest[0]!, rest[1]!);
      break;
    case 'slice':
      if (rest.length < 2) throw new Error('用法: slice <assets-clean> <upscale-queue> [前N张]');
      cmdSlice(rest[0]!, rest[1]!, rest[2] === undefined ? undefined : Number(rest[2]));
      break;
    case 'merge':
      if (rest.length < 2) throw new Error('用法: merge <upscale-queue> <upscale-done>');
      cmdMerge(rest[0]!, rest[1]!);
      break;
    case 'assemble':
      if (rest.length < 3) throw new Error('用法: assemble <upscale-queue> <upscale-done> <hd> [模型名]');
      cmdAssemble(rest[0]!, rest[1]!, rest[2]!, rest[3]);
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
          '  slice    <assets-clean> <queue> [N]     按帧切片 + Alpha 分离（T-061）',
          '  merge    <queue> <upscale-done>         回填校验 + Alpha 合并（T-062）',
          '  assemble <queue> <upscale-done> <hd>    落进 assets/hd + 写清单（T-063）[模型]',
          '  status   <hd>                           看进度',
          '  ingest   <assets-clean> <hd> [模型]     回填已完成的产物（旧路径）',
        ].join('\n'),
      );
  }
}

if (process.argv[1]?.endsWith('cli-upscale.ts')) {
  main(process.argv.slice(2));
}
