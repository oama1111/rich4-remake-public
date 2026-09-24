// 各朝向组的「玫红」「皮肤」两类像素 Lab 均值：新版（assets/hd）vs 原版忠实（prep.A）
import { readFileSync } from 'node:fs';
import { decodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { srgbToLab } from '../../../packages/assets-pipeline/src/seams.ts';
export const W = process.env.RICH4_ASSETS ?? 'assets';
export const lay = JSON.parse(readFileSync(W + '/work/fringe-pilot/e2-layout.json', 'utf8'));
export const mag = (l: any) => Math.min(1, Math.max(0, (l.a - 22) / 12)) * Math.min(1, Math.max(0, (18 - l.b) / 12));
export const skin = (l: any) => (l.L ?? l.l) > 50 && l.a > 0 && l.a < 24 && l.b > 10 && l.b < 45 ? 1 : 0;
export function stats(files: string[]) {
  const acc = { m: [0, 0, 0, 0], s: [0, 0, 0, 0] };
  for (const f of files) { const im = decodePng(new Uint8Array(readFileSync(f)));
    for (let i = 0; i < im.width * im.height; i++) { if (im.rgba[i * 4 + 3] < 200) continue; const l = srgbToLab(im.rgba[i * 4], im.rgba[i * 4 + 1], im.rgba[i * 4 + 2]);
      const wm = mag(l), ws = skin(l); acc.m[0] += l.l * wm; acc.m[1] += l.a * wm; acc.m[2] += l.b * wm; acc.m[3] += wm; acc.s[0] += l.l * ws; acc.s[1] += l.a * ws; acc.s[2] += l.b * ws; acc.s[3] += ws; } }
  const f = (v: number[]) => v.slice(0, 3).map((x) => +(x / Math.max(1, v[3]!)).toFixed(1));
  return { m: f(acc.m), s: f(acc.s) };
}
export const fileOf = (id: string) => { const [, r, i] = /^Data\/(\d+)_(\d+)$/.exec(id)!; return `${W}/hd/Data/${Number(r)}-${Number(i)}.png`; };
if (process.argv[1]?.endsWith('tone.ts')) {
  for (const [g, L] of Object.entries<any>(lay)) { const s = stats(L.frames.map((f: any) => fileOf(f.id))); console.log(g.padEnd(6), '玫红 Lab', s.m.join(','), ' 皮肤', s.s.join(',')); }
  const o = stats(Object.values<any>(lay).flatMap((L) => L.frames.map((f: any) => fileOf(f.id).replace('/hd/', '/work/backup-qian/'))));
  console.log('原版(旧高清)', '玫红', o.m.join(','), ' 皮肤', o.s.join(','));
}
