/*
 * 聯機：住進旅館那一段位移 / 住滿走出來 / 走回棋盤那一回合的停頓（審計 #17 / #21）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 表現層（`client/src/tween.ts` 的 `walkTweenFor`、`client/src/landing-pause.ts` 的 `relocateWalkPauseTicks`）
 * 只讀一條 action 前後兩份局面：`whoPlays` 的 0x10 / 0x20、`x/y`、`nodeId`、`phase`、`currentPlayer`。
 * 這裡釘住聯機那一半：服務器替電腦座位出手（`#driveComputers` → `decideForCurrent`），
 * 旁觀端照廣播重放，**逐條指紋一致**、那幾個欄位在兩邊一模一樣 ⇒ 旁觀端演同一段走進去 / 走出來、停同樣的 8 tick。
 * 客戶端那一半（同一份局面 ⇒ 同一段補間與停頓）在 `client/src/relocate-walk.test.ts`。
 *
 * 原版：住店 `0x41a85e call 0x40d5a5` 支 A（`+0x15 |= 0x20`、x/y 由走路例程挪到設施）；
 * 住滿釋放 `0x40d6be`（`+0x15 |= 0x10`）；走回棋盤那一回合收尾 `0x418ebd` 不推進遊標（`0x00418f8e`）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  FACILITY_TYPE,
  LOBBY_DEFAULT_OPTIONS,
  RELEASE_PENDING,
  WHO_PLAYS_RELOCATED,
  WHO_PLAYS_RETURN_TO_BOARD,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type SeatInfo,
} from '@rich4/core';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

/** 0 號真人（房主），其餘電腦 —— 服務器補滿的那種房間 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'HOTEL1',
    map,
    globalMapId: 0,
    seed: 7,
    seats: seats(),
    options: LOBBY_DEFAULT_OPTIONS,
    base: { state, snapshot: '' },
  });
  room.start();
  return room;
}

/** 提交並在「旁觀端鏡像」上照廣播重放，逐條對指紋；返回 [before, after]（鏡像那一份）*/
function submitBoth(
  room: Room,
  mirror: { s: GameState },
  topo: ReturnType<typeof topoOf>,
  seat: number,
  action: Action,
): [GameState, GameState] {
  const before = mirror.s;
  const r = room.submit(seat, action);
  expect(r.ok, `${action.type} 應被受理`).toBe(true);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return [before, mirror.s];
}

/** 客戶端判據讀的那幾個欄位（兩端要逐位相同）*/
const presentationInputs = (s: GameState, i: number) => {
  const p = s.players[i]!;
  return { phase: s.phase, currentPlayer: s.currentPlayer, whoPlays: p.whoPlays, nodeId: p.nodeId, xpos: p.xpos, ypos: p.ypos, direction: p.direction };
};

describe('★★ 聯機：電腦座位住進旅館 → 住滿走出來，旁觀端逐條一致', () => {
  run('服務器替電腦出 settle ⇒ 兩端同時帶上 0x20、貼圖位 = 設施坐標；住滿那一回合兩端同時帶 0x10 走回格上、不推進遊標', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 7, mode: 'multiplayer' });
    const hotelNode = map.nodes.find((n) => n.ref.kind === 'facility')!;
    const facId = hotelNode.ref.kind === 'facility' ? hotelNode.ref.index : -1;
    const fac = map.facilities.find((f) => f.id === facId)!;
    expect([fac.x, fac.y]).not.toEqual([hotelNode.x, hotelNode.y]);
    const GUEST = 1;
    const state: GameState = {
      ...s0,
      currentPlayer: GUEST,
      phase: 'settling',
      pending: null,
      stepsRemaining: 0,
      players: s0.players.map((p, i) => ({
        ...p,
        whoPlays: p.whoPlays !== 0 ? p.whoPlays : (p.landingWhoPlays ?? 2),
        nodeId: i === GUEST ? hotelNode.id : s0.players[0]!.nodeId,
        xpos: i === GUEST ? hotelNode.x : s0.players[0]!.xpos,
        ypos: i === GUEST ? hotelNode.y : s0.players[0]!.ypos,
        cash: 100_000,
      })),
      facilityOwner: s0.facilityOwner.map((o, i) => (i === facId ? 3 : o)),
      facilityLevel: s0.facilityLevel.map((l, i) => (i === facId ? 1 : l)),
      facilityType: s0.facilityType.map((t, i) => (i === facId ? FACILITY_TYPE.hotel : t)),
    };
    const room = roomFrom(map, state);
    const mirror = { s: state };

    // ① 住店：服務器替電腦決定（`decideForCurrent`，與 `#driveComputers` 同一出口）
    const settle = room.decideForCurrent();
    expect(settle?.type).toBe('settle');
    const [b1, a1] = submitBoth(room, mirror, topo, GUEST, settle!);
    const guest = a1.players[GUEST]!;
    expect(guest.whoPlays & WHO_PLAYS_RELOCATED).toBe(WHO_PLAYS_RELOCATED);
    expect(b1.players[GUEST]!.whoPlays & WHO_PLAYS_RELOCATED).toBe(0);
    expect([guest.xpos, guest.ypos]).toEqual([fac.x, fac.y]);
    expect(guest.nodeId).toBe(hotelNode.id);
    expect(guest.blocking.inHotel).not.toBe(0);
    expect(a1.phase).toBe('turnEnd');
    expect(presentationInputs(room.state, GUEST)).toEqual(presentationInputs(a1, GUEST));

    // ② 住滿：把天數撥到「明天釋放」，輪到他之前那一次 endTurn 給他走一天 ⇒ 0x10
    const releasing: GameState = {
      ...room.state,
      currentPlayer: 0,
      phase: 'turnEnd',
      players: room.state.players.map((p, i) =>
        i === GUEST ? { ...p, whoPlays: p.whoPlays & ~WHO_PLAYS_RELOCATED, blocking: { ...p.blocking, inHotel: RELEASE_PENDING } } : p,
      ),
    };
    const room2 = roomFrom(map, releasing);
    const mirror2 = { s: releasing };
    submitBoth(room2, mirror2, topo, 0, { type: 'endTurn' });
    expect(mirror2.s.currentPlayer).toBe(GUEST);
    expect(mirror2.s.players[GUEST]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(WHO_PLAYS_RETURN_TO_BOARD);
    expect([mirror2.s.players[GUEST]!.xpos, mirror2.s.players[GUEST]!.ypos]).toEqual([fac.x, fac.y]);

    // ③ 「走回棋盤」那一回合：服務器替電腦出 startTurn ⇒ 回到旅館格、進 turnEnd
    const start = room2.decideForCurrent();
    expect(start?.type).toBe('startTurn');
    const [b3, a3] = submitBoth(room2, mirror2, topo, GUEST, start!);
    expect(b3.phase).toBe('turnStart');
    expect(b3.players[GUEST]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(WHO_PLAYS_RETURN_TO_BOARD);
    expect([a3.players[GUEST]!.xpos, a3.players[GUEST]!.ypos]).toEqual([hotelNode.x, hotelNode.y]);
    expect(a3.phase).toBe('turnEnd');
    expect(presentationInputs(room2.state, GUEST)).toEqual(presentationInputs(a3, GUEST));

    // ④ 收尾：同一位再來一回合（`0x00418f8e` 不推進遊標）—— 停頓之後輪到的仍是他
    const end = room2.decideForCurrent();
    expect(end?.type).toBe('endTurn');
    const [, a4] = submitBoth(room2, mirror2, topo, GUEST, end!);
    expect(a4.currentPlayer).toBe(GUEST);
    expect(a4.phase).toBe('turnStart');
    expect(a4.players[GUEST]!.whoPlays & (WHO_PLAYS_RETURN_TO_BOARD | WHO_PLAYS_RELOCATED)).toBe(0);
  });
});
