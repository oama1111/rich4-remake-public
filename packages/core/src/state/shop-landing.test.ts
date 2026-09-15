/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 百貨公司落点
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { toolCount } from '../rules/tools.ts';
import { TRAFFIC_WALK } from '../rules/tool-effects.ts';
import { initialCardAmounts } from '../rules/new-game.ts';
import { initialToolStock } from '../rules/tools.ts';

const node = makeNode({ id: 1, adjacent: [1], flags: SPECIAL_KIND.DEPARTMENT_STORE, specialKind: SPECIAL_KIND.DEPARTMENT_STORE });
const topo = { nodes: [node] };

function landed(points: number): GameState {
  const s = makeGameState({
    phase: 'settling',
    // ★ 货架是从牌堆/库存里抽的（0x0042eb05 / 0x0042ec0b），空牌堆抽不出东西
    cardAmount: initialCardAmounts(),
    toolStock: initialToolStock(),
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, points, trafficMethod: TRAFFIC_WALK }),
    ),
  });
  return reduce(s, { type: 'settle' }, topo);
}

describe('★ 百貨公司落点', () => {
  it('★ 留下一个商店交互，列出卡片与道具的標價', () => {
    const s = landed(500);
    expect(s.pending?.kind).toBe('shop');
    if (s.pending?.kind !== 'shop') return;
    expect(s.pending.points).toBe(500);
    // ★ 货架 6..15 件（0x0042eb05 `rand()%10+6`），不是全部 30 张
    expect(s.pending.cards.length).toBeGreaterThanOrEqual(6);
    expect(s.pending.cards.length).toBeLessThanOrEqual(15);
    // ★ 道具只列 1..8 号（0x0042ec0b `cmp eax, 8`）—— 9..13 只能靠研究所
    expect(s.pending.tools.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.pending.tools.find((t) => t.id === 6)?.stock).toBeGreaterThan(0);
  });

  it('★ 买汽車：扣點數不扣钱，道具到手', () => {
    const s = landed(500);
    const cash = s.players[0]!.cash;
    const after = reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo);
    expect(after.players[0]!.points).toBe(350); // 500 − 150
    expect(after.players[0]!.cash).toBe(cash);
    expect(toolCount(after.tools, 0, 6)).toBe(1);
  });

  it('★ 买完商店还开着，可以接着买 —— 原版是模态窗口', () => {
    let s = landed(500);
    s = reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo);
    expect(s.pending?.kind).toBe('shop');
    // 交互里的點數要刷新，否则界面还显示旧数
    if (s.pending?.kind === 'shop') expect(s.pending.points).toBe(350);
    // 买货架上的第一张 —— 不在货架上的卡买不到（0x0042eb15 只列货架）
    const onShelf = s.pending?.kind === 'shop' ? s.pending.cards[0]!.id : 0;
    s = reduce(s, { type: 'shop', op: 'buyCard', id: onShelf }, topo);
    expect(s.players[0]!.cards).toContain(onShelf);
  });

  it('★ 买一件少一件 —— 卡片与道具**两页都**如此', () => {
    // @source 原版两页各清自己那一格：卡片 `mov byte [edi+0x48c31c],0`、
    //   道具 `mov byte [ebx+0x48c2f8],0`（rich4_shop.asm 0x42e1eb / 0x42e466 尾）
    let s = landed(500);
    if (s.pending?.kind !== 'shop') throw new Error('商店没开');
    const shelfTool = s.pending.tools.find((t) => t.id === 6)!.id;
    const shelfCard = s.pending.cards[0]!.id;
    s = reduce(s, { type: 'shop', op: 'buyTool', id: shelfTool }, topo);
    expect(s.pending?.kind === 'shop' && s.pending.tools.some((t) => t.id === shelfTool)).toBe(false);
    s = reduce(s, { type: 'shop', op: 'buyCard', id: shelfCard }, topo);
    expect(s.pending?.kind === 'shop' && s.pending.cards.some((c) => c.id === shelfCard)).toBe(false);
    // ★ 买过的再买一次：reducer 拒绝（返回同一个 state），而不是凭空再来一件
    expect(reduce(s, { type: 'shop', op: 'buyTool', id: shelfTool }, topo)).toBe(s);
  });

  it('點數不够时什么都不发生', () => {
    const s = landed(10);
    expect(reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo)).toBe(s);
  });

  it('★ 回合结束会关掉商店 —— 不能把柜台带给下家', () => {
    const s = landed(500);
    expect(s.pending?.kind).toBe('shop');
    const after = reduce({ ...s, phase: 'turnEnd' }, { type: 'endTurn' }, topo);
    expect(after.pending).toBeNull();
  });

  it('没落在商店上时买卖无效', () => {
    const s = makeGameState({ pending: null });
    expect(reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo)).toBe(s);
  });
});
