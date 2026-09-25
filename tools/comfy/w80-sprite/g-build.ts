// 通用分组构建：读 spec（key、参考图、若干组 {name, ids, cols, sig}）→ cast/<key>/ 下的 6× 绿幕网格、模糊起始图、layout、参考图
// 用法：node g-build.ts <spec.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { prepFrame } from './e-build.ts';
import { KEY_RGB, keyness, type Key } from './keycolor.ts';
const W = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work', P = W + '/fringe-pilot';
const GUT = 48;
const up32 = (v: number) => Math.ceil(v / 32) * 32;
const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const clean = JSON.parse(readFileSync(W + '/assets-clean/manifest.json', 'utf8')).images as any[];
function resample(img: any, w: number, h: number) { const o = new Uint8ClampedArray(w * h * 4); const fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.max(0, (x + 0.5) * fx - 0.5), sy = Math.max(0, (y + 0.5) * fy - 0.5), x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
    for (let c = 0; c < 4; c++) { const p = (xx: number, yy: number) => img.rgba[(yy * img.width + xx) * 4 + c]; o[(y * w + x) * 4 + c] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty; } }
  return { width: w, height: h, rgba: o }; }
function soft(px: Uint8ClampedArray, w: number, h: number, sig: number, key: Key) {
  const n = w * h, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = keyness(key, px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!) > 60 ? 0 : 1;
  const R = Math.ceil(sig * 3), ker: number[] = []; for (let k = -R; k <= R; k++) ker.push(Math.exp(-k * k / (2 * sig * sig)));
  const pass = (src: Float32Array, hz: boolean) => { const o = new Float32Array(n * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const acc = [0, 0, 0, 0];
    for (let k = -R; k <= R; k++) { const xx = hz ? x + k : x, yy = hz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; for (let c = 0; c < 4; c++) acc[c]! += src[j * 4 + c]! * ker[k + R]!; }
    for (let c = 0; c < 4; c++) o[(y * w + x) * 4 + c] = acc[c]!; } return o; };
  const src = new Float32Array(n * 4); for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) src[i * 4 + c] = px[i * 4 + c]! * m[i]!; src[i * 4 + 3] = m[i]!; }
  const b = pass(pass(src, true), false); const o = new Uint8ClampedArray(px);
  for (let i = 0; i < n; i++) if (m[i]) for (let c = 0; c < 3; c++) o[i * 4 + c] = b[i * 4 + c]! / b[i * 4 + 3]!;
  return o;
}
const dir = `${P}/cast/${spec.key}`; mkdirSync(dir, { recursive: true });
const layout: any = {};
for (const g of spec.groups) {
  const fr = g.ids.map(prepFrame); const cols = g.cols, rows = Math.ceil(g.ids.length / cols); const K = g.k ?? 6;
  const cw = Math.max(...fr.map((f: any) => f.cell.width)) * K + GUT, chh = Math.max(...fr.map((f: any) => f.cell.height)) * K + GUT;
  const CW = up32(cw * cols + GUT), CH = up32(chh * rows + GUT);
  // 底色：默认绿幕；原图里「偏绿」的像素超过 0.5% 就改用三者中最少撞色的那个
  const cnt = (k: Key) => { let c = 0, n = 0; for (const f of fr) { const A = f.A; for (let i = 0; i < A.width * A.height; i += 2) { if (A.rgba[i * 4 + 3] < 128) continue; n++; if (keyness(k, A.rgba[i * 4], A.rgba[i * 4 + 1], A.rgba[i * 4 + 2]) > 25) c++; } } return c / Math.max(1, n); };
  const cs = { green: cnt('green'), magenta: cnt('magenta'), blue: cnt('blue') } as Record<Key, number>;
  const key: Key = cs.green <= 0.005 ? 'green' : (['green', 'magenta', 'blue'] as Key[]).reduce((a, b) => (cs[b] < cs[a] ? b : a));
  const GREEN = KEY_RGB[key];
  const px = new Uint8ClampedArray(CW * CH * 4); for (let i = 0; i < CW * CH; i++) { px[i * 4] = GREEN[0]!; px[i * 4 + 1] = GREEN[1]!; px[i * 4 + 2] = GREEN[2]!; px[i * 4 + 3] = 255; }
  layout[g.name] = { CW, CH, key, frames: [] as any[] };
  fr.forEach((f: any, k: number) => {
    const w6 = f.cell.width * K, h6 = f.cell.height * K, ox = GUT + (k % cols) * cw, oy = GUT + Math.floor(k / cols) * chh;
    const im = resample(f.A, w6, h6);
    for (let y = 0; y < h6; y++) for (let x = 0; x < w6; x++) { const i = (y * w6 + x) * 4, o = ((oy + y) * CW + ox + x) * 4, a = im.rgba[i + 3]! / 255;
      for (let c = 0; c < 3; c++) px[o + c] = im.rgba[i + c]! * a + GREEN[c]! * (1 - a); }
    layout[g.name].frames.push({ id: g.ids[k], x: ox, y: oy, w: w6, h: h6, key, ...(g.diceRes != null && Number(g.ids[k].slice(5, 9)) === g.diceRes ? { dice: true } : {}) });
  });
  writeFileSync(`${dir}/${g.name}.png`, encodePng({ width: CW, height: CH, anchorX: 0, anchorY: 0, rgba: px }));
  writeFileSync(`${dir}/${g.name}-soft.png`, encodePng({ width: CW, height: CH, anchorX: 0, anchorY: 0, rgba: soft(px, CW, CH, g.sig ?? 4, key) }));
  if (CW * CH > 3.2e6) console.log(`⚠️ ${g.name} ${CW}×${CH} 太大`);
}
writeFileSync(`${dir}/layout.json`, JSON.stringify(layout, null, 1));
if (spec.portrait) { const pi = clean.find((i) => i.archive === spec.portrait[0] && i.resource === spec.portrait[1] && i.image === spec.portrait[2]);
  const por = decodePng(new Uint8Array(readFileSync(`${W}/assets-clean/${pi.file}`))); writeFileSync(`${dir}/portrait.png`, encodePng({ ...resample(por, por.width * 6, por.height * 6), anchorX: 0, anchorY: 0 })); }
if (spec.turnaround) { const st = spec.turnaround.map((id: string) => prepFrame(id).A);
  const tw = Math.max(...st.map((s: any) => s.width)) + 24, th = Math.max(...st.map((s: any) => s.height)) + 24, TW = tw * 4 + 24, TH = th * 2 + 24;
  const tp = new Uint8ClampedArray(TW * TH * 4).fill(150); for (let i = 3; i < tp.length; i += 4) tp[i] = 255;
  st.forEach((s: any, k: number) => { const ox = 24 + (k % 4) * tw, oy = 24 + Math.floor(k / 4) * th;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const i = (y * s.width + x) * 4, o = ((oy + y) * TW + ox + x) * 4, a = s.rgba[i + 3]! / 255; for (let c = 0; c < 3; c++) tp[o + c] = s.rgba[i + c]! * a + 150 * (1 - a); } });
  writeFileSync(`${dir}/turnaround.png`, encodePng({ width: TW, height: TH, anchorX: 0, anchorY: 0, rgba: tp })); }
console.log(spec.key, Object.keys(layout).length, '组');
