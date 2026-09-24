// 通用 spec → 重绘任务。用法：node g-jobs.ts <spec.json>
import { readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const briefs = JSON.parse(readFileSync(new URL('./cast-briefs.json', import.meta.url), 'utf8'));
const W = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work'; const rel = `fringe-pilot/cast/${spec.key}`;
const lay = JSON.parse(readFileSync(`${W}/${rel}/layout.json`, 'utf8'));
const HEAD = '把图1这组游戏角色动作帧（网格排列）重绘成高清的 3D 渲染角色。严格保持每一格角色的位置、大小、姿态和朝向，背景保持纯绿色。';
const FACE = '能看到脸的时候，是一张正常的脸：两只眼睛都要画出来（按朝向，远侧那只可以被挡住一部分，但不能省略、不能画成一只眼长在脸中间）。';
const ARM = '手臂要按正常的人体结构画完整：从肩膀连出手臂到手掌，不能只剩一个飘在空中的手掌。';
const DIR: Record<string, string> = { 0: '这一组基本面向镜头（略朝画面左下）。' + FACE, 1: '这一组朝画面左下方，是 3/4 侧面。' + FACE, 2: '这一组背对镜头、朝画面左上方，基本看不到脸，不要硬画正脸。', 3: '这一组完全背对镜头、朝画面上方，看不到脸，不要画脸。', 4: '这一组背对镜头、朝画面右上方，基本看不到脸，不要硬画正脸。', 5: '这一组侧身朝画面右方，只看得到一部分侧脸（图1里看得到的才画）。', 6: '这一组朝画面右下方，是 3/4 侧面。' + FACE, 7: '这一组面向镜头（略朝画面右下）。' + FACE, mixed: '每一格是同一个角色的不同朝向（按图1每一格的朝向画；背对镜头的格子看不到脸）。' + FACE };
const DICE = '如果图1某一格里有骰子，就在同样的位置画一颗同样大小的白色圆角立方体骰子（红色圆点）；图1里没有骰子的格子不要画骰子。';
const TAIL = '所有帧的材质质感必须完全一致。画面干净清晰：颜色过渡平滑自然，没有色带、没有噪点颗粒，材质细腻，光影柔和，边缘干净利落。画风：2000 年代初的 Q 版 3D 预渲染 CG 游戏角色（三维渲染质感，不是二维动画风）。';
const NEG = '独眼, 只有一只眼睛, 眼睛长在脸中间, 畸形的脸, 色带, 色阶断层, 噪点, 颗粒, 抖动, 黑边, 描边, 模糊, 平滑的色块, 缺少细节, 杂物, 畸形的手, 多余的手指, 悬空的手, 丢失物体, 新增物体, 改变姿态, 改变配色, 绿色进入角色, 平板状的头发, 塑料质感的头发, 二维动画风格, 写实照片风格, 文字, 水印';
const refs: any[] = [];
const ch = spec.char; const B = ch !== undefined ? briefs[String(ch)] : null;
if (spec.portrait) refs.push({ path: `rich4-pilot/work/cast/${spec.key}/portrait.png`, upload: `${rel}/portrait.png` });
if (spec.turnaround) refs.push({ path: `rich4-pilot/work/cast/${spec.key}/turnaround.png`, upload: `${rel}/turnaround.png` });
const jobs = spec.groups.map((g: any) => {
  const L = lay[g.name];
  const who = B ? B.brief : g.brief ? `角色是${g.brief}。` : `角色是《大富翁4》里的${spec.name}——${spec.brief}`;
  const detail = B ? '每一处都要有清晰的材质细节：' + B.detail + '大面积的同色区域也要画出结构和纹理，不能是一块平滑的色块。' : '每一处都要有清晰的材质细节：头发的发丝、布料的褶皱和纹理、金属和皮革的光泽；大面积的同色区域也要画出结构和纹理，不能是一块平滑的色块。';
  const ref = refs.length ? '造型以' + (spec.portrait ? '图2的头像和图3' : '图2') + '各个角度的样子为准：' : '';
  const scene = (g.vehicle ? `这一组里角色${g.vehicle}。` : '') + (g.outfit ? `这一组里角色${g.outfit}，其余造型不变。` : '') + (g.extra ?? '');
  const back = [2, 3, 4].includes(g.dir);
  return { id: `G-${spec.key}-${g.name}`, kind: 'qwen-repaint', upload: `${rel}/${g.name}-soft.png`, input: `rich4-pilot/work/cast/${spec.key}/${g.name}-soft.png`,
    reference: `rich4-pilot/work/cast/${spec.key}/${g.name}.png`, referenceUpload: `${rel}/${g.name}.png`, extraRefs: refs,
    out: `${rel}/out2/${g.name}.png`, width: L.CW, height: L.CH, seed: 7,
    prompt: HEAD + ref + who + scene + (DIR[String(g.dir)] ?? '') + ARM + (g.dice ? DICE : '') + detail + TAIL,
    negative: NEG + (back ? ', 正脸, 面向镜头' : ''), resolution: 0, repaintWidth: L.CW, repaintHeight: L.CH, steps: 30, denoise: back ? 0.96 : 0.95, noUpscale: true };
});
writeFileSync(`${W}/g-${spec.key}.jobs.json`, JSON.stringify({ jobs }, null, 1));
console.log(spec.key, jobs.length);
