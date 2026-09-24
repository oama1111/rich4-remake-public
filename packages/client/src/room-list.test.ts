/*
 * 房間列表（協議 v5）的純邏輯：可加入判據、排序、格式化、網路來的資料清洗、訂閱客戶端
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, roomJoinability, type RoomSummary } from '@rich4/core';
import {
  MAP_LABELS,
  RoomListClient,
  countLabel,
  formatAge,
  mapLabel,
  parseRoomSummary,
  rowAction,
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
