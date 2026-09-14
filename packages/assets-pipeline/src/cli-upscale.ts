#!/usr/bin/env node
/*
 * 画质升级 CLI —— 与外部超分工具的交接
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   plan   <assets-clean 目录> <hd 目录>          生成待办清单
 *   status <hd 目录>                              看进度
 *   ingest <assets-clean 目录> <hd 目录>          回填已完成的产物
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
  console.log(`\n下一步：把 ${cleanDir} 里的图按批次喂给你的超分工具，`);
  console.log(`产物放到 ${hdDir}/<档案>/<同名文件>，然后跑 ingest 回填。`);
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
          '  plan   <assets-clean> <hd>          生成待办清单',
          '  slice  <assets-clean> <queue> [N]   按帧切片 + Alpha 分离（T-061）',
          '  status <hd>                         看进度',
          '  ingest <assets-clean> <hd> [模型]   回填已完成的产物',
        ].join('\n'),
      );
  }
}

if (process.argv[1]?.endsWith('cli-upscale.ts')) {
  main(process.argv.slice(2));
}
