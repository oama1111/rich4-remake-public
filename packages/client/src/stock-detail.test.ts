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
  DETAIL_CHART_TAG,
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
  chartYAt,
  drawStockDetail,
  fixedOrNan,
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

  it('★ 走势线两端那两个价签：右对齐到 x=88、12 号字、上下各离端点 8px', () => {
    // @source `loc_0042a8bf` 起：`push 0xc` 建 12 号字、`push 0x58` 是 x、
    // 两处 `sub eax,8` / `add eax,8` 就是那个 8。
    expect(DETAIL_CHART_TAG).toEqual({ x: 0x58, size: 0xc, gap: 8 });
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

  it('★ 一个都没有时是 NaN（原版 `0/0`），不是 0', () => {
    // @source 0x0042a18d：`fild 计数` 后 `fdivr 求和` —— 计数 0 → x87 的 QNaN indefinite
    expect(Number.isNaN(recentAverage(hist([]), 0, 6))).toBe(true);
    expect(Number.isNaN(recentAverage(hist([]), 0, DETAIL_CHART.month))).toBe(true);
    // 有值就不受影响
    expect(recentAverage(hist([10]), 1, 6)).toBe(10);
  });

  it('★ NaN 那一格打出来是 `-nan`（Watcom `_cvt` 的写法）', () => {
    // @source 0x45c3b2（真 `_cvt`）→ 0x45d55d 写小写 nan；0/0 的符号位是 1 → 再补 `-`
    expect(fixedOrNan(NaN, 2)).toBe('-nan');
    expect(fixedOrNan(12.345, 2)).toBe('12.35');
    expect(fixedOrNan(12.345, 1)).toBe('12.3');
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

  it('★ `chartYAt` 就是折线每个点用的那条式子（截断，不是四舍五入）', () => {
    // 与上一条同一组数：mid = 20、scale = 109/20
    expect(chartYAt(30, 10, 30)).toBe(269);
    expect(chartYAt(30, 10, 10)).toBe(378);
    const pts = chartPoints(hist([10, 20, 30]), 0, 30, 10);
    expect(chartYAt(30, 10, 20)).toBe(pts[1]!.y);
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

  /** 一条好算的历史：前 7 格有值（第 1 格是 0，算「没写过」），今天 = 7 */
  const HIST = [10, 0, 30, 40, 50, 60, 70];
  function withHistory(base: ReturnType<typeof makeGameState>, stockIndex: number) {
    const history = base.market.history.map((h, i) => {
      if (i !== stockIndex) return h;
      const x = new Array<number>(DETAIL_CHART.days).fill(0);
      for (let k = 0; k < HIST.length; k++) x[k] = HIST[k]!;
      return x;
    });
    return { ...base, market: { ...base.market, history, day: HIST.length } };
  }

  /** 一支**没有上市公司**的股票 + 一堆「企业表下标 0」的垃圾，专抓错读第 0 格 */
  function unlistedState() {
    const s = withHistory(makeGameState(), 0);
    const stocks = s.market.stocks.map((x, i) =>
      i === 0 ? { ...x, commercialIndex: 0, price: 100, openPrice: 90, f10: 1234 } : x,
    );
    return {
      ...s,
      market: { ...s.market, stocks },
      // 企业表是 1 基的 —— 下标 0 是垃圾，简版卡一个字节都不该读它
      companyFunds: [999999, ...new Array<number>(15).fill(0)],
      companyProfit: [888888, ...new Array<number>(15).fill(0)],
      commercialOwners: [
        { owner: 2, ranking: [2, 0, 0, 0] },
        ...Array.from({ length: 15 }, () => ({ owner: 3, ranking: [0, 0, 0, 0] })),
      ],
    };
  }

  it('★ 有上市公司 → **公司卡**：图标 + 左列三格（本月盈餘/平均盈餘/經營者）', () => {
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
    expect(v.listed).toBe(true);
    expect(v.cells[0]![0]).toBe('12,000'); // 本月盈餘
    expect(v.cells[1]![0]).toBe('300'); // 平均盈餘 = 9000 ÷ 30
    expect(v.boss).toBe('乙'); // owner = 2 → 玩家下标 1
    expect(v.icon).toBe(3); // 地图 0 的銀行 = 图 3（那栋带 $ 的楼）
  });

  it('★ 没有上市公司 → **简版卡**：图标与左列三格全不画，右列 8 个数字照旧', () => {
    const v = stockDetailFrom(unlistedState(), 0, 0, NAMES, PLAYERS, null)!;
    expect(v.listed).toBe(false);
    // ① 图标整格不画 —— 画 0 会贴出资源 75 的 640×480 整屏页（需求方看到的那个错）
    expect(v.icon).toBeNull();
    // ② 左列三格（本月盈餘 / 平均盈餘 / 經營者）全空，**不去读下标 0 那个垃圾格**
    expect(v.cells[0]![0]).toBeNull();
    expect(v.cells[1]![0]).toBeNull();
    expect(v.boss).toBeNull();
    // ③ 右列那 8 个数字一个不少（@source `loc_00429fc5` 起那一段）
    expect(v.cells[0]![1]).toBe('100.0'); // 成交價（dec = 1）
    expect(v.cells[0]![2]).toBe('1234'); // 交易量 %d
    expect(v.cells[1]![1]).toBe('+10.0'); // 漲跌 = 现价 − 开盘
    expect(v.cells[1]![2]).toBe('11.11'); // 漲跌幅 %，恒两位
    expect(v.cells[2]![1]).toBe('50.0'); // 週均價（近 6 项非零）
    expect(v.cells[2]![2]).toBe('43.3'); // 月均價（近 24 项非零）
    expect(v.cells[3]![2]).toBe('70.0'); // 歷史高價
    expect(v.cells[4]![2]).toBe('10.0'); // 歷史低價
    // ④ 走势线与饼图两支都有
    expect(v.chart.length).toBeGreaterThan(0);
    expect(v.ratio).toBe(0);
  });

  it('★ 两支的**差别就在那四格**：同一局面下挂牌与不挂牌的数字集合不同', () => {
    const plainState = unlistedState();
    const listedState = {
      ...plainState,
      market: {
        ...plainState.market,
        stocks: plainState.market.stocks.map((x, i) => (i === 0 ? { ...x, commercialIndex: 3 } : x)),
      },
    };
    const plain = stockDetailFrom(plainState, 0, 0, NAMES, PLAYERS, null)!;
    const listed = stockDetailFrom(listedState, 0, 0, NAMES, PLAYERS, { type: 7, stockIndex: 0 })!;
    expect(plain.listed).toBe(false);
    expect(listed.listed).toBe(true);
    expect(plain.cells[0]![0]).toBeNull();
    expect(listed.cells[0]![0]).not.toBeNull();
    expect(plain.boss).toBeNull();
    expect(listed.boss).not.toBeNull();
    expect(plain.icon).toBeNull();
    expect(listed.icon).not.toBeNull();
    // 右列那一半两支一模一样
    for (const [r, c] of [[0, 1], [0, 2], [1, 1], [1, 2], [2, 1], [2, 2], [3, 2], [4, 2]] as const) {
      expect(plain.cells[r]![c]).toBe(listed.cells[r]![c]);
    }
  });

  it('★ 總天數为 0 时平均盈餘直接用累計盈餘（原版那一支）', () => {
    const base = makeGameState();
    const s = { ...base, totalDays: 0, companyProfit: Array.from({ length: 16 }, (_, i) => (i === 3 ? 9000 : 0)) };
    const stocks = s.market.stocks.map((x, i) => (i === 0 ? { ...x, commercialIndex: 3 } : x));
    const v = stockDetailFrom({ ...s, market: { ...s.market, stocks } }, 0, 0, NAMES, PLAYERS, null)!;
    expect(v.cells[1]![0]).toBe('9,000');
    expect(v.boss).toBeNull(); // 无主
    // 挂牌但地图上查不到企业记录（数据不一致）→ 也不画图标（画图 0 就是那张整屏页）
    expect(v.icon).toBeNull();
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

  it('★ 折线两端的价签跟着高低价走（@source `loc_0042a8bf` 起那两段）', () => {
    const v = stockDetailFrom(unlistedState(), 0, 0, NAMES, PLAYERS, null)!;
    expect(v.chartLabels.high).toBe('70.0');
    expect(v.chartLabels.low).toBe('10.0');
    // y = 折线端点的 y（画的时候才 ∓8）
    expect(v.chartLabels.highY).toBe(chartYAt(70, 10, 70));
    expect(v.chartLabels.lowY).toBe(chartYAt(70, 10, 10));
  });

  it('★ 高低价**无条件画**：一格历史都没有也照打初值 0 与 10000', () => {
    // 原版初值 高 = 0.0f、低 = 10000.0f，扫完直接 sprintf（@source 第 1165/1166 行）
    const base = makeGameState();
    // 价 < 15 → dec = 2，好把两位小数看全
    const stocks = base.market.stocks.map((x, i) => (i === 0 ? { ...x, price: 10, openPrice: 10 } : x));
    const v = stockDetailFrom({ ...base, market: { ...base.market, stocks } }, 0, 0, NAMES, PLAYERS, null)!;
    expect(v.cells[3]![2]).toBe('0.00'); // 历史一格都没写过 → 高还是初值 0
    expect(v.cells[4]![2]).toBe('10000.00'); // 低还是哨兵初值 10000
  });

  /** 记下「问了哪几张图」与「贴到哪」的假 ctx */
  function fakeCtx() {
    const asked: number[] = [];
    /** 每次取图连 `colorKeyBlack` 一起记（图标必须**不抠黑**）*/
    const askedKeyed: { index: number; colorKeyBlack: boolean }[] = [];
    const images: { dx: number; dy: number }[] = [];
    const textAt: { t: string; x: number; y: number; font: string }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      ellipse: () => undefined,
      fill: () => undefined,
      drawImage: (_b: unknown, dx: number, dy: number) => {
        images.push({ dx, dy });
      },
      fillText: (t: string, x: number, y: number) => {
        textAt.push({ t, x, y, font: ctx.font });
      },
    };
    const sprite = (_a: unknown, _r: number, index: number, colorKeyBlack = false) => {
      asked.push(index);
      askedKeyed.push({ index, colorKeyBlack });
      return { bitmap: {} as ImageBitmap, width: 80, height: 112, anchorX: 0, anchorY: 0 };
    };
    return {
      asked,
      askedKeyed,
      images,
      textAt,
      ctx: ctx as unknown as CanvasRenderingContext2D,
      sprite: sprite as unknown as Parameters<typeof drawStockDetail>[1],
    };
  }

  it('★ 未上市 → 画的时候**一张图标都不贴**（只贴底图；图 0 是 640×480 整屏页）', () => {
    const f = fakeCtx();
    drawStockDetail(f.ctx, f.sprite, stockDetailFrom(unlistedState(), 0, 0, NAMES, PLAYERS, null)!);
    expect(f.asked).toEqual([DETAIL_IMAGE]); // 只问了图 2（底图），没有图标那一次
    expect(f.images).toEqual([{ dx: DETAIL_ORIGIN.x, dy: DETAIL_ORIGIN.y }]);
  });

  it('★ 已上市 → 底图 + 图标两张（图标贴 (50,107)）', () => {
    const st = unlistedState();
    const stocks = st.market.stocks.map((x, i) => (i === 0 ? { ...x, commercialIndex: 3 } : x));
    const listed = { ...st, market: { ...st.market, stocks } };
    const f = fakeCtx();
    drawStockDetail(f.ctx, f.sprite, stockDetailFrom(listed, 0, 0, NAMES, PLAYERS, { type: 7, stockIndex: 0 })!);
    expect(f.asked).toEqual([DETAIL_IMAGE, 3]); // 底图 + 銀行那栋
    expect(f.images).toEqual([
      { dx: DETAIL_ORIGIN.x, dy: DETAIL_ORIGIN.y },
      { dx: DETAIL_ICON.x, dy: DETAIL_ICON.y },
    ]);
    // ★ 图标**不抠黑**：原版走不透明 blit（`call 0x4563f5` @0x00429f25）；
    //   资源 75 是 SMP，電子那台显示器屏 12%、圖 9 有 39.6% 是纯黑，抠了就镂空
    expect(f.askedKeyed).toEqual([
      { index: DETAIL_IMAGE, colorKeyBlack: false },
      { index: 3, colorKeyBlack: false },
    ]);
  });

  it('★ 折线两端的价签按 (88, 折线端点 ∓8) 画、**12 号**字', () => {
    const f = fakeCtx();
    const v = stockDetailFrom(unlistedState(), 0, 0, NAMES, PLAYERS, null)!;
    drawStockDetail(f.ctx, f.sprite, v);
    const tag = (t: string) => f.textAt.find((x) => x.t === t && x.x === DETAIL_CHART_TAG.x);
    expect(tag(v.chartLabels.high)).toMatchObject({
      t: '70.0', x: 88, y: v.chartLabels.highY - DETAIL_CHART_TAG.gap,
    });
    expect(tag(v.chartLabels.low)).toMatchObject({
      t: '10.0', x: 88, y: v.chartLabels.lowY + DETAIL_CHART_TAG.gap,
    });
    expect(tag('70.0')!.font.startsWith('12px')).toBe(true);
  });
});

describe('持股饼的画序 @source loc_0042a3cc 起（三个分支）', () => {
  interface Arc { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; ccw: boolean }

  /** 记下每次 `fill`/`stroke` 的颜色与那条路径上的椭圆参数 */
  function pieCtx() {
    const fills: { fill: string; arcs: Arc[] }[] = [];
    const strokes: Arc[][] = [];
    let path: Arc[] = [];
    let style = '';
    const ctx = {
      get fillStyle(): string {
        return style;
      },
      set fillStyle(v: string) {
        style = v;
      },
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      save: () => undefined,
      restore: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      fillText: () => undefined,
      drawImage: () => undefined,
      beginPath: () => {
        path = [];
      },
      ellipse: (
        cx: number, cy: number, rx: number, ry: number,
        _rot: number, a0: number, a1: number, ccw: boolean,
      ) => {
        path.push({ cx, cy, rx, ry, a0, a1, ccw });
      },
      fill: () => fills.push({ fill: style, arcs: path.slice() }),
      stroke: () => strokes.push(path.slice()),
    };
    const sprite = () => ({ bitmap: {} as ImageBitmap, width: 80, height: 112, anchorX: 0, anchorY: 0 });
    return {
      fills,
      strokes,
      ctx: ctx as unknown as CanvasRenderingContext2D,
      sprite: sprite as unknown as Parameters<typeof drawStockDetail>[1],
    };
  }

  const NAMES = Array.from({ length: 12 }, (_, i) => `股${i}`);
  const PLAYERS = ['甲', '乙', '丙', '丁'];

  /** 只跑「饼」那一段：拿一张真卡把 ratio 换掉、折线清空 */
  function pieFills(ratio: number) {
    const base = stockDetailFrom(makeGameState(), 0, 0, NAMES, PLAYERS, null)!;
    const f = pieCtx();
    drawStockDetail(f.ctx, f.sprite, { ...base, chart: [], ratio });
    // 有椭圆的 fill 才是饼那些（文字不走 fill）
    return f.fills.filter((o) => o.arcs.length > 0);
  }

  const boxCy = (DETAIL_PIE.box.top + DETAIL_PIE.box.bottom) / 2;
  const topCy = (DETAIL_PIE.topBox.top + DETAIL_PIE.topBox.bottom) / 2;

  it('★ r == 0 → 两个椭圆都是**深蓝**（其余那支的颜色），不是红', () => {
    // exe：`push 0xd00000` @0x0042a665 → `Ellipse(box)` @0x0042a681 → `Ellipse(topBox)` @0x0042a71d
    const fills = pieFills(0);
    expect(fills.map((o) => o.fill)).toEqual([DETAIL_PIE.rest, DETAIL_PIE.rest]);
    expect(fills.map((o) => o.arcs[0]!.cy)).toEqual([boxCy, topCy]);
  });

  it('★ r ≥ 1 → 两个椭圆都是**深红**（自己那份的颜色）@0x0042a6c2', () => {
    const fills = pieFills(1);
    expect(fills.map((o) => o.fill)).toEqual([DETAIL_PIE.mine, DETAIL_PIE.mine]);
    expect(fills.map((o) => o.arcs[0]!.cy)).toEqual([boxCy, topCy]);
  });

  it('★ 0 < r < 1 → 先铺**底盘椭圆**（深蓝）再两段扇，最后才是 FloodFill 的黑月牙', () => {
    // @source 0x0042a526 的 `Ellipse(414,343,591,401)` 在两次 `Pie` 之前
    const fills = pieFills(0.5);
    expect(fills.map((o) => o.fill)).toEqual([
      DETAIL_PIE.rest, // ① 底盘 @0x0042a50a
      DETAIL_PIE.mine, // ② 自己那份（占 ratio）@0x0042a586 那支刷子
      DETAIL_PIE.rest, // ③ 其余 @0x0042a549 那支刷子
      '#000000', // ④ FloodFill(dc,589,374,0) @0x0042a638
    ]);
    expect(fills[0]!.arcs[0]!.cy).toBe(boxCy);
    expect(fills[1]!.arcs[0]!.cy).toBe(topCy);
    // r = 0.5：端点在下半（y = 394 ≥ 365）→ 有那道 7px 竖线 → 月牙只涂它右边
    const end = pieEnd(0.5);
    expect(end).toEqual({ x: 502, y: 394 });
    expect(fills[3]!.arcs[0]!.a1).toBeCloseTo(Math.acos((end.x - DETAIL_PIE.cx) / DETAIL_PIE.rx), 10);
  });

  it('★ r ≤ 0.25 不涂黑（@0x0042a611 `fcomp 0.25` + `jbe`）', () => {
    const fills = pieFills(0.1);
    expect(fills.map((o) => o.fill)).toEqual([DETAIL_PIE.rest, DETAIL_PIE.mine, DETAIL_PIE.rest]);
  });

  it('★ 端点在上班（y < 365）→ 没有那道竖线，月牙整条连通 0..π', () => {
    const fills = pieFills(0.9);
    const end = pieEnd(0.9);
    expect(end.y).toBeLessThan(DETAIL_PIE.cy);
    expect(fills.map((o) => o.fill)).toEqual([
      DETAIL_PIE.rest, DETAIL_PIE.mine, DETAIL_PIE.rest, '#000000',
    ]);
    expect(fills[3]!.arcs[0]!.a0).toBe(0);
    expect(fills[3]!.arcs[0]!.a1).toBe(Math.PI);
  });

  it('★ 端点 x ≥ 589 时也不涂（@0x0042a627 `cmp …,0x24d` + `jge`）', () => {
    // r 刚过 0.25 时端点还在最右、xend 仍是 590
    const end = pieEnd(0.26);
    expect(end.x).toBeGreaterThanOrEqual(DETAIL_VALUE_X.c3);
    const fills = pieFills(0.26);
    expect(fills.map((o) => o.fill)).toEqual([DETAIL_PIE.rest, DETAIL_PIE.mine, DETAIL_PIE.rest]);
  });

  it('★ 两个椭圆的 black 描边与两道端帽短竖线三支都画 @0x0042a3cc', () => {
    // `CreatePen(0,1,0)` 选进 DC 后，`Ellipse` / `Pie` / `LineTo` 全用它描边
    const f = pieCtx();
    const base = stockDetailFrom(makeGameState(), 0, 0, NAMES, PLAYERS, null)!;
    drawStockDetail(f.ctx, f.sprite, { ...base, chart: [], ratio: 0 });
    // 两道端帽（moveTo/lineTo，不落 ellipse）+ 底盘 + 上盘 = 3 次 stroke
    expect(f.strokes).toHaveLength(3);
    expect(f.strokes[0]!.length).toBe(0);
    expect(f.strokes[1]!.map((a) => a.cy)).toEqual([boxCy]);
    expect(f.strokes[2]!.map((a) => a.cy)).toEqual([topCy]);
  });
});

