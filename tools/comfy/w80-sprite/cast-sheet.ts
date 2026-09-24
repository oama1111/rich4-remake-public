// 角色成品总览：8 行（朝向），每行 = 骰子帧 + 站 + 走第 4 帧；可选 pre-tone 对比
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
const [chArg, out, which] = process.argv.slice(2); const ch = Number(chArg); const base = 128 + 21 * ch;
const root = `/Volumes/Kingston/大富翁4重制版/wt-hd/assets/${which ?? 'hd'}/Data/`;
const lay = JSON.parse(readFileSync(`/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/c${ch}/layout.json`, 'utf8'));
const nd = lay.dice0.frames.length, nw = lay.walk0.frames.length - 1;
const rows = Array.from({ length: 8 }, (_, d) => [...Array.from({ length: nd }, (_, i) => `${base + 2}-${d * nd + i}`), `${base}-${d}`, `${base + 1}-${d * nw + Math.floor(nw / 2)}`].map((n) => decodePng(new Uint8Array(readFileSync(root + n + '.png')))));
const cw = Math.max(...rows.flat().map((t) => t.width)), chh = Math.max(...rows.flat().map((t) => t.height)), n = rows[0]!.length, W = cw * n + 20, H = chh * 8, px = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0, v = ((x >> 4) + (y >> 4)) & 1 ? 205 : 170; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
rows.forEach((r, ri) => r.forEach((t, k) => { const ox = k * cw + (k >= nd ? 20 : 0); for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const i = (y * t.width + x) * 4, a = t.rgba[i + 3]! / 255, o = ((ri * chh + y) * W + ox + x) * 4; for (let c = 0; c < 3; c++) px[o + c] = t.rgba[i + c]! * a + px[o + c]! * (1 - a); } }));
writeFileSync(out!, encodePng({ width: W, height: H, anchorX: 0, anchorY: 0, rgba: px }));
