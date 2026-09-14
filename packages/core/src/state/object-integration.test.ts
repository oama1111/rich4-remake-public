/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 物件接进引擎之后：开局在场、踩到生效、任期到点离场、破产不漏
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { applyBankruptcy, reduce, isGameOver } from './reduce.ts';
import { isAlive } from './types.ts';
import type { GameState } from './types.ts';
import { INITIAL_OBJECT_TYPES, placeObjectOfType } from '../rules/object-landing.ts';
import { OBJECT_NAMES } from '../rules/purchase.ts';
import { stateFingerprint } from '../net/protocol.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

function fresh(seed = 7): { state: GameState; topo: ReturnType<typeof topoOf> } {
  const map = loadMap();
  return {
    state: newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed,
    }),
    topo: topoOf(map),
  };
}
const topoOf = (map: ReturnType<typeof loadMap>) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
});

/** 场上（不在谁身上）的物件 */
const onMap = (s: GameState) => s.objects.filter((o) => o.nodeId !== 0 && o.attached === 0);

describe('★ 开局地图上真的有神明', () => {
  run('八个物件在场，种类正好是开局名单', () => {
    const { state } = fresh();
    const placed = onMap(state);
    expect(placed).toHaveLength(INITIAL_OBJECT_TYPES.length);
    expect(placed.map((o) => o.type).sort((a, b) => a - b)).toEqual([...INITIAL_OBJECT_TYPES]);
  });

  run('都落在可走、未禁放的格子上，且互不重叠', () => {
    const { state, topo } = fresh();
    const nodes = new Map(topo.nodes.map((n) => [n.id, n]));
    const seen = new Set<number>();
    for (const o of onMap(state)) {
      const n = nodes.get(o.nodeId);
      expect(n, `节点 ${o.nodeId} 不存在`).toBeDefined();
      expect(n!.walkable).toBe(true);
      expect(n!.noObjects).toBe(false);
      expect(seen.has(o.nodeId), `${OBJECT_NAMES[o.type]} 与别人叠在同一格`).toBe(false);
      seen.add(o.nodeId);
    }
  });

  run('换个种子，位置会不同 —— 确实是抽出来的', () => {
    const a = onMap(fresh(7).state).map((o) => o.nodeId);
    const b = onMap(fresh(99).state).map((o) => o.nodeId);
    expect(a).not.toEqual(b);
  });
});

describe('★ 踩上去：从 reduce 这一层看', () => {
  /** 把玩家 0 挪到某格、摆好物件，然后走一步过去 */
  function stepOnto(type: number, steps = 1) {
    const { state, topo } = fresh();
    // 找一段能走的路：node → 它的第一个邻居
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    // 清场，只留我们要测的那一个
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const objects = placeObjectOfType(cleared, type, to).objects;
    const start: GameState = {
      ...state,
      objects,
      phase: 'moving',
      stepsRemaining: steps,
      stepsTotal: steps,
    };
    return { before: start, after: reduce(start, { type: 'step' }, topo), topo, node: to };
  }

  run('走到小財神那格 → 附身，財運 +100', () => {
    const { after } = stepOnto(1);
    expect(after.players[0]!.godInfo).toBe(1);
    expect(after.players[0]!.fortune).toBe(100);
    expect(after.players[0]!.misfortune).toBe(-100);
    // 已附身 → 不再站在地图上
    expect(onMap(after)).toHaveLength(0);
  });

  run('★ 路障半途就把人钉住 —— 剩余步数直接归零', () => {
    const { after } = stepOnto(16, 5);
    expect(after.stepsRemaining).toBe(0);
    expect(after.phase).toBe('settling');
  });

  run('★ 神明路过不生效 —— 还有 5 步时踩上去什么也不发生', () => {
    const { after } = stepOnto(1, 5);
    expect(after.players[0]!.godInfo).toBe(0);
    expect(after.stepsRemaining).toBe(4);
  });

  run('地雷 → 住院 3 天，占用表也置位', () => {
    const { after } = stepOnto(17);
    expect(after.players[0]!.blocking.inHospital).toBe(3);
    expect(after.hospitalOccupancy[0]).toBe(1);
    expect(after.stepsRemaining).toBe(0);
  });

  run('寶箱 → 點數 +500', () => {
    const { before, after } = stepOnto(14);
    expect(after.players[0]!.points).toBe(before.players[0]!.points + 500);
  });

  run('★ 惡犬被踩掉之后，土地公会补到场上 —— 物件不会越打越少', () => {
    const { after } = stepOnto(11);
    const left = onMap(after);
    expect(left).toHaveLength(1);
    expect(left[0]!.type).toBe(12);
    expect(OBJECT_NAMES[12]).toBe('土地公');
  });
});

describe('★ 任期与破产', () => {
  run('神明 7 个回合后自己走人，搭档补位', () => {
    const { state, topo } = fresh();
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    let s: GameState = {
      ...state,
      objects: placeObjectOfType(cleared, 1, 1).objects,
    };
    // 直接附上去
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, godInfo: 1, fortune: 100 } : p)),
      objects: s.objects.map((o, i) =>
        i === 0 ? { ...o, nodeId: s.players[0]!.nodeId, state: 7, attached: 1 } : o,
      ),
      phase: 'turnEnd',
    };

    for (let day = 0; day < 7; day++) {
      s = reduce({ ...s, currentPlayer: 0, phase: 'turnEnd' }, { type: 'endTurn' }, topo);
    }
    expect(s.players[0]!.godInfo).toBe(0);
    expect(s.players[0]!.fortune).toBe(0);
    // 大財神（槽 1）补到场上
    expect(s.objects[1]!.nodeId).not.toBe(0);
  });

  run('★ 破产时身上的物件要还回去 —— 否则它永远挂在死人身上', () => {
    const { state, topo } = fresh();
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const s: GameState = {
      ...state,
      objects: cleared.map((o, i) =>
        i === 0 ? { ...o, nodeId: 5, state: 7, attached: 2 } : o,
      ),
      players: state.players.map((p, i) => (i === 1 ? { ...p, godInfo: 1, fortune: 100 } : p)),
    };
    const after = applyBankruptcy(s, 1, topo);
    expect(after.objects[0]!.attached).toBe(0);
    expect(after.objects[0]!.nodeId).toBe(0);
    // 搭档大財神补位
    expect(after.objects[1]!.nodeId).not.toBe(0);
  });
});

describe('★ 乞丐：破产者的棋子留在地图上', () => {
  /** 把玩家 1 弄成出局者，钉在玩家 0 下一步会走到的那格 */
  function setup() {
    const { state, topo } = fresh();
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const start: GameState = {
      ...state,
      objects: cleared,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, whoPlays: 0, nodeId: to } : i === 0 ? { ...p, cash: 500_000 } : p,
      ),
      phase: 'moving',
      stepsRemaining: 1,
      stepsTotal: 1,
    };
    return { start, topo, to };
  }

  run('★ 踩到乞丐 → 掏物价指数 × 1000，钱进公库', () => {
    const { start, topo } = setup();
    const after = reduce(start, { type: 'step' }, topo);
    const amount = start.priceIndex * 1000;
    expect(after.players[0]!.cash).toBe(500_000 - amount);
    expect(after.pool).toBe(start.pool + amount);
  });

  run('★ 收了钱乞丐就换个地方待着 —— 不然会被同一个人反复薅', () => {
    const { start, topo, to } = setup();
    const after = reduce(start, { type: 'step' }, topo);
    expect(after.players[1]!.nodeId).not.toBe(to);
    expect(after.players[1]!.nodeId).not.toBe(0);
  });

  run('路过不算 —— 还有步数时不施捨', () => {
    const { start, topo } = setup();
    const after = reduce({ ...start, stepsRemaining: 4, stepsTotal: 4 }, { type: 'step' }, topo);
    expect(after.players[0]!.cash).toBe(500_000);
  });

  run('同格的人还活着就不施捨', () => {
    const { start, topo } = setup();
    const living: GameState = {
      ...start,
      players: start.players.map((p, i) => (i === 1 ? { ...p, whoPlays: 2 } : p)),
    };
    expect(reduce(living, { type: 'step' }, topo).players[0]!.cash).toBe(500_000);
  });
});

describe('★ 确定性没被破坏', () => {
  run('同种子跑 3000 步，两次指纹逐步相同', () => {
    const runOnce = (): string[] => {
      const { state, topo } = fresh(2024);
      let s = state;
      const out: string[] = [];
      for (let i = 0; i < 3000 && !isGameOver(s); i++) {
        const a = decideAction({ state: s, map: loadMap() });
        if (a === null) break;
        s = reduce(s, a, topo);
        if (i % 100 === 0) out.push(stateFingerprint(s));
      }
      return out;
    };
    const a = runOnce();
    expect(a.length).toBeGreaterThan(10);
    expect(runOnce()).toEqual(a);
  });

  run('★ 物件表进了指纹 —— 神明位置不同必须校验和不同', () => {
    const { state } = fresh();
    const moved: GameState = {
      ...state,
      objects: state.objects.map((o, i) => (i === 0 ? { ...o, nodeId: o.nodeId + 1 } : o)),
    };
    expect(stateFingerprint(moved)).not.toBe(stateFingerprint(state));
  });

  run('物件全程守恒：既不凭空多出，也不凭空消失', () => {
    const map = loadMap();
    const topo = topoOf(map);
    let s = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 31337,
    });
    for (let i = 0; i < 60_000 && !isGameOver(s); i++) {
      const a = decideAction({ state: s, map });
      if (a === null) break;
      s = reduce(s, a, topo);
      // 不变量：任何 attached 非 0 的物件，都得被它的主人真正引用着
      for (let k = 0; k < s.objects.length; k++) {
        const o = s.objects[k]!;
        if (o.attached === 0) continue;
        const host = s.players[o.attached - 1]!;
        expect(
          host.godInfo === k + 1 || host.f64 === k + 1,
          `物件 ${k}（${OBJECT_NAMES[o.type]}）挂在玩家 ${o.attached - 1} 身上，但那人并不认它`,
        ).toBe(true);
        expect(isAlive(host)).toBe(true);
      }
    }
    // ★ 六对神明始终在循环；禮物与寶箱是一次性的（原版 `i < 12` 才有搭档）
    const alive = s.objects.filter((o) => o.nodeId !== 0 || o.attached !== 0);
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.length).toBeLessThanOrEqual(INITIAL_OBJECT_TYPES.length);
  }, 120_000);
});
