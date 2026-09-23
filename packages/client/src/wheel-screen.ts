/*
 * 轉盤動畫（四個盤：航空 / 旅館 / 購物中心 / 保險）—— T-039 / MOD-12 / REQ-12.14
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 這一屏**沒有待決交互**：`rules/facility.ts` 的 `spinWheel()`（VA 0x0043facb）
 *   早把倍數算進 state 了（旅館那個數同時是「住幾天」、保險那個數是投保天數），
 *   本模組只把這一趟 **起點 → 落點** 轉出來、停一下、自己關屏。
 *   D-003：「真人點擊時機不復刻，結果由 core 定」。
 *   四個盤的來路見下面 `wheelCue()` 的兩支（設施 / 企業）——企業那兩條是
 *   D-WHEEL-9，2026-09-16 補。
 *
 * ★ 本屏**不改 core**：起點槽就藏在 `before.rngState` 裡 —— 原版
 *   `[0x48c50c] = rand() % 12`（VA 0x0043f7da），而 `settleFacility()` /
 *   企業落點走這條路時 `before.rngState` 的**第一次 `rand()`** 就是它
 *   （那之前一個隨機數都沒取）。
 *   於是「起點」不必進 state；落點則由 core 的同一個走法（第一個非空格）定。
 *   這一手與 `magic-screen.ts` 的「用 diff 反推落點」是同一套路，只是這裡連
 *   隨機數都能重放，反推得更準。
 *
 * ## 出處（窗口過程 `fcn_0043f7c6`；入口 `fcn_0044090e`）
 *
 * | 是什麼 | @source |
 * |---|---|
 * | 素材 = `Panel.mkf` **資源 `(轉盤 & 3) + 0x44`**（旅館 69 / 購物中心 70）| 0x00440923 `and eax,3` / 0x00440926 `add eax,0x44` |
 * | 圓盤 = 圖 **`槽 + 2`**（12 張**預先轉好**的 30° 幀），錨點 (82,82) | 0x004409dd `add eax,0x24`(進場畫圖 2) / 0x0043f18d `add edx,2`(槽+2) |
 * | 圓盤落點 **(0xdc, 0x140) = (220,320)** | 0x004409ce / 0x004409d3；轉動中 0x0043f17d / 0x0043f182 |
 * | 天使常態 = 圖 **0**（75×61，錨點 (−6,0)），落點 **(0x109, 0xe6) = (265,230)** | 0x004409fe `add eax,0xc` |
 * | 天使轉動 = 圖 **1**（87×61，錨點 (0,0)），同一落點 | 0x0043f1cc `add eax,0x18` |
 * | 對話框 = `Data.mkf` **資源 0x205 = 517，圖 5**（249×170，錨點 (123,101)，棕色金邊訊息框）| 0x004409b6 `mov eax,[0x48bad8]` + 0x004409bb `add eax,0x48` ⇒ `(0x48−0xc)/12 = 5`；載入點 rich4_load_map.asm:576 |
 * | 氣泡落點 **(0xdc, 0x8c) = (220,140)** | 0x004409ac `push 0x8c` / 0x004409b1 `push 0xdc` |
 * | 氣泡文字 = 表 `0x475cf8` 的第 `轉盤` 項，`sprintf(buf, 該串, 地主名)`，畫在 **(220,140) flag 4（正中）** | 0x00440a20 / 0x00440a35 |
 * | 字級 **0x10 = 16**、內文 `0xf0f0f0`、陰影 `0x101010`（1px 右下）| 0x0044094e `_rich4_create_font`；陰影畫法 0x0044fc31 起 |
 * | 起點槽 `[0x48c50c] = rand() % 12`；每格 `+1 % 12`（順時針一格一格走）| 0x0043f7da `call rand` / 0x0043f7eb / 0x0043f127 |
 * | 停在**第一個非 `0xff` 的格子** | 0x0043f9fa `cmp byte [eax+0x475d0c], 0xff` |
 * | 一幀最短 **0x24 = 36ms** | 0x0043faab `cmp esi, 0x24 / jb` |
 * | 快轉段 **0x28 = 40 幀**（之後才進減速）| 0x0043f861 `cmp ebp, 0x28` / 0x0043f84f 判是不是真人 |
 * | 減速：延遲 1..5，**每一檔走 3 格**進下一檔 | 0x0043f9c7 起 `[esp+0x30] = 3` |
 * | 停在落點後再等 **0x28 = 40 幀**才關屏 | 0x0043fa19 `cmp ebp, 0x28` |
 * | ★ 整趟是**阻塞**的：狀態機跑到 `ebx = 6` 才 `ret`，返回值 = 盤上那個數 | 0x0043fab4 `cmp ebx, 6 / jl` → 0x0043fad1 `mov al,[eax+0x475d0c]` → 0x0043fae3 `ret` |
 * | 真人（`whoPlays == 1` 且不夢遊）**點一下**就把狀態機往前推（`1→2` / `5→6`）| 0x0043fa66 起 |
 * | 音效 = `Effect.mkf` **52**（0x34）**循環**播，落地那一下停 | 0x475d4c；起 0x0043f80d、落地 0x0043fa0a、釋放 0x00440a85 |
 *
 * ★ **本屏是浮窗**（`windowed: true`）：原版只把那塊 (0,40)-(440,480) 存進離屏
 *   （`fcn_00451e7e`，0x00440988），在**棋盤之上**畫圓盤/天使/氣泡，退出時
 *   把那一塊貼回去 —— 所以轉盤全程**棋盤與右側欄都看得見**。那塊矩形就是
 *   `LAYOUT.board = (0,40)-(440,480)`，本屏所有部件都落在它裡面；宣告
 *   `windowed` 之後 `main.ts` 會先照常畫一整幀棋盤再疊本屏（與
 *   `big-map-screen.ts` 同一條路）。見 `docs/deviations/T-039.md` D-WHEEL-2。
 *
 * ★ **「動畫過程」與本屏無關**（2026-09-16 核 exe 訂正）：入口 `fcn_0044090e`
 *   與窗口過程 `fcn_0043f7c6` **一處都沒讀** `[0x497159]`（= `RICH4.CFG+1`），
 *   狀態機 `ebx` 的推進只看「真人」與「夢遊」兩個判據 ⇒ **原版恆開動畫**，
 *   本屏照做即是 1:1。故**不要**拿 `env.animation` 去接
 *   `wheelFrameSequence(start, stop, animate = false)` 那一支 ——
 *   它在原版裡沒有調用點，只是本引擎現成的出口（見 `Q-ANIM-1.md` 與
 *   `T-039.md` 的 D-WHEEL-3）。
 *
 * ★★ **這一屏演完之前，誰都不許往前走 —— 包括台詞**（2026-09-19 核 exe）。
 *
 *   原版整趟是**阻塞**的：`fcn_0043f7c6` 的狀態機跑到 `ebx = 6` 才 `ret`
 *   （0x0043fab4 `cmp ebx,6 / jl` → 0x0043fad1 取盤上那個數 → 0x0043fae3 `ret`），
 *   而它在**同一次呼叫**裡把盤轉完。所以設施收費那一段的順序是**呼叫順序**定死的：
 *   ```asm
 *   0041a458  call 0x44090e     ; ★ 轉盤（阻塞：轉完才返回盤上的數）
 *   0041a460  [esp+0xd0] = eax  ; 轉盤值（旅館天數 / 購物中心倍數）
 *   0041a579  call 0x440cac     ; 費用訊息框（0x5dc ms）
 *   0041a5c0  call 0x40df69     ; 收費（錢真的轉手）
 *   0041a710  call 0x44f4ed     ; 敵對玩家那一句（事件 18，命中就不說 9/10/11）
 *   0041a71e  call 0x44f42d     ; ★ 付款人的台詞（事件 9/10/11）
 *   ```
 *   ⇒ 原版**必定**是「盤停下來 → 費用訊息框 → 付款人的台詞」。
 *   本引擎的台詞是 action 落地時就排進佇列的（非同步），所以 `main.ts` 的
 *   `speechTick()` 在**演出接管整屏期間整隊凍結**、`holdForActorWalk()` 另外
 *   等佇列排空才派下一步 —— 兩條合起來才等於原版這個「阻塞」。
 *
 * ★ **音效照原版**：`Effect.mkf` **52（0x34）循環**播 —— 起播
 *   `_rich4_play_sound_effect(flags=1, &info)`（VA 0x0043f80d，`ebx` 就是 1，
 *   `info` = `0x475d4c`，第一格 dword = 52；flags bit0 = `DSBPLAY_LOOPING`），
 *   落地 `fcn_004542e9(&0x475d4c)` 停（VA 0x0043fa0a）、退屏前釋放
 *   （VA 0x00440a85）。減速段尾巴另外放一聲**一次性**的 **1**（VA 0x0043f8a0，
 *   `ref_00482322` 第一格 dword = 1）。52 號只有 2086 B ≈ 0.089 s，不循環就只是
 *   一聲「嗒」，故走 `playEffect(52, true)` + `stopEffect(52)`。
 *   `Effect.mkf` 已在 `ARCHIVES`（`main.ts` 的 `SoundPlayer.addArchive`），
 *   `SoundPlayer.play/stop` 都齊。
 */

import { CHARACTERS } from '@rich4/data';
import {
  FACILITY_TYPE,
  INDUSTRY,
  WHEEL,
  WHEEL_BLANK,
  WHEEL_SLOTS,
  WHEEL_TABLE,
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_MASK,
  WatcomRng,
  addInsuranceDays,
  effectiveFacility,
  emptyOwnership,
  facilityIndexOf,
  ownerOf,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { drawGdiText } from './font.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv, UiKeyEvent} from './ui-screen.ts';

/** 取圖（與 `main.ts` 的 `spriteNow` 同一個簽名） */
export type WheelSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  素材
// ============================================================

/**
 * 四個轉盤各占 `Panel.mkf` 一個資源，**資源號 = (轉盤 & 3) + 0x44**。
 *
 * @source VA 0x0044093a：`mov eax,[esp+0xac] / and eax,3 / add eax,0x44 / call _read_mkf`
 *   —— 四個盤因此是 68 航空公司 / **69 旅館** / **70 購物中心** / 71 保險。
 *   每個資源都是 14 張圖（逐張看過 `assets-clean/Panel/00{68..71}_*.png`）。
 */
export const WHEEL_RESOURCE_BASE = 0x44;

/** 轉盤編號 → `Panel.mkf` 資源號 */
export function wheelResource(wheel: number): number {
  return WHEEL_RESOURCE_BASE + (wheel & 3);
}

/**
 * 一張轉盤資源裡的圖號。
 *
 * - **0 = 天使常態**（75×61，錨點 (−6,0)）@source 0x004409fe `add eax,0xc`
 * - **1 = 天使轉動**（87×61，錨點 (0,0)）@source 0x0043f1cc `add eax,0x18`
 * - **2..13 = 圓盤的 12 張預轉幀**，第 `槽` 格用圖 `槽 + 2` @source 0x0043f18d
 *
 * ★ 圓盤是**預先轉好的 12 張圖**（每張相差 30°），原版不自己旋轉 ——
 *   所以本模組只要把 `槽 + 2` 那張貼到 (220,320) 就行，不必做角度換算。
 *   逐張看過：圖 2 的「1」在正上方、圖 5 的「4」在正上方，與 `WHEEL_TABLE[1]`
 *   的 `槽 2 → 1`、`槽 5 → 4` 對得上。
 */
export const WHEEL_CHUNK = {
  angelIdle: 0,
  angelSpin: 1,
  discFirst: 2,
} as const;

/** 第 `slot` 格畫哪張圓盤圖 @source 0x0043f18d `圖號 = 槽 + 2` */
export function wheelDiscChunk(slot: number): number {
  return WHEEL_CHUNK.discFirst + slot;
}

/**
 * 對話框：`Data.mkf` **資源 517（0x205）圖 5**，249×170，錨點 (123,101) —— 棕色金邊的**訊息框**，
 * 與詢問框 / 訊息框 / 神明老虎機同一張（`gameui.ts` 的 `DIALOG_SKIN_IMAGE`）。
 *
 * @source 載入點 `rich4_load_map.asm:576`（`_read_mkf(data_mkf, 0x205, 0, 0)`）；
 *   繪製點 0x004409bb `add eax,0x48`：精靈記錄從 `+0x0c` 起每張 12 字節 ⇒ `(0x48 − 0x0c) / 12 = 5`。
 *   ★ 2026-09-23 訂正：先前寫成「0x48/12 = 圖 6」（漏減 0x0c 表頭），畫成了 `player_say` 的
 *   紅邊雲朵（圖 6，只有 0x0044f028 `add eax,0x54` 用它）。`dialog-templates.test.ts` 逐字節釘住。
 */
export const WHEEL_BUBBLE = { archive: 'Data.mkf', resource: 0x205, image: 5 } as const;

/**
 * 氣泡裡的兩行字 —— 表 `0x475cf8` 指到的四個串，**逐字照抄**（Big5）。
 *
 * @source 0x00475cf8 → 0x465210 / 0x465224 / 0x46523c / 0x46525c；
 *   `%s` 是**地主（業主）的角色名**（呼叫端 0x0041a3f3 `_rich4_strcpy(buf, player+0)`
 *   抄的就是玩家名，再 `push &buf` 傳進來）。第 5 項 0x465272 屬於另一個
 *   窗口過程（`fcn_0043f23e`，改建卡那一路），本屏不畫。
 */
export const WHEEL_BUBBLE_FMT: readonly string[] = [
  '%s\n\n送您出國旅遊...',
  '%s的旅館\n\n請進來休息...',
  '%s的購物中心\n\n您的消費倍數為...',
  '%s\n\n您的投保天數為...',
];

/** `轉盤` + 角色名 → 氣泡文字（`%s` 只有一處，`replace` 即可） */
export function wheelBubbleText(wheel: number, name: string): string {
  const fmt = WHEEL_BUBBLE_FMT[wheel];
  return fmt === undefined ? '' : fmt.replace('%s', name);
}

// ============================================================
//  音效
// ============================================================

/**
 * 轉動中的循環音 = `Effect.mkf` **52（0x34）**。
 *
 * @source VA 0x0043f80d：`push ebx / push 0x475d4c / call _rich4_play_sound_effect`，
 *   進函式時 `mov edx,1 / mov ebx,edx`，故 flags = **1 = `DSBPLAY_LOOPING`**；
 *   `0x475d4c` 第一格 dword = 52（dump：`34 00 00 00`）。
 */
export const WHEEL_SPIN_SOUND = 52;

/** 落地那一下的一次性音 = `Effect.mkf` **1** @source VA 0x0043f8a0（`0x482322` 第一格 dword = 1）*/
export const WHEEL_LAND_SOUND = 1;

// ============================================================
//  版面（屏幕坐標 640×480）
// ============================================================

/** 圓盤落點 @source 0x0043f17d / 0x0043f8fe / 0x00440a0e 的 `push 0xdc / push 0x140` */
export const WHEEL_DISC_AT = { x: 0xdc, y: 0x140 } as const;
/** 天使落點 @source 0x0043f1bd / 0x00440a01 的 `push 0x109 / push 0xe6` */
export const WHEEL_ANGEL_AT = { x: 0x109, y: 0xe6 } as const;
/** 氣泡落點 @source 0x004409ac `push 0x8c` / 0x004409b1 `push 0xdc` */
export const WHEEL_BUBBLE_AT = { x: 0xdc, y: 0x8c } as const;

/**
 * 氣泡文字：畫在 **(220,140)、flag 4 = 正中**。
 *
 * @source 0x00440a35 `push 4 / push 0x8c / push 0xdc`；
 *   flag 4 的語義見 `docs/handoff.md` §5 的七路跳表 0x44faa0：
 *   `x -= w/2; y -= h/2`（VA 0x0044ff2a），即 x/y 是**文字塊的中心**。
 */
export const WHEEL_TEXT_AT = { x: 0xdc, y: 0x8c } as const;

/**
 * 文字樣式。@source 0x0044094e `_rich4_create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)`
 *   —— 第一個色是**內文**、第二個是**陰影**（與魔法屋同一個約定，見 magic-screen.ts）；
 *   陰影是原地往右下 1px 再畫一遍（VA 0x0044fd54 起那三趟 `DrawTextA`）。
 *
 * `lineGap` 是我們補的行距：原版把整串丟給 GDI `DrawTextA`（VA 0x0044fbc9），
 *   行距是字體自帶的；本倉庫其他多行文字一律用「字級 + 6」（`shop-screen.ts`
 *   的氣泡、`lottery-screen.ts` 的氣泡、`board-screen.ts` 的訊息框）。
 */
export const WHEEL_TEXT = {
  size: 0x10,
  fill: '#f0f0f0',
  shadow: '#101010',
  lineGap: 6,
} as const;


// ============================================================
//  幀序（純函式，單測釘住）
// ============================================================

/** 一幀最短 36ms @source 0x0043faab `cmp esi, 0x24 / jb` */
export const WHEEL_FRAME_MS = 0x24;
/** 快轉段 40 幀 @source 0x0043f861 `cmp ebp, 0x28 / jb`（0x0043f84f 判的是「是不是真人」）*/
export const WHEEL_FAST_STEPS = 0x28;
/** 減速段每一檔走 3 格 @source 0x0043f9d2 `mov [esp+0x30], 3` */
export const WHEEL_SLOW_EVERY = 3;
/** 減速最多到 5 倍慢 @source 0x0043f9df `cmp [esp+0x34], 5 / jl` */
export const WHEEL_MAX_DELAY = 5;
/** 停在落點後再等 0x28 = 40 幀才關屏 @source 0x0043fa19 `cmp ebp, 0x28 / jne` */
export const WHEEL_HOLD_FRAMES = 0x28;
export const WHEEL_HOLD_MS = WHEEL_HOLD_FRAMES * WHEEL_FRAME_MS;

/**
 * 減速段從第幾格開始 —— 貼著尾巴的那 12 格（`3 × (5−1)`）。
 *
 * ★ 原版是「快轉 40 幀之後開始一檔一檔變慢、慢到 5 倍為止」，
 *   但那是**點擊／自動**那條時間線決定的（D-003 不復刻）；
 *   本引擎的總格數是固定的，所以把減速段**貼在尾巴上**，
 *   保證「最後幾格一定是最慢那一檔」—— 看起來一樣是先快後慢停下來。
 */
export function wheelSlowFrom(total: number): number {
  return Math.max(0, total - WHEEL_SLOW_EVERY * (WHEEL_MAX_DELAY - 1));
}

/**
 * 這一趟轉幾格。
 *
 * ★ 原版真人那一路的格數**取決於點擊時機**（快轉段一直轉到鬆手為止），
 *   所以不可復現（D-003）。本引擎固定走 **4 圈 + 起點到落點的距離** ——
 *   原版自動那一路是快轉 0x28 幀（≡ 3⅓ 圈）再加減速段的十來格，
 *   四圈多落在同一個量級，看起來一樣是「先快後慢停下來」。
 *
 * `stop === start` 時仍要走滿一圈（倍數就是起點那格，不能站著不動）。
 */
export const WHEEL_REVOLUTIONS = 4;

/** 從 `start` 往前走到 `stop` 要走幾格（不含起點那一幀） */
export function wheelSpinSteps(start: number, stop: number): number {
  const dist = (((stop - start) % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS;
  return WHEEL_SLOTS * WHEEL_REVOLUTIONS + (dist === 0 ? WHEEL_SLOTS : dist);
}

/** 走過 `step` 格之後正指著哪個槽 —— 順時針一格一格走 @source 0x0043f127 `inc / cmp 0xc` */
export function wheelSlotAt(start: number, step: number): number {
  return (((start + step) % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS;
}

/**
 * 走第 `step` 格（1 基）之前要等幾幀。
 *
 * 減速段**貼著尾巴算**：最後 `3 × (5−1) = 12` 格逐檔變慢（延遲 2,3,4,5，每檔 3 格），
 * 前面全是快轉（延遲 1）。@source 0x0043f9c7 起：步進條件是
 * `ebp − 上次 = [esp+0x34]`，而 `[esp+0x34]` 每走 3 格 +1、上限 5。
 */
export function wheelStepDelay(step: number, total: number): number {
  const slowFrom = wheelSlowFrom(total);
  if (step <= slowFrom) return 1;
  const level = 2 + Math.floor((step - slowFrom - 1) / WHEEL_SLOW_EVERY);
  return Math.min(WHEEL_MAX_DELAY, level);
}

/** 第 `step` 格要等多少毫秒 */
export function wheelStepWait(step: number, total: number): number {
  return WHEEL_FRAME_MS * wheelStepDelay(step, total);
}

/**
 * 這一趟的**完整幀序**（起點 → 落點，含起點那一幀）。
 *
 * ★ `animate === false` 時**只有落點那一幀** —— 不播動畫、直接顯示結果。
 *   ⚠️ **原版沒有這一支的調用點**：轉盤不受「動畫過程」管轄（見檔頭與
 *   D-WHEEL-3），這個參數只是本引擎現成的出口，正式路徑一律 `true`。
 */
export function wheelFrameSequence(start: number, stop: number, animate = true): number[] {
  if (!animate) return [stop];
  const total = wheelSpinSteps(start, stop);
  const out: number[] = [];
  for (let step = 0; step <= total; step++) out.push(wheelSlotAt(start, step));
  return out;
}

/** 天使這一幀用哪張圖：還在快轉段就是常態那張，進了減速段換成轉動那張 @source 0x0043f883(arg 0) / 0x0043f9b9(arg 1) */
export function wheelAngelChunk(step: number, total: number): number {
  return step < wheelSlowFrom(total) ? WHEEL_CHUNK.angelIdle : WHEEL_CHUNK.angelSpin;
}

/** 一次回放的進度 */
export interface WheelSpin {
  /** 起點槽 0..11 */
  start: number;
  /** 落點槽 0..11 */
  stop: number;
  /** 已經走過的格數 */
  step: number;
  /** 這一格是從什麼時候開始等的 */
  at: number;
  /** 這一格要等多久 */
  wait: number;
}

export function wheelSpinStart(start: number, stop: number, now: number): WheelSpin {
  const total = wheelSpinSteps(start, stop);
  return { start, stop, step: 0, at: now, wait: wheelStepWait(1, total) };
}

/** 這一刻正指著的槽 */
export function wheelSpinSlot(spin: WheelSpin): number {
  return wheelSlotAt(spin.start, spin.step);
}

/** 走完了沒有 */
export function wheelSpinLanded(spin: WheelSpin): boolean {
  return spin.step >= wheelSpinSteps(spin.start, spin.stop);
}

/** 推一格（沒到時間就原樣返回）*/
export function wheelSpinTick(spin: WheelSpin, now: number): WheelSpin {
  const total = wheelSpinSteps(spin.start, spin.stop);
  if (spin.step >= total) return spin;
  if (now - spin.at < spin.wait) return spin;
  const step = spin.step + 1;
  return { ...spin, step, at: now, wait: wheelStepWait(step + 1, total) };
}

/**
 * 跳到**減速段的起點** —— 真人點一下就是這個效果。
 *
 * @source 0x0043fa7f：真人點一下把 `ebx` 從 1 推到 2（快轉段結束、進減速段），
 *   或從 5 推到 6（停好之後提早關屏）。原版那一下之後**還要轉十幾格**才停
 *   （停在哪取決於點擊時機 —— 那正是 D-003 不復刻的部分）；本引擎落點已由
 *   core 定死，所以「按一下」= 直接進減速段、照樣停在同一個落點上。
 *   已經進減速段之後再點就沒事了（原版也是）。
 */
export function wheelSpinSkipToSlow(spin: WheelSpin, now: number): WheelSpin {
  const total = wheelSpinSteps(spin.start, spin.stop);
  const slowFrom = wheelSlowFrom(total);
  if (spin.step >= slowFrom) return spin;
  return { ...spin, step: slowFrom, at: now, wait: wheelStepWait(slowFrom + 1, total) };
}

/**
 * 這個玩家的點擊對這一屏有沒有作用。
 *
 * @source 0x0043fa66 起：`0x202`（左鍵抬起）/ `0x205`（右鍵）/ `0x101`（按鍵）
 *   三種訊息，且當前玩家 `whoPlays == 1`（`cmp byte[eax+0x496b7d],1 / jne`）
 *   且 `+0x37`（夢遊）為 0 時，才把狀態機往前推 —— `ebx 1→2`（開始減速）
 *   或 `ebx 5→6`（停好之後提早關屏）。AI 一路自己走，點了不算。
 */
export function wheelClickable(cue: WheelCue): boolean {
  return cue.human;
}

// ============================================================
//  從 before/after 反推這次轉盤
// ============================================================

/** 這次要回放什麼 */
export interface WheelCue {
  /**
   * 這一趟是哪一支開的盤：
   * - `facility` —— 旅館 / 購物中心（業主收費，@source 0x0041a44e / 0x0041a4aa）；
   * - `company`  —— 航空公司 / 保險公司（企業收費，@source 0x0041abc4 / 0x0041a9fe、0x0041ac3c）。
   */
  kind: 'facility' | 'company';
  /** `WHEEL.hotel` / `WHEEL.mall` / `WHEEL.travel` / `WHEEL.insurance` */
  wheel: number;
  /** 起點槽 0..11（= `rand() % 12`）*/
  start: number;
  /** 落點槽 0..11（起點之後第一個非空格）*/
  stop: number;
  /** 停在的那個數字（旅館 = 天數、購物中心 = 消費倍數、航空 = 旅遊天數、保險 = 投保天數）*/
  value: number;
  /** 設施下標（`state.facilityLastToll` 用的那個）；`company` 那一支恒 −1 */
  facilityId: number;
  /** 企業下标（`company` 那一支；`facility` 那一支恒 −1）*/
  commercialId: number;
  /** 業主（1 基，與 `facilityOwner` 同一套編碼）；`company` 那一支是**董事長** 1 基 */
  owner: number;
  /** 付費的那一位（玩家下標）*/
  payer: number;
  /** 付費的是不是真人 —— 只有真人的點擊會推狀態機 @source 0x0043fa66 */
  human: boolean;
}

/**
 * 起點之後第一個非空格 —— **與 core 的 `spinWheel()` 是同一個走法**。
 *
 * @source 0x0043f127（每格 `+1 % 12`）配 0x0043f9fa（停在第一個 `!= 0xff`）；
 *   core 的 `spinWheel()` 是同一條，故 `WHEEL_TABLE[wheel][firstFilledSlot(...)]`
 *   必定等於 `spinWheel(wheel, randValue)`（單測釘住）。
 */
export function firstFilledSlot(wheel: number, start: number): number {
  const table = WHEEL_TABLE[wheel];
  if (table === undefined) return 0;
  let slot = ((start % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS;
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    if ((table[slot] ?? WHEEL_BLANK) !== WHEEL_BLANK) return slot;
    slot = (slot + 1) % WHEEL_SLOTS;
  }
  return slot;
}

/** 這次轉盤轉出來的那個數 */
export function wheelValueOf(wheel: number, stop: number): number {
  const v = WHEEL_TABLE[wheel]?.[stop];
  return v === undefined || v === WHEEL_BLANK ? 0 : v;
}

/**
 * 剛剛是不是轉了一次轉盤？是的話把三件事解出來。
 *
 * 判據全部**純查 `before` + `topo`**。兩支：
 *
 * ### ① `facility`：旅館 / 購物中心（與 `settleFacility()` VA 0x0041a370 對應）
 *
 * 1. 當前玩家正**站在設施格上**（`facilityIndexOf(node.type)`，節點沒有 `specialKind`）；
 * 2. 那是一處**別人的** `level > 0` 的 **旅館 / 購物中心**
 *    —— 自己的走「首建／加蓋」、公園與研究所在收費那一路一開頭就 return（0x0041a386 / 0x0041a38f）；
 * 3. **隨機數真的動了** —— 查封／同盟／死神那三條免收在**轉盤之前**就 return
 *    （0x0041a3cc 的 `0x41d559`），那種情況一個 `rand()` 都不取；
 *    反過來，這一條路上唯一的隨機數消耗就是轉盤的 `rand() % 12`。
 *
 * ### ② `company`：航空公司 / 保險公司（T-039 D-WHEEL-9，2026-09-16 補）
 *
 * 同一個 `fcn_0044090e` / `fcn_0043f7c6` 也服務這兩種上市企業，入口在
 * `rich4_player_core_actions.asm` 的 **0x0041ab6d**（踩到**別人的**公司）：
 *
 * | 行業 | 轉盤 | @source |
 * |---|---|---|
 * | 1 航空 | **0**（`Panel.mkf` 68）| `loc_0041abb0`：`xor ebp,ebp` → `push ebp`（0x0041abc4）|
 * | 4 保險 | **3**（`Panel.mkf` 71）| `loc_0041ac3c`：`push 3` |
 *
 * 前置條件與設施那支同構：**別人的**公司（董事長不是 0 也不是我）、
 * `before.rngState` 動了（`industryUsesWheel()` 為真的行業才取那個 `rand()`）。
 * 氣泡裡的 `%s` 這支是**企業名**（`lea edi,[ebx+4]`，0x0041a9c0 —— 直接把名字
 * 指針傳進去，不經玩家名緩衝），設施那支才是業主的角色名。
 *
 * ★ 起點槽 = `new WatcomRng(before.rngState).next() % 12` @source 0x0043f7da。
 *
 * ⚠️ 解不出來的三種（都登記在 `docs/deviations/T-039.md`）：① 玩家被傳送／夢遊
 *   之類的動作改掉了落點（那時 `before` 的節點已經不是設施格）；
 *   ② 原版**真人**那一路按一下就停、格數取決於點擊時機，本引擎無從得知
 *   （D-003：結果由 core 定），故起點一律按「第一次 `rand()`」推；
 *   ③ 同一次 `settle` 裡若在轉盤**之前**還有別的隨機數消耗，起點就會偏一格 ——
 *   這兩條路上只有轉盤自己在取隨機數（見上），故不會發生。
 *   ★ 保險那一支另外拿 `after` 的保險期**反查**一道（`+0x3e` 加的就是盤上那個數，
 *   @source 0x0041aa0e）：對不上就不播 —— 這是起點推錯時的保險絲。
 */
export function wheelCue(
  before: GameState,
  after: GameState,
  topo: MapTopology,
): WheelCue | null {
  const payer = before.currentPlayer;
  const p = before.players[payer];
  if (p === undefined) return null;
  // 轉盤只出現在「結算」這一步
  if (before.phase !== 'settling') return null;
  const node = topo.nodes[p.nodeId - 1];
  if (node === undefined || node.specialKind !== 0) return null;
  // ★ 一個 rand() 都沒取 = 這一趟沒有轉盤（免收那三條 / 不取隨機數的行業）
  if (before.rngState === after.rngState) return null;
  const human =
    (p.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN && p.blocking.sleepWalking === 0;
  const slots = (wheel: number): Pick<WheelCue, 'start' | 'stop' | 'value'> => {
    const start = new WatcomRng(before.rngState).next() % WHEEL_SLOTS;
    const stop = firstFilledSlot(wheel, start);
    return { start, stop, value: wheelValueOf(wheel, stop) };
  };

  // ── ① 設施：旅館 / 購物中心 ──
  const facilityId = facilityIndexOf(node.type);
  if (facilityId !== null) {
    const fac = effectiveFacility(before, topo, facilityId);
    if (fac !== null) {
      const wheel =
        fac.type === FACILITY_TYPE.hotel
          ? WHEEL.hotel
          : fac.type === FACILITY_TYPE.mall
            ? WHEEL.mall
            : -1;
      if (wheel >= 0 && fac.level > 0 && fac.owner !== 0 && fac.owner !== payer + 1) {
        return {
          kind: 'facility',
          wheel,
          ...slots(wheel),
          facilityId,
          commercialId: -1,
          owner: fac.owner,
          payer,
          human,
        };
      }
    }
  }

  // ── ② 企業：航空公司（轉盤 0）/ 保險公司（轉盤 3）──
  const ref = node.ref;
  if (ref.kind !== 'commercial') return null;
  const c = topo.commercials?.find((x) => x.id === ref.index);
  if (c === undefined) return null;
  const wheel =
    c.type === INDUSTRY.airline
      ? WHEEL.travel
      : c.type === INDUSTRY.insurance
        ? WHEEL.insurance
        : -1;
  if (wheel < 0) return null;
  const chairman = ownerOf(before.commercialOwners[c.id] ?? emptyOwnership());
  if (chairman < 0 || chairman === payer) return null;
  const derived = slots(wheel);
  if (wheel === WHEEL.insurance) {
    // @source 0x0041aa0e：`player.+0x3e = (player.+0x3e + 盤上那個數) & 0x7f`
    const want = addInsuranceDays(p.insuranceDays, derived.value);
    if (after.players[payer]?.insuranceDays !== want) return null;
  }
  return {
    kind: 'company',
    wheel,
    ...derived,
    facilityId: -1,
    commercialId: c.id,
    owner: chairman + 1,
    payer,
    human,
  };
}

// ============================================================
//  繪製（只做 IO）
// ============================================================

/** 這一幀要畫成什麼樣 */
export interface WheelDraw {
  cue: WheelCue;
  /** 這一刻正指著的槽 */
  slot: number;
  /** 天使這一幀用哪張圖（`wheelAngelChunk`）*/
  angel: number;
  /** 氣泡裡的兩行字（`wheelBubbleText`）*/
  text: string;
}

/** 錨點落點繪製 @source `fcn_00456418`（`to_left = x − src->x`）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/** 三張圖原版都走帶透明的 `fcn_00456418`（0x004409c6 / 0x0043f1ae / 0x0043f1d7）*/
function wheelSprite(sprite: WheelSprite, archive: ArchiveName, resource: number, chunk: number): Sprite | null {
  return sprite(archive, resource, chunk, true);
}

/**
 * 畫整屏。
 *
 * 順序照原版：氣泡（0x004409b6）→ 圓盤（0x004409dd）→ 天使（0x004409fe）→ 字（0x00440a35）。
 * 圓盤壓在氣泡的下緣上、天使又壓在圓盤上，所以三步的**先後不能換**。
 */
export function drawWheelScreen(
  ctx: CanvasRenderingContext2D,
  sprite: WheelSprite,
  d: WheelDraw,
): void {
  const resource = wheelResource(d.cue.wheel);

  // ── ① 對話氣泡 ──
  drawAnchored(
    ctx,
    wheelSprite(sprite, WHEEL_BUBBLE.archive, WHEEL_BUBBLE.resource, WHEEL_BUBBLE.image),
    WHEEL_BUBBLE_AT.x,
    WHEEL_BUBBLE_AT.y,
  );

  // ── ② 圓盤（預轉好的那一幀）──
  drawAnchored(
    ctx,
    wheelSprite(sprite, 'Panel.mkf', resource, wheelDiscChunk(d.slot)),
    WHEEL_DISC_AT.x,
    WHEEL_DISC_AT.y,
  );

  // ── ③ 天使（壓在圓盤上）──
  drawAnchored(
    ctx,
    wheelSprite(sprite, 'Panel.mkf', resource, d.angel),
    WHEEL_ANGEL_AT.x,
    WHEEL_ANGEL_AT.y,
  );

  // ── ④ 氣泡裡的兩行字（`\n\n` 當空行留著，GDI 就是這麼排的）──
  const lines = d.text.split('\n');
  if (lines.length === 0) return;
  const lh = WHEEL_TEXT.size + WHEEL_TEXT.lineGap;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    if (line === '') return;
    const y = WHEEL_TEXT_AT.y + (i - (lines.length - 1) / 2) * lh;
    // 粗体 + 右下 1 px 阴影（`create_font(…, 3, 1)` 的 bit1 / bit0，@source 0x0044fa3f / 0x0044fc31）
    drawGdiText(ctx, line, WHEEL_TEXT_AT.x, y, {
      size: WHEEL_TEXT.size,
      color: WHEEL_TEXT.fill,
      color2: WHEEL_TEXT.shadow,
      flags: 3,
      spacing: 1,
    });
  });
}

// ============================================================
//  屏幕本體
// ============================================================

interface WheelPlayback {
  cue: WheelCue;
  spin: WheelSpin;
  /** 停在落點上的時刻；`null` = 還在轉 */
  landedAt: number | null;
}

/** 現在正在播的那一段；`null` = 沒在播 */
let playback: WheelPlayback | null = null;

/** 调试 / 单测用：把整屏关掉 */
export function resetWheelScreen(): void {
  playback = null;
}

/** 给单测的只读视图 */
export function wheelScreenState(): {
  playing: boolean;
  cue: WheelCue | null;
  slot: number;
  landed: boolean;
} {
  return {
    playing: playback !== null,
    cue: playback?.cue ?? null,
    slot: playback === null ? 0 : wheelSpinSlot(playback.spin),
    landed: playback === null ? false : wheelSpinLanded(playback.spin),
  };
}

/** 業主的角色名（原版呼叫端 0x0041a3f3 抄的是玩家名，本引擎角色名在 `@rich4/data`）*/
function ownerName(env: UiScreenEnv, owner: number): string {
  const p = env.state.players[owner - 1];
  return CHARACTERS[p?.character ?? 0]?.name ?? '';
}

/**
 * 氣泡裡 `%s` 那一段。
 *
 * - `facility`（旅館 / 購物中心）：**業主的角色名** —— 原版 0x0041a3f3 先把
 *   `player[owner].name` 抄進緩衝再傳給 `fcn_0044090e`；
 * - `company`（航空 / 保險）：**企業名** —— 原版 `lea edi,[ebx+4]`（0x0041a9c0）
 *   直接把企業記錄的 `+4`（名字）當指針傳進去。
 */
export function cueName(env: UiScreenEnv, cue: WheelCue): string {
  if (cue.kind === 'company') {
    return env.topo.commercials?.find((c) => c.id === cue.commercialId)?.name ?? '';
  }
  return ownerName(env, cue.owner);
}

/**
 * 原版的「點一下」—— `0x202`（左鍵抬起）/ `0x205`（右鍵）/ `0x101`（按鍵）
 * 三種訊息**共用同一支**（@source `0x0043fa66` 起，三者都落到 `esi = 2` 那支）。
 * 還在快轉就進減速段；已經停好就立刻關屏。
 *
 * 「點了算不算」的判据在 `wheelClickable`：`whoPlays == 1`（真人）且
 * `+0x37`（夢遊）为 0 —— AI 一路自己走，點了不算。
 */
function clickWheel(env: UiScreenEnv): void {
  const play = playback;
  if (play === null || !wheelClickable(play.cue)) return;
  if (play.landedAt !== null) {
    playback = null;
    env.log('轉盤：按一下提早關屏');
    env.requestRender();
    return;
  }
  const next = wheelSpinSkipToSlow(play.spin, env.now);
  if (next === play.spin) return;
  playback = { ...play, spin: next };
  env.requestRender();
}

export const wheelScreen: UiScreen = {
  id: 'wheel',

  /**
   * ★ 浮窗：原版把 (0,40)-(440,480) 那塊畫在**棋盤之上**（只有那塊進離屏快取），
   *   所以轉盤全程看得到棋盤與右側欄。本屏所有部件都在那塊矩形裡，
   *   宣告 `windowed` 讓 `main.ts` 先照常畫一整幀棋盤（@source 0x00440988 /
   *   0x0044090e 的 `fcn_00451e7e`）。
   */
  windowed: true,

  /** 演出期間接管整屏；停完 `WHEEL_HOLD_MS` 自己關 */
  active: () => playback !== null,

  draw(env: UiScreenEnv): void {
    const play = playback;
    if (play === null) return;
    const total = wheelSpinSteps(play.spin.start, play.spin.stop);
    drawWheelScreen(env.stage, env.sprite, {
      cue: play.cue,
      slot: wheelSpinSlot(play.spin),
      angel: wheelAngelChunk(play.spin.step, total),
      text: wheelBubbleText(play.cue.wheel, cueName(env, play.cue)),
    });
  },

  /**
   * 真人點一下 = 原版把狀態機往前推：還在快轉就進減速段，已經停好就立刻關屏。
   * AI 與夢遊中的玩家點了不算 @source 0x0043fa66。
   */
  down(_x: number, _y: number, env: UiScreenEnv): void {
    clickWheel(env);
  },

  /**
   * `WM_KEYDOWN`（0x101）—— 第三种「点一下」@source `0x0043fa66`：
   * `0x202`（左键抬起）/ `0x205`（右键）/ `0x101`（按键）三者在原版**共用
   * 同一支处理**（同一个 `esi = 2` 分支），所以这里与鼠标走同一个 `clickWheel`。
   *
   * ⚠️ 同一处也说明「点了算不算」的判据是 `whoPlays == 1`（真人）且
   *   `+0x37`（夢遊）为 0 —— 那是 `wheelClickable`。
   */
  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    clickWheel(env);
    return true;
  },

  /**
   * 联机旁观：行动者那台已经收场（见 `ui-screen.ts` 的 `fastForward`）⇒ 直接关屏。
   *
   * ★ 不看 `wheelClickable`：那是「这一下点击算不算」（电脑的转盘点了不算），
   *   这里是「行动者那台整段都转完、关掉了」—— 无论谁的转盘都已落定（值在 core 里早算好）。
   *   还在转就把循环的 52 号停掉（落地那一声 1 不补：他那边早响过了）。
   */
  fastForward(env: UiScreenEnv): boolean {
    const play = playback;
    if (play === null) return false;
    if (play.landedAt === null) env.stopEffect(WHEEL_SPIN_SOUND);
    playback = null;
    env.log('轉盤：跟著行動者收場');
    env.requestRender();
    return true;
  },
  tick(env: UiScreenEnv): void {
    const play = playback;
    if (play === null) return;
    if (play.landedAt !== null) {
      if (env.now - play.landedAt >= WHEEL_HOLD_MS) {
        playback = null;
        env.log('轉盤：演出結束');
      }
      env.requestRender();
      return;
    }
    const next = wheelSpinTick(play.spin, env.now);
    if (next !== play.spin) {
      const landed = wheelSpinLanded(next);
      playback = { ...play, spin: next, landedAt: landed ? env.now : null };
      if (landed) {
        // ★ 落地：先停循環的 52、再放一次性那聲 1
        //   @source 0x0043fa0a `fcn_004542e9(&0x475d4c)`（停）+ 0x0043f8a0（放 1）
        env.stopEffect(WHEEL_SPIN_SOUND);
        env.playEffect(WHEEL_LAND_SOUND);
        env.log(`轉盤：停在 ${next.stop} 格（${wheelValueOf(play.cue.wheel, next.stop)}）`);
      }
    }
    // ★ **每一幀都要續幀**（不是只在換格時）—— `tick` 只在 `requestRender`
    //   排的那一幀裡被調用（見 main.ts 的註釋），中間不續幀這一趟就會斷在
    //   半路，只能等 GO 鈕那個 500ms 定時器把它撈回來（動畫會一跳一跳）。
    env.requestRender();
  },

  /**
   * 察覺「剛剛轉了一次旅館 / 購物中心的轉盤」。
   *
   * ★ 與 `magic-screen.ts` 同一套路：`before → after` 反推。差別是這裡連
   *   **起點槽**都反得出來 —— 它就在 `before.rngState` 的第一次 `rand()` 裡。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return; // 上一段還沒播完
    if (before === after) return;
    const cue = wheelCue(before, after, env.topo);
    if (cue === null) return;
    playback = { cue, spin: wheelSpinStart(cue.start, cue.stop, env.now), landedAt: null };
    // ★ 起播那一下：循環音 52 @source 0x0043f80d（flags = `ebx` = 1 = DSBPLAY_LOOPING）
    env.playEffect(WHEEL_SPIN_SOUND, true);
    env.log(`轉盤：起點 ${cue.start} → 落點 ${cue.stop}（${cue.value}）`);
    env.requestRender();
  },
};
