/*
 * 卡片目标模型验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  targetClassOf, targetClassOfCard, validateTarget,
  bitsetOf, indexOfBitset, isCancelled, ACTOR_MIN, ACTOR_MAX,
} from './target.ts';
import type { CardTarget } from './target.ts';
import { CARD_IMPLS, SELECTION_GROUPS } from '@rich4/data';

describe('目标类别归类', () => {
  it('无选择参数 → none', () => {
    expect(targetClassOf(null)).toBe('none');
  });

  it('0xe0c0010 → anyPlayer（可对自己使用）', () => {
    expect(targetClassOf(0xe0c0010)).toBe('anyPlayer');
  });

  it('0xe0c0410 / 0xe0c0710 → player', () => {
    expect(targetClassOf(0xe0c0410)).toBe('player');
    expect(targetClassOf(0xe0c0710)).toBe('player');
  });

  it('0xe0c0202 → land（换地/换屋仅住宅/连锁店）', () => {
    expect(targetClassOf(0xe0c0202)).toBe('land');
  });

  it('0xe0c0006 / 0506 / 0626 → landOrFacility（REQ-06.1：同样作用于設施）', () => {
    for (const p of [0xe0c0006, 0xe0c0506, 0xe0c0626]) {
      expect(targetClassOf(p)).toBe('landOrFacility');
    }
  });

  it('★ 清单中每个选择参数都能被归类', () => {
    for (const impl of CARD_IMPLS) {
      if (impl.selectionParam === null) continue;
      expect(targetClassOf(impl.selectionParam), impl.name).not.toBe('none');
    }
  });

  it('★ 归类覆盖 SELECTION_GROUPS 的全部取值', () => {
    for (const key of Object.keys(SELECTION_GROUPS)) {
      expect(targetClassOf(Number(key))).not.toBe('none');
    }
  });
});

describe('卡片级目标类别（无 selectionParam 的卡）', () => {
  const implOf = (id: number) => {
    const impl = CARD_IMPLS.find((c) => c.id === id);
    if (impl === undefined) throw new Error(`card ${id} missing`);
    return impl;
  };

  it('請神符（23）→ object', () => {
    expect(targetClassOfCard(implOf(23))).toBe('object');
  });

  it('紅卡（24）/ 黑卡（25）→ stock', () => {
    expect(targetClassOfCard(implOf(24))).toBe('stock');
    expect(targetClassOfCard(implOf(25))).toBe('stock');
  });

  it('有 selectionParam 的卡与 targetClassOf 一致', () => {
    for (const impl of CARD_IMPLS) {
      if (impl.selectionParam === null) continue;
      expect(targetClassOfCard(impl), impl.name).toBe(targetClassOf(impl.selectionParam));
    }
  });

  it('无参数且非 ai 选择的卡 → none', () => {
    expect(targetClassOfCard(implOf(1))).toBe('none'); // 均富卡 selection 'none'
    expect(targetClassOfCard(implOf(15))).toBe('none'); // 冬眠卡
  });
});

describe('目标合法性校验', () => {
  const P = (index: number): CardTarget => ({ kind: 'player', index });
  const E = (entityId: number): CardTarget => ({ kind: 'entity', entityId });
  const N: CardTarget = { kind: 'none' };

  it('无需目标的卡不接受目标', () => {
    expect(validateTarget('none', N, 0)).toBeNull();
    expect(validateTarget('none', P(1), 0)).toBe('targetNotAllowed');
  });

  it('需要目标的卡必须给目标', () => {
    expect(validateTarget('player', N, 0)).toBe('targetRequired');
    expect(validateTarget('land', N, 0)).toBe('targetRequired');
  });

  it('目标种类必须匹配', () => {
    expect(validateTarget('land', P(1), 0)).toBe('wrongTargetKind');
    expect(validateTarget('player', E(2001), 0)).toBe('wrongTargetKind');
  });

  it('玩家下标须在范围内', () => {
    expect(validateTarget('player', P(1), 0)).toBeNull();
    expect(validateTarget('player', P(4), 0)).toBe('playerOutOfRange');
    expect(validateTarget('player', P(-1), 0)).toBe('playerOutOfRange');
  });

  it('★ anyPlayer 允许指向自己，player 不允许', () => {
    // 转向/停留/乌龟可对自己使用，由 2026 版 C 的自我目标分支佐证
    expect(validateTarget('anyPlayer', P(0), 0)).toBeNull();
    expect(validateTarget('player', P(0), 0)).toBe('cannotTargetSelf');
  });

  it('地块目标只校验种类', () => {
    expect(validateTarget('land', E(2001), 0)).toBeNull();
    expect(validateTarget('land', E(4001), 0)).toBeNull();
  });

  it('land 类仍不接受 facility（换地/换屋不换設施）', () => {
    expect(validateTarget('land', { kind: 'facility', facilityId: 1 }, 0)).toBe('wrongTargetKind');
  });
});

describe('目标合法性校验 · 新变体（T-001）', () => {
  const F = (facilityId: number): CardTarget => ({ kind: 'facility', facilityId });
  const S = (index: number): CardTarget => ({ kind: 'stock', index });
  const O = (objectIndex: number): CardTarget => ({ kind: 'object', objectIndex });
  const A = (actor: number): CardTarget => ({ kind: 'actor', actor });
  const E = (entityId: number): CardTarget => ({ kind: 'entity', entityId });
  const P = (index: number): CardTarget => ({ kind: 'player', index });

  it('landOrFacility 同时接受 entity 与 facility', () => {
    expect(validateTarget('landOrFacility', E(2001), 0)).toBeNull();
    expect(validateTarget('landOrFacility', F(1), 0)).toBeNull();
    expect(validateTarget('landOrFacility', P(1), 0)).toBe('wrongTargetKind');
  });

  it('facility 越界：1..facilityCount', () => {
    const lim = { facilityCount: 8 };
    expect(validateTarget('landOrFacility', F(8), 0, 4, lim)).toBeNull();
    expect(validateTarget('landOrFacility', F(0), 0, 4, lim)).toBe('facilityOutOfRange');
    expect(validateTarget('landOrFacility', F(9), 0, 4, lim)).toBe('facilityOutOfRange');
    expect(validateTarget('landOrFacility', F(1.5), 0, 4, lim)).toBe('facilityOutOfRange');
  });

  it('stock：0 基下标，0..stockCount-1', () => {
    const lim = { stockCount: 12 };
    expect(validateTarget('stock', S(0), 0, 4, lim)).toBeNull();
    expect(validateTarget('stock', S(11), 0, 4, lim)).toBeNull();
    expect(validateTarget('stock', S(12), 0, 4, lim)).toBe('stockOutOfRange');
    expect(validateTarget('stock', S(-1), 0, 4, lim)).toBe('stockOutOfRange');
    expect(validateTarget('stock', E(2001), 0, 4, lim)).toBe('wrongTargetKind');
  });

  it('object：1 基 handle，1..objectCount', () => {
    const lim = { objectCount: 46 };
    expect(validateTarget('object', O(1), 0, 4, lim)).toBeNull();
    expect(validateTarget('object', O(46), 0, 4, lim)).toBeNull();
    expect(validateTarget('object', O(0), 0, 4, lim)).toBe('objectOutOfRange');
    expect(validateTarget('object', O(47), 0, 4, lim)).toBe('objectOutOfRange');
    expect(validateTarget('object', P(1), 0, 4, lim)).toBe('wrongTargetKind');
  });

  it('playerOrActor：玩家（含自己）与 actor 4..8', () => {
    expect(validateTarget('playerOrActor', P(0), 0)).toBeNull(); // 自己
    expect(validateTarget('playerOrActor', P(3), 0)).toBeNull();
    expect(validateTarget('playerOrActor', P(4), 0)).toBe('playerOutOfRange');
    expect(validateTarget('playerOrActor', A(ACTOR_MIN), 0)).toBeNull();
    expect(validateTarget('playerOrActor', A(ACTOR_MAX), 0)).toBeNull();
    expect(validateTarget('playerOrActor', A(3), 0)).toBe('actorOutOfRange');
    expect(validateTarget('playerOrActor', A(9), 0)).toBe('actorOutOfRange');
    expect(validateTarget('playerOrActor', E(2001), 0)).toBe('wrongTargetKind');
  });

  it('REQ-05.1：anyPlayer/player 仅在 allowActor 时接受 actor', () => {
    expect(validateTarget('anyPlayer', A(4), 0)).toBe('wrongTargetKind');
    expect(validateTarget('player', A(4), 0)).toBe('wrongTargetKind');
    expect(validateTarget('anyPlayer', A(4), 0, 4, { allowActor: true })).toBeNull();
    expect(validateTarget('player', A(8), 0, 4, { allowActor: true })).toBeNull();
    expect(validateTarget('anyPlayer', A(9), 0, 4, { allowActor: true })).toBe('actorOutOfRange');
  });

  it('不给范围上限时只校验种类（与 land 类一致）', () => {
    expect(validateTarget('landOrFacility', F(999), 0)).toBeNull();
    expect(validateTarget('stock', S(999), 0)).toBeNull();
    expect(validateTarget('object', O(999), 0)).toBeNull();
  });
});

describe('位集合（与原版对齐）', () => {
  it('bitsetOf / indexOfBitset 互逆', () => {
    for (let i = 0; i < 8; i++) {
      expect(indexOfBitset(bitsetOf(i))).toBe(i);
    }
  });

  it('取最低置位（等价于原版 CTZ）', () => {
    expect(indexOfBitset(0b1010)).toBe(1);
    expect(indexOfBitset(0b1000)).toBe(3);
  });

  it('★ 位集合为 0 表示取消选择', () => {
    // @source test ebx, ebx / je end —— 此时不消耗卡片且返回 0
    expect(isCancelled(0)).toBe(true);
    expect(isCancelled(1)).toBe(false);
    expect(indexOfBitset(0)).toBe(-1);
  });
});
