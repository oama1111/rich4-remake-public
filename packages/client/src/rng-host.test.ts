/*
 * 宿主侧重播种的接线测试 —— 原版三个 `srand` 时机里，宿主负责「读档后」与「每回合」
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type MapTopology } from '@rich4/core';
import { clockSeed, reduceWithHostRng, reseedAfterLoad } from './rng-host.ts';

/** 空拓扑：本测试只关心「日推进」这条路径，不碰地块/设施 */
const topo: MapTopology = { nodes: [], lands: [], facilities: [], commercials: [] };

/** 让 `endTurn` 会绕回（`next <= currentPlayer`）⇒ 触发 `advanceGameDay` */
const lastPlayerTurn = (over: Record<string, unknown> = {}) =>
  makeGameState({
    phase: 'turnEnd',
    currentPlayer: 1,
    players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
    ...over,
  });

describe('★ 宿主侧重新播种 —— 原版 `0x402FA1`（读档后）与 `0x41D06E`（每回合）', () => {
  it('读档后：单机会换成新种子（= 原版「读档重开刷结果」）', () => {
    const s = makeGameState({ rngState: 0x1111 });
    const a = reseedAfterLoad(s, topo, 0x2222);
    const b = reseedAfterLoad(s, topo, 0x3333);
    expect(a.rngState).toBe(0x2222);
    expect(b.rngState).toBe(0x3333);
    expect(a.rngState).not.toBe(s.rngState);
  });

  it('★ 联机不重播种 —— 局面由服务器定序', () => {
    const s = makeGameState({ mode: 'multiplayer', rngState: 0x1111 });
    expect(reseedAfterLoad(s, topo, 0x2222).rngState).toBe(0x1111);
  });

  it('★ 日推进那一刻换种子；同一天里的其它 action 不换', () => {
    const s = lastPlayerTurn({ rngState: 0x1111, day: 5 });
    const afterDay = reduceWithHostRng(s, { type: 'endTurn' }, topo, 0x4444);
    expect(afterDay.day).not.toBe(s.day); // 确实推了一天
    expect(afterDay.rngState).toBe(0x4444);
  });

  it('同一天内的 action（例如掷骰）不动种子', () => {
    const s = makeGameState({ phase: 'turnStart', rngState: 0x1111 });
    const after = reduceWithHostRng(s, { type: 'rollDice' }, topo, 0x4444);
    expect(after.rngState).not.toBe(0x4444);
  });

  it('★ 联机的日推进也**不**注入宿主种子', () => {
    // ⚠️ 不能断言 rngState 不变：日推进本来就**合法地**抽随机数（惡人/行情/新闻），
    //    `state.rngState` 会被那些规则推进。要验的是「没有注入 0x4444」。
    const s = lastPlayerTurn({ mode: 'multiplayer', rngState: 0x1111, day: 5 });
    const after = reduceWithHostRng(s, { type: 'endTurn' }, topo, 0x4444);
    expect(after.rngState).not.toBe(0x4444);
  });

  it('时钟种子取正 31 位（对应原版 `GetTickCount()` 的用法）', () => {
    expect(clockSeed(0xffffffff)).toBe(0x7fffffff);
    expect(clockSeed(1234)).toBe(1234);
  });
});
