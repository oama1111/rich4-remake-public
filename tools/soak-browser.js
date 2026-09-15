/*
 * 浏览器长跑（回归用）—— 自动把一局打下去，逐拍记录 phase / 待决交互，
 * 抓「引擎层」的卡死与异常。2026-09-16 用它抓到过两处硬卡死：
 *   · 骰子动画相位只在被画的时候推进 ⇒ 整屏接管盖住棋盘后 active 恒真、整局冻死
 *   · requestRoll() 被拒时静默丢弃、scheduleAi 不再重排 ⇒ 电脑永远停在 awaitingRoll
 * 修好后同一局：**193 回合、0 次卡死、0 报错**（修前 25 回合且连续卡死）。
 *
 * 用法：
 *   1) pnpm dev   （另开一个终端；注意 Vite 可能落在 5173 而不是 5180）
 *   2) 用浏览器工具打开 http://localhost:5173/?screen=game&humans=1&ai=3&map=0&seed=7&chars=0,3,5,7
 *   3) 把本文件内容整段 `js` 执行（gstack：`browse js "$(cat tools/soak-browser.js)"`）
 *   4) 过几分钟读 `globalThis.__soak`：
 *      `{ticks, turns, stalls: [], errors: [], dialogClicks}`
 *      —— `stalls` 里每一条都是「同一个 (phase|currentPlayer|pending) 连续 300 拍
 *      （≈21 秒）没变」，正常动画等待（骰子 + 走子补间）不会超过这个窗口。
 *      ⚠️ **改完源码要重新 goto 再跑**：编辑会触发 Vite HMR 重载，把长跑打断。
 *
 * 注意：它把一切待决交互粗暴 `declineDecision` 掉，只为让引擎一直跑；
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
  const click = (sx, sy) => {
    const d = { clientX: rect.left + (ox + sx * scale) / kx, clientY: rect.top + (oy + sy * scale) / ky };
    c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...d }));
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...d }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...d }));
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...d }));
  };
  const S = { ticks: 0, turns: 0, stalls: [], errors: [], dialogClicks: 0, days: [] };
  globalThis.__soak = S;
  let lastKey = '', same = 0;
  globalThis.__soakTimer = setInterval(() => {
    try {
      const s = r.state;
      S.ticks++;
      const k = `${s.phase}|${s.currentPlayer}|${s.pending ? s.pending.kind : '-'}`;
      if (k === lastKey) same++; else { same = 0; lastKey = k; }
      if (same === 300) { S.stalls.push({ at: S.ticks, k, steps: s.stepsRemaining, dice: s.dice }); same = 0; }
      // 先粗暴答掉一切待决交互（本轮只关心**引擎层**会不会卡）
      if (s.pending && s.pending.kind !== 'none') {
        r.dispatch({ type: 'declineDecision' });
        return;
      }
      const d = r.dialog();
      if (d && Array.isArray(d.buttons) && d.buttons.length > 0) {
        // 挑「不是取消」的那颗（最后一颗通常是取消）
        const skip = /^(取消|離開|不買|NO|−|＋|\+|-|最大)/i;
        const b =
          d.buttons.find((x) => /確定|是|好|買|賣|OK/i.test(x.label) && !skip.test(x.label)) ||
          [...d.buttons].reverse().find((x) => !skip.test(x.label)) ||
          d.buttons[0];
        S.dialogClicks++; S.lastLabel = b.label;
        click(b.x, b.y);
        return;
      }
      switch (s.phase) {
        case 'turnStart': r.dispatch({ type: 'startTurn' }); break;
        case 'awaitingRoll': if (s.currentPlayer === 0) r.dispatch({ type: 'rollDice' }); break;
        case 'moving': r.dispatch({ type: 'step' }); break;
        case 'settling': r.dispatch({ type: 'settle' }); break;
        case 'turnEnd': S.turns++; S.days.push(s.day); r.dispatch({ type: 'endTurn' }); break;
        default: break;
      }
    } catch (e) { S.errors.push(String(e).slice(0, 200)); if (S.errors.length > 8) clearInterval(globalThis.__soakTimer); }
  }, 70);
  return 'soak2 started';
})()
