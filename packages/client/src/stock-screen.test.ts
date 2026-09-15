/*
 * 股市屏（T-030）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标照 exe（牌子表 `0x4754c8`、行命中 `loc_0042ae2c`、各行 `draw_text` 的 x），
 * 这里把「容易写错、错了又难看出来的」几条钉住：
 * 牌子命中是**开区间**、行高 32 且第一行从 80 起、小数位跟**价格量级**走、
 * 停牌那格换字、持股两列只在真有持股时画。
 */
import { describe, expect, it } from 'vitest';
import { STOCK_STATUS, makeGameState, type GameState } from '@rich4/core';
import {
  STOCK_BOSS_MARK,
  STOCK_CLOSED_AT,
  STOCK_HEADERS_PAGE1,
  STOCK_HOLDER_STEP,
  STOCK_HOLDER_X,
  STOCK_NO_BUY,
  STOCK_NO_SELL,
  STOCK_PLATE_EXIT,
  STOCK_PLATE_PAGE,
  STOCK_PLATES,
  STOCK_PLATE_BUY,
  STOCK_PLATE_INFO,
  STOCK_PLATE_SELL,
  STOCK_RESOURCE,
  STOCK_ROWS,
  STOCK_SUSPENDED,
  STOCK_VALUE_X,
  changeText,
  comma,
  hitStockPlate,
  hitStockRow,
  magnitudeClass,
  priceText,
  stockCounterClosed,
  stockRowRect,
  stockRowTextY,
  stockRowsFrom,
  stockStatusColor,
} from './stock-screen.ts';

describe('股市屏几何 @source 表 0x4754c8 / loc_0042ae2c', () => {
  it('★ 底图是资源 75', () => {
    expect(STOCK_RESOURCE).toBe(75);
  });

  it('★ 五块牌子照表 dump', () => {
    expect(STOCK_PLATES).toHaveLength(5);
    expect(STOCK_PLATES[STOCK_PLATE_PAGE]).toEqual({ x0: 16, y0: 9, x1: 124, y1: 39 });
    expect(STOCK_PLATES[STOCK_PLATE_BUY]).toEqual({ x0: 128, y0: 9, x1: 198, y1: 39 });
    expect(STOCK_PLATES[STOCK_PLATE_SELL]).toEqual({ x0: 202, y0: 9, x1: 272, y1: 39 });
    expect(STOCK_PLATES[STOCK_PLATE_INFO]).toEqual({ x0: 276, y0: 9, x1: 410, y1: 39 });
    // EXIT 那块**比别的矮一行**（y 8..40）—— 先前若照抄前四块会漏掉
    expect(STOCK_PLATES[STOCK_PLATE_EXIT]).toEqual({ x0: 552, y0: 8, x1: 623, y1: 40 });
  });

  it('★ 牌子命中是**开区间**：边界那一点不算', () => {
    for (let i = 0; i < STOCK_PLATES.length; i++) {
      const p = STOCK_PLATES[i]!;
      const cx = Math.floor((p.x0 + p.x1) / 2);
      const cy = Math.floor((p.y0 + p.y1) / 2);
      expect(hitStockPlate(cx, cy)).toBe(i);
      expect(hitStockPlate(p.x0, cy)).toBeNull();
      expect(hitStockPlate(p.x1, cy)).toBeNull();
      expect(hitStockPlate(cx, p.y0)).toBeNull();
      expect(hitStockPlate(cx, p.y1)).toBeNull();
    }
  });

  it('★ 12 行：高 32、第一行顶 80，文字在行内 y+16', () => {
    expect(STOCK_ROWS.count).toBe(12);
    expect(STOCK_ROWS.height).toBe(32);
    expect(STOCK_ROWS.top).toBe(80);
    expect(stockRowTextY(0)).toBe(96);
    expect(stockRowTextY(11)).toBe(96 + 11 * 32);
    expect(stockRowRect(0)).toEqual({ x: 15, y: 80, w: 610, h: 32 });
    expect(stockRowRect(11).y + stockRowRect(11).h).toBe(80 + 12 * 32);
  });

  it('★ 行命中：80 与 464 都不算（开区间），x 同理', () => {
    expect(hitStockRow(300, 80)).toBeNull();
    expect(hitStockRow(300, 81)).toBe(0);
    expect(hitStockRow(300, 111)).toBe(0);
    expect(hitStockRow(300, 112)).toBe(1);
    expect(hitStockRow(300, 463)).toBe(11);
    expect(hitStockRow(300, 464)).toBeNull();
    expect(hitStockRow(15, 200)).toBeNull();
    expect(hitStockRow(625, 200)).toBeNull();
    expect(hitStockRow(16, 200)).toBe(3); // (200-80)/32 = 3
  });

  it('★ 六列的落点（右对齐那几列是**右边缘**）', () => {
    expect(STOCK_VALUE_X.price).toBe(225);
    expect(STOCK_VALUE_X.change).toBe(305);
    expect(STOCK_VALUE_X.volume).toBe(401);
    expect(STOCK_VALUE_X.shares).toBe(504);
    expect(STOCK_VALUE_X.cost).toBe(609);
    // 名字两页各一处：图 0 在 76、图 1 在 71
    expect(STOCK_VALUE_X.name).toEqual([76, 71]);
  });
});

describe('持股页（图 1）的页头与董事长标识 @source 入口 0x42b856 / loc_00429ba1', () => {
  it('★ 持股页的页头**不是**行情那六列', () => {
    expect(STOCK_HEADERS_PAGE1).toEqual({
      name: 71,
      playerFirst: 0xa8,
      playerStep: 0x50,
      retained: 0x1ec,
      surplus: 0x244,
    });
    // 四个玩家：168 / 248 / 328 / 408
    expect(STOCK_HEADERS_PAGE1.playerFirst + 3 * STOCK_HEADERS_PAGE1.playerStep).toBe(408);
  });

  it('★ 持股数那一排的落点与董事长那一格', () => {
    expect(STOCK_HOLDER_X).toBe(0xc0); // 192
    expect(STOCK_HOLDER_STEP).toBe(0x50); // 80
    // 董事长那格：蓝底 + 黄字，框比数字宽 64、往左偏 56
    expect(STOCK_BOSS_MARK).toEqual({ dx: -0x38, w: 0x40, h: 0x14, box: '#0000ff', fg: '#f0f000' });
  });

  it('★ 董事長取自 commercial+0x18（玩家下标 + 1）', () => {
    const s = makeGameState();
    const stocks = s.market.stocks.map((x, i) => (i === 4 ? { ...x, commercialIndex: 2 } : x));
    const owners = [...s.commercialOwners];
    owners[2] = { owner: 3, ranking: [3, 0, 0, 0] };
    const rows = stockRowsFrom({ ...s, market: { ...s.market, stocks }, commercialOwners: owners }, 0, NAMES);
    expect(rows[4]!.boss).toBe(3);
    expect(rows[0]!.boss).toBe(0);
  });
});

describe('数值格式 @source fcn_00429691 / 表 0x475518', () => {
  it('★ 小数位跟**价格量级**走（15 / 150 两个阈值）', () => {
    expect(magnitudeClass(14.99)).toBe(0);
    expect(magnitudeClass(15)).toBe(1);
    expect(magnitudeClass(149.99)).toBe(1);
    expect(magnitudeClass(150)).toBe(2);
    expect(priceText(12.5)).toBe('12.50');
    expect(priceText(50.25)).toBe('50.3'); // %.1f 四舍五入
    expect(priceText(1200.4)).toBe('1200');
  });

  it('★ 漲跌带正负号，位数跟**现价**（不是跟差额）', () => {
    expect(changeText(12.5, 12)).toBe('+0.50');
    expect(changeText(11.5, 12)).toBe('-0.50');
    expect(changeText(1000, 900)).toBe('+100');
    expect(changeText(0.5, 1)).toBe('-0.50');
  });

  it('★ 千分位（原版的 num_to_currency_string 只加逗号）', () => {
    expect(comma(0)).toBe('0');
    expect(comma(1234)).toBe('1,234');
    expect(comma(1234567)).toBe('1,234,567');
  });
});

describe('涨跌类的字色与底色框 @source 跳表 ref_004297cf', () => {
  it('★ 漲停/跌停带框，漲/跌只有字色，平盤白字', () => {
    expect(stockStatusColor(STOCK_STATUS.up)).toEqual({ fg: '#ff0000', box: null });
    expect(stockStatusColor(STOCK_STATUS.limitUp)).toEqual({ fg: '#f0f0f0', box: '#d00000' });
    expect(stockStatusColor(STOCK_STATUS.down)).toEqual({ fg: '#00ff00', box: null });
    expect(stockStatusColor(STOCK_STATUS.limitDown)).toEqual({ fg: '#101010', box: '#00d000' });
    expect(stockStatusColor(STOCK_STATUS.flat)).toEqual({ fg: '#f0f0f0', box: null });
  });

  it('★ 两类各自的拒绝语', () => {
    expect(STOCK_NO_BUY).toBe('漲停無法買進！');
    expect(STOCK_NO_SELL).toBe('跌停無法賣出！');
    expect(STOCK_SUSPENDED).toBe('暫停交易');
    // 休市那句是「黑先白后」两个落点（描边效果）
    expect(STOCK_CLOSED_AT).toEqual([
      { x: 324, y: 244 },
      { x: 320, y: 240 },
    ]);
  });
});

/** 12 支股票的名字（core 的 `StockState` 不带名字，由调用方喂）*/
const NAMES = Array.from({ length: 12 }, (_, i) => `股${i}`);

describe('从局面摊成 12 行', () => {
  function withStock(over: Partial<GameState>): GameState {
    const s = makeGameState();
    return { ...s, ...over };
  }

  it('★ 名字由调用方喂（core 的 StockState 不带名字）', () => {
    expect(stockRowsFrom(makeGameState(), 0, NAMES).map((r) => r.name)).toEqual(NAMES);
  });

  it('★ 刚开局：12 行都是平盤，没持股就不画持股那两列', () => {
    const rows = stockRowsFrom(makeGameState(), 0, NAMES);
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.status).toBe(STOCK_STATUS.flat);
      expect(r.shares).toBeNull();
      expect(r.cost).toBeNull();
      expect(r.volume).not.toBeNull();
    }
  });

  it('★ 涨停 = 现价 ≥ 开盘 × 1.1 → 类 1；跌停 → 类 3', () => {
    const s = makeGameState();
    const stocks = s.market.stocks.map((x, i) => {
      if (i === 0) return { ...x, openPrice: 100, price: 110 };
      if (i === 1) return { ...x, openPrice: 100, price: 90 };
      if (i === 2) return { ...x, openPrice: 100, price: 105 };
      return x;
    });
    const rows = stockRowsFrom(withStock({ market: { ...s.market, stocks } }), 0, NAMES);
    expect(rows[0]!.status).toBe(STOCK_STATUS.limitUp);
    expect(rows[1]!.status).toBe(STOCK_STATUS.limitDown);
    expect(rows[2]!.status).toBe(STOCK_STATUS.up);
    // 位数跟**现价**（110 → 量级 1 → 一位小数），不是跟差额
    expect(rows[0]!.change).toBe('+10.0');
    expect(rows[1]!.change).toBe('-10.0');
  });

  it('★ 停牌（+6 ≠ 0）那一格改成不画交易量', () => {
    const s = makeGameState();
    const stocks = s.market.stocks.map((x, i) => (i === 3 ? { ...x, f6: 1 } : x));
    const rows = stockRowsFrom(withStock({ market: { ...s.market, stocks } }), 0);
    expect(rows[3]!.volume).toBeNull();
    expect(rows[0]!.volume).not.toBeNull();
  });

  it('★ 持股与平均成本只在真有持股时出现，且只算**当前玩家**的', () => {
    const s = makeGameState();
    const holdings = s.holdings.map((h, p) =>
      h.map((x, i) => (p === 0 && i === 2 ? { amount: 1200, avgCost: 33.125 } : x)),
    );
    const rows = stockRowsFrom(withStock({ holdings }), 0, NAMES);
    expect(rows[2]!.shares).toBe('1,200');
    expect(rows[2]!.cost).toBe('33.13');
    expect(rows[0]!.shares).toBeNull();
    // 换个人看，那一格就空了
    expect(stockRowsFrom(withStock({ holdings }), 1, NAMES)[2]!.shares).toBeNull();
  });

  it('★ 「有对应企业」决定持股两列的字色（listed）', () => {
    const s = makeGameState();
    const stocks = s.market.stocks.map((x, i) =>
      i === 5 ? { ...x, commercialIndex: 3 } : { ...x, commercialIndex: 0 },
    );
    const state = withStock({ market: { ...s.market, stocks } });
    expect(stockRowsFrom(state, 0, NAMES)[5]!.listed).toBe(true);
    expect(stockRowsFrom(state, 0, NAMES)[0]!.listed).toBe(false);
  });

  it('★ 休市判定用的是日历（元旦休市、平日开市）', () => {
    expect(stockCounterClosed(makeGameState({ month: 1, day: 1 }))).toBe(true);
    expect(stockCounterClosed(makeGameState({ month: 1, day: 5 }))).toBe(false);
  });
});
