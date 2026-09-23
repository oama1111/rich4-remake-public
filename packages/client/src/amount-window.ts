/*
 * 通用填数窗（`fcn_00453544`）的**面板** —— 纯版面 + 绘制
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 外部审查 B-5 / B-6 的原始抱怨是「借款/出价走的是自造按钮条，原版是数字键盘窗」。
 * 键盘与语义在 `amount-keys.ts`（两张表都逐项对过 exe），几何在同一个文件的
 * `AMOUNT_WINDOW` / `AMOUNT_KEY_RECTS`。本模块只做**最后一步：把它画出来**。
 *
 * ## 关键发现（2026-09-16，目视 + 汇编双向确认）
 *
 * `Panel.mkf` #0x15 的**图 0 就是画好的整块面板**（128×192）：
 *
 * ```text
 * ┌────────────────────────┐
 * │  ┌──────────────────┐  │  ← 金额显示（绿底）：本引擎只把数字贴上去
 * │  └──────────────────┘  │
 * │  ┌──────────────────┐  │  ← 指针条（33 格，见 AMOUNT_BAR_*）
 * │  └──────────────────┘  │
 * │  [  MAX  ] [   ↵   ]   │  ← 图 2 / 图 3
 * │  [ C ] [ 0 ] [  ←  ]   │  ← 图 4 / 图 5 / 图 6
 * │  [ 7 ] [ 8 ] [ 9 ]     │  ← 图 7..9
 * │  [ 4 ] [ 5 ] [ 6 ]     │  ← 图 10..12
 * │  [ 1 ] [ 2 ] [ 3 ]     │  ← 图 13..15
 * └────────────────────────┘
 * ```
 *
 * ⇒ **面板不需要逐键拼**（那 15 张 33×17 的小图是**按下态**用的，
 *   `loc_00452fce` 按 `AMOUNT_KEY_RECTS` 把第 `序号` 张盖上去）。
 *   要画的是「图 0 整块 + 金额数字」。
 *
 * ## 数字的位置（汇编逐条推出来，不是目测）
 *
 * `fcn_0045297e` 从**末位**往前贴，每贴一张 `sub esi, 0xc`（= 字距 12），
 * 最多 9 位（`cmp edi, 9 / jge`）：
 *
 * ```asm
 * 00452a0e  mov al, byte [0x48caac + ebx]      ; 金额字符串（十进制）
 * 00452a13  sub eax, 0x20                      ; '0'(0x30) → 0x10 …
 * 00452a16  push eax                           ;  → 图 = 字符 + 0x14
 * 00452a1d  call fcn_00456512(屏, 图, x, y, …)
 * ```
 *
 * 而 `fcn_00456512` 的两个落点参数是 `[ebp+0x14]`（x，减锚点 `[esi+4]`）
 * 与 `[ebp+0x18]`（y，减锚点 `[esi+6]`）—— 锚点在这张字库里全是 0，
 * 所以 (sub esi, 0xc) 的最后一张落在 `valueAt.dx`，倒数第 k 张落在
 * `valueAt.dx + k×0xc`。
 *
 * ★ 2026-09-19 订正：先前这里写着「落点其实是 x=+0x40、y=+0x21」并据此另列 `valueAtChar`，
 *   还把图号记成「字符 − 0x2b」（= 图 5..14，那是 33×17 的**键帽按下态**）。两条都是误读，
 *   整支 `fcn_0045297e` 重读后的结论见 `AMOUNT_WINDOW.valueAt` 与 `amountCharImage`。
 *
 * ## 比例条（同一支函数的后半，`0x452a64` 起）
 *
 * ```asm
 * 00452a64  blit(屏, 图集#0x15, 图 1, 窗x+0xa, 窗y+0x2a)        ; 先整条贴**暗**条（图 1，108×12）
 * 00452a92  esi = i ; cmp esi,-1 / je 跳过                        ; 值为 0 ⇒ 整条都暗
 * 00452a9b  copy(屏 ← 干净面板[0x48caa0], 目标(窗x+0xa, 窗y+0x2a),
 *                源(0xa, 0x2a), 宽 = byte[0x47e725 + i], 高 0xc)   ; 再把左边那一截还原成面板自带的**亮**条
 * ```
 * 其中 `i = trunc( float32(值 / 上限) × 33.0 )`（`0x4529aa fild/fdivp/fstp dword`、
 * `0x4529c2 fmul [0x466218]`= 33.0、`0x457dbc` 把舍入控制设成截断）。
 */

import type { Sprite } from './assets.ts';
import {
  AMOUNT_WINDOW,
  AMOUNT_DIGIT_MAX,
  amountFromBarX,
  amountWindowHit,
  type AmountKey,
} from './amount-keys.ts';
// ★ W-62：画的位置与命中框必须**同源** —— 命中框走 `boardRect()`（见 `dialog.ts`），
//   画这一半先前直接拿屏幕坐标往棋盘画布上画，于是整块面板低了 `LAYOUT.board.y`（40 px）。
import { boardRect } from './gameui.ts';
import { drawSprite, drawSpriteRegion } from './hd-stage.ts';

/** 取图 —— 与 `UiScreenEnv.sprite` / `bank-screen.ts` 的 `BankSprite` 同一个签名 */
/**
 * 取图出口 —— 与 `gameui.ts` 的 `SpriteFn` **同一形状**（`Data.mkf` / `Panel.mkf`）。
 * 这里不复用那个类型是为了不把 `gameui.ts` 拖进本模块的依赖；两者只要形状一致
 * 就能互相赋值（本模块只用 `Panel.mkf`）。
 */
export type AmountSprite = (
  archive: 'Data.mkf' | 'Panel.mkf',
  resource: number,
  index: number,
) => Sprite | null;

/** 数字表的资源号（= 面板图本身）@source `push 0x15` */
export const AMOUNT_RESOURCE = AMOUNT_WINDOW.panelResource;

/**
 * 一个十进制字符用哪张图。
 *
 * ⚠️ **不要照抄汇编那半句**：`loc_00452a0e-16` 写的是
 * `mov al, byte [buf+ebx] / sub eax, 0x20`，看似「图号 = 字符 − 0x20」；
 * 但同一支后面还有 `mov eax,[0x48caa8] / call fcn_00456512`，
 * 而 `fcn_00456512` 的**图参数**又被它当成「表基址」算了一遍
 * （`lea esi,[eax*4] / lea esi,[esi+eax*8] / lea esi,[esi+eax+0xc]`）
 * —— 那是在**自己拼图素表项的内存地址**（`read_mkf` 返回的是文件本体，
 * 表项从文件偏移 `0xc` 起、每项 12 字节），不是图号。照抄会得到 39 这种越界值。
 *
 * ⇒ 本函数用**目视核过的事实**（`assets-clean/Panel/0021_0NN.png`）：
 * 图 4 = 「C」、图 5 = 「0」、图 13 = 「1」、图 14 = 「2」、图 15 = 「3」、
 * 其余数字在 6..12 之间。成立的换算是 **图号 = `ch − 0x2c`**：
 * `'C'`(0x43)→4、`'0'`(0x30)→5、`'1'`(0x31)→13、`'9'`(0x39)→14。
 * （`'0'`..`'9'` 排成 `5,13,14,15,10,11,12,7,8,9` —— 与 `0x47e714` 那张
 * 字符表逐项吻合，也与 `AMOUNT_SLOT_BY_ID` 的数字映射吻合。）
 */
export function amountCharImage(ch: string): number {
  // 只认 '0'..'9'（金额栏里只有这些）
  const code = ch.charCodeAt(0);
  if (code < 0x30 || code > 0x39) return -1;
  // @source 0x00452a09 `mov al,[ebx+0x48caac]` / 0x00452a0f `sub eax,0x20` —— 图 = 字符 − 0x20
  //   ⇒ '0'..'9' = 图 16..25：`Panel.mkf` #0x15 里那十张 **9×19 的液晶字模**
  //   （图 2..15 是 33×17 的键帽按下态，不是字）。
  return code - 0x20;
}

/**
 * 金额数字的落点 —— 从右往左排，最多 `AMOUNT_DIGIT_MAX` 位。
 *
 * @param value 面板内坐标（相对窗左上角）
 * @returns 每个字符的 `{ch, image, x, y}`；超过 9 位只画**后** 9 位
 *
 * ★ 为什么取后 9 位：原版那个缓冲 `[0x48caac]` 本身就**不会被写超 9 位**
 *   （`loc_00453189` 的 `cmp eax, 9 / jge loc_0045310a` 直接拒绝那一次按键），
 *   所以「取后 9 位」只是把同一条上限在显示侧再表达一次，不会与规则打架。
 */
export function amountDigits(
  value: number,
  xLast = AMOUNT_WINDOW.valueAt.dx,
  y = AMOUNT_WINDOW.valueAt.dy,
): { ch: string; image: number; x: number; y: number }[] {
  const text = String(Math.max(0, Math.trunc(value)));
  // 超 9 位取**后** 9 位 —— 只是把原版那条 9 位上限在显示侧再表达一次
  const shown = text.slice(-AMOUNT_DIGIT_MAX);
  const out: { ch: string; image: number; x: number; y: number }[] = [];
  // ★ 右对齐：末位落在 xLast，往前每一位 −字距 @source 0x00452a28 `sub esi, 0xc`
  for (let i = 0; i < shown.length; i++) {
    const ch = shown[i] ?? '';
    if (ch === '') continue;
    const image = amountCharImage(ch);
    if (image < 0) continue; // 非数字（理论上不会出现）不贴越界的图
    const fromRight = shown.length - 1 - i;
    out.push({ ch, image, x: xLast - fromRight * AMOUNT_WINDOW.valueDigitPitch, y });
  }
  return out;
}

/** 比例条在面板内的位置与高 @source 0x00452a64..0x00452ad1（`+0xa` / `+0x2a` / `push 0xc`）*/
export const AMOUNT_GAUGE = { x: 0x0a, y: 0x2a, h: 0x0c, dimImage: 1 } as const;

/**
 * 比例条**亮**到第几个像素 @source 表 `0x47e725`（34 项，实 dump）。
 * 下标 = `amountGaugeIndex` 的返回值。
 */
export const AMOUNT_GAUGE_WIDTHS: readonly number[] = [
  3, 6, 9, 12, 15, 19, 22, 25, 28, 31, 34, 38, 41, 44, 47, 50, 53, 57, 60, 63, 66, 69, 73, 76, 79,
  82, 85, 88, 92, 95, 98, 101, 104, 107,
];

/**
 * 比例条的档位：`trunc(float32(值 / 上限) × 33)`；值为 0（或上限 ≤ 0）⇒ −1 = 整条都暗。
 * @source 0x004529aa..0x004529db（`fstp dword` 先落成 float32，再 `fmul 33.0`、截断取整）
 */
export function amountGaugeIndex(value: number, cap: number): number {
  if (!(value > 0) || !(cap > 0)) return -1;
  const i = Math.trunc(Math.fround(value / cap) * 33);
  return Math.min(i, AMOUNT_GAUGE_WIDTHS.length - 1);
}

/**
 * 面板的**全部贴图** —— 一张底 + 暗条 + 亮条那一截 + 每个数字一格。纯函数，方便单测钉版面。
 */
export function amountWindowPlan(value: number, cap = 0): {
  panel: { image: number; x: number; y: number };
  /** 暗条（图 1）整条贴上去 */
  gaugeDim: { image: number; x: number; y: number };
  /** 再从**面板图自己**身上还原回来的那一截亮条；null = 整条都暗 */
  gaugeLit: { x: number; y: number; w: number; h: number } | null;
  digits: readonly { ch: string; image: number; x: number; y: number }[];
} {
  const gi = amountGaugeIndex(value, cap);
  return {
    panel: { image: 0, x: 0, y: 0 },
    gaugeDim: { image: AMOUNT_GAUGE.dimImage, x: AMOUNT_GAUGE.x, y: AMOUNT_GAUGE.y },
    gaugeLit: gi < 0 ? null : { x: AMOUNT_GAUGE.x, y: AMOUNT_GAUGE.y, w: AMOUNT_GAUGE_WIDTHS[gi] ?? 0, h: AMOUNT_GAUGE.h },
    digits: amountDigits(value),
  };
}

/**
 * 画那扇窗（底图 + 比例条 + 数字）—— 只做 IO。
 *
 * ⚠️ **坐标系**：`ctx` 是**棋盘画布**（离屏 439×440，贴到舞台时原点在 (0,40)）；
 *   `AMOUNT_WINDOW.x/.y` 是原版的**屏幕**坐标（(256,144)，@source `[0x48cab8]`/`[0x48cab6]`），
 *   所以这里必须先过一遍 `boardRect()` 换成棋盘坐标 —— 否则整块面板会低
 *   `LAYOUT.board.y`（40 px），玩家照着画面点「7」实际落在「1 2 3」那一排（W-62）。
 *   股市屏那条路在调用前自己 `translate(LAYOUT.board.x, LAYOUT.board.y)`，
 *   同样是棋盘坐标系 ⇒ 本函数统一收棋盘坐标。
 */
export function drawAmountWindow(
  ctx: CanvasRenderingContext2D,
  sprite: AmountSprite,
  value: number,
  cap = 0,
): boolean {
  const plan = amountWindowPlan(value, cap);
  const base = sprite('Panel.mkf', AMOUNT_RESOURCE, plan.panel.image);
  // 底图还没解好时**什么都不画**：让调用方保留它自己的兜底（别画半扇窗）
  if (base === null) return false;
  // ★ W-62：屏幕坐标 → 棋盘画布坐标（与 `dialog.ts` 的命中框**同一处换算**）
  const o = boardRect({
    x: AMOUNT_WINDOW.x,
    y: AMOUNT_WINDOW.y,
    w: AMOUNT_WINDOW.w,
    h: AMOUNT_WINDOW.h,
  });
  const wx = o.x;
  const wy = o.y;
  drawSprite(ctx, base, wx + plan.panel.x, wy + plan.panel.y);
  // 比例条：先整条暗，再把左边那一截从面板图上原样盖回来（= 亮）
  const dim = sprite('Panel.mkf', AMOUNT_RESOURCE, plan.gaugeDim.image);
  if (dim !== null) {
    drawSprite(ctx, dim, wx + plan.gaugeDim.x - dim.anchorX, wy + plan.gaugeDim.y - dim.anchorY);
    const lit = plan.gaugeLit;
    if (lit !== null && lit.w > 0) {
      drawSpriteRegion(ctx, base, lit.x, lit.y, lit.w, lit.h, wx + lit.x, wy + lit.y, lit.w, lit.h);
    }
  }
  for (const d of plan.digits) {
    const s = sprite('Panel.mkf', AMOUNT_RESOURCE, d.image);
    if (s === null) continue;
    // 字库的锚点全是 0 ⇒ 直接减锚点（`fcn_00456512` 的 `[esi+4]/[esi+6]`）
    drawSprite(ctx, s, wx + d.x - s.anchorX, wy + d.y - s.anchorY);
  }
  return true;
}

/**
 * 「原版键盘窗上那一号钮」→ 「键盘语义」那一套（`AmountKey`）。
 *
 * ★ 原版本来就只有**一套**：键盘在 `loc_00452e4b` 把 VK 翻成钮序号写进
 *   `[0x48cac2]`，再合成一条 `WM_LBUTTONUP`；鼠标点某一号钮写的是**同一个**字段
 *   （`loc_00452fce` 那段分派两边共用）。所以「鼠标点第 N 号钮」与「键盘敲出
 *   第 N 号钮」必须走同一个出口 —— 本函数就是那道桥。
 *
 * @returns 对应的 `AmountKey`；`null` = 这一号钮不是键盘语义里的那几种
 *   （金额栏那两颗光标原版是**拖动**，没有对应的键）
 */
export function amountKeyOfSlotId(
  id: number,
  slotOf: (n: number) => { kind: string; digit?: number } | null,
  kindOf: (id: number) => AmountKey | null,
): AmountKey | null {
  const slot = slotOf(id);
  if (slot === null) return null;
  if (slot.kind === 'cursorLeft' || slot.kind === 'cursorRight') return null;
  // 键盘那一路的分派表（`AMOUNT_KEY_BY_ID`）已经把 2..0xf 都收了
  return kindOf(id);
}

/**
 * 金额栏（指针条）在**窗内**的矩形 —— 逐像素 id 图里 id `0x10` 那一片。
 *
 * @source `assets-clean/Panel/0022.bin`（`Panel.mkf` #0x16，128×192）实 dump：
 *   id `0x10` 共 **1540** 像素、外接矩形 `x∈[9,118]`、`y∈[41,54]`
 *   —— `110 × 14 = 1540` **正好等于**整个外接矩形 ⇒ 那一片就是个实心矩形，
 *   所以这里用矩形判定与「逐像素查 id」**等价**（原版 `loc_00453394` 查的就是 id 0x10）。
 */
export const AMOUNT_BAR_RECT = { x: 9, y: 41, w: 110, h: 14 } as const;

/** 拖动金额栏那一声 —— 每走一格都放 @source `[0x482352]`（表值 9）*/
export const AMOUNT_BAR_DRAG_SOUND = 9;

/**
 * **鼠标在金额栏上滑动** → 新的值（桌上坐标：棋盘画布内）。
 *
 * @source `loc_00453394`（`0x200` 那一支，`cmp dh, 0x10`）全文：
 *   先把窗内坐标夹进 `0 ≤ x ≤ 0x80`、`0 ≤ y ≤ 0xc0`，再查逐像素 id 图
 *   **必须是 `0x10`**（= 本常量那片），然后才走
 *   `amount-keys.ts` 的 `amountFromBarX`（`x−0xa` → 表 `0x47e725` → `trunc(上限×i/33)`）。
 *
 * @returns 新值；`null` = 原版**什么都不做**（没落在栏上、或 `x ≥ 118` 那一列）
 */
export function amountBarDragValue(sx: number, sy: number, max: number): number | null {
  const lx = sx - AMOUNT_WINDOW.x;
  const ly = sy - AMOUNT_WINDOW.y;
  if (lx < 0 || lx > 0x80 || ly < 0 || ly > 0xc0) return null;
  if (lx < AMOUNT_BAR_RECT.x || lx >= AMOUNT_BAR_RECT.x + AMOUNT_BAR_RECT.w) return null;
  if (ly < AMOUNT_BAR_RECT.y || ly >= AMOUNT_BAR_RECT.y + AMOUNT_BAR_RECT.h) return null;
  return amountFromBarX(lx, max);
}

/**
 * 原版那张**逐像素 id 图**（`Panel.mkf` #0x16 = 128×192 字节，每像素一个钮号）。
 *
 * ★ 2026-09-16 接入（素材在 `assets-clean/Panel/0022.bin`，24 576 B = 128×192）。
 *   这张图是**命中判定的真值**：矩形表 `0x47e6d8` 只给版面，重叠处（金额栏那
 *   两颗光标就重叠）靠这张图分。我逐格核过它与矩形表的**身份完全一致**：
 *   在每颗钮内取一点，读到的 id 依次是 2,3,…,15（`[0]`/`[1]` 是金额栏那颗光标，
 *   图里那一片全是 `1`）。
 *
 * @param bytes 资源原始字节；长度不足时返回 `null`（视作「没有这张图」）
 */
export function parseAmountHitMap(bytes: Uint8Array | null): Uint8Array | null {
  if (bytes === null || bytes.length < AMOUNT_WINDOW.w * AMOUNT_WINDOW.h) return null;
  return bytes.subarray(0, AMOUNT_WINDOW.w * AMOUNT_WINDOW.h);
}

/**
 * 用**逐像素 id 图**判命中 —— 与原版完全同一条路（鼠标 → 窗内坐标 → 取字节）。
 *
 * @param map `parseAmountHitMap` 的产物；`null` 时退回矩形表（`amountWindowHit`）
 * @returns 钮号 `0..15`；窗内但图上是 0（= 原版那一片空白）返回 `null`
 */
export function amountWindowHitMapped(
  map: Uint8Array | null,
  sx: number,
  sy: number,
): number | null {
  const lx = sx - AMOUNT_WINDOW.x;
  const ly = sy - AMOUNT_WINDOW.y;
  if (lx < 0 || ly < 0 || lx >= AMOUNT_WINDOW.w || ly >= AMOUNT_WINDOW.h) return null;
  if (map === null) return amountWindowHit(sx, sy);
  const id = map[ly * AMOUNT_WINDOW.w + lx] ?? 0;
  // 图上的 0 = 不认（原版那一片空白区），与矩形表的「不在任何钮上」等价
  return id === 0 ? null : id;
}
