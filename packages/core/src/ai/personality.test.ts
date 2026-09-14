/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 角色表那四个「语义未确认」的字段
 */

import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '@rich4/data';
import {
  AI_USES_CARDS,
  AI_USES_TOOLS,
  aiCanUseCards,
  aiCanUseTools,
  autoLoanAmount,
  stockBudget,
  traitsOf,
} from './personality.ts';

describe('f22：AI 能力位', () => {
  it('★ 12 个角色全是 3 —— 它是「AI 设置」的开关，不是角色差异', () => {
    for (const c of CHARACTERS) {
      expect(c.f22, c.name).toBe(AI_USES_CARDS | AI_USES_TOOLS);
    }
  });

  it('两位各管一件事', () => {
    expect(aiCanUseCards(1)).toBe(true);
    expect(aiCanUseTools(1)).toBe(false);
    expect(aiCanUseCards(2)).toBe(false);
    expect(aiCanUseTools(2)).toBe(true);
    expect(aiCanUseCards(0)).toBe(false);
    expect(aiCanUseTools(0)).toBe(false);
  });
});

describe('f24：借贷激进度', () => {
  it('借身家的百分之几，向零取整', () => {
    expect(autoLoanAmount(1_000_000, 60)).toBe(600_000);
    expect(autoLoanAmount(1_000_001, 30)).toBe(300_000); // trunc
    expect(autoLoanAmount(1_000_000, 100)).toBe(1_000_000);
  });

  it('★ 0 表示一辈子不借 —— 忍太郎、糖糖、烏咪', () => {
    expect(autoLoanAmount(9_999_999, 0)).toBe(0);
    const never = CHARACTERS.filter((c) => c.f24 === 0).map((c) => c.name);
    expect(never).toEqual(['忍太郎', '糖糖', '烏咪']);
  });

  it('★ 三个一进银行就押满身家的', () => {
    const maxed = CHARACTERS.filter((c) => c.f24 === 100).map((c) => c.name);
    expect(maxed).toEqual(['沙隆巴斯', '錢夫人', '宮本寶藏']);
  });

  it('身家为负或零时借不出来', () => {
    expect(autoLoanAmount(0, 100)).toBe(0);
    expect(autoLoanAmount(-5000, 100)).toBe(0);
  });
});

describe('f26：炒股比例', () => {
  it('目标是「可动用总额 × 比例」，减掉已有持仓', () => {
    // 持仓 100、现金 300、存款 600 → 池子 1000，目标 30% = 300，还差 200
    expect(stockBudget(100, 300, 600, 30)).toBe(200);
  });

  it('★ 封顶在**存款** —— 股票是从存款付的', () => {
    // 目标很高，但存款只有 50
    expect(stockBudget(0, 100_000, 50, 90)).toBe(50);
  });

  it('已经买够了就不再买', () => {
    expect(stockBudget(900, 50, 50, 30)).toBe(0);
  });

  it('★ 0 表示从不碰股票 —— 忍太郎、孫小美、金貝貝', () => {
    expect(stockBudget(0, 1_000_000, 1_000_000, 0)).toBe(0);
    const never = CHARACTERS.filter((c) => c.f26 === 0).map((c) => c.name);
    expect(never).toEqual(['忍太郎', '孫小美', '金貝貝']);
  });
});

describe('从角色表取默认值', () => {
  it('約翰喬：会用卡与道具、只放犯人、借 60%、炒股 30%', () => {
    expect(traitsOf(0)).toEqual({ aiFlags: 3, bailStyle: 2, loanRatio: 60, stockRatio: 30 });
  });

  it('★ 忍太郎是最保守的一个：不借钱、不炒股', () => {
    const t = traitsOf(2);
    expect(t.loanRatio).toBe(0);
    expect(t.stockRatio).toBe(0);
  });

  it('越界的角色编号退回一套安全默认值', () => {
    expect(traitsOf(99)).toEqual({ aiFlags: 3, bailStyle: 0, loanRatio: 0, stockRatio: 0 });
  });

  it('★ 12 个角色的四元组不是全都一样 —— 性格确实有区分度', () => {
    const shapes = new Set(
      CHARACTERS.map((c) => `${c.f22}/${c.f23}/${c.f24}/${c.f26}/${c.initCashRatio}`),
    );
    expect(shapes.size).toBeGreaterThanOrEqual(10);
  });
});
