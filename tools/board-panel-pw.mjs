/*
 * 左侧佈告欄的无头验收 —— 桌面 1440×900 与 iPhone 13 横屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这件事**只能**在真浏览器里量：面板是不是盖住了画布、画布还吃不吃得到点击、
 * 页面有没有被撑出可滚高度。vitest 那边钉的是源码与纯逻辑（见 `board-panel.test.ts`），
 * 这里钉的是**实际几何**。
 *
 * 用法（先起自己的 Vite，别占别人的端口）：
 *   pnpm --filter @rich4/client dev --port 5417 --strictPort
 *   VITE=5417 node tools/board-panel-pw.mjs
 *
 * 量四件事：
 *   ① 桌面 1440×900：面板默认展开、画布整块在视口里、两者不重叠、画布**正中/四边**上
 *      `elementFromPoint` 都判给画布、真的点下去画布收得到 `mousedown`；页面不可滚。
 *   ② iPhone 13 横屏：面板默认**收起**（只剩细籤）、画布整块在视口里、点一下画布照收。
 *   ③ 面板收起/展开来回切：画布跟着变宽变窄，切换前后都整块可见、都能点。
 *   ④ `/board.json` 404：面板**一直不出现**，画布照旧收得到点击（游戏不受影响）。
 *
 * `PLAYWRIGHT_FROM`：从哪个目录 require('playwright')（与 tools/ 下别的 pw 脚本同一套约定）。
 * 截图落在 `.qa-tmp/`（**不入库**）。
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { chromium, devices } = require('playwright');

const VITE = process.env.VITE ?? '5417';
const BASE = `http://127.0.0.1:${VITE}/`;
const OUT = `${process.env.ROOT ?? process.cwd()}/.qa-tmp/board-panel`;
const SHOTS = process.env.SHOTS === '1';
const SCREEN_W = 640;
const SCREEN_H = 480;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === '' ? '' : ` —— ${detail}`}`);
};

/** 画布里量到的几何：面板与画布的矩形、舞台放大倍数、有没有重叠 */
const GEOM = `(() => {
  const canvas = document.getElementById('board');
  const panel = document.getElementById('boardpanel');
  const cr = canvas.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  const scale = Math.min(cr.width / ${SCREEN_W}, cr.height / ${SCREEN_H});
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    canvas: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom, w: cr.width, h: cr.height },
    panel: { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom, w: pr.width, h: pr.height },
    stageScale: scale,
    overlap: Math.min(cr.right, pr.right) - Math.max(cr.left, pr.left) > 0.5 &&
             Math.min(cr.bottom, pr.bottom) - Math.max(cr.top, pr.top) > 0.5,
    scrollY: window.scrollY,
    scrollH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    hidden: panel.hidden,
    collapsed: panel.classList.contains('collapsed'),
    tabLabel: document.getElementById('boardtab').textContent,
    idCount: document.querySelectorAll('#boardpanel').length,
  };
})()`;

function geometryChecks(tag, g, opts) {
  const inside = (r) => r.left >= -0.5 && r.top >= -0.5 && r.right <= g.vw + 0.5 && r.bottom <= g.vh + 0.5;
  check(`${tag} 画布整块在视口里`, inside(g.canvas), JSON.stringify(g.canvas));
  check(`${tag} 画布与面板不重叠（面板是挤窄舞台的兄弟项，不是浮层）`, !g.overlap, `panel.right=${g.panel.right} canvas.left=${g.canvas.left}`);
  check(`${tag} 舞台放大倍数够大（${g.stageScale.toFixed(2)}×）`, g.stageScale >= (opts.minScale ?? 1), `scale=${g.stageScale.toFixed(3)}`);
  check(`${tag} 页面没有可滚的高度`, g.scrollH - g.scrollY <= g.vh + 2 && g.scrollY === 0, `scrollY=${g.scrollY} scrollH=${g.scrollH} vh=${g.vh}`);
}

/** 画布上取 5 个点（正中 + 四边内缩 20px）：`elementFromPoint` 必须都判给画布 */
async function hitPoints(page) {
  return page.evaluate(
    ([w, h]) => {
      const cr = document.getElementById('board').getBoundingClientRect();
      const pts = [
        [cr.left + cr.width / 2, cr.top + cr.height / 2],
        [cr.left + 20, cr.top + cr.height / 2],
        [cr.right - 20, cr.top + cr.height / 2],
        [cr.left + cr.width / 2, cr.top + 20],
        [cr.left + cr.width / 2, cr.bottom - 20],
      ];
      return pts.map(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return { x: Math.round(x), y: Math.round(y), id: el === null ? '(null)' : el.id || el.tagName };
      });
    },
    [SCREEN_W, SCREEN_H],
  );
}

/** 在画布正中真的点一下，看画布收不收得到 `mousedown`（面板有没有把事件截走） */
async function canvasAcceptsClick(page) {
  await page.evaluate(() => {
    const c = document.getElementById('board');
    window.__boardHits = 0;
    c.addEventListener('mousedown', () => (window.__boardHits += 1), true);
  });
  const box = await page.locator('#board').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return page.evaluate(() => window.__boardHits);
}

/**
 * 触屏：真的点一下（`touchstart` 到画布 ⇒ `touch-input.ts` 派回合成的 mousedown/mouseup/click）。
 * 面板要是把触摸截走了，这两个计数就都是 0。
 */
async function canvasAcceptsTap(page) {
  await page.evaluate(() => {
    const c = document.getElementById('board');
    window.__boardTouches = 0;
    window.__boardSynth = 0;
    c.addEventListener('touchstart', () => (window.__boardTouches += 1), true);
    c.addEventListener('mousedown', () => (window.__boardSynth += 1), true);
  });
  const box = await page.locator('#board').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  return page.evaluate(() => ({ touches: window.__boardTouches, synth: window.__boardSynth }));
}

async function waitForPanel(page) {
  await page.waitForSelector('#boardpanel:not([hidden])', { timeout: 180000 });
}

/**
 * 门厅（`#foyer`，`position: fixed; inset: 0; z-index: 50`）是进站的第一屏 ——
 * 它盖着整页（包括佈告欄），所以「画布吃不吃得到点击」必须**先进游戏**再量。
 */
async function enterGame(page) {
  await page.waitForSelector('#foyer', { timeout: 180000 });
  await page.fill('#foyer-name', 'pw-board');
  await page.click('#foyer-solo');
  await page.waitForSelector('#foyer', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(500);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });

  // ── ① 桌面 ────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?mute=1`, { waitUntil: 'domcontentloaded' });
    await waitForPanel(page);
    await enterGame(page);

    const g = await page.evaluate(GEOM);
    geometryChecks('[桌面]', g, { minScale: 1.6 });
    check('[桌面] 面板默认**展开**（宽屏）', g.collapsed === false && g.panel.w > 100, `collapsed=${g.collapsed} w=${g.panel.w}`);
    check('[桌面] 细籤此时是「收起」', g.tabLabel === '收起', `label=${g.tabLabel}`);

    const pts = await hitPoints(page);
    check(
      '[桌面] 画布正中 + 四边：elementFromPoint 都判给画布',
      pts.every((p) => p.id === 'board'),
      JSON.stringify(pts),
    );
    const hits = await canvasAcceptsClick(page);
    check('[桌面] 真的点下去，画布收得到 mousedown', hits >= 1, `hits=${hits}`);

    // 公告 / 亮点 / 更新日誌 都在，且日誌默认收起
    const content = await page.evaluate(() => {
      const el = document.getElementById('boardannouncement');
      const kids = [...el.children];
      const last = kids[kids.length - 1];
      return {
        announcement: (() => {
          return {
            text: el.textContent ?? '',
            paras: kids.map((c) => ({ tag: c.tagName, cls: c.className, text: c.textContent })),
            tags: [...el.querySelectorAll('*')].map((n) => n.tagName),
            lastAlign: last === undefined ? '' : getComputedStyle(last).textAlign,
          };
        })(),
        announcedAt: document.getElementById('boardannouncedate').textContent ?? '',
        highlights: [...document.querySelectorAll('#boardhighlights li')].map((li) => li.textContent),
        days: document.querySelectorAll('#boardchangelog .boardday').length,
        items: document.querySelectorAll('#boardchangelog .boardday li').length,
        logOpen: document.getElementById('boardlog').open,
        // 公告那一段有没有被面板**撑破**：滚动区必须真的在滚，面板本身不许高过视口
        bodyScroll: (() => {
          const b = document.getElementById('boardbody');
          return { h: b.clientHeight, scrollH: b.scrollHeight };
        })(),
      };
    });
    const ann = content.announcement;
    check('[桌面] 公告有字', ann.text.length > 10, `${ann.text.length} 字`);
    check('[桌面] 公告带更新日期', /^\d{4}-\d{2}-\d{2}$/.test(content.announcedAt.replace('公告更新：', '')), content.announcedAt);
    check('[桌面] 亮点 ≥ 2 条', content.highlights.length >= 2, `${content.highlights.length} 条`);
    check('[桌面] 自动更新日誌有分组与条目', content.days >= 1 && content.items >= 1, `${content.days} 天 / ${content.items} 条`);
    check('[桌面] 更新日誌默认**收起**', content.logOpen === false);
    check('[桌面] ★ 公告按空行分段（≥ 3 段），只有 <p>', ann.paras.length >= 3 && ann.tags.every((t) => t === 'P'), ann.paras.map((p) => p.cls).join(','));
    check(
      '[桌面] ★ 落款单独一段、右对齐、弱化（不是正文）',
      ann.paras[ann.paras.length - 1]?.cls === 'boardsig' &&
        ann.paras[ann.paras.length - 1]?.text.startsWith('—') &&
        ann.lastAlign === 'right',
      `${ann.paras[ann.paras.length - 1]?.text} / ${ann.lastAlign}`,
    );
    check(
      '[桌面] ★ 公告一个字都没被当成 HTML（段内不含尖括号）',
      ann.paras.every((p) => !p.text.includes('<') && !p.text.includes('>')),
      ann.text.slice(0, 40),
    );
    check(
      '[桌面] 公告在面板里换行、必要时滚动（不裁切）',
      content.bodyScroll.h > 0 && content.bodyScroll.scrollH >= content.bodyScroll.h,
      JSON.stringify(content.bodyScroll),
    );
    check('[桌面] 页面没有 JS 异常', errors.length === 0, errors.join(' | '));

    if (SHOTS) await page.screenshot({ path: `${OUT}/desktop-1440x900.png` });

    // 收起 → 画布变宽；再展开 → 变回来。两次都整块可见、都能点。
    await page.click('#boardtab');
    await page.waitForTimeout(150);
    const gc = await page.evaluate(GEOM);
    check('[桌面] 收起后仍整块可见且不重叠', gc.canvas.w > g.canvas.w && !gc.overlap, `canvas ${g.canvas.w} → ${gc.canvas.w}`);
    check('[桌面] 收起后画布照收点击', (await canvasAcceptsClick(page)) >= 1);
    await page.click('#boardtab');
    await page.waitForTimeout(150);
    const ge = await page.evaluate(GEOM);
    check('[桌面] 展开回来（画布变窄回去）', Math.abs(ge.canvas.w - g.canvas.w) < 1, `${ge.canvas.w}`);
    await ctx.close();
  }

  // ── ② 窄窗 640×480（面板会把游戏区吃掉一半，所以默认也收起）──
  {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?mute=1`, { waitUntil: 'domcontentloaded' });
    await waitForPanel(page);
    await enterGame(page);

    const g = await page.evaluate(GEOM);
    geometryChecks('[640×480]', g, { minScale: 0.9 });
    check('[640×480] ★ 窄窗默认**收起**（否则游戏区只剩一半）', g.collapsed === true, `collapsed=${g.collapsed}`);
    check('[640×480] 只剩一条细籤（≤ 32px）', g.panel.w <= 32, `w=${g.panel.w}`);
    const pts = await hitPoints(page);
    check('[640×480] 画布正中 + 四边都判给画布', pts.every((p) => p.id === 'board'), JSON.stringify(pts));
    check('[640×480] 画布照收点击', (await canvasAcceptsClick(page)) >= 1);

    // 硬要展开：游戏区被挤窄，但画布仍整块可见、仍可点、页面仍不可滚
    await page.click('#boardtab');
    await page.waitForTimeout(200);
    const ge = await page.evaluate(GEOM);
    check('[640×480] 展开后画布仍整块可见且不重叠', !ge.overlap && ge.canvas.w < g.canvas.w, `canvas ${g.canvas.w} → ${ge.canvas.w}`);
    check('[640×480] 展开后画布照收点击', (await canvasAcceptsClick(page)) >= 1);
    check('[640×480] 页面仍然不可滚', ge.scrollY === 0 && ge.scrollH <= ge.vh + 2, `scrollH=${ge.scrollH} vh=${ge.vh}`);
    check('[640×480] 页面没有 JS 异常', errors.length === 0, errors.join(' | '));
    if (SHOTS) await page.screenshot({ path: `${OUT}/window-640x480.png` });
    await ctx.close();
  }

  // ── ③ iPhone 13 横屏 ──────────────────────────────────────
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?mute=1`, { waitUntil: 'domcontentloaded' });
    await waitForPanel(page);
    await enterGame(page);

    const g = await page.evaluate(GEOM);
    geometryChecks('[iPhone 横屏]', g, { minScale: 0.7 });
    check('[iPhone 横屏] ★ 面板默认**收起**', g.collapsed === true, `collapsed=${g.collapsed}`);
    check('[iPhone 横屏] 只剩一条细籤（≤ 32px）', g.panel.w <= 32, `w=${g.panel.w}`);
    check('[iPhone 横屏] 细籤上写着「公告」（新公告看得见）', g.tabLabel === '公告', `label=${g.tabLabel}`);

    const pts = await hitPoints(page);
    check('[iPhone 横屏] 画布正中 + 四边都判给画布', pts.every((p) => p.id === 'board'), JSON.stringify(pts));
    const tap = await canvasAcceptsTap(page);
    check(
      '[iPhone 横屏] 真的点一下：touchstart 到画布，且合成出 mousedown',
      tap.touches >= 1 && tap.synth >= 1,
      JSON.stringify(tap),
    );
    check('[iPhone 横屏] 点完页面仍然不可滚', (await page.evaluate(() => window.scrollY)) === 0);

    if (SHOTS) await page.screenshot({ path: `${OUT}/iphone13-landscape.png` });

    // 点细籤展开：面板让出宽度，画布跟着变窄，但仍然整块可见 + 能点
    await page.tap('#boardtab');
    await page.waitForTimeout(200);
    const ge = await page.evaluate(GEOM);
    check('[iPhone 横屏] 点细籤能展开', ge.collapsed === false && ge.panel.w > 100, `w=${ge.panel.w}`);
    check('[iPhone 横屏] 展开后画布仍整块可见且不重叠', !ge.overlap && ge.canvas.right <= ge.vw + 0.5, `canvas.w=${ge.canvas.w}`);
    check('[iPhone 横屏] 展开后画布照收点击', (await canvasAcceptsClick(page)) >= 1);
    check('[iPhone 横屏] 页面仍然不可滚', ge.scrollY === 0 && ge.scrollH <= ge.vh + 2, `scrollH=${ge.scrollH} vh=${ge.vh}`);
    check(
      '[iPhone 横屏] 面板没被长公告撑破（高度 = 视口，内容自己滚）',
      ge.panel.h <= ge.vh + 0.5 && ge.panel.bottom <= ge.vh + 0.5,
      `panel.h=${ge.panel.h} vh=${ge.vh}`,
    );
    const scroll = await page.evaluate(() => {
      const b = document.getElementById('boardbody');
      return { h: b.clientHeight, scrollH: b.scrollHeight };
    });
    check(
      '[iPhone 横屏] 公告 + 日誌在面板里滚得动（不是被裁掉）',
      scroll.scrollH > scroll.h && scroll.h > 100,
      JSON.stringify(scroll),
    );
    check('[iPhone 横屏] 页面没有 JS 异常', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ── ④ `/board.json` 404（线上还没生成 / 传丢了）────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route('**/board.json', (route) => route.fulfill({ status: 404, body: 'Not Found' }));
    await page.goto(`${BASE}?mute=1`, { waitUntil: 'domcontentloaded' });
    await enterGame(page);
    // 反向等：游戏起来了之后，面板仍然不该出现
    await page.waitForTimeout(2000);
    const g = await page.evaluate(GEOM);
    check('★ [无 board.json] 面板一直不出现', g.hidden === true, `hidden=${g.hidden}`);
    check('★ [无 board.json] 画布整块可见且与面板不重叠', !g.overlap && g.canvas.w > 1000, `w=${g.canvas.w}`);
    const hits = await canvasAcceptsClick(page);
    check('★ [无 board.json] 游戏照收点击', hits >= 1, `hits=${hits}`);
    check('★ [无 board.json] 页面不可滚', g.scrollY === 0 && g.scrollH <= g.vh + 2);
    if (SHOTS) await page.screenshot({ path: `${OUT}/no-board-json.png` });
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length > 0) {
    console.log('失败：');
    for (const f of failed) console.log(`  ✖ ${f.name} —— ${f.detail}`);
    process.exitCode = 1;
  }
}

await main();
