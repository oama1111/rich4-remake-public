/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ provenance 审计（events 区，2026-09-24）：特殊格 / 魔法屋 / 探監 / 傳送機的几处与 exe 不符之处。
 *   每条都在 `docs/audit/provenance-events.md` 有对应行（VA 见各用例标题）。
 */

import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from './types.ts';
import { receiveCard, cardToDiscard } from '../rules/receive-card.ts';
import { applyMagicEffect } from '../places/magic-house.ts';
import { priceOf } from '../cards/rob.ts';
import { ACTOR_PLACE, specialSlotOf } from '../rules/special-actors.ts';
import { teleportLand, teleportPlayer } from '../rules/teleport.ts';
import { CONFINEMENT_GATE_TYPE } from '../rules/confinement.ts';

/** 15 张全是同一张便宜卡以外的牌：第 3 槽最便宜 */
function fullHand(): number[] {
  const hand = new Array<number>(15).fill(0);
  // 选出一张价最高的卡填满，再在第 3 槽放一张价最低的
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const dear = ids.reduce((a, b) => (priceOf(b) > priceOf(a) ? b : a));
  const cheap = ids.reduce((a, b) => (priceOf(b) < priceOf(a) ? b : a));
  hand.fill(dear);
  hand[3] = cheap;
  return hand;
}

describe('receiveCard（0x004412e4）：满手弃牌回牌堆', () => {
  it('满 15 张：最便宜那张 +1 回牌堆（0x004413a2），新卡 −1（0x0044133b）', () => {
    const hand = fullHand();
    const cheap = hand[3]!;
    const p = makePlayer({ index: 0, cards: hand });
    expect(cardToDiscard(p)).toBe(cheap);
    const amount = new Array<number>(30).fill(2);
    const newCard = hand[0]! === 1 ? 2 : 1;
    const r = receiveCard(p, newCard, amount);
    expect(r.discarded).toBe(cheap);
    expect(r.player.cards).toHaveLength(15);
    expect(r.player.cards).not.toContain(cheap);
    expect(r.player.cards[14]).toBe(newCard);
    expect(r.cardAmount[cheap - 1]).toBe(3);
    expect(r.cardAmount[newCard - 1]).toBe(newCard === cheap ? 2 : 1);
  });

  it('没满：只扣新卡', () => {
    const p = makePlayer({ index: 0, cards: [1, 2] });
    const r = receiveCard(p, 5, new Array<number>(30).fill(1));
    expect(r.discarded).toBe(0);
    expect(r.player.cards).toEqual([1, 2, 5]);
    expect(r.cardAmount[4]).toBe(0);
    expect(r.cardAmount.reduce((a, b) => a + b, 0)).toBe(29);
  });
});

describe('★ 抽卡格（0x0041b343 → 0x441e12 → 0x4412e4）', () => {
  it('满手抽卡：被弃的那张回牌堆，牌堆总数不变', () => {
    const topo: MapTopology = {
      nodes: [makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.CARD }), makeNode({ id: 2, adjacent: [1] })],
      lands: [],
    };
    const hand = fullHand();
    const s = makeGameState({
      rngState: 777,
      phase: 'settling',
      cardAmount: new Array<number>(30).fill(1),
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: i === 0 ? 1 : 2, cards: i === 0 ? hand : [] })),
    });
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.players[0]!.cards).toHaveLength(15);
    const total = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
    // 抽走一张、弃回一张 ⇒ 总数不变
    expect(total(r.cardAmount)).toBe(total(s.cardAmount));
    expect(r.cardAmount[hand[3]! - 1]).toBe(2);
  });
});

describe('★ 魔法屋 6「得一張卡片」（0x004320ee call 0x441e12）', () => {
  it('满手时先弃最便宜的一张，手牌不超过 15', () => {
    const hand = fullHand();
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cards: i === 0 ? hand : [] }));
    const r = applyMagicEffect(6, [0], {
      players,
      cardAmount: new Array<number>(30).fill(1),
      tools: [],
      toolStock: [],
      priceIndex: 1,
      initiator: 1,
      nodeOf: () => null,
      nextRandom: () => 0,
    });
    expect(r.players[0]!.cards).toHaveLength(15);
    expect(r.players[0]!.cards).not.toContain(hand[3]);
    expect(r.cardAmount.reduce((a, b) => a + b, 0)).toBe(30);
  });
});

describe('★ 魔法屋 2/10 过「免罪 → 嫁禍」二级判定（0x00431e54 / 0x0043240d call 0x441210）', () => {
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.MAGIC_HOUSE }),
      makeNode({ id: 2, adjacent: [1, 3] }),
      makeNode({ id: 3, adjacent: [2], type: CONFINEMENT_GATE_TYPE.prison }),
      makeNode({ id: 4, adjacent: [3], type: CONFINEMENT_GATE_TYPE.hospital }),
    ],
    lands: [],
  };
  const table = (cards0: number[]): GameState =>
    makeGameState({
      rngState: 4321,
      currentPlayer: 1,
      phase: 'turnEnd',
      priceIndex: 2,
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, whoPlays: i === 1 ? WHO_PLAYS_HUMAN : WHO_PLAYS_COMPUTER, nodeId: 2, cards: i === 0 ? cards0 : [] }),
      ),
    });

  for (const [option, field] of [[2, 'inPrison'], [10, 'inHospital']] as const) {
    it(`效果 ${option}：持免罪卡(21) ⇒ 免罪卡被扣、不关；敌意照记`, () => {
      const r = reduce(table([21]), { type: 'magicHouse', option }, topo);
      expect(r.players[0]!.cards).toEqual([]);
      expect(r.players[0]!.blocking[field]).toBe(0);
      expect(r.prisonOccupancy[0]).toBe(0);
      expect(r.hospitalOccupancy[0]).toBe(0);
      // 0x00431e45 / 0x004323fe：敌意在判定**之前**就记了（90 × 物價）
      expect(r.players[0]!.hostility[1]).toBe(90 * 2);
    });

    it(`效果 ${option}：没卡 ⇒ 关 3 天`, () => {
      const r = reduce(table([]), { type: 'magicHouse', option }, topo);
      expect(r.players[0]!.blocking[field]).toBe(3);
    });

    it(`效果 ${option}：电脑持嫁禍卡(19) ⇒ 换人关（替死鬼 ≠ 中签者），嫁禍卡被扣`, () => {
      const r = reduce(table([19]), { type: 'magicHouse', option }, topo);
      expect(r.players[0]!.blocking[field]).toBe(0);
      expect(r.players[0]!.cards).toEqual([]);
      const victims = r.players.filter((p) => p.blocking[field] === 3).map((p) => p.index);
      expect(victims).toHaveLength(1);
      expect(victims[0]).not.toBe(0);
    });
  }
});

describe('★ 魔法屋 9「就地拆除房屋」= 0x40ab4a mode 0 的两支（0x0043234c）', () => {
  const base = (nodeType: number): { s: GameState; topo: MapTopology } => {
    const topo: MapTopology = {
      nodes: [
        makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.MAGIC_HOUSE }),
        makeNode({ id: 2, adjacent: [1], type: nodeType }),
      ],
      lands: [makeLand({ id: 3 })],
      facilities: [makeFacility({ id: 5 })],
    };
    const s = makeGameState({
      currentPlayer: 1,
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, whoPlays: i === 1 ? WHO_PLAYS_HUMAN : WHO_PLAYS_COMPUTER, nodeId: 2 })),
    });
    return { s, topo };
  };

  it('連鎖店（type 1，1 级）⇒ 夷平成 0 级**住宅**（种类也写回）', () => {
    const { s, topo } = base(0x7d0 + 3);
    const landOwner = [...s.landOwner];
    const landLevel = [...s.landLevel];
    const landType = [...s.landType];
    landOwner[3] = 3;
    landLevel[3] = 1;
    landType[3] = 1;
    const r = reduce({ ...s, landOwner, landLevel, landType }, { type: 'magicHouse', option: 9 }, topo);
    expect(r.landLevel[3]).toBe(0);
    expect(r.landType[3]).toBe(0);
  });

  it('設施 2 级 ⇒ 1 级、种类不变', () => {
    const { s, topo } = base(0xfa0 + 5);
    const facilityOwner = [...s.facilityOwner];
    const facilityLevel = [...s.facilityLevel];
    const facilityType = [...s.facilityType];
    facilityOwner[5] = 3;
    facilityLevel[5] = 2;
    facilityType[5] = 1;
    const r = reduce({ ...s, facilityOwner, facilityLevel, facilityType }, { type: 'magicHouse', option: 9 }, topo);
    expect(r.facilityLevel[5]).toBe(1);
    expect(r.facilityType[5]).toBe(1);
  });

  it('設施 1 级 ⇒ 0 级、种类清 0（0x0040ac2e..0x0040ac33 并放人）', () => {
    const { s, topo } = base(0xfa0 + 5);
    const facilityOwner = [...s.facilityOwner];
    const facilityLevel = [...s.facilityLevel];
    const facilityType = [...s.facilityType];
    facilityOwner[5] = 3;
    facilityLevel[5] = 1;
    facilityType[5] = 1;
    const r = reduce({ ...s, facilityOwner, facilityLevel, facilityType }, { type: 'magicHouse', option: 9 }, topo);
    expect(r.facilityLevel[5]).toBe(0);
    expect(r.facilityType[5]).toBe(0);
  });
});

describe('★ 电脑探監保釋到惡人 ⇒ 摆到监狱门口（0x0043d580 call 0x43d7bf）', () => {
  it('小偷（槽 4）：占用表清、替身上盘在关押格、主人 = 保釋他的人', () => {
    const gate = CONFINEMENT_GATE_TYPE.prison;
    const topo: MapTopology = {
      nodes: [
        makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.PRISON }),
        makeNode({ id: 2, adjacent: [1], type: gate }),
      ],
      lands: [],
    };
    // 找一个第一掷为奇数（「管」）的种子
    let seed = 1;
    for (;;) {
      const g = new WatcomRng();
      g.setState(seed);
      if ((g.next() & 1) === 1) break;
      seed++;
    }
    const prisonOccupancy = new Array<number>(8).fill(0);
    prisonOccupancy[4] = 1;
    const s = makeGameState({
      rngState: seed,
      currentPlayer: 2,
      phase: 'settling',
      prisonOccupancy,
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, whoPlays: WHO_PLAYS_COMPUTER, nodeId: i === 2 ? 1 : 2, personality: 2, points: 1000 }),
      ),
    });
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.prisonOccupancy[4]).toBe(0);
    expect(r.players[2]!.points).toBe(700);
    const a = r.specialActors[specialSlotOf(4)]!;
    expect(a.place).toBe(ACTOR_PLACE.board);
    expect(a.nodeId).toBe(2);
    expect(a.owner).toBe(2);
  });
});

describe('★ 傳送機（0x004474a9 / 0x00447844）', () => {
  it('住宅搬家：到期日跟着搬（+0x30）、源头上次過路費清零（+0x2c）', () => {
    const s = makeGameState();
    const landOwner = [...s.landOwner];
    const landTenure = [...s.landTenure];
    const landLastToll = [...s.landLastToll];
    landOwner[3] = 1;
    landTenure[3] = 0x07ce0105;
    landLastToll[3] = 500;
    landLastToll[7] = 90;
    const r = teleportLand({ ...s, landOwner, landTenure, landLastToll }, 3, 7)!;
    expect(r.landOwner[7]).toBe(1);
    expect(r.landTenure[7]).toBe(0x07ce0105);
    expect(r.landTenure[3]).toBe(0);
    expect(r.landLastToll[3]).toBe(0);
    // 新址的上次過路費不写（原版只清源）
    expect(r.landLastToll[7]).toBe(90);
  });

  it('搬人：附身神明（+0x3f 跟班物件）的所在格一起搬（0x40fc00）', () => {
    const nodes = [
      makeNode({ id: 1, adjacent: [2], x: 0, y: 0 }),
      makeNode({ id: 2, adjacent: [1, 3], x: 32, y: 0 }),
      makeNode({ id: 3, adjacent: [2], x: 64, y: 0 }),
    ];
    const base = makeGameState();
    const objects = base.objects.map((o, i) => (i === 0 ? { ...o, type: 1, nodeId: 1 } : o));
    const s: GameState = {
      ...base,
      objects,
      players: base.players.map((p, i) => (i === 0 ? { ...p, nodeId: 1, godInfo: 1 } : p)),
    };
    const r = teleportPlayer(s, nodes, 0, 3)!;
    expect(r.players[0]!.nodeId).toBe(3);
    expect(r.objects[0]!.nodeId).toBe(3);
  });
});

describe('★ 福神代蓋空設施（真人选种类框）：选完才掷台词 rand（0x0040fa49）', () => {
  it('答框成功 ⇒ rngState 前进 1、交出 lastGodLine', () => {
    const topo: MapTopology = {
      nodes: [makeNode({ id: 1, adjacent: [2], type: 0xfa0 + 5 }), makeNode({ id: 2, adjacent: [1] })],
      lands: [],
      facilities: [makeFacility({ id: 5 })],
    };
    const base = makeGameState({ rngState: 999, currentPlayer: 0, phase: 'awaitingDecision' });
    // 福神附身：handle 3（固定槽 2 = 小福神；`0x0040f8da cmp dl,3` 比的就是 +0x3f 的 handle）
    const objects = base.objects.map((o, i) => (i === 2 ? { ...o, type: 3, attached: 1, state: 5 } : o));
    const s: GameState = {
      ...base,
      objects,
      players: base.players.map((p, i) => (i === 0 ? { ...p, nodeId: 1, whoPlays: WHO_PLAYS_HUMAN, godInfo: 3 } : p)),
      pending: { kind: 'buildFacility', facilityId: 5, name: 'x', price: 0, choices: [0, 1, 2, 3, 4], free: true },
    };
    const r = reduce(s, { type: 'buildFacility', facilityType: 1 }, topo);
    expect(r.facilityLevel[5]).toBe(1);
    const g = new WatcomRng();
    g.setState(999);
    const v = g.next();
    expect(r.rngState).toBe(g.getState());
    expect(r.lastGodLine).toEqual({ player: 0, event: v & 1 });
  });
});
