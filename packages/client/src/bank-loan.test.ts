/*
 * 銀行貸款屏（T-029b）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标照 exe（表 `0x4757f8`），门槛照那四支处理函数（`loc_00435c12` 起的跳表）。
 */
import { describe, expect, it } from 'vitest';
import {
  LOAN_BLIND_WINDOW,
  LOAN_BUTTONS,
  LOAN_EXIT,
  LOAN_FINANCE,
  LOAN_FROZEN_MARK,
  LOAN_PRIMARY,
  LOAN_RESOURCE,
  LOAN_ROOM,
  LOAN_SECONDARY,
  hitLoanButton,
  loanActionOf,
} from './bank-loan.ts';

describe('貸款屏几何 @source VA 0x436668 / 表 0x4757f8', () => {
  it('★ 底图是资源 23；两张房间 0 / 2；窗口那张是图 1', () => {
    expect(LOAN_RESOURCE).toBe(23);
    expect(LOAN_ROOM).toEqual({ normal: 0, chairman: 2 });
    expect(LOAN_BLIND_WINDOW).toEqual({ image: 1, x: 320, y: 240 });
    // 「申請貸款」的禁止章 = 图 23，落 (345,345)
    expect(LOAN_FROZEN_MARK).toEqual({ image: 23, x: 345, y: 345 });
  });

  it('★ 四颗钮的矩形照表 dump', () => {
    expect(LOAN_BUTTONS).toHaveLength(4);
    expect(LOAN_BUTTONS[LOAN_EXIT]).toEqual({ x0: 548, y0: 431, x1: 628, y1: 471 });
    expect(LOAN_BUTTONS[LOAN_PRIMARY]).toEqual({ x0: 282, y0: 324, x1: 408, y1: 366 });
    expect(LOAN_BUTTONS[LOAN_SECONDARY]).toEqual({ x0: 470, y0: 326, x1: 590, y1: 366 });
    // 窗口那颗最大 —— 所以命中要**最后**判它
    expect(LOAN_BUTTONS[LOAN_FINANCE]).toEqual({ x0: 268, y0: 51, x1: 591, y1: 273 });
  });

  it('★ 命中：四颗各中自己；两颗白单子与窗口不打架', () => {
    for (let i = 0; i < LOAN_BUTTONS.length; i++) {
      const b = LOAN_BUTTONS[i]!;
      expect(hitLoanButton(Math.floor((b.x0 + b.x1) / 2), Math.floor((b.y0 + b.y1) / 2))).toBe(i);
    }
    // 白单子在窗口那颗的**下面**（y 324/326 > 273）→ 不会被窗口抢走
    expect(hitLoanButton(345, 345)).toBe(LOAN_PRIMARY);
    expect(hitLoanButton(530, 345)).toBe(LOAN_SECONDARY);
    // 窗口本体
    expect(hitLoanButton(400, 150)).toBe(LOAN_FINANCE);
    expect(hitLoanButton(100, 150)).toBeNull(); // 窗外（店员那一侧）
  });
});

describe('四颗钮这一刻是什么意思 @source loc_00435c12 起的跳表', () => {
  it('★ 常态：申請貸款 / 償還貸款；董事長：週轉現金 / 歸還款項', () => {
    expect(loanActionOf(LOAN_PRIMARY, false, false, false)).toBe('borrow');
    expect(loanActionOf(LOAN_SECONDARY, false, false, true)).toBe('repay');
    expect(loanActionOf(LOAN_PRIMARY, true, false, false)).toBe('financeBorrow');
    expect(loanActionOf(LOAN_SECONDARY, true, false, true)).toBe('financeRepay');
  });

  it('★ 凍結时申請貸款不理（原版同时盖禁止章）', () => {
    expect(loanActionOf(LOAN_PRIMARY, false, true, false)).toBeNull();
    expect(loanActionOf(LOAN_PRIMARY, true, true, false)).toBeNull();
    // 償還不受凍結影响
    expect(loanActionOf(LOAN_SECONDARY, false, true, true)).toBe('repay');
  });

  it('★ 没欠款时償還不理', () => {
    expect(loanActionOf(LOAN_SECONDARY, false, false, false)).toBeNull();
    expect(loanActionOf(LOAN_SECONDARY, true, false, false)).toBeNull();
  });

  it('★ 窗口那颗只有董事長认', () => {
    expect(loanActionOf(LOAN_FINANCE, true, false, false)).toBe('financeBorrow');
    expect(loanActionOf(LOAN_FINANCE, false, false, false)).toBeNull();
  });

  it('★ EXIT 永远认；越界不认', () => {
    expect(loanActionOf(LOAN_EXIT, false, true, false)).toBe('exit');
    expect(loanActionOf(99, true, false, true)).toBeNull();
  });
});
