/*
 * 「消失」那两段影片：被外星人綁架的飛碟 / 強迫出國的飛機（第八份试玩回报 #3）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方：「npc触发被外星人绑架3天事件后没有呼出飞碟把人吸走的特效，人物仍然停留在地图上」。
 * 规则早就有了（`core/events/fortune-effects.ts` 的 `disappear` 支：`blocking.disappearing = 天数 | 原因<<6`），
 * 人还留在地图上是绘制那边的事（`render.ts` 的 `confinedPlayerDrawn`），这里补**影片**。
 *
 * @source `fcn_0040d375(玩家, 天数, 原因)` @ VA 0x0040d375 —— 命運 6（出國）/ 7（綁架）共用的收尾：
 * ```asm
 * 0040d3ad  call 0x40d761                    ; 清四个计数 / 占用表（与坐牢住院同一段）
 * 0040d3e6  call 0x41d476                    ; view_to(玩家)
 * 0040d3f8  call 0x44f2c2                    ; 小额损失那一族的台词（金额 = 天数）
 * 0040d425  call 0x44ba63                    ; 保險理賠那一支
 * 0040d44b  test edi, edi / jne 0x40d472     ; ★ edi = 原因：0 出國 / 1 綁架
 * 0040d451  push 0x22e … call 0x450441       ;   出國：Data.mkf #0x22e（飛機）
 * 0040d466  push 0x60 / push 0x140001 / push 0x28 / push edi(=0) / push 影片
 * 0040d476  push 0x215 … call 0x450441       ;   綁架：Data.mkf #0x215（飛碟）
 * 0040d48c  push 0x54 / push 0x1c0001 / push 0x28 / push 0 / push 影片
 * 0040d498  call 0x45144f                    ; ★ 阻塞播完（两支汇到同一处）
 * 0040d4a1  call 0x456e11                    ; free
 * ```
 * 参数（`fcn_0045144f(影片, x, y, flags, 音效)`）的逐位语义见 `confine-fx.ts` 文件头。
 * ⚠️ `fcn_0040d375` 里**没有** `cmp [0x497159], 0`（「動畫過程」开关）—— 与新聞 4 那支同一规矩：照 exe 走，
 *   不看开关（调用点 `main.ts` 的 `startDisappearFx` 也不拦）。
 *
 * 影片规格逐字节核过 `Data.mkf`（`parseFlicInfo`）：
 * | 资源 | 帧数 | 宽×高 | 每帧 | 总长 | 落点 | 音效 | flags |
 * |---|---|---|---|---|---|---|---|
 * | `0x215` 飛碟 | 46 | 440×440 | 71 ms | 3266 ms | (0,40) | 0x54 | 0x1c0001 |
 * | `0x22e` 飛機 | 40 | 440×440 | 42 ms | 1680 ms | (0,40) | 0x60 | 0x140001 |
 *
 * 判据：某位玩家的 `blocking.disappearing` 从 0 变成非 0（原因取高位 `>> 6`）。
 * 影片窗口里棋盘按 **before** 画（人还在，飛碟把他吸走 —— `deferred-board.ts`），
 * 直到 `flags` 第三字节那一帧（飛碟 0x1c = 光柱罩住人、飛機 0x14）原版片中重画一次棋盘，人随之隐掉
 * （`board-film.ts` 的 `boardFilmRedrawFrame`，宿主 `main.ts` 的 `applyBoardFilmRedraw`）。
 */

import { DISAPPEAR_REASON_ABDUCTED } from '@rich4/core';
import type { BoardFilmSpec } from './board-film.ts';

export const DISAPPEAR_FX_ARCHIVE = 'Data.mkf';

/** 被外星人綁架：飛碟 @source `0x0040d476 push 0x215` */
export const ABDUCT_FILM: BoardFilmSpec = {
  id: 'abduct',
  archive: DISAPPEAR_FX_ARCHIVE,
  resource: 0x215,
  frames: 46,
  width: 440,
  height: 440,
  frameMs: 71,
  x: 0,
  y: 0x28,
  sound: 0x54,
  flags: 0x1c0001,
};

/** 強迫出國觀光：飛機 @source `0x0040d451 push 0x22e` */
export const ABROAD_FILM: BoardFilmSpec = {
  id: 'abroad',
  archive: DISAPPEAR_FX_ARCHIVE,
  resource: 0x22e,
  frames: 40,
  width: 440,
  height: 440,
  frameMs: 42,
  x: 0,
  y: 0x28,
  sound: 0x60,
  flags: 0x140001,
};

/**
 * 这一拍有没有人**刚开始消失** —— 有就返回该播的那一段。
 * `disappearing` 的高两位是原因（`fortune-effects.ts`：`天数 | 原因 << 6`）。
 */
export function disappearFxTrigger(
  before: { players: readonly { blocking: { disappearing: number } }[] },
  after: { players: readonly { blocking: { disappearing: number } }[] },
): BoardFilmSpec | null {
  for (let i = 0; i < after.players.length; i++) {
    const a = after.players[i]?.blocking.disappearing ?? 0;
    const b = before.players[i]?.blocking.disappearing ?? 0;
    if (b !== 0 || a === 0) continue;
    return (a >> 6) === DISAPPEAR_REASON_ABDUCTED ? ABDUCT_FILM : ABROAD_FILM;
  }
  return null;
}
