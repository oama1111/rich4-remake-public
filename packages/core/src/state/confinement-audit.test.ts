/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ provenance 审计（events 区，2026-09-24）：关押 / 保釋 / 旅館住店几处与 exe 不符之处的回归。
 *   逐条对应 `docs/audit/provenance-events.md` 的 C-* 行。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SPECIAL_KIND, parseMap } from '../loaders/map.ts';
import { landAll, makeGameState, makeNode, makePlayer, makeFacility } from '../testing/factories.ts';
import { tickTurnCounters, RELEASE_PENDING } from '../rules/blocking.ts';
import { confine } from '../rules/confinement.ts';
import { canAffordBail } from '../rules/visit.ts';
import { newGame } from '../rules/new-game.ts';
import { facilityIndexOf } from '../rules/land.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_HUMAN, WHO_PLAYS_RELOCATED } from './types.ts';

describe('C-04/C-05 冬眠·夢遊·龜行：关押当天（含刚放出来那天）都不走（0x0041c95e / 0x0041caf7）', () => {
  it('刚放出来（计数原版仍停在 0x80）⇒ 三项都不减', () => {
    const p = makePlayer({ index: 0 });
    const q = { ...p, blocking: { ...p.blocking, sleeping: 2, sleepWalking: 3, tortoiseWalking: 4 } };
    const t = tickTurnCounters(q, true);
    expect(t.player.blocking.sleeping).toBe(2);
    expect(t.player.blocking.sleepWalking).toBe(3);
    expect(t.player.blocking.tortoiseWalking).toBe(4);
  });

  it('在押期间龜行也不减（先前龜行不受闸）', () => {
    const p = makePlayer({ index: 0 });
    const q = { ...p, blocking: { ...p.blocking, inPrison: 2, tortoiseWalking: 4 } };
    expect(tickTurnCounters(q).player.blocking.tortoiseWalking).toBe(4);
    const free = { ...p, blocking: { ...p.blocking, tortoiseWalking: 4 } };
    expect(tickTurnCounters(free).player.blocking.tortoiseWalking).toBe(3);
  });
});

describe('C-16 加刑那一支不写占用表（0x0043d6bd..0x0043d6d0 直落 0x43d6d6）', () => {
  it('被保釋过（0x80、占用 0）又被关 ⇒ 天数续上、占用表仍是 0', () => {
    const p = makePlayer({ index: 0 });
    const players = [{ ...p, blocking: { ...p.blocking, inPrison: RELEASE_PENDING } }];
    const occ = new Array<number>(8).fill(0);
    const r = confine(players, occ, 'prison', 0, 3);
    expect(r.extended).toBe(true);
    expect(r.occupancy[0]).toBe(0);
  });
});

describe('C-25/C-26 真人保釋：点券 ≥ 赎金即可（0x0043d0d4 jl）、被保的人对保釋者敌意 −max(天,1)×100×物價（0x0043cf21..0x0043cf4d）', () => {
  it('判据：真人 30 點券保得了玩家、300 點券保得了惡人；电脑那一支照旧', () => {
    expect(canAffordBail(30, 0, true)).toBe(true);
    expect(canAffordBail(30, 0)).toBe(false);
    expect(canAffordBail(300, 4, true)).toBe(true);
    expect(canAffordBail(300, 4)).toBe(false);
  });

  it('真人点保釋 1 号（剩 3 天）⇒ 1 号对我的敌意 −3×100×物價，付 30 點券', () => {
    const topo: MapTopology = {
      nodes: [makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.PRISON }), makeNode({ id: 2, adjacent: [1] })],
      lands: [],
    };
    const occ = new Array<number>(8).fill(0);
    occ[1] = 1;
    const s = makeGameState({
      currentPlayer: 0,
      priceIndex: 2,
      phase: 'settling',
      prisonOccupancy: occ,
      players: [0, 1, 2, 3].map((i) => {
        const p = makePlayer({ index: i, whoPlays: i === 0 ? WHO_PLAYS_HUMAN : 2, nodeId: i === 0 ? 1 : 2, points: 30 });
        const hostility = [...p.hostility];
        if (i === 1) hostility[0] = 1000;
        return i === 1 ? { ...p, hostility, blocking: { ...p.blocking, inPrison: 3 } } : p;
      }),
    });
    const landed = reduce(s, { type: 'settle' }, topo);
    expect(landed.pending?.kind).toBe('bail');
    const r = reduce(landed, { type: 'bail', slot: 1 }, topo);
    expect(r.players[0]!.points).toBe(0);
    expect(r.players[1]!.blocking.inPrison).toBe(RELEASE_PENDING);
    expect(r.prisonOccupancy[1]).toBe(0);
    expect(r.players[1]!.hostility[0]).toBe(1000 - 3 * 100 * 2);
  });
});

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

describe('C-28/C-29 旅館住店（0x0041a78f..0x0041a85e）', () => {
  function hotelScene(reaperSeat: number | null) {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const facNode = map.nodes.find((n) => facilityIndexOf(n.type) !== null)!;
    const idx = facilityIndexOf(facNode.type)!;
    const fac = makeFacility({ id: idx, type: 1, owner: 2, level: 3, rateByLevel: [100, 200, 400, 800, 1600, 3200] });
    const base = landAll(newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 1 }), map.nodes);
    const facilityOwner = [...base.facilityOwner];
    const facilityLevel = [...base.facilityLevel];
    const facilityType = [...base.facilityType];
    facilityOwner[idx] = 2;
    facilityLevel[idx] = 3;
    facilityType[idx] = 1;
    const other = map.nodes.find((n) => n.id !== facNode.id && n.walkable)!;
    const state: GameState = {
      ...base,
      priceIndex: 1,
      players: base.players.map((p, i) => ({
        ...p,
        nodeId: i === 0 ? facNode.id : other.id,
        cash: 100_000,
        moneyInBank: 0,
        godInfo: reaperSeat === i ? 0xe : 0,
      })),
      facilityOwner,
      facilityLevel,
      facilityType,
      stepsTotal: 4,
      phase: 'settling',
    };
    return { state, topo: { nodes: map.nodes, lands: map.lands, facilities: [fac] }, facNode, fac };
  }

  run('当前玩家对设施主人的敌意 +20×天×物價（记在当前玩家头上）', () => {
    const { state, topo } = hotelScene(null);
    const r = reduce(state, { type: 'settle' }, topo);
    const b = r.players[0]!.blocking.inHotel;
    expect(b).not.toBe(0);
    const days = b === RELEASE_PENDING ? 1 : b + 1;
    expect(r.players[0]!.hostility[1]! - state.players[0]!.hostility[1]!).toBe(20 * days);
  });

  run('死神换人付：住店者格子 = 当前玩家的格、贴图 = 設施坐标、**不**置 0x20；敌意仍记在当前玩家头上', () => {
    const { state, topo, facNode, fac } = hotelScene(2);
    const r = reduce(state, { type: 'settle' }, topo);
    const lodger = r.players[2]!;
    expect(lodger.blocking.inHotel).not.toBe(0);
    expect(lodger.nodeId).toBe(facNode.id);
    expect(lodger.xpos).toBe(fac.x);
    expect(lodger.whoPlays & WHO_PLAYS_RELOCATED).toBe(0);
    expect(r.players[0]!.hostility[1]).toBeGreaterThan(state.players[0]!.hostility[1]!);
  });
});
