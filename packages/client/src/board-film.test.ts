/*
 * 棋盘影片的**排队** —— 同一条 action 里的两段影片必须串行（狗咬 → 救护车）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第五份回报第 3 条：「被狗咬的动画顺序还是不对」。根因与 @source 见 `enqueueBoardFilm`。
 */
import { describe, expect, it } from 'vitest';
import { enqueueBoardFilm, type BoardFilmSpec } from './board-film.ts';

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
