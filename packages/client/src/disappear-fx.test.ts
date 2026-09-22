/*
 * 「消失」两段影片 + 消失中的棋子不画（第八份试玩回报 #3）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { ABDUCT_FILM, ABROAD_FILM, disappearFxTrigger } from './disappear-fx.ts';
import { boardFilmTotalMs } from './board-film.ts';
import { confinedPlayerDrawn } from './render.ts';
import { visibleBoardState } from './deferred-board.ts';
import { makeGameState, makePlayer } from '@rich4/core';

const P = (d: number) => ({ blocking: { disappearing: d } });

describe('影片规格 @source fcn_0040d375 尾巴 + Data.mkf 资源头', () => {
  it('綁架 = #0x215 46 帧 × 71 ms @(0,40) 音效 0x54；出國 = #0x22e 40 帧 × 42 ms 音效 0x60', () => {
    expect(ABDUCT_FILM).toMatchObject({ resource: 0x215, frames: 46, frameMs: 71, x: 0, y: 0x28, sound: 0x54, flags: 0x1c0001 });
    expect(ABROAD_FILM).toMatchObject({ resource: 0x22e, frames: 40, frameMs: 42, x: 0, y: 0x28, sound: 0x60, flags: 0x140001 });
    expect(boardFilmTotalMs(ABDUCT_FILM)).toBe(46 * 71);
  });
});

describe('disappearFxTrigger', () => {
  it('disappearing 0 → 3|1<<6（綁架）⇒ 飛碟；0 → 3（出國）⇒ 飛機；没变 / 变回 0 ⇒ null', () => {
    expect(disappearFxTrigger({ players: [P(0)] }, { players: [P(3 | (1 << 6))] })).toBe(ABDUCT_FILM);
    expect(disappearFxTrigger({ players: [P(0)] }, { players: [P(3)] })).toBe(ABROAD_FILM);
    expect(disappearFxTrigger({ players: [P(3)] }, { players: [P(2)] })).toBeNull();
    expect(disappearFxTrigger({ players: [P(3)] }, { players: [P(0)] })).toBeNull();
  });
});

describe('★ 消失 / 住宿 / 坐牢 / 住院中的棋子不画 @source 0x00408691 / 0x0040869a', () => {
  const blk = (o: Partial<{ inHotel: number; disappearing: number; inPrison: number; inHospital: number }>) => ({
    inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, ...o,
  });
  it('四个计数任一非 0 ⇒ 不画；whoPlays & 0x20 ⇒ 照画；全 0 ⇒ 画', () => {
    expect(confinedPlayerDrawn({ whoPlays: 1, blocking: blk({}) })).toBe(true);
    expect(confinedPlayerDrawn({ whoPlays: 1, blocking: blk({ disappearing: 3 | (1 << 6) }) })).toBe(false);
    expect(confinedPlayerDrawn({ whoPlays: 2, blocking: blk({ inHospital: 2 }) })).toBe(false);
    expect(confinedPlayerDrawn({ whoPlays: 2, blocking: blk({ inPrison: 1 }) })).toBe(false);
    expect(confinedPlayerDrawn({ whoPlays: 1, blocking: blk({ inHotel: 1 }) })).toBe(false);
    expect(confinedPlayerDrawn({ whoPlays: 1 | 0x20, blocking: blk({ inHospital: 2 }) })).toBe(true);
  });
  it('影片窗口开着时 `disappearing` 按 before 画（人还在，等飛碟把他吸走）', () => {
    const before = makeGameState({ players: [makePlayer({ index: 0 })] });
    const after = { ...before, players: [{ ...before.players[0]!, blocking: { ...before.players[0]!.blocking, disappearing: 3 | (1 << 6) } }] };
    expect(visibleBoardState(after, before).players[0]!.blocking.disappearing).toBe(0);
    expect(visibleBoardState(after, null).players[0]!.blocking.disappearing).toBe(3 | (1 << 6));
  });
});
