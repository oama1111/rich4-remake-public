/*
 * 新聞「随机挑一处建筑」那一族的**整块棋盘影片** —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第十二份試玩回報（`20260923-015102989`）：「龙卷风摧毁房屋没有看到具体哪个房子受影响，
 * 也没看到特效动画」。规则早就复刻了（`core/events/news-effects.ts` 的 `demolishAny`
 * 支：随机挑一处 → `mutate_land` 拆一级），**缺的是整段演出**：
 *   ① 訊息框里的 `%s` 是**地名**（先前被代入成人名，见 `event-box-screen.ts`）；
 *   ② 镜头移到那一处（core 写 `lastViewTarget`，见 `reduce.ts` 的 `out.place`）；
 *   ③ **这一段影片** —— 本模块；
 *   ④ 房主说一句（`speech.ts` 的 `detectNewsPlaceOwner`）。
 *
 * ★ C-ARC-2：本模块只算「该播哪一段」，不碰任何规则。★ C-DET-4：动效绝不进 state。
 *
 * ## 判据：这一族的施加阶段（pass 1）是**同一个形状**
 *
 * 以新聞 21「龍捲風侵襲%s 摧毀房屋一棟」`fcn_0044ac99` 为例（`disasm.py va 0x44ac99 150`）：
 *
 * ```asm
 * 0044add3  call 0x40af12                ; 取挑中那一处的 (x, y)
 * 0044aded  call 0x41d476                ; view_to(x, y, 2) —— 镜头移过去
 * 0044adfe  call 0x40ab4a                ; mutate_land(实体, 0) —— 拆一级
 * 0044ae0a  push 0x217                   ; ★ Data.mkf 资源 0x217
 * 0044ae0f  mov ebp, [0x48a0e4]          ; ★ Data.mkf 句柄
 * 0044ae16  call 0x450441                ; read_mkf
 * 0044ae20  push 0x58                    ; arg5 = 音效号（Effect.mkf）
 * 0044ae22  push 0x80001                 ; arg4 = flags（bit1 = 0 ⇒ 点不掉）
 * 0044ae27  push 0x28                    ; arg3 = y（屏幕）= 40
 * 0044ae29  push 0                       ; arg2 = x（屏幕）= 0
 * 0044ae2c  call 0x45144f                ; fcn_0045144f —— 阻塞播完
 * 0044ae3d  push 0x12c / call 0x4528b9   ; sleep 300
 * 0044ae4a  owner != 0 ⇒ player_say(owner − 1, 2, …)   ; 房主那一句
 * ```
 *
 * 其余三条逐条读过，只差「资源 / 音效 / flags」三个立即数：
 *
 * | 新聞 | 函数 | 影片（Data.mkf） | 音效 | flags | 调用点 |
 * |---|---|---|---|---|---|
 * | 5 外星怪獸襲擊%s | `fcn_004492a0` | `0x21b` | `0x54` | `0x200001` | `0x0044945b` / `0x00449471` / `0x0044947d` |
 * | 15 %s一處民宅瓦斯爆炸 | `fcn_0044a453` | `0x20f` | `0x57` | `0x50001` | `0x0044a54f` / `0x0044a565` / `0x0044a571` |
 * | 20 超級颱風侵襲%s | `fcn_0044ab2c` | `0x216` | `0x59` | `0x80001` | `0x0044ac4f` / `0x0044ac65` / `0x0044ac71` |
 * | 21 龍捲風侵襲%s | `fcn_0044ac99` | `0x217` | `0x58` | `0x80001` | `0x0044ae0a` / `0x0044ae20` / `0x0044ae2c` |
 *
 * 四段都落在屏幕 `(0, 0x28)`（`push 0x28 / push 0`）= 整块棋盘，flags 的 bit1 全是 0
 * ⇒ **点不掉**；四个函数里都**没有** `cmp byte [0x497159], 0`（「動畫過程」开关）
 * ⇒ 与新聞 4 的飛碟（`alien-news-fx.ts`）一样，**不看那个开关**。
 *
 * 帧数 / 尺寸 / 每帧毫秒逐字节读自资源头（`parseFlicInfo`，单测对着 `Data.mkf` 再核一遍）：
 *
 * | 资源 | 帧数 | 宽×高 | 每帧 |
 * |---|---|---|---|
 * | `0x21b` | 46 | 440×440 | 71 ms |
 * | `0x20f` | 41 | 440×440 | 71 ms |
 * | `0x216` | 15 | 440×440 | 71 ms |
 * | `0x217` | 15 | 440×440 | 71 ms |
 *
 * ★ **什么时候播**：原版次序是訊息框（pass 0 画字、`fcn_0044b6df` 停 2400 ms）→ pass 1
 *   才移镜头 + 播片 —— 与新聞 4 完全同形，故同样带 `afterOverlay`（等事件框收屏再起播）。
 *
 * ★ 片后静置（第二十二份补上，gap-audit #14）：21 / 15 播完之后 `sleep 300`（`0x0044ae3d` /
 *   `0x0044a582 push 0x12c`）、20 `sleep 500`（`0x0044ac82 push 0x1f4`）、5 没有 —— 走
 *   `BoardFilmSpec.holdMs`（最后一帧留在屏上，滑鼠鍵可点掉）；房主那一句在静置之后。
 *   新聞 18「強烈地震」/ 19「山洪」的尾巴形状不同（标白 `0x456c0a` + 闪 `0x451985`，**没有**整块影片），
 *   在 `news-flash-fx.ts`。
 */

import { boardFilmTotalMs, type BoardFilmSpec } from './board-film.ts';

/** 这一族影片都在 Data.mkf @source 各调用点 `mov reg, [0x48a0e4]`（`taken_mkf` = Data.mkf 句柄） */
export const NEWS_PLACE_FX_ARCHIVE = 'Data.mkf';

/** 落点 —— **屏幕** `(0, 0x28)` = 棋盘左上角 @source 各调用点 `push 0x28 / push 0` */
export const NEWS_PLACE_FX_X = 0;
export const NEWS_PLACE_FX_Y = 0x28;

function film(
  newsId: number,
  resource: number,
  frames: number,
  frameMs: number,
  sound: number,
  flags: number,
  holdMs = 0,
): BoardFilmSpec {
  return {
    ...(holdMs > 0 ? { holdMs } : {}),
    id: `news-${newsId}`,
    archive: NEWS_PLACE_FX_ARCHIVE,
    resource,
    frames,
    width: 440,
    height: 440,
    frameMs,
    x: NEWS_PLACE_FX_X,
    y: NEWS_PLACE_FX_Y,
    sound,
    flags,
    // ★ 原版次序是「訊息框 2400 ms → pass 1 才播这一段」（同新聞 4，见 `board-film.ts`）
    afterOverlay: true,
  };
}

/**
 * 新聞号 → 那一段影片（只收**逐条读过**的四条；表外返回 `null`）。
 *
 * @source 见文件头那张表（每一行的三个调用点 VA）。
 */
export const NEWS_PLACE_FILMS: ReadonlyMap<number, BoardFilmSpec> = new Map([
  // 5：`0x00449486 libc_free` 之后直接 `0x0044948e` 看房主，没有 sleep
  [5, film(5, 0x21b, 46, 71, 0x54, 0x200001)],
  // 15：`0x0044a582 push 0x12c / call 0x4528b9`
  [15, film(15, 0x20f, 41, 71, 0x57, 0x50001, 0x12c)],
  // 20：`0x0044ac82 push 0x1f4 / call 0x4528b9`
  [20, film(20, 0x216, 15, 71, 0x59, 0x80001, 0x1f4)],
  // 21：`0x0044ae3d push 0x12c / call 0x4528b9`
  [21, film(21, 0x217, 15, 71, 0x58, 0x80001, 0x12c)],
]);

/** 新聞 21「龍捲風」@source 新聞表 `0x475e24[21]` = `0x0044ac99` */
export const NEWS_TORNADO_ID = 21;

/** 这一段总共播多久（毫秒，**不含**片后静置）；表外为 0 */
export function newsPlaceFilmMs(newsId: number): number {
  const spec = NEWS_PLACE_FILMS.get(newsId);
  return spec === undefined ? 0 : boardFilmTotalMs(spec);
}

/**
 * 这一拍要不要播这一族的影片。
 *
 * 判据（纯查状态）：`lastEvent` **引用变了**、是新聞、且带着「挑中的那一处」（`place`）、
 * 事件号在表里。`place` 由 core 在挑中时**无条件**写（空地也写）—— 原版挑到空地
 * 照样播（`mutate_land` 什么都不改，但影片调用点在它之后、无条件）。
 *
 * @returns 该播就返回那一段的规格，否则 `null`
 */
export function newsPlaceFxTrigger(
  before: { lastEvent: { kind: string; id: number } | null },
  after: { lastEvent: { kind: string; id: number; place?: unknown } | null },
): BoardFilmSpec | null {
  const ev = after.lastEvent;
  if (ev === null || ev.kind !== 'news' || ev.place === undefined) return null;
  if (before.lastEvent === ev) return null;
  return NEWS_PLACE_FILMS.get(ev.id) ?? null;
}
