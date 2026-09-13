/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 道具效果 —— 对照 rich4_tool_*.asm
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { OBJECT_NAMES } from './purchase.ts';
import { emptyTools, toolCount } from './tools.ts';
import { makeObjects } from '../cards/summon.ts';
import {
  PLACEMENT_TOOLS,
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

  it('放置占用一个空槽', () => {
    const objs = makeObjects(5);
    const r = placeObject(objs, 42, 16);
    expect(r.ok).toBe(true);
    expect(r.objects[r.slot]).toMatchObject({ type: 16, nodeId: 42 });
  });

  it('★ 不会覆盖已在地图上的物件', () => {
    const objs = makeObjects(2);
    objs[0] = { type: 9, nodeId: 10, state: 0, attached: 0 };
    const r = placeObject(objs, 42, 16);
    expect(r.slot).toBe(1);
    expect(r.objects[0]!.nodeId).toBe(10);
  });

  it('没有空槽时失败', () => {
    const objs = makeObjects(2).map((o) => ({ ...o, nodeId: 5 }));
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
