/*
 * 联机镜像：回合循环出处审计（2026-09-24）的几条修正 —— 服务器与客户端走同一个 core
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ① 開局资金：真人对半（`0x00407307 sar eax,1`）、电脑按角色比例 —— 服务器 `newGame` 与单机同源；
 * ② 龜行：`rollDice` 只走一步、不掷骰（`0x0040dd7e`）—— 旁观端重放逐条指纹一致。
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

/** 0 号真人阿土伯（ratio 40），其余电脑 */
const seats = (): SeatInfo[] =>
  [1, 0, 2, 3].map((character, i) => ({ seat: i, name: `P${i}`, character, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

describe('★ 审计 2026-09-24：回合循环修正在联机里同一条路', () => {
  run('① 開局：真人阿土伯 150000/150000，电脑阿土伯仍按 40%；房间与单机 newGame 一致', () => {
    const map = loadMap();
    const room = new Room({ id: 'LOOPA', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS });
    const human = room.state.players[0]!;
    expect(human.cash).toBe(150_000);
    expect(human.moneyInBank).toBe(150_000);
    const single = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
    expect(stateFingerprint(single)).toBe(stateFingerprint(room.state));
    const ai = newGame({ map, players: [{ character: 1, kind: 'computer' }, { character: 0, kind: 'computer' }], seed: 11 });
    expect(ai.players[0]!.cash).toBe(120_000);
  });

  run('② 龜行的真人按 GO：一步、不动 rng；镜像与服务器指纹一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
    const base: GameState = {
      ...s0,
      phase: 'awaitingRoll',
      players: s0.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, tortoiseWalking: 2 } } : { ...p, whoPlays: p.landingWhoPlays ?? p.whoPlays },
      ),
    };
    const room = new Room({ id: 'LOOPB', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state: base, snapshot: '' } });
    room.start();
    const r = room.submit(0, { type: 'rollDice' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(base, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.stepsRemaining).toBe(1);
    expect(room.state.dice).toEqual([]);
    expect(room.state.rngState).toBe(base.rngState);
  });

  run('★ F1：客户端带 `forced` 的 rollDice 一律拒收（不编号、镜像不动）；不带的照常', () => {
    const map = loadMap();
    const s0 = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
    const base: GameState = {
      ...s0,
      phase: 'awaitingRoll',
      players: s0.players.map((p) => ({ ...p, whoPlays: p.landingWhoPlays ?? p.whoPlays })),
    };
    const room = new Room({ id: 'LOOPC', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state: base, snapshot: '' } });
    room.start();
    const fp = room.fingerprint;
    const seq = room.sequenceLength;
    for (const forced of [6, 100, 0, -1]) {
      const r = room.submit(0, { type: 'rollDice', forced });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('forcedDiceNotAllowed');
    }
    expect(room.fingerprint).toBe(fp);
    expect(room.sequenceLength).toBe(seq);
    expect(room.submitSystem({ type: 'rollDice', forced: 3 }).ok).toBe(false);
    const ok = room.submit(0, { type: 'rollDice' });
    expect(ok.ok).toBe(true);
    expect(room.state.phase).toBe('moving');
  });

  run('★ 走子中再发 startTurn（想重掷）⇒ 拒收，镜像不动', () => {
    const map = loadMap();
    const s0 = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
    const base: GameState = { ...s0, phase: 'awaitingRoll', players: s0.players.map((p) => ({ ...p, whoPlays: p.landingWhoPlays ?? p.whoPlays })) };
    const room = new Room({ id: 'LOOPD', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state: base, snapshot: '' } });
    room.start();
    expect(room.submit(0, { type: 'rollDice' }).ok).toBe(true);
    const fp = room.fingerprint;
    expect(room.submit(0, { type: 'startTurn' }).ok).toBe(false);
    expect(room.fingerprint).toBe(fp);
  });

  run('★ F3：住宿 + 坐牢的真人回合开头 —— 服务器与旁观端都只弹「坐牢中」一扇（最后一项覆写）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
    const base: GameState = {
      ...s0,
      phase: 'turnStart',
      players: s0.players.map((p, i) => ({
        ...p,
        whoPlays: p.landingWhoPlays ?? p.whoPlays,
        ...(i === 0 ? { blocking: { ...p.blocking, inHotel: 4, inPrison: 2 } } : {}),
      })),
    };
    const room = new Room({ id: 'LOOPE', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state: base, snapshot: '' } });
    room.start();
    const r = room.submit(0, { type: 'startTurn' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const viewer = reduce(base, r.broadcast.action, topo);
    for (const s of [room.state, viewer]) {
      expect(s.notices.map((n) => n.key)).toEqual(['confinement.prison']);
      expect(s.notices[0]!.args[1]).toBe(3);
    }
  });
});
