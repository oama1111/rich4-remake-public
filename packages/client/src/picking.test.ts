/*
 * 目标拾取模式（T-026）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里钉的是**指针形状规则**（原版选目标的唯一反馈）与「候选/命中」这两件
 * 纯计算。候选的**合法性**本身在 core（`preview.ts`），那边有自己的测试。
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology } from '@rich4/core';
import {
  PICK_CURSOR_INVALID,
  TOOL_SELECT_PARAM,
  classNeedsItsOwnList,
  hitCandidate,
  pickCursorSpec,
  startPick,
} from './picking.ts';

describe('指针形状 @source VA 0x445ec1', () => {
  it('★ 形状 = 选择参数的高 16 位（次高字节清掉）—— 所以指针就是那件道具的图标', () => {
    // 路障 `1` → 图 0（STOP 牌子）
    expect(pickCursorSpec(0x1).image).toBe(0);
    // 地雷 `0x10001` → 图 1（尖刺球）
    expect(pickCursorSpec(0x10001).image).toBe(1);
    // 定時炸彈 `0x20001` → 图 2（炸彈）
    expect(pickCursorSpec(0x20001).image).toBe(2);
    // 飛彈 `0x300c0` / 核子飛彈 `0x400c0` → 图 3 / 4
    expect(pickCursorSpec(0x300c0).image).toBe(3);
    expect(pickCursorSpec(0x400c0).image).toBe(4);
    // 各张卡 `0xe0c0XYZ` → 图 12（「卡片」光标）
    expect(pickCursorSpec(0xe0c0202).image).toBe(12);
  });

  it('★ 热点 x = 高 16 位的**高字节** + 1、y 固定 0xa', () => {
    expect(pickCursorSpec(0x1)).toEqual({ image: 0, hotX: 1, hotY: 0xa });
    expect(pickCursorSpec(0x10001).hotX).toBe(1);
    // 各张卡：与 asm 里的 `fcn_004021f8(12, 15, 10)` 逐位对上
    expect(pickCursorSpec(0xe0c0202)).toEqual({ image: 12, hotX: 15, hotY: 10 });
  });

  it('★ 选不中时是红叉（图 5）', () => {
    expect(PICK_CURSOR_INVALID).toEqual({ image: 5, hotX: 1, hotY: 0 });
  });

  it('★ 道具的选择参数表与 asm 对得上（路障只认格子、bit3 才是「目标必选」）', () => {
    expect(TOOL_SELECT_PARAM.get(2)).toBe(0x1); // 路障
    expect(TOOL_SELECT_PARAM.get(3)).toBe(0x10001);
    expect(TOOL_SELECT_PARAM.get(4)).toBe(0x20001);
    // 这几件的低字节都没有 bit3 → 右键能取消
    for (const v of TOOL_SELECT_PARAM.values()) expect(v & 0x8).toBe(0);
  });
});

describe('会话与候选', () => {
  const topo = {
    nodes: [
      { id: 1, x: 100, y: 100, ref: { kind: 'land', index: 1 }, adjacent: [] },
      { id: 2, x: 300, y: 100, ref: { kind: 'facility', index: 1 }, adjacent: [] },
      { id: 3, x: 300, y: 300, ref: { kind: 'special' }, adjacent: [] },
    ],
    lands: [],
    facilities: [],
    commercials: [],
  } as unknown as MapTopology;

  const stateOf = (over: Record<string, unknown> = {}): GameState =>
    ({
      players: [{ index: 0, nodeId: 1, cards: [] }],
      tools: new Array<number>(30).fill(0),
      objects: [],
      specialActors: [],
      currentPlayer: 0,
      ...over,
    }) as unknown as GameState;

  it('★ 库存里没有这件道具 → 一个候选都没有（也不会炸）', () => {
    const s = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x1);
    expect(s.candidates).toEqual([]);
  });

  it('★ 目标必选（bit3）时右键取消不了', () => {
    const a = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x1);
    expect(a.cancellable).toBe(true);
    const b = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x9);
    expect(b.cancellable).toBe(false);
  });

  it('★ 股票那一类没有棋盘落点 —— 它要自己的列表 UI', () => {
    expect(classNeedsItsOwnList('stock')).toBe(true);
    expect(classNeedsItsOwnList('land')).toBe(false);
    const s = startPick(stateOf(), topo, { kind: 'card', cardId: 24 }, 'stock', 0);
    expect(s.candidates).toEqual([]);
  });

  it('★ 命中：越近越优先，超出半径就不算', () => {
    const session = {
      source: { kind: 'tool' as const, toolId: 2 },
      targetClass: 'none' as const,
      param: 0x1,
      cancellable: true,
      candidates: [
        { wx: 100, wy: 100, target: { kind: 'node' as const, nodeId: 1 }, nodeId: 1 },
        { wx: 300, wy: 100, target: { kind: 'node' as const, nodeId: 2 }, nodeId: 2 },
      ],
    };
    const toScreen = (wx: number, wy: number) => ({ x: wx, y: wy });
    expect(hitCandidate(session, 110, 105, toScreen)).toBe(0);
    expect(hitCandidate(session, 290, 105, toScreen)).toBe(1);
    expect(hitCandidate(session, 200, 100, toScreen)).toBeNull(); // 两个都 >24
    // 越出画布的候选点不到（`toScreen` 返回 null）
    const offscreen = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x1);
    expect(hitCandidate(offscreen, 0, 0, () => null)).toBeNull();
  });
});
