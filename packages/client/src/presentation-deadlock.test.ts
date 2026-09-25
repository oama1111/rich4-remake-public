/*
 * 第十六份：线上卡死（`20260923-234517253-manual-Charles.json`，「卡死了」）的回归 ——
 * 把那份回报的 action 原样灌进**真的**几扇演出屏（事件框 / 轉盤 / 老虎机 / 訊息框）+ 台词队列，
 * 用与 `main.ts` 同一套闸（`presentation-order.ts`）与同一套接管 / 排队规则（`overlay.ts`）逐拍推，
 * 时钟是假的。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 那一次：第 112 条（P2 踩到小窮神）排下老虎机，第 118 条（P3 用地雷）在联机补帧里当场弹出
 * 「使用地雷」框、道具台词押在框后面 —— 老虎机等台词、台词等框、框等 `tick`（老虎机占着第一屏）。
 * 本测试先用**旧规矩**（第一个 active 的屏接管、排着的屏不另外 tick、框不看别的框）复现卡死，
 * 再用新规矩跑完：全部收场、气泡与框从不同屏。
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MkfArchive } from '../../assets-pipeline/src/mkf.ts';
import {
  PLACEMENT_TOOLS,
  decideAction,
  deserializeGame,
  newGame,
  parseMap,
  reduce,
  replayTrail,
  stateFingerprint,
  type Action,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { eventBoxScreen, resetEventBoxScreen, setEventBoxStartGate } from './event-box-screen.ts';
import { godLineTrigger } from './god-line.ts';
import { freshMagicBeats } from './magic-fx.ts';
import { godSlotScreen, godSlotState, resetGodSlot, setGodSlotStartGate } from './god-slot.ts';
import {
  noticeBoxScreen,
  noticeHoldsFilms,
  resetNoticeBoxScreen,
  noticeBoxScreenState,
  queueLocalNotice,
  setNoticeOverlayGate,
  setNoticeSpeechGate,
  setNoticeStartGate,
} from './notice-box-screen.ts';
import { pendingScreens, selectOverlay } from './overlay.ts';
import {
  SCREEN_BOX_TIER,
  boxMayStart,
  insertByRank,
  lineMayEnter,
  lineRank,
  speechAheadOfFilms,
  type BoxTier,
  type SpeechCue,
} from './presentation-order.ts';
import { PresentationHost } from './presentation-host.ts';
import { SpeechQueue, type SpeechBubble } from './speech-bubble.ts';
import { cardPlaySpeechLines, speechEventsFor, speechLinesFor, toolUseSpeechLines, type SpeechLine } from './speech.ts';
import type { SpeechOrder } from './stage-gate.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { resetWheelScreen, setWheelStartGate, wheelScreen, wheelScreenState } from './wheel-screen.ts';

/** 那份回报里重放要用的 base + trail（原档 1.4 MB，截图等不要）*/
const REPORT = new URL('./fixtures/pt16-deadlock-report.json', import.meta.url);
const MAP_MKF = new URL('../../../assets/game/map.mkf', import.meta.url);
const run = existsSync(MAP_MKF) ? it : it.skip;

/** 与 `SCREENS` 同一相对次序（事件框 → 轉盤 → 老虎机 → 訊息框）*/
const SCREENS: readonly UiScreen[] = [eventBoxScreen, wheelScreen, godSlotScreen, noticeBoxScreen];

interface Held {
  bubble: SpeechBubble;
  order: SpeechOrder;
  rank: number;
  cue?: SpeechCue;
}

interface RunResult {
  quiescentAt: number | null;
  overlaps: number;
  stuck: string;
}

/**
 * 上一趟的吞吐：最后一条施加的时刻；**演出链签名**连续不变（= `main.ts` 的演出死锁看门狗会出手）的最长一段（ms）。
 */
let lastRun = { appliedAt: 0, longestStall: 0 };

interface Step {
  before: GameState;
  after: GameState;
  action: Action;
  /** 这一条到达的时刻（ms，相对第一条）*/
  at: number;
  /** 联机旁观：这一条到达前行动者已经收场 ⇒ 本台各屏跟着落到终态（`followPresenter`）*/
  followPresenter?: boolean;
}

function loadReport(): { steps: Step[]; topo: MapTopology; map: ReturnType<typeof parseMap> } {
  const report = JSON.parse(readFileSync(REPORT, 'utf8')) as {
    base: string;
    trail: { t: number; action: Action; seed: number }[];
    /** 时间零点（原第 100 条的时刻；rebase 之后 trail 从原第 105 条起，零点不变）*/
    t0?: number;
    /**
     * trail 下标 → 录制时那一条的结果（`serializeGame`）。只冻结换人那两条 `endTurn`：可成交量 `0x42915a`
     * 挪到每位玩家回合开头（`0x0041c868`）之后，这两条的抽签与线上录制不同，而后续录下的 action 是照旧结果走的。
     */
    frozen?: Record<string, string>;
  };
  const base = deserializeGame(report.base);
  const map = parseMap(new MkfArchive(new Uint8Array(readFileSync(MAP_MKF))).read(base.globalMapId * 2 + 1));
  const topo: MapTopology = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
    landscapes: map.landscapes,
  };
  // 把每一条施加后的前后局面先算好（与 `replay-report.ts` 同一个 `replayTrail`）
  const all: Step[] = [];
  let cur = base;
  report.trail.forEach((e, i) => {
    const pinned = report.frozen?.[String(i)];
    const after = pinned !== undefined ? deserializeGame(pinned) : replayTrail(cur, [e], topo);
    all.push({ before: cur, after, action: e.action, at: e.t });
    cur = after;
  });
  // 按回报里的时间差灌。★ 2026-09-24 起 fixture 的 base 已是原第 105 条之前的局面（见 fixture 的 `rebased`：
  //   可成交量 `0x42915a` 挪到每位玩家回合开头之后，从原 base 重放会在第 11 条 endTurn 就与线上录制分叉）
  //   ⇒ 从头灌（先前是从原第 100 条起灌，那 5 条是上一位的收尾，与这次卡死无关）
  const START = 0;
  const t0 = report.t0 ?? all[START]!.at;
  return { steps: all.slice(START).map((x) => ({ ...x, at: x.at - t0 })), topo, map };
}

/**
 * 一台极简的宿主：只有演出那一半（没有 DOM / 音频 / 渲染器），闸的接线与 `main.ts` 一一对应。
 * @param oldRules 用第十六份之前的规矩（复现卡死用）
 */
function runPipeline(
  steps: readonly Step[],
  topo: MapTopology,
  map: ReturnType<typeof parseMap>,
  oldRules: boolean,
  drainMs = 120_000,
  /**
   * ★ 第十六份第二轮：`true` = 联机收件箱那样**拉**（`pumpNetInbox`）—— action 到了也要等
   *   `holdForActorWalk` 放行才施加；积压超过 150 条就一口气施加到剩 40 条（补帧）。
   *   `false` = 按到达时刻硬灌（第一轮那种「补帧」极端）。
   */
  inbox = false,
): RunResult {
  resetNoticeBoxScreen();
  resetEventBoxScreen();
  resetWheelScreen();
  resetGodSlot();

  let now = 0;
  let state = steps[0]?.before ?? ({} as GameState);
  const speechQueue = new SpeechQueue();
  let held: Held[] = [];
  let godLine: number | null = null;
  let pendingGodLine = false;
  let film: number | null = null;
  let pendingFilm = false;
  let flight: number | null = null;
  let flightAwaits = false;
  const GOD_LINE_MS = 2400;
  const FILM_MS = 2800;
  const FLIGHT_MS = 480;

  const env = {
    screen: 'game',
    get state() {
      return state;
    },
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

  const cueDone = (cue: SpeechCue): boolean => (cue === 'godAttach' ? flight === null && !flightAwaits : true);
  const filmsBusy = () => film !== null || pendingFilm || flight !== null || flightAwaits;
  // ★ 与 `main.ts` **同一份**判据（`presentation-host.ts`）—— 只把现取的状态换成本宿主的
  const host = new PresentationHost({
    screens: SCREENS,
    env: () => env,
    filmsBusy,
    godLine: () => ({ showing: godLine !== null, pending: pendingGodLine }),
    speech: () => ({ onStage: speechQueue.length, held }),
    cueDone,
    deferredScreens: () => 0,
    magicAwaitingPick: () => false,
    bailClosing: () => false,
  });
  const speechSnap = () => host.speechSnapshot();
  const showing = () => host.boxShowing();
  /** 旧规矩（复现用）：只看台词那一侧、不看别的框 */
  const blocked = (tier: BoxTier) => (oldRules ? !boxMayStart(tier, speechSnap()) : host.boxBlocked(tier));

  // ── 闸（与 `main.ts` 的 `set…Gate` 同一接线）──
  setNoticeStartGate(
    () =>
      godLine !== null ||
      pendingGodLine ||
      film !== null ||
      pendingFilm ||
      wheelScreenState().playing ||
      wheelScreenState().pending ||
      godSlotState().playing ||
      godSlotState().pending,
  );
  setNoticeOverlayGate(() => eventBoxScreen.active(env));
  setNoticeSpeechGate((tier) => blocked(tier));
  setGodSlotStartGate(() => film !== null || pendingFilm || godLine !== null || pendingGodLine || blocked(SCREEN_BOX_TIER.godSlot));
  setEventBoxStartGate(() => blocked(SCREEN_BOX_TIER.eventBox));
  setWheelStartGate(() => blocked(SCREEN_BOX_TIER.wheel));

  const release = () => {
    const snap = host.boxSnapshot();
    const keep: Held[] = [];
    const out: SpeechBubble[] = [];
    let blocked = false;
    for (const h of held) {
      if (blocked || (h.cue !== undefined && !cueDone(h.cue))) keep.push(h);
      else if (lineMayEnter(h.order, snap)) out.push(h.bubble);
      else {
        blocked = true;
        keep.push(h);
      }
    }
    held = keep;
    if (out.length > 0) speechQueue.push(out, now);
  };

  const apply = (before: GameState, after: GameState, action: Action) => {
    state = after;
    // startActionFx 那一半：附身影片 + 开场白、放置類道具的投掷
    if (godLineTrigger(before, after) !== null) {
      pendingFilm = true;
      pendingGodLine = true;
    }
    if (action.type === 'useTool' && PLACEMENT_TOOLS.has(action.toolId)) {
      flightAwaits = true;
    }
    // notifyApplied 那一半：先押台词，再派 event()，再放行
    const lines: SpeechLine[] = [
      ...cardPlaySpeechLines(before, after),
      ...toolUseSpeechLines(before, after),
      ...speechLinesFor(after, speechEventsFor(before, after, topo)),
    ];
    held = insertByRank(
      held,
      lines.map((l) => ({ bubble: l.bubble, order: l.order, rank: lineRank(l.order), ...(l.cue === undefined ? {} : { cue: l.cue }) })),
    );
    for (const s of SCREENS) s.event?.(before, after, env);
    release();
  };

  const frame = () => {
    // 整屏：接管的那一屏 + 排着的几屏
    let overlay: UiScreen | null;
    if (oldRules) {
      overlay = SCREENS.find((s) => s.active(env)) ?? null;
    } else {
      overlay = host.overlay();
      for (const s of pendingScreens(SCREENS, overlay, env)) s.tick?.(env);
    }
    overlay?.tick?.(env);
    // 开场白（`tickGodLine`）
    if (pendingGodLine && film === null && !pendingFilm && !blocked(SCREEN_BOX_TIER.godSay) && !eventBoxScreen.active(env)) {
      godLine = now;
      pendingGodLine = false;
    }
    if (godLine !== null && now - godLine >= GOD_LINE_MS) godLine = null;
    // 附身影片（`tickBoardFilm`）：等先说的台词、飞行、`beforeFilms` 的框
    if (pendingFilm && speechAheadOfFilms(speechSnap()) === 0 && flight === null && !flightAwaits && !noticeHoldsFilms()) {
      pendingFilm = false;
      film = now;
    }
    if (film !== null && now - film >= FILM_MS) film = null;
    // 投掷（`tickObjectFlight`）
    if (flightAwaits && speechAheadOfFilms(speechSnap()) === 0 && !noticeHoldsFilms()) {
      flightAwaits = false;
      flight = now;
    }
    if (flight !== null && now - flight >= FLIGHT_MS) flight = null;
    // 台词（`speechTick`）
    release();
    speechQueue.tick(now);
  };

  let overlaps = 0;
  const DT = 16;
  /** `holdForActorWalk` 的演出那一半：整屏在接管 / 影片那一类在演 / 台词没说完 */
  const driverHeld = () => host.screensBlocking() || filmsBusy() || godLine !== null || pendingGodLine || speechQueue.length > 0 || held.length > 0;
  let appliedAt = 0;
  let applied = 0;
  // 演出链签名（与 `main.ts` 的 `presentationSignature` 同一思路）：有东西排 / 押着、签名又一直不变 = 停滞
  let sig = '';
  let sigSince = 0;
  let longestStall = 0;
  const watch = () => {
    const n = noticeBoxScreenState();
    const waiting = held.length > 0 || pendingFilm || pendingGodLine || flightAwaits || SCREENS.some((x) => x.active(env) && x.pendingOnly?.(env) === true);
    const k = [
      SCREENS.filter((x) => x.active(env)).map((x) => `${x.id}${x.pendingOnly?.(env) === true ? '?' : ''}`).join(','),
      held.length,
      speechQueue.length,
      speechQueue.current()?.lines.join('') ?? '-',
      `${n.queued}:${n.playback?.at ?? '-'}`,
      `${film}:${pendingFilm}:${flight}:${flightAwaits}:${godLine}:${pendingGodLine}`,
      applied,
    ].join('|');
    if (!waiting || k !== sig) {
      sig = k;
      sigSince = now;
      return;
    }
    longestStall = Math.max(longestStall, now - sigSince);
  };
  if (!inbox) {
    for (const s of steps) {
      while (now < s.at) {
        frame();
        watch();
        if (speechQueue.current() !== null && showing()) overlaps++;
        now += DT;
      }
      if (s.followPresenter === true) for (const sc of SCREENS) sc.fastForward?.(env);
      apply(s.before, s.after, s.action);
      applied++;
    }
  } else {
    // 联机收件箱：到了的 action 排队，驱动放行才施加一条，之后至少隔一个 tick（`paceDelay`）
    const TICK = 160;
    let next = 0;
    let nextPump = 0;
    const queue: Step[] = [];
    while (next < steps.length || queue.length > 0) {
      while (next < steps.length && steps[next]!.at <= now) queue.push(steps[next++]!);
      const catchUp = () => {
        const s = queue.shift()!;
        if (s.followPresenter === true) for (const sc of SCREENS) sc.fastForward?.(env);
        apply(s.before, s.after, s.action);
        applied++;
      };
      if (queue.length > 150) while (queue.length > 40) catchUp();
      if (queue.length > 0 && now >= nextPump) {
        if (!driverHeld()) {
          catchUp();
          appliedAt = now;
          nextPump = now + TICK;
        }
      }
      frame();
      watch();
      if (speechQueue.current() !== null && showing()) overlaps++;
      now += DT;
      if (now > 6 * 60 * 60_000) break; // 六个钟头都灌不完 = 吞吐塌了
    }
  }
  lastRun = { appliedAt, longestStall };
  const t0 = now;
  const quiet = () =>
    SCREENS.every((s) => !s.active(env)) &&
    held.length === 0 &&
    speechQueue.length === 0 &&
    godLine === null &&
    !pendingGodLine &&
    film === null &&
    !pendingFilm &&
    flight === null &&
    !flightAwaits;
  while (now - t0 < drainMs) {
    frame();
    watch();
    lastRun.longestStall = Math.max(lastRun.longestStall, longestStall);
    if (speechQueue.current() !== null && showing()) overlaps++;
    if (quiet()) return { quiescentAt: now - t0, overlaps, stuck: '' };
    now += DT;
  }
  const stuck = [
    SCREENS.filter((s) => s.active(env)).map((s) => `${s.id}${s.pendingOnly?.(env) === true ? '(排着)' : '(开着)'}`).join(','),
    `押着台词 ${held.length}`,
    `台上 ${speechQueue.length}`,
    `開場白 ${pendingGodLine ? '排着' : godLine !== null ? '开着' : '-'}`,
    `影片 ${pendingFilm ? '排着' : film !== null ? '在播' : '-'}`,
    `投掷 ${flightAwaits ? '排着' : flight !== null ? '在飞' : '-'}`,
  ].join(' / ');
  return { quiescentAt: null, overlaps, stuck };
}

describe('★★ 第十六份：线上卡死（老虎机排着 × 「使用地雷」框开着 × 道具台词押着）', () => {
  run('fixture 忠实：rebase + 冻结两条 endTurn 之后，重放到底的指纹 = 回报里录下的终局指纹', () => {
    const { steps } = loadReport();
    const report = JSON.parse(readFileSync(REPORT, 'utf8')) as { finalFingerprint: string };
    // 回报录于 2026-09-25 之前：那时指纹还不含道具库存 / 牌堆，也不含坐标朝向 / 惡人表 /
    // 地產三项（種類 / 到期日 / 上次過路費）⇒ 按**旧口径**比：把后来补进的字段全部去掉。
    const last = steps.at(-1)!.after;
    expect(
      stateFingerprint({
        ...last,
        toolStock: undefined,
        cardAmount: undefined,
        specialActors: undefined,
        landTenure: undefined,
        landType: undefined,
        landLastToll: undefined,
        players: last.players.map((p) => ({
          ...p,
          xpos: undefined,
          ypos: undefined,
          direction: undefined,
          lastNodeId: undefined,
        })),
      }),
    ).toBe(report.finalFingerprint);
  });

  run('旧规矩（第一个 active 的屏接管、排着的不另 tick、框不看别的框）⇒ 复现卡死', () => {
    const { steps, topo, map } = loadReport();
    const r = runPipeline(steps, topo, map, true);
    expect(r.quiescentAt).toBeNull();
    expect(r.stuck).toContain('god-slot(排着)');
    expect(r.stuck).toContain('notice(开着)');
  }, 120_000);

  run('新规矩 ⇒ 全部演完、气泡与框从不同屏', () => {
    const { steps, topo, map } = loadReport();
    const r = runPipeline(steps, topo, map, false);
    expect(r.stuck).toBe('');
    expect(r.quiescentAt).not.toBeNull();
    expect(r.overlaps).toBe(0);
  }, 120_000);
});

// ============================================================
//  长局：道具 × 神明附身 × 联机补帧（突发）× 旁观跟着收场
// ============================================================

const MAP_BIN = (id: number) => `${process.env.RICH4_WORKSPACE ?? ''}/extracted/map/${String(id * 2 + 1).padStart(4, '0')}.bin`;
const runSoak = existsSync(MAP_BIN(0)) ? it : it.skip;

describe('★★ 第十六份：96 局长跑灌进同一台宿主 —— 从不卡死、从不同屏', () => {
  runSoak(
    '8 张图 × 12 局；action 到达间隔 0–400 ms（含联机补帧那种 0 间隔的一串）；百分之二的 action 之前旁观端跟着行动者收场；再走一遍联机收件箱（驱动放行才施加）',
    () => {
      const failures: string[] = [];
      let toolUses = 0;
      let possessions = 0;
      let actions = 0;
      let oldStuck = 0;
      // ★ 48 局（原 24 局）：第十六份規則修正（研究所面板 / 被关者不进落点）改了电脑长局的轨迹，
      //   旧规矩在前 24 局里恰好不再撞上那种互等；对照组要撞得到才有意义 ⇒ 每张图多跑 3 局。
      // ★ 96 局（2026-09-24）：开局惰性摆人 + 可成交量 `0x42915a` 挪到每位玩家回合开头（`0x0041c868`）
      //   又改了轨迹，前 48 局旧规矩一局都不卡；照上一次的做法**加局数、不挑种子**：
      //   96 局里旧规矩卡死 3 局（g62 / g73 / g90），新规矩 96 局全收场（整段约 15 s）。
      const GAMES = 96;
      let longestStall = 0;
      let worstRatio = 0;
      let compared = 0;
      for (let g = 0; g < GAMES; g++) {
        const globalMapId = g % 8;
        const map = parseMap(new Uint8Array(readFileSync(MAP_BIN(globalMapId))));
        const topo: MapTopology = {
          nodes: map.nodes,
          lands: map.lands,
          facilities: map.facilities,
          commercials: map.commercials,
          landscapes: map.landscapes,
        };
        let st: GameState = newGame({
          map,
          globalMapId,
          players: [0, 1, 2, 3].map((i) => ({ character: (i + g * 5) % 12, kind: 'computer' as const })),
          seed: 9100 + g,
        });
        // 可复现的「网络」：线性同余的伪随机决定间隔 / 突发 / 跟着收场
        let r = 12345 + g;
        const rnd = () => {
          r = (r * 1103515245 + 12345) & 0x7fffffff;
          return r / 0x7fffffff;
        };
        const steps: Step[] = [];
        let at = 0;
        let burst = 0;
        for (let i = 0; i < 80_000 && st.turnCount < 160; i++) {
          const a = decideAction({ state: st, map });
          if (a === null) break;
          const n = reduce(st, a, topo);
          if (n === st) break;
          if (burst > 0) burst--;
          else if (rnd() < 0.08) burst = 5 + Math.floor(rnd() * 25);
          at += burst > 0 ? 0 : Math.floor(rnd() * 400);
          if (a.type === 'useTool') toolUses++;
          if (godLineTrigger(st, n) !== null) possessions++;
          const beats = freshMagicBeats(st, n);
          if (beats !== null) for (const b of beats) steps.push({ before: b.before, after: b.after, action: a, at });
          else steps.push({ before: st, after: n, action: a, at, ...(rnd() < 0.02 ? { followPresenter: true } : {}) });
          st = n;
        }
        actions += steps.length;
        const res = runPipeline(steps, topo, map, false, 30 * 60_000);
        const stall = lastRun.longestStall;
        // 对照：同一串 action 用旧规矩跑 —— 证明这套长跑抓得住那一类互等
        if (runPipeline(steps, topo, map, true, 30 * 60_000).quiescentAt === null) oldStuck++;
        if (res.quiescentAt === null) failures.push(`g${g} 图${globalMapId} 卡死：${res.stuck}`);
        if (res.overlaps > 0) failures.push(`g${g} 图${globalMapId} 同屏 ${res.overlaps} 帧`);
        // ★ 第十六份第二轮：同一串 action 走**联机收件箱**那条路（驱动放行才施加）——
        //   吞吐不许塌：驱动连续被挡不得到演出看门狗的 15 秒，全部施加完、全部收场
        if (stall >= 15_000) failures.push(`g${g} 停滞 ${stall} ms（看门狗会出手）`);
        longestStall = Math.max(longestStall, stall);
        const viaInbox = runPipeline(steps, topo, map, false, 30 * 60_000, true);
        if (viaInbox.quiescentAt === null) failures.push(`g${g} 收件箱 卡死：${viaInbox.stuck}`);
        if (viaInbox.overlaps > 0) failures.push(`g${g} 收件箱 同屏 ${viaInbox.overlaps} 帧`);
        if (lastRun.longestStall >= 15_000) failures.push(`g${g} 收件箱 停滞 ${lastRun.longestStall} ms（看门狗会出手）`);
        longestStall = Math.max(longestStall, lastRun.longestStall);
        const newSpan = lastRun.appliedAt;
        // 吞吐对照：同一串 action 用第十六份之前的规矩走收件箱（那一版在线上跑满 50 回合）；它没卡死的局，
        // 新规矩施加完的用时不许明显更长（第一版修复就是这里塌了：一扇框起播就爆栈、驱动停摆）
        const oldInbox = runPipeline(steps, topo, map, true, 30 * 60_000, true);
        if (oldInbox.quiescentAt !== null && lastRun.appliedAt > 0) {
          compared++;
          worstRatio = Math.max(worstRatio, newSpan / lastRun.appliedAt);
        }
      }
      expect(failures).toEqual([]);
      // 防空转：确实撞到了道具与神明附身
      expect(toolUses).toBeGreaterThan(100);
      expect(possessions).toBeGreaterThan(20);
      expect(actions).toBeGreaterThan(10_000);
      expect(oldStuck, '旧规矩在这 96 局里至少卡死一局（否则这套长跑测不出那一类问题）').toBeGreaterThan(0);
      // 收件箱那条路：从不停滞到看门狗那一步；吞吐不比旧规矩差多少
      console.log(`[收件箱] 最长停滞 ${longestStall} ms；与旧规矩对照 ${compared} 局，施加完用时之比最差 ${worstRatio.toFixed(2)}`);
      expect(longestStall).toBeLessThan(15_000);
      expect(compared).toBeGreaterThan(10);
      expect(worstRatio).toBeLessThan(1.25);
    },
    600_000,
  );
});

describe('`overlay.ts`：开着的屏优先接管，排着的每帧也问闸', () => {
  const fake = (id: string, active: boolean, pendingOnly: boolean): UiScreen =>
    ({ id, active: () => active, pendingOnly: () => pendingOnly, draw: () => undefined }) as unknown as UiScreen;
  const env = {} as UiScreenEnv;

  it('排着的屏在前、开着的屏在后 ⇒ 开着的接管（那一次：老虎机排着、訊息框开着）', () => {
    const slot = fake('god-slot', true, true);
    const notice = fake('notice', true, false);
    expect(selectOverlay([slot, notice], env)?.id).toBe('notice');
    expect(pendingScreens([slot, notice], notice, env).map((s) => s.id)).toEqual(['god-slot']);
  });

  it('全都排着 ⇒ 第一个排着的接管，其余的也各问一次闸；没有 active 的 ⇒ null', () => {
    const a = fake('wheel', true, true);
    const b = fake('notice', true, true);
    expect(selectOverlay([a, b], env)?.id).toBe('wheel');
    expect(pendingScreens([a, b], a, env).map((s) => s.id)).toEqual(['notice']);
    expect(selectOverlay([fake('x', false, false)], env)).toBeNull();
  });
});

describe('`main.ts`：演出死锁看门狗 + 停摆回报', () => {
  const MAIN = new URL('./main.ts', import.meta.url);
  const runMain = existsSync(MAIN) ? it : it.skip;
  runMain('每秒一次（不靠渲染循环）；卡住就两级放行、记「⚠ 演出死锁自解」、落 stall 回报；自动阶段的停摆不分人机都回报', () => {
    const src = readFileSync(MAIN, 'utf8');
    expect(src).toContain('window.setInterval(() => watchPresentationDeadlock(Date.now()), 1_000);');
    expect(src).toContain('⚠ 演出死锁自解');
    expect(src).toContain("fileReport('stall', message);");
    expect(src).toContain('function unwindPresentations(level: number): void {');
    expect(src).toContain("const autoPhase = state.phase === 'turnStart' || state.phase === 'moving' || state.phase === 'settling';");
    expect(src).toContain('return presentationHost.overlay();');
    // 判据与单测共用一份；影片那一类不回头问整屏判据（上一版的无限递归）
    expect(src).toContain('const presentationHost = new PresentationHost({');
    expect(src).toContain('filmsBusy: () => stageBusy({ ...stageBusyFlags(false), godLine: false }),');
    expect(src).toContain('for (const s of pendingScreens(SCREENS, overlay, uiEnv())) s.tick?.(uiEnv());');
  });
});

describe('`presentation-host.ts`：结构上断环（第十六份第二轮：上一版在 main.ts 里无限递归）', () => {
  it('即使 `filmsBusy` 回头去问整屏判据，框的起播闸 / 整屏判据也不会互相递归', () => {
    resetNoticeBoxScreen();
    let calls = 0;
    const env = { screen: 'game', now: 0, requestRender: () => undefined, log: () => undefined } as unknown as UiScreenEnv;
    const host: PresentationHost = new PresentationHost({
      screens: SCREENS,
      env: () => env,
      // 故意写坏：影片位回头问整屏判据（上一版 `stageBusyFlags()` 里的 `blockingPresentation()`）
      filmsBusy: () => {
        calls++;
        return calls < 50 && host.screensBlocking();
      },
      godLine: () => ({ showing: false, pending: false }),
      speech: () => ({ onStage: 0, held: [] }),
      cueDone: () => true,
      deferredScreens: () => 0,
      magicAwaitingPick: () => false,
      bailClosing: () => false,
    });
    setNoticeSpeechGate((tier) => host.boxBlocked(tier));
    // 訊息框单独排着、台词刚说完 —— 上一版正是这一拍爆栈
    queueLocalNotice({ key: 'rent.payOneOwner', args: ['台北', '約翰喬', 500] });
    expect(() => host.screensBlocking()).not.toThrow();
    expect(() => host.boxBlocked('stage')).not.toThrow();
    expect(() => host.boxSnapshot()).not.toThrow();
    expect(calls).toBeLessThan(5); // 起播闸 / 整屏判据根本不碰影片位
    setNoticeSpeechGate(null);
    resetNoticeBoxScreen();
  });
});
