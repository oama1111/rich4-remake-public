#!/usr/bin/env node
/*
 * W-80 全量 · Q 路线（静态大图 Qwen 重绘 → SeedVR2）的输入与任务清单
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：node --experimental-strip-types tools/comfy/w80-prep-q.ts <work 目录>
 *   读 <work>/routes.json 的 Q 名单与 <work>/queue（slice 产物），
 *   写 <work>/q-in/**（填充后的输入）与 <work>/q.jobs.json。
 *
 * ★ 比例严格不变：重绘画布 = 原图 ×2 向上取到 32 的倍数；原图先在右/下两边**复制边缘像素**
 *   填到画布的一半，放大后再裁回 4w×4h（`pilot.ts` 的 `crop`）。
 * ★ 产物只是「候选」：之后用回缩比对闸的**重绘档**（10 / 30、IoU 0.97）与 S 路线的忠实版比，
 *   过闸才替换（`w80-choose-q.ts`）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from '../../packages/assets-pipeline/src/png.ts';

const PROMPT =
  '把这张游戏画面重绘成高清版本。严格保持构图、每个物体的位置与大小、轮廓、配色完全不变，' +
  '不要增加或删除任何元素，画面中的文字、数字与表格线保持原样。只提升清晰度与细节：材质、纹理与光影更干净细腻。' +
  '画风：2000 年代初的 Q 版 3D 预渲染 CG 游戏美术。';
const NEGATIVE = '模糊, 噪点, 压缩伪影, 文字变形, 新增物体, 删除物体, 改变构图, 改变配色, 写实照片风格, 动漫线稿, 水印';

const work = process.argv[2];
if (work === undefined) throw new Error('用法: w80-prep-q.ts <work 目录>');
const routes = JSON.parse(readFileSync(join(work, 'routes.json'), 'utf8')) as { Q: string[] };
const frames = new Map(
  (JSON.parse(readFileSync(join(work, 'queue/manifest.json'), 'utf8')) as { frames: { id: string; rgb: string; width: number; height: number }[] }).frames.map(
    (f) => [f.id, f],
  ),
);

const up32 = (v: number): number => Math.ceil(v / 32) * 32;
const jobs: unknown[] = [];
for (const id of routes.Q) {
  const f = frames.get(id);
  if (f === undefined) throw new Error(`队列里没有 ${id}`);
  const img = decodePng(new Uint8Array(readFileSync(join(work, 'queue', f.rgb))));
  const W2 = up32(img.width * 2);
  const H2 = up32(img.height * 2);
  const pw = W2 / 2;
  const ph = H2 / 2;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const s = (Math.min(y, img.height - 1) * img.width + Math.min(x, img.width - 1)) * 4;
      rgba.set(img.rgba.subarray(s, s + 4), (y * pw + x) * 4);
    }
  }
  const rel = f.rgb.replace(/^rgb\//, '');
  const local = join('q-in', rel);
  mkdirSync(dirname(join(work, local)), { recursive: true });
  writeFileSync(join(work, local), encodePng({ width: pw, height: ph, anchorX: 0, anchorY: 0, rgba }));
  jobs.push({
    id: `Q-${id.replace('/', '-')}`,
    kind: 'qwen-repaint',
    upload: local,
    input: `rich4-pilot/work/q/${rel}`,
    out: join('q-done', rel),
    width: W2 * 2,
    height: H2 * 2,
    crop: { w: img.width * 4, h: img.height * 4 },
    seed: 20260923,
    prompt: PROMPT,
    negative: NEGATIVE,
    resolution: 0,
    repaintWidth: W2,
    repaintHeight: H2,
    steps: 30,
  });
}
writeFileSync(join(work, 'q.jobs.json'), `${JSON.stringify({ jobs }, null, 1)}\n`);
console.log(`Q 路线 ${jobs.length} 个任务 → ${join(work, 'q.jobs.json')}`);
