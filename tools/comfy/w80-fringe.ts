#!/usr/bin/env node
/*
 * W-80 · S 路线放大前的外圈换色：轮廓不动，最外一圈像素的颜色换成内侧邻居的
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   node --experimental-strip-types tools/comfy/w80-fringe.ts <work 目录> <输出目录> [--strip | --bg keep|flat] [拼图名…]
 *     `--strip`：剔掉脏外圈（连 alpha 一起），另写 <输出目录>/alpha/<拼图>.png
 *     读 <work>/pack/rgb|alpha/<拼图>.png（1×），写 <输出目录>/rgb/<拼图>.png。不给拼图名 = 全部。
 *
 * ★ 为什么（需求方 2026-09-23）：预渲染角色的最外一圈是深色背景残色（抗锯齿混进去的），
 *   放大后 AI 把它当成描边往外补，merge 的 `edge.ts` 事后再压也压不干净。
 *   需求方的主意是「先剔掉最外一圈再放大」；直接剔会让角色瘦一圈、1–2 像素宽的细节（发丝、天线）消失，
 *   所以改成**只换颜色**：外圈像素取相邻内侧像素的均色，alpha 不动。内侧没有邻居（本身就只有
 *   1–2 像素宽）的保留原色。透明区见 `FringeBg`。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { decodePng, encodePng } from '../../packages/assets-pipeline/src/png.ts';
import { GUTTER_RGB } from '../../packages/assets-pipeline/src/grid.ts';

/** alpha ≥ 128 算不透明（与 edge.ts 的轮廓定义一致） */
const OPAQUE = 128;

/**
 * @param rgb   1× 颜色（RGBA，只用 RGB）
 * @param alpha 1× 透明度（灰度图，取 R）
 * @returns 换色 + 重新出血后的 RGBA（alpha 恒 255，与交给 AI 的 rgb 拼图同形）
 */
/**
 * 透明区怎么填：
 * - `keep`：保持原拼图（切片时的出血 + 隔离带），只动外圈
 * - `flat`：一律填中性灰（与隔离带同色）—— 给 AI 一块干净的「背景布」
 * ⚠️ 不能从换过色的外圈重新出血铺满：整张图的透明区被角色颜色的菱形色块填满，
 *   AI 分不清角色与背景，整张当纹理放，出来是 1× 像素块（2026-09-24 小样实测）。
 */
export type FringeBg = 'keep' | 'flat';

export function recolorFringe(
  width: number,
  height: number,
  rgb: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  bg: FringeBg = 'keep',
): Uint8ClampedArray {
  const n = width * height;
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) opaque[i] = alpha[i * 4]! >= OPAQUE ? 1 : 0;
  const isOpaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && opaque[y * width + x] === 1;

  const ring = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (opaque[y * width + x] === 0) continue;
      if (!isOpaque(x - 1, y) || !isOpaque(x + 1, y) || !isOpaque(x, y - 1) || !isOpaque(x, y + 1)) ring[y * width + x] = 1;
    }
  }

  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let r = rgb[i * 4]!;
      let g = rgb[i * 4 + 1]!;
      let b = rgb[i * 4 + 2]!;
      if (opaque[i] === 0) {
        if (bg === 'flat') [r, g, b] = GUTTER_RGB;
      } else if (ring[i] === 1) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!isOpaque(nx, ny) || ring[ny * width + nx] === 1) continue;
            const j = ny * width + nx;
            sr += rgb[j * 4]!;
            sg += rgb[j * 4 + 1]!;
            sb += rgb[j * 4 + 2]!;
            k++;
          }
        }
        if (k > 0) {
          r = Math.round(sr / k);
          g = Math.round(sg / k);
          b = Math.round(sb / k);
        }
      }
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

/** 预渲染背景色（外圈像素色直方图的峰：深墨绿，2026-09-24 实测） */
const BG: readonly [number, number, number] = [30, 52, 26];
/** 背景成分超过这个比例 ⇒ 整个像素剔掉 */
const STRIP_BG = 0.6;
/** 像素偏离「内侧色 ↔ 背景色」连线太远 ⇒ 不是残色（正常的暗部 / 黑描边），不动 */
const STRIP_MAX_RESIDUAL = 28;
/** 最多剥几层（残色带有时 2 像素宽） */
const STRIP_PASSES = 2;

/**
 * 剔掉 / 还原脏外圈（需求方 2026-09-24：「先把人物周围那一圈杂色去掉，再高清」）。
 *
 * 外圈像素 p 看成「角色本色 f（内侧邻居均色）」与「预渲染背景 BG」的混合：p ≈ t·f + (1−t)·BG，
 * 投影求 t。背景成分 1−t > 0.6 ⇒ 剔掉（alpha 置 0）；否则按 t 反混回本色（p−(1−t)·BG)/t；
 * p 离这条连线太远（残差 > 28）⇒ 不是残色（正常暗部、黑描边），不动。最多两层。
 * ⚠️ 第一版按「比内侧暗 / 色差大」一刀切，会把 3D 渲染本来就暗的轮廓光一起剥掉（小偷的腿细了一半）。
 *
 * @returns 新 rgb（透明处中性灰，同 `--bg flat`）与新 alpha（灰度图）
 */
export function stripFringe(
  width: number,
  height: number,
  rgb: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
): { rgb: Uint8ClampedArray; alpha: Uint8ClampedArray } {
  const n = width * height;
  const a = new Uint8ClampedArray(n);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i] = alpha[i * 4]!;
    for (let k = 0; k < 3; k++) c[i * 3 + k] = rgb[i * 4 + k]!;
  }
  const opq = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && a[y * width + x]! >= OPAQUE;
  for (let pass = 0; pass < STRIP_PASSES; pass++) {
    const ring = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (opq(x, y) && (!opq(x - 1, y) || !opq(x + 1, y) || !opq(x, y - 1) || !opq(x, y + 1))) ring[y * width + x] = 1;
      }
    }
    const kill: number[] = [];
    const fix: [number, number, number, number][] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (ring[i] === 0) continue;
        const f = [0, 0, 0];
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!opq(nx, ny) || ring[ny * width + nx] === 1) continue;
            const j = (ny * width + nx) * 3;
            f[0] += c[j]!;
            f[1] += c[j + 1]!;
            f[2] += c[j + 2]!;
            k++;
          }
        }
        if (k === 0) continue;
        const d = [f[0]! / k - BG[0], f[1]! / k - BG[1], f[2]! / k - BG[2]];
        const q = [c[i * 3]! - BG[0], c[i * 3 + 1]! - BG[1], c[i * 3 + 2]! - BG[2]];
        const dd = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
        if (dd < 400) continue; // 本色与背景太像，分不开
        const t = Math.max(0, Math.min(1, (q[0]! * d[0]! + q[1]! * d[1]! + q[2]! * d[2]!) / dd));
        const res = Math.hypot(q[0]! - t * d[0]!, q[1]! - t * d[1]!, q[2]! - t * d[2]!);
        if (res > STRIP_MAX_RESIDUAL) continue;
        if (1 - t > STRIP_BG) kill.push(i);
        else if (t < 0.97) fix.push([i, BG[0] + q[0]! / t, BG[1] + q[1]! / t, BG[2] + q[2]! / t]);
      }
    }
    if (kill.length === 0 && fix.length === 0) break;
    for (const i of kill) a[i] = 0;
    for (const [i, r, g, b] of fix) {
      c[i * 3] = r;
      c[i * 3 + 1] = g;
      c[i * 3 + 2] = b;
    }
  }
  const outRgb = new Uint8ClampedArray(n * 4);
  const outA = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const keep = a[i]! >= OPAQUE;
    for (let k = 0; k < 3; k++) {
      outRgb[i * 4 + k] = keep ? Math.round(c[i * 3 + k]!) : GUTTER_RGB[k]!;
      outA[i * 4 + k] = a[i]!;
    }
    outRgb[i * 4 + 3] = 255;
    outA[i * 4 + 3] = 255;
  }
  return { rgb: outRgb, alpha: outA };
}

function main(): void {
  const args = process.argv.slice(2);
  const stripAt = args.indexOf('--strip');
  const strip = stripAt >= 0;
  if (strip) args.splice(stripAt, 1);
  const bgAt = args.indexOf('--bg');
  const bg = (bgAt >= 0 ? args.splice(bgAt, 2)[1] : 'keep') as FringeBg;
  if (bg !== 'keep' && bg !== 'flat') throw new Error(`--bg 只能是 keep|flat，收到 ${bg}`);
  const [work, outDir, ...names] = args;
  if (work === undefined || outDir === undefined) throw new Error('用法: w80-fringe.ts <work 目录> <输出目录> [--strip | --bg keep|flat] [拼图名…]');
  const layout = JSON.parse(readFileSync(join(work, 'pack/layout.json'), 'utf8')) as { sheets: { name: string; rgb: string; alpha: string }[] };
  const want = new Set(names);
  let done = 0;
  for (const s of layout.sheets) {
    if (want.size > 0 && !want.has(s.name)) continue;
    const rgb = decodePng(new Uint8Array(readFileSync(join(work, 'pack', s.rgb))));
    const alpha = decodePng(new Uint8Array(readFileSync(join(work, 'pack', s.alpha))));
    const out = join(outDir, s.rgb);
    mkdirSync(dirname(out), { recursive: true });
    if (strip) {
      // 剔过的 alpha 也要写：merge 得用它，否则剔掉的像素又被原 alpha 盖回来
      const r = stripFringe(rgb.width, rgb.height, rgb.rgba, alpha.rgba);
      writeFileSync(out, encodePng({ width: rgb.width, height: rgb.height, anchorX: 0, anchorY: 0, rgba: r.rgb }));
      const outA = join(outDir, s.alpha);
      mkdirSync(dirname(outA), { recursive: true });
      writeFileSync(outA, encodePng({ width: rgb.width, height: rgb.height, anchorX: 0, anchorY: 0, rgba: r.alpha }));
    } else {
      const rgba = recolorFringe(rgb.width, rgb.height, rgb.rgba, alpha.rgba, bg);
      writeFileSync(out, encodePng({ width: rgb.width, height: rgb.height, anchorX: 0, anchorY: 0, rgba }));
    }
    done++;
  }
  console.log(`外圈换色 ${done} 张拼图 → ${outDir}`);
}

// 路径含中文：import.meta.url 是百分号编码的，比 filename
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main();
