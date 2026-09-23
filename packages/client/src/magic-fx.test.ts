/*
 * 魔法屋「就地拆除房屋」那一段 0x211 —— 规格与判据
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import type { GameState } from '@rich4/core';
import { MAGIC_DEMOLISH_FILM, MAGIC_OPTION_DEMOLISH, magicDemolishFxTrigger } from './magic-fx.ts';
import { boardFilmSkippable } from './board-film.ts';

const DATA_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Data.mkf';
const runData = existsSync(DATA_MKF) ? it : it.skip;

type S = Pick<GameState, 'lastEvent' | 'notices'>;
const st = (lastEvent: GameState['lastEvent'], notices: GameState['notices'] = []): S => ({ lastEvent, notices });
const EFFECT = { key: 'magic.effect' as const, args: ['金貝貝', '就地拆除房屋'], beforeFilms: true };

describe('★ 规格 @source 0x0043231a `push 0x211` / 0x00432354..0x00432360 `fcn_0045144f(影片, 0, 0x28, 0x260001, 0x61)`', () => {
  it('Data.mkf 0x211、落 (0, 0x28)、音效 0x61、flags 0x260001（打断不了）、起播时放开棋盘', () => {
    expect(MAGIC_DEMOLISH_FILM).toMatchObject({
      archive: 'Data.mkf', resource: 0x211, x: 0, y: 0x28, sound: 0x61, flags: 0x260001, releaseBoardOnStart: true,
    });
    expect(boardFilmSkippable(MAGIC_DEMOLISH_FILM)).toBe(false);
    expect(MAGIC_OPTION_DEMOLISH).toBe(9);
  });

  runData('★ 真值：资源头 = 68 帧 × 71 ms、440×440', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    expect(parseFlicInfo(a.read(MAGIC_DEMOLISH_FILM.resource))).toEqual({
      width: MAGIC_DEMOLISH_FILM.width,
      height: MAGIC_DEMOLISH_FILM.height,
      frames: MAGIC_DEMOLISH_FILM.frames,
      frameMs: MAGIC_DEMOLISH_FILM.frameMs,
    });
  });
});

describe('★ 判据：刚写下「魔法屋 · 就地拆除房屋」且有人过了闸（有那一扇框）', () => {
  const ev = { kind: 'magicHouse' as const, id: 9, criterion: 11, targets: [0] };
  it('★ 过闸 ⇒ 播', () => {
    expect(magicDemolishFxTrigger(st(null), st(ev, [EFFECT]))).toBe(true);
  });
  it('★ 没人过闸（站在普通格 / 住店中）⇒ 不播；别的效果 ⇒ 不播；旧的 lastEvent ⇒ 不播', () => {
    expect(magicDemolishFxTrigger(st(null), st(ev, []))).toBe(false);
    expect(magicDemolishFxTrigger(st(null), st({ ...ev, id: 5 }, [EFFECT]))).toBe(false);
    const same = st(ev, [EFFECT]);
    expect(magicDemolishFxTrigger(same, { ...same })).toBe(false);
    expect(magicDemolishFxTrigger(st(null), st({ kind: 'news', id: 9 }, [EFFECT]))).toBe(false);
  });
});
