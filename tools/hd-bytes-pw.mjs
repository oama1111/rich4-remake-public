/*
 * 高清流量量测（W-80 §8，需求方 2026-09-24 的预算：桌面一局额外 ≤ ~30 MB、手机 ≤ ~5 MB）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用 Playwright 的网络记录量「一局」到底下了多少字节，按类别分：原版素材 `/assets/game/`、
 * 超分素材 `/assets/hd-2x/`（清单 + 精灵 + 过场帧）、其余（前端脚本等）。
 * 一局 = 开场过场（4 人各两段）+ 电脑自己打到 `TURNS` 回合（缺省 30）。
 *
 * 用法（先起自己的 Vite，并让它端出线上那份超分子集：
 *   `RICH4_HD_ROOT=<hd-deploy 暂存>/assets pnpm --filter @rich4/client dev --port 5395 --strictPort`）：
 *   VITE=5395 DEVICE=desktop1440|iphone HD=1|0 [TURNS=30] node tools/hd-bytes-pw.mjs
 *
 * ⚠️ 开发服务器不压缩 `.mkf`（线上发的是 `.br`），所以「原版素材」一栏比线上大；超分那一栏线上一样
 *   （PNG / WebP 本来就压过，清单线上走 `.br` 约 17 KB，这里是原文）。
 */
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { chromium, devices } = require('playwright');

const VITE = process.env.VITE ?? '5395';
const DEVICE = process.env.DEVICE ?? 'desktop1440';
const HD = process.env.HD ?? '1';
const TURNS = Number(process.env.TURNS ?? '30');
const LIMIT_MS = Number(process.env.LIMIT_MS ?? String(12 * 60_000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const dev =
  DEVICE === 'desktop1440'
    ? { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
    : devices['iPhone 13 landscape'];
const ctx = await browser.newContext({ ...dev });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
const urls = new Map();
cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
const bytes = { game: 0, hdManifest: 0, hdSprite: 0, hdFlic: 0, other: 0 };
const counts = { hdSprite: 0, hdFlic: 0 };
const flics = new Set();
cdp.on('Network.loadingFinished', (e) => {
  const u = urls.get(e.requestId) ?? '';
  const n = e.encodedDataLength;
  if (u.includes('/assets/game/')) bytes.game += n;
  else if (u.includes('/assets/hd-2x-manifest')) bytes.hdManifest += n;
  else if (/\/assets\/hd-2x\/Data\//.test(u)) {
    bytes.hdSprite += n;
    counts.hdSprite++;
  } else if (/\/assets\/hd-2x\/(jump|Panel)\//.test(u)) {
    bytes.hdFlic += n;
    counts.hdFlic++;
    flics.add(u.replace(/^.*\/assets\/hd-2x\//, '').replace(/-\d+\.\w+.*$/, ''));
  } else bytes.other += n;
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`http://localhost:${VITE}/?screen=game&humans=0&ai=4&chars=3,0,5,7&map=0&seed=7&mute=1&hd=${HD}`);
await page.waitForFunction(() => !!(globalThis.__rich4 && globalThis.__rich4.state), null, { timeout: 180_000 });
const t0 = Date.now();
let turn = 0;
while (Date.now() - t0 < LIMIT_MS) {
  turn = await page.evaluate(() => globalThis.__rich4.state.turnCount);
  if (turn >= TURNS) break;
  await sleep(2000);
}
await sleep(3000);
const hd = await page.evaluate(() => globalThis.__rich4.hdStats());
const mb = (n) => Math.round((n / 1048576) * 100) / 100;
const hdTotal = bytes.hdManifest + bytes.hdSprite + bytes.hdFlic;
console.log(
  JSON.stringify(
    {
      device: DEVICE,
      hd: HD,
      turns: turn,
      secs: Math.round((Date.now() - t0) / 1000),
      hdStats: hd,
      MB: {
        game: mb(bytes.game),
        other: mb(bytes.other),
        hdManifest: mb(bytes.hdManifest),
        hdSprite: mb(bytes.hdSprite),
        hdFlic: mb(bytes.hdFlic),
        hdTotal: mb(hdTotal),
      },
      counts,
      flics: [...flics].sort(),
      errors,
    },
    null,
    1,
  ),
);
await browser.close();
