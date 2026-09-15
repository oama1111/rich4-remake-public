/*
 * 换地卡 / 红卡 / 黑卡验证 —— 基准为原版 exe 反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applySwapLandCard, applySwapFacilityCard, applyRedCard, applyBlackCard,
  RED_CARD_NEWS_FLAG, BLACK_CARD_NEWS_FLAG,
  SWAP_LAND_SELECTION_PARAM, SWAP_LAND_FACILITY_SELECTION_PARAM,
} from './swap-and-stock.ts';
import type { StockState } from '../places/stock.ts';
import { makeFacility, makeLand } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';
import { STOCK_COUNT } from '../rules/wealth.ts';

/** 最小可用的股票状态（字段默认值与 newStockMarket 的铺开方式一致） */
const makeStock = (over: Partial<StockState> = {}): StockState => ({
  price: 100, shares: 10_000, f10: 10_000, commercialIndex: 0, f6: 0,
  newsFlag: 0, basePrice: 100, openPrice: 100, volatility: 1, trend: 0, shock: 0,
  ...over,
});

describe('换地卡', () => {
  const two = () => [
    makeLand({ id: 1, owner: 1, level: 3, name: 'A' }),
    makeLand({ id: 2, owner: 2, level: 0, name: 'B' }),
  ];

  it('选择参数属地块组', () => {
    expect(cardImpl(4)!.selectionParam).toBe(SWAP_LAND_SELECTION_PARAM);
  });

  it('★ 交换两块地的归属', () => {
    const r = applySwapLandCard(two(), 1, 2);
    expect(r.ok).toBe(true);
    expect(r.lands[0]!.owner).toBe(2);
    expect(r.lands[1]!.owner).toBe(1);
  });

  it('★ 只换归属，等级与类型不动（房子随地一起易主）', () => {
    const r = applySwapLandCard(two(), 1, 2);
    expect(r.lands[0]!.level).toBe(3); // 原地块1 的等级留在原地
    expect(r.lands[1]!.level).toBe(0);
    expect(r.lands[0]!.name).toBe('A');
  });

  it('同一块地不可自换', () => {
    expect(applySwapLandCard(two(), 1, 1).ok).toBe(false);
  });

  it('地块不存在时失败', () => {
    expect(applySwapLandCard(two(), 1, 99).ok).toBe(false);
  });

  it('不原地修改入参', () => {
    const ls = two();
    applySwapLandCard(ls, 1, 2);
    expect(ls[0]!.owner).toBe(1);
  });
});

describe('换地卡 · 設施分支（脚下是設施时原版换 0xe0c0204）', () => {
  const twoFac = () => [
    makeFacility({ id: 1, owner: 1, level: 2, type: 1 }),
    makeFacility({ id: 2, owner: 3, level: 4, type: 2 }),
  ];

  it('★ 設施参数 0xe0c0204 存在且只认設施', () => {
    expect(SWAP_LAND_FACILITY_SELECTION_PARAM).toBe(0xe0c0204);
  });

  it('★ 交换两座設施的归属（+0x19）', () => {
    // @source VA 0x00442a09
    const r = applySwapFacilityCard(twoFac(), 1, 2);
    expect(r.ok).toBe(true);
    expect(r.facilities[0]!.owner).toBe(3);
    expect(r.facilities[1]!.owner).toBe(1);
  });

  it('★ 种类（+0x18）与等级（+0x1a）原地不动', () => {
    const r = applySwapFacilityCard(twoFac(), 1, 2);
    expect(r.facilities[0]).toMatchObject({ type: 1, level: 2 });
    expect(r.facilities[1]).toMatchObject({ type: 2, level: 4 });
  });

  it('同一座設施不可自换；不存在时失败', () => {
    expect(applySwapFacilityCard(twoFac(), 1, 1).ok).toBe(false);
    expect(applySwapFacilityCard(twoFac(), 1, 99).ok).toBe(false);
  });

  it('不原地修改入参', () => {
    const fs = twoFac();
    applySwapFacilityCard(fs, 1, 2);
    expect(fs[0]!.owner).toBe(1);
  });
});

describe('红卡 / 黑卡 —— 写 newsFlag（利多/利空天数）', () => {
  const stocks = () =>
    Array.from({ length: STOCK_COUNT }, () =>
      makeStock({ newsFlag: 0 }),
    );

  it('红卡写 0x20（利多 2 天），黑卡写 0x02（利空 2 天）', () => {
    expect(RED_CARD_NEWS_FLAG).toBe(0x20);
    expect(BLACK_CARD_NEWS_FLAG).toBe(0x02);
    expect(applyRedCard(stocks(), 3).stocks[3]!.newsFlag).toBe(0x20);
    expect(applyBlackCard(stocks(), 3).stocks[3]!.newsFlag).toBe(0x02);
  });

  it('只影响指定股票', () => {
    const r = applyRedCard(stocks(), 5);
    expect(r.stocks.filter((s) => s.newsFlag !== 0).length).toBe(1);
    expect(r.affected).toBe(5);
  });

  it('★ 整字节覆盖：红卡清掉残存利空，黑卡清掉残存利多', () => {
    const base = stocks().map((s, i) => (i === 2 ? { ...s, newsFlag: 0x05 } : s));
    expect(applyRedCard(base, 2).stocks[2]!.newsFlag).toBe(0x20);
    const base2 = stocks().map((s, i) => (i === 2 ? { ...s, newsFlag: 0x50 } : s));
    expect(applyBlackCard(base2, 2).stocks[2]!.newsFlag).toBe(0x02);
  });

  it('下标越界时不改动', () => {
    expect(applyRedCard(stocks(), 99).affected).toBe(-1);
    expect(applyBlackCard(stocks(), -1).affected).toBe(-1);
  });

  it('不原地修改入参', () => {
    const v = stocks();
    applyRedCard(v, 1);
    expect(v[1]!.newsFlag).toBe(0);
  });
});
