/*
 * 銀行 ATM 面板（T-029a）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 exe（面板落 (60,71)、18 颗钮的表 `0x475888`），
 * 这里把「容易写错、且错了很难看出来」的几条钉住：矩形是**面板局部**、
 * 图号 = 序号 + 1、金额从右往左一位一张数字图。
 */
import { describe, expect, it } from 'vitest';
import {
  ATM_BUTTONS,
  ATM_DIGIT,
  ATM_KEYS,
  ATM_FROZEN_AT,
  ATM_FROZEN_MARK,
  ATM_ORIGIN,
  ATM_RESOURCE,
  atmAmount,
  atmButtonCenter,
  atmButtonRect,
  atmLimit,
  atmKeyOf,
  atmPress,
  hitAtmButton,
  type AtmState,
} from './bank-screen.ts';

describe('ATM 面板几何 @source VA 0x4379c9 / 表 0x475888', () => {
  it('★ 面板是资源 24、落 (60,71)', () => {
    expect(ATM_RESOURCE).toBe(24);
    expect(ATM_ORIGIN).toEqual({ x: 60, y: 71 });
  });

  it('★ 18 颗钮的矩形照表 dump（面板局部）', () => {
    expect(ATM_BUTTONS).toHaveLength(18);
    // 存款 / 提款 / EXIT
    expect(ATM_BUTTONS[0]).toEqual({ x0: 57, y0: 49, x1: 137, y1: 90 });
    expect(ATM_BUTTONS[1]).toEqual({ x0: 139, y0: 49, x1: 219, y1: 90 });
    expect(ATM_BUTTONS[2]).toEqual({ x0: 221, y0: 49, x1: 264, y1: 90 });
    // 数字盘 4 行 × 3 列：行距 19、列距 39
    expect(ATM_BUTTONS[4]).toEqual({ x0: 58, y0: 211, x1: 91, y1: 228 });
    expect(ATM_BUTTONS[15]).toEqual({ x0: 136, y0: 268, x1: 169, y1: 285 });
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const b = ATM_BUTTONS[4 + r * 3 + c]!;
        expect(b.x0).toBe(58 + c * 39);
        expect(b.y0).toBe(211 + r * 19);
        expect(b.x1 - b.x0).toBe(33);
        expect(b.y1 - b.y0).toBe(17);
      }
    }
    // MAX / ↵
    expect(ATM_BUTTONS[16]).toEqual({ x0: 183, y0: 233, x1: 232, y1: 258 });
    expect(ATM_BUTTONS[17]).toEqual({ x0: 175, y0: 260, x1: 232, y1: 285 });
  });

  it('★ 金额栏底是序号 3（不是钮）；数字图 = 图 19..28', () => {
    expect(ATM_DIGIT.first).toBe(19);
    expect(ATM_DIGIT.first + 9).toBe(28); // '9'
    expect(ATM_DIGIT.step).toBe(20);
    expect(ATM_DIGIT.x).toBe(304);
    expect(ATM_DIGIT.y).toBe(172);
    expect(ATM_DIGIT.max).toBe(10);
    // 数字盘按下去的 12 个键（照图 5..16 上印的字）
    expect([...ATM_KEYS]).toEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'back']);
  });

  it('★ 命中：每颗钮的中心命中自己，面板外不认', () => {
    for (let i = 0; i < ATM_BUTTONS.length; i++) {
      const c = atmButtonCenter(i);
      expect(hitAtmButton(c.x, c.y)).toBe(i);
    }
    expect(hitAtmButton(50, 60)).toBeNull(); // 面板左上角之外
    expect(hitAtmButton(500, 500)).toBeNull();
  });

  it('★ 「銀行暫停放款」禁止章是图 29，盖在存款钮中心 (157,141)', () => {
    expect(ATM_FROZEN_MARK).toBe(29);
    expect(ATM_FROZEN_AT).toEqual({ x: 157, y: 141 });
    expect(atmButtonCenter(0)).toEqual({ x: 157, y: 141 }); // 存款钮中心 ✓
    expect(atmButtonRect(0)).toEqual({ x: 117, y: 120, w: 81, h: 42 });
  });
});

describe('ATM 的按键逻辑（纯函数）', () => {
  const base: AtmState = { mode: 0, digits: '', limits: [50000, 20000] };

  it('★ 数字一位一位接上去，最多 10 位', () => {
    let st: AtmState = base;
    for (const btn of [4, 5, 6]) st = atmPress(st, btn)!; // 7 8 9
    expect(st.digits).toBe('789');
    for (let i = 0; i < 10; i++) st = atmPress(st, 14)!; // 一直按 '0'
    expect(st.digits).toHaveLength(ATM_DIGIT.max);
  });

  it('★ 前导 0 不攒', () => {
    expect(atmPress(base, 14)!.digits).toBe(''); // 第一个就按 '0'
    expect(atmPress({ ...base, digits: '5' }, 14)!.digits).toBe('50');
  });

  it('★ C 清空、← 退格', () => {
    const st = { ...base, digits: '123' };
    expect(atmPress(st, 13)!.digits).toBe(''); // C
    expect(atmPress(st, 15)!.digits).toBe('12'); // ←
    expect(atmPress(base, 15)!.digits).toBe(''); // 空串退格还是空
  });

  it('★ MAX 把金额填成**当前模式**的上限', () => {
    expect(atmPress(base, 16)!.digits).toBe('50000'); // 存款上限
    expect(atmPress({ ...base, mode: 1 }, 16)!.digits).toBe('20000'); // 提款上限
    expect(atmLimit(base)).toBe(50000);
    expect(atmLimit({ ...base, mode: 1 })).toBe(20000);
  });

  it('★ 模式钮：点当前那件什么都不做；换模式把已键入的清掉', () => {
    const deposit: AtmState = { mode: 0, digits: '99', limits: [50000, 20000] };
    expect(atmPress(deposit, 0)).toEqual(deposit); // 已经是存款 → 原样（连 digits 都留）
    const asWithdraw = atmPress(deposit, 1)!;
    expect(asWithdraw.mode).toBe(1);
    expect(asWithdraw.digits).toBe('');
  });

  it('★ 冻结时点「存款」不认（原版改用当前模式）', () => {
    const withdrawFirst: AtmState = { mode: 1, digits: '', limits: [50000, 20000] };
    expect(atmPress(withdrawFirst, 0, true)).toEqual(withdrawFirst); // 冻结 → 原样
    expect(atmPress(withdrawFirst, 0, false)!.mode).toBe(0); // 没冻结 → 切得过去
  });

  it('★ EXIT 返回 null（关面板）；↵ 不改状态（发 action 是调用方的事）', () => {
    expect(atmPress(base, 2)).toBeNull();
    expect(atmPress({ ...base, digits: '7' }, 17)!.digits).toBe('7');
  });

  it('★ 金额：空串算 0', () => {
    expect(atmAmount(base)).toBe(0);
    expect(atmAmount({ ...base, digits: '12345' })).toBe(12345);
  });

  it('★ 不是数字盘的序号（金额栏底、越界）按下去不变', () => {
    expect(atmKeyOf(3)).toBeNull();
    expect(atmKeyOf(17)).toBeNull();
    expect(atmKeyOf(18)).toBeNull();
    expect(atmPress(base, 3)).toEqual(base);
    expect(atmPress(base, 99)).toEqual(base);
  });
});
