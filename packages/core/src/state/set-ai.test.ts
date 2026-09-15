/*
 * `setAi` —— 託管设置（工具列「託管AI」屏 / 服务器掉线代打）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版这一屏编辑的是玩家结构的五个旋钮（+0x15..+0x1a），按「確定」才拷回
 * （VA 0x0041e577 起，见 docs/original-screens.md 的 S3）。所以：
 *   · 五个字段都可选，给哪个改哪个；
 *   · **任一字段越界即整条拒绝**，不做「部分生效」。
 */
import { describe, expect, it } from 'vitest';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState, Player } from './types.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, WHO_PLAYS_AUTOPILOT } from './types.ts';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import { traitsOf } from '../ai/personality.ts';
import { CHARACTERS } from '@rich4/data';

/** 最小拓扑：setAi 不看地图，给个空表即可 */
const topo: MapTopology = { nodes: [], lands: [] };

function stateWith(over: Partial<Player> = {}): GameState {
  return makeGameState({
    players: [
      makePlayer({ index: 0, whoPlays: WHO_PLAYS_HUMAN, ...over }),
      makePlayer({ index: 1, character: 1, whoPlays: WHO_PLAYS_COMPUTER }),
      makePlayer({ index: 2, character: 2 }),
      makePlayer({ index: 3, character: 3 }),
    ],
  });
}

const me = (s: GameState): Player => s.players[0]!;

// ============================================================
//  两种调用方
// ============================================================

describe('服务器掉线代打：只发 whoPlays', () => {
  it('託管：1 → 5，其余旋钮一个都不动', () => {
    const s = stateWith({ aiFlags: 3, personality: 1, cashRatio: 70, stockRatio: 45 });
    const next = reduce(s, { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }, topo);

    expect(me(next).whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect({
      aiFlags: me(next).aiFlags,
      personality: me(next).personality,
      cashRatio: me(next).cashRatio,
      stockRatio: me(next).stockRatio,
    }).toEqual({ aiFlags: 3, personality: 1, cashRatio: 70, stockRatio: 45 });
  });

  it('重连归还：5 → 1', () => {
    const s = stateWith({ whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
    const next = reduce(s, { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN }, topo);
    expect(me(next).whoPlays).toBe(WHO_PLAYS_HUMAN);
  });
});

describe('託管AI 屏：按確定一次性发全部五项', () => {
  it('五个字段一起改', () => {
    const s = stateWith({ whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 });
    const next = reduce(
      s,
      { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT, aiFlags: 0, personality: 2, cashRatio: 20, stockRatio: 100 },
      topo,
    );

    expect(me(next)).toMatchObject({
      whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT,
      aiFlags: 0, // 两个能力位都关掉
      personality: 2, // 大老奸
      cashRatio: 20,
      stockRatio: 100,
    });
  });

  it('只发其中几项也可以', () => {
    const s = stateWith({ aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 });
    const next = reduce(s, { type: 'setAi', player: 0, personality: 2, cashRatio: 20 }, topo);

    expect(me(next)).toMatchObject({ aiFlags: 3, personality: 2, cashRatio: 20, stockRatio: 30 });
  });

  it('★ 五个字段各自独立：只改 cashRatio 不会碰到 stockRatio', () => {
    const s = stateWith({ cashRatio: 50, stockRatio: 30 });
    const next = reduce(s, { type: 'setAi', player: 0, cashRatio: 80 }, topo);
    expect(me(next).cashRatio).toBe(80);
    expect(me(next).stockRatio).toBe(30);
  });
});

// ============================================================
//  越界：整条拒绝，不做部分生效
// ============================================================

describe('越界即整条拒绝', () => {
  const cases: { name: string; action: Parameters<typeof reduce>[1] }[] = [
    { name: 'whoPlays = 0（出局），这一屏不能把人设回出局', action: { type: 'setAi', player: 0, whoPlays: 0 } },
    { name: 'whoPlays = 3（不在允许集里）', action: { type: 'setAi', player: 0, whoPlays: 3 } },
    { name: 'whoPlays = 4（只有 AUTOPILOT 位、没有人類位）', action: { type: 'setAi', player: 0, whoPlays: 4 } },
    { name: 'aiFlags = 4（只有两位有效）', action: { type: 'setAi', player: 0, aiFlags: 4 } },
    { name: 'aiFlags = -1', action: { type: 'setAi', player: 0, aiFlags: -1 } },
    { name: 'personality = 3（只有三档）', action: { type: 'setAi', player: 0, personality: 3 } },
    { name: 'personality = -1', action: { type: 'setAi', player: 0, personality: -1 } },
    { name: 'cashRatio = -1', action: { type: 'setAi', player: 0, cashRatio: -1 } },
    { name: 'cashRatio = 101', action: { type: 'setAi', player: 0, cashRatio: 101 } },
    { name: 'cashRatio = 1.5（百分比是整数）', action: { type: 'setAi', player: 0, cashRatio: 1.5 } },
    { name: 'stockRatio = 101', action: { type: 'setAi', player: 0, stockRatio: 101 } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const s = stateWith({ aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 });
      expect(reduce(s, c.action, topo)).toBe(s); // === 原对象 = 拒绝
    });
  }

  it('★ 一项越界 → 同一 action 里**合法的那几项也不生效**', () => {
    const s = stateWith({ personality: 0, cashRatio: 50 });
    // personality 合法（2），cashRatio 越界（200）
    const next = reduce(s, { type: 'setAi', player: 0, personality: 2, cashRatio: 200 }, topo);
    expect(next).toBe(s);
    expect(me(s).personality).toBe(0); // 没有被改掉一半
    expect(me(s).cashRatio).toBe(50);
  });

  it('边界值本身是合法的：0 与 100', () => {
    const s = stateWith({ cashRatio: 50, stockRatio: 50 });
    const zero = reduce(s, { type: 'setAi', player: 0, cashRatio: 0, stockRatio: 0 }, topo);
    expect({ c: me(zero).cashRatio, s: me(zero).stockRatio }).toEqual({ c: 0, s: 0 });
    const full = reduce(s, { type: 'setAi', player: 0, cashRatio: 100, stockRatio: 100 }, topo);
    expect({ c: me(full).cashRatio, s: me(full).stockRatio }).toEqual({ c: 100, s: 100 });
  });
});

// ============================================================
//  拒绝的分支
// ============================================================

describe('另一种拒绝：没东西可改', () => {
  it('值全都没变 → 返回原对象（reduce 用 `===` 表示「无事发生」）', () => {
    const s = stateWith({ whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 1 });
    const next = reduce(s, { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 1 }, topo);
    expect(next).toBe(s);
  });

  it('什么都没发（只给 player）→ 原对象', () => {
    const s = stateWith({});
    expect(reduce(s, { type: 'setAi', player: 0 }, topo)).toBe(s);
  });

  it('出局者拒绝', () => {
    const s = stateWith({ whoPlays: 0 });
    expect(reduce(s, { type: 'setAi', player: 0, personality: 2 }, topo)).toBe(s);
  });

  it('玩家下标越界拒绝', () => {
    const s = stateWith({});
    expect(reduce(s, { type: 'setAi', player: 9, personality: 2 }, topo)).toBe(s);
    expect(reduce(s, { type: 'setAi', player: -1, personality: 2 }, topo)).toBe(s);
  });
});

// ============================================================
//  不该动到别人
// ============================================================

describe('只改被指定的那一名玩家', () => {
  it('改 0 号座，1/2/3 号座原样', () => {
    const s = stateWith({ personality: 0 });
    const before = s.players.slice(1).map((p) => ({ ...p }));
    const next = reduce(s, { type: 'setAi', player: 0, personality: 2 }, topo);

    expect(next.players[1]).toBe(s.players[1]); // 同一引用，确实没碰
    expect(next.players.slice(1)).toEqual(before);
  });

  it('可以改电脑座位（原版那一屏只列人類，但内核不该拦）', () => {
    const s = stateWith({});
    const next = reduce(s, { type: 'setAi', player: 1, personality: 2 }, topo);
    expect(next.players[1]!.personality).toBe(2);
  });
});

// ============================================================
//  旋钮的初值来自角色表（+0x19 = 角色表的 f25）
// ============================================================

describe('cashRatio 的初值', () => {
  it('★ 开局从角色表的 initCashRatio 拷进玩家结构（+0x19）', () => {
    for (const c of CHARACTERS.slice(0, 4)) {
      expect(traitsOf(c.id).cashRatio).toBe(c.initCashRatio);
    }
  });

  it('四个旋钮一起给，且都带得出来（+0x16/+0x17/+0x19/+0x1a）', () => {
    const t = traitsOf(0);
    expect(Object.keys(t).sort()).toEqual(['aiFlags', 'cashRatio', 'loanRatio', 'personality', 'stockRatio']);
  });

  it('角色号越界 → 全用默认值，不抛错', () => {
    const t = traitsOf(999);
    expect(t.cashRatio).toBe(0);
    expect(t.aiFlags).toBe(3);
  });
});
