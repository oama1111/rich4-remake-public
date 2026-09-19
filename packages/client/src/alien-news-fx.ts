/*
 * 新聞 4「外星人攻打地球」的那段**飛碟影片** —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 试玩报告：「事件-外星人攻打地球也是被直接跳过了，应该是有个动画UFO来
 * 摧毁了某个地方的房子才对」—— 规则早就复刻了（`core/events/news-effects.ts`
 * 的 `alienBlast` 支：挑一栋已开发的房子当爆心、半径 0x64 重击、
 * 被扫到的人住院 3 天），**缺的是那一段演出**。
 *
 * ★ C-ARC-2：本模块只算「那一段此刻该画第几帧、画在哪」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history** —— 丢了只是少一段动画。
 *
 * ## 判据：`fcn_0044913d`（VA 0x0044913d = 新聞表 `0x475e24` 的 `[4]`）
 *
 * 事件的**施加阶段**（pass 1，入口 `0x00449150 jne 0x449175`）在算完效果之后
 * 只做两件事：播那段影片、放那条音效（VA 0x00449235..0x00449269）：
 *
 * ```asm
 * 00449235  push 0                       ; read_mkf 的 arg3 = 0
 * 00449237  push 0                       ; arg2 = 0
 * 00449239  push 0x213                   ; ★ Data.mkf 资源 0x213
 * 0044923e  mov edx, dword ptr [0x48a0e4] ; ★ Data.mkf 句柄（`taken_mkf`）
 * 00449244  push edx
 * 00449245  call 0x450441                ; read_mkf(Data.mkf, 0x213, 0, 0)
 * 0044924a  mov ebx, eax                 ; 解好的影片
 * 0044924f  push 0x56                    ; arg5 = 音效号（Effect.mkf）
 * 00449251  push 0x180001                ; arg4 = flags
 * 00449256  push 0x28                    ; arg3 = y（屏幕）= 40
 * 00449258  push 0                      ; arg2 = x（屏幕）= 0
 * 0044925a  push eax                    ; arg1 = 影片
 * 0044925b  call 0x45144f                ; fcn_0045144f —— 阻塞播完
 * 00449263  push ebx / call 0x456e11     ; libc_free（播完就放掉）
 * ```
 *
 * 参数含义、落点与 `flags` 逐位语义与 `confine-fx.ts` / `build-fx.ts` 同一支
 * `fcn_0045144f`（VA 0x0045144f）—— 那几个模块已经把它们逐位钉住了，这里照用：
 *
 * | 参数 | 存到 | 含义 |
 * |---|---|---|
 * | `x` / `y` | `[0x48c830]` / `[0x48c834]` | **屏幕**落点（棋盘左上角是 (0,40)）|
 * | 帧数 / 宽 / 高 | — | 取自资源头 `+0x06` / `+8` / `+0xa` |
 * | flags bit0 | `[0x48c882]` | 存背景 / 画进后台面（这里 = 1）|
 * | flags bit1 | `[0x48c880]` | ★ 点击/按键跳过闸 —— 这里 = 0 ⇒ **点不掉** |
 * | flags bit2 | `[0x48c883]` | 循环（= 0）|
 * | 5 号参数 | — | 随影片一起响的音效号（`Effect.mkf`）|
 *
 * ## 影片规格（`Data.mkf` 资源 0x213 的头，与 `packages/assets-pipeline`
 * 的 `parseFlicInfo` 同一算法；已用 `assets/game/Data.mkf` 逐字节核过）
 *
 * | 资源 | 帧数 | 宽×高 | 每帧 | 总长 | 落点 (屏幕) | 音效 |
 * |---|---|---|---|---|---|---|
 * | `0x213` | **36** | 440×440 | **114 ms** | **4104 ms** | (0, 0x28) = (0,40) | 0x56 |
 *
 * 440×440 的整幅帧贴在 (0,40) ⇒ 正好盖住整块棋盘（与入獄 0x21a 同形、
 * 与建屋大锤 0x229 同落点）—— 爆心的镜头对准由 `fcn_0041d476` 负责，
 * 影片本身**固定在画面里**（见 `build-fx.ts` 文件头「落点与锚点」那条）。
 *
 * ## 什么时候播
 *
 * 在**事件效果施加那一趟**（pass 1）播，即本引擎 `reduce` 把 `lastEvent`
 * 置成 `{ kind: 'news', id: 4 }` 的那一拍 ⇒ 判据就用它（`alienNewsFxTrigger`）。
 * 原版是 `fcn_0045144f` 阻塞播放，本引擎挂在 `main.ts` 的棋盘影片闸上
 * （`boardFilm` / `pendingBoardFilm`），播完才放行回合驱动 —— 与
 * `confine-fx.ts` / `god-fx.ts` 完全同一条路。
 *
 * ⚠️ 一处**有意照原版**的差异：`confine-fx.ts`（住院/入獄）与 `god-fx.ts`
 *   （神明）那两支的调用点各自写着 `cmp byte [0x497159], 0 / je 跳过`
 *   （= 「動畫過程」关掉就不播），而 **`fcn_0044913d` 里没有这一句** ——
 *   新聞 4 这段影片原版**不看那个开关**。本模块照 exe 走：由 `main.ts` 的
 *   调用点决定闸门，模块自己不拦 `options.animation`（见该调用点的注释）。
 */

import {
  boardFilmSkippable,
  boardFilmTotalMs,
  type BoardFilmSpec,
} from './board-film.ts';

/**
 * 新聞 4「外星人攻打地球」的事件号。
 *
 * @source 新聞表 `0x475e24` 的第 `[4]` 项 = **0x0044913d**（`disasm.py table 0x475e24 36`）；
 *   文案 `#0153外星人攻打地球` @ `VA 0x00465488`；
 *   `@rich4/data` 的 `NEWS_EVENTS[4].va` 也是同一个地址
 *   （`packages/data/src/event-table.ts` 的 `{ id: 4, va: 0x0044913d, effects: ['alienBlast'] }`）。
 */
export const NEWS_ALIEN_ID = 4;

/** 影片在 Data.mkf @source VA 0x0044923e `[0x48a0e4]` = `Data.mkf` 句柄 */
export const ALIEN_NEWS_FX_ARCHIVE = 'Data.mkf';

/** 飛碟影片 = `Data.mkf` 资源 **0x213（531）** @source VA 0x00449239 `push 0x213` */
export const ALIEN_NEWS_FLIC_RESOURCE = 0x213;

/** 音效号 —— `Effect.mkf` **0x56（86）** @source VA 0x0044924f `push 0x56`（= arg5）*/
export const ALIEN_NEWS_SOUND = 0x56;

/** `fcn_0045144f` 的 arg4 @source VA 0x00449251 `push 0x180001`（低字节 bit0 = 存背景）*/
export const ALIEN_NEWS_FLAGS = 0x180001;

/** 影片**屏幕**落点 x @source VA 0x00449258 `push 0` */
export const ALIEN_NEWS_X = 0;
/** 影片**屏幕**落点 y @source VA 0x00449256 `push 0x28` */
export const ALIEN_NEWS_Y = 0x28;

/**
 * 这一段影片的规格 —— 帧数/尺寸/每帧毫秒逐字节核过 `Data.mkf` 0x213 的头。
 *
 * @source 资源头 `+0x06` = 36 帧、`+8`/`+0xa` = 440×440、`+0x10` = 114 ms
 *   （算法见 `packages/assets-pipeline/src/flic.ts` 的 `parseFlicInfo`）。
 */
export const ALIEN_NEWS_FILM: BoardFilmSpec = {
  id: 'alien-news',
  archive: ALIEN_NEWS_FX_ARCHIVE,
  resource: ALIEN_NEWS_FLIC_RESOURCE,
  frames: 36,
  width: 440,
  height: 440,
  frameMs: 114,
  x: ALIEN_NEWS_X,
  y: ALIEN_NEWS_Y,
  sound: ALIEN_NEWS_SOUND,
  flags: ALIEN_NEWS_FLAGS,
  // ★ 原版次序是「訊息框 2400 ms → 才播这一段」（见 `board-film.ts` 的 `afterOverlay`）
  afterOverlay: true,
};

/** 这一段影片总共播多久（毫秒）= 36 × 114 = 4104 */
export function alienNewsTotalMs(): number {
  return boardFilmTotalMs(ALIEN_NEWS_FILM);
}

/**
 * 这一段能不能被点击/按键打断 —— `flags` 的 bit1（`[0x48c880]`）。
 *
 * @source `fcn_0045144f` VA 0x004514d6：置位时才认 `0x202`/`0x205`/`0x101`。
 *   `0x180001` 的 bit1 = 0 ⇒ 原版这 4.1 秒**点不掉**。
 */
export function alienNewsSkippable(): boolean {
  return boardFilmSkippable(ALIEN_NEWS_FILM);
}

/**
 * 这一拍要不要播飛碟影片。
 *
 * 判据（纯查状态，不读也不写别的字段）：
 *   ① `lastEvent` 从「不是新聞 4」变成「新聞 4」—— 与 `event-box-screen.ts`
 *      判定整屏那一段用的是同一条通道（`reduce.ts` 把 `lastEvent` 置成
 *      `{ kind: 'news', id: draw.eventId }`）；
 *   ② 事件号就是表里的 4（`NEWS_ALIEN_ID`，@source 表 `0x475e24[4]` = 0x0044913d）
 *      —— 单测再拿 `@rich4/data` 的 `NEWS_EVENTS[4].effects` 钉一遍，
 *      证明这个号确实只对应 `alienBlast` 那一段（将来挪号会立刻变红）。
 *
 * @returns 该播就返回那一段的规格，否则 `null`
 */
export function alienNewsFxTrigger(
  before: { lastEvent: { kind: string; id: number } | null },
  after: { lastEvent: { kind: string; id: number } | null },
): BoardFilmSpec | null {
  const ev = after.lastEvent;
  if (ev === null || ev.kind !== 'news' || ev.id !== NEWS_ALIEN_ID) return null;
  const prev = before.lastEvent;
  if (prev !== null && prev.kind === ev.kind && prev.id === ev.id) return null;
  return ALIEN_NEWS_FILM;
}
