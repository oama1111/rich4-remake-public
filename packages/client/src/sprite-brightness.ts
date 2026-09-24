/*
 * 精靈調亮 / 調暗 —— **不靠 `ctx.filter`** 的 `brightness(1 + a)`（過路費閃爍 W-69 用）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 需求方 2026-09-24「连着一条街收过路费时地块闪烁特效怎么没了」（iPhone Safari）：
 *   先前是 `ctx.filter = brightness(…)`。**WebKit（Safari / iOS 上所有浏览器）不支持
 *   `CanvasRenderingContext2D.filter`**（WebKit bug 198416）—— 赋值被静默忽略，
 *   于是演出的节拍（880 ms 押住訊息框）照走、棋盘上却一个像素都不变 = 「闪烁没了」。
 *   桌面 Chromium 里一直是好的，所以这不是演出次序的回归，而是换了设备。
 *
 * 做法：画完精灵本体之后再叠一层，结果与 `brightness(1 + a)` **逐像素相同**（不透明像素上）：
 *   · a > 0：同一张图以 `lighter`（相加）+ `globalAlpha = a` 再画一次 ⇒ c + a·c = c·(1 + a)；
 *   · a < 0：同形状的**纯黑剪影**以 `globalAlpha = −a` 盖上 ⇒ c·(1 − |a|)。
 *   两者都是所有 2D canvas 实现都有的基本合成，Safari / Chromium / Firefox 一致。
 *
 * 近似本身（按精靈而非按 id 圖像素、乘性近似加性）不变 —— 见 `docs/deviations/Q-TOLL-FX-1.md`。
 */

/** 建一张 w×h 的离屏 2D 画布；环境里没有（单测 / 无 DOM）返回 null */
export type SurfaceFactory = (w: number, h: number) => {
  canvas: CanvasImageSource;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} | null;

const defaultSurface: SurfaceFactory = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    return ctx === null ? null : { canvas: c, ctx };
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    return ctx === null ? null : { canvas: c, ctx };
  }
  return null;
};

/** 同一张精灵的黑剪影只做一次（精灵位图由 `SpriteCache` 持有，对象身份稳定） */
const masks = new WeakMap<object, CanvasImageSource | null>();

/** 精灵的纯黑剪影（透明处仍透明）；做不出来返回 null */
export function blackMaskOf(
  img: CanvasImageSource,
  w: number,
  h: number,
  surface: SurfaceFactory = defaultSurface,
): CanvasImageSource | null {
  const key = img as unknown as object;
  const hit = masks.get(key);
  if (hit !== undefined) return hit;
  const s = w > 0 && h > 0 ? surface(w, h) : null;
  let out: CanvasImageSource | null = null;
  if (s !== null) {
    s.ctx.drawImage(img, 0, 0, w, h);
    // 只保留已有像素的形状，颜色全换成黑
    s.ctx.globalCompositeOperation = 'source-in';
    s.ctx.fillStyle = '#000';
    s.ctx.fillRect(0, 0, w, h);
    out = s.canvas;
  }
  masks.set(key, out);
  return out;
}

/**
 * 在**已经画好**的精灵上叠一层，使它看起来是 `brightness(1 + a)`。
 *
 * @param a 亮度增量（`level / TOLL_FLASH_FULL_SCALE`，±0.5 为满幅）；0 什么都不做
 * @param w/h 精灵的原始像素尺寸（做剪影用）
 */
export function paintBrightness(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  a: number,
  w: number,
  h: number,
  surface: SurfaceFactory = defaultSurface,
): void {
  if (a === 0) return;
  if (a > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  const mask = blackMaskOf(img, w, h, surface);
  if (mask === null) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, -a);
  ctx.drawImage(mask, dx, dy, dw, dh);
  ctx.restore();
}

// ============================================================
//  冬眠 / 冻住的棋子去色（D-T047-4）—— 同样不靠 `ctx.filter`
// ============================================================

/**
 * 去色的逐像素算式：与先前 `ctx.filter = 'saturate(0) brightness(1.24)'` 在 Chromium 上
 * **逐像素相同**（Playwright 实测 4096 个随机色 0 误差：Chromium 的 saturate 矩阵系数是
 * 0.213 / 0.715 / 0.072，先取整、再 ×1.24 向下取整、封顶 255）。
 *
 * 近似本身（原版 `fcn_004555eb` 在 RGB555 调色板上 `(R+G+B+0x28)>>2`）不变，登记在 D-T047-4；
 * 这里只把「靠 filter」换成「自己算」—— 因为 WebKit 不认 `ctx.filter`，iPhone 上冬眠的棋子从来不灰。
 */
export function asleepGrey(r: number, g: number, b: number): number {
  const luma = Math.round(0.213 * r + 0.715 * g + 0.072 * b);
  return Math.min(255, Math.floor(luma * 1.24));
}

/** 同一张精灵的灰版只做一次 */
const greys = new WeakMap<object, CanvasImageSource | null>();

/** 就地把一块 RGBA 像素去色（透明度不动）—— 抽出来好单测 */
export function greyPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const v = asleepGrey(data[i]!, data[i + 1]!, data[i + 2]!);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

/**
 * 精灵的灰版（离屏画布，`getImageData` 逐像素算）；做不出来返回 null（调用方照画原图）。
 */
export function asleepSpriteOf(
  img: CanvasImageSource,
  w: number,
  h: number,
  surface: SurfaceFactory = defaultSurface,
): CanvasImageSource | null {
  const key = img as unknown as object;
  const hit = greys.get(key);
  if (hit !== undefined) return hit;
  let out: CanvasImageSource | null = null;
  const s = w > 0 && h > 0 ? surface(w, h) : null;
  if (s !== null) {
    try {
      s.ctx.drawImage(img, 0, 0, w, h);
      const px = s.ctx.getImageData(0, 0, w, h);
      greyPixels(px.data);
      s.ctx.putImageData(px, 0, 0);
      out = s.canvas;
    } catch {
      out = null;
    }
  }
  greys.set(key, out);
  return out;
}
