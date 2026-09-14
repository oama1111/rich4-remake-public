/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 怪獸卡与地块改造 —— 以 VA 0x0040ab4a 为准
 */

import { describe, expect, it } from 'vitest';
import { makeFacility, makeLand } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import {
  MONSTER_HOSTILITY_PER_LEVEL,
  MUTATE_CLEAR_OWNER,
  MUTATE_DEMOLISH_ONE,
  MUTATE_FLATTEN,
  applyMonsterCard,
  applyMonsterFacilityCard,
  mutateFacility,
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

describe('★ 設施分支 —— mutate_land 的 0xfa0..0x1770 路径（T-006）', () => {
  it('mode 2 夷平：等级与种类归零', () => {
    const r = mutateFacility(makeFacility({ level: 3, type: 1, owner: 2 }), MUTATE_FLATTEN);
    expect(r.changed).toBe(true);
    expect(r.facility.level).toBe(0);
    expect(r.facility.type).toBe(0);
  });

  it('★ mode 2 保留归属——怪獸踏平建筑，设施还是原主的', () => {
    const r = mutateFacility(makeFacility({ level: 3, type: 1, owner: 2 }), MUTATE_FLATTEN);
    expect(r.facility.owner).toBe(2);
  });

  it('mode 2 对 0 级设施不变', () => {
    expect(mutateFacility(makeFacility({ level: 0 }), MUTATE_FLATTEN).changed).toBe(false);
  });

  it('mode 0 拆一级；拆到 0 级时种类归零（退回公園）', () => {
    const one = mutateFacility(makeFacility({ level: 2, type: 3 }), MUTATE_DEMOLISH_ONE);
    expect(one.facility).toMatchObject({ level: 1, type: 3 });
    const zero = mutateFacility(makeFacility({ level: 1, type: 3 }), MUTATE_DEMOLISH_ONE);
    expect(zero.facility).toMatchObject({ level: 0, type: 0 });
  });

  it('mode 1 清归属：owner/level/type 全归零', () => {
    const r = mutateFacility(makeFacility({ level: 2, type: 4, owner: 1 }), MUTATE_CLEAR_OWNER);
    expect(r.facility).toMatchObject({ owner: 0, level: 0, type: 0 });
  });

  it('未知模式不改动', () => {
    const f = makeFacility({ level: 3 });
    expect(mutateFacility(f, 9)).toEqual({ facility: f, changed: false });
  });
});

describe('★ 怪獸卡踏設施（VA 0x004439e8 敌意段）', () => {
  it('敌意 = 等级 × 30 × 物价指数，与地块路径同式', () => {
    const r = applyMonsterFacilityCard(makeFacility({ level: 2, type: 1, owner: 3 }), 2, 0);
    expect(r.ok).toBe(true);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 2 * 30 * 2 }]);
  });

  it('无主设施不记敌意，但仍被踏平', () => {
    const r = applyMonsterFacilityCard(makeFacility({ level: 2, type: 1, owner: 0 }), 1, 0);
    expect(r.ok).toBe(true);
    expect(r.hostilityDeltas).toEqual([]);
    expect(r.facility.level).toBe(0);
  });

  it('0 级设施 → ok 为 false（没东西可拆）', () => {
    expect(applyMonsterFacilityCard(makeFacility({ level: 0, owner: 3 }), 1, 0).ok).toBe(false);
  });
});
