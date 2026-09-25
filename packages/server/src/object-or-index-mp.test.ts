/*
 * 联机镜像：节点反向索引 `node+0x26` 是**按位或**（出处审计补的逐位口径）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `place_object` 往节点第 3 字节里 `or` 槽号（0x0040e13c `lea edx,[ebx+1] / shl edx,0x10 /
 *   or dword [node+0x24], edx`）；落地分派读的也是它（0x0041b4b4 `and eax,0xff0000 / shr eax,0x10`），
 *   随后照 `objects[字节-1].type`（0x0041b4ca..db）跳表（0x0041b3e5）。
 *   ⇒ 同格两件时**不是**「取最大槽号」：死神（槽 14 ⇒ handle 15）压路障（槽 16 ⇒ handle 17）
 *     的 `15|17 = 31` 落在**槽 30**，而 `OBJECT_TYPE_TABLE[30] = 17`（地雷）⇒ 这一格炸人。
 * 服务器与每个镜像必须逐字节同一条（指纹 + 玩家字段）。
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
const topoOf = (map: Map0) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((character, i) => ({ seat: i, name: `P${i}`, character, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

describe('★★ 联机：同格两件的节点反向索引 = 按位或（0x0040e13c）', () => {
  run('死神(15) 与路障(17) 同格 ⇒ 15|17 = 31 ⇒ 那一格按地雷办；服务器与镜像同一条', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 17, mode: 'multiplayer' });
    // 物件先全清（免得落点撞上开局摆的神明），走一步看看 0 号实际会落到哪一格
    const cleared = s0.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const walking: GameState = {
      ...s0,
      phase: 'moving',
      currentPlayer: 0,
      stepsRemaining: 1,
      stepsTotal: 1,
      objects: cleared,
      players: s0.players.map((p, i) => ({ ...p, whoPlays: i === 0 ? 1 : p.whoPlays })),
    };
    const to = reduce(walking, { type: 'step' }, topo).players[0]!.nodeId;
    expect(to).not.toBe(0);
    // 在那一格上摆死神（种类 15 ⇒ 槽 14、handle 15）与路障（种类 16 ⇒ 槽 16、handle 17）
    const objects = [...cleared];
    objects[14] = { ...objects[14]!, nodeId: to, state: 0, attached: 0 };
    objects[16] = { ...objects[16]!, nodeId: to, state: 0, attached: 0 };
    const state: GameState = { ...walking, objects };
    const room = new Room({ id: 'OBJORA', map, globalMapId: 0, seed: 17, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const r = room.submit(0, { type: 'step' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(state, r.broadcast.action, topo);
    expect(mirror.players[0]!.nodeId).toBe(to);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    // 地雷那一支：住院 3 天（路障那一支只会把剩余步数清零）
    expect(mirror.players[0]!.blocking.inHospital).toBe(3);
    expect(room.state.players[0]!.blocking.inHospital).toBe(3);
    expect(mirror.players[0]!.blocking).toEqual(room.state.players[0]!.blocking);
    expect(mirror.stepsRemaining).toBe(room.state.stepsRemaining);
    // ⚠️ `xpos/ypos` **不在这里比**：`Room.#topo`（room.ts:106-111）少了 `landscapes`，
    //   服务器算出来的伤者停在**格心**，而客户端（带了 landscapes，main.ts:10536）把他挪到
    //   醫院大樓景观（core 的 `send_to_hospital` 0x43ecef 读景观记录 1）。
    //   这条差异已登记到台账 `provenance-cards.md` 的「跨区发现」（指纹不收 xpos/ypos，
    //   所以两边指纹仍然相等）。
    expect(mirror.players[0]!.nodeId).toBe(room.state.players[0]!.nodeId);
  });
});
