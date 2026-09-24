/*
 * 房間列表（協議 v5）的純邏輯：可加入判據、排序、格式化、網路來的資料清洗、訂閱客戶端
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, roomJoinability, type RoomSummary } from '@rich4/core';
import {
  MAP_LABELS,
  RoomListClient,
  canDeleteSave,
  countLabel,
  formatAge,
  mapLabel,
  parseRoomSummary,
  parseSaveSummary,
  rowAction,
  saveDateLabel,
  seatLabel,
  sortRooms,
  statusLabel,
} from './room-list.ts';

function room(p: Partial<RoomSummary> & { id: string }): RoomSummary {
  return {
    host: '小明',
    humans: 1,
    seatCount: 4,
    started: false,
    globalMapId: 0,
    ageMs: 0,
    rejoin: false,
    ...p,
  };
}

describe('★ 能不能加入（core `roomJoinability`，兩端同一個判據）', () => {
  it('等待中、沒滿 ⇒ 加入', () => {
    expect(roomJoinability(room({ id: 'A', humans: 1, seatCount: 4 }))).toBe('join');
    expect(rowAction(room({ id: 'A' }))).toEqual({ kind: 'join', label: '加入', enabled: true });
  });

  it('等待中、滿了 ⇒ 已滿（不可按）', () => {
    const r = room({ id: 'A', humans: 2, seatCount: 2 });
    expect(roomJoinability(r)).toBe('full');
    expect(rowAction(r)).toEqual({ kind: 'full', label: '已滿', enabled: false });
  });

  it('遊戲中、你不在裡面 ⇒ 遊戲中（不可按）', () => {
    const r = room({ id: 'A', started: true, humans: 2 });
    expect(rowAction(r)).toEqual({ kind: 'playing', label: '無法加入', enabled: false });
  });

  it('★ 你在這桌有斷線中的座位 ⇒ 重新連線 —— 開局了、滿了都照樣能按', () => {
    for (const r of [
      room({ id: 'A', rejoin: true, started: true }),
      room({ id: 'B', rejoin: true, humans: 4, seatCount: 4 }),
      room({ id: 'C', rejoin: true, started: true, humans: 4, seatCount: 4 }),
    ]) {
      expect(rowAction(r), r.id).toEqual({ kind: 'rejoin', label: '重新連線', enabled: true });
    }
  });
});

describe('★ 排序', () => {
  it('重新連線 > 可加入 > 已滿 > 遊戲中；組內新建的在上；同齡按房間碼', () => {
    const rooms = [
      room({ id: 'PLAY01', started: true, ageMs: 10 }),
      room({ id: 'FULL01', humans: 4, ageMs: 5 }),
      room({ id: 'JOINB2', ageMs: 60_000 }),
      room({ id: 'JOINA2', ageMs: 1_000 }),
      room({ id: 'JOINZ2', ageMs: 1_000 }),
      room({ id: 'BACK01', started: true, rejoin: true, ageMs: 999_999 }),
    ];
    expect(sortRooms(rooms).map((r) => r.id)).toEqual(['BACK01', 'JOINA2', 'JOINZ2', 'JOINB2', 'FULL01', 'PLAY01']);
  });

  it('不改傳進來的陣列', () => {
    const rooms = [room({ id: 'B', ageMs: 2 }), room({ id: 'A', ageMs: 1 })];
    sortRooms(rooms);
    expect(rooms.map((r) => r.id)).toEqual(['B', 'A']);
  });
});

describe('★ 格式化', () => {
  it('建立了多久：一分鐘內「剛剛」、一小時內按分、再往上按小時', () => {
    expect(formatAge(0)).toBe('剛剛');
    expect(formatAge(59_999)).toBe('剛剛');
    expect(formatAge(60_000)).toBe('1 分鐘前');
    expect(formatAge(59 * 60_000 + 59_999)).toBe('59 分鐘前');
    expect(formatAge(60 * 60_000)).toBe('1 小時前');
    expect(formatAge(Number.NaN)).toBe('剛剛');
  });

  it('人數 / 狀態 / 地圖名', () => {
    expect(countLabel({ humans: 1, seatCount: 4 })).toBe('1 / 4');
    expect(statusLabel({ started: false })).toBe('等待加入');
    expect(statusLabel({ started: true })).toBe('遊戲中');
    expect(MAP_LABELS).toHaveLength(8);
    expect(mapLabel(0)).toBe('台灣');
    expect(mapLabel(7)).toBe('海島');
    expect(mapLabel(12)).toBe('地圖 12');
  });
});

describe('★ 網路來的資料不可信', () => {
  it('形狀對的原樣收下；`ageMs` 缺 / 負數時夾成 0', () => {
    const good = room({ id: 'K7M2QP', ageMs: 5 });
    expect(parseRoomSummary(good)).toEqual(good);
    expect(parseRoomSummary({ ...good, ageMs: -3 })?.ageMs).toBe(0);
    expect(parseRoomSummary({ ...good, ageMs: undefined })?.ageMs).toBe(0);
  });

  it('缺欄位 / 型別不對 ⇒ 整行丟掉', () => {
    const good = room({ id: 'K7M2QP' });
    for (const bad of [
      null,
      'x',
      { ...good, id: 1 },
      { ...good, host: null },
      { ...good, humans: -1 },
      { ...good, seatCount: 2.5 },
      { ...good, started: 'yes' },
      { ...good, rejoin: undefined },
    ]) {
      expect(parseRoomSummary(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('★ RoomListClient', () => {
  it('subscribe 帶版本號與 clientId；收到 rooms 丟掉壞行、排好序交出去', () => {
    const sent: string[] = [];
    const got: RoomSummary[][] = [];
    const errors: string[] = [];
    const c = new RoomListClient(
      { send: (t) => sent.push(t) },
      { clientId: 'a'.repeat(32), onRooms: (r) => got.push(r), onError: (m) => errors.push(m) },
    );
    c.subscribe();
    expect(JSON.parse(sent[0]!)).toEqual({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: 'a'.repeat(32) });
    c.receive(
      JSON.stringify({
        t: 'rooms',
        rooms: [room({ id: 'PLAY01', started: true }), { junk: true }, room({ id: 'JOIN01' })],
      }),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.map((r) => r.id)).toEqual(['JOIN01', 'PLAY01']);
    c.receive(JSON.stringify({ t: 'error', message: '协议版本不符' }));
    expect(errors).toEqual(['协议版本不符']);
    // 不是 JSON / 不認識的消息：安靜忽略
    c.receive('not json');
    c.receive(JSON.stringify({ t: 'room' }));
    expect(got).toHaveLength(1);
  });
});

describe('★ 聯機存檔（v6）', () => {
  it('已開局的存檔房有空座 ⇒ 認領座位（可按）；排在可加入之後、已滿之前', () => {
    const claim = room({ id: 'CLAIM1', started: true, fromSave: true, vacant: [{ seat: 2, name: 'C', character: 4 }] });
    expect(rowAction(claim)).toEqual({ kind: 'claim', label: '認領座位', enabled: true });
    // 自己的斷線座位仍然優先是「重新連線」
    expect(rowAction({ ...claim, rejoin: true }).kind).toBe('rejoin');
    const sorted = sortRooms([room({ id: 'FULL01', humans: 4 }), claim, room({ id: 'JOIN01' })]);
    expect(sorted.map((r) => r.id)).toEqual(['JOIN01', 'CLAIM1', 'FULL01']);
  });

  it('房間行的 vacant / fromSave 照收；壞的空座丟掉', () => {
    const r = parseRoomSummary({
      ...room({ id: 'A' }),
      fromSave: true,
      vacant: [{ seat: 1, name: 'B', character: 3 }, { seat: 'x' }],
    });
    expect(r?.fromSave).toBe(true);
    expect(r?.vacant).toEqual([{ seat: 1, name: 'B', character: 3 }]);
  });

  it('存檔摘要：形狀對的收下（mine / alive 缺省）；缺欄位丟掉', () => {
    const good = {
      id: 'm-1',
      name: '週末',
      kind: 'manual',
      ageMs: 5,
      globalMapId: 1,
      year: 2010,
      month: 2,
      day: 3,
      turnCount: 40,
      seats: [{ seat: 0, name: '小明', character: 4, kind: 'human', mine: true }],
    };
    expect(parseSaveSummary(good)?.seats[0]).toEqual({ seat: 0, name: '小明', character: 4, kind: 'human', mine: true, alive: true });
    expect(parseSaveSummary({ ...good, kind: 'other' })).toBeNull();
    expect(parseSaveSummary({ ...good, turnCount: -1 })).toBeNull();
    expect(parseSaveSummary({ ...good, seats: [{ seat: 0 }] })).toBeNull();
    expect(saveDateLabel(good)).toBe('2010 年 2 月 3 日 · 第 40 回合');
  });

  it('座位叫法：「角色（暱稱）」—— 角色名取 @rich4/data 的角色表', () => {
    expect(seatLabel(4, 'Charles')).toBe('阿土伯（Charles）');
    expect(seatLabel(99, 'X')).toBe('X');
  });

  it('RoomListClient：listSaves 帶版本號與 clientId；saves 交給 onSaves', () => {
    const sent: string[] = [];
    const got: unknown[] = [];
    const c = new RoomListClient({ send: (t) => sent.push(t) }, { clientId: 'b'.repeat(32), onRooms: () => {}, onSaves: (s) => got.push(s) });
    c.listSaves();
    expect(JSON.parse(sent[0]!)).toEqual({ t: 'listSaves', version: PROTOCOL_VERSION, clientId: 'b'.repeat(32) });
    c.receive(JSON.stringify({ t: 'saves', saves: [{ junk: 1 }] }));
    expect(got).toEqual([[]]);
  });
});

describe('★ 刪除存檔（v6）', () => {
  it('只有存檔裡坐過的人露出「刪除」；deleteSave 帶版本號、clientId、id', () => {
    const seat = (mine: boolean) => ({ seat: 0, name: 'A', character: 1, kind: 'human' as const, mine, alive: true });
    expect(canDeleteSave({ seats: [seat(false), seat(true)] })).toBe(true);
    expect(canDeleteSave({ seats: [seat(false)] })).toBe(false);
    const sent: string[] = [];
    const c = new RoomListClient({ send: (t) => sent.push(t) }, { clientId: 'c'.repeat(32), onRooms: () => {} });
    c.deleteSave('m-1');
    expect(JSON.parse(sent[0]!)).toEqual({ t: 'deleteSave', version: PROTOCOL_VERSION, clientId: 'c'.repeat(32), id: 'm-1' });
  });
});
