/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 道具效果 —— 对照 rich4_tool_*.asm
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { OBJECT_NAMES } from './purchase.ts';
import { TOOL_SLOTS_PER_PLAYER, emptyTools, toolCount } from './tools.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from './objects.ts';
import { TOOLS } from '@rich4/data';
import type { Player } from '../state/types.ts';
import {
  PLACEMENT_TOOLS,
  TRAFFIC_WALK,
  TRAFFIC_CAR,
  TRAFFIC_ENGINEERING,
  TRAFFIC_MOTORCYCLE,
  UNIMPLEMENTED_TOOLS,
  VEHICLE_DICE,
  isToolImplemented,
  placeObject,
  useVehicleTool,
} from './tool-effects.ts';

describe('★ 骰子数由交通工具决定', () => {
  it('步行 1、機車 2、汽車 3', () => {
    expect(VEHICLE_DICE.get(0)).toBe(1);
    expect(VEHICLE_DICE.get(TRAFFIC_MOTORCYCLE)).toBe(2);
    expect(VEHICLE_DICE.get(TRAFFIC_CAR)).toBe(3);
  });

  it('用機車：traffic=1、ndices=2', () => {
    const r = useVehicleTool(makePlayer({ trafficMethod: 0, ndices: 1 }), emptyTools(4), 5);
    expect(r.ok).toBe(true);
    expect(r.player.trafficMethod).toBe(TRAFFIC_MOTORCYCLE);
    expect(r.player.ndices).toBe(2);
  });

  it('用汽車：traffic=2、ndices=3', () => {
    const r = useVehicleTool(makePlayer({ trafficMethod: 0 }), emptyTools(4), 6);
    expect(r.player.trafficMethod).toBe(TRAFFIC_CAR);
    expect(r.player.ndices).toBe(3);
  });

  it('★ 工程車 traffic=31，且 31&3=3 → 设施过路费倍率取到最贵的 4', () => {
    const r = useVehicleTool(makePlayer({ trafficMethod: 0 }), emptyTools(4), 12);
    expect(r.player.trafficMethod).toBe(TRAFFIC_ENGINEERING);
    expect(TRAFFIC_ENGINEERING & 3).toBe(3);
    expect(r.player.ndices).toBe(1);
  });
});

describe('★ 换乘会退还原有交通工具', () => {
  it('开着汽車用機車 → 汽車退回道具栏', () => {
    const p = makePlayer({ index: 1, trafficMethod: TRAFFIC_CAR });
    const r = useVehicleTool(p, emptyTools(4), 5);
    expect(toolCount(r.tools, 1, 6)).toBe(1); // 汽車 = 道具 6
    expect(r.player.trafficMethod).toBe(TRAFFIC_MOTORCYCLE);
  });

  it('骑着機車用汽車 → 機車退回', () => {
    const p = makePlayer({ index: 2, trafficMethod: TRAFFIC_MOTORCYCLE });
    const r = useVehicleTool(p, emptyTools(4), 6);
    expect(toolCount(r.tools, 2, 5)).toBe(1);
  });

  it('步行时换乘没有可退还的', () => {
    const r = useVehicleTool(makePlayer({ trafficMethod: 0 }), emptyTools(4), 5);
    expect(r.tools.every((v) => v === 0)).toBe(true);
  });
});

describe('★ 已经是同一种交通工具时白用——且不消耗道具', () => {
  it('骑機車再用機車：ok 为 false，状态不变', () => {
    const p = makePlayer({ trafficMethod: TRAFFIC_MOTORCYCLE, ndices: 2 });
    const r = useVehicleTool(p, emptyTools(4), 5);
    expect(r.ok).toBe(false);
    expect(r.player).toBe(p);
  });

  it('开汽車再用汽車同理', () => {
    const p = makePlayer({ trafficMethod: TRAFFIC_CAR });
    expect(useVehicleTool(p, emptyTools(4), 6).ok).toBe(false);
  });

  it('非交通工具编号返回 false', () => {
    expect(useVehicleTool(makePlayer(), emptyTools(4), 1).ok).toBe(false);
  });
});

describe('★ 放置类道具的物件种类', () => {
  it('路障 16 / 地雷 17 / 定時炸彈 18，与物件名表对上', () => {
    expect(PLACEMENT_TOOLS.get(2)).toBe(16);
    expect(PLACEMENT_TOOLS.get(3)).toBe(17);
    expect(PLACEMENT_TOOLS.get(4)).toBe(18);
    expect(OBJECT_NAMES[16]).toBe('路障');
    expect(OBJECT_NAMES[17]).toBe('地雷');
    expect(OBJECT_NAMES[18]).toBe('定時炸彈');
  });

  it('放置占用本种类分区里的一个空槽', () => {
    const objs = makeObjects(OBJECT_COUNT);
    const r = placeObject(objs, 42, 16);
    expect(r.ok).toBe(true);
    expect(r.objects[r.slot]).toMatchObject({ type: 16, nodeId: 42 });
  });

  it('★ 不会覆盖同区里已在地图上的物件', () => {
    const objs = makeObjects(OBJECT_COUNT);
    objs[0x10] = { type: 16, nodeId: 10, state: 0, attached: 0 };
    const r = placeObject(objs, 42, 16);
    expect(r.slot).toBe(0x11);
    expect(r.objects[0x10]!.nodeId).toBe(10);
  });

  it('本区放满时失败', () => {
    const objs = makeObjects(OBJECT_COUNT).map((o) => ({ ...o, nodeId: 5 }));
    expect(placeObject(objs, 42, 16).ok).toBe(false);
  });
});

describe('★ 未实现的道具明确列出', () => {
  it('已实现的是 2/3/4（放置）与 5/6/12（交通）', () => {
    for (const id of [2, 3, 4, 5, 6, 12]) {
      expect(isToolImplemented(id), `道具${id}`).toBe(true);
    }
  });

  it('其余 7 个标为未实现', () => {
    expect([...UNIMPLEMENTED_TOOLS].sort((a, b) => a - b)).toEqual([1, 7, 8, 9, 10, 11, 13]);
    for (const id of UNIMPLEMENTED_TOOLS) {
      expect(isToolImplemented(id), `道具${id}`).toBe(false);
    }
  });

  it('13 个道具都有明确归属，没有遗漏', () => {
    const done = [2, 3, 4, 5, 6, 12];
    const all = [...done, ...UNIMPLEMENTED_TOOLS].sort((a, b) => a - b);
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});

/*
 * ★ M2 验收：「全部 13 个道具各有测试用例且通过」
 *
 * 逐个点名。已实现的验其行为，未实现的要求它**明确登记在案**——
 * 不允许一个道具既没实现、又不在未实现清单里悄悄溜过去。
 */
describe('★ 13 个道具逐个点名', () => {
  const player = (over: Partial<Player> = {}): Player =>
    makePlayer({ index: 0, trafficMethod: TRAFFIC_WALK, ndices: 1, ...over });
  const emptySlots = (): number[] => new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);

  it('1 機器娃娃 —— 未实现，已登记', () => {
    expect(isToolImplemented(1)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(1);
  });

  // ★ 槽位是**按种类分区**的（place_object VA 0x0040e033）：
  //   路障 16..25、地雷 26..35、定時炸彈 36..45。
  //   先前这里断言的是「落在 0 号槽」——那是把「第一个空槽」当成了
  //   原版行为，会把 0 号（小財神）槽的种类改写掉。
  it('2 路障 —— 放置物件 16，落在 16..25 区', () => {
    expect(PLACEMENT_TOOLS.get(2)).toBe(16);
    const r = placeObject(makeObjects(OBJECT_COUNT), 12, 16);
    expect(r.ok).toBe(true);
    expect(r.slot).toBe(0x10);
    expect(r.objects[r.slot]).toMatchObject({ type: 16, nodeId: 12 });
    // 0 号槽仍是小財神，没被动过
    expect(r.objects[0]).toMatchObject({ type: 1, nodeId: 0 });
  });

  it('3 地雷 —— 放置物件 17，落在 26..35 区', () => {
    expect(PLACEMENT_TOOLS.get(3)).toBe(17);
    const r = placeObject(makeObjects(OBJECT_COUNT), 5, 17);
    expect(r.slot).toBe(0x1a);
    expect(r.objects[0x1a]).toMatchObject({ type: 17, nodeId: 5 });
  });

  it('4 定時炸彈 —— 放置物件 18，落在 36..45 区', () => {
    expect(PLACEMENT_TOOLS.get(4)).toBe(18);
    const r = placeObject(makeObjects(OBJECT_COUNT), 5, 18);
    expect(r.slot).toBe(0x24);
    expect(r.objects[0x24]).toMatchObject({ type: 18, nodeId: 5 });
  });

  it('★ 同一种类放满 10 个之后就放不下了', () => {
    let objects = makeObjects(OBJECT_COUNT);
    for (let i = 0; i < 10; i++) {
      const r = placeObject(objects, i + 1, 16);
      expect(r.ok).toBe(true);
      objects = r.objects;
    }
    expect(placeObject(objects, 99, 16).ok).toBe(false);
    // 但地雷区还是空的
    expect(placeObject(objects, 99, 17).ok).toBe(true);
  });

  it('5 機車 —— 交通方式 1、骰子 2', () => {
    const r = useVehicleTool(player(), emptySlots(), 5);
    expect(r.ok).toBe(true);
    expect(r.player.trafficMethod).toBe(TRAFFIC_MOTORCYCLE);
    expect(r.player.ndices).toBe(2);
  });

  it('6 汽車 —— 交通方式 2、骰子 3', () => {
    const r = useVehicleTool(player(), emptySlots(), 6);
    expect(r.ok).toBe(true);
    expect(r.player.trafficMethod).toBe(TRAFFIC_CAR);
    expect(r.player.ndices).toBe(3);
  });

  it('7 飛彈 —— 未实现，已登记', () => {
    expect(isToolImplemented(7)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(7);
  });

  it('8 遙控骰子 —— 效果未实现，但引擎已能吃强制点数', () => {
    expect(isToolImplemented(8)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(8);
  });

  it('9 機器工人 —— 未实现，已登记', () => {
    expect(isToolImplemented(9)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(9);
  });

  it('10 時光機 —— 未实现，已登记（原版靠还原存档实现撤销）', () => {
    expect(isToolImplemented(10)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(10);
  });

  it('11 傳送機 —— 未实现，已登记', () => {
    expect(isToolImplemented(11)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(11);
  });

  it('12 工程車 —— 交通方式 0x1f，设施过路费倍率吃满 4 倍', () => {
    const r = useVehicleTool(player(), emptySlots(), 12);
    expect(r.ok).toBe(true);
    expect(r.player.trafficMethod).toBe(TRAFFIC_ENGINEERING);
    expect(1 << ((TRAFFIC_ENGINEERING & 3) - 1)).toBe(4);
  });

  it('13 核子飛彈 —— 未实现，已登记', () => {
    expect(isToolImplemented(13)).toBe(false);
    expect(UNIMPLEMENTED_TOOLS).toContain(13);
  });

  it('★ 13 个道具无一遗漏：每个要么实现了，要么在未实现清单里', () => {
    for (const t of TOOLS) {
      const known = isToolImplemented(t.id) || UNIMPLEMENTED_TOOLS.includes(t.id);
      expect(known, `道具 ${t.id} ${t.name} 既没实现也没登记`).toBe(true);
    }
    expect(TOOLS).toHaveLength(13);
    // 已实现 6 个、未实现 7 个 —— 这个数字变了就该更新文档
    expect(TOOLS.filter((t) => isToolImplemented(t.id))).toHaveLength(6);
  });
});
