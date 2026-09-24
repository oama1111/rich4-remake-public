#!/usr/bin/env node
/*
 * W-80 全量 · Q 路线择优：重绘候选过「重绘档」闸才替换 S 路线的忠实版
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：node --experimental-strip-types tools/comfy/w80-choose-q.ts <work 目录> <hd 目录>
 *   在 S/V/G 都 assemble 进 <hd> 之后跑。对 <work>/q-done/** 的每张候选：
 *   与原图（<work>/assets-clean）做回缩比对（`GATE_PROFILES.repaint`：均值 ΔE ≤ 10、p95 ≤ 30、IoU ≥ 0.97），
 *   过了就覆盖 <hd> 里那张（之后跑 `upscale ingest … <qwen 模型名>` 记账 —— ingest 只重记变了的文件）；
 *   没过就留忠实版。结果写 <work>/q-choice.json。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../packages/assets-pipeline/src/png.ts';
import { gateCompare, GATE_PROFILES } from '../../packages/assets-pipeline/src/gate.ts';
import { hdRelativePath } from '../../packages/assets-pipeline/src/upscale.ts';

const [work, hd] = process.argv.slice(2);
if (work === undefined || hd === undefined) throw new Error('用法: w80-choose-q.ts <work 目录> <hd 目录>');
const routes = JSON.parse(readFileSync(join(work, 'routes.json'), 'utf8')) as { Q: string[] };
const clean = JSON.parse(readFileSync(join(work, 'assets-clean/manifest.json'), 'utf8')) as {
  images: { archive: string; resource: number; image: number; file: string }[];
};
const byId = new Map(
  clean.images.map((i) => [`${i.archive}/${String(i.resource).padStart(4, '0')}_${String(i.image).padStart(3, '0')}`, i]),
);

// 上面盖着从它身上抠出来的图层的底图不换（`w80-overlay-bases.ts`：重绘挪了色调，图层对不上会露方框）
const overlayPath = join(work, 'overlay-bases.json');
const overlays = existsSync(overlayPath) ? (JSON.parse(readFileSync(overlayPath, 'utf8')) as Record<string, string[]>) : {};

const choice: Record<string, unknown> = {};
let taken = 0;
for (const id of routes.Q) {
  const info = byId.get(id);
  if (info === undefined) continue;
  if (overlays[id] !== undefined) {
    choice[id] = { chosen: 'faithful', why: `上面盖着抠图图层：${overlays[id].slice(0, 3).join(' ')}` };
    continue;
  }
  const rel = `${info.archive}/${String(info.resource).padStart(4, '0')}_f${String(info.image).padStart(3, '0')}.png`;
  const cand = join(work, 'q-done', rel);
  if (!existsSync(cand)) {
    choice[id] = { chosen: 'faithful', why: '没有重绘候选' };
    continue;
  }
  const original = decodePng(new Uint8Array(readFileSync(join(work, 'assets-clean', info.file))));
  const m = gateCompare(original, decodePng(new Uint8Array(readFileSync(cand))), GATE_PROFILES.repaint);
  const target = join(hd, hdRelativePath(info.archive, info.resource, info.image));
  if (m.pass && existsSync(target)) {
    copyFileSync(cand, target);
    taken++;
  }
  choice[id] = {
    chosen: m.pass ? 'repaint' : 'faithful',
    meanDeltaE: +m.meanDeltaE.toFixed(2),
    p95DeltaE: +m.p95DeltaE.toFixed(2),
    iou: +m.iou.toFixed(4),
    ...(m.pass ? {} : { why: m.reasons.join('；') }),
  };
}
writeFileSync(join(work, 'q-choice.json'), `${JSON.stringify(choice, null, 1)}\n`);
console.log(`Q 择优：${routes.Q.length} 张候选，采用重绘 ${taken} 张，其余留忠实版 → ${join(work, 'q-choice.json')}`);
