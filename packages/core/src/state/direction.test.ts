/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * `directionOf` —— 原版 `0x00454fb4` 的逐位复刻（通道 2：`rich4-spec/tests/test_walk_step.py` §A）。
 *
 * 真值表来自**跑原版代码**，不是我推的：`0x454fb4(dx, dy)` 用 Unicorn 直接调用，
 * 8 个主方向 + 45° 扇区边界 + 零位移逐个采样。
 */

import { describe, expect, it } from 'vitest';
import { DIRECTION_REMAP, directionOf } from './reduce.ts';

const deg = (d: number, r = 1000): [number, number] => [
  Math.round(r * Math.cos((d * Math.PI) / 180)),
  Math.round(r * Math.sin((d * Math.PI) / 180)),
];

describe('directionOf —— 原版 0x454fb4 的真值表', () => {
  it('屏幕坐标（y 向下）的 8 个主方向：0=下 1=右下 2=右 3=右上 4=上 5=左上 6=左 7=左下', () => {
    expect(directionOf(100, 0)).toBe(2);
    expect(directionOf(100, 100)).toBe(1);
    expect(directionOf(0, 100)).toBe(0);
    expect(directionOf(-100, 100)).toBe(7);
    expect(directionOf(-100, 0)).toBe(6);
    expect(directionOf(-100, -100)).toBe(5);
    expect(directionOf(0, -100)).toBe(4);
    expect(directionOf(100, -100)).toBe(3);
  });

  it('按**角度**量化，与长度无关', () => {
    expect(directionOf(200, 10)).toBe(2); // 2.9°，仍在「右」
    expect(directionOf(200, 90)).toBe(1); // 24.2° → 「右下」
    expect(directionOf(90, 200)).toBe(1); // 65.8° 还是「右下」
    expect(directionOf(40, 200)).toBe(0); // 78.7° → 「下」
  });

  it('扇区宽 45°，边界在 22.5° + 45°k 上', () => {
    for (const [d, want] of [
      [22.4, 2], [22.6, 1], [67.4, 1], [67.6, 0], [112.4, 0], [112.6, 7],
      [157.4, 7], [157.6, 6], [202.4, 6], [202.6, 5], [247.4, 5], [247.6, 4],
      [292.4, 4], [292.6, 3], [337.4, 3], [337.6, 2],
    ] as const) {
      const [dx, dy] = deg(d);
      expect(directionOf(dx, dy), `${d}°`).toBe(want);
    }
  });

  it('★★ 零位移**没有特例**：内层 atan2 提前返回后照样查表 ⇒ 2（不是 0）', () => {
    // @source 0x00454fe5 `je 0x45502b`（内层 ret，ax = 0）之后，外层
    //   0x00454fc8 `shr ax,0xc` / `inc ax` / `shr ax,1` / `and eax,7` → 0
    //   0x00454fd4 `movzx eax, byte [eax + 0x482414]` ⇒ 2
    expect(directionOf(0, 0)).toBe(2);
  });

  it('DIRECTION_REMAP 就是 .data 里 0x482414 的 8 个字节', () => {
    expect([...DIRECTION_REMAP]).toEqual([2, 3, 4, 5, 6, 7, 0, 1]);
  });
});
