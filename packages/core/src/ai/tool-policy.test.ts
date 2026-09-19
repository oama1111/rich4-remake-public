/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * AI 用道具策略（tool-policy.ts）的逐件测试 —— 每件道具的「用不用、对谁用」各至少一条。
 * 判定条件全部以 rich4.exe 跳表 0x475324 道具侧（31..43 项）的 VA 为准（见 tool-policy.ts 各处 @source）。
 * 含 rand() 的分支用钉死的 rngState 验证 D-004 确定性替身（取值由同式预先算出，注释写明）。
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode, Rich4Map } from '../loaders/map.ts';
import type { MapTopology } from '../state/reduce.ts';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from '../rules/objects.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';
import { TRAFFIC_ENGINEERING } from '../rules/tool-effects.ts';
import { decideTool, type AiContext } from './policy.ts';
import {
  AI_NEVER_USES,
  aiToolChoice,
  toolsToConsider,
  type ToolAiView,
} from './tool-policy.ts';

// ============================================================
//  场景搭建
// ============================================================

interface Fixture {
  nodes?: MapNode[];
  lands?: LandInfo[];
  facilities?: FacilityInfo[];
  players?: GameState['players'];
  state?: Partial<GameState>;
  meIndex?: number;
}

/** 最小画面：默认一个 (0,0) 的普通节点，四名玩家都站在上面（视野 ±220 内） */
function viewOf(f: Fixture = {}): ToolAiView {
  const players = f.players ?? [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));
  const state = makeGameState({ players, currentPlayer: f.meIndex ?? 0, ...f.state });
  const meIndex = f.meIndex ?? 0;
  const topo: MapTopology = {
    nodes: f.nodes ?? [makeNode({ id: 1, x: 0, y: 0 })],
    lands: f.lands ?? [],
    facilities: f.facilities ?? [],
  };
  return { state, topo, meIndex, me: state.players[meIndex]!, lands: f.lands ?? [], facilities: f.facilities ?? [] };
}

const landNode = (id: number, landId: number, x = 0, y = 0, adjacent: number[] = []): MapNode =>
  makeNode({ id, x, y, ref: { kind: 'land', index: landId }, adjacent });

const facilityNode = (id: number, facilityId: number, x = 0, y = 0, adjacent: number[] = []): MapNode =>
  makeNode({ id, x, y, ref: { kind: 'facility', index: facilityId }, adjacent });

/** 一条直线步道：1→2→…→n，用于前瞻/反瞻类判定（x = 10×编号，全在默认视野内） */
function lineNodes(n: number, refs: Map<number, MapNode['ref']> = new Map()): MapNode[] {
  const out: MapNode[] = [];
  for (let i = 1; i <= n; i++) {
    const adjacent = [i - 1, i + 1].filter((j) => j >= 1 && j <= n);
    out.push(makeNode({ id: i, x: i * 10, y: 0, adjacent, ref: refs.get(i) ?? { kind: 'special' } }));
  }
  return out;
}

/** 站在 nodeId、来路 lastNodeId 的我（其余三名玩家扔到视野外的 0 号位） */
function meOnLine(nodeId: number, lastNodeId: number, over: Parameters<typeof makePlayer>[0] = {}) {
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, nodeId: 0 }));
  players[0] = makePlayer({ index: 0, character: 0, nodeId, lastNodeId, ...over });
  return players;
}

/** 把物件槽 slot（0 基，类型由槽位表决定）放到 nodeId 上 */
function objectsWith(slot: number, nodeId: number): GameState['objects'] {
  const objects = makeObjects(OBJECT_COUNT);
  objects[slot]!.nodeId = nodeId;
  return objects;
}

/** decideTool 的上下文：把同一份 nodes/lands/facilities 同时当地图与拓扑 */
function ctxOf(f: Fixture & { tools?: Record<number, number> }): AiContext {
  const view = viewOf(f);
  const state = { ...view.state };
  if (f.tools !== undefined) {
    const tools = new Array<number>(4 * 15).fill(0);
    for (const [id, n] of Object.entries(f.tools)) tools[Number(id)] = n;
    state.tools = tools;
  }
  const map = {
    nodes: view.topo.nodes,
    lands: view.lands,
    facilities: view.facilities,
  } as unknown as Rich4Map;
  return { state, map };
}

// ============================================================
//  共用机制
// ============================================================

describe('共用机制', () => {
  it('一回合最多试 4 件：种类 > 4 时从 rand%种类 起环形取（0x00447fec）', () => {
    expect(toolsToConsider([1, 2, 3, 4, 5, 6], 4)).toEqual([5, 6, 1, 2]);
    expect(toolsToConsider([2, 5, 9], 0)).toEqual([2, 5, 9]);
    expect(toolsToConsider([], 0)).toEqual([]);
  });

  it('時光機 AI 永不用（10 双保险）；核子飛彈已按 Q-TOOL-3 接线', () => {
    // ★ 曾写死 `[10, 13]`（13 = 核子飛彈），依据是把 `a0b1(x,y,-1)` 的半径 −1
    //   读成「全图 ⇒ 中止判据恒真」。Q-TOOL-3 已用机器码推翻（见 13 号那一节）。
    expect(AI_NEVER_USES).toEqual([10]);
    const view = viewOf();
    for (const id of AI_NEVER_USES) expect(aiToolChoice(id, view)).toBeNull();
    expect(aiToolChoice(99, view)).toBeNull();
  });
});

// ============================================================
//  十三件道具
// ============================================================

describe('1 機器娃娃（0x00420efa）', () => {
  it('前方 4 格有坏神（类型 5..8）→ 用', () => {
    const view = viewOf({
      nodes: lineNodes(8),
      players: meOnLine(1, 0),
      state: { objects: objectsWith(6, 3) }, // 槽 6 = 类型 7 小衰神
    });
    expect(aiToolChoice(1, view)).toEqual({ kind: 'plain' });
  });

  it('前方有惡犬（类型 11）→ 用', () => {
    const view = viewOf({
      nodes: lineNodes(8),
      players: meOnLine(1, 0),
      state: { objects: objectsWith(10, 4) },
    });
    expect(aiToolChoice(1, view)).toEqual({ kind: 'plain' });
  });

  it('前瞻遇岔路 → 不用（0x420f11 forked 即退）', () => {
    const nodes = lineNodes(8);
    nodes[1] = makeNode({ id: 2, x: 20, y: 0, adjacent: [1, 3, 4] }); // 2 号位分出两条
    const view = viewOf({
      nodes,
      players: meOnLine(1, 0),
      state: { objects: objectsWith(6, 3) },
    });
    expect(aiToolChoice(1, view)).toBeNull();
  });

  it('地雷（17）埋在我自己的地上 → 用；在别人/无主的地上 → 不用', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const mine = viewOf({
      nodes,
      lands: [makeLand({ id: 5, owner: 1 })],
      players: meOnLine(1, 0),
      state: { objects: objectsWith(26, 3) }, // 槽 26..35 = 类型 17 地雷
    });
    expect(aiToolChoice(1, mine)).toEqual({ kind: 'plain' });
    const theirs = viewOf({
      nodes,
      lands: [makeLand({ id: 5, owner: 2 })],
      players: meOnLine(1, 0),
      state: { objects: objectsWith(26, 3) },
    });
    expect(aiToolChoice(1, theirs)).toBeNull();
  });

  it('路障（16）在别人的地上且该地主同區过路费 > 3000×物價 → 用', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const lands = [
      makeLand({ id: 5, owner: 2, level: 4, name: 'A' }), // rent[4] = 6000
      makeLand({ id: 6, owner: 2, level: 1, name: 'A' }), // rent[1] = 500 → 同區 6500 > 3000
    ];
    const view = viewOf({ nodes, lands, players: meOnLine(1, 0), state: { objects: objectsWith(16, 3) } });
    expect(aiToolChoice(1, view)).toEqual({ kind: 'plain' });
  });

  it('路障在无主的地上 → 不用；在别人的設施上（按 0x989680 处理）→ 必用', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const noOwner = viewOf({
      nodes,
      lands: [makeLand({ id: 5, owner: 0 })],
      players: meOnLine(1, 0),
      state: { objects: objectsWith(16, 3) },
    });
    expect(aiToolChoice(1, noOwner)).toBeNull();
    const facNodes = lineNodes(8, new Map([[3, { kind: 'facility', index: 1 }]]));
    const fac = viewOf({
      nodes: facNodes,
      facilities: [makeFacility({ id: 1, owner: 2 })],
      players: meOnLine(1, 0),
      state: { objects: objectsWith(16, 3) },
    });
    expect(aiToolChoice(1, fac)).toEqual({ kind: 'plain' });
  });
});

describe('2 路障（0x0042107f）', () => {
  const stageOneNodes = () => lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
  const myStreet = [makeLand({ id: 1, owner: 1, name: 'A' }), makeLand({ id: 2, owner: 1, name: 'A' })];

  it('阶段一：前方无主住宅地 + 我同區 ≥ 2 + 钱闸全过 → 放这格', () => {
    const view = viewOf({
      nodes: stageOneNodes(),
      lands: [...myStreet, makeLand({ id: 5, owner: 0, name: 'A', landPrice: 1000 })],
      players: meOnLine(1, 0),
    });
    expect(aiToolChoice(2, view)).toEqual({ kind: 'place', nodeId: 3 });
  });

  it('阶段一：現金+存款 ≤ 10000 → 不放（0x4210db jle）', () => {
    const view = viewOf({
      nodes: stageOneNodes(),
      lands: [...myStreet, makeLand({ id: 5, owner: 0, name: 'A' })],
      players: meOnLine(1, 0, { cash: 5000, moneyInBank: 0 }),
    });
    expect(aiToolChoice(2, view)).toBeNull();
  });

  it('阶段一：百貨公司格且點券 > 200 → 放（不查钱，0x42126f）', () => {
    const nodes = lineNodes(8);
    nodes[2] = makeNode({ id: 3, x: 30, y: 0, adjacent: [2, 4], specialKind: SPECIAL_KIND.DEPARTMENT_STORE });
    const view = viewOf({ nodes, players: meOnLine(1, 0, { points: 300 }) });
    expect(aiToolChoice(2, view)).toEqual({ kind: 'place', nodeId: 3 });
    const poor = viewOf({ nodes, players: meOnLine(1, 0, { points: 100 }) });
    expect(aiToolChoice(2, poor)).toBeNull();
  });

  it('阶段二：反瞻 6 格 ∩ 画面里我的地，取同區过路费最大的一格', () => {
    const nodes = lineNodes(8, new Map([
      [3, { kind: 'land', index: 1 }],
      [4, { kind: 'land', index: 2 }],
      [5, { kind: 'land', index: 3 }],
    ]));
    const lands = [
      makeLand({ id: 1, owner: 1, level: 3, name: 'A' }), // A 街 2800 + 6000 = 8800
      makeLand({ id: 2, owner: 1, level: 4, name: 'A' }),
      makeLand({ id: 3, owner: 1, level: 5, name: 'B' }), // B 街 10000 → 最大
    ];
    const view = viewOf({ nodes, lands, players: meOnLine(8, 7) });
    expect(aiToolChoice(2, view)).toEqual({ kind: 'place', nodeId: 5 });
  });

  it('阶段二：同區过路费 ≤ 6000×物價 不放（严格大于，0x42138f jle）', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    const lands = [makeLand({ id: 1, owner: 1, level: 4, name: 'A' })]; // 恰 6000
    const view = viewOf({ nodes, lands, players: meOnLine(8, 7) });
    expect(aiToolChoice(2, view)).toBeNull();
  });
});

describe('3 地雷（0x004213c5）', () => {
  it('反瞻 ∩ 画面里有别人的地 → 随机候选（单候选钉死）', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    const view = viewOf({ nodes, lands: [makeLand({ id: 1, owner: 2 })], players: meOnLine(8, 7) });
    expect(aiToolChoice(3, view)).toEqual({ kind: 'place', nodeId: 3 });
  });

  it('两个候选时 rand()%2 挑（D-004 替身：rngState 2 → 前者，1 → 后者）', () => {
    const nodes = lineNodes(4, new Map([
      [2, { kind: 'land', index: 1 }],
      [3, { kind: 'land', index: 2 }],
    ]));
    const lands = [makeLand({ id: 1, owner: 2 }), makeLand({ id: 2, owner: 2 })];
    const first = viewOf({ nodes, lands, players: meOnLine(4, 3), state: { rngState: 2 } });
    const second = viewOf({ nodes, lands, players: meOnLine(4, 3), state: { rngState: 1 } });
    expect(aiToolChoice(3, first)).toEqual({ kind: 'place', nodeId: 2 });
    expect(aiToolChoice(3, second)).toEqual({ kind: 'place', nodeId: 3 });
  });

  it('监狱格有人坐牢 → 立即直选（不等扫完，0x421451）', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    nodes[5] = makeNode({ id: 6, x: 60, y: 0, adjacent: [5, 7], specialKind: SPECIAL_KIND.PRISON });
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 2 })], // 会先被收进候选，但监狱后来居上
      players: meOnLine(8, 7),
      state: { prisonOccupancy: [1, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(aiToolChoice(3, view)).toEqual({ kind: 'place', nodeId: 6 });
  });

  it('我自己的地不进候选 → 不用', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    const view = viewOf({ nodes, lands: [makeLand({ id: 1, owner: 1 })], players: meOnLine(8, 7) });
    expect(aiToolChoice(3, view)).toBeNull();
  });

  // ★★ 通道 2 差分（`rich4-spec/tests/test_tool_policy_ai.py` 的 [E] 组）：
  //   原版监狱/医院那两格是 `cmp dword [0x496b30], 0` —— **4 字节 = 只含槽 0..3 玩家**，
  //   不是落点那种逐槽扫 8 个。仅**物件槽**（4..7）被占用时**不**直选。
  it('★★ 监狱格**只有物件槽**被占 → 不直选（4 字节比较只覆盖槽 0..3）', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    nodes[5] = makeNode({ id: 6, x: 60, y: 0, adjacent: [5, 7], specialKind: SPECIAL_KIND.PRISON });
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 2 })],
      players: meOnLine(8, 7),
      state: { prisonOccupancy: [0, 0, 0, 0, 1, 0, 0, 0] }, // ★ 只有槽 4（物件）
    });
    expect(aiToolChoice(3, view)).toEqual({ kind: 'place', nodeId: 3 });
  });

  it('★★ 医院格**只有物件槽**被占 → 不直选', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    nodes[5] = makeNode({ id: 6, x: 60, y: 0, adjacent: [5, 7], specialKind: SPECIAL_KIND.HOSPITAL });
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 2 })],
      players: meOnLine(8, 7),
      state: { hospitalOccupancy: [0, 0, 0, 0, 0, 1, 0, 0] },
    });
    expect(aiToolChoice(3, view)).toEqual({ kind: 'place', nodeId: 3 });
  });

  it('★★ 只有物件槽被占 + 无其他候选 → 不用（8 槽口径会误直选监狱格）', () => {
    const nodes = lineNodes(8);
    nodes[5] = makeNode({ id: 6, x: 60, y: 0, adjacent: [5, 7], specialKind: SPECIAL_KIND.PRISON });
    const view = viewOf({
      nodes,
      players: meOnLine(8, 7),
      state: { prisonOccupancy: [0, 0, 0, 0, 0, 0, 0, 1] },
    });
    expect(aiToolChoice(3, view)).toBeNull();
  });
});

describe('4 定時炸彈（0x00421574）', () => {
  it('不查归属：无主地所在的普通反瞻格也进候选（rngState 1 → 候选[1,2,3] 取第 2 个）', () => {
    const nodes = lineNodes(3, new Map([[2, { kind: 'land', index: 1 }]]));
    const view = viewOf({ nodes, lands: [makeLand({ id: 1, owner: 0 })], players: meOnLine(3, 2) });
    expect(aiToolChoice(4, view)).toEqual({ kind: 'place', nodeId: 2 });
  });

  it('医院格有人住院 → 直选', () => {
    const nodes = lineNodes(4);
    nodes[1] = makeNode({ id: 2, x: 20, y: 0, adjacent: [1, 3], specialKind: SPECIAL_KIND.HOSPITAL });
    const view = viewOf({
      nodes,
      players: meOnLine(4, 3),
      state: { hospitalOccupancy: [0, 1, 0, 0, 0, 0, 0, 0] },
    });
    expect(aiToolChoice(4, view)).toEqual({ kind: 'place', nodeId: 2 });
  });
});

describe('5 機車（0x00421644）/ 6 汽車（0x00421675）', () => {
  it('機車：徒步且 rand%4==0 → 用（D-004：rngState 4 → 0，1 → 非 0）', () => {
    const yes = viewOf({ state: { rngState: 4 } });
    expect(aiToolChoice(5, yes)).toEqual({ kind: 'plain' });
    const no = viewOf({ state: { rngState: 1 } });
    expect(aiToolChoice(5, no)).toBeNull();
  });

  it('機車：已骑车（traffic & 3 ≠ 0）→ 不用', () => {
    const players = meOnLine(1, 0, { trafficMethod: 1 });
    expect(aiToolChoice(5, viewOf({ players, state: { rngState: 4 } }))).toBeNull();
  });

  it('汽車：traffic < 2 且 rand%4==0 → 用（rngState 1 → 0）；已开汽車 → 不用', () => {
    const walk = viewOf({ state: { rngState: 1 } });
    expect(aiToolChoice(6, walk)).toEqual({ kind: 'plain' });
    const car = viewOf({ players: meOnLine(1, 0, { trafficMethod: 2 }), state: { rngState: 1 } });
    expect(aiToolChoice(6, car)).toBeNull();
  });
});

describe('7 飛彈（0x00421717）', () => {
  // 我站 (0,0)；目标在 ±220 视野内但 ±100 爆风外
  const nodes = [
    makeNode({ id: 1, x: 0, y: 0 }),
    makeNode({ id: 2, x: 150, y: 0 }),
    makeNode({ id: 3, x: 180, y: 0, ref: { kind: 'land', index: 1 } }),
    makeNode({ id: 4, x: 300, y: 0 }),
  ];
  const playersAt = (target: number, targetNode: number) => {
    const players = meOnLine(1, 0);
    players[target] = makePlayer({ index: target, character: target, nodeId: targetNode });
    players[0]!.hostility = [0, 5, 0, 0];
    return players;
  };

  it('最恨的人在视野、我不在爆风、我的地也不在 → 打他脚下', () => {
    const view = viewOf({ nodes, players: playersAt(1, 2) });
    expect(aiToolChoice(7, view)).toEqual({ kind: 'missile', nodeId: 2 });
  });

  it('目标不在视野（±220 外）→ 不打', () => {
    const view = viewOf({ nodes, players: playersAt(1, 4) });
    expect(aiToolChoice(7, view)).toBeNull();
  });

  it('我的地在爆风内（±100）→ 放弃', () => {
    const view = viewOf({ nodes, lands: [makeLand({ id: 1, owner: 1 })], players: playersAt(1, 2) });
    expect(aiToolChoice(7, view)).toBeNull();
  });

  it('我在爆风内 → 放弃', () => {
    const close = [makeNode({ id: 1, x: 0, y: 0 }), makeNode({ id: 2, x: 80, y: 0 })];
    const view = viewOf({ nodes: close, players: playersAt(1, 2) });
    expect(aiToolChoice(7, view)).toBeNull();
  });

  it('没有可恨之人 → select_one_active_player 随机活跃对手（rngState 1 → rivals[2] = 3 号）', () => {
    const spread = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 150, y: 0 }),
      makeNode({ id: 3, x: 160, y: 0 }),
      makeNode({ id: 4, x: 170, y: 0 }),
    ];
    const players = meOnLine(1, 0);
    players[1] = makePlayer({ index: 1, character: 1, nodeId: 2 });
    players[2] = makePlayer({ index: 2, character: 2, nodeId: 3 });
    players[3] = makePlayer({ index: 3, character: 3, nodeId: 4 });
    const view = viewOf({ nodes: spread, players });
    expect(aiToolChoice(7, view)).toEqual({ kind: 'missile', nodeId: 4 });
  });

  // ★★ 通道 2 差分（`rich4-spec/tests/test_missile_target_ai.py` [B]）：
  //   原版 `0x40d31c` 在收集「随机活跃对手」时有一道 `cmp dword [player+0x32], 0`
  //   —— 住店/消失/坐牢/住院（+0x32..+0x35 四字节）任一非 0 的人**不参与**。
  //   最恨的人那条路（`0x40d2d3`）**没有**这道闸，两者不对称。
  const blocked = (p: GameState['players'][number], over: Partial<GameState['players'][number]['blocking']>) => {
    p.blocking = { ...p.blocking, ...over };
    return p;
  };

  it('★★ 随机对手里**关着的人不参与**（+0x32 dword == 0 的闸）', () => {
    const spread = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 150, y: 0 }),
      makeNode({ id: 3, x: 160, y: 0 }),
      makeNode({ id: 4, x: 170, y: 0 }),
    ];
    const players = meOnLine(1, 0);
    players[1] = makePlayer({ index: 1, character: 1, nodeId: 2 });
    players[2] = makePlayer({ index: 2, character: 2, nodeId: 3 });
    players[3] = blocked(makePlayer({ index: 3, character: 3, nodeId: 4 }), { inPrison: 2 });
    const choice = aiToolChoice(7, viewOf({ nodes: spread, players }));
    // 3 号被关 ⇒ 候选只剩 1/2 ⇒ 无论摇到谁都不会是节点 4
    expect(choice).not.toEqual({ kind: 'missile', nodeId: 4 });
  });

  it('★★ 全部随机对手都被关 ⇒ 不用（旧实现会误选一个在押者）', () => {
    const spread = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 150, y: 0 }),
      makeNode({ id: 3, x: 160, y: 0 }),
      makeNode({ id: 4, x: 170, y: 0 }),
    ];
    const players = meOnLine(1, 0);
    players[1] = blocked(makePlayer({ index: 1, character: 1, nodeId: 2 }), { inHospital: 1 });
    players[2] = blocked(makePlayer({ index: 2, character: 2, nodeId: 3 }), { inHotel: 1 });
    players[3] = blocked(makePlayer({ index: 3, character: 3, nodeId: 4 }), { disappearing: 1 });
    expect(aiToolChoice(7, viewOf({ nodes: spread, players }))).toBeNull();
  });

  it('★ 只有 +0x36（冬眠）非 0 **不**排除（原版那道闸只比 +0x32 那 4 字节）', () => {
    const spread = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 150, y: 0 }),
      makeNode({ id: 3, x: 160, y: 0 }),
      makeNode({ id: 4, x: 170, y: 0 }),
    ];
    const players = meOnLine(1, 0);
    players[1] = blocked(makePlayer({ index: 1, character: 1, nodeId: 2 }), { sleeping: 3 });
    players[2] = blocked(makePlayer({ index: 2, character: 2, nodeId: 3 }), { sleeping: 3 });
    players[3] = blocked(makePlayer({ index: 3, character: 3, nodeId: 4 }), { sleeping: 3 });
    expect(aiToolChoice(7, viewOf({ nodes: spread, players }))).not.toBeNull();
  });
});

describe('8 遙控骰子（0x00421827）', () => {
  const myStreet = [makeLand({ id: 1, owner: 1, name: 'A' }), makeLand({ id: 2, owner: 1, name: 'A' })];

  it('前方无主住宅地 + 同區我的地 ≥ 2 + 現金 > 地價×2.5 → 立即定步数', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const view = viewOf({
      nodes,
      lands: [...myStreet, makeLand({ id: 5, owner: 0, name: 'A', landPrice: 1000 })],
      players: meOnLine(1, 0),
    });
    expect(aiToolChoice(8, view)).toEqual({ kind: 'dice', steps: 2 });
  });

  it('衰神/死神附身（godInfo 7/8/15）、龜行、钱少、財運 < 0 → 不用', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const lands = [...myStreet, makeLand({ id: 5, owner: 0, name: 'A' })];
    const base = { nodes, lands };
    expect(aiToolChoice(8, viewOf({ ...base, players: meOnLine(1, 0, { godInfo: 7 }) }))).toBeNull();
    expect(aiToolChoice(8, viewOf({ ...base, players: meOnLine(1, 0, { godInfo: 15 }) }))).toBeNull();
    const tortoise = meOnLine(1, 0);
    tortoise[0]!.blocking.tortoiseWalking = 2;
    expect(aiToolChoice(8, viewOf({ ...base, players: tortoise }))).toBeNull();
    expect(
      aiToolChoice(8, viewOf({ ...base, players: meOnLine(1, 0, { cash: 9000, moneyInBank: 0 }) })),
    ).toBeNull();
    expect(aiToolChoice(8, viewOf({ ...base, players: meOnLine(1, 0, { fortune: -1 }) }))).toBeNull();
  });

  it('前瞻 6 格有岔路 → 不用', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    nodes[1] = makeNode({ id: 2, x: 20, y: 0, adjacent: [1, 3, 4] });
    const view = viewOf({ nodes, lands: [...myStreet, makeLand({ id: 5, owner: 0, name: 'A' })], players: meOnLine(1, 0) });
    expect(aiToolChoice(8, view)).toBeNull();
  });

  it('我的住宅不立即定：扫完取等级最高的记录', () => {
    const nodes = lineNodes(8, new Map([
      [3, { kind: 'land', index: 1 }],
      [5, { kind: 'land', index: 2 }],
    ]));
    const lands = [
      makeLand({ id: 1, owner: 1, level: 2, name: 'A' }),
      makeLand({ id: 2, owner: 1, level: 4, name: 'A' }),
    ];
    const view = viewOf({ nodes, lands, players: meOnLine(1, 0) });
    expect(aiToolChoice(8, view)).toEqual({ kind: 'dice', steps: 4 }); // node5 = 第 4 步
  });

  it('靠后的「立即定」压过靠前的最佳记录（立即定即停扫）', () => {
    const nodes = lineNodes(8, new Map([
      [3, { kind: 'land', index: 1 }],
      [4, { kind: 'facility', index: 1 }],
    ]));
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 1, level: 2, name: 'A' }), makeLand({ id: 2, owner: 1, name: 'A' })],
      facilities: [makeFacility({ id: 1, owner: 0, landPrice: 5000 })],
      players: meOnLine(1, 0),
    });
    expect(aiToolChoice(8, view)).toEqual({ kind: 'dice', steps: 3 }); // node4 = 第 3 步
  });

  it('格上有坏物件（类型 16/17/18 等）→ 该格跳过', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const view = viewOf({
      nodes,
      lands: [...myStreet, makeLand({ id: 5, owner: 0, name: 'A' })],
      players: meOnLine(1, 0),
      state: { objects: objectsWith(26, 3) }, // 地雷压在这格上
    });
    expect(aiToolChoice(8, view)).toBeNull();
  });
});

describe('9 機器工人（0x00421ba6）', () => {
  it('画面内我的可升级地产里取**当前租金**最高者', () => {
    const nodes = [
      makeNode({ id: 1, x: 0, y: 0 }),
      landNode(2, 1, 10, 0),
      landNode(3, 2, 20, 0),
    ];
    const lands = [
      makeLand({ id: 1, owner: 1, level: 1 }), // rent 500
      makeLand({ id: 2, owner: 1, level: 3 }), // rent 2800 → 最高
    ];
    const view = viewOf({ nodes, lands, players: meOnLine(1, 0) });
    expect(aiToolChoice(9, view)).toEqual({ kind: 'build', nodeId: 3 });
  });

  it('設施与住宅同场比较（rateByLevel[level] vs rentByLevel[level]）', () => {
    const nodes = [
      makeNode({ id: 1, x: 0, y: 0 }),
      landNode(2, 1, 10, 0),
      facilityNode(3, 1, 20, 0),
    ];
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 1, level: 3 })], // 2800
      facilities: [makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 2 })], // 4000
      players: meOnLine(1, 0),
    });
    expect(aiToolChoice(9, view)).toEqual({ kind: 'build', nodeId: 3 });
  });

  it('0 级設施按 +0x24 寻址读到的是 housePrice（照搬原版）', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), facilityNode(2, 1, 10, 0)];
    const view = viewOf({
      nodes,
      facilities: [makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 0 })],
      players: meOnLine(1, 0),
    });
    // rateByLevel[0] = housePrice = 1000 > 0 → 选中
    expect(aiToolChoice(9, view)).toEqual({ kind: 'build', nodeId: 2 });
  });

  it('满级 / 别人的地产不盖', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, 10, 0), landNode(3, 2, 20, 0)];
    const full = viewOf({ nodes, lands: [makeLand({ id: 1, owner: 1, level: 5 })], players: meOnLine(1, 0) });
    expect(aiToolChoice(9, full)).toBeNull();
    const theirs = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 2, level: 2 }), makeLand({ id: 2, owner: 2, level: 3 })],
      players: meOnLine(1, 0),
    });
    expect(aiToolChoice(9, theirs)).toBeNull();
  });
});

describe('11 傳送機（0x00421cb6）——AI 用来搬自己', () => {
  it('画面里无主 ≥ 3 级住宅、房價×物價 < 現金、钱闸过 → 搬过去', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, 10, 0)];
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 0, level: 3, housePrice: 200 })],
      players: meOnLine(1, 0),
    });
    expect(aiToolChoice(11, view)).toEqual({ kind: 'teleportSelf', nodeId: 2 });
  });

  it('等级 < 3 不捡；找到候选但 現金+存款 ≤ 10000 也不搬（钱闸在后，0x421dee）', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, 10, 0)];
    const low = viewOf({ nodes, lands: [makeLand({ id: 1, owner: 0, level: 2 })], players: meOnLine(1, 0) });
    expect(aiToolChoice(11, low)).toBeNull();
    const broke = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 0, level: 3 })],
      players: meOnLine(1, 0, { cash: 5000, moneyInBank: 0 }),
    });
    expect(aiToolChoice(11, broke)).toBeNull();
  });

  it('設施同样可捡（公園除外）；并列等级取画面行序最先', () => {
    const nodes = [
      makeNode({ id: 1, x: 0, y: 0 }),
      landNode(2, 1, 10, 0),
      facilityNode(3, 1, 20, 0),
      facilityNode(4, 2, 30, 0),
    ];
    const view = viewOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 0, level: 4, housePrice: 100 })],
      facilities: [
        makeFacility({ id: 1, owner: 0, type: FACILITY_TYPE.hotel, level: 4, housePrice: 100 }),
        makeFacility({ id: 2, owner: 0, type: FACILITY_TYPE.park, level: 4, housePrice: 100 }), // 公園排除
      ],
      players: meOnLine(1, 0),
    });
    // 住宅与旅館同为 4 级：行序最先的 node2 胜出
    expect(aiToolChoice(11, view)).toEqual({ kind: 'teleportSelf', nodeId: 2 });
  });
});

describe('12 工程車（0x00421e20）', () => {
  it('已开着工程車（traffic & 3 == 3）→ 不用', () => {
    const players = meOnLine(1, 0, { trafficMethod: TRAFFIC_ENGINEERING });
    expect(aiToolChoice(12, viewOf({ players, state: { rngState: 7 } }))).toBeNull();
  });

  it('rand%15 ≤ 個性 才用（rngState 7 → 0；8 → 1；10 → 3）', () => {
    const goodBoyYes = viewOf({ players: meOnLine(1, 0, { personality: 0 }), state: { rngState: 7 } });
    expect(aiToolChoice(12, goodBoyYes)).toEqual({ kind: 'plain' });
    const goodBoyNo = viewOf({ players: meOnLine(1, 0, { personality: 0 }), state: { rngState: 8 } });
    expect(aiToolChoice(12, goodBoyNo)).toBeNull();
    const villainYes = viewOf({ players: meOnLine(1, 0, { personality: 2 }), state: { rngState: 8 } });
    expect(aiToolChoice(12, villainYes)).toEqual({ kind: 'plain' });
    const villainNo = viewOf({ players: meOnLine(1, 0, { personality: 2 }), state: { rngState: 10 } });
    expect(aiToolChoice(12, villainNo)).toBeNull();
  });
});

describe('13 核子飛彈（0x00421e62）—— Q-TOOL-3 已结案：原版 AI 会放核彈', () => {
  /** 32px/格 @source 0x0040a22d `sar ebx,5`（与 `test_nuke_card_ai.py` 的 TILE_SHIFT 同） */
  const TILE = 32;
  /** 140 格 —— 稳稳落在爆风窗外（窗外半宽 14 格） */
  const FAR = 140 * TILE;

  /**
   * 造一局：我在 1 号节点 (0,0)；`lands`/`facilities` 自带坐标（原版读记录 +0/+2），
   * 同时各配一个节点 —— 引擎落 action 要从「实体格值」回到节点号。
   * 玩家 1..3 的 whoPlays=0 ⇒ 出局（`0x40d2b4` 只数 whoPlays != 0 的人）。
   */
  function nukeView(o: {
    lands?: LandInfo[];
    facilities?: FacilityInfo[];
    alive?: number;
    meBlocking?: Partial<GameState['players'][number]['blocking']>;
    state?: Partial<GameState>;
  } = {}): ToolAiView {
    const lands = o.lands ?? [];
    const facilities = o.facilities ?? [];
    const alive = o.alive ?? 4;
    const me = makePlayer({ index: 0, character: 0, nodeId: 1 });
    me.blocking = { ...me.blocking, ...(o.meBlocking ?? {}) };
    const players: GameState['players'] = [me];
    for (let i = 1; i < 4; i++) {
      players.push(makePlayer({ index: i, character: i, nodeId: 0, whoPlays: i < alive ? 1 : 0 }));
    }
    const nodes: MapNode[] = [makeNode({ id: 1, x: 0, y: 0 })];
    lands.forEach((l, k) => nodes.push(landNode(2 + k, l.id, l.x, l.y)));
    facilities.forEach((f, k) => nodes.push(facilityNode(2 + lands.length + k, f.id, f.x, f.y)));
    return viewOf({
      nodes,
      lands,
      facilities,
      players,
      ...(o.state !== undefined ? { state: o.state } : {}),
    });
  }

  const foeLand = (over: Partial<LandInfo>): LandInfo =>
    makeLand({ owner: 2, level: 1, x: FAR, y: FAR, ...over });

  // ── ④ 接线本身：典型局面不再返回 null ──
  it('④ 典型局面：唯一候选（别人的 1 级地）离我 140 格 → 出牌（不再返回 null）', () => {
    const view = nukeView({ lands: [foeLand({ id: 1 })] });
    expect(aiToolChoice(13, view)).toEqual({ kind: 'missile', nodeId: 2 });
  });

  // ── ① / ② 中止判据 = 我的棋子落在候选 ±14 格（原版像素 448px）内 ──
  it('① 候选恰在 14 格（448px）→ 我的棋子进窗 → 放弃本候选 ⇒ 不用', () => {
    const view = nukeView({ lands: [foeLand({ id: 1, x: 14 * TILE, y: 0 })] });
    expect(aiToolChoice(13, view)).toBeNull();
  });

  it('② 候选在 15 格（480px）外 → 不中止 ⇒ 出牌（★ 把 14 改成 13 即变红）', () => {
    const view = nukeView({ lands: [foeLand({ id: 1, x: 15 * TILE, y: 0 })] });
    expect(aiToolChoice(13, view)).toEqual({ kind: 'missile', nodeId: 2 });
  });

  it('① 两轴都要在 ±14 内：x 差 14 格、y 差 15 格 ⇒ 不中止 ⇒ 出牌', () => {
    const view = nukeView({ lands: [foeLand({ id: 1, x: 14 * TILE, y: 15 * TILE })] });
    expect(aiToolChoice(13, view)).toEqual({ kind: 'missile', nodeId: 2 });
  });

  // ── Q8：0x40a0b1 只在**没被关**时才画我的标记（0x40a117）──
  it('★★ 被关押（+0x32 的 4 字节非 0）时不画我的标记 ⇒ 同样 2 格也不中止 ⇒ 出牌', () => {
    const near = [foeLand({ id: 1, x: 2 * TILE, y: 0 })];
    expect(aiToolChoice(13, nukeView({ lands: near }))).toBeNull(); // 对照：自由身 ⇒ 中止
    expect(aiToolChoice(13, nukeView({ lands: near, meBlocking: { inPrison: 3 } }))).toEqual({
      kind: 'missile',
      nodeId: 2,
    });
  });

  // ── 中止是**按候选**重置的：近的被弃后换远的（D-004：逐次替身 salt+try）──
  it('★★ 近候选被中止 → 换远候选 ⇒ 出牌（★ 逐次 salt 改成固定 salt 即变红）', () => {
    const lands = [
      foeLand({ id: 1, x: 2 * TILE, y: 0 }), // 近：中止
      foeLand({ id: 2 }), // 远：发
    ];
    // rngState=1 时 aiRoll(salt,2)=0（近）、aiRoll(salt+1,2)=1（远）
    const view = nukeView({ lands, state: { rngState: 1 } });
    expect(aiToolChoice(13, view)).toEqual({ kind: 'missile', nodeId: 3 });
  });

  // ── 候选三道闸（@source 0x421e9e..0x421eb8 / 0x421f0a..0x421f24）──
  it('候选闸门：无主 / 我的 / level == 0 都不入选；地块 0 号永不入选 ⇒ 0 候选不用', () => {
    expect(
      aiToolChoice(
        13,
        nukeView({
          lands: [
            foeLand({ id: 1, owner: 0, level: 2 }),
            foeLand({ id: 2, owner: 1, level: 2 }),
            foeLand({ id: 3, owner: 2, level: 0 }),
            foeLand({ id: 0, owner: 2, level: 2 }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it('設施同样是候选（格值 0xfa0+i）：别人的 2 级設施 → 出牌', () => {
    const view = nukeView({
      facilities: [makeFacility({ id: 1, owner: 2, level: 2, x: FAR, y: FAR })],
    });
    expect(aiToolChoice(13, view)).toEqual({ kind: 'missile', nodeId: 2 });
  });

  it('★ 候选次序：先地块后設施（rand 取到 0 → 地块 node2，取到 1 → 設施 node3）', () => {
    const lands = [foeLand({ id: 1 })];
    const facilities = [makeFacility({ id: 1, owner: 2, level: 1, x: FAR, y: FAR })];
    expect(aiToolChoice(13, nukeView({ lands, facilities, state: { rngState: 1 } }))).toEqual({
      kind: 'missile',
      nodeId: 2,
    });
    expect(aiToolChoice(13, nukeView({ lands, facilities, state: { rngState: 0 } }))).toEqual({
      kind: 'missile',
      nodeId: 3,
    });
  });

  // ── 发弹判据：两个比值都 < 1/(存活数+2) ──
  it('★ 数量比：窗内我也有产业（mine/other = 1/1）⇒ 不过 ⇒ 不用', () => {
    const lands = [foeLand({ id: 1 }), makeLand({ id: 2, owner: 1, level: 1, x: FAR, y: FAR })];
    expect(aiToolChoice(13, nukeView({ lands }))).toBeNull();
  });

  it('★ 等级和比单独卡住：mine/other = 1/7 过关、mineLv/otherLv = 10/7 不过 ⇒ 不用', () => {
    const lands = [
      ...Array.from({ length: 7 }, (_, i) => foeLand({ id: i + 1 })),
      makeLand({ id: 8, owner: 1, level: 10, x: FAR, y: FAR }),
    ];
    expect(aiToolChoice(13, nukeView({ lands }))).toBeNull();
  });

  it('★ 阈值 1/(存活数+2)：mine/other = 1/5 = 0.2 ⇒ 存活 2 发（阈 1/4）、存活 4 不发（阈 1/6）', () => {
    const lands = [
      ...Array.from({ length: 5 }, (_, i) => foeLand({ id: i + 1 })),
      makeLand({ id: 6, owner: 1, level: 1, x: FAR, y: FAR }),
    ];
    expect(aiToolChoice(13, nukeView({ lands, alive: 2 }))?.kind).toBe('missile');
    expect(aiToolChoice(13, nukeView({ lands, alive: 4 }))).toBeNull();
  });

  it('我出的起吗：本函数**没有**钱闸（0x421e62 全程不读現金/存款/財運）', () => {
    const broke = [makePlayer({ index: 0, character: 0, nodeId: 1, cash: 0, moneyInBank: 0, fortune: -5 })];
    for (let i = 1; i < 4; i++) broke.push(makePlayer({ index: i, character: i, nodeId: 0 }));
    const view = viewOf({
      nodes: [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, FAR, FAR)],
      lands: [foeLand({ id: 1 })],
      players: broke,
    });
    expect(aiToolChoice(13, view)).toEqual({ kind: 'missile', nodeId: 2 });
  });

  // ── 决定链：持有 13 且肯用时，missile 支把节点号传给 useTool ──
  it('接线：持有 13、個性 2（f7=2 不受闸门拦）⇒ decideTool 给出 useTool', () => {
    const ctx = ctxOf({
      nodes: [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, FAR, FAR)],
      lands: [foeLand({ id: 1 })],
      players: meOnLine(1, 0, { personality: 2 }),
      tools: { 13: 1 },
    });
    expect(decideTool(ctx)).toEqual({ type: 'useTool', toolId: 13, nodeId: 2 });
  });
});

// ============================================================
//  decideTool 接线（闸门 → 环形 4 件 → 判定 → 预演 → action）
// ============================================================
describe('decideTool 接线', () => {
  it('aiFlags bit1 为 0 的 AI 不用道具（0x00447f87）', () => {
    const ctx = ctxOf({
      nodes: lineNodes(4),
      players: meOnLine(1, 0, { aiFlags: 1 }), // 只会出牌
      state: { rngState: 4 }, // 機車本会肯用
      tools: { 5: 1 },
    });
    expect(decideTool(ctx)).toBeNull();
  });

  it('道具栏扫描跳过時光機（槽下标 9）：只持有它时不出手', () => {
    const ctx = ctxOf({ nodes: lineNodes(4), players: meOnLine(1, 0), tools: { 10: 2 } });
    expect(decideTool(ctx)).toBeNull();
  });

  it('种类 > 4 时环形取 4 件：rngState 20 → 起点 1，機車第一个肯用', () => {
    const ctx = ctxOf({
      nodes: lineNodes(4),
      players: meOnLine(1, 0),
      state: { rngState: 20 },
      tools: { 3: 1, 5: 1, 9: 1, 11: 1, 12: 1 },
    });
    expect(decideTool(ctx)).toEqual({ type: 'useTool', toolId: 5 });
  });

  it('同一栏位 rngState 6 → 起点 2，機車不在环形里 → 不出手', () => {
    const ctx = ctxOf({
      nodes: lineNodes(4),
      players: meOnLine(1, 0),
      state: { rngState: 6 },
      tools: { 3: 1, 5: 1, 9: 1, 11: 1, 12: 1 },
    });
    expect(decideTool(ctx)).toBeNull();
  });

  it('個性闸门：乖寶寶（0）拿不到凶狠度 2 的飛彈（f7 − 個性 ≥ 2 从不）', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), makeNode({ id: 2, x: 150, y: 0 })];
    const players = meOnLine(1, 0, { personality: 0 });
    players[1] = makePlayer({ index: 1, character: 1, nodeId: 2 });
    players[0]!.hostility = [0, 5, 0, 0];
    const ctx = ctxOf({ nodes, players, tools: { 7: 1 } });
    expect(decideTool(ctx)).toBeNull();
  });

  it('遙控骰子 action：value = 步数（1..6）', () => {
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 5 }]]));
    const ctx = ctxOf({
      nodes,
      lands: [
        makeLand({ id: 1, owner: 1, name: 'A' }),
        makeLand({ id: 2, owner: 1, name: 'A' }),
        makeLand({ id: 5, owner: 0, name: 'A', landPrice: 1000 }),
      ],
      players: meOnLine(1, 0),
      tools: { 8: 1 },
    });
    expect(decideTool(ctx)).toEqual({ type: 'useTool', toolId: 8, value: 2 });
  });

  it('傳送機 action：nodeId = 玩家下标+1、value = 目标节点（搬人那一路）', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, 10, 0, [1, 3]), makeNode({ id: 3, x: 20, y: 0, adjacent: [2] })];
    const ctx = ctxOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 0, level: 3, housePrice: 100 })],
      players: meOnLine(1, 0, { personality: 1 }), // 傳送機 f7=1：普通人不受闸门拦
      tools: { 11: 1 },
    });
    expect(decideTool(ctx)).toEqual({ type: 'useTool', toolId: 11, nodeId: 1, value: 2 });
  });

  it('傳送機预演：候选就是自己脚下这格 → 不出（teleportPlayer 原地拒收，防活锁）', () => {
    const nodes = [landNode(1, 1, 0, 0, [2]), makeNode({ id: 2, x: 10, y: 0, adjacent: [1] })];
    const ctx = ctxOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 0, level: 3, housePrice: 100 })],
      players: meOnLine(1, 0, { personality: 1 }),
      tools: { 11: 1 },
    });
    expect(decideTool(ctx)).toBeNull();
  });

  it('放置类预演：地雷肯放但物件槽全满 → 不出（placeObject 拒收，防活锁）', () => {
    const objects = makeObjects(OBJECT_COUNT);
    for (let s = 26; s <= 35; s++) objects[s]!.nodeId = 40; // 地雷槽 26..35 全占
    const nodes = lineNodes(8, new Map([[3, { kind: 'land', index: 1 }]]));
    const ctx = ctxOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 2 })],
      players: meOnLine(8, 7, { personality: 1 }),
      state: { objects },
      tools: { 3: 1 },
    });
    expect(decideTool(ctx)).toBeNull();
  });

  it('機器工人：我的 5 级满级地 → 不出（level ≥ 5 跳过）', () => {
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), landNode(2, 1, 10, 0)];
    const ctx = ctxOf({
      nodes,
      lands: [makeLand({ id: 1, owner: 1, level: 5 })],
      players: meOnLine(1, 0, { personality: 1 }),
      tools: { 9: 1 },
    });
    expect(decideTool(ctx)).toBeNull();
  });
});
