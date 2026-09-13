/*
 * 每月结算验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyMonthlyInterest,
  monthlyScore,
  pickAwardWinner,
  pickRichest,
  settleMonthlyBank,
  AWARD_MARGIN,
  UNLUCKY_DAY_WEIGHT,
  F68_WEIGHT,
} from './monthly.ts';
import type { Player } from '../state/types.ts';
import { WHO_PLAYS_HUMAN } from '../state/types.ts';

function player(over: Partial<Player> = {}): Player {
  return {
    index: 0, character: 0, whoPlays: WHO_PLAYS_HUMAN,
    nodeId: 1, lastNodeId: 0, direction: 0, trafficMethod: 0, ndices: 1,
    cash: 0, moneyInBank: 0, loan: 0, specialFinance: 0, f44: 0, points: 0,
    blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: 0 },
    daysRejectedByBank: 0,
    godInfo: 0, cards: [], tools: new Array<number>(13).fill(0),
    alliedPlayer: 0, alliedDays: 0,
    ...over,
  };
}

describe('存款利息 —— 10%', () => {
  it('基本计算', () => {
    expect(applyMonthlyInterest(1000, 0)).toBe(1100);
    expect(applyMonthlyInterest(150000, 0)).toBe(165000);
    expect(applyMonthlyInterest(3_006_949, 0)).toBe(3_307_643); // Save0.dat 的实际存款
  });

  it('★ 有贷款则不发利息', () => {
    // @source cmp dword [player+36], 0 / jne skip
    expect(applyMonthlyInterest(1000, 1)).toBe(1000);
    expect(applyMonthlyInterest(1_000_000, 50000)).toBe(1_000_000);
  });

  it('零存款仍为零', () => {
    expect(applyMonthlyInterest(0, 0)).toBe(0);
  });

  it('向零取整（而非四舍五入）', () => {
    // 5 * 1.1 = 5.5 → 5
    expect(applyMonthlyInterest(5, 0)).toBe(5);
    // 9 * 1.1 = 9.9 → 9
    expect(applyMonthlyInterest(9, 0)).toBe(9);
    // 1 * 1.1 = 1.1 → 1
    expect(applyMonthlyInterest(1, 0)).toBe(1);
  });

  it('负余额也向零取整', () => {
    expect(applyMonthlyInterest(-1000, 0)).toBe(-1100);
    expect(applyMonthlyInterest(-5, 0)).toBe(-5);
  });

  it('★ BigInt 精确算法与浮点 trunc(x*1.1) 在合理金额区间内完全一致', () => {
    // 验证「用 BigInt 展开 double 常量」这一取巧做法没有引入偏差
    let mismatches = 0;
    const samples: number[] = [];
    for (let v = 0; v < 5000; v++) samples.push(v);
    for (let v = 0; v < 2_000_000_000; v += 7_777_777) samples.push(v);
    for (const v of samples) {
      if (applyMonthlyInterest(v, 0) !== Math.trunc(v * 1.1)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('settleMonthlyBank 不改动无需变化的玩家对象', () => {
    const p = player({ moneyInBank: 1000, loan: 5 });
    expect(settleMonthlyBank(p)).toBe(p); // 同一引用
  });

  it('settleMonthlyBank 返回新对象且原对象不变', () => {
    const p = player({ moneyInBank: 1000 });
    const after = settleMonthlyBank(p);
    expect(after.moneyInBank).toBe(1100);
    expect(p.moneyInBank).toBe(1000);
  });
});

describe('月度奖项评分', () => {
  const acc = (o: Partial<Parameters<typeof monthlyScore>[0]> = {}) => ({
    windfall: 0, unexpectedLoss: 0, f42: 0, f68: 0, ...o,
  });

  it('意外之财减意外损失', () => {
    expect(monthlyScore(acc({ windfall: 50000, unexpectedLoss: 20000 }), 1)).toBe(30000);
  });

  it('f42 按 物价指数 × 2500 折算', () => {
    expect(UNLUCKY_DAY_WEIGHT).toBe(2500);
    expect(monthlyScore(acc({ f42: 3 }), 1)).toBe(3 * 2500);
    expect(monthlyScore(acc({ f42: 3 }), 4)).toBe(3 * 4 * 2500);
  });

  it('f68 权重为 10', () => {
    expect(F68_WEIGHT).toBe(10);
    expect(monthlyScore(acc({ f68: 7 }), 1)).toBe(70);
  });

  it('三项叠加', () => {
    const s = monthlyScore(acc({ windfall: 1000, unexpectedLoss: 400, f42: 2, f68: 5 }), 3);
    expect(s).toBe(1000 - 400 + 2 * 3 * 2500 + 5 * 10);
  });

  it('Save0.dat 的实际数据代入', () => {
    // 该玩家 +0x5C=26000, +0x60=394432
    expect(monthlyScore(acc({ windfall: 26000, unexpectedLoss: 394432 }), 5)).toBe(-368432);
  });
});

describe('pickAwardWinner —— 领先幅度门槛', () => {
  it('门槛为 0.4', () => {
    expect(AWARD_MARGIN).toBe(0.4);
  });

  it('★ 领先不足 40% 则无人获奖', () => {
    // (100 - 70) / 100 = 0.3 <= 0.4
    expect(pickAwardWinner([100, 70])).toBe(-1);
  });

  it('恰好 40% 也不颁奖（须严格大于）', () => {
    // @source jbe → 不颁奖
    expect(pickAwardWinner([100, 60])).toBe(-1);
  });

  it('领先超过 40% 才颁奖', () => {
    // (100 - 59) / 100 = 0.41 > 0.4
    expect(pickAwardWinner([100, 59])).toBe(0);
  });

  it('返回最高分者的下标', () => {
    expect(pickAwardWinner([10, 20, 100, 30])).toBe(2);
  });

  it('最高分为 0 时不颁奖', () => {
    expect(pickAwardWinner([0, 0, 0])).toBe(-1);
    expect(pickAwardWinner([-5, -10])).toBe(-1); // 全为负 → max 保持 0
  });

  it('次高分为 0 时不颁奖', () => {
    expect(pickAwardWinner([100, 0, 0])).toBe(-1);
  });

  it('空候选返回 -1', () => {
    expect(pickAwardWinner([])).toBe(-1);
  });

  it('并列最高时无人获奖（次高被清零后为 0）', () => {
    expect(pickAwardWinner([100, 100])).toBe(-1);
  });
});

describe('pickRichest —— 首富评选', () => {
  it('取总资产最高者，无领先门槛', () => {
    expect(pickRichest([100, 101, 50])).toBe(1); // 仅领先 1 也算
  });

  it('平手取先出现者', () => {
    // @source cmp esi, eax / jge → 不替换
    expect(pickRichest([100, 100])).toBe(0);
  });

  it('全部为 0 或负时返回 0', () => {
    expect(pickRichest([0, 0])).toBe(0);
    expect(pickRichest([-1, -2])).toBe(0);
  });
});
