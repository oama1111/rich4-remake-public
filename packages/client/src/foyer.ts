/*
 * 门厅 —— 名字、建立 / 加入房间、邀请链接（W-73）
 * SPDX-License-Identifier: GPL-3.0-or-later
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
} from '@rich4/core';

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
/** 邀请链接用的查询参数名 */
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

/** 输入框里那一串 → 房间码：**去空格、转大写**（任务书 W-73 §1） */
export function normalizeRoomCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** 填进输入框的就是一个合法房间码吗 */
export function looksLikeRoomCode(raw: string): boolean {
  return isRoomCode(normalizeRoomCode(raw));
}

/** 邀请链接：`https://<host>/?room=<码>` */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?${ROOM_PARAM}=${code}`;
}

/** 从 `location.search` 里读邀请码；没有 / 不合法返回 `null` */
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

// ============================================================
//  覆盖层
// ============================================================

export interface FoyerChoice {
  kind: 'solo' | 'online';
  /** `kind === 'online'` 时有值 */
  room: string;
  name: string;
}

export interface FoyerOptions {
  /** `?room=XXXXXX` —— 有值就直接停在「加入」并填好（任务书 W-73 §1） */
  inviteRoom?: string | null;
  storage?: FoyerStorage | null;
  random?: RandomBytes;
  doc?: Document;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif";

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

const BTN = `flex:1 1 0;padding:11px 10px;font:600 14px/1.2 ${FONT};border:1px solid #3a5a83;border-radius:8px;background:#22405f;color:#e9eef7;cursor:pointer`;
const INPUT = `width:100%;box-sizing:border-box;padding:9px 10px;font:14px/1.4 ${FONT};border-radius:6px;border:1px solid #3a5a83;background:#0e2138;color:#e9eef7`;

/**
 * 弹门厅；玩家选完（或输了房间码）之后 resolve。
 *
 * 三个入口（任务书 W-73 §1）：**單機遊戲** / **建立房間** / **加入房間**。
 */
export function showFoyer(opts: FoyerOptions = {}): Promise<FoyerChoice> {
  const doc = opts.doc ?? document;
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const random = opts.random ?? defaultRandom;
  const invite = opts.inviteRoom ?? null;

  return new Promise<FoyerChoice>((resolve) => {
    const overlay = el(
      doc,
      'div',
      `position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:#0b1622;font-family:${FONT};color:#e9eef7`,
    );
    const card = el(
      doc,
      'div',
      'width:340px;max-width:92vw;padding:24px 22px;border-radius:12px;background:#17304f;border:1px solid #2b4a70;box-shadow:0 10px 34px rgba(0,0,0,.45)',
    );
    card.append(
      el(doc, 'h1', 'margin:0 0 4px;font-size:19px;font-weight:600;letter-spacing:1px', '大富翁4 重製版'),
      el(doc, 'p', 'margin:0 0 18px;font-size:12px;color:#a9bcd4', '和朋友一起玩（各自要有原版素材）'),
    );

    const nameLabel = el(doc, 'label', 'display:block;font-size:13px;color:#a9bcd4;margin-bottom:6px', '你的名字');
    const nameInput = el(doc, 'input', INPUT);
    nameInput.type = 'text';
    nameInput.maxLength = 24;
    nameInput.value = loadName(storage);
    nameInput.placeholder = '1~12 個字';
    nameLabel.htmlFor = 'foyer-name';
    nameInput.id = 'foyer-name';

    const roomLabel = el(doc, 'label', 'display:block;font-size:13px;color:#a9bcd4;margin:14px 0 6px', '房間碼');
    const roomInput = el(doc, 'input', INPUT);
    roomInput.type = 'text';
    roomInput.maxLength = 12;
    roomInput.value = invite ?? '';
    roomInput.placeholder = '6 位，例如 K7M2QP';
    roomInput.id = 'foyer-room';

    const err = el(doc, 'p', 'margin:10px 0 0;font-size:12px;color:#ff9d9d;min-height:1em');
    const hint = el(
      doc,
      'p',
      'margin:12px 0 0;font-size:11px;color:#7f92aa;line-height:1.5',
      '建立房間之後，把生成的連結發給朋友即可。',
    );

    const soloBtn = el(doc, 'button', BTN, '單機遊戲');
    const makeBtn = el(doc, 'button', BTN, '建立房間');
    const joinBtn = el(doc, 'button', BTN, '加入房間');
    for (const b of [soloBtn, makeBtn, joinBtn]) b.type = 'button';
    const row = el(doc, 'div', 'display:flex;gap:8px;margin-top:18px');
    row.append(soloBtn, makeBtn, joinBtn);

    const joinRow = el(doc, 'div', 'margin-top:4px');
    joinRow.append(roomLabel, roomInput);

    card.append(nameLabel, nameInput, err, row, joinRow, hint);
    overlay.append(card);
    doc.body.append(overlay);

    const fail = (message: string): void => {
      err.textContent = message;
    };
    /** 名字过了才 `true`；顺便把名字存起来 */
    const takeName = (): string | null => {
      const checked = validateName(nameInput.value);
      if (!checked.ok) {
        fail(checked.message);
        nameInput.focus();
        return null;
      }
      saveName(storage, checked.name);
      return checked.name;
    };
    /** 关掉覆盖层再 resolve —— 顺序反了会让它盖在標題画面上 */
    const finish = (choice: FoyerChoice): void => {
      overlay.remove();
      resolve(choice);
    };

    soloBtn.addEventListener('click', () => {
      const name = takeName();
      if (name === null) return;
      finish({ kind: 'solo', room: '', name });
    });
    makeBtn.addEventListener('click', () => {
      const name = takeName();
      if (name === null) return;
      const code = newRoomCode(random);
      hint.textContent = `房間 ${code}：把邀請連結發給朋友，他們點開就能進。`;
      finish({ kind: 'online', room: code, name });
    });
    joinBtn.addEventListener('click', () => {
      const name = takeName();
      if (name === null) return;
      const code = normalizeRoomCode(roomInput.value);
      if (!isRoomCode(code)) {
        fail('房間碼要 6 位（字母沒有 I/O，數字沒有 0/1）');
        roomInput.focus();
        return;
      }
      finish({ kind: 'online', room: code, name });
    });
    // 邀请链接进来的：直接停在「加入」，光标放名字上（房间码已经填好）
    nameInput.focus();
    if (invite !== null) roomInput.value = invite;
  });
}
