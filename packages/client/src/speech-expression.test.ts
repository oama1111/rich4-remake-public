/*
 * 台词的**表情号**（`player_say` 第 2 实参 `arg2` = 头像图号 − 1）—— W-50 §1.2 第 1 条
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 两套取值、两张表：
 *   · `speech.ts` 的 `EXPRESSION_BY_EVENT` —— **事件台词**（角色台词表 `0x48084a`），
 *     判据 = 事件号（`0x48084a + 4n` = 事件 n），同一个事件到处同值；
 *   · `speech-bubble.ts` 的 `CARD_LINE_EXPRESSION` —— **用卡台词**（卡牌台词表
 *     `0x48123a`，槽号 = 卡号 − 1），逐卡不同（1..17 多为 3，10/11/12 是 0，
 *     22..28 是 0，29/30 是 3）。
 *
 * 每一个数字都在 `speech.ts` / `speech-bubble.ts` 的注释里附了
 * `push <arg2>` 的**地址**（回 exe 用 `python3 tools/disasm.py card <卡号>` /
 * `disasm.py va <地址>` 可复现）。这一份测试把它们**逐条钉住** ——
 * 改错一位就该变红。
 *
 * ★ 为什么要专门钉：`expression` 只影响画哪张脸（`speech-bubble.ts` 的头像图号
 *   = `expression + 1`），错了不会崩、也不会被别的测试发现 —— 只有这一份会。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type GameState } from '@rich4/core';
import {
  EXPRESSION_BY_EVENT,
  expressionOf,
  openingSpeech,
  speechEventsFor,
} from './speech.ts';
import { CARD_LINE_EXPRESSION, cardLineBubbleOf } from './speech-bubble.ts';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

describe('★★ 事件台词的表情号（`EXPRESSION_BY_EVENT`）', () => {
  // 逐条 = `speech.ts` 那张表的「事件 → 表情」两列，照抄
  const EXPECTED: readonly [readonly number[], number, string][] = [
    [[0, 1, 2], 0, '小额进帐 / 得點券格 / 土地公 / 福神'],
    [[3, 4, 5], 2, '小额损失（住宿/監獄/醫院那几笔）'],
    [[6, 7, 8], 3, '進帳档位 + 小財神'],
    [[9, 10, 11], 2, '付錢档位'],
    [[12, 13, 14], 3, '罰款档位'],
    [[15], 0, '剛滿 5 級'],
    [[16, 17], 0, '同一街區獨佔'],
    [[18], 1, '最敵對玩家拿走 ≥5000×物價'],
    [[19], 2, '入獄 / 回合開始被阻'],
    [[20], 2, '住院 / 回合開始被阻'],
    [[21], 1, '夢遊卡 / 回合開始被阻'],
    [[22], 2, '壞神附身（小窮/大窮/小衰/大衰/死神）'],
    [[23], 2, '神明離身'],
    [[24], 3, '終局'],
    [[25], 2, '破產'],
    [[26], 3, '開局宣言'],
  ];

  for (const [events, expression, why] of EXPECTED) {
    it(`事件 ${events.join('/')} ⇒ ${expression}（${why}）`, () => {
      for (const e of events) {
        expect(expressionOf(e), `事件 ${e}`).toBe(expression);
      }
    });
  }

  it('★ 表里没有的事件 ⇒ `null`（**不猜**，`speechEventsFor` 也不写这一位）', () => {
    expect(expressionOf(27)).toBeNull();
    expect(expressionOf(999)).toBeNull();
  });

  it('★ 表本身只覆盖 0..26 这 27 个事件号，没有多写', () => {
    expect(Object.keys(EXPRESSION_BY_EVENT).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 27 }, (_, i) => i),
    );
  });

  it('★★ `speechEventsFor` 把表情号真的盖到了事件上（入獄 → 事件 19 → 2）', () => {
    const before = makeGameState();
    const after = clone(before);
    after.players = after.players.map((p, i) =>
      i === 0 ? makePlayer({ index: 0, blocking: { ...p.blocking, inPrison: 3 } }) : p,
    );
    const events = speechEventsFor(before, after);
    const prison = events.filter((e) => e.event === 19);
    expect(prison).toHaveLength(1);
    expect(prison[0]!.expression).toBe(2);
  });

  it('★★ 開局宣言（事件 26）也带表情号 3 —— 它不经 `speechEventsFor`，走 `openingSpeech`', () => {
    const state = makeGameState({ currentPlayer: 2 });
    const bubbles = openingSpeech(state);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.expression).toBe(3);
    expect(bubbles[0]!.player).toBe(2);
  });
});

describe('★★ 用卡台词的表情号（`CARD_LINE_EXPRESSION`）—— 逐卡核过', () => {
  it('★ 逐卡取值与 exe 一致', () => {
    const three = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 29, 30];
    const zero = [10, 11, 12, 22, 23, 24, 25, 26, 27, 28];
    for (const card of three) expect(CARD_LINE_EXPRESSION[card], `卡 ${card}`).toBe(3);
    for (const card of zero) expect(CARD_LINE_EXPRESSION[card], `卡 ${card}`).toBe(0);
  });

  it('★ 被动卡 18..21 不在表里（`IMPLEMENTED_CARD_IDS` 里也没有 ⇒ 永不播）', () => {
    for (const card of [18, 19, 20, 21]) {
      expect(CARD_LINE_EXPRESSION[card], `卡 ${card}`).toBeUndefined();
    }
  });

  it('★★ `cardLineBubbleOf` 真的用了这张表 —— 拆除卡（12）是 0、均富卡（1）是 3', () => {
    // 换一位就该红：这两张的 arg2 在 exe 里确实不同（0x00443b87 vs 0x00442115）
    expect(cardLineBubbleOf(0, 0, '阿土伯', 12)?.expression).toBe(0);
    expect(cardLineBubbleOf(0, 0, '阿土伯', 1)?.expression).toBe(3);
  });
});
