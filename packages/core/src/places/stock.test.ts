/*
 * 股票交易验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  buyStock, sellStock, recalcAvgCost, commercialUnitPrice,
  COMMERCIAL_PRICE_DIVISOR, EMPTY_HOLDING,
} from './stock.ts';
import type { StockHolding, StockState } from './stock.ts';
import type { Player } from '../state/types.ts';
import { calculatePlayerWealth } from '../rules/wealth.ts';
import { STOCKS, stocksOfMap } from '@rich4/data';
import { makePlayer as basePlayer } from '../testing/factories.ts';

/** 本文件显式声明默认资金（10万/10万），避免依赖共用工厂的默认值 */
const makePlayer = (over: Partial<Player> = {}): Player =>
  basePlayer({ cash: 100_000, moneyInBank: 100_000, ...over });

const stock = (over: Partial<StockState> = {}): StockState =>
  ({ price: 100, shares: 10_000, f10: 10_000, commercialIndex: 0, f6: 0, newsFlag: 0, basePrice: 100, openPrice: 100, volatility: 1, trend: 0, shock: 0, ...over });

describe('股票数值表（来自 exe 二进制）', () => {
  it('96 支 = 8 图 × 12', () => {
    expect(STOCKS.length).toBe(96);
    for (let m = 0; m < 8; m++) expect(stocksOfMap(m).length).toBe(12);
  });

  it('地图0 首支为中國信託，价 100，波动 1.0', () => {
    const s = stocksOfMap(0)[0]!;
    expect(s.name).toBe('中國信託');
    expect(s.price).toBe(100);
    expect(s.volatility).toBe(1);
    expect(s.shares).toBe(10_000);
  });

  it('波动系数落在 0.4 ~ 2.0', () => {
    for (const s of STOCKS) {
      expect(s.volatility).toBeGreaterThanOrEqual(0.4);
      expect(s.volatility).toBeLessThanOrEqual(2.0);
    }
  });

  it('各图主题不同（地图7 为饭店主题）', () => {
    const m7 = stocksOfMap(7).map((s) => s.name);
    expect(m7.filter((n) => n.includes('飯店')).length).toBeGreaterThan(2);
  });
});

describe('买入', () => {
  it('★ 股市买入从存款扣款', () => {
    const r = buyStock(makePlayer(), EMPTY_HOLDING, stock(), 100, 'market');
    expect(r.amount).toBe(10_000);           // 100 股 × 100 元
    expect(r.player.moneyInBank).toBe(90_000);
    expect(r.player.cash).toBe(100_000);      // 现金不动
    expect(r.holding.amount).toBe(100);
  });

  it('★ 地图企业买入从现金扣款', () => {
    const unit = commercialUnitPrice(500_000); // 500000 / 10000 = 50
    expect(unit).toBe(50);
    const r = buyStock(makePlayer(), EMPTY_HOLDING, stock(), 100, 'commercial', unit);
    expect(r.amount).toBe(5_000);
    expect(r.player.cash).toBe(95_000);
    expect(r.player.moneyInBank).toBe(100_000); // 存款不动
  });

  it('企业单价为整数除法（向零取整）', () => {
    expect(COMMERCIAL_PRICE_DIVISOR).toBe(10_000);
    expect(commercialUnitPrice(59_999)).toBe(5);
  });

  it('买入使可流通股数减少', () => {
    const r = buyStock(makePlayer(), EMPTY_HOLDING, stock(), 300, 'market');
    expect(r.stock.shares).toBe(9_700);
    expect(r.stock.f10).toBe(9_700);
  });

  it('价格为小数时成交额向零取整', () => {
    const r = buyStock(makePlayer(), EMPTY_HOLDING, stock({ price: 33.7 }), 3, 'market');
    expect(r.amount).toBe(101); // trunc(3 × 33.7) = trunc(101.1)
  });

  it('非正股数无变化', () => {
    const p = makePlayer();
    expect(buyStock(p, EMPTY_HOLDING, stock(), 0, 'market').amount).toBe(0);
  });
});

describe('持仓成本均价', () => {
  it('首次买入即为买入价', () => {
    const h = recalcAvgCost(EMPTY_HOLDING, 100, 10_000);
    expect(h.amount).toBe(100);
    expect(h.avgCost).toBe(100);
  });

  it('★ 二次买入按加权重算', () => {
    const first = recalcAvgCost(EMPTY_HOLDING, 100, 10_000); // 均价 100
    const second = recalcAvgCost(first, 100, 30_000);        // 再买 100 股花 30000
    expect(second.amount).toBe(200);
    expect(second.avgCost).toBe(200);                         // (10000+30000)/200
  });

  it('旧总成本先取整再参与加法（原版 fistp 行为）', () => {
    // 3 股均价 0.5 → oldTotal = trunc(1.5) = 1，而非 1.5
    const prev: StockHolding = { amount: 3, avgCost: 0.5 };
    const next = recalcAvgCost(prev, 1, 0);
    expect(next.avgCost).toBe(1 / 4); // (1 + 0) / 4
  });

  it('通过实际买入路径验证均价', () => {
    let r = buyStock(makePlayer(), EMPTY_HOLDING, stock({ price: 100 }), 50, 'market');
    r = buyStock(r.player, r.holding, { ...r.stock, price: 200 }, 50, 'market');
    expect(r.holding.amount).toBe(100);
    expect(r.holding.avgCost).toBe(150); // (5000 + 10000) / 100
  });
});

describe('卖出', () => {
  const held: StockHolding = { amount: 200, avgCost: 80 };

  it('按市价卖出，所得进存款', () => {
    const r = sellStock(makePlayer(), held, stock({ price: 120 }), 100);
    expect(r.amount).toBe(12_000);
    expect(r.player.moneyInBank).toBe(112_000);
    expect(r.holding.amount).toBe(100);
  });

  it('卖出使可流通股数增加', () => {
    const r = sellStock(makePlayer(), held, stock(), 100);
    expect(r.stock.shares).toBe(10_100);
    expect(r.stock.f10).toBe(10_100);
  });

  it('★ 清仓时成本均价归零', () => {
    const r = sellStock(makePlayer(), held, stock(), 200);
    expect(r.holding.amount).toBe(0);
    expect(r.holding.avgCost).toBe(0);
  });

  it('未清仓时成本均价保留', () => {
    const r = sellStock(makePlayer(), held, stock(), 50);
    expect(r.holding.avgCost).toBe(80);
  });

  it('卖出量被持仓截断', () => {
    const r = sellStock(makePlayer(), held, stock({ price: 10 }), 9999);
    expect(r.holding.amount).toBe(0);
    expect(r.amount).toBe(2_000); // 只卖了 200 股
  });

  it('★ 破产清算路径：所得进全局池而非玩家存款', () => {
    const r = sellStock(makePlayer(), held, stock(), 100, 'pool');
    expect(r.amount).toBe(10_000);
    expect(r.player.moneyInBank).toBe(100_000); // 玩家存款不变
  });

  it('空仓卖出无变化', () => {
    const p = makePlayer();
    expect(sellStock(p, EMPTY_HOLDING, stock(), 10).amount).toBe(0);
  });
});

describe('与总资产计算的衔接', () => {
  it('★ 持股按**市价**计入总资产，而非成本均价', () => {
    // 成本 100 买入，市价涨到 300
    const bought = buyStock(makePlayer({ cash: 0, moneyInBank: 100_000 }), EMPTY_HOLDING, stock({ price: 100 }), 100, 'market');
    expect(bought.holding.avgCost).toBe(100);
    const w = calculatePlayerWealth(bought.player, [], [], [{ amount: 100, price: 300 }]);
    // 存款 90000 + 100 股 × 市价 300
    expect(w).toBe(90_000 + 30_000);
  });
});

describe('★ 两种买入的差别（先前把它们混成了一段）', () => {
  it('★ 柜台买入减流通量，企业买入不减', () => {
    const s0 = stock({ shares: 10_000, f10: 10_000 });
    const market = buyStock(makePlayer({ moneyInBank: 999_999 }), EMPTY_HOLDING, s0, 100, 'market');
    expect(market.stock.shares).toBe(9_900);
    expect(market.stock.f10).toBe(9_900);

    // ⚠️ loc_00428d7f 里没有那两条 `sub word`，企业买入**不动流通量**
    const com = buyStock(makePlayer({ cash: 999_999 }), EMPTY_HOLDING, s0, 100, 'commercial', 40);
    expect(com.stock.shares).toBe(10_000);
    expect(com.stock.f10).toBe(10_000);
  });

  it('★ 企业买入要从企业的剩余股数里扣', () => {
    // @source sub dword [commercial + 0x30], esi
    const com = buyStock(makePlayer({ cash: 999_999 }), EMPTY_HOLDING, stock(), 250, 'commercial', 40);
    expect(com.commercialSharesTaken).toBe(250);
    expect(com.amount).toBe(250 * 40);

    const market = buyStock(makePlayer({ moneyInBank: 999_999 }), EMPTY_HOLDING, stock(), 250, 'market');
    expect(market.commercialSharesTaken).toBe(0);
  });

  it('★ 单价来自企业资产额 ÷ 10000，与股价无关', () => {
    const s = stock({ price: 999 }); // 股价再高也不影响企业买入
    const r = buyStock(makePlayer({ cash: 999_999 }), EMPTY_HOLDING, s, 10, 'commercial', commercialUnitPrice(400_000));
    expect(commercialUnitPrice(400_000)).toBe(40);
    expect(r.amount).toBe(10 * 40);
  });
});
