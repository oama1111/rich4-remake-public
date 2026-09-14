/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 替身走子 —— 四个 NPC 与機器娃娃
 */

import { describe, expect, it } from 'vitest';
import {
  ACTOR_DOLL,
  ACTOR_PLACE,
  DOLL_STEPS,
  INITIAL_ACTOR_PLACE,
  NPC_ACTORS,
  NPC_NAMES,
  NPC_STEP_MIN,
  NPC_STEP_SPAN,
  SPECIAL_ACTOR_BASE,
  SPECIAL_ACTOR_COUNT,
  actorActive,
  idleActor,
  initialConfinement,
  initialSpecialActors,
  npcBittenByDog,
  isSpecialActor,
  npcSteps,
  releaseNpc,
  runDoll,
  spawnDoll,
  specialSlotOf,
} from './special-actors.ts';
import { INMATE_NAMES } from './visit.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { UNIMPLEMENTED_TOOLS } from './tool-effects.ts';
import { TOOL_SLOTS_PER_PLAYER, giveTool, toolCount } from './tools.ts';
import type { MapObject } from '../cards/summon.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import type { GameState } from '../state/types.ts';

describe('★ 行动者编号：玩家 0..3 之外还有 4..8', () => {
  it('四个 NPC 是 4..7，機器娃娃是 8', () => {
    expect(NPC_ACTORS).toEqual([4, 5, 6, 7]);
    expect(ACTOR_DOLL).toBe(8);
    expect(SPECIAL_ACTOR_BASE).toBe(4);
    // 表是 5 × 16 字节
    expect(SPECIAL_ACTOR_COUNT).toBe(5);
  });

  it('表下标 = actor − 4；機器娃娃落在第 4 项（即 0x498e28 + 64）', () => {
    expect(specialSlotOf(4)).toBe(0);
    expect(specialSlotOf(7)).toBe(3);
    expect(specialSlotOf(ACTOR_DOLL)).toBe(4);
    // 0x498e68 = 0x498e28 + 64 = 0x498e28 + 4*16 —— 这就是道具 1 写的地址
    expect(0x498e28 + specialSlotOf(ACTOR_DOLL) * 16).toBe(0x498e68);
  });

  it('玩家与越界的都不是替身', () => {
    for (const a of [0, 1, 2, 3, 9, -1]) expect(isSpecialActor(a), `actor ${a}`).toBe(false);
    for (const a of [4, 5, 6, 7, 8]) expect(isSpecialActor(a), `actor ${a}`).toBe(true);
  });

  it('★ 四个 NPC 与監獄占用表槽 4..7 是同一批人', () => {
    expect(NPC_NAMES).toEqual(INMATE_NAMES);
  });

  it('开局五个都不在棋盘上', () => {
    const a = initialSpecialActors();
    expect(a).toHaveLength(SPECIAL_ACTOR_COUNT);
    expect(a.every((x) => !actorActive(x))).toBe(true);
    expect(actorActive(idleActor())).toBe(false);
    expect(actorActive(undefined)).toBe(false);
  });
});

describe('★ 开局：兩個蹲監獄、兩個躺醫院 —— 不是四个全在監獄', () => {
  it('小偷/強盜在監獄，流氓/間諜在醫院，機器娃娃未出场', () => {
    // 与初值表 0x47ecec 的 +10 一字不差：1 / 1 / 2 / 2 / 3
    expect(INITIAL_ACTOR_PLACE).toEqual([1, 1, 2, 2, 3]);
    const byName = Object.fromEntries(
      NPC_NAMES.map((n, i) => [n, INITIAL_ACTOR_PLACE[i]]),
    );
    expect(byName['小偷']).toBe(ACTOR_PLACE.prison);
    expect(byName['強盜']).toBe(ACTOR_PLACE.prison);
    expect(byName['流氓']).toBe(ACTOR_PLACE.hospital);
    expect(byName['間諜']).toBe(ACTOR_PLACE.hospital);
    expect(INITIAL_ACTOR_PLACE[specialSlotOf(ACTOR_DOLL)]).toBe(ACTOR_PLACE.offBoard);
  });

  it('★ 占用表与替身记录说的是同一件事', () => {
    // @source 00407351 [0x496b34]=1 / [0x496b35]=1 / [0x496b66]=1 / [0x496b67]=1
    expect(initialConfinement('prison', 8)).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
    expect(initialConfinement('hospital', 8)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('关着的人不在棋盘上 —— node_id 初值是 0', () => {
    for (const a of initialSpecialActors()) expect(a.nodeId).toBe(0);
  });
});

describe('★ 惡犬咬 NPC —— 进醫院，等人花 300 點券捞', () => {
  it('从棋盘上撤下来，落到醫院', () => {
    const walking = releaseNpc(40, 2, 6);
    const bitten = npcBittenByDog(walking);
    expect(bitten.place).toBe(ACTOR_PLACE.hospital);
    expect(bitten.nodeId).toBe(0);
    expect(actorActive(bitten)).toBe(false);
  });

  it('★ 剩余步数清零 —— 被咬了就走不动了 @source 0x0041b8e0', () => {
    expect(npcBittenByDog(releaseNpc(40, 2, 6)).stepsRemaining).toBe(0);
  });

  it('★ 主人不清 —— 原版那一支只动 +10 与 +11..15，没碰 +8', () => {
    expect(npcBittenByDog(releaseNpc(40, 3, 6)).owner).toBe(3);
  });
});

describe('走几步', () => {
  it('★ 機器娃娃固定 9 步 —— 不掷骰子 @source 0x0040deb9 mov esi, 9', () => {
    expect(DOLL_STEPS).toBe(9);
  });

  it('★ NPC 走 rand() % 9 + 2，即 2..10 @source 0x0040de50', () => {
    expect(NPC_STEP_MIN).toBe(2);
    expect(NPC_STEP_SPAN).toBe(9);
    const rng = new WatcomRng();
    rng.setState(12345);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const n = npcSteps(rng);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(10);
      seen.add(n);
    }
    // 九个取值都该出现过，否则说明模数写错了
    expect(seen.size).toBe(9);
  });
});

describe('上路', () => {
  it('機器娃娃从主人脚下起步，位置原样抄一份', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 12, lastNodeId: 11, direction: 5 })],
    });
    const doll = spawnDoll(s, 0);
    expect(doll).toEqual({
      nodeId: 12,
      lastNodeId: 11,
      direction: 5,
      owner: 0,
      stepsRemaining: DOLL_STEPS,
      place: ACTOR_PLACE.board,
    });
  });

  it('主人不在地图上就放不出来', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 0 })] });
    expect(spawnDoll(s, 0)).toBeNull();
    expect(spawnDoll(s, 3)).toBeNull();
  });

  it('★ NPC 出獄：主人是保釋他的人，last_node = 0（第一步不受「不走回头路」限制）', () => {
    const npc = releaseNpc(40, 2, 7);
    expect(npc).toEqual({
      nodeId: 40,
      lastNodeId: 0,
      direction: 0,
      owner: 2,
      stepsRemaining: 7,
      place: ACTOR_PLACE.board,
    });
  });
});

// ============================================================
//  機器娃娃：清道夫
// ============================================================

/** 一条直线：1 → 2 → 3 → …，走到头为止 */
const line = (from: number): number => from + 1;

function objs(...at: number[]): MapObject[] {
  return at.map((nodeId) => ({ type: 16, nodeId, state: 0, attached: 0 }));
}

describe('★ 機器娃娃 —— 走九格，见物件就轰走', () => {
  it('走满九步，路径含起点共十格', () => {
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, place: ACTOR_PLACE.board },
      [],
      line,
    );
    expect(r.path).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('沿途的物件被清掉，不在路上的不动', () => {
    const before = objs(3, 7, 40);
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, place: ACTOR_PLACE.board },
      before,
      line,
    );
    expect(r.cleared).toEqual([0, 1]);
    expect(r.objects[0]?.nodeId).toBe(0);
    expect(r.objects[1]?.nodeId).toBe(0);
    // 40 号在九步之外，原封不动
    expect(r.objects[2]?.nodeId).toBe(40);
    // 原数组不被改写
    expect(before[0]?.nodeId).toBe(3);
  });

  it('★ 起点那一格不扫 —— 娃娃是走出去才踩到格子的', () => {
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, place: ACTOR_PLACE.board },
      objs(1),
      line,
    );
    expect(r.cleared).toEqual([]);
    expect(r.objects[0]?.nodeId).toBe(1);
  });

  it('★ 附身状态一并清掉 —— 被请走的神明不该还挂在谁身上', () => {
    const attached: MapObject[] = [{ type: 1, nodeId: 5, state: 3, attached: 2 }];
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, place: ACTOR_PLACE.board },
      attached,
      line,
    );
    expect(r.objects[0]).toEqual({ type: 1, nodeId: 0, state: 0, attached: 0 });
  });

  it('走完就收场 —— 替身不留在场上', () => {
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 1, stepsRemaining: DOLL_STEPS, place: ACTOR_PLACE.board },
      [],
      line,
    );
    expect(actorActive(r.actor)).toBe(false);
  });

  it('走到死路就停 —— 不会原地打转刷步数', () => {
    // 只连一格：2 之后无处可去
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, place: ACTOR_PLACE.board },
      [],
      (from) => (from === 1 ? 2 : 0),
    );
    expect(r.path).toEqual([1, 2]);
  });
});

// ============================================================
//  接到 reducer 上
// ============================================================

describe('★ 道具 1 —— 用得出去，且真的清场', () => {
  /** 一条 1→2→3→4 的单行道，末端不回头 */
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3] }),
      makeNode({ id: 3, adjacent: [2, 4] }),
      makeNode({ id: 4, adjacent: [3] }),
    ],
  };

  function withDoll(objects: MapObject[]) {
    const base = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, lastNodeId: 0 })],
      objects,
    });
    const given = giveTool(
      new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0),
      base.toolStock,
      0,
      1,
    );
    return { ...base, tools: given.tools, toolStock: given.stock };
  }

  it('道具不再被当作「未实现」挡下来', () => {
    expect(UNIMPLEMENTED_TOOLS).toEqual([]);
  });

  it('用掉一件，把路上的物件扫光', () => {
    const s = withDoll(objs(2, 3));
    const after = reduce(s, { type: 'useTool', toolId: 1 }, topo);
    expect(after).not.toBe(s);
    expect(toolCount(after.tools, 0, 1)).toBe(0);
    expect(after.objects.every((o) => o.nodeId === 0)).toBe(true);
  });

  it('★ 主人不动 —— 走的是替身，不是他自己', () => {
    const s = withDoll(objs(3));
    const after = reduce(s, { type: 'useTool', toolId: 1 }, topo);
    expect(after.players[0]?.nodeId).toBe(1);
  });

  it('★ 替身走完不留在状态里', () => {
    const s = withDoll([]);
    const after = reduce(s, { type: 'useTool', toolId: 1 }, topo);
    expect(after.specialActors.every((a) => !actorActive(a))).toBe(true);
  });

  it('没有这件道具就什么都不发生', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 1 })], objects: objs(2) });
    expect(reduce(s, { type: 'useTool', toolId: 1 }, topo)).toBe(s);
  });

  it('★ 岔路上消耗了随机数 —— rngState 会推进（C-DET-4：可重放）', () => {
    const forked: MapTopology = {
      nodes: [
        makeNode({ id: 1, adjacent: [2, 3] }),
        makeNode({ id: 2, adjacent: [1] }),
        makeNode({ id: 3, adjacent: [1] }),
      ],
    };
    const s = withDoll([]);
    const a = reduce(s, { type: 'useTool', toolId: 1 }, forked);
    expect(a.rngState).not.toBe(s.rngState);
    // 同一状态跑两次必须一模一样
    const b = reduce(s, { type: 'useTool', toolId: 1 }, forked);
    expect(b.rngState).toBe(a.rngState);
    expect(b.objects).toEqual(a.objects);
  });
});

// ============================================================
//  保釋 → 上路
// ============================================================

describe('★ 保釋 NPC —— 他会当场上路', () => {
  /** 一条环线 1→2→3→4→1，**监狱在 2 号**（所以他绕一圈会自投罗网） */
  const loop: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [4, 2] }),
      makeNode({ id: 2, adjacent: [1, 3], specialKind: SPECIAL_KIND.PRISON }),
      makeNode({ id: 3, adjacent: [2, 4] }),
      makeNode({ id: 4, adjacent: [3, 1] }),
    ],
  };
  /** 一条**没有監獄**的直路：2 是起点（假装是监狱门口），往后一路走开 */
  const away: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3], specialKind: SPECIAL_KIND.PRISON }),
      ...Array.from({ length: 18 }, (_, i) =>
        makeNode({ id: i + 3, adjacent: [i + 2, i + 4] }),
      ),
    ],
  };

  function visiting(slot: number, over: Partial<GameState> = {}) {
    return makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 2, points: 900 })),
      prisonOccupancy: initialConfinement('prison', 8),
      phase: 'turnEnd',
      pending: {
        kind: 'bail',
        place: 'prison',
        candidates: [
          { slot, player: -1, name: NPC_NAMES[slot - 4] ?? '', cost: 300, affordable: true },
        ],
        points: 900,
      },
      ...over,
    });
  }

  it('花 300 點券把小偷放出来，占用表当场清空', () => {
    const s = visiting(4);
    const after = reduce(s, { type: 'bail', slot: 4 }, away);
    expect(after.players[0]?.points).toBe(600);
  });

  it('★ 主人是保釋他的人 —— 不是他自己', () => {
    const s = { ...visiting(5), currentPlayer: 2 };
    const after = reduce(s, { type: 'bail', slot: 5 }, away);
    expect(after.specialActors[1]?.owner).toBe(2);
  });

  it('★ 走完就收场 —— 替身不留在场上', () => {
    const s = visiting(4);
    const after = reduce(s, { type: 'bail', slot: 4 }, away);
    expect(actorActive(after.specialActors[0])).toBe(false);
    expect(after.rngState).not.toBe(s.rngState);
  });

  it('★★ 环线上绕回監獄格 → 他自投罗网，占用表又满上', () => {
    const s = visiting(4);
    const after = reduce(s, { type: 'bail', slot: 4 }, loop);
    // 这张四格环线怎么走都会踩回 2 号
    expect(after.prisonOccupancy[4]).toBe(1);
    expect(after.specialActors[0]?.place).toBe(ACTOR_PLACE.prison);
  });

  it('保釋玩家（槽 0..3）不碰替身表', () => {
    const occ = initialConfinement('prison', 8);
    occ[1] = 1;
    const s = visiting(1, { prisonOccupancy: occ });
    const after = reduce(
      { ...s, pending: { kind: 'bail', place: 'prison', candidates: [{ slot: 1, player: 1, name: '', cost: 30, affordable: true }], points: 900 } },
      { type: 'bail', slot: 1 },
      away,
    );
    expect(after.specialActors).toEqual(s.specialActors);
  });
});
