/*
 * 联机：魔法屋「向後轉」（第 24 份 `20260924-181812507`「财产最多的人向后转没生效」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 0x004321d0 `call 0x40c78c` —— 掉头 **并重挑来路**（0x0040c7c4..0x0040c859，有候选才 `rand()`）。
 * 重挑来路吃随机流 ⇒ 服务器与每个镜像必须逐字节同一条（指纹相同），且被点到的人真的换了来路。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type GameState,
  type SeatInfo,
} from '@rich4/core';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials });
const seats = (): SeatInfo[] => [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

describe('★★ 联机：魔法屋向後轉两端一致', () => {
  run('真人点「向後轉」、名单 [0, 2] ⇒ 服务器与镜像指纹相同；两人朝向 +4、来路换到另一头', () => {
    const map = loadMap();
    const topo = topoOf(map);
    // 一格恰有两个邻居（走得通的普通路段）
    const node = map.nodes.find((n) => n.adjacent.length === 2 && n.walkable)!;
    const [a, b] = node.adjacent as [number, number];
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 7, mode: 'multiplayer' });
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 0, targets: [0, 2] },
      players: base.players.map((p) => ({ ...p, whoPlays: 1, nodeId: node.id, lastNodeId: a, direction: 2 })),
    };
    const room = new Room({ id: 'MAGTB1', map, globalMapId: 0, seed: 7, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const r = room.submit(1, { type: 'magicHouse', option: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(state, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    for (const who of [0, 2]) {
      expect(room.state.players[who]!.direction).toBe(6);
      expect(room.state.players[who]!.lastNodeId).toBe(b);
      expect(mirror.players[who]).toEqual(room.state.players[who]);
    }
    // 没被点到的人不动
    expect(room.state.players[3]!.lastNodeId).toBe(a);
  });

  run('★ 轉向卡（同一个 0x40c78c，0x00443025）：真人对 2 号出牌 ⇒ 服务器与镜像指纹相同；2 号朝向 +4、来路换到另一头', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const node = map.nodes.find((n) => n.adjacent.length === 2 && n.walkable)!;
    const [a, b] = node.adjacent as [number, number];
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 9, mode: 'multiplayer' });
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'awaitingRoll',
      pending: null,
      players: base.players.map((p, i) => ({ ...p, whoPlays: 1, nodeId: node.id, lastNodeId: a, direction: 2, cards: i === 1 ? [6] : [] })),
    };
    const room = new Room({ id: 'TURNC1', map, globalMapId: 0, seed: 9, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const r = room.submit(1, { type: 'useCard', cardId: 6, target: { kind: 'player', index: 2 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(state, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.players[2]!.direction).toBe(6);
    expect(room.state.players[2]!.lastNodeId).toBe(b);
    expect(mirror.players[2]).toEqual(room.state.players[2]);
    expect(room.state.players[1]!.cards).toEqual([]);
  });
});
