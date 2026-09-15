/*
 * 转向卡 / 换屋卡验证 —— 基准为原版 exe 反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  turnAround, applyTurnCard, applySwapHouseCard, applySwapHouseFacilityCard,
  DIRECTION_COUNT, TURN_AROUND_OFFSET,
} from './turn-and-house.ts';
import { applySwapLandCard } from './swap-and-stock.ts';
import { makePlayer, makeLand, makeFacility } from '../testing/factories.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, direction: 1 }));

describe('转向卡', () => {
  it('★ 方向 = (原方向 + 4) & 7，即掉头', () => {
    expect(DIRECTION_COUNT).toBe(8);
    expect(TURN_AROUND_OFFSET).toBe(4);
    expect(turnAround(0)).toBe(4);
    expect(turnAround(1)).toBe(5);
    expect(turnAround(4)).toBe(0);
    expect(turnAround(7)).toBe(3);
  });

  it('掉头两次回到原方向', () => {
    for (let d = 0; d < 8; d++) expect(turnAround(turnAround(d))).toBe(d);
  });

  it('让目标掉头', () => {
    const r = applyTurnCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.ok).toBe(true);
    expect(r.players[2]!.direction).toBe(5);
    expect(r.players[1]!.direction).toBe(1); // 其他人不变
  });

  it('★ 可以对自己使用（anyPlayer 组）', () => {
    const r = applyTurnCard(four(), 1, { kind: 'player', index: 1 });
    expect(r.ok).toBe(true);
    expect(r.players[1]!.direction).toBe(5);
  });

  it('目标缺失/越界时失败', () => {
    expect(applyTurnCard(four(), 0, { kind: 'none' }).error).toBe('targetRequired');
    expect(applyTurnCard(four(), 0, { kind: 'player', index: 9 }).error).toBe('playerOutOfRange');
  });
});

describe('换屋卡', () => {
  const two = () => [
    makeLand({ id: 1, owner: 1, level: 4 }),
    makeLand({ id: 2, owner: 2, level: 1 }),
  ];

  it('★ 交换的是房子（等级），归属不变', () => {
    const r = applySwapHouseCard(two(), 1, 2);
    expect(r.ok).toBe(true);
    expect(r.lands[0]!.level).toBe(1);
    expect(r.lands[1]!.level).toBe(4);
    // 归属不动
    expect(r.lands[0]!.owner).toBe(1);
    expect(r.lands[1]!.owner).toBe(2);
  });

  it('★ 与换地卡的区别：换地换归属、换屋换房子', () => {
    const land = two();
    const house = applySwapHouseCard(land, 1, 2);
    const swap = applySwapLandCard(land, 1, 2);
    // 换屋：等级互换、归属不变
    expect(house.lands[0]!.level).toBe(1);
    expect(house.lands[0]!.owner).toBe(1);
    // 换地：归属互换、等级不变
    expect(swap.lands[0]!.owner).toBe(2);
    expect(swap.lands[0]!.level).toBe(4);
  });

  it('同一块地不可自换；地块不存在时失败', () => {
    expect(applySwapHouseCard(two(), 1, 1).ok).toBe(false);
    expect(applySwapHouseCard(two(), 1, 99).ok).toBe(false);
  });

  it('★ 种类（+0x18）也跟着换：住宅 ↔ 连锁店', () => {
    // @source 助手 0x40b4f8 尾部（地块分支 0x0040b6c5）：+0x18 与 +0x1a 一起互换
    const ls = [
      makeLand({ id: 1, owner: 1, level: 4, type: 0 }),
      makeLand({ id: 2, owner: 2, level: 0, type: 1 }),
    ];
    const r = applySwapHouseCard(ls, 1, 2);
    expect(r.lands[0]).toMatchObject({ type: 1, level: 0 });
    expect(r.lands[1]).toMatchObject({ type: 0, level: 4 });
  });

  it('不原地修改入参', () => {
    const ls = two();
    applySwapHouseCard(ls, 1, 2);
    expect(ls[0]!.level).toBe(4);
  });
});

describe('换屋卡 · 設施分支（脚下是設施时原版换 0xe0c0204）', () => {
  const twoFac = () => [
    makeFacility({ id: 1, owner: 1, level: 1, type: 3 }),
    makeFacility({ id: 2, owner: 2, level: 4, type: 1 }),
  ];

  it('★ 换的是种类 + 等级，归属不动', () => {
    // @source 助手 0x40b4f8 設施分支 VA 0x0040b880
    const r = applySwapHouseFacilityCard(twoFac(), 1, 2);
    expect(r.ok).toBe(true);
    expect(r.facilities[0]).toMatchObject({ type: 1, level: 4, owner: 1 });
    expect(r.facilities[1]).toMatchObject({ type: 3, level: 1, owner: 2 });
  });

  it('同一座設施不可自换；不存在时失败', () => {
    expect(applySwapHouseFacilityCard(twoFac(), 1, 1).ok).toBe(false);
    expect(applySwapHouseFacilityCard(twoFac(), 1, 99).ok).toBe(false);
  });

  it('不原地修改入参', () => {
    const fs = twoFac();
    applySwapHouseFacilityCard(fs, 1, 2);
    expect(fs[0]!.level).toBe(1);
  });
});
