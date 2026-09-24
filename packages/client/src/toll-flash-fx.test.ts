/*
 * 過路費閃爍的節拍（W-69）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 表與毫秒數全部照 `fcn_00451985`（VA 0x00451985）：
 * 16 幀 × 30 ms，亮度表 `0x476380`，之後靜 400 ms。
 */

import { describe, expect, it } from 'vitest';
import {
  TOLL_FLASH_FRAME_MS,
  TOLL_FLASH_FRAMES,
  TOLL_FLASH_FULL_SCALE,
  TOLL_FLASH_HOLD_MS,
  TOLL_FLASH_LEVELS,
  TOLL_FLASH_TOTAL_MS,
  tollFlashGain,
  tollFlashLevel,
} from './toll-flash-fx.ts';

describe('亮度表與節拍常數 @source fcn_00451985 / 表 0x476380', () => {
  it('★ 16 幀、每幀 30 ms、之後靜 400 ms', () => {
    expect(TOLL_FLASH_FRAMES).toBe(16);
    expect(TOLL_FLASH_FRAME_MS).toBe(0x1e);
    expect(TOLL_FLASH_HOLD_MS).toBe(0x190);
    expect(TOLL_FLASH_TOTAL_MS).toBe(16 * 30 + 400);
  });

  it('★ 亮度表逐項照抄（int8，單位 = 5 位色分量）', () => {
    expect(TOLL_FLASH_LEVELS).toEqual([
      4, 8, 12, 16, 12, 8, 4, 0, -4, -8, -12, -16, -12, -8, -4, 0,
    ]);
    // 兩端都是 0（起點、以及「負半程走回 0」）
    expect(TOLL_FLASH_LEVELS[7]).toBe(0);
    expect(TOLL_FLASH_LEVELS[15]).toBe(0);
    // 峰值 ±16 = 半程（滿量程 31）
    expect(Math.max(...TOLL_FLASH_LEVELS)).toBe(16);
    expect(TOLL_FLASH_FULL_SCALE).toBe(32);
  });
});

describe('tollFlashLevel —— 第 k 幀取表、400 ms 靜止、之後 null', () => {
  it('★ 表上那幾點（首席排的驗收值）', () => {
    // k = 0 → 4
    expect(tollFlashLevel(0)).toBe(4);
    // k = 3（90 ms）→ 16（正峰值）
    expect(tollFlashLevel(90)).toBe(16);
    // k = 7（210 ms）→ 0
    expect(tollFlashLevel(210)).toBe(0);
    // k = 11（330 ms）→ −16（負峰值）
    expect(tollFlashLevel(330)).toBe(-16);
    // k = 15（479 ms，最後一幀）→ 0
    expect(tollFlashLevel(479)).toBe(0);
  });

  it('★ 幀邊界左閉右開（每一幀正好 30 ms）', () => {
    for (let k = 0; k < TOLL_FLASH_FRAMES; k++) {
      expect(tollFlashLevel(k * 30), `第 ${k} 幀的頭`).toBe(TOLL_FLASH_LEVELS[k]);
      expect(tollFlashLevel(k * 30 + 29), `第 ${k} 幀的尾`).toBe(TOLL_FLASH_LEVELS[k]);
    }
    // 第 16 幀起是那段 400 ms 的靜止 —— 一律 0
    expect(tollFlashLevel(16 * 30)).toBe(0);
    expect(tollFlashLevel(450)).toBe(0);
    expect(tollFlashLevel(480)).toBe(0);
    expect(tollFlashLevel(879)).toBe(0);
  });

  it('★ 880 ms 起整段演完 → null（呼叫端收攤）', () => {
    expect(tollFlashLevel(TOLL_FLASH_TOTAL_MS)).toBeNull();
    expect(tollFlashLevel(TOLL_FLASH_TOTAL_MS + 1)).toBeNull();
    expect(tollFlashLevel(100000)).toBeNull();
  });

  it('負的 elapsed（時鐘回撥 / 首幀）按第 0 幀算，不返回 null', () => {
    expect(tollFlashLevel(-1)).toBe(4);
    expect(tollFlashLevel(-1000)).toBe(4);
  });
});

describe('tollFlashGain —— 疊層的亮度增益（`brightness(1 + a)` 的 a）', () => {
  it('★ 正峰值 → +0.5（亮 1.5 倍）；負峰值 → −0.5（暗 0.5 倍）', () => {
    expect(tollFlashGain(90)).toBe(16 / 32);
    expect(tollFlashGain(330)).toBe(-16 / 32);
  });

  it('★ 0 與演完都不疊（null）', () => {
    expect(tollFlashGain(210)).toBeNull();
    expect(tollFlashGain(450)).toBeNull();
    expect(tollFlashGain(TOLL_FLASH_TOTAL_MS)).toBeNull();
  });

  it('★ 只在 16 幀內非 null，增益 = level/32', () => {
    for (let k = 0; k < TOLL_FLASH_FRAMES; k++) {
      const a = tollFlashGain(k * 30);
      const level = TOLL_FLASH_LEVELS[k]!;
      if (level === 0) {
        expect(a, `第 ${k} 幀`).toBeNull();
        continue;
      }
      expect(a, `第 ${k} 幀`).toBeCloseTo(level / TOLL_FLASH_FULL_SCALE, 6);
    }
  });
});
