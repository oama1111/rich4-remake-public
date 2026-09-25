/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 機器工人与两枚飛彈 —— 要真地图才测得动
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame as newGameRaw } from '../rules/new-game.ts';
import { landAll } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { TOOL_SLOTS_PER_PLAYER, toolCount } from '../rules/tools.ts';
import { MISSILE_RADIUS, NUKE_VIEW_HALF } from '../rules/tool-effects.ts';
import { housingIndexOf, facilityIndexOf } from '../rules/land.ts';

/**
 * 夹具：「第一輪已经过去」—— 这里测的不是开局，要的是大家都已在盘上
 * （`newGame` 只摆第 1 位，其余轮到自己才落地，见 `rules/start-placement.ts`）。
 */
const newGame = (o: Parameters<typeof newGameRaw>[0]): ReturnType<typeof newGameRaw> =>
  landAll(newGameRaw(o), o.map.nodes);

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
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
  // 道具只能在按 GO 之前用（`canUseItemsNow`）
  return { state: { ...base, tools, phase: 'awaitingRoll' } as GameState, topo, map };
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

  // ★ 2026-09-24 审计订正：take_tool（`0x004472fb`）在 `0x40b110`（`0x00447345`）之前 ⇒ 盖不上也扣道具
  run('满级的地盖不上去，但道具照扣', () => {
    const { state, topo } = setup({ 9: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const idx = housingIndexOf(node.type)!;
    const landLevel = [...state.landLevel];
    landLevel[idx] = 5;
    const s: GameState = { ...state, landLevel };
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: node.id }, topo);
    expect(after.landLevel[idx]).toBe(5);
    expect(after.tools[9]).toBe(0);
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
  // ★★ 2026-09-24 订正（需求方问「核子飛彈会不会炸周围建筑」时对照出来的）：
  //   先前这条断言「全图」—— 依据是把半径 −1 读成整张地图。机器码是
  //   `0x0040a469 xor esi,esi / mov edi,0x1b8` + `0x0040a494 call 0x409de7`：收的是**当前镜头**下那张
  //   440×440 的 id 图（镜头已由 `0x447b77 call 0x41d476` 移到目标上）⇒ 只炸**画面里**的那一片。
  run('★ 画面范围（±220，镜头在目标上）—— 里面连地契一起烧掉，外面一块都不动', () => {
    const { state, topo } = setup({ 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const landLevel = state.landLevel.map(() => 3);
    const landOwner = state.landOwner.map(() => 2);
    const s: GameState = { ...state, landLevel, landOwner };

    const r = reduce(s, { type: 'useTool', toolId: 13, nodeId: node.id }, topo);
    const target = topo.nodes[node.id - 1]!;
    let inside = 0;
    let outside = 0;
    for (const n of topo.nodes) {
      const idx = housingIndexOf(n.type);
      if (idx === null) continue;
      const near = Math.abs(n.x - target.x) <= NUKE_VIEW_HALF && Math.abs(n.y - target.y) <= NUKE_VIEW_HALF;
      if (near) {
        expect(r.landLevel[idx], `节点 ${n.id} 在画面里`).toBe(0);
        expect(r.landOwner[idx], `节点 ${n.id} 在画面里`).toBe(0);
        inside++;
      } else {
        expect(r.landLevel[idx], `节点 ${n.id} 在画面外`).toBe(3);
        expect(r.landOwner[idx], `节点 ${n.id} 在画面外`).toBe(2);
        outside++;
      }
    }
    // 既炸到东西、又不是全图（否则测的是退化情形）
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });

  run('★ 范围里的人住院 3 天、车也没了', () => {
    const { state, topo } = setup({ 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    // 1 号站在目标格上（画面正中）；0 号（发射者）挪到画面外，免得自己也被算进去
    const far = topo.nodes.find((n) => {
      const t = topo.nodes[node.id - 1]!;
      return Math.abs(n.x - t.x) > NUKE_VIEW_HALF || Math.abs(n.y - t.y) > NUKE_VIEW_HALF;
    })!;
    const players = state.players.map((p, i) =>
      i === 1 ? { ...p, nodeId: node.id, trafficMethod: 2, ndices: 3 } : i === 0 ? { ...p, nodeId: far.id } : p,
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

  // ★★ 2026-09-24 订正：先前断言「飛彈不炸自己」（理由是「自己站在别处」）—— 原版没有这条例外：
  //   `0x40ae8c..0x40aeaa` 对 id 里每个玩家位都 `call 0x40cd07`，片后 `0x004470a1` 那一圈也不看是谁。
  run('★ 飛彈与核彈都炸自己（站在范围里就算，没有发射者例外）', () => {
    const { state, topo } = setup({ 7: 1, 13: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    // 把自己挪到目标格上
    const players = state.players.map((p, i) => (i === 0 ? { ...p, nodeId: node.id } : p));
    const s: GameState = { ...state, players };

    const byMissile = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(byMissile.players[0]!.blocking.inHospital).toBe(3);

    const byNuke = reduce(s, { type: 'useTool', toolId: 13, nodeId: node.id }, topo);
    expect(byNuke.players[0]!.blocking.inHospital).toBe(3);
  });

  // @source 0x40cd07：`cmp dword [+0x32], 0 / jne 0x40cd70` —— 住店 / 消失 / 監獄 / 醫院里的人不挂 0x40
  //   ⇒ 片后那一圈（`0x4470ac test [+0x15], 0x40`）不记仇、不续住院天数
  run('★ 范围里但已经关着的人（醫院）不再挨：不记仇、住院天数不续', () => {
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const players = state.players.map((p, i) =>
      i === 1 ? { ...p, nodeId: node.id, blocking: { ...p.blocking, inHospital: 2 } } : p,
    );
    const s: GameState = { ...state, players };
    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(r.players[1]!.blocking.inHospital).toBe(2);
    expect(r.players[1]!.hostility[0]).toBe(s.players[1]!.hostility[0]);
  });

  // @source 0x40aee0..0x40aefc：id 的 bits 8..14 = 物件 handle ⇒ `call 0x40e14d` 释放（地雷回库存）
  run('★ 爆风里地上的物件被炸掉（地雷回库存），范围外的留着', () => {
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const target = topo.nodes[node.id - 1]!;
    const far = topo.nodes.find(
      (n) => Math.abs(n.x - target.x) > MISSILE_RADIUS || Math.abs(n.y - target.y) > MISSILE_RADIUS,
    )!;
    const objects = state.objects.map((o) => ({ ...o, nodeId: 0, attached: 0 }));
    objects[26] = { ...objects[26]!, nodeId: node.id }; // 槽 26..35 = 地雷
    objects[27] = { ...objects[27]!, nodeId: far.id };
    const s: GameState = { ...state, objects };
    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(r.objects[26]!.nodeId).toBe(0);
    expect(r.toolStock[3]).toBe((s.toolStock[3] ?? 0) + 1);
    expect(r.objects[27]!.nodeId).toBe(far.id);
  });

  // @source 0x40aeb4..0x40aede：id 的 bits 4..7 = 惡人 ⇒ `send_to_hospital(惡人, 0)`（0x43ee37 `+10 = 2`、0x43ee62 占用表）
  run('★ 爆风里站在棋盘上的惡人进醫院', () => {
    const { state, topo } = setup({ 7: 1 });
    const node = firstHousingNode(topo);
    if (node === undefined) return;
    const specialActors = state.specialActors.map((a, i) => (i === 0 ? { ...a, nodeId: node.id, place: 0 } : a));
    const s: GameState = { ...state, specialActors: specialActors as GameState['specialActors'] };
    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: node.id }, topo);
    expect(r.specialActors[0]!.place).toBe(2);
    expect(r.hospitalOccupancy[4]).toBe(1);
  });

  // 一座設施占两个节点，id 图里只有一个 id ⇒ 只挨一次
  run('★ 設施占两格也只挨一次 —— 敌意 30×物價 记一遍', () => {
    const { state, topo } = setup({ 7: 1 });
    const facNode = topo.nodes.find((n) => facilityIndexOf(n.type) !== null)!;
    const fid = facilityIndexOf(facNode.type)!;
    expect(topo.nodes.filter((n) => facilityIndexOf(n.type) === fid).length).toBeGreaterThan(1);
    const facilityLevel = [...state.facilityLevel];
    const facilityOwner = [...state.facilityOwner];
    facilityLevel[fid] = 3;
    facilityOwner[fid] = 2;
    // 地块全清，免得住宅那一支也给 1 号记仇
    const landOwner = state.landOwner.map(() => 0);
    const s: GameState = { ...state, facilityLevel, facilityOwner, landOwner };
    const r = reduce(s, { type: 'useTool', toolId: 7, nodeId: facNode.id }, topo);
    expect(r.facilityLevel[fid]).toBe(2);
    expect(r.players[1]!.hostility[0]).toBe(30 * s.priceIndex);
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
