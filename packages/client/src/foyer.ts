/*
 * 门厅 —— 名字 + 「單人模式 / 在線聯機」兩個入口 + 房間列表（W-73 → 2026-09-23 房間列表）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 2026-09-23 需求方：「改成單人模式 / 在線聯機 2 個入口，在線聯機點擊進去後展示房間列表……
 *   這樣朋友們不需要再傳遞那個很麻煩的邀請碼」⇒ 房間碼輸入框與「複製邀請連結」從主路徑上拿掉；
 *   房間碼只剩**內部 id**（列表上小字顯示，給除錯用）。舊的 `?room=` 連結**仍然有效**：
 *   打開就直接進那一間（見 `main.ts` 的 `startFoyer`）。
 *
 * ★ **为什么用 DOM 不用 canvas**（任务书 W-73 开头）：名字要打中文，
 *   canvas 里接不了输入法。门厅是本项目**自己**的界面，不碰任何复刻屏 ——
 *   標題畫面那 5 颗钮一颗都不加不改。
 *
 * ★ 这个文件分成两半，边界很清楚：
 *   · **纯函数**（房间码、名字、邀请链接、身份令牌）—— 单测钉着，
 *     见 `foyer.test.ts`；
 *   · **DOM 覆盖层**（`showFoyer`）—— 浏览器里验收，不写 jsdom 测试
 *     （那要引一个 DOM 实现，为一个覆盖层不值）。
 */

import {
  MAX_NAME_CODE_POINTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isRoomCode,
  sanitizeName,
  type JoinMode,
  type RoomSummary,
  type SaveSummary,
} from '@rich4/core';
import {
  RoomListClient,
  countLabel,
  formatAge,
  mapLabel,
  canDeleteSave,
  rowAction,
  saveDateLabel,
  seatLabel,
  statusLabel,
} from './room-list.ts';
import { TEXT_ENTRY_FONT_PX } from './text-entry.ts';

/** 上次用的名字 */
export const NAME_STORAGE_KEY = 'rich4.name';
/**
 * ★ W-73 §3：身份令牌。
 *
 * 为什么存本地而不是每次现生成：断线重连（刷新页面、切网络）时服务器要靠它
 * **认回原座位**。现生成一个就等于换了一个人 —— 原座位会被当成「跑掉的那个」，
 * 而自己变成新来的（开局后根本进不去）。
 */
export const CLIENT_ID_STORAGE_KEY = 'rich4.clientId';
/** `clientId` 的随机字节数 —— 16 字节 ⇒ 32 位十六进制，与 `isClientId` 的判据对齐 */
export const CLIENT_ID_BYTES = 16;
/** 旧邀请链接的查询参数名（`?room=` 仍然认：打开就直接进那一间）*/
export const ROOM_PARAM = 'room';

/** 随机字节从哪来 @default `crypto.getRandomValues` */
export type RandomBytes = (bytes: Uint8Array) => void;

function defaultRandom(bytes: Uint8Array): void {
  globalThis.crypto.getRandomValues(bytes);
}

/**
 * 生成一个房间码：**6 位、32 字符集**（`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`）。
 *
 * ★ 用 `crypto.getRandomValues` 而不是 `Math.random()`：房间码是唯一的准入凭据，
 *   可猜的码等于没有码。
 * ★ 用 `byte % 32` 取字符**没有取模偏差** —— 256 恰好是 32 的 8 倍，
 *   每个字符落到 8 个字节值上，均匀。
 */
export function newRoomCode(random: RandomBytes = defaultRandom): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  random(bytes);
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[bytes[i]! % ROOM_CODE_ALPHABET.length]!;
  }
  return out;
}

/** 生成一个身份令牌：16 字节随机 → 32 位**小写**十六进制（服务器只认这个形状） */
export function newClientId(random: RandomBytes = defaultRandom): string {
  const bytes = new Uint8Array(CLIENT_ID_BYTES);
  random(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 链接里那一串 → 房间码：**去空格、转大写**（任务书 W-73 §1） */
export function normalizeRoomCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** 从 `location.search` 里读旧邀请链接的房间码；没有 / 不合法返回 `null` */
export function inviteRoomFrom(search: string): string | null {
  const raw = new URLSearchParams(search).get(ROOM_PARAM);
  if (raw === null) return null;
  const code = normalizeRoomCode(raw);
  return isRoomCode(code) ? code : null;
}

/** 名字校验（与服务器**同一个** `sanitizeName` —— 见 core/protocol.ts 的注释） */
export function validateName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = sanitizeName(raw);
  if (name === null) {
    return { ok: false, message: `名字要 1~${MAX_NAME_CODE_POINTS} 個字（不能只有空白）` };
  }
  return { ok: true, name };
}

// ============================================================
//  localStorage 里的两样东西
// ============================================================

/** 存储口（隐私模式下 `localStorage` 会直接抛，所以每一步都要兜住） */
export interface FoyerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 浏览器里的那个；拿不到返回 `null` */
export function browserStorage(): FoyerStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 上次用的名字；没有 / 存坏了返回 `''` */
export function loadName(storage: FoyerStorage | null): string {
  try {
    return sanitizeName(storage?.getItem(NAME_STORAGE_KEY) ?? '') ?? '';
  } catch {
    return '';
  }
}

export function saveName(storage: FoyerStorage | null, name: string): void {
  try {
    storage?.setItem(NAME_STORAGE_KEY, name);
  } catch {
    /* 存不进去不是错误：下次再输一遍就是 */
  }
}

/**
 * 取身份令牌；没有就**生成一个并存下来**（任务书 W-73 §3）。
 *
 * ⚠️ 存坏了（不是 32 位小写十六进制）一律当**没有**重新生成 —— 拿一个服务器
 *   必然拒绝的值去 join，只会换回一句 error 然后被断开。
 */
export function loadClientId(storage: FoyerStorage | null, random: RandomBytes = defaultRandom): string {
  try {
    const saved = storage?.getItem(CLIENT_ID_STORAGE_KEY) ?? null;
    if (saved !== null && /^[0-9a-f]{32}$/.test(saved)) return saved;
    const fresh = newClientId(random);
    storage?.setItem(CLIENT_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return newClientId(random);
  }
}

/**
 * 页面一打开该走哪条路（纯函数，`main.ts` 的 `boot` 用）。
 *
 * · `?ws=…&room=…` —— **老调试入口**（`tools/net-e2e.js` 在用）：直接进那一间，不经门厅；
 * · 其余 —— 门厅。`?ws=` 单独出现时只**换服务器地址**（本机调试：Vite 与服务器不同端口），
 *   `?room=` 单独出现时是旧邀请链接（门厅会直接送进那一间）。
 */
export type FoyerEntry =
  | { kind: 'direct' }
  | { kind: 'foyer'; wsUrl: string | null; inviteRoom: string | null };

export function foyerEntry(search: string): FoyerEntry {
  const q = new URLSearchParams(search);
  const ws = q.get('ws');
  const wsUrl = ws === null || ws === '' ? null : ws;
  if (wsUrl !== null && q.has(ROOM_PARAM)) return { kind: 'direct' };
  return { kind: 'foyer', wsUrl, inviteRoom: inviteRoomFrom(search) };
}

/** 把旧邀请链接的 `?room=` 从地址里拿掉（其余参数原样保留）—— 用过一次就不再自动进房 */
export function withoutRoomParam(search: string): string {
  const q = new URLSearchParams(search);
  q.delete(ROOM_PARAM);
  const rest = q.toString();
  return rest === '' ? '' : `?${rest}`;
}

// ============================================================
//  覆盖层
// ============================================================

export type FoyerChoice =
  | { kind: 'solo'; name: string }
  | {
      kind: 'online';
      room: string;
      name: string;
      /** `'create'` = 建立房間；`'join'` = 从列表 / 旧链接进一间**已有的** */
      mode: JoinMode;
      /** ★ 聯機存檔（v6）：建房時從這份存檔繼續 */
      fromSave?: string;
      /** ★ 聯機存檔（v6）：加入已開局的存檔房時認領這一座 */
      claimSeat?: number;
    };

/** 门厅用到的那一小截 WebSocket（单测 / 替身好塞）*/
export interface FoyerSocket {
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface FoyerOptions {
  /** 一打开停在哪一页 @default 'home' */
  view?: 'home' | 'rooms';
  /** 房间列表页顶上那条提示（例如「这个房间已经不在了」）*/
  notice?: string | null;
  /** 旧邀请链接的房间码：有值时「在線聯機」直接进这一间，不经列表 */
  inviteRoom?: string | null;
  /** 房间列表连哪台服务器（`wss://<host>/ws`）*/
  wsUrl: string;
  /** 身份令牌 —— 列表据此标出「你在这桌有断线中的座位」*/
  clientId: string;
  storage?: FoyerStorage | null;
  random?: RandomBytes;
  doc?: Document;
  openSocket?: (url: string) => FoyerSocket;
  /**
   * 「高清畫面」勾选框（W-80 §8）—— 每台设备自己的显示设定（存在本机、不上网、联机各看各的）。
   * 不给就不显示。`set` 当场生效（倍率 + 超分素材原地换），不必重新整理。
   */
  hd?: { on: boolean; set: (on: boolean) => void };
}

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif";
/** 断线后隔多久重连列表 */
const LIST_RETRY_MS = 2000;
/** 「幾分鐘前」多久刷一次 */
const AGE_TICK_MS = 15_000;

/** 造一个带内联样式的元素（不引任何外部样式表 —— 与登录页同一条规矩） */
function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

const GOLD = '#f3d27a';
const BTN = `padding:10px 14px;font:600 14px/1.2 ${FONT};border:1px solid #3a5a83;border-radius:8px;background:#22405f;color:#e9eef7;cursor:pointer`;
const BTN_MAIN = `padding:10px 14px;font:600 14px/1.2 ${FONT};border:1px solid #b08a2e;border-radius:8px;background:#7a5a14;color:#fff3d0;cursor:pointer`;
// ★ 第二十七份：文字框字号 ≥ 16px，iOS Safari 聚焦时才不会自动放大且失焦不缩回（见 text-entry.ts）
const INPUT = `width:100%;box-sizing:border-box;padding:9px 10px;font:${TEXT_ENTRY_FONT_PX}px/1.4 ${FONT};border-radius:6px;border:1px solid #3a5a83;background:#0e2138;color:#e9eef7`;
const ENTRY = `display:block;width:100%;box-sizing:border-box;text-align:left;padding:14px 16px;border-radius:10px;border:1px solid #3a5a83;background:#1d3a5c;color:#e9eef7;cursor:pointer;font-family:${FONT}`;

function button(doc: Document, style: string, text: string): HTMLButtonElement {
  const b = el(doc, 'button', style, text);
  b.type = 'button';
  return b;
}

/** 一个大入口：标题 + 一行小字 */
function entryButton(doc: Document, title: string, sub: string): HTMLButtonElement {
  const b = button(doc, ENTRY, '');
  b.append(
    el(doc, 'div', `font-size:18px;font-weight:700;letter-spacing:2px;color:${GOLD}`, title),
    el(doc, 'div', 'margin-top:4px;font-size:12px;color:#a9bcd4', sub),
  );
  return b;
}

/**
 * 弹门厅；玩家选完之后 resolve（覆盖层已经收掉）。
 *
 * 两页：
 * · **首页** —— 名字 + 两个大入口：**單人模式** / **在線聯機**；
 * · **房间列表** —— 房主暱稱、人數、狀態、地圖、建立了多久；每行「加入 / 重新連線」，
 *   底下「建立房間 / 重新整理 / 返回」。列表由服务器**推送**（见 `room-list.ts` 文件头）。
 */
export function showFoyer(opts: FoyerOptions): Promise<FoyerChoice> {
  const doc = opts.doc ?? document;
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const random = opts.random ?? defaultRandom;
  const invite = opts.inviteRoom ?? null;
  const openSocket = opts.openSocket ?? ((url: string) => new WebSocket(url) as unknown as FoyerSocket);

  return new Promise<FoyerChoice>((resolve) => {
    // ★ 左侧佈告欄（`board-panel.ts`）：门厅**不再盖住左边那一条**。
    //   面板把当前占位宽度写在 `body` 的 `--board-w` 上（`hidden` ⇒ `0px`），
    //   这里拿它当左边界 —— 面板于是永远露在门厅外面（第一次来的人也看得到公告），
    //   而面板自己还是 `body` 里没 position 的 flex 子项，绝不会浮到画布上去。
    //   `top/right/bottom` 代替 `inset`：左边那一份让给面板。拿不到变量时按 `0px`
    //   （= 老行为，铺满整屏）。
    const overlay = el(
      doc,
      'div',
      `position:fixed;left:var(--board-w,0px);top:0;right:0;bottom:0;z-index:50;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at top,#16304f 0%,#0b1622 70%);font-family:${FONT};color:#e9eef7;overflow:auto`,
    );
    overlay.id = 'foyer';
    // 卡片按**门厅自己的宽度**收（不是 `100vw`）：面板展开时门厅只剩右边那一块，
    // 手机竖屏那种窄条上 360px 的卡片要能跟着缩，不许溢出到面板底下。
    const card = el(
      doc,
      'div',
      'width:360px;max-width:calc(100% - 32px);box-sizing:border-box;margin:16px auto;padding:22px 20px;border-radius:12px;background:#17304f;border:1px solid #2b4a70;box-shadow:0 10px 34px rgba(0,0,0,.45)',
    );
    overlay.append(card);
    doc.body.append(overlay);

    // ── 列表页的状态（离开列表页时一并收掉）──
    let name = loadName(storage);
    let socket: FoyerSocket | null = null;
    let listActive = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ageTimer: ReturnType<typeof setInterval> | null = null;
    let rooms: RoomSummary[] | null = null;
    let roomsAt = 0;
    let listError = '';
    let notice = opts.notice ?? '';
    let renderList: () => void = () => {};
    /**
     * ★ 聯機存檔（v6）：列表頁的哪一塊 —— 房間列表 / 「建立房間」的兩個選項 / 存檔列表 / 認領空座。
     * 共用同一條連線（存檔列表也是從它要的）。
     */
    let panel: { kind: 'rooms' } | { kind: 'create' } | { kind: 'saves' } | { kind: 'claim'; room: RoomSummary } = {
      kind: 'rooms',
    };
    let saves: SaveSummary[] | null = null;
    let savesAt = 0;
    let askSaves: () => void = () => {};
    let delSave: (id: string) => void = () => {};
    /** 正在問「確定刪除？」的那一份 */
    let confirmDelete: string | null = null;

    const stopList = (): void => {
      listActive = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (ageTimer !== null) clearInterval(ageTimer);
      retryTimer = null;
      ageTimer = null;
      const s = socket;
      socket = null;
      if (s !== null) {
        s.onclose = null;
        s.onmessage = null;
        try {
          s.close();
        } catch {
          /* 已经关了 */
        }
      }
    };

    /** 关掉覆盖层再 resolve —— 顺序反了会让它盖在標題画面 / 大厅上 */
    const finish = (choice: FoyerChoice): void => {
      stopList();
      overlay.remove();
      resolve(choice);
    };

    const connectList = (): void => {
      if (!listActive) return;
      let s: FoyerSocket;
      try {
        s = openSocket(opts.wsUrl);
      } catch {
        listError = '連不上伺服器，稍後自動重試…';
        renderList();
        retryTimer = setTimeout(connectList, LIST_RETRY_MS);
        return;
      }
      socket = s;
      const client = new RoomListClient(
        { send: (text) => s.send(text) },
        {
          clientId: opts.clientId,
          onRooms: (next) => {
            rooms = next;
            roomsAt = Date.now();
            listError = '';
            renderList();
          },
          onSaves: (next) => {
            saves = next;
            savesAt = Date.now();
            renderList();
          },
          onError: (message) => {
            listError = message.includes('版本')
              ? `${message} —— 請重新整理網頁（Ctrl+F5 / 下拉刷新）`
              : `伺服器：${message}`;
            renderList();
          },
        },
      );
      s.onopen = () => {
        client.subscribe();
        if (panel.kind === 'saves') client.listSaves();
      };
      askSaves = () => {
        if (socket === s) client.listSaves();
      };
      delSave = (id) => {
        if (socket === s) client.deleteSave(id);
      };
      s.onmessage = (ev) => client.receive(String(ev.data));
      s.onerror = () => {
        /* onclose 会跟着来 */
      };
      s.onclose = () => {
        if (socket !== s || !listActive) return;
        socket = null;
        listError = '與伺服器斷線，2 秒後重連…';
        renderList();
        retryTimer = setTimeout(connectList, LIST_RETRY_MS);
      };
      // 「重新整理」要能在连着的时候直接再要一份
      refresh = () => {
        if (socket === s) client.subscribe();
      };
    };
    let refresh: () => void = () => {};

    // ============================================================
    //  首页
    // ============================================================
    const showHome = (): void => {
      stopList();
      card.replaceChildren();
      card.style.width = '360px';
      card.append(
        el(doc, 'h1', `margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:3px;color:${GOLD}`, '大富翁4 重製版'),
        el(doc, 'p', 'margin:0 0 18px;font-size:12px;color:#a9bcd4', '先取個暱稱，再選怎麼玩。'),
      );
      const nameLabel = el(doc, 'label', 'display:block;font-size:13px;color:#a9bcd4;margin-bottom:6px', '你的暱稱');
      const nameInput = el(doc, 'input', INPUT);
      nameInput.type = 'text';
      nameInput.maxLength = 24;
      nameInput.value = name;
      nameInput.placeholder = `1~${MAX_NAME_CODE_POINTS} 個字`;
      nameInput.id = 'foyer-name';
      nameLabel.htmlFor = 'foyer-name';
      const err = el(doc, 'p', 'margin:8px 0 0;font-size:12px;color:#ff9d9d;min-height:1em');

      const solo = entryButton(doc, '單人模式', '和電腦對戰；存檔在這台瀏覽器裡');
      solo.id = 'foyer-solo';
      const online = entryButton(
        doc,
        '在線聯機',
        invite !== null ? `你收到了房間邀請（${invite}），點這裡直接進入` : '看看朋友開了哪些房間，或者自己開一間',
      );
      online.id = 'foyer-online';
      const entries = el(doc, 'div', 'display:flex;flex-direction:column;gap:10px;margin-top:14px');
      entries.append(solo, online);
      card.append(
        nameLabel,
        nameInput,
        err,
        entries,
      );
      const hd = opts.hd;
      if (hd !== undefined) {
        const row = el(doc, 'label', 'display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:12px;color:#a9bcd4;cursor:pointer;line-height:1.5');
        const box = el(doc, 'input', 'margin:2px 0 0;flex:none;cursor:pointer');
        box.type = 'checkbox';
        box.id = 'foyer-hd';
        box.checked = hd.on;
        box.addEventListener('change', () => hd.set(box.checked));
        row.append(box, el(doc, 'span', '', '高清畫面（文字更清晰、部分美術AI重繪；手機發燙可以關掉）'));
        card.append(row);
      }

      /** 名字过了才返回它；顺便存起来 */
      const takeName = (): string | null => {
        const checked = validateName(nameInput.value);
        if (!checked.ok) {
          err.textContent = checked.message;
          nameInput.focus();
          return null;
        }
        saveName(storage, checked.name);
        name = checked.name;
        return checked.name;
      };
      solo.addEventListener('click', () => {
        const n = takeName();
        if (n !== null) finish({ kind: 'solo', name: n });
      });
      online.addEventListener('click', () => {
        const n = takeName();
        if (n === null) return;
        // 旧邀请链接：直接进那一间（它若已经解散，`main.ts` 会带着提示把人送回列表）
        if (invite !== null) finish({ kind: 'online', room: invite, name: n, mode: 'join' });
        else showRooms();
      });
      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') online.click();
      });
      nameInput.focus();
    };

    // ============================================================
    //  房间列表
    // ============================================================
    const showRooms = (): void => {
      stopList();
      card.replaceChildren();
      card.style.width = '560px';
      const header = el(doc, 'div', 'display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap');
      const title = el(doc, 'h1', `margin:0;font-size:20px;font-weight:700;letter-spacing:2px;color:${GOLD}`, '在線聯機');
      title.id = 'foyer-title';
      header.append(title, el(doc, 'span', 'font-size:12px;color:#a9bcd4', `暱稱：${name}`));
      const noticeEl = el(
        doc,
        'p',
        'margin:10px 0 0;padding:8px 10px;border-radius:6px;background:#4a2a1a;border:1px solid #8a5a2a;font-size:12px;color:#ffd9a8',
      );
      noticeEl.id = 'foyer-notice';
      const errEl = el(doc, 'p', 'margin:8px 0 0;font-size:12px;color:#ff9d9d;min-height:1em');
      errEl.id = 'foyer-list-error';
      const head = el(
        doc,
        'div',
        'display:flex;gap:8px;padding:6px 10px;margin-top:6px;font-size:11px;color:#7f92aa;border-bottom:1px solid #2b4a70',
      );
      head.append(
        el(doc, 'span', 'flex:1 1 auto', '房主'),
        el(doc, 'span', 'flex:0 0 56px;text-align:center', '人數'),
        el(doc, 'span', 'flex:0 0 64px;text-align:center', '狀態'),
        el(doc, 'span', 'flex:0 0 84px;text-align:right', ''),
      );
      const list = el(doc, 'div', 'max-height:min(52vh,360px);overflow-y:auto');
      list.id = 'foyer-rooms';

      const create = button(doc, BTN_MAIN, '建立房間');
      create.id = 'foyer-create';
      const reload = button(doc, BTN, '重新整理');
      reload.id = 'foyer-refresh';
      const back = button(doc, BTN, '返回');
      back.id = 'foyer-back';
      const footer = el(doc, 'div', 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap');
      const spacer = el(doc, 'div', 'flex:1 1 auto');
      footer.append(create, spacer, reload, back);

      card.append(header, noticeEl, errEl, head, list, footer);

      renderList = () => {
        noticeEl.textContent = notice;
        noticeEl.style.display = notice === '' ? 'none' : 'block';
        errEl.textContent = listError;
        list.replaceChildren();
        const onRooms = panel.kind === 'rooms';
        head.style.display = onRooms ? 'flex' : 'none';
        title.textContent =
          panel.kind === 'rooms'
            ? '在線聯機'
            : panel.kind === 'create'
              ? '建立房間'
              : panel.kind === 'saves'
                ? '從存檔繼續'
                : '認領座位';
        create.style.display = onRooms ? '' : 'none';
        reload.style.display = panel.kind === 'create' || panel.kind === 'claim' ? 'none' : '';
        if (panel.kind === 'create') {
          renderCreate();
          return;
        }
        if (panel.kind === 'saves') {
          renderSaves();
          return;
        }
        if (panel.kind === 'claim') {
          renderClaim(panel.room);
          return;
        }
        if (rooms === null) {
          list.append(el(doc, 'p', 'margin:18px 0;text-align:center;font-size:13px;color:#a9bcd4', '正在讀取房間列表…'));
          return;
        }
        if (rooms.length === 0) {
          const empty = el(doc, 'div', 'margin:22px 0;text-align:center;font-size:13px;color:#a9bcd4;line-height:1.7');
          empty.append(
            el(doc, 'div', 'font-size:15px;color:#e9eef7', '目前沒有可以加入的房間'),
            el(doc, 'div', '', '按「建立房間」開一間 —— 朋友打開網站、點「在線聯機」就會在這裡看到。'),
          );
          empty.id = 'foyer-empty';
          list.append(empty);
          return;
        }
        const elapsed = Date.now() - roomsAt;
        for (const r of rooms) {
          const act = rowAction(r);
          const row = el(
            doc,
            'div',
            `display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #22405f;${act.enabled ? '' : 'opacity:.8'}`,
          );
          row.dataset.room = r.id;
          const who = el(doc, 'div', 'flex:1 1 auto;min-width:0');
          who.append(
            el(
              doc,
              'div',
              'font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
              `${r.host} 的房間`,
            ),
            el(
              doc,
              'div',
              'margin-top:2px;font-size:11px;color:#7f92aa',
              `${mapLabel(r.globalMapId)} · ${formatAge(r.ageMs + elapsed)} · #${r.id}`,
            ),
          );
          const count = el(doc, 'div', 'flex:0 0 56px;text-align:center;font-size:15px;font-variant-numeric:tabular-nums', countLabel(r));
          const status = el(
            doc,
            'div',
            `flex:0 0 64px;text-align:center;font-size:12px;color:${r.started ? '#ffb27a' : '#8fe3a0'}`,
            statusLabel(r),
          );
          const go = button(
            doc,
            `${act.kind === 'rejoin' ? BTN_MAIN : BTN};flex:0 0 84px;padding:8px 6px;font-size:13px${act.enabled ? '' : ';cursor:default;background:#1a2d44;color:#9fb0c6;border-color:#2b4a70'}`,
            act.label,
          );
          go.disabled = !act.enabled;
          go.addEventListener('click', () => {
            if (!act.enabled) return;
            // ★ 聯機存檔（v6）：已開局的存檔房 ⇒ 先挑要認領哪一座
            if (act.kind === 'claim') {
              panel = { kind: 'claim', room: r };
              renderList();
              return;
            }
            finish({ kind: 'online', room: r.id, name, mode: 'join' });
          });
          row.append(who, count, status, go);
          list.append(row);
        }
      };

      /** 「建立房間」：新遊戲 / 從存檔繼續 */
      const renderCreate = (): void => {
        const box = el(doc, 'div', 'display:flex;flex-direction:column;gap:10px;margin:14px 0 4px');
        const fresh = entryButton(doc, '新遊戲', '自己當房主，在大廳裡選地圖、角色與開局設定');
        fresh.id = 'foyer-new-game';
        const resume = entryButton(doc, '從存檔繼續', '伺服器上的存檔（每過一天自動存一份，房主也可以手動存）');
        resume.id = 'foyer-from-save';
        fresh.addEventListener('click', () => {
          finish({ kind: 'online', room: newRoomCode(random), name, mode: 'create' });
        });
        resume.addEventListener('click', () => {
          panel = { kind: 'saves' };
          saves = null;
          askSaves();
          renderList();
        });
        box.append(fresh, resume);
        list.append(box);
      };

      /** 存檔列表 */
      const renderSaves = (): void => {
        if (saves === null) {
          list.append(el(doc, 'p', 'margin:18px 0;text-align:center;font-size:13px;color:#a9bcd4', '正在讀取存檔…'));
          return;
        }
        if (saves.length === 0) {
          const empty = el(doc, 'div', 'margin:22px 0;text-align:center;font-size:13px;color:#a9bcd4;line-height:1.7');
          empty.id = 'foyer-saves-empty';
          empty.append(
            el(doc, 'div', 'font-size:15px;color:#e9eef7', '伺服器上還沒有存檔'),
            el(doc, 'div', '', '聯機玩的時候每過一天會自動存一份；房主也可以在遊戲裡按「儲存進度」存一份。'),
          );
          list.append(empty);
          return;
        }
        const elapsed = Date.now() - savesAt;
        for (const sv of saves) {
          const row = el(doc, 'div', 'display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #22405f');
          row.dataset.save = sv.id;
          const info = el(doc, 'div', 'flex:1 1 auto;min-width:0');
          const top = el(doc, 'div', 'font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
          top.append(
            el(
              doc,
              'span',
              `display:inline-block;margin-right:6px;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;${
                sv.kind === 'auto' ? 'background:#22405f;color:#a9bcd4' : 'background:#7a5a14;color:#fff3d0'
              }`,
              sv.kind === 'auto' ? '自動' : '手動',
            ),
            doc.createTextNode(sv.name),
          );
          const seatsLine = sv.seats
            .map((st) => `${seatLabel(st.character, st.kind === 'computer' ? '電腦' : st.name)}${st.mine ? '・你' : ''}${st.alive ? '' : '・破產'}`)
            .join('　');
          info.append(
            top,
            el(
              doc,
              'div',
              'margin-top:2px;font-size:11px;color:#7f92aa',
              `${mapLabel(sv.globalMapId)} · ${saveDateLabel(sv)} · 存於${formatAge(sv.ageMs + elapsed)}`,
            ),
            el(doc, 'div', 'margin-top:3px;font-size:12px;color:#c9d4e2;line-height:1.5', seatsLine),
          );
          const go = button(doc, `${BTN_MAIN};padding:8px 6px;font-size:13px`, '選這個');
          go.addEventListener('click', () => {
            finish({ kind: 'online', room: newRoomCode(random), name, mode: 'create', fromSave: sv.id });
          });
          const actions = el(doc, 'div', 'flex:0 0 84px;display:flex;flex-direction:column;gap:6px');
          actions.append(go);
          // ★ 刪除：只給存檔裡坐過的人（服務器同一個判據），而且要再按一次確認
          if (canDeleteSave(sv)) {
            const small = `${BTN};padding:5px 6px;font-size:12px`;
            if (confirmDelete === sv.id) {
              const yes = button(doc, `${small};background:#6a2020;border-color:#b04040`, '確定刪除');
              yes.dataset.confirmDelete = sv.id;
              const no = button(doc, small, '取消');
              yes.addEventListener('click', () => {
                confirmDelete = null;
                delSave(sv.id);
              });
              no.addEventListener('click', () => {
                confirmDelete = null;
                renderList();
              });
              actions.append(yes, no);
            } else {
              const del = button(doc, small, '刪除');
              del.dataset.deleteSave = sv.id;
              del.addEventListener('click', () => {
                confirmDelete = sv.id;
                renderList();
              });
              actions.append(del);
            }
          }
          row.append(info, actions);
          list.append(row);
        }
      };

      /** 已開局的存檔房：挑一個電腦代打中的空座認領 */
      const renderClaim = (r: RoomSummary): void => {
        list.append(
          el(
            doc,
            'p',
            'margin:12px 0 6px;font-size:13px;color:#a9bcd4;line-height:1.6',
            `「${r.host} 的房間」已經開局了。下面這些座位現在由電腦代打 —— 選你原來的那一座接回來：`,
          ),
        );
        for (const v of r.vacant ?? []) {
          const b = button(doc, `${BTN};display:block;width:100%;margin-top:8px;text-align:left`, `這是我：${seatLabel(v.character, v.name)}`);
          b.dataset.seat = String(v.seat);
          b.addEventListener('click', () => {
            finish({ kind: 'online', room: r.id, name, mode: 'join', claimSeat: v.seat });
          });
          list.append(b);
        }
      };

      create.addEventListener('click', () => {
        panel = { kind: 'create' };
        renderList();
      });
      reload.addEventListener('click', () => {
        notice = '';
        if (socket === null) {
          if (retryTimer !== null) clearTimeout(retryTimer);
          retryTimer = null;
          connectList();
        } else if (panel.kind === 'saves') askSaves();
        else refresh();
        renderList();
      });
      back.addEventListener('click', () => {
        notice = '';
        // 子頁先回房間列表，房間列表再回首頁
        if (panel.kind !== 'rooms') {
          panel = { kind: 'rooms' };
          renderList();
          return;
        }
        showHome();
      });

      listActive = true;
      panel = { kind: 'rooms' };
      rooms = null;
      listError = '';
      renderList();
      ageTimer = setInterval(() => renderList(), AGE_TICK_MS);
      connectList();
    };

    // 从大厅退回来 / 进房失败退回来：名字还在就直接停在列表上
    if (opts.view === 'rooms' && validateName(name).ok) showRooms();
    else showHome();
  });
}
