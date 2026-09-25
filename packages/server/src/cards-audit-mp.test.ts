/*
 * 联机镜像：卡片 / 道具 / 物件出处审计（2026-09-24）的几条修正 —— 服务器与客户端走同一个 core
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ① 出牌回牌堆（`remove_card` 0x004413a2）：房间与旁观端重放的牌堆逐格一致；
 * ② 卡片 / 道具只能在按 GO 之前用（走子态 0）：走子中的出牌被房间拒收；
 * ③ 放路障直接 dec、不回库存（0x00446c7e）：两端库存一致。
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
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes });

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((character, i) => ({ seat: i, name: `P${i}`, character, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

function roomWith(id: string, patch: (s: GameState) => GameState) {
  const map = loadMap();
  const s0 = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 17, mode: 'multiplayer' });
  const base = patch({
    ...s0,
    players: s0.players.map((p, i) => (i === 0 ? p : { ...p, whoPlays: p.landingWhoPlays ?? p.whoPlays })),
  });
  const room = new Room({ id, map, globalMapId: 0, seed: 17, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state: base, snapshot: '' } });
  room.start();
  return { room, base, topo: topoOf(map) };
}

describe('★ 审计 2026-09-24：卡片 / 道具修正在联机里同一条路', () => {
  run('① 真人打均富卡：牌回牌堆 +1，旁观端重放一致', () => {
    const { room, base, topo } = roomWith('CARDA', (s) => ({
      ...s,
      phase: 'awaitingRoll',
      players: s.players.map((p, i) => (i === 0 ? { ...p, cards: [1] } : p)),
    }));
    const r = room.submit(0, { type: 'useCard', cardId: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(base, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(mirror.cardAmount).toEqual(room.state.cardAmount);
    expect(room.state.cardAmount[0]).toBe(base.cardAmount[0]! + 1);
  });

  run('② 走子中出牌 ⇒ 房间拒收（卡片/道具只在按 GO 之前）', () => {
    const { room } = roomWith('CARDB', (s) => ({
      ...s,
      phase: 'moving',
      stepsRemaining: 3,
      players: s.players.map((p, i) => (i === 0 ? { ...p, cards: [1] } : p)),
    }));
    expect(room.submit(0, { type: 'useCard', cardId: 1 }).ok).toBe(false);
  });

  run('③ 放路障：道具 −1、库存不回；两端一致', () => {
    const { room, base, topo } = roomWith('CARDC', (s) => {
      const tools = [...s.tools];
      tools[2] = 1;
      return { ...s, phase: 'awaitingRoll', tools };
    });
    const me = base.players[0]!;
    const target = topo.nodes.find((n) => n.id !== me.nodeId && n.adjacent.length > 0 && reduce(base, { type: 'useTool', toolId: 2, nodeId: n.id }, topo) !== base);
    expect(target).toBeDefined();
    if (target === undefined) return;
    const r = room.submit(0, { type: 'useTool', toolId: 2, nodeId: target.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(base, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.toolStock).toEqual(base.toolStock);
    expect(room.state.tools[2]).toBe(0);
  });

  run('④ 电脑出夢遊卡打真人持嫁禍卡的人：挂起、提交权归持卡人（actingSeat），他答完两端一致', () => {
    const { room, base, topo } = roomWith('CARDD', (s) => ({
      ...s,
      phase: 'awaitingRoll',
      currentPlayer: 1,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, cards: [16] } : i === 0 ? { ...p, cards: [19] } : p,
      ),
    }));
    const r1 = room.submit(1, { type: 'useCard', cardId: 16, target: { kind: 'player', index: 0 } });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const mid = reduce(base, r1.broadcast.action, topo);
    expect(mid.pending?.kind).toBe('scapegoat');
    expect(room.actingSeat).toBe(0);
    // 出牌者那一端替他答 ⇒ 被拒
    expect(room.submit(1, { type: 'answerScapegoat', target: 2 }).ok).toBe(false);
    const r2 = room.submit(0, { type: 'answerScapegoat', target: 1 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const mirror = reduce(mid, r2.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.players[1]!.blocking.sleepWalking).toBe(4);
    expect(room.state.players[0]!.cards).toEqual([]);
  });

  run('⑤ 真人下車（道具 14）：两端一致', () => {
    const { room, base, topo } = roomWith('CARDE', (s) => ({
      ...s,
      phase: 'awaitingRoll',
      players: s.players.map((p, i) => (i === 0 ? { ...p, trafficMethod: 2, ndices: 3 } : p)),
    }));
    const r = room.submit(0, { type: 'useTool', toolId: 14 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mirror = reduce(base, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.players[0]!.trafficMethod).toBe(0);
  });
});
