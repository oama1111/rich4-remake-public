/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 神明加持倍率 —— 以 VA 0x0044b896 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  BLESSING_CHANCE_THRESHOLD,
  BLESSING_DOUBLE,
  BLESSING_DOUBLE_THRESHOLD,
  BLESSING_NONE,
  BLESSING_VOID,
  blessingLevel,
  blessingMultiplier,
  playerBlessingMultiplier,
} from './blessing.ts';

describe('★ 返回的是倍率档位，不是布尔开关', () => {
  it('0 → ×1、1 → ×0、2 → ×2', () => {
    expect(blessingMultiplier(BLESSING_NONE)).toBe(1);
    expect(blessingMultiplier(BLESSING_VOID)).toBe(0);
    expect(blessingMultiplier(BLESSING_DOUBLE)).toBe(2);
  });

  it('未知档位按不变处理', () => {
    expect(blessingMultiplier(7)).toBe(1);
  });
});

describe('阈值分档', () => {
  it('> 100 必定加倍', () => {
    expect(BLESSING_DOUBLE_THRESHOLD).toBe(100);
    expect(blessingLevel(101, 0)).toBe(BLESSING_DOUBLE);
    expect(blessingLevel(9999, 0)).toBe(BLESSING_DOUBLE);
  });

  it('★ 恰好 100 不走必定档（原版是 jle）', () => {
    expect(blessingLevel(100, 0)).not.toBe(BLESSING_DOUBLE);
  });

  it('50 < x <= 100 一半概率加倍', () => {
    expect(BLESSING_CHANCE_THRESHOLD).toBe(50);
    expect(blessingLevel(75, 1)).toBe(BLESSING_DOUBLE);
    expect(blessingLevel(75, 0)).toBe(BLESSING_NONE);
    // 只看最低位
    expect(blessingLevel(75, 3)).toBe(BLESSING_DOUBLE);
    expect(blessingLevel(75, 2)).toBe(BLESSING_NONE);
  });

  it('★ 恰好 50 落到不变档（jle）', () => {
    expect(blessingLevel(50, 1)).toBe(BLESSING_NONE);
  });

  it('0..50 不变', () => {
    for (const v of [0, 1, 25, 50]) expect(blessingLevel(v, 1)).toBe(BLESSING_NONE);
  });

  it('★ 只有负值才归零（test si,si / jge）', () => {
    expect(blessingLevel(-1, 0)).toBe(BLESSING_VOID);
    expect(blessingLevel(-999, 1)).toBe(BLESSING_VOID);
    expect(blessingLevel(0, 0)).toBe(BLESSING_NONE);
  });
});

describe('从玩家取值', () => {
  it('默认加持为 0 → 不变', () => {
    expect(playerBlessingMultiplier(makePlayer(), 1)).toBe(1);
  });

  it('负加持 → 金额归零', () => {
    expect(playerBlessingMultiplier(makePlayer({ blessing: -5 }), 1)).toBe(0);
  });

  it('高加持 → 加倍', () => {
    expect(playerBlessingMultiplier(makePlayer({ blessing: 200 }), 0)).toBe(2);
  });
});
