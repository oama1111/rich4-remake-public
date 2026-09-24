// 任一角色整套（站 / 走 / 拿骰子，8 向）→ 16 组 6× 绿幕网格 + 模糊起始图 + 头像/多角度参考图
// 用法：node cast-build.ts <角色号 0..11>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { prepFrame } from './e-build.ts';
const W = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work', P = W + '/fringe-pilot';
const K = 6, GUT = 48, GREEN = [0, 255, 0];
const up32 = (v: number) => Math.ceil(v / 32) * 32;
const ch = Number(process.argv[2]); const base = 128 + 21 * ch;
const clean = JSON.parse(readFileSync(W + '/assets-clean/manifest.json', 'utf8')).images as any[];
const count = (r: number) => clean.filter((i) => i.archive === 'Data' && i.resource === r).length;
const id = (r: number, i: number) => `Data/${String(r).padStart(4, '0')}_${String(i).padStart(3, '0')}`;
function resample(img: any, w: number, h: number) { const o = new Uint8ClampedArray(w * h * 4); const fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.max(0, (x + 0.5) * fx - 0.5), sy = Math.max(0, (y + 0.5) * fy - 0.5), x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
    for (let c = 0; c < 4; c++) { const p = (xx: number, yy: number) => img.rgba[(yy * img.width + xx) * 4 + c]; o[(y * w + x) * 4 + c] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty; } }
  return { width: w, height: h, rgba: o }; }
function soft(px: Uint8ClampedArray, w: number, h: number, sig: number) {
  const n = w * h, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = px[i * 4 + 1]! - Math.max(px[i * 4]!, px[i * 4 + 2]!) > 60 ? 0 : 1;
  const R = Math.ceil(sig * 3), ker: number[] = []; for (let k = -R; k <= R; k++) ker.push(Math.exp(-k * k / (2 * sig * sig)));
  const pass = (src: Float32Array, hz: boolean) => { const o = new Float32Array(n * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const acc = [0, 0, 0, 0];
    for (let k = -R; k <= R; k++) { const xx = hz ? x + k : x, yy = hz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; for (let c = 0; c < 4; c++) acc[c]! += src[j * 4 + c]! * ker[k + R]!; }
    for (let c = 0; c < 4; c++) o[(y * w + x) * 4 + c] = acc[c]!; } return o; };
  const src = new Float32Array(n * 4); for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) src[i * 4 + c] = px[i * 4 + c]! * m[i]!; src[i * 4 + 3] = m[i]!; }
  const b = pass(pass(src, true), false); const o = new Uint8ClampedArray(px);
  for (let i = 0; i < n; i++) if (m[i]) for (let c = 0; c < 3; c++) o[i * 4 + c] = b[i * 4 + c]! / b[i * 4 + 3]!;
  return o;
}
const nWalk = count(base + 1) / 8, nDice = count(base + 2) / 8;
const sets: Record<string, { ids: string[]; cols: number; sig: number }> = {};
for (let d = 0; d < 8; d++) {
  const wids = [...Array.from({ length: nWalk }, (_, i) => id(base + 1, d * nWalk + i)), id(base, d)];
  sets[`walk${d}`] = { ids: wids, cols: wids.length <= 6 ? 3 : 4, sig: 4 };
  sets[`dice${d}`] = { ids: Array.from({ length: nDice }, (_, i) => id(base + 2, d * nDice + i)), cols: 3, sig: 2 };
}
const layout: any = {};
const dir = `${P}/cast/c${ch}`; mkdirSync(dir, { recursive: true });
for (const [name, { ids, cols, sig }] of Object.entries(sets)) {
  const fr = ids.map(prepFrame);
  const rows = Math.ceil(ids.length / cols);
  const cw = Math.max(...fr.map((f: any) => f.cell.width)) * K + GUT, chh = Math.max(...fr.map((f: any) => f.cell.height)) * K + GUT;
  const CW = up32(cw * cols + GUT), CH = up32(chh * rows + GUT);
  const px = new Uint8ClampedArray(CW * CH * 4); for (let i = 0; i < CW * CH; i++) { px[i * 4] = GREEN[0]!; px[i * 4 + 1] = GREEN[1]!; px[i * 4 + 2] = GREEN[2]!; px[i * 4 + 3] = 255; }
  layout[name] = { CW, CH, frames: [] as any[] };
  fr.forEach((f: any, k: number) => {
    const w6 = f.cell.width * K, h6 = f.cell.height * K, ox = GUT + (k % cols) * cw, oy = GUT + Math.floor(k / cols) * chh;
    const im = resample(f.A, w6, h6);
    for (let y = 0; y < h6; y++) for (let x = 0; x < w6; x++) { const i = (y * w6 + x) * 4, o = ((oy + y) * CW + ox + x) * 4, a = im.rgba[i + 3]! / 255;
      for (let c = 0; c < 3; c++) px[o + c] = im.rgba[i + c]! * a + GREEN[c]! * (1 - a); }
    layout[name].frames.push({ id: ids[k], x: ox, y: oy, w: w6, h: h6 });
  });
  writeFileSync(`${dir}/${name}.png`, encodePng({ width: CW, height: CH, anchorX: 0, anchorY: 0, rgba: px }));
  writeFileSync(`${dir}/${name}-soft.png`, encodePng({ width: CW, height: CH, anchorX: 0, anchorY: 0, rgba: soft(px, CW, CH, sig) }));
  console.log(name, CW, CH, (CW * CH / 1e6).toFixed(2) + 'MP');
}
writeFileSync(`${dir}/layout.json`, JSON.stringify(layout, null, 1));
// 参考图：选角头像 ×6；多角度设定图 = 站姿 8 向 A 版，4×2 灰底
const pi = clean.find((i) => i.archive === 'Data' && i.resource === 2 && i.image === ch);
const por = decodePng(new Uint8Array(readFileSync(`${W}/assets-clean/${pi.file}`)));
writeFileSync(`${dir}/portrait.png`, encodePng({ ...resample(por, por.width * 6, por.height * 6), anchorX: 0, anchorY: 0 }));
const st = Array.from({ length: 8 }, (_, d) => prepFrame(id(base, d)).A);
const tw = Math.max(...st.map((s) => s.width)) + 24, th = Math.max(...st.map((s) => s.height)) + 24, TW = tw * 4 + 24, TH = th * 2 + 24;
const tp = new Uint8ClampedArray(TW * TH * 4).fill(150); for (let i = 3; i < tp.length; i += 4) tp[i] = 255;
st.forEach((s, k) => { const ox = 24 + (k % 4) * tw, oy = 24 + Math.floor(k / 4) * th;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const i = (y * s.width + x) * 4, o = ((oy + y) * TW + ox + x) * 4, a = s.rgba[i + 3]! / 255; for (let c = 0; c < 3; c++) tp[o + c] = s.rgba[i + c]! * a + 150 * (1 - a); } });
writeFileSync(`${dir}/turnaround.png`, encodePng({ width: TW, height: TH, anchorX: 0, anchorY: 0, rgba: tp }));
console.log('walk', nWalk, '/向  dice', nDice, '/向');
