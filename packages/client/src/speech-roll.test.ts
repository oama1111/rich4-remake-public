/*
 * 台词随机的**查询**（`speech-roll.ts`）—— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 那几次 `rand()` 由 core 在 exe 掷的那一刻掷、记进 `after.lastSpeechRolls`（站点 VA、说话人、原值）；
 * 本文件钉住客户端这一侧的读法：
 *   ① 「这一条 action 掷的」= `after` 与 `before` 的**引用不同**（core 最外层 `reduce` 出口整份覆写）；
 *   ② 按**站点 + 说话人**取，同一对掷了多次时 `nth` 取第几次；
 *   ③ `speechRand(…) & 1` 就是原版的 `rand() & 1`；core 没在那一档掷（`null`）按前一句（0）。
 *
 * 分布 / 「两台客户端说同一句」不在本文件：值现在来自 core（`WatcomRng`，见 core 的用例），
 * 两端的等价性由联机镜像用例（`packages/server/src/events-audit-mp.test.ts`）与端到端探测器用例钉住。
 */
import { describe, expect, it } from 'vitest';
import { SPEECH_SITE, type GameState, type SpeechRoll } from '@rich4/core';
import { NEWS_OWNER_RAND_SITE, SPEECH_RAND_SITE, speechCoin, speechRand, speechRollsOf } from './speech-roll.ts';

const rolls = (...list: SpeechRoll[]): Pick<GameState, 'lastSpeechRolls'> => ({ lastSpeechRolls: list });
const none: Pick<GameState, 'lastSpeechRolls'> = { lastSpeechRolls: null };

describe('★ 台词随机：从 core 记下来的那一份里查', () => {
  it('站点表与 core 同一份（`0x0044f280` 等），不是各写一套', () => {
    expect(SPEECH_RAND_SITE).toBe(SPEECH_SITE);
    expect(NEWS_OWNER_RAND_SITE.get(21)).toBe(0x0044ae74);
  });

  it('★ 「这一条 action 掷的」看引用：同一份（core 没重盖）就不算这一条的', () => {
    const before = rolls({ site: SPEECH_SITE.pay, player: 0, value: 5 });
    // 引用相同 ⇒ 这是上一条留下的，不重说
    expect(speechRollsOf(before, before)).toEqual([]);
    expect(speechRand(before, before, 0, SPEECH_SITE.pay)).toBeNull();
    // 引用不同 ⇒ 整份都是这一条的
    const after = rolls({ site: SPEECH_SITE.pay, player: 0, value: 5 });
    expect(speechRollsOf(before, after)).toHaveLength(1);
  });

  it('★ 没掷（`null` / 缺字段）⇒ 空；旧存档缺字段也不炸', () => {
    expect(speechRollsOf(none, none)).toEqual([]);
    expect(speechRollsOf({}, {})).toEqual([]);
    expect(speechRand(none, rolls({ site: SPEECH_SITE.gain, player: 2, value: 0x7fff }), 0, SPEECH_SITE.gain)).toBeNull();
  });

  it('★ 按站点 + 说话人取（同一站点别人掷的不算自己的）；`nth` 取第几次', () => {
    const before = none;
    const after = rolls(
      { site: SPEECH_SITE.pay, player: 1, value: 11 },
      { site: SPEECH_SITE.pay, player: 0, value: 22 },
      { site: SPEECH_SITE.pay, player: 0, value: 33 },
      { site: SPEECH_SITE.gain, player: 0, value: 44 },
    );
    expect(speechRand(before, after, 0, SPEECH_SITE.pay)).toBe(22);
    expect(speechRand(before, after, 0, SPEECH_SITE.pay, 1)).toBe(33);
    expect(speechRand(before, after, 0, SPEECH_SITE.pay, 2)).toBeNull();
    expect(speechRand(before, after, 1, SPEECH_SITE.pay)).toBe(11);
    expect(speechRand(before, after, 0, SPEECH_SITE.gain)).toBe(44);
    // 没在那个站点掷过 ⇒ `null`（不是 0 —— 调用方据此知道「原版这一档不掷」）
    expect(speechRand(before, after, 0, SPEECH_SITE.fine)).toBeNull();
  });

  it('★ `speechCoin` = 原值 `& 1`（@source `and eax,1`）；没掷按前一句 0', () => {
    const before = none;
    for (const value of [0, 1, 2, 3, 0x7ffe, 0x7fff]) {
      const after = rolls({ site: SPEECH_SITE.hostile, player: 3, value });
      expect(speechCoin(before, after, 3, SPEECH_SITE.hostile)).toBe(value & 1);
    }
    expect(speechCoin(before, none, 3, SPEECH_SITE.hostile)).toBe(0);
  });
});
