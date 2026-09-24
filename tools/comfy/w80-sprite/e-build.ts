// 小样 E：每角色 9 帧 3×3、6× 大画布、起始图 = A 去色带；写输入、布局、任务
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { cutCell } from '../../../packages/assets-pipeline/src/grid.ts';
import { mergeUpscaled } from '../../../packages/assets-pipeline/src/merge.ts';
import { bleedColors } from '../../../packages/assets-pipeline/src/slice.ts';
const W = process.env.RICH4_ASSETS ?? 'assets/work', P = W + '/fringe-pilot';
const L = JSON.parse(readFileSync(join(W, 'pack/layout.json'), 'utf8'));
const cells = new Map<string, any>(); for (const s of L.sheets) for (const c of s.cells) cells.set(c.id, { sheet: s, cell: c });
const cache = new Map<string, any>(); const load = (p: string) => { let v = cache.get(p); if (!v) { v = decodePng(new Uint8Array(readFileSync(p))); cache.set(p, v); } return v; };
function deband(img: any, R = 6, sigma = 10, iters = 2) { let cur = img.rgba; const { width: w, height: h } = img; const inv = 1 / (2 * sigma * sigma);
  for (let it = 0; it < iters; it++) { const nxt = new Uint8ClampedArray(cur); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (cur[i + 3] < 128) continue; let sr = 0, sg = 0, sb = 0, sw = 0;
    for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = (yy * w + xx) * 4; if (cur[j + 3] < 128) continue;
      const d = (cur[j] - cur[i]) ** 2 + (cur[j + 1] - cur[i + 1]) ** 2 + (cur[j + 2] - cur[i + 2]) ** 2; const wt = Math.exp(-d * inv); sr += cur[j] * wt; sg += cur[j + 1] * wt; sb += cur[j + 2] * wt; sw += wt; } }
    nxt[i] = sr / sw; nxt[i + 1] = sg / sw; nxt[i + 2] = sb / sw; } cur = nxt; } return { ...img, rgba: cur }; }
function resample(img: any, w: number, h: number) { const o = new Uint8ClampedArray(w * h * 4); const fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.max(0, (x + 0.5) * fx - 0.5), sy = Math.max(0, (y + 0.5) * fy - 0.5), x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
    for (let c = 0; c < 4; c++) { const p = (xx: number, yy: number) => img.rgba[(yy * img.width + xx) * 4 + c]; o[(y * w + x) * 4 + c] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty; } }
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba: o }; }
export function prepFrame(id: string) {
  const { sheet, cell } = cells.get(id)!;
  const sr = cutCell(load(join(P, 'in-strip', sheet.rgb)), cell, 1), sa = cutCell(load(join(P, 'in-strip', sheet.alpha)), cell, 1);
  const tmp = new Uint8ClampedArray(sr.rgba.length); for (let i = 0; i < tmp.length; i += 4) { tmp[i] = sr.rgba[i]; tmp[i + 1] = sr.rgba[i + 1]; tmp[i + 2] = sr.rgba[i + 2]; tmp[i + 3] = sa.rgba[i] >= 128 ? 255 : 0; }
  const bled = bleedColors(sr.width, sr.height, tmp); const orig1 = { ...sr, rgba: new Uint8ClampedArray(sr.rgba.length) };
  for (let i = 0, j = 0; i < orig1.rgba.length; i += 4, j += 3) { orig1.rgba[i] = bled[j]; orig1.rgba[i + 1] = bled[j + 1]; orig1.rgba[i + 2] = bled[j + 2]; orig1.rgba[i + 3] = 255; }
  const a4 = cutCell(load(join(P, 'in-strip/alpha4', sheet.alpha.replace(/^alpha\//, ''))), cell, 4);
  const A = deband(mergeUpscaled(cutCell(load(join(P, 'done-A', sheet.rgb)), cell, 4), a4, 4, orig1));
  return { cell, orig1, a4, A };
}
const K = 6, GUT = 48, GREEN = [0, 255, 0];
const up32 = (v: number) => Math.ceil(v / 32) * 32;
if (process.argv[1]?.endsWith('e-build.ts')) {
  // SETS=名:资源:起始帧[,…]（默认沿用最早两组）
  const spec = process.env.SETS ?? 'qian:0208:8,thief:0381:8';
  const sets: Record<string, string[]> = Object.fromEntries(spec.split(',').map((t) => { const [n, r, f] = t.split(':'); return [n!, Array.from({ length: 9 }, (_, i) => `Data/${r}_${String(Number(f) + i).padStart(3, '0')}`)]; }));
  const layPath = `${P}/e-layout.json`;
  let layout: any = {}; try { layout = JSON.parse(readFileSync(layPath, 'utf8')); } catch {}
  mkdirSync(P + '/e-in', { recursive: true });
  for (const [name, ids] of Object.entries(sets)) {
    const fr = ids.map(prepFrame);
    const cw = Math.max(...fr.map((f) => f.cell.width)) * K + GUT, ch = Math.max(...fr.map((f) => f.cell.height)) * K + GUT;
    const CW = up32(cw * 3 + GUT), CH = up32(ch * 3 + GUT);
    const px = new Uint8ClampedArray(CW * CH * 4); for (let i = 0; i < CW * CH; i++) { px[i * 4] = GREEN[0]; px[i * 4 + 1] = GREEN[1]; px[i * 4 + 2] = GREEN[2]; px[i * 4 + 3] = 255; }
    layout[name] = { CW, CH, frames: [] as any[] };
    fr.forEach((f, k) => {
      const w6 = f.cell.width * K, h6 = f.cell.height * K, ox = GUT + (k % 3) * cw, oy = GUT + Math.floor(k / 3) * ch;
      const im = resample(f.A, w6, h6);
      for (let y = 0; y < h6; y++) for (let x = 0; x < w6; x++) { const i = (y * w6 + x) * 4, o = ((oy + y) * CW + ox + x) * 4, a = im.rgba[i + 3] / 255;
        for (let c = 0; c < 3; c++) px[o + c] = im.rgba[i + c] * a + GREEN[c] * (1 - a); }
      layout[name].frames.push({ id: ids[k], x: ox, y: oy, w: w6, h: h6 });
    });
    writeFileSync(`${P}/e-in/${name}.png`, encodePng({ width: CW, height: CH, anchorX: 0, anchorY: 0, rgba: px }));
    console.log(name, CW, CH, (CW * CH / 1e6).toFixed(2) + 'MP');
  }
  if (!process.env.SETS) {
  const c = JSON.parse(readFileSync(join(W, 'assets-clean/manifest.json'), 'utf8')).images;
  const pi = c.find((i: any) => i.archive === 'Data' && i.resource === 2 && i.image === 3);
  const por = decodePng(new Uint8Array(readFileSync(join(W, 'assets-clean', pi.file))));
  writeFileSync(`${P}/e-in/qian-portrait.png`, encodePng(resample(por, por.width * 6, por.height * 6)));
  }
  writeFileSync(layPath, JSON.stringify(layout, null, 1));
}
