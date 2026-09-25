import { readFileSync, readdirSync } from 'node:fs';
import { decodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { keyness, type Key } from './keycolor.ts';
const W = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work';
const clean = JSON.parse(readFileSync(W + '/assets-clean/manifest.json', 'utf8')).images as any[];
const byId = new Map(clean.map((i) => [`${i.archive}/${String(i.resource).padStart(4, '0')}_${String(i.image).padStart(3, '0')}`, i]));
const frac = (ids: string[], k: Key) => { let c = 0, n = 0; for (const id of ids) { const it = byId.get(id); if (!it) continue; const im = decodePng(new Uint8Array(readFileSync(W + '/assets-clean/' + it.file)));
  for (let i = 0; i < im.width * im.height; i++) { if (im.rgba[i * 4 + 3]! < 128) continue; n++; if (keyness(k, im.rgba[i * 4]!, im.rgba[i * 4 + 1]!, im.rgba[i * 4 + 2]!) > 25) c++; } } return c / Math.max(1, n); };
const out: Record<string, string[]> = {};
const keys = process.argv.slice(2);
for (const key of keys) {
  const lay = JSON.parse(readFileSync(`${W}/fringe-pilot/cast/${key}/layout.json`, 'utf8'));
  for (const [g, L] of Object.entries<any>(lay)) { const ids = L.frames.map((f: any) => f.id); const gf = frac(ids, 'green');
    if (gf > 0.005) { const m = frac(ids, 'magenta'), b = frac(ids, 'blue'); (out[key] ??= []).push(`${g}(绿${(gf * 100).toFixed(1)}% 洋${(m * 100).toFixed(1)}% 蓝${(b * 100).toFixed(1)}%)`); } }
}
for (const [k, v] of Object.entries(out)) console.log(k, v.length, '组：', v.slice(0, 6).join(' '), v.length > 6 ? '…' : '');
