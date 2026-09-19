/*
 * W-04：浏览器性能三条（C-PERF）的取证脚本
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 量什么（场景：`?screen=game&humans=0&ai=4&map=0&seed=7`，连跑 5 分钟）
 *   · `requestAnimationFrame` 帧间隔：均值 / p95 / p99 / >33 ms 帧占比
 *   · `performance.memory.usedJSHeapSize`：每 10 秒一采（起止差 = 泄漏线索）
 *   · `navigationStart → 标题屏首帧`（= `first-contentful-paint`；见下面的口径说明）
 *
 * 用法（★ 必须用 `browse eval <file>`；`browse js "$(cat …)"` 解析多行脚本会出问题，
 *       与 `tools/soak-browser.js` 顶部记的是同一个坑）：
 *
 *   1) pnpm dev            # 另开一个终端；Vite 一般落 5173
 *   2) $B goto "http://localhost:5173/?screen=game&humans=0&ai=4&map=0&seed=7"
 *   3) cp tools/perf-browser.js /tmp/perf.js && $B eval /tmp/perf.js      # → "perf started"
 *   4) 等 5 分钟（`sleep 300`）
 *   5) $B js "globalThis.__perfStop = true"
 *      $B eval /tmp/perf.js                                              # → 一行 JSON 结果
 *   6) 把 JSON 存成 .qa-tmp/perf.json，再按 docs/acceptance/perf-<日期>.md 写报告
 *
 * 口径说明（**测量方法本身要交代清楚，不然数字没法复核**）：
 *   · 帧间隔只统计**相邻两次 rAF 之间**的差；第一帧（没有前驱）不算。
 *   · 脚本是**页面加载完之后**才注入的（`browse eval` 只能这样），所以
 *     「标题屏首帧」取的是 `PerformancePaintTiming` 里的 `first-contentful-paint` ——
 *     标题屏是这一局的第一屏内容，它的首帧就是 FCP。取不到时回落到
 *     `domContentLoadedEventEnd`、再回落到 `loadEventEnd`，并在结果里标 `paintSource`。
 *   · `performance.memory` 需要 Chromium；值本身可能被量化（默认 100 KB 粒度），
 *     所以「起止差」只当**泄漏线索**用，不当精确值。
 *
 * 本脚本**只测量**：不改游戏代码、不下优化结论（WORKPLAN W-04 的口径）。
 */
(() => {
  // ── 收集模式 ────────────────────────────────────────────────
  if (globalThis.__perfStop === true) {
    const S = globalThis.__perf;
    if (!S) return JSON.stringify({ error: '没有 __perf 会话：先用 start 模式跑一次' });
    if (S.timer) clearInterval(S.timer);
    if (S.raf) cancelAnimationFrame(S.raf);
    if (S.raf2) cancelAnimationFrame(S.raf2);
    S.endedAt = performance.now();
    S.visibility = document.visibilityState;

    const q = (arr, p) => {
      if (arr.length === 0) return null;
      const a = [...arr].sort((x, y) => x - y);
      const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
      return Math.round(a[idx] * 100) / 100;
    };
    const f = S.frames;
    const mean = f.length === 0 ? null : f.reduce((a, b) => a + b, 0) / f.length;
    const mem = S.mem;
    const used = mem.map((m) => m.used).filter((v) => typeof v === 'number');
    const out = {
      url: location.href,
      startedAtMs: Math.round(S.startedAt),
      durationSec: Math.round(((S.endedAt - S.startedAt) / 1000) * 10) / 10,
      frames: {
        n: f.length,
        meanMs: mean === null ? null : Math.round(mean * 100) / 100,
        p95Ms: q(f, 95),
        p99Ms: q(f, 99),
        over33ms: f.filter((x) => x > 33.34).length,
        over33Pct: f.length === 0 ? null : Math.round((f.filter((x) => x > 33.34).length / f.length) * 10000) / 100,
        fpsFromMean: mean === null || mean === 0 ? null : Math.round((1000 / mean) * 10) / 10,
        maxMs: f.length === 0 ? null : Math.round(Math.max(...f) * 100) / 100,
      },
      memory: {
        samples: mem.length,
        firstUsed: used.length > 0 ? used[0] : null,
        lastUsed: used.length > 0 ? used[used.length - 1] : null,
        deltaUsed: used.length > 1 ? used[used.length - 1] - used[0] : null,
        minUsed: used.length > 0 ? Math.min(...used) : null,
        maxUsed: used.length > 0 ? Math.max(...used) : null,
      },
      navigation: S.nav,
      progress: {
        turnCountStart: S.turnStart,
        turnCountEnd: S.sample().turnCount,
        dayEnd: S.sample().day,
        players: S.sample().players,
      },
    };
    globalThis.__perfResult = out;
    return JSON.stringify(out);
  }

  // ── 启动模式 ────────────────────────────────────────────────
  const r = globalThis.__rich4;
  if (!r || !r.state) return 'no __rich4 (页面没起或不是 DEV 构建？)';
  if (globalThis.__perf && globalThis.__perf.timer) {
    clearInterval(globalThis.__perf.timer);
    cancelAnimationFrame(globalThis.__perf.raf);
    if (globalThis.__perf.raf2) cancelAnimationFrame(globalThis.__perf.raf2);
  }

  const navEntry = performance.getEntriesByType('navigation')[0];
  const paints = {};
  for (const p of performance.getEntriesByType('paint')) paints[p.name] = Math.round(p.startTime * 100) / 100;
  const fcp = paints['first-contentful-paint'];
  const paintSource = fcp !== undefined
    ? 'first-contentful-paint'
    : navEntry && navEntry.domContentLoadedEventEnd > 0
      ? 'domContentLoadedEventEnd'
      : 'loadEventEnd';
  const titleFirstFrameMs = fcp !== undefined
    ? fcp
    : Math.round(((navEntry && (navEntry.domContentLoadedEventEnd || navEntry.loadEventEnd)) || 0) * 100) / 100;

  const sample = () => {
    const s = r.state;
    return {
      phase: s.phase,
      turnCount: s.turnCount,
      day: s.day,
      month: s.month,
      players: s.players.length,
      currentPlayer: s.currentPlayer,
    };
  };

  const S = {
    startedAt: performance.now(),
    frames: [],
    mem: [],
    nav: {
      paintSource,
      titleFirstFrameMs,
      paints,
      // 导航时序（毫秒，相对 navigationStart）
      domInteractiveMs: navEntry ? Math.round(navEntry.domInteractive * 100) / 100 : null,
      domContentLoadedMs: navEntry ? Math.round(navEntry.domContentLoadedEventEnd * 100) / 100 : null,
      loadEventMs: navEntry ? Math.round(navEntry.loadEventEnd * 100) / 100 : null,
      transferSize: navEntry ? navEntry.transferSize : null,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      userAgent: navigator.userAgent,
    },
    turnStart: sample().turnCount,
    sample,
    timer: 0,
    raf: 0,
    raf2: 0,
  };
  globalThis.__perf = S;

  // 帧间隔：第 1 帧只当基线（没有前驱），不入样
  let prev = 0;
  const onFrame = (t) => {
    if (prev !== 0) S.frames.push(t - prev);
    prev = t;
    S.raf = requestAnimationFrame(onFrame);
  };
  S.raf = requestAnimationFrame(onFrame);

  // 内存：每 10 秒一采
  const memSample = () => {
    const m = performance.memory;
    S.mem.push({
      t: Math.round(performance.now()),
      used: m ? m.usedJSHeapSize : null,
      total: m ? m.totalJSHeapSize : null,
      limit: m ? m.jsHeapSizeLimit : null,
    });
  };
  memSample();
  S.timer = setInterval(memSample, 10_000);

  S.raf2 = requestAnimationFrame(() => {});
  return 'perf started';
})()
