/*
 * Q-GND-4：底图走通整条链 —— plan → slice → [外部 4×] → merge → assemble → seams → review
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一条测的不是某个函数，而是**这条链对底图成不成立**：先前底图不在清单里，
 * `planUpscale` 不为它建任务，于是 T-063 的回填与 T-064 的接缝检查**都没有真实输入**，
 * 只能用合成夹具验（旧卡的 notes 里就是这么写的）。
 *
 * 这里在临时目录里真跑一遍：写一张 64×64 的「底图」PNG（格式标 `GND`）、
 * 用最近邻 ×4 冒充外部超分工具交回产物，然后逐步跑 CLI 的每个子命令。
 * 临时目录用 `os.tmpdir()`，跑完删掉。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cmdAssemble, cmdMerge, cmdPlan, cmdReview, cmdSeams, cmdSlice } from './cli-upscale.ts';
import { decodePng, encodePng } from './png.ts';
import type { AssetEntryLike, UpscaleManifest } from './upscale.ts';
import type { QueueManifest } from './slice.ts';

const SIZE = 64; // 2×2 个 32px 块
const SCALE = 4;

/** 一张 64×64 的不透明「底图」：左上深蓝、右下土黄，中间有个斜的过渡 */
function groundPng(): Uint8Array {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      const t = (x + y) / (2 * SIZE);
      rgba[o] = Math.round(30 + t * 180);
      rgba[o + 1] = Math.round(60 + t * 120);
      rgba[o + 2] = Math.round(140 - t * 90);
      rgba[o + 3] = 255;
    }
  }
  return encodePng({ width: SIZE, height: SIZE, anchorX: 0, anchorY: 0, rgba });
}

/** 最近邻 ×4 —— 「外部工具交了产物、但没引入任何伪影」 */
function nearest4x(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const w = SIZE * SCALE;
  const out = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / SCALE) * SIZE + Math.floor(x / SCALE)) * 4;
      const o = (y * w + x) * 4;
      out[o] = rgba[s]!;
      out[o + 1] = rgba[s + 1]!;
      out[o + 2] = rgba[s + 2]!;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 把队列交出去的 rgb/alpha 各自 ×4 放进 upscale-done（冒充外部工具） */
function fakeUpscale(queueDir: string, doneDir: string, damage = 0): void {
  for (const kind of ['rgb', 'alpha'] as const) {
    const src = decodePng(new Uint8Array(readFileSync(join(queueDir, kind, 'map', '0000_f000.png'))));
    const up = nearest4x(src.rgba);
    if (damage !== 0) {
      // 在**非 32px 格线**上划一刀（x=100 → 原图 25，25 % 32 ≠ 0）：
      // 逐块放大那条路永远看不到这一条
      const w = SIZE * SCALE;
      for (let y = 0; y < w; y++) {
        for (let x = 100; x < w; x++) {
          const o = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) up[o + c] = Math.max(0, Math.min(255, up[o + c]! + damage));
        }
      }
    }
    const rel = join('map', '0000_f000.png');
    const p = join(doneDir, kind, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, encodePng({ width: SIZE * SCALE, height: SIZE * SCALE, anchorX: 0, anchorY: 0, rgba: up }));
  }
}

let root = '';
let clean = '';
let hd = '';
let queue = '';
let done = '';

beforeEach(() => {
  // CLI 会往 stdout 打一堆进度，测试里静音
  vi.spyOn(console, 'log').mockImplementation(() => {});
  root = mkdtempSync(join(tmpdir(), 'rich4-gnd-'));
  clean = join(root, 'assets-clean');
  hd = join(root, 'hd');
  queue = join(root, 'queue');
  done = join(root, 'done');
  mkdirSync(join(clean, 'map'), { recursive: true });
  writeFileSync(join(clean, 'map', '0000_000.png'), groundPng());

  // 清单里那一条：格式 GND、锚点 0/0、尺寸 64×64 —— 与 cli-extract 现在的产出一致
  const entry: AssetEntryLike = {
    archive: 'map',
    resource: 0,
    image: 0,
    file: 'map/0000_000.png',
    width: SIZE,
    height: SIZE,
    anchorX: 0,
    anchorY: 0,
    format: 'GND',
  };
  writeFileSync(
    join(clean, 'manifest.json'),
    JSON.stringify({ generatedBy: 'test', images: [entry], raw: [] }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const manifest = (): UpscaleManifest =>
  JSON.parse(readFileSync(join(root, 'hd-manifest.json'), 'utf8')) as UpscaleManifest;

describe('★ Q-GND-4：底图走通 plan → slice → merge → assemble → seams → review', () => {
  it('plan：底图建出了任务（分类 tile、4×）', () => {
    cmdPlan(clean, hd);
    const m = manifest();
    expect(m.tasks).toHaveLength(1);
    expect(m.tasks[0]).toMatchObject({
      id: 'map/0000_000',
      input: 'map/0000_000.png',
      category: 'tile',
      scale: 4,
      format: 'GND',
    });
    // 批次只跟面积走：这张夹具是 64×64（small）；真实的 2304² 底图落 large
    expect(m.tasks[0]!.batch).toBe('small');
  });

  it('★ 全链：slice → merge → assemble → seams → review 都不掉底图', () => {
    cmdPlan(clean, hd);
    cmdSlice(clean, queue);

    const q = JSON.parse(readFileSync(join(queue, 'manifest.json'), 'utf8')) as QueueManifest;
    expect(q.frames).toHaveLength(1);
    expect(q.frames[0]!.model).toBe('realesrgan-x4plus'); // tile 那一档
    // 底图没有透明区：alpha 交出的是全 255 的等灰图
    const alpha = decodePng(new Uint8Array(readFileSync(join(queue, q.frames[0]!.alpha))));
    expect(alpha.rgba[0]).toBe(255);

    fakeUpscale(queue, done);

    cmdMerge(queue, done);
    expect(existsSync(join(done, 'merged', 'map', '0000_f000.png'))).toBe(true);

    cmdAssemble(queue, done, hd);
    // ★ hd 落点就是 client 要读的那个名字（hdRelativePath 单点定义）
    expect(existsSync(join(hd, 'map', '0-0.png'))).toBe(true);
    const rec = manifest().results['map/0000_000'];
    expect(rec).toBeDefined();
    expect({ w: rec!.outWidth, h: rec!.outHeight }).toEqual({ w: SIZE * SCALE, h: SIZE * SCALE });
    expect({ x: rec!.outAnchorX, y: rec!.outAnchorY }).toEqual({ x: 0, y: 0 });

    // ★★ T-064 拿到了**真实输入**：原图与放大图都是从磁盘上读的
    const checked = cmdSeams(hd, clean);
    expect(checked).toHaveLength(1);
    expect(checked[0]!.allChecked).toBeGreaterThan(0);
    expect(checked[0]!.allSeams).toBe(0); // 忠实 ×4：一条都不报
    expect(checked[0]!.offGridSeams).toBe(0);

    cmdReview(hd, clean, join(root, 'review.html'));
    expect(readFileSync(join(root, 'review.html'), 'utf8')).toContain('map/0-0.png');
  });

  it('★ 放大图被划了一刀（非格线）→ 接缝检查报出来，且标成「非格线」', () => {
    cmdPlan(clean, hd);
    cmdSlice(clean, queue);
    fakeUpscale(queue, done, 30); // 在 x=100（非 32px 格线）上注入伪影
    cmdMerge(queue, done);
    cmdAssemble(queue, done, hd);

    const checked = cmdSeams(hd, clean);
    expect(checked).toHaveLength(1);
    expect(checked[0]!.allSeams).toBeGreaterThan(0);
    // ★ 这条正是「逐块放大」那套口径查不到的东西
    expect(checked[0]!.offGridSeams).toBeGreaterThan(0);
    expect(checked[0]!.worst?.onGrid).toBe(false);
  });

  it('★ 没有产物时不报接缝、也不炸（清单里有任务但 hd 目录是空的）', () => {
    cmdPlan(clean, hd);
    expect(cmdSeams(hd, clean)).toEqual([]);
  });

  it('清单里没有底图任务时给出提示并返回空（旧清单的情形）', () => {
    writeFileSync(join(clean, 'manifest.json'), JSON.stringify({ generatedBy: 'test', images: [], raw: [] }));
    cmdPlan(clean, hd);
    expect(cmdSeams(hd, clean)).toEqual([]);
  });
});
