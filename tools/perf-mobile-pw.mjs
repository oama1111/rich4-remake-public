/*
 * 手机发烫取证（第十九份：「我用safari在iphone上玩时手机变得很烫」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用 Playwright 的 Chromium 近似 iPhone 13（横屏 750×342 CSS、DPR 3、触屏）+ CDP CPU 降速，
 * 逐个场景量：每秒真正画了几帧、每帧 JS 多久、画布后备存储多大、绘制 vs 其余脚本、
 * 定时器每秒触发几次、音频节点 / 音符排程量与 WebAudio 渲染负载。
 *
 * 用法（先起自己的 Vite：`pnpm --filter @rich4/client dev --port 5402 --strictPort`）：
 *   VITE=5402 [THROTTLE=4] [SECS=10] [SCENES=foyer,title,idle,ai,shop,hidden] [AUDIO=1] \
 *     node tools/perf-mobile-pw.mjs > .qa-tmp/perf-mobile.json
 *
 * 口径：
 *   · 「帧」= 实际执行过回调的 `requestAnimationFrame` 时间戳（同一时间戳的多个回调算一帧）。
 *     这是**游戏要了几帧**，与浏览器 vsync 无关；静止画面理想值是 0。
 *   · `rafMs` = rAF 回调里的 JS 时间（= 帧里的 tick + 绘制 + 贴屏）；`timerMs` = setTimeout /
 *     setInterval 回调的 JS 时间；`taskMs` = CDP `TaskDuration` 的增量（主线程总忙碌）。
 *   · 音频：`AUDIO=1` 时不带 `?mute=1`，用一次按键解锁（真 Chromium 的 WebAudio，
 *     但以 `--mute-audio` 启动 —— 照常渲染、扬声器不出声）；`renderCapacity` 取 CDP
 *     `WebAudio.getRealtimeData`（渲染线程占用比例，0..1）。
 *   · 「后台」场景：无头 Chromium 切不出真正的 hidden 标签页，这里改写 `document.hidden` /
 *     `visibilityState` 并派 `visibilitychange`，同时像真浏览器那样把 rAF 回调压到回前台
 *     （`rafRequestsWhileHiddenPerSec` = 后台时游戏还在要几帧）。定时器与音频照真的跑。
 */
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { chromium, devices } = require('playwright');

const VITE = process.env.VITE ?? '5402';
const THROTTLE = Number(process.env.THROTTLE ?? '4');
const SECS = Number(process.env.SECS ?? '10');
const AUDIO = process.env.AUDIO !== '0';
const SCENES = (process.env.SCENES ?? 'foyer,title,idle,ai,shop,hidden,hidden-ai').split(',');
const BASE = `http://localhost:${VITE}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const err = (...a) => console.error(...a);

/** 注入在页面脚本**之前**：只包一层计数，不改行为 */
const INSTRUMENT = () => {
  const S = (globalThis.__pm = {
    frames: 0,
    rafCalls: 0,
    rafMs: 0,
    timerCalls: 0,
    timerMs: 0,
    timerByDelay: {},
    audioCtx: 0,
    nodesCreated: 0,
    srcStarted: 0,
    srcLive: 0,
    bitmaps: 0,
  });
  let lastTs = -1;
  const rAF = window.requestAnimationFrame.bind(window);
  // 「切到后台」仿真：无头 Chromium 的 `bringToFront` 不会把原页变成 hidden，
  // 这里把 `document.hidden` / `visibilityState` 改成可控，并像真浏览器一样**不跑** rAF（回调压到回前台）。
  let hidden = false;
  const held = [];
  S.rafReqHidden = 0;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  globalThis.__pmSetHidden = (h) => {
    hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
    if (!h) for (const cb of held.splice(0)) window.requestAnimationFrame(cb);
  };
  window.requestAnimationFrame = (cb) => {
    if (hidden) {
      S.rafReqHidden++;
      held.push(cb);
      return 0;
    }
    return rAF((ts) => {
      if (ts !== lastTs) {
        lastTs = ts;
        S.frames++;
      }
      const a = performance.now();
      try {
        cb(ts);
      } finally {
        S.rafCalls++;
        S.rafMs += performance.now() - a;
      }
    });
  };
  const wrapTimer = (orig) =>
    function (fn, delay, ...rest) {
      if (typeof fn !== 'function') return orig.call(window, fn, delay, ...rest);
      const key = String(Math.round(Number(delay) || 0));
      return orig.call(
        window,
        (...args) => {
          const a = performance.now();
          try {
            fn(...args);
          } finally {
            S.timerCalls++;
            S.timerMs += performance.now() - a;
            S.timerByDelay[key] = (S.timerByDelay[key] ?? 0) + 1;
          }
        },
        delay,
        ...rest,
      );
    };
  window.setTimeout = wrapTimer(window.setTimeout);
  window.setInterval = wrapTimer(window.setInterval);
  if (typeof window.createImageBitmap === 'function') {
    const cib = window.createImageBitmap.bind(window);
    window.createImageBitmap = (...a) => {
      S.bitmaps++;
      return cib(...a);
    };
  }
  const B = globalThis.BaseAudioContext?.prototype;
  if (B) {
    for (const m of ['createOscillator', 'createGain', 'createBufferSource', 'createBiquadFilter', 'createStereoPanner']) {
      const f = B[m];
      if (typeof f !== 'function') continue;
      B[m] = function (...a) {
        S.nodesCreated++;
        return f.apply(this, a);
      };
    }
    const AS = globalThis.AudioScheduledSourceNode.prototype;
    const start = AS.start;
    AS.start = function (...a) {
      S.srcStarted++;
      S.srcLive++;
      this.addEventListener('ended', () => S.srcLive--, { once: true });
      return start.apply(this, a);
    };
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(...a) {
        super(...a);
        S.audioCtx++;
        (globalThis.__pmCtxs ??= []).push(this);
      }
    };
  }
};

const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const dev = devices['iPhone 13 landscape'];

async function openScene(url) {
  const ctx = await browser.newContext({ ...dev });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => err(`[pageerror] ${e.message}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const audioCtxIds = [];
  try {
    await cdp.send('WebAudio.enable');
    cdp.on('WebAudio.contextCreated', (e) => audioCtxIds.push(e.context.contextId));
  } catch {
    /* 老 Chromium 没这个域 */
  }
  await page.goto(url);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  return { ctx, page, cdp, audioCtxIds };
}

async function unlockAudio(page) {
  if (!AUDIO) return;
  // keydown 在 capture 相解锁（`bindAudioUnlock`）；Shift 本身没有热键
  await page.keyboard.press('Shift');
}

const metric = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? 0;

async function measure(s, label, secs = SECS) {
  const { page, cdp, audioCtxIds } = s;
  const snap = () => page.evaluate(() => ({ ...globalThis.__pm, timerByDelay: { ...globalThis.__pm.timerByDelay } }));
  const rs0 = await page.evaluate(() => globalThis.__rich4?.renderStats?.() ?? null);
  const turn0 = await page.evaluate(() => globalThis.__rich4?.state?.turnCount ?? null);
  const a = await snap();
  const ma = await cdp.send('Performance.getMetrics');
  const t0 = Date.now();
  const caps = [];
  for (let i = 0; i < secs; i++) {
    await sleep(1000);
    for (const id of audioCtxIds) {
      try {
        const r = await cdp.send('WebAudio.getRealtimeData', { contextId: id });
        caps.push(r.realtimeData.renderCapacity);
      } catch {
        /* context 已关 */
      }
    }
  }
  const b = await snap();
  const mb = await cdp.send('Performance.getMetrics');
  const dt = (Date.now() - t0) / 1000;
  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas#board') ?? document.querySelector('canvas');
    const r = globalThis.__rich4;
    return {
      visibility: document.visibilityState,
      screen: r?.screen ?? null,
      overlay: r?.overlayId?.() ?? null,
      phase: r?.state?.phase ?? null,
      turn: r?.state?.turnCount ?? null,
      shop: r?.shopUi != null,
      canvas: c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null,
      dpr: devicePixelRatio,
      renderStats: r?.renderStats?.() ?? null,
      audioStates: (globalThis.__pmCtxs ?? []).map((c) => c.state),
    };
  });
  const per = (k) => Math.round(((b[k] - a[k]) / dt) * 10) / 10;
  const frames = b.frames - a.frames;
  const timerByDelay = {};
  for (const [k, v] of Object.entries(b.timerByDelay)) {
    const d = v - (a.timerByDelay[k] ?? 0);
    if (d > 0) timerByDelay[k] = Math.round((d / dt) * 10) / 10;
  }
  const px = info.canvas ? info.canvas.w * info.canvas.h : 0;
  return {
    scene: label,
    ...info,
    secs: Math.round(dt * 10) / 10,
    turnsAdvanced: info.turn === null || turn0 === null ? null : info.turn - turn0,
    fps: Math.round((frames / dt) * 10) / 10,
    jsPerFrameMs: frames === 0 ? 0 : Math.round(((b.rafMs - a.rafMs) / frames) * 100) / 100,
    rafMsPerSec: Math.round((b.rafMs - a.rafMs) / dt),
    timerMsPerSec: Math.round((b.timerMs - a.timerMs) / dt),
    timersPerSec: per('timerCalls'),
    timerByDelay,
    taskMsPerSec: Math.round(((metric(mb, 'TaskDuration') - metric(ma, 'TaskDuration')) / dt) * 1000),
    scriptMsPerSec: Math.round(((metric(mb, 'ScriptDuration') - metric(ma, 'ScriptDuration')) / dt) * 1000),
    // 贴屏像素吞吐：真正贴屏的帧 × 画布后备存储（去重之前每一帧都贴）
    blitMpxPerSec: Math.round(((px * (info.renderStats && rs0 ? info.renderStats.painted - rs0.painted : frames)) / dt / 1e6) * 10) / 10,
    bitmapsPerSec: per('bitmaps'),
    rafRequestsWhileHiddenPerSec: per('rafReqHidden'),
    // 真正光栅化 + 贴屏的帧（有指令去重之后才有这个数；之前 = fps）
    paintedPerSec:
      info.renderStats && rs0 ? Math.round(((info.renderStats.painted - rs0.painted) / dt) * 10) / 10 : Math.round((frames / dt) * 10) / 10,
    audio: {
      contexts: b.audioCtx,
      nodesCreatedPerSec: per('nodesCreated'),
      sourcesStartedPerSec: per('srcStarted'),
      sourcesLive: b.srcLive,
      renderCapacityMean: caps.length === 0 ? null : Math.round((caps.reduce((x, y) => x + y, 0) / caps.length) * 1000) / 1000,
    },
  };
}

const waitRich4 = (page) => page.waitForFunction(() => !!(globalThis.__rich4 && globalThis.__rich4.state), null, { timeout: 180_000 });
const mute = AUDIO ? '' : '&mute=1';
const results = [];

async function idleBoard() {
  const s = await openScene(`${BASE}?screen=game&humans=1&ai=3&map=0&seed=7${mute}`);
  await waitRich4(s.page);
  await unlockAudio(s.page);
  // 等到轮到真人掷骰、台上没有演出
  await s.page.waitForFunction(
    () => {
      const r = globalThis.__rich4;
      return r.screen === 'game' && r.state.phase === 'awaitingRoll' && r.state.currentPlayer === 0 && r.overlayId() === null;
    },
    null,
    { timeout: 120_000 },
  );
  await sleep(6000);
  return s;
}

for (const scene of SCENES) {
  err(`— ${scene}`);
  if (scene === 'foyer') {
    const s = await openScene(`${BASE}?x=1${mute}`);
    await sleep(8000);
    await unlockAudio(s.page);
    await sleep(3000);
    results.push(await measure(s, 'foyer'));
    await s.ctx.close();
  } else if (scene === 'title') {
    const s = await openScene(`${BASE}?screen=title${mute}`);
    await waitRich4(s.page);
    await sleep(6000);
    await unlockAudio(s.page);
    await sleep(3000);
    results.push(await measure(s, 'title'));
    await s.ctx.close();
  } else if (scene === 'idle') {
    const s = await idleBoard();
    results.push(await measure(s, 'idle-board'));
    await s.ctx.close();
  } else if (scene === 'ai') {
    const s = await openScene(`${BASE}?screen=game&humans=0&ai=4&map=0&seed=7${mute}`);
    await waitRich4(s.page);
    await unlockAudio(s.page);
    // 片头（跳伞）播完、真的在棋盘上走
    await s.page.waitForFunction(() => globalThis.__rich4.screen === 'game', null, { timeout: 180_000 });
    await sleep(3000);
    results.push(await measure(s, 'ai-turns', Math.max(SECS, 20)));
    await s.ctx.close();
  } else if (scene === 'shop') {
    const s = await idleBoard();
    const ok = await s.page.evaluate(() => {
      const r = globalThis.__rich4;
      const node = r.map.nodes.find((n) => n && n.specialKind === 15);
      if (!node) return 'no shop node';
      return r.warp(node.id) ? `warped ${node.id}` : 'warp failed';
    });
    err(`  ${ok}`);
    await s.page.waitForFunction(() => globalThis.__rich4.shopUi != null, null, { timeout: 60_000 });
    await sleep(6000);
    results.push(await measure(s, 'shop'));
    await s.ctx.close();
  } else if (scene === 'hidden') {
    const s = await idleBoard();
    await s.page.evaluate(() => globalThis.__pmSetHidden(true));
    await sleep(2000);
    results.push(await measure(s, 'hidden (idle board)'));
    await s.page.evaluate(() => globalThis.__pmSetHidden(false));
    await sleep(2000);
    results.push(await measure(s, 'visible again (idle board)', 4));
    await s.ctx.close();
  } else if (scene === 'hidden-ai') {
    const s = await openScene(`${BASE}?screen=game&humans=0&ai=4&map=0&seed=7${mute}`);
    await waitRich4(s.page);
    await unlockAudio(s.page);
    await s.page.waitForFunction(() => globalThis.__rich4.screen === 'game', null, { timeout: 180_000 });
    await sleep(3000);
    await s.page.evaluate(() => globalThis.__pmSetHidden(true));
    await sleep(2000);
    results.push(await measure(s, 'hidden (AI turns)'));
    await s.page.evaluate(() => globalThis.__pmSetHidden(false));
    await sleep(2000);
    results.push(await measure(s, 'visible again (AI turns)', 6));
    await s.ctx.close();
  }
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
