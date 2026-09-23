/*
 * 魔法屋效果那几句台词（2026-09-23 再审）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ① 加蓋 / 拆除 / 拍賣三支收尾：中签者 `player_say(中签者, 0, "？？？...")`（`0x00432094` / `0x004320a2`）；
 * ② 變賣卡片 / 道具那两支直接加點券（0x00431d3d），**不经过** `fcn_0044f230` ⇒ 不说「得點券」那一档；
 * ③ 就地加蓋到 5 级：`0x431caa` 那一支不说事件 15（那一句只在落点加蓋 `0x00419a19` / 建設公司 `0x0041ab5b`）。
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS, MAGIC_HOUSE_TEXT } from '@rich4/data';
import { makeGameState, makePlayer, type GameState } from '@rich4/core';
import {
  detectLevelFive,
  detectMagicAuctionPonder,
  detectMagicPonder,
  detectPointsGained,
  speechEventsFor,
  speechLinesFor,
} from './speech.ts';

const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));
const nameOf = (i: number) => CHARACTERS[i]?.name ?? '';
const base = makeGameState({ players, currentPlayer: 1 });

function magic(id: number, targets: number[], acted: number[], over: Partial<GameState> = {}): GameState {
  return {
    ...base,
    lastEvent: { kind: 'magicHouse', id, criterion: 10, targets },
    notices: acted.map((who) => ({ key: 'magic.effect' as const, args: [nameOf(who), 'x'], beforeFilms: true })),
    ...over,
  };
}

describe('★ ①「？？？...」@source 0x00432094 `push 0x46482f / push 0 / push 中签者` → 0x004320a2 `call player_say`', () => {
  it('★★ 就地加蓋 / 就地拆除：过了闸的中签者各说一句；表情 0；字面串、没有语音', () => {
    for (const id of [5, 9]) {
      const said = detectMagicPonder(base, magic(id, [0, 2, 3], [0, 3]));
      expect(said, `效果 ${id}`).toEqual([
        { player: 0, event: -1, expression: 0, text: MAGIC_HOUSE_TEXT.ponder.text },
        { player: 3, event: -1, expression: 0, text: MAGIC_HOUSE_TEXT.ponder.text },
      ]);
    }
    expect(MAGIC_HOUSE_TEXT.ponder.text).toBe('？？？...');
    const lines = speechLinesFor(magic(5, [0], [0]), detectMagicPonder(base, magic(5, [0], [0])).map((e) => ({ ...e, order: 'afterStage' as const })));
    expect(lines[0]!.bubble).toMatchObject({ lines: ['？？？...'], voice: null, emoji: null, expression: 0, speaker: nameOf(0) });
  });

  it('★ 其它效果不说；旧的 lastEvent 不说；`player_say` 的三道闸（消失 / 夢遊 / 冬眠）挡住就不说', () => {
    expect(detectMagicPonder(base, magic(4, [0], [0]))).toEqual([]);
    const a = magic(9, [0], [0]);
    expect(detectMagicPonder(a, { ...a })).toEqual([]);
    const sleeping = players.map((p, i) => (i === 0 ? { ...p, blocking: { ...p.blocking, sleeping: 2 } } : p));
    expect(detectMagicPonder(base, magic(9, [0], [0], { players: sleeping }))).toEqual([]);
  });

  it('★ 拍賣當格土地：拍賣窗口关掉那一拍，卖方（= 中签者）说', () => {
    const during: GameState = {
      ...magic(11, [2], [2]),
      pending: { kind: 'auction', entityId: 0x7d1, basePrice: 1000, bidders: [0, 1], seller: 2 } as unknown as GameState['pending'],
    };
    const done: GameState = { ...during, pending: null };
    expect(detectMagicAuctionPonder(during, done)).toEqual([
      { player: 2, event: -1, expression: 0, text: MAGIC_HOUSE_TEXT.ponder.text },
    ]);
    // 还在拍 / 不是魔法屋那一趟 ⇒ 不说
    expect(detectMagicAuctionPonder(during, during)).toEqual([]);
    expect(detectMagicAuctionPonder(during, { ...done, lastEvent: { kind: 'news', id: 3 } })).toEqual([]);
  });

  it('★ 走进 `speechEventsFor` 时字段原样带着（`afterStage`）', () => {
    const evs = speechEventsFor(base, magic(9, [0], [0]));
    expect(evs.filter((e) => e.text !== undefined)).toEqual([
      { player: 0, event: -1, expression: 0, text: '？？？...', order: 'afterStage' },
    ]);
  });
});

describe('★ ②③ 魔法屋那一趟不说通用的「得點券」/「剛滿 5 級」', () => {
  it('★ 變賣所有卡片：點券涨了也不说（`0x00431d3d add word [player+0x30], ax`，不走 0x44f230）', () => {
    const after = magic(0, [3], [3], {
      players: players.map((p, i) => (i === 3 ? { ...p, points: p.points + 300 } : p)),
    });
    expect(detectPointsGained(base, after)).toEqual([]);
    // 对照：不是魔法屋那一趟时照常说
    expect(detectPointsGained(base, { ...after, lastEvent: null }).length).toBeGreaterThan(0);
  });

  it('★ 就地加蓋到 5 级：不说事件 15', () => {
    const before = { ...base, landLevel: [0, 4] };
    const after = magic(5, [1], [1], { landLevel: [0, 5] });
    expect(detectLevelFive(before, after)).toEqual([]);
    expect(detectLevelFive(before, { ...after, lastEvent: null })).toHaveLength(1);
  });
});
