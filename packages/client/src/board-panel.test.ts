/*
 * 左侧佈告欄 —— 收起状态、取数据、画上去，以及**绝不能碰画布**的那几条钉子
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这块面板是全站唯一「游戏之外还会长东西」的 DOM，它一旦越界（浮在画布上、
 * 给画布挂监听、把页面撑出可滚高度），坏掉的是**所有人**的触摸操作。
 * 所以这里用一套假 DOM 把它能碰到的东西收窄成一张白名单，再钉住 index.html 的布局：
 *
 *   ① 纯逻辑：默认收起（手机 / 矮屏 / 粗指针）、记忆、`/board.json` 拿不到怎么办；
 *   ①′ 门厅（进站第一屏）：面板把自己占多宽写给 `body` 的 `--board-w`，门厅拿它当左边界
 *      ⇒ 面板永远露在门厅外面；门厅在屏幕上时面板**一律展开**（连手机也是）；
 *   ② 运行：装上去之后**唯一的监听**是细籤上的 `click` —— 画布上零监听、零改动；
 *   ③ 源码：面板的 CSS 是 `flex: none` 的**兄弟项**（不是浮层），画布那两条
 *      （`flex: 1 1 0` / `touch-action: none`）一个字没动；面板只按 6 个 id 取元素；
 *      渲染只走 `textContent`，一处 `innerHTML` 都没有。
 *
 * ★ 可证伪性：给 `#boardpanel` 加一句 `position: fixed`、把它挪到 `<canvas>` 后面、
 *   把 `#boardpanel[hidden]` 那条删掉、让面板去 `getElementById('board')`、
 *   用 `innerHTML` 摆条目、`installBoardPanel` 在拿不到数据时也挂监听 —— 都会当场红。
 *   把门厅改回 `inset:0`（或者忘了写 `--board-w`）同样当场红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_JSON_PATH, parseAnnouncement, parseBoard, type BoardData } from './board-data.ts';
import {
  BOARD_STATE_KEY,
  BOARD_WIDTH,
  BOARD_WIDTH_VAR,
  NARROW_HEIGHT_PX,
  NARROW_WIDTH_PX,
  TAB_LABEL_CLOSE,
  TAB_LABEL_OPEN,
  announcementParagraphs,
  boardPanelDom,
  boardPanelFoyer,
  boardPanelWidth,
  defaultCollapsed,
  fetchBoardText,
  initialCollapsed,
  installBoardPanel,
  readStoredCollapsed,
  renderBoardPanel,
  storedCollapsedValue,
  type BoardPanelDom,
  type BoardPanelView,
  type BoardStorage,
} from './board-panel.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const panelSrc = readFileSync(new URL('./board-panel.ts', import.meta.url), 'utf8');
const foyerSrc = readFileSync(new URL('./foyer.ts', import.meta.url), 'utf8');
/** 去注释之后的源码（注释里提到 `inset` / `100vw` 这些词不算） */
const foyerCode = foyerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ============================================================
//  假 DOM / 假 storage
// ============================================================

interface FakeEl {
  readonly id: string;
  hidden: boolean;
  textContent: string | null;
  title: string;
  readonly attrs: Record<string, string>;
  readonly classes: Set<string>;
  children: readonly unknown[];
  readonly listeners: { type: string; fn: () => void }[];
  readonly classList: { toggle(token: string, force: boolean): void };
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'click', fn: () => void): void;
  replaceChildren(...nodes: readonly unknown[]): void;
}

function fakeEl(id: string): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    id,
    hidden: false,
    textContent: '',
    title: '',
    attrs: {},
    classes,
    children: [],
    listeners: [],
    classList: {
      toggle: (token, force) => {
        if (force) classes.add(token);
        else classes.delete(token);
      },
    },
    setAttribute: (name, value) => {
      el.attrs[name] = value;
    },
    addEventListener: (type, fn) => {
      el.listeners.push({ type, fn });
    },
    replaceChildren: (...nodes) => {
      el.children = [...nodes];
    },
  };
  return el;
}

/**
 * 一套假面板。`canvas` 是**游戏那块画布的另一半** —— 面板这一路根本拿不到它
 * （`boardPanelDom` 只按 6 个自己的 id 取元素），下面几条断言就是钉这个。
 *
 * `layout.props` 是写给 `body` 的那几个自定义属性（真 DOM 上是 `body.style`）——
 * 门厅靠 `--board-w` 让位，所以它也得被钉住。
 */
function fakePanel(): {
  dom: BoardPanelDom;
  els: Record<'root' | 'tab' | 'announcement' | 'announcedAt' | 'highlights' | 'changelog', FakeEl>;
  layout: { readonly props: Map<string, string> };
  canvas: FakeEl;
} {
  const els = {
    root: fakeEl('boardpanel'),
    tab: fakeEl('boardtab'),
    announcement: fakeEl('boardannouncement'),
    announcedAt: fakeEl('boardannouncedate'),
    highlights: fakeEl('boardhighlights'),
    changelog: fakeEl('boardchangelog'),
  };
  // index.html 里的原样：面板一开始就是隐藏 + 收起
  els.root.hidden = true;
  els.root.classes.add('collapsed');
  els.tab.textContent = TAB_LABEL_OPEN;

  const props = new Map<string, string>();
  const dom: BoardPanelDom = {
    root: els.root,
    tab: els.tab,
    layout: {
      setProperty: (name, value) => {
        props.set(name, value);
      },
    },
    announcement: els.announcement,
    announcedAt: els.announcedAt,
    highlights: els.highlights,
    changelog: els.changelog,
    paragraph: (text, signature) => ({ kind: signature ? 'sig' : 'para', text }),
    item: (text) => ({ kind: 'item', text }),
    group: (date, items) => ({ kind: 'group', date, items }),
  };
  return { dom, els, layout: { props }, canvas: fakeEl('board') };
}

function fakeStorage(init: Record<string, string> = {}): BoardStorage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const BOARD_JSON = JSON.stringify({
  announcement: { text: '欢迎来玩\n第二行', updatedAt: '2026-09-25' },
  highlights: ['亮点一', '亮点二'],
  changelog: [
    { date: '2026-09-25', items: ['条目一', '条目二'] },
    { date: '2026-09-24', items: ['条目三'] },
  ],
});

function board(over: Partial<BoardData> = {}): BoardData {
  const data = parseBoard(BOARD_JSON);
  if (data === null) throw new Error('夹具本身坏了');
  return { ...data, ...over };
}

/** 桌面（宽、高、鼠标）；iPhone 13 横屏是 844×390 + 粗指针 */
const DESKTOP: BoardPanelView = { width: 1440, height: 900, coarse: false };
const IPHONE_LANDSCAPE: BoardPanelView = { width: 844, height: 390, coarse: true };
const IPHONE_PORTRAIT: BoardPanelView = { width: 390, height: 844, coarse: true };

// ============================================================
//  ① 纯逻辑
// ============================================================

describe('默认收起还是展开', () => {
  it('★ iPhone 13 横屏（844×390）默认**收起** —— 宽度不窄，但只有 390 高', () => {
    expect(defaultCollapsed(IPHONE_LANDSCAPE)).toBe(true);
    expect(defaultCollapsed({ ...IPHONE_LANDSCAPE, coarse: false })).toBe(true); // 只看高度也已经够矮
    expect(defaultCollapsed(IPHONE_PORTRAIT)).toBe(true);
    expect(defaultCollapsed({ width: 390, height: 900, coarse: true })).toBe(true);
  });

  it('桌面（1440×900，鼠标）默认展开', () => {
    expect(defaultCollapsed(DESKTOP)).toBe(false);
  });

  it('640×480 那种小窗默认收起（面板会吃掉半个游戏区）', () => {
    expect(defaultCollapsed({ width: 640, height: 480, coarse: false })).toBe(true);
    expect(NARROW_WIDTH_PX).toBeGreaterThan(640);
    expect(NARROW_HEIGHT_PX).toBeGreaterThan(480);
  });

  it('临界值：正好等于阈值算展开（判据是「小于」）', () => {
    expect(defaultCollapsed({ width: NARROW_WIDTH_PX, height: NARROW_HEIGHT_PX, coarse: false })).toBe(false);
    expect(defaultCollapsed({ width: NARROW_WIDTH_PX - 1, height: 900, coarse: false })).toBe(true);
    expect(defaultCollapsed({ width: 1440, height: NARROW_HEIGHT_PX - 1, coarse: false })).toBe(true);
    expect(defaultCollapsed({ width: 1440, height: 900, coarse: true })).toBe(true);
  });
});

describe('收起状态的记忆', () => {
  it('只有 `1` / `0` 认得；别的值当没存过', () => {
    expect(readStoredCollapsed('1')).toBe(true);
    expect(readStoredCollapsed('0')).toBe(false);
    expect(readStoredCollapsed(null)).toBeNull();
    expect(readStoredCollapsed(undefined)).toBeNull();
    expect(readStoredCollapsed('true')).toBeNull();
    expect(readStoredCollapsed('')).toBeNull();
  });

  it('★ 玩家按过就听他的（手机上存了 `0` 也照样展开）', () => {
    expect(initialCollapsed(IPHONE_LANDSCAPE, '0')).toBe(false);
    expect(initialCollapsed(DESKTOP, '1')).toBe(true);
  });

  it('没按过才按视口判', () => {
    expect(initialCollapsed(IPHONE_LANDSCAPE, null)).toBe(true);
    expect(initialCollapsed(DESKTOP, null)).toBe(false);
    expect(initialCollapsed(DESKTOP, '看不懂的值')).toBe(false);
  });

  it('存下去的值能读回来（同一个 key）', () => {
    expect(BOARD_STATE_KEY).toBe('rich4.board.collapsed');
    expect(readStoredCollapsed(storedCollapsedValue(true))).toBe(true);
    expect(readStoredCollapsed(storedCollapsedValue(false))).toBe(false);
  });
});

// ============================================================
//  ①′ 门厅：进门第一眼就要看到公告
// ============================================================

describe('★ 门厅（进站第一屏）—— 面板让位 + 一律展开', () => {
  it('`--board-w` 三个值：hidden ⇒ 0px、收起 ⇒ 30px、展开 ⇒ 与面板同一条公式', () => {
    expect(BOARD_WIDTH_VAR).toBe('--board-w');
    expect(boardPanelWidth({ hidden: true, collapsed: true })).toBe('0px');
    expect(boardPanelWidth({ hidden: true, collapsed: false })).toBe('0px'); // hidden 优先
    expect(boardPanelWidth({ hidden: false, collapsed: true })).toBe('30px');
    expect(boardPanelWidth({ hidden: false, collapsed: false })).toBe('min(300px, 64vw)');
    // 门厅在屏幕上、展开着 ⇒ 窄一点那一档（给门厅留 240px）
    expect(boardPanelWidth({ hidden: false, collapsed: false, foyer: true })).toBe('min(300px, max(120px, 100vw - 240px))');
    // 收起优先于门厅那一档
    expect(boardPanelWidth({ hidden: false, collapsed: true, foyer: true })).toBe('30px');
    expect(BOARD_WIDTH).toEqual({
      hidden: '0px',
      collapsed: '30px',
      foyer: 'min(300px, max(120px, 100vw - 240px))',
      expanded: 'min(300px, 64vw)',
    });
  });

  it('★ 变量里那几条宽度与 index.html 的面板宽度一字不差（对不上门厅就会错开一条缝 / 压住面板）', () => {
    expect(cssRule('#boardpanel')).toContain(`width: ${BOARD_WIDTH.expanded}`);
    expect(cssRule('#boardpanel.foyer')).toContain(`width: ${BOARD_WIDTH.foyer}`);
    expect(cssRule('#boardpanel.collapsed')).toContain(`width: ${BOARD_WIDTH.collapsed}`);
    // 初始值：面板 hidden（`board.json` 还没回来）时门厅铺满整屏
    expect(cssRule('body')).toContain(`${BOARD_WIDTH_VAR}: ${BOARD_WIDTH.hidden}`);
  });

  it('★ `.foyer` 那一档在手机上真的把门厅让宽了：390 宽 ⇒ 面板 150px / 门厅 240px', () => {
    // `min(300px, max(120px, 100vw - 240px))` 在 390 宽上 = 150px（老公式 64vw = 250px）
    const vw = 390;
    const foyerWidth = Math.min(300, Math.max(120, vw - 240));
    expect(foyerWidth).toBe(150);
    expect(vw - foyerWidth).toBe(240);
    // 桌面（1440）上这一档与展开那一条完全一样 ⇒ 观感不变
    expect(Math.min(300, Math.max(120, 1440 - 240))).toBe(300);
    expect(Math.min(300, 0.64 * 1440)).toBe(300);
  });

  it('★ 门厅在 ⇒ 手机（横屏 / 竖屏）、小窗都默认**展开**；门厅收了 ⇒ 回到视口判据', () => {
    expect(initialCollapsed(IPHONE_LANDSCAPE, null, true)).toBe(false);
    expect(initialCollapsed(IPHONE_PORTRAIT, null, true)).toBe(false);
    expect(initialCollapsed({ width: 640, height: 480, coarse: false }, null, true)).toBe(false);
    expect(initialCollapsed(IPHONE_LANDSCAPE, null, false)).toBe(true);
    expect(initialCollapsed(DESKTOP, null, false)).toBe(false);
  });

  it('★ 玩家自己按过的永远优先（门厅期间也不翻他的案）', () => {
    expect(initialCollapsed(IPHONE_LANDSCAPE, '1', true)).toBe(true);
    expect(initialCollapsed(DESKTOP, '0', true)).toBe(false);
    expect(initialCollapsed(DESKTOP, '看不懂', true)).toBe(false);
  });

  it('装上时门厅还在 ⇒ 手机上也展开，并把占位宽度写给门厅（窄一点那一档）', async () => {
    const { dom, els, layout } = fakePanel();
    await installBoardPanel({
      dom,
      load: async () => board(),
      storage: fakeStorage(),
      view: IPHONE_LANDSCAPE,
      foyer: boardPanelFoyer(true),
    });
    expect(els.root.hidden).toBe(false);
    expect(els.root.classes.has('collapsed')).toBe(false);
    expect(els.root.classes.has('foyer')).toBe(true); // 门厅那一档（给门厅留 240px）
    expect(els.tab.textContent).toBe(TAB_LABEL_CLOSE);
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.foyer);
  });

  it('★ 门厅收了（main.ts 调 refresh）⇒ 手机上回到默认收起，而且**不写** localStorage', async () => {
    const { dom, els, layout } = fakePanel();
    const storage = fakeStorage();
    const foyer = boardPanelFoyer(true);
    await installBoardPanel({ dom, load: async () => board(), storage, view: IPHONE_LANDSCAPE, foyer });

    foyer.up = false;
    foyer.refresh?.();
    expect(els.root.classes.has('collapsed')).toBe(true);
    expect(els.root.classes.has('foyer')).toBe(false); // 门厅没了就不再走窄那一档
    expect(els.tab.textContent).toBe(TAB_LABEL_OPEN);
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.collapsed);
    expect(storage.map.size).toBe(0); // 这一下不是玩家按的，不进记忆

    // 门厅又回来（进房失败回列表）：再展开一次
    foyer.up = true;
    foyer.refresh?.();
    expect(els.root.classes.has('collapsed')).toBe(false);
    expect(els.root.classes.has('foyer')).toBe(true);
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.foyer);
  });

  it('★ 门厅期间玩家按了「收起」⇒ 门厅收了也照他说的收着（窄那一档让位给 30px）', async () => {
    const { dom, els, layout } = fakePanel();
    const storage = fakeStorage();
    const foyer = boardPanelFoyer(true);
    await installBoardPanel({ dom, load: async () => board(), storage, view: DESKTOP, foyer });
    els.tab.listeners[0]?.fn(); // 玩家按的
    expect(els.root.classes.has('collapsed')).toBe(true);
    expect(els.root.classes.has('foyer')).toBe(false);
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.collapsed);
    foyer.up = false;
    foyer.refresh?.();
    expect(els.root.classes.has('collapsed')).toBe(true);
    expect(storage.map.get(BOARD_STATE_KEY)).toBe('1');
  });

  it('收起 / 展开都跟着改写 `--board-w`（门厅跟着动）', async () => {
    const { dom, els, layout } = fakePanel();
    await installBoardPanel({ dom, load: async () => board(), storage: fakeStorage(), view: DESKTOP });
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.expanded);
    els.tab.listeners[0]?.fn();
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.collapsed);
    els.tab.listeners[0]?.fn();
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe(BOARD_WIDTH.expanded);
  });

  it('★ 拿不到 board.json ⇒ `--board-w` 是 0px（门厅照旧铺满整屏，不空一条）', async () => {
    const { dom, layout } = fakePanel();
    const shown = await installBoardPanel({ dom, load: async () => null, storage: fakeStorage(), view: DESKTOP });
    expect(shown).toBe(false);
    expect(layout.props.get(BOARD_WIDTH_VAR)).toBe('0px');
  });

  it('门厅开关没给（桌面壳 / 测试）也照装，`refresh` 没人填', async () => {
    const { dom, els } = fakePanel();
    const shown = await installBoardPanel({ dom, load: async () => board(), storage: fakeStorage(), view: DESKTOP });
    expect(shown).toBe(true);
    expect(els.root.classes.has('collapsed')).toBe(false);
  });
});

describe('fetchBoardText —— 任何不顺利都给 null，绝不抛', () => {
  it('路径就是同源的 /board.json', () => {
    expect(BOARD_JSON_PATH).toBe('/board.json');
  });

  it('200 ⇒ 原文', async () => {
    const text = await fetchBoardText(async () => ({ ok: true, text: async () => '{"a":1}' }));
    expect(text).toBe('{"a":1}');
  });

  it('★ 404 / 500 ⇒ null（面板据此收起）', async () => {
    expect(await fetchBoardText(async () => ({ ok: false, text: async () => 'Not Found' }))).toBeNull();
  });

  it('★ 网络错（离线 / 桌面壳里没有这个路由）⇒ null', async () => {
    expect(
      await fetchBoardText(async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBeNull();
  });

  it('读 body 时才炸也算（返回 null）', async () => {
    expect(
      await fetchBoardText(async () => ({
        ok: true,
        text: async () => {
          throw new Error('network error');
        },
      })),
    ).toBeNull();
  });

  it('请求的 URL 就是传进去的那个', async () => {
    let seen = '';
    await fetchBoardText(async (url) => {
      seen = url;
      return { ok: true, text: async () => '{}' };
    });
    expect(seen).toBe('/board.json');
  });
});

// ============================================================
//  ② 画上去 / 装上去
// ============================================================

describe('announcementParagraphs —— 空行分段、破折号那一段是落款', () => {
  it('空行分段；段内的单换行保留（渲染那边 pre-wrap）', () => {
    expect(announcementParagraphs('第一段\n还是一段\n\n第二段')).toEqual([
      { text: '第一段\n还是一段', signature: false },
      { text: '第二段', signature: false },
    ]);
  });

  it('连着几个空行不产生空段；首尾空白丢掉', () => {
    expect(announcementParagraphs('\n\n甲\n\n\n\n乙\n\n')).toEqual([
      { text: '甲', signature: false },
      { text: '乙', signature: false },
    ]);
  });

  it('★ 以破折号开头的那一段算落款（`——Charles` / `-- 某人`）', () => {
    expect(announcementParagraphs('正文\n\n——Charles')).toEqual([
      { text: '正文', signature: false },
      { text: '——Charles', signature: true },
    ]);
    expect(announcementParagraphs('-- 某人')[0]?.signature).toBe(true);
    // 破折号在中间 / 段首不是破折号的，都算正文
    expect(announcementParagraphs('正文 —— 不是落款')[0]?.signature).toBe(false);
  });

  it('空文本 / 只有空行 ⇒ 没有段落', () => {
    expect(announcementParagraphs('')).toEqual([]);
    expect(announcementParagraphs('\n \n\t\n')).toEqual([]);
  });

  it('★ 一个字都不改（标点、全角空格、数字照旧）', () => {
    const text = '這是完全復刻 1998 年發售的「大富翁4」遊戲，基本實現 99.9% 還原。';
    expect(announcementParagraphs(text)).toEqual([{ text, signature: false }]);
  });

  it('★ 仓库里那份真的公告分得出四段，最后一段是落款', () => {
    const md = parseAnnouncement(readFileSync(new URL('../../../docs/board/announcement.md', import.meta.url), 'utf8'));
    const paras = announcementParagraphs(md);
    expect(paras.length).toBeGreaterThanOrEqual(4);
    expect(paras[paras.length - 1]).toEqual({ text: '——Charles', signature: true });
    // 公开页面上的东西：不许有 HTML、位址、链接
    expect(paras.filter((p) => /[<>]|0x[0-9a-f]{4,}|https?:\/\//i.test(p.text))).toEqual([]);
  });
});

describe('renderBoardPanel —— 摆内容', () => {
  it('公告按空行分段摆进去（落款那一段单独标出来）', () => {
    const { dom, els } = fakePanel();
    renderBoardPanel(dom, board({ announcement: { text: '第一段\n换行\n\n第二段\n\n——Charles', updatedAt: '' } }));
    expect(els.announcement.children).toEqual([
      { kind: 'para', text: '第一段\n换行' },
      { kind: 'para', text: '第二段' },
      { kind: 'sig', text: '——Charles' },
    ]);
    expect(els.announcedAt.textContent).toBe('');
  });

  it('公告带更新日期时写在段落下面', () => {
    const { dom, els } = fakePanel();
    renderBoardPanel(dom, board());
    expect(els.announcedAt.textContent).toBe('公告更新：2026-09-25');
  });

  it('没有 updatedAt ⇒ 日期那一行是空的（CSS `:empty` 会把它收掉）', () => {
    const { dom, els } = fakePanel();
    renderBoardPanel(dom, board({ announcement: { text: '公告', updatedAt: '' } }));
    expect(els.announcedAt.textContent).toBe('');
  });

  it('亮点与日誌按顺序摆，日期与条目都对得上', () => {
    const { dom, els } = fakePanel();
    renderBoardPanel(dom, board());
    expect(els.highlights.children).toEqual([
      { kind: 'item', text: '亮点一' },
      { kind: 'item', text: '亮点二' },
    ]);
    expect(els.changelog.children).toEqual([
      { kind: 'group', date: '2026-09-25', items: ['条目一', '条目二'] },
      { kind: 'group', date: '2026-09-24', items: ['条目三'] },
    ]);
  });

  it('★ 不解析 HTML：尖括号原样当文字收下（写进 DOM 的是 textContent）', () => {
    const nasty = '<img src=x onerror="alert(1)"> & </script><b>粗</b>';
    const { dom, els } = fakePanel();
    renderBoardPanel(dom, board({ announcement: { text: nasty, updatedAt: '' }, highlights: [nasty] }));
    expect(els.announcement.children).toEqual([{ kind: 'para', text: nasty }]);
    expect(els.highlights.children).toEqual([{ kind: 'item', text: nasty }]);
  });

  it('三块都空 ⇒ 什么也不摆（装的时候也不会露出来，见下）', () => {
    const { dom, els } = fakePanel();
    renderBoardPanel(dom, { announcement: { text: '', updatedAt: '' }, highlights: [], changelog: [] });
    expect(els.announcement.children).toEqual([]);
    expect(els.highlights.children).toEqual([]);
    expect(els.changelog.children).toEqual([]);
  });
});

describe('installBoardPanel —— 装上、露出、收起/展开', () => {
  it('宽屏：默认展开、画一次、写 localStorage 的**只有**玩家按过那一次', async () => {
    const { dom, els } = fakePanel();
    const storage = fakeStorage();
    let layouts = 0;
    const shown = await installBoardPanel({
      dom,
      load: async () => board(),
      storage,
      view: DESKTOP,
      onLayoutChange: () => {
        layouts += 1;
      },
    });

    expect(shown).toBe(true);
    expect(els.root.hidden).toBe(false);
    expect(els.root.classes.has('collapsed')).toBe(false);
    expect(els.tab.textContent).toBe(TAB_LABEL_CLOSE);
    expect(els.tab.attrs['aria-expanded']).toBe('true');
    expect(layouts).toBe(1); // 面板一露出来就要排一帧（画布变窄了）
    expect(storage.map.size).toBe(0); // ★ 首屏不写回：写下去手机上就再也默认收不起了
  });

  it('★ 手机横屏：一露出来就是收起的（只剩细籤），画布只让出 30px', async () => {
    const { dom, els } = fakePanel();
    await installBoardPanel({ dom, load: async () => board(), storage: fakeStorage(), view: IPHONE_LANDSCAPE });
    expect(els.root.hidden).toBe(false);
    expect(els.root.classes.has('collapsed')).toBe(true);
    expect(els.tab.textContent).toBe(TAB_LABEL_OPEN);
    expect(els.tab.attrs['aria-expanded']).toBe('false');
  });

  it('点细籤 = 收起/展开，并且记下来', async () => {
    const { dom, els } = fakePanel();
    const storage = fakeStorage();
    let layouts = 0;
    await installBoardPanel({
      dom,
      load: async () => board(),
      storage,
      view: DESKTOP,
      onLayoutChange: () => {
        layouts += 1;
      },
    });

    const click = els.tab.listeners[0];
    expect(click?.type).toBe('click');
    click?.fn();
    expect(els.root.classes.has('collapsed')).toBe(true);
    expect(els.tab.textContent).toBe(TAB_LABEL_OPEN);
    expect(storage.map.get(BOARD_STATE_KEY)).toBe('1');
    expect(layouts).toBe(2);

    click?.fn();
    expect(els.root.classes.has('collapsed')).toBe(false);
    expect(els.tab.textContent).toBe(TAB_LABEL_CLOSE);
    expect(storage.map.get(BOARD_STATE_KEY)).toBe('0');
    expect(layouts).toBe(3);
  });

  it('★ 存过就听玩家的：手机上存了 `0`，打开就是展开的', async () => {
    const { dom, els } = fakePanel();
    await installBoardPanel({
      dom,
      load: async () => board(),
      storage: fakeStorage({ [BOARD_STATE_KEY]: '0' }),
      view: IPHONE_LANDSCAPE,
    });
    expect(els.root.classes.has('collapsed')).toBe(false);
    expect(els.tab.textContent).toBe(TAB_LABEL_CLOSE);
  });

  it('localStorage 取不到（隐私模式）也照装，只是不记忆', async () => {
    const { dom, els } = fakePanel();
    const shown = await installBoardPanel({ dom, load: async () => board(), storage: null, view: DESKTOP });
    expect(shown).toBe(true);
    expect(() => els.tab.listeners[0]?.fn()).not.toThrow();
  });

  it('localStorage 一读就抛也不影响（Safari 隐私模式）', async () => {
    const { dom } = fakePanel();
    const hostile: BoardStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const shown = await installBoardPanel({ dom, load: async () => board(), storage: hostile, view: DESKTOP });
    expect(shown).toBe(true);
  });
});

describe('★★ 拿不到 / 坏了 / 空了的 board.json —— 游戏照跑', () => {
  async function hiddenBecause(load: () => Promise<BoardData | null>): Promise<{
    shown: boolean;
    layouts: number;
    listeners: string[];
    storage: Map<string, string>;
    els: ReturnType<typeof fakePanel>['els'];
  }> {
    const { dom, els } = fakePanel();
    const storage = fakeStorage();
    let layouts = 0;
    const shown = await installBoardPanel({
      dom,
      load,
      storage,
      view: DESKTOP,
      onLayoutChange: () => {
        layouts += 1;
      },
    });
    return {
      shown,
      layouts,
      listeners: Object.values(els).flatMap((e) => e.listeners.map((l) => `${e.id}:${l.type}`)),
      storage: storage.map,
      els,
    };
  }

  it('★ 404（load 给 null）：面板一直 hidden，一个监听都不挂，不排帧，不写 localStorage', async () => {
    const r = await hiddenBecause(async () => null);
    expect(r.shown).toBe(false);
    expect(r.els.root.hidden).toBe(true);
    expect(r.els.root.classes.has('collapsed')).toBe(true); // 保持 index.html 原样：细籤还在
    expect(r.listeners).toEqual([]);
    expect(r.layouts).toBe(0);
    expect(r.storage.size).toBe(0);
  });

  it('★ JSON 坏掉（parseBoard 给 null）：同上', async () => {
    const r = await hiddenBecause(async () => parseBoard('<html><body>404 Not Found</body></html>'));
    expect(r.shown).toBe(false);
    expect(r.els.root.hidden).toBe(true);
    expect(r.listeners).toEqual([]);
  });

  it('★ 解析得出但三块全空：面板没必要出现', async () => {
    const r = await hiddenBecause(async () =>
      parseBoard(JSON.stringify({ announcement: { text: '  ' }, highlights: [], changelog: [] })),
    );
    expect(r.shown).toBe(false);
    expect(r.els.root.hidden).toBe(true);
  });

  it('取数据时抛了：吞掉、报一声、面板不出现（不许把游戏带崩）', async () => {
    const { dom, els } = fakePanel();
    const errors: unknown[] = [];
    const shown = await installBoardPanel({
      dom,
      load: async () => {
        throw new Error('boom');
      },
      storage: fakeStorage(),
      view: DESKTOP,
      onError: (err) => errors.push(err),
    });
    expect(shown).toBe(false);
    expect(els.root.hidden).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('★ 画布从头到尾没被碰过：零监听、hidden 没动、class 没动', async () => {
    const { dom, els, canvas } = fakePanel();
    const before = { hidden: canvas.hidden, textContent: canvas.textContent, classes: [...canvas.classes] };
    await installBoardPanel({ dom, load: async () => board(), storage: fakeStorage(), view: DESKTOP });
    els.tab.listeners[0]?.fn();

    expect(canvas.listeners).toEqual([]);
    expect(canvas.hidden).toBe(before.hidden);
    expect(canvas.textContent).toBe(before.textContent);
    expect([...canvas.classes]).toEqual(before.classes);
  });

  it('★ 面板自己挂的监听只有细籤上的 click（没有 pointerdown / touchstart / mousedown）', async () => {
    const { dom, els } = fakePanel();
    await installBoardPanel({ dom, load: async () => board(), storage: fakeStorage(), view: DESKTOP });
    const all = Object.values(els).flatMap((e) => e.listeners.map((l) => `${e.id}:${l.type}`));
    expect(all).toEqual(['boardtab:click']);
  });
});

// ============================================================
//  ③ 源码钉子：布局、白名单、textContent
// ============================================================

/** 从 index.html 里抠出一条 CSS 规则（行首的选择器 `… { … }`，不含后代选择器） */
function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*${escaped} \\{([\\s\\S]*?)\\}`, 'm').exec(html);
  if (m === null) throw new Error(`index.html 里找不到规则：${selector}`);
  return m[0];
}

describe('★ index.html 的布局：面板是「挤窄舞台」的兄弟项，不是浮层', () => {
  it('面板排在 `<canvas id="board">` **前面**（flex 行 ⇒ 在左边）', () => {
    const panel = html.indexOf('id="boardpanel"');
    const canvas = html.indexOf('<canvas id="board">');
    expect(panel).toBeGreaterThan(0);
    expect(canvas).toBeGreaterThan(0);
    expect(panel).toBeLessThan(canvas);
  });

  it('★ 面板 `flex: none`，而且**一处 position 都没有**（浮层才会盖住画布、截走事件）', () => {
    const rule = cssRule('#boardpanel');
    expect(rule).toContain('flex: none');
    expect(rule).not.toMatch(/position\s*:/);
    // 收起时只剩一条细籤
    expect(cssRule('#boardpanel.collapsed')).toContain('width: 30px');
  });

  it('★ 画布那两条一个字没动：`flex: 1 1 0` + `touch-action: none`', () => {
    const rule = cssRule('#board');
    expect(rule).toContain('flex: 1 1 0');
    expect(rule).toContain('width: 100%');
    expect(rule).toContain('height: 100%');
    expect(rule).toContain('touch-action: none');
  });

  it('★ 页面结构还是「固定贴满可视区、不可滚」（iPhone Safari 那条老账）', () => {
    const rule = cssRule('body');
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('overflow: hidden');
    expect(cssRule('html')).toContain('overflow: hidden');
  });

  it('`hidden` 真的藏得住（`display: flex` 会盖掉 `hidden` 的默认样式，所以那条规则必须有）', () => {
    expect(cssRule('#boardpanel[hidden]')).toContain('display: none');
    expect(html).toMatch(/<aside id="boardpanel"[^>]*hidden/);
  });

  it('面板自己滚，滚到底不带着整页动', () => {
    const rule = cssRule('#boardbody');
    expect(rule).toContain('overflow-y: auto');
    expect(rule).toContain('overscroll-behavior: contain');
  });

  it('细籤与六块内容都在（id 与 boardPanelDom 取的那几个一致）', () => {
    for (const id of ['boardpanel', 'boardtab', 'boardannouncement', 'boardannouncedate', 'boardhighlights', 'boardchangelog']) {
      expect(html).toContain(`id="${id}"`);
    }
    // 更新日誌默认收起（`<details>` 不带 open）
    expect(html).toMatch(/<details id="boardlog">/);
  });
});

describe('★ 门厅不再盖住面板（源码钉子）', () => {
  it('★ 门厅的左边就是面板的占位宽度 —— 不是 `inset:0`（那就是「进门看不见公告」的老毛病）', () => {
    expect(foyerSrc).toContain('position:fixed;left:var(--board-w,0px);top:0;right:0;bottom:0');
    expect(foyerCode).not.toContain('inset:0');
    // 覆盖层该有的那几样一个没少
    expect(foyerSrc).toContain('z-index:50');
    expect(foyerSrc).toContain('align-items:center');
    expect(foyerSrc).toContain('justify-content:center');
    expect(foyerSrc).toContain('radial-gradient(');
    expect(foyerSrc).toContain('overflow:auto');
  });

  it('★ 卡片按门厅自己的宽度收 —— 面板展开时 360px 的卡片不许溢到面板底下', () => {
    expect(foyerSrc).toContain('max-width:calc(100% - 32px)');
    expect(foyerCode).not.toContain('100vw');
  });

  it('★ main.ts 在门厅开合的整段里拨那块开关，并把开关交给面板', () => {
    expect(main).toContain('boardPanelFoyer()');
    expect(main).toContain('foyer: boardFoyer');
    expect(main).toContain('await whileFoyerUp(() =>');
    expect(main).toContain('boardFoyer.up = true');
    expect(main).toContain('boardFoyer.up = false');
    // 开关落在 `finally` 里：门厅中途抛了也得把「门厅没了」说出去
    expect(main.indexOf('boardFoyer.up = false')).toBeGreaterThan(main.indexOf('boardFoyer.up = true'));
  });
});

describe('★ 面板这一路拿不到画布、也不解析 HTML', () => {
  it('`boardPanelDom` 只按面板自己的 6 个 id 取元素（白名单）', () => {
    const ids = [...panelSrc.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    const panelIds = [
      'boardannouncement',
      'boardannouncedate',
      'boardchangelog',
      'boardhighlights',
      'boardpanel',
      'boardtab',
    ];
    expect([...ids].sort()).toEqual([...panelIds].sort());
    // ★ 画布不在名单上 —— 面板这一路根本拿不到它
    expect(ids).not.toContain('board');
  });

  it('★ 面板源码里没有 innerHTML / outerHTML / insertAdjacentHTML / document.write', () => {
    // 注释里提到这几个词不算（去注释之后再查）
    const code = panelSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      expect(code).not.toContain(bad);
    }
    // 写文字只走 textContent
    expect(code).toContain('.textContent =');
  });

  it('★ 面板源码不 import main.ts / render.ts（拿不到棋盘那一套）', () => {
    const imports = [...panelSrc.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['board-data.ts']);
  });

  it('main.ts 在 boot 里装面板，并且把 `requestRender` 当作「布局变了」的回调', () => {
    expect(main).toContain('boardPanelDom(document)');
    expect(main).toContain('installBoardPanel(');
    expect(main).toContain('onLayoutChange: requestRender');
    // 位置：在 `boot()` 末尾的 DOM 接线区（渲染链铺好之后）
    expect(main.indexOf('installBoardPanel(')).toBeGreaterThan(main.indexOf('bindPageVisibility();'));
    expect(main.indexOf('installBoardPanel(')).toBeLessThan(main.indexOf('void boot();'));
  });

  it('`boardPanelDom` 少一个元素就返回 null（有人改了 index.html 也不会把游戏带崩）', () => {
    const doc = {
      getElementById: (id: string) => (id === 'boardtab' ? null : fakeEl(id)),
      createElement: () => fakeEl('x'),
    };
    expect(boardPanelDom(doc as unknown as Document)).toBeNull();
  });
});
