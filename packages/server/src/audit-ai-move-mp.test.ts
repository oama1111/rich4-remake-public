/*
 * 联机：ai-move 审计的几处订正与单机同一条路
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 服务器替电脑 / 掉线代打的座位出手（`Room.decideForCurrent` → core 的 `decideAction`），
 * 客户端按广播重放。这里钉住：服务器给出的那一手 = 单机同一局面给出的那一手，重放后逐条指纹一致。
 *
 *   ① 漲價卡的設施一支（`0x004205f6 mov [esp+4], esi`）：手牌 ≤ 8 ⇒ 只选**第一栋**合格設施。
 *   ② 开着保釋窗被托管的真人：关窗（`declineDecision`），不再自拟「挑最便宜的同伴」。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  decideAction,
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

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

const baseGame = (map: Map0): GameState => {
  const s = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 11, mode: 'multiplayer' });
  const home = s.players[0]!;
  return {
    ...s,
    players: s.players.map((p) =>
      p.whoPlays !== 0
        ? p
        : { ...p, whoPlays: p.landingWhoPlays ?? 0, nodeId: home.nodeId, lastNodeId: home.lastNodeId, xpos: home.xpos, ypos: home.ypos },
    ),
  };
};

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'AUDITAI',
    map,
    globalMapId: 0,
    seed: 11,
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

describe('★★ 联机：ai-move 审计订正与单机同一条路', () => {
  run('★★ ① 电脑出漲價卡：两栋合格設施只选画面上靠前的那栋（esi 残值），服务器与单机同一手、重放一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = baseGame(map);
    const facNodes = map.nodes.filter((n) => n.ref.kind === 'facility');
    // 找两栋設施节点，彼此都在 ±220 的视野里
    let a = -1;
    let b = -1;
    outer: for (const n1 of facNodes) {
      for (const n2 of facNodes) {
        if (n1.id === n2.id || n1.ref.kind !== 'facility' || n2.ref.kind !== 'facility') continue;
        if (n1.ref.index === n2.ref.index) continue;
        if (Math.abs(n1.x - n2.x) <= 200 && Math.abs(n1.y - n2.y) <= 200) {
          a = n1.id;
          b = n2.id;
          break outer;
        }
      }
    }
    expect(a).toBeGreaterThan(0);
    const na = map.nodes[a - 1]!;
    const nb = map.nodes[b - 1]!;
    const fa = na.ref.kind === 'facility' ? na.ref.index : -1;
    const fb = nb.ref.kind === 'facility' ? nb.ref.index : -1;
    const facilityOwner = [...s0.facilityOwner];
    const facilityLevel = [...s0.facilityLevel];
    const facilityType = [...s0.facilityType];
    facilityOwner[fa] = 2;
    facilityOwner[fb] = 2;
    facilityType[fa] = 1; // 旅館
    facilityType[fb] = 2; // 購物中心
    facilityLevel[fa] = 3;
    facilityLevel[fb] = 5;
    const state: GameState = {
      ...s0,
      currentPlayer: 1,
      phase: 'awaitingRoll',
      aiStep: 2,
      aiBranch: 1,
      pending: null,
      facilityOwner,
      facilityLevel,
      facilityType,
      landOwner: s0.landOwner.map(() => 0),
      players: s0.players.map((p, i) =>
        i === 1 ? { ...p, nodeId: a, cards: [27], aiFlags: 3, personality: 2, hostility: [0, 0, 0, 0] } : p,
      ),
    };
    // 画面行序（先 y 后 x）靠前的那栋 = 第一栋合格設施
    const first = na.y < nb.y || (na.y === nb.y && na.x < nb.x) ? fa : fb;
    const room = roomFrom(map, state);
    const mirror = { s: state };
    const act = room.decideForCurrent();
    expect(act).toEqual({ type: 'useCard', cardId: 27, target: { kind: 'facility', facilityId: first } });
    expect(decideAction({ state, map })).toEqual(act);
    expect(submitBoth(room, mirror, topo, 1, act!).ok).toBe(true);
  });

  run('★★ ② 开着保釋窗被托管的真人：服务器替他关窗（declineDecision），重放一致、點券不动', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = baseGame(map);
    const state: GameState = {
      ...s0,
      currentPlayer: 0,
      phase: 'turnEnd',
      prisonOccupancy: s0.prisonOccupancy.map((v, i) => (i === 1 ? 3 : v)),
      pending: {
        kind: 'bail',
        place: 'prison',
        candidates: [{ slot: 1, player: 1, name: 'P1', cost: 30, affordable: true }],
        points: 500,
      },
      players: s0.players.map((p, i) =>
        i === 0 ? { ...p, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT, points: 500 } : p,
      ),
    };
    const room = roomFrom(map, state);
    const mirror = { s: state };
    const act = room.decideForCurrent();
    expect(act).toEqual({ type: 'declineDecision' });
    expect(decideAction({ state, map })).toEqual(act);
    expect(submitBoth(room, mirror, topo, 0, act!).ok).toBe(true);
    expect(room.state.pending).toBeNull();
    expect(room.state.players[0]!.points).toBe(500);
  });
});
