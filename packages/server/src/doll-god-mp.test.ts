/*
 * 联机：機器娃娃不扫**别人身上**的神明（第 24 份 `20260924-182247766`「我身上背的窮神莫名其妙消失了」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 娃娃每走一格读节点反向索引 `node+0x24` 第 3 字节（0x0041b4b4），附身的物件不在那一字节里；
 *   扫到的才 `call 0x40e14d`（0x0041b529，放置类回库存、神明搭档另找地方登场 —— 那一步要 `rand()`）。
 * 服务器与每个镜像逐字节同一条（指纹相同），被路过的那位照背着神明。
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

describe('★★ 联机：機器娃娃路过背着神明的人', () => {
  run('真人放娃娃、前一格站着背小窮神的 1 号 ⇒ 神明不被扫；服务器与镜像指纹相同', () => {
    const map = loadMap();
    const topo = topoOf(map);
    // 一段直路：本格恰两个邻居，前一格也恰两个邻居（娃娃第一步确定踩到它）
    const node = map.nodes.find((n) => {
      if (n.adjacent.length !== 2 || !n.walkable) return false;
      const ahead = map.nodes[n.adjacent[1]! - 1];
      return ahead !== undefined && ahead.walkable && ahead.adjacent.length === 2;
    })!;
    const [back, ahead] = node.adjacent as [number, number];
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
    const tools = [...base.tools];
    tools[0 * 15 + 1] = 1; // 0 号有一个機器娃娃
    // 物件：清掉开局摆的（免得路上本来就有东西），4 号槽（小窮神）附在 1 号身上
    const objects = base.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    objects[4] = { ...objects[4]!, type: 5, nodeId: ahead, state: 7, attached: 2 };
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'awaitingRoll',
      pending: null,
      tools,
      objects,
      players: base.players.map((p, i) => ({
        ...p,
        whoPlays: 1,
        nodeId: i === 1 ? ahead : node.id,
        lastNodeId: i === 1 ? node.id : back,
        godInfo: i === 1 ? 5 : 0,
      })),
    };
    const room = new Room({ id: 'DOLLG1', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const r = room.submit(0, { type: 'useTool', toolId: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(state, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    // 娃娃确实走过了他那一格
    expect(room.state.lastNpcWalks[0]!.path.slice(0, 2)).toEqual([node.id, ahead]);
    expect(room.state.players[1]!.godInfo).toBe(5);
    expect(room.state.objects[4]).toEqual({ ...objects[4] });
    expect(mirror.objects[4]).toEqual(room.state.objects[4]);
  });
});
