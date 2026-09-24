#!/usr/bin/env node
/*
 * W-80 全量 · G 路线：地图底图（2304²）分块重绘 → 羽化拼回
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   node --experimental-strip-types tools/comfy/w80-ground.ts split  <work 目录>
 *   node --experimental-strip-types tools/comfy/w80-ground.ts stitch <work 目录>
 *
 * split：读 <work>/routes.json 的 G 名单与 <work>/queue，把每张底图切成 576² 的块
 *   （步长 512 ⇒ 相邻块重叠 64 像素，最后一块贴齐右/下边），写 <work>/g-in/** 与 <work>/g.jobs.json。
 *   每块：Qwen 图生图（denoise 0.5，画布 1152²）→ SeedVR2 到 2304²（4×）。
 * stitch：把 <work>/g-done/** 的 4× 块按重叠区线性羽化拼回 9216²，写成 merge 认的
 *   <work>/upscale-done/rgb|alpha/map/<资源>_f000.png（alpha 全不透明）。
 *
 * ★ 为什么分块、为什么是低强度重绘：见 docs/tasks/W-80-hd-upgrade.md §5.1 —— 整张 2304² 进不了
 *   Qwen；纯 SeedVR2 会把原版 32×32 地砖之间本来就对不上的纹理锐化成方块；全量重绘会改字形与纹理。
 * ★ 逐行拼：9216² 的 RGBA 一张就 340 MB，不开整幅浮点累加器，只留当前行涉及的那几块。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from '../../packages/assets-pipeline/src/png.ts';

export const TILE = 576;
export const STRIDE = 512;
/** 4× 下羽化带宽（= 源图 64 像素重叠 × 4） */
const SCALE = 4;
const FEATHER = (TILE - STRIDE) * SCALE;

const PROMPT =
  '把这张俯视游戏地图的局部重绘成高清版本。严格保持构图、道路与地块格线的位置、海岸线形状、配色完全不变，' +
  '不要增加或删除任何元素，文字保持原样。只提升清晰度与细节：草地、岩石、沙滩、海浪纹理更细腻。' +
  '画风：2000 年代初的 Q 版 3D 预渲染 CG 游戏美术。';
const NEGATIVE = '模糊, 噪点, 压缩伪影, 文字变形, 新增物体, 删除物体, 改变构图, 改变配色, 写实照片风格, 动漫线稿, 水印';

/** 一条轴上的块起点：0, 512, …，最后一块贴齐末端 */
export function tileStarts(size: number): number[] {
  const out: number[] = [];
  for (let s = 0; s + TILE < size; s += STRIDE) out.push(s);
  out.push(size - TILE);
  return [...new Set(out)];
}

interface Frame {
  id: string;
  rgb: string;
  alpha: string;
  width: number;
  height: number;
}

function load(work: string): { g: Frame[] } {
  const routes = JSON.parse(readFileSync(join(work, 'routes.json'), 'utf8')) as { G: string[] };
  const frames = new Map(
    (JSON.parse(readFileSync(join(work, 'queue/manifest.json'), 'utf8')) as { frames: Frame[] }).frames.map((f) => [f.id, f]),
  );
  return { g: routes.G.map((id) => frames.get(id)!).filter((f) => f !== undefined) };
}

const tileName = (f: Frame, ty: number, tx: number): string => `${f.rgb.replace(/^rgb\//, '').replace(/\.png$/, '')}/t${ty}_${tx}.png`;

function split(work: string): void {
  const { g } = load(work);
  const jobs: unknown[] = [];
  for (const f of g) {
    const img = decodePng(new Uint8Array(readFileSync(join(work, 'queue', f.rgb))));
    for (const sy of tileStarts(img.height)) {
      for (const sx of tileStarts(img.width)) {
        const rgba = new Uint8ClampedArray(TILE * TILE * 4);
        for (let y = 0; y < TILE; y++) rgba.set(img.rgba.subarray(((sy + y) * img.width + sx) * 4, ((sy + y) * img.width + sx + TILE) * 4), y * TILE * 4);
        const rel = tileName(f, sy, sx);
        const local = join('g-in', rel);
        mkdirSync(dirname(join(work, local)), { recursive: true });
        writeFileSync(join(work, local), encodePng({ width: TILE, height: TILE, anchorX: 0, anchorY: 0, rgba }));
        jobs.push({
          id: `G-${rel.replace(/[/.]/g, '-')}`,
          kind: 'qwen-repaint',
          upload: local,
          input: `rich4-pilot/work/g/${rel}`,
          out: join('g-done', rel),
          width: TILE * SCALE,
          height: TILE * SCALE,
          seed: 20260923,
          prompt: PROMPT,
          negative: NEGATIVE,
          resolution: 0,
          repaintWidth: TILE * 2,
          repaintHeight: TILE * 2,
          denoise: 0.5,
          steps: 30,
        });
      }
    }
  }
  writeFileSync(join(work, 'g.jobs.json'), `${JSON.stringify({ jobs }, null, 1)}\n`);
  console.log(`G 路线 ${g.length} 张底图 → ${jobs.length} 块 → ${join(work, 'g.jobs.json')}`);
}

/** 块内某点的羽化权重：挨着别的块的那几条边在 FEATHER 宽度内线性降到 0；贴图边的边不降 */
function weight(p: number, start: number, size: number, full: number): number {
  const lo = start === 0 ? Infinity : p - start;
  const hi = start + size === full ? Infinity : start + size - 1 - p;
  return Math.max(1e-3, Math.min(1, (Math.min(lo, hi) + 0.5) / FEATHER));
}

function stitch(work: string): void {
  const { g } = load(work);
  for (const f of g) {
    const W = f.width * SCALE;
    const H = f.height * SCALE;
    const xs = tileStarts(f.width).map((s) => s * SCALE);
    const ys = tileStarts(f.height).map((s) => s * SCALE);
    const T = TILE * SCALE;
    // alpha 最后写 ⇒ 它在就说明这张已拼完（重跑收尾脚本不重拼）
    if (existsSync(join(work, 'upscale-done', f.alpha))) {
      console.log(`${f.id}：已拼过，跳过`);
      continue;
    }
    const missing = ys.flatMap((sy) => xs.map((sx) => join(work, 'g-done', tileName(f, sy / SCALE, sx / SCALE)))).filter((p) => !existsSync(p));
    if (missing.length > 0) {
      console.log(`${f.id}：还缺 ${missing.length} 块，跳过`);
      continue;
    }
    const out = new Uint8ClampedArray(W * H * 4);
    const cache = new Map<string, Uint8ClampedArray>();
    const tile = (sy: number, sx: number): Uint8ClampedArray => {
      const key = `${sy}_${sx}`;
      let t = cache.get(key);
      if (t === undefined) {
        const img = decodePng(new Uint8Array(readFileSync(join(work, 'g-done', tileName(f, sy / SCALE, sx / SCALE)))));
        if (img.width !== T || img.height !== T) throw new Error(`${key} 尺寸 ${img.width}×${img.height}，应为 ${T}²`);
        t = img.rgba;
        cache.set(key, t);
      }
      return t;
    };
    for (let y = 0; y < H; y++) {
      const rows = ys.filter((sy) => y >= sy && y < sy + T);
      // 这一行用不到的块放掉（逐行往下，块行只进不退）
      for (const key of [...cache.keys()]) if (!rows.includes(Number(key.split('_')[0]))) cache.delete(key);
      for (let x = 0; x < W; x++) {
        let r = 0;
        let gg = 0;
        let b = 0;
        let ws = 0;
        for (const sy of rows) {
          const wy = weight(y, sy, T, H);
          for (const sx of xs) {
            if (x < sx || x >= sx + T) continue;
            const wgt = wy * weight(x, sx, T, W);
            const i = ((y - sy) * T + (x - sx)) * 4;
            const t = tile(sy, sx);
            r += t[i]! * wgt;
            gg += t[i + 1]! * wgt;
            b += t[i + 2]! * wgt;
            ws += wgt;
          }
        }
        const o = (y * W + x) * 4;
        out[o] = Math.round(r / ws);
        out[o + 1] = Math.round(gg / ws);
        out[o + 2] = Math.round(b / ws);
        out[o + 3] = 255;
      }
    }
    const rgbPath = join(work, 'upscale-done', f.rgb);
    mkdirSync(dirname(rgbPath), { recursive: true });
    writeFileSync(rgbPath, encodePng({ width: W, height: H, anchorX: 0, anchorY: 0, rgba: out }));
    // 底图全不透明：alpha 就是一张全白（merge 的规范形，r=g=b=255）
    out.fill(255);
    const alphaPath = join(work, 'upscale-done', f.alpha);
    mkdirSync(dirname(alphaPath), { recursive: true });
    writeFileSync(alphaPath, encodePng({ width: W, height: H, anchorX: 0, anchorY: 0, rgba: out }));
    console.log(`${f.id} → ${W}×${H}`);
  }
}

const [cmd, work] = process.argv.slice(2);
if (work === undefined || (cmd !== 'split' && cmd !== 'stitch')) {
  console.log('用法: w80-ground.ts split|stitch <work 目录>');
  process.exitCode = 1;
} else if (cmd === 'split') split(work);
else stitch(work);
