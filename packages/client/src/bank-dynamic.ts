/*
 * 銀行两屏的**动态部分**（Q-BANK-1 / T-029c）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `bank-screen.ts`（ATM，第 ① 屏）与 `bank-loan.ts`（貸款屏，第 ② 屏）已经把
 * **版式、命中、门槛**按 exe 复刻好了；这里补三块**会动**的东西：
 *
 * 1. **貸款屏进屏的两块滑入面板** —— `fcn_00433d6e`（玩家：头像 + 名字 + 現金/存款/貸款）
 *    与 `fcn_00433f24`（日期 + 星期 + 距還款日），贴法 `(0,y)` / `(280,y)`，
 *    `y` = `[0x48c3d5]`（640 = 全藏屏下 → 440 = 到位）。
 * 2. **貸款屏的状态机** —— `fcn_00435062` 的 `0x401/0x405/0x409/0x40a` 自定义消息
 *    + `0x113` 定时器（`SetTimer(hwnd, 深度, 50ms)`）+ `fcn_00434492` 特別融資子对话框。
 * 3. **ATM 的另外两块** —— `fcn_00436d3a` 开头那条**进度条**（按 `[0x48c3ec]` 换算）、
 *    `0x100` 键盘那一支（原版 ATM 也收键盘）、`0x200`（`loc_00437904`，
 *    **按住金额栏拖动才用它**，不是悬停高亮）。
 *
 * ⚠️ **两处对 `known-deviations.md` 原文的订正**（都是回 exe 核出来的）：
 * - 面板**不是 280×200**：`fcn_00451a5a(0xc8, 0x118, 0, 0)` 建的是
 *   `width=200, height=280`（@source `fcn_00451a5a` 的 `+0` = 宽、`+2` = 高），
 *   与 `Panel.mkf` 资源 23 图 15 的 **200×280** 正好一样大。日期面板才是 200×200。
 * - 「悬停反馈」（`loc_00437904`）**不是高亮**：那支只做一件事 ——
 *   `if ([0x48c40b] != 4) return;` 否则把这次 `WM_MOUSEMOVE` 的 `lParam`
 *   原样转成一条 `WM_LBUTTONDOWN`。也就是**按住金额栏时拖动＝连续点它**（拖进度条）。
 *
 * ## 抠黑（`BANK_KEYED`）
 *
 * 原版 `Panel` 的 SMP 图黑底靠贴图函数抠掉，两支：`fcn_004563f5`（不透明）、
 * `fcn_00456418`/`fcn_004562a5`（跳过 0 值像素，即抠黑）。**逐调用点**抄，
 * 见下面 `BANK_KEYED` 那张表 —— 与 `shop-screen.ts` 的 `SHOP_KEYED` 同一个做法。
 */

import { sceneOfMonth } from '@rich4/core';
import { FINANCE_BORROW, FINANCE_BYE, FINANCE_REPAY } from './bank-loan.ts';
import { appendDigitKey, backspaceKey } from './amount-keys.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import { FONT_FAMILY, clerkTextStyle, drawGdiText } from './font.ts';
import { alignFor } from './hud.ts';
// ★ 店員那几句话的**语音出口**（`#0075` 那一句就在里面）——
//   见 `loanBubbleVoice` 的取证块。
import { playVoiceCode } from './voice-sink.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type BankSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 銀行两屏用到的资源号 @source 入口 `read_mkf` / 各绘制点 */
export const BANK_RES = {
  /** ATM 面板 @source 入口 VA 0x437a18 `read_mkf(panel, 0x18, 0, 0)` */
  atm: 24,
  /** 貸款屏底图 @source 入口 VA 0x4366b2 `read_mkf(panel, 0x17, 0, 0)` */
  loan: 23,
  /** 滑入日期面板的季节底图 @source `fcn_00433f24` 入口 VA 0x4366c? 的 `read_mkf(panel, 2, 0, 0)` */
  date: 2,
} as const;

// ============================================================
//  抠黑表 —— 逐调用点抄，别在调用点手写
// ============================================================

/**
 * 哪几张图要抠黑（= 原版走带透明的 `fcn_00456418` / `fcn_004562a5`）。
 *
 * | 资源 | 图 | 原版走哪支 | 抠黑 | 出处 |
 * |---|---|---|---|---|
 * | 24 ATM | 0 面板底 | `fcn_00456418` | ✓ | 0x436f9d |
 * | 24 ATM | 29 禁止章 | `fcn_00456418` | ✓ | 0x437045 |
 * | 24 ATM | 1/2 提款·存款（选中态）| `fcn_004563f5` | ✗ | 0x437047 / 0x4373b0 |
 * | 24 ATM | 3..18 钮 / 19..28 数字 | `fcn_004563f5` | ✗ | 0x437457 / 0x436dad |
 * | 24 ATM | 4 进度条填充 | `fcn_0045643d`（矩形拷贝）| ✗ | 0x436e1a |
 * | 23 貸款 | 0 店員室 / 2 董事長室 / 15 玩家面板 | 是**目标 surface**；贴屏走 `fcn_004563f5` | ✗ | 0x434403 / 0x4351?? |
 * | 23 貸款 | 1 百叶窗 | `fcn_004562a5` | ✓ | 0x434230 |
 * | 23 貸款 | 16/18 董事長那三张小钮 | `fcn_004562a5` | ✓ | 0x434292 / 0x4342d0 |
 * | 23 貸款 | 20 特別融資表单 | `fcn_00456280` | ✗ | 0x434273 |
 * | 23 貸款 | 21 对话气泡 | `fcn_0044ecb6`（`fcn_0044ec30` 存的图）| ✓ | 0x434462 |
 * | 23 貸款 | 23 禁止章 | `fcn_004562a5` | ✓ | 0x434209 / 0x434333 |
 * | 2 日期 | 0..3 季节底图 | `fcn_00456280`（拷进 surface）| ✗ | 0x433f7a |
 */
export const BANK_KEYED: ReadonlyMap<string, ReadonlySet<number>> = new Map([
  [`Panel.mkf:${BANK_RES.atm}`, new Set<number>([0, 29])],
  [`Panel.mkf:${BANK_RES.loan}`, new Set<number>([1, 16, 18, 21, 23])],
  [`Panel.mkf:${BANK_RES.date}`, new Set<number>()],
]);

/** 该图要不要抠黑 */
export function bankKeyed(archive: ArchiveName, resource: number, index: number): boolean {
  return BANK_KEYED.get(`${archive}:${resource}`)?.has(index) ?? false;
}

/**
 * 取一张銀行屏的图 —— **抠不抠黑由 `BANK_KEYED` 说了算**，别在调用点手写。
 * 与 `shop-screen.ts` 的 `shopSprite()` 同一个做法。
 */
export function bankSprite(
  sprite: BankSprite,
  archive: ArchiveName,
  resource: number,
  index: number,
): Sprite | null {
  return sprite(archive, resource, index, bankKeyed(archive, resource, index));
}

// ============================================================
//  ATM：进度条（`fcn_00436d3a` 开头那一段）
// ============================================================

/**
 * 进度条几何 @source `fcn_00436d3a`：
 * ```asm
 * 00436e1a  fcn_0045643d(屏, 图4(204×26), 118, 210, 0, 0, ebx, 26)   ; 填充：宽 = ebx
 * 00436e48  fcn_0045643d(屏, 图0, 118+ebx, 210, 58+ebx, 139, 204−ebx, 26) ; 空余部分还原
 * 00436ed3  InvalidateRect({118,172,324,236})
 * 00436e48  cmp ebp, 0xcc                        ; ★ 204 = 满格
 * ```
 * `118 = 0x76`、`210 = 0xd2`、`204 = 0xcc`、`26 = 0x1a`；
 * 空余部分从**图 0** 的 `(58,139)` 起还原（面板局部坐标）。
 */
export const ATM_BAR = {
  x: 0x76,
  y: 0xd2,
  w: 0xcc,
  h: 0x1a,
  /** 填充图 = 资源 24 图 4（204×26）@source `[0x48c3f4]+0x3c` */
  fillImage: 4,
  /** 空余部分从图 0 的这一点起还原 @source `push 0x8b / push 0x3a+ebx` */
  emptySrcX: 0x3a,
  emptySrcY: 0x8b,
} as const;

/**
 * `pct = trunc(金额 / 上限 × 34)` @source `fcn_00436d3a`：
 * ```asm
 * 00436d3a  eax = atoi([0x48c3f8])
 * 00436dde  fild eax / fild [0x48c3ec] / fdivp   ; 金额 ÷ 上限
 * 00436e??  fmul dword [0x464bd0]                ; × 34.0
 * 00436df2  call __round_toward_zero             ; 向零取整
 * ```
 * ★ 比例常数是 **34.0**（不是 100）—— 一格 = 6 像素，`34 × 6 = 204` 正好是条宽。
 *
 * ⚠️ 上限为 0 时原版会得到 `0/0 = NaN` → 取整成 `0x80000000` → 再 ×6 溢出；
 *   本引擎直接返回 0（原版这一步只会在「上限 0 且金额 0」时走到，条本来就是空的）。
 */
export const ATM_PCT_SCALE = 34;
/** 一格 6 像素 @source `fcn_00436d3a` 的 `lea eax,[edx*4] / sub / add eax,eax` */
export const ATM_PCT_STEP = 6;

export function atmPercent(amount: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.trunc((Math.trunc(amount) / Math.trunc(limit)) * ATM_PCT_SCALE);
}

/** 进度条填充宽度（像素） */
export function atmBarWidth(pct: number): number {
  return Math.max(0, Math.min(ATM_BAR.w, Math.trunc(pct) * ATM_PCT_STEP));
}

// ============================================================
//  ATM：键盘（`0x100` → `loc_004374ac`）
// ============================================================

/**
 * `WM_KEYDOWN` 的 `wParam`（VK 码）→ 按下的是哪颗钮（原版 `[0x48c40b]` = 钮序号 + 1）。
 *
 * @source `loc_004374ac` 的两层跳表（0x4374ac..0x437618）：
 *
 * | VK | 键 | 钮序号 | 图 | 语义 |
 * |---|---|---|---|---|
 * | 0x37..0x39 | 7 8 9 | 4..6 | 5..7 | 数字 |
 * | 0x34..0x36 | 4 5 6 | 7..9 | 8..10 | 数字 |
 * | 0x31..0x33 | 1 2 3 | 10..12 | 11..13 | 数字 |
 * | 0x30 | 0 | 14 | 15 | 数字 |
 * | 0x43 | C | 13 | 14 | 清空 |
 * | 0x08 | Backspace | 15 | 16 | 退格 |
 * | 0x4d | M | 16 | 17 | MAX |
 * | 0x0d | Enter | 17 | 18 | ↵ 確認 |
 * | 0x48 | H | 3 | 4 | ★ 合成一次金额栏点击（`lParam = (223<<16)\|220`）|
 *
 * ★ 键按下后原版会 `PostMessage(hwnd, 0x202, 0, 0)`（假抬手）——
 *   于是**键盘这一支走的完全是抬手那套分发**，与鼠标共用同一条路。
 */
export const ATM_KEY_VK: ReadonlyMap<number, number> = new Map<number, number>([
  [0x37, 5],
  [0x38, 6],
  [0x39, 7],
  [0x34, 8],
  [0x35, 9],
  [0x36, 10],
  [0x31, 11],
  [0x32, 12],
  [0x33, 13],
  [0x30, 15],
  [0x43, 14],
  [0x08, 16],
  [0x4d, 17],
  [0x0d, 18],
  [0x48, 4],
]);

/** 这个 VK 码对应哪个「按下码」；无关的键返回 null @source `loc_004374ac` */
export function atmCodeOfKey(vk: number): number | null {
  return ATM_KEY_VK.get(vk) ?? null;
}

/**
 * 拖进度条时点到了哪里（`loc_00437904` 转发出来的那次点击的金额）。
 *
 * @source `loc_00437413`：
 * ```asm
 * 00437576  esi -= 0x3a          ; esi 此刻 = 屏 x − 0x3c ⇒ esi = 屏 x − 118 = 条内 x
 * 00437577  if (esi < 0)   → 0
 * 00437583  if (esi >= 0xcc) → [0x48c3ec]（上限）
 * 0043743d  ebx = esi / 6
 * 00437455  eax = 上限 / 34
 * 00437460  ebx = (ebx + 1) * (eax + 1)      ; ★ 两个 +1 都是原版的，照抄
 * 0043746f  if (ebx > 上限) ebx = 上限
 * ```
 */
export function atmSeekAmount(barX: number, limit: number): number {
  if (barX < 0) return 0;
  if (barX >= ATM_BAR.w) return limit;
  const a = Math.trunc(barX / ATM_PCT_STEP) + 1;
  const b = Math.trunc(limit / ATM_PCT_SCALE) + 1;
  return Math.min(limit, a * b);
}

/**
 * 抬手分发的**纯函数**版（@source `loc_0043762d` 的跳表，`code` = 钮序号 + 1）。
 *
 * | code | 钮 | 做什么 |
 * |---|---|---|
 * | 1 / 2 | 提款 / 存款 | 抬手什么都不做（模式在**按下**时就换了）|
 * | 3 | EXIT | 不在这里处理（调用方关屏）|
 * | 4 | 金额栏 | 不在这里处理（拖动由 `atmSeekAmount` 算）|
 * | 5..13 / 15 | 数字 7 8 9 4 5 6 1 2 3 / 0 | 接上去（到上限就截到上限）|
 * | 14 | C | 清空 |
 * | 16 | ← | 退格 |
 * | 17 | MAX | 填成上限 |
 * | 18 | ↵ | 不在这里处理（调用方发 action）|
 *
 * `digits` 口径与 `bank-screen.ts` 的 `AtmState.digits` 一致（空串 = 还没输入）。
 *
 * ★ 数字与退格那两条**不是这一扇窗独有的**：通用填数窗（`fcn_00453544` 的
 *   `loc_00453189` / `loc_00453156`）逐条一模一样，只有位数上限不同
 *   （ATM 10 位 / 通用窗 9 位）。故那两条走 `amount-keys.ts` 的
 *   `appendDigitKey` / `backspaceKey` —— 两扇窗**共用同一份纯函数**。
 */
export function atmApplyCode(digits: string, code: number, limit: number): string {
  const btn = code - 1;
  switch (btn) {
    case 13: // C
      return '0';
    case 15: // ← 退格 @source 0x43778c：只有一位且不是 '0' 才退回 '0'
      return backspaceKey(digits);
    case 16: // MAX
      return String(Math.max(0, Math.trunc(limit)));
    case 17: // ↵
      return digits;
    default:
      break;
  }
  if (btn < 4 || btn > 14) return digits; // 越界 / 模式钮 / 金额栏
  // 数字盘（图 5..16 上印的字）@source 表 0x475914：4..12 = 7 8 9 4 5 6 1 2 3、14 = '0'
  const ch = ATM_DIGIT_CHAR[btn];
  if (ch === undefined) return digits;
  // @source 0x43787e：满 10 位不再接；开头是 '0' 且这次不是 '0' 就顶掉它；
  // @source 0x4378c2：超过上限就填成上限 —— 与通用填数窗同一份
  return appendDigitKey(digits, ch, limit, ATM_DIGIT_MAX);
}

/** 钮序号 → 那个键上印的字 @source 表 `0x475914`：`4..12 = 7 8 9 4 5 6 1 2 3`、`14 = '0'` */
const ATM_DIGIT_CHAR: Readonly<Record<number, string>> = {
  4: '7',
  5: '8',
  6: '9',
  7: '4',
  8: '5',
  9: '6',
  10: '1',
  11: '2',
  12: '3',
  14: '0',
};
/** 最多 10 位 @source `loc_0043787e` 的 `cmp eax, 0xa` */
export const ATM_DIGIT_MAX = 10;

/**
 * `0x200`（`WM_MOUSEMOVE`）那一支的**全部**语义 @source `loc_00437904`：
 * 只有「正按着金额栏」（`[0x48c40b] == 4`）时，才把这次移动**当成一次点击**
 * 重发给窗口（`PostMessage(hwnd, 0x201, 0, lParam)`）—— 也就是拖进度条。
 *
 * ★ 原版 ATM **没有**悬停高亮。
 */
export function atmDragToClick(pressed: number | null): number | null {
  return pressed === 4 ? 4 : null;
}

// ============================================================
//  ATM：这一帧要画什么（选中态 / 按下态）
// ============================================================

/** 按下的「码」→ 该画哪张图（在哪颗钮上）@source `loc_004371f9` 的 `[ebx+1]` */
export function atmPressedImage(code: number): number | null {
  // code 4 = 金额栏：原版先贴满格图 4，紧接着拖动那次 `fcn_00436d3a` 又会重画 ——
  // 本引擎每帧重画，所以这里不画，直接由进度条自己表达
  if (code < 1 || code > 18 || code === 4) return null;
  return code;
}

/** 正被按住的钮序号（0 基）；不是钮返回 null */
export function atmPressedButton(code: number | null): number | null {
  if (code === null || code < 1 || code > 18) return null;
  return code - 1;
}

// ============================================================
//  貸款屏：两块滑入面板
// ============================================================

/**
 * 玩家面板（`Panel.mkf` 资源 23 **图 15**，200×280）。
 *
 * @source `_rich4_ui_bank_entry` VA 0x4366d0 起：
 * ```asm
 * fcn_00451a5a(0xc8, 0x118, 0, 0)   ; ★ allocate_graph_st(宽=200, 高=280)
 * fcn_00451a5a(0xc8, 0xc8, 0, 0)    ; 日期面板 200×200
 * ```
 * `fcn_00433d6e` 把图 15 原样拷进第一个 surface 的 (0,0)（锚点 (0,0)，正好铺满）。
 */
export const LOAN_INFO_PANEL = {
  resource: BANK_RES.loan,
  image: 15,
  x: 0,
  w: 200,
  h: 280,
} as const;

/** 日期面板落点与尺寸 @source `fcn_00433f24`（贴屏时 x = 0x118 = 280）*/
export const LOAN_DATE_PANEL = { x: 0x118, w: 200, h: 200 } as const;

/**
 * 月份 → 季节底图（资源 2 图 0..3）@source 表 `0x475218`：
 * `[3,0,0,0,1,1,1,2,2,2,3,3]`（下标 = 月 − 1）。
 * ★ 与 `@rich4/core` 的 `sceneOfMonth` 是同一张表，这里不再抄一份。
 */
export const LOAN_INFO_TEXT = {
  /** 头像：`[0x498eb0 + 0x34×玩家] + 0xc`（= `map.mkf` 资源 `角色+0x1b` 图 0），锚点落 (0x2a,0x28) */
  avatar: { x: 0x2a, y: 0x28 },
  /** 角色名 @source `draw_text(name, 0x52, 0x1c, flag 0)`，22 号 */
  name: { x: 0x52, y: 0x1c, size: 0x16 },
  /** 三行标签 @source 三次 `draw_text(col, 0xa, …, 0)`，12 号白字 */
  labelX: 0x0a,
  labelSize: 0x0c,
  /** 三个数值 @source `draw_text("$"+数字, 0xb4, …, flag 1)`，仍是 22 号那支字体 */
  valueX: 0xb4,
  valueSize: 0x16,
  /** 标签 y / 数值 y（原版逐条写的）@source `fcn_00433d6e` */
  rows: [
    { label: '現  金', labelY: 0x50, valueY: 0x64 },
    { label: '存  款', labelY: 0x91, valueY: 0xa4 },
    { label: '貸  款', labelY: 0xd0, valueY: 0xe4 },
  ],
} as const;

/**
 * 日期面板上的字 @source `fcn_00433f24`（落点都是**面板局部**坐标）：
 *
 * | 是什么 | 落点 | 字号 | flag | 对齐 |
 * |---|---|---|---|---|
 * | 日 | (0x3c,0x60) | 0x3c = 60 | 2 | 正中 |
 * | 星期 | (0x0e,0x48) | 0x10 = 16 | 3 | 正中 |
 * | 年 | (0x8c,0x08) | 0x18 = 24 | 0 | 左上 |
 * | 月 | (0x3c,0x30) | 0x1c = 28 | 2 | 正中（`sprintf("%d月")`）|
 * | 距還款日 | (0x14,0xb0) | 0x14 = 20 | 5 | 左·垂直居中 |
 */
export const LOAN_DATE_TEXT = {
  day: { x: 0x3c, y: 0x60, size: 0x3c, flag: 2 },
  week: { x: 0x0e, y: 0x48, size: 0x10, flag: 3 },
  year: { x: 0x8c, y: 0x08, size: 0x18, flag: 0 },
  month: { x: 0x3c, y: 0x30, size: 0x1c, flag: 2 },
  due: { x: 0x14, y: 0xb0, size: 0x14, flag: 5 },
} as const;

/** 星期名表 @source `0x47511c`（7 个串指针，0 = 星期日）*/
export const LOAN_WEEKDAY: readonly string[] = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
];

/** 「距還款日%d天」@source 串 `0x464a74` */
export const LOAN_DUE_TEXT = '距還款日%d天';

/**
 * 玩家头像的取图口径 @source `fcn_00433d6e`：
 * ```asm
 * 00433d9a  imul eax, [0x49910c], 0x34
 * 00433da1  mov  eax, [eax + 0x498eb0]     ; 该玩家的角色图集
 * 00433da7  add  eax, 0xc                  ; 图 0
 * 00433db2  call fcn_004562a5              ; ★ 带透明（跳 0 值像素）
 * ```
 * `[0x498eb0 + 0x34×p]` 就是 `read_mkf(map.mkf, 角色 + 0x1b)`（@source
 * `rich4-re/csrc/loadsave.c:247`），即 `portraitResource(character)`。
 */
export const LOAN_AVATAR = { archive: 'map.mkf' as ArchiveName, base: 0x1b, image: 0 } as const;

/** 取某角色的头像图（抠黑由这里定，别在调用点手写）*/
export function loanAvatar(sprite: BankSprite, character: number): Sprite | null {
  return sprite(LOAN_AVATAR.archive, LOAN_AVATAR.base + character, LOAN_AVATAR.image, true);
}

// ============================================================
//  貸款屏：滑入（`[0x48c3d5]` / `[0x48c3d9]`）
// ============================================================

/**
 * @source
 * ```asm
 * 00435116  mov dword [0x48c3d5], 0x280     ; 进屏：y = 640（整块在屏下）
 * 00435d48  mov dword [0x48c3d5], 0x280     ; 点「申請貸款」：再来一次
 * 00435d4c  mov dword [0x48c3d9], 0xffffffd8 ; dy = −40（每拍往上 40）
 * 00435da4  mov dword [0x48c3d9], 0xffffffd8 ; 点「償還貸款」同上
 * 004357a7  mov dword [0x48c3d9], 0x28      ; 收尾：dy = +40
 * 004357ab  mov dword [0x48c3d5], 0x1b8     ; 从 440 往下退
 * 004355e3  cmp dword [0x48c3d5], 0x1b8     ; 到位（y == 440）→ dy = 0
 * 00435601  cmp dword [0x48c3d5], 0x280     ; 退净（y == 640）→ dy = 0
 * ```
 * ⚠️ **到位是 y = 440，不是 0** —— 200×280 的面板从屏下升上来，
 *   露出的是它**下面**那 40 行？不：面板是贴在 `(0, y)`、即 y 是**顶边**，
 *   所以静止时只在屏底露出 40 像素…… 这正是原版的数：面板是**滑出来一半**
 *   贴在屏幕下缘的（`y = 440` 时 200×280 的顶边在 440）。
 *   ★ 本引擎照抄这个数，不做「看起来更合理」的调整。
 */
export const LOAN_SLIDE = {
  /** 藏起来时的 y（也是退净的终点）*/
  hidden: 0x280,
  /** 到位时的 y */
  shown: 0x1b8,
  /** 每一拍走的像素（方向由 `dy` 的符号决定）*/
  step: 0x28,
} as const;

/**
 * 定时器节拍。
 *
 * `SetTimer(hwnd, nIDEvent=[0x46cad8], uElapse=0x32, NULL)` —— **nIDEvent 是
 * 当前模态深度**（`_callbackSize`，`_rich4_start_game_loop` 里 `++`），
 * `uElapse = 0x32 = 50ms`，`WM_TIMER` 里再拿 `wParam == [0x46cad8]` 认领。
 * 所以贷款屏是 **50ms 一拍**（与商店那支隔一拍才动不同）。
 * @source `_rich4_ui_bank_entry` VA 0x4368?；`fcn_00435062` 的 `0x113` 分支
 */
export const LOAN_TICK_MS = 50;

/** 滑入状态：面板顶边 y 与每拍步长 */
export interface LoanSlide {
  y: number;
  dy: number;
}

/** 进屏 → 点「申請/償還」时滑出来 @source `loc_00435d48` */
export function loanSlideIn(): LoanSlide {
  return { y: LOAN_SLIDE.hidden, dy: -LOAN_SLIDE.step };
}

/** 收尾 → 滑回去 @source `loc_004357a7` */
export function loanSlideOut(): LoanSlide {
  return { y: LOAN_SLIDE.shown, dy: LOAN_SLIDE.step };
}

/**
 * 走一拍。
 *
 * ★ 原版在**到位的那一拍**就把 `[0x48c3d9]` 归零（`loc_004355f7`），所以
 *   从这里出去的状态要么还在动、要么已经停住 —— 不会像商店那样冲过头。
 */
export function loanSlideStep(s: LoanSlide): LoanSlide {
  if (loanSlideDone(s)) return s;
  const y = s.y + s.dy;
  if (s.dy < 0 && y <= LOAN_SLIDE.shown) return { y: LOAN_SLIDE.shown, dy: 0 };
  if (s.dy > 0 && y >= LOAN_SLIDE.hidden) return { y: LOAN_SLIDE.hidden, dy: 0 };
  return { y, dy: s.dy };
}

/** 停住了吗（`dy == 0`）*/
export function loanSlideDone(s: LoanSlide): boolean {
  return s.dy === 0;
}

/** 面板贴到屏上了吗（y 还没到 640 就有东西露出来）*/
export function loanPanelsVisible(s: LoanSlide): boolean {
  return s.y < LOAN_SLIDE.hidden;
}

// ============================================================
//  貸款屏：状态机（`[0x48c3dd]`）
// ============================================================

/**
 * 状态值 —— 逐条 dump 自 `fcn_00435062` 里对 `[0x48c3dd]` 的写法。
 *
 * | 值 | 名字 | 什么时候 | 气泡 |
 * |---|---|---|---|
 * | 0 | idle | 还没铺场 | — |
 * | 1 | greet | `0x405`（若 `cfg[1] != 0`）| #0075 歡迎光臨 |
 * | 3 | menu | 招呼看完 / 点一下跳过 | #0076 需要我為您服務嗎 |
 * | 4 | ready | #0076 看完 —— **只有这个状态受理点钮** | — |
 * | 5 | borrowIn | 点「申請貸款」，表单滑入 | #0078 / #0081 |
 * | 6 | borrowAsk | 滑入完，`PostMessage(0x409)` 开填数页 | — |
 * | 7 | borrowDone | 借到手 | #0079 |
 * | 8 | settle | 收尾（借款/还款都汇到这里）| #0080 / #0084 |
 * | 9 | repayIn | 点「償還貸款」，表单滑入 | #0082 |
 * | 0xa | repayAsk | 滑入完，`PostMessage(0x40a)` 开填数页 | — |
 * | 0xb | bye | 说再见 → 关屏 | #0085 |
 */
export const LOAN_ST = {
  idle: 0,
  greet: 1,
  menu: 3,
  ready: 4,
  borrowIn: 5,
  borrowAsk: 6,
  borrowDone: 7,
  settle: 8,
  repayIn: 9,
  repayAsk: 0xa,
  bye: 0xb,
} as const;

/**
 * 店員要说的话 —— 逐条 dump 自 `rich4.exe` 的串表（`0x48c3xx` 里存的就是这些指针）。
 *
 * | @source | 串号 | 什么时候 |
 * |---|---|---|
 * | `0x475830` | #0075 | 进屏招呼（`0x405`，`cfg[1] != 0`）|
 * | `0x475834` | #0076 | 招呼之后 / 跳过招呼 |
 * | `0x47583c` | #0078 | 点「申請貸款」（额度还够）|
 * | `0x475840` | #0079 | 借到手 |
 * | `0x475844` | #0080 | 借款收尾（「請於三個月內還清貸款」）|
 * | `0x475848` | #0081 | 点「申請貸款」但已到额度 |
 * | `0x47584c` | #0082 | 点「償還貸款」|
 * | `0x475850` | #0083 | 还款金额超过手头现金 |
 * | `0x475854` | #0084 | 还款完成 |
 * | `0x475858` | #0085 | 离开 |
 *
 * ★ 串首的 `#00xx` 是 `draw_text` 的**颜色控制码**（`0x44fb00` 的 `cmp ah,'#'`），
 *   不是显示内容 —— 这里按 `raw` 原样留着、`text` 去掉它给气泡排字用。
 */
export const LOAN_MSG = {
  greet: { id: 0x75, raw: '#0075歡迎光臨\n大富翁銀行！', text: '歡迎光臨\n大富翁銀行！' },
  menu: { id: 0x76, raw: '#0076需要我為您\n服務嗎？', text: '需要我為您\n服務嗎？' },
  askBorrow: { id: 0x78, raw: '#0078請輸入您要貸款\n的金額！', text: '請輸入您要貸款\n的金額！' },
  borrowDone: { id: 0x79, raw: '#0079您的貸款手續\n已經完成。', text: '您的貸款手續\n已經完成。' },
  borrowSettle: { id: 0x80, raw: '#0080請於三個月內\n還清貸款。', text: '請於三個月內\n還清貸款。' },
  overLimit: { id: 0x81, raw: '#0081很抱歉！\n金額已超過\n許可額度。', text: '很抱歉！\n金額已超過\n許可額度。' },
  askRepay: { id: 0x82, raw: '#0082請輸入您預備\n還款的金額！', text: '請輸入您預備\n還款的金額！' },
  noCash: { id: 0x83, raw: '#0083很抱歉！\n您的現金不足。', text: '很抱歉！\n您的現金不足。' },
  repayDone: { id: 0x84, raw: '#0084您的還款手續\n已完成。', text: '您的還款手續\n已完成。' },
  bye: { id: 0x85, raw: '#0085謝謝您的惠顧！', text: '謝謝您的惠顧！' },
  // ── 特別融資子对话框（`fcn_00434492`，董事長室）自己的六句 ──
  //    @source 串表指针：0x47585c / 0x475860 / 0x475864 / 0x475868 / 0x47586c / 0x475870
  //    ⚠️ 图 21 @(240,80) 是**主屏**的气泡；子对话框那张是图 **22** @(214,50)
  //       —— 见 `LOAN_FINANCE_BUBBLE`，本引擎把两屏合成一屏，故气泡混用一处（已登记）。
  financeGreet: { id: 0x86, raw: '#0086董事長親自蒞臨\n不知有何指教？', text: '董事長親自蒞臨\n不知有何指教？' },
  financeAskBorrow: { id: 0x87, raw: '#0087請輸入您要\n週轉的金額∼', text: '請輸入您要\n週轉的金額∼' },
  financeNoCash: { id: 0x88, raw: '#0088行裡現在沒有\n這麼多現金。', text: '行裡現在沒有\n這麼多現金。' },
  financeAskRepay: { id: 0x89, raw: '#0089請輸入您要\n還款的金額∼', text: '請輸入您要\n還款的金額∼' },
  financeNoDebt: { id: 0x90, raw: '#0090董事長您別開玩笑了∼', text: '董事長您別開玩笑了∼' },
  financeBye: { id: 0x91, raw: '#0091董事長慢走！', text: '董事長慢走！' },
} as const;
export type LoanMsg = (typeof LOAN_MSG)[keyof typeof LOAN_MSG];

/**
 * 貸款屏換了一句台詞 → 走**语音出口**（`playVoiceCode`）。返回这一次到底播没播。
 *
 * ## 为什么是「换一句播一次」，以及原版在哪播
 *
 * 原版那 16 句话（主屏 10 句 `0x475830..0x475858` + 特別融資子对话框 6 句
 * `0x47585c..0x475870`）**都不是直接画到屏上的**：每一句都先把串指针压栈，
 * 再汇到同一支气泡绘制函数。以**进屏那一句招呼**为例，
 * `@source` `fcn_00435062` 的 `0x405` 分支：
 *
 * ```asm
 * 00435200  cmp  byte ptr [0x497159], 0     ; RICH4.CFG+1 = 動畫過程
 * 00435207  je   0x43521c                    ; 关掉 ⇒ st=3，不招呼
 * 00435209  mov  byte ptr [0x48c3dd], 1      ; st = greet
 * 00435210  mov  esi, dword ptr [0x475830]   ; ★ #0075「歡迎光臨 大富翁銀行！」
 * 00435216  push esi
 * 00435217  jmp  0x435d8c
 * 00435d8c  call 0x44ecb6                    ; ★ 气泡绘制/排版（参数 = 串指针）
 * ```
 *
 * 而 `0x44ecb6` 在 `0x0044edae` 调 `rich4_draw_text`（`0x44fabc`），
 * 后者认出串首的 `'#'`（`@source 0x0044fb00 cmp ah, 0x23`）就把**紧跟的 4 位数字**
 * 解析成语音号，并 `@source 0x0044fb4e call 0x45441a`（`play_speech`，
 * 从 `Speaking.mkf` 取那一段播），随后 `0x44fb56 add ebx, 5` 跳过前缀继续画字。
 * ⇒ 原版是「**换一句就播一次**」，**不是**每帧播（`0x44ecb6` 只在换句那一拍被调）。
 *
 * ★ **只有貸款屏（第 ② 屏）有语音**：ATM 那一屏（`_rich4_ui_bank_atm_entry`，
 *   VA 0x4379c9）的函数体里**一处 `0x44ecb6` / `0x44fabc` / `0x45441a` 都没有**
 *   （逐条列出该函数的 `call` 即可复核），也没有别的文本气泡 ⇒ 进 ATM 时原版不发声。
 *
 * ★ **本引擎的调用点**（与 `main.ts` 写 `loanBubbleAt` 的那一处同源）：
 *   `syncLoanUi`（进屏那一句）与 `loanEffect`（状态机换句）。绘制链
 *   （`drawLoanBubble`）**一处都不许调它** —— 那是整屏每帧重画，会变成每帧一声
 *   （与 `magic-screen.ts` 踩过的同一个坑同源）。
 *
 * ⚠️ 真正的去抖在 `main.ts` 注册的 sink 里（`audio.ts` 的 `shouldRetriggerVoice`，
 *   同一句还在响就不再起播）—— 本函数只管「这一拍是不是换了句」。
 *
 * @param prev 上一句（`null` = 这一屏刚开、还没有上一句）
 * @param next 这一拍该说的那句（`null` = 不说）
 * @returns 真的把它送进语音出口了 → true
 */
export function loanBubbleVoice(prev: LoanMsg | null, next: LoanMsg | null): boolean {
  if (next === null || prev === next) return false;
  playVoiceCode(next.raw);
  return true;
}

/** 气泡底图与落点 @source `fcn_00434186` 尾：`fcn_0044ec30(图21, 0xf0, 0x50, 0x14, 0, 0x101010, 0)` */
export const LOAN_BUBBLE = {
  image: 21,
  x: 0xf0,
  y: 0x50,
  /** 字心偏移：`x + w/2 + dx`、`y + h/2 + dy` @source 那两个 arg 存进 `[0x48c618]`/`[0x48c62c]` */
  dx: 0x14,
  dy: 0,
  size: 0x14,
  color: '#101010',
} as const;

/** 气泡寿命 —— 与商店同一支 `fcn_0044ee18` @source `cmp eax, 0x7d0` */
export const LOAN_BUBBLE_MS = 2000;

/**
 * **特別融資子对话框**自己那张气泡底图与落点。
 *
 * @source `fcn_00434492` 的建屏那一支（`loc_004345ac`）：
 * ```asm
 * mov eax, [0x48c3c0] / add eax, 0x114      ; ★ 图 22（0x114 = 0xc + 22×12）
 * push 0 / push 0x101010 / push -0xa / push 0 / push 0x32 / push 0xd6
 * call fcn_0044ec30                          ; 落点 (0xd6, 0x32) = (214, 50)，字心再 (0, -10)
 * ```
 * ⚠️ 与主屏那张（图 21 @(240,80)，见 `LOAN_BUBBLE`）**不是同一张**。
 *   本引擎把董事長室与子对话框合成了同一屏（见 `bank-loan.ts` 的 `chairman` 分支，
 *   闸门是 `LoanUi.financeOpen`），故两套气泡共用一处落点 —— 已在 T-029 登记为已知近似。
 */
export const LOAN_FINANCE_BUBBLE = { image: 22, x: 0xd6, y: 0x32, dy: -0x0a } as const;

/** 填数页要开的是哪一支（`openForm` 的 op）*/
export type LoanFormOp = 'borrow' | 'repay' | 'financeBorrow' | 'financeRepay';

/** 貸款屏这一刻的界面状态（对应原版那一串全局）*/
export interface LoanUi {
  /** `[0x48c3dd]` */
  st: number;
  /** 正在说的那句话（`null` = 不说）*/
  bubble: LoanMsg | null;
  /** `[0x48c3d5]` / `[0x48c3d9]` */
  slide: LoanSlide;
  /** `[0x48c3e1]`：正被按住的钮（1 基；0 = 没按）*/
  pressed: number;
  /** `[0x48c3e2]`：特別融資子对话框确认过没有（= 那一下的返回标志 `[0x48c3d0]`）*/
  financeOk: boolean;
  /**
   * 这一刻填数页要开哪一支（`borrowIn`/`repayIn` 那两格共用一段代码，
   * 光看 `st` 分不出「一般貸款」还是「特別融資」）。
   *
   * ★ 这个字段是**必须的**：先前 `bubbleEnd` 那条路上把 op 写死成 `'borrow'`，
   *   于是董事長点「週轉現金」→ 气泡说完那一刻**又开了一次一般貸款的填数页**
   *   （`openLoanAmount('borrow')` 会按 op 重新找选项、把已开的那页换掉），
   *   结果钱记进 `loan` 而不是 `specialFinance` —— 真机上抓到的。
   */
  formOp: LoanFormOp | null;
  /**
   * 特別融資子对话框开着没有（主屏状态 `[0x48c3dd] = 0xa`）。
   *
   * ★ 原版那扇子是**另一个模态窗口**（`Wait_0402_Message(fcn_00434492)`），
   *   点「窗」之前它不在：那时三条数额的**数字**不画、三颗小钮**点了没反应**。
   *   本引擎两屏合一，于是拿这一位当那道闸。
   * @source `loc_00435ddb`（`[0x48c3e0] != 0` → 状态 0xa → 开子对话框）
   */
  financeOpen: boolean;
}

/**
 * 进屏。
 *
 * @source `fcn_00435062` 的 `0x401`（铺场）+ `0x405`（反应）：
 * ```asm
 * 00435116  [0x48c3e0] = wParam（董事長）; 状态全清 ; [0x48c3d5] = 0x280
 * 00435149  fcn_00434186()                 ; 铺底图
 * 00435161  SetTimer(hwnd, 深度, 50ms)
 * 00435166  PostMessage(0x405)
 * 00435197  （0x405）若 player+0x3c != 0 → 盖禁止章 + 「銀行暫停放款 還剩%d天！」
 * 00435200  if (cfg[1] != 0) { st = 1 ; 气泡 #0075 } else st = 3
 * ```
 * @param showGreeting `cfg[1] != 0`（要不要播那句招呼）
 */
export function loanStart(showGreeting: boolean): LoanUi {
  return {
    st: showGreeting ? LOAN_ST.greet : LOAN_ST.menu,
    bubble: showGreeting ? LOAN_MSG.greet : null,
    slide: { y: LOAN_SLIDE.hidden, dy: 0 },
    pressed: 0,
    financeOk: false,
    financeOpen: false,
    formOp: null,
  };
}

/** 状态机发出的**副作用**（纯函数只描述，不执行）*/
export type LoanEffect =
  /** 开通用填数页（原版 `PostMessage(0x409/0x40a)` → `fcn_00453544`）*/
  | { kind: 'openForm'; op: 'borrow' | 'repay' | 'financeBorrow' | 'financeRepay' }
  /**
   * 子对话框收摊并把返回标志交给主屏 @source `loc_0043490f` 的
   * `Post_0402_Message([0x48c3d0])` —— 原版是**自己给自己发消息**，
   * 这里同样绕一圈（`main.ts` 收到就再喂一次 `financeClosed`）。
   */
  | { kind: 'financeClosed'; ok: boolean }
  /** 关屏 @source `Post_0402_Message` */
  | { kind: 'close' };

/** 状态机收到的**事件** */
export type LoanEvent =
  /** 0x113 定时器：气泡到点（`fcn_0044ee18` 返回真）*/
  | { kind: 'bubbleEnd' }
  /** 左键按下 @source `loc_00435c12`（`0x201/0x203`）*/
  | { kind: 'press'; btn: number; frozen: boolean; hasLoan: boolean; chairman: boolean; overLimit: boolean }
  /** 左键抬起 @source `loc_00435ea2`（`0x202`）*/
  | { kind: 'release' }
  /**
   * 董事長室**左侧三颗小钮**被点了 @source `fcn_00434492` 的 `0x202`（`loc_00434da1`）。
   *
   * `btn` = `FINANCE_BORROW` / `FINANCE_REPAY` / `FINANCE_BYE`；
   * `canBorrow` = 「還有可週轉額度」（原版 `player+0x28 < [0x48c3c8]`，
   * `loc_00434dfb` 末尾那条 `jge 跳过`）；`canRepay` = 「還有欠款」
   * （`loc_00434e98` 末尾的 `cmp dword [eax+0x496b90], 0 / je 跳过`）。
   *
   * ⚠️ 两条前置不满足时原版**什么都不做、连气泡都不换**（那条 `jge`/`je`
   *   直接跳到收尾），这里照抄。
   */
  | { kind: 'finance'; btn: number; canBorrow: boolean; canRepay: boolean }
  /** 右键抬起 —— 直接说再见 @source `loc_00435f6d`（`0x205`）*/
  | { kind: 'cancel' }
  /** 填数页收摊（`amount` = 填出来的数，0 = 没填）*/
  | { kind: 'formClosed'; amount: number; cash: number; deposit: number }
  /** 特別融資子对话框的结果 */
  | { kind: 'financeClosed'; ok: boolean };

export interface LoanStepResult {
  ui: LoanUi;
  effect: LoanEffect | null;
}

/**
 * 状态机走一步 —— **纯函数**，`main.ts` 只负责把 effect 接上 IO。
 *
 * 逐条照 `fcn_00435062`：`0x401`（= `loanStart`）、`0x405`（= 建屏时的气泡）、
 * `0x113`（气泡到点 → 见下面那张转换表）、`0x201/0x203`（点钮）、
 * `0x202`（抬手）、`0x205`（右键）、`0x409`/`0x40a`（填数页回来）。
 *
 * `0x113` 里「气泡到点」那张表（`loc_00435667` 的跳表）：
 * ```asm
 * 1  → st=3 + #0076
 * 3  → st=4
 * 5  → st=6 + PostMessage(0x409)          ; 借款表单滑入完 → 开填数页
 * 7  → st=8 + #0080
 * 8  → [0x48c3d9]=+40, [0x48c3d5]=440, st=4   ; ★ 收尾＝滑回去
 * 9  → st=0xa + PostMessage(0x40a)
 * 0xb → KillTimer + Post_0402_Message      ; 关屏
 * ```
 */
export function loanStep(ui: LoanUi, ev: LoanEvent): LoanStepResult {
  const same = (): LoanStepResult => ({ ui, effect: null });
  switch (ev.kind) {
    case 'bubbleEnd': {
      switch (ui.st) {
        case LOAN_ST.greet:
          return { ui: { ...ui, st: LOAN_ST.menu, bubble: LOAN_MSG.menu }, effect: null };
        case LOAN_ST.menu:
          return { ui: { ...ui, st: LOAN_ST.ready, bubble: null }, effect: null };
        case LOAN_ST.borrowIn:
          // ★ op 取自 `formOp`（一般貸款 / 特別融資週轉）—— 写死 `'borrow'` 会把
          //   董事長那一笔记进 `loan`，见 `LoanUi.formOp` 的说明。
          return {
            ui: { ...ui, st: LOAN_ST.borrowAsk, bubble: null },
            effect: { kind: 'openForm', op: ui.formOp === 'financeBorrow' ? 'financeBorrow' : 'borrow' },
          };
        case LOAN_ST.borrowDone:
          return { ui: { ...ui, st: LOAN_ST.settle, bubble: LOAN_MSG.borrowSettle }, effect: null };
        case LOAN_ST.settle:
          return { ui: { ...ui, st: LOAN_ST.ready, slide: loanSlideOut(), bubble: null }, effect: null };
        case LOAN_ST.repayIn:
          return {
            ui: { ...ui, st: LOAN_ST.repayAsk, bubble: null },
            effect: { kind: 'openForm', op: ui.formOp === 'financeRepay' ? 'financeRepay' : 'repay' },
          };
        case LOAN_ST.bye:
          return { ui, effect: { kind: 'close' } };
        default:
          return same();
      }
    }
    case 'press': {
      // @source loc_00435c12：st < 4 只把气泡收掉并回到 3；st > 4 什么都不做
      if (ui.st < LOAN_ST.ready) {
        return { ui: { ...ui, st: LOAN_ST.menu, bubble: null }, effect: null };
      }
      if (ui.st !== LOAN_ST.ready) return same();
      switch (ev.btn) {
        case 0: // EXIT：只记按下（抬手才算）@source loc_00435cca
          return { ui: { ...ui, pressed: 1 }, effect: null };
        case 1: // 申請貸款 @source loc_00435d48
          if (ev.frozen) return same(); // `player+0x3c != 0` → 不理（同时盖着禁止章）
          // ★ 董事長按这一颗也是**一般貸款** —— `loc_00435d48` 全文不看董事長标志
          //   （只有「窗」那一颗 `loc_00435ddb` 看）。特別融資的週轉現金在
          //   子对话框里，是**另外三颗**钮。
          return {
            ui: {
              ...ui,
              formOp: 'borrow',
              st: LOAN_ST.borrowIn,
              slide: loanSlideIn(),
              pressed: 0,
              bubble: ev.overLimit ? LOAN_MSG.overLimit : LOAN_MSG.askBorrow,
            },
            effect: null,
          };
        case 2: // 償還貸款 @source loc_00435da4
          if (!ev.hasLoan) return same();
          return {
            ui: {
              ...ui,
              formOp: 'repay',
              st: LOAN_ST.repayIn,
              slide: loanSlideIn(),
              pressed: 0,
              bubble: LOAN_MSG.askRepay,
            },
            effect: null,
          };
        case 3: // 窗（特別融資）@source loc_00435ddb
          if (!ev.chairman) return same();
          // ★ 开的是**子对话框**（董事長室），不是填数页：状态 0xa + 气泡 #0086，
          //   后面三颗小钮才受理（`[0x48c3cc]` 那台状态机在子对话框自己身上）。
          if (ui.financeOpen) return same();
          return {
            ui: { ...ui, financeOpen: true, pressed: 0, bubble: LOAN_MSG.financeGreet },
            effect: null,
          };
        default:
          return same();
      }
    }
    case 'finance': {
      // ── 董事長室左侧三颗小钮 @source `fcn_00434492` 的 `0x202`（`loc_00434da1`）──
      //    ⚠️ 原版只在这一屏的**状态 2**（招呼说完）受理点钮；本引擎那一格由
      //       `ready` 承担，另外还要**子对话框开着**（`financeOpen`）——
      //       点「窗」之前那三颗小钮在原版里根本不在。
      if (ui.st !== LOAN_ST.ready || !ui.financeOpen) return same();
      if (ev.btn === FINANCE_BORROW) {
        // @source `loc_00434dfb`：`jge` 那条 —— 没额度就什么都不做
        if (!ev.canBorrow) return same();
        // ★ 直接进 `borrowAsk`（不是 `borrowIn`）：原版子对话框是
        //   「按下的下一拍」（状态 3 → 状态 4）就 `fcn_00453544` 开填数页 ——
        //   **不是**等气泡说完那 1 秒。留在 `borrowIn` 的话气泡到点会再开一次，
        //   把用户已经填了一半的那一页冲掉。
        return {
          ui: { ...ui, formOp: 'financeBorrow', st: LOAN_ST.borrowAsk, bubble: LOAN_MSG.financeAskBorrow },
          effect: { kind: 'openForm', op: 'financeBorrow' },
        };
      }
      if (ev.btn === FINANCE_REPAY) {
        // @source `loc_00434e98`：`cmp dword [eax+0x496b90], 0 / je` —— 没欠款不动
        if (!ev.canRepay) return same();
        // 同上：直接进 `repayAsk`
        return {
          ui: { ...ui, formOp: 'financeRepay', st: LOAN_ST.repayAsk, bubble: LOAN_MSG.financeAskRepay },
          effect: { kind: 'openForm', op: 'financeRepay' },
        };
      }
      if (ev.btn === FINANCE_BYE) {
        // @source `loc_00434f25`：子对话框置状态 7 + 串 `[0x475870]`（#0091 董事長慢走！），
        // 下一拍 `loc_0043490f` 收掉定时器并 `Post_0402_Message([0x48c3d0])`。
        // ★ `[0x48c3d0]` 这一支**没置 1** ⇒ 返回标志 0 ⇒ 主屏 `loc_00435e1d` 走
        //   `[0x48c3dd] = 4`：**回到银行贷款屏**（不是把整屏关掉）。先前这里写成
        //   `st: bye`，于是点「離開」会把银行屏一起关掉。
        return {
          ui: { ...ui, financeOpen: false, st: LOAN_ST.ready, bubble: LOAN_MSG.financeBye },
          effect: { kind: 'financeClosed', ok: false },
        };
      }
      return same();
    }
    case 'release': {
      // @source loc_00435ea2：只有「按的是 EXIT」且还没在道别时才收场
      if (ui.pressed === 1 && ui.st !== LOAN_ST.bye) {
        return { ui: { ...ui, pressed: 0, st: LOAN_ST.bye, bubble: LOAN_MSG.bye }, effect: null };
      }
      return { ui: { ...ui, pressed: 0 }, effect: null };
    }
    case 'cancel': {
      if (ui.st === LOAN_ST.bye) return same();
      // @source `loc_00434fae`（子对话框的 `0x205`）：状态 != 7 时放取消音、
      // 状态 7 + 串 `[0x475870]`，返回标志仍是 0 ⇒ 主屏回状态 4。
      // ★ 所以「子对话框开着」时右键**只收子对话框**，银行贷款屏留着。
      if (ui.financeOpen) {
        return {
          ui: { ...ui, financeOpen: false, st: LOAN_ST.ready, bubble: LOAN_MSG.financeBye },
          effect: { kind: 'financeClosed', ok: false },
        };
      }
      return { ui: { ...ui, pressed: 0, st: LOAN_ST.bye, bubble: LOAN_MSG.bye }, effect: null };
    }
    case 'formClosed': {
      // ── 特別融資那两笔（`formOp`）走的是**子对话框**的路，与一般貸款不同 ──
      // @source `loc_0043469a`（週轉）/ `loc_0043471c` 起（歸還）：
      //   额 > 0 → 子对话框置状态 7 + `[0x48c3d0] = 1` ⇒ 返回标志 1
      //           ⇒ 主屏 `loc_00435e1d` 走 `[0x48c3dd] = 0xb`（**收场**）；
      //   额 = 0 → `loc_004346b2` 置状态 2 ⇒ 子对话框**留着**（返回标志 0）。
      if (ui.formOp === 'financeBorrow' || ui.formOp === 'financeRepay') {
        if (ev.amount <= 0) {
          return { ui: { ...ui, st: LOAN_ST.ready, pressed: 0, formOp: null, bubble: null }, effect: null };
        }
        // 歸還超额：`loc_00434700` 那一段是「现金+存款不够」→ 状态 5 + 串 #0090，
        // 下一拍又开一次还款页（原版就是这么反复问）—— 这里用 financeNoDebt 重问。
        if (ui.formOp === 'financeRepay' && ev.amount > ev.cash + ev.deposit) {
          return {
            ui: { ...ui, st: LOAN_ST.repayIn, pressed: 0, bubble: LOAN_MSG.financeNoDebt },
            effect: null,
          };
        }
        return {
          ui: { ...ui, financeOk: true, financeOpen: false, formOp: null, st: LOAN_ST.bye },
          effect: null,
        };
      }
      // ── @source `0x409`（借款）──
      // `eax = [0x48c3b0]（總資產）− player+0x24（已借）; edx = fcn_00453544(eax)`
      // 额 > 0 → `st=7` + 气泡 #0079（`loc_00435340`）；额 == 0 → `st=8`
      // ★ 原版额 == 0 那支**不挂气泡** —— 而 `fcn_0044ee18` 在**没有气泡**时返回 1，
      //   所以下一拍照样走 `case 8`（滑回去）。本引擎照抄这个口径：
      //   `st=8` 挂不挂气泡由这里决定，`bubbleEnd` 分支对两者一视同仁。
      if (ui.st === LOAN_ST.borrowAsk) {
        return ev.amount > 0
          ? { ui: { ...ui, formOp: null, st: LOAN_ST.borrowDone, pressed: 0, bubble: LOAN_MSG.borrowDone }, effect: null }
          : { ui: { ...ui, formOp: null, st: LOAN_ST.settle, pressed: 0, bubble: null }, effect: null };
      }
      // ── @source `0x40a`（还款）──
      // `edx = fcn_00453544(player+0x24)`；`ecx = player+0x1c + player+0x20`（手头现金）
      //   edx >  ecx → `st=9` + #0083（現金不足，退回表单那一拍）
      //   edx <= ecx → `st=8` + #0084（`loc_004353a3`）
      //   edx == 0   → `st=8`（不挂气泡）
      if (ui.st === LOAN_ST.repayAsk) {
        if (ev.amount <= 0) {
          return { ui: { ...ui, formOp: null, st: LOAN_ST.settle, pressed: 0, bubble: null }, effect: null };
        }
        if (ev.amount > ev.cash + ev.deposit) {
          return { ui: { ...ui, st: LOAN_ST.repayIn, pressed: 0, bubble: LOAN_MSG.noCash }, effect: null };
        }
        return { ui: { ...ui, formOp: null, st: LOAN_ST.settle, pressed: 0, bubble: LOAN_MSG.repayDone }, effect: null };
      }
      return same();
    }
    case 'financeClosed': {
      // `[0x48c3e2] = 返回标志`：1 ⇒ 主屏状态 0xb（收场）；0 ⇒ 回状态 4
      if (ev.ok) return { ui: { ...ui, financeOk: true, financeOpen: false, st: LOAN_ST.bye }, effect: null };
      return { ui: { ...ui, financeOpen: false, st: LOAN_ST.ready }, effect: null };
    }
    default:
      return same();
  }
}

// ============================================================
//  貸款屏：绘制
// ============================================================

/** 画这一帧的两块滑入面板所需要的一切 */
export interface LoanPanelsView {
  slide: LoanSlide;
  /** 角色号 —— 头像取 `map.mkf` 资源 `角色 + 0x1b` 图 0 */
  character: number;
  name: string;
  /** `[現金, 存款, 貸款]`，对应 `player+0x1c/0x20/0x24` */
  money: readonly [number, number, number];
  date: { year: number; month: number; day: number };
  /** 星期 0..6（`weekdayOf`）*/
  weekday: number;
  globalMapId: number;
  /** 今天的節日插画（`holidayIndexOf != -1` 时整张盖掉季节底图）；没有给 null */
  holidayArt: ImageBitmap | null;
  /** 「距還款日%d天」的天数；`null` = 不画（`player+0x2c == 0`）*/
  dueDays: number | null;
}

const FONT = FONT_FAMILY;

/** 带描边的字（`create_font` 的第 4 个 arg 是**标志位**：bit0 = 投影、bit1 = 粗体）*/
function bankText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  flag: number,
  fill: string,
  shadow: boolean,
): void {
  const a = alignFor(flag);
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = a.align;
  ctx.textBaseline = a.baseline;
  if (shadow) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#101010';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/** 带 $ 千分位 —— 与 `bank-loan.ts` 的 `money()` 同口径（串 `0x452793`）*/
function bankMoney(n: number): string {
  return `$${Math.trunc(n).toLocaleString('en-US')}`;
}

/** 锚点落点绘制（`fcn_004562a5` / `fcn_00456418` 内部都减锚点）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, Math.round(x - s.anchorX), Math.round(y - s.anchorY));
}

/**
 * 画两块滑入面板（`fcn_00433d6e` + `fcn_00433f24`）。
 *
 * 原版是先把两块面板画进各自的 surface，再由窗口过程
 * `fcn_004563f5(screen, 面板, 0, y)` / `(screen, 日期面板, 280, y)` 贴出来；
 * 本引擎每帧重画、没有离屏 surface，所以直接把内容画在 `(0,y)` 与 `(280,y)` 上，
 * 并**裁到面板矩形**（等价于原版 surface 的边界 + `0x455b3a` 的屏幕裁切）。
 *
 * 调色/字号/落点逐条照 `fcn_00433d6e` / `fcn_00433f24`，见上面的常量表。
 */
export function drawLoanPanels(
  ctx: CanvasRenderingContext2D,
  sprite: BankSprite,
  v: LoanPanelsView,
): void {
  const y = v.slide.y;
  if (!loanPanelsVisible(v.slide)) return;

  // ── ① 玩家面板：200×280，资源 23 图 15 + 头像 + 名字 + 三行 ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(LOAN_INFO_PANEL.x, y, LOAN_INFO_PANEL.w, LOAN_INFO_PANEL.h);
  ctx.clip();
  const bg = bankSprite(sprite, 'Panel.mkf', LOAN_INFO_PANEL.resource, LOAN_INFO_PANEL.image);
  if (bg !== null) ctx.drawImage(bg.bitmap, LOAN_INFO_PANEL.x, y);
  // 头像 = map.mkf 资源 `角色 + 0x1b` 图 0，锚点落 (0x2a, 0x28) @source `fcn_004562a5`
  drawAnchored(
    ctx,
    loanAvatar(sprite, v.character),
    LOAN_INFO_TEXT.avatar.x,
    y + LOAN_INFO_TEXT.avatar.y,
  );
  // 名字（22 号，flag 0 = 左上）@source `draw_text(name, 0x52, 0x1c, 0)`
  bankText(ctx, v.name, LOAN_INFO_TEXT.name.x, y + LOAN_INFO_TEXT.name.y, LOAN_INFO_TEXT.name.size, 0, '#ffffff', true);
  // 三行：标签（12 号 flag 0）、数值（22 号 flag 1 = 右上）
  for (let i = 0; i < LOAN_INFO_TEXT.rows.length; i++) {
    const row = LOAN_INFO_TEXT.rows[i]!;
    bankText(ctx, row.label, LOAN_INFO_TEXT.labelX, y + row.labelY, LOAN_INFO_TEXT.labelSize, 0, '#ffffff', true);
    bankText(
      ctx,
      bankMoney(v.money[i] ?? 0),
      LOAN_INFO_TEXT.valueX,
      y + row.valueY,
      LOAN_INFO_TEXT.valueSize,
      1,
      '#ffffff',
      true,
    );
  }
  ctx.restore();

  // ── ② 日期面板：200×200，贴 (280, y) ──
  const dx = LOAN_DATE_PANEL.x;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, y, LOAN_DATE_PANEL.w, LOAN_DATE_PANEL.h);
  ctx.clip();
  if (v.holidayArt !== null) {
    // 節日那天整张盖掉季节底图 @source `fcn_00433f24` 的 `!= -1` 分支
    ctx.drawImage(v.holidayArt, dx, y, LOAN_DATE_PANEL.w, LOAN_DATE_PANEL.h);
  } else {
    // 季节底图 = 资源 2 图 `sceneOfMonth(月)` @source 表 0x475218（在 `@rich4/core` 里）
    const scene = bankSprite(sprite, 'Panel.mkf', BANK_RES.date, sceneOfMonth(v.date.month));
    if (scene !== null) ctx.drawImage(scene.bitmap, dx, y);
  }
  const t = LOAN_DATE_TEXT;
  bankText(ctx, String(v.date.day), dx + t.day.x, y + t.day.y, t.day.size, t.day.flag, '#ffffff', true);
  bankText(
    ctx,
    LOAN_WEEKDAY[v.weekday] ?? '',
    dx + t.week.x,
    y + t.week.y,
    t.week.size,
    t.week.flag,
    '#ffffff',
    true,
  );
  bankText(ctx, String(v.date.year), dx + t.year.x, y + t.year.y, t.year.size, t.year.flag, '#ffffff', true);
  bankText(ctx, `${v.date.month}月`, dx + t.month.x, y + t.month.y, t.month.size, t.month.flag, '#ffffff', true);
  if (v.dueDays !== null) {
    bankText(
      ctx,
      LOAN_DUE_TEXT.replace('%d', String(v.dueDays)),
      dx + t.due.x,
      y + t.due.y,
      t.due.size,
      t.due.flag,
      '#ffffff',
      true,
    );
  }
  ctx.restore();
}

/** 月份 → 季节图号 @source 表 `0x475218`（在 `@rich4/core` 里叫 `sceneOfMonth`/`MONTH_SCENE`）*/
export const LOAN_MONTH_SCENE: readonly number[] = [3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];

/**
 * EXIT 那颗钮的按下 / 复原图。
 *
 * @source `loc_00435cca`（按下）：`fcn_00456418(屏, 图 19, 548, 431)`；
 *   `loc_00435ea2`（抬手）：`fcn_00456418(屏, 图 18, 548, 431)` —— 都画在
 *   命中表里 EXIT 那一格的左上角（图 18/19 都是 80×40、锚点 (0,0)）。
 * ★ 四颗钮里**只有 EXIT** 有按下图；申請/償還/窗那三颗没有。
 */
export const LOAN_EXIT_IMAGE = { pressed: 19, normal: 18 } as const;

/** 画 EXIT 的按下态（`[0x48c3e1] == 1` 时）@source `loc_00435cca` */
export function drawLoanPressed(
  ctx: CanvasRenderingContext2D,
  sprite: BankSprite,
  pressed: number,
  exitRect: { x0: number; y0: number },
): void {
  if (pressed !== 1) return;
  const img = bankSprite(sprite, 'Panel.mkf', BANK_RES.loan, LOAN_EXIT_IMAGE.pressed);
  drawAnchored(ctx, img, exitRect.x0, exitRect.y0);
}

/**
 * 「距還款日%d天」的天数 = `dayNumber(到期日) − dayNumber(今天)`
 * @source `fcn_004521aa`（两个日期都过 `0x451f8c` 再相减）。
 */
export function loanDueDays(
  today: { year: number; month: number; day: number },
  due: { year: number; month: number; day: number },
  dayNumber: (y: number, m: number, d: number) => number,
): number {
  return dayNumber(due.year, due.month, due.day) - dayNumber(today.year, today.month, today.day);
}

/**
 * 画对话气泡（`fcn_0044ecb6`）—— 底图是资源 23 图 21，字心在
 * `(x + w/2 + dx, y + h/2 + dy)`（见 `LOAN_BUBBLE`）。
 */
export function drawLoanBubble(
  ctx: CanvasRenderingContext2D,
  sprite: BankSprite,
  text: string,
  bubble: Sprite | null = null,
): void {
  const img = bubble ?? bankSprite(sprite, 'Panel.mkf', BANK_RES.loan, LOAN_BUBBLE.image);
  if (img === null) return;
  drawAnchored(ctx, img, LOAN_BUBBLE.x, LOAN_BUBBLE.y);
  const cx = LOAN_BUBBLE.x + img.width / 2 + LOAN_BUBBLE.dx;
  const cy = LOAN_BUBBLE.y + img.height / 2 + LOAN_BUBBLE.dy;
  const lines = text.split('\n').filter((l) => l !== '');
  const lh = LOAN_BUBBLE.size + 6;
  // ★ 2026-09-23：字效照 `fcn_0044ecb6` 的 `create_font(0x14, 正文色, 第二色=0, 2, 1)` —— 20 号深色**粗体**（`font.ts` 的 `clerkTextStyle`）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    drawGdiText(ctx, line, cx, cy + (i - (lines.length - 1) / 2) * lh, clerkTextStyle(LOAN_BUBBLE.color));
  });
}
