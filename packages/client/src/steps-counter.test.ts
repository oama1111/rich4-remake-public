/*
 * 走子剩余步数的大数字 —— 单测（W-66-a）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 四条边都要钉，因为它们各自对应原版那几条 `cmp`：
 *   ① `stepsCounterValue` 的「补回早减的那一格」（本引擎特有的折叠）；
 *   ② `stepsCounterShown` 的四道闸（值 > 0 / `whoPlays & 0x30` / 关押四项）；
 *   ③ `stepsCounterPlan` 的位数 → x（245 − 25×位数 + 50×k）与图号（8 + 数字）；
 *   ④ 反证：**不许**拿 `phase` 当条件（最后一格补间时相位已是 `settling`）。
 */
import { describe, expect, it } from 'vitest';
import {
  STEPS_COUNTER_ARCHIVE,
  STEPS_COUNTER_CENTER_X,
  STEPS_COUNTER_RESOURCE,
  STEPS_COUNTER_Y,
  STEPS_DIGIT_BASE_IMAGE,
  STEPS_DIGIT_STEP,
  type StepsCounterPlayer,
  stepsCounterPlan,
  stepsCounterShown,
  stepsCounterValue,
} from './steps-counter.ts';

const free = (over: Partial<StepsCounterPlayer> = {}): StepsCounterPlayer => ({
  whoPlays: 1,
  blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0 },
  ...over,
});

describe('★ W-66-a 剩余步数的取值', () => {
  it('★ 补间中 ⇒ 把本引擎早减的那一格补回来', () => {
    expect(stepsCounterValue(3, true)).toBe(4);
    expect(stepsCounterValue(3, false)).toBe(3);
    expect(stepsCounterValue(0, true)).toBe(1); // 最后一格补间：显示 1
    expect(stepsCounterValue(0, false)).toBe(0); // 走完 ⇒ 0 ⇒ 消失
  });

  it('★ 反证：不补的话最后一格会显示 0（数字提前消失）', () => {
    expect(stepsCounterValue(0, false)).toBe(0);
    expect(stepsCounterValue(0, true)).not.toBe(0);
  });
});

describe('★ W-66-a 什么时候画（原版四道闸 @source 0x00409937..0x00409971）', () => {
  it('★ 值 > 0 且没什么挡着 ⇒ 画', () => {
    expect(stepsCounterShown(1, free())).toBe(true);
    expect(stepsCounterShown(18, free())).toBe(true);
  });

  it('★ 值 ≤ 0 ⇒ 不画', () => {
    expect(stepsCounterShown(0, free())).toBe(false);
    expect(stepsCounterShown(-1, free())).toBe(false);
  });

  it('★ `whoPlays & 0x30`（走回棋盘 / 被挪过）非 0 ⇒ 不画', () => {
    expect(stepsCounterShown(3, free({ whoPlays: 0x10 }))).toBe(false);
    expect(stepsCounterShown(3, free({ whoPlays: 0x20 }))).toBe(false);
    expect(stepsCounterShown(3, free({ whoPlays: 0x31 }))).toBe(false);
    // 反证：`& 0x0f` 那几位（真人/电脑/托管）**不算**挡
    for (const whoPlays of [1, 2, 4, 8, 5]) {
      expect(stepsCounterShown(3, free({ whoPlays })), `whoPlays=${whoPlays}`).toBe(true);
    }
  });

  it('★ 住宿 / 消失 / 坐牢 / 住院 任一非 0 ⇒ 不画', () => {
    for (const key of ['inHotel', 'disappearing', 'inPrison', 'inHospital'] as const) {
      const p = free();
      expect(
        stepsCounterShown(3, { ...p, blocking: { ...p.blocking, [key]: 1 } }),
        key,
      ).toBe(false);
    }
  });

  it('★★ 这一条**不看 `phase`** —— 最后一格补间时相位已经是 `settling`', () => {
    // 判据里根本没有 phase 这个入参；这里把「能给的东西都摆成正常」再确认一次
    expect(stepsCounterShown(1, free())).toBe(true);
    // 反证：若实现里加了 `phase === 'moving'` 这类条件，上面那条就会变 false ——
    //   本文件的 `StepsCounterPlayer` 结构里没有 phase 字段，编译期就挡住了。
  });
});

describe('★ W-66-a 数字贴在哪（位数 → x、字符 → 图号）', () => {
  it('★ 图号 = `8 + 数字`（`Data.mkf #0x205` 图 8..17）', () => {
    expect(STEPS_COUNTER_ARCHIVE).toBe('Data.mkf');
    expect(STEPS_COUNTER_RESOURCE).toBe(0x205);
    expect(STEPS_DIGIT_BASE_IMAGE).toBe(8);
    expect(STEPS_COUNTER_Y).toBe(400); // 屏幕 y
    expect(stepsCounterPlan(7).map((d) => d.image)).toEqual([15]);
    expect(stepsCounterPlan(30).map((d) => d.image)).toEqual([11, 8]); // '3' → 11、'0' → 8
    expect(stepsCounterPlan(9).map((d) => d.image)).toEqual([17]); // 上界正好是 17
  });

  it('★ 1 位 ⇒ x = 220；2 位 ⇒ 195 / 245；3 位 ⇒ 170 / 220 / 270', () => {
    expect(STEPS_COUNTER_CENTER_X).toBe(245);
    expect(STEPS_DIGIT_STEP).toBe(50);
    expect(stepsCounterPlan(5).map((d) => d.x)).toEqual([220]);
    expect(stepsCounterPlan(18).map((d) => d.x)).toEqual([195, 245]);
    expect(stepsCounterPlan(123).map((d) => d.x)).toEqual([170, 220, 270]);
  });

  it('★ 整串以 245 为中心：`首位 x + 位数 × 50 / 2 === 245`', () => {
    // 每一位的 x 是**那一格 50 宽的左缘**（不是格心）——
    //   所以「整串居中」的式子是首位左缘 + 半个总宽，不是首尾两点的中点
    //   （1 位时 220 + 25 = 245 ✓；2 位 195 + 50 = 245 ✓；3 位 170 + 75 = 245 ✓）。
    for (const v of [1, 5, 12, 99, 123, 1234]) {
      const xs = stepsCounterPlan(v).map((d) => d.x);
      expect(xs[0]! + (xs.length * STEPS_DIGIT_STEP) / 2, String(v)).toBe(
        STEPS_COUNTER_CENTER_X,
      );
    }
  });

  it('★ 每一位的 y 都是 400；0 / 负数 ⇒ 空表（什么都不画）', () => {
    expect(stepsCounterPlan(42).every((d) => d.y === 400)).toBe(true);
    expect(stepsCounterPlan(0)).toEqual([]);
    expect(stepsCounterPlan(-3)).toEqual([]);
  });
});
