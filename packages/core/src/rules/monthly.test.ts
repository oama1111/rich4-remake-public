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
  clearMonthlyAccumulators,
  addMisfortuneDays,
  misfortuneDaysAfter,
  settleMonthlyBank,
  AWARD_MARGIN,
  UNLUCKY_DAY_WEIGHT,
  F68_WEIGHT,
} from './monthly.ts';
import { makePlayer } from '../testing/factories.ts';


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
    const p = makePlayer({ moneyInBank: 1000, loan: 5 });
    expect(settleMonthlyBank(p)).toBe(p); // 同一引用
  });

  it('settleMonthlyBank 返回新对象且原对象不变', () => {
    const p = makePlayer({ moneyInBank: 1000 });
    const after = settleMonthlyBank(p);
    expect(after.moneyInBank).toBe(1100);
    expect(p.moneyInBank).toBe(1000);
  });

  // ★ 月结收尾清零（原版 0x00439ec6–0x00439ef3）：
  //   `p+0x42`(totalWinterSleepDays) / `p+0x5c`(monthlyPaid) / `p+0x60`(monthlyReceived) 全部清 0。
  //   不清 ⇒ 月度奖项评分与月结屏的「本月意外之財/損失」自**第 2 个月**起用跨月累计值。
  describe('★ 月结收尾：三项月度累加器清零', () => {
    it('clearMonthlyAccumulators 清零三项', () => {
      const p = makePlayer({ totalWinterSleepDays: 3, monthlyPaid: 12345, monthlyReceived: 6789 });
      const after = clearMonthlyAccumulators(p);
      expect(after.totalWinterSleepDays).toBe(0);
      expect(after.monthlyPaid).toBe(0);
      expect(after.monthlyReceived).toBe(0);
      // 不动别的字段
      expect(after.cash).toBe(p.cash);
      expect(p.monthlyPaid).toBe(12345); // 原对象不变
    });

    it('已经是 0 时返回同一引用（避免无谓重建）', () => {
      const p = makePlayer({ totalWinterSleepDays: 0, monthlyPaid: 0, monthlyReceived: 0 });
      expect(clearMonthlyAccumulators(p)).toBe(p);
    });

    // ★ 本次补（2026-09-18）：累加侧的**唯一入口**。原版全 exe 共 6 处 8 位累加
    //   （0x40d431 消失 / 0x41a83f 住宿 / 0x43d755 监狱 / 0x43ee04 医院 /
    //    0x4441a1 冬眠卡 / 0x444372 夢遊卡），口径都是 `add byte ptr`。
    it('★ addMisfortuneDays 是 8 位加法（原版 `add byte ptr` 会回绕）', () => {
      expect(misfortuneDaysAfter(0, 3)).toBe(3);
      expect(misfortuneDaysAfter(253, 5)).toBe(2);
      expect(addMisfortuneDays(makePlayer({ totalWinterSleepDays: 253 }), 5).totalWinterSleepDays).toBe(2);
    });

    it('0 天不改引用（仍是同一对象）', () => {
      const p = makePlayer({ totalWinterSleepDays: 7 });
      expect(addMisfortuneDays(p, 0)).toBe(p);
    });

    it('★ settleMonthlyBank 同时做利息与清零（同属原版 0x00439bfa）', () => {
      const p = makePlayer({ moneyInBank: 1000, monthlyPaid: 500, monthlyReceived: 900 });
      const after = settleMonthlyBank(p);
      expect(after.moneyInBank).toBe(1100);
      expect(after.monthlyPaid).toBe(0); // ★ 关键：这里以前不清
      expect(after.monthlyReceived).toBe(0);
    });
  });
});

describe('月度奖项评分', () => {
  const acc = (o: Partial<Parameters<typeof monthlyScore>[0]> = {}) => ({
    windfall: 0, unexpectedLoss: 0, f42: 0, f68: 0, ...o,
  });

  it('意外損失減意外之財（「悲情人物」：損失越多分越高）', () => {
    // ★ 字段名与 exe 的 UI 语义对齐（§7.140）：unexpectedLoss = +0x5c、windfall = +0x60
    expect(monthlyScore(acc({ unexpectedLoss: 50000, windfall: 20000 }), 1)).toBe(30000);
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
    const s = monthlyScore(acc({ unexpectedLoss: 1000, windfall: 400, f42: 2, f68: 5 }), 3);
    expect(s).toBe(1000 - 400 + 2 * 3 * 2500 + 5 * 10);
  });

  it('Save0.dat 的实际数据代入', () => {
    // 该玩家 +0x5C=26000（損失）, +0x60=394432（之財）
    expect(monthlyScore(acc({ unexpectedLoss: 26000, windfall: 394432 }), 5)).toBe(-368432);
  });

  // ★★ 通道 2 差分（`rich4-spec/tests/test_monthly_score.py`）：原版全程 32 位，
  //   JS 不回绕会分叉 —— 故 `monthlyScore` 显式 `| 0`。
  it('★★ 32 位回绕照抄（原版 imul/add 只留低 32 位）', () => {
    // +0x5c = 0x7fffffff, +0x60 = −1 ⇒ 原版 −2147483648
    expect(monthlyScore(acc({ unexpectedLoss: 0x7fffffff, windfall: -1 }), 1)).toBe(-2147483648);
    // 天=255、物價=3369 ⇒ 255×3369×2500 = 2147737500 > 2^31 ⇒ 回绕为负
    expect(monthlyScore(acc({ f42: 255 }), 3369)).toBe(-2147229796);
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
