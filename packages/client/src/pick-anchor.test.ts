/*
 * 拾取候选的**落点**（Q-TOOL-4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方报的「使用機器工人无法给自己的地块修成房子」，根在这里：
 *   原版判「光标底下是什么」用的是**像素级实例表**
 *   （`_rich4_get_instance_from_position` VA 0x40a9d7），命中的是**画在那儿的实例**——
 *   光标在白格/建筑上是**地块编码**、在設施上是設施编码、只有在路面上才是节点号。
 *   而地块/設施是按**各自的记录坐标**画的（Q-LAYOUT-4：「建筑在路边的白色格子里，
 *   不在路面上」），与所在的节点实测差 **41..66 屏幕像素**（本文件末尾那条测试
 *   把地图 1 全部 50 块地 × 8 个视角都过了一遍）。
 *
 *   先前 `pickCandidates` 把**所有**候选一律挂在节点（路面）上，于是：
 *   - 機器工人（类别位只有地块|設施，**没有格子**）的可点区域正好反了 ——
 *     用户点自己的白格/房子永远吃红叉（命中半径 24 < 41）；
 *   - 地块类卡片同样只能点到**路面**，点不到那栋房子。
 *
 * 这一份钉的是落点与类别位；「算不算数」仍然在 core（`preview.test.ts`）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  newGame,
  parseMap,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import {
  PICK_CLASS,
  hitCandidate,
  instanceAnchor,
  pickClasses,
  startPick,
} from './picking.ts';
import { worldToScreen, type Camera } from './render.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

const TOOL_ROBOT_WORKER = 9;
const TOOL_BARRIER = 2;
const TOOL_MISSILE = 7;
const PARAM = {
  barrier: 0x1,
  missile: 0x300c0,
  worker: 0x2090006,
};

function setup() {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo: MapTopology = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
  };
  const base = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 11,
  });
  const tools = [...base.tools];
  tools[TOOL_ROBOT_WORKER] = 1;
  tools[TOOL_BARRIER] = 1;
  tools[TOOL_MISSILE] = 1;
  /** 两块住宅地：A 是目标，B 给当前玩家站着（换地卡要求「站在地块上」） */
  // ★ 判别联合的收窄进不了闭包，先把下标取成局部量
  const landIds = topo.nodes
    .map((n) => (n.ref.kind === 'land' ? n.ref.index : null))
    .filter((x): x is number => x !== null);
  const idA = landIds[0]!;
  const idB = landIds[1]!;
  const nodeA = topo.nodes.find((n) => n.ref.kind === 'land' && n.ref.index === idA)!;
  const nodeB = topo.nodes.find((n) => n.ref.kind === 'land' && n.ref.index === idB)!;
  const landA = topo.lands!.find((l) => l.id === idA)!;
  const landB = topo.lands!.find((l) => l.id === idB)!;
  const landOwner = [...base.landOwner];
  landOwner[landA.id] = 1; // A 是玩家 0 自己的地
  landOwner[landB.id] = 1;
  const players = base.players.map((p, i) =>
    // 玩家 0：站在地块 B 上（换地卡要求「站在地块上」），手里有換地卡（4）
    i === 0 ? { ...p, nodeId: nodeB.id, kind: 'human' as const, cards: [4] } : p,
  );
  const state: GameState = { ...base, tools, landOwner, players };
  return { topo, state, nodeA, nodeB, landA, landB };
}

const toScreen = (wx: number, wy: number) => ({ x: wx, y: wy });

describe('★ 类别位 @source VA 0x4461ff / 0x445ec1', () => {
  it('機器工人 `0x2090006` → 低字节 `0x6` = 地块|設施（**没有**格子）', () => {
    expect(pickClasses(PARAM.worker)).toBe(PICK_CLASS.land | PICK_CLASS.facility);
  });

  it('路障 `0x1` → 只认格子；傳送機 `0x2090001` 同', () => {
    expect(pickClasses(0x1)).toBe(PICK_CLASS.node);
    expect(pickClasses(0x2090001)).toBe(PICK_CLASS.node);
  });

  it('★ bit6「什么都收」展开成 `0x37`，顺手把 bit3（目标必选）清掉', () => {
    // 飛彈 `0x300c0` / 核子 `0x400c0` 的低 16 位都是 0xc0（bit6|bit7）
    expect(pickClasses(PARAM.missile)).toBe(0x80 | 0x37);
    expect(pickClasses(0x400c0)).toBe(0x80 | 0x37);
    // bit6 + bit3 一起给 → 规范化后 bit3 没了 → 右键能取消
    const session = startPick(
      { players: [], tools: [], objects: [], specialActors: [], currentPlayer: 0 } as unknown as GameState,
      { nodes: [] } as unknown as MapTopology,
      { kind: 'tool', toolId: TOOL_BARRIER },
      'none',
      0x48,
    );
    expect(session.cancellable).toBe(true);
  });
});

describe('★ instanceAnchor —— 候选落在**画出来的那个实例**上', () => {
  run('地块 → 地块记录的 x/y（不是节点的）', () => {
    const { topo, nodeA, landA } = setup();
    const p = instanceAnchor(topo, nodeA, PICK_CLASS.land);
    expect(p).toEqual({ x: landA.x, y: landA.y });
    // 与节点确实不同（这就是「点不到」的来源）
    expect(landA.y).not.toBe(nodeA.y);
  });

  run('設施 → 設施记录的 x/y', () => {
    const { topo } = setup();
    const node = topo.nodes.find((n) => n.ref.kind === 'facility');
    if (node === undefined || node.ref.kind !== 'facility') return;
    const fid = node.ref.index;
    const f = topo.facilities!.find((x) => x.id === fid)!;
    expect(instanceAnchor(topo, node, PICK_CLASS.facility)).toEqual({ x: f.x, y: f.y });
  });

  run('格子（路面）→ 节点自己的 x/y', () => {
    const { topo, nodeA } = setup();
    expect(instanceAnchor(topo, nodeA, PICK_CLASS.node)).toEqual({ x: nodeA.x, y: nodeA.y });
    // 类别位没给地块 → 就算这是地块格也退回节点
    expect(instanceAnchor(topo, nodeA, 0)).toEqual({ x: nodeA.x, y: nodeA.y });
  });
});

describe('★ 機器工人（9）在真地图上的候选', () => {
  run('★ 候选挂在**白格/建筑**上：点地块处命中、点路面（节点）不命中', () => {
    const { topo, state, nodeA, landA } = setup();
    const session = startPick(state, topo, { kind: 'tool', toolId: TOOL_ROBOT_WORKER }, 'none', PARAM.worker);
    const mine = session.candidates.filter((c) => c.nodeId === nodeA.id);
    // 低字节没有 bit0 → 这一个节点只出一个候选
    expect(mine).toHaveLength(1);
    expect(mine[0]!.wx).toBe(landA.x);
    expect(mine[0]!.wy).toBe(landA.y);

    expect(hitCandidate(session, landA.x, landA.y, toScreen)).not.toBeNull();
    // ★ 站在「路面」上点 → 不认（原版 `0x6` 没有 bit0）
    expect(hitCandidate(session, nodeA.x, nodeA.y, toScreen)).toBeNull();
  });

  run('路障（2）反过来：候选在路面，白格上不认', () => {
    const { topo, state, nodeA, landA } = setup();
    const session = startPick(state, topo, { kind: 'tool', toolId: TOOL_BARRIER }, 'none', PARAM.barrier);
    const mine = session.candidates.filter((c) => c.nodeId === nodeA.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.wx).toBe(nodeA.x);
    expect(hitCandidate(session, nodeA.x, nodeA.y, toScreen)).not.toBeNull();
    expect(hitCandidate(session, landA.x, landA.y, toScreen)).toBeNull();
  });

  run('飛彈（bit6「什么都收」）→ 路面与白格**都**是候选', () => {
    const { topo, state, nodeA, landA } = setup();
    const session = startPick(state, topo, { kind: 'tool', toolId: TOOL_MISSILE }, 'none', PARAM.missile);
    const mine = session.candidates.filter((c) => c.nodeId === nodeA.id);
    expect(mine).toHaveLength(2);
    const xs = mine.map((c) => `${c.wx},${c.wy}`).sort();
    expect(xs).toEqual([`${landA.x},${landA.y}`, `${nodeA.x},${nodeA.y}`].sort());
  });

  run('★ 回归：候选若还挂在节点（路面）上，地块处就是空的 —— 这就是先前点不动的原因', () => {
    const { state, nodeA, landA } = setup();
    // 手工造一个「旧行为」的会话：落点全在节点上
    const old = {
      source: { kind: 'tool' as const, toolId: TOOL_ROBOT_WORKER },
      targetClass: 'none' as const,
      param: PARAM.worker,
      cancellable: true,
      candidates: [{ wx: nodeA.x, wy: nodeA.y, target: { kind: 'node' as const, nodeId: nodeA.id }, nodeId: nodeA.id }],
    };
    expect(state.tools[TOOL_ROBOT_WORKER]).toBe(1); // 道具在身上、规则也通
    expect(hitCandidate(old, landA.x, landA.y, toScreen)).toBeNull(); // ← 用户点白格/房子：没反应
    expect(hitCandidate(old, nodeA.x, nodeA.y, toScreen)).not.toBeNull(); // 只有点路面才认
  });
});

describe('★ 地块类卡片的候选同样跟地块走', () => {
  run('換地卡（4，`0xe0c0202`）→ 候选落在地块记录的 x/y 上', () => {
    const { topo, state, nodeA, landA } = setup();
    const session = startPick(state, topo, { kind: 'card', cardId: 4 }, 'land', 0xe0c0202);
    const mine = session.candidates.filter((c) => c.nodeId === nodeA.id);
    // 玩家站在地块 B 上、手里有換地卡 → 地块 A 一定是个合法目标
    expect(mine).toHaveLength(1);
    expect(mine[0]!.wx).toBe(landA.x);
    expect(mine[0]!.wy).toBe(landA.y);
    expect(hitCandidate(session, landA.x, landA.y, toScreen)).not.toBeNull();
    // ★ 卡片以前挂在路面上，用户点房子点不到
    expect(hitCandidate(session, nodeA.x, nodeA.y, toScreen)).toBeNull();
  });
});

describe('★ 为什么「挂在节点上」一定点不动（Q-TOOL-4 的量化依据）', () => {
  run('地图 1 的每一块地 × 8 个视角：节点与地块的**屏幕**距离都大于命中半径 24', () => {
    const { topo } = setup();
    const viewport = { w: 800, h: 600 };
    let min = Number.POSITIVE_INFINITY;
    let measured = 0;
    for (const n of topo.nodes) {
      const ref = n.ref;
      if (ref.kind !== 'land') continue;
      const land = topo.lands!.find((l) => l.id === ref.index);
      if (land === undefined) continue;
      for (let view = 0; view < 8; view++) {
        // 镜头停在那一格（`projectWorld` 用 camTileX/Y 定位 29×29 窗口）
        const cam: Camera = {
          mode: 'character',
          view,
          tileX: n.x >> 5,
          tileY: n.y >> 5,
          scale: 1,
          x: 0,
          y: 0,
        };
        const pn = worldToScreen(n.x, n.y, cam, viewport);
        const pl = worldToScreen(land.x, land.y, cam, viewport);
        if (pn === null || pl === null) continue; // 越出窗口的格子没画，跳过
        const d = Math.hypot(pn.x - pl.x, pn.y - pl.y);
        min = Math.min(min, d);
        measured++;
      }
    }
    expect(measured).toBeGreaterThan(0);
    // ★ 实测 41.15..65.73 —— 全部 > 24（`hitCandidate` 的半径）
    expect(min).toBeGreaterThan(24);
  });
});
