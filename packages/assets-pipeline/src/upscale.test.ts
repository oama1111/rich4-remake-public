/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 超分管线
 */

import { describe, expect, it } from 'vitest';
import { selectTasks } from './cli-upscale.ts';
import { existsSync, readFileSync } from 'node:fs';
import {
  BATCH_RULES,
  classify,
  emptyManifest,
  hdRelativePath,
  locateIngestOutput,
  pendingTasks,
  planUpscale,
  resourceKeyOf,
  recordResult,
  scaleAnchor,
  summarize,
  taskIdOf,
  type AssetEntryLike,
} from './upscale.ts';

const MANIFEST = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/manifest.json';
const run = existsSync(MANIFEST) ? it : it.skip;

const entry = (over: Partial<AssetEntryLike> = {}): AssetEntryLike => ({
  archive: 'Data',
  resource: 1,
  image: 2,
  file: 'Data/0001_002.png',
  width: 64,
  height: 64,
  anchorX: 32,
  anchorY: 32,
  format: 'SPR',
  ...over,
});

describe('分批', () => {
  it('按面积分四档', () => {
    expect(classify(4, 4).batch).toBe('tiny');
    expect(classify(64, 64).batch).toBe('small');
    expect(classify(200, 200).batch).toBe('medium');
    expect(classify(640, 480).batch).toBe('large');
  });

  it('★ C-AST-3 硬约束：倍率统一 4×（含 640×480 → 2560×1920），批次只为工具分组', () => {
    expect(classify(4, 4).scale).toBe(4);
    expect(classify(64, 64).scale).toBe(4);
    expect(classify(640, 480).scale).toBe(4);
  });

  it('BATCH_RULES 全部为 4×', () => {
    for (const r of BATCH_RULES) expect(r.scale).toBe(4);
  });
});

describe('★ C-AST-6：锚点必须与图像同步缩放', () => {
  it('整数倍放大时锚点同比例放大', () => {
    expect(scaleAnchor(32, 32, 64, 64, 256, 256)).toEqual({ anchorX: 128, anchorY: 128 });
  });

  it('★ 用**实际**输出尺寸而不是请求倍率——工具常会对齐到偶数', () => {
    // 请求 4 倍本应是 256，工具给了 258（对齐到 6 的倍数之类）
    const a = scaleAnchor(32, 32, 64, 64, 258, 258);
    expect(a.anchorX).toBe(129); // 32 * (258/64) = 129
    // 若按请求倍率算会得到 128，差 1 像素——所有精灵会系统性偏移
    expect(a.anchorX).not.toBe(128);
  });

  it('非等比缩放时两轴各自计算', () => {
    expect(scaleAnchor(10, 20, 40, 40, 80, 160)).toEqual({ anchorX: 20, anchorY: 80 });
  });

  it('零尺寸不除零', () => {
    expect(scaleAnchor(5, 5, 0, 0, 10, 10)).toEqual({ anchorX: 0, anchorY: 0 });
  });

  it('★ recordResult 自动算锚点——把 C-AST-6 变成代码保证', () => {
    const [task] = planUpscale([entry()]);
    const r = recordResult(task!, {
      model: 'realesrgan-x4plus-anime',
      outWidth: 256,
      outHeight: 256,
      srcHash: 'aaa',
      outHash: 'bbb',
    });
    expect(r.outAnchorX).toBe(128);
    expect(r.outAnchorY).toBe(128);
    expect(r.model).toBe('realesrgan-x4plus-anime');
  });
});

describe('任务标识', () => {
  it('稳定且可读', () => {
    expect(taskIdOf({ archive: 'Data', resource: 1, image: 2 })).toBe('Data/0001_002');
  });

  it('不同图不撞号', () => {
    const a = taskIdOf({ archive: 'Data', resource: 1, image: 2 });
    const b = taskIdOf({ archive: 'Data', resource: 12, image: 0 });
    expect(a).not.toBe(b);
  });
});

describe('★ Q-GND-4：地图底图也要进超分清单', () => {
  /** `cli-extract` 解出来的那条底图 —— 一整张 2304×2304、格式 GND、锚点 0/0 */
  const ground = (): AssetEntryLike =>
    entry({
      archive: 'map',
      resource: 0,
      image: 0,
      file: 'map/0000_000.png',
      width: 2304,
      height: 2304,
      anchorX: 0,
      anchorY: 0,
      format: 'GND',
    });

  it('底图能建出任务（先前它不在清单里，这一条根本不存在）', () => {
    const tasks = planUpscale([ground()]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('map/0000_000');
    expect(tasks[0]!.input).toBe('map/0000_000.png');
  });

  it('★ 分类是 tile —— 底图是地形，放大后要过 T-064 的接缝检查', () => {
    // 2304×2304 按尺寸本会落进 background；GND 来源优先，判成 tile（见 classify.ts）
    expect(planUpscale([ground()])[0]!.category).toBe('tile');
  });

  it('倍率 4×、落 large 批（与 C-AST-3 一致）', () => {
    const t = planUpscale([ground()])[0]!;
    expect(t.scale).toBe(4);
    expect(t.batch).toBe('large');
    expect(t.srcWidth).toBe(2304);
  });

  it('八张底图各自一条，且与结构数据（奇数号资源）不混', () => {
    const entries: AssetEntryLike[] = [];
    for (let m = 0; m < 8; m++) entries.push({ ...ground(), resource: m * 2, file: `map/${String(m * 2).padStart(4, '0')}_000.png` });
    const tasks = planUpscale(entries);
    expect(tasks.map((t) => t.id)).toEqual([
      'map/0000_000',
      'map/0002_000',
      'map/0004_000',
      'map/0006_000',
      'map/0008_000',
      'map/0010_000',
      'map/0012_000',
      'map/0014_000',
    ]);
    expect(summarize(tasks).large).toEqual({ count: 8, scale: 4 });
  });

  it('★ 底图在 hd 里的落点由同一条 hdRelativePath 决定（写读两侧不会漂）', () => {
    expect(hdRelativePath('map', 0, 0)).toBe('map/0-0.png');
    expect(hdRelativePath('map', 14, 0)).toBe('map/14-0.png');
  });
});

describe('增量重跑', () => {
  const setup = () => {
    const tasks = planUpscale([entry({ image: 1 }), entry({ image: 2 })]);
    const m = emptyManifest(tasks);
    m.results[tasks[0]!.id] = recordResult(tasks[0]!, {
      model: 'm1', outWidth: 256, outHeight: 256, srcHash: 'h1', outHash: 'o1',
    });
    return { m, tasks };
  };

  it('没做过的要跑', () => {
    const { m, tasks } = setup();
    const pending = pendingTasks(m, new Map([[tasks[0]!.id, 'h1']]));
    expect(pending.map((t) => t.id)).toEqual([tasks[1]!.id]);
  });

  it('★ 源图变了要重跑', () => {
    const { m, tasks } = setup();
    const pending = pendingTasks(m, new Map([[tasks[0]!.id, 'CHANGED']]));
    expect(pending.map((t) => t.id)).toContain(tasks[0]!.id);
  });

  it('★ 换模型时全部重跑', () => {
    const { m, tasks } = setup();
    const pending = pendingTasks(m, new Map([[tasks[0]!.id, 'h1']]), 'm2');
    expect(pending.map((t) => t.id)).toContain(tasks[0]!.id);
  });

  it('同模型同源图则跳过', () => {
    const { m, tasks } = setup();
    const pending = pendingTasks(m, new Map([[tasks[0]!.id, 'h1']]), 'm1');
    expect(pending.map((t) => t.id)).not.toContain(tasks[0]!.id);
  });
});

describe('★ 真实素材清单', () => {
  run('13000+ 张图能全部规划出任务且分批合理', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { images: AssetEntryLike[] };
    const tasks = planUpscale(m.images);
    expect(tasks.length).toBe(m.images.length);
    expect(tasks.length).toBeGreaterThan(13_000);

    const s = summarize(tasks);
    // 绝大多数是小图——中位面积约 4000 px
    expect(s['small']!.count).toBeGreaterThan(tasks.length / 2);
    // 大图很少 —— 影片帧除外：jump 的过场全是 640×480、Data 的特效多是 440×440，
    // 重新解包（FLIC 接进来之后）那 2500 多帧都落 large
    expect(tasks.filter((t) => t.batch === 'large' && t.format !== 'FLIC').length).toBeLessThan(100);

    // id 全局唯一，否则回填时会互相覆盖
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });

  run('★ 每个任务都带上了源锚点——回填时才算得出新锚点', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { images: AssetEntryLike[] };
    const tasks = planUpscale(m.images.slice(0, 500));
    for (const t of tasks) {
      expect(Number.isInteger(t.srcAnchorX)).toBe(true);
      expect(Number.isInteger(t.srcAnchorY)).toBe(true);
    }
  });

  run('★ FLIC / GND（重新解包之后才有）：影片帧按动画归 sprite 或全屏 background，底图归 tile', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { images: AssetEntryLike[] };
    const tasks = planUpscale(m.images);
    const flic = tasks.filter((t) => t.format === 'FLIC');
    const gnd = tasks.filter((t) => t.format === 'GND');
    if (flic.length === 0 && gnd.length === 0) return; // 旧的 assets-clean：还没有这两种
    for (const t of flic) {
      expect(t.category === 'sprite' || t.category === 'background' || t.category === 'ui').toBe(true);
      if (t.archive !== 'Panel') expect(t.category).not.toBe('ui');
      expect(t.scale).toBe(4);
    }
    for (const t of gnd) expect({ category: t.category, batch: t.batch }).toEqual({ category: 'tile', batch: 'large' });
  });
});

describe('★ 帧数现数（extract 不写 frames，分类器的「多帧 → sprite」先前从没命中过）', () => {
  it('同一资源多张图 → sprite；单张 → 不受影响', () => {
    const tasks = planUpscale([
      entry({ resource: 7, image: 0, file: 'Data/0007_000.png' }),
      entry({ resource: 7, image: 1, file: 'Data/0007_001.png' }),
      entry({ resource: 8, image: 0, file: 'Data/0008_000.png' }),
    ]);
    expect(tasks.map((t) => t.category)).toEqual(['sprite', 'sprite', 'ui']);
  });

  it('★ FLIC 影片帧同理：多帧 → sprite；640×480 的过场仍是 background（尺寸规则在前）', () => {
    const flic = (resource: number, image: number, w: number, h: number): AssetEntryLike =>
      entry({ archive: 'jump', resource, image, file: `jump/${resource}_${image}.png`, width: w, height: h, format: 'FLIC' });
    const tasks = planUpscale([flic(46, 0, 220, 240), flic(46, 1, 220, 240), flic(47, 0, 640, 480), flic(47, 1, 640, 480)]);
    expect(tasks.map((t) => t.category)).toEqual(['sprite', 'sprite', 'background', 'background']);
    expect(tasks.map((t) => t.batch)).toEqual(['medium', 'medium', 'large', 'large']);
  });

  it('显式给了 frames 就尊重它', () => {
    expect(planUpscale([entry({ frames: 5 })])[0]!.category).toBe('sprite');
    expect(planUpscale([entry({ frames: 1 }), entry({ image: 3, frames: 1 })])[0]!.category).toBe('ui');
  });

  it('分组键与任务 id 的前半截一致', () => {
    expect(resourceKeyOf({ archive: 'Data', resource: 2 })).toBe('Data/0002');
    expect(taskIdOf({ archive: 'Data', resource: 2, image: 5 }).startsWith(resourceKeyOf({ archive: 'Data', resource: 2 }))).toBe(true);
  });
});

describe('★ W-80 §4.7：ingest 的产物定位（旧 ingest 只认原名，client 却读 hdRelativePath）', () => {
  const task = { archive: 'Data', resource: 0, image: 0, input: 'Data/0000_000.png' };
  const has = (...files: string[]) => (rel: string) => files.includes(rel);

  it('只有原名那份 → legacy：要从 input 名挪到 hdRelativePath', () => {
    expect(locateIngestOutput(task, has('Data/0000_000.png'))).toEqual({
      kind: 'legacy',
      from: 'Data/0000_000.png',
      to: 'Data/0-0.png',
    });
  });

  it('只有 hdRelativePath 那份 → canonical：原地记账', () => {
    expect(locateIngestOutput(task, has('Data/0-0.png'))).toEqual({ kind: 'canonical', rel: 'Data/0-0.png' });
  });

  it('★ 两处都有 → 认原名那份（那是新放进来的；挪过去即覆盖，重跑只剩 canonical）', () => {
    expect(locateIngestOutput(task, has('Data/0000_000.png', 'Data/0-0.png')).kind).toBe('legacy');
  });

  it('都没有 → absent', () => {
    expect(locateIngestOutput(task, has())).toEqual({ kind: 'absent' });
  });

  it('Windows 分隔符与前导斜杠归一', () => {
    const t = { ...task, input: '\\Data\\0000_000.png' };
    expect(locateIngestOutput(t, has('Data/0000_000.png'))).toMatchObject({ kind: 'legacy', from: 'Data/0000_000.png' });
  });
});

describe('selectTasks（slice --only）', () => {
  const tasks = [
    { archive: 'Data', resource: 381, image: 0 },
    { archive: 'Data', resource: 381, image: 1 },
    { archive: 'Data', resource: 38, image: 0 },
    { archive: 'Panel', resource: 0, image: 0 },
  ];
  it('按「档案/资源号」挑，不会把 38 当成 381 的前缀', () => {
    expect(selectTasks(tasks, ['Data/381', 'Panel/0']).map((t) => `${t.archive}/${t.resource}/${t.image}`)).toEqual([
      'Data/381/0',
      'Data/381/1',
      'Panel/0/0',
    ]);
    expect(selectTasks(tasks, [])).toHaveLength(4);
  });
  it('★ 写错或一个都没命中 → 当场报错', () => {
    expect(() => selectTasks(tasks, ['Data-381'])).toThrow('档案/资源号');
    expect(() => selectTasks(tasks, ['Data/999'])).toThrow('没命中');
  });
});
