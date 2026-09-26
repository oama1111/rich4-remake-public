/*
 * 銀行 —— **ATM 面板**（提款 / 存款那一半）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 银行落点原版开**两屏**（落点分派 `0x0041b396` 起）：
 *   1. **`_rich4_ui_bank_atm_entry`**（VA 0x4379c9）—— 就是这台 ATM：提款/存款
 *      + 一台**数字键盘**（本模块）；
 *   2. 回来之后（`0x0041b39b` 终局码为 0 才往下）`0x0041b3af call 0x436668`
 *      `_rich4_ui_bank_entry` —— 貸款屏（申請/償還/特別融資，`Panel.mkf` **资源 23**）。
 *   第 2 屏另开一张卡（T-029b），本模块只管第 1 屏。core 那边落点先挂
 *   `pending {kind:'atm', landing:true}`，答掉之后才换成 `kind:'bank'`（第十三份试玩回报 #2）。
 *   **路过**銀行（`0x0041b5ab`）开的也是这同一台，只是关掉之后接着走。
 *
 * ## 出处
 *
 * | 是什么 | @source |
 * |---|---|
 * | 面板 = `Panel.mkf` **资源 24** 图 0（320×338），落 **(60,71)** | 入口 VA 0x437a18 的 `read_mkf(panel, 0x18, …)`；画在 `loc_00436f9d` |
 * | 18 颗钮的矩形 = 表 **`0x475888`**（每项 8 字节：x0,y0,x1,y1，**面板局部**）| 命中 `loc_00437161`（先减去 60/71 再查表）|
 * | 钮的图号 = **序号 + 1**（资源 24 的图 1..18）| `lea edx,[ebx+1]` 后按 12 字节步进取 chunk |
 * | 数字图 = 图 **19..28** = `'0'..'9'`，18×32 | 见下 |
 * | 金额串 `[0x48c3f8]`、模式 `[0x48c3f0]` | `loc_00437161` 的 `cmp ebx, [0x48c3f0]` 与 `loc_00437588` 一带 |
 *
 * ## 金额那一行的画法（`fcn_00436d3a`）
 *
 * ```
 * esi = 0x130 (304)                       ; x 从 304 起，从**右往左**画
 * 图号 = (字符 − 0x1d)                     ; '0'(0x30) → 19 ✓ '9'(0x39) → 28 ✓
 * fcn_004563f5(screen, 图, esi, 0xac(172)) ; 不透明贴图，锚点 (0,0) → 左上角对齐
 * esi -= 0x14 (20)                         ; 每字 20 像素
 * 最多 10 位
 * ```
 *
 * ## 键位（把图 5..16 / 17 / 18 导出来读出来的）
 *
 * ```
 *   7 8 9        ← 图 5..7      [MAX]   ← 图 17
 *   4 5 6        ← 图 8..10     [↵]     ← 图 18
 *   1 2 3        ← 图 11..13
 *   C 0 ←        ← 图 14..16（清空 / 0 / 退格）
 * ```
 * 上面两颗大图：图 1（**左上**，钮 0）= **提款**、图 2（**中间**，钮 1）= **存款**、
 * 图 3 = **EXIT**；图 4 = 金额栏的底。
 *
 * ★★ 第十三份试玩回报 #1「左上角应该是取款，中间是存款」—— 先前这里凭**看图**把两颗认反了
 *   （「手伸向钱 = 存款」），整台 ATM 的存/提因此对调。改按 exe 的**数据流**定：
 * ```asm
 * ; 按下钮 0 / 钮 1（抬手分发 `[0x48c40b]` = 钮序号 + 1）
 * 004373ab  cmp al,1 …  mov [0x48c3f0], 0            ; 码 1（钮 0，左上）→ 模式 0
 * 004373d1  mov eax,[player+0x496b88] → [0x48c3ec]  ;   上限 = **存款余额**
 * 004373eb  …           mov [0x48c3f0], 1            ; 码 2（钮 1，中间）→ 模式 1
 * 0043740b  mov eax,[player+0x496b84] → [0x48c3ec]  ;   上限 = **現金**
 * ; 按確認（`0x4377e6`）
 * 0043781e  cmp dword [0x48c3f0], 0 / jne 0x437856
 * 00437827  sub [player+0x496b88], ebx  ; 模式 0：存款 −= x
 * 0043782d  add [player+0x496b84], ebx  ;         現金 += x   ⇒ **提款**（之后 `0x43784d` 查特別融資垫付）
 * 00437856  add [player+0x496b88], ebx  ; 模式 1：存款 += x、現金 −= x ⇒ **存款**
 * ```
 *   ⇒ 模式 0 = 提款（钮 0，左上）、模式 1 = 存款（钮 1，中间）；开窗默认模式 0（`0x0043705f`），
 *   暫停放款时默认模式 1（`0x00437028`）且钮 0 按了不认（`0x004371e5`）—— 暫停的是「放款」＝提款。
 *   ATM 的键盘表（`loc_004374ac`）**没有**切模式的键（只有数字 / C / ← / M / Enter / H），无需改。
 */

import type { ArchiveName, Sprite } from './assets.ts';
import {
  ATM_BAR,
  ATM_PCT_STEP,
  ATM_PCT_SCALE,
  atmBarWidth,
  atmPercent,
  atmPressedImage,
  bankSprite,
} from './bank-dynamic.ts';
import { drawSprite, drawSpriteRegion } from './hd-stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type AtmSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 面板图集 @source 入口 VA 0x437a18 的 `read_mkf(panel_mkf, 0x18, 0, 0)` */
export const ATM_RESOURCE = 24;
/** 面板落点（屏幕）@source `loc_00436f9d` 的 `push 0x47 / push 0x3c` */
export const ATM_ORIGIN = { x: 0x3c, y: 0x47 } as const;

/** 一颗钮：面板局部的矩形 + 图号（= 序号 + 1）*/
export interface AtmButton {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 18 颗钮 —— **逐项 dump 自 `rich4.exe` 的表 `0x475888`**（面板局部坐标）。
 *
 * | # | 图 | 矩形 | 是什么 |
 * |---|---|---|---|
 * | 0 | 1 | (57,49)-(137,90) | 提款（模式 0）|
 * | 1 | 2 | (139,49)-(219,90) | 存款（模式 1）|
 * | 2 | 3 | (221,49)-(264,90) | EXIT |
 * | 3 | 4 | (53,137)-(268,166) | 金额栏底（不是钮）|
 * | 4..15 | 5..16 | 4×3 格 33×17 | 数字盘 `789 / 456 / 123 / C0←` |
 * | 16 | 17 | (183,233)-(232,258) | MAX |
 * | 17 | 18 | (175,260)-(232,285) | ↵ 確認 |
 */
export const ATM_BUTTONS: readonly AtmButton[] = [
  { x0: 57, y0: 49, x1: 137, y1: 90 },
  { x0: 139, y0: 49, x1: 219, y1: 90 },
  { x0: 221, y0: 49, x1: 264, y1: 90 },
  { x0: 53, y0: 137, x1: 268, y1: 166 },
  { x0: 58, y0: 211, x1: 91, y1: 228 },
  { x0: 97, y0: 211, x1: 130, y1: 228 },
  { x0: 136, y0: 211, x1: 169, y1: 228 },
  { x0: 58, y0: 230, x1: 91, y1: 247 },
  { x0: 97, y0: 230, x1: 130, y1: 247 },
  { x0: 136, y0: 230, x1: 169, y1: 247 },
  { x0: 58, y0: 249, x1: 91, y1: 266 },
  { x0: 97, y0: 249, x1: 130, y1: 266 },
  { x0: 136, y0: 249, x1: 169, y1: 266 },
  { x0: 58, y0: 268, x1: 91, y1: 285 },
  { x0: 97, y0: 268, x1: 130, y1: 285 },
  { x0: 136, y0: 268, x1: 169, y1: 285 },
  { x0: 183, y0: 233, x1: 232, y1: 258 },
  { x0: 175, y0: 260, x1: 232, y1: 285 },
] as const;

/** 钮的图号 = 序号 + 1 @source `loc_00437161` 的 `lea edx,[ebx+1]` */
export const ATM_IMAGE_BASE = 1;
/** 金额栏底那张图的序号（不是钮）*/
export const ATM_DISPLAY = 3;

/** 数字图 @source `fcn_00436d3a` */
export const ATM_DIGIT = { first: 19, step: 20, x: 0x130, y: 0xac, max: 10 } as const;

/** 数字盘那 12 颗按下去是什么（序号 4..15）@source 图 5..16 上印的就是这些 */
export const ATM_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'back'] as const;

/** 点在第几颗钮上（坐标是**屏幕/舞台**坐标）；没点中返回 null @source `loc_00437161` */
export function hitAtmButton(sx: number, sy: number): number | null {
  const x = sx - ATM_ORIGIN.x;
  const y = sy - ATM_ORIGIN.y;
  for (let i = 0; i < ATM_BUTTONS.length; i++) {
    const b = ATM_BUTTONS[i]!;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return i;
  }
  return null;
}

/** 钮的屏幕矩形（画按下态用）*/
export function atmButtonRect(i: number): { x: number; y: number; w: number; h: number } {
  const b = ATM_BUTTONS[i]!;
  return { x: ATM_ORIGIN.x + b.x0, y: ATM_ORIGIN.y + b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
}

/** 两种模式 @source `[0x48c3f0]`：0 = 提款（钮 0，左上）、1 = 存款（钮 1，中间）—— 见文件头 */
export const ATM_MODE = { withdraw: 0, deposit: 1 } as const;

/**
 * ATM 这一刻的状态。
 *
 * @param mode 0 = 提款 / 1 = 存款（原版 `[0x48c3f0]`，见 `ATM_MODE`）
 * @param digits 已键入的数字串（原版 `[0x48c3f8]`，是 ASCII）
 * @param limits `[提款上限, 存款上限]` —— 提款 = 存款余额、存款 = 現金（按模式下标取）
 */
export interface AtmState {
  mode: number;
  digits: string;
  limits: readonly [number, number];
}

/**
 * 开窗那一刻的状态 @source ATM 窗 `0x401`（`0x00436fdd`）：
 * `+0x3c`（銀行暫停放款）!= 0 ⇒ 模式 1 = 存款（`0x00437028`，上限 = 現金）；否则模式 0 = 提款
 * （`0x0043705f`，上限 = 存款）。金额串 = `"0"`（`fcn_00436edb`），本模块以空串表示「还没输入」。
 */
export function atmOpen(cash: number, moneyInBank: number, frozen: boolean): AtmState {
  return {
    mode: frozen ? ATM_MODE.deposit : ATM_MODE.withdraw,
    digits: '',
    limits: [moneyInBank, cash],
  };
}

/** 按確認那一刻的模式 → core 的 `bank` op @source `0x0043781e`：模式 0 提款、模式 1 存款 */
export function atmOp(mode: number): 'withdraw' | 'deposit' {
  return mode === ATM_MODE.deposit ? 'deposit' : 'withdraw';
}

/** 当前金额 */
export function atmAmount(st: AtmState): number {
  const n = Number.parseInt(st.digits === '' ? '0' : st.digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 当前模式的上限 */
export function atmLimit(st: AtmState): number {
  return Math.max(0, Math.trunc(st.limits[st.mode] ?? 0));
}

/**
 * 按下一颗钮之后的**新状态** —— 纯函数（`null` = 关掉面板）。
 *
 * 数字盘那 12 颗照着图上的字走：`C` 清空、`←` 退格；最多 10 位
 * （@source `fcn_00436d3a` 的 `cmp edi, 0xa`）。
 * `MAX` 把金额填成上限（图 17 上印的就是 `MAX`）。
 *
 * 两颗模式钮（钮序号 = 模式号：钮 0 提款、钮 1 存款）**每按一次都重设**：模式、上限、金额串归 `"0"`
 * —— 点的是当前那件也一样。@source `loc_00437161`：`0x004371ce cmp ebx,[0x48c3f0] / je 0x43738f`
 * 只是**跳过重画高亮**，照样 `0x0043738f` 写码 → `0x004373ab`（码 1）/ `0x004373eb`（码 2）设模式与上限
 * 后 `call 0x436edb(1)`（`0x00436edb mov byte [0x48c3f8],0x30` = 金额串清成 `"0"`）。
 * （第十三份试玩回报复核订正：先前写成「点当前那件什么都不做、连 digits 都留」，把那个 `je` 读成了整段跳过。）
 */
export function atmPress(st: AtmState, btn: number, frozen = false): AtmState | null {
  if (btn === 2) return null; // EXIT
  if (btn === 0 || btn === 1) {
    // ★ 暫停放款时点「提款」（钮 0）换成当前模式那件 @source `0x004371e5` / `0x004371ee mov ebx,[0x48c3f0]`
    const mode = btn === 0 && frozen ? st.mode : btn;
    return { ...st, mode, digits: '' };
  }
  if (btn === 16) return { ...st, digits: String(atmLimit(st)) };
  if (btn === 17) return st; // ↵ 由调用方发 action，不改状态
  const key = atmKeyOf(btn);
  if (key === null) return st;
  if (key === 'C') return { ...st, digits: '' };
  if (key === 'back') return { ...st, digits: st.digits.slice(0, -1) };
  if (st.digits.length >= ATM_DIGIT.max) return st;
  if (st.digits === '' && key === '0') return st; // 前导 0 不攒
  return { ...st, digits: st.digits + key };
}

/**
 * 按下（鼠标 `0x201` / 键盘 `0x100`）那一下放的音效（Effect.mkf 编号）；`null` = 不放。
 *
 * @param code 按下码（`[0x48c40b]` = 钮序号 + 1；键盘见 `ATM_KEY_VK`）
 *
 * | 码 | 音效 | @source |
 * |---|---|---|
 * | 1 / 2（提款 / 存款）| **1**（`[0x482322]`）| `0x004373b5` / `0x004373ed push 0x482322 / call 0x4542ce` |
 * | 4（金额栏；拖动时每次移动都重发一次按下，`loc_00437904`）| **9**（`[0x482352]`）| `0x00437415` |
 * | 其余 3、5..18（EXIT / 数字 / C / ← / MAX / ↵）| **7**（`[0x48234a]`）| `0x0043749a` |
 *
 * 键盘那一路（`loc_004374ac`）：除 `H`（码 4，改发一次 `0x201` 走上面金额栏那一支 ⇒ 9）外都在
 * `0x00437571 push 0x48234a` 放 **7** —— 键盘码从来不是 1/2，所以同一张表就够。
 * 抬手（`0x202`）与右键关窗（`loc_0043791e`）都不放音。
 */
export function atmPressSound(code: number): number | null {
  if (code === 1 || code === 2) return 1;
  if (code === 4) return 9;
  if (code >= 3 && code <= 18) return 7;
  return null;
}

/** 第 `btn` 颗是哪个键；不是数字盘返回 null */
export function atmKeyOf(btn: number): (typeof ATM_KEYS)[number] | null {
  const k = btn - 4;
  return k >= 0 && k < ATM_KEYS.length ? ATM_KEYS[k]! : null;
}

/**
 * **「銀行暫停放款」禁止章** —— 图 29（29×29，一个红圈斜杠）。
 *
 * @source `loc_00436f9d`：`cmp byte [player+0x3c], 0 / je 跳过` 之后才
 *   `fcn_00456418(screen, sheet+0x168, 0x9d(157), 0x8d(141))` —— 即
 *   **只有 `bank_freeze_days != 0` 时**才盖在**提款**（钮 0，左上）那颗钮的中心。
 *   同一状态下 `loc_004371da` 也把「点提款」这一下吃掉（改用当前模式）。
 */
export const ATM_FROZEN_MARK = 29;
/** 禁止章的落点（提款钮 = 钮 0 的中心）@source `push 0x8d / push 0x9d` */
export const ATM_FROZEN_AT = { x: 0x9d, y: 0x8d } as const;

/** 某一颗钮的中心（屏幕坐标）—— 悬停标记就画在这儿 */
export function atmButtonCenter(i: number): { x: number; y: number } {
  const r = atmButtonRect(i);
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

/**
 * 画面板。
 *
 * 顺序照原版 `0x401`（`loc_00436f9d`）+ `fcn_00436d3a`：
 * 面板底（**抠黑**）→ 冻结章 → **当前模式那支高亮图** → 金额数字 → 进度条
 * → 正被按住那颗的按下图。
 *
 * ★ **两颗模式钮只画当前那一支**：@source `loc_00436f9d` 的
 *   `if (player+0x3c != 0) 画图 2（存款）/ else 画图 1（提款）` ——
 *   面板底图（图 0）里本来就有两颗钮，图 1/2 是它们的**高亮态**。
 *
 * @param frozen `bank_freeze_days != 0` —— 盖上「銀行暫停放款」禁止章
 * @param pressed `[0x48c40b]`（钮序号 + 1；`null`/0 = 没按住）
 */
export function drawBankAtm(
  ctx: CanvasRenderingContext2D,
  sprite: AtmSprite,
  st: AtmState,
  frozen = false,
  pressed: number | null = null,
): void {
  const ox = ATM_ORIGIN.x;
  const oy = ATM_ORIGIN.y;
  const at = (index: number, x: number, y: number): void => {
    const s = bankSprite(sprite, 'Panel.mkf', ATM_RESOURCE, index);
    if (s !== null) drawSprite(ctx, s, x - s.anchorX, y - s.anchorY);
  };

  at(0, ox, oy); // 面板底（图 0，锚点 (0,0)）
  // 「銀行暫停放款」禁止章（图 29，锚点 (14,14)）—— 只在冻结时盖
  if (frozen) at(ATM_FROZEN_MARK, ATM_FROZEN_AT.x, ATM_FROZEN_AT.y);
  // 当前模式那颗钮的高亮图 @source `loc_00436f9d`：提款（模式 0）→ 图 1、存款（模式 1）→ 图 2
  const modeBtn = ATM_BUTTONS[st.mode === 1 ? 1 : 0]!;
  at(ATM_IMAGE_BASE + (st.mode === 1 ? 1 : 0), ox + modeBtn.x0, oy + modeBtn.y0);

  // 金额：从右往左一位一张数字图 @source `fcn_00436d3a`
  for (let k = 0; k < st.digits.length && k < ATM_DIGIT.max; k++) {
    const ch = st.digits.charCodeAt(st.digits.length - 1 - k);
    at(ATM_DIGIT.first + (ch - 0x30), ATM_DIGIT.x - k * ATM_DIGIT.step, ATM_DIGIT.y);
  }

  // ── 进度条 @source `fcn_00436d3a` 的三次 `fcn_0045643d` ──
  drawAtmBar(ctx, sprite, atmAmount(st), atmLimit(st));

  // ── 正被按住那颗的按下图（图 = 码）@source `loc_004371f9` ──
  const img = pressed === null ? null : atmPressedImage(pressed);
  if (img !== null && pressed !== null) {
    const b = ATM_BUTTONS[pressed - 1]!;
    at(img, ox + b.x0, oy + b.y0);
  }
}

/**
 * ATM 的**进度条** @source `fcn_00436d3a`（VA 0x436d3a）：
 *
 * ```asm
 * pct = trunc(atoi(金额) / [0x48c3ec] × 34)      ; [0x464bd0] = 34.0f
 * ebx = pct × 6                                  ; 一格 6 像素，34×6 = 204 = 条宽
 * 若 ebx != 0 :  图4 (0,0,ebx,26) → (118,210)
 * 若 ebx < 204:  图0 (58+ebx,139,204−ebx,26) → (118+ebx,210)
 * ```
 * ⚠️ 扣黑表说图 0 是**带透明**贴的，但这里走的是 `fcn_0045643d`（矩形拷贝）——
 *   所以这条「还原空余部分」的两头都按**原样**搬像素，不做抠黑。
 */
export function drawAtmBar(
  ctx: CanvasRenderingContext2D,
  sprite: AtmSprite,
  amount: number,
  limit: number,
): void {
  const w = atmBarWidth(atmPercent(amount, limit));
  const fill = bankSprite(sprite, 'Panel.mkf', ATM_RESOURCE, ATM_BAR.fillImage);
  if (w > 0 && fill !== null) {
    drawSpriteRegion(ctx, fill, 0, 0, w, ATM_BAR.h, ATM_BAR.x, ATM_BAR.y, w, ATM_BAR.h);
  }
  if (w < ATM_BAR.w) {
    const rest = ATM_BAR.w - w;
    const plate = bankSprite(sprite, 'Panel.mkf', ATM_RESOURCE, 0);
    if (plate !== null) {
      drawSpriteRegion(
        ctx,
        plate,
        ATM_BAR.emptySrcX + w,
        ATM_BAR.emptySrcY,
        rest,
        ATM_BAR.h,
        ATM_BAR.x + w,
        ATM_BAR.y,
        rest,
        ATM_BAR.h,
      );
    }
  }
}

/** 进度条一格多少像素 / 比例常数 —— 转出去给单测钉 @source `fcn_00436d3a` */
export const ATM_BAR_STEP = ATM_PCT_STEP;
export const ATM_BAR_SCALE = ATM_PCT_SCALE;
