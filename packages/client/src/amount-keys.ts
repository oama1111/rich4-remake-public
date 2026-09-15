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
 * 按下点落在金额栏第几格 —— 表 `0x47e725` 里第一个 ≥ `0x40 − 0xa` 的项。
 * `0x40 − 0xa = 54`；`table[16] = 53 < 54 ≤ 57 = table[17]` ⇒ **17**
 * @source `loc_00453451` 的循环（`sub ebx, 0xa` 在 `loc_00453413`）。
 */
export const AMOUNT_BAR_PRESS_STEP = 17;

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

/** 金额栏按在第 `AMOUNT_BAR_PRESS_STEP` 格上时的值 @source `loc_00453470`/`loc_00453480` 的 `fdiv`/`fmul` */
function barValue(max: number): number {
  const cap = Math.max(0, Math.trunc(max));
  // 原版：`fild i` → `fdiv 33.0f` → `fmul max` → `__round_toward_zero`（= 向零取整）
  return Math.trunc((cap * AMOUNT_BAR_PRESS_STEP) / AMOUNT_BAR_STEPS);
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
