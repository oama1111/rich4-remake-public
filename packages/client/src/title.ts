/*
 * 標題畫面
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 整屏是 `Data.mkf` 资源 1 的第 0 张图（640×480 的地球底图 + 标题字），
 *   五个按钮是同一资源里的小图，**坐标从 exe 里读出来的**，不是量的。
 *
 * @source 標題窗口过程 VA 0x00402762 起的命中测试循环：
 * ```asm
 * for (i = 0; i < 5; i++) {
 *     edi = (2*i + 2) * 12                       ; ★ 精灵表项 12 字节/张
 *     x0 = word[0x46cb28 + i*4]     - 图.anchorX ; +0x10
 *     y0 = word[0x46cb28 + i*4 + 2] - 图.anchorY ; +0x12
 *     x1 = x0 + 图.width                          ; +0x0c
 *     y1 = y0 + 图.height                         ; +0x0e
 *     if (鼠标在 [x0,x1) × [y0,y1) 内) 选中 = i
 * }
 * ```
 *   锚点表在 0x0046cb28，五对 int16。
 *
 * ★ 精灵**成对**：奇数号是常态、偶数号是高亮（尺寸更大一圈）。
 *   按钮 i 用 `2i+1`（常态）与 `2i+2`（高亮）。
 *   实测尺寸 1:108×105 / 2:116×113、3:107×92 / 4:114×99 …… 一一对上。
 */

import type { Sprite } from './assets.ts';
import { drawSprite } from './hd-stage.ts';

/** 標題底图与按钮都在 Data.mkf 资源 1 */
export const TITLE_RESOURCE = 1;
/** 底图图号 */
export const TITLE_BACKGROUND = 0;

/** 五个按钮 —— 顺序即 exe 里的下标，决定用哪张精灵与哪个分支 */
export type TitleButton = 'start' | 'load' | 'option' | 'exit' | 'newStage';

/**
 * 按钮锚点。
 * @source `word [i*4 + 0x0046cb28]`，五对 int16，逐字节取自 rich4.exe
 */
export const TITLE_ANCHORS: readonly { id: TitleButton; x: number; y: number }[] = [
  { id: 'start', x: 190, y: 380 },
  { id: 'load', x: 328, y: 380 },
  { id: 'option', x: 468, y: 378 },
  { id: 'exit', x: 328, y: 450 },
  { id: 'newStage', x: 62, y: 380 },
];

/** 按钮 i 的常态／高亮图号 @source edi = (2*i + 2) * 12 —— 表项 12 字节 */
export function titleSpriteIndex(i: number, hot: boolean): number {
  return hot ? 2 * i + 2 : 2 * i + 1;
}

export interface TitleHit {
  index: number;
  id: TitleButton;
}

/**
 * 命中测试。
 *
 * ⚠️ 判定框用的是**高亮那张**的尺寸吗？不是——原版取的是
 *   `(2*i+2)` 那一张（高亮版，更大一圈）。照搬：鼠标一进大框就高亮，
 *   这也是原版按钮「一碰就胀开」的手感来源。
 */
export function hitTitle(
  x: number,
  y: number,
  sizeOf: (spriteIndex: number) => Sprite | null,
): TitleHit | null {
  for (let i = 0; i < TITLE_ANCHORS.length; i++) {
    const a = TITLE_ANCHORS[i]!;
    // 高亮那张拿不到就退而用常态那张
    const s = sizeOf(2 * i + 2) ?? sizeOf(2 * i + 1);
    // ⚠️ 两张都还没解出来时给一个**兜底方框**。原版不需要这个（它的图
    //   早就在内存里），但这里解码是异步的：没有兜底的话，图没解完之前
    //   按钮全是死的，用户会以为界面坏了。宁可判定粗一点，也不要点不动。
    const w = s?.width ?? FALLBACK_BUTTON;
    const h = s?.height ?? FALLBACK_BUTTON;
    const ax = s?.anchorX ?? Math.floor(w / 2);
    const ay = s?.anchorY ?? Math.floor(h / 2);
    const x0 = a.x - ax;
    const y0 = a.y - ay;
    if (x >= x0 && y >= y0 && x < x0 + w && y < y0 + h) {
      return { index: i, id: a.id };
    }
  }
  return null;
}

/** 图还没解出来时的兜底判定框边长 —— 五个按钮实测在 53..116 之间 */
const FALLBACK_BUTTON = 90;

/** 把標題畫面画到 640×480 的舞台上 */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  hot: number | null,
  need: (
    archive: 'Data.mkf',
    resource: number,
    index: number,
    colorKeyBlack?: boolean,
  ) => Sprite | null,
): void {
  // ⚠️ 底图是整屏 SMP，**不能抠黑**——海洋与夜空里的黑是真的黑。
  const bg = need('Data.mkf', TITLE_RESOURCE, TITLE_BACKGROUND, false);
  if (bg !== null) drawSprite(ctx, bg, 0, 0);

  // ★ 按钮反过来：它们是叠在底图上的 SMP 小图，**黑就是透明**。
  //   不抠的话每个按钮都顶着一个黑方块，一眼假。
  for (let i = 0; i < TITLE_ANCHORS.length; i++) {
    const a = TITLE_ANCHORS[i]!;
    // ⚠️ **两张都要摸一下**。命中判定用的是高亮那张的尺寸，而高亮那张
    //   在鼠标碰到之前从不绘制 —— 不预热的话它一直没被解码，
    //   判定里取到 null 就跳过，于是**第一次点永远点不中**。
    const hotSprite = need('Data.mkf', TITLE_RESOURCE, titleSpriteIndex(i, true), true);
    const normal = need('Data.mkf', TITLE_RESOURCE, titleSpriteIndex(i, false), true);
    const s = hot === i ? hotSprite : normal;
    if (s === null) continue;
    drawSprite(ctx, s, a.x - s.anchorX, a.y - s.anchorY);
  }
}
