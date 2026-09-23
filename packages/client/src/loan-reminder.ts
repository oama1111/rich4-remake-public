/*
 * 銀行 —— **还款提醒窗**（距还款日 3 天、恰好真人、回合开始）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * core 挂 `pending {kind:'loanReminder'}`（相位 `turnStart`）；这里只管这扇窗怎么演、什么时候关。
 * 关窗 = 派 `declineDecision`（core 随即走完 `0x41c84f` 剩下的那一段）。
 *
 * ## 原版
 *
 * `0x0041c86d call 0x436a5a` → 跳表 `0x436a4a[3]` → `0x00436b01 call 0x43695e`：
 * ```asm
 * 00436969  cmp byte [player+0x15], 1 / jne 返回        ; 恰好真人
 * 00436983  read_mkf(panel, 0x17) → [0x48c3c0]          ; 貸款屏的图（资源 23）
 * 0043699d  read_mkf(panel, 2)    → [0x48c3bc]          ; 日期面板的季节底图
 * 004369b8  0x451a5a(0xc8, 0x118) / 0x451a5a(0xc8, 0xc8) ; 两块面板的 surface（200×280 / 200×200）
 * 004369e2  push 4 / call 0x4549cf                       ; 貸款屏配乐（MIDI05）
 * 004369f1  push 0x436034 / call 0x4018e7                ; ★ 模态窗
 * 004369fb  push 1 / call 0x41906a / call 0x454bcc       ; 重画主窗口、配乐接回
 * ```
 * 窗过程 `0x436034`：
 * ```asm
 * ; 0x401（铺场）
 * 004360c3  push 0 / call 0x434186             ; ★ 貸款屏铺法、**非董事長**那一支（店員室 + 百叶窗；
 *                                              ;   冻结时盖禁止章；尾巴里 0x433d6e / 0x433f24 把两块面板画好）
 * 004360f6  0x4563f5(屏, 玩家面板, 0x1b8, 0)    ; 两块面板**直接贴在到位处**（x = 440、y = 0 / 280，不滑入）
 * 00436115  0x4563f5(屏, 日期面板, 0x1b8, 0x118)
 * 00436139  SetTimer(hwnd, 深度, 0x32, 0)        ; 50 ms 一拍
 * 0043615b  PostMessage(0x405)
 * ; 0x405
 * 0043619f  sprintf(buf, 0x464aee '%s您好', 名字) / [0x48c3e7] = 1 / call 0x44ecb6(buf)   ; 第一句
 * ; 0x113（每拍）
 * 004361e9  push 0 / call 0x44ee18 / test eax, eax / je 不换句   ; 这一句到点（2000 ms）了没有
 * 0043620a  st 1 → 2，0x44ecb6([0x475878])      ; 「您向銀行借貸的\n貸款即將到期。」
 * 0043621f  st 2 → 3，0x44ecb6([0x47587c])      ; 「請不要忘記喔！」
 * 0043622f  st 3 → KillTimer / call 0x401966(0) ; 关窗
 * ; 0x201 / 0x203（左键）
 * 00436596  play_sound_effect(0x482322) / push 1 / call 0x44ee18   ; 音效 1 + 这一句当场收掉（下一拍换句）
 * ; 0x205（右键）
 * 004365b4  cmp [0x48c3e7], 3 / jae 不理
 * 004365c3  play_sound_effect(0x482332) / [0x48c3e7] = 3 / push 1 / call 0x44ee18   ; 音效 4 + 跳到最后（下一拍关）
 * ```
 * 气泡与字的版式与貸款屏同一套（`0x434186` 尾巴里 `0x44ec30(图 21, 0xf0, 0x50, …)`，见 `bank-dynamic.ts` 的
 * `LOAN_BUBBLE`）；这三句都**没有** `#nnnn` 语音码 ⇒ 不发声。
 *
 * ⚠️ **没做**：`0x113` 里另有店員的眨眼 / 小动作（`0x475880` 那张档表 + 三处 `rand()`），
 *   与貸款屏主屏那一段同样**未复刻**（`bank-loan.ts` 头注释的「没做」一栏）。纯装饰，不进 `GameState`。
 */

import { BANK, formatOriginal } from '@rich4/data';
import { LOAN_BUBBLE_MS, LOAN_TICK_MS } from './bank-dynamic.ts';

/** `[0x48c3e7]` 的三档 —— 正在说第几句 */
export const REMINDER_ST = { greet: 1, dueSoon: 2, dontForget: 3 } as const;
export type ReminderSt = (typeof REMINDER_ST)[keyof typeof REMINDER_ST];

/** 左键那一声 @source `0x00436598 push 0x482322`（`[0x482322] = 1`）*/
export const REMINDER_CLICK_SOUND = 1;
/** 右键那一声 @source `0x004365c3 push 0x482332`（`[0x482332] = 4`，取消音）*/
export const REMINDER_CANCEL_SOUND = 4;
/** 配乐：`0x004369e0 push 4 / call 0x4549cf` ⇒ `MIDI05.MID`（与貸款屏同一首）*/
export const REMINDER_BGM = 'midi05.mid';

export interface LoanReminderUi {
  st: ReminderSt;
  /** 正挂在气泡里的那一句；`null` = 这一句已被收掉（`0x44ee18(1)`），下一拍换句 */
  text: string | null;
  /** 这一句挂上的时刻（`[0x4762c4]`）*/
  at: number;
  /** 上一拍定时器的时刻（50 ms 一拍）*/
  tickAt: number;
}

/** 这一档说哪一句 */
export function reminderText(st: ReminderSt, name: string): string {
  switch (st) {
    case REMINDER_ST.greet:
      return formatOriginal(BANK.greeting.text, name);
    case REMINDER_ST.dueSoon:
      return BANK.loanDueSoon.text;
    default:
      return BANK.dontForget.text;
  }
}

/** 开窗：`0x405` 那一拍挂第一句 */
export function reminderStart(name: string, now: number): LoanReminderUi {
  return { st: REMINDER_ST.greet, text: reminderText(REMINDER_ST.greet, name), at: now, tickAt: now };
}

export interface ReminderTick {
  ui: LoanReminderUi;
  /** 第三句也收了 ⇒ 关窗（派 `declineDecision`）*/
  close: boolean;
}

/**
 * 定时器走一拍（50 ms）。没到拍点原样返回（同一个对象）。
 *
 * `0x44ee18(0)` 为真 = 气泡已被收掉，或挂满 `LOAN_BUBBLE_MS`（2000 ms，`cmp eax, 0x7d0`）。
 */
export function reminderTick(ui: LoanReminderUi, now: number, name: string): ReminderTick {
  if (now - ui.tickAt < LOAN_TICK_MS) return { ui, close: false };
  const ticked = { ...ui, tickAt: now };
  if (ui.text !== null && now - ui.at < LOAN_BUBBLE_MS) return { ui: ticked, close: false };
  if (ui.st === REMINDER_ST.dontForget) return { ui: { ...ticked, text: null }, close: true };
  const st: ReminderSt = ui.st === REMINDER_ST.greet ? REMINDER_ST.dueSoon : REMINDER_ST.dontForget;
  return { ui: { ...ticked, st, text: reminderText(st, name), at: now }, close: false };
}

/** 左键（`0x201` / `0x203`）：这一句当场收掉，下一拍换句 */
export function reminderClick(ui: LoanReminderUi): LoanReminderUi {
  return { ...ui, text: null };
}

/**
 * 右键（`0x205`）：还没到第三句就跳到第三句并收掉 ⇒ 下一拍关窗；已经是第三句 **不理**
 * （`0x004365bb jae 0x436162`，连音也不放）。返回 `null` = 这一下不理。
 */
export function reminderCancel(ui: LoanReminderUi): LoanReminderUi | null {
  if (ui.st >= REMINDER_ST.dontForget) return null;
  return { ...ui, st: REMINDER_ST.dontForget, text: null };
}
