// 某角色整套落盘：切帧 → 抠像 → 缩 4× → 按身体对位 → 骰子逐帧自检（不过退回忠实版，ACCEPT 放行）
// 用法：node cast-apply.ts <角色号> [组名…]   环境：DRY=1 只报告；ACCEPT=Data/xxxx_yyy,…
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { hdRelativePath } from '../../../packages/assets-pipeline/src/upscale.ts';
import { prepFrame } from './e-build.ts';
import { eFrame } from './e-post.ts';
const ROOT = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets';
const [chArg, ...only] = process.argv.slice(2); const ch = Number(chArg);
const dir = `${ROOT}/work/fringe-pilot/cast/c${ch}`;
const lay = JSON.parse(readFileSync(`${dir}/layout.json`, 'utf8'));
const accept = new Set((process.env.ACCEPT ?? '').split(',').filter(Boolean));
const pale = (p: Uint8ClampedArray, i: number) => Math.min(p[i]!, p[i + 1]!, p[i + 2]!) > 165 && Math.max(p[i]!, p[i + 1]!, p[i + 2]!) - Math.min(p[i]!, p[i + 1]!, p[i + 2]!) < 40;
function diceBlocks(img: any, alphaOf: (i: number) => number) {
  const B = 16, bw = Math.ceil(img.width / B), bh = Math.ceil(img.height / B), m = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let n = 0, t = 0;
    for (let y = by * B; y < Math.min(img.height, by * B + B); y++) for (let x = bx * B; x < Math.min(img.width, bx * B + B); x++) { const i = y * img.width + x; if (alphaOf(i) < 128) continue; t++; if (pale(img.rgba, i * 4)) n++; }
    m[by * bw + bx] = t > 40 && n / (B * B) > 0.35 ? 1 : 0; }
  return m;
}
const lines: string[] = []; const flagged: string[] = []; let ious: number[] = [];
for (const [name, L] of Object.entries<any>(lay)) {
  if (only.length && !only.includes(name)) continue;
  const dice = name.startsWith('dice'), file = `${dir}/${process.env.OUT ?? 'out2'}/${name}.repaint.png`;
  if (!existsSync(file)) { lines.push(`${name}：没有产物`); continue; }
  for (const fr of L.frames) {
    const [, rs, is] = /^Data\/(\d+)_(\d+)$/.exec(fr.id)!;
    const rel = hdRelativePath('Data', Number(rs), Number(is));
    const dst = join(ROOT, 'hd', rel), bak = join(ROOT, 'work/backup-cast', rel);
    if (!existsSync(bak)) { mkdirSync(dirname(bak), { recursive: true }); copyFileSync(dst, bak); }
    const prep = prepFrame(fr.id); const r = eFrame('', name, fr, prep, file);
    let out = r.img, note = '';
    if (dice) {
      const mo = diceBlocks(prep.A, (i) => prep.a4.rgba[i * 4]!), mn = diceBlocks(r.img, (i) => r.img.rgba[i * 4 + 3]!);
      let inter = 0, uni = 0, ao = 0, an = 0; for (let i = 0; i < mo.length; i++) { ao += mo[i]!; an += mn[i]!; if (mo[i] && mn[i]) inter++; if (mo[i] || mn[i]) uni++; }
      const diou = uni ? inter / uni : 1; note = ` 骰子 原${ao}/新${an} 重合${diou.toFixed(2)}`;
      if (!accept.has(fr.id) && ((ao >= 4 && (diou < 0.35 || an > ao * 2.2 || an < ao * 0.4)) || (ao < 2 && an >= 5))) { out = prep.A; note += ' ✗退回忠实版'; flagged.push(fr.id); }
    }
    ious.push(r.iou);
    if (!process.env.DRY) writeFileSync(dst, encodePng(out));
    lines.push(`${fr.id} IoU ${r.iou.toFixed(2)} 位移 ${r.dx},${r.dy}${note}`);
  }
}
if (process.env.VERBOSE) console.log(lines.join('\n'));
console.log(`c${ch}：${ious.length} 帧，IoU 平均 ${(ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(2)}、最低 ${Math.min(...ious).toFixed(2)}；骰子报警 ${flagged.length} 帧 ${flagged.join(',')}`);
