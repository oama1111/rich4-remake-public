#!/usr/bin/env node
/*
 * W-80 · S 路线放大前的外圈换色：轮廓不动，最外一圈像素的颜色换成内侧邻居的
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   node --experimental-strip-types tools/comfy/w80-fringe.ts <work 目录> <输出目录> [--bg keep|flat] [拼图名…]
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

function main(): void {
  const args = process.argv.slice(2);
  const bgAt = args.indexOf('--bg');
  const bg = (bgAt >= 0 ? args.splice(bgAt, 2)[1] : 'keep') as FringeBg;
  if (bg !== 'keep' && bg !== 'flat') throw new Error(`--bg 只能是 keep|flat，收到 ${bg}`);
  const [work, outDir, ...names] = args;
  if (work === undefined || outDir === undefined) throw new Error('用法: w80-fringe.ts <work 目录> <输出目录> [--bg keep|flat] [拼图名…]');
  const layout = JSON.parse(readFileSync(join(work, 'pack/layout.json'), 'utf8')) as { sheets: { name: string; rgb: string; alpha: string }[] };
  const want = new Set(names);
  let done = 0;
  for (const s of layout.sheets) {
    if (want.size > 0 && !want.has(s.name)) continue;
    const rgb = decodePng(new Uint8Array(readFileSync(join(work, 'pack', s.rgb))));
    const alpha = decodePng(new Uint8Array(readFileSync(join(work, 'pack', s.alpha))));
    const rgba = recolorFringe(rgb.width, rgb.height, rgb.rgba, alpha.rgba, bg);
    const out = join(outDir, s.rgb);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng({ width: rgb.width, height: rgb.height, anchorX: 0, anchorY: 0, rgba }));
    done++;
  }
  console.log(`外圈换色 ${done} 张拼图 → ${outDir}`);
}

// 路径含中文：import.meta.url 是百分号编码的，比 filename
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main();
