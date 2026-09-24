// 给已有网格另出一份指定 σ 的模糊起始图：node soft-n.ts <角色号> <σ> <组名…>
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
const [ch, sigA, ...groups] = process.argv.slice(2); const sig = Number(sigA); const dir = `/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/c${ch}`;
for (const g of groups) { const im = decodePng(new Uint8Array(readFileSync(`${dir}/${g}.png`))); const { width: w, height: h } = im; const n = w * h, px = im.rgba;
  const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = px[i * 4 + 1]! - Math.max(px[i * 4]!, px[i * 4 + 2]!) > 60 ? 0 : 1;
  const R = Math.ceil(sig * 3), ker: number[] = []; for (let k = -R; k <= R; k++) ker.push(Math.exp(-k * k / (2 * sig * sig)));
  const pass = (src: Float32Array, hz: boolean) => { const o = new Float32Array(n * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const acc = [0, 0, 0, 0];
    for (let k = -R; k <= R; k++) { const xx = hz ? x + k : x, yy = hz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; for (let c = 0; c < 4; c++) acc[c]! += src[j * 4 + c]! * ker[k + R]!; }
    for (let c = 0; c < 4; c++) o[(y * w + x) * 4 + c] = acc[c]!; } return o; };
  const src = new Float32Array(n * 4); for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) src[i * 4 + c] = px[i * 4 + c]! * m[i]!; src[i * 4 + 3] = m[i]!; }
  const b = pass(pass(src, true), false); const o = new Uint8ClampedArray(px);
  for (let i = 0; i < n; i++) if (m[i]) for (let c = 0; c < 3; c++) o[i * 4 + c] = b[i * 4 + c]! / b[i * 4 + 3]!;
  writeFileSync(`${dir}/${g}-soft${sig}.png`, encodePng({ ...im, rgba: o })); }
