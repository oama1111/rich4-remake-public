/*
 * 换地卡 / 红卡 / 黑卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 */

import type { LandInfo } from '../loaders/map.ts';

// ============================================================
//  换地卡（4）
// ============================================================

/** 换地卡的选择参数 @source `push 0xe0c0202` —— 地块组 */
export const SWAP_LAND_SELECTION_PARAM = 0xe0c0202;

export interface SwapLandResult {
  lands: LandInfo[];
  ok: boolean;
}

/**
 * 换地卡：**交换两块地的归属**。
 *
 * @source VA 0x004427bb:
 * ```asm
 * mov byte [esi + 0x19], bl     ; 地块A.owner = 原B的owner
 * mov byte [edi + 0x19], al     ; 地块B.owner = 原A的owner
 * ```
 *
 * 只换 `owner`，**等级与类型原地不动**——换过去的地连同上面的房子一起易主。
 */
export function applySwapLandCard(
  lands: readonly LandInfo[],
  landIdA: number,
  landIdB: number,
): SwapLandResult {
  const a = lands.find((l) => l.id === landIdA);
  const b = lands.find((l) => l.id === landIdB);
  if (a === undefined || b === undefined || landIdA === landIdB) {
    return { lands: [...lands], ok: false };
  }
  const next = lands.map((l) => {
    if (l.id === landIdA) return { ...l, owner: b.owner };
    if (l.id === landIdB) return { ...l, owner: a.owner };
    return l;
  });
  return { lands: next, ok: true };
}

// ============================================================
//  红卡（24）/ 黑卡（25）—— 操纵股票
// ============================================================

/**
 * 红卡与黑卡都写 `stock_info` 的 **`f7`**（偏移 0x07）。
 *
 * @source 红卡 VA 0x00444f88 `mov byte [ebx + 0x496987], 0x20`
 * @source 黑卡 VA 0x004450f6 `mov byte [eax*4 + 0x496987], 2`
 *   （`stocks_on_map` 基址 0x496980，故 0x496987 即 `+0x07` = f7）
 *
 * ⚠️ `f7` 的**语义未明**（land.h 与 rich4_stocks.h 均未记载其含义），
 * 但两卡写入的值截然不同，按 C-FID-2 保留原始数值而不臆测命名。
 * 从卡名推测与「涨停 / 跌停」有关，**待确认**。
 */
export const STOCK_F7_RED = 0x20;
export const STOCK_F7_BLACK = 0x02;

export interface StockFlagResult {
  /** 12 支股票的 f7 值 */
  stockF7: number[];
  affected: number;
}

/**
 * 红卡：把指定股票的 `f7` 置为 0x20。
 * @source VA 0x00444f88
 */
export function applyRedCard(stockF7: readonly number[], stockIndex: number): StockFlagResult {
  if (stockIndex < 0 || stockIndex >= stockF7.length) {
    return { stockF7: [...stockF7], affected: -1 };
  }
  const next = [...stockF7];
  next[stockIndex] = STOCK_F7_RED;
  return { stockF7: next, affected: stockIndex };
}

/**
 * 黑卡：把指定股票的 `f7` 置为 2。
 * @source VA 0x004450f6
 */
export function applyBlackCard(stockF7: readonly number[], stockIndex: number): StockFlagResult {
  if (stockIndex < 0 || stockIndex >= stockF7.length) {
    return { stockF7: [...stockF7], affected: -1 };
  }
  const next = [...stockF7];
  next[stockIndex] = STOCK_F7_BLACK;
  return { stockF7: next, affected: stockIndex };
}
