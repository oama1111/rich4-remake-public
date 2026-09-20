/*
 * 「影片播放期间棋盘按 before 那一帧画」—— 延迟可见状态
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事：
 *   ① **反证（本文件的主要目的）**：影片窗口还开着时把棋盘画成 after 的那一版，
 *      必须变红 —— 那就是 issue #19 报的「效果先于动画可见」；
 *   ② 被按住的**只有**加蓋与附身那五项，同一条 action 里别的变化照常按 after 画；
 *   ③ 窗口一关（`before` 为 `null` / 四条状态位全假）→ 立刻切回 after。
 *
 * 判据（写入点）全部引用别处已取过证的 `@source`，本文件不新造：
 *   · 加蓋 —— `build-fx.ts` 文件头（`fcn_0040b110` 先写等级、再播 0x229 / 0x20b）；
 *   · 附身 —— `god-fx.ts` 文件头（`attach_object` VA 0x0040ead7 写 godInfo/attached/nodeId，
 *     紧接着 `_rich4_attach_god` VA 0x0040ea62 播片）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeGameState, makePlayer, type GameState, type MapObject } from '@rich4/core';
import {
  boardFilmWindowOpen,
  boardStateForFilm,
  visibleBoardState,
  type BoardFilmWindow,
} from './deferred-board.ts';

/** 四条状态位全假 = 没有任何影片在播 */
const NO_FILM: BoardFilmWindow = {
  buildPlaying: false,
  buildPending: false,
  filmPlaying: false,
  filmPending: false,
};

/** 一条建屋影片还在（大锤正放着）*/
const BUILD_FILM: BoardFilmWindow = { ...NO_FILM, buildPlaying: true };
/** 棋盘影片「该播、还在解」那段窗口 */
const BOARD_FILM_PENDING: BoardFilmWindow = { ...NO_FILM, filmPending: true };

/** 造一件物件（神明那几槽的 type 由槽位定，测试只关心 attached/nodeId）*/
function obj(type: number, nodeId: number, attached: number, state = 0): MapObject {
  return { type, nodeId, attached, state };
}

/**
 * 「機器工人把 12 号地块从 3 级盖到 4 级」那一拍的前后。
 *
 * @source 调用序列见 `build-fx.ts` 文件头：`0x00447345 call 0x40b110`（等级 +1）
 *   在前，`0x0044735c call 0x45144f`（大锤影片）在后。
 */
function buildTick(): { before: GameState; after: GameState } {
  const before = makeGameState({
    landLevel: [0, 3],
    landOwner: [0, 2],
    facilityLevel: [0, 2],
    facilityOwner: [0, 1],
    players: [makePlayer({ index: 0, cash: 1000 })],
  });
  const after: GameState = {
    ...before,
    landLevel: [0, 4],
    facilityLevel: [0, 3],
    players: [makePlayer({ index: 0, cash: 1000 })],
  };
  return { before, after };
}

/**
 * 「走到神明那一格被附身」那一拍的前后。
 *
 * @source `god-fx.ts` / `rules/object-landing.ts`：`attach_object` 写
 *   `player + 0x3f`（godInfo）、`objects[i] + 5`（attached = 主人 + 1）、
 *   `objects[i] + 2`（nodeId ← 主人所在格）。
 */
function possessTick(): { before: GameState; after: GameState } {
  const before = makeGameState({
    objects: [obj(1, 7, 0), obj(3, 7, 0)],
    players: [makePlayer({ index: 0, nodeId: 12, godInfo: 0 })],
  });
  const after = makeGameState({
    // 槽 1（小財神）附到 0 号玩家身上
    objects: [obj(1, 12, 1, 7), obj(3, 7, 0)],
    players: [makePlayer({ index: 0, nodeId: 12, godInfo: 1 })],
  });
  return { before, after };
}

// ============================================================
//  ★ 反证：影片还在放 → 必须画 before
// ============================================================

describe('★★ 反证：影片窗口还开着时画 after = 红（issue #19 的那条 bug）', () => {
  it('建屋影片（大锤还在放）：那 12 号地块**必须**还是 3 级，不能提前变成 4 级', () => {
    const { before, after } = buildTick();
    // 影片窗口开着 —— 这一刻画 after 就是「房子先修好了」，正是需求方看到的
    const drawn = boardStateForFilm(after, before, BUILD_FILM);
    expect(drawn.landLevel[1]).toBe(3);
    // 反面：把窗口关掉才允许看见 4 级
    expect(boardStateForFilm(after, before, NO_FILM).landLevel[1]).toBe(4);
    // 若实现「窗口开着也照画 after」，上面第一条断言立刻变红 —— 这就是那条 bug
    expect(drawn.landLevel[1]).not.toBe(after.landLevel[1]);
  });

  it('建屋影片：設施等级同理（設施那一支也置 bit7，见 build-fx.ts 文件头第 3 条）', () => {
    const { before, after } = buildTick();
    expect(boardStateForFilm(after, before, BUILD_FILM).facilityLevel[1]).toBe(2);
    expect(boardStateForFilm(after, before, NO_FILM).facilityLevel[1]).toBe(3);
  });

  it('神明附身：影片窗口里**不能**把神明标记画到主人身上', () => {
    const { before, after } = possessTick();
    const drawn = boardStateForFilm(after, before, BOARD_FILM_PENDING);
    // 主人身上没有神（before）
    expect(drawn.players[0]!.godInfo).toBe(0);
    // 神明还站在原来那一格的地上（before 的 nodeId=7、attached=0）
    expect(drawn.objects[0]!.attached).toBe(0);
    expect(drawn.objects[0]!.nodeId).toBe(7);
    // 窗口一关才切到 after
    const settled = boardStateForFilm(after, before, NO_FILM);
    expect(settled.players[0]!.godInfo).toBe(1);
    expect(settled.objects[0]!.attached).toBe(1);
    expect(settled.objects[0]!.nodeId).toBe(12);
  });

  it('只退回 attached、不退回 nodeId 的写法会画错位 —— 请神符那种「人在别处」的附身', () => {
    const { before, after } = possessTick();
    const drawn = boardStateForFilm(after, before, BOARD_FILM_PENDING);
    // 两项必须同时回到 before：单退回 attached 会让神明站在 12 号格（主人的格）上
    expect(drawn.objects[0]!.nodeId).toBe(before.objects[0]!.nodeId);
    expect(drawn.objects[0]!.attached).toBe(before.objects[0]!.attached);
  });
});

// ============================================================
//  窗口的判据
// ============================================================

describe('窗口判据：四条影片状态位（正在播 / 还没解好）任意一条非空就算开着', () => {
  it('四条各自单独置位都算开着', () => {
    expect(boardFilmWindowOpen(BUILD_FILM)).toBe(true);
    expect(boardFilmWindowOpen({ ...NO_FILM, buildPending: true })).toBe(true);
    expect(boardFilmWindowOpen({ ...NO_FILM, filmPlaying: true })).toBe(true);
    expect(boardFilmWindowOpen(BOARD_FILM_PENDING)).toBe(true);
  });

  it('四条全假 = 关着', () => {
    expect(boardFilmWindowOpen(NO_FILM)).toBe(false);
  });

  it('窗口开着但没记下 before（快照丢了）→ 退化成 after，不许抛', () => {
    const { after } = buildTick();
    expect(visibleBoardState(after, null)).toBe(after);
    expect(boardStateForFilm(after, null, BUILD_FILM)).toBe(after);
  });
});

// ============================================================
//  按住的范围：只动那五项
// ============================================================

describe('按住的范围只限加蓋 / 附身那五项，别的变化照常按 after 画', () => {
  it('同一条 action 里的现金、道具、骰子…仍是 after 的值', () => {
    const before = makeGameState({
      landLevel: [0, 3],
      players: [makePlayer({ index: 0, cash: 1000, points: 10 })],
      stepsRemaining: 2,
      dice: [2],
    });
    const after: GameState = {
      ...before,
      landLevel: [0, 4],
      players: [makePlayer({ index: 0, cash: 4000, points: 60 })],
      stepsRemaining: 0,
      dice: [2],
    };
    const drawn = boardStateForFilm(after, before, BUILD_FILM);
    expect(drawn.landLevel[1]).toBe(3);        // 按住
    expect(drawn.players[0]!.cash).toBe(4000); // 不按住
    expect(drawn.players[0]!.points).toBe(60); // 不按住
    expect(drawn.stepsRemaining).toBe(0);      // 不按住
    expect(drawn.landOwner).toBe(after.landOwner);
  });

  it('没变的下标沿用 after 的元素（只换真的变了的那几格）', () => {
    const before = makeGameState({ landLevel: [2, 3, 0] });
    const after: GameState = { ...before, landLevel: [2, 4, 0] };
    const drawn = visibleBoardState(after, before);
    expect(drawn.landLevel).not.toBe(after.landLevel);
    expect(drawn.landLevel[0]).toBe(2);
    expect(drawn.landLevel[1]).toBe(3);
    expect(drawn.landLevel[2]).toBe(0);
    // 只有被改的那一格换了新数组
    expect(drawn.facilityLevel).toBe(after.facilityLevel);
    expect(drawn.players).toBe(after.players);
    expect(drawn.objects).toBe(after.objects);
  });

  it('一处都没变 → 原样返回 after 本体（不新建对象）', () => {
    const state = makeGameState({ landLevel: [1] });
    expect(visibleBoardState(state, state)).toBe(state);
  });

  it('两个玩家同样变 → 两个都按住，没变的那个沿用原元素', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, godInfo: 0 }), makePlayer({ index: 1, godInfo: 0 })],
    });
    const after: GameState = {
      ...before,
      players: [
        makePlayer({ index: 0, godInfo: 5 }),
        before.players[1]!,
      ],
    };
    const drawn = visibleBoardState(after, before);
    expect(drawn.players[0]!.godInfo).toBe(0);
    expect(drawn.players[1]).toBe(after.players[1]);
  });
});

// ============================================================
//  纯函数：不写原对象
// ============================================================

describe('纯函数：一个字节都不写回 before / after', () => {
  it('调用前后 after / before 的所有被按住字段原值不变', () => {
    const { before, after } = possessTick();
    const snapshot = JSON.stringify({ before, after });
    visibleBoardState(after, before);
    boardStateForFilm(after, before, BUILD_FILM);
    expect(JSON.stringify({ before, after })).toBe(snapshot);
  });

  it('返回的副本改字段也影响不到 after 的数组元素', () => {
    const { before, after } = possessTick();
    const drawn = visibleBoardState(after, before);
    expect(drawn.players[0]).not.toBe(after.players[0]);
    expect(drawn.objects[0]).not.toBe(after.objects[0]);
    expect(after.players[0]!.godInfo).toBe(1);
    expect(after.objects[0]!.attached).toBe(1);
  });
});

// ============================================================
//  main.ts 的接线（源码钉子）—— 与 `god-fx.test.ts` / `confine-fx.test.ts` 同一写法
// ============================================================

describe('★ main.ts 接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('棋盘那一处吃的是 boardDrawState()，不是裸 state（否则整条修复静默失效）', () => {
    expect(src).toContain('state: boardDrawState(),');
    expect(src).toContain('function boardDrawState(): GameState {');
  });

  it('五条影片（建屋 / 住院入獄 / 神明 / 新聞4飛碟 / 惡犬咬人）起播前都记下 before 快照', () => {
    expect(src).toContain('deferredBoardBefore = before;');
    // 2026-09-19：新聞 4「外星人攻打地球」的飛碟影片（房子在 core 里已经被掀掉）
    // 與「踩到惡犬」的狗咬影片（人已經被寫進醫院）都加進来了，故由 3 → 4 → 5 处。
    expect(src.split('deferredBoardBefore = before;').length - 1).toBe(5);
  });

  it('★ 两条影片都要等这一步的走子补间播完才起播（试玩3 #1 的正面）', () => {
    // `tickBuildFx` 与 `tickBoardFilm` 各一处
    expect(src.split('if (!renderer.walkDone(now)) return;').length - 1).toBe(2);
  });
});
