/*
 * 换地卡 / 红卡 / 黑卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 */

import type { LandInfo } from '../loaders/map.ts';
import type { StockState } from '../places/stock.ts';

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
 * 红卡与黑卡都写 `stock_info` 偏移 +7 的 **`newsFlag`**（旧称 f7）。
 *
 * `newsFlag` 是**两个 4 位计数器**：高半字节 = 利多还剩几天，
 * 低半字节 = 利空还剩几天。非 0 时当日趋势固定 ±10%（利多优先），
 * 每日两个半字节各减 1（VA 0x0041cff9，见 stock-market.ts 的
 * `tickStockCountdowns`）。
 *
 * @source 红卡 VA 0x00444f88 `mov byte [ebx + 0x496987], 0x20`
 *   → **利多 2 天**（`stocks_on_map` 基址 0x496980，故 0x496987 = +0x07）
 * @source 黑卡 VA 0x004450f6 `mov byte [eax*4 + 0x496987], 2`
 *   → **利空 2 天**
 *
 * ⚠️ 两卡都是**整字节覆盖**：紅卡会清掉残存的利空天数，黑卡反之。照搬原版。
 */
export const RED_CARD_NEWS_FLAG = 0x20;
export const BLACK_CARD_NEWS_FLAG = 0x02;

export interface StockNewsResult {
  /** 12 支股票（仅目标股的 newsFlag 被改写） */
  stocks: StockState[];
  /** 命中的股票下标；越界为 -1 */
  affected: number;
}

/**
 * 红卡：把指定股票的 `newsFlag` 置为 0x20（**利多 2 天**）。
 * @source VA 0x00444f25（AI 分支选股经 `0x41e6f2(0)`，写入点 0x00444f88）
 *
 * ⚠️ 黑卡尾部的敌意循环（VA 0x0044515c 起）是**原版 bug**：
 *   priceDiff 恒为 0（函数开头快照 − 现价，中间无人改价），
 *   且 delta 以 double 压栈、update_hostility（0x40df69）只读 int 低 32 位，
 *   双重原因敌意恒为 0。红卡没有敌意段。故两卡都**不产生敌意**。
 */
export function applyRedCard(stocks: readonly StockState[], stockIndex: number): StockNewsResult {
  return writeNewsFlag(stocks, stockIndex, RED_CARD_NEWS_FLAG);
}

/**
 * 黑卡：把指定股票的 `newsFlag` 置为 0x02（**利空 2 天**）。
 * @source VA 0x0044503f（写入点 0x004450f6）
 */
export function applyBlackCard(stocks: readonly StockState[], stockIndex: number): StockNewsResult {
  return writeNewsFlag(stocks, stockIndex, BLACK_CARD_NEWS_FLAG);
}

/** @source `mov byte [stock*36 + 0x496987], imm` —— 整字节覆盖 */
function writeNewsFlag(
  stocks: readonly StockState[],
  stockIndex: number,
  value: number,
): StockNewsResult {
  const target = stocks[stockIndex];
  if (target === undefined) {
    return { stocks: [...stocks], affected: -1 };
  }
  const next = stocks.map((s, i) => (i === stockIndex ? { ...s, newsFlag: value } : s));
  return { stocks: next, affected: stockIndex };
}
