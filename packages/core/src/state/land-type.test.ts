/*
 * 地块种类是**会变的状态**，不是地图静态数据
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这个测试钉住的是一个真被漏掉过的 bug：改建卡把住宅与連鎖店对调
 * （`type ^ 1`），但 reduce 只把 `owner` 与 `level` 落回状态，`type`
 * 改完就丢。表现是「卡用了、看着生效、下一次读地块又变回去」。
 */
import { describe, expect, it } from 'vitest';
import { reduce, effectiveLand, type MapTopology } from './reduce.ts';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';

/** 一块住宅地，节点 1 就是它 */
function scene(): { state: ReturnType<typeof makeGameState>; topo: MapTopology } {
  const land = makeLand({ id: 1, type: LAND_TYPE_HOUSE, landPrice: 100, housePrice: 50 });
  const topo: MapTopology = {
    nodes: [
      // 节点 type 落在 0x7d0..0xfa0 之间才算住宅地（housingIndexOf）
      makeNode({ id: 1, type: 0x7d1, ref: { kind: 'land', index: 1 }, adjacent: [2], adjacentSlots: [2, 0, 0, 0] }),
      makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0] }),
    ],
    lands: [land],
  };
  const state = makeGameState({
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1 })),
    landOwner: [0, 1],
    landLevel: [0, 2],
    landType: [0, LAND_TYPE_HOUSE],
    phase: 'awaitingRoll',
  });
  return { state, topo };
}

describe('landType 进状态', () => {
  it('effectiveLand 读的是状态里的 type，不是地图里的', () => {
    const { state, topo } = scene();
    expect(effectiveLand(state, topo, 1)?.type).toBe(LAND_TYPE_HOUSE);
    const flipped = { ...state, landType: [0, LAND_TYPE_HOUSE ^ 1] };
    expect(effectiveLand(flipped, topo, 1)?.type).toBe(LAND_TYPE_HOUSE ^ 1);
  });

  it('★ 改建卡改的 type 真的留在状态里了', () => {
    const { state, topo } = scene();
    const me = state.players[0]!;
    const withCard = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, cards: [...me.cards, 7] } : p)),
    };
    const after = reduce(withCard, { type: 'useCard', cardId: 7 }, topo);
    // 住宅 ↔ 連鎖店 对调（@source `xor ah, 1`）
    expect(after.landType[1]).toBe(LAND_TYPE_HOUSE ^ 1);
    expect(effectiveLand(after, topo, 1)?.type).toBe(LAND_TYPE_HOUSE ^ 1);
  });
});
