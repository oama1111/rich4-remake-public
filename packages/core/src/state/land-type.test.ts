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
import { readFileSync, existsSync } from 'node:fs';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
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

describe('landPrice 进状态（新聞 6/14 的地价改动要落得住）', () => {
  it('effectiveLand 读的是状态里的 landPrice，不是地图里的', () => {
    const { state, topo } = scene();
    expect(effectiveLand(state, topo, 1)?.landPrice).toBe(100); // 地图初值
    const raised = { ...state, landPrice: [0, 130] };
    expect(effectiveLand(raised, topo, 1)?.landPrice).toBe(130);
    // ★ 少了这一格，新聞 6「公告地價調漲３０％」就会「看着生效、下一次又变回去」
  });

  it('newGame 把**地图地价**抄进状态（真地图）', () => {
    const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
    if (!existsSync(MAP)) return; // 没解包素材就跳过（与其它真地图测试同规矩）
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const g = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 1,
    });
    expect(g.landPrice).toHaveLength(map.lands.reduce((m, l) => Math.max(m, l.id), 0) + 1);
    for (const l of map.lands.slice(0, 8)) {
      expect(g.landPrice[l.id], `land ${l.id}`).toBe(l.landPrice);
    }
    // 每处設施也一样
    for (const f of map.facilities.slice(0, 4)) {
      expect(g.facilityPrice[f.id], `facility ${f.id}`).toBe(f.landPrice);
    }
  });
});
