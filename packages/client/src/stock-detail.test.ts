/*
 * 上市公司資訊详情卡（T-030b）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标照 exe（`fcn_00429d65` 的各 `draw_text` / `Ellipse` / `MoveToEx`），
 * 把「容易写错、错了又难看出来的」几条钉住：
 * 图标表是**每图 12 字节、列 = 行業別 − 1**、历史里 ±0 算「没写过」、
 * 均价从今天**往前**数且要绕圈、走势线从今天起画到第一个空位为止、
 * 饼图从正上方顺时针切。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState } from '@rich4/core';
import {
  DETAIL_CHART,
  DETAIL_ICON,
  DETAIL_ICON_TABLE,
  DETAIL_IMAGE,
  DETAIL_ORIGIN,
  DETAIL_PIE,
  DETAIL_RESOURCE,
  DETAIL_SIZE,
  DETAIL_TITLE,
  DETAIL_VALUE_X,
  DETAIL_VALUE_Y,
  chartPoints,
  chartScale,
  historyFilled,
  historyRange,
  iconImageOf,
  pieEnd,
  recentAverage,
  stockDetailFrom,
} from './stock-detail.ts';

describe('详情卡几何 @source fcn_00429d65', () => {
  it('★ 卡是资源 75 的图 2，贴在 (26,52)', () => {
    expect(DETAIL_RESOURCE).toBe(75);
    expect(DETAIL_IMAGE).toBe(2);
    expect(DETAIL_ORIGIN).toEqual({ x: 26, y: 52 });
    expect(DETAIL_SIZE).toEqual({ w: 587, h: 375 });
    // 卡不出屏
    expect(DETAIL_ORIGIN.x + DETAIL_SIZE.w).toBeLessThanOrEqual(640);
    expect(DETAIL_ORIGIN.y + DETAIL_SIZE.h).toBeLessThanOrEqual(480);
  });

  it('★ 标题 20 号居中 (320,82)；图标贴 (50,107)', () => {
    expect(DETAIL_TITLE).toEqual({ x: 320, y: 82, size: 20 });
    expect(DETAIL_ICON).toEqual({ x: 50, y: 107 });
  });

  it('★ 三列数值右边缘 309/453/589，五行 y = 123/162/203/243/283', () => {
    expect(DETAIL_VALUE_X).toEqual({ c1: 0x135, c2: 0x1c5, c3: 0x24d });
    expect(DETAIL_VALUE_Y).toEqual([0x7b, 0xa2, 0xcb, 0xf3, 0x11b]);
  });
});

describe('企业图标索引 @source 表 0x475530', () => {
  it('★ 表是 8 张地图 × 12 个行業別', () => {
    expect(DETAIL_ICON_TABLE).toHaveLength(96);
  });

  it('★ 表里的值**就是图号**（不是偏移）', () => {
    // 地图 0：航空(1)=11、電子(3)=7、銀行(7)=3（那栋带 $ 的楼）、百貨(10)=4
    expect(iconImageOf(0, 1, 0)).toBe(11);
    expect(iconImageOf(0, 3, 0)).toBe(7);
    expect(iconImageOf(0, 7, 0)).toBe(3);
    expect(iconImageOf(0, 10, 0)).toBe(4);
    // 地图 0 的汽車(5) 是 6 —— 就是那辆车（导出来对过）
    expect(iconImageOf(0, 5, 0)).toBe(6);
    // 地图 2 的電子是 8（与地图 0 不同）
    expect(iconImageOf(2, 3, 0)).toBe(8);
  });

  it('★ 表里的 0x0f / 0x18 是算式，要加股票下标', () => {
    // 地图 5 行業別 12 = 0x0f → + (股票下标 − 3)
    expect(iconImageOf(5, 12, 5)).toBe(15 + 2);
    // 地图 7 行業別 2 = 0x18 → + (股票下标 − 2)
    expect(iconImageOf(7, 2, 4)).toBe(24 + 2);
  });

  it('★ 表里为 0 的格子（该图没有这种行業）就是图 0（底图，等于不画）', () => {
    expect(iconImageOf(0, 2, 0)).toBe(0);
    expect(iconImageOf(0, 8, 0)).toBe(0);
  });
});

describe('历史缓冲的统计 @source loc_0042a147 / loc_0042a2b3', () => {
  /** 造一条 144 格的历史：前 n 格填 v，其余留 0 */
  function hist(fill: readonly number[]): number[] {
    const h = new Array<number>(DETAIL_CHART.days).fill(0);
    for (let i = 0; i < fill.length; i++) h[i] = fill[i]!;
    return h;
  }

  it('★ ±0 算「没写过」（去掉符号位为 0）', () => {
    expect(historyFilled(0)).toBe(false);
    expect(historyFilled(-0)).toBe(false);
    expect(historyFilled(0.0001)).toBe(true);
    expect(historyFilled(-5)).toBe(true);
  });

  it('★ 均价从今天**往前**数，且要绕圈', () => {
    const h = hist([10, 20, 30]);
    // day = 3：往前 3 格 = 30 / 20 / 10
    expect(recentAverage(h, 3, 3)).toBe(20);
    // day = 1：往前 3 格 = 10 / [143]=0 跳过 / [142]=0 跳过 → 只有一个 10
    expect(recentAverage(h, 1, 3)).toBe(10);
  });

  it('★ 一个都没有就返回 0', () => {
    expect(recentAverage(hist([]), 0, 6)).toBe(0);
    expect(recentAverage(hist([]), 0, DETAIL_CHART.month)).toBe(0);
  });

  it('★ 高低扫满 144 格；没有历史时低价的哨兵值要还原成 0', () => {
    expect(historyRange(hist([10, 20, 30]))).toEqual({ high: 30, low: 10 });
    expect(historyRange(hist([]))).toEqual({ high: 0, low: 10000 });
  });
});

describe('半年走势线 @source loc_0042a724', () => {
  function hist(fill: readonly number[]): number[] {
    const h = new Array<number>(DETAIL_CHART.days).fill(0);
    for (let i = 0; i < fill.length; i++) h[i] = fill[i]!;
    return h;
  }

  it('★ 波动够大按「109 ÷ 价差」，否则按「109 ÷ (中线 × 0.6)」', () => {
    // 价差/中线 = 20/20 = 1 > 0.3 → 109/40
    expect(chartScale(30, 10)).toBeCloseTo(109 / 20, 6);
    // 价差/中线 = 0.2/1 = 0.2 ≤ 0.3 → 109/(1×0.6)
    expect(chartScale(1.1, 0.9)).toBeCloseTo(109 / 0.6, 6);
  });

  it('★ x 从 92 起每点 +2；y 以 324 为中线、价高在上', () => {
    const h = hist([10, 20, 30]);
    const pts = chartPoints(h, 0, 30, 10);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.x).toBe(92);
    expect(pts[1]!.x).toBe(94);
    expect(pts[2]!.x).toBe(96);
    // mid = 20、scale = 109/20 → 三个点关于 y=324 对称
    // 原版是先算完再 `round_toward_zero`（不是先截断差值）
    const y = (v: number): number => Math.trunc(DETAIL_CHART.midY - (v - 20) * (109 / 20));
    expect(pts[0]!.y).toBe(y(10));
    expect(pts[1]!.y).toBe(y(20));
    expect(pts[2]!.y).toBe(y(30));
    expect(pts[0]!.y).toBe(378); // 324 + 54.5 → 378
    expect(pts[2]!.y).toBe(269); // 324 − 54.5 → 269
  });

  it('★ 从「今天」起画，遇到没写过的那格就停', () => {
    const h = hist([10, 20, 30]); // 只有 0/1/2 有值
    const pts = chartPoints(h, 0, 30, 10);
    expect(pts).toHaveLength(3); // 画到第 4 格（全 0）停
    // 今天没写（day=100）时从头开始
    expect(chartPoints(h, 100, 30, 10)).toHaveLength(3);
  });

  it('★ 一个历史都没有 → 一个点都不画', () => {
    expect(chartPoints(hist([]), 0, 0, 10000)).toHaveLength(0);
  });
});

describe('持股比例那个饼 @source loc_0042a324', () => {
  it('★ 圆心与半径照常量', () => {
    expect([DETAIL_PIE.cx, DETAIL_PIE.cy, DETAIL_PIE.rx, DETAIL_PIE.ry]).toEqual([502, 365, 88, 29]);
    expect(DETAIL_PIE.totalShares).toBe(10000);
  });

  it('★ ratio=0 切在正上方；0.25 切在正右（顺时针）', () => {
    expect(pieEnd(0)).toEqual({ x: 502, y: 365 - 29 });
    expect(pieEnd(0.25)).toEqual({ x: 502 + 88, y: 365 });
    expect(pieEnd(0.5)).toEqual({ x: 502, y: 365 + 29 });
  });
});

describe('从局面摊出一张卡', () => {
  const NAMES = Array.from({ length: 12 }, (_, i) => `股${i}`);
  const PLAYERS = ['甲', '乙', '丙', '丁'];

  it('★ 有企业时：盈餘取 companyFunds / companyProfit÷總天數、經營者取業主名字', () => {
    const base = makeGameState();
    const s = {
      ...base,
      totalDays: 30,
      companyFunds: Array.from({ length: 16 }, (_, i) => (i === 3 ? 12000 : 0)),
      companyProfit: Array.from({ length: 16 }, (_, i) => (i === 3 ? 9000 : 0)),
      // ★ 工厂里 commercialOwners / commercialShares 是**空数组**，得自己铺到够长
      commercialOwners: Array.from({ length: 16 }, (_, i) =>
        i === 3 ? { owner: 2, ranking: [2, 0, 0, 0] } : { owner: 0, ranking: [0, 0, 0, 0] },
      ),
    };
    const stocks = s.market.stocks.map((x, i) => (i === 0 ? { ...x, commercialIndex: 3 } : x));
    const state = { ...s, market: { ...s.market, stocks } };
    const v = stockDetailFrom(state, 0, 0, NAMES, PLAYERS, { type: 7, stockIndex: 0 })!;
    expect(v.name).toBe('股0');
    expect(v.cells[0]![0]).toBe('12,000'); // 本月盈餘
    expect(v.cells[1]![0]).toBe('300'); // 平均盈餘 = 9000 ÷ 30
    expect(v.boss).toBe('乙'); // owner = 2 → 玩家下标 1
    expect(v.icon).toBe(3); // 地图 0 的銀行 = 图 3（那栋带 $ 的楼）
  });

  it('★ 總天數为 0 时平均盈餘直接用累計盈餘（原版那一支）', () => {
    const base = makeGameState();
    const s = { ...base, totalDays: 0, companyProfit: Array.from({ length: 16 }, (_, i) => (i === 3 ? 9000 : 0)) };
    const stocks = s.market.stocks.map((x, i) => (i === 0 ? { ...x, commercialIndex: 3 } : x));
    const v = stockDetailFrom({ ...s, market: { ...s.market, stocks } }, 0, 0, NAMES, PLAYERS, null)!;
    expect(v.cells[1]![0]).toBe('9,000');
    expect(v.boss).toBeNull(); // 无主
    expect(v.icon).toBe(0); // 没有企业 → 不画图标
  });

  it('★ 涨跌幅是百分数、涨跌带符号、位数跟价格量级', () => {
    const base = makeGameState();
    const stocks = base.market.stocks.map((x, i) =>
      i === 0 ? { ...x, openPrice: 100, price: 110 } : x,
    );
    const v = stockDetailFrom({ ...base, market: { ...base.market, stocks } }, 0, 0, NAMES, PLAYERS, null)!;
    expect(v.cells[0]![1]).toBe('110.0');
    expect(v.cells[1]![1]).toBe('+10.0');
    expect(v.cells[1]![2]).toBe('10.00');
  });

  it('★ 持股比例 = 自己那支的持股 ÷ 10000', () => {
    const base = makeGameState();
    const holdings = base.holdings.map((h, p) =>
      h.map((x, i) => (p === 0 && i === 2 ? { amount: 2500, avgCost: 1 } : x)),
    );
    const v = stockDetailFrom({ ...base, holdings }, 2, 0, NAMES, PLAYERS, null)!;
    expect(v.ratio).toBeCloseTo(0.25, 10);
    expect(pieEnd(v.ratio)).toEqual({ x: 590, y: 365 });
    expect(stockDetailFrom({ ...base, holdings }, 2, 1, NAMES, PLAYERS, null)!.ratio).toBe(0);
  });
});
