/*
 * 第二十一份（`20260924-144217689`）：董事長踩到商店 —— 先在**地图屏**弹「歡迎董事長光臨 送您%s！」，
 * 再说那句「好消息」台词，**然后**才开商店窗（老板娘的招呼在开窗之后）。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `_rich4_ui_shop_entry`（`fcn_0042e931`）：`0x0042ea14 call 0x440cac(buf, 0x5dc)`（訊息框，阻塞）→
 *   `0x0042ea23 call 0x44f230`（台词，阻塞）→ `0x0042ea2b` 之后才建商店窗。
 *
 * 回报现场（联机，本机真人 P0 是「百貨」那家企業的董事長）：日志是
 * `付费訊息框：shop.chairmanGift` → `♪ midi07.mid`（商店窗已开）→ `結束` —— 框弹在了商店窗上。
 * 病根：`notifyApplied` 在訊息框 `event()` 登记、台词上账**之前**就调了 `syncShopUi`，那一拍闸看不见它们。
 *
 * 本测试把回报最后那一条（`settle` → `pending{shop}`）原样灌进**真的**訊息框屏 + 台词队列，
 * 用与 `main.ts` 同一套闸（`PresentationHost` + `shopWindowMayOpen`）逐拍推，
 * 分别按「旧次序」（先同步商店窗、再登记）与「新次序」跑，钉住先后。
 * 联机旁观者走的是同一个 `notifyApplied`（收件箱施加），次序同样适用；联机的状态一致性见
 * `packages/server/src/shop-gift-mp.test.ts`。
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MkfArchive } from '../../assets-pipeline/src/mkf.ts';
import { deserializeGame, parseMap, replayTrail, stateFingerprint, type Action, type GameState, type MapTopology } from '@rich4/core';
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
import { shopWindowMayOpen } from './shop-screen.ts';
import { SpeechQueue, type SpeechBubble } from './speech-bubble.ts';
import { speechEventsFor, speechLinesFor } from './speech.ts';
import type { SpeechOrder } from './stage-gate.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const REPORT = new URL('./fixtures/pt21-chairman-shop-report.json', import.meta.url);
const MAP_MKF = new URL('../../../assets/game/map.mkf', import.meta.url);
const run = existsSync(MAP_MKF) ? it : it.skip;

function load(): { before: GameState; after: GameState; action: Action; topo: MapTopology; map: ReturnType<typeof parseMap>; fp: string } {
  const r = JSON.parse(readFileSync(REPORT, 'utf8')) as {
    base: string;
    trail: { t: number; action: Action; seed: number }[];
    finalFingerprint: string;
  };
  const before = deserializeGame(r.base);
  const map = parseMap(new MkfArchive(new Uint8Array(readFileSync(MAP_MKF))).read(before.globalMapId * 2 + 1));
  const topo: MapTopology = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
    landscapes: map.landscapes,
  };
  const after = replayTrail(before, r.trail, topo);
  return { before, after, action: r.trail[0]!.action, topo, map, fp: r.finalFingerprint };
}

interface Timeline {
  noticeStart: number | null;
  noticeEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  shopOpen: number | null;
}

/** 一台极简宿主（接线同 `main.ts`）：`oldOrder` = 先同步商店窗、再登记框与台词（修之前的 `notifyApplied`）*/
function simulate(oldOrder: boolean): Timeline {
  const { before, after, topo, map } = load();
  resetNoticeBoxScreen();
  let now = 0;
  const state = after;
  const speechQueue = new SpeechQueue();
  let held: { bubble: SpeechBubble; order: SpeechOrder; rank: number }[] = [];
  const env = {
    screen: 'game',
    state,
    topo,
    map,
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

  let shopOpen: number | null = null;
  const syncShop = () => {
    if (shopOpen !== null || state.pending?.kind !== 'shop') return;
    const ok = shopWindowMayOpen({
      blocking: host.screensBlocking(),
      noticeShowing: noticeShowing(),
      noticeQueued: noticePendingRanks().length,
      speechOnStage: speechQueue.length,
      speechHeld: held.length,
    });
    if (ok) shopOpen = now;
  };
  const release = () => {
    const snap = host.boxSnapshot();
    const keep: typeof held = [];
    const out: SpeechBubble[] = [];
    let stop = false;
    for (const h of held) {
      if (!stop && lineMayEnter(h.order, snap)) out.push(h.bubble);
      else {
        stop = true;
        keep.push(h);
      }
    }
    held = keep;
    if (out.length > 0) speechQueue.push(out, now);
  };

  // ── notifyApplied ──
  if (oldOrder) syncShop();
  const lines = speechLinesFor(after, speechEventsFor(before, after, topo));
  held = insertByRank(
    held,
    lines.map((l) => ({ bubble: l.bubble, order: l.order, rank: lineRank(l.order) })),
  );
  noticeBoxScreen.event?.(before, after, env);
  release();
  if (!oldOrder) syncShop();

  // ── 逐帧 ──
  const t: Timeline = { noticeStart: null, noticeEnd: null, lineStart: null, lineEnd: null, shopOpen: null };
  const DT = 16;
  while (now < 30_000) {
    if (host.overlay() !== null) host.overlay()?.tick?.(env);
    release();
    speechQueue.tick(now);
    const showingBox = noticeBoxScreenState().playback !== null;
    if (showingBox && t.noticeStart === null) t.noticeStart = now;
    if (!showingBox && t.noticeStart !== null && t.noticeEnd === null) t.noticeEnd = now;
    if (speechQueue.current() !== null && t.lineStart === null) t.lineStart = now;
    if (speechQueue.current() === null && t.lineStart !== null && t.lineEnd === null) t.lineEnd = now;
    syncShop(); // 渲染循环里那一处每帧补呼
    if (shopOpen !== null && t.lineEnd !== null) break;
    now += DT;
  }
  t.shopOpen = shopOpen;
  return t;
}

describe('★★ 第二十一份：董事長進店 —— 地图屏赠礼框 → 台词 → 商店窗', () => {
  run('fixture 忠实：回报最后一条（settle）重放出 pending{shop} + 赠礼框 + 赠礼提示，指纹与回报一致', () => {
    const { before, after, fp } = load();
    expect(stateFingerprint(after)).toBe(fp);
    expect(before.pending).toBeNull();
    expect(after.pending?.kind).toBe('shop');
    expect(after.notices.map((n) => n.key)).toEqual(['shop.chairmanGift']);
    expect(after.lastShopGift).not.toBeNull();
  });

  run('旧次序（先同步商店窗、再登记框与台词）⇒ 复现回报：商店窗在框之前就开了', () => {
    const t = simulate(true);
    expect(t.shopOpen).toBe(0);
    expect(t.noticeStart).not.toBeNull();
    expect(t.noticeStart!).toBeGreaterThanOrEqual(t.shopOpen!);
  });

  run('新次序 ⇒ 框先弹、框收掉之后说台词、台词说完才开商店窗', () => {
    const t = simulate(false);
    expect(t.noticeStart).toBe(0);
    expect(t.noticeEnd).not.toBeNull();
    // 那句「好消息」台词在框收掉之后才上台（`0x0042ea14` → `0x0042ea23`）
    expect(t.lineStart).not.toBeNull();
    expect(t.lineStart!).toBeGreaterThanOrEqual(t.noticeEnd!);
    // 商店窗在台词说完之后才开（`0x0042ea28` 之后建窗）
    expect(t.shopOpen).not.toBeNull();
    expect(t.shopOpen!).toBeGreaterThanOrEqual(t.lineEnd!);
  });
});

describe('`shopWindowMayOpen` 纯函数', () => {
  const idle = { blocking: false, noticeShowing: false, noticeQueued: 0, speechOnStage: 0, speechHeld: 0 };
  it('什么都没在演 ⇒ 开', () => {
    expect(shopWindowMayOpen(idle)).toBe(true);
  });
  it.each([
    ['blocking', { blocking: true }],
    ['noticeShowing', { noticeShowing: true }],
    ['noticeQueued', { noticeQueued: 1 }],
    ['speechOnStage', { speechOnStage: 1 }],
    ['speechHeld', { speechHeld: 1 }],
  ])('%s ⇒ 先别开', (_name, patch) => {
    expect(shopWindowMayOpen({ ...idle, ...patch })).toBe(false);
  });
});

describe('`main.ts` 接线（源码钉）', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  it('`notifyApplied` 里 `syncShopUi` 排在各屏 `event()` 登记与台词放行**之后**', () => {
    const start = main.indexOf('function notifyApplied(before: GameState): void {');
    const end = main.indexOf('\n}\n', start);
    const body = main.slice(start, end);
    const deliver = body.indexOf('deliverScreenEvent(s, before, state, env)');
    const releaseAt = body.indexOf('releaseHeldSpeech(performance.now())');
    const sync = body.indexOf('syncShopUi();');
    expect(deliver).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(deliver);
    expect(sync).toBeGreaterThan(releaseAt);
    // 只调一次（不能前面再留一处）
    expect(body.indexOf('syncShopUi();')).toBe(body.lastIndexOf('syncShopUi();'));
  });
  it('`syncShopUi` 的闸是 `shopWindowMayOpen`，且把排着的訊息框算上', () => {
    const fn = main.slice(main.indexOf('function syncShopUi(): void {'));
    const head = fn.slice(0, fn.indexOf('if (shopUi === null) {\n    const ui'));
    expect(head).toContain('shopWindowMayOpen(');
    expect(head).toContain('noticePendingRanks().length');
    expect(head).toContain('noticeShowing()');
  });
});
