/*
 * 道具欄 / 卡片欄 浮窗的网格与取数（T-024）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 exe（VA 0x445c8f 的命中、VA 0x447cde 的绘制），
 * 把容易写错的几条钉住：格子是 5×3 的 80×56、原点 (19,135)；
 * 道具**紧排**且只列数量 > 0 的；卡片槽号就是数组下标。
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@rich4/core';
import {
  INV_BASE,
  INV_CELL,
  INV_ORIGIN,
  INV_RESOURCE,
  INV_SLOTS,
  INV_VEHICLE_IMAGE,
  cardEntries,
  hitInventory,
  invCellRect,
  toolEntries,
  toolIsDirect,
} from './inventory.ts';

describe('浮窗几何 @source VA 0x445c8f', () => {
  it('★ 底图是 Panel.mkf 资源 11，道具用图 1、卡片用图 0，落在 (14,130)', () => {
    expect(INV_RESOURCE).toBe(11);
    expect(INV_BASE).toEqual({ cards: 0, tools: 1 });
    expect(INV_ORIGIN).toEqual({ x: 14, y: 130 });
  });

  it('★ 5×3 = 15 格，格 80×56、原点 (19,135)；最后一格右下角正好落在 (419,303)', () => {
    expect(INV_SLOTS).toBe(15);
    expect(INV_CELL).toEqual({ x0: 19, y0: 135, w: 80, h: 56, cols: 5, rows: 3 });
    expect(invCellRect(0)).toEqual({ x: 19, y: 135, w: 80, h: 56 });
    expect(invCellRect(4)).toEqual({ x: 339, y: 135, w: 80, h: 56 });
    expect(invCellRect(5)).toEqual({ x: 19, y: 191, w: 80, h: 56 });
    expect(invCellRect(14)).toEqual({ x: 339, y: 247, w: 80, h: 56 });
  });

  it('★ 命中：每格中心命中自己，边界外不认', () => {
    for (let slot = 0; slot < INV_SLOTS; slot++) {
      const r = invCellRect(slot);
      expect(hitInventory(r.x + r.w / 2, r.y + r.h / 2)).toBe(slot);
      expect(hitInventory(r.x, r.y)).toBe(slot); // 左上边界算在内
    }
    expect(hitInventory(418, 302)).toBe(14); // 最后一个像素
    expect(hitInventory(419, 302)).toBeNull(); // 右边界不算
    expect(hitInventory(18, 200)).toBeNull();
    expect(hitInventory(100, 303)).toBeNull();
    expect(hitInventory(100, 134)).toBeNull();
  });
});

describe('格子内容（T-024）', () => {
  /** 只填这一屏用得到的字段 */
  const stateOf = (tools: number[], cards: number[] = []): GameState =>
    ({
      // 道具是**全局表**，步长 15
      tools,
      players: [{ index: 0, cards, trafficMethod: 0 }],
    }) as unknown as GameState;

  it('★ 道具緊排：数量为 0 的跳过且不占格（S8 截图证实 8 号排第 5 格）', () => {
    const tools = new Array<number>(30).fill(0);
    for (const id of [1, 2, 3, 4, 8, 9]) tools[id] = 1;
    const got = toolEntries(stateOf(tools), 0);
    expect(got.map((e) => e.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(got.map((e) => e.id)).toEqual([1, 2, 3, 4, 8, 9]);
    expect(got.every((e) => e.count === 1)).toBe(true);
  });

  it('★ 道具数量原样带出来（同一件可以有多个）', () => {
    const tools = new Array<number>(30).fill(0);
    tools[1] = 3;
    tools[5] = 7;
    expect(toolEntries(stateOf(tools), 0)).toEqual([
      { slot: 0, id: 1, count: 3 },
      { slot: 1, id: 5, count: 7 },
    ]);
  });

  it('★ 只取**当前玩家**那一行（道具表步长 15）', () => {
    const tools = new Array<number>(30).fill(0);
    tools[15 + 1] = 2; // 玩家 1 的道具 1
    expect(toolEntries(stateOf(tools), 0)).toEqual([]);
    expect(toolEntries(stateOf(tools), 1)).toEqual([{ slot: 0, id: 1, count: 2 }]);
  });

  it('★ 卡片槽号就是数组下标（原版两边都按 player_cards[玩家×15+下标] 取）', () => {
    expect(cardEntries(stateOf([], [3, 0, 7]), 0)).toEqual([
      { slot: 0, id: 3, count: 1 },
      { slot: 2, id: 7, count: 1 },
    ]);
    expect(cardEntries(stateOf([], []), 0)).toEqual([]);
  });
});

describe('选中之后归谁管', () => {
  it('★ 機器娃娃 / 机車 / 汽車 / 時光機 不用再问，直接发 useTool', () => {
    // 機器娃娃是自动的（原版 AI 那一支直接回 `PLAIN`，VA 0x420f4d 一带）
    expect(toolIsDirect(1)).toBe(true);
    expect(toolIsDirect(5)).toBe(true); // 機車
    expect(toolIsDirect(6)).toBe(true); // 汽車
    expect(toolIsDirect(10)).toBe(true); // 時光機（只需要快照，不需要目标）
  });

  it('★ 其他的都要先选目标/点数 —— 那段属 T-026', () => {
    for (const id of [2, 3, 4, 7, 8, 9, 11, 12, 13]) expect(toolIsDirect(id)).toBe(false);
  });

  it('★ 载具徽章：机車 = 图 15、汽車 = 图 16，其余（走路）没有', () => {
    expect(INV_VEHICLE_IMAGE.get(1)).toBe(15);
    expect(INV_VEHICLE_IMAGE.get(2)).toBe(16);
    expect(INV_VEHICLE_IMAGE.get(0)).toBeUndefined();
  });
});
