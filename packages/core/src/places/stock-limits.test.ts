/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 股市：漲停／跌停 与 休市日
 */

import { describe, expect, it } from 'vitest';
import {
  LIMIT_PCT,
  STOCK_STATUS,
  applyPriceTick,
  isLimitDown,
  isLimitUp,
  marketOpenOn,
  stockStatus,
} from './stock-market.ts';
import { isHoliday, weekdayOf } from './calendar.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import type { GameState } from '../state/types.ts';

describe('★ 漲停 / 跌停 @source fcn_004295ea', () => {
  it('幅度 ±10%，门槛用同一条落档函数', () => {
    expect(LIMIT_PCT).toBe(10);
    const open = 100;
    const up = applyPriceTick(open, 10);
    const down = applyPriceTick(open, -10);
    expect(stockStatus(open, up)).toBe(STOCK_STATUS.limitUp);
    expect(stockStatus(open, up - 0.5)).toBe(STOCK_STATUS.up);
    expect(stockStatus(open, down)).toBe(STOCK_STATUS.limitDown);
    expect(stockStatus(open, down + 0.5)).toBe(STOCK_STATUS.down);
    expect(stockStatus(open, open)).toBe(STOCK_STATUS.flat);
  });

  it('isLimitUp / isLimitDown 只在各自那一档为真', () => {
    expect(isLimitUp(100, applyPriceTick(100, 10))).toBe(true);
    expect(isLimitUp(100, 100)).toBe(false);
    expect(isLimitDown(100, applyPriceTick(100, -10))).toBe(true);
    expect(isLimitDown(100, 100)).toBe(false);
  });
});

describe('★ 休市日 = isHoliday（星期日 + 節日表）@source fcn_00428d01 → fcn_004523d5', () => {
  it('星期日休市', () => {
    // 找一个星期日
    let d = 1;
    while (weekdayOf(2000, 3, d) !== 0) d++;
    expect(marketOpenOn(0, 2000, 3, d)).toBe(false);
    expect(marketOpenOn(0, 2000, 3, d + 1)).toBe(true);
  });

  it('与 isHoliday 逐日互补（抽一整年）', () => {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 28; d++) {
        expect(marketOpenOn(0, 2001, m, d)).toBe(!isHoliday(0, 2001, m, d));
      }
    }
  });
});

// ============================================================
//  接到 reducer
// ============================================================

const topo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1] })], lands: [] };

function trader(over: Partial<GameState> = {}): GameState {
  const s = makeGameState({
    players: [makePlayer({ index: 0, nodeId: 1, cash: 100_000, moneyInBank: 100_000 })],
    phase: 'awaitingRoll',
    year: 2000,
    month: 3,
    day: 1,
    ...over,
  });
  return s;
}

function weekdayNotHoliday(): { year: number; month: number; day: number } {
  for (let d = 1; d <= 28; d++) if (!isHoliday(0, 2000, 3, d)) return { year: 2000, month: 3, day: d };
  throw new Error('no open day');
}
function sunday(): { year: number; month: number; day: number } {
  for (let d = 1; d <= 28; d++) if (weekdayOf(2000, 3, d) === 0) return { year: 2000, month: 3, day: d };
  throw new Error('no sunday');
}

describe('★ 柜台：休市不开门、漲停不买、跌停不卖', () => {
  it('开市日能买', () => {
    const s = trader(weekdayNotHoliday());
    const after = reduce(s, { type: 'buyStock', stock: 0, shares: 10 }, topo);
    expect(after).not.toBe(s);
  });

  it('★ 星期日买不了', () => {
    const s = trader(sunday());
    expect(reduce(s, { type: 'buyStock', stock: 0, shares: 10 }, topo)).toBe(s);
  });

  it('★ 漲停無法買進 —— 把現價推到门槛', () => {
    const s = trader(weekdayNotHoliday());
    const st = s.market.stocks[0]!;
    const stocks = s.market.stocks.map((x, i) =>
      i === 0 ? { ...x, price: applyPriceTick(x.openPrice, 10) } : x,
    );
    const limited = { ...s, market: { ...s.market, stocks } };
    expect(isLimitUp(st.openPrice, stocks[0]!.price)).toBe(true);
    expect(reduce(limited, { type: 'buyStock', stock: 0, shares: 10 }, topo)).toBe(limited);
  });

  it('★ 跌停無法賣出', () => {
    const s0 = trader(weekdayNotHoliday());
    const bought = reduce(s0, { type: 'buyStock', stock: 0, shares: 10 }, topo);
    const stocks = bought.market.stocks.map((x, i) =>
      i === 0 ? { ...x, price: applyPriceTick(x.openPrice, -10) } : x,
    );
    const limited = { ...bought, market: { ...bought.market, stocks } };
    expect(reduce(limited, { type: 'sellStock', stock: 0, shares: 10 }, topo)).toBe(limited);
  });
});

describe('★ 休市日不走行情', () => {
  it('推进到星期日：行情不变；推进到开市日：行情变', () => {
    const sun = sunday();
    // 前一天是星期六 → endTurn 推进到星期日
    const sat = trader({ ...sun, day: sun.day - 1, phase: 'turnEnd' });
    const toSunday = reduce(sat, { type: 'endTurn' }, topo);
    expect(toSunday.day).toBe(sun.day);
    expect(toSunday.market.stocks.map((x) => x.price)).toEqual(sat.market.stocks.map((x) => x.price));

    const open = weekdayNotHoliday();
    const before = trader({ ...open, day: open.day - 1 >= 1 ? open.day - 1 : open.day, phase: 'turnEnd' });
    const next = reduce(before, { type: 'endTurn' }, topo);
    if (marketOpenOn(0, next.year, next.month, next.day)) {
      // 至少有一支变了
      expect(next.market.stocks.some((x, i) => x.price !== before.market.stocks[i]?.price)).toBe(true);
    }
  });
});

describe('★ 停牌中柜台不能买卖 @source 0x0042aef4 / 0x0042b02f', () => {
  it('f6 != 0 时买、卖都拒；归零后能买', () => {
    const s = trader(weekdayNotHoliday());
    const halted = { ...s, market: { ...s.market, stocks: s.market.stocks.map((x, i) => (i === 0 ? { ...x, f6: 2 } : x)) } };
    expect(reduce(halted, { type: 'buyStock', stock: 0, shares: 10 }, topo)).toBe(halted);
    const bought = reduce(s, { type: 'buyStock', stock: 0, shares: 10 }, topo);
    const haltedHeld = { ...bought, market: { ...bought.market, stocks: bought.market.stocks.map((x, i) => (i === 0 ? { ...x, f6: 1 } : x)) } };
    expect(reduce(haltedHeld, { type: 'sellStock', stock: 0, shares: 10 }, topo)).toBe(haltedHeld);
    expect(reduce(s, { type: 'buyStock', stock: 0, shares: 10 }, topo)).not.toBe(s);
  });
});
