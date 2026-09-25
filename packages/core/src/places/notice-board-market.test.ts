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
  sweepStaleColumn,
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
    // ★★ 审计订正（0x004288a9）：双重循环逐对压入、不去重 ⇒ k 张同种卡进表 k·(k−1) 次
    expect(duplicateCards([1, 2, 2, 3, 3, 3])).toEqual([2, 2, 3, 3, 3, 3, 3, 3]);
    expect(duplicateCards([5, 7, 5])).toEqual([5, 5]);
  });

  it('★★ 进门先清理（0x0042483e）：挂着却已不归挂牌人的撤掉；一旦撤过一件，游标就钉在那一格', () => {
    const col = [
      { kind: 3, id: 1, price: 1, amount: 0 },
      { kind: 3, id: 2, price: 1, amount: 0 }, // 失效
      { kind: 3, id: 3, price: 1, amount: 0 },
      { kind: 3, id: 4, price: 1, amount: 0 }, // 失效（但游标已钉在 1 号格，看不到它）
      null, null, null,
    ] as Parameters<typeof sweepStaleColumn>[0];
    const out = sweepStaleColumn(col, (it) => it.id !== 2 && it.id !== 4);
    expect(out.map((x) => x?.id ?? 0)).toEqual([1, 3, 4, 0, 0, 0, 0]);
    // 没撤过就逐格往后看，全都合格 ⇒ 原样返回
    expect(sweepStaleColumn(col, () => true)).toBe(col);
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

  it('★★ 进门先清理（0x004284c5 call 0x42483e）：别人挂着、自己手上已没有的卡，在电脑这一步被撤掉', () => {
    const s0 = makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, cash: 100_000, whoPlays: 2, cards: i === 1 ? [3] : [] })),
      phase: 'turnStart',
      rngState: 1,
    });
    const col = (ids: number[]) => [...ids.map((id) => ({ kind: LISTING.card, id, price: 100, amount: 0 })), null, null, null, null, null].slice(0, 7);
    const s = { ...s0, noticeBoard: [col([]), col([5, 3])] };
    const after = toBoardStep(s);
    // 1 号挂着卡 5（手上没有）与卡 3（手上有）⇒ 5 撤掉、3 挪到第 0 格
    expect(after.noticeBoard[1]!.map((x) => x?.id ?? 0)).toEqual([3, 0, 0, 0, 0, 0, 0]);
  });

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

// ============================================================
//  ★★ 2026 本轮：公佈欄买**股票**之后要重排企业持股名次
//  原版 `0x0042571e call 0x4294d5`（实参 = 股票号 + 买家）
// ============================================================

describe('★ 公佈欄买股票 → 重排企业老板', () => {
  const STOCK = 0;
  const COMM = 3;

  /** 0 号持 100 股、1 号持 10 股；企业 3 的老板是 0 号（ranking 首位 = 玩家+1） */
  const marketState = (): GameState => {
    const s = makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, cash: 100_000 })),
      phase: 'awaitingRoll',
    });
    return {
      ...s,
      holdings: s.holdings.map((row, i) =>
        row.map((h, j) => (j === STOCK ? { amount: i === 0 ? 100 : 10, avgCost: 10 } : h)),
      ),
      market: {
        ...s.market,
        stocks: s.market.stocks.map((st, j) =>
          j === STOCK ? { ...st, commercialIndex: COMM } : st,
        ),
      },
      commercialOwners: s.commercialOwners.map((o, j) =>
        j === COMM ? { ...o, ranking: [1, 2, 0, 0], owner: 1 } : o,
      ),
    };
  };

  it('卖出全部持股后，企业老板换成买家（此前不会重排）', () => {
    const s = marketState();
    const listed = reduce(
      s,
      { type: 'noticeBoard', op: 'list', kind: LISTING.stock, id: STOCK, price: 100, amount: 100 },
      topo,
    );
    expect(listed.noticeBoard[0]?.[0]).toMatchObject({ kind: LISTING.stock, amount: 100 });
    const bought = reduce({ ...listed, currentPlayer: 1 },
      { type: 'noticeBoard', op: 'buy', seller: 0, slot: 0 }, topo);
    // 持股确实转过去了
    expect(bought.holdings[1]?.[STOCK]?.amount).toBe(110);
    expect(bought.holdings[0]?.[STOCK]?.amount).toBe(0);
    // ★ 老板跟着换（0 号一股不剩、1 号 110 股）
    expect(bought.commercialOwners[COMM]?.owner).toBe(2);
    expect(bought.commercialOwners[COMM]?.ranking[0]).toBe(2);
  });

  it('买**非股票**（地產）不碰企业名次', () => {
    const s = twoPlayers();
    const id = encodeEstate('facility', FAC_ID);
    const listed = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.estate, id, price: 5000 }, topo);
    const before = listed.commercialOwners.map((o) => o.owner);
    const bought = reduce({ ...listed, currentPlayer: 1 },
      { type: 'noticeBoard', op: 'buy', seller: 0, slot: 0 }, topo);
    expect(bought.commercialOwners.map((o) => o.owner)).toEqual(before);
  });
});
