#!/usr/bin/env node
/*
 * W-80 全量 · V 路线产物归位 + 按路线拆子队列
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：node --experimental-strip-types tools/comfy/w80-place-v.ts <work 目录>
 *   ① <work>/video-done/<档案>-<资源>/NNNN.png（按帧序）→ <work>/upscale-done/rgb/<档案>/<资源>_fNNN.png
 *      （alpha 由 w80-finish.sh 用 sips 把队列里的 1× alpha 放大 4×）
 *   ② 写 queue-V / queue-G 两个子队列（manifest 子集 + 指回 queue 的 rgb/alpha 链接），
 *      好让 assemble 按路线分别记模型名。queue-S 在打包时就建好了。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const work = process.argv[2];
if (work === undefined) throw new Error('用法: w80-place-v.ts <work 目录>');
const routes = JSON.parse(readFileSync(join(work, 'routes.json'), 'utf8')) as { V: string[]; G: string[] };
const q = JSON.parse(readFileSync(join(work, 'queue/manifest.json'), 'utf8')) as { frames: { id: string; rgb: string }[] };
const byId = new Map(q.frames.map((f) => [f.id, f]));

// ① 视频产物按帧序归位
const films = new Map<string, { id: string; rgb: string }[]>();
for (const id of routes.V) {
  const f = byId.get(id)!;
  const [archive, rest] = id.split('/') as [string, string];
  const key = `${archive}-${Number(rest.split('_')[0])}`;
  films.set(key, [...(films.get(key) ?? []), f]);
}
let placed = 0;
let missing = 0;
for (const [key, frames] of films) {
  frames.sort((a, b) => a.rgb.localeCompare(b.rgb));
  const dir = join(work, 'video-done', key);
  const outs = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.png')).sort() : [];
  if (outs.length !== frames.length) {
    console.log(`${key}：产物 ${outs.length} 帧、原片 ${frames.length} 帧，跳过`);
    missing += frames.length;
    continue;
  }
  frames.forEach((f, i) => {
    const to = join(work, 'upscale-done', f.rgb);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(dir, outs[i]!), to);
    placed++;
  });
}
console.log(`V 归位 ${placed} 帧（缺 ${missing}）`);

// ② 子队列
for (const [name, ids] of [
  ['queue-V', routes.V],
  ['queue-G', routes.G],
] as const) {
  const d = join(work, name);
  mkdirSync(d, { recursive: true });
  for (const sub of ['rgb', 'alpha']) if (!existsSync(join(d, sub))) symlinkSync(`../queue/${sub}`, join(d, sub));
  const all = JSON.parse(readFileSync(join(work, 'queue/manifest.json'), 'utf8')) as Record<string, unknown> & { frames: { id: string }[] };
  const want = new Set(ids);
  writeFileSync(join(d, 'manifest.json'), JSON.stringify({ ...all, frames: all.frames.filter((f) => want.has(f.id)) }));
}
console.log('子队列 queue-V / queue-G 已写');
