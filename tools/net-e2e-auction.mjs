/*
 * 联机拍卖的活体 e2e（gap-audit #4 验收）—— 真服务器 + 两个真浏览器客户端（Playwright，各自一个 context）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 证明的是：联机拍卖里**每一口**（服务器一口气替电脑出的、另一位真人点的、本机自己点的回包）
 * 在两端都照单机节拍挥槌 + 放 0x3f，本机那一口不演第二遍，不死锁、不触发代打，终局两端摘要一致。
 *
 * 怎么走到拍卖（不加任何后门）：`tools/net-e2e-auction-save.ts` 写一份服务器存档（协议 v6 的「從存檔繼續」），
 *   局面停在 A 的回合开头、A 手里有拍賣卡、脚下是一块地；A 在门厅「建立房間 → 從存檔繼續」开这一局，
 *   B 走老的 `?ws=&room=` 入口进房（凭 clientId 认回 1 号座）。A 开局后用卡 ⇒ A 是卖方（旁观），B 与两家电脑竞价。
 *   B 轮到举牌时**真的点画布上的钮**（前 `B_RAISES` 次 +100、之后 PASS），走 `auction-screen.ts` 的 `up()` → `applyHumanBid`。
 *
 * 取证（DEV 钩子，`?mute=1` 不出声）：`__rich4.auctionTrace()`（每一口挥槌的来源 / 起点 / 画出的帧、本机回包认出次数）、
 *   `__rich4.sfxLog()`（整屏音效的发出时刻）、`__rich4.history`（施加过的 action）。
 *
 * 用法（先起自己的 Vite：`pnpm --filter @rich4/client dev --port 5391 --strictPort`）：
 *   ROOT=$PWD VITE=5391 PORT=8812 node tools/net-e2e-auction.mjs
 * 退出码 0 = 全部 PASS。`SHOT=<png>` 存旁观端挥槌中的截图。
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = process.env.ROOT ?? process.cwd();
const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { chromium } = require('playwright');
const VITE = process.env.VITE ?? '5391';
const PORT = process.env.PORT ?? '8812';
const SHOT = process.env.SHOT ?? '';
const AFTER_TURNS = Number(process.env.AFTER_TURNS ?? '6');
/** 与 `net-e2e-auction-save.ts` 的 `B_RAISES` 同一个数 */
const B_RAISES = 3;
/** `auction-screen.ts`：AUCTION_FRAME_MS × AUCTION_HAMMER_FRAMES、AUCTION_BOX_MS、AUCTION_SOUND_BID */
const HAMMER_MS = 0x64 * 3;
const BOX_MS = 2000;
const SOUND_BID = 0x3f;
/** 节拍的容差：下限按 `env.now` 取样粒度留 20 ms；上限 = 收件箱 / 渲染节拍能迟到多少（「队里已有下一口」的那几对才查）*/
const PACE_MIN = HAMMER_MS - 20;
const PACE_MAX = HAMMER_MS + 250;

const OUT = `${ROOT}/.qa-tmp/pw-auction`;
mkdirSync(OUT, { recursive: true });
const SAVES = `${OUT}/saves-${process.pid}`;
rmSync(SAVES, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const fails = [];
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) fails.push(what);
};

const idA = randomBytes(16).toString('hex');
const idB = randomBytes(16).toString('hex');
log('=== 0) 写存档夹具 ===');
const gen = spawnSync('node', ['--experimental-transform-types', '--no-warnings', 'tools/net-e2e-auction-save.ts', SAVES, idA, idB], {
  cwd: ROOT,
  encoding: 'utf8',
});
if (gen.status !== 0) {
  console.error(gen.stderr);
  process.exit(1);
}
const fixture = JSON.parse(gen.stdout.trim().split('\n').pop());
log(`  ${JSON.stringify(fixture)}`);

log(`=== 起服务器（port ${PORT}，saves ${SAVES}）===`);
const server = spawn(
  'node',
  ['--experimental-transform-types', 'packages/server/src/cli.ts', '--port', PORT, '--map', '0', '--takeover', '6000', '--no-gate', '--saves', SAVES],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);
const slog = createWriteStream(`${OUT}/server.log`);
server.stdout.pipe(slog);
server.stderr.pipe(slog);
process.on('exit', () => server.kill());
await sleep(5000);

const browser = await chromium.launch({ headless: true });
const WS = `ws://localhost:${PORT}/ws`;
const newPage = async (name, clientId) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // 身份令牌 = 存档里那一座的 clientId（`foyer.ts` 的 CLIENT_ID_STORAGE_KEY）
  await ctx.addInitScript((id) => {
    try {
      localStorage.setItem('rich4.clientId', id);
    } catch {}
  }, clientId);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${name} pageerror] ${e.message}`));
  return { ctx, page, name };
};
const logLines = (p) => p.page.evaluate(() => [...(document.getElementById('log')?.children ?? [])].map((d) => d.textContent ?? ''));

log('=== 1) A 在门厅「從存檔繼續」建房 ===');
const A = await newPage('A', idA);
await A.page.goto(`http://localhost:${VITE}/?mute=1&ws=${encodeURIComponent(WS)}`);
await A.page.waitForSelector('#foyer-name', { timeout: 180_000 });
await A.page.fill('#foyer-name', 'A');
await A.page.click('#foyer-online');
await A.page.getByRole('button', { name: '建立房間' }).click();
await A.page.click('#foyer-from-save');
await A.page.getByRole('button', { name: '選這個' }).first().click();
await A.page.waitForFunction(() => [...(document.getElementById('log')?.children ?? [])].some((d) => /進房 [A-Z0-9]{6}/.test(d.textContent ?? '')), null, { timeout: 180_000 });
const room = (await logLines(A)).map((l) => /進房 ([A-Z0-9]{6})/.exec(l)?.[1]).find((x) => x);
log(`  房间 ${room}；A 日志：${JSON.stringify((await logLines(A)).filter((l) => /進房/.test(l)))}`);

log('=== 2) B 走 ?ws=&room= 进房（凭 clientId 认回 1 号座）===');
const B = await newPage('B', idB);
await B.page.goto(`http://localhost:${VITE}/?mute=1&ws=${encodeURIComponent(WS)}&room=${room}&name=B`);
await B.page.waitForFunction(() => [...(document.getElementById('log')?.children ?? [])].some((d) => /號座/.test(d.textContent ?? '')), null, { timeout: 180_000 });
log(`  B 日志：${JSON.stringify((await logLines(B)).filter((l) => /進房/.test(l)))}`);

/** 页面里的驱动：A 开局 → 自己回合开头用拍賣卡；B 轮到举牌时点真钮 */
const driver = (cfg) => {
  const r = globalThis.__rich4;
  const T = (globalThis.__auc = { clicks: [], usedCardAt: null, bTurns: 0, lastKey: '', errors: [] });
  const click = (sx, sy) => {
    const c = document.querySelector('canvas');
    const rect = c.getBoundingClientRect();
    const raw = Math.min(c.width / 640, c.height / 480);
    const whole = Math.floor(raw);
    const scale = whole >= 1 && raw - whole < 0.02 ? whole : raw;
    const ox = Math.floor((c.width - 640 * scale) / 2);
    const oy = Math.floor((c.height - 480 * scale) / 2);
    const kx = c.width / rect.width;
    const ky = c.height / rect.height;
    const d = { clientX: rect.left + (ox + sx * scale) / kx, clientY: rect.top + (oy + sy * scale) / ky };
    for (const type of ['mousemove', 'mousedown']) c.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...d }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...d }));
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...d }));
  };
  let lastStart = 0;
  let lastKey = '';
  let lastAt = 0;
  T.timer = setInterval(() => {
    try {
      const now = performance.now();
      if (r.screen === 'lobby') {
        if (cfg.role === 'A' && now - lastStart > 500) {
          lastStart = now;
          click(506 + 55, 398 + 17);
        }
        return;
      }
      if (r.screen !== 'game') return;
      const s = r.state;
      if (cfg.role === 'A') {
        if (T.usedCardAt !== null || s.currentPlayer !== cfg.seat) return;
        const key = `${s.phase}|${s.pending ? s.pending.kind : '-'}`;
        if (key === lastKey && now - lastAt < 1500) return;
        lastKey = key;
        lastAt = now;
        if (s.phase === 'turnStart') r.dispatch({ type: 'startTurn' });
        else if (s.phase === 'awaitingRoll' && s.pending === null) {
          r.dispatch({ type: 'useCard', cardId: 8, target: { kind: 'none' } });
          T.usedCardAt = now;
        }
        return;
      }
      // B：只在本屏自己说「轮到本机真人举牌」时伸手（`humanExit` = 与 down()/up() 同一个 humanTurn）
      const ex = r.humanExit();
      if (ex === null || ex.why !== 'auction:PASS') return;
      const p = s.pending;
      const key = `${p.seat}@${p.price}`;
      if (key === T.lastKey) return;
      T.lastKey = key;
      const btn = T.bTurns < cfg.raises ? 1 : 0;
      T.bTurns++;
      // 七颗钮：cx 0x196，y 0x85 + i×0x30（`AUCTION_BUTTON`）
      click(0x196, 0x85 + btn * 0x30);
      T.clicks.push({ t: now, btn, key });
    } catch (e) {
      T.errors.push(String(e).slice(0, 200));
    }
  }, 50);
  return 'ok';
};
await A.page.evaluate(driver, { role: 'A', seat: 0, raises: B_RAISES });
await B.page.evaluate(driver, { role: 'B', seat: 1, raises: B_RAISES });

log('=== 3) 开局 → A 用拍賣卡 → 竞价 ===');
for (let i = 0; ; i++) {
  const scr = await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__rich4.screen)));
  if (scr.every((x) => x === 'game')) break;
  if (i % 25 === 0) log(`  … 画面 A=${scr[0]} B=${scr[1]}；A 日志头 ${JSON.stringify((await logLines(A)).slice(0, 4))}`);
  if (i > 900) {
    await A.page.screenshot({ path: `${OUT}/stuck-A.png` });
    throw new Error('3 分钟内没开局');
  }
  await sleep(200);
}
await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__rich4.auctionTrace(true))));
const t0 = Date.now();
let opened = false;
let shot = false;
let done = false;
while (Date.now() - t0 < 180_000) {
  const st = await Promise.all(
    [A, B].map((p) =>
      p.page.evaluate(() => {
        const r = globalThis.__rich4;
        const tr = r.auctionTrace();
        const last = tr.anims[tr.anims.length - 1];
        return {
          now: performance.now(),
          pending: r.state.pending ? r.state.pending.kind : null,
          overlay: r.overlayId(),
          opens: tr.opens.length,
          anims: tr.anims.length,
          lastT: last ? last.t : null,
          usedCardAt: globalThis.__auc.usedCardAt,
        };
      }),
    ),
  );
  const [a, b] = st;
  if (a.opens > 0 && b.opens > 0) opened = true;
  // 旁观端（A）挥槌中的那一刻截一张
  if (!shot && SHOT !== '' && a.anims >= 2 && a.lastT !== null && a.now - a.lastT < 120) {
    await A.page.screenshot({ path: SHOT });
    shot = true;
    log(`  截图（A 第 ${a.anims} 口挥槌中）→ ${SHOT}`);
  }
  if (opened && a.pending !== 'auction' && b.pending !== 'auction' && a.overlay !== 'auction' && b.overlay !== 'auction') {
    done = true;
    break;
  }
  await sleep(40);
}
check(opened, '3a) 两端都开出了拍卖屏');
check(done, `3b) 拍卖在 ${Math.round((Date.now() - t0) / 1000)}s 内走完、两端都收屏（不死锁）`);

const evidence = (p) =>
  p.page.evaluate((SOUND) => {
    const r = globalThis.__rich4;
    const lines = [...document.getElementById('log').children].map((d) => d.textContent ?? '');
    const bids = r.history.filter((a) => a.type === 'auctionBid').map((a) => ({ bidder: a.bidder, status: a.status, step: a.step }));
    const setAi = r.history.filter((a) => a.type === 'setAi').map((a) => ({ player: a.player, whoPlays: a.whoPlays }));
    return {
      trace: r.auctionTrace(),
      sfx: r.sfxLog().filter((e) => e.id === SOUND).map((e) => e.t),
      bids,
      setAi,
      autopilot: r.state.players.map((pl) => (pl.whoPlays & 0x04) !== 0),
      drv: { clicks: globalThis.__auc.clicks, errors: globalThis.__auc.errors, bTurns: globalThis.__auc.bTurns },
      stats: r.presStats(),
      unwindLines: lines.filter((t) => t.includes('演出死锁自解')),
      rejected: lines.filter((t) => t.includes('notYourTurn')),
      errors: lines.filter((t) => t.includes('程式錯誤')),
      desync: lines.filter((t) => t.includes('失步')),
      takeover: lines.filter((t) => /代打|託管/.test(t)),
    };
  }, SOUND_BID);
const ev = { A: await evidence(A), B: await evidence(B) };

log('\n=== 4) 每一口的演出 ===');
const total = ev.A.bids.length;
const bBids = ev.A.bids.filter((x) => x.bidder === 1).length;
log(`  出价 ${total} 口（B ${bBids} 口，电脑 ${total - bBids} 口）：${ev.A.bids.map((x) => `${x.bidder}:${x.status}${x.step ? '+' + x.step : ''}`).join(' ')}`);
log(`  夹具预演 ${fixture.predicted.bids} 口（B ${fixture.predicted.bTurns}、电脑 ${fixture.predicted.aiBids}）`);
check(total >= 6 && ev.B.bids.length === total, `4a) 两端施加的出价一样多且够长（A ${total} / B ${ev.B.bids.length}）`);
check(bBids >= 2 && ev.B.drv.clicks.length === bBids, `4b) B 真点了 ${ev.B.drv.clicks.length} 次钮、落地 ${bBids} 口`);

const perClient = {};
for (const who of ['A', 'B']) {
  const e = ev[who];
  const anims = e.trace.anims;
  const open = e.trace.opens[0] ?? null;
  const t = anims.map((x) => x.t);
  const intervals = t.slice(1).map((x, i) => Math.round(x - t[i]));
  const bySource = anims.reduce((m, x) => ((m[x.source] = (m[x.source] ?? 0) + 1), m), {});
  const firstGap = open === null || t[0] === undefined ? null : Math.round(t[0] - open);
  // 与单机同一节拍：下一口若不是 B 的（B 要人想）⇒ 它在上一口挥槌收尾时就已经在队里 ⇒ 间隔 ≈ HAMMER_MS
  const paced = anims.slice(1).map((x, i) => ({ gap: intervals[i], queued: x.bidder !== 1 }));
  const queuedGaps = paced.filter((x) => x.queued).map((x) => x.gap);
  // 音效：拍卖屏开着那段里的 0x3f（`sfx` 已按号过滤；落槌那声是 0x1d 不算）
  const sfxIn = open === null ? [] : e.sfx.filter((s) => s >= open - 1);
  const sfxVsAnim = anims.map((x) => sfxIn.reduce((best, s) => Math.min(best, Math.abs(s - x.t)), Infinity));
  perClient[who] = { anims: anims.length, bySource, intervals, firstGap, queuedGaps, sfx: sfxIn.length, echoes: e.trace.echoes.length };
  log(`  ${who}：挥槌 ${anims.length} 次 ${JSON.stringify(bySource)}；开场→第一口 ${firstGap} ms；0x3f ${sfxIn.length} 声；回包认出 ${e.trace.echoes.length} 次`);
  log(`     间隔 ms：${intervals.join(', ')}`);
  log(`     逐口（出价者/来源/帧）：${anims.map((x) => `${x.bidder}/${x.source[0]}/${x.frames.join('')}`).join(' ')}`);
  check(anims.length === total, `4c-${who}) 每一口都挥了槌（${anims.length}/${total}）`);
  check(anims.every((x) => [0, 1, 2].every((f) => x.frames.includes(f))), `4d-${who}) 每一口三帧都画出来了`);
  check(sfxIn.length === total, `4e-${who}) 0x3f 恰好 ${total} 声（实 ${sfxIn.length}）—— 本机那口没放两遍`);
  check(sfxVsAnim.every((d) => d < 5), `4f-${who}) 每一声 0x3f 与挥槌同一拍（最大偏差 ${Math.max(...sfxVsAnim).toFixed(1)} ms）`);
  check(firstGap !== null && firstGap >= BOX_MS - 20, `4g-${who}) 开场那句走完才出第一口（${firstGap} ms ≥ ${BOX_MS}）`);
  check(intervals.every((g) => g >= PACE_MIN), `4h-${who}) 任意两口不早于挥槌收尾（最小 ${Math.min(...intervals)} ms ≥ ${PACE_MIN}）`);
  check(
    queuedGaps.length > 0 && queuedGaps.every((g) => g <= PACE_MAX),
    `4i-${who}) 排着的下一口按单机节拍放（${queuedGaps.length} 对，最大 ${Math.max(...queuedGaps)} ms ≤ ${PACE_MAX}）`,
  );
}
check(ev.B.trace.anims.filter((x) => x.source === 'local').length === bBids && ev.B.trace.echoes.length === bBids, `4j) B 自己那 ${bBids} 口：点钮时演一次、回包 ${ev.B.trace.echoes.length} 次都认出没重演`);
check(ev.A.trace.anims.every((x) => x.source === 'broadcast'), '4k) 旁观端 A 每一口都是广播补演（没有本机出价）');

log('\n=== 5) 代打 / 死锁 / 错误 ===');
for (const who of ['A', 'B']) {
  const e = ev[who];
  log(`  ${who}：presStats ${JSON.stringify(e.stats)}；setAi ${JSON.stringify(e.setAi)}；日志 代打/託管 ${JSON.stringify(e.takeover)}`);
  check(e.unwindLines.length === 0 && e.stats.unwinds === 0, `5a-${who}) 没有 ⚠ 演出死锁自解`);
  check(e.autopilot[0] === false && e.autopilot[1] === false && e.setAi.every((x) => x.player > 1 || (x.whoPlays & 0x04) === 0), `5b-${who}) 真人座位没被服务器接管`);
  check(e.rejected.length === 0 && e.errors.length === 0 && e.desync.length === 0 && e.drv.errors.length === 0, `5c-${who}) 没有被拒 / 程式錯誤 / 失步 / 驱动异常`);
}

log(`\n=== 6) 拍卖之后接着打 ${AFTER_TURNS} 回合（net-e2e 驱动），再冻结比对摘要 ===`);
const JS = readFileSync(`${ROOT}/tools/net-e2e.js`, 'utf8');
await Promise.all([A, B].map((p) => p.page.evaluate(() => clearInterval(globalThis.__auc.timer))));
await Promise.all([A, B].map((p) => p.page.evaluate(JS)));
const turn0 = await A.page.evaluate(() => globalThis.__rich4.state.turnCount);
const t1 = Date.now();
let advanced = false;
while (Date.now() - t1 < 150_000) {
  await sleep(3000);
  const [ta, tb] = await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__rich4.state.turnCount)));
  if (ta >= turn0 + AFTER_TURNS && tb >= turn0 + AFTER_TURNS) {
    advanced = true;
    break;
  }
}
check(advanced, `6a) 拍卖之后回合照常推进（${turn0} → ≥ ${turn0 + AFTER_TURNS}）`);
await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__net.stop())));
let ca;
let cb;
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  [ca, cb] = await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__net.checkpoint())));
  if (ca.digest === cb.digest) break;
}
check(ca.digest === cb.digest && ca.turn === cb.turn, `6b) 冻结后两端同一回合 ${ca.turn}：digest ${ca.digest} vs ${cb.digest}`);
const post = { A: await evidence(A), B: await evidence(B) };
for (const who of ['A', 'B']) {
  const e = post[who];
  check(e.unwindLines.length === 0 && e.stats.unwinds === 0 && e.autopilot[0] === false && e.autopilot[1] === false && e.desync.length === 0,
    `6c-${who}) 收尾后仍无死锁自解 / 接管 / 失步`);
}

log(`\nJSON ${JSON.stringify({ total, bBids, perClient })}`);
await browser.close();
server.kill();
rmSync(SAVES, { recursive: true, force: true });
log(fails.length === 0 ? '\nALL PASS' : `\n${fails.length} FAIL：${fails.join(' | ')}`);
process.exit(fails.length === 0 ? 0 : 1);
