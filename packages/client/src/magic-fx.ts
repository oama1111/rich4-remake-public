/*
 * 魔法屋效果那几段**棋盘上的演出**（女巫窗口关掉之后、`0x431caa` 里的那一部分）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么单独一个模块：女巫窗口（`magic-screen.ts`）只管 `0x4325c2` 那扇窗；
 *   窗口返回之后 `0x004339c5 call 0x431caa` 对每个中签者施加效果，其中「就地拆除房屋」
 *   这一支自己还要播一段影片（`Data.mkf` 0x211，工人拆房 + 烟尘）—— 先前一处都没接。
 *
 * ## 「就地拆除房屋」那一支（`loc_00432259`）
 *
 * ```asm
 * 00432259  cmp dword [player+0x32], 0 / jne 跳过         ; 住店/消失/坐牢/住院中 → 整支不做
 *           格型别 ∈ (0x7d0, 0x1770) 否则跳过
 *           push 1 / call 0x41906a
 *           sprintf("%s\n\n", 名字) + strcat("就地拆除房屋") → 0x004322f5 call 0x440cac(…, 0x5dc)   ; ① 訊息框
 *           0x40af12(格型别, &x, &y)
 * 0043231a  push 0x211 / read_mkf(Data.mkf)
 * 00432341  call 0x41d476(x, y, 0)                          ; ② view_to 那块地
 * 0043234c  call 0x40ab4a(格型别, 0)                         ; ③ 拆一层（里面 `0x40a4e1` 重画地图）
 * 00432354  push 0x61 / push 0x260001 / push 0x28 / push 0 / push 影片
 * 00432360  call 0x45144f                                   ; ④ 影片：落 (0, 0x28)、音效 0x61
 *           free
 * 00432094  push 0x46482f / push 0 / push 中签者 / call player_say   ; ⑤「？？？...」
 * ```
 * ⇒ 次序：**框 → 镜头 → 拆（地图已重画）→ 影片 → 台词**。本模块只管 ④ 的规格与判据；
 *   ① 是 core 的 `notices`（`magic.effect`，`beforeFilms`）、② 是 core 的 `lastViewTarget`、
 *   ⑤ 是 `speech.ts` 的 `magicPonder`。
 *
 * ★ ③ 在 ④ 之前 ⇒ 影片期间棋盘上那块地**已经是拆过的样子**（`releaseBoardOnStart`）。
 * ★ 这一支**不看**「動畫過程」（整段里没有 `cmp [0x497159], 0`）。
 * ★ `flags = 0x260001`：bit1 没置 ⇒ 点击 / 按键打断不了（`fcn_0045144f` 0x004514d6）。
 *
 * ★ C-ARC-2：本模块不含任何规则。★ C-DET-4：动效绝不进 `GameState`。
 */

import type { GameState, MagicBeat } from '@rich4/core';
import type { BoardFilmSpec } from './board-film.ts';

/** 「就地拆除房屋」的效果号（`MAGIC_HOUSE_OPTIONS[9]`）@source 跳表 `0x431c7a` 第 9 项 = `0x432259` */
export const MAGIC_OPTION_DEMOLISH = 9;

/**
 * 拆房那一段影片。
 *
 * @source 0x0043231a `push 0x211`（`Data.mkf`，`[0x48a0e4]`）；0x00432354..0x00432360
 *   `fcn_0045144f(影片, 0, 0x28, 0x260001, 0x61)`；帧数 / 尺寸 / 节拍取资源头
 *   （68 帧、440×440、71 ms；源文件 `D:\ANI2\new-ok.FLC`）。
 */
export const MAGIC_DEMOLISH_FILM: BoardFilmSpec = {
  id: 'magic-demolish',
  archive: 'Data.mkf',
  resource: 0x211,
  frames: 68,
  width: 440,
  height: 440,
  frameMs: 71,
  x: 0,
  y: 0x28,
  sound: 0x61,
  flags: 0x260001,
  releaseBoardOnStart: true,
};

/**
 * 这一拍要不要播拆房那一段：`lastEvent` **刚写成**「魔法屋 · 就地拆除房屋」，
 * 且至少有一个中签者过了那道闸（core 为他交了 `magic.effect` 那一扇框 —— 框与影片同一道闸）。
 *
 * ⚠️ 名单里不止一个人过闸时原版是「框 → 影片」**每人一遍**；本引擎只播一遍（与加蓋那一支
 *   的大锤同一条近似，登记于 `docs/deviations/T-037.md` D-MAGIC-16）。
 */
export function magicDemolishFxTrigger(
  before: Pick<GameState, 'lastEvent' | 'notices'>,
  after: Pick<GameState, 'lastEvent' | 'notices'>,
): boolean {
  const ev = after.lastEvent;
  if (ev === null || ev === before.lastEvent || ev.kind !== 'magicHouse') return false;
  if (ev.id !== MAGIC_OPTION_DEMOLISH) return false;
  if (after.notices === before.notices) return false;
  return after.notices.some((n) => n.key === 'magic.effect');
}

// ============================================================
//  逐人演出（D-MAGIC-16）—— `0x431caa` 的逐人循环，纯状态机
// ============================================================

/**
 * 这一条 action 刚交出的魔法屋逐人分段（`GameState.lastMagicBeats`，引用变了才算）；不是 ⇒ `null`。
 */
export function freshMagicBeats(
  before: Pick<GameState, 'lastMagicBeats'>,
  after: Pick<GameState, 'lastMagicBeats'>,
): readonly MagicBeat[] | null {
  const beats = after.lastMagicBeats ?? null;
  if (beats === null || beats === (before.lastMagicBeats ?? null) || beats.length === 0) return null;
  return beats;
}

/**
 * ★★ 第二十六份 panel：这一条换人 action 刚交出的两段（`GameState.lastTurnBeats`，引用变了才算）；不是 ⇒ `null`。
 * 与魔法屋逐人分段同一套逐段演（`MagicSequence`）：分界之前一段（惡人那一趟 / 推日期，侧栏仍是上一位）演完，
 * 才起下一位「走一天」那一段（`0x41c84f`：`0x436a5a` 的重画、还款日框、释放 / 神明任期的台词）。
 */
export function freshTurnBeats(
  before: Pick<GameState, 'lastTurnBeats'>,
  after: Pick<GameState, 'lastTurnBeats'>,
): readonly MagicBeat[] | null {
  const beats = after.lastTurnBeats ?? null;
  if (beats === null || beats === (before.lastTurnBeats ?? null) || beats.length === 0) return null;
  return beats;
}

/** 逐段演到哪了 */
export interface MagicSequence {
  readonly beats: readonly MagicBeat[];
  /** 下一段的下标 */
  readonly next: number;
  /** 最近起播的那一段的 after —— 棋盘 / 侧栏 / 镜头按它画；还没起播 = `null` */
  readonly shown: GameState | null;
}

export function magicSequenceStart(beats: readonly MagicBeat[]): MagicSequence {
  return { beats, next: 0, shown: null };
}

/**
 * 走一拍：上一段还在演（`busy`）就原地等；否则起下一段（交出 `beat`）；全部演完 ⇒ `done`。
 *
 * ★ 原版 `0x431caa` 是阻塞的：一位中签者整支（框 → 镜头 → 影片 → 台词）演完才 `inc edi` 轮到下一位。
 */
export function magicSequenceStep(
  seq: MagicSequence,
  busy: boolean,
): { seq: MagicSequence; beat: MagicBeat | null; done: boolean } {
  if (busy) return { seq, beat: null, done: false };
  const beat = seq.beats[seq.next];
  if (beat === undefined) return { seq, beat: null, done: true };
  return { seq: { ...seq, next: seq.next + 1, shown: beat.after }, beat, done: false };
}
