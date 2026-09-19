/*
 * 重交互格扫描（回归用）—— 把每一种「要点进去」的特殊格挨个走一遍，
 * 断言：给出预期的待决交互 → 答掉之后回到可玩状态（不卡屏、不留残余）。
 *
 * ★ 2026-09-19（W-12）：本文件原来叫 `tools/sweep-screens.js`。那一轮把
 *   `sweep-screens.js` 改成了「全屏幕截图扫描」，这份**交互格**扫描原样搬到这里，
 *   逻辑一行没改，只是文件与用法文档换了名字。
 *
 * 为什么单独做这一套：`tools/soak-browser.js` 为了跑长局会把一切待决交互
 * `declineDecision` 掉，于是**交互屏本身**反而没被打开过。这一套专打那一面。
 *
 * 用法（与 soak 同一套）：
 *   1) pnpm dev
 *   2) 浏览器打开 http://localhost:5173/?screen=game&humans=1&ai=3&map=0&seed=7&chars=0,3,5,7
 *   3) `cp tools/sweep-squares.js /tmp/squares.js && browse eval /tmp/squares.js`，
 *      然后读 `globalThis.__isweep`
 *      ⚠️ 与 `soak-browser.js` 同：**不要**用 `browse js "$(cat …)"`（多行脚本会出问题，见该文件用法 3）
 *
 * 实测（2026-09-16，地圖 0）：14 种全部正常 ——
 *   PENGUIN_DIG / BALLOON / GIFT_FROM_SKY → `minigame`
 *   LOTTERY → `lottery`   BANK → `bank`   DEPARTMENT_STORE → `shop`
 *   PRISON / HOSPITAL → `bail`
 *   MAGIC_HOUSE / POINTS_* / CARD / NEWS / FORTUNE / PARK → 即时结算（无 pending）
 * 答掉之后一律回到 `awaitingRoll`、`screen === 'game'`。
 * ★ 魔法屋没有 pending 是**对的** —— 原版就是两个转盘随机、即时结算
 *   （见 `known-deviations.md` 的「魔法屋：两个转盘都已解出」）。
 *
 * 节点号取自地圖 0（每种取首个；换地图请先重新解出节点号）。
 */
(() => {
  const r = globalThis.__rich4;
  const KINDS = [
    ['PENGUIN_DIG', 101], ['BALLOON', 25], ['GIFT_FROM_SKY', 71], ['LOTTERY', 20],
    ['BANK', 19], ['DEPARTMENT_STORE', 8], ['MAGIC_HOUSE', 7], ['PRISON', 12],
    ['HOSPITAL', 16], ['POINTS_50', 24], ['CARD', 5], ['NEWS', 11], ['FORTUNE', 6], ['PARK', 10],
  ];
  const R = [];
  for (const [name, nodeId] of KINDS) {
    try {
      const s = r.state;
      s.pending = null;
      s.currentPlayer = 0;
      s.phase = 'settling';
      r.warp(nodeId);
      r.dispatch({ type: 'settle' });
      const mid = { phase: r.state.phase, pend: r.state.pending && r.state.pending.kind, screen: r.screen };
      for (let i = 0; i < 30; i++) {
        const st = r.state;
        if (st.pending && st.pending.kind !== 'none') { r.dispatch({ type: 'declineDecision' }); continue; }
        if (st.phase === 'turnStart') r.dispatch({ type: 'startTurn' });
        else if (st.phase === 'moving') r.dispatch({ type: 'step' });
        else if (st.phase === 'settling') r.dispatch({ type: 'settle' });
        else if (st.phase === 'turnEnd') r.dispatch({ type: 'endTurn' });
        else break;
      }
      R.push({ name, nodeId, mid, endPhase: r.state.phase, endPend: r.state.pending && r.state.pending.kind, screen: r.screen });
    } catch (e) { R.push({ name, nodeId, error: String(e).slice(0, 100) }); }
  }
  globalThis.__isweep = R;
  return 'done ' + R.length;
})()
