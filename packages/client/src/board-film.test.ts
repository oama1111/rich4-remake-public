/*
 * 棋盘影片的**排队** —— 同一条 action 里的两段影片必须串行（狗咬 → 救护车）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第五份回报第 3 条：「被狗咬的动画顺序还是不对」。根因与 @source 见 `enqueueBoardFilm`。
 */
import { describe, expect, it } from 'vitest';
import {
  beginBoardFilm,
  boardFilmDone,
  boardFilmFrame,
  boardFilmHolding,
  boardFilmHoldMs,
  enqueueBoardFilm,
  type BoardFilmSpec,
} from './board-film.ts';
import { NEWS_PLACE_FILMS } from './news-place-fx.ts';

const spec = (id: string): BoardFilmSpec => ({ id }) as unknown as BoardFilmSpec;

describe('enqueueBoardFilm @source 0x0041b8cd（0x214）→ 0x0043ed59（0x20c）', () => {
  it('空着 ⇒ 直接成为下一段', () => {
    const dog = spec('dog');
    expect(enqueueBoardFilm({ pending: null, after: null }, dog, false)).toEqual({ pending: dog, after: null });
  });

  it('★ 已经排了狗咬 ⇒ 救护车接在后面，狗咬**不被顶掉**', () => {
    const dog = spec('dog');
    const ambulance = spec('ambulance');
    const out = enqueueBoardFilm({ pending: dog, after: null }, ambulance, false);
    expect(out.pending).toBe(dog);
    expect(out.after).toBe(ambulance);
  });

  it('★ 有一段正在播 ⇒ 新来的排队，不打断', () => {
    const ambulance = spec('ambulance');
    const out = enqueueBoardFilm({ pending: null, after: null }, ambulance, true);
    expect(out.pending).toBeNull();
    expect(out.after).toBe(ambulance);
  });
});

describe('★ 第二十二份（gap-audit #14）：片后静置 `holdMs`（`fcn_004528b9` 阻塞等）', () => {
  const spec = (holdMs?: number): BoardFilmSpec => ({
    id: 't',
    archive: 'Data.mkf',
    resource: 0x217,
    frames: 15,
    width: 440,
    height: 440,
    frameMs: 71,
    x: 0,
    y: 0x28,
    sound: -1,
    flags: 0x80001,
    ...(holdMs === undefined ? {} : { holdMs }),
  });

  it('★★ 帧放完之后再等 `holdMs` 才收场；静置期间钉在最后一帧', () => {
    const f = beginBoardFilm(spec(300), 1000);
    const end = 1000 + 15 * 71;
    expect(boardFilmDone(f, end - 1)).toBe(false);
    expect(boardFilmHolding(f, end - 1)).toBe(false);
    expect(boardFilmDone(f, end)).toBe(false);
    expect(boardFilmHolding(f, end)).toBe(true);
    expect(boardFilmFrame(f, end + 299)).toBe(14);
    expect(boardFilmDone(f, end + 299)).toBe(false);
    expect(boardFilmDone(f, end + 300)).toBe(true);
    expect(boardFilmHolding(f, end + 300)).toBe(false);
  });

  it('★ 没有 `holdMs` ⇒ 与先前一样，帧放完即收（别的影片一律不受影响）', () => {
    const f = beginBoardFilm(spec(), 0);
    expect(boardFilmHoldMs(f.spec)).toBe(0);
    expect(boardFilmDone(f, 15 * 71)).toBe(true);
    expect(boardFilmHolding(f, 15 * 71)).toBe(false);
  });

  it('★ 静置期间被滑鼠鍵点掉（`holdSkipped`）⇒ 当拍收场；帧还没放完时点掉不算（这几段影片本身点不掉）', () => {
    const f = { ...beginBoardFilm(spec(500), 0), holdSkipped: true };
    expect(boardFilmDone(f, 15 * 71 - 1)).toBe(false);
    expect(boardFilmDone(f, 15 * 71)).toBe(true);
  });

  it('★★ 新聞那一族：15 / 21 静 300 ms、20 静 500 ms、5 不静 @source 0x0044a582 / 0x0044ae3d `push 0x12c`、0x0044ac82 `push 0x1f4`', () => {
    expect(NEWS_PLACE_FILMS.get(15)!.holdMs).toBe(0x12c);
    expect(NEWS_PLACE_FILMS.get(21)!.holdMs).toBe(0x12c);
    expect(NEWS_PLACE_FILMS.get(20)!.holdMs).toBe(0x1f4);
    expect(NEWS_PLACE_FILMS.get(5)!.holdMs).toBeUndefined();
  });
});
