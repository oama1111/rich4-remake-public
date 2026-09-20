/*
 * 浏览器长跑（回归用）—— 自动把一局打下去，逐拍记录 phase / 待决交互，
 * 抓「引擎层」的卡死与异常。2026-09-16 用它抓到过两处硬卡死：
 *   · 骰子动画相位只在被画的时候推进 ⇒ 整屏接管盖住棋盘后 active 恒真、整局冻死
 *   · requestRoll() 被拒时静默丢弃、scheduleAi 不再重排 ⇒ 电脑永远停在 awaitingRoll
 * 修好后同一局：**193 回合、0 次卡死、0 报错**（修前 25 回合且连续卡死）。
 *
 * ★ 两条路径（默认还是老那条，老用法一字不变）：
 *
 *   ── 默认（legacy）：脚本**自己**把整条机械阶梯推完 ——
 *      `turnStart→startTurn` / `awaitingRoll→rollDice`（仅 0 号真人）/
 *      `moving→step` / `settling→settle` / `turnEnd→endTurn`。
 *      只要引擎不卡，它就能一直跑；代价是它**替客户端**把每一步做掉了。
 *
 *   ── 真人路径（URL 加 `?humanPath=1`，或执行前先置
 *      `globalThis.__soakHumanPath = true`）：轮到真人且停在 `awaitingRoll` 时，
 *      **点 GO 鈕**（走 canvas 真实鼠标事件），而不是 `dispatch({type:'rollDice'})`；
 *      `moving` / `settling` / `turnEnd` / `turnStart` 期间**一个 action 都不派** ——
 *      回合必须由客户端自己的 driver（`scheduleHumanTurn` / `dicePoll` /
 *      补间收尾）推下去。
 *
 *      ★ 这条路径存在的理由：legacy 在 `moving` 里**无条件**
 *      `dispatch({type:'step'})`，正好盖住「动画收尾那一下把 turn driver 吞了」
 *      这一类 bug（`main.ts` 的 `dicePoll` 先前就有这么一处：骰子动画跑完
 *      `diceFx.active` 变假之后没人再排 `scheduleHumanTurn`）。
 *      真人路径不派任何 action，那种卡死就会**停在 `moving`**，
 *      由 `humanStalls` 抓个正着。
 *
 * 用法：
 *   1) pnpm dev   （另开一个终端；注意 Vite 可能落在 5173 而不是 5180）
 *   2) 用浏览器工具打开
 *      http://localhost:5173/?screen=game&humans=1&ai=3&map=0&seed=7&chars=0,3,5,7
 *      —— 要跑真人路径就再加 `&humanPath=1`
 *   3) 整段执行（gstack）：**必须用 `browse eval <file>`**，先把脚本放到 `/tmp` 或 cwd：
 *      `cp tools/soak-browser.js /tmp/soak.js && browse eval /tmp/soak.js`
 *      ⚠️ **不要**用 `browse js "$(cat tools/soak-browser.js)"` —— 那条路解析多行脚本会出问题
 *      （实测症状：脚本在 `document.querySelector('canvas')` 处拿到 `null`，
 *       报 `Cannot read properties of null (reading 'getBoundingClientRect')`，
 *       而同一条表达式单独用 `js` 跑却正常；根因未查清，`eval <file>` 稳过。
 *       2026-09-19 又踩了一次，见 gaps §7.131）。
 *   4) 过几分钟读 `globalThis.__soak`：
 *      默认路径：`{ticks, turns, stalls: [], errors: [], dialogClicks}`
 *      真人路径：上面那些之外还有
 *      `{humanPath, soakDispatches, goClicks, goMisses, humanStalls}`
 *      —— `stalls` 里每一条都是「同一个 (phase|currentPlayer|pending) 连续 300 拍
 *      （≈21 秒）没变」，正常动画等待（骰子 + 走子补间）不会超过这个窗口。
 *      ⚠️ **改完源码要重新 goto 再跑**：编辑会触发 Vite HMR 重载，把长跑打断。
 *
 * ★ 真人路径**要验的断言**（跑完在控制台里算）：
 *
 *      humanPath && soakDispatches === 0 && goClicks > 0 && humanStalls.length === 0
 *
 *   - `soakDispatches` = 本脚本**自己**派出去的 action 数（两种路径都记）。
 *     真人路径下它**应当为 0**：一个都不派、整条阶梯还走得动，才证明回合是
 *     客户端 driver 自己接住的。非 0 就说明脚本又伸手替引擎推了
 *     （待决交互答不掉时的兜底 `declineDecision` 也会记在这里）。
 *   - `goClicks` = 真正落到 GO 鈕上、被引擎收下的点击次数（`goMisses` 是没命中的）。
 *   - `humanStalls` = `phase === 'moving'` 且 `(currentPlayer, nodeId, stepsRemaining)`
 *
 *   ★ 2026-09-16 **实测通过**（这是它存在的理由 —— 修 A-1 之前这条路必卡）：
 *     命令：`browse eval tools/soak-browser.js`（注意：要用 `eval <file>`，
 *     `browse js "$(cat …)"` 那条路在解析多行脚本时会出问题）
 *     结果（约 3 分钟）：
 *     ```json
 *     {"humanPath":true,"soakDispatches":0,"goClicks":78,"goMisses":0,
 *      "humanStalls":0,"turns":27,"ticks":1705,"errors":0}
 *     ```
 *     ⇒ 27 个回合全部由**界面自己的驱动**走完（脚本一个 action 都没派），
 *       78 次 GO 点击全中，0 次 `moving` 卡死，0 条异常。
 *     **连续 ~6 秒没变** —— 就是「走子动画收完没人接着推」那一类僵住。
 *
 * ★ W-14（2026-09-20）：对话框按钮答不掉的屏（競價 / 百貨公司 / 保釋 / 填数页 / 設施類別）
 *   先问 `__rich4.humanExit()` 拿该屏的**真实退出手势**（落点取各屏自己的命中框），发成真实
 *   鼠标 / 键盘事件。新增两个读数：
 *     `exitGestures` = 各出口发了几次；`exitStuck` = 同一出口连发 40 次屏还在（**那是 bug**，
 *     2026-09-20 就是这样抓到「百貨公司道别气泡被点掉后永远不关门」的）。
 *   真人路径的完整断言因此是：
 *     humanPath && soakDispatches === 0 && goClicks > 0 && humanStalls.length === 0
 *       && stalls.length === 0 && exitStuck.length === 0 && busyStalls.length === 0
 *   （`stalls` 只数**台上空闲**的拍 —— 判据问 `__rich4.stageBusy()`；演出自己连续 90 秒不收场记 `busyStalls`）
 *   ⚠️ 标签页必须在**前台**：隐藏时 rAF 被节流，一回合要 30 秒。
 *
 * 注意：它仍把**真人的**待决交互粗暴答掉，只为让引擎一直跑
 * （真人路径优先点界面上的按钮，点不到才兜底 `declineDecision`）；
 * 要验交互本身请用 `dialog()` 返回的 buttons 点真实鼠标事件（见下面 click()）。
 */
(() => {
  const r = globalThis.__rich4;
  if (globalThis.__soakTimer) clearInterval(globalThis.__soakTimer);
  const c = document.querySelector('canvas');
  const rect = c.getBoundingClientRect();
  const raw = Math.min(c.width / 640, c.height / 480);
  const whole = Math.floor(raw);
  const scale = (whole >= 1 && raw - whole < 0.02) ? whole : raw;
  const ox = Math.floor((c.width - 640 * scale) / 2), oy = Math.floor((c.height - 480 * scale) / 2);
  const kx = c.width / rect.width, ky = c.height / rect.height;
  // sx/sy 是**舞台**（640×480）坐标；canvas 可能 1:1 也可能整数缩放 + letterbox
  const click = (sx, sy) => {
    const d = { clientX: rect.left + (ox + sx * scale) / kx, clientY: rect.top + (oy + sy * scale) / ky };
    c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...d }));
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...d }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...d }));
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...d }));
  };

  // ── 真人路径开关：URL `?humanPath=1` 或 `globalThis.__soakHumanPath = true` ──
  //    在**起点**读一次（中途改无效）；两者都没有就是老的 legacy 行为。
  const humanPath =
    new URLSearchParams(globalThis.location?.search ?? '').get('humanPath') === '1' ||
    globalThis.__soakHumanPath === true;

  // ── GO 鈕的落点（**舞台**坐标）──────────────────────────────
  //   默认：棋盘坐标 (180,80)、尺寸 72×67（`go-button.ts:72,80`），
  //   中心 = (180+36, 80+33.5) = (216,113.5)；棋盘原点在舞台 (0,40)
  //   （`stage.ts` 的 LAYOUT.board）⇒ 舞台中心 ≈ **(216,153)**。
  //   有 `__rich4.goButton()` 时优先用它（含拖动后的真实位置与 stageX/stageY）。
  const GO_DEFAULT_STAGE = { x: 180 + 72 / 2, y: 80 + 67 / 2 + 40 }; // ≈ (216,153.5)
  const goPoint = () => {
    let x = GO_DEFAULT_STAGE.x, y = GO_DEFAULT_STAGE.y;
    try {
      const g = typeof r.goButton === 'function' ? r.goButton() : null;
      if (g && [g.stageX, g.stageY, g.w, g.h].every((v) => typeof v === 'number' && isFinite(v))) {
        x = g.stageX + g.w / 2;
        y = g.stageY + g.h / 2;
      }
    } catch { /* 钩子不在就退回默认点 */ }
    return { x, y };
  };
  // 与引擎同一个 `hitAdvance`（点之前先问一次几何）；问不到就信默认点
  const hitsGo = (x, y) => {
    try {
      return typeof r.hitGo === 'function' ? r.hitGo(x, y) === true : true;
    } catch { return true; }
  };
  const trace = () => {
    try { return typeof r.inputTrace === 'function' ? r.inputTrace() : null; } catch { return null; }
  };

  const S = {
    ticks: 0, turns: 0, stalls: [], errors: [], dialogClicks: 0, days: [],
    // ── 真人路径专用 ──
    humanPath,
    soakDispatches: 0,
    goClicks: 0,
    goMisses: 0,
    humanStalls: [],
    exitGestures: {},
    exitStuck: [],
    busyStalls: [],
  };
  globalThis.__soak = S;
  let lastKey = '', same = 0, busyRun = 0;
  // `moving` 卡死检测：只看 (currentPlayer, nodeId, stepsRemaining) 这三个
  let moveKey = null, moveSince = 0, moveLogged = false;
  let lastPhase = '';

  // 真人座位：`who_plays & 3 === 1`（WHO_PLAYS_HUMAN）；电脑是 2，被托管是 1|4
  const isHumanSeat = (s) => {
    const p = s.players && s.players[s.currentPlayer];
    return p !== undefined && (p.whoPlays & 3) === 1;
  };
  const dispatchSelf = (a) => { S.soakDispatches++; r.dispatch(a); };
  // ── W-14 / E-21：对话框按钮答不掉的屏，用该屏的**真实退出方式** ──
  //   問 `__rich4.humanExit()`（落点取各屏自己的命中框；其余是原版的通用出口 = 右键）。
  //   这是 UI 手势，**不计入** `soakDispatches`。同一个出口连点 40 次（≈3 秒）屏还在，
  //   记进 `exitStuck` —— 那是「真实出口点了不灵」的 bug，不是脚本的缺口。
  const rightClick = (sx, sy) => {
    const d = { clientX: rect.left + (ox + sx * scale) / kx, clientY: rect.top + (oy + sy * scale) / ky };
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...d }));
  };
  let exitWhy = '', exitRepeat = 0;
  const tryHumanExit = () => {
    let h = null;
    try { h = typeof r.humanExit === 'function' ? r.humanExit() : null; } catch { h = null; }
    if (!h) { exitWhy = ''; exitRepeat = 0; return false; }
    if (h.why === exitWhy) exitRepeat++; else { exitWhy = h.why; exitRepeat = 0; }
    if (exitRepeat === 40) S.exitStuck.push({ at: S.ticks, why: h.why });
    // 每 5 拍（≈350 ms）发一次：商店的第一下只是收气泡、道别那句要等它说完
    if (exitRepeat % 5 !== 0) return true;
    S.exitGestures[h.why] = (S.exitGestures[h.why] || 0) + 1;
    if (h.gesture === 'rightClick') rightClick(h.x, h.y);
    else if (h.gesture === 'keys') {
      for (const code of h.keys || []) {
        const key = code.startsWith('Digit') ? code.slice(5) : code;
        window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, key }));
        window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, code, key }));
      }
    } else click(h.x, h.y);
    return true;
  };
  const dialogNow = () => {
    const d = r.dialog();
    return d && Array.isArray(d.buttons) && d.buttons.length > 0 ? d : null;
  };
  const clickDialog = (d) => {
    // 挑「不是取消」的那颗（最后一颗通常是取消）
    const skip = /^(取消|離開|不買|NO|−|＋|\+|-|最大)/i;
    const b =
      d.buttons.find((x) => /確定|是|好|買|賣|OK/i.test(x.label) && !skip.test(x.label)) ||
      [...d.buttons].reverse().find((x) => !skip.test(x.label)) ||
      d.buttons[0];
    S.dialogClicks++; S.lastLabel = b.label;
    click(b.x, b.y);
  };
  const clickGo = () => {
    // ★ 先问一句「引擎此刻真的在等真人掷骰吗」——`state.phase` 从**建局那一刻**
    //   就是 `awaitingRoll`，但开机那几拍的 `screen` 还没落到 `game`
    //   （过场/拉幕/标题），此时点 GO 一定被 `not-awaiting-human-roll` 打回。
    //   不先滤掉这一段，`goMisses` 会把这十几秒全记成「点偏了」，
    //   那个数就不再是「几何有没有对上」的指标了。
    const g = (() => {
      try { return typeof r.goButton === 'function' ? r.goButton() : null; } catch { return null; }
    })();
    if (g !== null && g.awaitingRoll !== true) return;
    const p = goPoint();
    if (!hitsGo(p.x, p.y)) { S.goMisses++; return; }
    S.goClicks++;
    click(p.x, p.y);
    const t = trace();
    if (t) {
      S.lastEarlyReturn = t.earlyReturn;
      // 没落到钮上（位置漂了 / 已经不在等真人掷骰）—— 退回未记账，下一拍重点
      if (t.earlyReturn === 'go-miss' || t.earlyReturn === 'not-awaiting-human-roll') {
        S.goClicks--; S.goMisses++;
      }
    }
  };

  globalThis.__soakTimer = setInterval(() => {
    try {
      const s = r.state;
      S.ticks++;
      const k = `${s.phase}|${s.currentPlayer}|${s.pending ? s.pending.kind : '-'}`;
      // ★ W-14：台上在**正当演出**（影片 / 整屏回放 / 补间 / 台词）的那些拍不计入「同态」——
      //   魔法屋回放 + 几段建屋影片能让 k 连续 25 秒不变，那不是卡死。判据问引擎自己的
      //   `stageBusy()`；演出本身**连续 90 秒**不收场另记 `busyStalls`（那才是「演出卡死」）。
      let busy = null;
      try { busy = typeof r.stageBusy === 'function' ? r.stageBusy() : null; } catch { busy = null; }
      const isBusy = busy !== null && busy.busy === true;
      if (k !== lastKey) { same = 0; busyRun = 0; lastKey = k; }
      else if (isBusy) { busyRun++; } else { same++; busyRun = 0; }
      if (busyRun === 1286) { S.busyStalls.push({ at: S.ticks, k, busy }); busyRun = 0; }
      // ★ 小遊戲屏是**实时**的一屏：没人操作时它按自己的表走完才收
      //   （企鵝 / 氣球 `*_PLAY_TICKS = 0x96` × 100 ms = 15 秒，加片头、入场与 2 秒计分 ≈ 21 秒），
      //   正好踩在 300 拍的窗口上（2026-09-20 WebKit 长跑误报一条 `turnEnd|0|minigame`，随后自己走下去了）。
      //   这一屏放宽到 600 拍；它要是 42 秒还不收，那才是真卡。
      const stallWindow = s.pending && s.pending.kind === 'minigame' ? 600 : 300;
      if (same === stallWindow) { S.stalls.push({ at: S.ticks, k, steps: s.stepsRemaining, dice: s.dice, busy }); same = 0; }

      if (humanPath) {
        // ★ 真人路径的卡死检测：`moving` 且三元组 6 秒没动
        const me = s.players && s.players[s.currentPlayer];
        const mk = s.phase === 'moving'
          ? `${s.currentPlayer}|${me ? me.nodeId : '-'}|${s.stepsRemaining}`
          : null;
        const now = Date.now();
        if (mk === null) { moveKey = null; moveLogged = false; }
        else if (mk !== moveKey) { moveKey = mk; moveSince = now; moveLogged = false; }
        else if (!moveLogged && now - moveSince >= 6000) {
          S.humanStalls.push({ at: S.ticks, k: mk, steps: s.stepsRemaining, dice: s.dice });
          moveLogged = true;
        }
        // 真人路径不 dispatch endTurn，用 `turnStart` 的相位跳变数回合
        if (s.phase === 'turnStart' && lastPhase !== 'turnStart') { S.turns++; S.days.push(s.day); }
        lastPhase = s.phase;

        const human = isHumanSeat(s);
        // ★ W-14：競價屏轮到真人那一口时 `currentPlayer` 可能是**电脑**（卖家），
        //   所以这一问排在 `human` 判据之前 —— `humanExit()` 自己只在真人该作答时才非空。
        if (tryHumanExit()) return;
        if (s.pending && s.pending.kind !== 'none') {
          // 真人的待决交互：优先点界面上的按钮（UI 动作，不计入 soakDispatches）；
          // 界面点不到（柜台/商店那类整屏）才兜底 declineDecision —— 会计进
          // soakDispatches，看到非 0 就是这里。
          if (human) {
            const d = dialogNow();
            if (d) { clickDialog(d); return; }
            dispatchSelf({ type: 'declineDecision' });
          }
          // 电脑的待决交互交给客户端自己的 driver（scheduleAi），脚本不伸手
          return;
        }
        const d = dialogNow();
        if (d) { clickDialog(d); return; }
        // ★ 真人掷骰：点 GO，**不是** dispatch rollDice
        if (s.phase === 'awaitingRoll' && human) { clickGo(); return; }
        // moving / settling / turnEnd / turnStart：一个 action 都不派 ——
        // 客户端的 driver 必须自己把回合推下去（本模式要验的就是这个）
        return;
      }

      // ── legacy（默认）：先粗暴答掉一切待决交互（本轮只关心**引擎层**会不会卡）──
      if (s.pending && s.pending.kind !== 'none') {
        dispatchSelf({ type: 'declineDecision' });
        return;
      }
      const d = dialogNow();
      if (d) { clickDialog(d); return; }
      switch (s.phase) {
        case 'turnStart': dispatchSelf({ type: 'startTurn' }); break;
        case 'awaitingRoll': if (s.currentPlayer === 0) dispatchSelf({ type: 'rollDice' }); break;
        case 'moving': dispatchSelf({ type: 'step' }); break;
        case 'settling': dispatchSelf({ type: 'settle' }); break;
        case 'turnEnd':
          // ★ 回合边界的惡人段（T-047 的 D-T047-5）也要走 —— 那一段由 `npcStep`
          //   逐条推进（`endTurn` 在队列非空时是**有意的空操作**）。
          //   这里用 core 的 `autoAction` 问，免得把「还有哪些惡人」的知识
          //   在脚本里再抄一遍。
          if (s.pendingNpcSlots && s.pendingNpcSlots.length > 0) {
            dispatchSelf({ type: 'npcStep' });
            break;
          }
          S.turns++; S.days.push(s.day); dispatchSelf({ type: 'endTurn' }); break;
        default: break;
      }
    } catch (e) { S.errors.push(String(e).slice(0, 200)); if (S.errors.length > 8) clearInterval(globalThis.__soakTimer); }
  }, 70);
  return humanPath ? 'soak2 started (human path)' : 'soak2 started';
})()
