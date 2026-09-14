/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 百貨公司
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  buyCard,
  buyTool,
  cardPrice,
  resellValue,
  sellCard,
  sellTool,
  toolPrice,
} from './shop.ts';
import { emptyTools, initialToolStock, toolCount, TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
import { MAX_HAND_CARDS } from '../rules/special-square.ts';

const tools = () => emptyTools(4);
const stock = () => initialToolStock();

describe('標價', () => {
  it('★ 与 exe 的卡片/道具表一致', () => {
    // @source byte [id*8 + 0x47fdef] / [id*8 + 0x47fedf]
    expect(cardPrice(1)).toBe(200); // 均富卡
    expect(cardPrice(3)).toBe(35); // 購地卡
    expect(toolPrice(5)).toBe(80); // 機車
    expect(toolPrice(6)).toBe(150); // 汽車
    expect(toolPrice(13)).toBe(250); // 核子飛彈
  });

  it('未知编号標價为 0', () => {
    expect(cardPrice(999)).toBe(0);
    expect(toolPrice(0)).toBe(0);
  });
});

describe('回收价', () => {
  it('★ 退九成，向零取整', () => {
    // @source fmul qword 0.9 / __round_toward_zero
    expect(resellValue(100)).toBe(90);
    expect(resellValue(35)).toBe(31); // 31.5 → 31
    expect(resellValue(25)).toBe(22); // 22.5 → 22
    expect(resellValue(1)).toBe(0);
  });
});

describe('★ 买卡', () => {
  it('★ 扣的是點數，不是钱', () => {
    const p = makePlayer({ points: 300, cash: 1000 });
    const r = buyCard(p, 1);
    expect(r.ok).toBe(true);
    expect(r.player.points).toBe(100); // 300 − 200
    expect(r.player.cash).toBe(1000); // 现金没动
    expect(r.player.cards).toEqual([1]);
  });

  it('點數不够买不了', () => {
    const r = buyCard(makePlayer({ points: 10, cash: 999_999 }), 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('notEnoughPoints');
  });

  it('满手牌买不了', () => {
    const p = makePlayer({ points: 9999, cards: new Array<number>(MAX_HAND_CARDS).fill(2) });
    expect(buyCard(p, 1).error).toBe('handFull');
  });
});

describe('★ 买道具', () => {
  it('★ 汽車 150 點 —— 这条一通，車就买得到了', () => {
    const p = makePlayer({ index: 0, points: 200 });
    const r = buyTool(p, tools(), stock(), 6);
    expect(r.ok).toBe(true);
    expect(r.player.points).toBe(50);
    expect(toolCount(r.tools, 0, 6)).toBe(1);
    // 编号 ≤ 8 要扣全局库存
    expect(r.stock[6]).toBe(initialToolStock()[6]! - 1);
  });

  it('★ 编号 > 8 不限量 —— 库存那一栏本来就是 0', () => {
    const p = makePlayer({ index: 0, points: 9999 });
    const r = buyTool(p, tools(), stock(), 12); // 工程車
    expect(r.ok).toBe(true);
    expect(toolCount(r.tools, 0, 12)).toBe(1);
  });

  it('全局库存空了就买不到', () => {
    const s = stock();
    s[6] = 0;
    expect(buyTool(makePlayer({ points: 9999 }), tools(), s, 6).error).toBe('outOfStock');
  });

  it('每种最多 9 个', () => {
    const t = tools();
    t[0 * TOOL_SLOTS_PER_PLAYER + 6] = 9;
    expect(buyTool(makePlayer({ index: 0, points: 9999 }), t, stock(), 6).error).toBe('toolLimit');
  });
});

describe('★ 卖', () => {
  it('★ 卖卡退九成', () => {
    const p = makePlayer({ points: 0, cards: [1] });
    const r = sellCard(p, 1);
    expect(r.ok).toBe(true);
    expect(r.player.points).toBe(180); // trunc(200 × 0.9)
    expect(r.player.cards).toEqual([]);
  });

  it('没有这张卡卖不了', () => {
    expect(sellCard(makePlayer({ cards: [] }), 1).error).toBe('notOwned');
  });

  it('★ 卖道具：先算總價再乘 0.9，不是逐个算完再加', () => {
    const t = tools();
    t[0 * TOOL_SLOTS_PER_PLAYER + 3] = 3; // 三个地雷，單價 25
    const r = sellTool(makePlayer({ index: 0, points: 0 }), t, stock(), 3, 3);
    expect(r.ok).toBe(true);
    // 總價 75 × 0.9 = 67.5 → 67；逐个算则是 22×3 = 66，**不一样**
    expect(r.player.points).toBe(67);
    expect(toolCount(r.tools, 0, 3)).toBe(0);
  });

  it('★ 卖道具要把全局库存还回去', () => {
    const t = tools();
    t[0 * TOOL_SLOTS_PER_PLAYER + 5] = 2;
    const s = stock();
    const before = s[5]!;
    const r = sellTool(makePlayer({ index: 0 }), t, s, 5, 2);
    expect(r.stock[5]).toBe(before + 2);
  });

  it('卖得比有的多会被拒', () => {
    const t = tools();
    t[0 * TOOL_SLOTS_PER_PLAYER + 5] = 1;
    expect(sellTool(makePlayer({ index: 0 }), t, stock(), 5, 2).error).toBe('notOwned');
  });
});
