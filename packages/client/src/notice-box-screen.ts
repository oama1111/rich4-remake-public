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
 * ★ 2026-09-19：`event-box-screen.ts` 那两条「死等、不认消息」的错注释**已订正**
 *   （见 E-5 的收口），本屏与那一屏现在照同一份汇编做。
 *
 * ## 触发（纯查状态，不读也不写 `GameState`）
 *
 * `after.notices` 与 `before.notices` **不是同一个数组**（`reduce.ts` 每弹一次都新建
 * 一个数组；没弹的 action 一路 `{...state}` 带过来，引用不变）⇒ 起播。
 * 金额、名字、費名全部是 core 交出来的，本屏**一个字都不算**
 * —— 尤其**不许**从 `before → after` 的差分反推金额（神明加成会让它对不上）。
 *
 * ## ★★ 一次 action 可以弹**不止一扇**
 *
 * 原版在 `0x00419d50`（租金框）之后还会接着弹 `0x00419f16`（死神框），
 * 設施那一路同理（`0x41a56f` → `0x41a6f2`）。所以 core 交出来的是**数组**，
 * 本屏按顺序**一扇一扇放** —— 每扇各自计 1500 ms（`NoticeHint.holdMs` 可覆盖，
 * 得点格那三扇是 1000 ms），每扇都能被同一个出口跳过（跳过只结束**当前**这一扇，
 * 与原版「每扇各自一次可跳过的等待」一致）。
 */

import { FACILITY_TOLL, GOD_MANIFEST, MESSAGE_BOX, RENT, SHOP, formatOriginal } from '@rich4/data';
import type { GameState, NoticeHint, NoticeKey } from '@rich4/core';
import { drawDialog } from './dialog.ts';
import type { InteractionUi } from './interactions.ts';
import { LAYOUT } from './stage.ts';
import type { UiKeyEvent, UiScreen, UiScreenEnv } from './ui-screen.ts';

/**
 * 框停留时长 —— 原版 `push 0x5dc`（1500 ms）。
 * @source 0x00419d50（住宅）/ 0x0041aeaa（企業）/ 0x0041a56f（設施），三处都是 `0x5dc`
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
  // ★ 免收那一路（`0x41d559` 的**全部九种**）：
  //   原版在豁免分支里先 sprintf 再弹**同一扇**框（`0x41d6a4 push 0x5dc /
  //   call 0x440cac`）。⚠️ 参数个数不是一种：查封（0x41d59f）与死神（0x41d5fa）
  //   只推了費名一个实参；同盟（0x41d5ce）与其余六种是「名字 + 費名」两个。
  'rent.freeSealed': RENT.freeSealed.text,
  'rent.freeAllied': RENT.freeAllied.text,
  'rent.freeReaper': RENT.freeReaper.text,
  'rent.freeHotel': RENT.freeHotel.text,
  'rent.freeVanished': RENT.freeVanished.text,
  'rent.freePrison': RENT.freePrison.text,
  'rent.freeHospital': RENT.freeHospital.text,
  'rent.freeWinterSleep': RENT.freeWinterSleep.text,
  'rent.freeSleepwalk': RENT.freeSleepwalk.text,
  // ★ 死神顯靈由他人賠償 —— 与租金框**在同一个 action 里前后脚弹**（0x00419f16）
  'rent.reaperPays': RENT.reaperPays.text,
  // ★ 設施那三路（`0x41a3cc` 那一支）
  'facility.hotel': FACILITY_TOLL.hotel.text,
  'facility.mall': FACILITY_TOLL.mall.text,
  // 加油站借的是「董事長」那一句（@source 0x41a55d `push 0x463a31`），
  // 只是第一个 `%s` 被 core 填成常量「加油站」
  'facility.gasStation': RENT.payChairman.text,
  // ★ 得点格 / 抽卡格 / 禮物 / 寶箱 / 乞丐 / 小偷
  'points.50': MESSAGE_BOX.points50.text,
  'points.30': MESSAGE_BOX.points30.text,
  'points.10': MESSAGE_BOX.points10.text,
  'points.card': MESSAGE_BOX.got.text,
  'object.gift': MESSAGE_BOX.got.text,
  'object.treasure': MESSAGE_BOX.got500Points.text,
  'beggar.alms': MESSAGE_BOX.alms.text,
  'thief.loot': MESSAGE_BOX.thiefLoot.text,
  // ★ 神明落脚顯靈（`fcn_0040f381` / `fcn_0040f8be`）：三句都是 `0x440cac(…, 0x5dc)` 同一扇框
  'god.build': GOD_MANIFEST.build.text,
  'god.demolish': GOD_MANIFEST.demolish.text,
  'god.seize': GOD_MANIFEST.seize.text,
  // ★ W-67-a：董事長蒞臨商店的贈禮（`0x464378`）—— 在商店窗打开**之前**弹
  'shop.chairmanGift': SHOP.chairmanGift.text,
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
  /** 这一扇停留多久（ms）—— 原版每扇框各自 `push` 一个时长 */
  holdMs: number;
}

export function noticePlaybackStart(text: string, now: number, holdMs: number = NOTICE_HOLD_MS): NoticePlayback {
  return { text, at: now, holdMs };
}

/** 走一帧；该关屏了返回 `null` */
export function noticePlaybackTick(p: NoticePlayback, now: number): NoticePlayback | null {
  return now - p.at >= p.holdMs ? null : p;
}

// ============================================================
//  屏幕本体
// ============================================================

/** 排着队、还没轮到的那几扇 */
interface QueuedNotice {
  key: NoticeKey;
  text: string;
  holdMs: number;
}

/** 现在正在弹的那一个；`null` = 没在弹 */
let playback: NoticePlayback | null = null;

/** 正在弹的那一扇之后还排着的（FIFO） */
let pending: QueuedNotice[] = [];

/** 调试 / 单测用：把整屏关掉（连队列一起清空） */
export function resetNoticeBoxScreen(): void {
  playback = null;
  pending = [];
}

/**
 * 从队头起下一扇。
 *
 * ★ 起播时刻**在这里才记**（不记入队时刻）：原版是一扇放完再等下一扇，
 *   两扇共用一个 1500 ms 计时就会让第二扇一出现就已经超时。
 */
function startNext(env: UiScreenEnv): void {
  if (playback !== null) return;
  const item = pending.shift();
  if (item === undefined) {
    pending = [];
    return;
  }
  playback = noticePlaybackStart(item.text, env.now, item.holdMs);
  env.log(`付费訊息框：${item.key}`);
}

/**
 * 跳过这一拍（左键抬起 / 右键抬起 / 任意键按下 —— 见头注释的三种消息）。
 *
 * 原版那个等待函数一见这三种消息就立刻返回（不做任何「先播完再说」的事），
 * 而**每扇框各自有一次**这样的等待 —— 所以这里只结束**当前**这一扇，
 * 后面排队的照旧接着弹。
 */
function skip(env: UiScreenEnv): void {
  if (playback === null) return;
  playback = null;
  env.log('付费訊息框：跳过');
  startNext(env);
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
      // ★ 后面还有排队的就接着弹（原版那几扇框是一扇接一扇）
      startNext(env);
    }
    // ★ **必须自己续帧**：`main.ts` 只把 `tick` 发给**此刻接管整屏**的那一屏，
    //   而关屏是「时间到」才有的事 —— 不续帧就永远到不了那个 deadline
    //   （与 `event-box-screen.ts` 同一条路子）。换扇也一样要续。
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
   * 察觉「刚刚落了要弹框的 action」。
   *
   * 判据是**引用**：`reduce.ts` 每弹一次都新建一个 `notices` 数组，没弹的
   * action 只是把原来的引用带过来 ⇒ `after.notices !== before.notices`
   * 就等于「这一条 action 弹了框」。这与 `lastCardPlay` 的判据同一套。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    const list = after.notices;
    if (list === before.notices || list.length === 0) return;
    // ★ **不丢**：正在播就把新的排到队尾（原版是一次 action 里连弹几扇，见头注释）
    for (const n of list) {
      pending.push({ key: n.key, text: noticeText(n), holdMs: n.holdMs ?? NOTICE_HOLD_MS });
    }
    if (playback === null) startNext(env);
    env.requestRender();
  },
};

/** 给单测的只读视图 */
export function noticeBoxScreenState(): {
  playing: boolean;
  playback: NoticePlayback | null;
  /** 排队等着弹的扇数（不含正在播的那一扇） */
  queued: number;
} {
  return { playing: playback !== null, playback, queued: pending.length };
}
