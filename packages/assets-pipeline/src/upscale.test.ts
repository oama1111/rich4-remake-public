/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 超分管线
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  BATCH_RULES,
  classify,
  emptyManifest,
  pendingTasks,
  planUpscale,
  recordResult,
  scaleAnchor,
  summarize,
  taskIdOf,
  type AssetEntryLike,
} from './upscale.ts';

const MANIFEST = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/assets-clean/manifest.json';
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
    // 大图很少
    expect(s['large']?.count ?? 0).toBeLessThan(100);

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
});
