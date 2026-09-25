/*
 * 联机：events 区 provenance 审计（2026-09-24）改动的几条 —— 服务器与镜像逐字节同一条（指纹相同）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * - 魔法屋「立刻坐牢三天」过免罪卡（`0x00431e54 call 0x441210`）
 * - 魔法屋「就地拆除房屋」拆設施（`0x0043234c call 0x40ab4a(type,0)`）
 * - 真人保釋：点券 ≥ 赎金、被保者敌意 −max(天,1)×100×物價（`0x0043d0d4` / `0x0043cf21..0x0043cf4d`）
 * - 踩新聞格抽到地價稅、付不起当场破产（`0x0044a1e7..0x0044a215` → `0x41d375 call 0x40cd87`）
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
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
const seats = (): SeatInfo[] => [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

/** 服务器吃下一条 action，镜像照同一条 reduce，两边指纹必须相同 */
function mirrorOnce(map: Map0, state: GameState, seat: number, action: Action, id: string) {
  const topo = topoOf(map);
  const room = new Room({ id, map, globalMapId: 0, seed: 5, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
  room.start();
  const r = room.submit(seat, action);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error('rejected');
  const mirror = reduce(state, r.broadcast.action, topo);
  expect(stateFingerprint(mirror)).toBe(room.fingerprint);
  return { room, mirror };
}

describe('★★ 联机：events 区审计改动两端一致', () => {
  run('魔法屋「立刻坐牢三天」点到持免罪卡的人 ⇒ 扣卡、不关；敌意照记', () => {
    const map = loadMap();
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const node = map.nodes.find((n) => n.walkable && n.adjacent.length === 2)!;
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 0, targets: [0] },
      players: base.players.map((p, i) => ({ ...p, whoPlays: 1, nodeId: node.id, cards: i === 0 ? [21] : [] })),
    };
    const { room, mirror } = mirrorOnce(map, state, 1, { type: 'magicHouse', option: 2 }, 'EVAUD1');
    expect(room.state.players[0]!.cards).toEqual([]);
    expect(room.state.players[0]!.blocking.inPrison).toBe(0);
    expect(room.state.players[0]!.hostility[1]).toBeGreaterThan(0);
    expect(mirror.players[0]).toEqual(room.state.players[0]);
  });

  run('魔法屋「就地拆除房屋」站在 1 级設施上 ⇒ 0 级、种类清 0', () => {
    const map = loadMap();
    const facNode = map.nodes.find((n) => n.ref.kind === 'facility')!;
    const fid = (facNode.ref as { index: number }).index;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const facilityOwner = [...base.facilityOwner];
    const facilityLevel = [...base.facilityLevel];
    const facilityType = [...base.facilityType];
    facilityOwner[fid] = 3;
    facilityLevel[fid] = 1;
    facilityType[fid] = 2;
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'turnEnd',
      facilityOwner,
      facilityLevel,
      facilityType,
      pending: { kind: 'magicHouse', criterion: 0, targets: [0] },
      players: base.players.map((p) => ({ ...p, whoPlays: 1, nodeId: facNode.id })),
    };
    const { room } = mirrorOnce(map, state, 1, { type: 'magicHouse', option: 9 }, 'EVAUD2');
    expect(room.state.facilityLevel[fid]).toBe(0);
    expect(room.state.facilityType[fid]).toBe(0);
  });

  run('真人保釋 1 号：30 點券够、1 号对我敌意 −天×100×物價', () => {
    const map = loadMap();
    const square = map.nodes.find((n) => n.specialKind === 4)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const occ = [...base.prisonOccupancy];
    occ[1] = 1;
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'awaitingDecision',
      prisonOccupancy: occ,
      pending: { kind: 'bail', place: 'prison', candidates: [], points: 30 },
      players: base.players.map((p, i) => {
        const q = { ...p, whoPlays: 1, nodeId: square.id, points: i === 0 ? 30 : p.points };
        if (i !== 1) return q;
        const hostility = [...q.hostility];
        hostility[0] = 5000;
        return { ...q, hostility, blocking: { ...q.blocking, inPrison: 2 } };
      }),
    };
    const { room } = mirrorOnce(map, state, 0, { type: 'bail', slot: 1 }, 'EVAUD3');
    expect(room.state.players[0]!.points).toBe(0);
    expect(room.state.players[1]!.hostility[0]).toBe(5000 - 2 * 100 * room.state.priceIndex);
  });

  run('踩新聞格抽到地價稅：没钱的地主当场破产（拍卖的随机流两端一致）', () => {
    const map = loadMap();
    const square = map.nodes.find((n) => n.specialKind === 2)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const landOwner = [...base.landOwner];
    // 1 号名下三块地；他身上一分钱没有
    for (const id of [1, 2, 3]) landOwner[id] = 2;
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'settling',
      landOwner,
      newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: 12 },
      players: base.players.map((p, i) => ({
        ...p,
        whoPlays: 1,
        nodeId: i === 0 ? square.id : p.nodeId || 1,
        cash: i === 1 ? 0 : 50_000,
        moneyInBank: 0,
      })),
    };
    const { room } = mirrorOnce(map, state, 0, { type: 'settle' }, 'EVAUD4');
    expect(room.state.lastEvent).toMatchObject({ kind: 'news', id: 12 });
    expect(room.state.players[1]!.whoPlays).toBe(0);
  });
});
