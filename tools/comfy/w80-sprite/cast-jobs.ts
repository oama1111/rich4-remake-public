// 生成某个角色 16 组的重绘任务。用法：node cast-jobs.ts <角色号>
import { readFileSync, writeFileSync } from 'node:fs';
import { KEY_NAME } from './keycolor.ts';
const ch = process.argv[2]!; const B = JSON.parse(readFileSync(new URL('./cast-briefs.json', import.meta.url), 'utf8'))[ch];
const W = '/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work'; const rel = `fringe-pilot/cast/c${ch}`;
const lay = JSON.parse(readFileSync(`${W}/${rel}/layout.json`, 'utf8'));
const HEAD = '把图1这组游戏角色动作帧（网格排列，每一格是同一个角色、同一个朝向的一帧）重绘成高清的 3D 渲染角色。严格保持每一格角色的位置、大小、姿态和朝向，背景保持纯绿色。';
const REF = '造型以图2的头像和图3他/她各个角度的样子为准：';
const FACE = '能看到脸的时候，是一张正常的脸：两只眼睛都要画出来（按朝向，远侧那只可以被挡住一部分，但不能省略、不能画成一只眼长在脸中间）。';
const ARM = '手臂要按正常的人体结构画完整：从肩膀连出手臂到手掌；原图里被身体挡住、只露出一个小手掌的那只手，要把手臂补出来自然地连到身体上，不能只剩一个飘在空中的手掌。';
const DIR: Record<number, string> = {
  0: '这一组基本面向镜头（略朝画面左下）。' + FACE, 1: '这一组朝画面左下方，是 3/4 侧面。' + FACE,
  5: '这一组侧身朝画面右方，只看得到一部分侧脸（图1里看得到的才画）。', 6: '这一组朝画面右下方，是 3/4 侧面。' + FACE,
  7: '这一组面向镜头（略朝画面右下）。' + FACE,
};
const BACKDIR: Record<number, string> = { 2: '背对镜头、朝画面左上方', 3: '完全背对镜头、朝画面上方', 4: '背对镜头、朝画面右上方' };
// ★ 骰子别写「必须完全一致、不要改变动作」—— 那样 AI 只敢照抄模糊的起始图，出来一片平滑色块（约翰乔小样）
const DICE = '每一格有一颗很大的白色圆角立方体骰子（红色圆点），骰子在哪里、多大，按图1同一格画。';
const DETAIL = (d: string) => '每一处都要有清晰的材质细节：' + d + '大面积的同色区域也要画出结构和纹理，不能是一块平滑的色块。';
const SAME = '所有帧的头发、衣服的质感必须完全一致（同样清晰的发丝与布料纹理），不能有的帧清晰、有的帧扁平。';
const TAIL = '画面干净清晰：颜色过渡平滑自然，没有色带、没有噪点颗粒，材质细腻，光影柔和，边缘干净利落。画风：2000 年代初的 Q 版 3D 预渲染 CG 游戏角色（三维渲染质感，不是二维动画风）。';
const NEG = '独眼, 只有一只眼睛, 眼睛长在脸中间, 畸形的脸, 色带, 色阶断层, 噪点, 颗粒, 抖动, 黑边, 描边, 模糊, 杂物, 畸形的手, 多余的手指, 悬空的手, 没有手臂的手掌, 丢失物体, 新增物体, 改变姿态, 改变配色, 绿色进入角色, 平板状的头发, 塑料质感的头发, 二维动画风格, 写实照片风格, 文字, 水印';
const refs = [{ path: `rich4-pilot/work/cast/c${ch}/portrait.png`, upload: `${rel}/portrait.png` }, { path: `rich4-pilot/work/cast/c${ch}/turnaround.png`, upload: `${rel}/turnaround.png` }];
const jobs = Object.keys(lay).map((name) => {
  const d = Number(name.slice(-1)), dice = name.startsWith('dice'), back = d >= 2 && d <= 4, L = lay[name]; const KN = KEY_NAME[(L.key ?? 'green') as 'green'];
  const body = back ? `这一组画的是${B.name}的背影：人物${BACKDIR[d]}，画面里看不到脸、眼睛、鼻子和嘴。${B.back}` : B.brief + DIR[d] + ARM;
  return { id: `C${ch}-${name}`, kind: 'qwen-repaint', upload: `${rel}/${name}-soft${dice ? '4' : ''}.png`, input: `rich4-pilot/work/cast/c${ch}/${name}-soft${dice ? '4' : ''}.png`,
    reference: `rich4-pilot/work/cast/c${ch}/${name}.png`, referenceUpload: `${rel}/${name}.png`, extraRefs: refs,
    out: `${rel}/out2/${name}.png`, width: L.CW, height: L.CH, seed: 7,
    prompt: HEAD.replace('纯绿色', KN) + (back ? '' : REF) + body + (dice ? DICE : '') + DETAIL(B.detail) + SAME + TAIL,
    negative: NEG.replace('绿色进入角色', KN.slice(1) + '进入角色') + ', 平滑的色块, 缺少细节' + (back ? ', 脸, 眼睛, 正脸, 面向镜头, 五官' : '') + (dice ? ', 两颗骰子, 多颗骰子, 没有骰子, 小骰子' : ''),
    resolution: 0, repaintWidth: L.CW, repaintHeight: L.CH, steps: 30, denoise: back ? 0.96 : 0.95, noUpscale: true };
});
writeFileSync(`${W}/cast-c${ch}.jobs.json`, JSON.stringify({ jobs }, null, 1));
console.log(`c${ch} ${B.name}: ${jobs.length} 组`);
