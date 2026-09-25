/*
 * 地块类卡片验证 —— 基准为原版 exe 反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyAngelCard, applyDevilCard, applyDemolishCard,
  applyRaisePriceCard, applySealCard,
  applyAngelFacilityCard, applyDevilFacilityCard, applyDemolishFacilityCard,
} from './land-cards.ts';
import { makeFacility, makeLand } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { PRICE_STATUS } from '../rules/land-mutation.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';

describe('天使卡 —— 升级', () => {
  it('住宅逐级升', () => {
    expect(applyAngelCard(makeLand({ type: LAND_TYPE_HOUSE, level: 2 })).level).toBe(3);
  });

  it('住宅受满级上限约束', () => {
    expect(applyAngelCard(makeLand({ type: LAND_TYPE_HOUSE, level: MAX_LAND_LEVEL })).level)
      .toBe(MAX_LAND_LEVEL);
  });

  it('★ 连锁店只能从 0 升到 1', () => {
    // @source cmp byte [land+0x1a],0 / jne → 不变
    expect(applyAngelCard(makeLand({ type: 1, level: 0 })).level).toBe(1);
  });

  it('★ 已有等级的连锁店原地不动', () => {
    const l = makeLand({ type: 1, level: 1 });
    expect(applyAngelCard(l)).toBe(l); // 同一引用
  });

  it('不原地修改入参', () => {
    const l = makeLand({ level: 2 });
    applyAngelCard(l);
    expect(l.level).toBe(2);
  });
});

describe('恶魔卡 —— 夷平', () => {
  it('等级归零且退回住宅', () => {
    const r = applyDevilCard(makeLand({ type: 1, level: 5 }));
    expect(r.level).toBe(0);
    expect(r.type).toBe(LAND_TYPE_HOUSE);
  });

  it('★ 与拆除卡的区别：恶魔对住宅也直接归零', () => {
    const land = makeLand({ type: LAND_TYPE_HOUSE, level: 4, owner: 2 });
    expect(applyDevilCard(land).level).toBe(0);        // 恶魔：归零
    expect(applyDemolishCard(land, 1).land.level).toBe(3); // 拆除：掉一级
  });
});

describe('拆除卡', () => {
  it('复用地块变更底座', () => {
    const r = applyDemolishCard(makeLand({ level: 3, owner: 2 }), 2);
    expect(r.land.level).toBe(2);
    expect(r.hostilityDelta).toBe(60); // pi 2 × 30
  });
});

describe('★ 涨价卡 / 查封卡 —— 按地块名批量作用于同一区', () => {
  const district = () => [
    makeLand({ id: 1, name: '台北市' }),
    makeLand({ id: 2, name: '台北市' }),
    makeLand({ id: 3, name: '新竹市' }),
    makeLand({ id: 4, name: '台北市' }),
  ];

  it('涨价：同名地块全部标记 0x50', () => {
    const r = applyRaisePriceCard(district(), '台北市');
    expect(r.affected).toEqual([1, 2, 4]);
    expect(r.lands.filter((l) => l.priceStatus === PRICE_STATUS.RAISED).length).toBe(3);
  });

  it('查封：同名地块全部标记 0x51', () => {
    const r = applySealCard(district(), '台北市');
    expect(r.lands[0]!.priceStatus).toBe(PRICE_STATUS.SEALED);
    expect(r.lands[3]!.priceStatus).toBe(PRICE_STATUS.SEALED);
  });

  it('★ 不同名的地块不受影响', () => {
    const r = applyRaisePriceCard(district(), '台北市');
    expect(r.lands[2]!.priceStatus).toBe(PRICE_STATUS.NORMAL);
  });

  it('无匹配时不影响任何地块', () => {
    const r = applyRaisePriceCard(district(), '不存在的区');
    expect(r.affected).toEqual([]);
    expect(r.lands.every((l) => l.priceStatus === PRICE_STATUS.NORMAL)).toBe(true);
  });

  it('与过路费的同区机制一致（都按地块名分组）', () => {
    // 过路费按 name 累加同区租金，涨价/查封按 name 批量标记
    const r = applyRaisePriceCard(district(), '台北市');
    const names = r.lands.filter((l) => l.priceStatus === PRICE_STATUS.RAISED).map((l) => l.name);
    expect(new Set(names).size).toBe(1);
  });

  it('不原地修改入参', () => {
    const ls = district();
    const snap = JSON.stringify(ls);
    applyRaisePriceCard(ls, '台北市');
    expect(JSON.stringify(ls)).toBe(snap);
  });
});

// ============================================================
//  設施分支 —— 基准为原版 exe 反汇编（VA 0x0040b110 等）
// ============================================================

describe('天使卡对設施 —— 首建 / 升級', () => {
  it('0 级空地 → 按 buildType 首建 1 级', () => {
    const r = applyAngelFacilityCard(makeFacility({ type: 0, level: 0 }), 2);
    expect(r.ok).toBe(true);
    expect(r.facility.type).toBe(2); // 購物中心
    expect(r.facility.level).toBe(1);
    expect(r.resultCode).toBe(1);
  });

  it('未给 buildType 时由调用方补 0（公園）—— 这里显式传 0', () => {
    const r = applyAngelFacilityCard(makeFacility({ type: 0, level: 0 }), 0);
    expect(r.facility.type).toBe(0);
    expect(r.facility.level).toBe(1);
  });

  it('未满级 → 升一级', () => {
    const r = applyAngelFacilityCard(makeFacility({ type: 1, level: 2 }), 0);
    expect(r.ok).toBe(true);
    expect(r.facility.level).toBe(3);
    expect(r.resultCode).toBe(1);
  });

  it('★ 升到 5 级时返回 0x81（原版只凭 test al,0x80 放音效）', () => {
    const r = applyAngelFacilityCard(makeFacility({ type: 1, level: 4 }), 0);
    expect(r.ok).toBe(true);
    expect(r.facility.level).toBe(5);
    expect(r.resultCode).toBe(0x81);
  });

  it('★ 满级不动（公園 max=1；原版返回 0）', () => {
    const f = makeFacility({ type: 0, level: 1 });
    const r = applyAngelFacilityCard(f, 3);
    expect(r.ok).toBe(false);
    expect(r.facility).toBe(f); // 同一引用，什么都没改
    expect(r.resultCode).toBe(0);
  });

  it('★ 最高等级按种类查表：加油站 max=1、研究所 max=5', () => {
    expect(applyAngelFacilityCard(makeFacility({ type: 3, level: 1 }), 0).ok).toBe(false);
    expect(applyAngelFacilityCard(makeFacility({ type: 4, level: 1 }), 0).facility.level).toBe(2);
  });
});

describe('惡魔卡对設施 —— 夷平退回公園', () => {
  it('level=0、type=0，归属保留', () => {
    const r = applyDevilFacilityCard(makeFacility({ type: 1, level: 3, owner: 2 }), 1, 0);
    expect(r.ok).toBe(true);
    expect(r.facility.level).toBe(0);
    expect(r.facility.type).toBe(0);
    expect(r.facility.owner).toBe(2);
  });

  it('★ 敌意 = 等级 × 30 × 物价指数（与怪獸同式）', () => {
    const r = applyDevilFacilityCard(makeFacility({ type: 1, level: 3, owner: 2 }), 2, 0);
    expect(r.hostilityDeltas).toEqual([{ from: 1, to: 0, delta: 180 }]);
  });

  it('无主設施不记敌意', () => {
    const r = applyDevilFacilityCard(makeFacility({ type: 1, level: 3, owner: 0 }), 2, 0);
    expect(r.hostilityDeltas).toEqual([]);
  });

  // ★ 2026-09-24 审计订正：设施支无条件直写 level/type = 0 并放住店的人（0x004438c4..0x004438cc）
  it('0 级空地：照写 0、照放住店的人（不走 mutate_land 的「没变」闸）', () => {
    const r = applyDevilFacilityCard(makeFacility({ type: 0, level: 0 }), 1, 0);
    expect(r.ok).toBe(true);
    expect(r.facility.level).toBe(0);
    expect(r.releasesConfined).toBe(true);
  });
});

describe('拆除卡对設施 —— 拆一级', () => {
  it('掉一级，种类保留', () => {
    const r = applyDemolishFacilityCard(makeFacility({ type: 1, level: 3, owner: 2 }), 1);
    expect(r.ok).toBe(true);
    expect(r.facility.level).toBe(2);
    expect(r.facility.type).toBe(1);
  });

  it('★ 拆到 0 级时退回公園（type=0）', () => {
    const r = applyDemolishFacilityCard(makeFacility({ type: 1, level: 1, owner: 2 }), 1);
    expect(r.facility.level).toBe(0);
    expect(r.facility.type).toBe(0);
  });

  it('★ 敌意是平坦 30 × 物价指数（不按等级）', () => {
    const r = applyDemolishFacilityCard(makeFacility({ type: 1, level: 4, owner: 3 }), 2);
    expect(r.hostilityDelta).toBe(60);
    expect(r.victim).toBe(2);
  });

  it('无主設施不记敌意', () => {
    const r = applyDemolishFacilityCard(makeFacility({ type: 1, level: 2, owner: 0 }), 2);
    expect(r.hostilityDelta).toBe(0);
    expect(r.victim).toBe(-1);
  });

  it('0 级空地不生效', () => {
    expect(applyDemolishFacilityCard(makeFacility({ type: 0, level: 0 }), 1).ok).toBe(false);
  });
});
