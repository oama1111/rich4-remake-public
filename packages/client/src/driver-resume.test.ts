/*
 * 回到棋盘那一帧要不要续回合驱动 —— 单测（W-60）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 判据只有四个格子，但它是**阻断级** bug（棋子停在半路、GO 点不动）的唯一闸门，
 * 所以四条边都要钉：跨进棋盘 ⇒ true；棋盘 → 棋盘 ⇒ false（否则每帧都叫一次驱动）；
 * 棋盘 → 别处 ⇒ false（离开不叫）；過場 → 棋盘 ⇒ true（`endIntro()` 那条老路）。
 */
import { describe, expect, it } from 'vitest';
import { shouldResumeDriver } from './driver-resume.ts';

describe('★ W-60 `shouldResumeDriver`', () => {
  it('★ 設定屏关掉、回到棋盘 ⇒ true（这就是那条被阻断的链）', () => {
    expect(shouldResumeDriver('options', 'game')).toBe(true);
  });

  it('★ 過場（intro）放完 ⇒ true —— `endIntro()` 那条手工补的路径同样覆盖', () => {
    expect(shouldResumeDriver('intro', 'game')).toBe(true);
  });

  it('★ 棋盘 → 棋盘 ⇒ false（否则每一帧都叫驱动，会变成忙等）', () => {
    expect(shouldResumeDriver('game', 'game')).toBe(false);
  });

  it('★ 棋盘 → 别处 ⇒ false（**离开**棋盘不叫；驱动入口自己会 `return`）', () => {
    expect(shouldResumeDriver('game', 'options')).toBe(false);
    expect(shouldResumeDriver('game', 'stock')).toBe(false);
    expect(shouldResumeDriver('game', 'title')).toBe(false);
  });

  it('★ 别的整屏之间互跳 ⇒ false（只有**落回棋盘**那一帧算数）', () => {
    expect(shouldResumeDriver('options', 'stock')).toBe(false);
    expect(shouldResumeDriver('title', 'setup')).toBe(false);
    expect(shouldResumeDriver('stock', 'stock')).toBe(false);
  });

  it('★★ 这一条必须是**边沿**判据：连开两次設定再关掉，各叫一次（不重复也不漏）', () => {
    // 模拟一串屏号变化：棋盘 → 設定 → 棋盘 → 設定 → 棋盘
    const seq = ['game', 'options', 'game', 'options', 'game'];
    const resumed: number[] = [];
    for (let i = 1; i < seq.length; i++) {
      if (shouldResumeDriver(seq[i - 1]!, seq[i]!)) resumed.push(i);
    }
    expect(resumed).toEqual([2, 4]);
  });
});
