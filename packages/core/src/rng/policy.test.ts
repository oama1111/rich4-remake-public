/*
 * 播种策略测试 —— 证明「单机可读档重开、联机不可」确实成立
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { WatcomRng, rollDice } from './watcom.ts';
import {
  SINGLE_PLAYER_POLICY,
  MULTIPLAYER_POLICY,
  policyFor,
  needsReseed,
  serializeRng,
  deserializeRng,
} from './policy.ts';

/** 模拟：存档 → 读档 → 掷 5 次骰，返回点数序列 */
function loadAndRoll(
  saved: { rngState: number | null },
  freshSeed: number,
): { reseeded: boolean; rolls: number[] } {
  const rng = new WatcomRng();
  const reseeded = deserializeRng(rng, saved, freshSeed);
  const rolls = Array.from({ length: 5 }, () => rollDice(rng, 1).sum);
  return { reseeded, rolls };
}

describe('单机模式 —— 完整保留原版行为', () => {
  it('存档不写入 PRNG 状态', () => {
    const rng = new WatcomRng(1);
    for (let i = 0; i < 10; i++) rng.next();
    expect(serializeRng(rng, SINGLE_PLAYER_POLICY).rngState).toBeNull();
  });

  it('★ 读档重开能刷出不同结果（原版行为）', () => {
    const rng = new WatcomRng(1);
    for (let i = 0; i < 10; i++) rng.next();
    const save = serializeRng(rng, SINGLE_PLAYER_POLICY);

    // 玩家读档三次，每次宿主注入不同的挂钟种子
    const a = loadAndRoll(save, 111111);
    const b = loadAndRoll(save, 222222);
    const c = loadAndRoll(save, 333333);

    expect(a.reseeded).toBe(true);
    expect(a.rolls).not.toEqual(b.rolls);
    expect(b.rolls).not.toEqual(c.rolls);
  });

  it('播种时机与原版三处 srand 一致', () => {
    for (const occasion of ['gameStart', 'afterLoad', 'turnAdvance'] as const) {
      expect(needsReseed(SINGLE_PLAYER_POLICY, occasion)).toBe(true);
    }
  });
});

describe('联机模式 —— 严格确定性', () => {
  it('快照写入 PRNG 状态', () => {
    const rng = new WatcomRng(1);
    for (let i = 0; i < 10; i++) rng.next();
    const snap = serializeRng(rng, MULTIPLAYER_POLICY);
    expect(snap.rngState).toBe(rng.getState());
  });

  it('★ 重连恢复后结果完全一致 —— 不存在刷结果的可能', () => {
    const rng = new WatcomRng(9999);
    for (let i = 0; i < 10; i++) rng.next();
    const snap = serializeRng(rng, MULTIPLAYER_POLICY);

    // 无论宿主传什么"新种子"，都不会被采用
    const a = loadAndRoll(snap, 111111);
    const b = loadAndRoll(snap, 222222);

    expect(a.reseeded).toBe(false);
    expect(a.rolls).toEqual(b.rolls);

    // 且与未中断的原始序列一致
    expect(rollDice(rng, 1).sum).toBe(a.rolls[0]);
  });

  it('回合推进时不重新播种', () => {
    expect(needsReseed(MULTIPLAYER_POLICY, 'turnAdvance')).toBe(false);
    expect(needsReseed(MULTIPLAYER_POLICY, 'afterLoad')).toBe(false);
    expect(needsReseed(MULTIPLAYER_POLICY, 'gameStart')).toBe(true);
  });
});

describe('两种模式的引擎都是纯函数', () => {
  it('把 reseed 当作 action 记录后，单机局同样可完整回放', () => {
    // 模拟一局单机：掷骰若干次，中途发生两次回合级重新播种
    type Action = { kind: 'roll' } | { kind: 'reseed'; seed: number };
    const log: Action[] = [
      { kind: 'reseed', seed: 0x1a2b3c4d }, // gameStart
      { kind: 'roll' }, { kind: 'roll' },
      { kind: 'reseed', seed: 0x5e6f7a8b }, // turnAdvance
      { kind: 'roll' }, { kind: 'roll' }, { kind: 'roll' },
      { kind: 'reseed', seed: 0x0c0d0e0f }, // turnAdvance
      { kind: 'roll' },
    ];

    const replay = (): number[] => {
      const rng = new WatcomRng();
      const out: number[] = [];
      for (const a of log) {
        if (a.kind === 'reseed') rng.seed(a.seed);
        else out.push(rollDice(rng, 1).sum);
      }
      return out;
    };

    // 同一份 action 日志重放两次，结果逐项相同 —— C-DET-4 在单机模式下同样成立
    expect(replay()).toEqual(replay());
  });

  it('policyFor 按模式返回正确策略', () => {
    expect(policyFor('single')).toBe(SINGLE_PLAYER_POLICY);
    expect(policyFor('multiplayer')).toBe(MULTIPLAYER_POLICY);
  });
});
