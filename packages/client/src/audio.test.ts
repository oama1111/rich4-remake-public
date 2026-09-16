/*
 * `SoundPlayer.durationOf` —— 给台词队列撑时长用（T-052）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版 `_rich4_player_say` 的收尾是「**等声音停** → 再 `fcn_004544f6(0x3e8)` 等
 * 1000 ms」（VA 0x00454520 起的 `PeekMessage` + `timeGetTime` 循环）。
 * 本引擎的字幕与语音是**并行**的，长句会出现「字先没了、声音还在」——
 * 故 `main.ts` 起播后问一次时长、把这一段撑长（`SpeechQueue.extend`）。
 *
 * 这一条钉的是：**纯查询、不触发加载、缺档案也不炸**。
 */
import { describe, expect, it } from 'vitest';
import { SoundPlayer } from './audio.ts';

describe('★ `durationOf` —— 给台词队列撑时长用（T-052 的 Q-SPEECH-6/9）', () => {
  it('没解码好 / 没播过 → null（纯查询，不触发加载）', () => {
    const p = new SoundPlayer();
    expect(p.durationOf('Speaking.mkf', 1050)).toBeNull();
    expect(p.durationOf('Effect.mkf', 0)).toBeNull();
  });

  it('⚠️ 不装档案时 `play` 是安静的、`durationOf` 仍为 null（不炸）', () => {
    const p = new SoundPlayer();
    expect(() => p.play('Speaking.mkf', 1050)).not.toThrow();
    expect(p.durationOf('Speaking.mkf', 1050)).toBeNull();
  });

  it('同一路问两次都是 null（不因为问过就变成 0 或抛错）', () => {
    const p = new SoundPlayer();
    p.durationOf('Speaking.mkf', 1347);
    expect(p.durationOf('Speaking.mkf', 1347)).toBeNull();
  });
});
