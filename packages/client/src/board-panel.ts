/*
 * 左側佈告欄（公告 + 更新日誌）—— DOM 面板，**不进 640×480 舞台**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-25：页面左边加一块佈告欄，所有来的人都能看到公告与更新日誌；
 * 内容由协调方在服务器上更新（**页面上没有编辑器**）。
 *
 * ── 为什么是 DOM、为什么是「佔一格寬」而不是浮层 ──────────────
 * 画布（`#board`）是全站唯一吃触摸/鼠标的地方，而且 `touch-action: none`（手势全归
 * `touch-input.ts`）。这一块做成**浮在画布上的绝对定位面板**就等于在画布上盖一条，
 * 那一条上的点击全被吃掉。所以：
 *   · `#boardpanel` 是 `body`（flex 行）里 `#board` **前面**的一个普通 flex 子项，
 *     `flex: none` + 固定宽度 ⇒ 它一展开，画布自己变窄，`resizeCanvas()` /
 *     `currentMetrics()` 照旧读画布的 client 尺寸、照旧 letterbox，一行都不用改；
 *   · 它**不在画布上**、也不跟画布重叠 ⇒ 指针事件不可能被截走（见测试
 *     `board-panel.test.ts` 的「不碰画布」那几条，以及 index.html 上的源码钉子）。
 *   · 收起时只剩一条 30px 的细籤：手机上默认收起（见 `defaultCollapsed`），
 *     但新公告仍然看得见「公告」两个字，点一下就开。
 *
 * ── 拿不到数据怎么办 ────────────────────────────────────────
 * `#boardpanel` 在 index.html 里是 `hidden` 的，只有 `/board.json` 取回来且解析得动
 * （`board-data.ts` 的 `parseBoard`）、里面**确实有内容**，才 `hidden = false`。
 * 404 / 网络错 / JSON 坏了 / 桌面壳里没有这个文件 —— 面板**一直不出现**，
 * 游戏一个字节都不受影响。
 *
 * ── 安全 ────────────────────────────────────────────────────
 * 面板上每一个字都用 `textContent` 写（`renderBoardPanel` + `boardPanelDom` 里的
 * `item` / `group`），JSON 里的 `<script>` 只会被当成文字显示。这一条有测试钉着
 * （`board-panel.test.ts` 里那条「不解析 HTML」）。
 */

import {
  BOARD_JSON_PATH,
  hasBoardContent,
  type BoardData,
} from './board-data.ts';

/** 收起/展开记在这里（`'1'` = 收起，`'0'` = 展开） */
export const BOARD_STATE_KEY = 'rich4.board.collapsed';

/** 窄到这个宽度以下（或矮到这个高度以下）就当手机：**默认收起** */
export const NARROW_WIDTH_PX = 760;
export const NARROW_HEIGHT_PX = 560;

/** 细籤上的字：收起时是入口，展开时是收起钮 */
export const TAB_LABEL_OPEN = '公告';
export const TAB_LABEL_CLOSE = '收起';

/** 面板要碰的那几个 DOM 面 —— 测试里喂假的（见 `board-panel.test.ts`） */
export interface BoardPanelDom {
  /** `#boardpanel`：`hidden` 一开始就是真，只有拿到数据才放开；`collapsed` 类 = 收起 */
  readonly root: { hidden: boolean; classList: { toggle(token: string, force: boolean): void } };
  /** `#boardtab`：左侧那条永远看得见的细籤 */
  readonly tab: {
    textContent: string | null;
    title: string;
    setAttribute(name: string, value: string): void;
    addEventListener(type: 'click', listener: () => void): void;
  };
  readonly announcement: { replaceChildren(...nodes: readonly unknown[]): void };
  readonly announcedAt: { textContent: string | null };
  readonly highlights: { replaceChildren(...nodes: readonly unknown[]): void };
  readonly changelog: { replaceChildren(...nodes: readonly unknown[]): void };
  /** 造公告的一段（`signature` = 落款那一段，渲染那边会弱化） */
  readonly paragraph: (text: string, signature: boolean) => unknown;
  /** 造一个亮点条目 */
  readonly item: (text: string) => unknown;
  /** 造一天（日期 + 那一天的条目） */
  readonly group: (date: string, items: readonly string[]) => unknown;
}

/** 视口的样子（判断「是不是手机」用；测试直接给数字） */
export interface BoardPanelView {
  readonly width: number;
  readonly height: number;
  /** 粗指针（触摸屏）—— 有它就按手机算，不管转成哪个方向 */
  readonly coarse: boolean;
}

/** 记状态用的那一小块 `localStorage`（给不进 DOM 的测试用） */
export interface BoardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `fetch` 里用得到的那一点（测试给假的响应就好） */
export interface BoardFetchResponse {
  readonly ok: boolean;
  text(): Promise<string>;
}
export type BoardFetch = (url: string) => Promise<BoardFetchResponse>;

// ============================================================
//  收起 / 展开：默认值与记忆
// ============================================================

/**
 * 手机 / 小平板 ⇒ 默认收起。
 *
 * ★ 只看宽度是不够的：iPhone 13 横屏是 844×390 —— 宽得很，可总共才 390 高，
 *   展开的 300px 面板会把棋盘挤成一小条。所以**矮**也算、**粗指针**也算
 *   （真机上转向之后两种判据都还成立）。
 */
export function defaultCollapsed(view: BoardPanelView): boolean {
  return view.coarse || view.width < NARROW_WIDTH_PX || view.height < NARROW_HEIGHT_PX;
}

/** 存下来的值 → 布尔；不是我们写的那两个值就当没存过（`null`） */
export function readStoredCollapsed(raw: string | null | undefined): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** 布尔 → 存下去的值 */
export function storedCollapsedValue(collapsed: boolean): string {
  return collapsed ? '1' : '0';
}

/**
 * 开局该是收着还是开着：**玩家自己按过就听他的**，没按过才按视口判。
 *
 * ⚠️ 玩家没按过时**不写** localStorage（见 `installBoardPanel`）—— 写下去就等于
 *   把「在手机上默认收起」这件事钉死成「这台设备永远收起」，换个屏幕也不改了。
 */
export function initialCollapsed(view: BoardPanelView, stored: string | null | undefined): boolean {
  return readStoredCollapsed(stored) ?? defaultCollapsed(view);
}

// ============================================================
//  取数据
// ============================================================

/**
 * 取 `/board.json` 的原文。**任何**不顺利（404、网络错、解析前就发现不对）都给 `null`，
 * 由调用方把整块面板收起来 —— 这里不抛、不重试、不吭声。
 */
export async function fetchBoardText(
  fetchImpl: BoardFetch,
  url: string = BOARD_JSON_PATH,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ============================================================
//  画上去（全部 textContent，绝不 innerHTML）
// ============================================================

/** 公告的一段 */
export interface AnnouncementParagraph {
  readonly text: string;
  /** 落款（以破折号开头的那一段）—— 右对齐、灰一点、小一号，免得看起来像正文 */
  readonly signature: boolean;
}

/**
 * 公告正文 → 段落。**空行分段**（写的人怎么分段就怎么显示），段内的单换行保留
 * （渲染那边是 `white-space: pre-wrap`）；以破折号开头的那一段算落款。
 *
 * ⚠️ 这里只是**切段**，一个字符都不改：需求方的原文逐字显示，标点与空格照旧。
 */
export function announcementParagraphs(text: string): AnnouncementParagraph[] {
  const out: AnnouncementParagraph[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const body = block.trim();
    if (body === '') continue;
    out.push({ text: body, signature: /^(?:—|--)/.test(body) });
  }
  return out;
}

/** 把一份数据摆进面板（**不**管 `hidden` / `collapsed`，那是 `installBoardPanel` 的事） */
export function renderBoardPanel(dom: BoardPanelDom, data: BoardData): void {
  dom.announcement.replaceChildren(
    ...announcementParagraphs(data.announcement.text).map((p) => dom.paragraph(p.text, p.signature)),
  );
  dom.announcedAt.textContent =
    data.announcement.updatedAt === '' ? '' : `公告更新：${data.announcement.updatedAt}`;
  dom.highlights.replaceChildren(...data.highlights.map((text) => dom.item(text)));
  dom.changelog.replaceChildren(...data.changelog.map((day) => dom.group(day.date, day.items)));
}

// ============================================================
//  装上去
// ============================================================

export interface InstallBoardPanelOptions {
  readonly dom: BoardPanelDom;
  /** 取数据（拿不到给 `null`）*/
  readonly load: () => Promise<BoardData | null>;
  /** `localStorage`；隐私模式下取不到就给 `null`（那就只是不记忆） */
  readonly storage: BoardStorage | null;
  readonly view: BoardPanelView;
  /**
   * 面板的**占位宽度变了**（出现 / 收起 / 展开）—— 画布跟着变宽变窄，
   * 调用方在这里排一帧（`requestRender`），`resizeCanvas()` 会在那一帧里读新尺寸。
   * ⚠️ 面板本身**从不**碰画布，这是它与画布之间唯一的联系。
   */
  readonly onLayoutChange?: (() => void) | undefined;
  /** 出了意外（但不影响游戏）时报一声，给日志栏用 */
  readonly onError?: ((err: unknown) => void) | undefined;
}

/**
 * 装上佈告欄：取数据 → 画上去 → 露出来 → 接上细籤的收起/展开。
 *
 * 返回**面板有没有露出来**（测试用；调用方当它没有返回值也行）。
 * 拿不到数据 / 数据是空的 / 中途出了任何意外 ⇒ 返回 `false`，面板保持 `hidden`，
 * 而且**一个监听都不挂**（连收起状态都不去动）—— 游戏该怎么跑还怎么跑。
 */
export async function installBoardPanel(opts: InstallBoardPanelOptions): Promise<boolean> {
  const { dom, storage, view, onLayoutChange, onError } = opts;
  try {
    const data = await opts.load();
    if (data === null || !hasBoardContent(data)) return false;

    renderBoardPanel(dom, data);

    let collapsed = initialCollapsed(view, safeGet(storage));
    const apply = (next: boolean, remember: boolean): void => {
      collapsed = next;
      dom.root.classList.toggle('collapsed', next);
      dom.tab.textContent = next ? TAB_LABEL_OPEN : TAB_LABEL_CLOSE;
      dom.tab.title = next ? '看公告與更新日誌' : '收起佈告欄';
      // 细籤自己就是那颗开关：收起时它「开」面板，所以当前状态是收着的
      dom.tab.setAttribute('aria-expanded', next ? 'false' : 'true');
      if (remember) safeSet(storage, BOARD_STATE_KEY, storedCollapsedValue(next));
      onLayoutChange?.();
    };

    dom.root.hidden = false;
    apply(collapsed, false); // 首屏只按默认/记忆摆一次，**不写**回去
    dom.tab.addEventListener('click', () => apply(!collapsed, true));
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

function safeGet(storage: BoardStorage | null): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(BOARD_STATE_KEY);
  } catch {
    return null; // Safari 隐私模式下 getItem 也会抛
  }
}

function safeSet(storage: BoardStorage | null, key: string, value: string): void {
  if (storage === null) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* 存不下就算了：面板照用，只是下次打开不记得 */
  }
}

// ============================================================
//  真 DOM
// ============================================================

/**
 * 从 `document` 上取面板要的那几个元素。
 *
 * ⚠️ 这里取的名字是**白名单**：只有下面这 6 个 id。画布（`board`）不在这张单子上
 *   —— 面板这一路根本拿不到画布，也就不可能给它挂监听、改它的尺寸（测试钉着）。
 * 少一个元素（有人改了 index.html）⇒ 返回 `null`，面板整个不装，游戏照跑。
 */
export function boardPanelDom(doc: Document): BoardPanelDom | null {
  const root = doc.getElementById('boardpanel');
  const tab = doc.getElementById('boardtab');
  const announcement = doc.getElementById('boardannouncement');
  const announcedAt = doc.getElementById('boardannouncedate');
  const highlights = doc.getElementById('boardhighlights');
  const changelog = doc.getElementById('boardchangelog');
  if (
    root === null ||
    tab === null ||
    announcement === null ||
    announcedAt === null ||
    highlights === null ||
    changelog === null
  ) {
    return null;
  }

  const paragraph = (text: string, signature: boolean): Node => {
    const p = doc.createElement('p');
    p.className = signature ? 'boardsig' : 'boardpara';
    p.textContent = text;
    return p;
  };
  const item = (text: string): Node => {
    const li = doc.createElement('li');
    li.textContent = text;
    return li;
  };
  const group = (date: string, items: readonly string[]): Node => {
    const box = doc.createElement('div');
    box.className = 'boardday';
    const head = doc.createElement('div');
    head.className = 'boarddate';
    head.textContent = date;
    const list = doc.createElement('ul');
    list.replaceChildren(...items.map(item));
    box.replaceChildren(head, list);
    return box;
  };

  return { root, tab, announcement, announcedAt, highlights, changelog, paragraph, item, group };
}

/** 当前视口（判断默认收起用） */
export function readBoardView(win: Window): BoardPanelView {
  let coarse = false;
  try {
    coarse = win.matchMedia('(pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  return { width: win.innerWidth, height: win.innerHeight, coarse };
}
