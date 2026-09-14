/*
 * 百貨公司（卡片／道具商店）的待决交互要带齐买卖两边
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方描述原版这一屏：左侧是可买的卡片列表，**右下是自己已有的卡片，
 *   点击可以卖出换點數**。规则引擎里 `sellCard` / `sellTool` 一直有，
 *   但 `pending` 没把「你手上有什么」带出来，界面便无从显示 —— 等于这半边
 *   功能对玩家不存在。这个测试钉住它带了。
 */
import { describe, expect, it } from 'vitest';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { resellValue, cardPrice, toolPrice } from './shop.ts';
import { emptyTools, giveTool, initialToolStock } from '../rules/tools.ts';

const topo: MapTopology = {
  nodes: [
    makeNode({
      id: 1,
      specialKind: SPECIAL_KIND.DEPARTMENT_STORE,
      adjacent: [2],
      adjacentSlots: [2, 0, 0, 0],
    }),
    makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0] }),
  ],
};

function atShop() {
  const given = giveTool(emptyTools(4), initialToolStock(), 0, 2);
  const s = makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, nodeId: 1, points: 500, cards: i === 0 ? [1, 9, 9] : [] }),
    ),
    phase: 'settling',
    tools: given.tools,
    toolStock: given.stock,
  });
  return reduce(s, { type: 'settle' }, topo);
}

describe('百貨公司的待决交互', () => {
  it('★ 手上的卡片与道具都带出来了，并附退款额', () => {
    const s = atShop();
    expect(s.pending?.kind).toBe('shop');
    if (s.pending?.kind !== 'shop') throw new Error('应当是 shop');
    // 手上两种卡（9 号有两张，按种类去重）
    expect(s.pending.owned.cards.map((c) => c.id).sort()).toEqual([1, 9]);
    expect(s.pending.owned.cards.find((c) => c.id === 9)?.refund).toBe(
      resellValue(cardPrice(9)),
    );
    // 手上一种道具
    expect(s.pending.owned.tools).toHaveLength(1);
    expect(s.pending.owned.tools[0]).toMatchObject({ id: 2, count: 1 });
    expect(s.pending.owned.tools[0]?.refund).toBe(resellValue(toolPrice(2)));
  });

  it('★ 卖出后點數增加、卡片减少，柜台还开着', () => {
    const s = atShop();
    const before = s.players[0]!.points;
    const after = reduce(s, { type: 'shop', op: 'sellCard', id: 1 }, topo);
    expect(after.players[0]!.points).toBe(before + resellValue(cardPrice(1)));
    expect(after.players[0]!.cards).toEqual([9, 9]);
    // 柜台不关，而且待决交互里的數字要跟着刷新
    expect(after.pending?.kind).toBe('shop');
    if (after.pending?.kind !== 'shop') throw new Error('应当是 shop');
    expect(after.pending.points).toBe(after.players[0]!.points);
  });

  it('手上没有的卡卖不掉，状态原样返回', () => {
    const s = atShop();
    expect(reduce(s, { type: 'shop', op: 'sellCard', id: 30 }, topo)).toBe(s);
  });

  it('退九成 —— 取整方式与原版一致', () => {
    // @source `trunc(點數 + 價格 × 0.9)`，见 places/shop.ts 的说明
    expect(resellValue(100)).toBe(90);
    expect(resellValue(155)).toBe(139); // 139.5 → 139
    expect(resellValue(1)).toBe(0);
  });
});
