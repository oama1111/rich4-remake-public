/*
 * ★★ `20260925-134801926`（「为什么直接没让我进商店」）：董事長踩到百貨公司 ——
 *   进店那三段是**阻塞**的（赠礼框 → 「好消息」台词 → 建商店窗，@source 见
 *   `shop-screen.ts` 的 `shopWindowMayOpen`），**窗开之前屏上不该有任何能作答商店的东西**。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回报现场（单机，玩家 Charles = 阿土伯 P0，第 28 回合；日志逐条）：
 * ```
 * ▶ 股市：買進 / 買進股數 2292 / 股市：離開      ← 先用工具列的股市买下大宇百貨 2292 股（当上董事長）
 * 付费訊息框：shop.chairmanGift                  ← 踩到百貨公司（节点 8）当上董事長的那份赠礼框
 * 付费訊息框：跳过                               ← 点一下把框跳过
 * ▶ 百貨公司：EXIT                              ← ★ 第二下点落到了**后备交互壳**的 EXIT 上
 * ```
 * 全程**没有** `♪ midi07.mid`（商店窗从没建起来）⇒ 那一下把这一趟 `declineDecision` 掉了，
 * 玩家报「为什么直接没让我进商店」。
 *
 * 病根（客户端）：`interactions.ts` 给商店留的那份最小后备壳（万一商店屏没画出来还能走人）
 * 由 `main.ts` 的 `currentDialog()` 交给棋盘对话框（`drawDialog` / `hitDialog` / `onDialogHit`）
 * 以及键盘（是 / 否 / 確定）、右键取消梯子、触屏「取消」钮共用；而它当时**不看出演状态**，
 * 于是框 / 台词还在台上（= 原版那两段阻塞调用还没返回）时就收点击。
 * 日志里那第二下就落在它上面（赠礼框画在棋盘对话框那一块，框一收，底下的壳就露出来了）。
 *
 * 本测试：纯判据的真值表 + 现场逐拍重放（真的訊息框屏 + 真的台词队列 + 与 `main.ts`
 * 同一份闸），外加 `main.ts` 的接线钉。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SPECIAL_KIND,
  TRAFFIC_WALK,
  initialCardAmounts,
  initialToolStock,
  makeGameState,
  makeNode,
  makePlayer,
  reduce,
  type MapTopology,
} from '@rich4/core';
import { STORE_INDUSTRY } from '../../core/src/places/shop.ts';
import {
  noticeBoxScreen,
  noticeBoxScreenState,
  noticePendingRanks,
  noticeShowing,
  resetNoticeBoxScreen,
  setNoticeOverlayGate,
  setNoticeSpeechGate,
  setNoticeStartGate,
} from './notice-box-screen.ts';
import { insertByRank, lineMayEnter, lineRank } from './presentation-order.ts';
import { PresentationHost } from './presentation-host.ts';
import { shopShellMayAnswer, shopWindowMayOpen } from './shop-screen.ts';
import { SpeechQueue, type SpeechBubble } from './speech-bubble.ts';
import { speechEventsFor, speechLinesFor } from './speech.ts';
import type { SpeechOrder } from './stage-gate.ts';
import type { UiScreenEnv } from './ui-screen.ts';

describe('`shopShellMayAnswer` 纯函数', () => {
  it('不是商店待决 ⇒ 不关它的事', () => {
    expect(shopShellMayAnswer({ pendingKind: null, windowOpen: false, windowMayOpen: () => false })).toBe(true);
    expect(shopShellMayAnswer({ pendingKind: 'buyLand', windowOpen: false, windowMayOpen: () => false })).toBe(true);
  });

  it('商店窗已经建起来 ⇒ 壳照旧可用（那一拍棋盘对话框本来就不画、不吃点击）', () => {
    expect(shopShellMayAnswer({ pendingKind: 'shop', windowOpen: true, windowMayOpen: () => false })).toBe(true);
  });

  it('★ 现场那一拍：窗还没建、进店演出（框 / 台词）还在台上 ⇒ 壳**不许**作答', () => {
    expect(shopShellMayAnswer({ pendingKind: 'shop', windowOpen: false, windowMayOpen: () => false })).toBe(false);
  });

  it('演出演完（窗开得起来）而窗仍没建 ⇒ 壳还是兜底（这一拍放它出来）', () => {
    expect(shopShellMayAnswer({ pendingKind: 'shop', windowOpen: false, windowMayOpen: () => true })).toBe(true);
  });
});

// ============================================================
//  现场逐拍：董事長踩到百貨公司
// ============================================================

const node = makeNode({
  id: 1,
  adjacent: [1],
  flags: SPECIAL_KIND.DEPARTMENT_STORE,
  specialKind: SPECIAL_KIND.DEPARTMENT_STORE,
});
/** 玩家 0 是那家百貨（行業 10）的董事長 ⇒ 有赠礼框 */
const chairmanTopo = {
  nodes: [node],
  commercials: [{ id: 0, type: STORE_INDUSTRY, x: 0, y: 0, name: '百貨', stockIndex: 0 }],
} as unknown as MapTopology;

function shopLanding(): {
  before: ReturnType<typeof makeGameState>;
  after: ReturnType<typeof makeGameState>;
} {
  const base = makeGameState({
    phase: 'settling',
    // 货架是从牌堆 / 库存里抽的 —— 空牌堆抽不出东西
    cardAmount: initialCardAmounts(),
    toolStock: initialToolStock(),
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, points: 500, trafficMethod: TRAFFIC_WALK }),
    ),
  });
  const owners = base.commercialOwners.map((c) => ({ ...c }));
  owners[0] = { ...owners[0]!, owner: 1 }; // 1 基 ⇒ 玩家 0
  const before = { ...base, commercialOwners: owners };
  return { before, after: reduce(before, { type: 'settle' }, chairmanTopo) };
}

interface Frame {
  /** 商店窗建起来了没有（`main.ts` 的 `shopUi !== null`）*/
  windowOpen: boolean;
  /** 这一拍「开窗闸」的结论（`shopWindowMayOpen`）*/
  gate: boolean;
  /** 这一拍棋盘的通用对话框（= 商店那份后备壳）会不会收点击 —— 与 `main.ts` 同一判据 */
  shellAnswerable: boolean;
  /**
   * 修**之前**那一拍会怎样：壳不看出演、摆着就收点击（`currentDialog` 只判座位与待决种类）
   * ⇒ 窗还没建起来的每一拍都作答。用来证明「回报那一对点击落在哪几拍」。
   */
  oldShellWouldAnswer: boolean;
}

/**
 * 逐拍推：真的訊息框屏 + 真的台词队列 + `PresentationHost`（与 `main.ts` 同一套接线）。
 *
 * `skipBoxAfterMs` = 玩家在第几毫秒把赠礼框点掉（现场日志的 `付费訊息框：跳过`）；
 * 传 `Infinity` = 不点，让框自己到时收。
 */
function runEntry(skipBoxAfterMs: number): {
  frames: Frame[];
  boxShown: boolean;
  windowOpenAt: number | null;
} {
  const { before, after } = shopLanding();
  if (after.pending?.kind !== 'shop') throw new Error('这张台子上落点应当挂出商店交互');
  resetNoticeBoxScreen();
  let now = 0;
  const speechQueue = new SpeechQueue();
  let held: { bubble: SpeechBubble; order: SpeechOrder; rank: number }[] = [];
  const env = {
    screen: 'game',
    state: after,
    topo: chairmanTopo,
    map: undefined,
    get now() {
      return now;
    },
    stage: {} as CanvasRenderingContext2D,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: () => undefined,
    playEffect: () => undefined,
    stopEffect: () => undefined,
    animation: true,
  } as unknown as UiScreenEnv;
  const host = new PresentationHost({
    screens: [noticeBoxScreen],
    env: () => env,
    filmsBusy: () => false,
    godLine: () => ({ showing: false, pending: false }),
    speech: () => ({ onStage: speechQueue.length, held }),
    cueDone: () => true,
    deferredScreens: () => 0,
    magicAwaitingPick: () => false,
    bailClosing: () => false,
  });
  setNoticeStartGate(() => false);
  setNoticeOverlayGate(() => false);
  setNoticeSpeechGate((tier) => host.boxBlocked(tier));

  // ── `notifyApplied`：台词先上账（押着），再把这一条 action 交给各屏，最后放行能上台的 ──
  const lines = speechLinesFor(after, speechEventsFor(before, after, chairmanTopo));
  held = insertByRank(
    held,
    lines.map((l) => ({ bubble: l.bubble, order: l.order, rank: lineRank(l.order) })),
  );
  noticeBoxScreen.event?.(before, after, env);
  const release = (): void => {
    const snap = host.boxSnapshot();
    const keep: typeof held = [];
    const out: SpeechBubble[] = [];
    let blocked = false;
    for (const h of held) {
      if (blocked || !lineMayEnter(h.order, snap)) {
        blocked = true;
        keep.push(h);
        continue;
      }
      out.push(h.bubble);
    }
    held = keep;
    if (out.length > 0) speechQueue.push(out, now);
  };
  release();

  // ── 逐拍（与 `main.ts` 的 `requestRender` 同一条：訊息框屏自己 tick、本机每帧补呼）──
  const frames: Frame[] = [];
  let windowOpen = false;
  let boxShown = false;
  let windowOpenAt: number | null = null;
  let skipped = false;
  const DT = 16;
  while (now < 30_000) {
    host.overlay()?.tick?.(env);
    release();
    speechQueue.tick(now);
    if (noticeBoxScreenState().playback !== null) boxShown = true;
    // ★ 现场那一下：玩家点掉赠礼框（`付费訊息框：跳过`）
    if (!skipped && boxShown && now >= skipBoxAfterMs && noticeBoxScreenState().playback !== null) {
      skipped = true;
      noticeBoxScreen.up?.(0, 0, env);
    }
    const gate = shopWindowMayOpen({
      blocking: host.screensBlocking(),
      noticeShowing: noticeShowing(),
      noticeQueued: noticePendingRanks().length,
      speechOnStage: speechQueue.length,
      speechHeld: held.length,
    });
    // `main.ts` 的 `syncShopUi` 就在这一拍建窗（闸开 = 窗开）
    if (gate && !windowOpen) {
      windowOpen = true;
      windowOpenAt = now;
    }
    frames.push({
      windowOpen,
      gate,
      shellAnswerable: shopShellMayAnswer({
        pendingKind: 'shop',
        windowOpen,
        windowMayOpen: () => gate,
      }),
      oldShellWouldAnswer: !windowOpen,
    });
    if (windowOpen && speechQueue.length === 0) break;
    now += DT;
  }
  return { frames, boxShown, windowOpenAt };
}

describe('★★ 现场：董事長踩到百貨公司 —— 商店窗开之前，后备壳不许作答', () => {
  it('落点那一条 action 挂出 `pending{shop}` + 董事長赠礼框（现场状态）', () => {
    const { after } = shopLanding();
    expect(after.pending?.kind).toBe('shop');
    expect(after.notices.map((n) => n.key)).toEqual(['shop.chairmanGift']);
    expect(after.lastShopGift ?? null).not.toBeNull();
  });

  it('★ 跳过赠礼框之后接着乱点 ⇒ 什么都不派（修之前：那一下 = `▶ 百貨公司：EXIT`）', () => {
    const r = runEntry(700);
    // 框真的弹了（现场日志那条 `付费訊息框：shop.chairmanGift`）
    expect(r.boxShown).toBe(true);
    // 现场那一对点击落在「窗还没建起来」的拍子上 —— 修之前那些拍子**都**作答（= 回报）
    const beforeWindow = r.frames.filter((f) => !f.windowOpen);
    expect(beforeWindow.length).toBeGreaterThan(0);
    expect(beforeWindow.every((f) => f.oldShellWouldAnswer)).toBe(true);
    // ★ 修之后：进店演出期间没有一拍能作答
    expect(beforeWindow.every((f) => !f.shellAnswerable)).toBe(true);
    // 而且演出演完之后窗是开得起来的（不是靠「永远关着」蒙混）
    expect(r.windowOpenAt).not.toBeNull();
  });

  it('★ 不点框也一样：赠礼框自收到台词说完之前，壳都不作答', () => {
    const r = runEntry(Number.POSITIVE_INFINITY);
    expect(r.boxShown).toBe(true);
    expect(r.frames.filter((f) => !f.windowOpen).every((f) => !f.shellAnswerable)).toBe(true);
    // 窗不是跟框同时开的：框 / 台词演完之后才开（@source `0x0042ea14` → `0x0042ea23` → `0x0042ea28`）
    expect(r.windowOpenAt).not.toBeNull();
    expect(r.windowOpenAt!).toBeGreaterThan(0);
  });
});

describe('`main.ts` 接线（源码钉）', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('`currentDialog` 用 `shopShellMayAnswer` 挡住商店那份后备壳', () => {
    const fn = main.slice(main.indexOf('function currentDialog(): InteractionUi | null {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('shopShellMayAnswer(');
    // 三个实参：待决种类 / 窗建起来没有 / 开窗闸 —— 闸必须取**同一份**取值
    expect(body).toContain('pendingKind:');
    expect(body).toContain('windowOpen: shopUi !== null');
    expect(body).toContain('windowMayOpen: shopOpenGate');
    // 挡在**所有**出口（含持卡人那一问）之前 —— 键盘 / 右键 / 触屏「取消」都读这个函数
    expect(body.indexOf('shopShellMayAnswer(')).toBeLessThan(body.indexOf('cardPassiveDialogOpen()'));
  });

  it('开窗与壳共用 `shopOpenGate()`（一处取值，不许各写一套）', () => {
    const gate = main.slice(main.indexOf('function shopOpenGate(): boolean {'));
    expect(gate.slice(0, gate.indexOf('\n}\n'))).toContain('shopWindowMayOpen(');
    const sync = main.slice(main.indexOf('function syncShopUi(): void {'));
    expect(sync.slice(0, sync.indexOf('if (shopUi === null) {\n    const ui'))).toContain('shopOpenGate()');
    // 取值只此一处：`blockingPresentation()` 不再在别处直接喂给 `shopWindowMayOpen`
    expect(main.split('shopWindowMayOpen({').length).toBe(2);
  });
});
