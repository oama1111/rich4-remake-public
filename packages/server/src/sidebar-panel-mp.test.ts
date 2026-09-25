/*
 * 联机：侧栏面板（pt22 WP-2 #2 / #3 / #16）—— 服务器与客户端镜像交给侧栏的输入逐字段相同
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 侧栏各端自己画（`client/src/hud.ts`），画什么只取：
 *   - #2 惡人回合：`lastNpcTurn`（行动者游标在哪个惡人身上，第二十六份 panel #1）+ `specialActors[槽].owner`（小头像画谁）
 *     @source 0x00415fc1 判 `[0x49910c]`、0x0041603d 取替身记录 +8；
 *   - #3 结盟小头像：`players[*].alliedPlayer`（`[p+0x41]`，0x00416256 / 0x0041685a）；
 *   - #16 落地影片期间：`currentPlayer` 已是新玩家（换人后 0x41c84f → 0x436a5a → 0x41906a(1) 那次
 *     WM_PAINT 就把侧栏换过去了，早于 0x418c55 的落地影片）。
 * 这些都在 core 的状态里、随广播重放 ⇒ 这里钉「服务器 = 镜像」；同一份输入画出同一组调用钉在
 * `packages/client/src/sidebar-panel.test.ts` ④。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  isUnplaced,
  landAll,
  newGame,
  parseMap,
  reduce,
  initialConfinement,
  releaseNpc,
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
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials });

const seats = (): SeatInfo[] => [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: (i * 5) % 12, kind: 'human' as const }));

function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

/** 侧栏要读的那几样 */
const sidebarInputs = (s: GameState) => ({
  currentPlayer: s.currentPlayer,
  // ★★ 第二十六份 panel #1：侧栏画惡人那一版的判据 = 行动者游标（core 的 `lastNpcTurn`）
  turn: s.lastNpcTurn ?? null,
  walks: s.lastNpcWalks.map((w) => w.slot),
  owners: s.specialActors.map((a) => a.owner),
  allies: s.players.map((p) => p.alliedPlayer),
  characters: s.players.map((p) => p.character),
});

describe('★★ 联机：侧栏面板的输入两端一致', () => {
  run('#2/#3 最后一位收回合、强盜（2 号保釋的）走一趟；1、3 号结盟 ⇒ 服务器与镜像逐字段相同', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = landAll(
      newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 9, mode: 'multiplayer' }),
      map.nodes,
    );
    const specialActors = [...base.specialActors];
    specialActors[1] = releaseNpc(map.nodes[10]!.id, 2, 0);
    const state: GameState = {
      ...base,
      currentPlayer: 3,
      phase: 'turnEnd',
      pending: null,
      pendingNpcSlots: [],
      specialActors,
      players: base.players.map((p, i) =>
        i === 1 ? { ...p, alliedPlayer: 4, alliedDays: 7 } : i === 3 ? { ...p, alliedPlayer: 2, alliedDays: 7 } : p,
      ),
    };
    const room = new Room({ id: 'PANMP1', map, globalMapId: 0, seed: 9, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 3, { type: 'endTurn' }).ok).toBe(true);
    // 强盜这一趟交给了两端的表现层（槽 1 = actor 5），主人仍是 2 号
    expect(room.state.lastNpcWalks.some((w) => w.slot === 1)).toBe(true);
    expect(room.state.specialActors[1]!.owner).toBe(2);
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(room.state));
    // 结盟还在（天数只在推日期里减），两端一样
    expect(room.state.players[1]!.alliedPlayer).toBe(4);
  });

  run('★★ 第二十六份 panel #1：惡人的整个回合（含**停留**不走的那一个）两端都交出同一个行动者；下一位行动者那条 action 清掉', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = landAll(
      newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 13, mode: 'multiplayer' }),
      map.nodes,
    );
    const specialActors = [...base.specialActors];
    specialActors[0] = releaseNpc(map.nodes[6]!.id, 1, 0); // 小偷：会走
    specialActors[2] = { ...releaseNpc(map.nodes[12]!.id, 2, 0), halted: 3 }; // 流氓：停留
    const state: GameState = { ...base, currentPlayer: 3, phase: 'turnEnd', pending: null, pendingNpcSlots: [], specialActors };
    const room = new Room({ id: 'PANMP3', map, globalMapId: 0, seed: 13, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 3, { type: 'endTurn' }).ok).toBe(true);
    expect(room.state.lastNpcTurn).toEqual({ actor: 4 });
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(room.state));
    expect(submitBoth(room, mirror, topo, room.actingSeat, { type: 'npcStep' }).ok).toBe(true);
    expect(room.state.lastNpcWalks).toEqual([]); // 停留 ⇒ 没有补间
    expect(room.state.lastNpcTurn).toEqual({ actor: 6 });
    expect(room.state.phase).toBe('turnStart'); // 最后一个惡人那一条连推日期、换到 0 号
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(room.state));
    expect(submitBoth(room, mirror, topo, room.actingSeat, { type: 'startTurn' }).ok).toBe(true);
    expect(room.state.lastNpcTurn ?? null).toBeNull();
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(room.state));
  });

  run('★★ 保釋惡人：那一下只摆到监狱门口（0x0043d7e0，不走、不掷随机数），轮到游标 4..7 才走；侧栏两端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = landAll(
      newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 21, mode: 'multiplayer' }),
      map.nodes,
    );
    const state: GameState = {
      ...base,
      currentPlayer: 3,
      phase: 'turnEnd',
      pendingNpcSlots: [],
      prisonOccupancy: initialConfinement('prison', 8),
      players: base.players.map((p) => ({ ...p, points: 900 })),
      pending: { kind: 'bail', place: 'prison', candidates: [{ slot: 5, player: -1, name: '', cost: 300, affordable: true }], points: 900 },
    };
    const room = new Room({ id: 'PANMP4', map, globalMapId: 0, seed: 21, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 3, { type: 'bail', slot: 5 }).ok).toBe(true);
    const bailed = room.state;
    expect(bailed.specialActors[1]).toMatchObject({ owner: 3, stepsRemaining: 0 });
    expect(bailed.rngState).toBe(state.rngState);
    expect(bailed.lastNpcTurn ?? null).toBeNull();
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(bailed));
    expect(submitBoth(room, mirror, topo, 3, { type: 'endTurn' }).ok).toBe(true);
    expect(room.state.lastNpcTurn).toEqual({ actor: 5 });
    expect(room.state.lastNpcWalks[0]?.path[0]).toBe(bailed.specialActors[1]!.nodeId);
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(room.state));
  });

  run('#16 换人让下一位落地 ⇒ 两端 `currentPlayer` 都已是他（侧栏在影片期间画他）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 3, mode: 'multiplayer' });
    const state: GameState = { ...base, phase: 'turnEnd', pending: null, pendingNpcSlots: [] };
    expect(isUnplaced(state.players[1]!)).toBe(true);
    const room = new Room({ id: 'PANMP2', map, globalMapId: 0, seed: 3, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'endTurn' }).ok).toBe(true);
    expect(room.state.currentPlayer).toBe(1);
    expect(isUnplaced(room.state.players[1]!)).toBe(false);
    expect(mirror.s.currentPlayer).toBe(1);
    expect(sidebarInputs(mirror.s)).toEqual(sidebarInputs(room.state));
  });
});
