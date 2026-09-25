/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 回合边界上的那条链：日期 → 股市 → 樂透 → 月结
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import { initialCardAmounts } from '../rules/new-game.ts';
import type { GameState } from './types.ts';
import { LOTTERY_DRAW_DAY } from '../places/lottery.ts';
import { newStockMarket } from '../places/stock-market.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

/** 一輪才过一天（0x00418f93）：让最后一名玩家收回合，回合才会绕回 0 号 */
const endTurn = (s: GameState): GameState =>
  reduce({ ...s, phase: 'turnEnd', currentPlayer: s.players.length - 1 }, { type: 'endTurn' }, topo);

describe('日期推进', () => {
  it('★ 一輪过一天：最后一名玩家收回合才推日期（0x00418fc3 ebx=1 → 0x41cf67）', () => {
    const s = endTurn(makeGameState({ year: 1998, month: 1, day: 1 }));
    expect([s.year, s.month, s.day]).toEqual([1998, 1, 2]);
    // 不是最后一名：日期、物价都不动
    const mid = reduce({ ...makeGameState({ year: 1998, month: 1, day: 1 }), phase: 'turnEnd', currentPlayer: 1 }, { type: 'endTurn' }, topo);
    expect([mid.year, mid.month, mid.day]).toEqual([1998, 1, 1]);
    expect(mid.currentPlayer).toBe(2);
    // 只剩一人时每回合都绕回自己 → 每回合一天
    const solo = reduce({ ...makeGameState({ year: 1998, month: 1, day: 1, players: [makePlayer({ index: 0 })] }), phase: 'turnEnd' }, { type: 'endTurn' }, topo);
    expect(solo.day).toBe(2);
  });

  it('★ 月末跨月', () => {
    const s = endTurn(makeGameState({ year: 1998, month: 1, day: 31 }));
    expect([s.year, s.month, s.day]).toEqual([1998, 2, 1]);
  });

  it('★ 年末跨年', () => {
    const s = endTurn(makeGameState({ year: 1998, month: 12, day: 31 }));
    expect([s.year, s.month, s.day]).toEqual([1999, 1, 1]);
  });
});

describe('月结', () => {
  it('★ 跨月时无贷款者的存款 ×1.1', () => {
    const base = makeGameState({
      year: 1998,
      month: 1,
      day: 31,
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, moneyInBank: 100_000, loan: 0 }),
      ),
    });
    const s = endTurn(base);
    expect(s.players[0]!.moneyInBank).toBe(110_000);
  });

  it('★ 有贷款就不发利息', () => {
    const base = makeGameState({
      year: 1998,
      month: 1,
      day: 31,
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, moneyInBank: 100_000, loan: i === 0 ? 1 : 0 }),
      ),
    });
    const s = endTurn(base);
    expect(s.players[0]!.moneyInBank).toBe(100_000);
    expect(s.players[1]!.moneyInBank).toBe(110_000);
  });

  it('月中不发利息', () => {
    const base = makeGameState({
      month: 1,
      day: 10,
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, moneyInBank: 100_000 })),
    });
    expect(endTurn(base).players[0]!.moneyInBank).toBe(100_000);
  });

  it('★ 出局者不参与月结', () => {
    const base = makeGameState({
      month: 1,
      day: 31,
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, moneyInBank: 100_000, whoPlays: i === 0 ? 0 : 1 }),
      ),
    });
    expect(endTurn(base).players[0]!.moneyInBank).toBe(100_000);
  });
});

describe('樂透开奖', () => {
  const withTickets = (day: number): GameState => {
    const lottery = new Array<number>(36).fill(0);
    // 12 张全归玩家 0 → 超过门槛，必定开出已售号码
    for (let i = 0; i < 12; i++) lottery[i] = 1;
    return makeGameState({ month: 3, day, lottery, pool: 500_000 });
  };

  it('★ 每月 15 号才开奖', () => {
    const notYet = endTurn(withTickets(10));
    expect(notYet.pool).toBe(500_000);
    expect(notYet.lottery.filter((v) => v !== 0)).toHaveLength(12);
  });

  it('★ 15 号开奖：公库全数派给中奖者、号码清空', () => {
    // day 14 → 推进后是 15
    const s = endTurn(withTickets(14));
    expect(s.day).toBe(LOTTERY_DRAW_DAY);
    expect(s.pool).toBe(0);
    expect(s.lottery.every((v) => v === 0)).toBe(true);
    expect(s.players[0]!.cash).toBeGreaterThanOrEqual(500_000);
  });

  it('★ 无人购票就不开奖，公库原样留着', () => {
    const s = endTurn(makeGameState({ month: 3, day: 14, pool: 500_000 }));
    expect(s.day).toBe(15);
    expect(s.pool).toBe(500_000);
    // 原版此时根本不开屏（0x00431729）⇒ 也没有「本期号码」可交给表现层
    expect(s.lastLotteryDraw).toBeNull();
  });

  describe('★★ 开奖屏要显示的「本期号码」由 core 交出来（第十二份試玩回報）', () => {
    it('★ 有人中奖：号、得主、开奖前公库、开奖前号码表都在提示里', () => {
      const before = withTickets(14);
      const s = endTurn(before);
      const h = s.lastLotteryDraw;
      expect(h).not.toBeNull();
      expect(h!.winner).toBe(0);
      expect(h!.pool).toBe(500_000);
      expect(h!.sold).toEqual(before.lottery);
      // 开出的号确实是玩家 0 的（12 张全归他 → 必定在已售里开）
      expect(before.lottery[h!.number]).toBe(1);
    });

    it('★★ 没人中奖：号码表与公库原样 —— 号码**只有**提示里有（表现层先前只能「当 0 号播」）', () => {
      // 只卖出一张（玩家 1 持 05 号），不超门槛 ⇒ 全 36 号里随机开；找一个开不中的种子
      const lottery = new Array<number>(36).fill(0);
      lottery[4] = 2;
      let found: GameState | null = null;
      for (let seed = 1; seed < 200 && found === null; seed++) {
        const s = endTurn(makeGameState({ month: 3, day: 14, lottery, pool: 7_000, rngState: seed }));
        if (s.lastLotteryDraw?.winner === null) found = s;
      }
      expect(found).not.toBeNull();
      const h = found!.lastLotteryDraw!;
      expect(h.number).not.toBe(4);
      expect(h.number).toBeGreaterThanOrEqual(0);
      expect(h.number).toBeLessThan(36);
      expect(h.pool).toBe(7_000);
      expect(found!.lottery).toEqual(lottery); // 规则侧原样结转
      expect(found!.pool).toBe(7_000);
    });

    it('★ 纯表现提示只活一条 action：下一条 action 就清回 null', () => {
      const s = endTurn(withTickets(14));
      expect(s.lastLotteryDraw).not.toBeNull();
      const next = endTurn(s);
      expect(next.lastLotteryDraw).toBeNull();
    });

    it('★ 不是 15 号：不写', () => {
      expect(endTurn(withTickets(10)).lastLotteryDraw).toBeNull();
    });
  });
});

describe('股市', () => {
  it('★ 每回合收一次盘 —— 日序号前进、历史被写入', () => {
    const s = endTurn(makeGameState({ market: newStockMarket(0) }));
    expect(s.market.day).toBe(1);
    expect(s.market.history[0]![0]).toBeGreaterThan(0);
    expect(s.market.index).toBeGreaterThan(0);
  });

  it('★ 连跑多回合后股价确实动了', () => {
    let s = makeGameState({ market: newStockMarket(0) });
    const before = s.market.stocks.map((x) => x.price);
    for (let i = 0; i < 20; i++) s = endTurn(s);
    expect(s.market.stocks.map((x) => x.price)).not.toEqual(before);
  });

  it('★ 随机数从 rngState 顺序取，不重播种', () => {
    const a = endTurn(makeGameState({ rngState: 12345 }));
    const b = endTurn(makeGameState({ rngState: 12345 }));
    expect(a.rngState).toBe(b.rngState);
    expect(a.rngState).not.toBe(12345);
    expect(a.market.stocks.map((x) => x.price)).toEqual(b.market.stocks.map((x) => x.price));
  });
});

describe('★★ 節日送卡（0x00452444：節日表旗标 & 8）', () => {
  it('地图 0 的聖誕節：在场的每人从牌堆抽一张（出局者不送），牌堆守恒，逐位弹「聖誕節」框', () => {
    const base = makeGameState({
      year: 1998,
      month: 12,
      day: 24,
      globalMapId: 0,
      cardAmount: initialCardAmounts(),
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, whoPlays: i === 2 ? 0 : 1 })),
    });
    const poolBefore = base.cardAmount.reduce((a, b) => a + b, 0);
    const s = endTurn(base);
    expect([s.month, s.day]).toEqual([12, 25]);
    expect(s.players.map((p) => p.cards.length)).toEqual([1, 1, 0, 1]);
    expect(s.cardAmount.reduce((a, b) => a + b, 0)).toBe(poolBefore - 3);
    expect(s.notices.filter((n) => n.key === 'holiday.cardXmas')).toHaveLength(3);
    // 别的日子不送
    const plain = endTurn({ ...base, day: 20 });
    expect(plain.players.every((p) => p.cards.length === 0)).toBe(true);
  });
});
