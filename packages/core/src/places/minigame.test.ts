/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 三个小游戏
 */

import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '../loaders/map.ts';
import {
  MINIGAME,
  MINIGAME_AUTO_BASE,
  MINIGAME_AUTO_SPREAD,
  MINIGAME_MAX_SCORE,
  MINIGAME_NAMES,
  autoMinigameScore,
  clampMinigameScore,
  isMinigame,
} from './minigame.ts';

describe('是哪三个', () => {
  it('编号与特殊格一致', () => {
    expect(MINIGAME.PENGUIN).toBe(SPECIAL_KIND.PENGUIN_DIG);
    expect(MINIGAME.BALLOON).toBe(SPECIAL_KIND.BALLOON);
    expect(MINIGAME.GIFT).toBe(SPECIAL_KIND.GIFT_FROM_SKY);
    expect(MINIGAME_NAMES[MINIGAME.PENGUIN]).toBe('企鵝挖寶');
  });

  it('别的格子不是小游戏', () => {
    expect(isMinigame(SPECIAL_KIND.BANK)).toBe(false);
    expect(isMinigame(SPECIAL_KIND.MAGIC_HOUSE)).toBe(false);
    expect(isMinigame(SPECIAL_KIND.LOTTERY)).toBe(false);
  });
});

describe('★ 不玩的那条出口 —— 三个小游戏共用', () => {
  it('得分恒在 50..69', () => {
    expect(MINIGAME_AUTO_BASE).toBe(50);
    expect(MINIGAME_AUTO_SPREAD).toBe(20);
    for (let r = 0; r < 200; r++) {
      const v = autoMinigameScore(r);
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThanOrEqual(69);
    }
  });

  it('就是 50 + rand() % 20', () => {
    expect(autoMinigameScore(0)).toBe(50);
    expect(autoMinigameScore(19)).toBe(69);
    expect(autoMinigameScore(20)).toBe(50);
    expect(autoMinigameScore(12345)).toBe(50 + (12345 % 20));
  });
});

describe('真人报上来的分数要夹住', () => {
  it('正常分数原样收下', () => {
    expect(clampMinigameScore(0)).toBe(0);
    expect(clampMinigameScore(500)).toBe(500);
    expect(clampMinigameScore(MINIGAME_MAX_SCORE)).toBe(999);
  });

  it('★ 超过上限夹到 999 —— 不拦的话一条构造的消息就能刷點券', () => {
    expect(clampMinigameScore(1_000_000)).toBe(999);
    expect(clampMinigameScore(Number.MAX_SAFE_INTEGER)).toBe(999);
  });

  it('负数与非有限值一律归零 —— 归零比夹到上限更保守', () => {
    expect(clampMinigameScore(-5)).toBe(0);
    expect(clampMinigameScore(Number.NaN)).toBe(0);
    // Infinity 不是「分数太高」，是**根本不是分数**，故不夹到 999 而是丢弃
    expect(clampMinigameScore(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampMinigameScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('小数向零取整', () => {
    expect(clampMinigameScore(99.9)).toBe(99);
  });
});
