/*
 * 地块状态变更验证 —— 基准为原版 exe 反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  demolishLand, markLand, markFacility, isSealed, isRaised,
  PRICE_STATUS, DEMOLISH_HOSTILITY_FACTOR,
} from './land-mutation.ts';
import { makeLand, makeFacility } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

describe('拆除', () => {
  it('★ 住宅只掉一级', () => {
    const r = demolishLand(makeLand({ type: LAND_TYPE_HOUSE, level: 4, owner: 2 }), 1);
    expect(r.land.level).toBe(3);
    expect(r.land.type).toBe(LAND_TYPE_HOUSE);
  });

  it('★ 连锁店被整个拆平并退回住宅', () => {
    // @source cmp byte [land+0x18],0 / je 跳过 / level=0 / type=0
    const r = demolishLand(makeLand({ type: 1, level: 1, owner: 2 }), 1);
    expect(r.land.level).toBe(0);
    expect(r.land.type).toBe(LAND_TYPE_HOUSE);
  });

  it('等级为 0 的住宅拆后仍为 0（不为负）', () => {
    expect(demolishLand(makeLand({ level: 0, owner: 2 }), 1).land.level).toBe(0);
  });

  it('敌意 = 物价指数 × 30', () => {
    expect(DEMOLISH_HOSTILITY_FACTOR).toBe(30);
    const r = demolishLand(makeLand({ level: 3, owner: 2 }), 4);
    expect(r.hostilityDelta).toBe(120);
    expect(r.victim).toBe(1); // owner - 1
  });

  it('★ 无主地块不记敌意', () => {
    const r = demolishLand(makeLand({ level: 3, owner: 0 }), 5);
    expect(r.hostilityDelta).toBe(0);
    expect(r.victim).toBe(-1);
  });

  it('不原地修改入参', () => {
    const l = makeLand({ level: 3, owner: 2 });
    demolishLand(l, 1);
    expect(l.level).toBe(3);
  });
});

describe('状态标记', () => {
  it('涨价 = 0x50，查封 = 0x51', () => {
    expect(PRICE_STATUS.RAISED).toBe(0x50);
    expect(PRICE_STATUS.SEALED).toBe(0x51);
  });

  it('给住宅打标记', () => {
    expect(markLand(makeLand(), PRICE_STATUS.RAISED).priceStatus).toBe(0x50);
    expect(markLand(makeLand(), PRICE_STATUS.SEALED).priceStatus).toBe(0x51);
  });

  it('★ 查封设施会额外清一个字段，涨价不会', () => {
    // @source 查封卡 mov byte [fac+0x1c],0x51 / mov byte [fac+0x1e],0
    expect(markFacility(makeFacility(), PRICE_STATUS.SEALED).extraCleared).toBe(true);
    expect(markFacility(makeFacility(), PRICE_STATUS.RAISED).extraCleared).toBe(false);
  });

  it('状态判定', () => {
    expect(isRaised(PRICE_STATUS.RAISED)).toBe(true);
    expect(isSealed(PRICE_STATUS.SEALED)).toBe(true);
    expect(isSealed(PRICE_STATUS.RAISED)).toBe(false);
    expect(isRaised(PRICE_STATUS.NORMAL)).toBe(false);
  });

  it('不原地修改入参', () => {
    const l = makeLand();
    markLand(l, PRICE_STATUS.SEALED);
    expect(l.priceStatus).toBe(0);
  });
});
