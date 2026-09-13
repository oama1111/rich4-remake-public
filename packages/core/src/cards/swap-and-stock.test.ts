/*
 * 换地卡 / 红卡 / 黑卡验证 —— 基准为原版 exe 反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applySwapLandCard, applyRedCard, applyBlackCard,
  STOCK_F7_RED, STOCK_F7_BLACK, SWAP_LAND_SELECTION_PARAM,
} from './swap-and-stock.ts';
import { makeLand } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';
import { STOCK_COUNT } from '../rules/wealth.ts';

describe('换地卡', () => {
  const two = () => [
    makeLand({ id: 1, owner: 1, level: 3, name: 'A' }),
    makeLand({ id: 2, owner: 2, level: 0, name: 'B' }),
  ];

  it('选择参数属地块组', () => {
    expect(cardImpl(4)!.selectionParam).toBe(SWAP_LAND_SELECTION_PARAM);
  });

  it('★ 交换两块地的归属', () => {
    const r = applySwapLandCard(two(), 1, 2);
    expect(r.ok).toBe(true);
    expect(r.lands[0]!.owner).toBe(2);
    expect(r.lands[1]!.owner).toBe(1);
  });

  it('★ 只换归属，等级与类型不动（房子随地一起易主）', () => {
    const r = applySwapLandCard(two(), 1, 2);
    expect(r.lands[0]!.level).toBe(3); // 原地块1 的等级留在原地
    expect(r.lands[1]!.level).toBe(0);
    expect(r.lands[0]!.name).toBe('A');
  });

  it('同一块地不可自换', () => {
    expect(applySwapLandCard(two(), 1, 1).ok).toBe(false);
  });

  it('地块不存在时失败', () => {
    expect(applySwapLandCard(two(), 1, 99).ok).toBe(false);
  });

  it('不原地修改入参', () => {
    const ls = two();
    applySwapLandCard(ls, 1, 2);
    expect(ls[0]!.owner).toBe(1);
  });
});

describe('红卡 / 黑卡 —— 操纵股票 f7', () => {
  const f7 = () => new Array<number>(STOCK_COUNT).fill(0);

  it('红卡写 0x20，黑卡写 2', () => {
    expect(STOCK_F7_RED).toBe(0x20);
    expect(STOCK_F7_BLACK).toBe(0x02);
    expect(applyRedCard(f7(), 3).stockF7[3]).toBe(0x20);
    expect(applyBlackCard(f7(), 3).stockF7[3]).toBe(0x02);
  });

  it('只影响指定股票', () => {
    const r = applyRedCard(f7(), 5);
    expect(r.stockF7.filter((v) => v !== 0).length).toBe(1);
    expect(r.affected).toBe(5);
  });

  it('下标越界时不改动', () => {
    expect(applyRedCard(f7(), 99).affected).toBe(-1);
    expect(applyBlackCard(f7(), -1).affected).toBe(-1);
  });

  it('两卡可互相覆盖', () => {
    const red = applyRedCard(f7(), 2);
    const black = applyBlackCard(red.stockF7, 2);
    expect(black.stockF7[2]).toBe(STOCK_F7_BLACK);
  });

  it('不原地修改入参', () => {
    const v = f7();
    applyRedCard(v, 1);
    expect(v[1]).toBe(0);
  });
});
