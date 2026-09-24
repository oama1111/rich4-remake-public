/*
 * 触屏上的「右键」—— 长按 = 右键、可见的「取消」钮（需求方 2026-09-24）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方原话：「如果我在触屏设备上没有办法用鼠标右键取消操作，比如使用卡片或者
 *   打开卡片栏之后，就没办法玩」。原版几乎处处用右键（`WM_RBUTTONUP 0x205`）取消：
 *   卡片欄 / 道具欄 / 目标拾取 / 跳过台词 / 关屏 —— 触屏上没有右键，人就卡住了。
 *
 * ★ 这是**本项目自己的无障碍补丁**（原版没有触屏），所以两条原则：
 *   1. **不另写一套取消逻辑**：长按与「取消」钮最终都是在画布上派一次真正的
 *      `contextmenu` 事件，走 `main.ts` 那条右键处理的**原路**
 *      （过路费闪 → 登记整屏的 `UiScreen.contextmenu` → `cancelTopPanel()` 梯子 → 小地图标记）。
 *   2. **不碰复刻屏**：画布里一个像素都不加；「取消」钮是 DOM，优先放在 640×480 舞台
 *      外的黑边里，只有黑边放不下时才以半透明小钮压在棋盘右下角。
 *
 * 本文件分三块：
 *   · `TouchGesture` —— 长按状态机（纯逻辑，时间与坐标都由调用方喂，单测钉着）；
 *   · `rightClickMeaningful` —— 「此刻右键有没有用」（纯函数，与右键处理同一套判据）；
 *   · `longPressAllowed` —— 「此刻长按算不算右键」（纯函数；金额条那几屏不算）；
 *   · `cancelButtonPlacement` —— 「取消」钮放哪（纯函数）；
 *   · `bindTouchGestures` —— 把状态机接到画布的 touch 事件上（DOM 胶水，浏览器里验收）。
 *
 * ⚠️ 桌面鼠标一行不变：本模块只听 `touchstart/move/end/cancel`，鼠标从来不发这几种。
 */

import { cancelLayerOf, type CancelLayer, type CancelSnapshot } from './panel-cancel.ts';

// ============================================================
//  长按状态机
// ============================================================

/** 按住不动多久算长按（ms）—— iOS / Android 系统长按的通行值 */
export const LONG_PRESS_MS = 500;
/** 手指挪动超过这么多（CSS 像素）就不再是「点」或「长按」，而是拖 */
export const TAP_SLOP_PX = 10;

/** 状态机吐出的「鼠标动作」—— 坐标是 client（CSS 像素）*/
export interface GestureOut {
  readonly kind: 'move' | 'down' | 'up' | 'click' | 'rightClick';
  readonly x: number;
  readonly y: number;
}

type Phase =
  /** 没有手指 */
  | { readonly k: 'idle' }
  /** 一根手指按着、还没动、还没到时限 —— 这时**什么都没派**（点还是长按还说不准）*/
  | {
      readonly k: 'pending';
      readonly id: number;
      readonly x0: number;
      readonly y0: number;
      readonly t0: number;
      /** 这一次按下时长按**算不算**右键（金额条那几屏不算，见 `longPressAllowed`）*/
      readonly lp: boolean;
    }
  /** 挪过阈值 ⇒ 已派了按下，之后逐拍派移动，抬手派抬起 */
  | { readonly k: 'drag'; readonly id: number; readonly x: number; readonly y: number }
  /** 长按已派出右键 ⇒ 这根手指剩下的一切（移动、抬手）都吞掉 */
  | { readonly k: 'held'; readonly id: number }
  /** 多指 ⇒ 这一轮作废，等所有手指都离开 */
  | { readonly k: 'void' };

/**
 * 单指手势 → 鼠标动作。
 *
 * | 手势 | 派出 |
 * |---|---|
 * | 点（< 500 ms，挪动 ≤ 10 px）| 抬手时：移动 → 按下 → 抬起 → click（都在按下点）|
 * | 拖（500 ms 内挪过 10 px）| 挪过那一刻：移动 → 按下(起点) → 移动；之后逐拍移动；抬手：抬起 → click |
 * | 长按（按住 ≥ 500 ms，挪动 ≤ 10 px）| 到点：右键；抬手**什么都不派**（后面那一下点被吞掉）|
 * | 第二根手指在「还没定性」时落下 | 这一轮作废，什么都不派，直到全部手指离开 |
 *
 * ★ `start(…, longPress = false)`（金额条那几屏，见 `longPressAllowed`）：这一次按下**没有长按**，
 *   按多久都只是「点」或「拖」—— 手指搁在金额条上不会把整页取消掉（需求方 2026-09-24）。
 *
 * ★ 按下**推迟**到能判定的那一刻才派 —— 否则长按时左键早已按下（工具列会记下按下号、
 *   抬手就成立），后面那一下右键再取消也晚了。代价是点按的「按下图」只闪一帧。
 */
export class TouchGesture {
  private phase: Phase = { k: 'idle' };
  private readonly fingers = new Set<number>();

  /** 下一次该叫 `due()` 的时刻；`null` = 不用定时 */
  deadline(): number | null {
    return this.phase.k === 'pending' && this.phase.lp ? this.phase.t0 + LONG_PRESS_MS : null;
  }

  /** 此刻有没有手指在屏上（给「吞掉系统长按菜单」那道闸用）*/
  active(): boolean {
    return this.fingers.size > 0;
  }

  /** @param longPress 这一次按下长按算不算右键（落指那一刻定，之后不再变）*/
  start(id: number, x: number, y: number, t: number, longPress = true): GestureOut[] {
    this.fingers.add(id);
    const p = this.phase;
    if (p.k === 'idle' && this.fingers.size === 1) {
      this.phase = { k: 'pending', id, x0: x, y0: y, t0: t, lp: longPress };
    } else if (p.k === 'pending') {
      // 第二根手指：双指缩放 / 误触 —— 既不是点也不是长按
      this.phase = { k: 'void' };
    }
    // drag / held / void：多出来的手指一概不理
    return [];
  }

  move(id: number, x: number, y: number, t: number): GestureOut[] {
    const p = this.phase;
    if (p.k === 'pending' && p.id === id) {
      // 时限已过而定时器还没来得及跑：按长按算（与 `due` 同一条判据）
      if (p.lp && t - p.t0 >= LONG_PRESS_MS) return this.fire(p);
      if (Math.hypot(x - p.x0, y - p.y0) <= TAP_SLOP_PX) return [];
      this.phase = { k: 'drag', id, x, y };
      return [
        { kind: 'move', x: p.x0, y: p.y0 },
        { kind: 'down', x: p.x0, y: p.y0 },
        { kind: 'move', x, y },
      ];
    }
    if (p.k === 'drag' && p.id === id) {
      this.phase = { k: 'drag', id, x, y };
      return [{ kind: 'move', x, y }];
    }
    return [];
  }

  end(id: number, x: number, y: number, t: number): GestureOut[] {
    this.fingers.delete(id);
    const p = this.phase;
    let out: GestureOut[] = [];
    if (p.k === 'pending' && p.id === id) {
      if (p.lp && t - p.t0 >= LONG_PRESS_MS) {
        out = this.fire(p);
      } else {
        out = [
          { kind: 'move', x: p.x0, y: p.y0 },
          { kind: 'down', x: p.x0, y: p.y0 },
          { kind: 'up', x: p.x0, y: p.y0 },
          { kind: 'click', x: p.x0, y: p.y0 },
        ];
      }
      this.phase = { k: 'idle' };
    } else if (p.k === 'drag' && p.id === id) {
      out = [
        { kind: 'up', x, y },
        { kind: 'click', x, y },
      ];
      this.phase = { k: 'idle' };
    } else if (p.k === 'held' && p.id === id) {
      this.phase = { k: 'idle' };
    }
    if (this.fingers.size > 0 && this.phase.k === 'idle') this.phase = { k: 'void' };
    if (this.fingers.size === 0 && this.phase.k === 'void') this.phase = { k: 'idle' };
    return out;
  }

  /** 系统把触摸收走了（来电、手势切走…）：拖着的要松开，但**不算点击** */
  cancel(id: number): GestureOut[] {
    this.fingers.delete(id);
    const p = this.phase;
    let out: GestureOut[] = [];
    if (p.k === 'drag' && p.id === id) out = [{ kind: 'up', x: p.x, y: p.y }];
    if ((p.k === 'pending' || p.k === 'drag' || p.k === 'held') && p.id === id) this.phase = { k: 'idle' };
    if (this.fingers.size > 0 && this.phase.k === 'idle') this.phase = { k: 'void' };
    if (this.fingers.size === 0 && this.phase.k === 'void') this.phase = { k: 'idle' };
    return out;
  }

  /** 定时器到点 */
  due(t: number): GestureOut[] {
    const p = this.phase;
    if (p.k !== 'pending' || !p.lp || t - p.t0 < LONG_PRESS_MS) return [];
    return this.fire(p);
  }

  private fire(p: Extract<Phase, { k: 'pending' }>): GestureOut[] {
    this.phase = this.fingers.has(p.id) ? { k: 'held', id: p.id } : { k: 'idle' };
    return [{ kind: 'rightClick', x: p.x0, y: p.y0 }];
  }
}

// ============================================================
//  「此刻右键有没有用」
// ============================================================

/**
 * `main.ts` 那条 `contextmenu` 处理**依次**看的几样东西（全是纯查询）。
 * 顺序与判据必须与那条处理一致 —— 见 `rightClickMeaningful`。
 */
export interface RightClickSnapshot {
  /** 過路費闪在播（右键跳过它）*/
  readonly tollFlash: boolean;
  /**
   * 此刻接管整屏、且**声明了** `contextmenu` 的那一屏：它这一拍收右键会不会有反应
   * （`UiScreen.contextmenuLive`，没给就当有）。`null` = 没有这样的屏。
   */
  readonly overlayContextmenu: boolean | null;
  /** 通用取消梯子的输入（与 `cancelTopPanel()` 同一份）*/
  readonly cancel: CancelSnapshot;
  /** 目标拾取可以取消（`pick.cancellable`；目标必选的那种右键无效）*/
  readonly pickCancellable: boolean;
  /** 棋盘上有小地图标记（右键清掉它，梯子之外的最后一档）*/
  readonly minimapMarker: boolean;
}

/**
 * 这一拍右键**有没有东西可取消/可跳过**。「取消」钮只在它为真时露出来。
 *
 * 与 `main.ts` 的 `contextmenu` 处理一一对应：
 *   ① 過路費闪 → ② 声明了 `contextmenu` 的整屏（**整屏在就只看它**，下面不走）
 *   → ③ `cancelLayerOf` 梯子 → ④ 棋盘上的小地图标记。
 */
export function rightClickMeaningful(s: RightClickSnapshot): boolean {
  if (s.tollFlash) return true;
  if (s.overlayContextmenu !== null) return s.overlayContextmenu;
  const layer = cancelLayerOf(s.cancel);
  // 目标必选（`[0x48c594]` bit3）的拾取：右键这一拍被吃掉但什么都不做
  if (layer === 'pick') return s.pickCancellable;
  if (layer !== null) return true;
  return s.cancel.screen === 'game' && s.minimapMarker;
}

// ============================================================
//  「此刻长按算不算右键」—— 金额条那几屏不算
// ============================================================

/**
 * 画着**金额条 / 数字键盘**的那几层（`cancelLayerOf` 的口径）：
 *   · `amountPage`  —— 通用填数窗 `fcn_00453544`（棋盘对话框里的填数页；貸款屏借/還、
 *     特別融資、上市企業認購都开这一扇）；
 *   · `stockAmount` —— 同一扇填数窗，借股市屏开的（買進 / 賣出股数）；
 *   · `atm`         —— 銀行 ATM（`Panel.mkf` #24，自己的数字键盘 + 拖动金额栏）。
 * 整屏（`UiScreen`）那一类由各屏自己报 `amountEntry`（公佈欄的出价填数页、拍賣的加价钮）。
 */
export const AMOUNT_ENTRY_LAYERS: ReadonlySet<CancelLayer> = new Set<CancelLayer>(['amountPage', 'stockAmount', 'atm']);

export interface LongPressSnapshot {
  /** 接管整屏的那一屏此刻在不在填金额（`UiScreen.amountEntry`，没给就当不在）；`null` = 没有整屏 */
  readonly overlayAmountEntry: boolean | null;
  /** 通用取消梯子的输入（与 `cancelTopPanel()` 同一份）*/
  readonly cancel: CancelSnapshot;
}

/**
 * 这一次落指，**长按算不算右键**。
 *
 * ★ 需求方 2026-09-24：「在金额条界面就不要用长按取消逻辑了，反正还有按钮」——
 *   金额条要按住拖，手指在条上一停过 500 ms 就被当成右键、把整页填数窗取消掉。
 *   这几屏上长按**整个关掉**（不是只在条上关）：按多久都只是点 / 拖；
 *   取消走「取消」钮（`rightClickMeaningful` 不受影响，钮照样露着）或 ESC。
 *
 * ⚠️ 只影响触屏手势；桌面鼠标右键一行不变。
 */
export function longPressAllowed(s: LongPressSnapshot): boolean {
  if (s.overlayAmountEntry === true) return false;
  const layer = cancelLayerOf(s.cancel);
  return layer === null || !AMOUNT_ENTRY_LAYERS.has(layer);
}

/** 这台设备是不是触屏（粗指针或有触点）—— 只有触屏才露「取消」钮 */
export function isTouchDevice(
  win: { matchMedia?: (q: string) => { matches: boolean }; navigator?: { maxTouchPoints?: number } },
): boolean {
  if (coarseQuery(win)?.matches === true) return true;
  return (win.navigator?.maxTouchPoints ?? 0) > 0;
}

/**
 * ★ 第十九份（iPhone 发烫）：`isTouchDevice` 每帧都问（`syncTouchCancel`），而每次
 *   `matchMedia()` 都新建一个查询对象。`MediaQueryList.matches` 本身是**活的**（接上 / 拔掉
 *   键盘触控板时会跟着变），所以缓存查询对象、每次读它的 `matches`，结果与先前逐次新建完全一样。
 */
const coarseQueries = new WeakMap<object, { matches: boolean } | null>();
function coarseQuery(win: { matchMedia?: (q: string) => { matches: boolean } }): { matches: boolean } | null {
  let q = coarseQueries.get(win);
  if (q === undefined) {
    q = win.matchMedia?.('(pointer: coarse)') ?? null;
    coarseQueries.set(win, q);
  }
  return q;
}

// ============================================================
//  「取消」钮放哪
// ============================================================

/** 页面上的矩形（CSS 像素）*/
export interface CssRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CancelButtonPlacement {
  /** 舞台下方黑边 / 舞台右侧黑边 / 压在棋盘右下角 */
  readonly mode: 'bottom' | 'side' | 'corner';
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 黑边里的钮：横放 88×44（Apple HIG 最小触控高 44pt）*/
const WIDE = { w: 88, h: 44 } as const;
/**
 * 侧边竖放：宽至多 64、至少 30，高 96。
 * ★ 横放 iPad 的侧边黑边通常只有 40 来 px（1180×820 → 43、1194×834 → 41，
 *   见 `stage.ts` 的放大规则）⇒ 宽度下限压到 30，靠 96 的高度把触控面积补回来。
 */
const SIDE_MAX_W = 64;
const SIDE_MIN_W = 30;
const SIDE_H = 96;
/** 侧边钮两侧至少各留这么多 */
const SIDE_PAD = 3;
/** 压在舞台上的小钮 */
const CORNER = { w: 60, h: 36 } as const;
/** 离舞台 / 视口边的留白 */
const GAP = 8;
/** 棋盘区的右缘（舞台坐标 x = 439，右边是側欄/小地图）@source stage.ts `LAYOUT.board` */
const BOARD_RIGHT = 439 / 640;

/**
 * @param view  画布在页面上的矩形（黑边就是它减去舞台）
 * @param stage 640×480 舞台放大后在页面上的矩形
 */
export function cancelButtonPlacement(view: CssRect, stage: CssRect): CancelButtonPlacement {
  const viewRight = view.left + view.width;
  const viewBottom = view.top + view.height;
  const stageRight = stage.left + stage.width;
  const stageBottom = stage.top + stage.height;

  // ① 竖屏手机：舞台下方的黑边（贴着舞台右下，拇指够得着；左下角让给「回報問題」）
  const below = viewBottom - stageBottom;
  if (below >= WIDE.h + 2 * GAP) {
    const right = Math.min(stageRight, viewRight - GAP);
    return {
      mode: 'bottom',
      left: Math.max(view.left + GAP, right - WIDE.w - GAP),
      top: stageBottom + Math.min(16, (below - WIDE.h) / 2),
      width: WIDE.w,
      height: WIDE.h,
    };
  }
  // ② 横放的 iPad / 手机：舞台右侧的黑边（竖着放，贴近右下）
  const beside = viewRight - stageRight;
  if (beside >= SIDE_MIN_W + 2 * SIDE_PAD) {
    const width = Math.min(SIDE_MAX_W, beside - 2 * SIDE_PAD);
    const height = Math.min(SIDE_H, view.height - 2 * GAP);
    return {
      mode: 'side',
      left: stageRight + (beside - width) / 2,
      top: Math.max(view.top + GAP, stageBottom - height - 3 * GAP),
      width,
      height,
    };
  }
  // ③ 没黑边：半透明小钮压在棋盘区右下角（小地图左边，避开左下的「回報問題」）
  return {
    mode: 'corner',
    left: stage.left + stage.width * BOARD_RIGHT - CORNER.w - GAP,
    top: stageBottom - CORNER.h - GAP,
    width: CORNER.w,
    height: CORNER.h,
  };
}

// ============================================================
//  DOM 胶水
// ============================================================

/** 本模块自己派出的鼠标事件（给「吞掉系统长按菜单」那道闸认）*/
const synthetic = new WeakSet<Event>();
/** 拖动中（派过按下、还没派抬起）—— 只给 `buttons` 字段用 */
let held = false;

/** 派一个鼠标事件到画布上（`mouseup` / `mousemove` 冒泡到 window，与真鼠标同路）*/
export function dispatchMouse(
  target: EventTarget,
  type: 'mousemove' | 'mousedown' | 'mouseup' | 'click' | 'contextmenu',
  x: number,
  y: number,
): void {
  const right = type === 'contextmenu';
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: right ? 2 : 0,
    buttons: type === 'mousedown' || (type === 'mousemove' && held) ? 1 : 0,
    view: window,
  });
  if (type === 'mousedown') held = true;
  if (type === 'mouseup') held = false;
  synthetic.add(e);
  target.dispatchEvent(e);
}

/**
 * 画布上的触摸 → 鼠标事件。
 *
 * ★ `touchstart` 一律 `preventDefault`（非 passive）：浏览器就不再自己合成
 *   mousedown/mouseup/click（那一套没有长按、也不认拖），也不滚动/缩放/弹放大镜。
 *   之后的鼠标事件全由状态机派，**与鼠标同一批监听**收。
 * ★ Android Chrome 长按会自己发一个 `contextmenu`：手指在屏上时那一个吞掉
 *   （捕获相、只认不是本模块派的），不然长按一次会取消两层。
 */
export function bindTouchGestures(
  canvas: HTMLCanvasElement,
  opts: {
    /** 落指那一刻问一次：长按算不算右键（金额条那几屏不算，见 `longPressAllowed`）*/
    readonly longPress?: () => boolean;
    readonly now?: () => number;
  } = {},
): TouchGesture {
  const now = opts.now ?? (() => performance.now());
  const longPress = opts.longPress ?? (() => true);
  const g = new TouchGesture();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTouchAt = -Infinity;

  const run = (out: readonly GestureOut[]): void => {
    for (const o of out) {
      if (o.kind === 'rightClick') dispatchMouse(canvas, 'contextmenu', o.x, o.y);
      else if (o.kind === 'move') dispatchMouse(canvas, 'mousemove', o.x, o.y);
      else if (o.kind === 'down') dispatchMouse(canvas, 'mousedown', o.x, o.y);
      else if (o.kind === 'up') dispatchMouse(canvas, 'mouseup', o.x, o.y);
      else dispatchMouse(canvas, 'click', o.x, o.y);
    }
  };
  const arm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const at = g.deadline();
    if (at === null) return;
    timer = setTimeout(() => {
      timer = null;
      run(g.due(now()));
      arm();
    }, Math.max(0, at - now()));
  };
  const each = (e: TouchEvent, fn: (t: Touch) => GestureOut[]): void => {
    if (e.cancelable) e.preventDefault();
    lastTouchAt = now();
    for (const t of Array.from(e.changedTouches)) run(fn(t));
    arm();
  };

  const lo: AddEventListenerOptions = { passive: false };
  canvas.addEventListener(
    'touchstart',
    (e) => each(e, (t) => g.start(t.identifier, t.clientX, t.clientY, now(), longPress())),
    lo,
  );
  canvas.addEventListener('touchmove', (e) => each(e, (t) => g.move(t.identifier, t.clientX, t.clientY, now())), lo);
  canvas.addEventListener('touchend', (e) => each(e, (t) => g.end(t.identifier, t.clientX, t.clientY, now())), lo);
  canvas.addEventListener('touchcancel', (e) => each(e, (t) => g.cancel(t.identifier)), lo);
  canvas.addEventListener(
    'contextmenu',
    (e) => {
      if (synthetic.has(e)) return;
      if (!g.active() && now() - lastTouchAt > 1_000) return; // 真鼠标的右键：照旧放行
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
  return g;
}
