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

// ============================================================
//  ★ 第二十七份：打完字画面回不来（iPhone Safari 横屏，「输入文字后画面显示不全」）
// ============================================================
//
// ★ 症状：在门厅暱稱 / 聯機存檔取名 / 回報說明框里打完字，舞台只剩放大后的一角（下半截
//   棋盘与小地图被裁掉）；转向也不恢复。回报里存的是**画布**截图（完整），裁切发生在页面层。
//
// ★ 根因（iOS Safari 的三个老行为叠在一起）：
//   ① 聚焦**计算字号 < 16px** 的文字框 ⇒ 自动放大（visualViewport.scale > 1），失焦**不缩回**；
//      上面的 `visibleBox` 把 scale ≠ 1 当成玩家双指放大、按设计不跟 ⇒ 页面停在放大态。
//   ② 软键盘升起时 Safari 把文档卷上去露出输入框（scrollY > 0），键盘收起后**常常不卷回**，
//      固定定位的整页于是错位。
//   ③ 键盘收起 / 转向时 `visualViewport` 的 resize 有时来得晚、有时只来一次且尺寸还是旧的。
//
// ★ 修法（三层）：
//   1. 字号：所有文字框 ≥ 16px（text-entry.ts 的 `TEXT_ENTRY_FONT_PX` + index.html 兜底）⇒ ① 不再发生。
//   2. iOS 上 meta viewport 加 `maximum-scale=1`（`iosViewportContent`）：iOS 10 起它**只**挡
//      聚焦自动放大，玩家双指缩放照旧可用；Android / 桌面不加（Android 上它会真的禁掉缩放）。
//   3. `installTextEntryRecovery`：文字框失焦后（焦点没有跳到另一个文字框），在键盘收起动画的
//      几个时刻各「收拾」一次 —— 卷动归零、若仍是放大态就用 meta 复位招把 scale 夹回 1、
//      重钉页面矩形并排一帧；转向后同样补几次。键盘收着时可视区一变也把残留的卷动归零。

/** 失焦 / 转向之后这几个时刻各收拾一次（ms）：0 = 立刻；其余盖住 iOS 键盘收起 / 转向动画（≈ 250–500ms） */
export const SETTLE_DELAYS_MS: readonly number[] = [0, 120, 350, 700];

/** meta 复位招：改成含 `maximum-scale=1, minimum-scale=1` 的内容，这么久之后再改回去（ms） */
export const ZOOM_RESET_RESTORE_MS = 400;

/** iPhone / iPod / iPad（含「桌面版网站」模式下伪装成 Macintosh 的 iPadOS） */
export function isIosWebKit(nav: { userAgent: string; maxTouchPoints?: number }): boolean {
  if (/iP(hone|od|ad)/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

/** 去掉 meta viewport 里已有的缩放上下限 / user-scalable 项 */
function stripScaleLimits(content: string): string[] {
  return content
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '' && !/^(maximum-scale|minimum-scale|user-scalable)\s*=/i.test(p));
}

/** iOS 上常驻的 meta viewport：原内容 + `maximum-scale=1`（只挡聚焦自动放大） */
export function iosViewportContent(content: string): string {
  return [...stripScaleLimits(content), 'maximum-scale=1'].join(', ');
}

/**
 * 复位用的 meta viewport：原内容 + `maximum-scale=1, minimum-scale=1`。
 * 与常驻内容**一定不同**（iOS 只在内容变了时重新套用，才会把当前 scale 夹回 1）。
 */
export function zoomResetViewportContent(content: string): string {
  return [...stripScaleLimits(content), 'maximum-scale=1', 'minimum-scale=1'].join(', ');
}

/** 收拾一次要做什么（纯函数，测试直接喂状态） */
export interface SettlePlan {
  /** 把文档卷回 (0, 0) */
  readonly scrollToOrigin: boolean;
  /** 用 meta 复位招把 scale 夹回 1 */
  readonly resetZoom: boolean;
}

/**
 * 失焦 / 转向之后的一次收拾。
 * - 焦点又在文字框里（跳到下一个框、或键盘又升起来了）⇒ 什么都不做，别跟 Safari 抢；
 * - 文档被卷过 ⇒ 卷回原点；
 * - 仍是放大态，且这次放大是**打字引起的**（`zoomSuspect`）⇒ 复位缩放。玩家自己双指放大不动。
 */
export function planSettle(s: {
  readonly typing: boolean;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly scale: number | null;
  readonly zoomSuspect: boolean;
}): SettlePlan {
  if (s.typing) return { scrollToOrigin: false, resetZoom: false };
  return {
    scrollToOrigin: s.scrollX !== 0 || s.scrollY !== 0,
    resetZoom: s.zoomSuspect && s.scale !== null && Math.abs(s.scale - 1) > ZOOM_EPSILON,
  };
}

/** 装 `installTextEntryRecovery` 需要的窗口接口（测试用假的） */
export interface RecoveryWindow extends ViewportHost {
  readonly scrollX: number;
  readonly scrollY: number;
  scrollTo(x: number, y: number): void;
  setTimeout(cb: () => void, ms: number): unknown;
}

/** meta viewport 元素里用得到的那一项 */
export interface MetaLike {
  content: string;
}

/** 装 `installTextEntryRecovery` 需要的文档接口 */
export interface RecoveryDocument {
  readonly activeElement: unknown;
  addEventListener(type: string, cb: (e: { target: EventTarget | null }) => void, capture?: boolean): void;
}

/**
 * 文字框失焦 / 转向后把页面收拾回「整块舞台看得见」。`refit` = `installViewportFit` 的返回值
 * 再加排一帧（调用方给）。返回「立刻收拾一轮」的函数（测试 / 手动用）。
 */
export function installTextEntryRecovery(opts: {
  readonly win: RecoveryWindow;
  readonly doc: RecoveryDocument;
  /** `<meta name="viewport">`；没有就不做缩放复位（只卷回 + 重钉） */
  readonly meta: MetaLike | null;
  readonly isTextEntry: (t: unknown) => boolean;
  readonly refit: () => void;
}): () => void {
  const { win, doc, meta, isTextEntry, refit } = opts;
  /** 最近一次放大可能是打字引起的（有文字框失焦过、scale 还没回到 1） */
  let zoomSuspect = false;
  let restoreTimer = false;

  const resetZoom = (): void => {
    if (meta === null || restoreTimer) return;
    const original = meta.content;
    meta.content = zoomResetViewportContent(original);
    restoreTimer = true;
    win.setTimeout(() => {
      restoreTimer = false;
      meta.content = original;
    }, ZOOM_RESET_RESTORE_MS);
  };

  const settle = (): void => {
    const vv = win.visualViewport;
    const scale = vv === null || vv === undefined ? null : vv.scale;
    const plan = planSettle({
      typing: isTextEntry(doc.activeElement),
      scrollX: win.scrollX,
      scrollY: win.scrollY,
      scale,
      zoomSuspect,
    });
    if (plan.scrollToOrigin) win.scrollTo(0, 0);
    if (plan.resetZoom) resetZoom();
    if (scale !== null && Math.abs(scale - 1) <= ZOOM_EPSILON) zoomSuspect = false;
    // 焦点还在文字框里也重钉：键盘升着时页面矩形本来就该贴住缩小的可视区
    refit();
  };

  const burst = (): void => {
    for (const ms of SETTLE_DELAYS_MS) win.setTimeout(settle, ms);
  };

  doc.addEventListener(
    'focusout',
    (e) => {
      if (!isTextEntry(e.target)) return;
      zoomSuspect = true;
      burst();
    },
    true,
  );
  win.addEventListener('orientationchange', burst);
  // 键盘收着（没在打字）时可视区一变：残留的卷动归零（iOS 键盘收起后常留一截）
  const vv = win.visualViewport;
  vv?.addEventListener('resize', () => {
    if (isTextEntry(doc.activeElement)) return;
    if (Math.abs(vv.scale - 1) > ZOOM_EPSILON) return; // 玩家双指放大时不动
    if (win.scrollX !== 0 || win.scrollY !== 0) win.scrollTo(0, 0);
  });
  return settle;
}
