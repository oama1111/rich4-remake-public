/*
 * 替玩家把**系统鼠标指针**挪到按钮上（试玩3 #2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这是**原版行为**：原版在几个时刻会替玩家把系统指针挪到按钮上。
 *   `SetCursorPos` 的导入 IAT 在 `0x0046231c`，全 exe 一共 **9 处**
 *   `call dword ptr cs:[0x46231c]`（另有 1 处跳转桩 `0x004610a8`）：
 *
 * | 调用点 | 哪一扇窗 / 哪一拍 | 落点 | 本引擎 |
 * |---|---|---|---|
 * | `0x0040107b` | 键盘钩子：方向键把**虚拟光标**挪 ±10 | `(x+0xa, y)` | T-086 已记「不挪用户光标」，本次不动 |
 * | `0x0041361d` / `0x0041363d` | 镜头已顶到屏幕边：把指针夹回 `0` / `0x27f` | `(0, y)` / `(0x27f, y)` | 不是按钮，本次不做 |
 * | **`0x00418db0`** | ★ **回合开始、GO 鈕上场等真人掷骰** | `([0x475284]+0x2e, [0x475288]+0x22)` | **本模块实现** |
 * | **`0x0043fb54`** | ★ **「請選擇設施類別」浮窗**的 `WM_CREATE` —— 它自己 `push 0x465289` = `請選擇設施類別`（`pickFacilityKind` 那一串）| `(220,320)` | **本模块实现** |
 * | **`0x0043ffc2`** | ★ 同一扇窗的**第二支**（前面 `push 0x465289` 也在，`0x43fb37 jmp 0x43ff3d` 是它的兄弟支）| `(220,320)` | **本模块实现**（与上面同一屏、同一个落点）|
 * | **`0x00440355`** | ★ **研究所選項目**面板（窗口过程 `0x4402d7`）的 `WM_CREATE` | `(220,320)` | **本模块实现** |
 * | **`0x004467de`** | ★ **遥控骰子小盘**的 `WM_CREATE`（`Q-PICK-2`）：窗口过程里 `0x446814 cmp eax,0x13a / 0x44681f cmp eax,0x157`、6 行 `add ebx,0x28` 与 `[0x48c598]` 那个「哪一颗」全局——与 `dice-choose.ts` 的命中区逐项对得上 | `(220,320)` | **本模块实现** |
 * | **`0x00453719`** | ★ **YES/NO 訊息框（買地那一扇 `fcn_00440ba8`）的 `WM_CREATE`** | `([0x48cac4]+0x16, [0x48cac8]+0x16)` | **本模块实现** |
 *
 * ## 两处已实现的取证
 *
 * ### ① 回合开始等掷骰 → GO 鈕（VA 0x00418db0）
 *
 * 回合状态机的跳表是 `0x418c3d`（`jmp dword ptr [eax*4 + 0x418c3d]`，
 * `0x00418d81`；`dump 0x418c3d 6 4` = `0x418d88 / 0x418d99 / 0x418dc6 /
 * 0x418e7a / 0x418e7a / 0x418dc6`）。**相位 1** = `0x418d99`：
 *
 * ```asm
 * 00418d99  call 0x4196f1              ; [0x46cafd] = 1 + 画 GO 鈕（=「GO 鈕上场」）
 * 00418d9e  mov  eax, [0x475288]       ; ← GO 鈕的 **y**（go-button.ts 的 @source）
 * 00418da3  add  eax, 0x22             ; ★ y + 0x22
 * 00418da6  push eax
 * 00418da7  mov  eax, [0x475284]       ; ← GO 鈕的 **x**
 * 00418dac  add  eax, 0x2e             ; ★ x + 0x2e
 * 00418daf  push eax
 * 00418db0  call dword ptr cs:[0x46231c]   ; SetCursorPos
 * ```
 *
 * ★ **落点按「用的是哪个全局」定，不靠猜压栈顺序**：`[0x475284]` 是 GO 鈕的 x、
 *   `[0x475288]` 是它的 y（`go-button.ts` 顶部的 `@source` 已取证：拖动写
 *   `0x00418aa8 [0x475284] = 鼠标位移 x`、贴图 `0x004172a6 push [0x475288] /
 *   push [0x475284]`）。所以 **x 加 0x2e、y 加 0x22**，两个立即数各归各的轴。
 * ★ 「相位 1 就是 GO 鈕在场」也**不是**从跳转逻辑推的：同一条基本块第一步
 *   `call 0x4196f1` 干的就是 `mov byte [0x46cafd], 1` + `0x417191(1)`，
 *   而 `0x46cafd` 全 exe 只有这一处置 1（另一处 `0x4017bc` 是初始化），
 *   `0x417191` 是**画 GO 鈕**那一段（它用 GO 的图集与位置：
 *   `0x004171d6 cmp eax, [0x475284]`、`0x0041724d` 起按
 *   `player+0x38/+0x39` 选图 —— 与 `dialog.ts` 的 `goImageOf` 同一张判据表）。
 *   ⇒ 「GO 鈕上场」这一拍就是原版挪指针的那一拍。
 *
 * ### ② YES/NO 訊息框（VA 0x00453719）
 *
 * 買地那一路走 `fcn_00440ba8`（通用詢問框）→ `_rich4_ui_yesno`（`0x453a32`）
 * → 窗口过程 `0x45367e`（`0x00453b0c push 0x45367e`）。它的 `WM_CREATE`
 * （`0x004536b4 je 0x4536f6`，`cmp eax, 0x401`）里：
 *
 * ```asm
 * 00453707  mov eax, [0x48cac8]        ; ← 框的 **top**（= 中心 y − h/2）
 * 0045370c  add eax, 0x16             ; ★ top + 0x16
 * 00453710  mov eax, [0x48cac4]        ; ← 框的 **left**（= 中心 x − w/2）
 * 00453715  add eax, 0x16             ; ★ left + 0x16
 * 00453719  call dword ptr cs:[0x46231c]   ; SetCursorPos
 * ```
 *
 * `[0x48cac4]/[0x48cac8]` 是**框左上角**，由 `0x453a32` 自己算出来：
 * `0x00453a6f mov ebx,[esp+0x14] / 0x00453a73 sub ebx, edx(w/2) /
 * 0x00453a75 mov [0x48cac4], ebx`，紧接着 `0x00453a8d..0x00453aaa` 用
 * `+w` / `+h` 补出 `[0x48cacc]`（右）与 `[0x48cad0]`（下）—— 典型的
 * left/top/right/bottom 矩形；`0x00453aaf push 0x48cac4 / call 0x451e7e`
 * 把这个矩形交给窗口，`0x00453aeb call 0x4563f5(面, 图, left, top)` 按它贴图。
 * 那个「图」是 `0x00453a5c call 0x450441(Data.mkf, 0x1b8, 0, 0)` 读回来的
 * **YES/NO 控件**（`gameui.ts` 的 `YESNO_RESOURCE = 0x1b8`、`YESNO_SIZE = 96×48`、
 * `YESNO_CENTER_SCREEN = (0xdc, 0x140)`）；`x0 = 中心 − w/2`、`y0 = 中心 − h/2`
 * （`0x00453a69 / 0x00453a7b`）= **(172, 296)**，于是落点 = **(194, 318)** ——
 * 正落在 YES 那半块（172..220 × 296..344）里。
 *
 * ## 为什么要有这个模块
 *
 * 浏览器**做不到**（网页不能挪系统指针），桌面壳可以（Tauri 2
 * `Window::set_cursor_position`，见 `desktop/src-tauri/src/lib.rs` 的 `warp_cursor`）。
 * 所以这里只算「**该不该挪、挪到哪**」，真的挪交给注入进来的 `warp` 端口 ——
 * 浏览器那边注入的是空操作（`host.ts` 的 `warpCursor`）。
 *
 * ★ C-ARC-2：这里一条规则都没有，只有「原版在哪一拍把指针放到哪个点」。
 * ★ 挪的是**系统指针**、按窗口逻辑坐标算 —— 与原版那套 640×480 屏幕坐标之间
 *   隔着一次「舞台 → 页面」的换算，就是 `main.ts` 的 `eventToStage`
 *   反着走一遍（见 `stageToClient`）。
 */

import { YESNO_CENTER_SCREEN, YESNO_SIZE } from './gameui.ts';

/** 屏幕（640×480 定屏）坐标 —— 与原版那一套同一套 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * GO 鈕那一处落点相对 **GO 鈕左上角** 的偏移。
 *
 * @source VA 0x00418dac `add eax, 0x2e`（x 那一项）、0x00418da3 `add eax, 0x22`（y 那一项）。
 * ⚠️ 它**不是** GO 鈕的正中心（图 72×67 ⇒ 中心偏移 (36,34)）—— 原版写的是这两个
 *   立即数，照抄，不「改良」。
 */
export const GO_WARP_OFFSET = { x: 0x2e, y: 0x22 } as const;

/**
 * YES/NO 那一处落点相对 **控件左上角** 的偏移。
 *
 * @source VA 0x00453710 / 0x00453715 —— 两条都是 `add eax, 0x16`，
 *   也就是「左上角再往里 22 px」（x、y 同一个数，所以与压栈顺序无关）。
 */
export const YESNO_WARP_OFFSET = { x: 0x16, y: 0x16 } as const;

/**
 * YES/NO 控件左上角（**屏幕**坐标）。
 *
 * @source 中心与尺寸是既有的带 `@source` 常量（`gameui.ts` 的
 *   `YESNO_CENTER_SCREEN = (0xdc, 0x140)`、`YESNO_SIZE = 96×48`）；
 *   原版那一支算的也是 `x0 = 中心 − w/2`、`y0 = 中心 − h/2`
 *   （VA 0x00453a69 / 0x00453a7b）⇒ **(172, 296)**。
 */
export const YESNO_TOP_LEFT: ScreenPoint = {
  x: YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2,
  y: YESNO_CENTER_SCREEN.y - YESNO_SIZE.h / 2,
};

/**
 * GO 鈕那一处落点 —— `([0x475284] + 0x2e, [0x475288] + 0x22)`。
 *
 * @param goScreen GO 鈕左上角，**屏幕**坐标。⚠️ `goButton.position()` 给的是
 *   **棋盘画布**坐标，先过一次 `boardToScreen()`（画布原点在屏幕 (0,40)）。
 */
export function goWarpTarget(goScreen: ScreenPoint): ScreenPoint {
  return { x: goScreen.x + GO_WARP_OFFSET.x, y: goScreen.y + GO_WARP_OFFSET.y };
}

/** YES/NO 那一处落点 —— 框左上 + (0x16,0x16) */
export function yesNoWarpTarget(): ScreenPoint {
  return {
    x: YESNO_TOP_LEFT.x + YESNO_WARP_OFFSET.x,
    y: YESNO_TOP_LEFT.y + YESNO_WARP_OFFSET.y,
  };
}

/**
 * 那**四处固定落点**共用的目标点 `(0xdc, 0x140)` = **(220, 320)**。
 *
 * @source 四处 `WM_CREATE` 里都是 `push 0x140 / push 0xdc / call SetCursorPos`
 *   （`0x0043fb4a..54`、`0x0043ffb8..c2`、`0x0044034b..55`、`0x004467d4..de`）。
 *   ★ 压栈顺序是「先 push y=0x140、后 push x=0xdc」（Win32 的 `SetCursorPos(x, y)`
 *   是 stdcall，右到左），与 YES/NO 那一处同一个读法。
 *   ⚠️ 这个点**不是**任何一颗控件的中心（`0xdc,0x140` = 屏幕正中偏下），
 *   四处照抄，不「改良」成「控件中心」。
 */
export const FIXED_WARP_TARGET: ScreenPoint = { x: 0xdc, y: 0x140 };

/** 「这一拍要不要挪」看的几件事 —— 每一件都对应 exe 里一处 `SetCursorPos` */
export interface WarpMoments {
  /** 轮到真人、GO 鈕在场等他掷骰（`main.ts` 的 `awaitingHumanRoll()`）*/
  readonly awaitingRoll: boolean;
  /** 棋盘上盖着**两个选项**的 YES/NO 框（`dialog.ts` 的 `usesYesNo`）*/
  readonly yesNoBox: boolean;
  /** 「請選擇設施類別」浮窗开着（`facility-picker.ts` 的 `active()`）*/
  readonly facilityPicker: boolean;
  /** 研究所選項目面板开着（`research-screen.ts`）*/
  readonly research: boolean;
  /** 遥控骰子小盘开着（`main.ts` 的 `dicePick`）*/
  readonly dicePick: boolean;
}

/** 什么都没发生的那一拍 */
export const NO_MOMENTS: WarpMoments = {
  awaitingRoll: false,
  yesNoBox: false,
  facilityPicker: false,
  research: false,
  dicePick: false,
};

export interface WarpTarget extends ScreenPoint {
  /** 是哪一条时机 —— 只给日志与测试用 */
  readonly reason: 'go' | 'yesNo' | 'facilityPicker' | 'research' | 'dicePick';
}

/**
 * 这一拍该不该挪、挪到哪（纯函数）。
 *
 * ★ 原版是**边沿触发**的：GO 鈕那一处在**相位 1 进入时**执行一次；
 *   YES/NO 那一处在窗口的 **`WM_CREATE`** 里执行一次。所以这里也只在
 *   「上一拍没有、这一拍有」时才挪 —— 否则每帧都会把玩家的手拽回去。
 * ★ 两件事理论上不会同时成立（框在场上时 GO 鈕根本不画：
 *   `main.ts` 的 `drawGameStage` 里 `dlg !== null` 就不画 GO）。真同时成立时
 *   按**框**算：框盖在棋盘上，指针该进框。
 *
 * @param now 这一拍的时机
 * @param prev 上一拍的时机
 * @param goScreen GO 鈕左上角（**屏幕**坐标）
 */
export function cursorWarp(
  now: WarpMoments,
  prev: WarpMoments,
  goScreen: ScreenPoint,
): WarpTarget | null {
  if (now.yesNoBox && !prev.yesNoBox) return { ...yesNoWarpTarget(), reason: 'yesNo' };
  // ★ 那四处固定落点（設施類別窗 / 研究所 / 遥控骰子小盘）—— 每一处的窗口
  //   `WM_CREATE` 都只执行一次，所以同样按「上一拍没有、这一拍有」的边沿触发。
  //   四者互斥（都是浮窗），按登记表里「谁在前谁接管」的次序判，与别的屏一致。
  if (now.facilityPicker && !prev.facilityPicker) {
    return { ...FIXED_WARP_TARGET, reason: 'facilityPicker' };
  }
  if (now.research && !prev.research) {
    return { ...FIXED_WARP_TARGET, reason: 'research' };
  }
  if (now.dicePick && !prev.dicePick) {
    return { ...FIXED_WARP_TARGET, reason: 'dicePick' };
  }
  if (now.awaitingRoll && !prev.awaitingRoll) {
    return { ...goWarpTarget(goScreen), reason: 'go' };
  }
  return null;
}

// ============================================================
//  舞台 → 页面逻辑坐标（= 系统指针要的那个坐标）
// ============================================================

/** `stageMetrics()` 的结果，这里只要这三个数 */
export interface StageView {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** 画布在页面里的位置与像素比（`measureCanvas` 量出来的） */
export interface CanvasBox {
  readonly left: number;
  readonly top: number;
  /** 设备像素 / CSS px（x 方向） */
  readonly dprX: number;
  /** 同上（y 方向） */
  readonly dprY: number;
}

/**
 * 量一块画布在页面里的位置与像素比。
 *
 * ★ 为什么不能假定 `left/top = 0`：调试抽屉（`#panel`）在右边占 300 px，
 *   画布是 flex 项，起点会跟着走。
 */
export function measureCanvas(canvas: {
  readonly width: number;
  readonly height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  getBoundingClientRect(): { left: number; top: number };
}): CanvasBox {
  const r = canvas.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    dprX: canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1,
    dprY: canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1,
  };
}

/**
 * 舞台（640×480）坐标 → 页面逻辑坐标（CSS px = 窗口客户区逻辑坐标）。
 *
 * ★ 这是 `main.ts` 的 `eventToStage()` 的**逆**：那一步做的是
 *   `toStage((e.clientX − left) × dpr, …, metrics)`，也就是
 *   `舞台 = (页面 − left) × dpr / scale − offset`。反解出来就是下面这两行。
 *   Rust 那边再乘一次窗口缩放比就得到物理坐标（`logical_to_physical`）。
 */
export function stageToClient(p: ScreenPoint, m: StageView, box: CanvasBox): ScreenPoint {
  return {
    x: box.left + (p.x * m.scale + m.offsetX) / box.dprX,
    y: box.top + (p.y * m.scale + m.offsetY) / box.dprY,
  };
}

// ============================================================
//  每帧一次的那一条
// ============================================================

/** 一帧里要看的东西 */
export interface CursorWarpFrame {
  /** 「轮到真人、GO 鈕在场」 */
  readonly awaitingRoll: boolean;
  /** 「棋盘上盖着两个选项的 YES/NO 框」 */
  readonly yesNoBox: boolean;
  /** 「請選擇設施類別」浮窗开着 */
  readonly facilityPicker: boolean;
  /** 研究所選項目面板开着 */
  readonly research: boolean;
  /** 遥控骰子小盘开着 */
  readonly dicePick: boolean;
  /** GO 鈕左上角（**屏幕**坐标） */
  readonly goScreen: ScreenPoint;
  /** 当前舞台放大/居中（`main.ts` 的 `currentMetrics()`） */
  readonly metrics: StageView;
  /** 画布在页面里的位置与像素比（`measureCanvas(canvas)`） */
  readonly canvas: CanvasBox;
}

export interface CursorWarper {
  /**
   * 每帧调一次。
   * @returns 真的挪了就是落点（**屏幕**坐标）+ 时机；没挪返回 `null`（给测试看）
   */
  update(): WarpTarget | null;
}

/**
 * 造一条「每帧看一眼，该挪就挪」的线。
 *
 * @param warp 真的去挪系统指针的端口（桌面版是 `host.ts` 的 `warpCursor`，
 *   浏览器版它自己就是空操作）
 * @param readFrame 取这一帧的时机与几何
 */
export function createCursorWarper(
  warp: (x: number, y: number) => void,
  readFrame: () => CursorWarpFrame,
): CursorWarper {
  let prev: WarpMoments = NO_MOMENTS;
  return {
    update: () => {
      const f = readFrame();
      const now: WarpMoments = {
        awaitingRoll: f.awaitingRoll,
        yesNoBox: f.yesNoBox,
        facilityPicker: f.facilityPicker,
        research: f.research,
        dicePick: f.dicePick,
      };
      const target = cursorWarp(now, prev, f.goScreen);
      prev = now;
      if (target === null) return null;
      const at = stageToClient(target, f.metrics, f.canvas);
      warp(at.x, at.y);
      return target;
    },
  };
}
