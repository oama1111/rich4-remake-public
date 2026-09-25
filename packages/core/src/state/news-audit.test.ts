/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ provenance 审计（events 区，2026-09-24）：新聞几条与 exe 不符之处的回归。
 *   逐条对应 `docs/audit/provenance-events.md` 的 N-* 行。
 */
import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { applyNewsEffect } from '../events/news-effects.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_COMPUTER, isAlive } from './types.ts';
import { ACTOR_PLACE, specialSlotOf } from '../rules/special-actors.ts';

/** 1 = 新聞格（抽牌人站这），2..4 = 普通格 */
function newsTopo(lands: MapTopology['lands'] = [], facilities: MapTopology['facilities'] = []): MapTopology {
  return {
    nodes: [
      makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.NEWS, x: 0, y: 0 }),
      makeNode({ id: 2, adjacent: [1, 3], x: 2000, y: 2000 }),
      makeNode({ id: 3, adjacent: [2, 4], x: 5, y: 5 }),
      makeNode({ id: 4, adjacent: [3], x: 4000, y: 4000 }),
    ],
    lands,
    facilities,
  };
}

function landingOnNews(newsId: number, over: Partial<GameState> = {}): GameState {
  return makeGameState({
    rngState: 2468,
    phase: 'settling',
    currentPlayer: 0,
    newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: newsId },
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, whoPlays: WHO_PLAYS_COMPUTER, nodeId: i === 0 ? 1 : 2, cash: 50_000, moneyInBank: 50_000 }),
    ),
    ...over,
  });
}

describe('N-12 地價稅：付不出当场破产（0x0044a1e7..0x0044a215 → 0x41d2c6 → 0x41d375 call 0x40cd87）', () => {
  it('没钱的地主被收地價稅 ⇒ 出局（先前只记个旗、人还留在场上）', () => {
    const topo = newsTopo([makeLand({ id: 0, landPrice: 10_000, x: 3000, y: 3000 })]);
    const base = landingOnNews(12);
    const landOwner = [...base.landOwner];
    landOwner[0] = 2; // 1 号的地
    const s: GameState = {
      ...base,
      landOwner,
      players: base.players.map((p, i) => (i === 1 ? { ...p, cash: 0, moneyInBank: 0 } : p)),
    };
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.lastEvent).toMatchObject({ kind: 'news', id: 12 });
    expect(isAlive(r.players[1]!)).toBe(false);
    // 其余人没地、份额 0：一分不动
    expect(r.players[2]!.cash).toBe(50_000);
  });
});

describe('N-07 公開拍賣：挑地之后的开拍接着同一条随机流（0x4497b7 → 0x4498a1 → 0x439f1c）', () => {
  it('rngState = 挑地 1 次 + 每个电脑出价座位 1 次（先前开拍重掷挑地那一格、结束又被覆盖掉）', () => {
    const topo = newsTopo([makeLand({ id: 0, x: 3000, y: 3000 }), makeLand({ id: 1, x: 3100, y: 3000 })]);
    const s = landingOnNews(7);
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.lastEvent).toMatchObject({ kind: 'news', id: 7 });
    const rng = new WatcomRng();
    rng.setState(s.rngState);
    const states: number[] = [];
    for (let k = 0; k < 2000; k++) {
      rng.next();
      states.push(rng.getState());
    }
    const k = states.indexOf(r.rngState);
    // 挑地 1 次 + 4 位电脑出价座位各至少 1 次 ⇒ 至少走了 5 步（先前恒为 1 步：开拍那几次被覆盖掉）
    expect(r.pending?.kind).toBe('auction');
    expect(k + 1).toBeGreaterThanOrEqual(5);
  });
});

describe('N-24/25 股市崩盤／全面上漲：写完标记当场改价（0x0044b049 push 0 / call 0x429040）', () => {
  it('今日价 = 按 ±10 趋势重算；当天那笔历史被覆盖', () => {
    const market = newStockMarket(0);
    const r = applyNewsEffect(24, {
      players: [makePlayer({ index: 0 })],
      affected: [0],
      priceIndex: 1,
      pool: 0,
      market,
    });
    const m = r.market!;
    for (let i = 0; i < m.stocks.length; i++) {
      expect(m.stocks[i]!.newsFlag).toBe(1);
      expect(m.stocks[i]!.trend).toBe(-10);
      const slot = market.day - 1 >= 0 ? market.day - 1 : m.history[i]!.length - 1;
      expect(m.history[i]![slot]).toBe(m.stocks[i]!.price);
    }
  });
});

describe('N-20 颱風的轻击是 damage_area 内联逻辑（0x0040ad1c / 0x0040adf5..0x0040ae0d）', () => {
  it('窗里 0 级設施也清种类并放出旅館住客；0 级带种类的地块也清种类', () => {
    const players = [0, 1].map((i) => makePlayer({ index: i }));
    players[1] = { ...players[1]!, blocking: { ...players[1]!.blocking, inHotel: 3 } };
    const lands = [{ ...makeLand({ id: 1, x: 0, y: 0 }), level: 0, type: 1, owner: 1 }];
    const facilities = [{ ...makeFacility({ id: 2, x: 10, y: 10 }), level: 0, type: 1, owner: 1 }];
    const r = applyNewsEffect(20, {
      players,
      affected: [0],
      priceIndex: 1,
      pool: 0,
      lands,
      facilities,
      rng: { below: () => 0 },
    });
    expect(r.landMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 1 }]);
    expect(r.facilityMutations).toEqual([{ id: 2, level: 0, type: 0, owner: 1 }]);
    expect(r.players[1]!.blocking.inHotel).toBe(0x80);
  });
});

describe('N-06 地價調漲：存回是 word（0x0044967b / 0x00449721）', () => {
  it('×1.3 超过 65535 回绕', () => {
    const lands = [{ ...makeLand({ id: 1 }), landPrice: 60_000 }];
    const r = applyNewsEffect(6, {
      players: [makePlayer({ index: 0 })],
      affected: [0],
      priceIndex: 1,
      pool: 0,
      lands,
      facilities: [],
      rng: { below: () => 0 },
    });
    expect(r.landPrice).toEqual([{ id: 1, price: Math.trunc(60_000 * 1.3) & 0xffff }]);
  });
});

describe('N-04 外星人攻打地球：窗里的惡人进醫院、没附身的物件被放回（0x0040aeb4..0x0040aefc）', () => {
  it('小偷站在爆心 ⇒ 撤下棋盘、醫院占用表置 1；爆心上的路障回库存', () => {
    const topo = newsTopo([makeLand({ id: 0, x: 5, y: 5 })]);
    const base = landingOnNews(4);
    const landLevel = [...base.landLevel];
    landLevel[0] = 2;
    const specialActors = base.specialActors.map((a, i) =>
      i === specialSlotOf(4) ? { ...a, place: ACTOR_PLACE.board, nodeId: 3 } : a,
    );
    const objects = base.objects.map((o, i) => (i === 16 ? { ...o, type: 16, nodeId: 3, attached: 0 } : o));
    const toolStock = [...base.toolStock];
    const s: GameState = { ...base, landLevel, specialActors, objects, toolStock };
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.lastEvent).toMatchObject({ kind: 'news', id: 4 });
    const thief = r.specialActors[specialSlotOf(4)]!;
    expect(thief.place).toBe(ACTOR_PLACE.hospital);
    expect(r.hospitalOccupancy[4]).toBe(1);
    expect(r.objects[16]!.nodeId).toBe(0);
  });
});
