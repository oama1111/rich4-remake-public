/*
 * `tools/net-e2e.sh` 第 1–5 步的 Playwright 版（第十六份第二轮）—— 自己的浏览器、两端各一个 context
 * （不共用 `browse` 守护进程与 localStorage，不碰别人的标签页 / 服务器），可与别的检出并行跑。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法（先起自己的 Vite：`pnpm --filter @rich4/client dev --port 5374 --strictPort`）：
 *   ROOT=$PWD VITE=5374 PORT=8796 SEATS=4 [SEED=968029213] node tools/net-e2e-pw.mjs
 * `PLAYWRIGHT_FROM`：从哪个目录 require('playwright')（缺省 gstack 自带的那份）。
 * 额外打印每端 `__rich4.presStats()`（驱动被演出挡了多久、按原因）与「演出死锁自解」次数。
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = process.env.ROOT;
const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { chromium } = require('playwright');
const VITE = process.env.VITE ?? '5374';
const PORT = process.env.PORT ?? '8796';
const SEATS = process.env.SEATS ?? '4';
const TURNS = Number(process.env.TURNS ?? '50');
const ROOM = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const URL = `http://localhost:${VITE}/?mute=1&ws=ws://localhost:${PORT}/ws&room=${ROOM}`;
const JS = readFileSync(`${ROOT}/tools/net-e2e.js`, 'utf8');
const OUT = `${ROOT}/.qa-tmp/pw-e2e`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

log(`=== 起服务器（--seats ${SEATS}，port ${PORT}，room ${ROOM}）===`);
const server = spawn('node', ['--experimental-transform-types', 'packages/server/src/cli.ts', '--port', PORT, '--map', '0', '--seats', SEATS, '--takeover', '6000', '--no-gate', ...(process.env.SEED ? ['--seed', process.env.SEED] : [])], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const slog = createWriteStream(`${OUT}/server.log`);
server.stdout.pipe(slog);
server.stderr.pipe(slog);
process.on('exit', () => server.kill());
await sleep(6000);

const browser = await chromium.launch({ headless: true });
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${name} pageerror] ${e.message}`));
  await page.goto(`${URL}&name=${name}`);
  await page.waitForFunction(() => !!(globalThis.__rich4 && globalThis.__rich4.state), null, { timeout: 180_000 });
  // 等进房（日志里有「我是 N 號座」）再注入驱动
  await page.waitForFunction(() => [...(document.getElementById('log')?.children ?? [])].some((d) => /號座/.test(d.textContent ?? '')), null, { timeout: 180_000 });
  return { ctx, page, name };
};
log('=== 开两个客户端 ===');
let [A, B] = await Promise.all([open('A'), open('B')]);
await Promise.all([A, B].map((p) => p.page.evaluate(JS)));
log('  两端都进房、驱动已注入');

const summary = (p) => p.page.evaluate(() => globalThis.__net.summary());
const cp = (p) => p.page.evaluate(() => globalThis.__net.checkpoint());
const stats = (p) =>
  p.page.evaluate(() => ({
    stats: globalThis.__rich4.presStats ? globalThis.__rich4.presStats() : null,
    unwindLines: [...document.getElementById('log').children].map((d) => d.textContent).filter((t) => t.includes('演出死锁自解')).length,
    rejected: [...document.getElementById('log').children].map((d) => d.textContent).filter((t) => t.includes('notYourTurn')).length,
    errors: [...document.getElementById('log').children].map((d) => d.textContent).filter((t) => t.includes('程式錯誤')).length,
  }));
const pauseBoth = () => Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__net.stop())));
const resumeBoth = () => Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__net.resume())));
const settle = async () => {
  let a, b;
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    a = await cp(A);
    b = await cp(B);
    if (a.digest === b.digest) break;
  }
  return [a, b];
};

log(`\n=== 1) 跑到 ${TURNS} 回合 ===`);
let ok1 = false;
const t0 = Date.now();
for (let i = 0; i < 60; i++) {
  await sleep(5000);
  const sa = await summary(A);
  const sb = await summary(B);
  log(`  … ${Math.round((Date.now() - t0) / 1000)}s A 回合 ${sa.turnCount} / B 回合 ${sb.turnCount}`);
  if (sa.turnCount >= TURNS && sb.turnCount >= TURNS) {
    ok1 = true;
    break;
  }
}
log(ok1 ? `PASS 1) 两端都过了 ${TURNS} 回合` : `FAIL 1) 5 分钟内没到 ${TURNS} 回合`);
for (const p of [A, B]) log(`  ${p.name} 统计：${JSON.stringify(await stats(p))}`);
log(`  B 日志头：${JSON.stringify(await B.page.evaluate(() => [...document.getElementById('log').children].slice(0, 6).map((d) => d.textContent)))}`);

log('\n=== 2) 冻结两端比对全量摘要 ===');
await pauseBoth();
let [ca, cb] = await settle();
log(`${ca.digest === cb.digest && ca.turn === cb.turn ? 'PASS' : 'FAIL'} 2) 同一回合 ${ca.turn}：digest ${ca.digest} vs ${cb.digest}`);

log('\n=== 3) 刷新 B 端，重连后比对 ===');
await B.page.goto(`${URL}&name=B`);
await B.page.waitForFunction(() => !!(globalThis.__rich4 && globalThis.__rich4.state), null, { timeout: 180_000 });
await sleep(3000);
await B.page.evaluate(JS);
await resumeBoth();
await sleep(8000);
await pauseBoth();
[ca, cb] = await settle();
log(`${ca.digest === cb.digest && ca.turn === cb.turn ? 'PASS' : 'FAIL'} 3) 重连后同一回合 ${ca.turn}：digest ${ca.digest} vs ${cb.digest}`);

log('\n=== 4) 人为改坏 B 端 → 看失步与自愈 ===');
await resumeBoth();
await sleep(2000);
log('  ' + JSON.stringify(await B.page.evaluate(() => globalThis.__net.tamper())));
await sleep(15000);
for (const p of [A, B]) log(`  ${p.name} 失步行：${JSON.stringify((await summary(p)).desyncLines.map((x) => x.slice(0, 100)))}`);
await pauseBoth();
[ca, cb] = await settle();
log(`${ca.digest === cb.digest && ca.turn === cb.turn ? 'PASS' : 'FAIL'} 4) 自愈后同一回合 ${ca.turn}：digest ${ca.digest} vs ${cb.digest}`);

log('\n=== 5) 关掉 B 端，等过托管阈值，看 A 端还能不能自己推进 ===');
await B.ctx.close();
await A.page.evaluate(() => globalThis.__net.resume());
const t1 = (await summary(A)).turnCount;
let t2 = t1;
let waited = 0;
while (waited < 60 && t2 <= t1) {
  await sleep(3000);
  waited += 3;
  t2 = (await summary(A)).turnCount;
}
log(`  关 B 端时 A 回合 ${t1}，等了 ${waited}s 后 ${t2}`);
log(t2 > t1 ? 'PASS 5) 无人操作 B 座，回合仍在推进（服务器补位）' : 'FAIL 5) 回合停了');
log(`  A 最终统计：${JSON.stringify(await stats(A))}`);

await browser.close();
server.kill();
process.exit(0);
