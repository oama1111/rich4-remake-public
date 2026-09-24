#!/usr/bin/env node
/*
 * W-80 全量 · Q 路线前置检查：哪些重绘候选上面还盖着「从它身上抠出来的」图层
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：node --experimental-strip-types tools/comfy/w80-overlay-bases.ts <work 目录>
 *   对 <work>/q-choice.json 里每张 Q 候选底图 B，在同一档案里找图层 O：O 的不透明像素与 B 某块
 *   （允许 ±12 的调色板误差，FLIC 自带调色板与 SMP 不完全一致）有 ≥ 30% 对得上 ⇒ O 是从 B 上抠出来盖回去的。
 *   有这种图层的 B 写进 <work>/overlay-bases.json，`w80-choose-q.ts` 不给它换重绘版。
 *
 * ★ 为什么：重绘会整体挪色调（ΔE 均值 6～10），盖在上面的图层走的是忠实放大（ΔE ≈ 2），
 *   原版里两者像素相同、看不出边界；高清下就露出一个方框。实例：开场机舱 `jump/0045_000`
 *   上的开门动画 `jump/0046`（W-80 §6.3）。
 * ★ 启发式：用网格上 25 根 6 像素探针（颜色 >>4 分桶）找候选位置，再隔点比全块。宁可多报
 *   （多报只是少用一张重绘图），不追求零误报。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../packages/assets-pipeline/src/png.ts';

const RUN = 6;
const TOL = 12;
const MIN_MATCH = 0.3;

const work = process.argv[2];
if (work === undefined) throw new Error('用法: w80-overlay-bases.ts <work 目录>');
const clean = JSON.parse(readFileSync(join(work, 'assets-clean/manifest.json'), 'utf8')).images as {
  archive: string;
  resource: number;
  image: number;
  file: string;
}[];
const idOf = (i: (typeof clean)[0]): string => `${i.archive}/${String(i.resource).padStart(4, '0')}_${String(i.image).padStart(3, '0')}`;
const routes = JSON.parse(readFileSync(join(work, 'routes.json'), 'utf8')) as { Q: string[] };
const qSet = new Set(routes.Q);
const load = (i: (typeof clean)[0]) => decodePng(new Uint8Array(readFileSync(join(work, 'assets-clean', i.file))));

function key(px: Uint8ClampedArray, o: number): string {
  let h = '';
  for (let k = 0; k < RUN * 4; k += 4) h += `${px[o + k]! >> 4},${px[o + k + 1]! >> 4},${px[o + k + 2]! >> 4};`;
  return h;
}

const out: Record<string, string[]> = {};
for (const b of clean.filter((i) => qSet.has(idOf(i)))) {
  const B = load(b);
  const idx = new Map<string, number[]>();
  for (let y = 0; y < B.height; y++) {
    for (let x = 0; x + RUN <= B.width; x++) {
      const k = key(B.rgba, (y * B.width + x) * 4);
      const l = idx.get(k);
      if (l === undefined) idx.set(k, [y * B.width + x]);
      else if (l.length < 32) l.push(y * B.width + x);
    }
  }
  const hits: string[] = [];
  for (const o of clean) {
    if (o === b || o.archive !== b.archive) continue;
    const O = load(o);
    if (O.width > B.width || O.height > B.height || O.width * O.height < 400) continue;
    const cands = new Set<string>();
    for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const y = Math.floor(O.height * fy);
        const x = Math.floor(O.width * fx - RUN / 2);
        if (x < 0) continue;
        let opaque = true;
        for (let k = 0; k < RUN; k++) if (O.rgba[(y * O.width + x + k) * 4 + 3]! < 255) opaque = false;
        if (!opaque) continue;
        const k = key(O.rgba, (y * O.width + x) * 4);
        if (/^(\d+),\1,\1;(\1,\1,\1;)+$/.test(k)) continue; // 纯灰/纯黑到处都是，不当探针
        for (const p of idx.get(k) ?? []) cands.add(`${(p % B.width) - x},${Math.floor(p / B.width) - y}`);
      }
    }
    for (const c of cands) {
      const [dx, dy] = c.split(',').map(Number) as [number, number];
      if (dx < 0 || dy < 0 || dx + O.width > B.width || dy + O.height > B.height) continue;
      let same = 0;
      let op = 0;
      for (let y = 0; y < O.height; y += 2) {
        for (let x = 0; x < O.width; x += 2) {
          const i = (y * O.width + x) * 4;
          if (O.rgba[i + 3]! < 255) continue;
          op++;
          const j = ((dy + y) * B.width + dx + x) * 4;
          if (
            Math.abs(O.rgba[i]! - B.rgba[j]!) <= TOL &&
            Math.abs(O.rgba[i + 1]! - B.rgba[j + 1]!) <= TOL &&
            Math.abs(O.rgba[i + 2]! - B.rgba[j + 2]!) <= TOL
          ) same++;
        }
      }
      if (op > 0 && same / op >= MIN_MATCH) {
        hits.push(`${idOf(o)}@${dx},${dy}`);
        break;
      }
    }
  }
  if (hits.length > 0) out[idOf(b)] = hits;
  console.log(`${idOf(b)}  ${hits.length === 0 ? '无' : hits.slice(0, 4).join(' ') + (hits.length > 4 ? ` …共 ${hits.length}` : '')}`);
}
writeFileSync(join(work, 'overlay-bases.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${Object.keys(out).length} 张候选上盖着抠图图层 → ${join(work, 'overlay-bases.json')}`);
