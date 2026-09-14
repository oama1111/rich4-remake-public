/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 用道具接入 reduce
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { TOOL_SLOTS_PER_PLAYER, toolCount } from '../rules/tools.ts';
import { TRAFFIC_CAR, TRAFFIC_MOTORCYCLE, TRAFFIC_WALK } from '../rules/tool-effects.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] }), makeNode({ id: 2, adjacent: [1] })] };

/** 给玩家 0 发几个道具 */
function withTools(counts: Record<number, number>, over: Partial<GameState> = {}): GameState {
  const tools = new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);
  for (const [id, n] of Object.entries(counts)) tools[Number(id)] = n;
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, trafficMethod: TRAFFIC_WALK, ndices: 1 }),
    ),
    tools,
    ...over,
  });
}

describe('★ 交通工具', () => {
  it('★ 用汽車：交通方式变 2、骰子变 3、道具被收走', () => {
    const s = withTools({ 6: 1 });
    const after = reduce(s, { type: 'useTool', toolId: 6 }, topo);
    expect(after.players[0]!.trafficMethod).toBe(TRAFFIC_CAR);
    expect(after.players[0]!.ndices).toBe(3);
    expect(toolCount(after.tools, 0, 6)).toBe(0);
  });

  it('★ 已经是同一种车时不消耗道具 —— 原版直接 jmp 结束，不走 take_tool', () => {
    const s = withTools({ 6: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, nodeId: 1, trafficMethod: TRAFFIC_CAR, ndices: 3 }),
      ),
    });
    expect(reduce(s, { type: 'useTool', toolId: 6 }, topo)).toBe(s);
  });

  it('★ 换车时旧车退还成道具', () => {
    const s = withTools({ 6: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, nodeId: 1, trafficMethod: TRAFFIC_MOTORCYCLE, ndices: 2 }),
      ),
    });
    const after = reduce(s, { type: 'useTool', toolId: 6 }, topo);
    expect(after.players[0]!.trafficMethod).toBe(TRAFFIC_CAR);
    // 機車（5）被退回来
    expect(toolCount(after.tools, 0, 5)).toBe(1);
  });

  it('没有这个道具就什么都不做', () => {
    const s = withTools({});
    expect(reduce(s, { type: 'useTool', toolId: 6 }, topo)).toBe(s);
  });
});

describe('★ 放置类道具', () => {
  it('★ 路障放到指定格上，占一个物件槽', () => {
    const s = withTools({ 2: 1 });
    const before = s.objects.filter((o) => o.nodeId !== 0).length;
    const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
    expect(after.objects.filter((o) => o.nodeId !== 0).length).toBe(before + 1);
    // 路障的物件种类是 16
    expect(after.objects.some((o) => o.nodeId === 2 && o.type === 16)).toBe(true);
    expect(toolCount(after.tools, 0, 2)).toBe(0);
  });

  it('地雷 17、定時炸彈 18', () => {
    for (const [tool, type] of [
      [3, 17],
      [4, 18],
    ] as const) {
      const s = withTools({ [tool]: 1 });
      const after = reduce(s, { type: 'useTool', toolId: tool, nodeId: 2 }, topo);
      expect(after.objects.some((o) => o.nodeId === 2 && o.type === type)).toBe(true);
    }
  });

  it('没给格子就不放', () => {
    const s = withTools({ 2: 1 });
    expect(reduce(s, { type: 'useTool', toolId: 2 }, topo)).toBe(s);
  });
});

describe('未实现的道具', () => {
  it('★ 安静地什么都不做，也不消耗', () => {
    // 7 飛彈、10 時光機 都还没实现
    for (const id of [7, 10]) {
      const s = withTools({ [id]: 1 });
      expect(reduce(s, { type: 'useTool', toolId: id }, topo)).toBe(s);
    }
  });
});

describe('出局者', () => {
  it('不能用道具', () => {
    const s = withTools({ 6: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, nodeId: 1, whoPlays: i === 0 ? 0 : 1 }),
      ),
    });
    expect(reduce(s, { type: 'useTool', toolId: 6 }, topo)).toBe(s);
  });
});
