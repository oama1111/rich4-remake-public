/*
 * 卡片目标模型验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  targetClassOf, validateTarget, bitsetOf, indexOfBitset, isCancelled,
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

  it('地块类参数 → land', () => {
    for (const p of [0xe0c0202, 0xe0c0006, 0xe0c0506, 0xe0c0626]) {
      expect(targetClassOf(p)).toBe('land');
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
