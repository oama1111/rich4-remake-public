/*
 * 整组拼图（W-80 §4.3）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事：拼 → 模拟 k× 放大 → 切回与逐帧放大逐字节相同；隔离带真的隔得住；
 * 超过边长上限就分张；回传尺寸不合规整张拒收。
 */

import { describe, expect, it } from 'vitest';
import type { DecodedImage } from './sprite.ts';
import {
  checkSheetSizes,
  cutCell,
  DEFAULT_GUTTER,
  groupKeyOf,
  GUTTER_RGB,
  inferSheetScale,
  PackScaleError,
  planPack,
  renderSheet,
  unpackSheet,
  type PackCell,
  type PackFrame,
  type PackSheet,
} from './grid.ts';

// ============================================================
//  夹具
// ============================================================

function frame(id: string, width: number, height: number, scale = 4): PackFrame {
  const [archive, rest] = id.split('/') as [string, string];
  const [res, img] = rest.split('_') as [string, string];
  const base = `${archive}/${res}_f${img}`;
  return { id, rgb: `rgb/${base}.png`, alpha: `alpha/${base}.png`, width, height, scale };
}

/** 每帧一张可辨认的图：颜色由 id 的哈希与坐标决定，alpha 图是等灰形式 */
function frameImage(f: PackFrame, kind: 'rgb' | 'alpha'): DecodedImage {
  let h = 0;
  for (const ch of f.id) h = (h * 31 + ch.charCodeAt(0)) & 0xff;
  const rgba = new Uint8ClampedArray(f.width * f.height * 4);
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const o = (y * f.width + x) * 4;
      if (kind === 'rgb') rgba.set([(h + x * 7) & 0xff, (h * 3 + y * 11) & 0xff, (x ^ y ^ h) & 0xff, 255], o);
      else {
        const a = (x + y) % 3 === 0 ? 0 : 255;
        rgba.set([a, a, a, 255], o);
      }
    }
  }
  return { width: f.width, height: f.height, anchorX: 0, anchorY: 0, rgba };
}

/** 最近邻 k× —— 冒充外部 AI 工具 */
function nearestK(img: DecodedImage, k: number): DecodedImage {
  const w = img.width * k;
  const h = img.height * k;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      rgba.set(img.rgba.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, anchorX: 0, anchorY: 0, rgba };
}

/** (2r+1)² 方框模糊 —— 冒充「会往邻近像素渗色」的模型 */
function boxBlur(img: DecodedImage, r: number): DecodedImage {
  const { width, height } = img;
  const rgba = new Uint8ClampedArray(img.rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const s = (ny * width + nx) * 4;
          for (let c = 0; c < 3; c++) sum[c] = sum[c]! + img.rgba[s + c]!;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      rgba.set([Math.round(sum[0]! / n), Math.round(sum[1]! / n), Math.round(sum[2]! / n), 255], o);
    }
  }
  return { width, height, anchorX: 0, anchorY: 0, rgba };
}

const byId = (frames: readonly PackFrame[]) => new Map(frames.map((f) => [f.id, f]));

function render(sheet: PackSheet, frames: readonly PackFrame[], kind: 'rgb' | 'alpha'): DecodedImage {
  const map = byId(frames);
  return renderSheet(sheet, kind, (cell: PackCell) => frameImage(map.get(cell.id)!, kind));
}

/** 两个矩形之间的间隔（x/y 两个方向取大者；重叠为负） */
function gap(a: PackCell, b: PackCell): number {
  const gx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(gx, gy);
}

// ============================================================
//  布局
// ============================================================

describe('planPack（排布）', () => {
  it('帧 id → 分组键：取到资源一级', () => {
    expect(groupKeyOf('Data/0002_005')).toBe('Data/0002');
    expect(groupKeyOf('map/0000_000')).toBe('map/0000');
    expect(() => groupKeyOf('nonsense')).toThrow(/不合约定/);
  });

  it('★ 按 (档案, 资源) 分组，组与帧的顺序同队列；同尺寸帧排成 ⌈√n⌉ 列的规整网格', () => {
    const frames = [
      ...Array.from({ length: 9 }, (_, i) => frame(`Data/0002_00${i}`, 10, 6)),
      frame('Data/0003_000', 5, 5),
      frame('Panel/0002_000', 7, 3),
    ];
    const { sheets, oversize } = planPack(frames);
    expect(oversize).toEqual([]);
    expect(sheets.map((s) => s.name)).toEqual(['Data/0002-0', 'Data/0003-0', 'Panel/0002-0']);
    const s = sheets[0]!;
    expect(s.rgb).toBe('rgb/Data/0002-0.png');
    expect(s.alpha).toBe('alpha/Data/0002-0.png');
    expect(s.cells.map((c) => c.id)).toEqual(frames.slice(0, 9).map((f) => f.id));
    // 3×3 网格，格间 8px
    expect(s.cells.map((c) => [c.x, c.y])).toEqual([
      [0, 0], [18, 0], [36, 0],
      [0, 14], [18, 14], [36, 14],
      [0, 28], [18, 28], [36, 28],
    ]);
    expect({ w: s.width, h: s.height }).toEqual({ w: 46, h: 34 });
    // 单帧组：外圈不留隔离带，拼出来就是那一帧
    expect({ w: sheets[1]!.width, h: sheets[1]!.height }).toEqual({ w: 5, h: 5 });
  });

  it('★ 任意两格至少隔 gutter（尺寸不一的帧也一样）', () => {
    const sizes = [[30, 10], [5, 40], [12, 12], [25, 7], [8, 30], [16, 16], [3, 3], [40, 20]] as const;
    const frames = sizes.map(([w, h], i) => frame(`Data/0100_00${i}`, w, h));
    for (const gutter of [0, 3, DEFAULT_GUTTER]) {
      const { sheets } = planPack(frames, { gutter });
      const cells = sheets.flatMap((s) => s.cells);
      expect(cells).toHaveLength(frames.length);
      for (const s of sheets) {
        for (let i = 0; i < s.cells.length; i++) {
          for (let j = i + 1; j < s.cells.length; j++) expect(gap(s.cells[i]!, s.cells[j]!)).toBeGreaterThanOrEqual(gutter);
        }
      }
    }
  });

  it('★ 超过 --max 就分张，每张边长都不超限；帧一个不丢、不重', () => {
    const frames = Array.from({ length: 23 }, (_, i) => frame(`jump/0047_${String(i).padStart(3, '0')}`, 20, 15));
    const { sheets, oversize } = planPack(frames, { gutter: 4, max: 64 });
    expect(oversize).toEqual([]);
    expect(sheets.length).toBeGreaterThan(1);
    expect(sheets.map((s) => s.name)).toEqual(sheets.map((_, i) => `jump/0047-${i}`));
    for (const s of sheets) {
      expect(s.width).toBeLessThanOrEqual(64);
      expect(s.height).toBeLessThanOrEqual(64);
    }
    expect(sheets.flatMap((s) => s.cells.map((c) => c.id))).toEqual(frames.map((f) => f.id));
  });

  it('单帧就超过 --max：独占一张、列进 oversize，前后的帧照常排', () => {
    const frames = [frame('map/0000_000', 10, 10), frame('map/0000_001', 100, 90), frame('map/0000_002', 10, 10)];
    const { sheets, oversize } = planPack(frames, { max: 64 });
    expect(oversize).toEqual(['map/0000_001']);
    expect(sheets.map((s) => s.cells.map((c) => c.id))).toEqual([['map/0000_000'], ['map/0000_001'], ['map/0000_002']]);
    expect({ w: sheets[1]!.width, h: sheets[1]!.height }).toEqual({ w: 100, h: 90 });
  });

  it('参数不合法就抛', () => {
    expect(() => planPack([], { gutter: -1 })).toThrow(/gutter/);
    expect(() => planPack([], { max: 0 })).toThrow(/max/);
  });
});

// ============================================================
//  拼 / 切
// ============================================================

describe('renderSheet / unpackSheet', () => {
  const frames = [
    frame('Data/0381_000', 9, 7),
    frame('Data/0381_001', 9, 7),
    frame('Data/0381_002', 6, 11),
    frame('Data/0381_003', 13, 4),
    frame('Data/0381_004', 9, 7),
  ];

  it('空白处：rgb 填中性灰、alpha 填 0（等灰形式，自身 alpha 255）', () => {
    const { sheets } = planPack(frames);
    const s = sheets[0]!;
    const rgb = render(s, frames, 'rgb');
    const alpha = render(s, frames, 'alpha');
    // 第一格与第二格之间的隔离带
    const gx = s.cells[0]!.x + s.cells[0]!.width + 1;
    const o = (0 * s.width + gx) * 4;
    expect([...rgb.rgba.subarray(o, o + 4)]).toEqual([...GUTTER_RGB, 255]);
    expect([...alpha.rgba.subarray(o, o + 4)]).toEqual([0, 0, 0, 255]);
  });

  it('★ 往返：拼 → 最近邻 k× → 切回，与逐帧最近邻 k× 逐字节相同（k = 1..4）', () => {
    const { sheets } = planPack(frames);
    for (const k of [1, 2, 3, 4]) {
      for (const s of sheets) {
        const out = unpackSheet(s, nearestK(render(s, frames, 'rgb'), k), nearestK(render(s, frames, 'alpha'), k));
        expect(out.k).toBe(k);
        for (const { cell, rgb, alpha } of out.cells) {
          const f = byId(frames).get(cell.id)!;
          expect({ w: rgb.width, h: rgb.height }).toEqual({ w: f.width * k, h: f.height * k });
          expect([...rgb.rgba]).toEqual([...nearestK(frameImage(f, 'rgb'), k).rgba]);
          expect([...alpha.rgba]).toEqual([...nearestK(frameImage(f, 'alpha'), k).rgba]);
        }
      }
    }
  });

  it('★ 隔离带隔得住：模型往外渗 < 隔离带宽度时，邻格换了内容本格一个字节都不变', () => {
    const k = 4;
    const { sheets } = planPack(frames); // 默认隔离带 8px → 放大后 32px
    const s = sheets[0]!;
    const base = nearestK(render(s, frames, 'rgb'), k);
    // 把第二格整个换成纯白（邻格内容剧变）
    const other = nearestK(render(s, frames, 'rgb'), k);
    const c1 = s.cells[1]!;
    for (let y = c1.y * k; y < (c1.y + c1.height) * k; y++) {
      for (let x = c1.x * k; x < (c1.x + c1.width) * k; x++) other.rgba.set([255, 255, 255, 255], (y * other.width + x) * 4);
    }
    // 渗色半径 15 < 32 / 2：两格各自的渗色都到不了对方
    const r = 15;
    const a = boxBlur(base, r);
    const b = boxBlur(other, r);
    for (const cell of s.cells) {
      if (cell.id === c1.id) continue;
      expect([...cutCell(b, cell, k).rgba]).toEqual([...cutCell(a, cell, k).rgba]);
    }
    // 反证：隔离带为 0 时同样的渗色会串到紧挨着的那一格
    const tight = planPack(frames, { gutter: 0 }).sheets[0]!;
    const ta = nearestK(render(tight, frames, 'rgb'), k);
    const tb = nearestK(render(tight, frames, 'rgb'), k);
    const t1 = tight.cells[1]!;
    for (let y = t1.y * k; y < (t1.y + t1.height) * k; y++) {
      for (let x = t1.x * k; x < (t1.x + t1.width) * k; x++) tb.rgba.set([255, 255, 255, 255], (y * tb.width + x) * 4);
    }
    const t0 = tight.cells[0]!;
    expect([...cutCell(boxBlur(tb, r), t0, k).rgba]).not.toEqual([...cutCell(boxBlur(ta, r), t0, k).rgba]);
  });

  it('★ fill: edge —— 隔离带靠格的一半填格的边缘色，中间仍是平灰；格内不动', () => {
    const { sheets } = planPack(frames); // 格 0 在 (0,0) 9×7，格 1 在 (17,0)
    const s = sheets[0]!;
    const map = byId(frames);
    const edged = renderSheet(s, 'rgb', (c) => frameImage(map.get(c.id)!, 'rgb'), { gutter: DEFAULT_GUTTER });
    const flat = render(s, frames, 'rgb');
    const at = (img: DecodedImage, x: number, y: number) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    const f0 = frameImage(frames[0]!, 'rgb');
    // 格 0 右边外 1..4 列 = 格 0 最右一列；第 5..8 列里靠格 1 那一半 = 格 1 最左一列
    for (let dx = 0; dx < 4; dx++) expect(at(edged, 9 + dx, 3)).toEqual(at(f0, 8, 3));
    const f1 = frameImage(frames[1]!, 'rgb');
    for (let dx = 0; dx < 4; dx++) expect(at(edged, 13 + dx, 3)).toEqual(at(f1, 0, 3));
    // 格内逐字节与 flat 相同
    for (const c of s.cells) expect([...cutCell(edged, c, 1).rgba]).toEqual([...cutCell(flat, c, 1).rgba]);
    // 离所有格都超过半条隔离带的空白（第 2 行格 3 右边的行尾）仍是平灰
    const c3 = s.cells[3]!;
    expect(at(edged, s.width - 1, c3.y)).toEqual([...GUTTER_RGB, 255]);
  });

  it('★ fill: edge —— 往返仍逐字节；渗色半径 < 半条隔离带时仍隔得住', () => {
    const k = 4;
    const { sheets } = planPack(frames);
    const s = sheets[0]!;
    const map = byId(frames);
    const edge = { gutter: DEFAULT_GUTTER };
    const out = unpackSheet(
      s,
      nearestK(renderSheet(s, 'rgb', (c) => frameImage(map.get(c.id)!, 'rgb'), edge), k),
      nearestK(renderSheet(s, 'alpha', (c) => frameImage(map.get(c.id)!, 'alpha'), edge), k),
    );
    for (const { cell, rgb } of out.cells) expect([...rgb.rgba]).toEqual([...nearestK(frameImage(map.get(cell.id)!, 'rgb'), k).rgba]);

    const base = nearestK(renderSheet(s, 'rgb', (c) => frameImage(map.get(c.id)!, 'rgb'), edge), k);
    const whiteOne = (c: PackCell) => {
      const f = frameImage(map.get(c.id)!, 'rgb');
      if (c.id === s.cells[1]!.id) f.rgba.fill(255);
      return f;
    };
    const other = nearestK(renderSheet(s, 'rgb', whiteOne, edge), k);
    const r = 15; // < 4 × 8 / 2
    const a = boxBlur(base, r);
    const b = boxBlur(other, r);
    for (const cell of s.cells) {
      if (cell.id === s.cells[1]!.id) continue;
      expect([...cutCell(b, cell, k).rgba]).toEqual([...cutCell(a, cell, k).rgba]);
    }
  });

  it('帧的实际尺寸与布局不符：拼的时候就抛', () => {
    const { sheets } = planPack(frames);
    expect(() =>
      renderSheet(sheets[0]!, 'rgb', (cell) => frameImage({ ...byId(frames).get(cell.id)!, width: 2 }, 'rgb')),
    ).toThrow(/不符/);
  });
});

// ============================================================
//  回传尺寸校验
// ============================================================

describe('★ 回传尺寸不合规：整张拒收', () => {
  const sheet: PackSheet = planPack([frame('Data/0001_000', 10, 6), frame('Data/0001_001', 10, 6)]).sheets[0]!;

  it('统一整数倍才收', () => {
    expect(inferSheetScale(sheet, sheet.width * 4, sheet.height * 4)).toBe(4);
    expect(inferSheetScale(sheet, sheet.width, sheet.height)).toBe(1);
  });

  it('两轴倍率不一致 → 拒', () => {
    expect(() => inferSheetScale(sheet, sheet.width * 4, sheet.height * 3)).toThrow(PackScaleError);
    expect(() => inferSheetScale(sheet, sheet.width * 4, sheet.height * 3)).toThrow(/两轴倍率不一致/);
  });

  it('非整数倍（工具把尺寸对齐过了）→ 拒', () => {
    expect(() => inferSheetScale(sheet, sheet.width * 4 + 2, sheet.height * 4)).toThrow(/不是布局 .* 的整数倍/);
  });

  it('rgb 与 alpha 尺寸不一致 → 拒', () => {
    expect(() =>
      checkSheetSizes(sheet, { width: sheet.width * 4, height: sheet.height * 4 }, { width: sheet.width * 2, height: sheet.height * 2 }),
    ).toThrow(/互不一致/);
  });

  it('切格越界 → 拒（而不是静默切出半张）', () => {
    const tiny: DecodedImage = { width: 4, height: 4, anchorX: 0, anchorY: 0, rgba: new Uint8ClampedArray(64) };
    expect(() => cutCell(tiny, sheet.cells[1]!, 1)).toThrow(PackScaleError);
  });
});
