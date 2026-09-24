/*
 * 「影片播放期间棋盘按 before 那一帧画」—— 延迟可见状态
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么需要它（试玩3 #1「神明附身」/ #9「機器工人」，issue #19）：
 *   原版这一族演出是**同步**的：`fcn_0045144f`（VA 0x0045144f，出处见
 *   `board-film.ts` 文件头）自己那个 `PeekMessage` 循环不结束，就回不到结算流程，
 *   棋盘也就**不会重绘**。而本引擎的 core 是「一条 action 把后果一次写完」：
 *
 *   · **加蓋** —— `fcn_0040b110` 先把地块/設施的 `+0x1a` 等级加 1，**再**播
 *     大锤 `Data.mkf` 0x229（蓋到滿級再接 0x20b）。调用序列已在 `build-fx.ts`
 *     文件头逐条取过证（`0x00447345` 在 `0x0044735c` 之前）；
 *   · **附身** —— `attach_object`（VA 0x0040ead7）写 `player + 0x3f`、
 *     `objects[i] + 5`（attached）与 `+2`（所在格），然后在**同一次调用里**
 *     接着走 `_rich4_attach_god`（VA 0x0040ea62）播神明那 12 段。出处见
 *     `god-fx.ts` 文件头。
 *
 *   于是只要照 `state` 画，玩家就会在影片起播**之前**（浏览器里 FLIC 真解码那
 *   几百毫秒，以及「走子补间还没滑完」那段）先看到结果 —— 这正是需求方报的
 *   「效果先于动画可见」。
 *
 * ⇒ 影片这段窗口里，棋盘按**改之前**那一份画；窗口一关（影片播完 / 解码失败
 *   放弃 / 没起播）立刻切回 after。窗口本身由宿主（`main.ts`）按四条影片状态位开关。
 *   ★ 第十四份試玩回報：窗口**没关**也可能提前切回 after —— 原版 `fcn_0045144f` 在
 *   `flags` 第三字节那一帧按当前状态重画一次棋盘（`board-film.ts` 的 `boardFilmRedrawFrame`），
 *   宿主到那一帧就放掉快照（`main.ts` 的 `applyBoardFilmRedraw`）。
 *
 * ★ C-ARC-2：本模块一个规则判断都没有 —— 只是「把 after 里那几处替换回 before」的
 *   纯替换。哪几处要按住是一张**固定清单**（见 `visibleBoardState` 的注释），
 *   每一项的写入点都在 `build-fx.ts` / `god-fx.ts` / `rules/object-landing.ts`
 *   里取过证。
 * ★ C-DET-4：这里不写任何 state，只返回一份**给渲染器看的副本**；原对象一个不改。
 */

import { WHO_PLAYS_WRECKED, type GameState, type MapObject, type Player } from '@rich4/core';
import { wreckedThisAction } from './dog-fx.ts';

/**
 * 这一拍棋盘该按哪一份 state 画。
 *
 * 影片窗口内要**按住**（换回 before）的只有五项，每一项的写入点都取过证：
 *
 * | 字段 | 谁写的 | 哪一段影片 | 出处 |
 * |---|---|---|---|
 * | `landLevel[i]` | `fcn_0040b110`（地块记录 `+0x1a` 加 1）| 大锤 `0x229` → 滿級 `0x20b` | `build-fx.ts` 文件头 |
 * | `landOwner/landType/facilityOwner/facilityType[i]`（跟等级同进退）| `damage_area`（飛彈夷平連鎖店 / 核彈清归属）| 爆炸 `0x210` | `0x40ad30` / `0x40ad6b` |
 * | `facilityLevel[i]` | 同一支的**設施**分支（同是 `+0x1a`）| 同上 | `build-fx.ts` 文件头第 3 条 |
 * | `players[i].godInfo` | `attach_object`（`player + 0x3f`）| 神明 12 段 | `god-fx.ts` 文件头 |
 * | `objects[i].attached` | `attach_object`（`objects[i] + 5`）| 神明 12 段 | `god-fx.ts` + `rules/object-landing.ts` 的 `@source` |
 * | `objects[i].nodeId` | 同上（`objects[i] + 2` ← 主人所在格）| 神明 12 段 | 同上 |
 *
 * | `players[i].blocking.disappearing` | `fcn_0040d375`（`+0x33`）| 飛碟 / 飛機 | `disappear-fx.ts` 文件头 |
 * | `players[i]` 的位置 + `inHospital/inPrison`（**刚被送进去**的那位）| `send_to_hospital` / `..._prison`（`0x43ec3f` / `0x43d593`）| 救护车 / 入獄 | `holdBackPlayers` 注释（第八份 #8）|
 * | `players[i].whoPlays` 的 `WHO_PLAYS_WRECKED` 位（同上那位，惡犬/地雷/炸彈）| `0x40cd07`（`or 0x40`）| 救护车 | `dog-fx.ts` 的 `wreckedThisAction` |
 *
 * ⚠️ **只按住这几项**，不是整个棋盘退回 before：同一条 action 里的其它变化
 *   （现金、道具、骰子…）照常按 after 画。
 *
 * @param after core 已经写完的那一份（`state`）
 * @param before 影片**起播那一拍之前**的那一份；窗口没开就给 `null`
 * @returns 窗口开着 → after 的五项被换回 before；否则原样返回 after
 */
export function visibleBoardState(
  after: GameState,
  before: GameState | null,
  /**
   * ★ 等级（`landLevel` / `facilityLevel`）要不要按住。
   *
   * 機器工人那一段（大锤 `0x229`）要**中途放开**：工人出场时房子还是旧的、
   * 敲完那一拍才换成新模型（`build-fx.ts` 的 `buildHammerDone`，第 48 帧 = 2736 ms）。
   * 其余几类影片（神明 / 救护车 / 入獄 / 飛碟）恒为 `true` —— 它们按住的是
   * 「别让玩家提前看到后果」，与建屋那一段的诉求不同。
   */
  holdLevels = true,
  /**
   * ★ 物件（`objects[i].attached/nodeId`）要不要按住。
   *
   * 只有「两段串行」的第一段做完片中重画之后放开（第十四份試玩回報「狗咬完狗就该消失」）：
   * 惡犬 / 地雷那两支先 `remove_object`（`0x0041b845` / `0x0041be8c`）再播 0x214 / 0x20d，
   * 片子第 3 个计数（`flags` 0x30001，见 `board-film.ts` 的 `boardFilmRedrawFrame`）重画棋盘
   * ⇒ 狗 / 地雷当场没了；而入院者的位置要到**第二段**（救护车）里 `send_to_hospital` 才改，
   * 所以那时玩家仍按住（乞丐站在原格）。其余情况恒为 `true`。
   */
  holdObjects = true,
): GameState {
  // 窗口没开：一个字节都不动，直接交 after（引用相等，渲染器那边零成本）
  if (before === null) return after;

  const landLevel = holdLevels ? holdBackNumbers(after.landLevel, before.landLevel) : after.landLevel;
  const facilityLevel = holdLevels
    ? holdBackNumbers(after.facilityLevel, before.facilityLevel)
    : after.facilityLevel;
  // ★ 2026-09-24：建筑的**归属 / 种类**与等级一起按住 —— 飛彈把連鎖店夷平（`0x40ad30 [+0x18]=0`）、
  //   核彈连归属一起清（`0x40ad6b..0x40ad77`）都在 `damage_area`（`0x44707a` / `0x447b8c`）里、
  //   **影片之前**写完；片中第 9 个计数（`0x90001` 的第三字节）才重画棋盘。
  //   先前只按住等级 ⇒ 片子前段看到的是「旧等级 + 新种类 / 无主」拼出来的样子。
  const landOwner = holdLevels ? holdBackNumbers(after.landOwner, before.landOwner) : after.landOwner;
  const landType = holdLevels ? holdBackNumbers(after.landType, before.landType) : after.landType;
  const facilityOwner = holdLevels
    ? holdBackNumbers(after.facilityOwner, before.facilityOwner)
    : after.facilityOwner;
  const facilityType = holdLevels
    ? holdBackNumbers(after.facilityType, before.facilityType)
    : after.facilityType;
  const players = holdBackPlayers(after.players, before.players, { before, after });
  const objects = holdObjects ? holdBackObjects(after.objects, before.objects) : after.objects;

  // 一处都没被改过（这一段影片改的是别的字段）→ 不必新建对象
  if (
    landLevel === after.landLevel
    && facilityLevel === after.facilityLevel
    && landOwner === after.landOwner
    && landType === after.landType
    && facilityOwner === after.facilityOwner
    && facilityType === after.facilityType
    && players === after.players
    && objects === after.objects
  ) {
    return after;
  }
  return { ...after, landLevel, facilityLevel, landOwner, landType, facilityOwner, facilityType, players, objects };
}

/** 逐项按住：只换**真的变了**的那些下标，没变的沿用 after 的元素 */
function holdBackNumbers(after: number[], before: readonly number[]): number[] {
  let changed = false;
  const out = after.map((value, i) => {
    const b = before[i];
    if (b === undefined || value === b) return value;
    changed = true;
    return b;
  });
  return changed ? out : after;
}

/**
 * 玩家身上按住三样：`godInfo`（附身标记）、`blocking.disappearing`（第八份试玩回报 #3）、
 * **刚被送进監獄／醫院的那一位的位置**（第八份试玩回报 #8）。
 *
 * ★ 消失：`fcn_0040d375` 在**播飛碟 / 飛機之前**就写了 `+0x33`（`0x0040d43a`），但影片是盖在
 *   `view_to`（`0x0040d3e6`）那一次重绘的**存下来的背景**上播的 —— 那一帧人还在。影片收屏后的第一次
 *   重绘才按 `+0x33 != 0` 把他隐掉（`render.ts` 的 `confinedPlayerDrawn`）。⇒ 影片**起播时**按 before 画。
 *   ⚠️ 第十四份試玩回報订正：「收屏后的第一次重绘」不对 —— 片中就有一次重绘（`flags` 第三字节：
 *   飛碟 0x1c、飛機 0x14，`board-film.ts` 的 `boardFilmRedrawFrame`），到那一帧宿主放掉快照，人随之隐掉。
 *
 * ★ 送醫院 / 送監獄：`send_to_hospital`（`0x43ec3f`）先 `0x0043ec78 view_to(玩家现在的位置)` 重绘一帧，
 *   **然后**才改 `+0x0c`（所在格）/ `+0x08,+0x0a`（坐标）/ `+0x35`（住院天数），再把救护车片
 *   （440×74 的一条，`confine-fx.ts`）盖在那一帧上播；播完 `0x0043eda0 view_to(新位置)` 才切到醫院。
 *   監獄那支（`0x43d593`）同一结构。⇒ 影片窗口里人还**站在事发那一格**，不能按 after 隐掉。
 *   另外 `0x40cd07`（惡犬 / 地雷 / 炸彈）在这之前给他 `or who_plays, 0x40` 重载成**乞丐造型**
 *   （`WHO_PLAYS_WRECKED`，判据 `dog-fx.ts` 的 `wreckedThisAction`），`send_to_hospital` 到
 *   `0x0043ecad and 0xf` 才清 —— 所以救护车开到他身上之前他是乞丐。
 *   ★ 第十四份試玩回報：人**不是**等片子播完才隐掉 —— 救护车 0x20c / 警车 0x21a 的 `flags` 第三字节
 *   = 0x1e / 0x12 ⇒ 第 30 / 18 个计数（车正盖在人身上那一帧）片中重画一次棋盘，那时位置已改 ⇒ 人没了
 *   （`main.ts` 的 `applyBoardFilmRedraw` 放掉快照）；镜头仍等片子播完才去醫院／監獄。
 */
function holdBackPlayers(after: Player[], before: readonly Player[], snapshot?: { before: GameState; after: GameState }): Player[] {
  let changed = false;
  const out = after.map((p, i) => {
    const b = before[i];
    if (b === undefined) return p;
    const godChanged = p.godInfo !== b.godInfo;
    const vanished = p.blocking.disappearing !== b.blocking.disappearing;
    const confinedNow =
      (b.blocking.inHospital === 0 && p.blocking.inHospital !== 0)
      || (b.blocking.inPrison === 0 && p.blocking.inPrison !== 0);
    if (!godChanged && !vanished && !confinedNow) return p;
    changed = true;
    const wrecked = confinedNow && snapshot !== undefined && wreckedThisAction(snapshot.before, snapshot.after, i);
    return {
      ...p,
      ...(godChanged ? { godInfo: b.godInfo } : {}),
      ...(confinedNow
        ? {
            nodeId: b.nodeId,
            lastNodeId: b.lastNodeId,
            xpos: b.xpos,
            ypos: b.ypos,
            direction: b.direction,
            whoPlays: wrecked ? p.whoPlays | WHO_PLAYS_WRECKED : p.whoPlays,
          }
        : {}),
      ...(vanished || confinedNow
        ? {
            blocking: {
              ...p.blocking,
              ...(vanished ? { disappearing: b.blocking.disappearing } : {}),
              ...(confinedNow ? { inHospital: b.blocking.inHospital, inPrison: b.blocking.inPrison } : {}),
            },
          }
        : {}),
    };
  });
  return changed ? out : after;
}

/**
 * 物件按住两项：`attached`（附在人身上 = 不画在地图上）与 `nodeId`（在哪一格）。
 *
 * ★ 两项必须一起按住：`attach_object` 把 `nodeId` 也改成了主人所在格。
 *   只退回 `attached` 的话，神明会「站在主人脚边那一格的地上」——
 *   落点踩上去时两者恰好相同看不出来，但請神符那种「人在别处」的附身会画错位。
 */
function holdBackObjects(
  after: MapObject[],
  before: readonly MapObject[],
): MapObject[] {
  let changed = false;
  const out = after.map((o, i) => {
    const b = before[i];
    if (b === undefined) return o;
    if (o.attached === b.attached && o.nodeId === b.nodeId) return o;
    changed = true;
    return { ...o, attached: b.attached, nodeId: b.nodeId };
  });
  return changed ? out : after;
}

/**
 * 这一拍有哪些影片还在 —— **四条状态位**，宿主手里本来就是分开的四个变量。
 *
 * ★ 为什么不是按时间算：建屋是两段式（大锤 → 滿級），棋盘影片又有「该播、影片还
 *   在解」那一段；两者各有自己的时间轴与收摊条件，窗口开着的充要条件就是这四条里
 *   有一条非空。时间轴的判据（帧号 / 总长）归 `board-film.ts` / `build-fx.ts`，
 *   本模块不重复实现一遍，免得两处判据漂移。
 */
export interface BoardFilmWindow {
  /** 正在播的建屋影片（`main.ts` 的 `buildFx !== null`）*/
  buildPlaying: boolean;
  /** 建屋影片还没解好（`pendingBuildFx !== null`）*/
  buildPending: boolean;
  /** 正在播的棋盘影片（`boardFilm !== null`）*/
  filmPlaying: boolean;
  /** 棋盘影片还没解好（`pendingBoardFilm !== null`）*/
  filmPending: boolean;
  /**
   * ★ 第八份试玩回报 #8：**接着还要播一段**（`pendingBoardFilmAfter !== null`，狗咬 → 救护车）。
   *   两段之间那一拍 `boardFilm` / `pendingBoardFilm` 都是空 —— 不算进来的话窗口会「关一下」：
   *   镜头当场跳到醫院（`cameraFollowTarget` 的 `confined` 支读 after 的 `xpos`）、棋盘按 after 画，
   *   随后救护车才起播 —— 正是需求方看到的「镜头直接转到医院然后播放救护车动画」。
   *   原版两次 `fcn_0045144f` 是背靠背的阻塞调用，中间没有重绘。
   */
  filmQueued?: boolean;
}

/** 窗口开着吗 = 五条里有一条非空 */
export function boardFilmWindowOpen(w: BoardFilmWindow): boolean {
  return w.buildPlaying || w.buildPending || w.filmPlaying || w.filmPending || w.filmQueued === true;
}

/**
 * 宿主一步到位的入口：窗口开着就用 `before` 作底，窗口一关立刻用 `after`。
 *
 * @param before 影片起播那一拍之前的那一份快照（`main.ts` 的 `deferredBoardBefore`）
 */
export function boardStateForFilm(
  after: GameState,
  before: GameState | null,
  w: BoardFilmWindow,
  /** 见 `visibleBoardState` 的第三个参数 —— 機器工人大锤片要中途放开等级 */
  holdLevels = true,
  /** 见 `visibleBoardState` 的第四个参数 —— 串行两段的第一段重画之后放开物件 */
  holdObjects = true,
): GameState {
  return visibleBoardState(after, boardFilmWindowOpen(w) ? before : null, holdLevels, holdObjects);
}
