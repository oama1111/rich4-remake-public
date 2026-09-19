/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 機器工人与两枚飛彈 —— 要真地图才测得动
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { TOOL_SLOTS_PER_PLAYER, toolCount } from '../rules/tools.ts';
import { MISSILE_RADIUS } from '../rules/tool-effects.ts';
import { housingIndexOf, facilityIndexOf } from '../rules/land.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

function setup(counts: Record<number, number>) {
  const map = loadMap();
  const topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
  landscapes: map.landscapes,
  };
  const base = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 11,
  });
  const tools = [...base.tools];
  for (const [id, n] of Object.entries(counts)) tools[Number(id)] = n;
  return { state: { ...base, tools } as GameState, topo, map };
}

/** 第一个住宅节点 */
function firstHousingNode(topo: { nodes: readonly { id: number; type: number }[] }) {
  return topo.nodes.find((n) => housingIndexOf(n.type) !== null);
}

describe('★ 機器工人（9）', () => {
  run('在选中的地块上免费加蓋一级 —— 不花钱、不看归属', () => {
    const { state, topo } = setup({ 9: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const idx = housingIndexOf(node.type)!;
    // 先把地判给别人，证明「连别人的地都能替他盖」
    const landOwner = [...state.landOwner];
    landOwner[idx] = 2;
    const s: GameState = { ...state, landOwner };
    const before = s.players[0]!.cash;

    const r = reduce(s, { type: 'useTool', toolId: 9, nodeId: node.id }, topo);
    expect(r.landLevel[idx]).toBe((s.landLevel[idx] ?? 0) + 1);
    expect(r.landOwner[idx]).toBe(2);
    expect(r.players[0]!.cash).toBe(before);
    expect(toolCount(r.tools, 0, 9)).toBe(0);
  });

  run('满级的地盖不上去，道具也不消耗', () => {
    const { state, topo } = setup({ 9: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const idx = housingIndexOf(node.type)!;
    const landLevel = [...state.landLevel];
    landLevel[idx] = 5;
    const s: GameState = { ...state, landLevel };
    expect(reduce(s, { type: 'useTool', toolId: 9, nodeId: node.id }, topo)).toBe(s);
  });
});

describe('★ 飛彈（7）', () => {
  run('把半径内的房子各拆一级，范围外的不动', () => {
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    // 全图都盖到 3 级、判给玩家 1
    const landLevel = state.landLevel.map(() => 3);
    const landOwner = state.landOwner.map(() => 2);
    const s: GameState = { ...state, landLevel, landOwner };

    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    const target = topo.nodes[node.id - 1]!;
    let inside = 0;
    let outside = 0;
    for (const n of topo.nodes) {
      const idx = housingIndexOf(n.type);
      if (idx === null) continue;
      const near =
        Math.abs(n.x - target.x) <= MISSILE_RADIUS && Math.abs(n.y - target.y) <= MISSILE_RADIUS;
      if (near) {
        expect(r.landLevel[idx], `节点 ${n.id} 在范围内`).toBe(2);
        inside++;
      } else {
        expect(r.landLevel[idx], `节点 ${n.id} 在范围外`).toBe(3);
        outside++;
      }
    }
    // ★ 这一发必须既炸到东西、又没炸到全图，否则测的是个退化情形
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
    expect(toolCount(r.tools, 0, 7)).toBe(0);
  });

  run('★★ 設施也在范围内（`flags = 0x26` 里那一位）—— 掉一级 + 地主同样记仇 30×物價', () => {
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const target = topo.nodes[node.id - 1]!;
    // 找一处落在范围里的設施
    const fac = topo.facilities?.find(
      (f) =>
        Math.abs(f.x - target.x) <= MISSILE_RADIUS && Math.abs(f.y - target.y) <= MISSILE_RADIUS,
    );
    if (fac === undefined) return; // 这张图上没炸到設施就跳过
    const facilityLevel = [...state.facilityLevel];
    const facilityOwner = [...state.facilityOwner];
    facilityLevel[fac.id] = 3;
    facilityOwner[fac.id] = 2; // 玩家 1 的企業
    const s: GameState = { ...state, facilityLevel, facilityOwner };
    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(r.facilityLevel[fac.id]).toBe(2);
    expect(r.facilityOwner[fac.id]).toBe(2); // 轻击保留归属
    expect(r.players[1]!.hostility[0]).toBeGreaterThanOrEqual(30 * s.priceIndex);
  });

  run('★ 地主记仇 30 × 物价指数', () => {
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const idx = housingIndexOf(node.type)!;
    const landLevel = state.landLevel.map(() => 0);
    const landOwner = state.landOwner.map(() => 0);
    landLevel[idx] = 3;
    landOwner[idx] = 2; // 玩家 1 的地
    const s: GameState = { ...state, landLevel, landOwner };
    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(r.players[1]!.hostility[0]).toBe(30 * s.priceIndex);
  });
});

describe('★ 核子飛彈（13）', () => {
  run('★ 全图 —— 而且连地契一起烧掉', () => {
    const { state, topo } = setup({ 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const landLevel = state.landLevel.map(() => 3);
    const landOwner = state.landOwner.map(() => 2);
    const s: GameState = { ...state, landLevel, landOwner };

    const r = reduce(s, { type: 'useTool', toolId: 13, nodeId: node.id }, topo);
    for (const n of topo.nodes) {
      const idx = housingIndexOf(n.type);
      if (idx === null) continue;
      expect(r.landLevel[idx], `节点 ${n.id}`).toBe(0);
      expect(r.landOwner[idx], `节点 ${n.id}`).toBe(0);
    }
  });

  run('★ 范围里的人住院 3 天、车也没了', () => {
    const { state, topo } = setup({ 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const players = state.players.map((p, i) =>
      i === 1 ? { ...p, trafficMethod: 2, ndices: 3 } : p,
    );
    const s: GameState = { ...state, players };
    const r = reduce(s, { type: 'useTool', toolId: 13, nodeId: node.id }, topo);

    expect(r.players[1]!.blocking.inHospital).toBe(3);
    expect(r.players[1]!.trafficMethod).toBe(0);
    expect(r.players[1]!.ndices).toBe(1);
    expect(r.hospitalOccupancy[1]).toBe(1);
    // 敌意 90 × 物价指数
    expect(r.players[1]!.hostility[0]).toBe(90 * s.priceIndex);
    // 车回全局库存
    expect(r.toolStock[6]).toBe((s.toolStock[6] ?? 0) + 1);
  });

  run('★ 核彈连自己也炸 —— 飛彈不炸自己', () => {
    const { state, topo } = setup({ 7: 1, 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    // 把自己挪到目标格上
    const players = state.players.map((p, i) => (i === 0 ? { ...p, nodeId: node.id } : p));
    const s: GameState = { ...state, players };

    const byMissile = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(byMissile.players[0]!.blocking.inHospital).toBe(0);

    const byNuke = reduce(s, { type: 'useTool', toolId: 13, nodeId: node.id }, topo);
    expect(byNuke.players[0]!.blocking.inHospital).toBe(3);
  });
});

// ============================================================
//  ★★ 第 160 条：`damage_area` 的三处「算了不写 / 该做没做」
//      （README §7.142(5) 的 E9 #6/#7/#11，通道 2 `test_damage_area.py`）
// ============================================================
describe('★★ 范围伤害必须把种类/地契落到状态（damage_area @source 0x0040ac7b）', () => {
  const inMissileRange = (
    n: { x: number; y: number },
    target: { x: number; y: number },
  ): boolean =>
    Math.abs(n.x - target.x) <= MISSILE_RADIUS && Math.abs(n.y - target.y) <= MISSILE_RADIUS;

  run('★★ 飛彈把連鎖店夷平成「0 级住宅」—— landType 必须落回', () => {
    // @source 0x40ad2a `cmp byte [ebx+0x18],0 / je 结束` → `0x40ad30 [+0x1a]=0 / [+0x18]=0`
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const idx = housingIndexOf(node.type)!;
    const landLevel = state.landLevel.map(() => 0);
    const landOwner = state.landOwner.map(() => 0);
    const landType = state.landType.map(() => 0);
    landLevel[idx] = 2;
    landType[idx] = 1; // 連鎖店
    landOwner[idx] = 2;
    const s: GameState = { ...state, landLevel, landOwner, landType };

    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(r.landLevel[idx]).toBe(0);
    // ★ 修复前这里仍是 1（`out.type` 被丢弃）⇒ 复刻留着一个「0 级連鎖店」
    expect(r.landType[idx]).toBe(0);
    expect(r.landOwner[idx]).toBe(2); // 轻击保留归属
  });

  run('★★ 核彈连地契一起烧 —— landType / landTenure 都要清', () => {
    // @source 0x40ad6b..0x40ad77：`[+0x19]/[+0x1a]/[+0x18]` 与 **`+0x30`** 全清
    const { state, topo } = setup({ 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const idx = housingIndexOf(node.type)!;
    const landLevel = state.landLevel.map(() => 0);
    const landOwner = state.landOwner.map(() => 0);
    const landType = state.landType.map(() => 0);
    const landTenure = state.landTenure.map(() => 0);
    landLevel[idx] = 4;
    landType[idx] = 1;
    landOwner[idx] = 2;
    landTenure[idx] = 0x7fff;
    const s: GameState = { ...state, landLevel, landOwner, landType, landTenure };

    const r = reduce(s, { type: 'useTool', toolId: 13, nodeId: node.id }, topo);
    expect(r.landType[idx]).toBe(0);
    expect(r.landTenure[idx]).toBe(0); // ★ 修复前不动 ⇒ 之后会被 sweepTenure「到期」
  });

  run('★★ 輕击打「等级已经是 0」的設施：照样清种类并放人', () => {
    // ★ `damage_area` 与 `0x40ab4a` 的 mode 0 **不是**同一份逻辑：
    //   `0x40ae03 mov al,[ebx+0x1a] / test al,al / jne 结束` 读的是**减完之后**的等级，
    //   所以「本来就是 0」也走 `0x40ae0a type=0` + `0x40ae0d call 0x40dffa`。
    const { state, topo } = setup({ 7: 1 });
    // ★ 目标就选**設施所在的那一格** —— 飛彈的 `useTool` 不校验目标类型，
    //   而爆风窗口是以目标格为中心的方窗，这样那一处設施必然在窗内（距离 0）。
    const facNode = topo.nodes.find((n) => facilityIndexOf(n.type) !== null);
    // ★ 这里**不能**写成「找不到就 return」—— 那会让本用例静默变成空跑
    expect(facNode, '这张图上必须有設施，否则本用例什么都没验').toBeDefined();
    if (facNode === undefined) return;
    const facId = facilityIndexOf(facNode.type)!;
    const target = facNode;
    const facilityLevel = [...state.facilityLevel];
    const facilityType = [...state.facilityType];
    const facilityOwner = [...state.facilityOwner];
    facilityLevel[facId] = 0; // 拆到 0 级后留下的那种记录
    facilityType[facId] = 1;
    facilityOwner[facId] = 2;
    // 一个被关在旅館、且**在爆风外**的玩家：用来观察「一刀切放人」
    const far = topo.nodes.find((n) => !inMissileRange(n, target));
    expect(far, '地图上必须有爆风外的格').toBeDefined();
    if (far === undefined) return;
    const players = state.players.map((p, i) =>
      i === 1 ? { ...p, nodeId: far.id, blocking: { ...p.blocking, inHotel: 3 } } : p,
    );
    const s: GameState = { ...state, facilityLevel, facilityType, facilityOwner, players };

    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: facNode.id }, topo);
    // ★ 修复前 `mutateFacility` 在 level===0 时提前返回 ⇒ 种类仍是 1、也没人放出来
    expect(r.facilityType[facId]).toBe(0);
    expect(r.players[1]!.blocking.inHotel).toBe(0x80);
  });
});

void TOOL_SLOTS_PER_PLAYER;
