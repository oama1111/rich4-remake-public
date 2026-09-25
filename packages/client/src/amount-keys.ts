/*
 * 通用填数窗（`fcn_00453544`）**自己那张键盘表** —— 纯函数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版那扇窗的窗口过程是 `fcn_00452c02`。它的 `0x100`（`WM_KEYDOWN`）落在
 * `loc_00452e4b`（VA 0x00452e4b），做的事只有两件：
 *
 * ```asm
 * 00452e4b  xor dl, dl
 * 00452e4d  mov byte [0x48cac2], dl        ; 先清「按下的钮」
 * 00452e53  cmp eax, 0x35                  ; ★ 下面是一棵二叉分派：VK → 钮序号
 * ...
 * 00452ed7  mov byte [0x48cac2], 5         ; '0' → 序号 5
 * ...
 * 00452f0e  push ref_0048234a              ; 按键音（[0x48234a] = 7）
 * 00452f15  call rich4_play_sound_effect
 * 00452f1d  push 0
 * 00452f1f  push 0
 * 00452f21  push 0x202                     ; ★ WM_LBUTTONUP
 * 00452f26  jmp PostMessageA
 * ```
 *
 * ⇒ **键盘不是另一套状态机**：它把键翻成「窗里哪一颗钮被按下」的序号
 * （`[0x48cac2]`），再自己合成一条 `WM_LBUTTONUP (0x202)`。而 0x202 在
 * `fcn_00452c02` 里落到 `loc_00452fce` —— **与鼠标抬手同一条分发**：
 * 按序号查跳表 `[0x452bca + (序号−2)*4]`，跳到「接数字 / C / 退格 / M / Enter」
 * 那五支上（见下）。所以「键盘」与「鼠标」在原版**共用同一套状态机**，
 * 差别只在「谁来决定是哪颗钮」。
 *
 * 那串「0..9 的数字」不是整数，而是窗口里的一根**十进制字符串**
 * `[0x48caac]`（初值 `"0"`，见 `loc_00452c91` 的 `mov byte [0x48caac], 0x30`）。
 * 本引擎把它存成 `AmountPage.value`（整数）—— 两者**逐位等价**：
 * 那串字符永远是 `itoa(atoi(buf))`（前导 0 会被顶掉、超上限会被改写成 `itoa(max)`），
 * 所以「字符串」与「规范十进制整数」是一一对应的。下面每条注释都标出对应的原版指令。
 *
 * ★ 銀行 ATM（`fcn_00436ef8` 的 `loc_004374ac`）是**另一扇窗**，它那张表的
 *   VK / 序号完全不同（`ATM_KEY_VK`），但 0-9、退格、C、M 的**值语义**是同一套
 *   （连「前导 0 不入位」「超上限夹到上限」的写法都一样，只有位数上限不同：
 *   通用窗 9 位、ATM 10 位）。故那两条抽成 `appendDigitKey` / `backspaceKey`
 *   给两边共用 —— 见 `bank-dynamic.ts` 的 `atmApplyCode`。
 */

import { vkOf } from './hotkeys.ts';

/** 十进制位数上限 —— 9 位 @source `loc_00453189` 的 `cmp eax, 9` / `jge loc_0045310a` */
export const AMOUNT_DIGIT_MAX = 9;

/** `H` 合成的金额栏按下点（窗口内相对坐标）@source `loc_00452f73`：`+0x40` / `+0x2f` */
export const AMOUNT_BAR_PRESS = { x: 0x40, y: 0x2f } as const;

/** 金额栏的格数 = `[0x46621c]` = `0x42040000` = 33.0f @source `loc_00453470` 的 `fdiv` */
export const AMOUNT_BAR_STEPS = 33;

/**
 * 金额栏每一格对应的**窗内 x 阈值**（34 项）@source 表 `0x47e725`，逐字节：
 * `[3,6,9,12,15,19,22,25,28,31,34,38,41,44,47,50,53,57,60,63,66,69,73,76,79,82,
 * 85,88,92,95,98,101,104,107]`
 *   （`loc_00453451` 的 `mov al, byte [eax + 0x47e725]`，`eax` = 格号 0..0x21）。
 */
export const AMOUNT_BAR_THRESHOLDS: readonly number[] = [
  3, 6, 9, 12, 15, 19, 22, 25, 28, 31, 34, 38, 41, 44, 47, 50, 53, 57, 60, 63, 66, 69, 73, 76,
  79, 82, 85, 88, 92, 95, 98, 101, 104, 107,
];

/** 表 `0x47e725` 的项数（= 33 格 + 1）@source `cmp ebp, 0x22 / jge` */
export const AMOUNT_BAR_THRESHOLD_COUNT = 34;

/**
 * 按下点落在金额栏第几格 —— 表 `0x47e725` 里第一个 ≥ `0x40 − 0xa` 的项。
 * `0x40 − 0xa = 54`；`table[16] = 53 < 54 ≤ 57 = table[17]` ⇒ **17**
 * @source `loc_00453451` 的循环（`sub ebx, 0xa` 在 `loc_00453413`）。
 */
export const AMOUNT_BAR_PRESS_STEP = 17;

/**
 * **窗内 x → 金额栏格号**（拖动金额栏那条路）@source `loc_00453394`..`loc_0045349d`。
 *
 * ```asm
 * 00453394  cmp  dh, 0x10 / jne 什么都不做   ; ★ 只有逐像素 id = 0x10 的那片才走这条
 *           ebx = mouseX - 窗x ; eax = mouseY - 窗y
 *           test ebx,ebx / jl 什么都不做 ; cmp ebx,0x80 / jg 什么都不做
 *           test eax,eax / jl 什么都不做 ; cmp eax,0xc0 / jg 什么都不做
 *           al = mask[y*0x80 + x] ; cmp al,0x10 / jne 什么都不做   ; 再确认一次
 * 00453413  sub ebx, 0xa
 * 0045341b  jg → 否则值 = 0
 * 00453451  找第一个 table[i] >= ebx（i 从 0 到 0x21；找不到就什么都不做）
 * 00453470  value = trunc(上限 × i ÷ 33.0f)     ; `fdiv [0x46621c]` / `fmul [0x48ca98]`
 * ```
 *
 * @returns 格号 `0..33`；`0` 表示「值就是 0」这一档；`null` = 原版**什么都不做**
 *   （窗内 x 超出 `0..0x80`、或 `x − 0xa` 落在表的最大项之外）
 */
export function amountBarStepAt(x: number): number | null {
  if (!Number.isFinite(x)) return null;
  if (x < 0 || x > 0x80) return null;
  const ebx = x - 0xa;
  if (ebx <= 0) return 0;
  const i = AMOUNT_BAR_THRESHOLDS.findIndex((v) => ebx <= v);
  return i < 0 ? null : i;
}

/**
 * 拖动金额栏 → 新的值；`null` = 原版什么都不做（**值保持不变**）。
 *
 * ★ 与 `H` 键**同一条式子**：`H` 就是拿一个写死的按下点 `(0x40,0x2f)` 走这里
 *   （`loc_00452f73` 把 x 加 `0x40`、y 加 `0x2f` 之后伪造一发按下），
 *   所以两边不会算出两个值。
 */
export function amountFromBarX(x: number, max: number): number | null {
  const step = amountBarStepAt(x);
  if (step === null) return null;
  const cap = Math.max(0, Math.trunc(max));
  // 原版：`fild i` → `fdiv 33.0f` → `fmul 上限` → `__round_toward_zero`（向零取整）
  return Math.trunc((cap * step) / AMOUNT_BAR_STEPS);
}

/**
 * `WM_KEYDOWN` 的 `wParam`（VK 码）→ 窗里那颗钮的**序号**（原版写进 `[0x48cac2]`）。
 *
 * @source `loc_00452e4b` 起那棵二叉分派，逐项：
 *
 * | VK | 键 | 序号 | 落点 VA |
 * |---|---|---|---|
 * | 0x30 | `0` | 5 | 0x452ed7 |
 * | 0x31 | `1` | 0xd | 0x452ee3 |
 * | 0x32 | `2` | 0xe | 0x452eef（`cmp 0x33` 的 `jb`）|
 * | 0x33 | `3` | 0xf | 0x452efb |
 * | 0x34 | `4` | 0xa | 0x452f07（`cmp 0x33` 的 `jmp`）|
 * | 0x35 | `5` | 0xb | 0x452f2b |
 * | 0x36 | `6` | 0xc | 0x452f34（`cmp 0x37` 的 `jb`）|
 * | 0x37 | `7` | 7 | 0x452f3d |
 * | 0x38 | `8` | 8 | 0x452f46（`cmp 0x37` 的 `jmp`）|
 * | 0x39 | `9` | 9 | 0x452f4f |
 * | 0x08 | 退格 | 6 | 0x452f6a |
 * | 0x0d | Enter | 3 | 0x452f96 |
 * | 0x43 | `C` | 4 | 0x452f61 |
 * | 0x48 | `H` | 0x10（金额栏）| 0x452f73 |
 * | 0x4d | `M` | 2 | 0x452f58 |
 *
 * ★ 只有主键盘那十个数字；小键盘的 VK 是 `0x60..0x69`，这棵树里**没有**。
 * ★ `ESC (0x1b)` 也不在树里（掉到 `loc_00452fa2`，因为序号是 0 而直接返回）——
 *   它是由全局键盘钩子补成 `WM_RBUTTONUP (0x205)` 才关掉窗子的，
 *   所以那一条留给 `panel-cancel.ts` 的梯子，本模块**不管取消**。
 *
 * 这张表由 `amount-keys.test.ts` **直接把 exe 那段分派解释一遍**来对账（不靠手抄）。
 */
/**
 * 那扇窗**面板的几何** —— 三张表和两个落点，全部逐字节核过。
 *
 * 外部审查 B-5/B-6 说「借款/出价走的是自造按钮条，原版是数字键盘窗」——
 * 键盘那一半（`AMOUNT_KEY_*` 两张表 + 一次按键的四条规则）本模块早就有了；
 * 缺的是**面板与命中**，即下面这些常数。2026-09-16 补齐并钉住。
 *
 * | 项 | 值 | 出处 |
 * |---|---|---|
 * | 面板图 | `Panel.mkf` **#0x15（21）** 图 0 = **128×192**（窗底） | `rich4.asm:27494` `read_mkf(panel, 0x15)` → `[0x48caa8]` |
 * | 逐像素 id 图 | `Panel.mkf` **#0x16（22）** = **128×192 字节**（每像素一个钮 id） | `rich4.asm:27502` → `[0x48ca9c]` |
 * | 窗落点 | **`(0x100, 0x90)` = (256, 144)**，尺寸 128×192 | `rich4.asm:27510-27513`：`[0x48cab8]=0x100`、`[0x48cab6]=0x90`，`InvalidateRect (0x100,0x90)-(0x180,0x150)` |
 * | 金额显示 | 面板内 `(0x6b, 0x0b)` 起、**9 位**、字距 **0xc**、右起往左贴 | `fcn_0045297e`（`add esi,0x6b` / `add ebp,0xb` / `sub esi,0xc` / `cmp edi,9`）|
 * | 「%」那一格 | 面板内 `(0xa, 0x2a)` | 同上（`add eax,0x2a` / `add eax,0xa`）|
 */
export const AMOUNT_WINDOW = {
  /** 面板图在 `Panel.mkf` 里的资源号 @source `push 0x15` */
  panelResource: 0x15,
  /** 逐像素 id 图 @source `push 0x16` */
  hitResource: 0x16,
  /** 面板尺寸（图 0 的实测尺寸）*/
  w: 128,
  h: 192,
  /** 窗落点（屏幕坐标）@source `[0x48cab8]/[0x48cab6]` */
  x: 0x100,
  y: 0x90,
  /**
   * **末位数字**的落点（面板内）—— 数字**右对齐**，从末位往左排。
   *
   * @source `fcn_0045297e`（2026-09-19 整支重读）：
   * ```asm
   * 00452985  movsx esi, word [0x48cab8] / add esi, 0x6b   ; x = 窗 x + 0x6b
   * 0045298f  movsx ebp, word [0x48cab6] / add ebp, 0x0b   ; y = 窗 y + 0x0b
   * 00452a00  lea ebx, [eax-1]                             ; 从**末位**字符起
   * 00452a05  push ebp / push esi / …                      ; (屏, 图集, 图, x=esi, y=ebp)
   * 00452a28  sub esi, 0xc / dec ebx                        ; 往**左**走一格、取前一位
   * ```
   * ★ 先前这里另列了一个 `valueAtChar = (0x40, 0x21)` 并让数字**从左往右**排 ——
   *   那两个数在这支函数里**根本不存在**，是误读。后果：数字落在比例条那一行
   *   （y = 0x21 紧贴 0x2a 的条），上面的液晶屏永远是空的，看着像「按键没反应」
   *   （2026-09-19 试玩回报：买股票的计算器「无法实际操作」—— 其实数按进去了，只是看不见）。
   */
  valueAt: { dx: 0x6b, dy: 0x0b },
  /** 位数之间的字距 @source `loc_00452a05` 的 `sub esi, 0xc` */
  valueDigitPitch: 0xc,
  /** 位数上限 @source `loc_00453189` 的 `cmp eax, 9` */
  valueMaxChars: 9,
  /** 「%」那一格的面板内偏移 */
  percentAt: { dx: 0xa, dy: 0x2a },
} as const;

/**
 * 16 颗钮在**面板内**的矩形 `{x, y, w, h}` @source 表 `0x47e6d8`（每钮 4 字节）。
 *
 * 逐字节 dump 出来是（`rich4.asm:49788` 起；本表连**表外第 16 项**一起列全）：
 * ```text
 * [0] (16, 11, 228, 7)   金额栏的「‹」光标（不是键盘键）
 * [1] (17, 11, 228, 7)   金额栏的「›」光标
 * [2] ( 8, 63,  58, 25)  M   = 最大
 * [3] (64, 63,  57, 25)  Enter = 確定
 * [4] ( 8, 95,  33, 17)  C
 * [5] (48, 95,  33, 17)  '0'
 * [6] (88, 95,  33, 17)  ← 退格
 * [7] ( 8,119,  33, 17)  '7'   [8] (48,119,33,17) '8'   [9] (88,119,33,17) '9'
 * [10]( 8,143,  33, 17)  '4'   [11](48,143,33,17) '5'   [12](88,143,33,17) '6'
 * [13]( 8,167,  33, 17)  '1'   [14](48,167,33,17) '2'   [15](88,167,33,17) '3'
 * ```
 *
 * ★★ **编号语义 2026-09-16 已解出**（旧注释说「没解出」，可以撤了）：
 *
 * ```asm
 * ; fcn_00452c02 的 0x202（左键抬手）落 loc_00452fce，末尾按序号分派：
 * 004530d6  mov al, [0x48cac2]    ; 钮序号
 * 004530da  sub al, 2
 * 004530dc  cmp al, 0xd           ; ★ 越界闸：序号必须落在 2..0xf
 * 004530de  ja  loc_0045310a      ;   否则只清序号、什么都不做
 * 004530e1  jmp dword [eax*4 + 0x452bca]
 * ```
 * 跳表 `0x452bca`（dump 出来）：
 * `0x4530e9 0x453116 0x453145 0x453189 0x453156 0x453189 ×10`
 * ⇒ 序号 **2**=M(`loc_004530e9`) / **3**=Enter(`0x453116`) / **4**=C(`0x453145`)
 * / **5**=接数字 / **6**=退格(`0x453156`) / **7..0xf**=接数字(`0x453189`)。
 *
 * 「接数字」那一支读的是**字符表 `0x47e714`**（`mov dl, byte [eax + 0x47e714]`，
 * eax = 序号）—— dump 出来 `X.!.` 之后正好是 `'0' '0' '0' '7' '8' '9' '4' '5' '6' '1' '2' '3'`
 * ⇒ 序号 **5/7/8 = '0','7','8'**、**9/10/11 = '9','4','5'**、
 * **12/13/14 = '6','1','2'**、**15 = '3'**。
 * 与 `AMOUNT_KEY_BY_ID` 的十条数字映射**逐条吻合**（那张手抄表得到了独立验证）。
 *
 * 另两条也定了：**0/1** 是**金额栏的左右光标**（不是键盘键）—— 鼠标按下后
 * 序号 1 走 `loc_0045320b` 的拖动支（`cmp dh,1`），键盘则是 `H` → 序号 0x10。
 */
export const AMOUNT_KEY_RECTS: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 16, y: 11, w: 228, h: 7 }, // 0 金额栏光标 ‹
  { x: 17, y: 11, w: 228, h: 7 }, // 1 金额栏光标 ›
  { x: 8, y: 63, w: 58, h: 25 }, // 2 M
  { x: 64, y: 63, w: 57, h: 25 }, // 3 Enter
  { x: 8, y: 95, w: 33, h: 17 }, // 4 C
  { x: 48, y: 95, w: 33, h: 17 }, // 5 '0'
  { x: 88, y: 95, w: 33, h: 17 }, // 6 退格
  { x: 8, y: 119, w: 33, h: 17 }, // 7 '7'
  { x: 48, y: 119, w: 33, h: 17 }, // 8 '8'
  { x: 88, y: 119, w: 33, h: 17 }, // 9 '9'
  { x: 8, y: 143, w: 33, h: 17 }, // 10 '4'
  { x: 48, y: 143, w: 33, h: 17 }, // 11 '5'
  { x: 88, y: 143, w: 33, h: 17 }, // 12 '6'
  { x: 8, y: 167, w: 33, h: 17 }, // 13 '1'
  { x: 48, y: 167, w: 33, h: 17 }, // 14 '2'
  { x: 88, y: 167, w: 33, h: 17 }, // 15 '3'（表外第 16 项）
];

/**
 * 「钮序号 → 那扇窗的**语义**」—— 由跳表 `0x452bca` 定（见 `AMOUNT_KEY_RECTS` 的注释）。
 *
 * 与键盘那一路的 `AMOUNT_KEY_BY_ID` 是**同一套语义**（那张表收的是分派写出的序号），
 * 这里补上它没列的三项：`0`/`1` = 金额栏左右光标（鼠标）、`0xf` = `'3'`。
 */
export type AmountSlot =
  | { readonly kind: 'digit'; readonly digit: number }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'max' }
  | { readonly kind: 'ok' }
  /** 金额栏左光标（鼠标那颗，序号 0）*/
  | { readonly kind: 'cursorLeft' }
  /** 金额栏右光标 / 拖动条（序号 1）*/
  | { readonly kind: 'cursorRight' };

/** 序号 → 语义；`null` = 那扇窗不认（原版 `cmp al,0xd / ja` 那一闸之外）*/
export const AMOUNT_SLOT_BY_ID: ReadonlyMap<number, AmountSlot> = new Map<number, AmountSlot>([
  [0, { kind: 'cursorLeft' }],
  [1, { kind: 'cursorRight' }],
  [2, { kind: 'max' }],
  [3, { kind: 'ok' }],
  [4, { kind: 'clear' }],
  [5, { kind: 'digit', digit: 0 }],
  [6, { kind: 'backspace' }],
  [7, { kind: 'digit', digit: 7 }],
  [8, { kind: 'digit', digit: 8 }],
  [9, { kind: 'digit', digit: 9 }],
  [0xa, { kind: 'digit', digit: 4 }],
  [0xb, { kind: 'digit', digit: 5 }],
  [0xc, { kind: 'digit', digit: 6 }],
  [0xd, { kind: 'digit', digit: 1 }],
  [0xe, { kind: 'digit', digit: 2 }],
  [0xf, { kind: 'digit', digit: 3 }],
]);

/** 原版那一道越界闸：序号必须落在 `2..0xf` 才查跳表 @source `cmp al,0xd / ja` */
export function amountSlotOfId(id: number): AmountSlot | null {
  if (id === 0 || id === 1) return AMOUNT_SLOT_BY_ID.get(id) ?? null;
  if (id < 2 || id > 0xf) return null;
  return AMOUNT_SLOT_BY_ID.get(id) ?? null;
}

/**
 * 一个**舞台坐标**落在面板内哪一颗钮上（面板外返回 `null`）。
 *
 * 原版是查 `Panel.mkf` #0x16 那张**逐像素 id 图**（鼠标 → 窗内坐标 → 取字节），
 * 本引擎没有那张图，故按 `AMOUNT_KEY_RECTS` 做矩形命中 —— 矩形表**就是**
 * 那张 id 图的等价物（都是 15 个可点区域）。
 *
 * ⚠️ 下标 0/1（金额栏的 ‹ / › 光标）**矩形互相重叠**，此时按**表序**取第一个
 *   命中的 —— 原版靠逐像素图上左右两半不同的 id 来分，本表没有那一层信息。
 */
export function amountWindowHit(sx: number, sy: number): number | null {
  const lx = sx - AMOUNT_WINDOW.x;
  const ly = sy - AMOUNT_WINDOW.y;
  for (let i = 0; i < AMOUNT_KEY_RECTS.length; i++) {
    const r = AMOUNT_KEY_RECTS[i];
    if (r === undefined) continue;
    if (lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h) return i;
  }
  return null;
}

export const AMOUNT_KEY_ID_VK: ReadonlyMap<number, number> = new Map<number, number>([
  [0x30, 5],
  [0x31, 0xd],
  [0x32, 0xe],
  [0x33, 0xf],
  [0x34, 0xa],
  [0x35, 0xb],
  [0x36, 0xc],
  [0x37, 7],
  [0x38, 8],
  [0x39, 9],
  [0x08, 6],
  [0x0d, 3],
  [0x43, 4],
  [0x48, 0x10],
  [0x4d, 2],
]);

/** 窗里的一颗钮被按下 —— 就是「序号」对应的语义 */
export type AmountKey =
  /** 数字盘上那 10 颗（序号 5 / 7..0xf）@source 表 `0x47e714` 取字、`loc_00453189` 入位 */
  | { readonly kind: 'digit'; readonly digit: number }
  /** ← 退格（序号 6）@source `loc_00453156` */
  | { readonly kind: 'backspace' }
  /** C 清零（序号 4）@source `loc_00453145` —— **不是取消** */
  | { readonly kind: 'clear' }
  /** M = 最大（序号 2）@source `loc_004530e9` 的 `itoa(10, buf, max)` */
  | { readonly kind: 'max' }
  /** H = 按金额栏（序号 0x10）@source `loc_00452f73` */
  | { readonly kind: 'bar' }
  /** Enter = 確定（序号 3）@source `loc_00453116` 的 `Post_0402_Message(atoi(buf))` */
  | { readonly kind: 'ok' };

/**
 * 填数窗的按键音 —— 表 `0x48234a` = `[7, 0]`（`_rich4_play_sound_effect(0, 0x48234a)`）。
 *
 * @source 键盘：`loc_00452e4b` 把键翻成钮序号后落 0x00452f0e..0x00452f15 放它，再合成 0x202；
 *   鼠标：`WM_LBUTTONDOWN` 按在钮上（序号不是 1 = 拖窗、也不是 0x10 = 金额栏）
 *   0x00452d8e..0x00452d95 放它（gap-audit #13）。
 */
export const AMOUNT_KEY_SOUND = 7;

/**
 * 这一键要放的音效号；不放就 `null` —— 纯函数。
 *
 * ★ `H`（金额栏，序号 0x10）那一支 `loc_00452f73` 自己算好坐标直接跳 0x00452fb9 合成
 *   `WM_MOUSEMOVE`，**不经过** 0x00452f0e ⇒ 没有按键音；鼠标按在金额栏上（0x00452d75 `cmp al, 0x10`）同样不放。
 */
export function amountKeySound(key: AmountKey): number | null {
  return key.kind === 'bar' ? null : AMOUNT_KEY_SOUND;
}

/**
 * **鼠标**按在填数窗第 `id` 号上那一下要放的音 —— 放在**按下**（`WM_LBUTTONDOWN`），不是抬手。
 *
 * @source `fcn_00452c02` 的 0x201 / 0x203 → `loc_00452d0e`：
 * ```asm
 * 00452d5e  mov [0x48cac2], al            ; 记下按在哪一号（抬手只认它）
 * 00452d63  cmp al, 1  / jne 0x452d75     ; 1 = 拖窗：只记坐标，不放音
 * 00452d75  cmp al, 0x10 / jne 0x452d8e   ; 0x10 = 金额栏：合成 WM_MOUSEMOVE，不放音
 * 00452d8e  push 0 / push 0x48234a
 * 00452d95  call _rich4_play_sound_effect  ; ★ 其余 ⇒ 按下这一拍放 7，再贴「按下」图
 * ```
 * 动作本身在**抬手**：`WM_LBUTTONUP`（0x202）落 `loc_00452fce`，照 `[0x48cac2]`（按下时记的）
 * 查跳表 `0x452bca` —— **不再看抬手的坐标**；键盘那一路也是「放 7 → 合成 0x202」进同一段。
 */
export function amountButtonDownSound(id: number): number | null {
  return id === 1 || id === 0x10 ? null : AMOUNT_KEY_SOUND;
}

/**
 * 钮序号 → 语义。序号的**字**来自表 `0x47e714`（`mov dl, byte [eax + 0x47e714]`，
 * eax = 序号）：`[5]='0'`、`[7..9]='7','8','9'`、`[0xa..0xc]='4','5','6'`、
 * `[0xd..0xf]='1','2','3'`；序号 2/3/4/6 由跳表 `0x452bca` 决定：
 * `[0]=0x4530e9`（M）、`[1]=0x453116`（Enter）、`[2]=0x453145`（C）、
 * `[4]=0x453156`（退格）、**其余 10 项 = `0x453189`（接数字）**。
 */
export const AMOUNT_KEY_BY_ID: ReadonlyMap<number, AmountKey> = new Map<number, AmountKey>([
  [5, { kind: 'digit', digit: 0 }],
  [7, { kind: 'digit', digit: 7 }],
  [8, { kind: 'digit', digit: 8 }],
  [9, { kind: 'digit', digit: 9 }],
  [0xa, { kind: 'digit', digit: 4 }],
  [0xb, { kind: 'digit', digit: 5 }],
  [0xc, { kind: 'digit', digit: 6 }],
  [0xd, { kind: 'digit', digit: 1 }],
  [0xe, { kind: 'digit', digit: 2 }],
  [0xf, { kind: 'digit', digit: 3 }],
  [6, { kind: 'backspace' }],
  [4, { kind: 'clear' }],
  [2, { kind: 'max' }],
  [0x10, { kind: 'bar' }],
  [3, { kind: 'ok' }],
]);

/** VK 码 → 窗里的那颗钮；这扇窗不认的键返回 `null` @source `loc_00452e4b` */
export function amountKeyOfVk(vk: number): AmountKey | null {
  const id = AMOUNT_KEY_ID_VK.get(vk);
  return id === undefined ? null : (AMOUNT_KEY_BY_ID.get(id) ?? null);
}

/**
 * 浏览器事件 → VK。`hotkeys.ts` 的 `vkOf()` 只覆盖熱鍵用得上的键，
 * **没有数字与退格**；这里照同一套规则补一份（与 `main.ts` 的 `atmVkOf` 同规则，
 * 因为原版那扇窗认的也是主键盘 `0x30..0x39` + `0x08`）。
 */
export function amountVkOf(e: KeyboardEvent): number | null {
  const v = vkOf(e);
  if (v !== null) return v;
  if (e.code === 'Backspace') return 0x08;
  if (e.code.startsWith('Digit') && e.code.length === 6) {
    const d = e.code.charCodeAt(5) - 0x30;
    if (d >= 0 && d <= 9) return 0x30 + d;
  }
  return null;
}

/**
 * 接一位数字 —— **通用填数窗与銀行 ATM 共用的那一份**。
 *
 * @source 通用窗 `loc_00453189`；ATM `loc_0043787e`（`cmp eax, 0xa`）。
 * 四条规则，逐条对上：
 * 1. 已经满 `maxDigits` 位 → 什么都不做（通用窗 `cmp eax, 9 / jge loc_0045310a`）；
 * 2. 当前是 `"0"` 而又按 `0` → 什么都不做（`cmp byte [0x48caac], 0x30` +
 *    `cmp byte [0x48cac2], 5`）；
 * 3. 当前是 `"0"` 而按的是别的数字 → **顶掉**那个 `0`（`mov dword [esp+0x68], 0`）；
 * 4. 拼完之后若 `atoi(buf) > 上限` → 改写成 `itoa(上限)`（`jle` 不过就走
 *    `loc_004530e9` 的 `itoa(10, buf, max)`）。
 *
 * `digits` 允许是空串（ATM 的「还没输入」就是空串）：空串按 `"0"` 参与判断，
 * 规则 2 命中时原样退回空串。
 *
 * @param digits    当前那串十进制数字
 * @param ch        这一次按下去的数字字符（`'0'..'9'`）
 * @param limit     上限（原版 `[0x48ca98]`）
 * @param maxDigits 位数上限（通用窗 9、ATM 10）
 */
export function appendDigitKey(digits: string, ch: string, limit: number, maxDigits: number): string {
  const cur = digits === '' ? '0' : digits;
  if (cur.length >= maxDigits) return digits;
  if (cur === '0' && ch === '0') return digits;
  const next = (cur === '0' && ch !== '0' ? '' : cur) + ch;
  const n = Number.parseInt(next, 10);
  if (Number.isFinite(n) && n > limit) return String(Math.max(0, Math.trunc(limit)));
  return next;
}

/**
 * 退格 —— 也是两边共用的那一份 @source 通用窗 `loc_00453156`、ATM `loc_0043778c`。
 *
 * 末位删一位；**只剩一位时**不是 `"0"` 就退回 `"0"`、是 `"0"` 就不动
 * （`cmp eax, 1 / jle` + `cmp byte [0x48caac], 0x30 / je`）。
 */
export function backspaceKey(digits: string): string {
  const cur = digits === '' ? '0' : digits;
  return cur.length > 1 ? cur.slice(0, -1) : '0';
}

/**
 * 金额栏按在第 `AMOUNT_BAR_PRESS_STEP` 格上时的值。
 *
 * ★ 直接调 `amountFromBarX(0x40, …)` —— `H` 与**拖动**在 exe 里本来就是同一支
 *   （`loc_00452f73` 伪造的那一发按下最终也落到 `loc_00453470` 的 `fdiv`/`fmul`），
 *   分开写两份迟早会算出两个值。
 */
function barValue(max: number): number {
  return amountFromBarX(AMOUNT_BAR_PRESS.x, max) ?? 0;
}

/** 一次按键的结果 */
export interface AmountKeyResult {
  /** 新的显示值（= 原版那串 `[0x48caac]` 的数值形态）*/
  readonly value: number;
  /** 这一下是不是「確定」（Enter → `Post_0402_Message(atoi(buf))`）*/
  readonly submit: boolean;
}

/**
 * **一次按键 → 新值 / 新状态**。纯函数：只吃 `(当前值, 上限, 键)`。
 *
 * | 键 | 做什么 | 取证 |
 * |---|---|---|
 * | 数字 | 接一位（满 9 位不加、前导 0 顶掉、超上限夹到上限）| `loc_00453189` |
 * | 退格 | 末位删一位；只剩一位且非 0 → `0` | `loc_00453156` |
 * | C | 清零（**不是**取消）| `loc_00453145` |
 * | M | 填成上限 | `loc_004530e9` |
 * | H | 按金额栏：`trunc(上限 × 17 ÷ 33)` | `loc_00452f73` / `loc_00453394` |
 * | Enter | 值不动，**確定** | `loc_00453116` |
 *
 * ⚠️ 取消（`0x205` / ESC）不在这张表里：原版是全局钩子把取消键补成 `WM_RBUTTONUP`
 *    才关的窗（`loc_004534a3`），本引擎那一条在 `panel-cancel.ts` 的梯子上。
 */
export function amountKeyStep(value: number, max: number, key: AmountKey): AmountKeyResult {
  const cur = Math.max(0, Math.trunc(value));
  switch (key.kind) {
    case 'ok':
      return { value: cur, submit: true };
    case 'clear':
      return { value: 0, submit: false };
    case 'max':
      return { value: Math.max(0, Math.trunc(max)), submit: false };
    case 'backspace':
      return { value: Number.parseInt(backspaceKey(String(cur)), 10), submit: false };
    case 'bar':
      return { value: barValue(max), submit: false };
    case 'digit':
      return {
        value: Number.parseInt(appendDigitKey(String(cur), String(key.digit), max, AMOUNT_DIGIT_MAX), 10),
        submit: false,
      };
  }
}
