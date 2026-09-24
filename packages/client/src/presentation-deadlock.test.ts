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
  type Action,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { eventBoxScreen, eventBoxScreenState, resetEventBoxScreen, setEventBoxStartGate } from './event-box-screen.ts';
import { godLineTrigger } from './god-line.ts';
import { freshMagicBeats } from './magic-fx.ts';
import { godSlotScreen, godSlotState, resetGodSlot, setGodSlotStartGate } from './god-slot.ts';
import {
  noticeBoxScreen,
  noticeHoldsFilms,
  noticeShowing,
  noticePendingRanks,
  resetNoticeBoxScreen,
  setNoticeOverlayGate,
  setNoticeSpeechGate,
  setNoticeStartGate,
} from './notice-box-screen.ts';
import { pendingScreens, selectOverlay } from './overlay.ts';
import {
  SCREEN_BOX_TIER,
  boxMayStart,
  boxRank,
  countedHeld,
  insertByRank,
  lineMayEnter,
  lineRank,
  speechAheadOfFilms,
  type SpeechCue,
} from './presentation-order.ts';
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
  replayTrail(base, report.trail, topo, (i, before, after) => {
    all.push({ before, after, action: report.trail[i]!.action, at: report.trail[i]!.t });
  });
  // 从第 100 条起按回报里的时间差灌（前面的已经演完）
  const START = 100;
  const t0 = all[START]!.at;
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
  const speechSnap = () => ({ onStage: speechQueue.length, heldRanks: countedHeld(held, cueDone).map((h) => h.rank) });
  const showing = () =>
    godLine !== null || noticeShowing() || eventBoxScreenState().playing || wheelScreenState().playing || godSlotState().playing;
  const boxSnap = () => {
    const pendingRanks = noticePendingRanks();
    if (wheelScreenState().pending) pendingRanks.push(boxRank(SCREEN_BOX_TIER.wheel));
    if (godSlotState().pending) pendingRanks.push(boxRank(SCREEN_BOX_TIER.godSlot));
    if (pendingGodLine) pendingRanks.push(boxRank(SCREEN_BOX_TIER.godSay));
    return { showing: showing(), pendingRanks, filmsBusy: film !== null || pendingFilm || flight !== null || flightAwaits };
  };
  const other = () => (oldRules ? false : showing());

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
  setNoticeSpeechGate((tier) => !boxMayStart(tier, speechSnap()) || other());
  setGodSlotStartGate(
    () => film !== null || pendingFilm || godLine !== null || pendingGodLine || !boxMayStart(SCREEN_BOX_TIER.godSlot, speechSnap()) || other(),
  );
  setEventBoxStartGate(() => !boxMayStart(SCREEN_BOX_TIER.eventBox, speechSnap()) || other());
  setWheelStartGate(() => !boxMayStart(SCREEN_BOX_TIER.wheel, speechSnap()) || other());

  const release = () => {
    const snap = boxSnap();
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
      overlay = selectOverlay(SCREENS, env);
      for (const s of pendingScreens(SCREENS, overlay, env)) s.tick?.(env);
    }
    overlay?.tick?.(env);
    // 开场白（`tickGodLine`）
    if (pendingGodLine && film === null && !pendingFilm && boxMayStart(SCREEN_BOX_TIER.godSay, speechSnap()) && !eventBoxScreen.active(env) && !other()) {
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
  for (const s of steps) {
    while (now < s.at) {
      frame();
      if (speechQueue.current() !== null && showing()) overlaps++;
      now += DT;
    }
    if (s.followPresenter === true) for (const sc of SCREENS) sc.fastForward?.(env);
    apply(s.before, s.after, s.action);
  }
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

describe('★★ 第十六份：24 局长跑灌进同一台宿主 —— 从不卡死、从不同屏', () => {
  runSoak(
    '8 张图 × 3 局；action 到达间隔 0–400 ms（含联机补帧那种 0 间隔的一串）；百分之二的 action 之前旁观端跟着行动者收场',
    () => {
      const failures: string[] = [];
      let toolUses = 0;
      let possessions = 0;
      let actions = 0;
      let oldStuck = 0;
      for (let g = 0; g < 24; g++) {
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
        // 对照：同一串 action 用旧规矩跑 —— 证明这套长跑抓得住那一类互等
        if (runPipeline(steps, topo, map, true, 30 * 60_000).quiescentAt === null) oldStuck++;
        if (res.quiescentAt === null) failures.push(`g${g} 图${globalMapId} 卡死：${res.stuck}`);
        if (res.overlaps > 0) failures.push(`g${g} 图${globalMapId} 同屏 ${res.overlaps} 帧`);
      }
      expect(failures).toEqual([]);
      // 防空转：确实撞到了道具与神明附身
      expect(toolUses).toBeGreaterThan(100);
      expect(possessions).toBeGreaterThan(20);
      expect(actions).toBeGreaterThan(10_000);
      expect(oldStuck, '旧规矩在这 24 局里至少卡死一局（否则这套长跑测不出那一类问题）').toBeGreaterThan(0);
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
    expect(src).toContain('return selectOverlay(SCREENS, uiEnv());');
    expect(src).toContain('for (const s of pendingScreens(SCREENS, overlay, uiEnv())) s.tick?.(uiEnv());');
  });
});
