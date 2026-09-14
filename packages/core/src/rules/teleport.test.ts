/*
 * 傳送機：搬地產、搬人
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';
import { emptyTools, giveTool, initialToolStock, toolCount } from './tools.ts';
import {
  TELEPORT_LAND_BASE,
  TOOL_TELEPORTER,
  decodeTeleport,
  pickFacingAt,
  teleportFacility,
  teleportLand,
  teleportPlayer,
} from './teleport.ts';
import type { GameState } from '../state/types.ts';
import { UNIMPLEMENTED_TOOLS } from './tool-effects.ts';
import { linkBlockedMask } from '../state/reduce.ts';

/**
 * 一个十字路口：节点 5 在中心，四个方向各有一个邻居。
 * 坐标按屏幕的 y 向下算。
 */
const cross: MapTopology = {
  nodes: [
    makeNode({ id: 1, x: 100, y: 0, adjacent: [5], adjacentSlots: [5, 0, 0, 0] }), // 上
    makeNode({ id: 2, x: 200, y: 100, adjacent: [5], adjacentSlots: [5, 0, 0, 0] }), // 右
    makeNode({ id: 3, x: 100, y: 200, adjacent: [5], adjacentSlots: [5, 0, 0, 0] }), // 下
    makeNode({ id: 4, x: 0, y: 100, adjacent: [5], adjacentSlots: [5, 0, 0, 0] }), // 左
    makeNode({ id: 5, x: 100, y: 100, adjacent: [1, 2, 3, 4], adjacentSlots: [1, 2, 3, 4] }),
  ],
  lands: [
    makeLand({ id: 1, type: LAND_TYPE_HOUSE }),
    makeLand({ id: 2, type: LAND_TYPE_HOUSE }),
  ],
};

function withTool(): ReturnType<typeof makeGameState> {
  const s = makeGameState({
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1 })),
    landOwner: [0, 2, 0],
    landLevel: [0, 3, 0],
    landType: [0, LAND_TYPE_HOUSE, LAND_TYPE_HOUSE],
    phase: 'awaitingRoll',
  });
  const given = giveTool(emptyTools(4), initialToolStock(), 0, TOOL_TELEPORTER);
  return { ...s, tools: given.tools, toolStock: given.stock };
}

describe('傳送機', () => {
  it('道具已全部实现', () => {
    expect(UNIMPLEMENTED_TOOLS).toEqual([]);
  });

  describe('★ 搬設施 @source 0x004475d8 —— 与搬地產同构，多搬到期日、只清不搬上次過路費', () => {
    /** 往任意状态里塞一件傳送機（本文件的 withTool() 是自带状态的） */
    function armed(s: GameState): GameState {
      const given = giveTool(emptyTools(4), initialToolStock(), 0, TOOL_TELEPORTER);
      return { ...s, tools: given.tools, toolStock: given.stock };
    }
    function two(): GameState {
      const s = makeGameState({
        players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1 })),
        phase: 'awaitingRoll',
      });
      const facilityOwner = [...s.facilityOwner];
      const facilityLevel = [...s.facilityLevel];
      const facilityType = [...s.facilityType];
      const facilityTenure = [...s.facilityTenure];
      const facilityLastToll = [...s.facilityLastToll];
      facilityOwner[1] = 2;
      facilityLevel[1] = 3;
      facilityType[1] = 2;
      facilityTenure[1] = 0x7d00401;
      facilityLastToll[1] = 8000;
      facilityLastToll[5] = 300;
      return { ...s, facilityOwner, facilityLevel, facilityType, facilityTenure, facilityLastToll };
    }

    it('归属、等级、种类、到期日整块搬走，源头清零', () => {
      const r = teleportFacility(two(), 1, 5)!;
      expect(r.facilityOwner[5]).toBe(2);
      expect(r.facilityLevel[5]).toBe(3);
      expect(r.facilityType[5]).toBe(2);
      expect(r.facilityTenure[5]).toBe(0x7d00401);
      expect(r.facilityOwner[1]).toBe(0);
      expect(r.facilityLevel[1]).toBe(0);
      expect(r.facilityType[1]).toBe(0);
      expect(r.facilityTenure[1]).toBe(0);
    });

    it('★ 上次過路費：源清零、新址保持原样（0x0044760f 只写源）', () => {
      const r = teleportFacility(two(), 1, 5)!;
      expect(r.facilityLastToll[1]).toBe(0);
      expect(r.facilityLastToll[5]).toBe(300);
    });

    it('无主設施搬不动；搬到自己身上也不行', () => {
      expect(teleportFacility(two(), 2, 5)).toBeNull();
      expect(teleportFacility(two(), 1, 1)).toBeNull();
    });

    it('经 useTool 走設施编码（4000 + id）那一路，并消耗道具', () => {
      const s = armed(two());
      const after = reduce(s, { type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: 4001, value: 4005 }, cross);
      expect(after.facilityOwner[5]).toBe(2);
      expect(after.facilityOwner[1]).toBe(0);
      expect(toolCount(after.tools, 0, TOOL_TELEPORTER)).toBe(0);
    });

    it('地產↔設施混搬没有这一路 —— 不消耗道具', () => {
      const s = armed(two());
      const after = reduce(s, { type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: 2001, value: 4005 }, cross);
      expect(after).toBe(s);
    });
  });

  it('★ 选择器的三段编码 —— @source cmp 0x7d0 / 0xfa0 / 0x1770', () => {
    expect(decodeTeleport(0x7d0)).toBeNull(); // 边界不含
    expect(decodeTeleport(0x7d1)).toEqual({ kind: 'land', index: 1 });
    expect(decodeTeleport(0xf9f)).toEqual({ kind: 'land', index: 0xf9f - 0x7d0 });
    expect(decodeTeleport(0xfa0)).toBeNull();
    expect(decodeTeleport(0xfa1)).toEqual({ kind: 'facility', index: 1 });
    expect(decodeTeleport(0x1770)).toBeNull();
    expect(decodeTeleport(3)).toBeNull(); // 小数字留给「搬人」
  });

  it('★ 搬地產：归属、等级、种类一起走，源头清空', () => {
    const s = withTool();
    const after = teleportLand(s, 1, 2)!;
    expect(after.landOwner[2]).toBe(2);
    expect(after.landLevel[2]).toBe(3);
    expect(after.landType[2]).toBe(LAND_TYPE_HOUSE);
    // @source `mov [源+0x19], 0` 等三行 —— 源头是要清掉的
    expect(after.landOwner[1]).toBe(0);
    expect(after.landLevel[1]).toBe(0);
  });

  it('空地搬不动，同一块地也搬不动', () => {
    const s = withTool();
    expect(teleportLand(s, 2, 1)).toBeNull(); // 2 是空地
    expect(teleportLand(s, 1, 1)).toBeNull();
  });

  it('★ 落地朝向取「圆周距离最近」的那个邻居', () => {
    // 节点 5 的四个邻居方位：1 在正上、2 在正右、3 在正下、4 在正左
    // 朝向编码见 reduce.ts 的 directionOf
    const up = pickFacingAt(cross.nodes, 5, 0);
    expect(up).not.toBeNull();
    // 原朝向就是某个邻居的方位时，必定选中它，距离为 0
    for (let dir = 0; dir < 8; dir++) {
      const got = pickFacingAt(cross.nodes, 5, dir)!;
      const raw = Math.abs(dir - got.direction);
      expect(Math.min(raw, 8 - raw)).toBeLessThanOrEqual(1);
    }
  });

  it('★ last_node 取一个**不同于**目标的邻居，这样下一步会朝目标走', () => {
    const f = pickFacingAt(cross.nodes, 5, 0)!;
    expect(f.from).not.toBe(f.toward);
    expect(cross.nodes[4]!.adjacent).toContain(f.from);
  });

  it('被封的槽不算候选', () => {
    const blocked: MapTopology = {
      ...cross,
      nodes: cross.nodes.map((n) =>
        n.id === 5 ? { ...n, flags: n.flags | linkBlockedMask(0) | linkBlockedMask(1) | linkBlockedMask(2) } : n,
      ),
    };
    const f = pickFacingAt(blocked.nodes, 5, 0)!;
    // 只剩槽 3（节点 4）
    expect(f.toward).toBe(4);
    expect(f.from).toBe(4); // 只有一个候选时 from 就是它自己
  });

  it('四周无路的格子传不过去', () => {
    const island: MapTopology = {
      nodes: [makeNode({ id: 1, adjacent: [], adjacentSlots: [0, 0, 0, 0] })],
    };
    expect(pickFacingAt(island.nodes, 1, 0)).toBeNull();
    const s = withTool();
    expect(teleportPlayer(s, island.nodes, 0, 1)).toBeNull();
  });

  it('★ 搬人：换格、换朝向、换坐标，原地不动的不算', () => {
    const s = { ...withTool(), players: withTool().players.map((p) => ({ ...p, nodeId: 1 })) };
    const after = teleportPlayer(s, cross.nodes, 0, 5)!;
    expect(after.players[0]!.nodeId).toBe(5);
    expect(after.players[0]!.xpos).toBe(100);
    expect(after.players[0]!.ypos).toBe(100);
    expect(teleportPlayer(after, cross.nodes, 0, 5)).toBeNull(); // 已经在那儿了
  });

  it('★ 走 useTool 这条路：地產编码 → 搬地產，并扣掉道具', () => {
    const s = withTool();
    const after = reduce(
      s,
      {
        type: 'useTool',
        toolId: TOOL_TELEPORTER,
        nodeId: TELEPORT_LAND_BASE + 1,
        value: TELEPORT_LAND_BASE + 2,
      },
      cross,
    );
    expect(after.landOwner[2]).toBe(2);
    expect(toolCount(after.tools, 0, TOOL_TELEPORTER)).toBe(0);
  });

  it('★ 設施那一路还没做 —— 不生效也不消耗道具（Q-TOOL-2）', () => {
    const s = withTool();
    const after = reduce(
      s,
      { type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: 0xfa1, value: 0xfa2 },
      cross,
    );
    expect(after).toBe(s);
    expect(toolCount(after.tools, 0, TOOL_TELEPORTER)).toBe(1);
  });
});
