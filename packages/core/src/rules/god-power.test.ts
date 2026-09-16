/*
 * 神明附身那一刻的「發威」—— 跳表 ref_0040ea9b 的语义与金额公式
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 判据全部回 exe（VA 见 `god-power.ts` 的文件头）：
 *   ① 四种金額型（1/2/5/6）取满 **4** 次 `rand()%10`，拼成四位/三位数；
 *   ② 福神/衰神/死神**不取随机数**（原版那扇窗根本没开）；
 *   ③ 每个种类的發威种类与 VA 一一对应。
 */
import { describe, expect, it } from 'vitest';
import { WatcomRng } from '../rng/watcom.ts';
import {
  GOD_ANGEL,
  GOD_BIG_LUCK,
  GOD_BIG_MISFORTUNE,
  GOD_BIG_POVERTY,
  GOD_BIG_WEALTH,
  GOD_DEVIL,
  GOD_EARTH,
  GOD_POWER_DIGITS,
  GOD_REAPER,
  GOD_SMALL_LUCK,
  GOD_SMALL_MISFORTUNE,
  GOD_SMALL_POVERTY,
  GOD_SMALL_WEALTH,
  godPowerHasEffect,
  godPowerOf,
  rollGodAmounts,
} from './god-power.ts';

describe('★ 金額：四個數字拼成四位/三位數 @source 0x0040f2d7 + 0x0043f66x', () => {
  it('取滿 4 次 rand()%10，順序 = [0x48c504]→[0x48c507]', () => {
    expect(GOD_POWER_DIGITS).toBe(4);
    const probe = new WatcomRng(7);
    const digits = [0, 1, 2, 3].map(() => probe.below(10));

    const rng = new WatcomRng(7);
    const out = rollGodAmounts(rng);
    const [d4, d5, d6, d7] = digits as [number, number, number, number];
    expect(out.four).toBe(d4 * 1000 + d5 * 100 + d6 * 10 + d7);
    expect(out.three).toBe(d5 * 100 + d6 * 10 + d7);
    // 随机数消耗必须与「取四个数字」完全一致
    expect(rng.getState()).toBe(probe.getState());
  });

  it('同一个种子答案固定（C-DET-1）', () => {
    expect(rollGodAmounts(new WatcomRng(1))).toEqual(rollGodAmounts(new WatcomRng(1)));
    expect(rollGodAmounts(new WatcomRng(1))).not.toEqual(rollGodAmounts(new WatcomRng(2)));
  });

  it('四位 ≤ 9999、三位 ≤ 999（原版：只有小財神加千位那一項）', () => {
    for (const seed of [1, 7, 99, 12345, 987654321]) {
      const a = rollGodAmounts(new WatcomRng(seed));
      expect(a.four).toBeGreaterThanOrEqual(0);
      expect(a.four).toBeLessThanOrEqual(9999);
      expect(a.three).toBeGreaterThanOrEqual(0);
      expect(a.three).toBeLessThanOrEqual(999);
      // 三位數就是四位數的後三位
      expect(a.three).toBe(a.four % 1000);
    }
  });
});

describe('★ 每個神明的發威 @source 各函数', () => {
  const at = (type: number, seed = 7) => godPowerOf(type, new WatcomRng(seed));

  it('1 小財神 → 每個對手付給附身者，金額取四位', () => {
    const p = at(GOD_SMALL_WEALTH);
    expect(p.kind).toBe('collectFromOpponents');
    expect((p as { amount: number }).amount).toBe(rollGodAmounts(new WatcomRng(7)).four);
  });

  it('2 大財神 → 附身者進帳，金額取三位', () => {
    const p = at(GOD_BIG_WEALTH);
    expect(p.kind).toBe('gain');
    expect((p as { amount: number }).amount).toBe(rollGodAmounts(new WatcomRng(7)).three);
  });

  it('5 小窮神 / 6 大窮神 → 付款，金額三位', () => {
    expect(at(GOD_SMALL_POVERTY)).toEqual({
      kind: 'payOpponents',
      amount: rollGodAmounts(new WatcomRng(7)).three,
    });
    expect(at(GOD_BIG_POVERTY)).toEqual({
      kind: 'payBank',
      amount: rollGodAmounts(new WatcomRng(7)).three,
    });
  });

  it('3/4 福神 → 得一張 / 兩張卡 @source 0x0040ede7 / 0x0040eea8', () => {
    expect(at(GOD_SMALL_LUCK)).toEqual({ kind: 'receiveCards', count: 1 });
    expect(at(GOD_BIG_LUCK)).toEqual({ kind: 'receiveCards', count: 2 });
  });

  it('7 小衰神 → 丢一张；8 大衰神 → 丢一半 @source 0x0040f10c / 0x0040f1de', () => {
    expect(at(GOD_SMALL_MISFORTUNE)).toEqual({ kind: 'dropCards', mode: 'one' });
    expect(at(GOD_BIG_MISFORTUNE)).toEqual({ kind: 'dropCards', mode: 'half' });
  });

  it('15 死神 → 賣光道具與卡片 @source 0x0040f2eb', () => {
    expect(at(GOD_REAPER)).toEqual({ kind: 'sellEverything' });
  });

  it('9/10/12 → 只演出（状态不动）；11/13/14 不附身 → none', () => {
    for (const type of [GOD_ANGEL, GOD_DEVIL, GOD_EARTH, 11, 13, 14]) {
      expect(at(type)).toEqual({ kind: 'none' });
      expect(godPowerHasEffect(at(type))).toBe(false);
    }
  });

  it('★ 只有金額型消耗隨機數（其餘一個都不取）', () => {
    const seedState = new WatcomRng(7).getState();
    for (const type of [GOD_SMALL_WEALTH, GOD_BIG_WEALTH, GOD_SMALL_POVERTY, GOD_BIG_POVERTY]) {
      const rng = new WatcomRng(7);
      godPowerOf(type, rng);
      expect(rng.getState(), `種類 ${type} 應該取 4 個數字`).not.toBe(seedState);
    }
    for (const type of [
      GOD_SMALL_LUCK, GOD_BIG_LUCK, GOD_SMALL_MISFORTUNE, GOD_BIG_MISFORTUNE,
      GOD_ANGEL, GOD_DEVIL, GOD_EARTH, GOD_REAPER, 11, 13, 14,
    ]) {
      const rng = new WatcomRng(7);
      godPowerOf(type, rng);
      expect(rng.getState(), `種類 ${type} 不該消耗隨機數`).toBe(seedState);
    }
  });

  it('有發威的神明（會被表現層畫氣泡的那幾種）', () => {
    const withEffect = [1, 2, 3, 4, 5, 6, 7, 8, 15];
    for (const type of withEffect) expect(godPowerHasEffect(at(type))).toBe(true);
  });
});
