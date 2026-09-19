/*
 * 「盖在棋盘上的阻塞影片」通用零件
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么单独一个模块：原版有一族演出走的是**同一支**函数 `fcn_0045144f`
 *   （VA 0x0045144f，真解码 `fcn_00450ced`）—— 建屋（大锤/滿級）、
 *   住院、入獄、神明降臨/發威，还有卡片特效（`Data.mkf` 523..570 那一族）都在内。
 *   它们的差别只有「资源 + 落点 + flags + 音效」四个数，播放规则完全一样：
 *
 *   1. 一帧等资源头 `+0x10` 毫秒（`[0x48c870]`），帧号从 0 起、**不循环**；
 *   2. `flags` bit1（`[0x48c880]`）置位时认 `0x202/0x205/0x101` 提前收场；
 *   3. 整幅帧直接贴屏幕（`[0x48c830]`/`[0x48c834]` 就是落点），**不进绘制槽**；
 *   4. 调用方是**阻塞**的 —— `fcn_0045144f` 自己那个 `PeekMessage` 循环不结束
 *      就不回到结算流程（本引擎对应「回合驱动那一道闸」）。
 *
 * 所以这里只留「规格 + 纯播放」两件事；**谁在什么时机播**归各自的模块
 * （`build-fx.ts` / `confine-fx.ts` / `god-fx.ts`），落点转棋盘局部坐标归宿主
 * （见 `main.ts` 的 `LAYOUT.board.y` 那一减）。
 *
 * ★ C-ARC-2：本模块不含任何规则。★ C-DET-4：动效绝不进 `GameState`。
 */

import type { ArchiveName, LoadedFlic } from './assets.ts';

/** 一段棋盘影片的规格 —— 四个数都逐字节核过资源头/调用点 */
export interface BoardFilmSpec {
  /** 稳定标识（日志/缓存键用，如 `hospital` / `god-5`）*/
  id: string;
  /** 影片所在档案（`Data.mkf` / `Panel.mkf` / `jump.mkf`）*/
  archive: ArchiveName;
  /** 资源号 */
  resource: number;
  /** 帧数 @source 资源头 +0x06 */
  frames: number;
  width: number;
  height: number;
  /** 每帧停留多少毫秒 @source 资源头 +0x10 */
  frameMs: number;
  /** **屏幕**落点 @source `fcn_0045144f` 的 arg2 / arg3 */
  x: number;
  y: number;
  /** 随影片一起响的音效号（`Effect.mkf`）@source arg5（−1 = 不放）*/
  sound: number;
  /** `fcn_0045144f` 的 arg4 —— bit1 是「点击/按键能不能打断」@source VA 0x004514d6 */
  flags: number;
  /**
   * 起播前要不要**等整屏浮窗收掉**（`afterOverlay`）。
   *
   * 只有新聞 4 那一支（`alien-news-fx.ts`）用得上：原版那一段影片是在
   * `fcn_0044b6df` 把訊息框贴上屏、等满 2400 ms（`0x0044b862 push 0x960`）
   * **之后**、事件函数体里才播的（VA 0x00449245/0x0044925b）—— 框先、片后。
   * 而本引擎的 `event-box-screen.ts` 是**浮窗**（`windowed: true`）盖在棋盘上
   * 440×480 那一块，恰好把 (0,40)-(440,480) 的整块棋盘影片**整段遮住**；
   * 不等它收屏，这 4.1 秒就会在框底下白播。
   *
   * 未置位 = 不等（住院/入獄/神明那几支的调用点都在訊息框之外）。
   */
  afterOverlay?: boolean;
}

/** 正在播的这一段（纯数据，宿主自己拿着）*/
export interface BoardFilm {
  spec: BoardFilmSpec;
  /** 这一段是什么时候开始的（`performance.now()` 时基）*/
  startedAt: number;
}

/** 一段影片总共播多久（毫秒）= 帧数 × 每帧毫秒（不循环、不重复）*/
export function boardFilmTotalMs(spec: BoardFilmSpec): number {
  return spec.frames * spec.frameMs;
}

/**
 * 这一段能不能被点击/按键打断 —— `flags` 的 bit1（`[0x48c880]`）。
 *
 * @source `fcn_0045144f` VA 0x004514d6：`cmp byte [0x48c880], 0 / je 0x4514fd`
 *   置位时才认 `0x202` / `0x205` / `0x101` 三种消息并提前收场。
 */
export function boardFilmSkippable(spec: BoardFilmSpec): boolean {
  return (spec.flags & 2) !== 0;
}

export function beginBoardFilm(spec: BoardFilmSpec, now: number): BoardFilm {
  return { spec, startedAt: now };
}

/**
 * 现在该画第几帧（**0 基**，播完钉在最后一帧上）。
 *
 * @source VA 0x0045117d：帧号从 0 起、每帧等 `[0x48c870]` 才 +1，
 *   到 `帧数 − 1` 为止；一帧都不循环。
 */
export function boardFilmFrame(film: BoardFilm, now: number): number {
  const k = Math.floor((now - film.startedAt) / film.spec.frameMs);
  if (!Number.isFinite(k) || k < 0) return 0;
  return Math.min(film.spec.frames - 1, k);
}

/** 这一段播完了吗（时间到）*/
export function boardFilmDone(film: BoardFilm, now: number): boolean {
  return now - film.startedAt >= boardFilmTotalMs(film.spec);
}

/**
 * 这一刻该贴哪张图；影片还没解好 → `null`（棋盘照画，下一帧会补上）。
 *
 * @param flic `assets.getFlic(spec.archive, spec.resource)`
 */
export function boardFilmBitmap(
  film: BoardFilm,
  now: number,
  flic: LoadedFlic | null | undefined,
): ImageBitmap | null {
  if (flic === null || flic === undefined) return null;
  const frame = boardFilmFrame(film, now);
  return flic.frames[frame] ?? flic.frames[flic.frames.length - 1] ?? null;
}
