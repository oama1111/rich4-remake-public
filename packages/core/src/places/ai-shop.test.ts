/*
 * 电脑逛百貨公司（`_rich4_ui_shop_entry` 电脑那一支 `0x0042ed8d..0x0042f307`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第二十六份試玩回報（`20260924-234350490`）「约翰乔的汽车哪里来的」：汽車是电脑在百貨公司买的 ——
 * 原版确有这一手（`0x0042f211 push 6 / call 0x42d272`），但条件是「道具预算 = 點券 − 點券>>1、
 * 先買機車、价 < 预算、手里没有这种车」。逐段取证见 `ai-shop.ts` 文件头。
 */
import { describe, expect, it } from 'vitest';
import { CARDS, TOOLS } from '@rich4/data';
import { makePlayer } from '../testing/factories.ts';
import { initialCardAmounts } from '../rules/new-game.ts';
import { emptyTools, initialToolStock, toolCount, TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
import { TRAFFIC_CAR, TRAFFIC_MOTORCYCLE, TRAFFIC_WALK } from '../rules/tool-effects.ts';
import { AI_SHOP_TOOL_ORDER, aiShopVisit } from './ai-shop.ts';
import type { Player } from '../state/types.ts';

/** 牌堆空（只看道具那一段）*/
const noCards = (): number[] => new Array<number>(30).fill(0);

function visit(over: Partial<Player>, opts: { tools?: number[]; cards?: number[]; stock?: number[] } = {}) {
  return aiShopVisit({
    player: makePlayer({ index: 0, personality: 2, trafficMethod: TRAFFIC_WALK, ...over }),
    tools: opts.tools ?? emptyTools(4),
    toolStock: opts.stock ?? initialToolStock(),
    cardAmount: opts.cards ?? noCards(),
  });
}

const withTool = (id: number, n: number): number[] => {
  const t = emptyTools(4);
  t[id] = n;
  return t;
};

describe('★★ 交通工具（V 段 0x0042f16c..0x0042f232）', () => {
  it('道具预算 = 點券 − 點券>>1；步行、手里没车：先買機車（80 < 预算），剩下的够才买汽車（150 < 剩余）', () => {
    // 460 → 预算 230 → 機車 → 150，`150 < 150` 不成立 ⇒ 不买汽車
    const a = visit({ points: 460 });
    // 其后 T 段拿剩下的 150：遙控骰子 30、路障 30、（飛彈 100 > 90 跳过）機器娃娃 15、定時炸彈 25、地雷 25
    expect(a.log.filter((s) => s.op === 'buyTool').map((s) => s.id)).toEqual([5, 8, 2, 1, 4, 3]);
    expect(toolCount(a.tools, 0, 6)).toBe(0);
    // 461 → 预算 231 → 機車 → 151 ⇒ 汽車（剩 1）
    const b = visit({ points: 461 });
    expect(toolCount(b.tools, 0, 5)).toBe(1);
    expect(toolCount(b.tools, 0, 6)).toBe(1);
  });

  it('★ 先前的自拟规则「150 點就买汽車」不是原版：300 點只够買機車', () => {
    const r = visit({ points: 300 });
    expect(toolCount(r.tools, 0, 5)).toBe(1);
    expect(toolCount(r.tools, 0, 6)).toBe(0);
  });

  it('手里已有機車（没骑）⇒ 不再買機車，301 點（预算 151）就买汽車', () => {
    const r = visit({ points: 301 }, { tools: withTool(5, 1) });
    expect(toolCount(r.tools, 0, 5)).toBe(1);
    expect(toolCount(r.tools, 0, 6)).toBe(1);
  });

  it('手里已有汽車 ⇒ 不再买第二辆（`cmp byte [0x499161+..], 0 / jne`）', () => {
    const r = visit({ points: 900 }, { tools: withTool(6, 1) });
    expect(toolCount(r.tools, 0, 6)).toBe(1);
  });

  it('已经在开汽車 ⇒ 不买汽車，但**照样買機車**（原版機車那一支只看「是不是在骑機車」）', () => {
    const r = visit({ points: 900, trafficMethod: TRAFFIC_CAR, ndices: 3 });
    expect(toolCount(r.tools, 0, 5)).toBe(1);
    expect(toolCount(r.tools, 0, 6)).toBe(0);
  });

  it('库存没有 ⇒ 不买（`cmp byte [0x497325], 0 / je`）', () => {
    const stock = initialToolStock();
    stock[6] = 0;
    const r = visit({ points: 900 }, { stock });
    expect(toolCount(r.tools, 0, 6)).toBe(0);
  });

  it('點券只从道具那一半扣（不碰现金），库存同步减', () => {
    const r = visit({ points: 461, cash: 12345 });
    expect(r.player.cash).toBe(12345);
    expect(r.toolStock[5]).toBe(initialToolStock()[5]! - 1);
    expect(r.toolStock[6]).toBe(initialToolStock()[6]! - 1);
    // 卡那一半（230）没用上（牌堆空）⇒ 点券 = 461 − 80 − 150
    expect(r.player.points).toBe(461 - 80 - 150);
  });
});

describe('★ 其余六件（T 段，表 0x4755f0）', () => {
  it('顺序 8, 2, 7, 1, 4, 3；价 ≤ 预算（`jg` 跳过）就各买一件', () => {
    expect(AI_SHOP_TOOL_ORDER).toEqual([8, 2, 7, 1, 4, 3]);
    // 手里已有两种车 ⇒ V 段不花钱；预算 = 1000 − 500 = 500 ⇒ 六件都买得起
    const t = emptyTools(4);
    t[5] = 1;
    t[6] = 1;
    const r = visit({ points: 1000 }, { tools: t });
    expect(r.log.filter((s) => s.op === 'buyTool').map((s) => s.id)).toEqual([8, 2, 7, 1, 4, 3]);
  });

  it('乖寶寶（個性 0）不买 f7 = 2 的飛彈（`cmp esi, 2 / je` 跳过）', () => {
    const t = emptyTools(4);
    t[5] = 1;
    t[6] = 1;
    const r = visit({ points: 1000, personality: 0 }, { tools: t });
    expect(r.log.some((s) => s.op === 'buyTool' && s.id === 7)).toBe(false);
  });
});

describe('★ 变卖（S1..S3）', () => {
  it('S2：乖寶寶手里 f7 = 2 的道具整种卖光（九成）', () => {
    const r = visit({ points: 0, personality: 0 }, { tools: withTool(7, 3) });
    expect(toolCount(r.tools, 0, 7)).toBe(0);
    expect(r.log[0]).toEqual({ op: 'sellTool', id: 7, count: 3 });
  });

  it('S3：點券 < 100 ⇒ 多的道具卖到剩 1；骑機車就把手里的機車也卖掉', () => {
    const t = emptyTools(4);
    t[2] = 4;
    t[5] = 1;
    const r = visit({ points: 0, trafficMethod: TRAFFIC_MOTORCYCLE, ndices: 2 }, { tools: t });
    expect(r.log.slice(0, 2)).toEqual([
      { op: 'sellTool', id: 2, count: 3 },
      { op: 'sellTool', id: 5, count: 1 },
    ]);
    // 骑着機車 ⇒ V 段不再買機車（`and al,3 / cmp al,1 / je`）
    expect(toolCount(r.tools, 0, 5)).toBe(0);
  });

  it('S3：卖最便宜的一张卡，牌放回牌堆（`consume_card` 0x004413a2）', () => {
    const cheap = [...CARDS].sort((a, b) => a.price - b.price)[0]!;
    const dear = [...CARDS].sort((a, b) => b.price - a.price)[0]!;
    const r = visit({ points: 0, cards: [dear.id, cheap.id] });
    expect(r.player.cards).toEqual([dear.id]);
    expect(r.cardAmount[cheap.id - 1]).toBe(1);
  });

  it('點券为 0 且没东西可卖 ⇒ 什么都不做（`test bx, bx / je` 离店）', () => {
    const r = visit({ points: 0 });
    expect(r.log).toEqual([]);
  });
});

describe('★ 买卡（C 段）', () => {
  it('卡预算 = 點券>>1；价高者先；从牌堆扣', () => {
    const r = aiShopVisit({
      player: makePlayer({ index: 0, personality: 2, points: 400 }),
      tools: withTool(5, 1).map((v, i) => (i === 6 ? 1 : v)),
      toolStock: initialToolStock(),
      cardAmount: initialCardAmounts(),
    });
    const bought = r.log.filter((s) => s.op === 'buyCard').map((s) => s.id);
    expect(bought.length).toBeGreaterThan(0);
    const prices = bought.map((id) => CARDS.find((c) => c.id === id)!.price);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
    expect(prices.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
    for (const id of bought) expect(r.cardAmount[id - 1]).toBeLessThan(initialCardAmounts()[id - 1]!);
    expect(r.player.cards).toEqual(bought);
  });

  it('手牌满 15 ⇒ 不买（`0x0042f10d cmp eax, 0xf / je`）', () => {
    const full = new Array<number>(15).fill(CARDS[CARDS.length - 1]!.id);
    const r = aiShopVisit({
      player: makePlayer({ index: 0, personality: 2, points: 400, cards: full }),
      tools: emptyTools(4),
      toolStock: initialToolStock(),
      cardAmount: initialCardAmounts(),
    });
    expect(r.log.some((s) => s.op === 'buyCard')).toBe(false);
  });

  it('玩家 2 的道具落在自己那 15 格（不串到别人）', () => {
    const r = aiShopVisit({
      player: makePlayer({ index: 2, personality: 2, points: 461 }),
      tools: emptyTools(4),
      toolStock: initialToolStock(),
      cardAmount: noCards(),
    });
    expect(r.tools[2 * TOOL_SLOTS_PER_PLAYER + 6]).toBe(1);
    expect(r.tools[0 * TOOL_SLOTS_PER_PLAYER + 6]).toBe(0);
  });
});

/**
 * ★ 2026-09-25 审计（L48）：这一趟的營業額。
 *
 * 原版电脑那一支把每次买卖函数的**返回值**累加进 `ebp`，离店时
 * `0x0042f24f cmp eax,6 / jge 0x42ed50` 跳进真人支的同一段收尾，由
 * `0x42ed75/0x42ed7e` 记进那家企業的 `+0x28 / +0x2c`：
 *   买卡 `0x42d237` / 买道具 `0x42d272` 返回 **標價 × 10**、
 *   卖卡 `0x42d145` 返回 **標價**（不是到手的那 0.9 倍）、卖道具 `0x42d1b2` 返回 **標價 × 数量**。
 */
describe('★ L48 營業額（原版 ebp）', () => {
  const revenueOf = (r: ReturnType<typeof aiShopVisit>): number =>
    r.log.reduce((sum, s) => {
      if (s.op === 'buyCard' || s.op === 'buyTool') {
        const p = s.op === 'buyCard' ? CARDS.find((c) => c.id === s.id)!.price : TOOLS.find((t) => t.id === s.id)!.price;
        return sum + 10 * p;
      }
      if (s.op === 'sellCard') return sum + CARDS.find((c) => c.id === s.id)!.price;
      return sum + TOOLS.find((t) => t.id === s.id)!.price * s.count;
    }, 0);

  it('买道具 ⇒ 每件 標價 × 10；与 log 逐条算出来的一致', () => {
    const r = visit({ points: 461 });
    expect(r.log.some((s) => s.op === 'buyTool')).toBe(true);
    expect(r.revenue).toBeGreaterThan(0);
    expect(r.revenue).toBe(revenueOf(r));
    // 461 → 預算 231 → 機車（80）+ 汽車（150）… 逐件都是 10 × 標價
    expect(r.revenue % 10).toBe(0);
  });

  it('卖卡 / 卖道具记的是**標價**（全额），不是到手的 0.9 倍', () => {
    // 點券 < 100 ⇒ 走 S3 变卖：手里两张卡（先卖最便宜的）+ 一件多出来的道具
    const cards = [CARDS[0]!.id, CARDS[1]!.id];
    const r = aiShopVisit({
      player: makePlayer({ index: 0, personality: 2, points: 0, cards }),
      tools: withTool(1, 2),
      toolStock: initialToolStock(),
      cardAmount: noCards(),
    });
    const soldCard = r.log.find((s) => s.op === 'sellCard');
    expect(soldCard).toBeDefined();
    if (soldCard === undefined || soldCard.op !== 'sellCard') return;
    const price = CARDS.find((c) => c.id === soldCard.id)!.price;
    // 到手 = trunc(價 × 0.9)，营业额 = 全额 價 —— 两者必须不同（除不尽时才等）
    expect(r.revenue).toBe(revenueOf(r));
    expect(r.revenue).toBeGreaterThanOrEqual(price + TOOLS.find((t) => t.id === 1)!.price);
    expect(r.player.points).toBeLessThan(r.revenue);
  });

  it('什么都不做 ⇒ 營業額 0（不凭空记一笔）', () => {
    const r = visit({ points: 0 });
    expect(r.log).toEqual([]);
    expect(r.revenue).toBe(0);
  });
});
