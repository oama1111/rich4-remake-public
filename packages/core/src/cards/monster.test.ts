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

describe('mode 1 —— 完全清除（不是只清归属）', () => {
  // ★ 原版 `0x0040abae`–`0x0040abc3` 一次清**四项**：
  //   `[+0x19]=0`(owner) `[+0x1a]=0`(**level**) `[+0x18]=0`(type) `[+0x30]=0`(flast)，
  //   且**无前置判据**（一定会改，返回值恒 1）。
  //   此前的测试只断言 owner/type，**从不查 level** —— 这正是
  //   "mode 1 留下无主残楼"这个 bug 能长期存活的原因。
  it('owner / level / type / flast **四项**全清', () => {
    const r = mutateLand(
      makeLand({ owner: 3, type: 1, level: 4, flast: 0x07e5_060f }),
      MUTATE_CLEAR_OWNER,
    );
    expect(r.land.owner).toBe(0);
    expect(r.land.level).toBe(0); // ★ 以前漏掉的
    expect(r.land.type).toBe(LAND_TYPE_HOUSE);
    expect(r.land.flast).toBe(0); // ★ 以前漏掉的（地契到期日）
    expect(r.changed).toBe(true);
  });

  it('无前置判据：已经在初始状态也会返回 changed = true', () => {
    const r = mutateLand(makeLand({ owner: 0, level: 0, type: 0 }), MUTATE_CLEAR_OWNER);
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
    expect(mutateLand(land, 9)).toEqual({
      land, changed: false, releasesConfined: false,
    });
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

  it('mode 1 完全清除：owner/level/type/**flast** 全归零', () => {
    const r = mutateFacility(
      makeFacility({ level: 2, type: 4, owner: 1, flast: 0x07e5_060f }),
      MUTATE_CLEAR_OWNER,
    );
    // ★ flast 在 `+0x34`（与住宅的 `+0x30` 不同），以前漏清
    expect(r.facility).toMatchObject({ owner: 0, level: 0, type: 0, flast: 0 });
  });

  it('未知模式不改动', () => {
    const f = makeFacility({ level: 3 });
    expect(mutateFacility(f, 9)).toEqual({
      facility: f, changed: false, releasesConfined: false,
    });
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

// ============================================================
//  `releasesConfined` —— 原版 mutate 尾部 `call 0x40dffa` 的门控
//  （差分证据：rich4-spec/tests/test_mutate_release.py）
// ============================================================

// ★★ 2026-09-19 订正（§7.141 E1，通道 2 `test_land_mutation_gates.py` 354/354）：
//   原版 `0x40ab4a` 的 **地块支三种 mode 一次都不调 `0x40dffa`** —— 那 120 条指令里
//   只有一次 `call 0x40a4e1`（mode 1）；`0x40dffa` 的三个调用点
//   （`0x40ac33`/`0x40ac4d`/`0x40ac6c`）全在 **設施支**。
//   旧断言把「地块也放人」钉死了（还引了属于另一个函数 `0x40ac7b` 的 `0x40ae0a`），已改。
describe('★ releasesConfined：放人只在**設施**支发生（地块支一次都不放）', () => {
  it('mode 0（拆一级）：設施拆到 0 级才放人', () => {
    expect(mutateFacility(makeFacility({ level: 3 }), 0).releasesConfined).toBe(false);
    expect(mutateFacility(makeFacility({ level: 1 }), 0).releasesConfined).toBe(true);
    expect(mutateFacility(makeFacility({ level: 0 }), 0).changed).toBe(false);
  });

  it('★★ mode 0：**地块**拆到 0 级也**不放人**', () => {
    expect(mutateLand(makeLand({ level: 3 }), 0).releasesConfined).toBe(false);
    expect(mutateLand(makeLand({ level: 1 }), 0).releasesConfined).toBe(false);
  });

  it('★ mode 1（清归属）：設施无条件放人、**地块不放**', () => {
    expect(mutateFacility(makeFacility({ level: 0 }), 1).releasesConfined).toBe(true);
    expect(mutateLand(makeLand({ level: 0 }), 1).releasesConfined).toBe(false);
  });

  it('mode 2（夷平）：設施改了才放人、**地块不放**', () => {
    expect(mutateFacility(makeFacility({ level: 2 }), 2).releasesConfined).toBe(true);
    expect(mutateFacility(makeFacility({ level: 0 }), 2).releasesConfined).toBe(false);
    expect(mutateLand(makeLand({ level: 2 }), 2).releasesConfined).toBe(false);
    expect(mutateLand(makeLand({ level: 0 }), 2).releasesConfined).toBe(false);
  });

  it('★ 地塊的连锁店（type != 0）拆一级「直接归零」，同样**不放人**', () => {
    expect(mutateLand(makeLand({ level: 1, type: 1 }), 0).releasesConfined).toBe(false);
    expect(mutateLand(makeLand({ level: 1, type: 1 }), 0).land.level).toBe(0);
  });
});
