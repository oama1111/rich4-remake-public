/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 聯機存檔（協議 v6）：倉庫、自動 / 手動存檔、從存檔建房、「這是我」/ 離座 / 認領座位、
 * 服務器重啟後接著打的確定性、開局日期
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  decideAction,
  defaultStartDate,
  deserializeGame,
  parseMap,
  reduce,
  roomJoinability,
  serializeGame,
  stateFingerprint,
  type Action,
  type ClientMessage,
  type GameState,
  type MapTopology,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type ClientHandle, type Conn } from './hub.ts';
import {
  FileSaveStore,
  MemorySaveStore,
  SAVE_CAP,
  SaveFullError,
  parseStoredSave,
  pruneOrder,
  type StoredSave,
} from './saves.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

class FakeConn implements Conn {
  readonly inbox: ServerMessage[] = [];
  closed = false;
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
  actions(): Action[] {
    return this.inbox.flatMap((m) => (m.t === 'action' ? [m.action] : []));
  }
}

interface Client {
  conn: FakeConn;
  h: ClientHandle;
  send(m: ClientMessage): void;
}
function client(hub: RoomHub): Client {
  const conn = new FakeConn();
  const h = hub.connect(conn);
  return { conn, h, send: (m) => h.onMessage(m) };
}
const join = (room: string, who: string, extra: Partial<Extract<ClientMessage, { t: 'join' }>> = {}): ClientMessage => ({
  t: 'join',
  version: PROTOCOL_VERSION,
  room,
  name: who,
  clientId: idFor(who),
  ...extra,
});

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(pjoin(tmpdir(), 'rich4-saves-'));
  tempDirs.push(d);
  return d;
}

function hubWith(saves: MemorySaveStore | FileSaveStore, now: { t: number }, map = loadMap()): RoomHub {
  return new RoomHub({
    map,
    globalMapId: 0,
    seedFor: () => 4242,
    now: () => now.t,
    turnMs: 0,
    saves,
    today: null,
  });
}

/** 真人座位的腳本：先把自己託管，之後每一步由 core 的 AI 拿主意（與 e2e.test.ts 同一個寫法）*/
function scripted(state: GameState, map: ReturnType<typeof loadMap>, seat: number): Action {
  const me = state.players[seat]!;
  if ((me.whoPlays & WHO_PLAYS_AUTOPILOT) === 0) {
    return { type: 'setAi', player: seat, whoPlays: me.whoPlays | WHO_PLAYS_AUTOPILOT };
  }
  const a = decideAction({ state, map });
  if (a === null) throw new Error(`座位 ${seat} 無決策：${state.phase}`);
  return a;
}

/** 輪到誰（真人、有連線）就讓誰照腳本出手；電腦 / 空座由服務器自己走。`until` 為真就停 */
function play(hub: RoomHub, roomId: string, seats: Map<number, Client>, map: ReturnType<typeof loadMap>, until: (s: GameState) => boolean): void {
  const room = hub.room(roomId)!;
  for (let guard = 0; guard < 50_000 && !until(room.state); guard++) {
    if (room.state.phase === 'gameOver') return;
    const c = seats.get(room.actingSeat);
    if (c === undefined) throw new Error(`輪到 ${room.actingSeat} 號座，但沒人能出手（${room.state.phase}）`);
    c.send({ t: 'intent', action: scripted(room.state, map, room.actingSeat) });
  }
}

const dayOf = (s: GameState): string => `${s.year}-${s.month}-${s.day}`;

// ============================================================

describe('★ 存檔倉庫', () => {
  const sv = (id: string, kind: 'auto' | 'manual', savedAt: number) => ({ id, kind, savedAt });

  it('pruneOrder：只刪最舊的自動存檔；手動存檔一份都不動（不夠數由 put 拒絕）；剛寫的那份不刪', () => {
    const saves = [sv('a1', 'auto', 1), sv('m1', 'manual', 0), sv('a2', 'auto', 5), sv('m2', 'manual', 3)];
    expect(pruneOrder(saves, 4)).toEqual([]);
    expect(pruneOrder(saves, 3)).toEqual(['a1']);
    expect(pruneOrder(saves, 2)).toEqual(['a1', 'a2']);
    expect(pruneOrder(saves, 1)).toEqual(['a1', 'a2']);
    expect(pruneOrder(saves, 2, 'a1')).toEqual(['a2']);
    expect(SAVE_CAP).toBe(30);
  });

  it('記憶體版：同 id 覆蓋；超過上限照 pruneOrder 刪', () => {
    const store = new MemorySaveStore(2);
    const mk = (id: string, kind: 'auto' | 'manual', savedAt: number): StoredSave => ({
      format: 1,
      id,
      kind,
      name: id,
      savedAt,
      globalMapId: 0,
      options: { seatCount: 2, fundIndex: 0, vehicle: 0, landTenure: 0, timeIndex: 0, victoryIndex: 0 },
      seats: [],
      snapshot: '{}',
      meta: { year: 2010, month: 1, day: 1, turnCount: 0, alive: [] },
    });
    store.put(mk('m1', 'manual', 1));
    store.put(mk('a1', 'auto', 2));
    store.put(mk('a1', 'auto', 3)); // 覆蓋
    expect(store.list().map((s) => s.id)).toEqual(['a1', 'm1']);
    store.put(mk('m2', 'manual', 4));
    expect(store.list().map((s) => s.id)).toEqual(['m2', 'm1']);
    // ★ 滿了、全是手動存檔 ⇒ 拒絕新的（手動 / 新 id 的自動都一樣），**一份都不刪**
    expect(() => store.put(mk('m3', 'manual', 5))).toThrow(SaveFullError);
    expect(() => store.put(mk('a9', 'auto', 6))).toThrow('存檔已滿');
    expect(store.list().map((s) => s.id)).toEqual(['m2', 'm1']);
    // 覆蓋同一份不增加份數 ⇒ 照樣寫得進去
    store.put(mk('m2', 'manual', 7));
    store.delete('m1');
    store.put(mk('m3', 'manual', 8));
    expect(store.list().map((s) => s.id)).toEqual(['m3', 'm2']);
  });

  it('★ 目錄版：寫得進去、重開讀得回來；檔案 0640、目錄 0750；壞檔 / 名字對不上的跳過；超過上限刪檔', () => {
    const dir = pjoin(tempDir(), 'saves');
    const store = new FileSaveStore(dir, 2);
    const mk = (id: string, kind: 'auto' | 'manual', savedAt: number): StoredSave => ({
      format: 1,
      id,
      kind,
      name: `存檔 ${id}`,
      savedAt,
      globalMapId: 3,
      options: { seatCount: 2, fundIndex: 1, vehicle: 0, landTenure: 0, timeIndex: 0, victoryIndex: 0 },
      seats: [{ seat: 0, name: '小明', character: 4, kind: 'human', clientId: idFor('A') }],
      snapshot: '{"x":1}',
      meta: { year: 2010, month: 2, day: 3, turnCount: 7, alive: [true] },
    });
    store.put(mk('auto-K7M2QP', 'auto', 10));
    store.put(mk('m-1', 'manual', 11));
    if (process.platform !== 'win32') {
      expect(statSync(pjoin(dir, 'm-1.json')).mode & 0o777).toBe(0o640);
      expect(statSync(dir).mode & 0o777).toBe(0o750);
    }
    writeFileSync(pjoin(dir, 'broken.json'), '{not json');
    writeFileSync(pjoin(dir, 'renamed.json'), JSON.stringify(mk('m-9', 'manual', 1)));
    const again = new FileSaveStore(dir, 2);
    expect(again.list().map((s) => s.id)).toEqual(['m-1', 'auto-K7M2QP']);
    expect(again.get('m-1')?.seats[0]?.clientId).toBe(idFor('A'));
    again.put(mk('m-2', 'manual', 12));
    expect(readdirSync(dir).filter((f) => f.endsWith('.json') && f.startsWith('m-') || f.startsWith('auto')).sort()).toEqual([
      'm-1.json',
      'm-2.json',
    ]);
    expect(parseStoredSave('{"format":1,"id":"../x"}')).toBeNull();
    // 刪除：檔案也沒了；不合法的 id 什麼都不做
    again.delete('m-1');
    expect(existsSync(pjoin(dir, 'm-1.json'))).toBe(false);
    again.delete('../../etc');
    expect(new FileSaveStore(dir, 2).list().map((s) => s.id)).toEqual(['m-2']);
  });
});

describe('★ 自動存檔 / 手動存檔', () => {
  run('每過一天覆蓋同一份自動存檔；內容 = 鏡像的快照；列表不給 clientId、只給 mine', () => {
    const map = loadMap();
    const store = new MemorySaveStore();
    const now = { t: 1_000_000 };
    const hub = hubWith(store, now, map);
    const a = client(hub);
    a.send(join('K7M2QP', 'A', { mode: 'create' }));
    a.send({ t: 'setOptions', options: { seatCount: 2 } });
    a.send({ t: 'start' });
    expect(store.list()).toEqual([]); // 開局那一天不存
    const room = hub.room('K7M2QP')!;
    const day0 = dayOf(room.state);
    play(hub, 'K7M2QP', new Map([[0, a]]), map, (s) => dayOf(s) !== day0);
    expect(store.list().map((s) => s.id)).toEqual(['auto-K7M2QP']);
    const auto = store.get('auto-K7M2QP')!;
    expect(auto.kind).toBe('auto');
    expect(auto.name).toBe('A 的房間');
    expect(auto.snapshot).toBe(serializeGame(room.state));
    expect(auto.seats.map((s) => [s.kind, s.clientId])).toEqual([
      ['human', idFor('A')],
      ['computer', null],
    ]);
    const day1 = dayOf(room.state);
    play(hub, 'K7M2QP', new Map([[0, a]]), map, (s) => dayOf(s) !== day1);
    expect(store.list()).toHaveLength(1); // 覆蓋，不是多一份
    expect(dayOf(deserializeGame(store.get('auto-K7M2QP')!.snapshot))).toBe(dayOf(room.state));

    // 列表：沒有任何 clientId；只有 mine
    const mine = hub.listSaves(idFor('A'));
    const theirs = hub.listSaves(idFor('Z'));
    expect(JSON.stringify(mine)).not.toContain(idFor('A'));
    expect(mine[0]!.seats.map((s) => s.mine)).toEqual([true, false]);
    expect(theirs[0]!.seats.map((s) => s.mine)).toEqual([false, false]);
    expect(mine[0]).toMatchObject({ id: 'auto-K7M2QP', kind: 'auto', globalMapId: 0, turnCount: room.state.turnCount });

    // 透過協議要列表
    const w = client(hub);
    w.send({ t: 'listSaves', version: PROTOCOL_VERSION, clientId: idFor('A') });
    expect(w.conn.last('saves')?.saves[0]?.seats[0]?.mine).toBe(true);
  });

  run('手動存檔：只有房主、只在開局後、名字要合法；成功廣播 saved', () => {
    const store = new MemorySaveStore();
    const now = { t: 5_000 };
    const hub = hubWith(store, now);
    const a = client(hub);
    const b = client(hub);
    a.send(join('K7M2QP', 'A', { mode: 'create' }));
    b.send(join('K7M2QP', 'B', { mode: 'join' }));
    a.send({ t: 'save', name: '太早' });
    expect(a.conn.last('error')?.message).toContain('還沒開局');
    a.send({ t: 'start' });
    b.send({ t: 'save', name: '我不是房主' });
    expect(b.conn.last('error')?.message).toContain('房主');
    a.send({ t: 'save', name: '   ' });
    expect(a.conn.last('error')?.message).toContain('1~24');
    a.send({ t: 'save', name: '週末那一局' });
    expect(a.conn.last('saved')?.name).toBe('週末那一局');
    expect(b.conn.last('saved')?.name).toBe('週末那一局');
    expect(store.list().map((s) => [s.kind, s.name])).toEqual([['manual', '週末那一局']]);
  });

  run('沒開存檔（沒給 saves）：listSaves 回空、save 回 error', () => {
    const hub = new RoomHub({ map: loadMap(), globalMapId: 0, seedFor: () => 1, turnMs: 0 });
    const a = client(hub);
    a.send(join('K7M2QP', 'A'));
    a.send({ t: 'start' });
    a.send({ t: 'save', name: 'x' });
    expect(a.conn.last('error')?.message).toContain('--saves');
    expect(hub.listSaves(idFor('A'))).toEqual([]);
  });
});

describe('★★ 服務器重啟後從存檔繼續（確定性）', () => {
  run('三真人一電腦打幾天 → 存檔 → 換一台 hub（= 重啟）→ 從存檔建房 → A 換了暱稱憑 clientId 自動坐回、B 換了瀏覽器點「這是我」、C 沒來由電腦代打 → 接著打：與「沒中斷、同一串 action」逐字節一致', () => {
    const map = loadMap();
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
    const dir = tempDir();
    const now = { t: 10_000_000 };

    // ── 第一台 ──
    const hub1 = hubWith(new FileSaveStore(dir), now, map);
    const a = client(hub1);
    const b = client(hub1);
    const c = client(hub1);
    a.send(join('K7M2QP', 'A', { mode: 'create' }));
    b.send(join('K7M2QP', 'B', { mode: 'join' }));
    c.send(join('K7M2QP', 'C', { mode: 'join' }));
    a.send({ t: 'start' });
    const room1 = hub1.room('K7M2QP')!;
    const seats1 = new Map([
      [0, a],
      [1, b],
      [2, c],
    ]);
    const day0 = dayOf(room1.state);
    play(hub1, 'K7M2QP', seats1, map, (s) => dayOf(s) !== day0 && s.turnCount >= 9);
    a.send({ t: 'save', name: '打到一半' });
    const saved = new FileSaveStore(dir).list().find((s) => s.kind === 'manual')!;
    expect(saved.name).toBe('打到一半');
    const atSave = room1.state;
    expect(saved.snapshot).toBe(serializeGame(atSave));

    // ── 重啟：新 hub、同一個目錄 ──
    now.t += 60_000;
    const hub2 = hubWith(new FileSaveStore(dir), now, map);
    const a2 = client(hub2);
    // A 換了暱稱 —— 憑 clientId 自動坐回 0 號座
    a2.send({ ...(join('Q9B7U3', 'A', { mode: 'create', fromSave: saved.id }) as Extract<ClientMessage, { t: 'join' }>), name: '阿A改名' });
    expect(a2.h.seat).toBe(0);
    const info = a2.conn.last('joined')!.room;
    expect(info.fromSave?.name).toBe('打到一半');
    expect(info.hostSeat).toBe(0);
    expect(info.seats.map((s) => [s.name, s.kind, s.vacant === true])).toEqual([
      ['阿A改名', 'human', false],
      ['B', 'human', true],
      ['C', 'human', true],
      ['電腦4', 'computer', false],
    ]);
    // 設定鎖定
    a2.send({ t: 'setMap', globalMapId: 1 });
    expect(a2.conn.last('error')?.message).toContain('存檔');
    a2.send({ t: 'setOptions', options: { fundIndex: 2 } });
    expect(a2.conn.last('error')?.message).toContain('存檔');

    // 列表：外人看到「加入」，1/3
    const w = client(hub2);
    w.send({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: idFor('W') });
    const row = w.conn.last('rooms')!.rooms[0]!;
    expect(row).toMatchObject({ host: '阿A改名', humans: 1, seatCount: 3, fromSave: true, started: false });
    expect(roomJoinability(row)).toBe('join');

    // B 換了瀏覽器（新 clientId）：進房先是「還沒入座」，再點「這是我」
    const b2 = client(hub2);
    b2.send(join('Q9B7U3', 'B2', { mode: 'join' }));
    expect(b2.conn.last('joined')?.seat).toBe(-1);
    expect(b2.h.seat).toBeNull();
    b2.send({ t: 'start' }); // 還沒入座的人不能開局
    expect(hub2.room('Q9B7U3')).toBeNull();
    b2.send({ t: 'claim', seat: 3 }); // 電腦座位不能認
    expect(b2.conn.last('error')?.message).toContain('不能認領');
    b2.send({ t: 'claim', seat: 1 });
    expect(b2.conn.last('joined')?.seat).toBe(1);
    expect(b2.h.seat).toBe(1);
    expect(a2.conn.last('room')?.room.seats[1]).toMatchObject({ name: 'B2', connected: true });
    expect(a2.conn.last('room')?.room.seats[1]?.vacant).toBeUndefined();

    // 旁觀者一個：開局時被請出去（error + 斷開）
    const d = client(hub2);
    d.send(join('Q9B7U3', 'D', { mode: 'join' }));
    expect(d.conn.last('joined')?.seat).toBe(-1);

    // 開局：C 沒來 ⇒ 電腦代打（離線託管，可認領）
    a2.send({ t: 'start' });
    expect(d.conn.last('error')?.message).toContain('認領');
    expect(d.conn.closed).toBe(true);
    const room2 = hub2.room('Q9B7U3')!;
    const start = a2.conn.last('start')!;
    expect(start.snapshot).toBe(saved.snapshot);
    expect(start.startDate).toBeUndefined(); // 快照裡有自己的日期
    const cSeat = a2.conn.last('room')!.room.seats[2]!;
    expect(cSeat).toMatchObject({ vacant: true, autopilot: 'offline', connected: false });
    expect(room2.state.players[2]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect(room2.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);

    // 接著打幾天
    const seats2 = new Map([
      [0, a2],
      [1, b2],
    ]);
    const dayAtLoad = dayOf(room2.state);
    play(hub2, 'Q9B7U3', seats2, map, (s) => dayOf(s) !== dayAtLoad && s.turnCount >= atSave.turnCount + 8);

    // ① 客戶端鏡像（起點 = start 帶來的快照，照廣播施加）== 服務器
    for (const cl of [a2, b2]) {
      let s = deserializeGame(cl.conn.last('start')!.snapshot!);
      for (const act of cl.conn.actions()) s = reduce(s, act, topo);
      expect(stateFingerprint(s)).toBe(room2.fingerprint);
    }
    // ② 「沒中斷」：第一台那個還活著的鏡像，照同一串 action 接著施加 —— 逐字節一致
    let uninterrupted = atSave;
    for (const act of a2.conn.actions()) uninterrupted = reduce(uninterrupted, act, topo);
    expect(stateFingerprint(uninterrupted)).toBe(room2.fingerprint);
    expect(serializeGame(uninterrupted)).toBe(serializeGame(room2.state));

    // ③ 失步自愈（replay）也帶快照
    a2.send({ t: 'resync' });
    const rep = a2.conn.last('replay')!;
    expect(rep.snapshot).toBe(saved.snapshot);
    let fromReplay = deserializeGame(rep.snapshot!);
    for (const x of rep.actions) fromReplay = reduce(fromReplay, x.action, topo);
    expect(stateFingerprint(fromReplay)).toBe(room2.fingerprint);

    // ④ C 之後回來：憑原 clientId 自動坐回（走重連那一段，託管歸還）
    const c2 = client(hub2);
    c2.send({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: idFor('C') });
    expect(c2.conn.last('rooms')!.rooms.find((r) => r.id === 'Q9B7U3')?.rejoin).toBe(true);
    c2.send(join('Q9B7U3', 'C', { mode: 'join' }));
    expect(c2.h.seat).toBe(2);
    expect(c2.conn.last('start')?.snapshot).toBe(saved.snapshot);
    expect(room2.state.players[2]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
  });
});

describe('★ 存檔房：認領 / 離座 / 列表', () => {
  /** 做一份兩真人（A、B）+ 兩電腦的存檔，回傳它的 id */
  function makeSave(store: MemorySaveStore, now: { t: number }): string {
    const hub = hubWith(store, now);
    const a = client(hub);
    const b = client(hub);
    a.send(join('K7M2QP', 'A', { mode: 'create' }));
    b.send(join('K7M2QP', 'B', { mode: 'join' }));
    a.send({ t: 'start' });
    a.send({ t: 'save', name: '兩個人' });
    return store.list()[0]!.id;
  }

  run('房主可以請別人離座（認錯人了）；別人只能讓自己離座；被請下去的人退回「還沒入座」', () => {
    const store = new MemorySaveStore();
    const now = { t: 1 };
    const id = makeSave(store, now);
    const hub = hubWith(store, now);
    const host = client(hub);
    host.send(join('ABCDEF', 'H', { mode: 'create', fromSave: id }));
    expect(host.h.seat).toBeNull(); // 房主不是存檔裡的人 ⇒ 也得先認一座
    expect(host.conn.last('joined')?.room.hostSeat).toBe(-1);
    const x = client(hub);
    x.send(join('ABCDEF', 'X', { mode: 'join' }));
    x.send({ t: 'claim', seat: 0 });
    expect(x.h.seat).toBe(0);
    host.send({ t: 'claim', seat: 0 }); // 有人了
    expect(host.conn.last('error')?.message).toContain('不能認領');
    host.send({ t: 'claim', seat: 1 });
    expect(host.h.seat).toBe(1);
    expect(host.conn.last('room')?.room.hostSeat).toBe(1);
    host.send({ t: 'claim', seat: 0 }); // 已經坐下了
    expect(host.conn.last('error')?.message).toContain('坐下了');

    x.send({ t: 'unclaim', seat: 1 }); // 不是房主，不能請別人
    expect(x.conn.last('error')?.message).toContain('房主');
    host.send({ t: 'unclaim', seat: 0 });
    expect(x.h.seat).toBeNull();
    expect(x.conn.last('joined')?.seat).toBe(-1);
    const seat0 = host.conn.last('room')!.room.seats[0]!;
    expect(seat0).toMatchObject({ name: 'A', vacant: true }); // 還原成存檔裡的那個人
    // 原來的 A 來了 ⇒ 憑 clientId 自動坐回 0 號座
    const a = client(hub);
    a.send(join('ABCDEF', 'A', { mode: 'join' }));
    expect(a.h.seat).toBe(0);
    // 自己離座
    a.send({ t: 'unclaim', seat: 0 });
    expect(a.h.seat).toBeNull();
    // 開局前走掉的人，那一座又空出來
    host.h.onClose(0);
    expect(hub.roomInfo('ABCDEF')?.seats[1]).toMatchObject({ vacant: true, connected: false });
  });

  run('★ 已開局的存檔房：外人看到「認領座位」（只列活著的空座）；從列表認領 = join 帶 claimSeat；認領完就沒了', () => {
    const store = new MemorySaveStore();
    const now = { t: 1 };
    const id = makeSave(store, now);
    const hub = hubWith(store, now);
    const a = client(hub);
    a.send(join('ABCDEF', 'A', { mode: 'create', fromSave: id }));
    a.send({ t: 'start' });
    const w = client(hub);
    w.send({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: idFor('W') });
    const row = w.conn.last('rooms')!.rooms[0]!;
    expect(row.vacant).toEqual([{ seat: 1, name: 'B', character: row.vacant![0]!.character }]);
    expect(roomJoinability(row)).toBe('claim');
    expect(JSON.stringify(row)).not.toContain(idFor('B'));
    // 原來的 B 看到的是「重新連線」
    expect(hub.listRooms(idFor('B'))[0]?.rejoin).toBe(true);

    // 外人不帶 claimSeat ⇒ 進不去
    const x = client(hub);
    x.send(join('ABCDEF', 'X', { mode: 'join' }));
    expect(x.conn.last('error')?.message).toContain('已满');
    // 帶了電腦座位 / 不存在的座位 ⇒ 進不去
    x.send(join('ABCDEF', 'X', { mode: 'join', claimSeat: 2 }));
    expect(x.h.seat).toBeNull();
    // 認領 1 號座
    x.send(join('ABCDEF', 'X', { mode: 'join', claimSeat: 1 }));
    expect(x.h.seat).toBe(1);
    expect(x.conn.last('start')?.snapshot).toBeDefined();
    expect(hub.room('ABCDEF')!.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    const after = hub.listRooms(idFor('W'))[0]!;
    expect(after.vacant).toBeUndefined();
    expect(roomJoinability(after)).toBe('playing');
    // 原來的 B 現在沒位子了（座位跟著認領的人走）
    expect(hub.listRooms(idFor('B'))[0]?.rejoin).toBe(false);
  });

  run('fromSave 只能與 create 一起；存檔不存在 ⇒ error，且不建房', () => {
    const store = new MemorySaveStore();
    const now = { t: 1 };
    const id = makeSave(store, now);
    const hub = hubWith(store, now);
    const a = client(hub);
    a.send(join('ABCDEF', 'A', { mode: 'join', fromSave: id }));
    expect(a.conn.last('error')?.message).toContain('create');
    a.send(join('ABCDEF', 'A', { mode: 'create', fromSave: 'm-nope' }));
    expect(a.conn.last('error')?.message).toContain('不在');
    a.send(join('ABCDEF', 'A', { mode: 'create', fromSave: '../../etc/passwd' }));
    expect(a.conn.last('error')?.message).toContain('不在');
    expect(hub.roomInfo('ABCDEF')).toBeNull();
  });
});

describe('★ 開局日期 = 服務器的今天（與單機同一個 defaultStartDate）', () => {
  run('today 注入 2005-06-07 ⇒ start 帶這個日期，鏡像也從這一天開始；缺省時是 hub 時鐘的今天', () => {
    const map = loadMap();
    const hub = new RoomHub({
      map,
      globalMapId: 0,
      seedFor: () => 1,
      turnMs: 0,
      today: () => new Date(2005, 5, 7),
    });
    const a = client(hub);
    a.send(join('K7M2QP', 'A'));
    a.send({ t: 'start' });
    expect(a.conn.last('start')?.startDate).toEqual({ year: 2005, month: 6, day: 7 });
    const s = hub.room('K7M2QP')!.state;
    expect([s.year, s.month, s.day]).toEqual([2005, 6, 7]);
    // 重連補發的 start 也帶
    a.h.onClose(0);
    const a2 = client(hub);
    a2.send(join('K7M2QP', 'A'));
    expect(a2.conn.last('start')?.startDate).toEqual({ year: 2005, month: 6, day: 7 });
    a2.send({ t: 'resync' });
    expect(a2.conn.last('replay')?.startDate).toEqual({ year: 2005, month: 6, day: 7 });

    // 鉗到 1998-01-01..2010-01-01（與單機同一個函數）
    const hub2 = new RoomHub({ map, globalMapId: 0, seedFor: () => 1, turnMs: 0, today: () => new Date(2031, 2, 4) });
    const b = client(hub2);
    b.send(join('K7M2QP', 'B'));
    b.send({ t: 'start' });
    expect(b.conn.last('start')?.startDate).toEqual({ year: 2010, month: 1, day: 1 });
    // 缺省：真實的今天（不跟假時鐘 `now` 走 —— 從 0 起算的假時鐘不該把日期鉗到 1998）
    const hub3 = new RoomHub({ map, globalMapId: 0, seedFor: () => 1, turnMs: 0, now: () => 0 });
    const c = client(hub3);
    c.send(join('K7M2QP', 'C'));
    c.send({ t: 'start' });
    expect(c.conn.last('start')?.startDate).toEqual(defaultStartDate(new Date()));
  });
});

describe('★ 手動存檔滿了 / 刪除存檔', () => {
  run('全是手動存檔、滿了 ⇒ 「存檔已滿，請先刪除舊存檔」；存檔裡坐過的人能刪（刪完再存就行），別人不能', () => {
    const store = new MemorySaveStore(1);
    const now = { t: 100 };
    const hub = hubWith(store, now);
    const a = client(hub);
    const b = client(hub);
    a.send(join('K7M2QP', 'A', { mode: 'create' }));
    b.send(join('K7M2QP', 'B', { mode: 'join' }));
    a.send({ t: 'start' });
    a.send({ t: 'save', name: '第一份' });
    expect(a.conn.last('saved')?.name).toBe('第一份');
    now.t += 10;
    a.send({ t: 'save', name: '第二份' });
    expect(a.conn.last('error')?.message).toBe('存檔已滿，請先刪除舊存檔');
    expect(store.list().map((s) => s.name)).toEqual(['第一份']);
    const id = store.list()[0]!.id;

    // 外人不能刪（服務器照樣回一份列表）
    const w = client(hub);
    w.send({ t: 'deleteSave', version: PROTOCOL_VERSION, clientId: idFor('W'), id });
    expect(w.conn.last('error')?.message).toContain('存檔裡的玩家');
    expect(w.conn.last('saves')?.saves).toHaveLength(1);
    // 版本不符 / clientId 不合法
    w.send({ t: 'deleteSave', version: 5, clientId: idFor('W'), id });
    expect(w.conn.last('error')?.message).toContain('协议版本');
    // B 坐過 ⇒ 能刪；回來的列表是空的
    const bl = client(hub);
    bl.send({ t: 'deleteSave', version: PROTOCOL_VERSION, clientId: idFor('B'), id });
    expect(bl.conn.last('saves')?.saves).toEqual([]);
    expect(store.list()).toEqual([]);
    a.send({ t: 'save', name: '第二份' });
    expect(a.conn.last('saved')?.name).toBe('第二份');
  });
});

describe('★ 存檔房的房主交接', () => {
  run('存檔房房主離開 ⇒ 交給坐著的下一位；沒人坐 ⇒ 關房（還沒入座的人被請出去），存檔留著', () => {
    const store = new MemorySaveStore();
    const now = { t: 1 };
    const hub0 = hubWith(store, now);
    const p = client(hub0);
    const q = client(hub0);
    p.send(join('K7M2QP', 'A', { mode: 'create' }));
    q.send(join('K7M2QP', 'B', { mode: 'join' }));
    p.send({ t: 'start' });
    p.send({ t: 'save', name: '兩個人' });
    const id = store.list()[0]!.id;

    const hub = hubWith(store, now);
    const a = client(hub);
    const b = client(hub);
    a.send(join('ABCDEF', 'A', { mode: 'create', fromSave: id }));
    b.send(join('ABCDEF', 'B', { mode: 'join' }));
    expect(b.h.seat).toBe(1);
    a.send({ t: 'leave' });
    const info = hub.roomInfo('ABCDEF')!;
    expect(info.hostSeat).toBe(1);
    expect(info.seats[0]).toMatchObject({ name: 'A', vacant: true });
    // B 是新房主了：能開局
    const g = client(hub);
    g.send(join('ABCDEF', 'G', { mode: 'join' }));
    expect(g.h.seat).toBeNull();
    b.send({ t: 'leave' });
    // 沒人坐了 ⇒ 關房；還沒入座的 G 收到原因並被斷開
    expect(hub.roomInfo('ABCDEF')).toBeNull();
    expect(g.conn.last('error')?.message).toContain('房間已關閉');
    expect(g.conn.closed).toBe(true);
    expect(store.get(id)).not.toBeNull();
  });
});
