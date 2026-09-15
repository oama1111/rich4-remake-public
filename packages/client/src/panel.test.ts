/*
 * 右側欄四页的**排版**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 同一页里三行的格式可能不同（原版各行用的是不同的格式化函数）——
 * 这一层最容易「看起来都对」：地產页要是把个数印成 $0、或者其他页把天数
 * 印成货币，画面上都不报错，只是与原版不符。故逐页断言。
 */
import { describe, expect, it } from 'vitest';
import { currency, panelRows } from './panel.ts';
import type { GameState, LandInfo, MapTopology } from '@rich4/core';

const emptyTopo: MapTopology = { nodes: [], lands: [], facilities: [], commercials: [] };

/**
 * 最小 GameState —— 只放 `panelRows` 真正读到的字段。
 * （core 的测试工厂没有对外导出，而这里正是要钉住「它到底读了哪些字段」。）
 */
function mkState(over: Partial<GameState> = {}): GameState {
  const player = (i: number) =>
    ({ index: i, cash: 0, moneyInBank: 0, loan: 0, points: 0, insuranceDays: 0 }) as never;
  return {
    players: [0, 1, 2, 3].map(player),
    holdings: [0, 1, 2, 3].map(() => Array.from({ length: 12 }, () => ({ amount: 0, avgCost: 0 }))),
    market: { stocks: Array.from({ length: 12 }, () => ({ price: 0 })) },
    commercialOwners: [],
    landOwner: [],
    landLevel: [],
    landType: [],
    facilityOwner: [],
    facilityLevel: [],
    facilityType: [],
    ...over,
  } as unknown as GameState;
}

/** 造一个四页各有特征值的局面 */
function fixture() {
  const state = mkState({
    players: [
      { index: 0, cash: 12345, moneyInBank: 6789, loan: 4321, points: 7, insuranceDays: 3 },
      { index: 1, cash: 0, moneyInBank: 0, loan: 0, points: 0, insuranceDays: 0 },
      { index: 2, cash: 0, moneyInBank: 0, loan: 0, points: 0, insuranceDays: 0 },
      { index: 3, cash: 0, moneyInBank: 0, loan: 0, points: 0, insuranceDays: 0 },
    ] as never,
    holdings: [0, 1, 2, 3].map((i) =>
      Array.from({ length: 12 }, (_, s) =>
        i === 0 && s === 0 ? { amount: 100, avgCost: 12 } : { amount: 0, avgCost: 0 },
      ),
    ),
    commercialOwners: [{ owner: 1, ranking: [1, 0, 0, 0] }] as never,
  });
  (state.market.stocks[0] as { price: number }).price = 15;
  return { state, topo: emptyTopo };
}

/** 一块有主的地 */
const ownedLand = (id: number, level: number): LandInfo =>
  ({
    id, x: 0, y: 0, name: '', priceStatus: 0, type: 0, owner: 1, level,
    facing: 0, landPrice: 100, housePrice: 10, rentByLevel: [0, 0, 0, 0, 0, 0], flast: 0,
  }) as unknown as LandInfo;

describe('panelRows —— 每页的格式', () => {
  it('★ 資金页三行都是货币', () => {
    const { state, topo: t } = fixture();
    const rows = panelRows(state, t, 0, 0);
    expect(rows[0]).toBe('$12,345');
    expect(rows[1]).toBe('$6,789');
    expect(rows[2]?.startsWith('$')).toBe(true); // 總資產
  });

  it('★ 地產页三行都是**个数**，不是货币', () => {
    const { state } = fixture();
    const s2 = mkState({
      ...state,
      landOwner: [0, 1, 1],
      landType: [0, 3, 0], // ★ 連鎖店的判据是 type（+0x18），不是 level
    });
    const rows = panelRows(s2, { ...emptyTopo, lands: [ownedLand(1, 3), ownedLand(2, 0)] }, 0, 1);
    expect(rows).toEqual(['2', '1', '0']); // 土地(2) / 連鎖店(type≠0 的 1 块) / 設施(0)
    for (const r of rows) expect(r.startsWith('$')).toBe(false);
  });

  it('★ 股票页：前两行货币、第三行个数（原版第三行走 itoa）', () => {
    const { state, topo: t } = fixture();
    const rows = panelRows(state, t, 0, 2);
    expect(rows[0]).toBe('$1,500'); // 100 × 15
    expect(rows[1]).toBe('$1,200'); // 100 × 12
    expect(rows[2]).toBe('1'); // 經營權
    expect(rows[2]?.startsWith('$')).toBe(false);
  });

  it('★ 其他页：點卷是个数、貸款是货币、保險期带「天」', () => {
    const { state, topo: t } = fixture();
    const rows = panelRows(state, t, 0, 3);
    expect(rows[0]).toBe('7');
    expect(rows[1]).toBe('$4,321');
    expect(rows[2]).toBe('3天');
  });

  it('页号回绕：−1 → 3、4 → 0（原版 `(页 ∓ 1) & 3`）', () => {
    const { state, topo: t } = fixture();
    expect(panelRows(state, t, 0, -1)).toEqual(panelRows(state, t, 0, 3));
    expect(panelRows(state, t, 0, 4)).toEqual(panelRows(state, t, 0, 0));
  });

  it('currency 与原版一致：带千分位的 $ 前缀', () => {
    expect(currency(0)).toBe('$0');
    expect(currency(1000)).toBe('$1,000');
    expect(currency(1234567)).toBe('$1,234,567');
  });
});
