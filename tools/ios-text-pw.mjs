/*
 * A-1 验收：iPhone Safari「输入文字后画面显示不全」（第二十七份試玩回報）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回报 `feedback/20260925-030128992-manual-Charles.json`（联机第 36 回合，UA iPhone OS 18_7 Safari）。
 * 症状：在**文字框**里打完字，舞台只剩放大后的一角（回报截图是画布自己，所以看不出问题）。
 *
 * 桌面 WebKit **不复现** iOS 的「聚焦 <16px 文字框自动放大」—— 那是 iOS Safari 独有的行为，
 * 引擎里没有。所以这个脚本量的是**能与不能复现之间那条界线**：
 *   ① 根因那一层：所有文字框的计算字号 ≥ 16px（iOS 才不放大）；
 *   ② 页面那一层：真实 WebKit 里开框 / 打字 / 关框走完，画布矩形、body 矩形、
 *      `visualViewport` 三者关系与进框前**一模一样**，且文档没有被卷走（scrollX/Y = 0）；
 *   ③ 可视区真的变了（软键盘 / 地址栏 / 转向都走 `visualViewport` resize）时，
 *      舞台按新的可视区重钉，变回去以后又**逐像素**回到原样。
 * iOS 独有的自动放大 / 键盘卷动，由 `viewport.test.ts` 的模拟夹具逐个场景守着（那边是假 vv）。
 *
 * 四个场景 —— 前两个就是回报里那条路（需求方是在备注框里打完字、按「送出」才把这份回报交上来的）：
 *   场景 1  棋盘上的一键回报框：点开 → 打字 → **取消**；
 *   场景 1b 同上，但按 **送出**（真的走一遍 `fileReport`）；
 *   场景 2  门厅的昵称框：聚焦 → 打字 → 失焦；
 *   场景 3  可视区真的伸缩一次（软键盘 / 地址栏 / 转向都走 `visualViewport` resize）。
 *
 * 用法（先起自己的 Vite，端口别撞别的会话）：
 *   pnpm --filter @rich4/client dev --port 5411 --strictPort
 *   VITE=5411 node tools/ios-text-pw.mjs
 *
 * 每个场景打一条 before / after 读数 + 断言结果；任何一条断言不成立 ⇒ 退出码 1。
 */
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/.agents/skills/gstack`}/package.json`);
const { webkit, devices } = require('playwright');

const VITE = process.env.VITE ?? '5411';
const BASE = `http://127.0.0.1:${VITE}`;
/** 上一轮装到本机的 WebKit（playwright 1.58 期望的 2248 已被清掉，2272 在同一条协议上能用）*/
const EXE = process.env.WEBKIT_EXE ?? `${process.env.HOME}/Library/Caches/ms-playwright/webkit-2272/pw_run.sh`;

/** 失焦后收拾的四个时刻是 0/120/350/700ms（`viewport.ts` 的 SETTLE_DELAYS_MS）—— 多等一点 */
const SETTLE_MS = 1100;

const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name} —— ${detail}`);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail === undefined ? '' : `: ${detail}`}`);
}

/** 页面此刻的「看得见的东西」全量读数 —— 断言全在这几项上 */
const PROBE = `(() => {
  const r = (el) => {
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(3), y: +b.y.toFixed(3), w: +b.width.toFixed(3), h: +b.height.toFixed(3) };
  };
  const vv = window.visualViewport;
  return {
    canvas: r(document.getElementById('board')),
    body: r(document.body),
    vv: vv === null || vv === undefined ? null : {
      w: +vv.width.toFixed(3), h: +vv.height.toFixed(3),
      scale: +vv.scale.toFixed(4), top: +vv.offsetTop.toFixed(3), left: +vv.offsetLeft.toFixed(3),
    },
    win: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    scroll: { x: window.scrollX, y: window.scrollY },
    fonts: {
      feedbacknote: document.getElementById('feedbacknote') === null
        ? null : getComputedStyle(document.getElementById('feedbacknote')).fontSize,
      nickname: (() => {
        const i = document.querySelector('input[type=text], input:not([type])');
        return i === null ? null : getComputedStyle(i).fontSize;
      })(),
    },
    meta: document.querySelector('meta[name=viewport]')?.content ?? null,
  };
})()`;

const probe = (page) => page.evaluate(PROBE);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 断言「与进框前的关系一致」：画布 / body 矩形 + 可视区 + 没有页面滚动 */
function checkRestored(label, before, after) {
  check(`${label}：画布矩形回到进框前`, same(before.canvas, after.canvas), `${JSON.stringify(before.canvas)} → ${JSON.stringify(after.canvas)}`);
  check(`${label}：body 矩形回到进框前`, same(before.body, after.body), `${JSON.stringify(before.body)} → ${JSON.stringify(after.body)}`);
  check(`${label}：visualViewport 与进框前一致`, same(before.vv, after.vv), `${JSON.stringify(before.vv)} → ${JSON.stringify(after.vv)}`);
  check(`${label}：页面没有被卷走`, after.scroll.x === 0 && after.scroll.y === 0, JSON.stringify(after.scroll));
}

const browser = await webkit.launch({ headless: true, executablePath: EXE });
const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const errors = [];
const newPage = async () => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  // 开发服务器没有 `POST /api/feedback` ⇒ `fileReport` 退回「下载一份 json」。
  // 收下就丢掉（别往盘上落文件），页面本身不该因此跳走。
  p.on('download', (d) => void d.cancel().catch(() => {}));
  return p;
};

// ── 场景 1：棋盘上的一键回报框（回报当时就在这个框里打字）────────────────────
{
  const page = await newPage();
  // `?screen=game` 直接开局；`mute=1` = 静音（需求方在前台干别的事）
  await page.goto(`${BASE}/?screen=game&mute=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 侧栏出现「回合」才说明这一局真的起来了（画布元素一直都有，不算数）
  await page.waitForFunction(() => document.getElementById('meta')?.textContent?.includes('回合') === true, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  const before = await probe(page);
  console.log('场景 1（棋盘 · 回报备注框）before', JSON.stringify(before));
  check('回报备注框计算字号 ≥ 16px', parseFloat(before.fonts.feedbacknote) >= 16, before.fonts.feedbacknote);
  check('iOS UA 下 meta viewport 常驻 maximum-scale=1', before.meta?.includes('maximum-scale=1') === true, String(before.meta));
  check('进框前没有页面滚动', before.scroll.x === 0 && before.scroll.y === 0, JSON.stringify(before.scroll));
  check('进框前画布铺满可视区', same(before.canvas, { x: 0, y: 0, w: before.vv.w, h: before.vv.h }), `${JSON.stringify(before.canvas)} vs vv ${before.vv.w}×${before.vv.h}`);

  // 打开面板（`#feedback` 的 click 处理里就直接 focus 了 textarea）+ 打字
  await page.click('#feedback');
  const typing = await probe(page);
  check('打字中面板可见、焦点在备注框', await page.evaluate(() => document.activeElement?.id === 'feedbacknote'));
  await page.type('#feedbacknote', '输入文字后画面显示不全');
  check('打字中画布没有被改尺寸', same(typing.canvas, before.canvas), JSON.stringify(typing.canvas));

  // 关闭（取消）—— 真机上这一步键盘收起，iOS 在 0/120/350/700ms 各收拾一次
  await page.click('#feedbackcancel');
  await page.waitForTimeout(SETTLE_MS);
  const after = await probe(page);
  console.log('场景 1 after', JSON.stringify(after));
  checkRestored('场景 1', before, after);

  // ── 场景 1b：同一条路，但按「送出」（需求方就是这么交上这份回报的）──────────
  //    `#feedbackpanel` 是 `hidden = true` 收起来的，收起时 textarea 会**失焦**
  //    （webkit / chromium 都发 `blur` + `focusout`，已单独核过）⇒ 收拾照样触发。
  await page.click('#feedback');
  await page.type('#feedbacknote', '再按一次送出');
  await page.click('#feedbacksend');
  await page.waitForTimeout(SETTLE_MS);
  const afterSend = await probe(page);
  console.log('场景 1b after', JSON.stringify(afterSend));
  check('送出后备注框已清空、面板已收起',
    await page.evaluate(() => document.getElementById('feedbackpanel').hidden === true
      && document.getElementById('feedbacknote').value === ''));
  check('送出后没有跳出这个页面（开发服务器退回下载，不导航）',
    page.url().startsWith(BASE), page.url());
  checkRestored('场景 1b', before, afterSend);
  await page.close();
}

// ── 场景 2：门厅的昵称框（另一个可疑触发点）───────────────────────────────
{
  const page = await newPage();
  await page.goto(`${BASE}/?mute=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type=text], input:not([type])', { timeout: 30000 });
  await page.waitForTimeout(400);

  const before = await probe(page);
  console.log('场景 2（门厅 · 昵称框）before', JSON.stringify(before));
  check('昵称框计算字号 ≥ 16px', parseFloat(before.fonts.nickname) >= 16, before.fonts.nickname);

  const nick = 'input[type=text], input:not([type])';
  await page.click(nick);
  await page.type(nick, 'Charles');
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(SETTLE_MS);
  const after = await probe(page);
  console.log('场景 2 after', JSON.stringify(after));
  checkRestored('场景 2', before, after);
  await page.close();
}

// ── 场景 3：可视区真的变了又变回来（软键盘 / 地址栏 / 转向都走这条）──────────
//    桌面 WebKit 起不了真的软键盘，改**真的**改窗口：`visualViewport` 随之 resize，
//    与 iOS 键盘升起/收起走的是同一条 `installViewportFit` → `requestRender` 路径。
{
  const page = await newPage();
  await page.goto(`${BASE}/?screen=game&mute=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('meta')?.textContent?.includes('回合') === true, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  const before = await probe(page);
  // 键盘升起：可视区变矮（iPhone 13 横屏键盘大约吃掉一半）
  await page.setViewportSize({ width: before.win.w, height: Math.round(before.win.h * 0.55) });
  await page.waitForTimeout(300);
  const shrunk = await probe(page);
  check('可视区变矮 ⇒ 画布跟着铺满新的可视区',
    same(shrunk.canvas, { x: 0, y: 0, w: shrunk.vv.w, h: shrunk.vv.h }),
    `${JSON.stringify(shrunk.canvas)} vs vv ${shrunk.vv.w}×${shrunk.vv.h}`);
  check('可视区变矮 ⇒ 舞台按新可视区重算（比例变了）',
    Math.abs(shrunk.canvas.h / before.canvas.h - 0.55) < 0.02,
    `${before.canvas.h} → ${shrunk.canvas.h}`);

  // 键盘收起
  await page.setViewportSize({ width: before.win.w, height: before.win.h });
  await page.waitForTimeout(SETTLE_MS);
  const after = await probe(page);
  console.log('场景 3（可视区伸缩）before/after', JSON.stringify(before.canvas), JSON.stringify(after.canvas));
  checkRestored('场景 3', before, after);
  await page.close();
}

check('全程没有未捕获的页面错误', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(`\n${failures.length === 0 ? '全部通过' : `${failures.length} 条不通过`}`);
for (const f of failures) console.log(`  ✘ ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
