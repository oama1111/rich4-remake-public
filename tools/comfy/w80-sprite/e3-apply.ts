// 钱夫人整套落盘 v3：走路/站用 done-Q2（背面 walk3 用 Q2c），骰子用 done-Q3 + 逐帧骰子检查（不过退回忠实版 A）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodePng } from '../../../packages/assets-pipeline/src/png.ts';
import { hdRelativePath } from '../../../packages/assets-pipeline/src/upscale.ts';
import { prepFrame } from './e-build.ts';
import { eFrame } from './e-post.ts';
const ROOT = process.env.RICH4_ASSETS ?? 'assets', P = ROOT + '/work/fringe-pilot';
const lay = JSON.parse(readFileSync(P + '/e2-layout.json', 'utf8'));
const pale = (p: Uint8ClampedArray, i: number) => Math.min(p[i]!, p[i + 1]!, p[i + 2]!) > 165 && Math.max(p[i]!, p[i + 1]!, p[i + 2]!) - Math.min(p[i]!, p[i + 1]!, p[i + 2]!) < 40;
/** 骰子掩膜：亮、低饱和、不透明；再去掉小连通块（珍珠）—— 这里简化为按 16×16 块统计，块内 pale 占比 > 35% 算骰子块 */
function diceBlocks(img: any, alphaOf: (i: number) => number) {
  const B = 16, bw = Math.ceil(img.width / B), bh = Math.ceil(img.height / B), m = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let n = 0, t = 0;
    for (let y = by * B; y < Math.min(img.height, by * B + B); y++) for (let x = bx * B; x < Math.min(img.width, bx * B + B); x++) { const i = y * img.width + x; if (alphaOf(i) < 128) continue; t++; if (pale(img.rgba, i * 4)) n++; }
    m[by * bw + bx] = t > 40 && n / (B * B) > 0.35 ? 1 : 0; }
  return m;
}
const onlyGroups = process.argv.slice(2);
const report: string[] = []; let fallback = 0;
for (const [name, L] of Object.entries<any>(lay)) {
  if (onlyGroups.length && !onlyGroups.includes(name)) continue;
  const dice = name.startsWith('dice');
  const src = dice ? (process.env.DICE_SRC ?? 'done-Q4-0.92') : name === 'walk3' ? 'done-Q2c' : 'done-Q2';
  const file = `${P}/${src}/${name}.repaint.png`;
  if (!existsSync(file)) { report.push(`${name}：没有产物，跳过`); continue; }
  for (const fr of L.frames) {
    const [, rs, is] = /^Data\/(\d+)_(\d+)$/.exec(fr.id)!;
    const rel = hdRelativePath('Data', Number(rs), Number(is));
    const dst = join(ROOT, 'hd', rel), bak = join(ROOT, 'work/backup-qian', rel);
    if (!existsSync(bak)) { mkdirSync(dirname(bak), { recursive: true }); copyFileSync(dst, bak); }
    const prep = prepFrame(fr.id);
    const r = eFrame('', name, fr, prep, file);
    let out = r.img, note = '';
    if (dice) {
      const mo = diceBlocks(prep.A, (i) => prep.a4.rgba[i * 4]!), mn = diceBlocks(r.img, (i) => r.img.rgba[i * 4 + 3]!);
      let inter = 0, uni = 0, ao = 0, an = 0; for (let i = 0; i < mo.length; i++) { ao += mo[i]!; an += mn[i]!; if (mo[i] && mn[i]) inter++; if (mo[i] || mn[i]) uni++; }
      const diou = uni ? inter / uni : 1;
      note = ` 骰子块 原${ao}/新${an} 重合${diou.toFixed(2)}`;
      const reviewed = (process.env.ACCEPT ?? '').split(',').includes(fr.id);
      if (!reviewed && ((ao >= 4 && (diou < 0.35 || an > ao * 2.2 || an < ao * 0.4)) || (ao < 2 && an >= 5))) { out = prep.A; fallback++; note += ' ✗退回忠实版'; }
    }
    if (!process.env.DRY) writeFileSync(dst, encodePng(out));
    report.push(`${fr.id} IoU ${r.iou.toFixed(2)} 位移 ${r.dx},${r.dy}${note}`);
  }
}
console.log(report.join('\n')); console.log('退回忠实版', fallback, '帧');
