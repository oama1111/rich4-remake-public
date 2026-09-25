/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ provenance 审计（events 区，2026-09-24）：命運几条与 exe 不符之处的回归。
 *   逐条对应 `docs/audit/provenance-events.md` 的 F-* 行。
 */
import { describe, expect, it } from 'vitest';
import { applyFortuneEffect, FORTUNE_BANK_HACK, FORTUNE_CONFISCATE_LAND } from './fortune-effects.ts';
import type { FortuneEffectLand } from './fortune-effects.ts';
import { makePlayer } from '../testing/factories.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { BLESSING_VOID } from '../rules/blessing.ts';
import { priceOf } from '../cards/rob.ts';

const fixedRng = () => ({ below: () => 0, next: () => 0 });

describe('F-01 命運 1「強制徵收土地一處」（0x0044c0b6..0x0044c0d2）', () => {
  it('赔 word[+0x1c] 地价（不乘物價）进现金；交出 kind=confiscate', () => {
    const lands: FortuneEffectLand[] = [
      { id: 4, owner: 1, level: 0, housePrice: 900, landPrice: 3200, x: 1, y: 2 },
      { id: 5, owner: 1, level: 2, housePrice: 900, landPrice: 7000, x: 3, y: 4 },
    ];
    const out = applyFortuneEffect(FORTUNE_CONFISCATE_LAND, {
      players: [makePlayer({ index: 0, cash: 100 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
      priceIndex: 5,
      lands,
      rng: fixedRng(),
    });
    expect(out.demolished).toEqual({ landId: 4, x: 1, y: 2, payout: 3200, kind: 'confiscate' });
    expect(out.players[0]!.cash).toBe(3300);
  });
});

describe('F-03 命運 3「支票跳票」（0x0044c28d / 0x0044c2ba）', () => {
  it('神明档位 1 ⇒ 不加拒絕往來天数', () => {
    const out = applyFortuneEffect(3, {
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
      priceIndex: 1,
      multiplier: BLESSING_VOID,
    });
    expect(out.cancelled).toBe(true);
    expect(out.players[0]!.daysRejectedByBank).toBe(0);
  });

  it('`add byte` 8 位回绕', () => {
    const out = applyFortuneEffect(3, {
      players: [makePlayer({ index: 0, daysRejectedByBank: 240 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
      priceIndex: 1,
    });
    expect(out.players[0]!.daysRejectedByBank).toBe((240 + 30) & 0xff);
  });
});

describe('F-04 命運 4「侵入銀行電腦 挪用其他人存款10％」（0x0044c342..0x0044c3a3）', () => {
  it('其他在场、有存款的人各被扣 trunc(存款 × 0.1f)，从存款付、进我**存款**', () => {
    const players = [
      makePlayer({ index: 0, cash: 0, moneyInBank: 1000 }),
      makePlayer({ index: 1, cash: 500, moneyInBank: 12345 }),
      makePlayer({ index: 2, cash: 500, moneyInBank: 0 }),
      makePlayer({ index: 3, cash: 500, moneyInBank: 99, whoPlays: 0 }),
    ];
    const out = applyFortuneEffect(FORTUNE_BANK_HACK, { players, currentPlayer: 0, priceIndex: 3 });
    expect(out.unimplemented).toBe(false);
    const take = Math.trunc(12345 * Math.fround(0.1));
    expect(take).toBe(1234);
    expect(out.players[1]!.moneyInBank).toBe(12345 - take);
    expect(out.players[1]!.cash).toBe(500);
    expect(out.players[0]!.moneyInBank).toBe(1000 + take);
    expect(out.players[0]!.cash).toBe(0);
    // 出局者、零存款者不动
    expect(out.players[2]).toEqual(players[2]);
    expect(out.players[3]).toEqual(players[3]);
  });
});

describe('F-05 命運 5 电脑寿星：牌堆计数（0x441e77 → 0x441343 +1；0x4412e4 −1、满手弃牌 +1）', () => {
  it('寿星满 15 张：收来的牌与被弃的牌都记账（牌堆 + 所有手牌 守恒）', () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const dear = ids.reduce((a, b) => (priceOf(b) > priceOf(a) ? b : a));
    const cheap = ids.reduce((a, b) => (priceOf(b) < priceOf(a) ? b : a));
    const hand = new Array<number>(15).fill(dear);
    hand[2] = cheap;
    const other = ids.find((c) => c !== dear && c !== cheap)!;
    const deck = new Array<number>(30).fill(1);
    const out = applyFortuneEffect(5, {
      players: [
        makePlayer({ index: 0, whoPlays: 2, cards: hand }),
        makePlayer({ index: 1, cards: [other] }),
      ],
      currentPlayer: 0,
      priceIndex: 1,
      cardAmount: deck,
      rng: new WatcomRng(7),
    });
    expect(out.players[1]!.cards).toEqual([]);
    expect(out.players[0]!.cards).toHaveLength(15);
    expect(out.players[0]!.cards).toContain(other);
    expect(out.cardAmount![cheap - 1]).toBe(2);
    // 手牌 16 张 → 15 张（弃一张），牌堆 30 → 31
    expect(out.cardAmount!.reduce((a, b) => a + b, 0)).toBe(31);
  });
});

describe('F-12 命運 12/13 住院前先毁车（0x0044cd54 call 0x40cd07）', () => {
  it('騎機車摔傷：車回库存、徒步一颗骰子，再住院', () => {
    const stock = new Array<number>(14).fill(0);
    const out = applyFortuneEffect(13, {
      players: [makePlayer({ index: 0, trafficMethod: 1, ndices: 2 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
      priceIndex: 1,
      toolStock: stock,
      rng: fixedRng(),
    });
    expect(out.players[0]!.trafficMethod).toBe(0);
    expect(out.players[0]!.ndices).toBe(1);
    expect(out.toolStock![5]).toBe(1);
    expect(out.players[0]!.blocking.inHospital).toBe(3);
  });

  it('坐牢（33）不毁车', () => {
    const out = applyFortuneEffect(33, {
      players: [makePlayer({ index: 0, trafficMethod: 2, ndices: 3 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
      priceIndex: 1,
      toolStock: new Array<number>(14).fill(0),
      rng: fixedRng(),
    });
    expect(out.players[0]!.trafficMethod).toBe(2);
    expect(out.toolStock).toBeNull();
  });
});

describe('首次关押 4..6 天的倒霉台词 rand（0x0043d5f9 call 0x44f2c2 → 0x0044f312）', () => {
  it('命運 34 坐牢 5 天 ⇒ 多掷一次；33 坐牢 3 天 ⇒ 不掷', () => {
    const count = (id: number): number => {
      let n = 0;
      applyFortuneEffect(id, {
        players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
        currentPlayer: 0,
        priceIndex: 1,
        rng: { below: (m: number) => { n++; return 0 % m; }, next: () => { n++; return 0; } },
      });
      return n;
    };
    expect(count(34)).toBe(1);
    expect(count(33)).toBe(0);
  });
});
