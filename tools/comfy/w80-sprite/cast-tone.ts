// 角色各朝向组色调统一：用原版（忠实）全部帧的 Lab 聚 6 类主色，每组每类整体平移到原版均值（同组同一平移）
// 用法：node cast-tone.ts <角色号> [组名…]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { srgbToLab } from '../../../packages/assets-pipeline/src/seams.ts';
import { labToSrgb } from '../../../packages/assets-pipeline/src/edge.ts';
const ROOT = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets';
const [chArg, ...only] = process.argv.slice(2); const ch = Number(chArg);
const lay = JSON.parse(readFileSync(`${ROOT}/work/fringe-pilot/cast/${/^[0-9]+$/.test(String(chArg ?? ch)) ? "c" + (chArg ?? ch) : (chArg ?? ch)}/layout.json`, 'utf8'));
const fileOf = (id: string) => { const [, r, i] = /^Data\/(\d+)_(\d+)$/.exec(id)!; return `${ROOT}/hd/Data/${Number(r)}-${Number(i)}.png`; };
type Px = [number, number, number];
function labs(files: string[], step = 2): Px[] { const out: Px[] = []; for (const f of files) { const im = decodePng(new Uint8Array(readFileSync(f)));
  for (let i = 0; i < im.width * im.height; i += step) { if (im.rgba[i * 4 + 3]! < 200) continue; const l = srgbToLab(im.rgba[i * 4]!, im.rgba[i * 4 + 1]!, im.rgba[i * 4 + 2]!); out.push([l.l, l.a, l.b]); } } return out; }
const d2 = (a: Px, b: Px) => (a[0] - b[0]) ** 2 * 0.5 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; // 亮度权重减半：按色相聚
const refFiles = Object.values<any>(lay).flatMap((L) => L.frames.map((f: any) => fileOf(f.id).replace('/hd/', '/work/backup-cast/')));
const ref = labs(refFiles, 3);
// k-means（k=6，确定性初始化：按 L 排序等分取中位）
const K = 6; const sorted = [...ref].sort((a, b) => a[0] - b[0]); let C: Px[] = Array.from({ length: K }, (_, k) => sorted[Math.floor((k + 0.5) * sorted.length / K)]!);
for (let it = 0; it < 12; it++) { const s = C.map(() => [0, 0, 0, 0]); for (const p of ref) { let bi = 0, bd = Infinity; C.forEach((c, k) => { const d = d2(p, c); if (d < bd) { bd = d; bi = k; } }); const t = s[bi]!; t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++; }
  C = s.map((t, k) => (t[3]! ? [t[0]! / t[3]!, t[1]! / t[3]!, t[2]! / t[3]!] as Px : C[k]!)); }
const soft = (p: Px) => { const w = C.map((c) => Math.exp(-d2(p, c) / (2 * 12 * 12))); const s = w.reduce((a, b) => a + b, 0) || 1; return w.map((v) => v / s); };
const meanBy = (px: Px[]) => { const s = C.map(() => [0, 0, 0, 0]); for (const p of px) soft(p).forEach((w, k) => { const t = s[k]!; t[0] += p[0] * w; t[1] += p[1] * w; t[2] += p[2] * w; t[3] += w; }); return s.map((t) => (t[3]! > 50 ? [t[0]! / t[3]!, t[1]! / t[3]!, t[2]! / t[3]!, t[3]!] : null)); };
const refMean = meanBy(ref); const refTot = refMean.reduce((a, m) => a + (m ? m[3]! : 0), 0);
for (const [g, L] of Object.entries<any>(lay)) {
  if (only.length && !only.includes(g)) continue;
  const files = L.frames.map((f: any) => fileOf(f.id));
  for (const f of files) { const p = f.replace('/hd/', '/work/pre-tone/'); if (!existsSync(p) || process.env.REFRESH) { mkdirSync(dirname(p), { recursive: true }); copyFileSync(f, p); } }
  const src = files.map((f: string) => f.replace('/hd/', '/work/pre-tone/'));
  const gm = meanBy(labs(src, 2)); const gTot = gm.reduce((a, m) => a + (m ? m[3]! : 0), 0);
  const shift = C.map((_, k) => { const a = refMean[k], b = gm[k]; if (!a || !b) return [0, 0, 0];
    // 这类颜色在本组里明显比原版少（如背影看不到领巾）⇒ 均值不可靠，不动
    if (b[3]! / gTot < 0.3 * (a[3]! / refTot)) return [0, 0, 0]; return [(a[0]! - b[0]!) * 0.6, a[1]! - b[1]!, a[2]! - b[2]!]; });
  console.log(g.padEnd(6), shift.map((s) => s.map((v) => v.toFixed(1)).join('/')).join('  '));
  src.forEach((p: string, k: number) => { const im = decodePng(new Uint8Array(readFileSync(p)));
    for (let i = 0; i < im.width * im.height; i++) { if (im.rgba[i * 4 + 3] === 0) continue; const l = srgbToLab(im.rgba[i * 4]!, im.rgba[i * 4 + 1]!, im.rgba[i * 4 + 2]!);
      const w = soft([l.l, l.a, l.b]); let dl = 0, da = 0, db = 0; w.forEach((v, j) => { dl += shift[j]![0]! * v; da += shift[j]![1]! * v; db += shift[j]![2]! * v; });
      const [r, gg, bb] = labToSrgb({ l: l.l + dl, a: l.a + da, b: l.b + db }); im.rgba[i * 4] = r; im.rgba[i * 4 + 1] = gg; im.rgba[i * 4 + 2] = bb; }
    writeFileSync(files[k], encodePng(im)); });
}
