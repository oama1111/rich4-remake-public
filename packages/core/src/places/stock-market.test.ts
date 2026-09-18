/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  HISTORY_DAYS,
  MAX_PRICE,
  MAX_TREND,
  MIN_PRICE,
  applyPriceTick,
  applyStockNews,
  bindCommercials,
  newStockMarket,
  newsTrend,
  refreshTradableShares,
  tickSize,
  tickMarketClosure,
  tickStockCountdowns,
  tickStockMarket,
} from './stock-market.ts';
import type { StockMarketState } from './stock-market.ts';
import type { StockState } from './stock.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { STOCKS, STOCKS_PER_MAP } from '@rich4/data';

const stock = (over: Partial<StockState> = {}): StockState => ({
  price: 100,
  openPrice: 100,
  basePrice: 100,
  shares: 10_000,
  f10: 10_000,
  commercialIndex: 0,
  f6: 0,
  newsFlag: 0,
  volatility: 1,
  trend: 0,
  shock: 0,
  ...over,
});

const market = (stocks: StockState[]): StockMarketState => ({
  stocks,
  day: 0,
  history: stocks.map(() => new Array<number>(HISTORY_DAYS).fill(0)),
  index: 0,
  closedDays: 0,
});

describe('跳动单位', () => {
  it('★ 按台股式的价位档划分 —— 5/15/50/150 四道坎', () => {
    expect(tickSize(4.99)).toBe(0.01);
    expect(tickSize(5)).toBe(0.05);
    expect(tickSize(14.99)).toBe(0.05);
    expect(tickSize(15)).toBe(0.1);
    expect(tickSize(49.99)).toBe(0.1);
    expect(tickSize(50)).toBe(0.5);
    expect(tickSize(149.99)).toBe(0.5);
    expect(tickSize(150)).toBe(1);
    expect(tickSize(9999)).toBe(1);
  });
});

describe('落档', () => {
  it('趋势为 0 时价格不变', () => {
    expect(applyPriceTick(100, 0)).toBe(100);
  });

  it('★ 涨跌都朝开盘价方向取整，不是四舍五入', () => {
    // 100 涨 3.7% → 103.7，档位 0.5（≥50 且 <150）
    // 涨幅 3.7 对 0.5 取余 = 0.2，落档后 103.5 —— 比 103.7 **低**
    const up = applyPriceTick(100, 3.7);
    expect(up).toBeLessThan(103.7);
    expect(up).toBeCloseTo(103.5, 5);

    // 100 跌 3.7% → 96.3，跌幅 3.7 对 0.5 取余 0.2，落档后 96.5 —— 比 96.3 **高**
    const down = applyPriceTick(100, -3.7);
    expect(down).toBeGreaterThan(96.3);
    expect(down).toBeCloseTo(96.5, 5);
  });

  it('★ 落档后仍是跳动单位的整数倍（相对开盘价）', () => {
    for (const pct of [1.3, 2.9, 7.7, -1.3, -6.1, -9.9]) {
      const out = applyPriceTick(200, pct);
      // 200 → 档位 1.0，故收盘价与开盘价之差必为整数
      expect(Number.isInteger(Math.round((out - 200) * 1e6) / 1e6)).toBe(true);
    }
  });

  it('★ 下限 1、上限 9999', () => {
    expect(applyPriceTick(1.2, -99)).toBe(MIN_PRICE);
    expect(applyPriceTick(9990, 10)).toBe(MAX_PRICE);
  });

  it('极低价位用 0.01 档，不会被抹成 0', () => {
    const out = applyPriceTick(2, -3);
    expect(out).toBeGreaterThanOrEqual(MIN_PRICE);
    expect(out).toBeLessThan(2);
  });
});

describe('开局行情', () => {
  it('★ 每张地图 12 支，三个价格字段初值相同', () => {
    for (let mapId = 0; mapId < 8; mapId++) {
      const m = newStockMarket(mapId);
      expect(m.stocks).toHaveLength(STOCKS_PER_MAP);
      for (const s of m.stocks) {
        expect(s.price).toBe(s.openPrice);
        expect(s.price).toBe(s.basePrice);
      }
    }
  });

  it('股票取自对应地图的那一段', () => {
    const m = newStockMarket(1);
    expect(m.stocks[0]!.price).toBe(STOCKS[STOCKS_PER_MAP]!.price);
    expect(m.stocks[0]!.volatility).toBe(STOCKS[STOCKS_PER_MAP]!.volatility);
  });
});

describe('每日收盘', () => {
  it('★ 昨日收盘成为今日开盘', () => {
    const rng = new WatcomRng(1234);
    let m = newStockMarket(0);
    const firstClose = m.stocks.map((s) => s.price);
    m = tickStockMarket(m, rng);
    expect(m.stocks.map((s) => s.openPrice)).toEqual(firstClose);
    const secondOpen = m.stocks.map((s) => s.price);
    m = tickStockMarket(m, rng);
    expect(m.stocks.map((s) => s.openPrice)).toEqual(secondOpen);
  });

  it('★★ 冲击用**未舍入**的扩展精度值（`fst` 不弹栈）—— 差 1 ulp 也要对上', () => {
    // 通道 2：`rich4-spec/tests/test_stock_daily.py` §E
    //   原版 `fdiv` 之后是 `fst dword [+0x20]`（**不弹栈**），所以后面的
    //   `fmul [+24] / fadd [+28]` 用的是**未舍入**的 r，只有 `+0x20` 存的是 f32。
    //   本用例：drift 抽 0x4000（= 0）、冲击抽 0x3000（r = −4096/1171）。
    //   ★ 用舍过的 r 会得到 0xbfbfba0a（−1.4978649616241455），原版是 0xbfbfba0b。
    const picks = [0x4000, 0x3000, ...new Array<number>(11).fill(0x4000)];
    let i = 0;
    const r = { next: () => picks[i++] ?? 0x4000 } as unknown as WatcomRng;
    const m = tickStockMarket(market([stock({ volatility: 1, trend: 2 })]), r);
    expect(m.stocks[0]!.trend).toBe(-1.497865080833435);
    // 而 `+0x20`（shock）存的是舍过的那个
    expect(m.stocks[0]!.shock).toBe(Math.fround(-4096 / 1171));
  });

  it('★ 趋势是累加的 —— 走势有惯性，不是每日独立白噪声', () => {
    const rng = new WatcomRng(77);
    let m = market([stock({ volatility: 1 })]);
    // 人为给一个很强的正趋势，观察它是否被带入次日
    m = { ...m, stocks: [{ ...m.stocks[0]!, trend: 8 }] };
    const before = m.stocks[0]!.trend;
    m = tickStockMarket(m, rng);
    // 次日趋势 = 冲击×波动 + 昨日趋势 + 大盘漂移，随机项幅度有限，
    // 不可能把 8 一次性抹成与它无关的值
    expect(m.stocks[0]!.trend).not.toBe(before);
    expect(m.stocks[0]!.price).toBeGreaterThan(100);
  });

  it('★ 趋势永远钳在 ±10', () => {
    const rng = new WatcomRng(5);
    let m = market([stock({ volatility: 2, trend: 9.9 })]);
    for (let i = 0; i < 200; i++) {
      m = tickStockMarket(m, rng);
      expect(m.stocks[0]!.trend).toBeLessThanOrEqual(MAX_TREND);
      expect(m.stocks[0]!.trend).toBeGreaterThanOrEqual(-MAX_TREND);
    }
  });

  it('★ f6 非 0 的股票当日不动，趋势被清零', () => {
    const rng = new WatcomRng(9);
    let m = market([stock({ f6: 1, trend: 7 })]);
    m = tickStockMarket(m, rng);
    expect(m.stocks[0]!.trend).toBe(0);
    expect(m.stocks[0]!.price).toBe(100);
  });

  it('★ 有新闻标记时趋势固定为 ±10，与随机无关', () => {
    const up = tickStockMarket(market([stock({ newsFlag: 0x10 })]), new WatcomRng(1));
    const down = tickStockMarket(market([stock({ newsFlag: 0x01 })]), new WatcomRng(999));
    expect(up.stocks[0]!.trend).toBe(10);
    expect(down.stocks[0]!.trend).toBe(-10);
    expect(up.stocks[0]!.price).toBe(applyPriceTick(100, 10));
    expect(down.stocks[0]!.price).toBe(applyPriceTick(100, -10));
  });

  it('★ 价格始终留在 [1, 9999] 内 —— 长跑 2000 日不越界', () => {
    const rng = new WatcomRng(20260913);
    let m = newStockMarket(0);
    for (let i = 0; i < 2000; i++) {
      m = tickStockMarket(m, rng);
      for (const s of m.stocks) {
        expect(s.price).toBeGreaterThanOrEqual(MIN_PRICE);
        expect(s.price).toBeLessThanOrEqual(MAX_PRICE);
      }
    }
  });

  it('★ 均值回归确实在起作用：长跑后股价不会离初始价无限远', () => {
    const rng = new WatcomRng(4242);
    let m = newStockMarket(0);
    for (let i = 0; i < 3000; i++) m = tickStockMarket(m, rng);
    for (const s of m.stocks) {
      // 无企业时「过高」线是初始价 ×8、「过低」线是 ×0.5，
      // 越线后趋势会被加倍/削半，故长期不该出现几十倍的离谱值
      expect(s.price).toBeLessThan(s.basePrice * 40);
    }
  });

  it('★ 有对应企业时参考价改用企业资产 ÷ 10000', () => {
    // 波动系数取 0 消掉个股随机项，只留下大盘漂移，两次跑用同一种子即同一漂移
    const seed = 31;
    const base = { volatility: 0, trend: 1 };

    // 企业资产 1000 万 → 参考价 1000，开盘 100 远低于 1000×0.85 → 「过低」区
    const withCommercial = tickStockMarket(
      market([stock({ ...base, commercialIndex: 3 })]),
      new WatcomRng(seed),
      () => 10_000_000,
    );
    // 无企业时参考价 = 初始价 100，开盘也是 100，两条线都没越 → 不调整
    const plain = tickStockMarket(market([stock(base)]), new WatcomRng(seed));

    const t = plain.stocks[0]!.trend;
    expect(t).toBeGreaterThan(0); // 该种子下漂移没把 +1 压成负数
    // 「过低」区里的正趋势被加倍
    expect(withCommercial.stocks[0]!.trend).toBeCloseTo(Math.min(t * 2, MAX_TREND), 5);
  });

  it('★ 「过高」区里的涨势被削半', () => {
    const seed = 31;
    const base = { volatility: 0, trend: 1 };
    // 开盘 100、参考价 10（企业资产 10 万），100 > 10×3 → 「过高」区
    const high = tickStockMarket(
      market([stock({ ...base, commercialIndex: 3 })]),
      new WatcomRng(seed),
      () => 100_000,
    );
    const plain = tickStockMarket(market([stock(base)]), new WatcomRng(seed));
    expect(high.stocks[0]!.trend).toBeCloseTo(plain.stocks[0]!.trend * 0.5, 5);
  });

  it('★ 日序号写满 144 天回绕', () => {
    const rng = new WatcomRng(3);
    let m = market([stock()]);
    for (let i = 0; i < HISTORY_DAYS; i++) m = tickStockMarket(m, rng);
    expect(m.day).toBe(0);
    // 一圈下来每一格都写过了
    expect(m.history[0]!.every((v) => v > 0)).toBe(true);
  });

  it('大盘指数 = Σ收盘价 × 10，向零取整', () => {
    const rng = new WatcomRng(8);
    const m = tickStockMarket(market([stock({ f6: 1 }), stock({ f6: 1, price: 50 })]), rng);
    expect(m.index).toBe(Math.trunc((100 + 50) * 10));
  });

  it('★ 同种子同序列可完整复现', () => {
    const run = (): StockMarketState => {
      const rng = new WatcomRng(20240101);
      let m = newStockMarket(2);
      for (let i = 0; i < 300; i++) m = tickStockMarket(m, rng);
      return m;
    };
    expect(run().stocks.map((s) => s.price)).toEqual(run().stocks.map((s) => s.price));
    expect(run().index).toBe(run().index);
  });
});

describe('新闻即时改价', () => {
  it('★ 覆盖的是当日那一笔历史，不是新开一天', () => {
    const rng = new WatcomRng(6);
    let m = market([stock({ newsFlag: 0x10 })]);
    m = tickStockMarket(m, rng);
    const dayBefore = m.day;
    const after = applyStockNews(m, 1);
    expect(after.day).toBe(dayBefore);
    expect(after.history[0]![dayBefore - 1]).toBe(after.stocks[0]!.price);
  });

  it('★ 无新闻标记的股票原样不动', () => {
    const m = market([stock({ newsFlag: 0 })]);
    expect(applyStockNews(m, 1).stocks[0]!.price).toBe(100);
  });

  it('高半字节利多、低半字节利空', () => {
    expect(newsTrend(0x10)).toBe(10);
    expect(newsTrend(0xf0)).toBe(10);
    expect(newsTrend(0x01)).toBe(-10);
    expect(newsTrend(0x0f)).toBe(-10);
    // 两边都有时以高半字节为准
    expect(newsTrend(0x11)).toBe(10);
  });

  it('stockId 为 0 时全场生效，非 0 时只动那一支', () => {
    const m = market([stock({ newsFlag: 0x10 }), stock({ newsFlag: 0x01 })]);
    const all = applyStockNews(m, 0);
    expect(all.stocks[0]!.price).toBeGreaterThan(100);
    expect(all.stocks[1]!.price).toBeLessThan(100);

    const one = applyStockNews(m, 2);
    expect(one.stocks[0]!.price).toBe(100);
    expect(one.stocks[1]!.price).toBeLessThan(100);
  });

  it('日序号为 0 时回绕到第 143 格', () => {
    const m = { ...market([stock({ newsFlag: 0x10 })]), day: 0 };
    const after = applyStockNews(m, 1);
    expect(after.history[0]![HISTORY_DAYS - 1]).toBe(after.stocks[0]!.price);
  });
});

describe('每日倒数', () => {
  it('★ 新闻标记是两个 4 位计数器，各自减一', () => {
    const m = tickStockCountdowns(market([stock({ newsFlag: 0x35 })]));
    expect(m.stocks[0]!.newsFlag).toBe(0x24);
  });

  it('只有利多时低半字节不动', () => {
    expect(tickStockCountdowns(market([stock({ newsFlag: 0x30 })])).stocks[0]!.newsFlag).toBe(0x20);
  });

  it('只有利空时高半字节不动', () => {
    expect(tickStockCountdowns(market([stock({ newsFlag: 0x03 })])).stocks[0]!.newsFlag).toBe(0x02);
  });

  it('★ 减到 0 就停住，不会变成负数或借位', () => {
    let m = market([stock({ newsFlag: 0x11 })]);
    m = tickStockCountdowns(m);
    expect(m.stocks[0]!.newsFlag).toBe(0);
    m = tickStockCountdowns(m);
    expect(m.stocks[0]!.newsFlag).toBe(0);
  });

  it('★★ 全股市休市计数：`[0x4990dc]` 递减 + 「先置 0x80 再清」（新聞 26）', () => {
    // @source rich4_player_core_actions.asm:4763-4778，就在那 12 支股票循环之前
    expect(tickMarketClosure(0)).toBe(0); // 0 → 不动
    expect(tickMarketClosure(3)).toBe(2); // 逐日递减
    expect(tickMarketClosure(1)).toBe(0x80); // ★ 减到 0 → 置待清位
    expect(tickMarketClosure(0x80)).toBe(0); // 下一次才清 0
    expect(tickMarketClosure(0x81)).toBe(0); // 带高位的任何值都直接清
  });

  it('★ `tickStockCountdowns` 会把休市计数一起推进（同一条日期推进循环）', () => {
    const m = tickStockCountdowns({ ...market([stock()]), closedDays: 10 });
    expect(m.closedDays).toBe(9);
    // 一支股票都没有时也照推进
    expect(tickStockCountdowns({ ...market([]), closedDays: 1 }).closedDays).toBe(0x80);
  });

  it('★ 利多期内趋势为 +10，到期后回归随机', () => {
    const rng = new WatcomRng(55);
    let m = market([stock({ newsFlag: 0x02, volatility: 1 })]);
    // 还剩 2 天利空
    m = tickStockMarket(m, rng);
    expect(m.stocks[0]!.trend).toBe(-10);
    m = tickStockCountdowns(m);
    m = tickStockMarket(m, rng);
    expect(m.stocks[0]!.trend).toBe(-10);
    m = tickStockCountdowns(m);
    expect(m.stocks[0]!.newsFlag).toBe(0);
    m = tickStockMarket(m, rng);
    expect(m.stocks[0]!.trend).not.toBe(-10);
  });

  it('停牌天数同样每日减一', () => {
    const m = tickStockCountdowns(market([stock({ f6: 3 })]));
    expect(m.stocks[0]!.f6).toBe(2);
  });
});

describe('流通量扰动', () => {
  it('★ 不超过 1000 股的原样照抄', () => {
    const m = refreshTradableShares(market([stock({ shares: 1000, f10: 0 })]), new WatcomRng(1));
    expect(m.stocks[0]!.f10).toBe(1000);
  });

  it('★ 超过 1000 股的取 10%~30%', () => {
    const rng = new WatcomRng(20260913);
    let m = market([stock({ shares: 10_000 })]);
    for (let i = 0; i < 500; i++) {
      m = refreshTradableShares(m, rng);
      expect(m.stocks[0]!.f10).toBeGreaterThanOrEqual(1000);
      expect(m.stocks[0]!.f10).toBeLessThanOrEqual(3000);
    }
  });

  it('是整数', () => {
    const m = refreshTradableShares(market([stock({ shares: 5137 })]), new WatcomRng(77));
    expect(Number.isInteger(m.stocks[0]!.f10)).toBe(true);
  });
});

describe('股票与地图企业的绑定', () => {
  it('★ 表里的 hasCommercial 会被改写成 1 基企业序号', () => {
    // @source _rich4_init_stock_commercial VA 0x00428cb1
    const stocks = [
      stock({ commercialIndex: 1 }), // 该股有企业
      stock({ commercialIndex: 0 }), // 没有
      stock({ commercialIndex: 1 }), // 有，但地图上找不到对应企业
    ];
    bindCommercials(stocks, [
      { id: 7, stockIndex: 0 },
      { id: 9, stockIndex: 5 },
    ]);
    expect(stocks[0]!.commercialIndex).toBe(7);
    expect(stocks[1]!.commercialIndex).toBe(0);
    // 找不到对应企业的要清零，否则会拿 1 当企业序号去查
    expect(stocks[2]!.commercialIndex).toBe(0);
  });

  it('标了 0 的股票不参与绑定', () => {
    const stocks = [stock({ commercialIndex: 0 })];
    bindCommercials(stocks, [{ id: 3, stockIndex: 0 }]);
    expect(stocks[0]!.commercialIndex).toBe(0);
  });

  it('★ 不给企业表时各股都按「无企业」处理', () => {
    const m = newStockMarket(0);
    // 数值表里 hasCommercial 为 1 的股票此时仍是 1 —— 那是未绑定的原值
    expect(m.stocks.every((s) => s.commercialIndex === 0 || s.commercialIndex === 1)).toBe(true);
  });
});
