/*
 * 過路費：把「算進這筆錢的地塊」一起閃一遍（W-69）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方報「四塊同街的地只觸發了當格」——**錢沒算錯**（`core/rules/toll.ts` 的
 * `calculateLandToll()` 逐塊查表相加 × 物價指數，上面那個 4800 的用例原樣入庫），
 * 缺的是**收費之前那一段演出**：原版把算進去的每一塊地在棋盤 id 圖上標成 `0xffff`，
 * 再一起閃 16 幀。
 *
 * @source `rich4_player_core_actions.asm` 的落點結算尾巴（VA 0x00419b11..0x00419c88）
 *   —— 標記三處：`0x00419b9e` / `0x00419c1a` / `0x00419c61`（`call 0x456c0a`）；
 *   塊數 ≤ 1 就整段跳過（`0x00419c79 cmp [esp+0xe8],1 / jle`）。
 * @source 閃爍本體 `fcn_00451985`（VA 0x00451985）：
 *   · 16 幀、每幀 **30 ms**（`0x00451a37 push 0x1e`）；
 *   · 第 k 幀給被標記的像素亮度加 `LEVEL[k]`（表 `0x476380`，int8；單位是
 *     **5 位色分量**，所以 16 = 半程）；
 *   · 16 幀走完再靜 **400 ms**（`0x00451a49 push 0x190`）；
 *   · 任意滑鼠鍵可跳過（`fcn_004528b9` 返回非 0 即 break）。
 *
 * 純函數：不讀 DOM、不碰音訊、不動 PRNG（C-DET-1/2/4），能單測。
 */

/** 一幀多少毫秒 @source `0x00451a37 push 0x1e` */
export const TOLL_FLASH_FRAME_MS = 0x1e;

/** 閃幾幀 @source `fcn_00451985` 的迴圈上界 */
export const TOLL_FLASH_FRAMES = 16;

/** 閃完之後靜多久 @source `0x00451a49 push 0x190` */
export const TOLL_FLASH_HOLD_MS = 0x190;

/**
 * 每一幀的亮度增量 @source 表 `0x476380`（16 個 int8）。
 *
 * 單位是 **5 位色分量**：16 = 半程。中間那一帧（k=7）是 0 = 不加不減。
 */
export const TOLL_FLASH_LEVELS: readonly number[] = [
  4, 8, 12, 16, 12, 8, 4, 0, -4, -8, -12, -16, -12, -8, -4, 0,
];

/** 整段演出多長（16×30 + 400 = 880 ms）*/
export const TOLL_FLASH_TOTAL_MS =
  TOLL_FLASH_FRAMES * TOLL_FLASH_FRAME_MS + TOLL_FLASH_HOLD_MS;

/**
 * 亮度 16（半程）對應的濾鏡分母 —— `brightness(1 + level/32)`。
 *
 * 5 位分量的滿量程是 31，故 ±16 就是 ±50% 亮度；用 `ctx.filter` 近似原版的
 * **逐像素加**（原版是改 id 圖上的像素值）。見 `docs/deviations/Q-TOLL-FX-1.md`。
 */
export const TOLL_FLASH_FULL_SCALE = 32;

/**
 * 這一刻的亮度增量；`null` = **整段演完**（呼叫端該收攤了）。
 *
 * `k = floor(elapsed / 30)`：`k < 16` 取表；`16 ≤ elapsed < 880` 是那段 400 ms 的
 * 靜止（0）；`elapsed ≥ 880` 返回 `null`。
 */
export function tollFlashLevel(elapsedMs: number): number | null {
  if (elapsedMs < 0) return TOLL_FLASH_LEVELS[0] ?? 0;
  const k = Math.floor(elapsedMs / TOLL_FLASH_FRAME_MS);
  if (k < TOLL_FLASH_FRAMES) return TOLL_FLASH_LEVELS[k] ?? 0;
  if (elapsedMs < TOLL_FLASH_TOTAL_MS) return 0;
  return null;
}

/**
 * 這一刻該給那些地塊套的 `ctx.filter`；`null` = 不套（= 原樣）。
 *
 * ★ 原版是按 id 圖**逐像素**加亮度，本引擎按**精靈**近似（整張建築一起亮）——
 *   登記在 `docs/deviations/Q-TOLL-FX-1.md`。
 */
export function tollFlashFilter(elapsedMs: number): string | null {
  const level = tollFlashLevel(elapsedMs);
  if (level === null || level === 0) return null;
  return `brightness(${1 + level / TOLL_FLASH_FULL_SCALE})`;
}
