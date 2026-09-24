/*
 * 新聞 18「強烈地震」/ 19「山洪」：受灾的地块**白闪一遍**，然后停一下 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * gap-audit #6：这两条先前一点演出都没有（18 连镜头目标都没交，19 只有地名 / 镜头 / 房主台词）。
 * 原版 pass 1（訊息框停满 2400 ms 之后，`fcn_0044b6df` 0x0044b873）是这样的：
 *
 * ```asm
 * ; 新聞 18 fcn_0044a6e0（挑中地块那一支；設施那一支 0x0044a8aa / 0x0044a8d3 同形、只标它自己）
 * 0044a7ef  call 0x41d476                  ; view_to(挑中那一块, 2) —— 镜头移过去（core 的 lastViewTarget）
 * 0044a7f9  call 0x409b18(1)               ; 重建棋盘底图 / id 图
 * 0044a80c  for (i = 1; i <= 地块数; i++)
 * 0044a823    if (strcmp(地块[i].名字, 挑中.名字) == 0) {
 * 0044a846      0x456c0a(id 图, 0x2f440, 0x7d0 + i, 0xffff)   ; ★ 同名的每一块在 id 图上标白（不看等级）
 * 0044a84e      if (等级) 等级--                               ; 拆一级（不重画 ⇒ 屏上仍是拆之前）
 *             }
 * 0044a8f3  call 0x451985                  ; ★ 标白的那几块一起闪：16 帧 × 30 ms + 静 400 ms（与過路費同一支）
 * 0044a8fe  call 0x41d476(0, 0, 1)         ; 重画（这时才露出拆过的样子）
 * 0044a90b  push 0x1f4 / call 0x4528b9     ; 再停 500 ms（滑鼠鍵可点掉）
 *
 * ; 新聞 19 fcn_0044a91e
 * 0044aa75  call 0x41d476                  ; view_to(挑中那一处, 2)
 * 0044aa7f  call 0x409b18(1)
 * 0044aa9f  call 0x456c0a(…, [0x48c59c], 0xffff)          ; 标白挑中那一处
 * 0044aaaf  call 0x40ab4a(实体, 1)          ; mutate_land 清归属（只重画小地图的归属点 0x40a4e1，棋盘不重画）
 * 0044aab7  call 0x451985                  ; 闪
 * 0044aac2  call 0x41d476(0, 0, 1)         ; 重画
 * 0044aaca  push 0x12c / call 0x4528b9     ; 停 300 ms
 * 0044aad7  owner != 0 ⇒ player_say(owner − 1, 2, …)     ; 房主那一句（`speech.ts`）
 * ```
 *
 * 所以表现层的时间轴是：**事件框收屏** →（镜头早已在挑中那一处）→ 闪 880 ms（棋盘按 before 画）
 * → 重画成 after → 静置 500 / 300 ms → 收场（房主台词、回合驱动）。
 *
 * ★ 闪的逐帧亮度沿用 `toll-flash-fx.ts`（同一支 `fcn_00451985`，表 `0x476380`）；本引擎按**精靈**
 *   调亮（`sprite-brightness.ts`）近似原版 id 图上逐像素加亮 —— 没盖东西的空地（只露地砖）因此看不到闪，
 *   同 `docs/deviations/Q-TOLL-FX-1.md`。
 * ★ 与任务单的出入：原版 18 只 `view_to` **一次**（挑中那一块），同名的几块是**一起**标、**一起**闪的，
 *   不是逐块移镜头逐块闪（0x0044a80c 的循环里没有 `view_to`、也没有 `0x451985`）。
 * ★ 这两支里都没有 `cmp byte [0x497159], 0`（「動畫過程」开关）⇒ 不看那个开关。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4）。
 */

import { ESTATE_FACILITY_BASE, ESTATE_LAND_BASE } from '@rich4/core';
import { TOLL_FLASH_TOTAL_MS, tollFlashLevel } from './toll-flash-fx.ts';

/**
 * 新聞号 → 闪完重画之后再停多久（毫秒）。
 *
 * @source 18 `0x0044a906 push 0x1f4`、19 `0x0044aaca push 0x12c`（都是 `call 0x4528b9`）
 */
export const NEWS_FLASH_HOLD_MS: ReadonlyMap<number, number> = new Map([
  [18, 0x1f4],
  [19, 0x12c],
]);

/** 这一次要闪的那几处（地块 id / 設施 id 分开，渲染器按两张表认）+ 闪完再停多久 */
export interface NewsFlashCue {
  newsId: number;
  lands: readonly number[];
  facilities: readonly number[];
  holdMs: number;
}

/**
 * 这一拍是不是刚抽到新聞 18 / 19、且 core 交了要闪的那几处（`lastEvent.flashLots`）。
 *
 * 判据与 `newsPlaceFxTrigger` 同一套：`lastEvent` **引用变了**、是新聞、号在表里。
 */
export function newsFlashTrigger(
  before: { lastEvent: unknown },
  after: { lastEvent: { kind: string; id: number; flashLots?: readonly number[] } | null },
): NewsFlashCue | null {
  const ev = after.lastEvent;
  if (ev === null || ev.kind !== 'news' || before.lastEvent === ev) return null;
  const holdMs = NEWS_FLASH_HOLD_MS.get(ev.id);
  if (holdMs === undefined || ev.flashLots === undefined || ev.flashLots.length === 0) return null;
  const lands: number[] = [];
  const facilities: number[] = [];
  for (const e of ev.flashLots) {
    // 实体编码同原版 `[0x48c59c]`：`0x7d0 + 地块 id` / `0xfa0 + 設施 id`（同 `newsPlaceName` 的判法）
    if (e >= ESTATE_FACILITY_BASE) facilities.push(e - ESTATE_FACILITY_BASE);
    else if (e >= ESTATE_LAND_BASE) lands.push(e - ESTATE_LAND_BASE);
  }
  return { newsId: ev.id, lands, facilities, holdMs };
}

/** 这一段此刻在哪一截：`flash` = 闪（含那 400 ms 静止，棋盘仍按 before）、`hold` = 重画后静置、`done` */
export type NewsFlashPhase = 'flash' | 'hold' | 'done';

/**
 * @param elapsedMs 从起闪（事件框收屏那一拍）算起
 * @param holdMs `NewsFlashCue.holdMs`
 */
export function newsFlashPhase(elapsedMs: number, holdMs: number): NewsFlashPhase {
  if (elapsedMs < TOLL_FLASH_TOTAL_MS) return 'flash';
  if (elapsedMs < TOLL_FLASH_TOTAL_MS + holdMs) return 'hold';
  return 'done';
}

/** 这一刻的亮度增量（`toll-flash-fx.ts` 那张表）；闪完 / 亮度 0 ⇒ `null`（不叠） */
export function newsFlashLevel(elapsedMs: number): number | null {
  const level = tollFlashLevel(elapsedMs);
  return level === null || level === 0 ? null : level;
}
