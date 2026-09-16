/*
 * 改建卡验证 —— 基准为原版 exe 反汇编（VA 0x0044309b）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyRebuildCard,
  applyRebuildFacilityCard,
  CHAIN_STORE_MAX_LEVEL,
  FACILITY_TYPE_SINGLE_LEVEL,
} from './rebuild.ts';
import { makeFacility, makeLand } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';

/** 落在住宅地块 i 上时的节点 type */
const houseNode = (i: number) => 2000 + i;

describe('改建卡 —— 住宅 ↔ 连锁店互换', () => {
  it('★ 住宅改成连锁店', () => {
    const r = applyRebuildCard(houseNode(1), makeLand({ type: LAND_TYPE_HOUSE, level: 1 }));
    expect(r.ok).toBe(true);
    expect(r.land!.type).toBe(1);
  });

  it('★ 连锁店改回住宅', () => {
    const r = applyRebuildCard(houseNode(1), makeLand({ type: 1, level: 1 }));
    expect(r.ok).toBe(true);
    expect(r.land!.type).toBe(LAND_TYPE_HOUSE);
  });

  it('互换是 xor 1，连续两次回到原状', () => {
    const first = applyRebuildCard(houseNode(1), makeLand({ type: 0, level: 1 }));
    const second = applyRebuildCard(houseNode(1), first.land);
    expect(second.land!.type).toBe(0);
  });
});

describe('等级处理', () => {
  it('★ 改成连锁店时，等级 > 1 被压到 1', () => {
    // @source cmp byte [land+0x1a], 1 / jbe skip / mov byte [land+0x1a], 1
    expect(CHAIN_STORE_MAX_LEVEL).toBe(1);
    const r = applyRebuildCard(houseNode(1), makeLand({ type: LAND_TYPE_HOUSE, level: 5 }));
    expect(r.land!.type).toBe(1);
    expect(r.land!.level).toBe(1);
  });

  it('等级恰为 1 时不变（jbe 分支）', () => {
    const r = applyRebuildCard(houseNode(1), makeLand({ type: LAND_TYPE_HOUSE, level: 1 }));
    expect(r.land!.level).toBe(1);
  });

  it('★ 改回住宅时等级**不**被压（je 提前跳过）', () => {
    // 连锁店等级本就 ≤ 1，但若数据异常为 4，改回住宅时应原样保留
    const r = applyRebuildCard(houseNode(1), makeLand({ type: 1, level: 4 }));
    expect(r.land!.type).toBe(LAND_TYPE_HOUSE);
    expect(r.land!.level).toBe(4);
  });
});

describe('前置条件', () => {
  it('★ 空地不可改建', () => {
    const r = applyRebuildCard(houseNode(1), makeLand({ level: 0 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('emptyLot');
    expect(r.land).toBeNull();
  });

  it('非住宅落点不可改建', () => {
    // type 0 = 特殊格
    expect(applyRebuildCard(0, makeLand({ level: 3 })).reason).toBe('notHousingLand');
    // 4000+ = 設施 —— 那一支走 `applyRebuildFacilityCard`（下面那一组）
    expect(applyRebuildCard(4001, makeLand({ level: 3 })).reason).toBe('notHousingLand');
  });

  it('住宅区间边界与原版一致（2000 与 4000 本身被排除）', () => {
    expect(applyRebuildCard(2000, makeLand({ level: 1 })).ok).toBe(false);
    expect(applyRebuildCard(2001, makeLand({ level: 1 })).ok).toBe(true);
    expect(applyRebuildCard(3999, makeLand({ level: 1 })).ok).toBe(true);
    expect(applyRebuildCard(4000, makeLand({ level: 1 })).ok).toBe(false);
  });

  it('地块为 null 时失败', () => {
    expect(applyRebuildCard(houseNode(1), null).ok).toBe(false);
  });
});

describe('不原地修改入参', () => {
  it('原地块不变', () => {
    const land = makeLand({ type: LAND_TYPE_HOUSE, level: 5 });
    const snapshot = JSON.stringify(land);
    applyRebuildCard(houseNode(1), land);
    expect(JSON.stringify(land)).toBe(snapshot);
  });
});

// ============================================================
//  設施那一支 —— VA 0x0044315d 起
// ============================================================

describe('改建卡 —— 設施改种类（VA 0x0044315d）', () => {
  it('★ 公园 1 级 → 研究所：种类换掉、等级保留', () => {
    const r = applyRebuildFacilityCard(
      makeFacility({ type: FACILITY_TYPE.park, level: 1, owner: 1 }),
      FACILITY_TYPE.lab,
    );
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.facility!.type).toBe(FACILITY_TYPE.lab);
    expect(r.facility!.level).toBe(1);
    // 原版只写 `+0x18` 一个字节：别的字段原样带过去
    expect(r.facility!.owner).toBe(1);
  });

  it('★ 改成公園 / 加油站时等级 > 1 被压到 1（原版那两跳）', () => {
    // @source test dh,dh / je clamp；cmp dh,3 / jne done
    expect(FACILITY_TYPE_SINGLE_LEVEL).toEqual([FACILITY_TYPE.park, FACILITY_TYPE.gasStation]);
    const asPark = applyRebuildFacilityCard(
      makeFacility({ type: FACILITY_TYPE.hotel, level: 5 }),
      FACILITY_TYPE.park,
    );
    expect(asPark.facility!.type).toBe(FACILITY_TYPE.park);
    expect(asPark.facility!.level).toBe(1);

    const asGas = applyRebuildFacilityCard(
      makeFacility({ type: FACILITY_TYPE.mall, level: 4 }),
      FACILITY_TYPE.gasStation,
    );
    expect(asGas.facility!.level).toBe(1);
  });

  it('★ 改成旅館 / 購物中心 / 研究所时**不**压等级', () => {
    for (const type of [FACILITY_TYPE.hotel, FACILITY_TYPE.mall, FACILITY_TYPE.lab]) {
      const r = applyRebuildFacilityCard(makeFacility({ type: FACILITY_TYPE.park, level: 5 }), type);
      expect(r.facility!.type).toBe(type);
      expect(r.facility!.level).toBe(5);
    }
  });

  it('等级恰为 1 时压级是空操作（jbe）', () => {
    const r = applyRebuildFacilityCard(makeFacility({ type: FACILITY_TYPE.hotel, level: 1 }), FACILITY_TYPE.park);
    expect(r.facility!.level).toBe(1);
  });

  it('★ 改成同一种类照样生效（原版不复核）', () => {
    const r = applyRebuildFacilityCard(makeFacility({ type: FACILITY_TYPE.hotel, level: 3 }), FACILITY_TYPE.hotel);
    expect(r.ok).toBe(true);
    expect(r.facility!.type).toBe(FACILITY_TYPE.hotel);
    expect(r.facility!.level).toBe(3);
  });

  it('★ 等级 0 的設施不生效（`cmp [ebx+0x1a],0 / je`）', () => {
    const r = applyRebuildFacilityCard(makeFacility({ type: FACILITY_TYPE.park, level: 0 }), FACILITY_TYPE.hotel);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('emptyFacility');
    expect(r.facility).toBeNull();
  });

  it('★ 没给种类 → 拒收（真人必须先过选類別窗）', () => {
    const r = applyRebuildFacilityCard(makeFacility({ level: 2 }), undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('facilityTypeRequired');
  });

  it('种类超出 0..4 → 拒收（外部参数复核）', () => {
    const fac = makeFacility({ level: 2 });
    expect(applyRebuildFacilityCard(fac, -1).reason).toBe('badFacilityType');
    expect(applyRebuildFacilityCard(fac, 5).reason).toBe('badFacilityType');
    expect(applyRebuildFacilityCard(fac, 1.5).reason).toBe('badFacilityType');
    expect(applyRebuildFacilityCard(fac, FACILITY_TYPE.lab).ok).toBe(true);
  });

  it('不是設施格（null）→ notFacility', () => {
    expect(applyRebuildFacilityCard(null, FACILITY_TYPE.hotel).reason).toBe('notFacility');
  });

  it('原版**不看业主**：别人的設施照样改', () => {
    const r = applyRebuildFacilityCard(makeFacility({ owner: 3, level: 2 }), FACILITY_TYPE.park);
    expect(r.ok).toBe(true);
    expect(r.facility!.owner).toBe(3);
    expect(r.facility!.type).toBe(FACILITY_TYPE.park);
  });

  it('不原地修改入参', () => {
    const fac = makeFacility({ type: FACILITY_TYPE.hotel, level: 5 });
    const snapshot = JSON.stringify(fac);
    applyRebuildFacilityCard(fac, FACILITY_TYPE.park);
    expect(JSON.stringify(fac)).toBe(snapshot);
  });
});
