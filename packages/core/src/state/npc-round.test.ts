/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 四大惡人每輪走一趟 @source 0x00418f93（下一名行动者依次轮到棋盘上的 4..7）+ 0x0040dd1f（步数）
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from './reduce.ts';
import { ACTOR_PLACE, NPC_ACTORS, npcTurnSteps, releaseNpc, tickNpcCounters } from '../rules/special-actors.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
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
