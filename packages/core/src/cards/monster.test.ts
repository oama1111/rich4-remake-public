/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 怪獸卡与地块改造 —— 以 VA 0x0040ab4a 为准
 */

import { describe, expect, it } from 'vitest';
import { makeLand } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import {
  MONSTER_HOSTILITY_PER_LEVEL,
  MUTATE_CLEAR_OWNER,
  MUTATE_DEMOLISH_ONE,
  MUTATE_FLATTEN,
  applyMonsterCard,
  mutateLand,
} from './monster.ts';

describe('mode 0 —— 拆一级（拆除卡走这条）', () => {
  it('等级减一', () => {
    const r = mutateLand(makeLand({ level: 3, type: LAND_TYPE_HOUSE }), MUTATE_DEMOLISH_ONE);
    expect(r.land.level).toBe(2);
    expect(r.changed).toBe(true);
  });

  it('空地不变', () => {
    const r = mutateLand(makeLand({ level: 0 }), MUTATE_DEMOLISH_ONE);
    expect(r.changed).toBe(false);
  });

  it('★ 连锁店不是减一级，而是直接清空并变回住宅', () => {
    const r = mutateLand(makeLand({ level: 1, type: 1 }), MUTATE_DEMOLISH_ONE);
    expect(r.land.level).toBe(0);
    expect(r.land.type).toBe(LAND_TYPE_HOUSE);
  });
});

describe('mode 1 —— 清归属', () => {
  it('归属清零、类型变回住宅', () => {
    const r = mutateLand(makeLand({ owner: 3, type: 1, level: 2 }), MUTATE_CLEAR_OWNER);
    expect(r.land.owner).toBe(0);
    expect(r.land.type).toBe(LAND_TYPE_HOUSE);
    expect(r.changed).toBe(true);
  });
});

describe('★ mode 2 —— 夷平（怪獸卡）', () => {
  it('等级归零', () => {
    const r = mutateLand(makeLand({ level: 5, owner: 2 }), MUTATE_FLATTEN);
    expect(r.land.level).toBe(0);
  });

  it('★ 保留归属——怪獸踏平建筑，地还是原主的', () => {
    const r = mutateLand(makeLand({ level: 5, owner: 2 }), MUTATE_FLATTEN);
    expect(r.land.owner).toBe(2);
  });

  it('空地上什么都不发生', () => {
    expect(mutateLand(makeLand({ level: 0 }), MUTATE_FLATTEN).changed).toBe(false);
  });

  it('★ 与拆除卡的区别：一次踏平 vs 只拆一级', () => {
    const land = makeLand({ level: 4, owner: 1 });
    expect(mutateLand(land, MUTATE_FLATTEN).land.level).toBe(0);
    expect(mutateLand(land, MUTATE_DEMOLISH_ONE).land.level).toBe(3);
  });
});

describe('怪獸卡敌意', () => {
  it('★ 等级 × 30 × 物价指数', () => {
    expect(MONSTER_HOSTILITY_PER_LEVEL).toBe(30);
    const r = applyMonsterCard(makeLand({ level: 4, owner: 3 }), 2, 0);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 4 * 30 * 2 }]);
  });

  it('★ 无主地不记敌意', () => {
    const r = applyMonsterCard(makeLand({ level: 4, owner: 0 }), 2, 0);
    expect(r.hostilityDeltas).toEqual([]);
  });

  it('空地敌意为 0（等级 0）', () => {
    const r = applyMonsterCard(makeLand({ level: 0, owner: 3 }), 5, 0);
    expect(r.hostilityDeltas[0]!.delta).toBe(0);
    expect(r.ok).toBe(false); // 没东西可拆
  });

  it('夷平成功时 ok 为 true', () => {
    expect(applyMonsterCard(makeLand({ level: 2, owner: 3 }), 1, 0).ok).toBe(true);
  });
});

describe('未知模式', () => {
  it('不改动', () => {
    const land = makeLand({ level: 3 });
    expect(mutateLand(land, 9)).toEqual({ land, changed: false });
  });
});
