/*
 * 聯機存檔 —— 存在**服務器**上的局面（協議 v6）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方 2026-09-23 批准的設計：房間只活在服務器記憶體裡（種子 + 開局設定 + action 日誌），
 *   服務器一重啟 / 一部署就全沒了；遊戲內的「存檔」只寫本機瀏覽器。⇒ 服務器自己存一份。
 *
 * ★ 存的是**局面快照**（`serializeGame(mirror)`），不是「種子 + 整串 action」：
 *   · 部署之後規則代碼可能改過（修 bug）—— 拿舊的 action 日誌在新代碼上重放，
 *     有可能走岔甚至半路出現「非法 action」，整份存檔就廢了；快照不受這個影響；
 *   · 大小固定（一局 ≈ 15 KB），不隨回合數增長；載入是 O(1)；
 *   · 無損：`serializeGame` 本來就是單機存檔的格式，C-DET-4（存了再讀、之後逐字節一致）
 *     在 core 有測試釘著；聯機這邊 `saves.test.ts` 再釘一次「讀回來繼續打 = 沒存過繼續打」。
 *
 * ★ 存檔裡**有 `clientId`**（開局時要靠它把原來的人認回原座位）—— 所以存檔檔案是服務器私有的
 *   （目錄 0750、檔案 0640），任何發給客戶端的東西都只給 `SaveSummary`（見 core `protocol.ts`）。
 */

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { LobbyOptions } from '@rich4/core';

/**
 * 服務器上最多留幾份存檔。超了**只刪最舊的自動存檔**；
 * 手動存檔**永不靜默刪除**（需求方 2026-09-24）—— 滿了就拒絕新的（`SaveFullError`），請玩家自己刪。
 */
export const SAVE_CAP = 30;

/** 存檔檔案格式版本 */
export const SAVE_STORE_FORMAT = 1;

export interface StoredSeat {
  seat: number;
  name: string;
  character: number;
  kind: 'human' | 'computer';
  /** 真人座位的身份令牌 —— **只在服務器上**，永不外發 */
  clientId: string | null;
}

export interface StoredSave {
  format: typeof SAVE_STORE_FORMAT;
  id: string;
  kind: 'auto' | 'manual';
  name: string;
  /** 寫出時刻（服務器時鐘，毫秒）*/
  savedAt: number;
  globalMapId: number;
  options: LobbyOptions;
  seats: StoredSeat[];
  /** `serializeGame(mirror)` */
  snapshot: string;
  /** 列表顯示用（免得列一次就把每份快照解析一遍）*/
  meta: { year: number; month: number; day: number; turnCount: number; alive: boolean[] };
}

/** 存檔的 id：只許字母數字與 `-`（它會變成檔名）*/
const SAVE_ID_RE = /^[A-Za-z0-9-]{1,48}$/;

export function isSaveId(v: unknown): v is string {
  return typeof v === 'string' && SAVE_ID_RE.test(v);
}

/** 一間房的自動存檔 id —— 每間房**只有一份**，每過一天覆蓋一次 */
export function autoSaveId(roomId: string): string {
  return `auto-${roomId}`;
}

/**
 * 超過上限時該刪哪幾份：**只刪最舊的自動存檔**（手動存檔一份都不動）。
 * 自動的刪光了還超 ⇒ 返回的清單不夠數，由 `put` 拒絕這次寫入。
 *
 * ★ 純函數（單測釘著）。`keep` = 這次剛寫進去的那一份，無論如何不刪它。
 */
export function pruneOrder(
  saves: readonly Pick<StoredSave, 'id' | 'kind' | 'savedAt'>[],
  cap: number,
  keep: string | null = null,
): string[] {
  const over = saves.length - cap;
  if (over <= 0) return [];
  const byAge = (a: { savedAt: number; id: string }, b: { savedAt: number; id: string }): number =>
    a.savedAt - b.savedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const candidates = saves.filter((s) => s.kind === 'auto' && s.id !== keep).sort(byAge);
  return candidates.slice(0, over).map((s) => s.id);
}

/** 存檔已滿（全是手動存檔、刪不出位子）—— hub 回給玩家「存檔已滿，請先刪除舊存檔」*/
export class SaveFullError extends Error {
  constructor() {
    super('存檔已滿，請先刪除舊存檔');
  }
}

/**
 * 寫入 `next` 之前算好要刪哪些；刪完仍超上限就拋 `SaveFullError`（**寫入前**判，不會寫了一半）。
 */
function planPut(existing: readonly StoredSave[], next: StoredSave, cap: number): string[] {
  const after = [...existing.filter((s) => s.id !== next.id), next];
  const drop = pruneOrder(after, cap, next.id);
  if (after.length - drop.length > cap) throw new SaveFullError();
  return drop;
}

/** 存檔倉庫 —— hub 只認這個介面（測試用記憶體版，生產用目錄版）*/
export interface SaveStore {
  /** 全部存檔（新的在前）*/
  list(): StoredSave[];
  get(id: string): StoredSave | null;
  /** 寫入（同 id 覆蓋）；超過上限就按 `pruneOrder` 刪自動存檔，刪不出位子拋 `SaveFullError` */
  put(save: StoredSave): void;
  /** 刪一份（不存在就什麼都不做）*/
  delete(id: string): void;
}

function newestFirst(a: StoredSave, b: StoredSave): number {
  return b.savedAt - a.savedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 只放記憶體（測試、以及沒給 `--saves` 時的「本次開機內有效」）*/
export class MemorySaveStore implements SaveStore {
  readonly #saves = new Map<string, StoredSave>();
  readonly #cap: number;

  constructor(cap = SAVE_CAP) {
    this.#cap = cap;
  }

  list(): StoredSave[] {
    return [...this.#saves.values()].sort(newestFirst);
  }

  get(id: string): StoredSave | null {
    return this.#saves.get(id) ?? null;
  }

  put(save: StoredSave): void {
    const drop = planPut([...this.#saves.values()], save, this.#cap);
    this.#saves.set(save.id, save);
    for (const id of drop) this.#saves.delete(id);
  }

  delete(id: string): void {
    this.#saves.delete(id);
  }
}

/** 讀一份存檔檔案；壞的 / 不是本格式的返回 `null`（跳過，不讓一份壞檔拖垮開機）*/
export function parseStoredSave(text: string): StoredSave | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<StoredSave>;
  if (s.format !== SAVE_STORE_FORMAT || !isSaveId(s.id)) return null;
  if (s.kind !== 'auto' && s.kind !== 'manual') return null;
  if (typeof s.name !== 'string' || typeof s.savedAt !== 'number' || typeof s.snapshot !== 'string') return null;
  if (typeof s.globalMapId !== 'number' || typeof s.options !== 'object' || s.options === null) return null;
  if (!Array.isArray(s.seats) || typeof s.meta !== 'object' || s.meta === null) return null;
  return s as StoredSave;
}

/**
 * 存在一個目錄裡：一份存檔一個 `<id>.json`。
 *
 * · 開機時把目錄整個讀進記憶體（上限 30 份 × 約 15 KB，不值得懶載入）；
 * · 寫入先寫 `.tmp` 再 `rename` —— 寫到一半斷電不會留下半份檔；
 * · 目錄 0750、檔案 0640：裡面有 `clientId`。
 */
export class FileSaveStore implements SaveStore {
  readonly #dir: string;
  readonly #mem: MemorySaveStore;
  readonly #cap: number;

  constructor(dir: string, cap = SAVE_CAP) {
    this.#dir = dir;
    this.#cap = cap;
    // 記憶體那份不自己刪（上限由這裡統一按檔案刪），所以給它一個不會觸發的上限
    this.#mem = new MemorySaveStore(Number.MAX_SAFE_INTEGER);
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const save = parseStoredSave(readFileSync(join(dir, file), 'utf8'));
      if (save !== null && `${save.id}.json` === file) this.#mem.put(save);
    }
  }

  list(): StoredSave[] {
    return this.#mem.list();
  }

  get(id: string): StoredSave | null {
    return this.#mem.get(id);
  }

  put(save: StoredSave): void {
    if (!isSaveId(save.id)) throw new Error(`存檔 id 不合法：${save.id}`);
    const drop = planPut(this.#mem.list(), save, this.#cap);
    const path = join(this.#dir, `${save.id}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(save), { mode: 0o640 });
    chmodSync(tmp, 0o640);
    renameSync(tmp, path);
    this.#mem.put(save);
    for (const id of drop) this.delete(id);
  }

  delete(id: string): void {
    if (!isSaveId(id)) return;
    rmSync(join(this.#dir, `${id}.json`), { force: true });
    this.#mem.delete(id);
  }
}
