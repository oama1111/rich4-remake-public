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
import { WHO_PLAYS_WRECKED, makeGameState, makePlayer, type GameState, type MapObject } from '@rich4/core';
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

// ⚠️ 2026-09-22（第八份 #6）：`main.ts` 的 `startBuildFx` **不再**给建屋影片传 before（原版大锤片下面就是加好的
//    那一级）。下面两条「建屋」用例钉的是**纯函数**「给了 before 就按住等级」这条契约（神明那几段仍靠它），
//    不代表建屋影片现在还按。
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

  it('★ 第八份 #8：「接着还要播一段」（狗咬 → 救护车之间那一拍）也算开着 —— 镜头不能在这一拍跳去醫院', () => {
    expect(boardFilmWindowOpen({ ...NO_FILM, filmQueued: true })).toBe(true);
    expect(boardFilmWindowOpen({ ...NO_FILM, filmQueued: false })).toBe(false);
  });

  it('全假 = 关着', () => {
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

  /*
   * ★★ 第九份试玩回报：機器工人大锤片要**中途放开**等级（第 48 帧 = 2736 ms）。
   *   这是那一档的机制面 —— `holdLevels = false` 时等级按 after 画（新房子），
   *   而神明 / 位置那几项**仍然**按 before 按住（它们是别条影片的诉求）。
   */
  describe('holdLevels —— 機器工人中途放开等级', () => {
    const before = makeGameState({
      landLevel: [2, 0],
      facilityLevel: [1, 0],
      players: [makePlayer({ index: 0, godInfo: 0 }), makePlayer({ index: 1, godInfo: 0 })],
    });

    it('按住时（缺省）：等级按 before 画 —— 工人出场时房子还没修好', () => {
      const after: GameState = { ...before, landLevel: [3, 0], facilityLevel: [2, 0] };
      const drawn = visibleBoardState(after, before);
      expect(drawn.landLevel[0]).toBe(2);
      expect(drawn.facilityLevel[0]).toBe(1);
    });

    it('★ 放开后（holdLevels = false）：等级按 after 画 —— 敲完那一拍换新模型', () => {
      const after: GameState = { ...before, landLevel: [3, 0], facilityLevel: [2, 0] };
      const drawn = visibleBoardState(after, before, false);
      expect(drawn.landLevel[0]).toBe(3);
      expect(drawn.facilityLevel[0]).toBe(2);
      // 等级那一对直接沿用 after 的数组本体（渲染器零成本）
      expect(drawn.landLevel).toBe(after.landLevel);
      expect(drawn.facilityLevel).toBe(after.facilityLevel);
    });

    it('★ 放开等级**不影响**神明 / 物件那几项（它们仍按 before 按住）', () => {
      const godAttached = makePlayer({ index: 0, godInfo: 1 });
      const after: GameState = {
        ...before,
        landLevel: [3, 0],
        players: [godAttached, before.players[1]!],
      };
      const drawn = visibleBoardState(after, before, false);
      expect(drawn.landLevel[0], '等级放开').toBe(3);
      expect(drawn.players[0]!.godInfo, '神明仍按住（还没附身）').toBe(0);
    });
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
//  第八份试玩回报 #8：送醫院 / 送監獄那一拍，人留在事发格；惡犬 / 地雷 / 炸彈 → 乞丐造型
// ============================================================

describe('★ 刚被送进醫院 / 監獄的人在影片窗口里留在**事发那一格**（`send_to_hospital` 先 view_to 重绘、后改位置）', () => {
  /** 玩家 0 站在 7 号格踩到惡犬（槽 0）：after 里人已经在醫院格 23、住院 3 天，狗收走 */
  function dogTick(over: { object?: MapObject; f64Before?: number; f64After?: number } = {}) {
    const before = makeGameState({
      objects: [over.object ?? obj(11, 7, 0)],
      players: [
        makePlayer({ index: 0, nodeId: 7, lastNodeId: 6, xpos: 100, ypos: 200, direction: 3, whoPlays: 1, f64: over.f64Before ?? 0 }),
        makePlayer({ index: 1, nodeId: 30 }),
      ],
    });
    const after = makeGameState({
      objects: [obj(over.object?.type ?? 11, 0, 0)],
      players: [
        makePlayer({
          index: 0,
          nodeId: 23,
          lastNodeId: 0,
          xpos: 900,
          ypos: 900,
          direction: 0xf,
          whoPlays: 1,
          f64: over.f64After ?? 0,
          blocking: { ...before.players[0]!.blocking, inHospital: 3 },
        }),
        before.players[1]!,
      ],
    });
    return { before, after };
  }

  it('位置 / 朝向 / 住院计数按回 before ⇒ `confinedPlayerDrawn` 仍画他、且画在狗格上', () => {
    const { before, after } = dogTick();
    const drawn = visibleBoardState(after, before);
    const p = drawn.players[0]!;
    expect(p.nodeId).toBe(7);
    expect(p.lastNodeId).toBe(6);
    expect(p.xpos).toBe(100);
    expect(p.ypos).toBe(200);
    expect(p.direction).toBe(3);
    expect(p.blocking.inHospital).toBe(0);
    // 没变的那位沿用原元素
    expect(drawn.players[1]).toBe(after.players[1]);
  });

  it('★ 惡犬被踩掉 ⇒ 挂上 `WHO_PLAYS_WRECKED`（乞丐造型）；after 本体的 whoPlays 不动', () => {
    const { before, after } = dogTick();
    const drawn = visibleBoardState(after, before);
    expect(drawn.players[0]!.whoPlays & WHO_PLAYS_WRECKED).toBe(WHO_PLAYS_WRECKED);
    expect(drawn.players[0]!.whoPlays & 0x3).toBe(1);
    expect(after.players[0]!.whoPlays).toBe(1);
  });

  it('★ 地雷（17）被踩掉 / 背的炸彈炸了（f64 → 0）⇒ 同样乞丐', () => {
    const mine = dogTick({ object: obj(17, 7, 0) });
    expect(visibleBoardState(mine.after, mine.before).players[0]!.whoPlays & WHO_PLAYS_WRECKED).toBe(WHO_PLAYS_WRECKED);
    const bomb = dogTick({ object: obj(18, 0, 0), f64Before: 1, f64After: 0 });
    expect(visibleBoardState(bomb.after, bomb.before).players[0]!.whoPlays & WHO_PLAYS_WRECKED).toBe(WHO_PLAYS_WRECKED);
  });

  it('卡片 / 新聞把人送进醫院（没有物件被踩掉）⇒ 位置照按住，但**不是**乞丐', () => {
    const { before, after } = dogTick({ object: obj(11, 0, 0) }); // 狗本来就不在盘上
    const drawn = visibleBoardState(after, before);
    expect(drawn.players[0]!.nodeId).toBe(7);
    expect(drawn.players[0]!.whoPlays & WHO_PLAYS_WRECKED).toBe(0);
  });

  it('送監獄同一套：位置按住、`inPrison` 按回 0', () => {
    const before = makeGameState({ players: [makePlayer({ index: 0, nodeId: 7, xpos: 100, ypos: 200 })] });
    const after = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, xpos: 5, ypos: 5, blocking: { ...before.players[0]!.blocking, inPrison: 2 } })],
    });
    const drawn = visibleBoardState(after, before);
    expect(drawn.players[0]!.nodeId).toBe(7);
    expect(drawn.players[0]!.blocking.inPrison).toBe(0);
    expect(drawn.players[0]!.whoPlays & WHO_PLAYS_WRECKED).toBe(0);
  });

  it('本来就住着院（3 → 6 加刑）⇒ **不**按位置：他本来就不在盘上', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 23, blocking: { ...makePlayer().blocking, inHospital: 3 } })],
    });
    const after = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 23, blocking: { ...makePlayer().blocking, inHospital: 6 } })],
    });
    expect(visibleBoardState(after, before).players).toBe(after.players);
  });

  it('窗口一关（`boardStateForFilm` 四位全空）⇒ 立刻按 after：人隐掉、镜头去醫院', () => {
    const { before, after } = dogTick();
    expect(boardStateForFilm(after, before, NO_FILM)).toBe(after);
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

  it('影片起播前都记下 before 快照；建屋那段按「大锤族才按、中途放开」', () => {
    expect(src).toContain('deferredBoardBefore = before;');
    // 2026-09-19：新聞 4「外星人攻打地球」的飛碟影片（房子在 core 里已经被掀掉）
    // 與「踩到惡犬」的狗咬影片（人已經被寫進醫院）先加进来（3 → 4 → 5），
    // 收尾又补了**飛彈/核彈爆炸**（`startMissileFx`，整幅盖住棋盘）⇒ 6 处；
    // 2026-09-22 第八份 #3 再加**被綁架的飛碟 / 出國的飛機**（`startDisappearFx`）⇒ 7 处；
    // 同日第八份 #6 把**建屋**那段拿掉 ⇒ 6 处；
    // 同日第九份**又把它加回来**，但改成「按住、走到第 48 帧再放开」⇒ 7 处。
    // ⚠️ 「惡魔顯靈拆屋」（`startDevilFx`）是**第 7 条影片**，但它填的是
    //    `deferredBoardBefore = after;`（原版先拆、重画、再播）⇒ 不计在这里，
    //    由 `devil-fx.test.ts` 的源码钉单独管。
    // 2026-09-23 第十二份：新聞 5/15/20/21 的整块影片（`startNewsPlaceFx`，龍捲風 0x217 等）⇒ 8 处。
    // 2026-09-23 魔法屋「就地拆除房屋」0x211（`startMagicDemolishFx`：框那 1500 ms 房子还在，
    //   起播那一刻由 `releaseBoardOnStart` 放开 —— 原版先拆、重画、再播）⇒ 9 处。
    // 2026-09-24 第二十二份：新聞 18 地震 / 19 山洪的白闪（`startNewsFlash`：事件框 + 闪 880 ms 期间房子还在，
    //   闪完 `view_to(0, 0, 1)` 那一拍才放开）⇒ 10 处。
    expect(src.split('deferredBoardBefore = before;').length - 1).toBe(10);
    expect(src).toContain('if (pending.releaseBoardOnStart === true) deferredBoardBefore = null;');
    expect(src).toContain('deferredBoardBefore = after;');
  });

  it('★★ 建屋那一段只在**大锤族**按住，并按第 48 帧中途放开', () => {
    // 只在 plan.hammer 时按 —— 天使卡 / 自己的地升級那两条没有大锤段
    // ★ 2026-09-22（第十一份試玩回報 #11）：改成**无条件**写快照了（收摊也会清）——
    //   先前只在 `plan.hammer` 时写，配上「收摊不清」正好让过期快照继续生效。
    expect(src).toContain('deferredBoardBefore = before;');
    expect(src).not.toContain('if (plan.hammer) deferredBoardBefore = before;');
    // 放开那一拍的判据交给 build-fx.ts（纯函数，可单测）
    expect(src).toContain('const released = buildFx !== null && buildHammerDone(buildFx, now);');
    // 第十四份試玩回報：多了「片中重画后只按住人」那一档（`playersOnly`），`!released` 这一项照旧
    expect(src).toContain('boardStateForFilm(state, deferredBoardBefore, boardFilmWindowFlags(), !released && !playersOnly, !playersOnly)');
  });

  it('★ 两条影片都要等这一步的走子补间播完才起播（试玩3 #1 的正面）', () => {
    // `tickBuildFx` 与 `tickBoardFilm` 各一处
    expect(src.split('if (!renderer.walkDone(now)) return;').length - 1).toBe(2);
  });
});

// ============================================================
//  ★ 2026-09-24：飛彈 / 核彈 —— 归属与种类跟等级一起按住，到片中重画那一帧才放
// ============================================================

describe('★ 爆炸片（0x210）窗口里：建筑的归属 / 种类跟等级一起按住', () => {
  /**
   * 飛彈把 1 号地（3 级連鎖店）夷平成 0 级住宅（`0x40ad30 [+0x1a]=0 / [+0x18]=0`）、
   * 核彈把 1 号設施的归属 / 种类清掉（`0x40ae45..`）—— 都写在 `damage_area` 里、**影片之前**。
   */
  function blastTick(): { before: GameState; after: GameState } {
    const before = makeGameState({
      landLevel: [0, 3],
      landOwner: [0, 2],
      landType: [0, 1],
      facilityLevel: [0, 2],
      facilityOwner: [0, 1],
      facilityType: [0, 3],
      players: [makePlayer({ index: 0, cash: 1000 })],
    });
    const after: GameState = {
      ...before,
      landLevel: [0, 0],
      landType: [0, 0],
      facilityLevel: [0, 0],
      facilityOwner: [0, 0],
      facilityType: [0, 0],
    };
    return { before, after };
  }

  it('窗口开着：等级、种类、归属全按 before 画（不会出现「3 级住宅」「无主的 2 级設施」这种拼出来的样子）', () => {
    const { before, after } = blastTick();
    const shown = visibleBoardState(after, before);
    expect(shown.landLevel[1]).toBe(3);
    expect(shown.landType[1]).toBe(1);
    expect(shown.facilityLevel[1]).toBe(2);
    expect(shown.facilityOwner[1]).toBe(1);
    expect(shown.facilityType[1]).toBe(3);
  });

  it('片中重画那一帧（放开等级）之后：全按 after', () => {
    const { before, after } = blastTick();
    const shown = visibleBoardState(after, before, false);
    expect(shown.landLevel[1]).toBe(0);
    expect(shown.landType[1]).toBe(0);
    expect(shown.facilityOwner[1]).toBe(0);
    expect(shown.facilityType[1]).toBe(0);
  });

  it('窗口关着（before = null）：原样交 after', () => {
    const { after } = blastTick();
    expect(visibleBoardState(after, null)).toBe(after);
  });
});
