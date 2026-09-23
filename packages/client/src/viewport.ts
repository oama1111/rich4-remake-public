/*
 * 页面贴住「看得见的那一块」—— iPad Safari 地址栏遮住工具栏（第十二份試玩回報）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 症状：iPad 上用 Safari 开，顶部地址栏盖住了棋盘屏最上面那排工具栏图标。
 *
 * ★ 根因：`body { height: 100vh }`。在 iOS / iPadOS Safari 上 `100vh` 是
 *   **最大**视口（地址栏收起时的高度），地址栏展开时它比看得见的区域高出一截 ⇒
 *   ① 画布比可视区高，`stageMetrics` 按这块偏高的画布算放大倍数与居中，
 *      640×480 的舞台上下两头都落到了可视区外；
 *   ② 文档因此**可以滚动**（iOS 上 `body { overflow: hidden }` 挡不住触摸滚动），
 *      在棋盘上一拖，整页往上卷，舞台顶端那排工具栏就卷进了地址栏底下。
 *   桌面浏览器 `100vh` 与窗口一样高，所以只有 iPad / iPhone 上看得到。
 *
 * ★ 修法（两层，缺一层也还能用）：
 *   1. CSS（index.html）：`body` 改为 `position: fixed; inset: 0`（固定定位的包含块
 *      就是**当前**布局视口，地址栏展开/收起都跟着变），不再用 `100vh`；文档本身
 *      不再有可滚动的高度。
 *   2. JS（本模块）：有 `visualViewport` 且没有双指缩放时，把 `body` 的
 *      top/left/width/height 直接钉成 `visualViewport` 那块矩形，并在它
 *      `resize` / `scroll` 时重钉 —— 这是浏览器口中「此刻真正看得见」的区域，
 *      地址栏、Stage Manager 改窗口、分屏、软键盘都会反映在这里。
 *   画布是 `body` 的 flex 子元素，`resizeCanvas()` 读它的 client 尺寸 ⇒
 *   整块 640×480 永远按「看得见的那块」letterbox。
 *
 * ⚠️ 双指缩放（`scale ≠ 1`）时**不跟**：那是玩家自己要放大看，
 *   把页面缩成放大后那一小块反而会把画面再缩回去。此时退回 CSS 的 `inset: 0`。
 */

/** `window.visualViewport` 里用得到的那几项（测试里可以直接给一个对象） */
export interface VisualViewportLike {
  readonly width: number;
  readonly height: number;
  readonly offsetTop: number;
  readonly offsetLeft: number;
  readonly scale: number;
}

/** 页面该占的矩形（CSS 像素，相对布局视口） */
export interface ViewportBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 缩放偏离 1 超过这么多就当作玩家双指放大了 */
const ZOOM_EPSILON = 0.01;

/**
 * 看得见的那块矩形；`null` ⇒ 不用 JS 钉，交给 CSS 的 `position: fixed; inset: 0`。
 */
export function visibleBox(vv: VisualViewportLike | null | undefined): ViewportBox | null {
  if (vv === null || vv === undefined) return null;
  if (!(vv.width > 0 && vv.height > 0)) return null;
  if (Math.abs(vv.scale - 1) > ZOOM_EPSILON) return null;
  return {
    top: Math.max(0, vv.offsetTop),
    left: Math.max(0, vv.offsetLeft),
    width: vv.width,
    height: vv.height,
  };
}

/** 本模块碰到的 `body.style` 那几项 */
interface BoxStyle {
  top: string;
  left: string;
  width: string;
  height: string;
}

/** 装上它需要的最小窗口接口（测试用假的） */
export interface ViewportHost {
  readonly visualViewport?: (VisualViewportLike & EventTargetLike) | null;
  addEventListener(type: string, cb: () => void): void;
}

interface EventTargetLike {
  addEventListener(type: string, cb: () => void): void;
}

/** 把矩形写进 style；`null` ⇒ 清掉，退回样式表 */
export function applyBox(style: BoxStyle, box: ViewportBox | null): void {
  style.top = box === null ? '' : `${box.top}px`;
  style.left = box === null ? '' : `${box.left}px`;
  style.width = box === null ? '' : `${box.width}px`;
  style.height = box === null ? '' : `${box.height}px`;
}

/**
 * 让 `el` 始终贴住可视区。立刻钉一次，之后可视区一变就重钉，再叫 `onChange`
 * （调用方在那里排下一帧 —— `resizeCanvas()` 在帧里读画布的新尺寸）。
 */
export function installViewportFit(
  win: ViewportHost,
  style: BoxStyle,
  onChange?: () => void,
): () => void {
  const refit = (): void => {
    applyBox(style, visibleBox(win.visualViewport));
    onChange?.();
  };
  applyBox(style, visibleBox(win.visualViewport));
  const vv = win.visualViewport;
  if (vv !== null && vv !== undefined) {
    vv.addEventListener('resize', refit);
    vv.addEventListener('scroll', refit);
  }
  win.addEventListener('resize', refit);
  win.addEventListener('orientationchange', refit);
  return refit;
}
