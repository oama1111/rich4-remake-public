// 统一色调：每个朝向组的「玫红」「皮肤」整体平移到原版均值（组内同一平移量 ⇒ 不新增帧间闪烁）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { srgbToLab } from '../../../packages/assets-pipeline/src/seams.ts';
import { labToSrgb } from '../../../packages/assets-pipeline/src/edge.ts';
import { lay, fileOf, W } from './tone.ts';
const ramp = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const wMag = (l: any) => ramp(l.a, 20, 32) * (1 - ramp(l.b, 12, 22));
const wSkin = (l: any) => ramp(l.l, 45, 55) * ramp(l.a, -2, 4) * (1 - ramp(l.a, 22, 28)) * ramp(l.b, 6, 12) * (1 - ramp(l.b, 42, 48));
function groupStats(files: string[]) {
  const m = [0, 0, 0, 0], s = [0, 0, 0, 0];
  for (const f of files) { const im = decodePng(new Uint8Array(readFileSync(f)));
    for (let i = 0; i < im.width * im.height; i++) { if (im.rgba[i * 4 + 3] < 200) continue; const l = srgbToLab(im.rgba[i * 4], im.rgba[i * 4 + 1], im.rgba[i * 4 + 2]);
      const a = wMag(l), b = wSkin(l); m[0] += l.l * a; m[1] += l.a * a; m[2] += l.b * a; m[3] += a; s[0] += l.l * b; s[1] += l.a * b; s[2] += l.b * b; s[3] += b; } }
  return { m: m.slice(0, 3).map((v) => v / Math.max(1e-6, m[3]!)), s: s.slice(0, 3).map((v) => v / Math.max(1e-6, s[3]!)), wm: m[3]!, ws: s[3]! };
}
const only = process.argv.slice(2);
// 基准：原版（旧高清，忠实放大）所有帧的均值
const ref = groupStats(Object.values<any>(lay).flatMap((L) => L.frames.map((f: any) => fileOf(f.id).replace('/hd/', '/work/backup-qian/'))));
console.log('基准 玫红', ref.m.map((v) => v.toFixed(1)).join(','), ' 皮肤', ref.s.map((v) => v.toFixed(1)).join(','));
for (const [g, L] of Object.entries<any>(lay)) {
  if (only.length && !only.includes(g)) continue;
  const files = L.frames.map((f: any) => fileOf(f.id));
  // 先存一份校色前的（重跑可从这份再来，不叠加）
  for (const f of files) { const p = f.replace('/hd/', '/work/pre-tone/'); if (!existsSync(p) || process.env.REFRESH) { mkdirSync(dirname(p), { recursive: true }); copyFileSync(f, p); } }
  const src = files.map((f: string) => f.replace('/hd/', '/work/pre-tone/'));
  const st = groupStats(src);
  const dm = [(ref.m[0]! - st.m[0]!) * 0.6, ref.m[1]! - st.m[1]!, ref.m[2]! - st.m[2]!];
  const ds = st.ws > 2000 ? [(ref.s[0]! - st.s[0]!) * 0.6, ref.s[1]! - st.s[1]!, ref.s[2]! - st.s[2]!] : [0, 0, 0]; // 背影几乎没皮肤：不动
  console.log(g.padEnd(6), '玫红平移', dm.map((v) => v.toFixed(1)).join(','), ' 皮肤平移', ds.map((v) => v.toFixed(1)).join(','));
  src.forEach((p: string, k: number) => { const im = decodePng(new Uint8Array(readFileSync(p)));
    for (let i = 0; i < im.width * im.height; i++) { if (im.rgba[i * 4 + 3] === 0) continue; const l = srgbToLab(im.rgba[i * 4], im.rgba[i * 4 + 1], im.rgba[i * 4 + 2]);
      const a = wMag(l), b = wSkin(l); if (a + b < 1e-3) continue;
      const [r, gg, bb] = labToSrgb({ l: l.l + dm[0]! * a + ds[0]! * b, a: l.a + dm[1]! * a + ds[1]! * b, b: l.b + dm[2]! * a + ds[2]! * b });
      im.rgba[i * 4] = r; im.rgba[i * 4 + 1] = gg; im.rgba[i * 4 + 2] = bb; }
    writeFileSync(files[k], encodePng(im)); });
}
