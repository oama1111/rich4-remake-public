/*
 * 付费类落点的棕色訊息框 —— issue #18
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么有这一屏：走到**别人的**地产／企業要交过路费时，原版会先弹一个
 *   棕色訊息框，重制版先前一个都不弹。
 *
 * ## 出处（三处落点共用同一扇通用訊息框）
 *
 * ```asm
 * ; 住宅（别人的地產）—— 0x00419d50
 * 00419d3e  push 0x4639b3              ; RENT.payOneOwner（无同盟）
 * 00419d1a  push 0x46399a              ; RENT.payTwoOwners（地主有同盟）
 * 00419d50  push 0x5dc                 ; ★ 0x5dc = 1500 ms
 * 00419d5a  call 0x440cac              ; 通用訊息框
 * 00419d70  call 0x41d709              ; ★ 之后才按付款方的神明调整金额
 *
 * ; 企業（董事長／幫主）—— 0x0041aeaa
 * 0041ae86  push 0x463a6a              ; RENT.payBoss（行業 0xc 門派）
 * 0041ae98  push 0x463a31              ; RENT.payChairman（其余行業）
 * 0041aeaa  push 0x5dc / call 0x440cac
 * 0041aec5  call 0x41d709
 * ```
 *
 * `0x440cac` 那扇窗（VA 0x00440cac）：
 * ```asm
 * 00440d16  call 0x44f9d8              ; create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)
 * 00440d62  mov  eax, [0x48bad8]       ; ★ Data.mkf 0x205（= DIALOG_SKIN_* 那一份）
 * 00440d79  add  eax, 0x48             ; 精灵下标 → 图 5
 * 00440d84  call 0x456418(表面, 图5, 0xdc, 0x8c)   ; 框锚点 (220,140)
 * 00440dac  call 0x44fabc(0, 文字, 0xdc, 0x8c, 4)  ; flag 4 = 正中
 * 00440de7  push esi(0x5dc) / call 0x4528b9        ; 等 1500 ms
 * ```
 * ⇒ **框皮、锚点、居中对齐都与 `dialog.ts` 的通用询问框是同一套**
 *   （`DIALOG_SKIN_RESOURCE` / `DIALOG_SKIN_IMAGE` / `DIALOG_ANCHOR_SCREEN`），
 *   所以本屏直接复用 `drawDialog()`，不另画一套。
 *
 * ## 1500 ms 是**可跳过**的
 *
 * 原版那个等待函数 `fcn_004528b9`（VA 0x004528b9）自己的 `PeekMessage` 循环里
 * 认三种消息：
 * ```asm
 * 00452901  cmp  edx, 0x202 / je 0x452919   ; WM_LBUTTONUP
 * 00452909  cmp  edx, 0x205 / je 0x452919   ; WM_RBUTTONUP
 * 00452911  cmp  edx, 0x101 / jne 0x45291e  ; WM_KEYDOWN
 * 00452919  mov  ebx, 1                     ; ★ 置「跳过」标志
 * 00452938  test ebx, ebx / je 0x4528da     ; 没跳过就接着等
 * ```
 * 与本引擎 `UiScreen` 的三个出口一一对应：`up` / `contextmenu` / `key`。
 * （注意：`event-box-screen.ts` 里把 `fcn_004528b9` 注释成「死等、不认消息」——
 *  那两条注释与本段汇编不符；本屏照汇编做，不去动那边。）
 *
 * ## 触发（纯查状态，不读也不写 `GameState`）
 *
 * `after.lastNotice` 非空、且与 `before.lastNotice` **不是同一个对象**
 * （`reduce.ts` 每弹一次都新建一个对象；没弹的 action 一路 `{...state}` 带过来，
 * 引用不变）⇒ 起播。金额、名字、費名全部是 core 交出来的，本屏**一个字都不算**
 * —— 尤其**不许**从 `before → after` 的差分反推金额（神明加成会让它对不上）。
 */

import { RENT, formatOriginal } from '@rich4/data';
import type { GameState, NoticeHint, NoticeKey } from '@rich4/core';
import { drawDialog } from './dialog.ts';
import type { InteractionUi } from './interactions.ts';
import { LAYOUT } from './stage.ts';
import type { UiKeyEvent, UiScreen, UiScreenEnv } from './ui-screen.ts';

/**
 * 框停留时长 —— 原版 `push 0x5dc`（1500 ms）。
 * @source 0x00419d50（住宅）/ 0x0041aeaa（企業），两处都是 `0x5dc`
 */
export const NOTICE_HOLD_MS = 0x5dc;

/**
 * 文案键 → 原版格式串。
 *
 * ⚠️ 格式串一律取自 `@rich4/data` 的 `messages.ts`（那里面每一条都带 VA，
 *   并由 `messages.test.ts` 逐字对过 `rich4.exe`）——**不在这里另写中文**。
 *   `satisfies` 保证「core 能交出来的每一个键」这里都翻得出来（漏一个就编译不过）。
 */
export const NOTICE_TEXT = {
  'rent.payOneOwner': RENT.payOneOwner.text,
  'rent.payTwoOwners': RENT.payTwoOwners.text,
  'rent.payChairman': RENT.payChairman.text,
  'rent.payBoss': RENT.payBoss.text,
  // ★ 免收那一路（`0x41d559` 的九种里「被关着／不在棋盘」的四种）：
  //   原版在豁免分支里先 sprintf 再弹**同一扇**框（`0x41d6a4 push 0x5dc /
  //   call 0x440cac`），格式串的 `%s`#1 = 地主名、`%s`#2 = 費名。
  'rent.freeHotel': RENT.freeHotel.text,
  'rent.freeVanished': RENT.freeVanished.text,
  'rent.freePrison': RENT.freePrison.text,
  'rent.freeHospital': RENT.freeHospital.text,
} as const satisfies Record<NoticeKey, string>;

/** 一条 `{ key, args }` 提示 → 屏上那一句（`%s` / `%d` 全在 `args` 里） */
export function noticeText(n: NoticeHint): string {
  return formatOriginal(NOTICE_TEXT[n.key], ...n.args);
}

/** 这一帧要画的东西 —— 交给 `dialog.ts` 的通用框（没有标题、没有按钮） */
export function noticeUi(text: string): InteractionUi {
  return { title: '', detail: text, choices: [] };
}

// ============================================================
//  演出状态机（纯函数）
// ============================================================

export interface NoticePlayback {
  /** 已经填好的整句（`\n\n` 原样留着，`dialog.ts` 自己折行） */
  text: string;
  /** 起播时刻 */
  at: number;
}

export function noticePlaybackStart(text: string, now: number): NoticePlayback {
  return { text, at: now };
}

/** 走一帧；该关屏了返回 `null` */
export function noticePlaybackTick(p: NoticePlayback, now: number): NoticePlayback | null {
  return now - p.at >= NOTICE_HOLD_MS ? null : p;
}

// ============================================================
//  屏幕本体
// ============================================================

/** 现在正在弹的那一个；`null` = 没在弹 */
let playback: NoticePlayback | null = null;

/** 调试 / 单测用：把整屏关掉 */
export function resetNoticeBoxScreen(): void {
  playback = null;
}

/**
 * 跳过这一拍（左键抬起 / 右键抬起 / 任意键按下 —— 见头注释的三种消息）。
 *
 * 原版那个等待函数一见这三种消息就立刻返回（不做任何「先播完再说」的事），
 * 所以这里也只有一个动作：关屏。
 */
function skip(env: UiScreenEnv): void {
  if (playback === null) return;
  playback = null;
  env.log('付费訊息框：跳过');
  env.requestRender();
}

export const noticeBoxScreen: UiScreen = {
  id: 'notice',

  /**
   * ★ **浮窗**：原版 `fcn_00451e7e(&rect{0,0x28,0x1b8,0x1e0})` 只在棋盘那一栏上
   *   开对话框（见 `dialog.ts` 头注释），所以四周的棋盘 / 侧栏照旧露着。
   */
  windowed: true,

  active: () => playback !== null,

  draw(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    // ★ `drawDialog` 排的是**棋盘区**坐标（`boardRect` 会减掉 `LAYOUT.board`），
    //   而 `UiScreenEnv.stage` 是整块 640×480 —— 不平移就会画到屏幕 y = −1 上去。
    //   股市屏那扇填数窗就是同一处理（`main.ts` 的 `save/translate/drawDialog`）。
    env.stage.save();
    env.stage.translate(LAYOUT.board.x, LAYOUT.board.y);
    drawDialog(env.stage, env.sprite, noticeUi(p.text), null, null);
    env.stage.restore();
  },

  tick(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    const next = noticePlaybackTick(p, env.now);
    if (next === null) {
      playback = null;
      env.log('付费訊息框：結束');
      env.requestRender();
      return;
    }
    // ★ **必须自己续帧**：`main.ts` 只把 `tick` 发给**此刻接管整屏**的那一屏，
    //   而关屏是「时间到」才有的事 —— 不续帧就永远到不了 1500 ms 那个 deadline
    //   （与 `event-box-screen.ts` 同一条路子）。
    env.requestRender();
  },

  /** 原版那三处「可跳过的等待」认 `WM_LBUTTONUP`（0x202）、`WM_RBUTTONUP`（0x205）、`WM_KEYDOWN`（0x101） */
  up(_x: number, _y: number, env: UiScreenEnv): void {
    skip(env);
  },

  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    skip(env);
  },

  /** 只看消息号、不看是哪个键 @source 0x00452911 `cmp edx,0x101 / jne 继续等` */
  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    skip(env);
    return true;
  },

  /**
   * 察觉「刚刚落了一次付费类落点」。
   *
   * 判据是**引用**：`reduce.ts` 每弹一次都新建一个 `{key,args}` 对象，没弹的
   * action 只是把原来的引用带过来 ⇒ `after.lastNotice !== before.lastNotice`
   * 就等于「这一条 action 弹了框」。这与 `lastCardPlay` 的判据同一套。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return; // 上一段还没播完
    const n = after.lastNotice;
    if (n === null || n === before.lastNotice) return;
    playback = noticePlaybackStart(noticeText(n), env.now);
    env.log(`付费訊息框：${n.key}`);
    env.requestRender();
  },
};

/** 给单测的只读视图 */
export function noticeBoxScreenState(): { playing: boolean; playback: NoticePlayback | null } {
  return { playing: playback !== null, playback };
}
