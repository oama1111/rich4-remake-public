/*
 * 新聞 5 / 15 / 20 / 21 的整块棋盘影片 + 房主台词 + 訊息框地名 —— 第十二份試玩回報回歸
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回报（`wt12/20260923-015102989-manual-Charles.json`）：「龙卷风摧毁房屋没有看到具体哪个
 * 房子受影响，也没看到特效动画」。重放第 96 条：P1 抽到新聞 21，core 挑中 **合肥**（空地）。
 * 原版此时：訊息框「龍捲風侵襲合肥」→ 镜头移到合肥 → 0x217 龍捲風（音效 0x58）→（有主才）房主说话。
 *
 * 钉四件事（VA 全在 `news-place-fx.ts` 文件头那张表）：
 *   ① 四段影片的资源 / 音效 / flags / 落点，且帧数/尺寸/每帧毫秒与 `Data.mkf` 的头逐字节一致；
 *   ② 什么时候播：`lastEvent` 刚变成带 `place` 的那几条新聞；
 *   ③ 訊息框 `%s` = 地名（`newsPlaceName`）；
 *   ④ 房主台词（`detectNewsPlaceOwner`）与 `main.ts` 的接线。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import { newsEvent } from '@rich4/data';
import { makeGameState, makePlayer } from '@rich4/core';

import { boardFilmSkippable } from './board-film.ts';
import { LAYOUT } from './stage.ts';
import { NEWS_PLACE_FILMS, NEWS_TORNADO_ID, newsPlaceFilmMs, newsPlaceFxTrigger } from './news-place-fx.ts';
import { eventBoxDescription, newsPlaceName } from './event-box-screen.ts';
import { DETECTORS, detectNewsPlaceOwner, NEWS_PLACE_OWNER_LINE } from './speech.ts';

const DATA_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Data.mkf';
const runData = existsSync(DATA_MKF) ? it : it.skip;

type Ev = { kind: string; id: number; place?: { entity: number; owner: number } } | null;
const st = (lastEvent: Ev) => ({ lastEvent });

describe('★ 四段影片的规格 @source 各函数的 read_mkf / fcn_0045144f 调用点', () => {
  it('★★ 新聞 21 龍捲風 = Data.mkf 0x217、音效 0x58、flags 0x80001（点不掉）、落 (0, 0x28)', () => {
    // @source 0x0044ae0a `push 0x217` / 0x0044ae20 `push 0x58` / 0x0044ae22 `push 0x80001`
    //         0x0044ae27 `push 0x28` / 0x0044ae29 `push 0`
    const f = NEWS_PLACE_FILMS.get(21)!;
    expect(NEWS_TORNADO_ID).toBe(21);
    expect(f.archive).toBe('Data.mkf');
    expect(f.resource).toBe(0x217);
    expect(f.sound).toBe(0x58);
    expect(f.flags).toBe(0x80001);
    expect([f.x, f.y]).toEqual([0, 0x28]);
    expect(f.y - LAYOUT.board.y).toBe(0); // 整块棋盘
    expect(boardFilmSkippable(f)).toBe(false);
    // 15 帧 × 71 ms
    expect(newsPlaceFilmMs(21)).toBe(15 * 71);
  });

  it('★ 其余三条：5 = 0x21b/0x54/0x200001、15 = 0x20f/0x57/0x50001、20 = 0x216/0x59/0x80001', () => {
    // @source 5: 0x0044945b / 0x00449471 / 0x00449473；15: 0x0044a54f / 0x0044a565 / 0x0044a567；
    //         20: 0x0044ac4f / 0x0044ac65 / 0x0044ac67
    const rows = [...NEWS_PLACE_FILMS.entries()].map(([id, f]) => [id, f.resource, f.sound, f.flags]);
    expect(rows).toEqual([
      [5, 0x21b, 0x54, 0x200001],
      [15, 0x20f, 0x57, 0x50001],
      [20, 0x216, 0x59, 0x80001],
      [21, 0x217, 0x58, 0x80001],
    ]);
    for (const f of NEWS_PLACE_FILMS.values()) {
      expect([f.x, f.y, f.width, f.height]).toEqual([0, 0x28, 440, 440]);
      expect(boardFilmSkippable(f), `${f.id} 点不掉（flags bit1 = 0）`).toBe(false);
      // 原版次序：訊息框（pass 0）2400 ms → pass 1 才播 ⇒ 等事件框收屏
      expect(f.afterOverlay).toBe(true);
    }
  });

  it('★ 表里的四条新聞在 `@rich4/data` 里就是那四个函数（VA 对得上）', () => {
    expect(newsEvent(5)!.va).toBe(0x004492a0);
    expect(newsEvent(15)!.va).toBe(0x0044a453);
    expect(newsEvent(20)!.va).toBe(0x0044ab2c);
    expect(newsEvent(21)!.va).toBe(0x0044ac99);
  });

  runData('★ 帧数/尺寸/每帧毫秒与 `Data.mkf` 的资源头逐字节一致', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (const f of NEWS_PLACE_FILMS.values()) {
      const info = parseFlicInfo(a.read(f.resource));
      expect(info, `资源 0x${f.resource.toString(16)} 应当是标准 FLIC`).not.toBeNull();
      expect([info!.frames, info!.width, info!.height, info!.frameMs]).toEqual([
        f.frames,
        f.width,
        f.height,
        f.frameMs,
      ]);
    }
  });
});

describe('★ 触发判据', () => {
  const place = { entity: 0x7d0 + 61, owner: 0 };

  it('★★ 回报现场：新聞 21 挑到空地（owner 0）也播 —— 原版影片调用点在 mutate_land 之后、无条件', () => {
    expect(newsPlaceFxTrigger(st(null), st({ kind: 'news', id: 21, place }))).toBe(NEWS_PLACE_FILMS.get(21));
  });

  it('★ 没有 `place`（旧存档 / 候选为空）→ 不播', () => {
    expect(newsPlaceFxTrigger(st(null), st({ kind: 'news', id: 21 }))).toBeNull();
  });

  it('★ 同一次事件（引用没变）→ 不重播', () => {
    const ev = { kind: 'news', id: 21, place };
    expect(newsPlaceFxTrigger(st(ev), st(ev))).toBeNull();
  });

  it('★ 表外的新聞（19 山洪、18 地震…）/ 命運 → 不播', () => {
    expect(newsPlaceFxTrigger(st(null), st({ kind: 'news', id: 19, place }))).toBeNull();
    expect(newsPlaceFxTrigger(st(null), st({ kind: 'news', id: 4, place }))).toBeNull();
    expect(newsPlaceFxTrigger(st(null), st({ kind: 'fortune', id: 21, place }))).toBeNull();
  });
});

describe('★ 訊息框 `%s` = 地名 @source 0x0044acfe strcpy(地块 + 4) → 0x0044ad90 sprintf', () => {
  const topo = {
    lands: [{ id: 61, name: '合肥' }],
    facilities: [{ id: 3, name: '醫院' }],
  } as never;

  it('★★ 地块 / 設施两种编码都认', () => {
    expect(newsPlaceName(topo, 0x7d0 + 61)).toBe('合肥');
    expect(newsPlaceName(topo, 0xfa0 + 3)).toBe('醫院');
    expect(newsPlaceName(topo, 0x7d0 + 99)).toBeNull();
  });

  it('★★ 代进去就是「龍捲風侵襲合肥 / 摧毀房屋一棟」（先前代的是人名）', () => {
    expect(eventBoxDescription(newsEvent(21), 1, '合肥')).toBe('龍捲風侵襲合肥\n摧毀房屋一棟');
  });

  it('★ 第二十二份：18 地震 core 现在也交 `place` ⇒ `%s` 同样是地名（pass 0 `0x0044a76f strcpy(名字)` → `0x0044a789 sprintf`）', () => {
    expect(eventBoxDescription(newsEvent(18), 1, '合肥')).toBe('合肥強烈地震房屋倒塌');
    // 18 没有房主那一句（pass 0 不写 [0x48c5a0]、pass 1 尾巴只有 sleep 500）
    expect(NEWS_PLACE_OWNER_LINE.has(18)).toBe(false);
  });

  it('★ 事件框那一屏真的拿 `place` 去换地名（源码钉子）', () => {
    const src = readFileSync(new URL('./event-box-screen.ts', import.meta.url), 'utf8');
    expect(src).toContain('newsPlaceName(env.topo, ev.place.entity)');
    expect(src).toContain('const subject = placeName ?? eventSubject(before, after, after.currentPlayer);');
  });
});

describe('★ 房主那一句 @source 0x0044ae4a owner != 0 ⇒ player_say(owner − 1, 2, 表 0x480856 = 事件 3/4)', () => {
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));
  const after = (ev: Ev) => makeGameState({ players, lastEvent: ev as never });
  const before = makeGameState({ players, lastEvent: null });

  it('★★ 有主 ⇒ **房主**（不是抽牌人）说事件 3、表情 2', () => {
    const a = after({ kind: 'news', id: 21, place: { entity: 0x7d1, owner: 3 } });
    expect(detectNewsPlaceOwner(before, a)).toEqual([{ player: 2, event: 3, expression: 2 }]);
  });

  it('★ 无主（回报现场：合肥是空地）⇒ 不说', () => {
    const a = after({ kind: 'news', id: 21, place: { entity: 0x7d0 + 61, owner: 0 } });
    expect(detectNewsPlaceOwner(before, a)).toEqual([]);
  });

  it('★ 20 超級颱風没有这一段（`0x0044ac87` sleep 500 之后直接返回）⇒ 不说', () => {
    expect(NEWS_PLACE_OWNER_LINE.has(20)).toBe(false);
    expect([...NEWS_PLACE_OWNER_LINE].sort((x, y) => x - y)).toEqual([5, 15, 19, 21]);
    const a = after({ kind: 'news', id: 20, place: { entity: 0x7d1, owner: 3 } });
    expect(detectNewsPlaceOwner(before, a)).toEqual([]);
  });

  it('★ 房主在冬眠 ⇒ 不说（`player_say` 开头 `0x0044ef93` 那道闸）', () => {
    const sleepy = players.map((p, i) => (i === 2 ? { ...p, blocking: { ...p.blocking, sleeping: 3 } } : p));
    const a = makeGameState({ players: sleepy, lastEvent: { kind: 'news', id: 21, place: { entity: 0x7d1, owner: 3 } } as never });
    expect(detectNewsPlaceOwner(before, a)).toEqual([]);
  });

  it('★ 登记在 DETECTORS 里、次序 `afterStage`（影片与 sleep 之后才说）', () => {
    const d = DETECTORS.find((x) => x.name === 'newsPlaceOwner');
    expect(d?.order).toBe('afterStage');
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  it('`startActionFx` 里派发 `startNewsPlaceFx`，走共用那条棋盘影片路', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const at = src.indexOf('function startActionFx(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('startNewsPlaceFx(before, state);');
    expect(src).toContain('function startNewsPlaceFx(before: GameState, after: GameState): void {');
    expect(src).toContain("import { newsPlaceFxTrigger } from './news-place-fx.ts';");
  });
});
