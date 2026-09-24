/*
 * 「降落伞落地」—— 每位玩家**自己的第一个回合**开头那一段棋盘影片
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「谁刚落地、该播哪一段、规格是什么、这段期间谁先别画」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history** —— 摆人与落地由 core 在回合交接时一次做完
 *   （`core/src/rules/start-placement.ts`），这里按「before 没上盘、after 上了盘」补播。
 *
 * 需求方 2026-09-24：「开局时第一个玩家行动时理论上地图只有他，其他玩家在第一回合要轮到了
 * 才有个降落伞特效出现在地图上」。
 *
 * ## 原版（回合决策驱动 `fcn_00418c55` 的第一段，`disasm.py va 0x418c55 75`）
 *
 * ```asm
 * 00418c59  cmp  dword [0x475114], 0          ; 棋盘重画 0x40829d 刚摆了人？（= 玩家 + 1）
 * 00418c60  je   0x418d2a
 * 00418c6b  cmp  eax, [0x499114]              ; 当前是玩家（不是惡人）
 * 00418c7e  mov  al, byte [eax + 0x496b7b]    ; 当前玩家的角色号（+0x13）
 * 00418c89  add  eax, 0x22f                   ; ★ 资源号 = 0x22f + 角色
 * 00418c96  call 0x450441                     ; read_mkf([0x48a0e4] = Data.mkf, 0x22f + 角色, 0, 0)
 * 00418ca0  push -1 / push 1 / push 0x28 / push 0 / push eax
 * 00418ca9  call 0x45144f                     ; ★ 播：屏幕 (0, 0x28) 整块棋盘、flags 1、音效 −1（不放）
 * 00418cde  mov  word [player + 0x08], dx     ; 这才写坐标 ⇒ **影片期间人不在盘上**（棋子绘制
 * 00418cfa  mov  word [player + 0x0a], dx     ;   `0x00408684 cmp [player+0x08], 0` / 小地图 `0x00416fc9` 同判据）
 * 00418d07  mov  byte [player + 0x15], dl     ; who_plays ← +0x64
 * 00418d0e  call 0x40b93b                     ; 重载棋子
 * 00418d22  call 0x41d476(0, 0, 1)            ; 原镜头重画（人出现了）
 * ```
 * 接下来才是掷骰 / 电脑决策。**没有台词**（这一段里没有 `call 0x44ef41`），也**没有**「動畫過程」闸
 * （`cmp byte [0x497159], 0` 零命中）。镜头在摆人那一次重画里已经对准落点（`0x0040829d` 摆完把
 * `(x, y)` 换成那一格的坐标再居中，`0x00408375..0x004083a8`）。
 *
 * flags = 1：bit0 存背景；bit1 = 0 ⇒ **点不掉**（`0x004514d6`）；第三字节 0 ⇒ 片中不重画；不循环。
 *
 * ## 影片规格（逐字节读 `Data.mkf` 资源头，`parseFlicInfo`；嵌入源路径 `D:\RICH4\DDDD\Dnn.FLC`）
 *
 * | 角色 | 资源 | 帧数 | 每帧 | | 角色 | 资源 | 帧数 | 每帧 |
 * |---|---|---|---|---|---|---|---|---|
 * | 0 | `0x22f` | 34 | 42 ms | | 6 | `0x235` | 33 | 42 ms |
 * | 1 | `0x230` | 35 | 42 ms | | 7 | `0x236` | 39 | 42 ms |
 * | 2 | `0x231` | 34 | 42 ms | | 8 | `0x237` | 30 | 42 ms |
 * | 3 | `0x232` | 39 | 42 ms | | 9 | `0x238` | 39 | 42 ms |
 * | 4 | `0x233` | 30 | 42 ms | | 10 | `0x239` | 33 | 42 ms |
 * | 5 | `0x234` | 40 | 42 ms | | 11 | `0x23a` | 35 | 42 ms |
 *
 * 全部 440×440（整块棋盘）。
 */

import type { GameState } from '@rich4/core';
import { isUnplaced } from '@rich4/core';
import type { BoardFilmSpec } from './board-film.ts';

/** 落地影片的资源基数 @source VA 0x00418c89 `add eax, 0x22f`（+ 角色号 `+0x13`）*/
export const LANDING_FX_BASE = 0x22f;

/** 落地影片所在档案 @source VA 0x00418c8f `mov esi, [0x48a0e4]`（= Data.mkf，与建屋片同一个句柄）*/
export const LANDING_FX_ARCHIVE = 'Data.mkf';

/**
 * 各角色那一段的帧数（下标 = 角色号 0..11）@source `Data.mkf` 资源 0x22f..0x23a 的 FLIC 头 +0x06
 *   （`landing-fx.test.ts` 逐字节核对）
 */
export const LANDING_FX_FRAMES: readonly number[] = [34, 35, 34, 39, 30, 40, 33, 39, 30, 39, 33, 35];

/** 每帧毫秒 @source 同上，FLIC 头 +0x10（十二段都是 42）*/
export const LANDING_FX_FRAME_MS = 42;

/** 整块棋盘 @source FLIC 头 +0x08 / +0x0a */
export const LANDING_FX_W = 440;
export const LANDING_FX_H = 440;

/** 屏幕落点 (0, 0x28) = 棋盘左上角 @source VA 0x00418ca6 `push 0` / 0x00418ca4 `push 0x28` */
export const LANDING_FX_X = 0;
export const LANDING_FX_Y = 0x28;

/** `fcn_0045144f` 的 flags @source VA 0x00418ca2 `push 1` */
export const LANDING_FX_FLAGS = 1;

/** 音效号：−1 = 不放 @source VA 0x00418ca0 `push -1` */
export const LANDING_FX_SOUND = -1;

/** 这位角色那一段落地影片 */
export function landingFilmSpec(character: number): BoardFilmSpec {
  return {
    id: `landing-${character}`,
    archive: LANDING_FX_ARCHIVE,
    resource: LANDING_FX_BASE + character,
    frames: LANDING_FX_FRAMES[character] ?? LANDING_FX_FRAMES[0]!,
    width: LANDING_FX_W,
    height: LANDING_FX_H,
    frameMs: LANDING_FX_FRAME_MS,
    x: LANDING_FX_X,
    y: LANDING_FX_Y,
    sound: LANDING_FX_SOUND,
    flags: LANDING_FX_FLAGS,
  };
}

/**
 * 这一条 action 里**刚落地**的是谁（before 还没上盘、after 上了盘）；没有就 `null`。
 *
 * ★ 一条 action 至多一人：落地只发生在回合交接给他的那一刻（core 的 `startActorTurn`）。
 */
export function landingTrigger(before: GameState, after: GameState): number | null {
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (isUnplaced(b) && !isUnplaced(a) && a.xpos !== 0) return i;
  }
  return null;
}

/**
 * 开局那一刻：第 1 位（`newGame` 已经把他摆好、落了地）要不要补一段落地影片。
 *
 * 原版新开一局是 `0x406de7 → … → 0x415872`（跳伞过场）→ `0x401981` 进棋盘，第一次重画就摆第 1 位，
 * 随后 `0x418c55` 播他那一段 ⇒ **只有新开的局**才有（读档 / 联机重连进来的局不补）。
 * 判据：一步都还没走（`turnCount == 0`）、当前玩家已上盘、而且还有人没上盘（真是开局那一刻）。
 */
export function openingLandingPlayer(state: GameState): number | null {
  if (state.turnCount !== 0) return null;
  const me = state.players[state.currentPlayer];
  if (me === undefined || me.xpos === 0) return null;
  if (!state.players.some((p) => isUnplaced(p))) return null;
  return state.currentPlayer;
}

/**
 * 影片期间棋盘 / 小地图上**先别画这位** —— 原版此时坐标还是 0（`0x00418cde` 在影片之后才写）。
 * 只改坐标（棋子绘制与小地图都认 `xpos == 0`）；侧栏照常（那里读的是现金 / 存款）。
 */
export function hideLandingPlayer(state: GameState, player: number): GameState {
  const p = state.players[player];
  if (p === undefined || (p.xpos === 0 && p.ypos === 0)) return state;
  return {
    ...state,
    players: state.players.map((q, i) => (i === player ? { ...q, xpos: 0, ypos: 0 } : q)),
  };
}
