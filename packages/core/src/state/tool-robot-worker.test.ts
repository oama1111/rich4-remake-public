/*
 * 機器工人（9）—— 规则取证与回归（Q-TOOL-4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方报的「使用機器工人无法给自己的地块修成房子」，规则层**本身是通的**：
 *   这一份测试就是钉「规则怎么算」的。点不动那一半是**拾取落点**的问题，
 *   在 client 的 `picking.ts`（候选挂在节点/路面，而地块画在白格/建筑上，
 *   差 42..62 屏幕像素），回归测试见 `packages/client/src/pick-anchor.test.ts`。
 *
 * ★ 四条判据**全部回 exe 取证**（VA 0x0040b110，`fcn_0040b110`）：
 *   ```asm
 *   0040b117  cmp edx, 0x7d0 / jle  → 設施段
 *   0040b11f  cmp edx, 0xfa0 / jge  → 設施段
 *   0040b127  lea ecx, [edx - 0x7d0] / imul ecx, 0x34   ; ★ 参数是**地块编码** 2000+下标
 *   0040b138  cmp byte [ebx + 0x18], 0                   ; type == 0（住宅）
 *   0040b13e  cmp byte [ebx + 0x1a], 5 / jae 不可建        ; level < 5
 *   0040b149  mov cl, [ebx + 0x18] / cmp cl, 1           ; type == 1（連鎖店）
 *   0040b151  cmp cl, [ebx + 0x1a] / jbe 不可建           ; 1 <= level → 不可建（即只有 0 级可盖）
 *   0040b161  mov cl, [ebx + 0x1a] / inc cl / mov [..], cl ; level++
 *   0040b169  cmp cl, 5 / jne / or al, 0x80               ; ★ 刚满 5 级 → 置 bit7（表现层用）
 *   ```
 *   ★ **全程没有碰过 `+0x19`（owner）与任何金额** ——
 *     不花钱、不看归属（连别人的地、无主地都替他盖）。
 *     「只能盖自己的地」是 **AI 的判定函数**（`0x421ba6`：`cmp owner, 当前+1 / jne 跳过`）
 *     在做**选择**，不是效果的限制 —— 见 `ai/tool-policy.test.ts` 的「别人的地产不盖」。
 *
 * ⚠️ 用法上的一处 exe 差异（登记在 `docs/deviations/Q-TOOL-4.md`）：
 *   `rich4_use_tool_jiqigongren` 在 VA 0x004472fb 就 `call 0x445aa2`（take_tool）**先扣**，
 *   之后才 `call 0x40b110` —— 即「选到了就消耗，盖不成也消耗」。
 *   本引擎的既定口径是「**只在真正生效时才收走道具**」（`useToolAction` 的 consume），
 *   且 UI 不会把盖不动的地列成候选，所以这条差异观察不到。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import type { LandInfo } from '../loaders/map.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import { canUseTool } from './preview.ts';
import type { GameState } from './types.ts';
import { toolCount } from '../rules/tools.ts';
import { housingIndexOf } from '../rules/land.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const TOOL = 9;

/** 一张真地图 + 玩家 0 手里一件機器工人；`over` 覆盖地块状态 */
function setup(over: Partial<GameState> = {}) {
  const map = loadMap();
  const topo: MapTopology = {
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
  tools[TOOL] = 1;
  /** 第一块住宅地：节点号、地块下标、模板 */
  const node = map.nodes.find((n) => housingIndexOf(n.type) !== null)!;
  const idx = housingIndexOf(node.type)!;
  const template = topo.lands!.find((l) => l.id === idx)!;
  const state: GameState = { ...base, tools, ...over };
  /** 把某块地的（owner, level, type）写进状态 */
  const withLand = (o: Partial<LandInfo> = {}): GameState => {
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    const landType = [...state.landType];
    landOwner[idx] = o.owner ?? template.owner;
    landLevel[idx] = o.level ?? template.level;
    landType[idx] = o.type ?? template.type;
    return { ...state, landOwner, landLevel, landType };
  };
  return { map, topo, state, node, idx, template, withLand };
}

const use = (s: GameState, topo: MapTopology, nodeId: number): GameState =>
  reduce(s, { type: 'useTool', toolId: TOOL, nodeId }, topo);

describe('★ 機器工人（9）：自己的地', () => {
  run('自己的**空地** → 蓋成 1 级（平房），不花钱、道具收走', () => {
    const { topo, node, idx, withLand } = setup();
    const s = withLand({ owner: 1, level: 0 });
    const cash = s.players[0]!.cash;
    // 预演（拾取模式的判据）与真发一次必须同口径
    expect(canUseTool(s, topo, TOOL, node.id)).toBe(true);
    const r = use(s, topo, node.id);
    expect(r).not.toBe(s);
    expect(r.landLevel[idx]).toBe(1);
    expect(r.landOwner[idx]).toBe(1);
    expect(r.players[0]!.cash).toBe(cash); // ★ 免费
    expect(toolCount(r.tools, 0, TOOL)).toBe(0);
  });

  run('自己的**已有房** → 升一级（1 → 2）', () => {
    const { topo, node, idx, withLand } = setup();
    const s = withLand({ owner: 1, level: 1 });
    expect(canUseTool(s, topo, TOOL, node.id)).toBe(true);
    expect(use(s, topo, node.id).landLevel[idx]).toBe(2);
  });

  run('滿級（5）→ 不生效、道具也不消耗', () => {
    const { topo, node, withLand } = setup();
    const s = withLand({ owner: 1, level: MAX_LAND_LEVEL });
    expect(canUseTool(s, topo, TOOL, node.id)).toBe(false);
    expect(use(s, topo, node.id)).toBe(s);
  });
});

describe('★ 機器工人（9）：归属与钱（exe 全都**不看**，与需求方的猜测相反）', () => {
  run('★ 无主地 → **照样盖**（0x40b110 没读 +0x19）', () => {
    const { topo, node, idx, withLand } = setup();
    const s = withLand({ owner: 0, level: 0 });
    expect(canUseTool(s, topo, TOOL, node.id)).toBe(true);
    const r = use(s, topo, node.id);
    expect(r.landLevel[idx]).toBe(1);
    expect(r.landOwner[idx]).toBe(0); // ★ 地还是无主的
    expect(toolCount(r.tools, 0, TOOL)).toBe(0);
  });

  run('★ 别人的地 → **照样盖**（同上；「只挑自己的地」是 AI 判定 0x421ba6 做的事）', () => {
    const { topo, node, idx, withLand } = setup();
    const s = withLand({ owner: 2, level: 0 });
    expect(canUseTool(s, topo, TOOL, node.id)).toBe(true);
    const r = use(s, topo, node.id);
    expect(r.landLevel[idx]).toBe(1);
    expect(r.landOwner[idx]).toBe(2);
  });

  run('★ 现金为 0 → **照样盖**（这一件完全免费，path 上没有金额）', () => {
    const { topo, node, idx, withLand } = setup();
    const s = withLand({ owner: 1, level: 0 });
    const broke: GameState = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 0, moneyInBank: 0 } : p)),
    };
    expect(canUseTool(broke, topo, TOOL, node.id)).toBe(true);
    const r = use(broke, topo, node.id);
    expect(r.landLevel[idx]).toBe(1);
    expect(r.players[0]!.cash).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(0);
  });

  run('★ 連鎖店（type != 0）**只有 0 级**能盖 —— 已有房就盖不动', () => {
    const { topo, node, idx, withLand } = setup();
    const fresh = withLand({ owner: 1, level: 0, type: 1 });
    expect(use(fresh, topo, node.id).landLevel[idx]).toBe(1);
    const built = withLand({ owner: 1, level: 1, type: 1 });
    expect(canUseTool(built, topo, TOOL, node.id)).toBe(false);
    expect(use(built, topo, node.id)).toBe(built);
  });
});

describe('★ 機器工人（9）：前置与边界', () => {
  run('手里没有这一件 → 不生效', () => {
    const { topo, node, withLand } = setup();
    const s = withLand({ owner: 1, level: 0 });
    const bare: GameState = { ...s, tools: s.tools.map((n, i) => (i === TOOL ? 0 : n)) };
    expect(canUseTool(bare, topo, TOOL, node.id)).toBe(false);
    expect(use(bare, topo, node.id)).toBe(bare);
  });

  run('不是住宅/設施的格子（`nodeId` 指向别处）→ 不生效', () => {
    const { topo, node, withLand } = setup();
    const s = withLand({ owner: 1, level: 0 });
    const other = topo.nodes.find((n) => housingIndexOf(n.type) === null
      && (n.type <= 0xfa0 || n.type >= 0x1770) && n.id !== node.id);
    if (other === undefined) return;
    expect(canUseTool(s, topo, TOOL, other.id)).toBe(false);
    expect(use(s, topo, other.id)).toBe(s);
  });

  run('★ 每次只加一级（连发两次 = 两块道具各一级）', () => {
    const { topo, node, idx, withLand } = setup();
    let s = withLand({ owner: 1, level: 0 });
    s = { ...s, tools: s.tools.map((n, i) => (i === TOOL ? 2 : n)) };
    const once = use(s, topo, node.id);
    expect(once.landLevel[idx]).toBe(1);
    const twice = use(once, topo, node.id);
    expect(twice.landLevel[idx]).toBe(2);
    expect(toolCount(twice.tools, 0, TOOL)).toBe(0);
  });
});
