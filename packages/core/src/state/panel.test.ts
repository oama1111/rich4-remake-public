/*
 * 右側欄四页的数值
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一层先前完全没有：面板永远画「資金」那一页，而且三行里的第三行
 * 是个**自己拼的近似**（现金+存款+地价），既少算设施、股票，也没减贷款。
 * 现在四页都按 exe 的四个页处理函数算，故补上断言。
 */
import { describe, expect, it } from 'vitest';
import { PANEL_PAGE_COUNT, panelValues } from './panel.ts';
import { makeFacility, makeGameState, makeLand } from '../testing/factories.ts';
import type { MapTopology } from './reduce.ts';

function topoWith(lands: ReturnType<typeof makeLand>[], facilities: ReturnType<typeof makeFacility>[]): MapTopology {
  return { nodes: [], lands, facilities, commercials: [] };
}

// 地块 1：我拥有、等级 0（空地）；地块 2：我拥有、等级 2（有房）
const L1 = makeLand({ id: 1, owner: 0, level: 0, landPrice: 1000, housePrice: 200 });
const L2 = makeLand({ id: 2, owner: 0, level: 2, landPrice: 1000, housePrice: 200 });
// 设施 1：我拥有、等级 1
const F1 = makeFacility({ id: 1, owner: 0, level: 1, landPrice: 500, housePrice: 100 });

describe('panelValues —— 四页数值', () => {
  it('★ 資金页：現金 / 存款 / 總資產（總資產用 core 的 calculatePlayerWealth）', () => {
    const state = makeGameState({
      players: makeGameState().players.map((p, i) =>
        i === 0 ? { ...p, cash: 10000, moneyInBank: 5000, loan: 3000 } : p,
      ),
    });
    const v = panelValues(state, topoWith([], []), 0);
    expect(v.funds[0]).toBe(10000);
    expect(v.funds[1]).toBe(5000);
    // 现金+存款−贷款 = 12000
    expect(v.funds[2]).toBe(12000);
  });

  it('★ 資金页第三行**减贷款、且算设施** —— 旧的内联近似两样都错', () => {
    const base = makeGameState();
    const state = makeGameState({
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, cash: 0, moneyInBank: 0, loan: 700 } : p,
      ),
      landOwner: [0, 1, 0],
      landLevel: [0, 0, 0],
      facilityOwner: [0, 1],
      facilityLevel: [0, 1],
    });
    const topo = topoWith([L1], [F1]);
    // 地块1：等级0 → 只算地价 1000；设施1：等级1 → 1×100 + 500 = 600
    // 合计 1600 − 贷款 700 = 900
    expect(panelValues(state, topo, 0).funds[2]).toBe(900);
  });

  it('★ 地產页：土地 / 連鎖店 / 設施 —— 土地把设施也算进去（原版共用一个累加器）', () => {
    const state = makeGameState({
      landOwner: [0, 1, 1],
      landLevel: [0, 0, 2],
      facilityOwner: [0, 1],
      facilityLevel: [0, 1],
    });
    const v = panelValues(state, topoWith([L1, L2], [F1]), 0);
    // 土地 = 2 块地 + 1 个设施 = 3（@source VA 0x00416355 的 `[esp+0xac]`）
    expect(v.estate[0]).toBe(3);
    // 連鎖店 = 有房的地块数（等级≠0）= 1
    expect(v.estate[1]).toBe(1);
    // 設施 = 等级≠0 的设施数 = 1
    expect(v.estate[2]).toBe(1);
  });

  it('别人的地/设施不算我的', () => {
    const state = makeGameState({
      landOwner: [0, 2, 2],
      facilityOwner: [0, 3],
    });
    const v = panelValues(state, topoWith([L1, L2], [F1]), 0);
    expect(v.estate).toEqual([0, 0, 0]);
  });

  it('★ 股票页：總市值用实时价、成本用均价（两者来源不同，不许混用）', () => {
    const base = makeGameState();
    const holdings = base.holdings.map((row, i) =>
      i === 0 ? row.map((h, s) => (s === 3 ? { amount: 10, avgCost: 4 } : h)) : row,
    );
    const state = makeGameState({ holdings });
    state.market.stocks[3]!.price = 7;
    const v = panelValues(state, topoWith([], []), 0);
    expect(v.stocks[0]).toBe(70); // 10 × 7
    expect(v.stocks[1]).toBe(40); // 10 × 4
    expect(v.stocks[2]).toBe(0); // 无經營權
  });

  it('★ 股票页第三行 = 自己是所有人的企業数', () => {
    const state = makeGameState({
      commercialOwners: [
        { owner: 1, ranking: [1, 0, 0, 0] },
        { owner: 2, ranking: [2, 0, 0, 0] },
        { owner: 1, ranking: [1, 0, 0, 0] },
      ],
    });
    // 玩家下标 0 → owner 记的是「下标+1」= 1
    expect(panelValues(state, topoWith([], []), 0).stocks[2]).toBe(2);
    expect(panelValues(state, topoWith([], []), 1).stocks[2]).toBe(1);
  });

  it('★ 其他页：點卷 / 貸款 / 保險期（天）', () => {
    const base = makeGameState();
    const state = makeGameState({
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, points: 12, loan: 8000, insuranceDays: 3 } : p,
      ),
    });
    const v = panelValues(state, topoWith([], []), 0);
    expect(v.misc).toEqual([12, 8000, 3]);
  });

  it('四页一次全给，且页数常量是 4', () => {
    expect(PANEL_PAGE_COUNT).toBe(4);
    const v = panelValues(makeGameState(), topoWith([], []), 0);
    expect(Object.keys(v).sort()).toEqual(['estate', 'funds', 'misc', 'stocks']);
    for (const rows of Object.values(v)) expect(rows).toHaveLength(3);
  });

  it('玩家下标越界不抛，给全 0', () => {
    const v = panelValues(makeGameState(), topoWith([], []), 9);
    expect(v.funds).toEqual([0, 0, 0]);
    expect(v.estate).toEqual([0, 0, 0]);
  });
});
