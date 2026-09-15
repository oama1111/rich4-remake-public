/*
 * T-064：地形 tile 接缝检查与修补
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { GND_TILE_HEIGHT, GND_TILE_WIDTH, type GroundImage } from './ground.ts';
import {
  compareAllSeams,
  compareTileSeams,
  deltaE76,
  featherSeams,
  findTileSeams,
  srgbToLab,
  SEAM_THRESHOLD,
  type SeamReport,
} from './seams.ts';

// ============================================================
//  夹具
// ============================================================

type Rgb = readonly [number, number, number];

/** 造一张 tilesX×tilesY 的底图，每格填充一个纯色 */
function makeGround(tilesX: number, tilesY: number, paint: (tx: number, ty: number) => Rgb): GroundImage {
  return makeImage(tilesX * GND_TILE_WIDTH, tilesY * GND_TILE_HEIGHT, (x, y) =>
    paint(Math.floor(x / GND_TILE_WIDTH), Math.floor(y / GND_TILE_HEIGHT)),
  );
}

/** 逐像素上色，用来造渐变与噪声 */
function makeImage(width: number, height: number, paint: (x: number, y: number) => Rgb, tilesX = 0): GroundImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  const tx = tilesX === 0 ? Math.floor(width / GND_TILE_WIDTH) : tilesX;
  return { width, height, tilesX: tx, tilesY: Math.floor(height / GND_TILE_HEIGHT), rgba };
}

/** 确定性 LCG —— 测试里不许用 Math.random */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 同分布的高频噪声纹理：整幅图统计上一致，只是逐像素互不相关 */
function noisyGround(tilesX: number, tilesY: number, seed = 7): GroundImage {
  const rnd = lcg(seed);
  return makeImage(tilesX * GND_TILE_WIDTH, tilesY * GND_TILE_HEIGHT, () => {
    const v = 110 + Math.round((rnd() - 0.5) * 80);
    return [v, v, v];
  });
}

/** 最近邻 ×4 —— 「没有引入任何伪影」的放大参照 */
function nearest4x(img: GroundImage): GroundImage {
  const width = img.width * 4;
  const height = img.height * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const so = (Math.floor(y / 4) * img.width + Math.floor(x / 4)) * 4;
      const o = (y * width + x) * 4;
      rgba[o] = img.rgba[so]!;
      rgba[o + 1] = img.rgba[so + 1]!;
      rgba[o + 2] = img.rgba[so + 2]!;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, tilesX: img.tilesX, tilesY: img.tilesY, rgba };
}

function px(img: GroundImage, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}

/** 某条缝两侧的带内均值 ΔE —— 羽化前后对比用 */
function seamDeltaE(img: GroundImage, side: 'right' | 'bottom', tx: number, ty: number, band = 2): number {
  const mean = (x0: number, x1: number, y0: number, y1: number) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const [pr, pg, pb] = px(img, x, y);
        r += pr;
        g += pg;
        b += pb;
        n++;
      }
    return srgbToLab(r / n, g / n, b / n);
  };
  if (side === 'right') {
    const bx = (tx + 1) * GND_TILE_WIDTH;
    const y0 = ty * GND_TILE_HEIGHT;
    return deltaE76(mean(bx - band, bx, y0, y0 + GND_TILE_HEIGHT), mean(bx, bx + band, y0, y0 + GND_TILE_HEIGHT));
  }
  const by = (ty + 1) * GND_TILE_HEIGHT;
  const x0 = tx * GND_TILE_WIDTH;
  return deltaE76(mean(x0, x0 + GND_TILE_WIDTH, by - band, by), mean(x0, x0 + GND_TILE_WIDTH, by, by + band));
}

// ============================================================
//  色差度量
// ============================================================

describe('sRGB → Lab 与 CIE76 ΔE', () => {
  it('★ 黑与白的 ΔE 为 100（L* 的两端本来就是 0 与 100，中性色 a=b=0）', () => {
    // 容差放到 5e-5：sRGB→XYZ 的标准矩阵系数是 7 位小数，白点也取 5 位，
    // 于是理论上精确的 100 实际会差几个 1e-6。属正常浮点误差，不是度量有问题。
    expect(deltaE76(srgbToLab(0, 0, 0), srgbToLab(255, 255, 255))).toBeCloseTo(100, 4);
  });

  it('同一个颜色 ΔE 为 0', () => {
    expect(deltaE76(srgbToLab(37, 200, 91), srgbToLab(37, 200, 91))).toBe(0);
  });

  it('对称', () => {
    const p = srgbToLab(12, 34, 56);
    const q = srgbToLab(210, 8, 140);
    expect(deltaE76(p, q)).toBeCloseTo(deltaE76(q, p), 12);
  });

  it('中性色的 a、b 都是 0（灰必须落在 L* 轴上）', () => {
    // 同样受矩阵系数舍入影响：三行系数各自之和与白点略有出入，误差经 cbrt
    // 放大后实测最大约 1.7e-5（出现在纯白处）。故容差取 5e-5。
    for (const v of [0, 64, 128, 200, 255]) {
      const lab = srgbToLab(v, v, v);
      expect(lab.a).toBeCloseTo(0, 4);
      expect(lab.b).toBeCloseTo(0, 4);
    }
  });

  it('★ 度量不是 RGB 欧氏距离的换皮：黑 vs 纯绿的 ΔE 远小于 255', () => {
    const d = deltaE76(srgbToLab(0, 0, 0), srgbToLab(0, 255, 0));
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(180);
  });
});

// ============================================================
//  绝对检查（诊断）
// ============================================================

describe('findTileSeams —— 无缝样本报 0 条', () => {
  it('纯色整图：没有缝，但缝确实都检查过了', () => {
    const img = makeGround(3, 2, () => [120, 90, 60]);
    const r = findTileSeams(img);
    expect(r.seams).toEqual([]);
    // 3×2 格：右邻 2×2 = 4 条，下邻 3×1 = 3 条
    expect(r.checked).toBe(7);
    expect(r.tilesX).toBe(3);
    expect(r.tilesY).toBe(2);
    expect(r.threshold).toBe(SEAM_THRESHOLD);
  });

  it('平滑渐变横跨格边界也不报 —— 报的是「接缝」不是「相邻不同」', () => {
    const img = makeImage(4 * GND_TILE_WIDTH, GND_TILE_HEIGHT, (x) => [x, x, x]);
    expect(findTileSeams(img).seams).toEqual([]);
  });

  it('★ 高频噪声纹理不报 —— 实测教训的回归测试', () => {
    // 同分布噪声：逐像素看相邻像素毫不相关，但两侧统计上一致。
    // 只用逐像素 ΔE 会把这里**每一条**缝都报出来（真实地图上是 10224/10224）。
    const img = noisyGround(4, 3);
    const r = findTileSeams(img, { band: 4 });

    expect(r.seams).toEqual([]);
    // 而诊断值确实很大 —— 证明「逐像素 ΔE」确实分辨不了噪声
    const anySeam = findTileSeams(img, { band: 4, threshold: -1 }).seams[0]!;
    expect(anySeam.pixelDeltaE).toBeGreaterThan(5);
    expect(anySeam.deltaE).toBeLessThan(SEAM_THRESHOLD);
  });
});

describe('findTileSeams —— 硬边界被检出', () => {
  it('左右两格硬边界：报在 right，位置落在缝上', () => {
    const img = makeGround(2, 1, (tx) => (tx === 0 ? [10, 10, 10] : [240, 240, 240]));
    const r = findTileSeams(img);

    expect(r.seams).toHaveLength(1);
    const s = r.seams[0]!;
    expect(s.side).toBe('right');
    expect(s.tile).toEqual({ x: 0, y: 0 });
    expect(s.neighbor).toEqual({ x: 1, y: 0 });
    expect(s.pixel).toEqual({ x: GND_TILE_WIDTH, y: Math.floor(GND_TILE_HEIGHT / 2) });
    expect(s.deltaE).toBeGreaterThan(80);
  });

  it('上下两格硬边界：报在 bottom', () => {
    const img = makeGround(1, 2, (_tx, ty) => (ty === 0 ? [10, 10, 10] : [240, 240, 240]));
    const r = findTileSeams(img);

    expect(r.seams).toHaveLength(1);
    expect(r.seams[0]!.side).toBe('bottom');
    expect(r.seams[0]!.pixel).toEqual({ x: Math.floor(GND_TILE_WIDTH / 2), y: GND_TILE_HEIGHT });
  });

  it('阈值与取带深度可覆盖', () => {
    const img = makeGround(2, 1, (tx) => (tx === 0 ? [10, 10, 10] : [240, 240, 240]));
    const loose = findTileSeams(img, { threshold: 500 });
    expect(loose.seams).toEqual([]);
    expect(loose.threshold).toBe(500);

    // band 大到越过格子时读的是邻格内容，这里只确认参数被接受
    expect(findTileSeams(img, { band: 1 }).seams).toHaveLength(1);
  });

  it('多条缝按 ΔE 降序排（最刺眼的在最前）', () => {
    // tx=0|1 是全黑对全白（最刺眼）；tx=1|2 是白对浅灰（较轻微）
    const img = makeGround(3, 1, (tx) => (tx === 0 ? [0, 0, 0] : tx === 1 ? [255, 255, 255] : [235, 235, 235]));
    const r = findTileSeams(img);

    expect(r.seams.length).toBe(2);
    expect(r.seams[0]!.tile.x).toBe(0);
    expect(r.seams[1]!.tile.x).toBe(1);
    expect(r.seams[0]!.deltaE).toBeGreaterThan(r.seams[1]!.deltaE);
  });

  it('给了排布表就带上两侧源块号（能反查该重超分哪一块）', () => {
    const img = makeGround(2, 1, (tx) => (tx === 0 ? [10, 10, 10] : [240, 240, 240]));
    const r = findTileSeams(img, { layout: new Uint16Array([7, 3]) });
    expect(r.seams[0]!.blocks).toEqual({ tile: 7, neighbor: 3 });
  });

  it('不给排布表就不带 blocks 字段', () => {
    const img = makeGround(2, 1, (tx) => (tx === 0 ? [10, 10, 10] : [240, 240, 240]));
    expect(findTileSeams(img).seams[0]!.blocks).toBeUndefined();
  });
});

// ============================================================
//  ★ 放大前后对比 —— C-AST-7 的验收判据
// ============================================================

describe('compareTileSeams —— 放大后新增的接缝', () => {
  const src = (): GroundImage => noisyGround(4, 3);

  it('★ 忠实放大不报：最近邻 ×4 的 before 与 after 完全一致', () => {
    const original = src();
    const r = compareTileSeams(original, nearest4x(original));

    expect(r.seams).toEqual([]);
    // 4×3 格：右邻缝 (4-1)×3 = 9 条，下邻缝 4×(3-1) = 8 条
    expect(r.checked).toBe(17);
    expect(r.scale).toBe(4);
  });

  it('★ 在放大图的一条缝上做手脚 → 恰好检出那一条', () => {
    const original = makeGround(3, 2, (tx, ty) => [80 + tx * 10, 100 + ty * 10, 60]);
    const up = nearest4x(original);

    // 把 tx=0|1 这条竖缝右侧 8 个像素压暗（模拟模型在那条缝上没对上）
    const bx = 1 * GND_TILE_WIDTH * 4;
    const y0 = 0;
    for (let y = y0; y < y0 + GND_TILE_HEIGHT * 4; y++) {
      for (let x = bx; x < bx + 8; x++) {
        const o = (y * up.width + x) * 4;
        up.rgba[o] = 20;
        up.rgba[o + 1] = 20;
        up.rgba[o + 2] = 20;
      }
    }

    const r = compareTileSeams(original, up);
    expect(r.seams).toHaveLength(1);
    const s = r.seams[0]!;
    expect(s.side).toBe('right');
    expect(s.tile).toEqual({ x: 0, y: 0 });
    expect(s.increase).toBeGreaterThan(SEAM_THRESHOLD);
    expect(s.after).toBeGreaterThan(s.before);
  });

  it('本来就有色差的地方（真地形交界）不会被误报成新增接缝', () => {
    // 两格颜色差得很远（真边界），但放大忠实 —— 不该报
    const original = makeGround(2, 1, (tx) => (tx === 0 ? [10, 10, 10] : [240, 240, 240]));
    expect(compareTileSeams(original, nearest4x(original)).seams).toEqual([]);
  });

  it('尺寸不是整数倍 → 抛错（免得按错的 scale 静默比歪）', () => {
    const original = src();
    const bad = makeImage(original.width * 4 + 1, original.height * 4, () => [0, 0, 0], original.tilesX);
    expect(() => compareTileSeams(original, bad)).toThrow(/不等于原图/);
  });

  it('★ 绝对值极小的地方不报：增量本身不到一个 JND', () => {
    // 两格只差 1 个灰阶，放大后被放大到差 5 个灰阶 —— 增量仍然 < 2.3，
    // 视觉上根本看不出来，不该报（增量这一条判据已经把「绝对值」一并管住了）
    const original = makeGround(2, 1, (tx) => (tx === 0 ? [128, 128, 128] : [129, 129, 129]));
    const up = makeImage(
      original.width * 4,
      original.height * 4,
      (x) => (x < GND_TILE_WIDTH * 4 ? [128, 128, 128] : [133, 133, 133]),
      original.tilesX,
    );
    expect(compareTileSeams(original, up).seams).toEqual([]);
    // 放大到差 60 个灰阶就报出来了 —— 证明这一段确实在被检查，不是没比
    const worse = makeImage(
      original.width * 4,
      original.height * 4,
      (x) => (x < GND_TILE_WIDTH * 4 ? [128, 128, 128] : [188, 188, 188]),
      original.tilesX,
    );
    expect(compareTileSeams(original, worse).seams).toHaveLength(1);
  });

  it('margin 可覆盖：抬到很高就不再报', () => {
    const original = makeGround(3, 2, (tx, ty) => [80 + tx * 10, 100 + ty * 10, 60]);
    const up = nearest4x(original);
    const bx = GND_TILE_WIDTH * 4;
    for (let y = 0; y < GND_TILE_HEIGHT * 4; y++)
      for (let x = bx; x < bx + 8; x++) {
        const o = (y * up.width + x) * 4;
        up.rgba[o] = 20;
        up.rgba[o + 1] = 20;
        up.rgba[o + 2] = 20;
      }

    expect(compareTileSeams(original, up).seams).toHaveLength(1);
    expect(compareTileSeams(original, up, { margin: 500 }).seams).toEqual([]);
  });

  it('按增量降序排（放大得最糟的排最前）', () => {
    const original = makeGround(3, 1, () => [100, 100, 100]);
    const up = nearest4x(original);
    // 缝 0|1 轻微破坏，缝 1|2 严重破坏
    const damage = (tx: number, v: number): void => {
      const bx = (tx + 1) * GND_TILE_WIDTH * 4;
      for (let y = 0; y < GND_TILE_HEIGHT * 4; y++)
        for (let x = bx; x < bx + 8; x++) {
          const o = (y * up.width + x) * 4;
          up.rgba[o] = v;
          up.rgba[o + 1] = v;
          up.rgba[o + 2] = v;
        }
    };
    damage(0, 80);
    damage(1, 5);

    const r = compareTileSeams(original, up);
    expect(r.seams).toHaveLength(2);
    expect(r.seams[0]!.tile.x).toBe(1);
    expect(r.seams[0]!.increase).toBeGreaterThan(r.seams[1]!.increase);
  });
});

// ============================================================
//  整张放大：逐列 / 逐行全扫（Q-GND-4 的另一套口径）
// ============================================================

/** 把 x ≥ x0 的整列各通道加 delta —— 造一条**模型自己**的竖直分块线 */
function shiftRightOf(img: GroundImage, x0: number, delta: number): void {
  for (let y = 0; y < img.height; y++) {
    for (let x = x0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        img.rgba[o + c] = Math.max(0, Math.min(255, img.rgba[o + c]! + delta));
      }
    }
  }
}

describe('★ compareAllSeams —— 整张放大时的接缝判据', () => {
  const BAND = 2;

  it('★ 忠实最近邻 ×4：一条都不报（非格线也不报 —— 这是换口径的前提）', () => {
    const src = noisyGround(4, 3);
    const r = compareAllSeams(src, nearest4x(src));
    expect(r.seams).toEqual([]);
    // 每条原图边界都查过了（两侧各留 band 的余量）
    expect(r.checkedX).toBe(src.width - 2 * BAND + 1);
    expect(r.checkedY).toBe(src.height - 2 * BAND + 1);
    expect(r.scale).toBe(4);
  });

  it('★ 模型分块线不在 32px 格上：照样报出来，且 onGrid 为 false', () => {
    const src = noisyGround(4, 3, 11); // 128×96
    const up = nearest4x(src);
    // x=100 **不是** 32×4=128 的整数倍 —— 逐块放大那条路永远不会看这条线
    shiftRightOf(up, 100, 30);

    const r = compareAllSeams(src, up);
    const hit = r.seams.find((s) => s.side === 'right' && s.pixel.x === 100);
    expect(hit).toBeDefined();
    expect(hit!.onGrid).toBe(false);
    expect(hit!.increase).toBeGreaterThan(2.3);
    // 而只查格线的那套口径对这条缝一无所知
    expect(compareTileSeams(src, up).seams.some((s) => s.pixel.x === 100)).toBe(false);
  });

  it('格线上的接缝：既报出来、onGrid 也为 true（两套口径在格线处必须一致）', () => {
    const src = noisyGround(4, 3, 12);
    const up = nearest4x(src);
    shiftRightOf(up, GND_TILE_WIDTH * 4, 30); // x = 128，正是格线

    const all = compareAllSeams(src, up);
    const grid = all.seams.find((s) => s.pixel.x === GND_TILE_WIDTH * 4);
    expect(grid).toBeDefined();
    expect(grid!.onGrid).toBe(true);
    // 旧口径同样查得到这条（它只查格线）
    expect(compareTileSeams(src, up).seams.length).toBeGreaterThan(0);
  });

  it('横缝同理（下邻那一类）', () => {
    const src = noisyGround(3, 4, 13);
    const up = nearest4x(src);
    for (let y = 100; y < up.height; y++) {
      for (let x = 0; x < up.width; x++) {
        const o = (y * up.width + x) * 4;
        for (let c = 0; c < 3; c++) up.rgba[o + c] = Math.max(0, Math.min(255, up.rgba[o + c]! + 30));
      }
    }
    const r = compareAllSeams(src, up);
    const hit = r.seams.find((s) => s.side === 'bottom' && s.pixel.y === 100);
    expect(hit).toBeDefined();
    expect(hit!.onGrid).toBe(false);
  });

  it('★ 尺寸不是恰好 ×scale 就抛错（与旧口径同一条守卫）', () => {
    const src = noisyGround(2, 2);
    const bad = makeImage(src.width * 4 + 4, src.height * 4, () => [10, 10, 10]);
    expect(() => compareAllSeams(src, bad)).toThrow(/不等于原图/);
  });

  it('margin 可覆盖：抬到很高就不再报', () => {
    const src = noisyGround(4, 3, 14);
    const up = nearest4x(src);
    shiftRightOf(up, 100, 30);
    expect(compareAllSeams(src, up).seams.length).toBeGreaterThan(0);
    expect(compareAllSeams(src, up, { margin: 500 }).seams).toEqual([]);
    expect(compareAllSeams(src, up, { margin: 500 }).checkedX).toBe(src.width - 2 * BAND + 1);
  });
});

// ============================================================
//  修补
// ============================================================

describe('featherSeams —— 跨缝双向羽化', () => {
  const artificial = (): GroundImage => makeGround(2, 1, (tx) => (tx === 0 ? [10, 10, 10] : [240, 240, 240]));

  it('★ 羽化后这条缝的色差显著下降', () => {
    const img = artificial();
    const before = seamDeltaE(img, 'right', 0, 0);

    const fixed = featherSeams(img, findTileSeams(img));
    const after = seamDeltaE(fixed, 'right', 0, 0);

    expect(before).toBeGreaterThan(80);
    expect(after).toBeLessThan(before / 2);
  });

  it('双向：缝两侧的像素都被改动了', () => {
    const img = artificial();
    const fixed = featherSeams(img, findTileSeams(img));

    expect(px(fixed, GND_TILE_WIDTH - 1, 0)[0]).toBeGreaterThan(10);
    expect(px(fixed, GND_TILE_WIDTH, 0)[0]).toBeLessThan(240);
  });

  it('离缝最近的像素混合得最多（权重 1/2、1/4…）', () => {
    const img = artificial();
    const fixed = featherSeams(img, findTileSeams(img), { band: 2 });

    const nearest = px(fixed, GND_TILE_WIDTH - 1, 0)[0];
    const next = px(fixed, GND_TILE_WIDTH - 2, 0)[0];
    expect(nearest).toBeGreaterThan(next);
    expect(nearest).toBeCloseTo(125, -1.2); // 10 与 240 按权重 1/2 混合
  });

  it('下邻缝也能羽化', () => {
    const img = makeGround(1, 2, (_tx, ty) => (ty === 0 ? [10, 10, 10] : [240, 240, 240]));
    const before = seamDeltaE(img, 'bottom', 0, 0);
    const fixed = featherSeams(img, findTileSeams(img));
    expect(seamDeltaE(fixed, 'bottom', 0, 0)).toBeLessThan(before / 2);
  });

  it('★ scale：接缝按放大图坐标定位', () => {
    const original = artificial();
    const up = nearest4x(original);
    const report = findTileSeams(original); // 报告按原图坐标给位置

    const fixed = featherSeams(up, report, { scale: 4 });
    // 放大图上的缝在 x = 32*4 = 128，两侧该被改动
    expect(px(fixed, 128 - 1, 0)[0]).toBeGreaterThan(10);
    expect(px(fixed, 128, 0)[0]).toBeLessThan(240);
  });

  it('不改传入的图', () => {
    const img = artificial();
    const snapshot = Uint8Array.from(img.rgba);
    featherSeams(img, findTileSeams(img));
    expect(img.rgba).toEqual(snapshot);
  });

  it('没有接缝时原样返回内容', () => {
    const img = makeGround(2, 1, () => [100, 100, 100]);
    expect(featherSeams(img, findTileSeams(img)).rgba).toEqual(img.rgba);
  });

  it('报告为空时不做任何事', () => {
    const img = artificial();
    const empty: SeamReport = { tilesX: 2, tilesY: 1, threshold: SEAM_THRESHOLD, checked: 0, seams: [] };
    expect(featherSeams(img, empty).rgba).toEqual(img.rgba);
  });
});
