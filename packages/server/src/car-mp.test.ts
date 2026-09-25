/*
 * 联机：电脑的车从哪里来、什么时候换 —— 第二十六份試玩回報 `20260924-234350490`「约翰乔的汽车哪里来的」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 重放结论：約翰喬（P1，电脑）第 41 回合 `useTool 6` 换上汽車；那件汽車在起点快照（第 33 回合）之前就在
 * 他道具欄里 —— 是更早在百貨公司买的。两件事各钉一半，单机 / 联机同一条路：
 *
 *   ① 电脑进百貨 ⇒ 当场按原版那一支买卖（`0x0042ea2b … jne 0x42ed8d`，`core/places/ai-shop.ts`），
 *      不挂 `pending{shop}`、服务器不必替它答；客户端按广播重放逐条指纹一致；单机 reduce 得到同一个结果。
 *   ② 电脑用汽車 ⇒ 服务器镜像出「使用汽車」框（`tool.aiUse`，`0x00448070`）+ `lastToolUsed`（道具台词
 *      `#0235`）+ 交通 2 / 骰子 3（`0x00446f3d`）；旁观端重放同一条 action 得到同样的三样，
 *      表现层据此在框收掉之后才换图组（`client/src/vehicle-hold.ts`，客户端那一半在 `vehicle-hold.test.ts`）；
 *      下一掷双方都是 3 颗。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
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
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials });

/** 0 号真人（房主 Charles），其余电脑 —— 回报现场的座位 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

const TOOL_SLOTS = 15;
const MOTORCYCLE = 5;
const CAR = 6;

function baseGame(map: Map0, mode: 'single' | 'multiplayer'): GameState {
  const s = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 7, mode });
  // 人人在盘上（`who_plays ← landingWhoPlays`：0 号 = 1 真人，其余 = 2 电脑）
  return { ...s, players: s.players.map((p) => ({ ...p, whoPlays: p.landingWhoPlays ?? p.whoPlays })) };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'CARMP',
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

function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

describe('★★ 第二十六份：电脑的车 —— 联机与单机同一条路', () => {
  run('★ ① 电脑进百貨：当场买卖（先買機車，461 點才轮得到汽車）、不挂商店交互；联机重放一致、与单机同结果', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const store = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.DEPARTMENT_STORE)!;
    const scene = (mode: 'single' | 'multiplayer', points: number): GameState => {
      const s0 = baseGame(map, mode);
      return {
        ...s0,
        currentPlayer: 1,
        phase: 'settling',
        pending: null,
        stepsRemaining: 0,
        players: s0.players.map((p, i) => (i === 1 ? { ...p, nodeId: store.id, points, trafficMethod: 0, ndices: 1 } : p)),
      };
    };
    for (const [points, car] of [
      [300, 0],
      [460, 0],
      [461, 1],
    ] as const) {
      const state = scene('multiplayer', points);
      const room = roomFrom(map, state);
      const mirror = { s: state };
      expect(submitBoth(room, mirror, topo, 1, { type: 'settle' }).ok).toBe(true);
      const s = room.state;
      expect(s.pending).toBeNull();
      expect(s.phase).toBe('turnEnd');
      expect(s.tools[1 * TOOL_SLOTS + MOTORCYCLE]).toBe(1);
      expect(s.tools[1 * TOOL_SLOTS + CAR], `${points} 點`).toBe(car);
      // 服务器不用替它答商店（没有商店交互）⇒ 电脑座位接着就是收尾
      expect(room.decideForCurrent()).toEqual({ type: 'endTurn' });
      // 单机：同一个局面、同一条 settle ⇒ 同样的道具与點券
      const single = reduce(scene('single', points), { type: 'settle' }, topo);
      expect(single.pending).toBeNull();
      expect(single.tools).toEqual(s.tools);
      expect(single.players[1]!.points).toBe(s.players[1]!.points);
      expect(single.cardAmount).toEqual(s.cardAmount);
    }
  });

  run('★ ② 电脑用汽車：「使用汽車」框 + 道具台词提示 + 交通 2 / 骰子 3，旁观端重放一致；下一掷双方都是 3 颗', () => {
    const map = loadMap();
    const topo = topoOf(map);
    for (const mode of ['multiplayer', 'single'] as const) {
      const s0 = baseGame(map, mode);
      const tools = [...s0.tools];
      tools[1 * TOOL_SLOTS + CAR] = 1;
      const state: GameState = {
        ...s0,
        currentPlayer: 1,
        phase: 'awaitingRoll',
        pending: null,
        tools,
        players: s0.players.map((p, i) => (i === 1 ? { ...p, trafficMethod: 0, ndices: 1 } : p)),
      };
      const use: Action = { type: 'useTool', toolId: CAR };
      let after: GameState;
      if (mode === 'multiplayer') {
        const room = roomFrom(map, state);
        const mirror = { s: state };
        expect(submitBoth(room, mirror, topo, 1, use).ok).toBe(true);
        after = room.state;
        // 旁观端（镜像）拿到的是同一扇框、同一句台词提示、同一套车
        expect(mirror.s.notices).toEqual(after.notices);
        expect(mirror.s.lastToolUsed).toEqual(after.lastToolUsed);
        expect(mirror.s.players[1]!.trafficMethod).toBe(2);
        expect(submitBoth(room, mirror, topo, 1, { type: 'rollDice' }).ok).toBe(true);
        expect(room.state.dice).toHaveLength(3);
        expect(mirror.s.dice).toEqual(room.state.dice);
      } else {
        after = reduce(state, use, topo);
        expect(reduce(after, { type: 'rollDice' }, topo).dice).toHaveLength(3);
      }
      expect(after.notices.map((n) => [n.key, n.args[0]])).toEqual([['tool.aiUse', '汽車']]);
      expect(after.lastToolUsed).toEqual({ player: 1, toolId: CAR });
      expect(after.players[1]!.trafficMethod).toBe(2);
      expect(after.players[1]!.ndices).toBe(3);
      expect(after.tools[1 * TOOL_SLOTS + CAR]).toBe(0);
    }
  });
});
