/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 出牌接入 reduce
 *
 * ★ 卡片效果本身在 cards/ 下各自有测试，这里只验**接驳**：
 *   状态进得去、结果合得回来、失败时原样不动。
 */

import { describe, expect, it } from 'vitest';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { IMPLEMENTED_CARD_IDS } from '../cards/registry.ts';
import { HOUSING_TYPE_MIN } from '../rules/land.ts';

/** 一块住宅地 + 站在上面的四个玩家 */
function scene(over: Partial<GameState> = {}): {
  state: GameState;
  topo: { nodes: ReturnType<typeof makeNode>[]; lands: ReturnType<typeof makeLand>[] };
} {
  const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
  const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
  const state = makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000 }),
    ),
    landOwner: [0, 0],
    landLevel: [0, 0],
    ...over,
  });
  return { state, topo: { nodes: [node], lands: [land] } };
}

const give = (s: GameState, who: number, cardId: number): GameState => ({
  ...s,
  players: s.players.map((p, i) => (i === who ? { ...p, cards: [cardId] } : p)),
});

describe('★ 出牌入口', () => {
  it('★ 均富卡（1）把现金拉平 —— 效果真的落到状态上了', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 1);
    s = {
      ...s,
      players: s.players.map((p, i) => ({ ...p, cash: [100_000, 0, 0, 0][i]! })),
    };
    const after = reduce(s, { type: 'useCard', cardId: 1 }, topo);
    const cash = after.players.map((p) => p.cash);
    expect(new Set(cash).size, `现金应当被拉平，实际 ${cash.join('/')}`).toBe(1);
    // 卡被消耗
    expect(after.players[0]!.cards).toHaveLength(0);
  });

  it('★ 手上没有这张卡就什么都不发生', () => {
    const { state, topo } = scene();
    expect(reduce(state, { type: 'useCard', cardId: 1 }, topo)).toBe(state);
  });

  it('★ 被动卡不能主动打 —— 原版函数体就是 xor eax,eax; ret', () => {
    const { state, topo } = scene();
    // 21 免罪卡是被动卡
    const s = give(state, 0, 21);
    expect(reduce(s, { type: 'useCard', cardId: 21 }, topo)).toBe(s);
  });

  it('★ 出局者不能出牌', () => {
    const { state, topo } = scene();
    const s = {
      ...give(state, 0, 1),
      players: give(state, 0, 1).players.map((p, i) =>
        i === 0 ? { ...p, whoPlays: 0 } : p,
      ),
    };
    expect(reduce(s, { type: 'useCard', cardId: 1 }, topo)).toBe(s);
  });

  it('★ 購地卡（3）改的是 landOwner，不是地图静态表', () => {
    // 購地卡是从**别人手里**买下自己所站的地，故先让玩家 1 持有
    const { state, topo } = scene({ landOwner: [0, 2] });
    const s = give(state, 0, 3);
    const after = reduce(s, { type: 'useCard', cardId: 3 }, topo);
    expect(after.landOwner[1]).toBe(1); // 玩家 0 → 编码 1
    // 地图静态表没被改动
    expect(topo.lands[0]!.owner).toBe(0);
  });

  it('★ 停留卡（14）给目标挂上停留天数', () => {
    const { state, topo } = scene();
    const s = give(state, 0, 14);
    const after = reduce(s, { type: 'useCard', cardId: 14, target: { kind: 'player', index: 2 } }, topo);
    expect(after.players[2]!.blocking.stopping).toBeGreaterThan(0);
  });

  it('★ 19 张已实现的卡都能走到这个入口而不抛错', () => {
    for (const id of IMPLEMENTED_CARD_IDS) {
      const { state, topo } = scene();
      const s = give(state, 0, id);
      // 目标给一个合法的：多数卡要么不需要，要么接受玩家 1 或地块 1
      for (const target of [
        { kind: 'none' } as const,
        { kind: 'player', index: 1 } as const,
        { kind: 'entity', entityId: 1 } as const,
      ]) {
        expect(() => reduce(s, { type: 'useCard', cardId: id, target }, topo)).not.toThrow();
      }
    }
  });

  it('★ 未实现的卡安静地什么都不做，不抛错也不扣卡', () => {
    const { state, topo } = scene();
    // 30 张卡已全部接线，改用未登记的卡号验证同一条「安静失败」路径
    expect(IMPLEMENTED_CARD_IDS).not.toContain(99);
    const s = give(state, 0, 99);
    expect(reduce(s, { type: 'useCard', cardId: 99 }, topo)).toBe(s);
  });
});

describe('★ T-008：設施目标经 reduce 端到端落回 GameState', () => {
  // 一处 3 级旅館（玩家 2 持有）+ 站在別处的出牌者
  function facScene(facOver: Parameters<typeof makeFacility>[0] = {}, stateOver: Partial<GameState> = {}) {
    const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
    const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
    const fac = makeFacility({ id: 1, type: 1, level: 3, owner: 2, ...facOver });
    const state = makeGameState({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000 }),
      ),
      facilityType: [0, fac.type],
      facilityLevel: [0, fac.level],
      facilityOwner: [0, fac.owner],
      ...stateOver,
    });
    return { state, topo: { nodes: [node], lands: [land], facilities: [fac] } };
  }

  it('惡魔卡（10）：facilityLevel/facilityType 真的落回 GameState，敌意也落上', () => {
    const { state, topo } = facScene();
    const s = give(state, 0, 10);
    const after = reduce(s, { type: 'useCard', cardId: 10, target: { kind: 'facility', facilityId: 1 } }, topo);
    expect(after.facilityLevel[1]).toBe(0);
    expect(after.facilityType[1]).toBe(0);
    expect(after.facilityOwner[1]).toBe(2); // 归属保留
    // 敌意 = 3 × 30 × 物价指数1，记在玩家 1 → 玩家 0
    expect(after.players[1]!.hostility[0]).toBeGreaterThan(0);
    expect(after.players[0]!.cards).toHaveLength(0);
  });

  it('天使卡（9）：0 级空地首建，buildType 落进 facilityType', () => {
    const { state, topo } = facScene({ type: 0, level: 0, owner: 0 });
    const s = give(state, 0, 9);
    const after = reduce(s, { type: 'useCard', cardId: 9, target: { kind: 'facility', facilityId: 1, buildType: 4 } }, topo);
    expect(after.facilityType[1]).toBe(4);
    expect(after.facilityLevel[1]).toBe(1);
  });

  it('漲價卡（27）：設施 priceStatus 经 reduce 持久化（不再是地图静态值）', () => {
    const { state, topo } = facScene();
    const s = give(state, 0, 27);
    const after = reduce(s, { type: 'useCard', cardId: 27, target: { kind: 'facility', facilityId: 1 } }, topo);
    expect(after.facilityPriceStatus[1]).toBe(0x50);
  });

  it('漲價卡（27）对地块：landPriceStatus 经 reduce 持久化', () => {
    const { state, topo } = facScene();
    const s = give(state, 0, 27);
    const after = reduce(s, { type: 'useCard', cardId: 27, target: { kind: 'entity', entityId: 1 } }, topo);
    expect(after.landPriceStatus[1]).toBe(0x50);
  });

  it('★ 查封卡（28）封到研究所：facilityResearchDays 被清零', () => {
    const { state, topo } = facScene({ type: 4, level: 2 }, {
      facilityResearchDays: [0, 7],
    });
    const s = give(state, 0, 28);
    const after = reduce(s, { type: 'useCard', cardId: 28, target: { kind: 'facility', facilityId: 1 } }, topo);
    expect(after.facilityPriceStatus[1]).toBe(0x51);
    expect(after.facilityResearchDays[1]).toBe(0);
  });
});
