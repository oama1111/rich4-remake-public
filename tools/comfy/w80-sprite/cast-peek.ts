// 报警帧：忠实版 | 重绘版 并排
import { readFileSync, writeFileSync } from 'node:fs';
import { encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { prepFrame } from './e-build.ts';
import { eFrame } from './e-post.ts';
const [ch, out, idsArg] = process.argv.slice(2); const dir = `/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/${/^[0-9]+$/.test(String(ch)) ? "c" + (ch) : (ch)}`;
const lay = JSON.parse(readFileSync(`${dir}/layout.json`, 'utf8'));
const tiles: any[] = [];
for (const id of idsArg!.split(',')) { const g = Object.keys(lay).find((k) => lay[k].frames.some((f: any) => f.id === id))!; const fr = lay[g].frames.find((f: any) => f.id === id); const prep = prepFrame(id);
  tiles.push(prep.A, eFrame('', g, fr, prep, `${dir}/${process.env.OUT ?? 'out2'}/${g}.repaint.png`).img); }
const cw = Math.max(...tiles.map((t) => t.width)), chh = Math.max(...tiles.map((t) => t.height)), W = cw * tiles.length, px = new Uint8ClampedArray(W * chh * 4);
for (let i = 0; i < W * chh; i++) { const x = i % W, y = (i / W) | 0, v = ((x >> 4) + (y >> 4)) & 1 ? 205 : 170; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
tiles.forEach((t, k) => { for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const i = (y * t.width + x) * 4, a = t.rgba[i + 3] / 255, o = (y * W + k * cw + x) * 4; for (let c = 0; c < 3; c++) px[o + c] = t.rgba[i + c] * a + px[o + c] * (1 - a); } });
writeFileSync(out!, encodePng({ width: W, height: chh, anchorX: 0, anchorY: 0, rgba: px }));
