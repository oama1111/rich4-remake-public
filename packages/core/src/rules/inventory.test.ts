/*
 * 变卖手牌与道具 —— 「變賣所有卡片道具」/ 破产清算共用
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 每条断言都对着 `_rich4_player_sell_all_tools`（VA 0x00445b3f）与
 * `_rich4_player_sell_all_the_card`（VA 0x00441f21）的逐句读法。
 */
import { describe, expect, it } from 'vitest';
import { CARDS, TOOLS, cardById, toolById } from '@rich4/data';
import { makePlayer } from '../testing/factories.ts';
import { MAX_TOOL_ID, TOOL_SLOTS_PER_PLAYER } from './tools.ts';
import {
  VEHICLE_TOOL,
  cardPrice,
  sellAllCards,
  sellAllTools,
  toolPrice,
} from './inventory.ts';

/** 造一份「玩家的道具表」*/
const toolsOf = (index: number, counts: Record<number, number>): number[] => {
  const out = new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);
  for (const [id, n] of Object.entries(counts)) out[index * TOOL_SLOTS_PER_PLAYER + Number(id)] = n;
  return out;
};

describe('★ 道具卖价 = 道具表的 price @source `byte [eax*8 + 0x47fee7]`', () => {
  it('13 件道具逐条对上（表项 +5 那个字节）', () => {
    for (const t of TOOLS) expect(toolPrice(t.id), t.name).toBe(t.price);
    expect(TOOLS).toHaveLength(13);
    // 抽样：機車 80 / 汽車 150 / 核子飛彈 250
    expect(toolPrice(5)).toBe(80);
    expect(toolPrice(6)).toBe(150);
    expect(toolPrice(13)).toBe(250);
    // 全部塞得进一个**字节**（原版读的是 byte）
    for (const t of TOOLS) expect(t.price).toBeLessThan(256);
  });

  it('★ 卡片卖价 = 卡片表的 price（原版同样读 byte）', () => {
    for (const c of CARDS) expect(cardPrice(c.id), c.name).toBe(c.price);
    expect(cardPrice(1)).toBe(cardById(1)!.price);
    for (const c of CARDS) expect(c.price).toBeLessThan(256);
  });
});

describe('★ 座驾折回道具 @source `[0x499160/0x499161/0x499167]`', () => {
  it('★ 1/2/3 → 道具 5 機車 / 6 汽車 / 12 工程車', () => {
    expect([...VEHICLE_TOOL.entries()]).toEqual([
      [1, 5],
      [2, 6],
      [3, 12],
    ]);
    for (const [kind, id] of VEHICLE_TOOL) {
      const r = sellAllTools(
        makePlayer({ index: 0, trafficMethod: kind, ndices: 3 }),
        toolsOf(0, {}),
        new Array<number>(14).fill(0),
      );
      // 折进来的那台车**当场被卖掉**，所以持有量仍是 0，但钱进了所得
      expect(r.tools[0 * TOOL_SLOTS_PER_PLAYER + id], `kind=${kind}`).toBe(0);
      expect(r.points, `kind=${kind}`).toBe(toolPrice(id!));
      // 同时下车、退回一颗骰子
      expect(r.player.trafficMethod).toBe(0);
      expect(r.player.ndices).toBe(1);
    }
  });

  it('★ 走路（traffic 0）不折道具', () => {
    const p = makePlayer({ index: 0, trafficMethod: 0, ndices: 2 });
    const r = sellAllTools(p, toolsOf(0, {}), []);
    expect(r.points).toBe(0);
    expect(r.player.ndices).toBe(2); // 没动
    expect(r.player).toBe(p); // 连对象都没换
  });

  it('★ `traffic & 3 == 0` 但 traffic != 0 ⇒ 只下车、不折道具', () => {
    const r = sellAllTools(
      makePlayer({ index: 0, trafficMethod: 4, ndices: 3 }),
      toolsOf(0, {}),
      [],
    );
    expect(r.points).toBe(0);
    expect(r.player.trafficMethod).toBe(0);
    expect(r.player.ndices).toBe(1);
  });
});

describe('★ 卖光道具 @source VA 0x00445b3f 的循环', () => {
  it('★ 所得 = Σ 持有量 × 原价；持有量清零', () => {
    const tools = toolsOf(0, { 3: 2, 7: 1 }); // 地雷 25×2 + 飛彈 100×1
    const r = sellAllTools(makePlayer({ index: 0 }), tools, new Array<number>(14).fill(0));
    expect(r.points).toBe(2 * 25 + 100);
    for (let id = 1; id <= MAX_TOOL_ID; id++) {
      expect(r.tools[0 * TOOL_SLOTS_PER_PLAYER + id]).toBe(0);
    }
  });

  it('★ 只有编号 ≤ 8 的**还回商店库存** @source `cmp eax, 8 / jge`', () => {
    const stock = new Array<number>(14).fill(0);
    const r = sellAllTools(makePlayer({ index: 0 }), toolsOf(0, { 2: 3, 9: 2, 13: 1 }), stock);
    expect(r.toolStock[2]).toBe(3); // 路障 ≤ 8 ⇒ 回库存
    expect(r.toolStock[9]).toBe(0); // 機器工人 ≥ 9 ⇒ 不回（本来也不限量）
    expect(r.toolStock[13]).toBe(0);
    // 但它们照样卖钱
    expect(r.points).toBe(3 * 30 + 2 * 30 + 250);
  });

  it('★ 只动当前这名玩家的槽位', () => {
    const tools = toolsOf(1, { 2: 5 });
    const r = sellAllTools(makePlayer({ index: 0 }), tools, new Array<number>(14).fill(0));
    expect(r.points).toBe(0);
    expect(r.tools[1 * TOOL_SLOTS_PER_PLAYER + 2]).toBe(5);
  });
});

describe('★ 卖光手牌 @source VA 0x00441f21', () => {
  it('★ 每张按原价卖、回商店库存、手牌清空', () => {
    const stock = new Array<number>(30).fill(0);
    const p = makePlayer({ index: 0, cards: [1, 1, 7] });
    const r = sellAllCards(p, stock);
    const expectPoints = cardPrice(1) * 2 + cardPrice(7);
    expect(r.points).toBe(expectPoints);
    expect(r.player.cards).toEqual([]);
    expect(r.cardAmount[0]).toBe(2); // 卡片 1 回了两张
    expect(r.cardAmount[6]).toBe(1); // 卡片 7 回了一张
  });

  it('★ 空手牌 ⇒ 一分不得、库存不动', () => {
    const r = sellAllCards(makePlayer({ index: 0, cards: [] }), new Array<number>(30).fill(0));
    expect(r.points).toBe(0);
    expect(r.cardAmount.every((v) => v === 0)).toBe(true);
  });
});

describe('★ 两件事都是**纯函数**（不改入参）', () => {
  it('道具表 / 库存 / 手牌数组都不被就地改写', () => {
    const tools = toolsOf(0, { 2: 1 });
    const stock = new Array<number>(14).fill(0);
    const before = [...tools];
    sellAllTools(makePlayer({ index: 0 }), tools, stock);
    expect(tools).toEqual(before);
    const cards = [3, 4];
    const p = makePlayer({ index: 0, cards });
    const s2 = new Array<number>(30).fill(0);
    sellAllCards(p, s2);
    expect(cards).toEqual([3, 4]);
    expect(s2.every((v) => v === 0)).toBe(true);
  });

  it('未知编号不炸（表里没有就按 0 算）', () => {
    expect(toolById(99)).toBeUndefined();
    expect(toolPrice(99)).toBe(0);
    expect(cardPrice(99)).toBe(0);
  });
});
