/*
 * 联机：飛彈的爆炸窗口按原版那张 440×440 的**屏幕空间** id 图算（Q-TOOL-1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `damage_area` VA 0x0040ac7b → `0x40a45c(0x64)`：
 *   镜头先被 `0x00447065 call 0x41d476(x, y, 0)` 移到目标格上，然后在那张
 *   440×440 的 id 图里取 `[220−size, 220+size)` 的方窗；每个实例只写**锚点那一粒**
 *   （`0x409ede or word [..], ax`），地块/設施的锚点是它们**记录自己的 x/y**
 *   （`0x4090fc` 的 `[ebp]/[ebp+2]`，与所在节点差 ~40 像素）。
 *
 * 这一条改了局面（哪些地块挨炸），所以补一条联机镜像：服务器广播的那一发
 * 与「拿同一串 action 在单机 reducer 上重放」必须逐字节同一指纹，且**双方**都要
 * 落在原版窗口的那一侧 —— 旧的「节点坐标 ±100 方框」在下面这张图上是会分叉的。
 *
 * 实测（地图 0001、视角 0、镜头居中于节点 39 (1463,239)，见 core 的 board-window.test.ts）：
 *   地块 1 (1463,192) → 偏移 (−23,−38)　在窗里
 *   地块 2 (1416,192) → 偏移 (−75,−23)　在窗里
 *   地块 3 (1368,192) → 偏移 (−130,−9)　**出窗**（节点坐标 |Δ|=(95,47) 的旧口径会误伤）
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  inBoardWindow,
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
});
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

describe('★★ 联机：飛彈窗口（Q-TOOL-1 —— 440×440 id 图里的屏幕方窗）', () => {
  run('真人打一发：服务器与镜像逐字节同一，且第 3 块地按原版口径**不**挨炸', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({
      map,
      players: seats().map((s) => ({ character: s.character, kind: s.kind })),
      seed: 11,
      mode: 'multiplayer',
    });
    // 目标 = 地图 0001 的第一个住宅节点（就是那个被我核过的夹具）
    const node = map.nodes.find((n) => n.ref.kind === 'land');
    expect(node?.id, '地图 0001 的第一个住宅节点').toBe(39);
    if (node === undefined) return;
    const target = map.nodes[node.id - 1]!;
    const tools = [...base.tools];
    tools[0 * 15 + 7] = 1; // 0 号手里有一发飛彈（TOOL_SLOTS_PER_PLAYER = 15）
    // 全图盖到 3 级、判给 1 号（玩家下标 1）—— 这样「哪些地块挨炸」看得见
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'awaitingRoll',
      pending: null,
      tools,
      landLevel: base.landLevel.map(() => 3),
      landOwner: base.landOwner.map(() => 2),
    };
    const room = new Room({
      id: 'BLAST1',
      map,
      globalMapId: 0,
      seed: 11,
      seats: seats(),
      options: LOBBY_DEFAULT_OPTIONS,
      base: { state, snapshot: '' },
    });
    room.start();
    const r = room.submit(0, { type: 'useTool', toolId: 7, nodeId: node.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // ① 镜像：同一串 action 在单机 reducer 上重放 ⇒ 同一指纹
    const mirror = reduce(state, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);

    // ② 窗口口径：两边都要与 `inBoardWindow` 的判据一致（服务器与镜像逐块地比）
    for (const [label, s] of [
      ['服务器', room.state],
      ['镜像', mirror],
    ] as const) {
      for (const [landId, level] of [
        [1, 2],
        [2, 2],
        [3, 3],
      ] as const) {
        const land = map.lands.find((l) => l.id === landId)!;
        const inside = inBoardWindow({ x: target.x, y: target.y }, land, 100);
        expect(s.landLevel[landId], `${label}：地块 ${landId} 在窗里吗 = ${inside}`).toBe(
          inside ? level : 3,
        );
      }
    }
    // ③ 第 3 块地：旧的「节点坐标 ±100 方框」会把它算进窗里（|Δ| = (95,47)），
    //    原版扫不到它（投影偏移 −130）⇒ 一个字节都不动。
    expect(room.state.landLevel[3]).toBe(3);
    expect(mirror.landLevel[3]).toBe(3);
    // ④ 咒语：这一发真的炸到了东西（否则 ② 是退化情形）
    expect(room.state.landLevel[1]).toBe(2);
    expect(room.state.landLevel[2]).toBe(2);
  });
});
