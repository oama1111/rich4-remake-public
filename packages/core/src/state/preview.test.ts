/*
 * 「这一步会不会生效」的预演 —— AI 与 UI 共用
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这两条断言是**契约**：预演必须与真跑同口径。它们错了，UI 会把「点不动的
 * 目标」高亮成可选（或反过来，把能选的判成不能选）。
 */
import { describe, expect, it } from 'vitest';
import { canUseCard, canUseTool } from './preview.ts';
import { makeGameState, makeLand } from '../testing/factories.ts';
import type { MapTopology } from './reduce.ts';

const topo = {
  nodes: [],
  lands: [makeLand({ id: 1, owner: 1 }), makeLand({ id: 2, owner: 0 })],
  facilities: [],
  commercials: [],
} as unknown as MapTopology;

describe('canUseCard —— 空跑一遍 registry', () => {
  it('★ 不需要目标的卡：牌在手上、且情况有意义，给 none 就通过', () => {
    const base = makeGameState();
    const players = base.players.map((p, i) => ({
      ...p,
      cash: i === 1 ? 100000 : 0,
      cards: i === 0 ? [1] : [], // 均富卡（1）在**当前玩家**手上
    }));
    expect(canUseCard(makeGameState({ players }), topo, 1, { kind: 'none' })).toBe(true);
  });

  it('★ 牌不在手上 → 不通过（UI 不能给没这张牌的人高亮）', () => {
    expect(canUseCard(makeGameState(), topo, 1, { kind: 'none' })).toBe(false);
  });

  it('★ 需要目标的卡：给 none 不通过（选目标前不该让它可点）', () => {
    const state = makeGameState();
    // 換地卡（4）selection 'ui'，要一块地
    expect(canUseCard(state, topo, 4, { kind: 'none' })).toBe(false);
  });

  it('★ 预演**不改状态**（连打两次结果一样）', () => {
    const state = makeGameState();
    const before = JSON.stringify(state);
    canUseCard(state, topo, 1, { kind: 'none' });
    canUseCard(state, topo, 4, { kind: 'none' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('canUseTool —— 空跑一遍 useToolAction', () => {
  const me = makeGameState();

  it('★ 库存里没有这件道具 → 不通过', () => {
    expect(canUseTool(me, topo, 5, 0)).toBe(false); // 機車：开局没有（下标 5 = 道具 5）
  });

  it('★ 有货且目标合法 → 通过；没给点数 → 不通过', () => {
    const state = makeGameState();
    state.tools[8] = 1; // ★ 下标 = 道具号（core 的约定，0 号空置）
    expect(canUseTool(state, topo, 8, 0, 0)).toBe(false); // 没点数
    expect(canUseTool(state, topo, 8, 0, 6)).toBe(true); // 1..18 之内
    expect(canUseTool(state, topo, 8, 0, 99)).toBe(false); // 越界
  });

  it('★ 预演**不改状态**（道具不会被吃掉）', () => {
    const state = makeGameState();
    state.tools[8] = 2;
    canUseTool(state, topo, 8, 0, 6);
    expect(state.tools[8]).toBe(2);
  });
});
