/*
 * 本机双客户端端到端（W-40）—— **在客户端页面里跑**的那一半
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 一个标签页跑一份。它做三件事：
 *   1) 大厅里**每 500 ms 点一次「開始」**（非房主点不到，命中判定自己会拒）；
 *   2) 轮到自己座位时**自动把回合推下去**（turnStart→…→endTurn，与
 *      `tools/soak-browser.js` 的 legacy 阶梯同一套判据，只是 action 走
 *      `dispatch` ⇒ 联机下会 `net.submit` 给服务器定序）；
 *   3) 记录证据：每跨一个回合的**全量状态摘要**、座位号、失步/自愈的日志行。
 *
 * ★ 摘要不是 `stateFingerprint()`（那是 core 的函数，页面里拿不到），而是
 *   `JSON.stringify(state)` 的 FNV-1a 32 位散列 —— **比传输用的指纹更严**
 *   （全量字段都进），只用来做「两端逐回合是否一致」的独立比对。
 *   服务器那条路上的判定另有权威信号：日志里的「失步！」与「⟳ 失步自愈」。
 *
 * 用法（由 `tools/net-e2e.sh` 驱动；手工时）：
 *   $B newtab "http://localhost:5173/?ws=ws://localhost:8787&room=r1&name=A"
 *   $B eval /tmp/net-e2e.js
 *   …跑完读 `globalThis.__net`：
 *   $B js "JSON.stringify(globalThis.__net.summary())"
 *
 * ★ 与 soak 同一条坑：必须 `browse eval <file>`，别用 `browse js "$(cat …)"`。
 */
(() => {
  const r = globalThis.__rich4;
  if (!r || !r.state) return 'no __rich4（页面没起，或不是 DEV 构建）';
  const N = (globalThis.__net = globalThis.__net || {});
  N.errors = N.errors || [];
  N.digests = N.digests || {};      // turnCount → 全量状态散列
  N.turnsSeen = N.turnsSeen || 0;
  N.dispatched = N.dispatched || 0;
  N.desyncLines = N.desyncLines || [];
  N.startedAt = N.startedAt || Date.now();

  // ── 舞台坐标点击（与 tools/soak-browser.js 同一套换算）──
  const click = (sx, sy) => {
    const c = document.querySelector('canvas');
    if (c === null) return;
    const rect = c.getBoundingClientRect();
    const raw = Math.min(c.width / 640, c.height / 480);
    const whole = Math.floor(raw);
    const scale = whole >= 1 && raw - whole < 0.02 ? whole : raw;
    const ox = Math.floor((c.width - 640 * scale) / 2);
    const oy = Math.floor((c.height - 480 * scale) / 2);
    const kx = c.width / rect.width, ky = c.height / rect.height;
    const d = {
      clientX: rect.left + (ox + sx * scale) / kx,
      clientY: rect.top + (oy + sy * scale) / ky,
    };
    for (const type of ['mousemove', 'mousedown']) {
      c.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...d }));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...d }));
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...d }));
  };
  /** 联机大厅的「開始」（`client/lobby.ts` 的 `BTN_START`，舞台坐标）*/
  const START = { x: 506 + 55, y: 416 + 17 };

  // ── 座位号：从页面日志里读（客户端没有把 `net.seat` 挂到调试出口上）──
  const logLines = () => {
    const el = document.getElementById('log');
    return el === null ? [] : [...el.children].map((c) => c.textContent ?? '');
  };
  const mySeat = () => {
    for (const line of logLines()) {
      const m = /我是\s*(\d+)\s*號座/.exec(line);
      if (m !== null) return Number(m[1]) - 1;
    }
    return null;
  };

  /** FNV-1a 32 位 —— 只求「两端一致/不一致」，不求密码学强度 */
  const fnv = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const digest = () => {
    try { return fnv(JSON.stringify(r.state)); } catch (e) { return 'digest-error:' + String(e).slice(0, 60); }
  };

  const scanLog = () => {
    // ★ 日志是一行一个 `<div>`（`main.ts` 的 `log()` 用 prepend），**不是**换行分隔的
    //   一段文本 —— 早先按 `\n` 切会把整块日志当成一行（实测 `desyncLines` 里塞进
    //   了 2000 多字的整段日志）。按子元素取才是「一行一条」。
    const el = document.getElementById('log');
    if (el === null) return;
    for (const child of el.children) {
      const line = child.textContent ?? '';
      if ((line.includes('失步') || line.includes('⟳')) && !N.desyncLines.includes(line)) {
        N.desyncLines.push(line);
      }
    }
  };

  let lastKey = '';
  let lastDispatchAt = 0;
  let lastStartClick = 0;
  const myActions = {};
  const tick = () => {
    try {
      scanLog();
      const seat = mySeat();
      N.seat = seat;
      N.screen = r.screen;
      const s = r.state;

      // ★ 摘要只在 **turnStart** 这一拍记（每个回合一次）：这一拍没有半截动画、
      //   两端必然停在同一个逻辑点上，逐回合比对才有意义。
      //   （先前按「turnCount 一变就记」会在两端各拍在不同位置，比出来必然不等。）
      if (s.phase === 'turnStart' && N.digests[s.turnCount] === undefined) {
        N.digests[s.turnCount] = digest();
      }
      if (s.turnCount > N.turnsSeen) N.turnsSeen = s.turnCount;

      if (r.screen === 'lobby') {
        const now = Date.now();
        if (now - lastStartClick > 500) { lastStartClick = now; click(START.x, START.y); N.startClicks = (N.startClicks || 0) + 1; }
        return;
      }
      // ★ 提交权 = 「此刻该谁拿主意」（core `actingSeat`，issue #9）：竞价期间轮到谁举牌谁提交，
      //   与回合主人无关；其余时刻 = 回合主人。电脑那一口由服务器出，这里不管。
      const p = s.pending;
      const bidding = !!p && p.kind === 'auction' && 'seat' in p && p.bidders[p.seat] !== undefined;
      const acting = bidding ? p.bidders[p.seat] : s.currentPlayer;
      if (r.screen !== 'game' || seat === null || acting !== seat) return;

      // 等本机这一拍真的落地（settle 的 action 要先跳起来）
      const key = `${s.phase}|${s.currentPlayer}|${s.pending ? s.pending.kind : '-'}|${bidding ? `${p.seat}@${p.price}` : ''}|${s.turnCount}|${s.players[s.currentPlayer]?.nodeId}`;
      const now = Date.now();
      if (key === lastKey && now - lastDispatchAt < 400) return;

      let action = null;
      // 竞价：本驱动的真人一律 PASS（⚠️ 不能回 declineDecision —— 那会把整场拍卖清掉）
      if (bidding) {
        action = { type: 'auctionBid', bidder: seat, status: 'pass', step: 0 };
        N.auctionBids = (N.auctionBids || 0) + 1;
        if (s.currentPlayer !== seat) N.crossSeatBids = (N.crossSeatBids || 0) + 1;
      } else if (s.pending && s.pending.kind !== 'none') action = { type: 'declineDecision' };
      else if (s.phase === 'turnStart') action = { type: 'startTurn' };
      else if (s.phase === 'awaitingRoll') action = { type: 'rollDice' };
      else if (s.phase === 'moving') action = { type: 'step' };
      else if (s.phase === 'settling') action = { type: 'settle' };
      else if (s.phase === 'turnEnd') {
        action = s.pendingNpcSlots && s.pendingNpcSlots.length > 0 ? { type: 'npcStep' } : { type: 'endTurn' };
      }
      if (action === null) return;
      lastKey = key;
      lastDispatchAt = now;
      N.dispatched++;
      myActions[action.type] = (myActions[action.type] ?? 0) + 1;
      N.myActions = myActions;
      r.dispatch(action);
    } catch (e) {
      N.errors.push(String(e).slice(0, 200));
      if (N.errors.length > 20) clearInterval(N.timer);
    }
  };
  if (N.timer) clearInterval(N.timer);
  N.timer = setInterval(tick, 60);

  N.summary = () => {
    const turn = r.state.turnCount;
    return {
      seat: N.seat,
      screen: N.screen ?? r.screen,
      turnCount: turn,
      turnsSeen: N.turnsSeen,
      digestNow: digest(),
      digestLatest: N.digests[turn] ?? null,
      digestTurns: Object.keys(N.digests).length,
      dispatched: N.dispatched,
      myActions: N.myActions ?? {},
      startClicks: N.startClicks ?? 0,
      desyncLines: N.desyncLines.slice(-4),
      errors: N.errors.slice(-5),
      elapsedSec: Math.round((Date.now() - N.startedAt) / 1000),
    };
  };
  /** 人为破坏本地状态：用来触发服务器的失步判定与客户端的自愈重放（Q-NET-1）*/
  N.tamper = () => {
    r.state.players[0].cash += 1;
    return { tampered: true, digestNow: digest() };
  };
  N.digestsFor = (turns) => turns.map((t) => [t, N.digests[t] ?? null]);
  N.stop = () => { clearInterval(N.timer); N.timer = 0; return 'stopped'; };
  /** 停/启成对用：**冻结两端再比摘要**才是最干净的取证方式（见 W-40 报告）*/
  N.resume = () => {
    if (N.timer) clearInterval(N.timer);
    N.timer = setInterval(tick, 60);
    return 'resumed';
  };
  N.stopBothNote = 'stop() 之后两端都不再派 action，等 1–2 秒读 digestNow 即为同一逻辑点';
  N.checkpoint = () => {
    const s = r.state;
    return {
      seat: N.seat, turn: s.turnCount, phase: s.phase, currentPlayer: s.currentPlayer,
      rngState: s.rngState, cash: s.players.map((p) => p.cash), digest: digest(),
    };
  };

  return 'net-e2e driver started';
})()
