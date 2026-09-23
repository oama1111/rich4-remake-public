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
   * 未置位 = 不等。住院/入獄那两支由新聞 / 命運引出时**在**事件框之后，但走的是
   * 下面的 `afterEventBox`（只等事件框那一屏，理由见那里）。
   */
  afterOverlay?: boolean;
  /**
   * 起播前要不要等**事件提示框**（新聞 / 命運，`event-box-screen.ts`）收掉 —— 只看那一屏。
   *
   * ★ 第十五份試玩回報（「忍太郎刚刚进监狱的动画太快了，前一个事件的弹窗还没看清楚就触发」）：
   *   新聞 29 / 命運 33 这类「事件里送人进監獄/醫院」的，警车 / 救护车在 `send_to_*` **里面**播，
   *   而 `send_to_*` 是事件处理函数 **pass 1** 才调的 —— 框先停满、片后播：
   * ```asm
   * ; 新聞 fcn_0044b6df
   * 0044b862  push 0x960 / call 0x4544f6         ; 框停 2400 ms（可跳过）
   * 0044b873  push 1 / call [eax*4 + 0x475e24]   ; pass 1 → 新聞 29 0x0044b362 call 0x43d593（入獄 + 0x21a）
   * ; 命運 fcn_0044db81
   * 0044dd44  push 0x640 / call 0x4544f6         ; 框停 1600 ms（可跳过）
   * 0044dd6f  push 1 / call [ebx+eax + 0x475ef0] ; pass 1（编号 ≥ 0x21 那一支；< 0x21 是 0x0044dd5b）
   *                                            ;   → 命運 33 0x0044d8c2 call 0x43d593
   * 0044dd7b  push 0x320 / call 0x4528b9         ; 再停 800 ms
   * ```
   * ⚠️ **不能**借 `afterOverlay`：那道闸看的是「任何一屏还在」，而入獄 / 住院尾段的
   *   保險理賠框（`0x43d755 → 0x44ba63`）排在影片**之后**、队列里等着 `pendingBoardFilm`
   *   ⇒ 訊息框屏 `active()` 为真 ⇒ 两边互等，整局卡死。这里只等事件提示框那一屏。
   */
  afterEventBox?: boolean;
  /**
   * 起播那一刻**放开**棋盘的「按 before 画」（`deferred-board.ts`）—— 影片期间棋盘按 after 画。
   *
   * 只有魔法屋「就地拆除房屋」那一段用（`magic-fx.ts`）：原版是先 `0x40ab4a` 拆（里面
   * `0x40a4e1` 重画地图）、**再**播 0x211 —— 影片期间那块地已经是拆过的样子；而影片之前
   * 那一扇訊息框（1500 ms）期间房子还在。未置位 = 整段都按 before 画（其它影片的口径）。
   */
  releaseBoardOnStart?: boolean;
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
 * 这一段此刻还得押着等事件提示框吗（`afterEventBox`，见 `BoardFilmSpec`）。
 *
 * @param eventBoxActive 事件提示框（新聞 / 命運）那一屏此刻还在不在演
 */
export function boardFilmWaitsForEventBox(spec: BoardFilmSpec, eventBoxActive: boolean): boolean {
  return spec.afterEventBox === true && eventBoxActive;
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

// ============================================================
//  片中重画：`flags` 的第三个字节（第十四份試玩回報：警车 / 狗咬）
// ============================================================

/**
 * 这一段在第几帧**重画一次底下的棋盘**（`0` = 整段都不重画；`0xff` = 每帧都重画）。
 *
 * `fcn_00450ced` 把 `flags` 的第三个字节存成 `[0x48c85c]`：
 * ```asm
 * 00450dcd  mov eax, ebx / sar eax, 0x10 / and eax, 0xff
 * 00450dd7  mov [0x48c85c], eax           ; ★ 片中重画的帧计数
 * 00450ddc  je  0x450e41                  ;   0 ⇒ 不重画
 * 00450dfd  push 0x5e880 / call 0x456f80  ;   否则开一块 440×440×2 的差值缓冲 → [0x48c868]
 * ```
 * 逐帧那一支（`fcn_00450f04`）每贴完一帧就把计数 `[0x48c874]` 加 1，然后：
 * ```asm
 * 0045117d  inc [0x48c874]                ; 刚贴完第 k 帧（0 基）⇒ 计数 = k + 1
 * 004511e3  mov ebp, [0x48c85c] / test / je 跳过
 * 004511f1  cmp ebp, 0xff / je 重画       ; 0xff = 每帧
 * 004511f9  cmp ebp, [0x48c874] / jne 跳过
 * 0045128a  call 0x456b3e                 ; 差值 = 屏幕面 − 背景面（影片透明处为 0）
 * 004512bf  call 0x40829d(-1, 0)          ; ★ 按**当前的游戏状态**重画整块棋盘
 * 00451337  call 0x456ba5                 ; 差值为 0 处（影片透明处）贴上新棋盘，影片像素保留
 * 0045136e  call 0x402250                 ; 送屏
 * ```
 * 此后各帧的透明处（索引 0，「取背景面原值」）读到的也都是新棋盘。
 * ⇒ 调用方在 `fcn_0045144f` **之前**写下的状态变化（入獄者搬进監獄、惡犬撤掉…）
 *   不是等片子播完才露出来，而是**在这一帧当场**露出来 —— 警车开过人、人就没了。
 *
 * ⚠️ `0x00450dde..0x00450df8`：重画帧非 0 时还要求 bit0 = 1、bit3 = 0，否则整段**不播**；
 *   本引擎登记的影片里凡是重画帧非 0 的都满足（bit0 = 1、bit3 = 0），故不另设这一档。
 */
export function boardFilmRedrawFrame(spec: BoardFilmSpec): number {
  return (spec.flags >> 16) & 0xff;
}

/**
 * 这一段此刻**已经**做过那次片中重画了吗（见 `boardFilmRedrawFrame`）。
 *
 * 计数 = N 发生在第 `N − 1` 帧（0 基）刚贴上屏的那一拍（`0x0045117d` 先加 1 再比），
 * 于是从第 `N − 1` 帧起棋盘就是新的。N 大于帧数 ⇒ 永远到不了（计数最多到帧数）。
 */
export function boardFilmRedrawn(film: BoardFilm, now: number): boolean {
  const n = boardFilmRedrawFrame(film.spec);
  if (n === 0) return false;
  if (n === 0xff) return true;
  if (n > film.spec.frames) return false;
  return now - film.startedAt >= (n - 1) * film.spec.frameMs;
}

// ============================================================
//  排队：同一条 action 里的**两段**影片（原版是两次阻塞的 `fcn_0045144f`，串行）
// ============================================================

/** 影片的两个槽：`pending` = 下一段要起播的、`after` = 排在它后面的 */
export interface BoardFilmSlots {
  pending: BoardFilmSpec | null;
  after: BoardFilmSpec | null;
}

/**
 * 同一条 action 里又来一段影片 —— **接在已经排好的那一段后面**，不许顶掉它。
 *
 * ★★ 第五份回报第 3 条「狗咬的动画顺序不对」的根因：`startActionFx` 先后调
 *   `startDogFx`（0x214）与 `startConfineFx`（0x20c），而后者直接
 *   `pendingBoardFilm = 救护车` 把还没起播的狗咬片**顶掉**了（動畫開着时只剩救护车）。
 *   原版的次序由调用次序定死：
 *   ```asm
 *   0041b8cd  call 0x45144f      ; 0x214 狗咬（阻塞播完）
 *   0041b8ef  call 0x43ec3f      ; send_to_hospital
 *     0043ed59  call 0x45144f    ;   0x20c 救护车（動畫過程开着才播，0x0043ed27）
 *     0043edcb  call 0x44ef41    ;   ★ 台词在两段影片**之后**
 *   ```
 *
 * @param playing 此刻是不是有一段正在播（正在播的不受影响，新的一律排队）
 */
export function enqueueBoardFilm(
  slots: BoardFilmSlots,
  spec: BoardFilmSpec,
  playing: boolean,
): BoardFilmSlots {
  if (slots.pending === null && !playing) return { pending: spec, after: slots.after };
  // 已经有一段在前面 ⇒ 排到它后面（`after` 单槽：原版同一条 action 里至多两段）
  return { pending: slots.pending, after: spec };
}

