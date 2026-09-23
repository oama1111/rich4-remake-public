/*
 * W-80 §4 管线补课：整条链在磁盘上真跑一遍
 *   plan → slice → pack → [冒充外部 AI：拼图最近邻 ×4] → unpack → merge → assemble → gate → tier
 * 以及 ingest 的路径修正（§4.7）。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 与 cli-upscale.test.ts（Q-GND-4 那条）同一个做法：临时目录、CLI 子命令逐个调，
 * 测的是「这些命令接起来成不成立」—— 各模块的纯函数另有各自的单测。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  cmdAssemble,
  cmdGate,
  cmdIngest,
  cmdMerge,
  cmdPack,
  cmdPlan,
  cmdSlice,
  cmdTier,
  cmdUnpack,
  parseFlags,
} from './cli-upscale.ts';
import { decodePng, encodePng } from './png.ts';
import type { DecodedImage } from './sprite.ts';
import type { AssetEntryLike, UpscaleManifest } from './upscale.ts';
import type { QueueManifest } from './slice.ts';
import type { PackLayout } from './grid.ts';
import type { GateReport } from './gate.ts';

// ============================================================
//  夹具
// ============================================================

const K = 4;

function image(w: number, h: number, at: (x: number, y: number) => readonly number[]): DecodedImage {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(at(x, y), (y * w + x) * 4);
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba };
}

function nearestK(img: DecodedImage, k: number): DecodedImage {
  return image(img.width * k, img.height * k, (x, y) => {
    const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
    return [...img.rgba.subarray(s, s + 4)];
  });
}

/** 一帧精灵：透明底上一块渐变，帧号决定块的位置（动起来） */
function spriteFrame(f: number): DecodedImage {
  return image(10, 8, (x, y) =>
    x >= 2 + f && x < 7 + f && y >= 1 && y < 7 ? [60 + 15 * x, 40 + 20 * y, 200 - 10 * f, 255] : [0, 0, 0, 0],
  );
}

/** 一帧 FLIC：整帧有图，但索引 0 那几处透明（flic.ts 的约定） */
function flicFrame(f: number): DecodedImage {
  return image(12, 12, (x, y) => ((x + y + f) % 11 === 0 ? [0, 0, 0, 0] : [100 + 10 * x, 80 + 5 * y, 60 + 20 * f, 255]));
}

function entry(archive: string, resource: number, image_: number, img: DecodedImage, format: AssetEntryLike['format']): AssetEntryLike {
  return {
    archive,
    resource,
    image: image_,
    file: `${archive}/${String(resource).padStart(4, '0')}_${String(image_).padStart(3, '0')}.png`,
    width: img.width,
    height: img.height,
    anchorX: 5,
    anchorY: 7,
    format,
  };
}

let root = '';
let clean = '';
let hd = '';
let queue = '';
let pack = '';
let packDone = '';
let done = '';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  root = mkdtempSync(join(tmpdir(), 'rich4-w80-'));
  clean = join(root, 'assets-clean');
  hd = join(root, 'hd');
  queue = join(root, 'queue');
  pack = join(root, 'pack');
  packDone = join(root, 'pack-done');
  done = join(root, 'done');

  const entries: AssetEntryLike[] = [];
  const put = (e: AssetEntryLike, img: DecodedImage): void => {
    const p = join(clean, e.file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, encodePng(img));
    entries.push(e);
  };
  for (let f = 0; f < 3; f++) put(entry('Data', 5, f, spriteFrame(f), 'SPR'), spriteFrame(f));
  for (let f = 0; f < 2; f++) put(entry('Data', 416, f, flicFrame(f), 'FLIC'), flicFrame(f));
  writeFileSync(join(clean, 'manifest.json'), JSON.stringify({ generatedBy: 'test', images: entries, raw: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** `<dir>-manifest.json`（与 dir 同级，cli-upscale 的约定） */
const manifestOf = (dir: string): UpscaleManifest =>
  JSON.parse(readFileSync(join(dirname(dir), `${basename(dir)}-manifest.json`), 'utf8')) as UpscaleManifest;

/** 冒充外部 AI：把 pack 目录里每张拼图最近邻 ×k 放进 pack-done（同名） */
function fakeUpscaleSheets(k: number, only?: (rel: string) => boolean): void {
  const layout = JSON.parse(readFileSync(join(pack, 'layout.json'), 'utf8')) as PackLayout;
  for (const s of layout.sheets) {
    for (const rel of [s.rgb, s.alpha]) {
      if (only !== undefined && !only(rel)) continue;
      const src = decodePng(new Uint8Array(readFileSync(join(pack, rel))));
      const out = join(packDone, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, encodePng(nearestK(src, k)));
    }
  }
}

function runChainToHd(): void {
  cmdPlan(clean, hd);
  cmdSlice(clean, queue);
  cmdPack(queue, pack);
  fakeUpscaleSheets(K);
  cmdUnpack(pack, packDone, done);
  cmdMerge(queue, done);
  cmdAssemble(queue, done, hd);
}

// ============================================================
//  FLIC 过 plan → slice
// ============================================================

describe('★ FLIC 过 plan → slice', () => {
  it('影片帧按帧数归 sprite、4×；索引 0 的透明处照常切进 alpha', () => {
    cmdPlan(clean, hd);
    const m = manifestOf(hd);
    const flic = m.tasks.filter((t) => t.format === 'FLIC');
    expect(flic.map((t) => ({ id: t.id, category: t.category, scale: t.scale }))).toEqual([
      { id: 'Data/0416_000', category: 'sprite', scale: 4 },
      { id: 'Data/0416_001', category: 'sprite', scale: 4 },
    ]);

    cmdSlice(clean, queue);
    const q = JSON.parse(readFileSync(join(queue, 'manifest.json'), 'utf8')) as QueueManifest;
    const f0 = q.frames.find((f) => f.id === 'Data/0416_000')!;
    expect(f0.model).toBe('realesrgan-x4plus-anime');
    const alpha = decodePng(new Uint8Array(readFileSync(join(queue, f0.alpha))));
    const values = new Set<number>();
    for (let i = 0; i < alpha.rgba.length; i += 4) values.add(alpha.rgba[i]!);
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255]);
  });
});

// ============================================================
//  pack → unpack → merge → assemble → gate → tier
// ============================================================

describe('★ 整条链：plan → slice → pack → [AI] → unpack → merge → assemble → gate → tier', () => {
  it('拼图按资源分组；切回的逐帧产物与不拼图时同名，merge/assemble 照常落盘', () => {
    runChainToHd();

    const layout = JSON.parse(readFileSync(join(pack, 'layout.json'), 'utf8')) as PackLayout;
    expect(layout.sheets.map((s) => s.name)).toEqual(['Data/0005-0', 'Data/0416-0']);
    expect(layout.gutter).toBe(8);
    expect(existsSync(join(pack, 'rgb', 'Data', '0005-0.png'))).toBe(true);
    expect(existsSync(join(pack, 'alpha', 'Data', '0416-0.png'))).toBe(true);

    // unpack 落的名字就是队列里的名字
    expect(readdirSync(join(done, 'rgb', 'Data')).sort()).toEqual([
      '0005_f000.png', '0005_f001.png', '0005_f002.png', '0416_f000.png', '0416_f001.png',
    ]);
    const report = JSON.parse(readFileSync(join(done, 'merge-report.json'), 'utf8')) as { merged: string[]; rejected: unknown[] };
    expect(report.rejected).toEqual([]);
    expect(report.merged).toHaveLength(5);

    const m = manifestOf(hd);
    expect(Object.keys(m.results)).toHaveLength(5);
    expect(existsSync(join(hd, 'Data', '5-2.png'))).toBe(true);
    expect(m.results['Data/0005_000']).toMatchObject({ outWidth: 40, outHeight: 32, outAnchorX: 20, outAnchorY: 28 });
  });

  it('★ gate：忠实放大全部过，报告写在 hd 同级', () => {
    runChainToHd();
    const r = cmdGate(hd, clean);
    expect(r.summary).toEqual({ checked: 5, passed: 5, failed: 0 });
    for (const row of r.rows) {
      expect(row.iou).toBe(1);
      expect(row.meanDeltaE).toBeLessThan(0.5);
    }
    const onDisk = JSON.parse(readFileSync(join(root, 'hd-gate-report.json'), 'utf8')) as GateReport;
    expect(onDisk.summary.passed).toBe(5);
  });

  it('★ gate：一张被换了色、一张被删了 → 两张打回', () => {
    runChainToHd();
    const p = join(hd, 'Data', '5-1.png');
    const img = decodePng(new Uint8Array(readFileSync(p)));
    for (let i = 0; i < img.rgba.length; i += 4) if (img.rgba[i + 3] !== 0) img.rgba.set([10, 250, 10], i);
    writeFileSync(p, encodePng(img));
    rmSync(join(hd, 'Data', '416-0.png'));

    const r = cmdGate(hd, clean);
    expect(r.summary).toEqual({ checked: 5, passed: 3, failed: 2 });
    const bad = r.rows.filter((row) => !row.pass).map((row) => row.id).sort();
    expect(bad).toEqual(['Data/0005_001', 'Data/0416_000']);
  });

  it('★ tier 2×：同名落盘、尺寸 = 原图 × 2、清单重算锚点并带 +tier2x', () => {
    runChainToHd();
    const out = join(root, 'hd-2x');
    cmdTier(hd, out, 2);
    const img = decodePng(new Uint8Array(readFileSync(join(out, 'Data', '5-0.png'))));
    expect({ w: img.width, h: img.height }).toEqual({ w: 20, h: 16 });
    const m = manifestOf(out);
    expect(m.tasks).toHaveLength(5);
    expect(m.results['Data/0005_000']).toMatchObject({
      outWidth: 20,
      outHeight: 16,
      outAnchorX: 10,
      outAnchorY: 14,
      model: 'realesrgan-x4plus-anime+tier2x',
    });
    // 这一档缩回原尺寸也过闸（同一把 downscaleArea）
    expect(cmdGate(out, clean).summary.failed).toBe(0);
  });

  it('★ unpack：回传尺寸不合规的整张拒收、一格不切；另一张照常切', () => {
    cmdPlan(clean, hd);
    cmdSlice(clean, queue);
    cmdPack(queue, pack);
    fakeUpscaleSheets(K);
    // 把精灵那组的 alpha 换成 ×3 —— rgb 与 alpha 倍率不一致
    const alphaRel = join('alpha', 'Data', '0005-0.png');
    const src = decodePng(new Uint8Array(readFileSync(join(pack, alphaRel))));
    writeFileSync(join(packDone, alphaRel), encodePng(nearestK(src, 3)));

    const r = cmdUnpack(pack, packDone, done);
    expect(r.rejected.map((x) => x.sheet)).toEqual(['Data/0005-0']);
    expect(r.rejected[0]!.detail).toMatch(/互不一致/);
    expect(r.frames).toBe(2);
    expect(existsSync(join(done, 'rgb', 'Data', '0005_f000.png'))).toBe(false);
    expect(existsSync(join(done, 'rgb', 'Data', '0416_f000.png'))).toBe(true);
  });

  it('unpack：还没交回的拼图不算错；倍率与队列不符的给出警告', () => {
    cmdPlan(clean, hd);
    cmdSlice(clean, queue);
    cmdPack(queue, pack);
    fakeUpscaleSheets(2, (rel) => rel.includes('0416'));
    const r = cmdUnpack(pack, packDone, done);
    expect(r.absent).toBe(1);
    expect(r.rejected).toEqual([]);
    expect(r.scaleWarnings).toHaveLength(1);
    expect(r.scaleWarnings[0]).toMatch(/×2.*×4/);
  });
});

// ============================================================
//  ingest（W-80 §4.7）
// ============================================================

describe('★ W-80 §4.7：ingest 落到 client 读的 hdRelativePath', () => {
  /** 按素材原名（旧路径的约定）放一张 4× 产物进 hd 目录 */
  function dropLegacy(input: string, img: DecodedImage): void {
    const p = join(hd, input);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, encodePng(nearestK(img, K)));
  }

  it('原名放进来的被挪到 hdRelativePath 并记账；重跑幂等', () => {
    cmdPlan(clean, hd);
    dropLegacy('Data/0005_000.png', spriteFrame(0));

    cmdIngest(clean, hd, 'manual');
    expect(existsSync(join(hd, 'Data', '0005_000.png'))).toBe(false);
    expect(existsSync(join(hd, 'Data', '5-0.png'))).toBe(true);
    const first = manifestOf(hd);
    expect(first.results['Data/0005_000']).toMatchObject({ model: 'manual', outWidth: 40, outHeight: 32, outAnchorX: 20 });

    cmdIngest(clean, hd, 'manual');
    const second = manifestOf(hd);
    expect(second.results).toEqual(first.results);
    expect(existsSync(join(hd, 'Data', '5-0.png'))).toBe(true);
  });

  it('★ 不会把 assemble 记的配方用默认模型名冲掉（产物未变就沿用旧记录）', () => {
    runChainToHd();
    const before = manifestOf(hd).results;
    cmdIngest(clean, hd, 'unknown');
    expect(manifestOf(hd).results).toEqual(before);
  });

  it('比源图还小的产物不挪、不记', () => {
    cmdPlan(clean, hd);
    const p = join(hd, 'Data/0005_001.png');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, encodePng(image(4, 4, () => [1, 1, 1, 255]))); // 源图 10×8
    cmdIngest(clean, hd, 'manual');
    expect(existsSync(p)).toBe(true);
    expect(existsSync(join(hd, 'Data', '5-1.png'))).toBe(false);
    expect(manifestOf(hd).results['Data/0005_001']).toBeUndefined();
  });
});

// ============================================================
//  参数
// ============================================================

describe('parseFlags', () => {
  it('数值参数、可选项参数、位置参数各归各；--名字=值 也认', () => {
    expect(parseFlags(['a', '--gutter', '4', 'b', '--max=512', '--fill', 'edge'], ['gutter', 'max'], { fill: ['flat', 'edge'] })).toEqual({
      positional: ['a', 'b'],
      flags: { gutter: 4, max: 512 },
      text: { fill: 'edge' },
    });
  });

  it('未知参数、缺值、非数、不在可选项里都抛', () => {
    expect(() => parseFlags(['--nope', '1'], ['iou'])).toThrow(/未知参数/);
    expect(() => parseFlags(['--iou'], ['iou'])).toThrow(/需要一个数/);
    expect(() => parseFlags(['--iou', 'abc'], ['iou'])).toThrow(/需要一个数/);
    expect(() => parseFlags(['--fill', 'blur'], [], { fill: ['flat', 'edge'] })).toThrow(/只能是/);
  });
});

describe('pack --fill edge 走通整条链', () => {
  it('布局里记下填法；切回、merge、assemble、gate 照常', () => {
    cmdPlan(clean, hd);
    cmdSlice(clean, queue);
    const layout = cmdPack(queue, pack, { fill: 'edge' });
    expect(layout.fill.mode).toBe('edge');
    fakeUpscaleSheets(K);
    cmdUnpack(pack, packDone, done);
    cmdMerge(queue, done);
    cmdAssemble(queue, done, hd);
    expect(cmdGate(hd, clean).summary).toEqual({ checked: 5, passed: 5, failed: 0 });
  });
});
