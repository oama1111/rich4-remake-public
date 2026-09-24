/*
 * 高清舞台 —— 逻辑坐标仍是 640×480，像素按设备分辨率走
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 为什么要有这一层
 *
 * 舞台（`stage.ts`）是一块 640×480 的画布，画满后再整数倍放大贴到窗口上。
 * 这对原版素材是对的（像素锐利、取景不变），但**超分素材进来也会先被压回
 * 640×480**，画质升级等于白做；文字也是在 640×480 上写的，放大后是糊的。
 *
 * 高清舞台把「逻辑坐标」与「像素密度」拆开：
 *
 * - 各离屏画布（舞台 / 棋盘 / 側欄 …）的**像素尺寸** = 逻辑尺寸 × `s`，
 *   上下文挂一个 `setTransform(s, 0, 0, s, 0, 0)` —— 所有绘制代码照旧写
 *   640×480 里的坐标，一行不用改；
 * - 精灵一律按**逻辑尺寸**画（`drawSprite`）：1× 原图放大 `s` 倍（最近邻，
 *   与原来整数倍放大一模一样），超分图缩到同一个框里（平滑）；
 * - 文字在 `s` 倍的画布上直接光栅化 —— 不花任何 AI 成本就清晰了。
 *
 * ★ `s = 1` 时每一次 `drawImage` 的参数与改造前**逐字相同**（见 `drawSprite`），
 *   所以关掉高清舞台就是原来的画面，线上行为不变。
 */

/** 能按逻辑尺寸画出来的一张图 —— `Sprite` 就满足 */
export interface SpriteLike {
  /** 位图；超分图的像素尺寸比 `width/height` 大 */
  readonly bitmap: CanvasImageSource;
  /** **逻辑**宽高（= 原版这张图的尺寸，舞台坐标里占多大） */
  readonly width: number;
  readonly height: number;
}

/** 高清舞台允许的最大像素倍率 —— 4× 素材再往上没有意义，只会白耗显存 */
export const MAX_SURFACE_SCALE = 4;

/**
 * ★ 触屏设备（手机 / 平板）的倍率上限。
 *
 * 第十九份试玩回报「iPhone 上玩手机很烫」修过一轮（指令表去重、后台暂停…）；高清舞台
 * 让三块离屏画布的像素按倍率平方涨 —— iPhone 13 横屏窗口倍数约 2.44，不封顶就是
 * 1.9 Mpx × 每帧重画，封到 2 是 1.2 Mpx（关掉高清时 0.3 Mpx）。网页素材本来就是 2× 档，
 * 再往上只多出文字的锐度，换不回发热。最后贴屏那一下补一次平滑放大（见 `main.ts` 的 `blitStage`）。
 */
export const TOUCH_SURFACE_SCALE_CAP = 2;

/**
 * 这台设备的倍率上限：触屏（粗指针或有触点）封到 `TOUCH_SURFACE_SCALE_CAP`，其余 `MAX_SURFACE_SCALE`。
 * ⚠️ iPad 的 Safari 自称 Mac，但 `maxTouchPoints > 0` —— 故两条判据取「或」。
 */
export function surfaceScaleCap(env: { coarsePointer: boolean; maxTouchPoints: number }): number {
  return env.coarsePointer || env.maxTouchPoints > 0 ? TOUCH_SURFACE_SCALE_CAP : MAX_SURFACE_SCALE;
}

/** 位图的像素尺寸；拿不到（测试里的假位图）返回 null */
function pixelSize(bitmap: CanvasImageSource): { w: number; h: number } | null {
  const b = bitmap as { width?: unknown; height?: unknown };
  if (typeof b.width !== 'number' || typeof b.height !== 'number') return null;
  if (b.width <= 0 || b.height <= 0) return null;
  return { w: b.width, h: b.height };
}

/**
 * 这张图是几倍像素（横、纵分开算：超分工具常把结果对齐到 4 的倍数，
 * 两个方向的实际倍率不一定相等）。原图 / 拿不到尺寸 → `null`。
 */
export function hdRatio(s: SpriteLike): { x: number; y: number } | null {
  const px = pixelSize(s.bitmap);
  if (px === null || s.width <= 0 || s.height <= 0) return null;
  if (px.w === s.width && px.h === s.height) return null;
  return { x: px.w / s.width, y: px.h / s.height };
}

/**
 * 画一张精灵，**按逻辑尺寸**。
 *
 * - 原图（像素 = 逻辑）：参数与改造前完全一样 —— 不给 `dw/dh` 就走 3 参，
 *   给了就走 5 参；最近邻由上下文的 `imageSmoothingEnabled = false` 保证；
 * - 超分图：总是走 5 参把它塞回逻辑框里，且**这一次**打开平滑（缩小取样，
 *   否则 4× 图缩到 2× 屏上会闪烁锯齿）。
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  s: SpriteLike,
  dx: number,
  dy: number,
  dw?: number,
  dh?: number,
): void {
  const r = hdRatio(s);
  if (r === null) {
    if (dw === undefined || dh === undefined) ctx.drawImage(s.bitmap, dx, dy);
    else ctx.drawImage(s.bitmap, dx, dy, dw, dh);
    return;
  }
  const w = dw ?? s.width;
  withSmoothing(ctx, smoothingFor(ctx, r, w / s.width), () => ctx.drawImage(s.bitmap, dx, dy, w, dh ?? s.height));
}

/**
 * 这一次缩放该用多贵的插值。
 *
 * ★ 只有**大幅缩小**（位图 ≥ 2 个像素落到 1 个设备像素上，如 4× 母版画到 1× 舞台）才要 `'high'`
 *   （防闪烁锯齿）；放大或小幅缩小用 `'low'`（双线性）就够。`'high'` 在软件光栅（无 GPU 的机器、
 *   headless）下极贵：开场过场 2× 帧贴到 3× 舞台，实测每帧 86 ms → 见 W-80 §8 的量测。
 *
 * @param r    位图像素 / 逻辑像素
 * @param k    目标尺寸 / 逻辑尺寸（按逻辑尺寸画 = 1）
 */
function smoothingFor(ctx: CanvasRenderingContext2D, r: { x: number; y: number }, k: number): ImageSmoothingQuality {
  const devicePerBitmapPx = (surfaceScaleOf(ctx) * Math.abs(k)) / Math.max(r.x, r.y);
  return devicePerBitmapPx < 0.5 ? 'high' : 'low';
}

/**
 * 从精灵上裁一块画（9 参 `drawImage` 的替身）。`sx/sy/sw/sh` 是**逻辑**坐标
 * —— 即原版那张图里的像素坐标；超分图按实际倍率换算到位图上。
 */
export function drawSpriteRegion(
  ctx: CanvasRenderingContext2D,
  s: SpriteLike,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const r = hdRatio(s);
  if (r === null) {
    ctx.drawImage(s.bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }
  withSmoothing(ctx, smoothingFor(ctx, r, sw === 0 ? 1 : dw / sw), () =>
    ctx.drawImage(s.bitmap, sx * r.x, sy * r.y, sw * r.x, sh * r.y, dx, dy, dw, dh),
  );
}

function withSmoothing(ctx: CanvasRenderingContext2D, quality: ImageSmoothingQuality, draw: () => void): void {
  const prev = ctx.imageSmoothingEnabled;
  const prevQ = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality;
  try {
    draw();
  } finally {
    ctx.imageSmoothingEnabled = prev;
    ctx.imageSmoothingQuality = prevQ;
  }
}

/**
 * 取影片第 `i` 帧来画：超分帧已解好就是它（`assets.ts` 的 `LoadedFlic.frameAt`），否则原帧。
 * 画出来一律按影片的**逻辑**尺寸塞框（`drawSprite(ctx, { bitmap, width, height }, …)`）。
 * 泛型是为了让只认 `frames` 的轻量类型（`intro.ts` 的 `IntroFlic`…）也能用。
 */
export function flicFrame<T>(f: { frames: readonly T[]; frameAt?: (i: number) => T | undefined }, i: number): T | undefined {
  return f.frameAt?.(i) ?? f.frames[i];
}

// ============================================================
//  离屏画布的像素倍率
// ============================================================

/**
 * 舞台该用几倍像素。
 *
 * @param blitScale 舞台贴到窗口时的放大倍数（`stageMetrics().scale`，设备像素）
 * @param enabled   高清舞台开没开；关着恒为 1（= 改造前）
 *
 * ★ 直接取窗口倍数（**可以是小数**），封顶 4：舞台像素正好等于它在窗口上占的像素，
 *   贴屏那一下是 1:1 拷贝、不做重采样。
 *   ⚠️ 先前取的是向上取整（2.4 → 3），贴屏时还得平滑缩一次 —— 实测（2880×1800）
 *   那一下单独吃掉 9 ms/帧，走子因此掉到 30 帧、格与格之间多等 45 ms，人物明显变慢。
 *   小数倍下 1× 原图的最近邻放大像素宽窄不一，与关掉高清舞台时整窗放大的效果相同，不算退化。
 */
export function surfaceScaleFor(blitScale: number, enabled: boolean, cap: number = MAX_SURFACE_SCALE): number {
  if (!enabled || !Number.isFinite(blitScale) || blitScale <= 1) return 1;
  return Math.max(1, Math.min(MAX_SURFACE_SCALE, cap, blitScale));
}

/** 离屏画布 + 它的上下文 */
export interface Surface {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/**
 * 把一块离屏画布调成 `逻辑尺寸 × s` 像素，并挂上 `s` 倍变换。
 *
 * ⚠️ 改 `canvas.width` 会**清空画布并重置上下文的全部状态**（变换、字体、
 *   平滑…），所以只在倍率真的变了时才动；动了之后本帧必须整块重画 ——
 *   舞台 / 棋盘 / 側欄本来就是每帧全量重画，满足这一条。
 *
 * @returns 这次是否真的改了尺寸
 */
export function sizeSurface(surface: Surface, logicalW: number, logicalH: number, s: number): boolean {
  const w = Math.round(logicalW * s);
  const h = Math.round(logicalH * s);
  const { canvas, ctx } = surface;
  const changed = canvas.width !== w || canvas.height !== h;
  if (changed) {
    canvas.width = w;
    canvas.height = h;
  }
  // 变换每次都重挂一遍：便宜，且防住有人 `setTransform` 忘了 restore
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return changed;
}

/**
 * 把一块离屏画布（像素 = 逻辑 × s）按**逻辑尺寸**贴上去。
 * `s = 1` 时与改造前的 3 参调用逐字相同。
 */
export function drawSurface(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  dx: number,
  dy: number,
  logicalW: number,
  logicalH: number,
  s: number,
): void {
  if (s === 1) ctx.drawImage(src, dx, dy);
  else ctx.drawImage(src, dx, dy, logicalW, logicalH);
}

/**
 * 当前的离屏像素倍率 —— 给**自己建离屏画布**的模块用（樂透開獎那块表面等），
 * 由 `main.ts` 每帧同步。默认 1 = 改造前。
 */
let currentScale = 1;

export function currentSurfaceScale(): number {
  return currentScale;
}

export function setCurrentSurfaceScale(s: number): void {
  currentScale = s;
}

/** 高清开关在 `localStorage` 里的键（每台设备各自记，不进存档、不上网）*/
export const HD_STORAGE_KEY = 'rich4.hd';

/**
 * 高清舞台开关：`?hd=0` 关、`?hd=1` 开（URL 优先）；URL 没写就看 `localStorage['rich4.hd']`，
 * 存的是 `'0'` 才关。
 *
 * ★ 2026-09-24 需求方拍板：**默认开**（W-80 §8 上线）。先前默认关是为了「不影响线上版本」。
 */
export function hdStageRequested(search: string, stored: string | null): boolean {
  const q = new URLSearchParams(search).get('hd');
  if (q !== null) return !(q === '0' || q === 'false');
  return stored !== '0';
}

/**
 * 从上下文当前的变换里读出离屏倍率 `s`（没有 `getTransform` 的假上下文按 1）。
 * 给要自己 `setTransform` 的绘制段用 —— 那会顶掉基础变换，得把 `s` 乘回去。
 */
export function surfaceScaleOf(ctx: CanvasRenderingContext2D): number {
  const t = (ctx as { getTransform?: () => DOMMatrix }).getTransform?.call(ctx);
  return t === undefined || !Number.isFinite(t.a) || t.a <= 0 ? 1 : t.a;
}
