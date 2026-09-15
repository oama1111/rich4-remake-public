/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 公佈欄：四种市價、挂設施、AI 怎么用这块板
 */

import { describe, expect, it } from 'vitest';
import { TOOLS } from '@rich4/data';
import {
  AI_BOARD_LIST_CHANCE,
  AI_BOARD_REPRICE_CHANCE,
  AI_BOARD_SHOP_CHANCE,
  AI_CARD_LIST_MIN_HAND,
  AI_TOOL_LIST_MIN_COUNT,
  LISTING,
  aiWantsListedEstate,
  aiWantsListedStock,
  aiWantsToListTool,
  cardListPrice,
  duplicateCards,
  encodeEstate,
  estateListPrice,
  stockListPrice,
  toolListPrice,
} from './notice-board.ts';
import { makeFacility, makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { FACILITY_TYPE_MIN } from '../rules/land.ts';
import { emptyTools, giveTool, initialToolStock } from '../rules/tools.ts';
import { WHO_PLAYS_HUMAN, type GameState } from '../state/types.ts';

describe('★ 四种市價', () => {
  it('道具：標價 × 100 × 物價 —— 截图 S13 的路障 3,000 元', () => {
    expect(toolListPrice(2, 1)).toBe(3000);
    expect(toolListPrice(2, 3)).toBe(9000);
    expect(toolListPrice(13, 1)).toBe(25_000);
  });

  it('卡片同式（已有）', () => {
    expect(cardListPrice(1, 1)).toBe(20_000);
  });

  it('股票：trunc(股數 × 現價) @source 0x00425f1e 的 `call 0x457dbc`', () => {
    expect(stockListPrice(100, 12.5)).toBe(1250);
    // 31.5：0x457dbc 是 __round_toward_zero（向零截断）⇒ 31，不是 Math.round 的 32
    expect(stockListPrice(3, 10.5)).toBe(31);
    expect(stockListPrice(1, 2.5)).toBe(2); // 2.5 → 2
    expect(stockListPrice(3, 0.5)).toBe(1); // 1.5 → 1
  });

  it('地產／設施：(地價 + 等級 × 房價) × 物價 @source 0x004265b9 / 0x004265e5', () => {
    expect(estateListPrice(3000, 0, 1500, 1)).toBe(3000);
    expect(estateListPrice(3000, 4, 1500, 2)).toBe((3000 + 6000) * 2);
  });
});

// ============================================================
//  挂設施
// ============================================================

const FAC_ID = 1;
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2] }),
    makeNode({ id: 2, adjacent: [1], type: FACILITY_TYPE_MIN + FAC_ID, ref: { kind: 'facility', index: FAC_ID } }),
  ],
  lands: [],
  facilities: [makeFacility({ id: FAC_ID, landPrice: 3000, housePrice: 1500 })],
};

function twoPlayers(over: Partial<GameState> = {}): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, cash: 100_000 })),
    phase: 'awaitingRoll',
    ...over,
  });
  const facilityOwner = [...s.facilityOwner];
  const facilityLevel = [...s.facilityLevel];
  facilityOwner[FAC_ID] = 1;
  facilityLevel[FAC_ID] = 2;
  return { ...s, facilityOwner, facilityLevel };
}

describe('★ 設施能挂、能买了', () => {
  const id = encodeEstate('facility', FAC_ID);

  it('自己的設施挂得上；别人的挂不上', () => {
    const s = twoPlayers();
    const listed = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.estate, id, price: 5000 }, topo);
    expect(listed.noticeBoard[0]?.[0]).toMatchObject({ kind: LISTING.estate, id, price: 5000 });
    const other = { ...s, currentPlayer: 1 };
    expect(reduce(other, { type: 'noticeBoard', op: 'list', kind: LISTING.estate, id, price: 5000 }, topo)).toBe(other);
  });

  it('买走只换归属，等级留在原处，付现金', () => {
    const s = twoPlayers();
    const listed = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.estate, id, price: 5000 }, topo);
    const asBuyer = { ...listed, currentPlayer: 1 };
    const bought = reduce(asBuyer, { type: 'noticeBoard', op: 'buy', seller: 0, slot: 0 }, topo);
    expect(bought.facilityOwner[FAC_ID]).toBe(2);
    expect(bought.facilityLevel[FAC_ID]).toBe(2);
    expect(bought.players[1]?.cash).toBe(95_000);
    expect(bought.players[0]?.cash).toBe(105_000);
    expect(bought.noticeBoard[0]?.[0]).toBeNull();
  });
});

// ============================================================
//  AI 用板的判据
// ============================================================

describe('★ AI 怎么用公佈欄 —— 判据', () => {
  it('三道随机闸：1/15 挂、1/3 重估、1/4 买', () => {
    expect([AI_BOARD_LIST_CHANCE, AI_BOARD_REPRICE_CHANCE, AI_BOARD_SHOP_CHANCE]).toEqual([15, 3, 4]);
  });

  it('卡片只在手牌 > 12 且有重复时挂；重复的挑法', () => {
    expect(AI_CARD_LIST_MIN_HAND).toBe(12);
    expect(duplicateCards([1, 2, 3])).toEqual([]);
    expect(duplicateCards([1, 2, 2, 3, 3, 3])).toEqual([2, 3]);
  });

  it('★ 道具：数量 ≥ 3，或 有货且 f7 − 個性 == 2', () => {
    expect(AI_TOOL_LIST_MIN_COUNT).toBe(3);
    expect(aiWantsToListTool(3, 0, 0)).toBe(true);
    expect(aiWantsToListTool(1, 2, 0)).toBe(true); // 乖寶寶手里的飛彈
    expect(aiWantsToListTool(1, 2, 1)).toBe(false);
    expect(aiWantsToListTool(0, 2, 0)).toBe(false);
    expect(aiWantsToListTool(2, 1, 0)).toBe(false);
  });

  it('★ f7 == 2 的正是四件凶狠道具', () => {
    expect(TOOLS.filter((t) => t.f7 === 2).map((t) => t.name)).toEqual(['飛彈', '時光機', '工程車', '核子飛彈']);
  });

  it('股票：单价低于現價才买', () => {
    expect(aiWantsListedStock(1000, 100, 12)).toBe(true); // 10 < 12
    expect(aiWantsListedStock(1300, 100, 12)).toBe(false);
    expect(aiWantsListedStock(1000, 0, 12)).toBe(false);
  });

  it('★ 单价恰好 .5 时向零截断（0x00428b77 的 `call 0x457dbc`）', () => {
    // 5 / 2 = 2.5：截断 2 < 3 → 买；Math.round 会给 3，不小于 3 → 不买
    expect(aiWantsListedStock(5, 2, 3)).toBe(true);
    expect(aiWantsListedStock(5, 2, 2)).toBe(false); // 2 < 2 为假
    // 7 / 2 = 3.5：截断 3
    expect(aiWantsListedStock(7, 2, 4)).toBe(true);
    expect(aiWantsListedStock(7, 2, 3)).toBe(false);
  });

  it('地產：3 × 估值 > 標價 且 cash > 2 × 標價', () => {
    expect(aiWantsListedEstate(8000, 3000, 100_000)).toBe(true);
    expect(aiWantsListedEstate(9000, 3000, 100_000)).toBe(false);
    expect(aiWantsListedEstate(8000, 3000, 16_000)).toBe(false);
  });
});

// ============================================================
//  AI 回合真的会动板
// ============================================================

/** 原版公佈欄那一步在买股卖股之后（0x00418e13）：startTurn 后再推两步调度才轮到它 */
function toBoardStep(state: GameState): GameState {
  let s = reduce(state, { type: 'startTurn' }, topo);
  s = reduce(s, { type: 'aiNext' }, topo);
  return reduce(s, { type: 'aiNext' }, topo);
}

describe('★ 电脑回合会用公佈欄（在 reducer 里掷，跨进调度第 2 步时）', () => {
  function aiWithTools(seed: number): GameState {
    const s = makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, cash: 100_000, whoPlays: 2, personality: 0 })),
      phase: 'turnStart',
      rngState: seed,
    });
    // 给 0 号五件路障 —— 数量 ≥ 3 必挂候选
    let tools = emptyTools(4);
    let stock = initialToolStock();
    for (let i = 0; i < 5; i++) {
      const g = giveTool(tools, stock, 0, 2);
      tools = g.tools;
      stock = g.stock;
    }
    return { ...s, tools, toolStock: stock };
  }

  it('扫一批种子：总有些回合挂出路障，且價 = 3000 × 物價', () => {
    let listedSeeds = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const after = toBoardStep(aiWithTools(seed));
      const it = after.noticeBoard[0]?.[0];
      if (it) {
        listedSeeds++;
        expect(it).toMatchObject({ kind: LISTING.tool, id: 2, price: 3000 });
      }
    }
    // 1/15 的闸：120 个种子里大约 8 次，允许较宽的区间
    expect(listedSeeds).toBeGreaterThan(2);
    expect(listedSeeds).toBeLessThan(30);
  });

  it('真人回合不动板', () => {
    const s = { ...aiWithTools(7), players: aiWithTools(7).players.map((p) => ({ ...p, whoPlays: WHO_PLAYS_HUMAN })) };
    const after = toBoardStep(s);
    expect(after.noticeBoard[0]?.every((x) => x === null)).toBe(true);
  });

  it('同一种子重放一致（C-DET-4）', () => {
    const a = toBoardStep(aiWithTools(11));
    const b = toBoardStep(aiWithTools(11));
    expect(a.noticeBoard).toEqual(b.noticeBoard);
    expect(a.rngState).toBe(b.rngState);
  });
});
