// 小样 E 后处理：6× 大画 → 切帧 → 面积缩到 4× → 绿幕抠像 → 对齐 → 低频校色 → 对比
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { cutCell } from '../../../packages/assets-pipeline/src/grid.ts';
import { srgbToLab } from '../../../packages/assets-pipeline/src/seams.ts';
import { labToSrgb } from '../../../packages/assets-pipeline/src/edge.ts';
import { prepFrame } from './e-build.ts';
const W = process.env.RICH4_ASSETS ?? 'assets/work', P = W + '/fringe-pilot';
const L = JSON.parse(readFileSync(join(W, 'pack/layout.json'), 'utf8'));
const cells = new Map<string, any>(); for (const s of L.sheets) for (const c of s.cells) cells.set(c.id, { sheet: s, cell: c });
const cache = new Map<string, any>(); const load = (p: string) => { let v = cache.get(p); if (!v) { v = decodePng(new Uint8Array(readFileSync(p))); cache.set(p, v); } return v; };
function deband(img: any, R = 6, sigma = 10, iters = 2) {
  let cur = img.rgba; const { width: w, height: h } = img; const inv = 1 / (2 * sigma * sigma);
  for (let it = 0; it < iters; it++) { const nxt = new Uint8ClampedArray(cur);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (cur[i + 3] < 128) continue;
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = (yy * w + xx) * 4; if (cur[j + 3] < 128) continue;
          const d = (cur[j] - cur[i]) ** 2 + (cur[j + 1] - cur[i + 1]) ** 2 + (cur[j + 2] - cur[i + 2]) ** 2; const wt = Math.exp(-d * inv);
          sr += cur[j] * wt; sg += cur[j + 1] * wt; sb += cur[j + 2] * wt; sw += wt; } }
      nxt[i] = sr / sw; nxt[i + 1] = sg / sw; nxt[i + 2] = sb / sw; }
    cur = nxt; }
  return { ...img, rgba: cur };
}
function keyGreen(img: any) {
  const o = new Uint8ClampedArray(img.rgba);
  for (let i = 0; i < o.length; i += 4) {
    const gr = o[i + 1] - Math.max(o[i], o[i + 2]);
    const a = gr <= 30 ? 1 : gr >= 90 ? 0 : 1 - (gr - 30) / 60;
    if (a < 1) o[i + 1] = Math.min(o[i + 1], Math.max(o[i], o[i + 2]));
    o[i + 3] = Math.round(a * 255);
  }
  return { ...img, rgba: o };
}
const pale = (r: number, g: number, b: number) => Math.min(r, g, b) > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
function align(ai: any, ref: any, R = 12, base?: any) {
  const { width: w, height: h } = ai; let best = { dx: 0, dy: 0, iou: -1 };
  for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) {
    let inter = 0, uni = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const sx = x - dx, sy = y - dy; const inA = sx >= 0 && sy >= 0 && sx < w && sy < h; const ai4 = inA ? (sy * w + sx) * 4 : 0;
      const a = inA && ai.rgba[ai4 + 3] >= 128; const b = ref.rgba[(y * w + x) * 4] >= 128;
      if (base && ((a && pale(ai.rgba[ai4], ai.rgba[ai4 + 1], ai.rgba[ai4 + 2])) || (b && pale(base.rgba[(y * w + x) * 4], base.rgba[(y * w + x) * 4 + 1], base.rgba[(y * w + x) * 4 + 2])))) continue;
      if (a && b) inter++; if (a || b) uni++; }
    const iou = uni ? inter / uni : 0; if (iou > best.iou) best = { dx, dy, iou };
  }
  const o = new Uint8ClampedArray(ai.rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x - best.dx, sy = y - best.dy; if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue; o.set(ai.rgba.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4); }
  return { img: { ...ai, rgba: o }, ...best };
}
function upNearest(img: any, k: number) { const w = img.width * k, h = img.height * k, o = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.set(img.rgba.subarray(((y / k | 0) * img.width + (x / k | 0)) * 4, ((y / k | 0) * img.width + (x / k | 0)) * 4 + 4), (y * w + x) * 4); return { width: w, height: h, anchorX: 0, anchorY: 0, rgba: o }; }
function upBilinear(img: any, k: number) {
  const w = img.width * k, h = img.height * k, o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.max(0, (x + 0.5) / k - 0.5), fy = Math.max(0, (y + 0.5) / k - 0.5), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    for (let c = 0; c < 4; c++) { const p = (xx: number, yy: number) => img.rgba[(yy * img.width + xx) * 4 + c];
      o[(y * w + x) * 4 + c] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty; } }
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba: o };
}
function gaussL(Lc: Float32Array, w: number, h: number, sig: number) {
  const R = Math.ceil(sig * 3), ker: number[] = []; for (let k = -R; k <= R; k++) ker.push(Math.exp(-k * k / (2 * sig * sig)));
  const pass = (src: Float32Array, hz: boolean) => { const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, ws = 0;
      for (let k = -R; k <= R; k++) { const xx = hz ? x + k : x, yy = hz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += src[yy * w + xx] * ker[k + R]; ws += ker[k + R]; }
      o[y * w + x] = s / ws; } return o; };
  return pass(pass(Lc, true), false);
}
/**
 * 引导校色：Δ = 原图 − AI（Lab），在 AI 图上做联合双边平滑 —— 只向「AI 里颜色相近」的邻居取、且 |Δ| 大的
 * （五官错位、原图蓝眼 vs AI 皮肤）不参与。于是只校整体偏色（绿幕反光），不把别处的颜色抹过来。
 */
function guidedFix(ai: any, base: any, R = 10, sigS = 6, sigC = 10, sigD = 16) {
  const { width: w, height: h } = ai; const n = w * h;
  const A = new Float32Array(n * 3), D = new Float32Array(n * 3), op = new Uint8Array(n);
  for (let i = 0; i < n; i++) { op[i] = ai.rgba[i * 4 + 3] >= 128 ? 1 : 0; if (!op[i]) continue;
    const a = srgbToLab(ai.rgba[i * 4], ai.rgba[i * 4 + 1], ai.rgba[i * 4 + 2]), b = srgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
    A[i * 3] = a.l; A[i * 3 + 1] = a.a; A[i * 3 + 2] = a.b; D[i * 3] = b.l - a.l; D[i * 3 + 1] = b.a - a.a; D[i * 3 + 2] = b.b - a.b; }
  const o = new Uint8ClampedArray(ai.rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!op[i]) continue;
    let s0 = 0, s1 = 0, s2 = 0, sw = 0;
    for (let dy = -R; dy <= R; dy += 2) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -R; dx <= R; dx += 2) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = yy * w + xx; if (!op[j]) continue;
        const dc = (A[j * 3] - A[i * 3]) ** 2 + (A[j * 3 + 1] - A[i * 3 + 1]) ** 2 + (A[j * 3 + 2] - A[i * 3 + 2]) ** 2;
        const dd = D[j * 3] ** 2 + D[j * 3 + 1] ** 2 + D[j * 3 + 2] ** 2;
        const wt = Math.exp(-(dx * dx + dy * dy) / (2 * sigS * sigS) - dc / (2 * sigC * sigC) - dd / (2 * sigD * sigD));
        s0 += D[j * 3] * wt; s1 += D[j * 3 + 1] * wt; s2 += D[j * 3 + 2] * wt; sw += wt; } }
    if (sw < 1e-6) continue;
    const [r, g, b] = labToSrgb({ l: A[i * 3] + s0 / sw, a: A[i * 3 + 1] + s1 / sw, b: A[i * 3 + 2] + s2 / sw });
    o[i * 4] = r; o[i * 4 + 1] = g; o[i * 4 + 2] = b; }
  return { ...ai, rgba: o };
}
function lowfreqFix(ai: any, base: any, sig = 6) {
  const { width: w, height: h } = ai; const n = w * h;
  const ch = (img: any) => { const Ls = new Float32Array(n), As = new Float32Array(n), Bs = new Float32Array(n);
    for (let i = 0; i < n; i++) { const l = srgbToLab(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]); Ls[i] = l.l; As[i] = l.a; Bs[i] = l.b; } return [Ls, As, Bs]; };
  // 只在 AI 的不透明区里做模糊（透明处不参与），避免把背景色混进来
  const wmask = new Float32Array(n); for (let i = 0; i < n; i++) wmask[i] = ai.rgba[i * 4 + 3] >= 128 ? 1 : 0;
  const mblur = (c: Float32Array) => { const num = gaussL(c.map((v, i) => v * wmask[i]), w, h, sig), den = gaussL(wmask, w, h, sig); return num.map((v, i) => (den[i] > 1e-3 ? v / den[i] : 0)); };
  const A = ch(ai), B = ch(base);
  const dA = A.map(mblur), dB = B.map(mblur);
  const o = new Uint8ClampedArray(ai.rgba);
  for (let i = 0; i < n; i++) { if (wmask[i] === 0) continue;
    const [r, g, b] = labToSrgb({ l: A[0][i] + dB[0][i] - dA[0][i], a: A[1][i] + dB[1][i] - dA[1][i], b: A[2][i] + dB[2][i] - dA[2][i] });
    o[i * 4] = r; o[i * 4 + 1] = g; o[i * 4 + 2] = b; }
  return { ...ai, rgba: o };
}
/** 面积平均缩放（任意比例） */
function areaDown(img: any, w: number, h: number) {
  const o = new Uint8ClampedArray(w * h * 4), fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * fx, x1 = (x + 1) * fx, y0 = y * fy, y1 = (y + 1) * fy; const acc = [0, 0, 0, 0]; let ws = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const wt = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy)); if (wt <= 0) continue;
      const i = (Math.min(img.height - 1, sy) * img.width + Math.min(img.width - 1, sx)) * 4; for (let c = 0; c < 4; c++) acc[c] += img.rgba[i + c] * wt; ws += wt; }
    for (let c = 0; c < 4; c++) o[(y * w + x) * 4 + c] = acc[c] / ws; }
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba: o };
}
function crop(img: any, x: number, y: number, w: number, h: number) { const o = new Uint8ClampedArray(w * h * 4); for (let r = 0; r < h; r++) o.set(img.rgba.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4); return { width: w, height: h, anchorX: 0, anchorY: 0, rgba: o }; }
export function eFrame(tag: string, name: string, fr: any, prep: any, file?: string) {
  const big = load(file ?? join(P, 'done-E' + tag, name + '.png'));
  const c6 = crop(big, fr.x, fr.y, fr.w, fr.h);
  // 先抠像再缩（抠像在大图上更准），缩后再对齐
  const k6 = keyGreen(c6);
  const d4 = areaDown(k6, prep.cell.width * 4, prep.cell.height * 4);
  const base4 = deband({ ...upBilinear(prep.orig1, 4) }, 6, 12, 3);
  const al = align(d4, prep.a4, 12, base4);
  return { img: process.env.FIX === 'old' ? lowfreqFix(al.img, base4) : process.env.FIX === 'guided' ? guidedFix(al.img, base4) : al.img, raw: al.img, iou: al.iou, dx: al.dx, dy: al.dy };
}
if (process.argv[1]?.endsWith('e-post.ts')) {
  const [out, name, tagsArg, zoomArg] = process.argv.slice(2);
  const lay = JSON.parse(readFileSync(join(P, 'e-layout.json'), 'utf8'))[name!];
  const tags = tagsArg!.split(','), zoom = Number(zoomArg ?? 4);
  const frames = lay.frames.slice(Number(process.env.FROM ?? 1), Number(process.env.FROM ?? 1) + Number(process.env.N ?? 6));
  const rows: any[][] = [];
  const preps = frames.map((f: any) => prepFrame(f.id));
  rows.push(frames.map((f: any) => { const { cell } = cells.get(f.id)!; const r = load(join(W, 'queue', cell.rgb)), a = load(join(W, 'queue', cell.alpha)); return upNearest({ ...r, rgba: r.rgba.map((v: number, i: number) => (i % 4 === 3 ? a.rgba[i - 3] : v)) }, 4); }));
  rows.push(preps.map((p: any) => p.A));
  for (const t of tags) { const r = frames.map((f: any, k: number) => eFrame(t, name!, f, preps[k])); console.log(t, r.map((x: any) => x.iou.toFixed(2) + '@' + x.dx + ',' + x.dy).join(' ')); rows.push(r.map((x: any) => process.env.RAW ? x.raw : x.img)); }
  const gap = 6, n = rows[0]!.length, f = zoom / 4;
  const colW = Math.round(Math.max(...rows.flat().map((im: any) => im.width)) * f), T = colW * n + gap * (n - 1);
  const rh = rows.map((r) => Math.round(Math.max(...r.map((im: any) => im.height)) * f));
  const H = rh.reduce((s, v) => s + v + gap, 0), px = new Uint8ClampedArray(T * H * 4).fill(50);
  let y0 = 0;
  rows.forEach((r, ri) => { r.forEach((img: any, k: number) => { const w = Math.round(img.width * f), h = Math.round(img.height * f);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(img.width - 1, Math.floor(x / f)), sy = Math.min(img.height - 1, Math.floor(y / f));
        const i = (sy * img.width + sx) * 4, a = img.rgba[i + 3] / 255, bg = ((x >> 3) + (y >> 3)) & 1 ? 205 : 160, o = ((y0 + y) * T + k * (colW + gap) + x) * 4;
        for (let c = 0; c < 3; c++) px[o + c] = img.rgba[i + c] * a + bg * (1 - a); px[o + 3] = 255; } }); y0 += rh[ri]! + gap; });
  writeFileSync(out!, encodePng({ width: T, height: H, anchorX: 0, anchorY: 0, rgba: px }));
}
