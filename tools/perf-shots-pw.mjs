/*
 * 第十九份（手机发烫）改动前后的**画面比对**：同一批静止屏各截几张主画布（`canvas#board` 的 PNG），
 * 按内容哈希去重后落盘 —— 改动前后各跑一次，两份清单应当一模一样。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   VITE=5402 OUT=.qa-tmp/shots-before node tools/perf-shots-pw.mjs
 *
 * 场景：標題（iPhone 13 横屏 DPR 3 / 桌面 1280×900 DPR 1）、等真人掷骰的棋盘（GO 鈕闪烁 ⇒ 应得 2 张）、百貨公司。
 * 全程 `?mute=1`。开局种子取自 `Date.now()`（`startGame`），故这里把 `Date.now` 钉死、`Math.random` 换成
 * 定种子的 LCG —— 前后两次跑的是同一局、同一个开局落点。
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { chromium, devices } = require('playwright');
const VITE = process.env.VITE ?? '5402';
const OUT = process.env.OUT ?? '.qa-tmp/shots';
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${VITE}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const manifest = {};

async function grab(page, label, n = 8, gap = 300) {
  const seen = new Map();
  const where = await page.evaluate(() => {
    const r = globalThis.__rich4;
    return r?.state ? { screen: r.screen, turn: r.state.turnCount, cp: r.state.currentPlayer, nodes: r.state.players.map((p) => p.nodeId) } : null;
  });
  console.error(label, JSON.stringify(where));
  for (let i = 0; i < n; i++) {
    const url = await page.evaluate(() => document.getElementById('board').toDataURL('image/png'));
    const buf = Buffer.from(url.split(',')[1], 'base64');
    const h = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (!seen.has(h)) {
      seen.set(h, 0);
      writeFileSync(`${OUT}/${label}-${h}.png`, buf);
    }
    seen.set(h, seen.get(h) + 1);
    await sleep(gap);
  }
  manifest[label] = [...seen.keys()].sort();
  console.error(label, JSON.stringify(Object.fromEntries(seen)));
}

const DETERMINISTIC = () => {
  Date.now = () => 1_700_000_000_000;
  let seed = 12345;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
};

const profiles = { phone: devices['iPhone 13 landscape'], desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } };
for (const [pname, prof] of Object.entries(profiles)) {
  {
    const ctx = await browser.newContext({ ...prof });
    await ctx.addInitScript(DETERMINISTIC);
    const page = await ctx.newPage();
    await page.goto(`${BASE}?screen=title&mute=1`);
    await page.waitForFunction(() => !!(globalThis.__rich4 && globalThis.__rich4.state), null, { timeout: 180_000 });
    await sleep(5000);
    await grab(page, `${pname}-title`, 4);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ ...prof });
    await ctx.addInitScript(DETERMINISTIC);
    const page = await ctx.newPage();
    await page.goto(`${BASE}?screen=game&humans=1&ai=3&map=0&seed=7&mute=1`);
    await page.waitForFunction(() => !!(globalThis.__rich4 && globalThis.__rich4.state), null, { timeout: 180_000 });
    await page.waitForFunction(
      () => {
        const r = globalThis.__rich4;
        return r.screen === 'game' && r.state.phase === 'awaitingRoll' && r.state.currentPlayer === 0 && r.overlayId() === null;
      },
      null,
      { timeout: 120_000 },
    );
    await sleep(5000);
    await grab(page, `${pname}-idle`, 12, 170);
    await page.evaluate(() => {
      const r = globalThis.__rich4;
      r.warp(r.map.nodes.find((n) => n && n.specialKind === 15).id);
    });
    await page.waitForFunction(() => globalThis.__rich4.shopUi != null, null, { timeout: 60_000 });
    await sleep(6000);
    await grab(page, `${pname}-shop`, 6);
    await ctx.close();
  }
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
await browser.close();
