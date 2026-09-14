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

const node = makeNode({ id: 1, adjacent: [1], flags: SPECIAL_KIND.DEPARTMENT_STORE, specialKind: SPECIAL_KIND.DEPARTMENT_STORE });
const topo = { nodes: [node] };

function landed(points: number): GameState {
  const s = makeGameState({
    phase: 'settling',
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
    expect(s.pending.cards.length).toBeGreaterThan(20);
    expect(s.pending.tools.length).toBe(13);
    // 编号 > 8 的道具不限量 —— 库存那栏给 null
    expect(s.pending.tools.find((t) => t.id === 12)?.stock).toBeNull();
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
    s = reduce(s, { type: 'shop', op: 'buyCard', id: 7 }, topo);
    expect(s.players[0]!.cards).toContain(7);
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
