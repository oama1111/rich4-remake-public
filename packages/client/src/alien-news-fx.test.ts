/*
 * 新聞 4「外星人攻打地球」的飛碟影片 —— 試玩回報回歸
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事，判据全部回 exe（VA 见 `alien-news-fx.ts` 的文件头）：
 *   ① **规格**：`Data.mkf` 0x213 = 36 帧 / 440×440 / 114 ms（逐字节核过资源头）；
 *   ② **落点 / 音效 / flags**：屏幕 (0, 0x28)、音效 0x56、flags 0x180001（点不掉）；
 *   ③ **什么时候播**：`lastEvent` 刚变成 `{ news, 4 }` 才播，别的号一律不播；
 *   ④ **接线**：`main.ts` 的 `startActionFx` 里真的有那一行（`confine-fx.test.ts`
 *      的「源码钉子」同一条路子 —— 少了它整段演出就还是「被直接跳过」）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import { NEWS_EVENTS, newsEvent } from '@rich4/data';

import { LAYOUT } from './stage.ts';
import {
  ALIEN_NEWS_FILM,
  ALIEN_NEWS_FLAGS,
  ALIEN_NEWS_FLIC_RESOURCE,
  ALIEN_NEWS_FX_ARCHIVE,
  ALIEN_NEWS_SOUND,
  ALIEN_NEWS_X,
  ALIEN_NEWS_Y,
  NEWS_ALIEN_ID,
  alienNewsFxTrigger,
  alienNewsSkippable,
  alienNewsTotalMs,
} from './alien-news-fx.ts';

const DATA_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Data.mkf';
const hasData = existsSync(DATA_MKF);
const runData = hasData ? it : it.skip;

/** 只有 `lastEvent` 一个字段的最小状态 */
const st = (lastEvent: { kind: string; id: number } | null) => ({ lastEvent });

describe('★ 影片规格 @source 资源头 + 调用点', () => {
  it('在 Data.mkf、资源 0x213、落点 (0, 0x28) —— 整块棋盘', () => {
    // @source VA 0x00449239 `push 0x213` / VA 0x0044923e `mov edx, [0x48a0e4]`
    expect(ALIEN_NEWS_FX_ARCHIVE).toBe('Data.mkf');
    expect(ALIEN_NEWS_FLIC_RESOURCE).toBe(0x213);
    expect(ALIEN_NEWS_FLIC_RESOURCE).toBe(531);
    // @source VA 0x00449258 `push 0`（x）/ VA 0x00449256 `push 0x28`（y）
    expect(ALIEN_NEWS_X).toBe(0);
    expect(ALIEN_NEWS_Y).toBe(0x28);
    expect(ALIEN_NEWS_Y).toBe(40);
    expect(ALIEN_NEWS_FILM.x).toBe(0);
    expect(ALIEN_NEWS_FILM.y).toBe(0x28);
    expect(ALIEN_NEWS_FILM.width).toBe(440);
    expect(ALIEN_NEWS_FILM.height).toBe(440);
    // 交给渲染器的是**棋盘局部**坐标：屏幕 y − 棋盘原点 = 0（与入獄 0x21a 同形）
    expect(ALIEN_NEWS_FILM.y - LAYOUT.board.y).toBe(0);
  });

  it('音效 0x56、flags 0x180001，且**点不掉**（flags bit1 = 0）', () => {
    // @source VA 0x0044924f `push 0x56` / VA 0x00449251 `push 0x180001`
    expect(ALIEN_NEWS_SOUND).toBe(0x56);
    expect(ALIEN_NEWS_SOUND).toBe(86);
    expect(ALIEN_NEWS_FLAGS).toBe(0x180001);
    expect(ALIEN_NEWS_FILM.sound).toBe(ALIEN_NEWS_SOUND);
    expect(ALIEN_NEWS_FILM.flags).toBe(ALIEN_NEWS_FLAGS);
    // bit0 = 存背景（`[0x48c882]`）；bit2 = 循环（0）；bit1 = 可跳过（0）
    expect(ALIEN_NEWS_FLAGS & 1).toBe(1);
    expect((ALIEN_NEWS_FLAGS >> 2) & 1).toBe(0);
    // @source `fcn_0045144f` VA 0x004514d6：bit1 置位才认点击/按键跳过
    expect(alienNewsSkippable()).toBe(false);
  });

  it('★ 总时长 = 36 帧 × 114 ms = 4104 ms', () => {
    expect(ALIEN_NEWS_FILM.frames).toBe(36);
    expect(ALIEN_NEWS_FILM.frameMs).toBe(114);
    expect(alienNewsTotalMs()).toBe(36 * 114);
    expect(alienNewsTotalMs()).toBe(4104);
  });

  it('★ 要等訊息框收屏才起播（`afterOverlay`）—— 原版次序是框 2400 ms、片在后', () => {
    // @source `fcn_0044b6df` 尾 `push 0x960 / call 0x4544f6`（框停 2400 ms）
    //   → 事件函数体 `fcn_0044913d` 的 VA 0x00449245/0x0044925b 才读片、播片。
    // 訊息框是浮窗 (0,0)-(440,480)，正好盖住 (0,40)-(440,480) 的整块影片。
    expect(ALIEN_NEWS_FILM.afterOverlay).toBe(true);
  });

  runData('★ 帧数/尺寸/每帧毫秒与 `Data.mkf` 0x213 的头逐字节一致', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    const info = parseFlicInfo(a.read(ALIEN_NEWS_FILM.resource));
    expect(info, '资源 0x213 应当是标准 FLIC').not.toBeNull();
    expect(info!.frames).toBe(ALIEN_NEWS_FILM.frames);
    expect(info!.width).toBe(ALIEN_NEWS_FILM.width);
    expect(info!.height).toBe(ALIEN_NEWS_FILM.height);
    expect(info!.frameMs).toBe(ALIEN_NEWS_FILM.frameMs);
  });
});

describe('★ 触发判据：只有新聞 4 播', () => {
  it('★★ 新聞 4 → 播（试玩报告的那一条）', () => {
    const before = st({ kind: 'news', id: 3 });
    const after = st({ kind: 'news', id: NEWS_ALIEN_ID });
    expect(alienNewsFxTrigger(before, after)).toBe(ALIEN_NEWS_FILM);
  });

  it('★ 事件号对不上 → 不播（拿别的新聞 id 逐条扫一遍）', () => {
    for (const e of NEWS_EVENTS) {
      if (e.id === NEWS_ALIEN_ID) continue;
      expect(
        alienNewsFxTrigger(st(null), st({ kind: 'news', id: e.id })),
        `news #${e.id} 不该放飛碟影片`,
      ).toBeNull();
    }
  });

  it('★ 伪证：把 after 的事件号换成**别的**（4 → 5 / 3 / 0 / 35）必须立刻不播', () => {
    // 这一条就是「实现不按新聞 4 触发就变红」的那把尺子。
    // 新聞 5「外星怪獸襲擊」是它最近的邻居（有自己的影片 `Data.mkf` 0x21b，
    // @source VA 0x00449467 `push 0x21b`）—— 把两段接错时这一条红。
    for (const wrong of [3, 5, 0, 35]) {
      expect(alienNewsFxTrigger(st(null), st({ kind: 'news', id: wrong }))).toBeNull();
    }
    // 反过来：正确的号必须中（**字面量 4**，不是常量 —— 常量改了这里照样红）
    expect(alienNewsFxTrigger(st(null), st({ kind: 'news', id: 4 }))).toBe(ALIEN_NEWS_FILM);
    expect(ALIEN_NEWS_FILM.resource).not.toBe(0x21b);
  });

  it('命運 / 魔法屋 / 小游戏那几条通道不播这段', () => {
    expect(alienNewsFxTrigger(st(null), st({ kind: 'fortune', id: NEWS_ALIEN_ID }))).toBeNull();
    expect(alienNewsFxTrigger(st(null), st({ kind: 'magicHouse', id: NEWS_ALIEN_ID }))).toBeNull();
    expect(
      alienNewsFxTrigger(st(null), st({ kind: 'minigameDecline', id: NEWS_ALIEN_ID })),
    ).toBeNull();
  });

  it('★ 本来就是新聞 4（同一次事件被重放）→ 不重播', () => {
    const same = st({ kind: 'news', id: NEWS_ALIEN_ID });
    expect(alienNewsFxTrigger(same, same)).toBeNull();
  });

  it('不是事件（lastEvent 为 null）→ 不播', () => {
    expect(alienNewsFxTrigger(st(null), st(null))).toBeNull();
    expect(alienNewsFxTrigger(st({ kind: 'news', id: NEWS_ALIEN_ID }), st(null))).toBeNull();
  });
});

describe('★ @rich4/data 的表与这段影片是同一件事', () => {
  it('news[4] 的 VA 就是新聞表的 `0x475e24[4]`，效果是 `alienBlast`', () => {
    const e = newsEvent(NEWS_ALIEN_ID);
    expect(e).toBeDefined();
    // @source `python3 tools/disasm.py table 0x475e24 36` 的 `[4] = 0x0044913d`
    expect(e!.va).toBe(0x0044913d);
    expect(e!.effects).toEqual(['alienBlast']);
    // 全表只有新聞 4 走 `alienBlast` —— 判据里那个号不会打到别人身上
    const alien = NEWS_EVENTS.filter((x) => x.effects.includes('alienBlast'));
    expect(alien.map((x) => x.id)).toEqual([NEWS_ALIEN_ID]);
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  it('`startActionFx` 的**函数体内**有那一行派发（少了它就还是「被直接跳过」）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const at = src.indexOf('function startActionFx(');
    expect(at).toBeGreaterThan(0);
    // 只看这个函数体：到下一个顶层 `}` 为止（`startActionFx` 后面紧跟空行 + 新注释）
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('startAlienNewsFx(before, state);');
    // 且排在住院影片**之后**（原版是先 send_to_hospital 的 0x20c、最后才 0x213）
    expect(body.indexOf('startConfineFx(before, state);')).toBeGreaterThan(0);
    expect(body.indexOf('startAlienNewsFx(before, state);')).toBeGreaterThan(
      body.indexOf('startConfineFx(before, state);'),
    );
    // 上面那个函数真的接了共用那条棋盘影片路
    expect(src).toContain('function startAlienNewsFx(before: GameState, after: GameState): void {');
    expect(src).toContain('startBoardFilm(spec);');
    expect(src).toContain("import { alienNewsFxTrigger, NEWS_ALIEN_ID } from './alien-news-fx.ts';");
  });
});
