/*
 * 落在地産格上收尾之后停 8 tick 才换人（`landing-pause.ts`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology } from '@rich4/core';
import {
  BLOCKED_TURN_TICKS,
  LANDING_TAIL_TICKS,
  blockedTurnPauseTicks,
  landingPauseRemaining,
  landingPauseTicks,
  turnEndPauseTicks,
} from './landing-pause.ts';

const topo = {
  nodes: [
    { id: 1, specialKind: 0, ref: { kind: 'land', index: 0 } },
    { id: 2, specialKind: 0, ref: { kind: 'facility', index: 0 } },
    { id: 3, specialKind: 5, ref: { kind: 'special' } },
    { id: 4, specialKind: 0, ref: { kind: 'unknown', raw: 0 } },
    { id: 5, specialKind: 0, ref: { kind: 'commercial', index: 0 } },
  ],
} as unknown as Pick<MapTopology, 'nodes'>;

const FREE = { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: 0 };

function st(phase: string, nodeId: number, currentPlayer = 0, whoPlays = 1, inHospital = 0): GameState {
  const blocking = { ...FREE, inHospital };
  return {
    phase,
    currentPlayer,
    players: [
      { nodeId, whoPlays, blocking },
      { nodeId, whoPlays, blocking },
    ],
  } as unknown as GameState;
}

describe('★ 落点收尾的换人停顿 @source 0x0041b111 (0x88) / 0x0040d840 / 0x0040d86f', () => {
  it('0x88 的低 7 位 = 8 tick', () => {
    expect(LANDING_TAIL_TICKS).toBe(8);
  });

  it('★ 地块 / 設施 / 企業格：落点结算或落点询问收尾进 turnEnd ⇒ 8', () => {
    expect(landingPauseTicks(st('settling', 1), st('turnEnd', 1), topo)).toBe(8);
    expect(landingPauseTicks(st('awaitingDecision', 1), st('turnEnd', 1), topo)).toBe(8);
    expect(landingPauseTicks(st('awaitingDecision', 2), st('turnEnd', 2), topo)).toBe(8);
    expect(landingPauseTicks(st('settling', 5), st('turnEnd', 5), topo)).toBe(8);
  });

  it('特殊格（返回 0x80）/ 格值 0（`0x004198c3 je 0x41b3d0`）/ 不是落点收尾 ⇒ 0', () => {
    expect(landingPauseTicks(st('settling', 3), st('turnEnd', 3), topo)).toBe(0);
    expect(landingPauseTicks(st('settling', 4), st('turnEnd', 4), topo)).toBe(0);
    expect(landingPauseTicks(st('turnStart', 1), st('turnEnd', 1), topo)).toBe(0);
    expect(landingPauseTicks(st('turnEnd', 1), st('turnEnd', 1), topo)).toBe(0);
    expect(landingPauseTicks(st('settling', 1), st('awaitingDecision', 1), topo)).toBe(0);
    expect(landingPauseTicks(st('settling', 1), st('turnEnd', 1, 1), topo)).toBe(0);
  });

  it('★ 从台上空下来那一拍起算 8 个 tick（速度 2 档 40 ms ⇒ 320 ms）', () => {
    let p = { ticks: 8, idleAt: null as number | null };
    let r = landingPauseRemaining(p, 1000, 40);
    expect(r.pause.idleAt).toBe(1000);
    expect(r.waitMs).toBe(320);
    p = r.pause;
    r = landingPauseRemaining(p, 1300, 40);
    expect(r.waitMs).toBe(20);
    r = landingPauseRemaining(p, 1320, 40);
    expect(r.waitMs).toBe(0);
  });
});

describe('★ 回合开头就被挡：框收掉后停 3 tick 才换人 @source 0x00418d70 / 0x00418d88 / 0x00418ead (0x83)', () => {
  it('0x83 的低 7 位 = 3', () => {
    expect(BLOCKED_TURN_TICKS).toBe(3);
  });

  it('★ startTurn 直接进 turnEnd（坐牢/住院/冬眠…的 skip 支）⇒ 3', () => {
    expect(blockedTurnPauseTicks(st('turnStart', 3), st('turnEnd', 3))).toBe(3);
    expect(turnEndPauseTicks(st('turnStart', 1), st('turnEnd', 1), topo)).toBe(3);
  });

  it('走回棋盘 / 被外力挪过（whoPlays & 0x30）那一支不接（控制流待核，见文件头）', () => {
    expect(blockedTurnPauseTicks(st('turnStart', 3, 0, 1 | 0x10), st('turnEnd', 3, 0, 1 | 0x10))).toBe(0);
    expect(blockedTurnPauseTicks(st('turnStart', 3, 0, 1 | 0x20), st('turnEnd', 3, 0, 1 | 0x20))).toBe(0);
  });

  it('正常开局（进 awaitingRoll）/ 换了人 ⇒ 0', () => {
    expect(blockedTurnPauseTicks(st('turnStart', 3), st('awaitingRoll', 3))).toBe(0);
    expect(blockedTurnPauseTicks(st('turnStart', 3), st('turnEnd', 3, 1))).toBe(0);
  });

  it('★ 第十六份：最后一步被送进醫院 ⇒ settle 被 `0x40c912(1)` 挡下，也是 3（不是 0x88 / 0x80）@source 0x0040d889 / 0x00418ead', () => {
    // 醫院格（特殊格）与地块格都一样：落点例程没进
    expect(turnEndPauseTicks(st('settling', 3, 0, 1, 5), st('turnEnd', 3, 0, 1, 5), topo)).toBe(3);
    expect(turnEndPauseTicks(st('settling', 1, 0, 1, 5), st('turnEnd', 1, 0, 1, 5), topo)).toBe(3);
    // 没被关：照旧（特殊格 0 / 地块 8）
    expect(blockedTurnPauseTicks(st('settling', 3), st('turnEnd', 3))).toBe(0);
  });

  it('turnEndPauseTicks：落点收尾仍是 8，特殊格落点 0（0x80 = 下一 tick）', () => {
    expect(turnEndPauseTicks(st('settling', 1), st('turnEnd', 1), topo)).toBe(8);
    expect(turnEndPauseTicks(st('settling', 3), st('turnEnd', 3), topo)).toBe(0);
  });
});
