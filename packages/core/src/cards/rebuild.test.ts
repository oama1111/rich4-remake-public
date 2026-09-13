/*
 * 改建卡验证 —— 基准为原版 exe 反汇编（VA 0x0044309b）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyRebuildCard, CHAIN_STORE_MAX_LEVEL } from './rebuild.ts';
import { makeLand } from '../testing/factories.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';

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
    // 4000+ = 设施（另有分支，尚未实现）
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
