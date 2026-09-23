/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 百貨公司：开门时货架上有什么、董事長進門有禮
 */

import { describe, expect, it } from 'vitest';
import { CARDS } from '@rich4/data';
import { SHELF_MIN, SHELF_SPAN, STORE_INDUSTRY, drawCardShelf, toolShelf } from './shop.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { initialToolStock, toolCount } from '../rules/tools.ts';
import { initialCardAmounts } from '../rules/new-game.ts';
import { emptyOwnership } from './commercial.ts';
import type { GameState } from '../state/types.ts';

describe('★ 卡片货架：6..15 件，按牌堆加权、不放回 @source 0x0042eb05', () => {
  it('件数落在 6..15', () => {
    expect([SHELF_MIN, SHELF_SPAN]).toEqual([6, 10]);
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new WatcomRng();
      rng.setState(seed);
      const n = drawCardShelf(initialCardAmounts(), rng).length;
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(15);
    }
  });

  // ★ 第十二份試玩回報「卡片商店的卡片数量太少」：那一次货架只有 6 张（下限）。
  //   原版的件数就是**第一口** `rand() % 10 + 6`（`0x0042eaff call rand / 0x0042eb06 mov ebx,0xa /
  //   idiv / 0x0042eb10 lea ebp,[edx+6]`），6..15 **均匀**，不看地图/日期/人；货架缓冲
  //   `0x48c31c` 开门时清 0xf = 15 字节。下面两条把「件数 = 第一口随机数」与「10 个值都抽得到」钉死。
  it('★ 件数 = 第一口 `rand() % 10 + 6`（牌堆够时不会提前停）@source 0x0042eaff..0x0042eb10', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const probe = new WatcomRng();
      probe.setState(seed);
      const rng = new WatcomRng();
      rng.setState(seed);
      expect(drawCardShelf(initialCardAmounts(), rng)).toHaveLength((probe.next() % 10) + 6);
    }
  });

  it('★ 6..15 十个件数都抽得到（均匀，不是偏向少的一头）', () => {
    const seen = new Map<number, number>();
    for (let seed = 1; seed <= 2000; seed++) {
      const rng = new WatcomRng();
      rng.setState(seed);
      const n = drawCardShelf(initialCardAmounts(), rng).length;
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    // 每档大约 1/10（2000 次 → 各 ~200）；给宽松的界，只为抓「整体偏向一头」这种错
    for (const [n, c] of seen) expect(c, `件数 ${n}`).toBeGreaterThan(120);
  });

  it('★ 不放回：同一张卡出现次数不超过牌堆剩余量', () => {
    const deck = initialCardAmounts();
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new WatcomRng();
      rng.setState(seed);
      const shelf = drawCardShelf(deck, rng);
      const count = new Map<number, number>();
      for (const id of shelf) count.set(id, (count.get(id) ?? 0) + 1);
      for (const [id, n] of count) expect(n, `卡 ${id}`).toBeLessThanOrEqual(deck[id - 1] ?? 0);
    }
  });

  it('牌堆空了就抽不出来', () => {
    const rng = new WatcomRng();
    rng.setState(3);
    expect(drawCardShelf(new Array<number>(30).fill(0), rng)).toEqual([]);
  });

  it('同一种子重放一致', () => {
    const a = new WatcomRng();
    a.setState(9);
    const b = new WatcomRng();
    b.setState(9);
    expect(drawCardShelf(initialCardAmounts(), a)).toEqual(drawCardShelf(initialCardAmounts(), b));
  });
});

describe('★ 道具货架：只有 1..8 号、库存 > 0 的 @source 0x0042ec0b', () => {
  it('開局库存下八件都在；9..13 永远不在', () => {
    expect(toolShelf(initialToolStock())).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('卖光的下架', () => {
    const stock = initialToolStock();
    stock[2] = 0;
    expect(toolShelf(stock)).toEqual([1, 3, 4, 5, 6, 7, 8]);
  });
});

// ============================================================
//  接到 reducer
// ============================================================

const storeNode = makeNode({ id: 2, adjacent: [1, 3], specialKind: SPECIAL_KIND.DEPARTMENT_STORE });
const STORE_CID = 1;
const topo: MapTopology = {
  nodes: [makeNode({ id: 1, adjacent: [2] }), storeNode, makeNode({ id: 3, adjacent: [2] })],
  lands: [],
  commercials: [
    { id: STORE_CID, x: 0, y: 0, name: '百貨', stockIndex: 0, landPrice: 0, type: STORE_INDUSTRY, spriteIndex: 0, assetValue: 0, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 0 },
  ],
};

function atStore(chairman: number | null): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: i === 0 ? 2 : 1, points: 900, cards: [] })),
    phase: 'settling',
    cardAmount: initialCardAmounts(),
    toolStock: initialToolStock(),
  });
  const commercialOwners = [...s.commercialOwners];
  while (commercialOwners.length <= STORE_CID) commercialOwners.push(emptyOwnership());
  commercialOwners[STORE_CID] = { ...emptyOwnership(), owner: chairman === null ? 0 : chairman + 1 };
  return { ...s, commercialOwners };
}

describe('★ 走进百貨公司', () => {
  it('货架不再是全部 30 张：件数 6..15，道具只列 1..8', () => {
    const r = reduce(atStore(null), { type: 'settle' }, topo);
    expect(r.pending?.kind).toBe('shop');
    if (r.pending?.kind !== 'shop') return;
    expect(r.pending.cards.length).toBeGreaterThanOrEqual(6);
    expect(r.pending.cards.length).toBeLessThanOrEqual(15);
    expect(r.pending.tools.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.rngState).not.toBe(atStore(null).rngState);
  });

  it('★ 买卡只认货架上有的，买一件货架少一件', () => {
    const opened = reduce(atStore(null), { type: 'settle' }, topo);
    if (opened.pending?.kind !== 'shop') throw new Error('no shop');
    const onShelf = opened.pending.cards[0]!.id;
    const offShelf = CARDS.map((c) => c.id).find((id) => !opened.pending!.kind || !(opened.pending as { cards: { id: number }[] }).cards.some((c) => c.id === id));
    const before = opened.pending.cards.length;
    const bought = reduce(opened, { type: 'shop', op: 'buyCard', id: onShelf }, topo);
    expect(bought.players[0]?.cards).toContain(onShelf);
    if (bought.pending?.kind === 'shop') expect(bought.pending.cards.length).toBe(before - 1);
    if (offShelf !== undefined) {
      expect(reduce(opened, { type: 'shop', op: 'buyCard', id: offShelf }, topo)).toBe(opened);
    }
  });

  it('★ 董事長進門有禮：一件道具或一张卡', () => {
    let gifted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = { ...atStore(0), rngState: seed };
      const r = reduce(s, { type: 'settle' }, topo);
      const toolsGained = [1, 2, 3, 4, 5, 6, 7, 8].reduce((n, id) => n + toolCount(r.tools, 0, id), 0);
      const cardsGained = r.players[0]!.cards.length;
      expect(toolsGained + cardsGained).toBe(1);
      if (toolsGained === 1) gifted++;
    }
    // rand() & 1 —— 两种都该出现
    expect(gifted).toBeGreaterThan(5);
    expect(gifted).toBeLessThan(35);
  });

  it('不是董事長：进门没礼物', () => {
    const r = reduce(atStore(1), { type: 'settle' }, topo);
    expect(r.players[0]!.cards).toEqual([]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].reduce((n, id) => n + toolCount(r.tools, 0, id), 0)).toBe(0);
  });
});
