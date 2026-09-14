/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 搶奪卡 —— 抢的是道具
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { emptyTools, giveTool, takeTool, toolCount } from '../rules/tools.ts';
import { applyRobCard, applyRobCardCard, robbableCards, robbableTools } from './rob.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
const stock = (n = 50) => new Array<number>(14).fill(n);
const tgt = (index: number) => ({ kind: 'player' as const, index });

/** 给目标塞点道具 */
function seeded() {
  let t = emptyTools(4);
  let s = stock();
  for (const id of [2, 2, 7, 11]) {
    const r = giveTool(t, s, 2, id);
    t = r.tools;
    s = r.stock;
  }
  return { tools: t, stock: s };
}

describe('take_tool 与 give_tool 对称', () => {
  it('★ 收走时把库存还回去', () => {
    const g = giveTool(emptyTools(2), stock(5), 0, 3);
    expect(g.stock[3]).toBe(4);
    const t = takeTool(g.tools, g.stock, 0, 3);
    expect(t.stock[3]).toBe(5); // 还回去了
    expect(toolCount(t.tools, 0, 3)).toBe(0);
  });

  it('★ 编号 > 8 不动库存', () => {
    const g = giveTool(emptyTools(2), stock(5), 0, 11);
    const t = takeTool(g.tools, g.stock, 0, 11);
    expect(t.stock[11]).toBe(5);
  });

  it('没有的道具收不走', () => {
    expect(takeTool(emptyTools(2), stock(), 0, 5).given).toBe(false);
  });
});

describe('搶奪', () => {
  it('道具从目标转到出牌者', () => {
    const { tools, stock: s } = seeded();
    const r = applyRobCard(four(), 0, tgt(2), tools, s, 7);
    expect(r.ok).toBe(true);
    expect(r.robbed).toBe(7);
    expect(toolCount(r.tools, 2, 7)).toBe(0);
    expect(toolCount(r.tools, 0, 7)).toBe(1);
  });

  it('★ 转移过程库存净额不变', () => {
    const { tools, stock: s } = seeded();
    const before = s[7]!;
    const r = applyRobCard(four(), 0, tgt(2), tools, s, 7);
    expect(r.stock[7]).toBe(before);
  });

  it('只抢一个，目标剩下的还在', () => {
    const { tools, stock: s } = seeded();
    const r = applyRobCard(four(), 0, tgt(2), tools, s, 2);
    expect(toolCount(r.tools, 2, 2)).toBe(1); // 原本 2 个
    expect(toolCount(r.tools, 0, 2)).toBe(1);
  });

  it('目标没有该道具则失败且状态不变', () => {
    const { tools, stock: s } = seeded();
    const r = applyRobCard(four(), 0, tgt(2), tools, s, 5);
    expect(r).toMatchObject({ ok: false, error: 'nothingToRob' });
    expect(r.tools).toEqual(tools);
  });

  it('★ 出牌者已满 9 个时，道具凭空消失——原版两函数组合的结果', () => {
    let t = emptyTools(4);
    let s = stock();
    // 出牌者塞满 9 个 11 号（不受库存限制）
    for (let i = 0; i < 9; i++) {
      const r = giveTool(t, s, 0, 11);
      t = r.tools;
      s = r.stock;
    }
    // 目标有一个
    const g = giveTool(t, s, 2, 11);
    t = g.tools;
    s = g.stock;

    const r = applyRobCard(four(), 0, tgt(2), t, s, 11);
    expect(r.ok).toBe(true);
    expect(toolCount(r.tools, 2, 11)).toBe(0); // 被拿走
    expect(toolCount(r.tools, 0, 11)).toBe(9); // 但没加上去
  });
});

describe('目标校验', () => {
  it('不能抢自己', () => {
    const { tools, stock: s } = seeded();
    expect(applyRobCard(four(), 2, tgt(2), tools, s, 7).error).toBe('cannotTargetSelf');
  });

  it('地块目标被拒', () => {
    const { tools, stock: s } = seeded();
    const r = applyRobCard(four(), 0, { kind: 'entity', entityId: 1 }, tools, s, 7);
    expect(r.error).toBe('wrongTargetKind');
  });

  it('越界被拒', () => {
    const { tools, stock: s } = seeded();
    expect(applyRobCard(four(), 0, tgt(9), tools, s, 7).error).toBe('playerOutOfRange');
  });
});

describe('可抢清单', () => {
  it('列出目标持有的道具编号', () => {
    const { tools } = seeded();
    expect(robbableTools(tools, 2)).toEqual([2, 7, 11]);
  });

  it('空手则为空', () => {
    expect(robbableTools(emptyTools(4), 0)).toEqual([]);
  });
});


// ============================================================
//  卡片路径（T-003，@source 0x441ae2：0x441343 取卡 + 0x4412e4 给卡）
// ============================================================

describe('搶奪 · 卡片路径', () => {
  it('卡从目标手牌转到出牌者', () => {
    const players = four();
    players[2] = { ...players[2]!, cards: [5, 9, 12] };
    const r = applyRobCardCard(players, 0, 2, 9);
    expect(r.ok).toBe(true);
    expect(r.robbed).toBe(9);
    expect(r.players[2]!.cards).toEqual([5, 12]);
    expect(r.players[0]!.cards).toEqual([9]);
  });

  it('对方没有该卡 → nothingToRob，双方手牌不变', () => {
    const players = four();
    players[2] = { ...players[2]!, cards: [5] };
    players[0] = { ...players[0]!, cards: [1] };
    const r = applyRobCardCard(players, 0, 2, 9);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('nothingToRob');
    expect(r.players[2]!.cards).toEqual([5]);
    expect(r.players[0]!.cards).toEqual([1]);
  });

  it('不能抢自己 / 下标越界', () => {
    expect(applyRobCardCard(four(), 0, 0, 9).error).toBe('cannotTargetSelf');
    expect(applyRobCardCard(four(), 0, 9, 9).error).toBe('playerOutOfRange');
  });

  it('★ 手牌满 15 张时先弃价格最低者再收入（0x44128f 同价留先）', () => {
    // 手牌：14 张停留卡(20 元) + 1 张送神符(10 元)；抢来漲價卡(35 元)
    const players = four();
    players[0] = {
      ...players[0]!,
      cards: [22, ...new Array<number>(14).fill(14)],
    };
    players[2] = { ...players[2]!, cards: [27] };
    const r = applyRobCardCard(players, 0, 2, 27);
    expect(r.ok).toBe(true);
    expect(r.players[0]!.cards).toHaveLength(15);
    // 最便宜的是送神符(22, 10 元) → 被弃；漲價卡入手
    expect(r.players[0]!.cards).not.toContain(22);
    expect(r.players[0]!.cards[14]).toBe(27);
  });

  it('robbableCards 列出目标手牌供选单使用', () => {
    const players = four();
    players[1] = { ...players[1]!, cards: [3, 3, 7] };
    expect(robbableCards(players, 1)).toEqual([3, 3, 7]);
    expect(robbableCards(players, 0)).toEqual([]);
  });
});
