/*
 * 房間列表 —— 「在線聯機」點進去看到的那一頁的**純邏輯**與傳輸（協議 v5）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方 2026-09-23：「改成單人模式 / 在線聯機兩個入口，在線聯機點進去展示房間列表……
 *   這樣朋友們不需要再傳遞那個很麻煩的邀請碼」。
 *
 * ★ 為什麼走 WebSocket 推送而不是 `GET /api/rooms` 輪詢：
 *   · 門（`gate.ts` 的訪問密碼）已經守在 WebSocket 升級口上，不用再多開一條 HTTP 路由、再驗一次；
 *   · 變化是**事件**（有人進房、房主按開始）—— 推送是即時的，輪詢要麼慢（2 秒）要麼吵；
 *   · 列表要按**看的人**算「你在這桌有斷線中的座位 ⇒ 重新連線」，這要 `clientId`：
 *     放進 WebSocket 消息體裡，不會出現在 URL / 訪問日誌裡。
 *
 * ★ 這個文件只有純函數 + 一個與傳輸無關的小客戶端（與 `NetClient` 同一個寫法：
 *   只要一個 `send(text)`，收到的文本交給 `receive(text)`）—— 單測見 `room-list.test.ts`。
 *   DOM 在 `foyer.ts`。
 */

import {
  PROTOCOL_VERSION,
  roomJoinability,
  type RoomJoinability,
  type RoomSummary,
  type SaveSummary,
} from '@rich4/core';
import { characterById } from '@rich4/data';

/**
 * 八張地圖的名字（`globalMapId` 0..7 = 舞台×4 + 地圖）。
 *
 * @source `setup.ts` `defaultSetup` 的注釋（舞台 0 = 台灣/中國/日本/U.S.A，
 *   舞台 1 = 星際/古代/恐龍/海島）與 `assets.ts` `setupSceneResource` 的注釋
 *   （TAIWAN/CHINA/JAPAN/U.S.A 與 STAR/ANCIENT/DINOSAUR/ISLAND）。
 *   只用在本項目自己的房間列表上，不進任何復刻屏。
 */
export const MAP_LABELS: readonly string[] = ['台灣', '中國', '日本', 'U.S.A', '星際', '古代', '恐龍', '海島'];

export function mapLabel(globalMapId: number): string {
  return MAP_LABELS[globalMapId] ?? `地圖 ${globalMapId}`;
}

/** 「建立了多久」—— 一分鐘內叫「剛剛」，一小時內按分鐘，再往上按小時 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '剛剛';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} 分鐘前`;
  return `${Math.floor(min / 60)} 小時前`;
}

/** 狀態欄那兩個字 */
export function statusLabel(r: Pick<RoomSummary, 'started'>): string {
  return r.started ? '遊戲中' : '等待加入';
}

/** 一行右邊那顆按鈕：字、能不能按 */
export interface RowAction {
  kind: RoomJoinability;
  label: string;
  enabled: boolean;
}

const ACTION_LABELS: Record<RoomJoinability, string> = {
  join: '加入',
  rejoin: '重新連線',
  // ★ 聯機存檔（v6）：已開局的存檔房裡還有電腦代打的空座
  claim: '認領座位',
  full: '已滿',
  // 狀態欄已經寫了「遊戲中」，按鈕上再寫一次是廢話 —— 說清楚「為什麼按不了」
  playing: '無法加入',
};

/** 判據與服務器同一個（core 的 `roomJoinability`）；這裡只配字 */
export function rowAction(r: RoomSummary): RowAction {
  const kind = roomJoinability(r);
  return { kind, label: ACTION_LABELS[kind], enabled: kind === 'join' || kind === 'rejoin' || kind === 'claim' };
}

/** 排序的組別：能回去的 > 能加入的 > 能認領空座的 > 滿了的 > 遊戲中的 */
const GROUP: Record<RoomJoinability, number> = { rejoin: 0, join: 1, claim: 2, full: 3, playing: 4 };

/**
 * 列表排序：先按組（見 `GROUP`），組內**新建的在上**（`ageMs` 小的在前），最後按房間碼定序。
 *
 * ★ 最後那一級不是可有可無：兩間同一毫秒建的房（測試裡很常見）不定序的話，
 *   每推一次列表兩行就可能對調一次，點的人會點錯。
 */
export function sortRooms(rooms: readonly RoomSummary[]): RoomSummary[] {
  return [...rooms].sort((a, b) => {
    const g = GROUP[roomJoinability(a)] - GROUP[roomJoinability(b)];
    if (g !== 0) return g;
    if (a.ageMs !== b.ageMs) return a.ageMs - b.ageMs;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 人數欄：`1 / 4` */
export function countLabel(r: Pick<RoomSummary, 'humans' | 'seatCount'>): string {
  return `${r.humans} / ${r.seatCount}`;
}

const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * 網路來的一行 → `RoomSummary`；形狀不對返回 `null`（整條丟掉，不讓一行壞資料把整頁畫壞）。
 */
export function parseRoomSummary(raw: unknown): RoomSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.host !== 'string') return null;
  if (!isNat(r.humans) || !isNat(r.seatCount) || !isNat(r.globalMapId)) return null;
  if (typeof r.started !== 'boolean' || typeof r.rejoin !== 'boolean') return null;
  const ageMs = typeof r.ageMs === 'number' && Number.isFinite(r.ageMs) ? Math.max(0, r.ageMs) : 0;
  const vacant = Array.isArray(r.vacant)
    ? r.vacant.flatMap((v: unknown) => {
        const o = v as Record<string, unknown> | null;
        return o !== null && typeof o === 'object' && isNat(o.seat) && typeof o.name === 'string' && isNat(o.character)
          ? [{ seat: o.seat, name: o.name, character: o.character }]
          : [];
      })
    : [];
  return {
    id: r.id,
    host: r.host,
    humans: r.humans,
    seatCount: r.seatCount,
    started: r.started,
    globalMapId: r.globalMapId,
    ageMs,
    rejoin: r.rejoin,
    ...(r.fromSave === true ? { fromSave: true } : {}),
    ...(vacant.length === 0 ? {} : { vacant }),
  };
}

/**
 * 網路來的一份存檔摘要 → `SaveSummary`；形狀不對返回 `null`。
 */
export function parseSaveSummary(raw: unknown): SaveSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  if (r.kind !== 'auto' && r.kind !== 'manual') return null;
  for (const k of ['globalMapId', 'year', 'month', 'day', 'turnCount'] as const) if (!isNat(r[k])) return null;
  if (!Array.isArray(r.seats)) return null;
  const seats: SaveSummary['seats'] = [];
  for (const v of r.seats) {
    const o = v as Record<string, unknown> | null;
    if (o === null || typeof o !== 'object') return null;
    if (!isNat(o.seat) || typeof o.name !== 'string' || !isNat(o.character)) return null;
    if (o.kind !== 'human' && o.kind !== 'computer') return null;
    seats.push({
      seat: o.seat,
      name: o.name,
      character: o.character,
      kind: o.kind,
      mine: o.mine === true,
      alive: o.alive !== false,
    });
  }
  const ageMs = typeof r.ageMs === 'number' && Number.isFinite(r.ageMs) ? Math.max(0, r.ageMs) : 0;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    ageMs,
    globalMapId: r.globalMapId as number,
    year: r.year as number,
    month: r.month as number,
    day: r.day as number,
    turnCount: r.turnCount as number,
    seats,
  };
}

/** 存檔 / 空座上的一個座位怎麼叫：「角色（暱稱）」；角色名表缺就只給暱稱 */
export function seatLabel(character: number, name: string): string {
  const c = characterById(character)?.name;
  return c === undefined ? name : `${c}（${name}）`;
}

/** 存檔列表那一行的日期：「2010 年 3 月 5 日 · 第 42 回合」 */
export function saveDateLabel(s: Pick<SaveSummary, 'year' | 'month' | 'day' | 'turnCount'>): string {
  return `${s.year} 年 ${s.month} 月 ${s.day} 日 · 第 ${s.turnCount} 回合`;
}

// ============================================================
//  傳輸：訂閱列表
// ============================================================

export interface RoomListSocket {
  send(text: string): void;
}

export interface RoomListClientOptions {
  clientId: string;
  /** 一份新的列表（整份替換；已排好序）*/
  onRooms(rooms: RoomSummary[]): void;
  /** ★ 聯機存檔（v6）：`listSaves` 的答覆（新的在前）*/
  onSaves?(saves: SaveSummary[]): void;
  onError?(message: string): void;
}

/**
 * 房間列表的客戶端 —— 連上之後 `subscribe()`，服務器每變一次就推一份。
 *
 * ★ 「重新整理」也是 `subscribe()`：服務器收到會把這條連接的「上次推過什麼」清掉、立刻再推一份。
 */
export class RoomListClient {
  readonly #socket: RoomListSocket;
  readonly #opts: RoomListClientOptions;

  constructor(socket: RoomListSocket, opts: RoomListClientOptions) {
    this.#socket = socket;
    this.#opts = opts;
  }

  subscribe(): void {
    this.#socket.send(JSON.stringify({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: this.#opts.clientId }));
  }

  /** ★ 聯機存檔（v6）：要一份存檔列表 */
  listSaves(): void {
    this.#socket.send(JSON.stringify({ t: 'listSaves', version: PROTOCOL_VERSION, clientId: this.#opts.clientId }));
  }

  receive(text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as { t?: unknown; rooms?: unknown; saves?: unknown; message?: unknown };
    if (m.t === 'saves' && Array.isArray(m.saves)) {
      const saves: SaveSummary[] = [];
      for (const raw of m.saves) {
        const sv = parseSaveSummary(raw);
        if (sv !== null) saves.push(sv);
      }
      this.#opts.onSaves?.(saves);
      return;
    }
    if (m.t === 'rooms' && Array.isArray(m.rooms)) {
      const rooms: RoomSummary[] = [];
      for (const raw of m.rooms) {
        const r = parseRoomSummary(raw);
        if (r !== null) rooms.push(r);
      }
      this.#opts.onRooms(sortRooms(rooms));
      return;
    }
    if (m.t === 'error' && typeof m.message === 'string') this.#opts.onError?.(m.message);
  }
}
