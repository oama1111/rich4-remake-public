/*
 * 地形 tile 接缝检查与修补（T-064）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * C-AST-7：「地形 tile 放大后需做接缝检查与修补，拼接处不得出现可见缝隙或色差。」
 *
 * 底图是 72×72 个 32×32 的块拼出来的（见 ground.ts）。超分模型逐块放大时每块只看得到
 * 自己那 32×32，挨着的两块各自补出来的边缘可能不一致，于是整图上浮出一道规则的网格线。
 *
 * ## ⚠️ 为什么判据必须是「与放大前比」，而不是一个绝对阈值
 *
 * 最初的写法是「取相邻两格的边缘列，算平均 ΔE，超阈值就报」。拿三张真实地图
 * （0000/0002/0004）实测，这个写法**完全不成立**：
 *
 * | 判据 | 报出的缝 |
 * |---|---|
 * | 逐像素 ΔE > 2.3 | 10224 / 10224（100%）|
 * | 带内均值 ΔE > 2.3 | ~3000 / 5112（竖缝，约 60%）|
 *
 * 原因是原版底图本身就同时具备两种性质，二者都不是「接缝」：
 *
 * 1. **高频纹理**：水面、草地这类噪声纹理，相邻像素本来就互不相关。逐像素比 ΔE，
 *    哪怕画面完全连续也必然爆表——100% 的误报就是这么来的。
 * 2. **真地形交界**：草地挨着水面、道路穿过格边界，两格的平均色本来就差得远。
 *    带内均值能压掉噪声，却压不掉这类**真边界**，于是仍有约 60% 误报，
 *    而且看画面（`0000.bin` 解出来是台湾岛，肉眼无接缝）它们全都不是缺陷。
 *
 * 所以任何只看放大图的绝对阈值都区分不了「本来就有的地形边界」与「超分引入的伪影」。
 * 唯一站得住的判据是**对照放大前**：某条缝在放大后比放大前**明显变差**，那才是超分
 * 引入的。这正是 C-AST-7 说「放大后需做接缝检查」的本意——检查是相对的。
 *
 * 于是本模块给两件事：
 *   · `findTileSeams`     —— 只看一张图的绝对色差。**它是诊断工具，不是验收判据**：
 *                            真地形边界也会报，请结合 `compareTileSeams` 一起看。
 *   · `compareTileSeams`  —— ★ 验收判据：同一张图放大前后对比，报出「新增」的接缝。
 *
 * ## 色差用 ΔE 而不是 RGB 差值
 *
 * 同样差 20 个灰阶，跨色相时人眼的感受并不相同；CIE76 的 ΔE（sRGB → Lab 再取欧氏
 * 距离）才近似「人觉得差多少」，阈值 2.3 对应公认的「刚可察觉差」。
 *
 * 本模块在 Node 下跑（assets-pipeline 不受 core 的确定性约束），故用浮点算色差；
 * 写回像素时四舍五入并夹到 0..255。
 */

import { GND_TILE_HEIGHT, GND_TILE_WIDTH, type GroundImage } from './ground.ts';

// ============================================================
//  色差：sRGB → Lab → CIE76 ΔE
// ============================================================

export interface Lab {
  l: number;
  a: number;
  b: number;
}

/** D65 白点（sRGB 的标准光源） */
const WHITE_X = 0.95047;
const WHITE_Y = 1.0;
const WHITE_Z = 1.08883;

/** sRGB 分量（0..255）→ 线性光 */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Lab 的 f()，含 t ≤ (6/29)³ 的线性段 */
function labF(t: number): number {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

export function srgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;

  const fx = labF(x / WHITE_X);
  const fy = labF(y / WHITE_Y);
  const fz = labF(z / WHITE_Z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 色差 —— 两个 Lab 之间的欧氏距离 */
export function deltaE76(p: Lab, q: Lab): number {
  const dl = p.l - q.l;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

// ============================================================
//  边缘带
// ============================================================

/**
 * 超过这个 ΔE 算「看得见」。
 *
 * 2.3 是公认的「刚可察觉差」（just-noticeable difference）量级。
 */
export const SEAM_THRESHOLD = 2.3;

/** 默认取带深度（格内像素） */
export const SEAM_BAND = 2;

/**
 * 一条竖直边缘带的平均色。
 *
 * ★ 先对**带内像素求 RGB 均值、再转 Lab**，而不是逐像素转 Lab 再平均：
 *   带内像素颜色相近，两种做法结果几乎一致，但先平均能顺带把高频噪声抹平
 *   ——这正是我们要的（见文件头：逐像素比对对噪声纹理毫无意义）。
 */
function bandLab(img: GroundImage, x0: number, x1: number, y0: number, y1: number): Lab {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 4;
      r += img.rgba[o]!;
      g += img.rgba[o + 1]!;
      b += img.rgba[o + 2]!;
      n++;
    }
  }
  if (n === 0) return { l: 0, a: 0, b: 0 };
  return srgbToLab(r / n, g / n, b / n);
}

/** 逐像素 ΔE 的均值 —— 只作诊断（噪声纹理会让它天生偏大） */
function meanPixelDeltaE(
  img: GroundImage,
  a: (i: number) => [number, number, number],
  b: (i: number) => [number, number, number],
  n: number,
): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += deltaE76(srgbToLab(...a(i)), srgbToLab(...b(i)));
  }
  return n === 0 ? 0 : sum / n;
}

function px(img: GroundImage, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}

// ============================================================
//  绝对检查（诊断用）
// ============================================================

export interface SeamHit {
  /** 接缝**左/上**侧的格位（列, 行） */
  tile: { x: number; y: number };
  /** 接缝**右/下**侧的格位 */
  neighbor: { x: number; y: number };
  /** 这条缝在左侧格的哪一边 */
  side: 'right' | 'bottom';
  /** ★ 判据：两侧边缘**带内均值**的 ΔE（系统性色差） */
  deltaE: number;
  /**
   * 诊断：两侧边缘**逐像素** ΔE 的均值。
   * ⚠️ 高频率纹理（水面、草地）会让它天生偏大，**不要拿它判断有无接缝**。
   */
  pixelDeltaE: number;
  /** 缝中点的整图像素坐标——人工去图上找它用 */
  pixel: { x: number; y: number };
  /**
   * 两侧各自对应的**源块号**（`ground.ts` 排布表里的值）。
   * 只有传了 `layout` 才有：拿到块号才能回去单独重超分那一块。
   */
  blocks?: { tile: number; neighbor: number };
}

export interface SeamReport {
  tilesX: number;
  tilesY: number;
  threshold: number;
  /** 一共比了多少条缝 */
  checked: number;
  /** 超阈值的缝，按 ΔE **降序**（最刺眼的排最前） */
  seams: SeamHit[];
}

export interface SeamOptions {
  /** 覆盖阈值，缺省 `SEAM_THRESHOLD` */
  threshold?: number;
  /** 覆盖格数，缺省取 `img.tilesX/tilesY` */
  tilesX?: number;
  tilesY?: number;
  /** 取带深度（像素），缺省 `SEAM_BAND` */
  band?: number;
  /** 源块排布表（`readLayout` 的产出）：给了就在报告里带上 `blocks` */
  layout?: Uint16Array;
}

/**
 * 扫一遍所有相邻 tile，报出边缘**带内均值**色差超阈值的缝。
 *
 * ⚠️ 这是诊断工具，不是验收判据：原版的真地形交界（草地挨水面）同样会报。
 *    要判「超分有没有引入接缝」请用 `compareTileSeams`。
 */
export function findTileSeams(img: GroundImage, opts: SeamOptions = {}): SeamReport {
  const tilesX = opts.tilesX ?? img.tilesX;
  const tilesY = opts.tilesY ?? img.tilesY;
  const threshold = opts.threshold ?? SEAM_THRESHOLD;
  const band = Math.max(1, opts.band ?? SEAM_BAND);
  const layout = opts.layout;

  const seams: SeamHit[] = [];
  let checked = 0;

  const blockOf = (tx: number, ty: number): number | undefined =>
    layout === undefined ? undefined : layout[ty * tilesX + tx];

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const y0 = ty * GND_TILE_HEIGHT;

      // 与右邻：左格最右 band 列 vs 右格最左 band 列
      if (tx + 1 < tilesX) {
        const bx = (tx + 1) * GND_TILE_WIDTH;
        const left = bandLab(img, bx - band, bx, y0, y0 + GND_TILE_HEIGHT);
        const right = bandLab(img, bx, bx + band, y0, y0 + GND_TILE_HEIGHT);
        const pixel = meanPixelDeltaE(
          img,
          (i) => px(img, bx - 1, y0 + i),
          (i) => px(img, bx, y0 + i),
          GND_TILE_HEIGHT,
        );
        checked++;
        const d = deltaE76(left, right);
        if (d > threshold) {
          seams.push(
            withBlocks(
              {
                tile: { x: tx, y: ty },
                neighbor: { x: tx + 1, y: ty },
                side: 'right',
                deltaE: d,
                pixelDeltaE: pixel,
                pixel: { x: bx, y: y0 + Math.floor(GND_TILE_HEIGHT / 2) },
              },
              blockOf(tx, ty),
              blockOf(tx + 1, ty),
            ),
          );
        }
      }

      // 与下邻：上格最下 band 行 vs 下格最上 band 行
      if (ty + 1 < tilesY) {
        const by = (ty + 1) * GND_TILE_HEIGHT;
        const x0 = tx * GND_TILE_WIDTH;
        const top = bandLab(img, x0, x0 + GND_TILE_WIDTH, by - band, by);
        const bottom = bandLab(img, x0, x0 + GND_TILE_WIDTH, by, by + band);
        const pixel = meanPixelDeltaE(
          img,
          (i) => px(img, x0 + i, by - 1),
          (i) => px(img, x0 + i, by),
          GND_TILE_WIDTH,
        );
        checked++;
        const d = deltaE76(top, bottom);
        if (d > threshold) {
          seams.push(
            withBlocks(
              {
                tile: { x: tx, y: ty },
                neighbor: { x: tx, y: ty + 1 },
                side: 'bottom',
                deltaE: d,
                pixelDeltaE: pixel,
                pixel: { x: x0 + Math.floor(GND_TILE_WIDTH / 2), y: by },
              },
              blockOf(tx, ty),
              blockOf(tx, ty + 1),
            ),
          );
        }
      }
    }
  }

  seams.sort((p, q) => q.deltaE - p.deltaE);
  return { tilesX, tilesY, threshold, checked, seams };
}

function withBlocks(hit: SeamHit, a: number | undefined, b: number | undefined): SeamHit {
  if (a !== undefined && b !== undefined) hit.blocks = { tile: a, neighbor: b };
  return hit;
}

// ============================================================
//  放大前后对比 —— ★ C-AST-7 的验收判据
// ============================================================

/** 放大后比放大前**多出**多少 ΔE 才算「新增了接缝」 */
export const SEAM_MARGIN = SEAM_THRESHOLD;

export interface SeamIncrease extends SeamHit {
  /** 放大前这条缝的带内均值 ΔE */
  before: number;
  /** 放大后同一条缝的带内均值 ΔE */
  after: number;
  /** `after - before` */
  increase: number;
}

export interface CompareOptions {
  /** 原图格数，缺省取 `original.tilesX/tilesY` */
  tilesX?: number;
  tilesY?: number;
  /** 超分倍率，缺省由两图宽度之比推出 */
  scale?: number;
  /** 增量阈值，缺省 `SEAM_MARGIN` */
  margin?: number;
  /** 原图侧的取带深度，缺省 `SEAM_BAND`；超分图侧自动乘 `scale` */
  band?: number;
}

export interface CompareReport {
  tilesX: number;
  tilesY: number;
  scale: number;
  margin: number;
  checked: number;
  /** 放大后**新增**的接缝，按增量降序 */
  seams: SeamIncrease[];
}

/**
 * ★ 验收判据：把放大图与原图逐条缝对照，报出**放大新引入**的接缝。
 *
 * 判据只有一条：`after - before > margin`（默认 2.3，一个 JND）。
 * 增量本身就同时管住了「绝对值」，不必再加一条绝对下限
 * —— 增量要超过一个 JND，变差后的绝对色差必然也在 JND 之上。
 *
 * 带宽度在两侧按 `scale` 换算，保证比的是**同一块地形**的同一段长度：
 * ΔE 是均值的色差，与取样尺度无关，所以两侧数值可以直接相减。
 */
export function compareTileSeams(
  original: GroundImage,
  upscaled: GroundImage,
  opts: CompareOptions = {},
): CompareReport {
  const tilesX = opts.tilesX ?? original.tilesX;
  const tilesY = opts.tilesY ?? original.tilesY;
  const scale = opts.scale ?? Math.round(upscaled.width / original.width);
  const margin = opts.margin ?? SEAM_MARGIN;
  const band = Math.max(1, opts.band ?? SEAM_BAND);
  const uBand = band * scale;

  requireScaledPair(original, upscaled, scale);

  const seams: SeamIncrease[] = [];
  let checked = 0;

  const judge = (
    before: number,
    after: number,
    tile: { x: number; y: number },
    neighbor: { x: number; y: number },
    side: 'right' | 'bottom',
    pixel: { x: number; y: number },
  ): void => {
    checked++;
    const increase = after - before;
    if (increase <= margin) return;
    seams.push({ tile, neighbor, side, deltaE: after, pixelDeltaE: 0, pixel, before, after, increase });
  };

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const oy0 = ty * GND_TILE_HEIGHT;
      const uy0 = oy0 * scale;

      if (tx + 1 < tilesX) {
        const obx = (tx + 1) * GND_TILE_WIDTH;
        const ubx = obx * scale;
        const before = deltaE76(
          bandLab(original, obx - band, obx, oy0, oy0 + GND_TILE_HEIGHT),
          bandLab(original, obx, obx + band, oy0, oy0 + GND_TILE_HEIGHT),
        );
        const after = deltaE76(
          bandLab(upscaled, ubx - uBand, ubx, uy0, uy0 + GND_TILE_HEIGHT * scale),
          bandLab(upscaled, ubx, ubx + uBand, uy0, uy0 + GND_TILE_HEIGHT * scale),
        );
        judge(before, after, { x: tx, y: ty }, { x: tx + 1, y: ty }, 'right', {
          x: ubx,
          y: uy0 + Math.floor((GND_TILE_HEIGHT * scale) / 2),
        });
      }

      if (ty + 1 < tilesY) {
        const oby = (ty + 1) * GND_TILE_HEIGHT;
        const uby = oby * scale;
        const ox0 = tx * GND_TILE_WIDTH;
        const ux0 = ox0 * scale;
        const before = deltaE76(
          bandLab(original, ox0, ox0 + GND_TILE_WIDTH, oby - band, oby),
          bandLab(original, ox0, ox0 + GND_TILE_WIDTH, oby, oby + band),
        );
        const after = deltaE76(
          bandLab(upscaled, ux0, ux0 + GND_TILE_WIDTH * scale, uby - uBand, uby),
          bandLab(upscaled, ux0, ux0 + GND_TILE_WIDTH * scale, uby, uby + uBand),
        );
        judge(before, after, { x: tx, y: ty }, { x: tx, y: ty + 1 }, 'bottom', {
          x: ux0 + Math.floor((GND_TILE_WIDTH * scale) / 2),
          y: uby,
        });
      }
    }
  }

  seams.sort((p, q) => q.increase - p.increase);
  return { tilesX, tilesY, scale, margin, checked, seams };
}

/**
 * 两张图必须**恰好**是 `scale` 倍的关系，否则后面的坐标换算全是错的。
 * 单独抽出来是因为 `compareTileSeams` 与 `compareAllSeams` 都要这一条。
 */
function requireScaledPair(original: GroundImage, upscaled: GroundImage, scale: number): void {
  if (scale < 1) throw new Error(`超分倍率 ${scale} 不合理（up ${upscaled.width} / src ${original.width}）`);
  const wantW = original.width * scale;
  const wantH = original.height * scale;
  if (upscaled.width !== wantW || upscaled.height !== wantH) {
    throw new Error(
      `放大图 ${upscaled.width}×${upscaled.height} 不等于原图 ${original.width}×${original.height} ×${scale} = ${wantW}×${wantH}`,
    );
  }
}

// ============================================================
//  整张放大：逐列 / 逐行全扫（Q-GND-4 的另一套口径）
// ============================================================

/**
 * ★ **底图走「整张放大」时的接缝判据**（Q-GND-4）。
 *
 * `compareTileSeams` 只比**原版 32px 格线**上那 10224 条缝（72×72 格）—— 那套口径成立的前提是
 * 「放大是逐块做的，伪影只会长在块边界上」。整张放大没有这个前提：模型内部若按
 * 256/400px 分块（Real-ESRGAN 的 `--tile` 就是干这个的），接缝会落在**模型自己的**
 * 分块线上，与 32px 格毫无关系，`compareTileSeams` 会**一条都查不到**。
 *
 * 所以这里换一套口径：**不比格线，比每一条线**。
 *   · 竖线取**原图每一个像素边界** `xo = band..W−band`（放大图上是 `xo × scale`）全扫，
 *     横线同理；`compareTileSeams` 查的 72 格线只是其中的 71 条；
 *   · 每条线仍用「带内均值 ΔE，放大后 − 放大前 > 一个 JND」这条**相对**判据
 *     （绝对阈值区分不了真地形边界与伪影，见文件头）；
 *   · 只取 `scale` 的整数倍位置：非整数倍在线在原图里没有对应物，连忠实最近邻
 *     放大都会在噪声纹理上假报（见 `compareAllSeams` 里的注释）；
 *   · 报告里带 `onGrid`，把「原版块边界」与「模型自己的分块线」分开：
 *     ★ **非格线上报出来的，就是逐块放大那条路根本查不到的东西。**
 *
 * 取带范围是**整幅的高/宽**（`compareTileSeams` 取的是一格高）。理由：模型固定
 * 分块时，同一个 `x = k·T` 的竖缝会在每一块行上**共线**地重复，整幅平均不会把它
 * 稀释掉；反过来，只看一格高更容易被局部高频纹理带偏。代价是对「只在某一小段
 * 出现的接缝」不敏感 —— 那种伪影本来就少见，且 `findTileSeams` 仍可配合定位。
 *
 * 复杂度：预计算每列/每行的 RGB 前缀和（一次 O(W·H)），之后**每条线 O(1)**，
 * 9216² 的图也只多跑两趟线性扫描，不必对每条线重扫全图。
 */
export interface AllSeamHit {
  side: 'right' | 'bottom';
  /** 缝的整图像素坐标（**放大图**上）—— 人工去图上找它用 */
  pixel: { x: number; y: number };
  /** 放大前这条线的带内均值 ΔE（原图侧，见 `compareAllSeams` 的取法） */
  before: number;
  /** 放大后同一条线的带内均值 ΔE */
  after: number;
  /** `after - before` */
  increase: number;
  /** ★ 这条线落在原图的 32px 块边界上吗（`坐标 % (32×scale) == 0`） */
  onGrid: boolean;
}

export interface AllCompareReport {
  width: number;
  height: number;
  scale: number;
  margin: number;
  /** 扫过的竖线 / 横线条数 */
  checkedX: number;
  checkedY: number;
  /** 放大后新引入的接缝（含格线上的），按增量降序 */
  seams: AllSeamHit[];
}

/** 每列的 RGB 总和的前缀和，长度 `(width + 1) × 3` */
function columnPrefix(img: GroundImage): Float64Array {
  const { width, height, rgba } = img;
  const out = new Float64Array((width + 1) * 3);
  for (let y = 0; y < height; y++) {
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      const p = (x + 1) * 3;
      out[p] = out[p]! + rgba[o]!;
      out[p + 1] = out[p + 1]! + rgba[o + 1]!;
      out[p + 2] = out[p + 2]! + rgba[o + 2]!;
    }
  }
  for (let x = 1; x <= width; x++) {
    const p = x * 3;
    const q = p - 3;
    out[p] = out[p]! + out[q]!;
    out[p + 1] = out[p + 1]! + out[q + 1]!;
    out[p + 2] = out[p + 2]! + out[q + 2]!;
  }
  return out;
}

/** 每行的 RGB 总和的前缀和，长度 `(height + 1) × 3` */
function rowPrefix(img: GroundImage): Float64Array {
  const { width, height, rgba } = img;
  const out = new Float64Array((height + 1) * 3);
  for (let y = 0; y < height; y++) {
    const p = (y + 1) * 3;
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      out[p] = out[p]! + rgba[o]!;
      out[p + 1] = out[p + 1]! + rgba[o + 1]!;
      out[p + 2] = out[p + 2]! + rgba[o + 2]!;
    }
  }
  for (let y = 1; y <= height; y++) {
    const p = y * 3;
    const q = p - 3;
    out[p] = out[p]! + out[q]!;
    out[p + 1] = out[p + 1]! + out[q + 1]!;
    out[p + 2] = out[p + 2]! + out[q + 2]!;
  }
  return out;
}

/**
 * 前缀和上取 `[i0, i1)` 的带内均值（`span` = 每条带的像素个数，
 * 竖带是「列宽 × 图高」、横带是「行高 × 图宽」）。
 * 空带返回 `null` —— 调用方据此跳过，绝不能让空带算成黑色（那是巨大的假 ΔE）。
 */
function prefixLab(pre: Float64Array, i0: number, i1: number, span: number): Lab | null {
  const n = (i1 - i0) * span;
  if (i1 <= i0 || n <= 0) return null;
  const o0 = i0 * 3;
  const o1 = i1 * 3;
  return srgbToLab(
    (pre[o1]! - pre[o0]!) / n,
    (pre[o1 + 1]! - pre[o0 + 1]!) / n,
    (pre[o1 + 2]! - pre[o0 + 2]!) / n,
  );
}

export function compareAllSeams(
  original: GroundImage,
  upscaled: GroundImage,
  opts: CompareOptions = {},
): AllCompareReport {
  const scale = opts.scale ?? Math.round(upscaled.width / original.width);
  const margin = opts.margin ?? SEAM_MARGIN;
  const band = Math.max(1, opts.band ?? SEAM_BAND);
  const uBand = band * scale;

  requireScaledPair(original, upscaled, scale);

  const oCols = columnPrefix(original);
  const uCols = columnPrefix(upscaled);
  const oRows = rowPrefix(original);
  const uRows = rowPrefix(upscaled);

  const seams: AllSeamHit[] = [];
  let checkedX = 0;
  let checkedY = 0;

  // ★ 只在**原图真实的像素边界**上比（x = xo × scale）。理由有两条：
  //   ① 不是 `scale` 整数倍的那些线在原图里没有对应物，比出来的只是「附近」的基线，
  //      连忠实最近邻放大都会在噪声纹理上假报（实测：带内均值差可达一个 JND 量级）；
  //   ② 超分工具的分块尺寸都是偶数/整十（128/192/256/400…），它的分块线仍落在
  //      这些线上 —— 放宽到非整数倍换不来检测能力，只换来噪声。
  for (let xo = band; xo + band <= original.width; xo++) {
    const x = xo * scale;
    const afterL = prefixLab(uCols, x - uBand, x, upscaled.height);
    const afterR = prefixLab(uCols, x, x + uBand, upscaled.height);
    const beforeL = prefixLab(oCols, xo - band, xo, original.height);
    const beforeR = prefixLab(oCols, xo, xo + band, original.height);
    if (afterL === null || afterR === null || beforeL === null || beforeR === null) continue;

    checkedX++;
    const before = deltaE76(beforeL, beforeR);
    const after = deltaE76(afterL, afterR);
    if (after - before <= margin) continue;
    seams.push({
      side: 'right',
      pixel: { x, y: Math.floor(upscaled.height / 2) },
      before,
      after,
      increase: after - before,
      onGrid: xo % GND_TILE_WIDTH === 0,
    });
  }

  for (let yo = band; yo + band <= original.height; yo++) {
    const y = yo * scale;
    const afterT = prefixLab(uRows, y - uBand, y, upscaled.width);
    const afterB = prefixLab(uRows, y, y + uBand, upscaled.width);
    const beforeT = prefixLab(oRows, yo - band, yo, original.width);
    const beforeB = prefixLab(oRows, yo, yo + band, original.width);
    if (afterT === null || afterB === null || beforeT === null || beforeB === null) continue;

    checkedY++;
    const before = deltaE76(beforeT, beforeB);
    const after = deltaE76(afterT, afterB);
    if (after - before <= margin) continue;
    seams.push({
      side: 'bottom',
      pixel: { x: Math.floor(upscaled.width / 2), y },
      before,
      after,
      increase: after - before,
      onGrid: yo % GND_TILE_HEIGHT === 0,
    });
  }

  seams.sort((p, q) => q.increase - p.increase);
  return { width: upscaled.width, height: upscaled.height, scale, margin, checkedX, checkedY, seams };
}

// ============================================================
//  修补：跨缝双向羽化
// ============================================================

/** 默认每侧羽化宽度（像素）——卡片要求「边缘 2px 双向羽化」 */
export const FEATHER_BAND = 2;

export interface FeatherOptions {
  /** 每侧羽化宽度（像素），缺省 `FEATHER_BAND` */
  band?: number;
  /** 超分倍率：接缝位置按它换算到放大图的坐标 */
  scale?: number;
}

/**
 * 把报告里的接缝逐条羽化掉，返回**新图**（不改传入的）。
 *
 * 做法：缝两侧各取 `band` 个像素，成对地向对侧颜色线性过渡——
 * 离缝最近的像素混合得最多（权重 1/2），往外依次减半（1/4、1/6…），
 * 于是原本一步到底的色阶被摊到 2×band 个像素上，硬边变成渐变。
 *
 * ★ 取「对侧颜色」一律从**输入的原始像素**读（先快照），不是边算边读：
 *   否则前一条缝的结果会渗进后一条缝，越补越糊，而且换个顺序结果就不同。
 *
 * ⚠️ 羽化是**有损**的：地形边界真的该是硬边时（水/沙）它会把边界抹柔。
 *   所以默认不自动跑，由人看过报告再决定。
 *
 * @param scale 接缝在放大图中的位置 = 原图坐标 × scale。`findTileSeams` 的
 *              报告按原图坐标给位置，`compareTileSeams` 的按放大图给，
 *              故修放大图时报 `scale`，修原图大小的图时不传。
 */
export function featherSeams(img: GroundImage, report: SeamReport, opts: FeatherOptions = {}): GroundImage {
  const band = Math.max(1, opts.band ?? FEATHER_BAND);
  const k = opts.scale ?? 1;
  const { width, height } = img;

  const src = new Uint8Array(img.rgba); // 快照：对侧颜色只从这里读
  const out = new Uint8Array(img.rgba);

  const at = (x: number, y: number): number => (y * width + x) * 4;

  /** out[idx] ← lerp(out[idx], src[mirror], w) */
  const blend = (idx: number, mirror: number, w: number): void => {
    for (let c = 0; c < 3; c++) {
      const v = out[idx + c]! + (src[mirror + c]! - out[idx + c]!) * w;
      out[idx + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  };

  for (const seam of report.seams) {
    const w = (i: number): number => (band - i) / (2 * band);

    if (seam.side === 'right') {
      const bx = (seam.tile.x + 1) * GND_TILE_WIDTH * k;
      const span = GND_TILE_HEIGHT * k;
      const y0 = seam.tile.y * span;
      for (let i = 0; i < band; i++) {
        const weight = w(i);
        for (let j = 0; j < span; j++) {
          const y = y0 + j;
          const left = at(bx - 1 - i, y);
          const right = at(bx + i, y);
          blend(left, right, weight);
          blend(right, left, weight);
        }
      }
    } else {
      const by = (seam.tile.y + 1) * GND_TILE_HEIGHT * k;
      const span = GND_TILE_WIDTH * k;
      const x0 = seam.tile.x * span;
      for (let i = 0; i < band; i++) {
        const weight = w(i);
        for (let j = 0; j < span; j++) {
          const x = x0 + j;
          const top = at(x, by - 1 - i);
          const bottom = at(x, by + i);
          blend(top, bottom, weight);
          blend(bottom, top, weight);
        }
      }
    }
  }

  return { width, height, tilesX: img.tilesX, tilesY: img.tilesY, rgba: out };
}
