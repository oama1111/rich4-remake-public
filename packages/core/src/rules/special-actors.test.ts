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
  npcTurnSteps,
  tickNpcCounters,
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
import type { SpecialActor } from './special-actors.ts';
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
      halted: 0,
      singleStep: 0,
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
      halted: 0,
      singleStep: 0,
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
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
      [],
      line,
    );
    expect(r.path).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('沿途的物件被清掉，不在路上的不动', () => {
    const before = objs(3, 7, 40);
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
      before,
      line,
    );
    // ★ 试玩3 #11：`cleared` 从「下标」改成「下标 + 在哪一格被扫掉」——
    //   客户端靠 `step` 把那一件留在原地直到补间走到那一格。
    //   3 号在第 3 格（`path[2]`）、7 号在第 7 格（`path[6]`）。
    expect(r.cleared).toEqual([
      { index: 0, step: 2 },
      { index: 1, step: 6 },
    ]);
    expect(r.objects[0]?.nodeId).toBe(0);
    expect(r.objects[1]?.nodeId).toBe(0);
    // 40 号在九步之外，原封不动
    expect(r.objects[2]?.nodeId).toBe(40);
    // 原数组不被改写
    expect(before[0]?.nodeId).toBe(3);
  });

  it('★ 起点那一格不扫 —— 娃娃是走出去才踩到格子的', () => {
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
      objs(1),
      line,
    );
    expect(r.cleared).toEqual([]);
    expect(r.objects[0]?.nodeId).toBe(1);
  });

  // ★★ 2026-09-24 订正（第 24 份试玩回报 `20260924-182247766`「我身上背的窮神莫名其妙消失了」）：
  //   先前这一例断言「附身的神明也被扫掉」—— 与原版相反。娃娃找物件读的是**节点反向索引**
  //   `node+0x24` 第 3 字节（@source 0x0041b4b4 `and eax,0xff0000 / shr eax,0x10`），附身时
  //   那一字节被抹掉（`release_object` 0x40e14d 也只在 `attached == 0` 时清它）⇒ 附身的**不在路上**。
  //   本引擎的附身物件 `nodeId` 跟着主人走（`syncEscortNodes`），光比 `nodeId` 才会误扫。
  it('★★ 附身的神明**不扫** —— 它不在节点反向索引里（0x0041b4b4），主人照背着', () => {
    const attached: MapObject[] = [{ type: 5, nodeId: 5, state: 3, attached: 2 }];
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
      attached,
      line,
    );
    expect(r.objects[0]).toEqual({ type: 5, nodeId: 5, state: 3, attached: 2 });
    expect(r.cleared).toEqual([]);
  });

  it('★ 同格有附身的也有地上的：只扫地上那一件（取槽号最大者，同 `objectHandleAt`）', () => {
    const mixed: MapObject[] = [
      { type: 5, nodeId: 4, state: 3, attached: 1 },
      { type: 16, nodeId: 4, state: 0, attached: 0 },
    ];
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
      mixed,
      line,
    );
    expect(r.cleared).toEqual([{ index: 1, step: 3 }]);
    expect(r.objects[0]).toEqual(mixed[0]);
    expect(r.objects[1]!.nodeId).toBe(0);
  });

  it('走完就收场 —— 替身不留在场上', () => {
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 1, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
      [],
      line,
    );
    expect(actorActive(r.actor)).toBe(false);
  });

  it('走到死路就停 —— 不会原地打转刷步数', () => {
    // 只连一格：2 之后无处可去
    const r = runDoll(
      { nodeId: 1, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: DOLL_STEPS, halted: 0, singleStep: 0, place: ACTOR_PLACE.board },
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

  /**
   * 物件表按**槽位**分种类（`OBJECT_TYPE_TABLE`：0..11 神明、16..25 路障…）—— 路障只能在 16 号槽起。
   * ⚠️ 先前这里把路障摆在 0 / 1 号槽：扫物件改走 `release_object`（0x40e14d）之后，
   *   `i < 12` 那一支会把「搭档」重新放回棋盘（神明才有的事），那种摆法就不成立了。
   */
  function roadblocksAt(...at: number[]): MapObject[] {
    const out: MapObject[] = Array.from({ length: 16 }, (_, i) => ({ type: i + 1, nodeId: 0, state: 0, attached: 0 }));
    for (const nodeId of at) out.push({ type: 16, nodeId, state: 0, attached: 0 });
    return out;
  }

  it('用掉一件，把路上的物件扫光；路障回库存（`release_object` 0x40e14d：`inc [0x497321]`）', () => {
    const s = withDoll(roadblocksAt(2, 3));
    const after = reduce(s, { type: 'useTool', toolId: 1 }, topo);
    expect(after).not.toBe(s);
    expect(toolCount(after.tools, 0, 1)).toBe(0);
    expect(after.objects.every((o) => o.nodeId === 0)).toBe(true);
    // 路障 = 道具 2（`OBJECT_TO_TOOL`）：两件都回库存
    expect(after.toolStock[2]).toBe((s.toolStock[2] ?? 0) + 2);
  });

  it('★ 地上的神明被扫走 = `release_object`：它离场、搭档另找地方登场（`i < 12` 那一支）', () => {
    const objects = roadblocksAt();
    objects[4] = { type: 5, nodeId: 2, state: 0, attached: 0 }; // 小窮神在 2 号格地上；5 号槽（大窮神）没出场
    const s = withDoll(objects);
    const after = reduce(s, { type: 'useTool', toolId: 1 }, topo);
    // 这条 4 格小路上娃娃来回走（1→4→1→4），搭档一登场就又被踩到 —— 正是原版逐格 `0x40e14d` 的样子
    const cleared = after.lastNpcWalks[0]!.cleared!;
    expect(cleared[0]).toEqual({ index: 4, step: 1 });
    // 小窮神离场后，大窮神（5 号槽）被放上棋盘，随后在第 2 步被扫
    expect(cleared[1]).toEqual({ index: 5, step: 2 });
  });

  it('★★ 路上站着一个**背着神明**的玩家：神明不被扫、玩家照背着（第 24 份 `20260924-182247766`）', () => {
    const objects = roadblocksAt();
    objects[4] = { type: 5, nodeId: 3, state: 7, attached: 2 }; // 小窮神附在 1 号玩家身上
    const base = withDoll(objects);
    const s = {
      ...base,
      players: [base.players[0]!, makePlayer({ index: 1, nodeId: 3, lastNodeId: 2, godInfo: 5 })],
    };
    const after = reduce(s, { type: 'useTool', toolId: 1 }, topo);
    expect(toolCount(after.tools, 0, 1)).toBe(0);
    expect(after.objects[4]).toEqual({ type: 5, nodeId: 3, state: 7, attached: 2 });
    expect(after.players[1]!.godInfo).toBe(5);
    expect(after.lastNpcWalks[0]!.cleared).toEqual([]);
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

describe('★ 保釋 NPC —— 摆到门口，等行动者游标轮到他才走（0x0043d7e0 / 0x0043ee8f）', () => {
  /**
   * 一条环线 1→2→3→4→1，**监狱在 2 号**（所以他绕一圈会自投罗网）。
   *
   * ★★ 2 号同时是**两个概念**：`specialKind` 4 = 監獄**落点格**（走回来会自投罗网），
   *   `type` 0x1f42 = **关押格**（`[0x48bae0]`，出獄那一步的起点）——
   *   判据见 `rules/confinement.ts` 的 `CONFINEMENT_GATE_TYPE`。
   *   真实地图上两者常常不是同一格（0001.bin：1 vs 12），故另有专门的可证伪用例。
   */
  const loop: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [4, 2] }),
      makeNode({
        id: 2, adjacent: [1, 3],
        type: 0x1f42, ref: { kind: 'landscape', index: 2 },
        specialKind: SPECIAL_KIND.PRISON,
      }),
      makeNode({ id: 3, adjacent: [2, 4] }),
      makeNode({ id: 4, adjacent: [3, 1] }),
    ],
  };
  /** 一条**没有監獄落点格**的直路：2 是起点（= 关押格／监狱门口），往后一路走开 */
  const away: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({
        id: 2, adjacent: [1, 3],
        type: 0x1f42, ref: { kind: 'landscape', index: 2 },
        specialKind: SPECIAL_KIND.PRISON,
      }),
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

  it('★★ 只摆到门口：在盘上、站关押格、没掷步数（随机流不动）、没有走子提示、不换行动者', () => {
    const s = visiting(4);
    const after = reduce(s, { type: 'bail', slot: 4 }, away);
    expect(actorActive(after.specialActors[0])).toBe(true);
    expect(after.specialActors[0]).toMatchObject({ nodeId: 2, lastNodeId: 0, owner: 0, stepsRemaining: 0, place: ACTOR_PLACE.board });
    expect(after.rngState, '步数在他自己的回合 0x0040de50 才掷').toBe(s.rngState);
    expect(after.lastNpcWalks).toBe(s.lastNpcWalks);
    expect(after.lastNpcTurn ?? null).toBeNull();
    expect(after.prisonOccupancy[4]).toBe(0);
    expect(after.phase).toBe('turnEnd');
    expect(after.pendingNpcSlots ?? []).toEqual([]);
  });

  it('★★ 保釋者是最后一名 ⇒ 这一轮收回合时他按槽位顺序走那一趟（环线上绕回監獄格 → 自投罗网）', () => {
    const s = { ...visiting(4), currentPlayer: 3 };
    const bailed = reduce(s, { type: 'bail', slot: 4 }, loop);
    expect(bailed.prisonOccupancy[4]).toBe(0);
    const after = reduce(bailed, { type: 'endTurn' }, loop);
    expect(after.lastNpcTurn).toEqual({ actor: 4 });
    expect(after.lastNpcWalks[0]!.path[0]).toBe(2);
    // 这张四格环线怎么走都会踩回 2 号
    expect(after.prisonOccupancy[4]).toBe(1);
    expect(after.specialActors[0]?.place).toBe(ACTOR_PLACE.prison);
  });

  it('★ 保釋者不是最后一名 ⇒ 下一位玩家先走，他等游标到 4..7', () => {
    const bailed = reduce(visiting(4), { type: 'bail', slot: 4 }, away);
    const after = reduce(bailed, { type: 'endTurn' }, away);
    expect(after.currentPlayer).toBe(1);
    expect(after.specialActors[0]!.nodeId).toBe(2);
    expect(after.lastNpcTurn ?? null).toBeNull();
  });

  it('★★★ 可证伪：出獄起点是**关押格**（`type` 0x1f42），不是落点特殊格', () => {
    // 1 号 = 关押格（`type` 0x1f42 = 原版 `[0x48bae0]`）；2 号 = 監獄**落点**特殊格
    const split: MapTopology = {
      nodes: [
        makeNode({
          id: 1, adjacent: [2],
          type: 0x1f42, ref: { kind: 'landscape', index: 2 },
        }),
        makeNode({ id: 2, adjacent: [1, 3], specialKind: SPECIAL_KIND.PRISON }),
        ...Array.from({ length: 17 }, (_, i) =>
          makeNode({ id: i + 3, adjacent: [i + 2, i + 4] }),
        ),
      ],
    };
    const after = reduce(visiting(4), { type: 'bail', slot: 4 }, split);
    // ★ 旧实现（`specialKind` 判据）会摆在 2 号 ⇒ 这两条当场红
    expect(after.specialActors[0]!.nodeId).toBe(1);
    expect(after.specialActors[0]!.nodeId).not.toBe(2);
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

/**
 * ★★ 替身的**四个**计时字节都要走一天（第 43 条）。
 *
 * @source `tick_blocking` 的 actor 分支 `0x0041ce39`：依次处理 `0x498e34..0x498e37`
 *   四个字节（= 替身记录 `+12..+15` = `hibernating`/`sleepwalkDays`/`halted`/`singleStep`），
 *   每个都是「`test 0x80` → 清零；否则 `dec`，到 0 `or 0x80`」。
 *   复刻先前只走了后两个 ⇒ 冬眠卡/夢遊卡打在替身上之后，那两个计数**永不递减**
 *   （`client/render.ts` 的 `isActorAsleep` 会永远把替身画成灰的）。
 */
describe('★★ 替身四个计时字节各走一天（第 43 条）', () => {
  it('四项一起递减', () => {
    const a = {
      ...idleActor(),
      hibernating: 5,
      sleepwalkDays: 3,
      halted: 2,
      singleStep: 4,
    };
    const t1 = tickNpcCounters(a);
    expect([t1.hibernating, t1.sleepwalkDays, t1.halted, t1.singleStep]).toEqual([4, 2, 1, 3]);
  });

  it('冬眠/梦游到 0 时挂 0x80（释放待清），再走一天清零 —— 与玩家的四项同一套', () => {
    let a: SpecialActor = { ...idleActor(), hibernating: 2, sleepwalkDays: 2 };
    a = tickNpcCounters(a);
    expect([a.hibernating, a.sleepwalkDays]).toEqual([1, 1]);
    a = tickNpcCounters(a);
    expect([a.hibernating, a.sleepwalkDays]).toEqual([0x80, 0x80]); // 到 0 → |0x80
    a = tickNpcCounters(a);
    expect([a.hibernating, a.sleepwalkDays]).toEqual([0, 0]); // 0x80 → 清零
  });

  it('★ 走满 6 天后灰化状态消失（`isActorAsleep` 读的就是这两项）', () => {
    // 冬眠卡写 5（`cards/hibernate.ts` 的 HIBERNATE_DAYS）
    let a: SpecialActor = { ...idleActor(), hibernating: 5 };
    // 客户端判据：`(hibernating ?? 0) !== 0` 就是"睡着"（`client/render.ts`）
    const asleep = (x: SpecialActor): boolean => ((x.hibernating ?? 0) !== 0);
    for (let day = 0; day < 5; day++) {
      expect(asleep(a), `第 ${day} 天应仍是睡着`).toBe(true);
      a = tickNpcCounters(a);
    }
    expect(a.hibernating).toBe(0x80); // 第 5 天走完挂释放位（当天仍显示睡着）
    a = tickNpcCounters(a);
    expect(asleep(a)).toBe(false); // 第 6 天起恢复正常
  });

  it('★ 0 不会被弄成 0x80（`dec` 只在原本非 0 时走）', () => {
    const a = tickNpcCounters({ ...idleActor(), hibernating: 0, sleepwalkDays: 0 });
    expect([a.hibernating, a.sleepwalkDays]).toEqual([0, 0]);
  });
});

describe('★ 冬眠闸门在**更早**的回合开始判定里（`0x40c912`），梦游不是闸门', () => {
  it('★★ 冬眠中的替身**整回合不行动**（旧测试把错行为钉死过，2026-09-19 第 92 条订正）', () => {
    // ⚠️ 本条此前写着「冬眠中的替身照样走」——那是**只读了 `0x40dd1f` 的 actor 分支
    //   （`0x40de09` 只看 +14/+15）**得出的结论。原版在**进 `0x40dd1f` 之前**
    //   还有一道闸：回合开始判定 `0x40c912` 的 actor 分支 `0x40cbf6`：
    //   `if ([slot + 0x0c] != 0) 返回 0` ⇒ 连 `0x40dd1f` 都不进、**不掷随机数**。
    //   通道 2：`rich4-spec/tests/test_turn_start.py` §F（冬眠 ⇒ 0、夢遊 ⇒ 2）。
    const base = idleActor();
    const asleep = { ...base, hibernating: 5 };
    const sleepy = { ...base, sleepwalkDays: 5 };
    const stepsOf = (a: typeof base): number[] =>
      [1, 2, 3].map((seed) => {
        const rng = new WatcomRng();
        rng.setState(seed);
        return npcTurnSteps(tickNpcCounters(a), rng);
      });
    expect(stepsOf(asleep)).toEqual([0, 0, 0]); // 冬眠：0 步
    expect(stepsOf(sleepy)).toEqual(stepsOf(base)); // 夢遊：不拦（只有走姿图不同）
  });
});
