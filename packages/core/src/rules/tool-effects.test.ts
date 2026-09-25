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
  MISSILE_RADIUS,
  NUKE_RADIUS,
  UNIMPLEMENTED_TOOLS,
  VEHICLE_DICE,
  blastLand,
  buildOneLevel,
  buildUpgradeBit7,
  reachedMaxBuildLevel,
  BUILD_MAX_LEVEL,
  isToolImplemented,
  isValidRemoteDice,
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
  it('★ 13 件全部实现', () => {
    for (let id = 1; id <= 13; id++) {
      expect(isToolImplemented(id), `道具${id}`).toBe(true);
    }
  });

  it('★ 未实现清单已清空 —— 最后一件是機器娃娃（替身走子）', () => {
    expect([...UNIMPLEMENTED_TOOLS]).toEqual([]);
  });

  it('清单里若再进新条目，必定同时不被认为已实现', () => {
    for (const id of UNIMPLEMENTED_TOOLS) {
      expect(isToolImplemented(id), `道具${id}`).toBe(false);
    }
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

  it('1 機器娃娃 —— 已实现：替身走九格，沿路扫物件', () => {
    expect(isToolImplemented(1)).toBe(true);
    expect(UNIMPLEMENTED_TOOLS).not.toContain(1);
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

  it('★ 7 飛彈 —— 半径 100 的方窗，逐块拆一级', () => {
    expect(isToolImplemented(7)).toBe(true);
    expect(MISSILE_RADIUS).toBe(100);
    // 住宅（type 0）掉一级
    expect(blastLand(2, 3, 0, 1, false)).toMatchObject({ owner: 2, level: 2, type: 0 });
    // 連鎖店（type 1）被夷平并退回住宅
    expect(blastLand(2, 4, 1, 1, false)).toMatchObject({ owner: 2, level: 0, type: 0 });
    // 敌意固定 30 × 物价指数
    expect(blastLand(2, 3, 0, 5, false).hostility).toBe(150);
    // 无主地不记敌意
    expect(blastLand(0, 3, 0, 5, false).hostility).toBe(0);
  });

  it('★ 13 核子飛彈 —— 全图，而且**连地契一起烧掉**', () => {
    expect(isToolImplemented(13)).toBe(true);
    expect(NUKE_RADIUS).toBe(-1);
    expect(blastLand(2, 3, 0, 1, true)).toMatchObject({ owner: 0, level: 0, type: 0 });
    // 敌意按等级计：level × 30 × 物价指数
    expect(blastLand(2, 3, 0, 2, true).hostility).toBe(3 * 30 * 2);
    expect(blastLand(2, 0, 0, 2, true).hostility).toBe(0);
  });

  it('8 遙控骰子 —— 指定点数 1..6（`0x00446847 cmp esi,6`），越界不收', () => {
    expect(isToolImplemented(8)).toBe(true);
    expect(isValidRemoteDice(1)).toBe(true);
    expect(isValidRemoteDice(6)).toBe(true);
    expect(isValidRemoteDice(0)).toBe(false);
    expect(isValidRemoteDice(7)).toBe(false);
    expect(isValidRemoteDice(2.5)).toBe(false);
  });

  it('★ 9 機器工人 —— 免费加蓋一级，连锁店只在 0 级时能盖', () => {
    expect(isToolImplemented(9)).toBe(true);
    expect(buildOneLevel(0, 2, 5)).toEqual({ ok: true, level: 3, reachedMaxLevel: false });
    expect(buildOneLevel(0, 5, 5)).toEqual({ ok: false, level: 5, reachedMaxLevel: false });
    expect(buildOneLevel(1, 0, 5)).toEqual({ ok: true, level: 1, reachedMaxLevel: false });
    expect(buildOneLevel(1, 1, 5)).toEqual({ ok: false, level: 1, reachedMaxLevel: false });
  });

  // ============================================================
  //  ★★ `0x40b110` 返回值的 bit7 —— README §7.142(5) E6
  // ============================================================

  it('★★ bit7 = 剛好升到 5 級：住宅 4→5 置位、設施 4→5 **也**置位', () => {
    // @source 地块支 0x0040b169 `cmp cl, 5` / `jne 0x40b170` / `0x0040b16e or al, 0x80`
    expect(buildOneLevel(0, 4, 5)).toEqual({ ok: true, level: 5, reachedMaxLevel: true });
    // ★ 設施支（等级 ≥ 1）到 5 级是 `0x0040b21a mov eax, 0x81` —— **同样置位**。
    //   `buildOneLevel` 只吃 (type, level, maxLevel)，住宅/連鎖店两支都从这里过；
    //   設施那一支走 `freeBuildFacilityById`，用的是同一个 `buildUpgradeBit7`。
    //   真值见 `rich4-spec/tests/test_land_mutation_gates.py` 的 [B] 段。
    expect(buildUpgradeBit7(4, 5)).toBe(true);
  });

  it('★★ bit7 是「**相等** 5」，不是「≥ 5」', () => {
    // @source 0x0040b169 / 0x0040b215 都是 `cmp …, 5` / `jne`。
    // ⚠️ 实测把 `=== 5` 改成 `>= 5`，**这一条**是唯一会红的地方：
    //   在 exe 里 `0x40b13e cmp byte [land+0x1a], 5 / jae` 已经把等级夹在 5 以下，
    //   所以「== 5」与「≥ 5」对**可达**输入等价（§7.142(13) 那种「恒不跳」的坑）。
    //   要证伪 `>= 5` 就必须给一个 > 5 的新等级 —— 直接测契约本身。
    expect(reachedMaxBuildLevel(BUILD_MAX_LEVEL)).toBe(true);
    expect(reachedMaxBuildLevel(BUILD_MAX_LEVEL + 1)).toBe(false);
    expect(reachedMaxBuildLevel(BUILD_MAX_LEVEL - 1)).toBe(false);
    expect(buildUpgradeBit7(5, 6)).toBe(false);
  });

  it('★★ 等级没变 ⇒ 不置 bit7（原版没加蓋的路径根本不走那个 cmp）', () => {
    // @source 0x0040b15d `test eax,eax` / `0x0040b15f je 0x40b170` —— eax 停在 0
    expect(buildUpgradeBit7(5, 5)).toBe(false);
    expect(buildUpgradeBit7(0, 0)).toBe(false);
  });

  it('★ 連鎖店 0→1 永远不置 bit7（新等级是 1）；首建那一条也一样', () => {
    expect(buildOneLevel(1, 0, 5).reachedMaxLevel).toBe(false);
    // 設施首建：`0x0040b1f4 mov eax, 1 / inc byte [ebx+0x1a] / ret`，**没有** bit7
    expect(buildUpgradeBit7(0, 1)).toBe(false);
  });

  it('★ 没蓋成（ok=false）时 bit7 一定是 false —— 两位不能互相矛盾', () => {
    for (const [t, lv, mx] of [[0, 5, 5], [1, 1, 5], [1, 5, 5], [2, 0, 5], [9, 0, 5]] as const) {
      const r = buildOneLevel(t, lv, mx);
      expect(r.ok).toBe(false);
      expect(r.reachedMaxLevel).toBe(false);
      expect(r.level).toBe(lv);
    }
  });

  it('★ 「== 5」这个判据与调用方给的 maxLevel 无关（exe 写死的 5）', () => {
    // @source 0x40b138 `cmp byte [land+0x1a], 5 / jae`（住宅封顶硬写 5）
    //   与 0x40b169 `cmp cl, 5`（bit7 判据硬写 5）是**同一个立即数**。
    //   这里用 maxLevel = 6 把「新等级 == 5」与「新等级 ≥ 5」分开：
    //   5→6 时 ok 仍然成立（本引擎的 maxLevel 形参语义），但 bit7 必须为 false。
    const r = buildOneLevel(0, 5, 6);
    expect(r.ok).toBe(true);
    expect(r.level).toBe(6);
    expect(r.reachedMaxLevel).toBe(false);
  });

  it('10 時光機 —— 已实现：还原回合开始的快照', () => {
    // ✅ 已实现：靠「回合开始快照 + 还原」，见 rules/time-machine.ts
    expect(isToolImplemented(10)).toBe(true);
    expect(UNIMPLEMENTED_TOOLS).not.toContain(10);
  });

  it('11 傳送機 —— 已实现：搬地產 / 搬人', () => {
    // ✅ 已实现：搬地產与搬人两路，見 rules/teleport.ts
    expect(isToolImplemented(11)).toBe(true);
    expect(UNIMPLEMENTED_TOOLS).not.toContain(11);
  });

  it('12 工程車 —— 交通方式 0x1f，设施过路费倍率吃满 4 倍', () => {
    const r = useVehicleTool(player(), emptySlots(), 12);
    expect(r.ok).toBe(true);
    expect(r.player.trafficMethod).toBe(TRAFFIC_ENGINEERING);
    expect(1 << ((TRAFFIC_ENGINEERING & 3) - 1)).toBe(4);
  });

  it('★ 13 个道具无一遗漏：每个要么实现了，要么在未实现清单里', () => {
    for (const t of TOOLS) {
      const known = isToolImplemented(t.id) || UNIMPLEMENTED_TOOLS.includes(t.id);
      expect(known, `道具 ${t.id} ${t.name} 既没实现也没登记`).toBe(true);
    }
    expect(TOOLS).toHaveLength(13);
    // ★ 13 个**全部**实现 —— 这个数字掉下来就该更新文档
    expect(TOOLS.filter((t) => isToolImplemented(t.id))).toHaveLength(13);
  });
});

describe('★★ 工程車（12）存下原座驾、按 (traffic&3)==3 判「已在开」（0x004479e2 / 0x00447a49 / 0x00447a55）', () => {
  it('骑機車开工程車：機車退回道具、原交通方式 1 / 骰子 2 存进 engineSaved*', () => {
    const p = makePlayer({ index: 0, trafficMethod: 1, ndices: 2 });
    const r = useVehicleTool(p, new Array<number>(60).fill(0), 12);
    expect(r.ok).toBe(true);
    expect(r.player.trafficMethod).toBe(0x1f);
    expect(r.player.ndices).toBe(1);
    expect(r.player.engineSavedTraffic).toBe(1);
    expect(r.player.engineSavedDice).toBe(2);
    expect(r.tools[5]).toBe(1);
  });
  it('工程車过了一天（0x1b）再开 → 不生效、不消耗', () => {
    const p = makePlayer({ index: 0, trafficMethod: 0x1b, ndices: 1 });
    expect(useVehicleTool(p, new Array<number>(60).fill(0), 12).ok).toBe(false);
  });
});
