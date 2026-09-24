/*
 * 演出宿主的「闸」那一半 —— `main.ts` 与单测（`presentation-deadlock.test.ts`）**共用同一份**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 第十六份（第二轮）：上一版把这些判据直接写在 `main.ts` 里，单测只能照着抄一份 ——
 *   抄出来的那份没有 `main.ts` 里的一个**无限递归**：
 *
 *   訊息框的起播闸 → 「屏上有没有框」`boxSnapshot()` → 它顺手算的影片位 `stageBusy(stageBusyFlags())`
 *   → `blockingPresentation()` → 「訊息框只是排着等台词」`noticeWaitingForSpeech()` → 訊息框的起播闸 → …
 *
 *   訊息框单独排着、台词又刚好说完的那一拍（几乎每一扇框起播前都会遇到）就爆栈：
 *   `RangeError: Maximum call stack size exceeded` 在回合驱动 / 联机收件箱的定时器回调里抛出，
 *   回调死掉、不再重排 ⇒ 联机端长时间不施加收件箱里的 action（`net-e2e` 只跑到第 7–21 回合，
 *   另一端在前面，本端的驱动按旧局面派 action，被服务器 `notYourTurn` 连拒）。
 *
 *   现在：① 判据收在这里、两边共用（单测跑的就是生产代码）；② 结构上断环 ——
 *   「屏上有没有框」（`boxShowing`）不碰影片位，影片位（`deps.filmsBusy`）不碰整屏判据。
 *
 * 纯逻辑：不读 DOM、不碰音频；状态全从 `deps` 现取。
 */

import { selectOverlay } from './overlay.ts';
import { noticeWaitingForSpeech, noticeShowing, noticePendingRanks } from './notice-box-screen.ts';
import { eventBoxPending, eventBoxScreenState } from './event-box-screen.ts';
import { wheelScreenState } from './wheel-screen.ts';
import { godSlotState } from './god-slot.ts';
import { auctionBidPacing, auctionPresentationOnly } from './auction-screen.ts';
import {
  SCREEN_BOX_TIER,
  boxMayStart,
  boxRank,
  countedHeld,
  type BoxSnapshot,
  type BoxTier,
  type SpeechCue,
  type SpeechSnapshot,
} from './presentation-order.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 演出类整屏（事件起播、自己收屏，期间棋局不许往前走）—— 与 `main.ts` 的旧表同一份 */
export const BLOCKING_PRESENTATIONS: ReadonlySet<string> = new Set([
  'shares',
  'lottery-draw',
  'monthly',
  'magic',
  'eventBox',
  // ★ 第十五份：命運让出框之后那 800 ms（`0x0044dd7b`）
  'eventTail',
  'notice',
  'wheel',
  'god-slot',
  // ★ 第二十五份：破產那一刻的整屏影片（`Data.mkf` 0x22b，见 `bankrupt-screen.ts`）——
  //   原版是阻塞的 `fcn_0045144f` + 2 s 静置，期间谁也不许往前走
  'bankrupt',
]);

/** 推日期那几屏 + 魔法屋女巫窗：都是 `lead` 档、起播即在屏上（见 `SCREEN_BOX_TIER`）*/
export const DAY_AND_MAGIC_BOXES: ReadonlySet<string> = new Set(['shares', 'lottery-draw', 'monthly', 'magic']);

/**
 * 「屏上开着一扇框」要逐屏问 `active()` 的那几屏：推日期 / 魔法屋，外加命運让出框之后那 800 ms
 * （`eventTail`，`0x0044dd7b` 阻塞等待 —— 原版这期间谁也不说话、别的框也不起）。
 */
const ACTIVE_MEANS_SHOWING: ReadonlySet<string> = new Set([...DAY_AND_MAGIC_BOXES, 'eventTail']);

/** 宿主交进来的现取状态 */
export interface PresentationDeps {
  readonly screens: readonly UiScreen[];
  env(): UiScreenEnv;
  /**
   * W-51 那几位里**不是框**的（影片 / 建屋片 / 投掷 / 走子 / 掷骰 / 閃爍 / 升天）+ 保釋屏收尾。
   * ⚠️ 实现里**不许**回头调本类的任何方法（那就是上一版的递归）。
   */
  filmsBusy(): boolean;
  /** 神明台词窗（`fcn_0040e2a2`）：开着 / 排着 */
  godLine(): { showing: boolean; pending: boolean };
  /** 台上几句、押着的几句（带档与 `cue`）*/
  speech(): { onStage: number; held: readonly { rank: number; cue?: SpeechCue }[] };
  cueDone(cue: SpeechCue): boolean;
  /** 押着没派的推日期 / 魔法屋 `event()` 几条 */
  deferredScreens(): number;
  /** 魔法屋女巫窗停在「等真人点格」 */
  magicAwaitingPick(): boolean;
  /** 保釋屏答完之后的收尾还在演 */
  bailClosing(): boolean;
}

export class PresentationHost {
  constructor(private readonly deps: PresentationDeps) {}

  /** 此刻接管整屏的那一屏（开着的优先，见 `overlay.ts`）*/
  overlay(): UiScreen | null {
    return selectOverlay(this.deps.screens, this.deps.env());
  }

  /** 台词那一侧（框的起播闸用）*/
  speechSnapshot(): SpeechSnapshot {
    const s = this.deps.speech();
    return { onStage: s.onStage, heldRanks: countedHeld(s.held, (c) => this.deps.cueDone(c)).map((h) => h.rank) };
  }

  /**
   * 屏上此刻开着一扇框（含訊息框收掉后那段空等）。
   * ⚠️ 只读各屏自己的状态位 —— **不碰**影片位、不碰 `screensBlocking`（断环）。
   */
  boxShowing(): boolean {
    if (this.deps.godLine().showing || noticeShowing() || eventBoxScreenState().playing) return true;
    if (wheelScreenState().playing || godSlotState().playing) return true;
    const env = this.deps.env();
    for (const s of this.deps.screens) {
      if (!ACTIVE_MEANS_SHOWING.has(s.id) || !s.active(env)) continue;
      if (s.id === 'magic' && this.deps.magicAwaitingPick()) continue;
      return true;
    }
    return false;
  }

  /** 框那一侧（台词的上台闸用）*/
  boxSnapshot(): BoxSnapshot {
    const pendingRanks = noticePendingRanks();
    if (this.deps.deferredScreens() > 0) pendingRanks.push(boxRank(SCREEN_BOX_TIER.monthly));
    if (eventBoxPending()) pendingRanks.push(boxRank(SCREEN_BOX_TIER.eventBox));
    if (wheelScreenState().pending) pendingRanks.push(boxRank(SCREEN_BOX_TIER.wheel));
    if (godSlotState().pending) pendingRanks.push(boxRank(SCREEN_BOX_TIER.godSlot));
    if (this.deps.godLine().pending) pendingRanks.push(boxRank(SCREEN_BOX_TIER.godSay));
    return { showing: this.boxShowing(), pendingRanks, filmsBusy: this.deps.filmsBusy() };
  }

  /** 一扇框能不能起播：台词那一侧放行、且屏上没有别的框 —— `true` = **还不能** */
  boxBlocked(tier: BoxTier): boolean {
    return !boxMayStart(tier, this.speechSnapshot()) || this.boxShowing();
  }

  /**
   * 演出类整屏在接管（= 旧 `blockingPresentation`）：回合驱动 / 联机收件箱据此等。
   * ★ 訊息框只是排着等台词（或等别的框）时不算 —— 否则押在后面的台词与它互等；
   * ★ 魔法屋女巫窗等真人点格时不算 —— 那是待决交互。
   */
  screensBlocking(): boolean {
    if (this.deps.bailClosing()) return true;
    if (this.deps.deferredScreens() > 0) return true;
    const overlay = this.overlay();
    if (overlay === null) return false;
    if (overlay.id === 'magic' && this.deps.magicAwaitingPick()) return false;
    if (overlay.id === 'notice' && noticeWaitingForSpeech()) return false;
    // ★ 第十八份：拍賣屏落槌之后那段结算 / 补演「开拍即流标」是纯演出（原版在模态窗口里）；
    //   竞价进行中不算（每一口要靠驱动 / 收件箱送进来）
    // ★ gap-audit #4（仅联机）：竞价中上一口的挥槌 / 开场那句还没走完 ⇒ 收件箱先别放下一口
    //   （节拍 = 单机本屏自己出电脑那一口的 `nextAt`；到点自己放，不会死锁）
    if (overlay.id === 'auction') {
      const env = this.deps.env();
      return auctionPresentationOnly(env) || auctionBidPacing(env);
    }
    return BLOCKING_PRESENTATIONS.has(overlay.id);
  }
}
