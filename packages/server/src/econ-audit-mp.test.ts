/*
 * 联机镜像：econ 审计（2026-09-24）改到的几条收费 / 破产规则，服务器与旁观端逐条一致
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 1. 过路费记敌意（`0x00419df3 call 0x40df69(当前玩家, 地主, 实付/100)`）—— 电脑踩真人的地；
 * 2. 真人全出局即收局（`0x0040d029 test esi, esi`）—— 1 真人 + 3 电脑，真人付不起过路费 ⇒ 当场 gameOver，
 *    清算跳过（先前继续清算、电脑自己打到底）。
 *
 * 服务器 `Room` 与单机走同一个 `reduce`；这里把广播逐条喂给镜像，指纹必须一路相等。
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

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/** `payer` 站在 `owner` 的 2 级地上，结算前 */
function scene(map: Map0, mode: 'single' | 'multiplayer', payer: number, owner: number, payerCash: number): GameState {
  const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 11, mode });
  const node = map.nodes.find((n) => n.ref.kind === 'land' && n.specialKind === 0)!;
  if (node.ref.kind !== 'land') throw new Error('地图上没有地块格');
  const landIndex = node.ref.index;
  const landOwner = [...s0.landOwner];
  const landLevel = [...s0.landLevel];
  landOwner[landIndex] = owner + 1;
  landLevel[landIndex] = 2;
  return {
    ...s0,
    day: 5,
    currentPlayer: payer,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    landOwner,
    landLevel,
    players: s0.players.map((p, i) => ({
      ...p,
      whoPlays: p.landingWhoPlays ?? p.whoPlays,
      ...(i === payer ? { nodeId: node.id, cash: payerCash, moneyInBank: 0 } : {}),
    })),
  };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'ECOMP',
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

describe('★ econ 审计：收费敌意 / 真人全出局收局 —— 联机与单机同一条路', () => {
  run('电脑 3 号踩真人 0 号的地：付过路费、记敌意；旁观端重放一致；单机同结果', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = scene(map, 'multiplayer', 3, 0, 500_000);
    const room = roomFrom(map, state);
    let mirror = state;
    const submit = (seat: number, action: Action) => {
      const r = room.submit(seat, action);
      expect(r.ok).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    };
    submit(3, { type: 'settle' });
    const paid = 500_000 - room.state.players[3]!.cash;
    expect(paid).toBeGreaterThan(0);
    expect(room.state.players[3]!.hostility[0]).toBe(Math.trunc(paid / 100));
    expect(mirror.players[3]!.hostility).toEqual(room.state.players[3]!.hostility);

    const single = reduce(scene(map, 'single', 3, 0, 500_000), { type: 'settle' }, topo);
    expect(single.players[3]!.hostility).toEqual(room.state.players[3]!.hostility);
    expect(single.players[3]!.cash).toBe(room.state.players[3]!.cash);
  });

  run('唯一的真人 0 号付不起电脑的过路费 ⇒ 当场收局（码 1 那条路），地产不清算；旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = scene(map, 'multiplayer', 0, 2, 0);
    const room = roomFrom(map, state);
    let mirror = state;
    const r = room.submit(0, { type: 'settle' });
    expect(r.ok).toBe(true);
    if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.players[0]!.whoPlays).toBe(0);
    expect(room.state.phase).toBe('gameOver');
    expect(mirror.phase).toBe('gameOver');
    // 电脑 1..3 号都还在 —— 原版照样结束
    expect(room.state.players.filter((p, i) => i > 0 && p.whoPlays !== 0).length).toBe(3);

    const single = reduce(scene(map, 'single', 0, 2, 0), { type: 'settle' }, topo);
    expect(single.phase).toBe('gameOver');
  });

  run('15 日分紅按人加总：一家负一家正 ⇒ 电脑 1 号只进净额，不误判破产；旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = scene(map, 'multiplayer', 3, 0, 500_000);
    const [a, b] = map.commercials;
    const companyFunds = [...s0.companyFunds];
    companyFunds[a!.id] = -5_000;
    companyFunds[b!.id] = 8_000;
    const state: GameState = {
      ...s0,
      day: 14,
      phase: 'turnEnd',
      companyFunds,
      holdings: s0.holdings.map((row, p) =>
        row.map((h, i) => ({ ...h, amount: p === 1 && (i === a!.stockIndex || i === b!.stockIndex) ? 100 : 0 })),
      ),
      players: s0.players.map((p, i) => (i === 1 ? { ...p, cash: 100, moneyInBank: 0 } : p)),
    };
    const room = roomFrom(map, state);
    let mirror = state;
    const r = room.submit(3, { type: 'endTurn' });
    expect(r.ok).toBe(true);
    if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.day).toBe(15);
    expect(room.state.players[1]!.whoPlays).not.toBe(0);
    expect(room.state.players[1]!.moneyInBank).toBe(3_000);
  });
});
