/*
 * 全屏幕截图扫描（W-12，回归用）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 把**每一屏 × 8 张地图**各钉住截一张，配一页缩略图墙（`index.html`），
 * 供首席/需求方一眼扫过找明显画错的；同时收集每屏的 console error。
 *
 * ★ 2026-09-19：本文件原来装的是「重交互格扫描」，那一份原样搬到
 *   `tools/sweep-squares.js`（逻辑一行没改）；本文件改成整屏截图扫描。
 *
 * 用法（★ 与 soak 同一套：必须 `browse eval <file>`，`browse js "$(cat …)"` 多行会炸）：
 *
 *   1) pnpm dev
 *   2) 一键扫完（推荐）：
 *        bash tools/sweep-screens.sh
 *      它自己会：每张图 goto 一次带 `?screen=game&humans=1&ai=3&seed=7&chars=0,3,5,7&map=N`，
 *      逐屏设 `globalThis.__swTarget` → `browse eval tools/sweep-screens.js` → `browse screenshot`。
 *   3) 手工单屏：
 *        $B js "globalThis.__swTarget='magic'"
 *        $B eval /tmp/sweep-screens.js
 *        $B screenshot .qa-tmp/sweep/one.png
 *
 * 本文件的返回（browse eval 会把这行字符串打出来，驱动脚本原样记进 summary.tsv）：
 *   `{"ok":true,"kind":"base","target":"stock","screen":"stock"}` —— 成功钉住
 *   `{"ok":false,...}` —— 打不开（例如这一屏要更深的状态构造），驱动脚本会记下来
 *
 * ★ 哪些屏打不开、为什么，`RECIPES` 里逐条写明；**打不开就如实标出来，不许拿别的屏顶替**。
 */
(() => {
  const r = globalThis.__rich4;
  const target = globalThis.__swTarget;
  if (!r || !r.state) return JSON.stringify({ ok: false, reason: 'no __rich4（页面没起或不是 DEV 构建）' });
  if (typeof target !== 'string' || target === '') {
    return JSON.stringify({ ok: false, reason: '没设 globalThis.__swTarget' });
  }

  /** main.ts:3545 的 `Screen` 联合类型 —— 这些屏 `goto` 就能直达 */
  const BASE = [
    'title', 'setup', 'options', 'saveload', 'lobby', 'aiSettings',
    'intro', 'assets', 'inventory', 'stock', 'game',
  ];

  /** `packages/core/src/loaders/map.ts` 的 `SPECIAL_KIND` */
  const K = {
    PARK: 1, NEWS: 2, FORTUNE: 3, PRISON: 4, HOSPITAL: 5,
    PENGUIN_DIG: 6, BALLOON: 7, GIFT_FROM_SKY: 8, LOTTERY: 9,
    CARD: 13, BANK: 14, DEPARTMENT_STORE: 15, MAGIC_HOUSE: 16,
  };

  /** 当前地图上第一个指定类型的特殊格节点号（没有返回 null） */
  const nodeOf = (...kinds) => {
    const spec = r.specials();
    for (const k of kinds) {
      for (const [node, kind] of Object.entries(spec)) if (kind === k) return Number(node);
    }
    return null;
  };

  /**
   * 走 `tools/sweep-squares.js` 那一套**已有的**做法把玩家挪到某格并结算：
   * 直接摆相位 + `__rich4.warp()`（warp 走的是引擎的傳送機规则，不是后门），
   * 只为让落点那屏**停在屏幕上**好截图。
   */
  const land = (...kinds) => {
    const node = nodeOf(...kinds);
    if (node === null) return false;
    try {
      const s = r.state;
      s.pending = null;
      s.currentPlayer = 0;
      s.phase = 'settling';
      r.goto('game');
      r.warp(node);
      r.dispatch({ type: 'settle' });
      return true;
    } catch {
      return false;
    }
  };

  const key = (keyCode, code, k) => {
    const c = document.querySelector('canvas');
    if (c === null) return false;
    c.dispatchEvent(new KeyboardEvent('keydown', { code, key: k, keyCode, which: keyCode, bubbles: true }));
    return true;
  };

  /**
   * 每一屏的「怎么打开」。表里没有的屏 = 本工具打不开（要更深的状态构造），
   * 驱动脚本会把它记成 `no-recipe`，**不会**用别的屏顶替。
   */
  const RECIPES = {
    // ── 用现成调试出口/工具列就能开的 ──
    help: () => { r.goto('game'); r.toolbar(0); },                       // 工具列 #1 遊戲百科
    aiSettings: () => { r.goto('game'); r.toolbar(2); },                 // #3 託管AI
    inventory: () => { r.goto('game'); r.toolbar(7); },                  // #8 道具欄
    bigMap: () => { r.goto('game'); key(0x4d, 'KeyM', 'm'); },           // 熱鍵 M
    magic: () => { r.goto('game'); r.magicHouse(); },                    // 引擎钩子：直达魔法屋

    // ── 落点类：把玩家挪过去再结算 ──
    lottery: () => land(K.LOTTERY),
    minigame: () => land(K.PENGUIN_DIG, K.BALLOON, K.GIFT_FROM_SKY),
    eventBox: () => land(K.NEWS, K.FORTUNE, K.CARD),
    shop: () => land(K.DEPARTMENT_STORE),
    bank: () => land(K.BANK),
    bail: () => land(K.PRISON, K.HOSPITAL),

    // ── 本工具打不开的（要在下面写明原因；驱动脚本按 no-recipe 记）──
    // auction / shares / monthly / lotteryDraw / godSlot / wheel / research /
    // facilityPicker / stealPicker / board：
    //   要「竞拍进行到某一口」「跨到 15 日」「月结那一拍」「神明附身」「旅馆转盘」
    //   「研究所选项目」「盖等级 0 设施时选种类」「搶奪卡拾取」「棋盘子窗口ui.open」
    //   这些**中间态**，现有 `__rich4` 出口都没有直接构造它们的口子（`land()` 只能
    //   造「落点结算」这一种）。加钩子属于改产品代码，留给下一轮按需做；
    //   这一轮**如实标为未截**。
  };

  const flush = () => {
    try { r.dispatch({ type: 'declineDecision' }); } catch { /* 没有待决交互就无所谓 */ }
  };

  try {
    if (BASE.includes(target)) {
      flush();
      r.goto(target);
      return JSON.stringify({ ok: true, kind: 'base', target, screen: r.screen });
    }
    const recipe = RECIPES[target];
    if (recipe === undefined) {
      return JSON.stringify({ ok: false, kind: 'overlay', target, reason: 'no-recipe（本工具没有打开这一屏的出口）' });
    }
    flush();
    const ret = recipe();
    if (ret === false) {
      return JSON.stringify({ ok: false, kind: 'overlay', target, reason: 'open-failed（这一屏要的落点/状态在地图上找不到）' });
    }
    return JSON.stringify({
      ok: true,
      kind: 'overlay',
      target,
      screen: r.screen,
      pending: r.state.pending?.kind ?? null,
    });
  } catch (e) {
    return JSON.stringify({ ok: false, target, reason: 'exception: ' + String(e).slice(0, 160) });
  }
})()
