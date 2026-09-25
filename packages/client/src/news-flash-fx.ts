/*
 * 新聞 18「強烈地震」/ 19「山洪」与命運 0「強制拆除房屋」/ 1「強制徵收土地」：
 * 受灾 / 被动的**那一块地白闪一遍**，然后停一下 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * gap-audit #6：这两条新聞先前一点演出都没有（18 连镜头目标都没交，19 只有地名 / 镜头 / 房主台词）。
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
 *
 * ; 命運 0 / 1（A-2）—— 两支走同一条尾巴，逐字节相同
 * 0044c092  call 0x456c0a(id 图, 0x2f440, 0x7d0 + 那块地, 0xffff)   ; 标白被拆 / 被徵收的那一块
 * 0044c0ce  mov byte [ebx + 0x19], 0       ; 事件 1：清归属（事件 0 是 0x0044bf3e 清等级，owner 不动）
 * 0044c0d9  call 0x40a4e1(0)               ; 重画小地图 / 侧栏的归属色块
 * 0044c0e3  jmp 0x44bf46                   ; ★ 与事件 0 汇合
 * 0044bf46  call 0x451985                  ; ★ 闪（同 19）
 * 0044bf51  call 0x41d476(0, 0, 1)         ; 重画（这时才露出「已经不是他的了」）
 * 0044bf59  push 0x12c / call 0x4528b9     ; 停 300 ms
 * 0044bf9f  player_say(抽到的人, 2, 台词[rand&1])        ; 倒霉台词（`speech.ts`）
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
 * ★ 这两支（以及命運 0/1）里都没有 `cmp byte [0x497159], 0`（「動畫過程」开关）⇒ 不看那个开关。
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

/** 这一段要闪的那几处（地块 id / 設施 id 分开，渲染器按两张表认）+ 闪完再停多久 */
export interface NewsFlashCue {
  /** 触发它的事件号（新聞 18 / 19 或命運 0 / 1）—— 只用于日志 */
  eventId: number;
  /** 哪一副牌抽到的（只用于日志）；两族共用同一支 `fcn_00451985`，时间轴完全同形 */
  kind: 'news' | 'fortune';
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
  return { eventId: ev.id, kind: 'news', lands, facilities, holdMs };
}

/**
 * 命運 0「強制拆除房屋」/ 1「強制徵收土地」標白之后那一停 —— `0x0044bf59 push 0x12c / call 0x4528b9`。
 *
 * @source 与新聞 19 同形（`0x0044aaca push 0x12c`）：闪（`fcn_00451985` 自带 16 × 30 + 400）
 *   → `0x0044bf51 view_to(0, 0, 1)` 重画 → 停 300 → 台词 `0x0044bf9f`。
 */
export const FORTUNE_FLASH_HOLD_MS = 0x12c;

/**
 * 这一拍是不是刚抽到命運 0 / 1、且真的动了那一块地 —— 要闪的就是它。
 *
 * ★★ A-2（回報「强制征收土地一处好像没生效」）：核心那条事件把地**改了**，
 *   但屏上只有「归属色块悄悄消失」，看不出是哪一块。原版在**共用尾巴**里把那一块标白再闪一遍：
 *
 * ```asm
 * ; 事件 1 施加支（事件 0 同形：0x0044befa / 0x0044bf16）
 * 0044c092  push 0xffff
 * 0044c097  mov eax,[0x48c5b0] / 0044c09c add eax,0x7d0   ; 实体编码 = 0x7d0 + 地块 id
 * 0044c0a1  push eax / 0044c0a2 push 0x2f440 / 0044c0ad push [0x474938]
 * 0044c0ae  call 0x456c0a                                ; ★ 把这块地标白
 * 0044c0b6  add_money / 0044c0ce owner=0 / 0044c0d2 地契=0
 * 0044c0d9  push 0 / call 0x40a4e1                       ; 重画小地图 / 侧栏的归属色块
 * 0044c0e3  jmp 0x44bf46                                 ; ↓ 与事件 0 共用
 * 0044bf46  call 0x451985                                ; ★ 闪（16 帧 × 30 ms + 400 ms，与過路費同一支）
 * 0044bf51  call 0x41d476(0, 0, 1)                       ; 重画（这时才露出「已经不是他的」）
 * 0044bf59  push 0x12c / call 0x4528b9                    ; 再停 300 ms
 * 0044bf9f  call 0x44ef41                                 ; 倒霉台词（`speech.ts`）
 * ```
 *
 * 「哪一块」由**这一条 action 自己写下的差**定：事件 1 是 `landOwner[i]` 由非 0 变 0
 * （`0x0044c0ce`），事件 0 是 `landLevel[i]` 由非 0 变 0（`0x0044bf3e`）。
 * 两条事件都只动**一块**，且这条 action 只做这一件事 —— 不必给 `GameState` 加字段
 * （`out.demolished` 是 reduce 内部的中间产物，没进状态）。
 */
export function fortuneFlashTrigger(
  before: { lastEvent: unknown; landOwner?: readonly number[]; landLevel?: readonly number[] },
  after: {
    lastEvent: { kind: string; id: number } | null;
    landOwner?: readonly number[];
    landLevel?: readonly number[];
  },
): NewsFlashCue | null {
  const ev = after.lastEvent;
  if (ev === null || ev.kind !== 'fortune' || before.lastEvent === ev) return null;
  // ⚠️ 只有 0 / 1 走 `0x44bf46` 那条尾巴（`0x0044c0e3 jmp 0x44bf46`）；
  //    其余命運没有 `0x451985`（逐支核过 `0x44bfb1` 之后所有的 `jmp` / `call` 目标）。
  if (ev.id !== 0 && ev.id !== 1) return null;
  const wasOwner = before.landOwner ?? [];
  const nowOwner = after.landOwner ?? [];
  const wasLevel = before.landLevel ?? [];
  const nowLevel = after.landLevel ?? [];
  const n = Math.max(wasOwner.length, wasLevel.length);
  const lands: number[] = [];
  for (let i = 0; i < n; i++) {
    // 事件 1 清 owner（`0x0044c0ce`）；事件 0 清 level（`0x0044bf3e`）—— owner 不动
    const changed = ev.id === 1 ? wasOwner[i] !== 0 && nowOwner[i] === 0 : wasLevel[i] !== 0 && nowLevel[i] === 0;
    if (changed) lands.push(i);
  }
  if (lands.length === 0) return null;
  return { eventId: ev.id, kind: 'fortune', lands, facilities: [], holdMs: FORTUNE_FLASH_HOLD_MS };
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
