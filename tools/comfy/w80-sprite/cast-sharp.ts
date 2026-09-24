// 各组清晰度：6× 输出里角色区域（非绿）的拉普拉斯能量均值，对比同组输入（清晰参考图）
import { readFileSync, existsSync } from 'node:fs';
import { decodePng } from '../../../packages/assets-pipeline/src/png.ts';
const ch = process.argv[2]; const dir = `/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/c${ch}`;
const lay = JSON.parse(readFileSync(`${dir}/layout.json`, 'utf8'));
function energy(f: string) { const im = decodePng(new Uint8Array(readFileSync(f))); const { width: w, height: h, rgba: p } = im;
  const L = (i: number) => 0.299 * p[i * 4]! + 0.587 * p[i * 4 + 1]! + 0.114 * p[i * 4 + 2]!; const fg = (i: number) => p[i * 4 + 1]! - Math.max(p[i * 4]!, p[i * 4 + 2]!) < 40;
  let s = 0, n = 0; for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { const i = y * w + x; if (!fg(i) || !fg(i - 2) || !fg(i + 2) || !fg(i - 2 * w) || !fg(i + 2 * w)) continue;
    const lap = 4 * L(i) - L(i - 1) - L(i + 1) - L(i - w) - L(i + w); s += Math.abs(lap); n++; } return s / Math.max(1, n); }
const rows: [string, number][] = [];
for (const g of Object.keys(lay)) { const f = `${dir}/${process.env.OUT ?? 'out2'}/${g}.repaint.png`; if (!existsSync(f)) continue; rows.push([g, energy(f)]); }
const med = [...rows.map((r) => r[1])].sort((a, b) => a - b)[Math.floor(rows.length / 2)]!;
for (const [g, e] of rows) console.log(g.padEnd(6), e.toFixed(2), (e / med).toFixed(2), e < med * 0.75 ? '← 偏糊' : '');
