/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ provenance 审计（events 区，2026-09-24）：四大惡人 / 乞丐 / 敌意几处与 exe 不符之处的回归。
 *   逐条对应 `docs/audit/provenance-events.md` 的 P-* / B-* / H-* 行。
 */
import { describe, expect, it } from 'vitest';
import { applyNpcEvents, runNpc, type NpcMap } from './npc-walk.ts';
import { ACTOR_PLACE, releaseNpc } from './special-actors.ts';
import { NPC } from './npc-actions.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { updateHostility } from './hostility.ts';
import { beggarAt } from './beggar.ts';
import { priceOf } from '../cards/rob.ts';
import type { MapObject } from '../cards/summon.ts';

function straight(special: Record<number, number> = {}): NpcMap {
  return {
    nodes: Array.from({ length: 21 }, (_, i) =>
      makeNode({ id: i + 1, adjacent: i === 0 ? [2] : [i, i + 2], specialKind: special[i + 1] ?? 0 }),
    ),
  };
}
const line = (from: number): number => from + 1;
const rng = (seed = 7): WatcomRng => new WatcomRng(seed);
const obj = (type: number, nodeId: number): MapObject => ({ type, nodeId, state: 0, attached: 0 });

describe('P-09/P-17 夢遊中的惡人（+13 ≠ 0）', () => {
  it('小偷不捡东西、不偷點券（0x0041b9a9 / 0x0041c187）', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20 }), makePlayer({ index: 1, nodeId: 3, points: 500 })],
      objects: [obj(14, 2)],
    });
    const w = runNpc(NPC.thief, { ...releaseNpc(1, 0, 3), sleepwalkDays: 2 }, s, straight(), line, rng());
    expect(w.events).toEqual([]);
  });
});

describe('P-14 路障拦下强盗：尾段照跑（0x0041bd3c jge 0x41c164）', () => {
  it('拦在有人的那一格 ⇒ 照样奪卡', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20 }), makePlayer({ index: 1, nodeId: 3, cards: [9] })],
      objects: [obj(16, 3)],
    });
    const w = runNpc(NPC.robber, releaseNpc(1, 0, 6), s, straight(), line, rng());
    expect(w.path).toEqual([1, 2, 3]);
    expect(w.events.map((e) => e.kind)).toEqual(['trap', 'card']);
  });
});

describe('P-16 惡犬也咬惡人（0x0041b837..0x0041b8ef）', () => {
  it('小偷停在惡犬上 ⇒ dog 事件、进醫院', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })], objects: [obj(11, 3)] });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 2), s, straight(), line, rng());
    expect(w.events).toEqual([{ kind: 'dog', node: 3, object: 0 }]);
    expect(w.actor.place).toBe(ACTOR_PLACE.hospital);
  });

  it('路过（没停）不咬', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })], objects: [obj(11, 3)] });
    const w = runNpc(NPC.thug, releaseNpc(1, 0, 4), s, straight(), line, rng());
    expect(w.events).toEqual([]);
    expect(w.actor.place).toBe(ACTOR_PLACE.board);
  });
});

describe('P-19 偷谁：占用位里下标最小的那一位，出局了就谁都不偷（0x0041c1c9 / 0x0041c1d6）', () => {
  it('下标最小的是出局者（乞丐）⇒ 不往下找', () => {
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 20 }),
        makePlayer({ index: 1, nodeId: 3, whoPlays: 0, points: 500 }),
        makePlayer({ index: 2, nodeId: 3, points: 500 }),
      ],
    });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 2), s, straight(), line, rng());
    expect(w.events.filter((e) => e.kind === 'points')).toEqual([]);
  });

  it('关着的人不占位（清了节点位）⇒ 偷后面那一位', () => {
    const p1 = makePlayer({ index: 1, nodeId: 3, points: 500 });
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 20 }),
        { ...p1, blocking: { ...p1.blocking, inHospital: 2 } },
        makePlayer({ index: 2, nodeId: 3, points: 500 }),
      ],
    });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 2), s, straight(), line, rng());
    expect(w.events).toContainEqual({ kind: 'points', victim: 2, amount: 250 });
  });
});

describe('P-32/P-33 老家 = 放出来的地方（+11），先偷再查老家；门口不是落点格时第一次路过不回（0x0041c7a6..）', () => {
  it('从醫院保出来的強盜：路过監獄格不回；第一次踩醫院格只「记下」，第二次才回', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })] });
    const map = straight({ 3: SPECIAL_KIND.PRISON, 5: SPECIAL_KIND.HOSPITAL, 7: SPECIAL_KIND.HOSPITAL });
    const a = releaseNpc(1, 0, 8, { place: 'hospital', gateSpecialKind: 0 });
    expect(a.home).toBe(2);
    const w = runNpc(NPC.robber, a, s, map, line, rng());
    expect(w.events).toEqual([{ kind: 'home', place: 'hospital', node: 7 }]);
    expect(w.path).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(w.actor.place).toBe(ACTOR_PLACE.hospital);
  });

  it('门口就是落点格（kind 4）⇒ 当场 |0x80，第一次踩到監獄格就回', () => {
    const a = releaseNpc(1, 0, 3, { place: 'prison', gateSpecialKind: SPECIAL_KIND.PRISON });
    expect(a.home).toBe(0x81);
  });

  it('老家那一格站着人：先奪卡、再回去', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20 }), makePlayer({ index: 1, nodeId: 3, cards: [4] })],
    });
    const a = { ...releaseNpc(1, 0, 5), home: 0x81 };
    const w = runNpc(NPC.robber, a, s, straight({ 3: SPECIAL_KIND.PRISON }), line, rng());
    expect(w.events.map((e) => e.kind)).toEqual(['card', 'home']);
  });
});

describe('P-10 小偷拆陷阱：先回库存再发（0x0040e17a.. / 0x445a4d）', () => {
  it('库存 0 时也拿得到（先 +1 再 −1）', () => {
    const stock = new Array<number>(14).fill(0);
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })], objects: [obj(16, 2)], toolStock: stock });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 2), s, straight(), line, rng());
    const out = applyNpcEvents(s, 0, w.events).state;
    expect(out.tools[0 * 15 + 2]).toBe(1);
    expect(out.toolStock[2]).toBe(0);
  });
});

describe('P-22/P-23 強盜奪卡：每次只少一张；主人满手时先弃最便宜的一张（0x441343 / 0x4412e4）', () => {
  it('同一趟两次从同一人手里拿同号卡 ⇒ 第二次还能拿到另一张同号', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20 }), makePlayer({ index: 1, nodeId: 3, cards: [5, 5] })],
    });
    // 1 → 3 → 2 → 3：两次停在 3 号
    const hop = (from: number): number => (from === 3 ? 2 : 3);
    const w = runNpc(NPC.robber, releaseNpc(1, 0, 3), s, straight(), hop, rng());
    expect(w.events.filter((e) => e.kind === 'card')).toEqual([
      { kind: 'card', victim: 1, card: 5 },
      { kind: 'card', victim: 1, card: 5 },
    ]);
  });

  it('主人满 15 张：弃掉最便宜的一张，牌堆 + 手牌守恒', () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const dear = ids.reduce((a, b) => (priceOf(b) > priceOf(a) ? b : a));
    const cheap = ids.reduce((a, b) => (priceOf(b) < priceOf(a) ? b : a));
    const hand = new Array<number>(15).fill(dear);
    hand[0] = cheap;
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20, cards: hand }), makePlayer({ index: 1, nodeId: 3, cards: [dear] })],
      cardAmount: new Array<number>(30).fill(1),
    });
    const out = applyNpcEvents(s, 0, [{ kind: 'card', victim: 1, card: dear }]).state;
    expect(out.players[0]!.cards).toHaveLength(15);
    expect(out.players[0]!.cards).not.toContain(cheap);
    expect(out.cardAmount[cheap - 1]).toBe(2);
    expect(out.cardAmount[dear - 1]).toBe(1);
  });
});

describe('P-31 間諜取企業盈餘：企業自己付（0x0041c797 → 0x0041d2e6 / 0x0041d2ea）', () => {
  it('+0x28 归 0、+0x2c 同减；保釋人存款 +盈餘；企業主一分不动', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20, moneyInBank: 0 }), makePlayer({ index: 1, nodeId: 20, cash: 5000, moneyInBank: 0 })],
      companyFunds: [0, 8000],
      companyProfit: [0, 20000],
    });
    const out = applyNpcEvents(s, 0, [{ kind: 'surplus', landlord: 1, amount: 8000, company: 1 }]).state;
    expect(out.companyFunds[1]).toBe(0);
    expect(out.companyProfit[1]).toBe(12000);
    expect(out.players[0]!.moneyInBank).toBe(8000);
    expect(out.players[1]!.cash).toBe(5000);
  });
});

describe('H-02 敌意 32 位有符号回绕（0x0040dfa1 add / 0x0040dfa9 test / jge）', () => {
  it('两次各加 ~1.7e9 ⇒ 溢出成负 ⇒ 清 0', () => {
    let players = [makePlayer({ index: 0 }), makePlayer({ index: 1 })];
    players = updateHostility(players, 0, 1, 1_717_986_919).players;
    players = updateHostility(players, 0, 1, 1_717_986_919).players;
    expect(players[0]!.hostility[1]).toBe(0);
  });
});

describe('B-02 乞丐：占用位里清掉了被关的人（0x0043d61d / 0x0040d5d2 / 0x0040d444）', () => {
  it('同格下标更小的那位在住院 ⇒ 不挡着后面的乞丐', () => {
    const p1 = makePlayer({ index: 1, nodeId: 5 });
    const players = [
      makePlayer({ index: 0, nodeId: 5 }),
      { ...p1, blocking: { ...p1.blocking, inHospital: 3 } },
      makePlayer({ index: 2, nodeId: 5, whoPlays: 0 }),
    ];
    expect(beggarAt(players, 5, 0)).toBe(2);
  });
});

describe('小偷捡到禮物后主人那一句的 rand（0x0041bafa call 0x44f230，价 50 < p ≤ 100）', () => {
  function draws(stockTool: number): number {
    const stock = new Array<number>(14).fill(0);
    stock[stockTool] = 3;
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })], objects: [obj(13, 2)], toolStock: stock });
    const r = rng(11);
    const start = r.getState();
    runNpc(NPC.thief, releaseNpc(1, 0, 1), s, straight(), line, r);
    const probe = new WatcomRng(start);
    for (let k = 1; k <= 5; k++) {
      probe.next();
      if (probe.getState() === r.getState()) return k;
    }
    return -1;
  }
  it('抽到機車（80）⇒ 抽签 1 次 + 台词 1 次', () => expect(draws(5)).toBe(2));
  it('抽到路障（30）⇒ 只抽签 1 次', () => expect(draws(2)).toBe(1));
});
