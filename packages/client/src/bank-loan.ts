/*
 * 銀行 —— **貸款屏**（申請 / 償還 / 董事長的特別融資）—— T-029b
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 银行落点的第 ② 屏（第 ① 屏是 ATM，见 `bank-screen.ts`）：
 * `rich4_player_core_actions.asm:2549` 起，ATM 关掉之后
 * `call _rich4_ui_bank_entry`（**VA 0x436668**）→ 窗口过程 **`fcn_00435062`**。
 *
 * ## 底图有两张（按「是不是董事長」二选一）
 *
 * @source `fcn_00434186`（VA 0x434186）：
 * ```asm
 * if (player+0x3c != 0) blit(图0, 图23, 345,345)   ; 冻结时给「申請貸款」盖禁止章
 * if (arg == 0) { 把 图1（344×240，窗里的老板）贴到 图0 (320,240) ; return }
 * ; ── 董事長那一支整张换成 图2 ──
 * ```
 * | 图 | 尺寸 | 是什么 |
 * |---|---|---|
 * | 0 | 640×480 | **店員室**（常态底图，已经画着 EXIT 与三张白单子）|
 * | 1 | 344×240 锚点 (62,198) | **百叶窗拉下来的样子**（常态才贴到 (320,240) —— 不是董事長就看不见人）|
 * | 2 | 640×480 | **董事長室**（董事長时整张换掉）|
 *
 * ## 四颗钮（表 `0x4757f8`，每项 8 字节 x0,y0,x1,y1）
 *
 * | # | 矩形 | 常态 | 董事長 | 门槛 @source |
 * |---|---|---|---|---|
 * | 0 | (548,431)-(628,471) | EXIT | 同 | — |
 * | 1 | (282,324)-(408,366) | 申請貸款 | 週轉現金 | `loc_00435d48`：`player+0x3c == 0`（没被凍結）|
 * | 2 | (470,326)-(590,366) | 償還貸款 | 歸還款項 | `loc_00435da4`：`loan != 0` 才有反应 |
 * | 3 | (268,51)-(591,273) | 窗（点它没反应）| **特別融資** | `loc_00435ddb`：`[0x48c3e0] != 0`（董事長）|
 *
 * ## 文字（两张底图各画各的）
 *
 * @source `fcn_00434186`；三行数额在 `fcn_00433c20`（VA 0x433c20）
 *
 * | 字 | 落点 | 字号/对齐 |
 * |---|---|---|
 * | `申請貸款` / `償還貸款` | (345,345) / (530,345) | 26 号 `0x101010` 居中 |
 * | `特別融資` | (443,427) | 26 号 居中 |
 * | `週轉現金` / `歸還款項` | (67,324) / (67,382) | 20 号 `0xf0f0f0` 居中 |
 * | `客戶存款總額` / `目前融資金額` / `尚可融資金額` | (78,147) / (78,195) / (78,243) | 16 号 `0x202020` 居中 |
 * | 三条**数额** | (128,163) / (128,211) / (128,259) | 16 号 `0xf0f0f0` 右对齐（flag 1）|
 *
 * 三条数额依次是 **額度 / 已用（`player+0x28` 特別融資余额）/ (額度 − 已用)**。
 *
 * ⚠️ **没做**：
 * - 进屏时那两块滑入面板（`fcn_00433d6e` 画 280×200 的头像+名字+两行、
 *   `fcn_00433f24` 画 200×200 的日期），贴法是 280×200 @(0,y)、200×200 @(280,y)，
 *   y 由状态 `[0x48c3d5]` 驱动（滑入动画）。
 * - `0x402`..`0x40a` 那串状态机与 `0x113` 定时器（店員的反应、表单滑入）。
 * - `fcn_00433c20` 里那次 `fcn_0045643d` 的 8 个参数只解出「一块 113×117 被贴到
 *   (135,278)」，语义未明。
 * - 董事長那三张左边的小钮图（图 16/18 落 (11,305)/(11,362)/(11,419)）**没有命中框**
 *   （命中表只有那 4 项），它们各自点下去是什么、第三张旁边那颗的字是什么，都还没跟。
 */

import type { ArchiveName, Sprite } from './assets.ts';
import { bankSprite } from './bank-dynamic.ts';
import { FONT_FAMILY } from './font.ts';
import { drawSprite } from './hd-stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type LoanSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 底图图集 @source 入口 VA 0x4367ab 的 `read_mkf(panel_mkf, 0x17, 0, 0)` */
export const LOAN_RESOURCE = 23;
/** 两张底图：常态 = 店員室、董事長 = 他自己的办公室 @source `fcn_00434186` */
export const LOAN_ROOM = { normal: 0, chairman: 2 } as const;
/**
 * 常态盖上窗口的那张 **百叶窗**（图 1，344×240，锚点 (62,198)）。
 *
 * ★ 它是「看不见董事長」的意思 —— 常态（非董事長）才贴；董事長时整张底图
 *   换成图 2（他自己的办公室，人在里面）。落点 (320,240) 是**锚点**。
 * @source `fcn_00434186` 的 `push 0xf0 / push 0x140` + `fcn_004562a5`
 */
export const LOAN_BLIND_WINDOW = { image: 1, x: 0x140, y: 0xf0 } as const;

/**
 * 董事長室里那三行数额**底下的红条面板**（图 20，137×165，锚点 (0,0)）。
 *
 * ★ 先前漏了它 —— 三条数额直接画在办公室底图上。@source `fcn_00434186` 的
 *   董事長支（`cmp dword [esp+8], 0` 之后第一件事）：
 * ```asm
 * push 0x7d                  ; y = 0x7d = 125
 * push 0xa                   ; x = 10
 * lea edx, [eax + 0xfc]      ; 图 20（+0xfc = 0xc + 12×20）
 * add eax, 0x24              ; 目标是图 2（办公室）
 * call fcn_00456280          ; ★ 不透明贴（`fcn_004562a5` 才是抠透明那种）
 * ```
 * 落点 (10,125) 与尺寸 137×165 ⇒ (10,125)-(147,290)，正好把三条数额
 * （字 x=78、值 x=128，y 147/163 … 243/259）全包住。
 */
export const LOAN_FINANCE_PANEL = { image: 20, x: 10, y: 0x7d } as const;

/**
 * 冻结时盖的禁止章（图 23，29×29，锚点 (14,14)）—— **两个落点**，
 * 因为它是贴进**当屏那张底图**里的：
 * `fcn_00434186` 的 `lea edx,[eax+0x120]`（= 图 23）。
 *
 * | 屏 | 底图 | 锚点 @source |
 * |---|---|---|
 * | 常态（店員室）| 图 0 | (0x159,0x159) = (345,345)，盖在「申請貸款」那张白单子上 |
 * | 董事長（办公室）| 图 2 | (0x43,0x144) = (67,324)，盖在「週轉現金」那颗钮上 |
 */
export const LOAN_FROZEN_MARK = { image: 23, x: 0x159, y: 0x159 } as const;
export const LOAN_FROZEN_MARK_CHAIRMAN = { image: 23, x: 0x43, y: 0x144 } as const;

/** 一颗钮的屏幕矩形 */
export interface LoanButton {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 四颗钮 —— 逐项 dump 自 `0x4757f8` @source 命中 `loc_00435c12` */
export const LOAN_BUTTONS: readonly LoanButton[] = [
  { x0: 548, y0: 431, x1: 628, y1: 471 }, // EXIT
  { x0: 282, y0: 324, x1: 408, y1: 366 }, // 申請貸款 / 週轉現金
  { x0: 470, y0: 326, x1: 590, y1: 366 }, // 償還貸款 / 歸還款項
  { x0: 268, y0: 51, x1: 591, y1: 273 }, // 窗（董事長时 = 特別融資）
] as const;

/** 钮的编号 */
export const LOAN_EXIT = 0;
export const LOAN_PRIMARY = 1;
export const LOAN_SECONDARY = 2;
export const LOAN_FINANCE = 3;

/**
 * 董事長室左侧那**三颗小钮**的命中矩形 —— 逐字节 dump 自 `0x475818`
 * （8 字节/项的有符号 16 位 `x0, y0, x1, y1`，**两端都闭**）。
 *
 * @source 命中判定 `rich4_ui_bank.asm:1506-1520`（`fcn_00434492` 的 `0x201` 分支）：
 * ```asm
 * loc_00434b8e:  ebx = 1 / 循环 ebp < 3
 *   movsx edx, word [ebx + 0x475818]  ; x0
 *   cmp esi, edx / jl 下一个          ; ★ `jl` —— 下界闭
 *   movsx edx, word [ebx + 0x47581c]  ; x1
 *   cmp esi, edx / jg 下一个          ; ★ `jg` —— 上界也闭
 *   … y0（+0x47581a）/ y1（+0x47581e）同理
 *   play_sound_effect(0x482322) / [0x48c3cf] = ebp + 1
 * ```
 * ★ 相邻还有一张 `0x475810`（`0x201` 那一支用来「把按下的样子贴回底图」），
 *   它的 `[1..3]` 与这张表的 `[0..2]` **完全相同** —— 因为两张表只差 8 字节：
 *   `0x475810[0]` 是整扇窗 `(268,51)-(591,273)`，后面三项才是这三颗钮。
 *
 * ⚠️ 与 `LOAN_BUTTONS`（`0x4757f8`，主屏那四颗）**不是同一张表**。
 */
export const FINANCE_BUTTONS: readonly LoanButton[] = [
  { x0: 11, y0: 305, x1: 125, y1: 345 }, // 週轉現金（图 16，字 @(67,324)）
  { x0: 11, y0: 362, x1: 125, y1: 402 }, // 歸還款項（图 16，字 @(67,382)）
  { x0: 11, y0: 419, x1: 91, y1: 459 }, // 離開（图 18/19，80×40）
] as const;

/** 三颗小钮的编号 @source `[0x48c3cf]` 的 1/2/3（这里 0 基）*/
export const FINANCE_BORROW = 0;
export const FINANCE_REPAY = 1;
export const FINANCE_BYE = 2;

/**
 * 点在**三颗小钮**的哪一颗上；没点中返回 `null`。
 *
 * @source 同 `FINANCE_BUTTONS` 的 `0x201` 判定循环（**两端都闭**）。
 * @param x 相对棋盘/舞台左上角的 x（这一屏是整屏，故就是舞台坐标）
 */
export function hitFinanceButton(x: number, y: number): number | null {
  for (let i = 0; i < FINANCE_BUTTONS.length; i++) {
    const b = FINANCE_BUTTONS[i]!;
    if (x < b.x0 || x > b.x1) continue;
    if (y < b.y0 || y > b.y1) continue;
    return i;
  }
  return null;
}

/** 这张牌／这一屏要做的事（`fcn_00435062` 的状态机之外的**动作**部分）*/
export type LoanOp = 'borrow' | 'repay' | 'financeBorrow' | 'financeRepay' | 'exit';

// ============================================================
//  董事長眨眼 —— 子对话框 `fcn_00434492` 那一支（Q-BANK-1a）
// ============================================================
//
// 子对话框挂着**自己的**定时器 `SetTimer(hwnd, id, 0x64, 0)` = **100 ms**
// （`rich4_ui_bank.asm:976`，与贷款屏主屏那 50 ms 不是一支），每一拍做两件事：
// ① 掷一次「要不要开始眨」；② 正在眨就把下一张眼睛贴片盖到董事长脸上。
//
// ```asm
// 004347a2  cmp byte [0x48c3cc], 4 / je 跳过      ; ★ 状态 4 = 填数页开着 ⇒ 不眨
// 004347bb  mov al, byte [0x48c3ce]               ; 计数器
//           and al, 0xf                            ; 低 4 位 = 「正在眨」标志
//           test al, al / jbe loc_0043493a         ; 0 → 掷骰
//           cmp al, 1 / je loc_00434958            ; 1 → 眨一拍（只有这两个值）
//
// loc_0043493a:                                     ; ★ 开始眨的闸
//           call _libc_rand / sar esi, 0xa / test esi, esi
//           jne 跳过                               ; rand() >> 10 == 0 才中 ⇒ 1/1024
//           or byte [0x48c3ce], 1                  ; 置「正在眨」
//
// loc_00434958:                                     ; ★ 眨一拍
//           al = [0x48c3ce] & 0x30 / tier = al >> 4 ; 档 = bit4..5
//           [0x48c3ce] = ([0x48c3ce] + 0x10) & 0x3f ; 档 +1（bit0 保留）
//           … 先把 (0x1f0,0xa2)-(0x236,0xc5) 从底图 surface 贴回来 …
//           al = [0x48c3ce] & 0x30
//           cmp al, 0x30 / je 结束支                ; ★ 判的是**加完之后**的值
//           图号 = byte[0x475884 + tier] / 贴到 (0x1f0,0xa2)
// 结束支:    [0x48c3ce] = 0                          ; 清干净，等下一次掷中
// ```
//
// ⇒ 档的序列（`0x475884` = `0c 0b 0c 00` = 图 12/11/12）：
//
// | 拍 | 计时器里的值 | 档 | 加完之后 | 画什么 |
// |---|---|---|---|---|
// | 掷中那一拍 | 0x01 | — | — | 不画（这一拍只置标志）|
// | 第 2 拍 | 0x01 | 0 | 0x11 | 图 **12**（睁眼）|
// | 第 3 拍 | 0x11 | 1 | 0x21 | 图 **11**（闭眼）|
// | 第 4 拍 | 0x21 | 2 | 0x31 ⇒ `&0x30 == 0x30` | **不画**，恢复底图 + 计数器清零 |
//
// ★ 所以 `0x475884` 的第 **4** 个字节（`00`）**永远不会被用到** —— 判「结束」
//   用的是**加完之后**的值，档 2 那一拍直接跳去结束支了。这与主屏那张
//   `0x475880`（`07 06 07 05`）的第 4 项 `05` 不被用到是同一个道理
//   （见 T-029.md 的订正）。⇒ 眨一次 = **闭眼 100 ms**（前后两拍都是睁眼）。

/** 档在计数器里的掩码 @source `and al, 0x30` */
export const LOAN_BLINK_TIER_MASK = 0x30;
/** 每拍给档加的量 @source `add ch, 0x10` */
export const LOAN_BLINK_TIER_INC = 0x10;
/** 计数器的掩码（低 4 位是「正在眨」，bit4..5 是档）@source `and al, 0x3f` */
export const LOAN_BLINK_MASK = 0x3f;
/** 开始眨一拍的随机闸：`rand() >> 10 == 0` ⇒ 1/1024 @source `loc_0043493a` */
export const LOAN_BLINK_P = 1 / 1024;
/** 子对话框那一支定时器 = **100 ms** @source `SetTimer(hwnd, id, 0x64, 0)`, `:976` */
export const LOAN_BLINK_TICK_MS = 0x64;
/** 眼贴片的落点与尺寸 = `(0x1f0,0xa2)-(0x236,0xc5)` @source `loc_00434958` */
export const LOAN_BLINK_AT = { x: 0x1f0, y: 0xa2, w: 0x46, h: 0x23 } as const;
/** 档 0/1/2 → 图号 @source `0x475884` 的字节 `0c 0b 0c 00`（第 4 项用不到）*/
export const LOAN_BLINK_IMAGES: readonly number[] = [12, 11, 12];

/**
 * 眨眼计数器的状态。
 *
 * `counter` 就是原版的 `[0x48c3ce]`（低 4 位 = 「正在眨」，bit4..5 = 档）。
 * `image` 是**这一拍走完之后**该盖在脸上的图号（`null` = 露出底图）——
 * ★ 必须存下来，因为原版用的是**走这一拍之前**的档去查图号：同一拍里
 *   「档」是加之前的、而「结束」判据是加之后的，光靠 `counter` 反推不出来
 *   （结束那一拍 `counter` 归 0，与「从没眨过」撞在同一个值上）。
 *
 * 这是**纯表现**，不进 `GameState`（C-DET-4）。原版的随机源是共享的
 * `_libc_rand`，而「眨几次」取决于这一屏开多久 —— 逐位复刻本来就不可达；
 * 这里照本项目其它装饰性随机的做法用 `Math.random`（与商店橱窗那一支同口径，
 * 见 `main.ts` 的 `blinkStep` 注释）。
 */
export interface LoanBlink {
  counter: number;
  /** 这一拍盖哪张眼贴片；`null` = 盖底图 */
  image: number | null;
  at: number;
}

export const LOAN_BLINK_IDLE: LoanBlink = { counter: 0, image: null, at: 0 };

/** 刚开屏：计数器清零、下一拍从 `now` 起算（原版 `loc_0043453a` 的 `[0x48c3ce] = 0`）*/
export function loanBlinkStart(now: number): LoanBlink {
  return { counter: 0, image: null, at: now };
}

/**
 * 走一拍定时器（每 `LOAN_BLINK_TICK_MS` 毫秒一次）。
 *
 * @param now 当前时刻（毫秒）—— 用 `performance.now()`，不读挂钟
 * @param random 0..1 的随机源（原版是 `_libc_rand`）
 * @returns 新的状态；没到点就原样返回（**同一个对象**，调用方据此判断要不要重绘）
 */
export function loanBlinkStep(
  blink: LoanBlink,
  now: number,
  random: () => number,
): LoanBlink {
  if (now - blink.at < LOAN_BLINK_TICK_MS) return blink;
  const counter = blink.counter;
  // 低 4 位 = 「正在眨」标志（原版只会是 0 或 1）
  if ((counter & 0xf) === 0) {
    // ★ 掷闸那一拍**不画**（原版 `loc_0043493a` 置完标志就跳去公共尾巴）——
    //   所以 `image` 还是 `null`。
    return random() < LOAN_BLINK_P
      ? { counter: counter | 1, image: null, at: now }
      : { counter, image: null, at: now };
  }
  // ★ 查图号用的是**加之前**的档（原版 `mov al,[0x48c3ce] / and al,0x30 / sar 4`
  //   在 `add ch,0x10` 之前），而「结束」判据用的是**加之后**的档。
  const tier = (counter & LOAN_BLINK_TIER_MASK) >> 4;
  const next = (counter + LOAN_BLINK_TIER_INC) & LOAN_BLINK_MASK;
  if ((next & LOAN_BLINK_TIER_MASK) === LOAN_BLINK_TIER_MASK) {
    return { counter: 0, image: null, at: now };
  }
  return { counter: next, image: LOAN_BLINK_IMAGES[tier] ?? null, at: now };
}

/** 这一拍该盖哪张眼睛贴片；`null` = 盖底图（不眨 / 刚掷中 / 那一拍是「结束」）*/
export function loanBlinkImage(blink: LoanBlink): number | null {
  return blink.image;
}

/**
 * 点在第几颗钮上；没点中返回 `null`（坐标是**屏幕/舞台**坐标）。
 *
 * ★ 顺序是表里的顺序（EXIT 在前），所以窗口那颗**最后**判 —— 它最大。
 */
export function hitLoanButton(x: number, y: number): number | null {
  for (let i = 0; i < LOAN_BUTTONS.length; i++) {
    const b = LOAN_BUTTONS[i]!;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return i;
  }
  return null;
}

/**
 * 点这颗钮在**这一刻**是什么意思（`null` = 按下去没反应）。
 *
 * ★ **董事長那两颗也是「一般貸款 / 償還貸款」** —— `loc_00435d48` / `loc_00435da4`
 *   全文都不看 `[0x48c3e0]`（董事長标志），只有「窗」那一颗 `loc_00435ddb` 看。
 *   特別融資那两笔（週轉現金 / 歸還款項）是**子对话框里的另外三颗小钮**，
 *   由 `FINANCE_BUTTONS` 与 `bank-dynamic.ts` 的 `{kind:'finance'}` 负责。
 *
 * @param chairman 是不是董事長（`pending.specialFinance !== null`）—— 只影响「窗」
 * @param frozen `bank_freeze_days != 0` —— 申請貸款被擋（原版盖禁止章且不理这一下）
 * @param hasLoan `loan != 0` —— 償還貸款才有反应
 */
export function loanActionOf(
  btn: number,
  chairman: boolean,
  frozen: boolean,
  hasLoan: boolean,
): LoanOp | null {
  switch (btn) {
    case LOAN_EXIT:
      return 'exit';
    case LOAN_PRIMARY:
      if (frozen) return null; // @source loc_00435d48 的 `player+0x3c != 0 → 不理`
      return 'borrow';
    case LOAN_SECONDARY:
      if (!hasLoan) return null; // @source loc_00435da4 的 `loan == 0 → 不理`
      return 'repay';
    case LOAN_FINANCE:
      // 「窗」不开填数页：董事長点它开的是**子对话框**（`financeOpen`），
      // 一般人点它没反应 —— 故这里一律 `null`。
      return null;
    default:
      return null;
  }
}

/** 画这一屏 */
export interface LoanView {
  /** 是不是董事長 */
  chairman: boolean;
  /** 冻结中（盖禁止章）*/
  frozen: boolean;
  /**
   * 董事長那三条数额的**数字**：額度 / 已用 / 还可融（只有董事長看得到）。
   * `null` = 子对话框还没开 —— 那时**整块办公室都不画**，见 `subDialog`。
   */
  finance: readonly [number, number, number] | null;
  /**
   * 特別融資**子对话框**开着没有 —— 决定这一帧画哪张底图。
   *
   * ★ 这是 Q-BANK-1c 的定案：原版 `fcn_00434186` 的董事長支把标题/面板/小钮/
   *   三行标签**画进图 2**（办公室），可它最后贴到屏上的却是
   *   `add eax, 0xc` = **图 0**（店員室）：
   *   ```asm
   *   00434212  cmp dword [esp + 8], 0    ; chairman ?
   *             jne loc_0043423d          ; 是 ⇒ 把装饰画进图 2
   *   …
   *   0043441d  mov eax, [0x48c3c0]; add eax, 0xc   ; ★ 贴的仍是图 0
   *   0043442d  call fcn_004563f5(屏, 图 0, 0, 0)
   *   ```
   *   ⇒ **董事長站在柜台前时，主屏看到的是店員室**（只见他贴进图 2 的那些装饰
   *     在子对话框里才露出来 —— 子对话框贴的是图 2）。
   *   唯一的差别：常态会在窗口上盖**百叶窗（图 1）**把董事長挡住，
   *   而董事長自己那一支**不盖**（`cmp [esp+8],0 / jne` 正好跳过那次
   *   `fcn_004562a5(图0, 图1, 320,240)`）—— 于是他从窗口里露面。
   */
  subDialog: boolean;
  /**
   * 这一拍盖在董事长脸上的眼睛贴片图号（12 睁 / 11 闭）；
   * `null` = 不盖（没在眨、或这一拍是「结束」⇒ 露出底图那张睁眼的）。
   */
  blink: number | null;
}

const FONT = FONT_FAMILY;

/** 一行字（黑/白由调用方定 —— 原版各处的 create_font 颜色不同）*/
function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  align: CanvasTextAlign,
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/** 带 $ 千分位 —— 与 `client/panel.ts` 的 `currency` 同口径 */
function money(n: number): string {
  return `$${Math.trunc(n).toLocaleString('en-US')}`;
}

/** 三条数额的标签与落点 @source `fcn_00434186` / `fcn_00433c20` */
export const LOAN_FINANCE_ROWS = [
  { label: '客戶存款總額', labelY: 147, valueY: 163 },
  { label: '目前融資金額', labelY: 195, valueY: 211 },
  { label: '尚可融資金額', labelY: 243, valueY: 259 },
] as const;
export const LOAN_FINANCE_X = { label: 78, value: 128 } as const;

/**
 * 画整屏（640×480）。
 *
 * 原版把字**画进底图本身**（`fcn_00434186` 的目标 surface 就是资源 23 的图），
 * 这里每帧照同样坐标画一遍 —— 与個人資產表那屏同一个做法。
 */
export function drawBankLoan(
  ctx: CanvasRenderingContext2D,
  sprite: LoanSprite,
  view: LoanView,
): void {
  // ★ 底图三态（Q-BANK-1c）：
  //   常态 = 图 0 + 百叶窗；董事長（子对话框没开）= 图 0、**不盖百叶窗**；
  //   子对话框开着 = 图 2（办公室，装饰都在它上面）。
  const office = view.chairman && view.subDialog;
  const roomImage = office ? LOAN_ROOM.chairman : LOAN_ROOM.normal;
  const room = bankSprite(sprite, 'Panel.mkf', LOAN_RESOURCE, roomImage);
  if (room !== null) drawSprite(ctx, room, 0, 0);

  if (office) {
    // ★ 三条数额底下那张红条面板（图 20）—— 原版是**贴进办公室底图**里的，
    //   竖着叠在数额下面，所以先画它再画字（`fcn_00456280` 不透明贴）。
    const panel = bankSprite(sprite, 'Panel.mkf', LOAN_RESOURCE, LOAN_FINANCE_PANEL.image);
    if (panel !== null) drawSprite(ctx, panel, LOAN_FINANCE_PANEL.x, LOAN_FINANCE_PANEL.y);
    // 董事長室那一支：三行 16 号 + 特别融資 + 两颗小钮的字
    // ★ 标签是**底图自己带的**（`fcn_00434186` 画进图 2 里的），数字才是子对话框画的
    for (let i = 0; i < LOAN_FINANCE_ROWS.length; i++) {
      const row = LOAN_FINANCE_ROWS[i]!;
      text(ctx, row.label, LOAN_FINANCE_X.label, row.labelY, 16, '#202020', 'center');
      if (view.finance !== null) {
        text(ctx, money(view.finance[i] ?? 0), LOAN_FINANCE_X.value, row.valueY, 16, '#f0f0f0', 'right');
      }
    }
    text(ctx, '特別融資', 443, 427, 26, '#101010', 'center');
    text(ctx, '週轉現金', 67, 324, 20, '#f0f0f0', 'center');
    text(ctx, '歸還款項', 67, 382, 20, '#f0f0f0', 'center');
    // 左边那三张钮图：图 16 落 (11,305)/(11,362)、图 18 落 (11,419)
    // @source `fcn_00434186` 的三次 `fcn_004562a5`
    for (const [img, x, y] of [[16, 11, 305], [16, 11, 362], [18, 11, 419]] as const) {
      const s = bankSprite(sprite, 'Panel.mkf', LOAN_RESOURCE, img);
      if (s !== null) drawSprite(ctx, s, x, y);
    }
  } else {
    // 柜台那一屏：两张白单子上的字（董事長自己也走这两颗 —— 原版 `loc_00435d48`
    // / `loc_00435da4` **不看董事長标志**，他按下去就是一般貸款/还款）
    text(ctx, '申請貸款', 345, 345, 26, '#101010', 'center');
    text(ctx, '償還貸款', 530, 345, 26, '#101010', 'center');
    // ★ 百叶窗只有**常态**才盖（把董事長挡在窗后）；董事長自己不盖，他从窗口露面
    if (!view.chairman) {
      const blind = bankSprite(sprite, 'Panel.mkf', LOAN_RESOURCE, LOAN_BLIND_WINDOW.image);
      if (blind !== null) {
        drawSprite(
          ctx,
          blind,
          LOAN_BLIND_WINDOW.x - blind.anchorX,
          LOAN_BLIND_WINDOW.y - blind.anchorY,
        );
      }
    }
  }

  // 董事長眨眼：把眼睛贴片盖到脸上（图 12 睁 / 11 闭，70×35 落 (496,162)）
  // —— 原版是子对话框 `fcn_00434492` 的 100 ms 定时器在画（`loc_00434958`）。
  if (office && view.blink !== null) {
    const eyes = bankSprite(sprite, 'Panel.mkf', LOAN_RESOURCE, view.blink);
    if (eyes !== null) drawSprite(ctx, eyes, LOAN_BLINK_AT.x, LOAN_BLINK_AT.y);
  }

  // 冻结中：禁止章 —— **贴进当屏那张底图**，所以两个落点（见 LOAN_FROZEN_MARK）
  if (view.frozen) {
    // 禁止章是**贴进当屏底图**的：常态/董事長主屏都进图 0（落点 345,345），
    // 只有子对话框那一屏进图 2（落点 67,324，盖在「週轉現金」那颗钮上）
    const at = office ? LOAN_FROZEN_MARK_CHAIRMAN : LOAN_FROZEN_MARK;
    const mark = bankSprite(sprite, 'Panel.mkf', LOAN_RESOURCE, at.image);
    if (mark !== null) {
      drawSprite(ctx, mark, at.x - mark.anchorX, at.y - mark.anchorY);
    }
  }
}
