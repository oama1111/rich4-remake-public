/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 四大惡人每輪走一趟 @source 0x00418f93（下一名行动者依次轮到棋盘上的 4..7）+ 0x0040dd1f（步数）
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { pickNextNode, reduce, type MapTopology } from './reduce.ts';
import {
  ACTOR_PLACE,
  DOLL_STEPS,
  NPC_ACTORS,
  SPECIAL_ACTOR_BASE,
  initialConfinement,
  npcTurnSteps,
  releaseNpc,
  tickNpcCounters,
} from '../rules/special-actors.ts';
import { runNpc } from '../rules/npc-walk.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { WatcomRng } from '../rng/watcom.ts';
import type { GameState } from './types.ts';

/** 一条 30 格的环 */
const ring: MapTopology = {
  nodes: Array.from({ length: 30 }, (_, i) => makeNode({ id: i + 1, adjacent: [((i + 1) % 30) + 1] })),
  lands: [],
};

function withThief(over: Partial<GameState> = {}, actor: Partial<ReturnType<typeof releaseNpc>> = {}): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 20 })),
    phase: 'turnEnd',
    currentPlayer: 1,
    ...over,
  });
  const specialActors = [...s.specialActors];
  specialActors[0] = { ...releaseNpc(1, 0, 0), ...actor }; // 小偷（actor 4）站在 1 号格
  return { ...s, specialActors };
}

describe('★ 步数 @source 0x0040de09', () => {
  it('停留 → 0；龜行 → 1；否则 rand()%9+2', () => {
    const rng = new WatcomRng();
    rng.setState(1);
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), halted: 2 }, rng)).toBe(0);
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), singleStep: 1 }, rng)).toBe(1);
    const n = npcTurnSteps(releaseNpc(1, 0, 0), rng);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('计数与玩家同一套：递减、到 0 挂 0x80、再来一天清零', () => {
    const a = tickNpcCounters({ ...releaseNpc(1, 0, 0), halted: 1, singleStep: 2 });
    expect(a.halted).toBe(RELEASE_PENDING);
    expect(a.singleStep).toBe(1);
    const b = tickNpcCounters(a);
    expect(b.halted).toBe(0);
    expect(b.singleStep).toBe(RELEASE_PENDING);
  });
});

describe('★ 一輪结束时惡人走一趟', () => {
  it('最后一名玩家收回合 → 棋盘上的惡人动了；不是最后一名 → 不动', () => {
    const s = withThief();
    const after = reduce(s, { type: 'endTurn' }, ring);
    const thief = after.specialActors[0]!;
    expect(thief.place).toBe(ACTOR_PLACE.board);
    expect(thief.nodeId).toBeGreaterThanOrEqual(3);
    expect(thief.nodeId).toBeLessThanOrEqual(11);
    expect(thief.stepsRemaining).toBe(0);
    const mid = reduce({ ...s, currentPlayer: 0 }, { type: 'endTurn' }, ring);
    expect(mid.specialActors[0]!.nodeId).toBe(1);
  });

  it('★ 停留中的惡人这一輪不走，计数走一天', () => {
    const s = withThief({}, { halted: 2 });
    const after = reduce(s, { type: 'endTurn' }, ring);
    expect(after.specialActors[0]).toMatchObject({ nodeId: 1, halted: 1 });
  });

  it('★ 龜行中的惡人只走一步', () => {
    const s = withThief({}, { singleStep: 3 });
    const after = reduce(s, { type: 'endTurn' }, ring);
    expect(after.specialActors[0]).toMatchObject({ nodeId: 2, singleStep: 2 });
  });

  it('不在棋盘上的（蹲監獄/未出场）不轮到', () => {
    const s = withThief({}, { place: ACTOR_PLACE.prison });
    const after = reduce(s, { type: 'endTurn' }, ring);
    expect(after.specialActors[0]!.nodeId).toBe(1);
    expect(NPC_ACTORS).toEqual([4, 5, 6, 7]);
  });

  it('★ 走到有玩家的格子照样结算（小偷偷點券）', () => {
    // 玩家 1 站在 5 号格，小偷从 1 号出发走 4 步会经过它；用固定种子找一个恰好踩上的
    for (let seed = 1; seed < 200; seed++) {
      const s = withThief({ rngState: seed, players: [0, 1].map((i) => makePlayer({ index: i, nodeId: i === 1 ? 5 : 20, points: 100 })) });
      const after = reduce(s, { type: 'endTurn' }, ring);
      if (after.players[1]!.points !== 100) {
        expect(after.players[1]!.points).toBe(50);
        expect(after.players[0]!.points).toBe(150);
        return;
      }
    }
    throw new Error('200 个种子都没踩到 5 号格？');
  });

  it('同一种子重放一致', () => {
    const a = reduce(withThief({ rngState: 77 }), { type: 'endTurn' }, ring);
    const b = reduce(withThief({ rngState: 77 }), { type: 'endTurn' }, ring);
    expect(a.specialActors).toEqual(b.specialActors);
    expect(a.rngState).toBe(b.rngState);
  });
});

describe('★ 總月數 @source [0x499084]', () => {
  it('跨月 +1，不跨月不动', () => {
    const jan31 = makeGameState({ year: 1998, month: 1, day: 31, phase: 'turnEnd', currentPlayer: 3 });
    const feb1 = reduce(jan31, { type: 'endTurn' }, ring);
    expect(feb1.totalMonths).toBe(1);
    expect(feb1.totalDays).toBe(1);
    const feb2 = reduce({ ...feb1, phase: 'turnEnd', currentPlayer: 3 }, { type: 'endTurn' }, ring);
    expect(feb2.totalMonths).toBe(1);
    expect(feb2.totalDays).toBe(2);
  });
});

describe('★ 涨价/查封状态每日递减（T-084）@source 0x0041d0ff 起', () => {
  // currentPlayer 3（最后一名）endTurn → 跨轮 → advanceGameDay
  const day = (s: GameState): GameState =>
    reduce({ ...s, phase: 'turnEnd', currentPlayer: 3 }, { type: 'endTurn' }, ring);

  it('landPriceStatus / facilityPriceStatus 每天 −0x10', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      landPriceStatus: [0, 0x50, 0x51, 0],
      facilityPriceStatus: [0, 0x51, 0x20],
    });
    const after = day(s);
    expect(after.landPriceStatus).toEqual([0, 0x40, 0x41, 0]);
    expect(after.facilityPriceStatus).toEqual([0, 0x41, 0x10]);
  });

  it('★ 查封 5 天后整字节解封（查封位不残存）', () => {
    let s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      landPriceStatus: [0, 0x51],
    });
    for (let i = 0; i < 4; i++) {
      s = day(s);
      expect(s.landPriceStatus[1]).not.toBe(0); // 前 4 天仍封着
    }
    s = day(s);
    expect(s.landPriceStatus[1]).toBe(0); // 第 5 天解封
  });

  it('★ 漲價 5 天后回落', () => {
    let s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      facilityPriceStatus: [0, 0x50],
    });
    for (let i = 0; i < 5; i++) s = day(s);
    expect(s.facilityPriceStatus[1]).toBe(0);
  });

  it('高 nibble 为 0 的状态不被误伤', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      landPriceStatus: [0, 0, 1],
    });
    expect(day(s).landPriceStatus).toEqual([0, 0, 1]);
  });
});

// ============================================================
//  lastNpcWalks —— 交给表现层的整趟路径（T-047）
// ============================================================

/** 監獄格在**路头**的直路：出獄之后每一步只有一个候选，整趟是确定的 */
const away: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.PRISON }),
    ...Array.from({ length: 19 }, (_, i) =>
      makeNode({ id: i + 2, adjacent: i === 18 ? [i + 1] : [i + 1, i + 3] }),
    ),
  ],
};

describe('★ lastNpcWalks：整趟路径交给表现层（T-047）', () => {
  it('一輪之后：与 runNpc 实走的格一致，含起点', () => {
    // 多个种子都复算一遍 —— 只对一个种子成立说明不了「路径确实是那一趟」
    for (const seed of [42, 7, 123, 999]) {
      const s = withThief({ rngState: seed });
      const after = reduce(s, { type: 'endTurn' }, ring);

      const hint = after.lastNpcWalks;
      expect(hint).toHaveLength(1); // 只有小偷在盘上
      expect(hint[0]!.slot).toBe(0); // actor 4 → slot 0
      const path = hint[0]!.path;

      // ① 独立复算同一趟 —— 同序消耗同一个 PRNG，路径必须逐格相同
      //   （⚠️ 不能顺手比 `after.rngState`：那是**走完之后** advanceGameDay
      //     又抽过签的状态，比它只会证明两件事无关。）
      const rng = new WatcomRng();
      rng.setState(s.rngState);
      const ticked = tickNpcCounters(s.specialActors[0]!);
      const steps = npcTurnSteps(ticked, rng);
      const walk = runNpc(
        SPECIAL_ACTOR_BASE,
        { ...ticked, stepsRemaining: steps },
        s,
        ring,
        (from, prev) => pickNextNode(ring, from, prev, rng) ?? 0,
        rng,
      );
      expect(path).toEqual(walk.path);

      // ② 再从拓扑独立验一遍（这条环线每一步只有一个候选，路径是被逼出来的）：
      //    起点 = 出发格、末格 = state 里的落点、逐格相邻、步数 2..10
      expect(path[0]).toBe(1);
      expect(path[path.length - 1]).toBe(after.specialActors[0]!.nodeId);
      expect(path.length).toBe(steps + 1);
      expect(steps).toBeGreaterThanOrEqual(2);
      expect(steps).toBeLessThanOrEqual(10);
      for (let i = 0; i + 1 < path.length; i++) {
        expect(ring.nodes[path[i]! - 1]!.adjacent).toContain(path[i + 1]);
      }
    }
  });

  it('这一輪没人走 → 空数组（覆写掉上一轮的，不累积）', () => {
    const first = reduce(withThief({ rngState: 42 }), { type: 'endTurn' }, ring);
    expect(first.lastNpcWalks.length).toBeGreaterThan(0);
    // 让小偷「停留」：这一趟不走，提示必须被覆写成空
    const halted = withThief({ rngState: first.rngState }, { halted: 2 });
    const after = reduce(halted, { type: 'endTurn' }, ring);
    expect(after.lastNpcWalks).toEqual([]);
  });

  it('★ 保釋上路那一趟也记下来：起点是監獄格', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1, points: 900 })),
      prisonOccupancy: initialConfinement('prison', 8),
      phase: 'turnEnd',
      pending: {
        kind: 'bail',
        place: 'prison',
        candidates: [{ slot: 4, player: -1, name: '', cost: 300, affordable: true }],
        points: 900,
      },
    });
    const after = reduce(s, { type: 'bail', slot: 4 }, away);
    const hint = after.lastNpcWalks;
    expect(hint).toHaveLength(1);
    expect(hint[0]!.slot).toBe(0);
    const path = hint[0]!.path;
    expect(path[0]).toBe(1); // 監獄格
    expect(path.length).toBeGreaterThanOrEqual(2);
    // 这条直路一路向前，末格就是 state 里的落点
    expect(path[path.length - 1]).toBe(after.specialActors[0]!.nodeId);
    expect(path).toEqual(Array.from({ length: path.length }, (_, i) => i + 1));
    for (let i = 0; i + 1 < path.length; i++) {
      expect(away.nodes[path[i]! - 1]!.adjacent).toContain(path[i + 1]);
    }
  });

  it('★ 機器娃娃那九格也记下来（runDoll 的 path 原先同样被丢掉）', () => {
    // 一条 12 格的直路：每一步只有一个候选，九步走出的路径是确定的
    const line: MapTopology = {
      nodes: Array.from({ length: 12 }, (_, i) =>
        makeNode({ id: i + 1, adjacent: i === 0 ? [2] : i === 11 ? [11] : [i, i + 2] }),
      ),
    };
    const tools = new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);
    tools[1] = 1; // 道具 1 = 機器娃娃
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1, lastNodeId: 0 })),
      tools,
    });
    const after = reduce(s, { type: 'useTool', toolId: 1 }, line);
    const hint = after.lastNpcWalks;
    expect(hint).toHaveLength(1);
    expect(hint[0]!.slot).toBe(4); // actor 8 → slot 4
    expect(hint[0]!.path).toEqual(Array.from({ length: DOLL_STEPS + 1 }, (_, i) => i + 1));
  });

  it('★ C-DET：它不进 stateFingerprint（改它不影响校验和）', () => {
    const after = reduce(withThief({ rngState: 42 }), { type: 'endTurn' }, ring);
    expect(after.lastNpcWalks.length).toBeGreaterThan(0);
    const base = stateFingerprint(after);
    // ⚠️ 得过一次变量：`stateFingerprint` 的形参是一张**显式字段表**，
    //   对象字面量直接多写一个字段会被 TS 的 excess property check 挡下 ——
    //   这本身就是「它不参与指纹」最硬的证据。
    const blanked = { ...after, lastNpcWalks: [] };
    const other = { ...after, lastNpcWalks: [{ slot: 3, path: [9, 8, 7] }] };
    expect(stateFingerprint(blanked)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });
});
