/*
 * 落在地産格上收尾之后停 8 tick 才换人（`landing-pause.ts`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology } from '@rich4/core';
import { LANDING_TAIL_TICKS, landingPauseRemaining, landingPauseTicks } from './landing-pause.ts';

const topo = {
  nodes: [
    { id: 1, specialKind: 0, ref: { kind: 'land', index: 0 } },
    { id: 2, specialKind: 0, ref: { kind: 'facility', index: 0 } },
    { id: 3, specialKind: 5, ref: { kind: 'special' } },
    { id: 4, specialKind: 0, ref: { kind: 'unknown', raw: 0 } },
    { id: 5, specialKind: 0, ref: { kind: 'commercial', index: 0 } },
  ],
} as unknown as Pick<MapTopology, 'nodes'>;

function st(phase: string, nodeId: number, currentPlayer = 0): GameState {
  return { phase, currentPlayer, players: [{ nodeId }, { nodeId }] } as unknown as GameState;
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
