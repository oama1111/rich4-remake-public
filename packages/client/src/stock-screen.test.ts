/*
 * 股市屏（T-030）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标照 exe（牌子表 `0x4754c8`、行命中 `loc_0042ae2c`、各行 `draw_text` 的 x），
 * 这里把「容易写错、错了又难看出来的」几条钉住：
 * 牌子命中是**开区间**、行高 32 且第一行从 80 起、小数位跟**价格量级**走、
 * 停牌那格换字、持股两列只在真有持股时画、
 * 以及**未上市的行不读 1 基企业表的第 0 格**（Q-STOCK-7）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BLACK_CARD_NEWS_FLAG,
  RED_CARD_NEWS_FLAG,
  STOCK_STATUS,
  makeGameState,
  type GameState,
} from '@rich4/core';
import {
  STOCK_BOSS_MARK,
  STOCK_CLOSED_AT,
  STOCK_HEADERS_PAGE1,
  STOCK_HOLDER_STEP,
  STOCK_HOLDER_X,
  STOCK_NO_BUY,
  STOCK_NO_SELL,
  STOCK_PICK_BLACK,
  STOCK_PICK_FEEDBACK_MS,
  STOCK_PICK_RED,
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
  drawStockScreen,
  comma,
  hitStockPlate,
  hitStockRow,
  magnitudeClass,
  priceText,
  stockCounterClosed,
  stockPickCardAction,
  stockPickFrameRects,
  stockPickModeOfCard,
  stockPickNewsFlag,
  stockRowRect,
  stockRowTextY,
  stockRowsFrom,
  stockStatusColor,
  stockTrendColor,
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

    // ★ 涨跌列/交易量列走**第二张表**（跳表 ref_004297e3）—— 跌停在这张表里是**绿字**，
    //   与成交價那格的「黑字+暗绿框」并不矛盾。需求方 2026-09-16 报的就是这一条。
    expect(stockTrendColor(STOCK_STATUS.up)).toBe('#ff0000');
    expect(stockTrendColor(STOCK_STATUS.limitUp)).toBe('#ff0000');
    expect(stockTrendColor(STOCK_STATUS.down)).toBe('#00ff00');
    expect(stockTrendColor(STOCK_STATUS.limitDown)).toBe('#00ff00');
    expect(stockTrendColor(STOCK_STATUS.flat)).toBe('#f0f0f0');
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

/**
 * ★ 未上市（`commercialIndex === 0`）那些行 —— Q-STOCK-7
 *
 * 判据 `股票记录 +4`：**1 基企业序号，0 = 这支股票没有上市公司**
 * （@source `0x00429aa0` / `0x00429d0f` / `0x00429c40` 的 `cmp word [..+0x496984],0`）。
 *
 * 这里特意把 **1 基企业表的第 0 格**灌成非零值：老实现对未上市股票就是去读这一格
 * （`commercialShares[0]` / `companyFunds[0]` / `commercialOwners[0]`），
 * 于是打出「0」而不是空白；第 0 格有毒，才区分得出「读没读」。
 */
describe('★ 未上市的行画什么（Q-STOCK-7）@source 0x00429a99 / 0x00429bd3 / 0x00429c40', () => {
  /** 第 0 格是毒，第 3 格才是正常企业数据 */
  function poisoned(commercialIndex: (i: number) => number): GameState {
    const s = makeGameState();
    const commercialShares = [...s.commercialShares];
    const companyFunds = [...s.companyFunds];
    const commercialOwners = [...s.commercialOwners];
    commercialShares[0] = 777; // 1 基表的第 0 格 —— 未上市的行**绝不该**读它
    companyFunds[0] = 888;
    commercialOwners[0] = { owner: 2, ranking: [2, 0, 0, 0] };
    commercialShares[3] = 1234; // 企业 +0x30
    companyFunds[3] = 5678; // 企业 +0x28
    commercialOwners[3] = { owner: 4, ranking: [4, 0, 0, 0] }; // 企业 +0x18（玩家下标 + 1）
    const stocks = s.market.stocks.map((x, i) => ({ ...x, commercialIndex: commercialIndex(i) }));
    return { ...s, market: { ...s.market, stocks }, commercialShares, companyFunds, commercialOwners };
  }

  it('★ 未上市：保留股份 / 累積盈餘**整格不画**（不是画 0，也不读第 0 格）', () => {
    const rows = stockRowsFrom(poisoned(() => 0), 0, NAMES);
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.listed).toBe(false);
      expect(r.retained).toBeNull(); // 企业 +0x30 那一格
      expect(r.surplus).toBeNull(); // 企业 +0x28 那一格
      expect(r.boss).toBe(0); // 董事長蓝框整格跳过 @source 0x00429bd3
    }
  });

  it('★ 已上市（+4 = 3）：照 1 基企业表读 +0x30 / +0x28 / +0x18，别的行不受影响', () => {
    const rows = stockRowsFrom(poisoned((i) => (i === 5 ? 3 : 0)), 0, NAMES);
    expect(rows[5]!.listed).toBe(true);
    expect(rows[5]!.retained).toBe('1,234');
    expect(rows[5]!.surplus).toBe('5,678');
    expect(rows[5]!.boss).toBe(4);
    expect(rows[4]!.retained).toBeNull();
    expect(rows[4]!.surplus).toBeNull();
  });

  it('★ 行情页那两列（持有股數 / 平均成本）与 comm 无关：未上市也照画', () => {
    const s = poisoned(() => 0);
    const holdings = s.holdings.map((h, p) =>
      h.map((x, i) => (p === 0 && i === 2 ? { amount: 1200, avgCost: 33.125 } : x)),
    );
    const rows = stockRowsFrom({ ...s, holdings }, 0, NAMES);
    expect(rows[2]!.listed).toBe(false);
    expect(rows[2]!.shares).toBe('1,200');
    expect(rows[2]!.cost).toBe('33.13');
  });
});

describe('选股模式（紅卡/黑卡）—— Q-PICK-2 @source loc_0042b0da', () => {
  it('★ 卡号 → 模式：紅卡(24) = 1、黑卡(25) = 2、别的没有', () => {
    expect(stockPickModeOfCard(24)).toBe(STOCK_PICK_RED);
    expect(stockPickModeOfCard(25)).toBe(STOCK_PICK_BLACK);
    expect(stockPickModeOfCard(23)).toBeNull();
    expect(stockPickModeOfCard(1)).toBeNull();
  });

  it('★ 模式 → newsFlag 字节：1 → 0x20（利多）、2 → 2（利空）', () => {
    // 与 core 的两个常量**同值** —— UI 里那次写字节（`loc_0042b137` / `loc_0042b11e`）
    // 与本引擎 core 里那次写字节（`applyRedCard` / `applyBlackCard`）必须是同一个值
    expect(stockPickNewsFlag(STOCK_PICK_RED)).toBe(0x20);
    expect(stockPickNewsFlag(STOCK_PICK_BLACK)).toBe(0x02);
    expect(stockPickNewsFlag(STOCK_PICK_RED)).toBe(RED_CARD_NEWS_FLAG);
    expect(stockPickNewsFlag(STOCK_PICK_BLACK)).toBe(BLACK_CARD_NEWS_FLAG);
  });

  it('★ 选中之后停 1 秒 @source `push 0x3e8; call 0x45285e`', () => {
    expect(STOCK_PICK_FEEDBACK_MS).toBe(1000);
  });

  it('★ 悬停反馈是整行**白框**：矩形与 stockRowRect 相同、四条边各占 1 像素', () => {
    const frame = stockPickFrameRects(3);
    const r = stockRowRect(3);
    // 上边
    expect(frame[0]).toEqual({ x: r.x, y: r.y, w: r.w, h: 1 });
    // 下边（最后一行像素）
    expect(frame[1]).toEqual({ x: r.x, y: r.y + r.h - 1, w: r.w, h: 1 });
    // 左边 / 右边（上下两条已占，故从 y+1 起、高 h−2）
    expect(frame[2]).toEqual({ x: r.x, y: r.y + 1, w: 1, h: r.h - 2 });
    expect(frame[3]).toEqual({ x: r.x + r.w - 1, y: r.y + 1, w: 1, h: r.h - 2 });
    // 第一行的框贴在第一行行情上：y 80..111
    expect(stockRowRect(0)).toEqual({ x: 15, y: 80, w: 610, h: 32 });
  });

  it('★ 点中一行 → useCard{cardId, target:{kind:stock, index}}（0 基下标）', () => {
    expect(stockPickCardAction(24, 3)).toEqual({
      type: 'useCard',
      cardId: 24,
      target: { kind: 'stock', index: 3 },
    });
    expect(stockPickCardAction(25, 0)).toEqual({
      type: 'useCard',
      cardId: 25,
      target: { kind: 'stock', index: 0 },
    });
  });

  it('★ 行号越界 → null（不发 action、卡不消耗）', () => {
    expect(stockPickCardAction(24, 12)).toBeNull();
    expect(stockPickCardAction(24, -1)).toBeNull();
    // 命中函数给的 0..11 都在范围内
    expect(stockPickCardAction(24, 11)).not.toBeNull();
  });

  it('★ 命中还是那条 32 像素的行几何（同一套 hitStockRow）', () => {
    // 第 1 行：y ∈ (80, 112)
    expect(hitStockRow(100, 81)).toBe(0);
    expect(hitStockRow(100, 111)).toBe(0);
    // 第 2 行
    expect(hitStockRow(100, 113)).toBe(1);
    // 第 12 行下边界（464）之外
    expect(hitStockRow(100, 463)).toBe(11);
    expect(hitStockRow(100, 464)).toBeNull();
  });
});

describe('持股页「各玩家持股」零值也要画 @source loc_00429cf9..0x00429c24', () => {
  it('★ 没持股画成 `0`，不是留空（原版那一圈没有零值判断）', () => {
    const state = makeGameState();
    state.market.stocks[0] = {
      ...state.market.stocks[0]!,
      price: 100,
      openPrice: 100,
      commercialIndex: 1, // 上市 → 走图 1 的持股路径
    };
    // 四个玩家都不持股
    for (let p = 0; p < state.players.length; p++) {
      state.holdings[p] = state.holdings[p] ?? [];
      state.holdings[p]![0] = { amount: 0, avgCost: 0 };
    }
    const rows = stockRowsFrom(state, 0);
    expect(rows[0]!.holders.every((n) => n === 0)).toBe(true);

    // 画一遍图 1：四个「0」都要出现（先前 `if (n === 0) continue` 会让它们全消失）
    const spy = vi.fn();
    const ctx = {
      save: spy, restore: spy, beginPath: spy, rect: spy, clip: spy,
      drawImage: spy, fillRect: spy, strokeRect: spy, fillText: spy, strokeText: spy,
      fillStyle: '', strokeStyle: '', lineWidth: 0, font: '',
      textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
    drawStockScreen(ctx, () => null, {
      page: 1,
      closed: false,
      deposit: 0,
      rows,
      playerNames: state.players.map((_, i) => `P${i + 1}`),
      hover: null,
      selected: null,
      pickHover: null,
    });
    // ★ 断言必须钉到**持股那一列的位置**上 —— 整屏别处也有「0」（余额等），
    //   只数 '0' 的个数会被它们蒙过去（我第一版就是这么写的，回退实现仍然绿）。
    for (let p = 0; p < state.players.length; p++) {
      const colX = STOCK_HOLDER_X + p * STOCK_HOLDER_STEP;
      // fillText(s, x, y)：x 是第 2 个参数（我第一版写成 c[2] 是 y，断言恒假）
      const at = spy.mock.calls.filter((c) => c[0] === '0' && c[1] === colX);
      // 12 行都会在这一列画「0」（同一位玩家、每支股票一格），所以是「至少一次」
      expect(at.length, `第 ${p + 1} 位玩家的持股格应当画出「0」`).toBeGreaterThan(0);
    }
  });
});
