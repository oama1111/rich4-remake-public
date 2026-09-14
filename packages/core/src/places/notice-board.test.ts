/*
 * 公佈欄 —— 玩家之间的二级市场
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { emptyTools, giveTool, initialToolStock, toolCount } from '../rules/tools.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { CARDS } from '@rich4/data';
import {
  BOARD_SLOTS,
  CARD_LIST_MULTIPLIER,
  LISTING,
  MAX_TOOL_PER_KIND,
  canBuyListing,
  cardListPrice,
  decodeEstate,
  emptyBoard,
  emptyColumn,
  encodeEstate,
  isColumnFull,
  listItem,
  withdrawItem,
  type Listing,
} from './notice-board.ts';

const topo: MapTopology = {
  nodes: [makeNode({ id: 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0] }), makeNode({ id: 2 })],
  lands: [makeLand({ id: 1, type: LAND_TYPE_HOUSE })],
};

const item = (over: Partial<Listing> = {}): Listing => ({
  kind: LISTING.card, id: 1, price: 1000, amount: 0, ...over,
});

function scene() {
  const given = giveTool(emptyTools(4), initialToolStock(), 1, 2);
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, cash: 100_000, cards: i === 1 ? [5, 7] : [] }),
    ),
    landOwner: [0, 2], // 地块 1 属于玩家 1
    landLevel: [0, 0],
    landType: [0, LAND_TYPE_HOUSE],
    tools: given.tools,
    toolStock: given.stock,
    phase: 'awaitingRoll',
  });
}

describe('槽位', () => {
  it('★ 每个玩家 7 个槽 —— 0x54 字节 ÷ 每槽 12 字节', () => {
    expect(BOARD_SLOTS).toBe(7);
    expect(0x54 / 12).toBe(BOARD_SLOTS);
    expect(emptyColumn()).toHaveLength(7);
    expect(emptyBoard()).toHaveLength(4);
  });

  it('★ 板满的判定看的是**最后那一格**（@source cmp byte [+0x496828], 0）', () => {
    const col = emptyColumn();
    expect(isColumnFull(col)).toBe(false);
    col[0] = item();
    expect(isColumnFull(col)).toBe(false); // 前面占了不算满
    col[BOARD_SLOTS - 1] = item();
    expect(isColumnFull(col)).toBe(true);
  });

  it('挂牌占第一个空槽', () => {
    let col = emptyColumn();
    col = listItem(col, item({ id: 1 }))!;
    col = listItem(col, item({ id: 2 }))!;
    expect(col[0]?.id).toBe(1);
    expect(col[1]?.id).toBe(2);
  });

  it('★ 同类型同编号会**覆盖**原来那一格，不新占一格', () => {
    let col = emptyColumn();
    col = listItem(col, item({ id: 1, price: 1000 }))!;
    col = listItem(col, item({ id: 2 }))!;
    col = listItem(col, item({ id: 1, price: 5000 }))!;
    expect(col[0]).toMatchObject({ id: 1, price: 5000 });
    expect(col[1]?.id).toBe(2);
    expect(col[2]).toBeNull();
  });

  it('七格全满且没有同项 → 挂不上', () => {
    let col = emptyColumn();
    for (let i = 0; i < BOARD_SLOTS; i++) col = listItem(col, item({ id: i + 1 }))!;
    expect(listItem(col, item({ id: 99 }))).toBeNull();
  });

  it('★ 撤件把后面的往前挪，最后一格清空（@source memmove + memset）', () => {
    let col = emptyColumn();
    for (let i = 0; i < 3; i++) col = listItem(col, item({ id: i + 1 }))!;
    const after = withdrawItem(col, 0)!;
    expect(after.map((x) => x?.id ?? null)).toEqual([2, 3, null, null, null, null, null]);
    expect(withdrawItem(col, 5)).toBeNull(); // 空格撤不了
  });
});

describe('編號與價格', () => {
  it('地產／設施 用 2000/4000 那套编码，与傳送機同源', () => {
    expect(encodeEstate('land', 3)).toBe(0x7d0 + 3);
    expect(decodeEstate(0x7d0 + 3)).toEqual({ kind: 'land', index: 3 });
    expect(decodeEstate(0xfa0 + 2)).toEqual({ kind: 'facility', index: 2 });
  });

  it('★ 卡片的市價 = 標價 × 100 × 物價指數（@source VA 0x00428935）', () => {
    expect(CARD_LIST_MULTIPLIER).toBe(100);
    // 卡片 1（均富卡）標價取自卡片表，不写死在这里
    const base = CARDS.find((c) => c.id === 1)!.price;
    expect(cardListPrice(1, 1)).toBe(base * 100);
    expect(cardListPrice(1, 3)).toBe(base * 100 * 3);
  });
});

describe('買下', () => {
  it('★ 现金不够就不成交', () => {
    const s = scene();
    const poor = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 10 } : p)) };
    expect(canBuyListing(poor, 0, 1, item({ price: 1000 }))).toBe('cashShort');
  });

  it('★ 手牌满 15 张就买不了卡片', () => {
    const s = scene();
    const full = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, cards: Array.from({ length: 15 }, () => 1) } : p,
      ),
    };
    expect(canBuyListing(full, 0, 1, item({ kind: LISTING.card }))).toBe('handFull');
  });

  it('★ 同种道具满 9 个就买不了（@source cmp …, 9 / jb）', () => {
    expect(MAX_TOOL_PER_KIND).toBe(9);
    let s = scene();
    let tools = s.tools;
    let stock = s.toolStock;
    for (let i = 0; i < 9; i++) {
      const g = giveTool(tools, stock, 0, 3);
      tools = g.tools;
      stock = g.stock;
    }
    s = { ...s, tools, toolStock: stock };
    expect(canBuyListing(s, 0, 1, item({ kind: LISTING.tool, id: 3 }))).toBe('toolFull');
  });

  it('不能买自己挂的', () => {
    expect(canBuyListing(scene(), 1, 1, item())).toBe('selfPurchase');
  });
});

describe('走 action 这条路', () => {
  it('★ 挂卡片 → 别人买走：卡片易手、现金对流、那一格撤掉', () => {
    let s = scene();
    // 玩家 1 挂 5 号卡
    s = { ...s, currentPlayer: 1 };
    s = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.card, id: 5, price: 3000 }, topo);
    expect(s.noticeBoard[1]?.[0]).toMatchObject({ kind: LISTING.card, id: 5, price: 3000 });

    // 玩家 0 买
    s = { ...s, currentPlayer: 0 };
    const before = { buyer: s.players[0]!.cash, seller: s.players[1]!.cash };
    s = reduce(s, { type: 'noticeBoard', op: 'buy', seller: 1, slot: 0 }, topo);
    expect(s.players[0]!.cards).toEqual([5]);
    expect(s.players[1]!.cards).toEqual([7]);
    expect(s.players[0]!.cash).toBe(before.buyer - 3000);
    expect(s.players[1]!.cash).toBe(before.seller + 3000);
    expect(s.noticeBoard[1]?.[0]).toBeNull();
  });

  it('★ 挂地產 → 归属真的转移', () => {
    let s = { ...scene(), currentPlayer: 1 };
    const id = encodeEstate('land', 1);
    s = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.estate, id, price: 8000 }, topo);
    expect(s.noticeBoard[1]?.[0]?.id).toBe(id);
    s = { ...s, currentPlayer: 0 };
    s = reduce(s, { type: 'noticeBoard', op: 'buy', seller: 1, slot: 0 }, topo);
    expect(s.landOwner[1]).toBe(1); // 玩家 0 + 1
  });

  it('★ 挂道具 → 库存在两人之间搬，不凭空多出来', () => {
    let s = { ...scene(), currentPlayer: 1 };
    expect(toolCount(s.tools, 1, 2)).toBe(1);
    s = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.tool, id: 2, price: 500 }, topo);
    s = { ...s, currentPlayer: 0 };
    s = reduce(s, { type: 'noticeBoard', op: 'buy', seller: 1, slot: 0 }, topo);
    expect(toolCount(s.tools, 1, 2)).toBe(0);
    expect(toolCount(s.tools, 0, 2)).toBe(1);
  });

  it('★ 挂别人的东西挂不上 —— 手上没有就不受理', () => {
    const s = { ...scene(), currentPlayer: 0 }; // 玩家 0 手上没牌
    const after = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.card, id: 5, price: 100 }, topo);
    expect(after).toBe(s);
  });

  it('价格必须是正整数', () => {
    const s = { ...scene(), currentPlayer: 1 };
    expect(reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.card, id: 5, price: 0 }, topo)).toBe(s);
    expect(reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.card, id: 5, price: -5 }, topo)).toBe(s);
  });

  it('撤件把自己那一格收回', () => {
    let s = { ...scene(), currentPlayer: 1 };
    s = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.card, id: 5, price: 3000 }, topo);
    s = reduce(s, { type: 'noticeBoard', op: 'withdraw', slot: 0 }, topo);
    expect(s.noticeBoard[1]?.[0]).toBeNull();
  });
});
