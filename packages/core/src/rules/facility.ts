/*
 * 设施过路费
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准，落点结算函数内 VA 0x0041a404 起。
 *
 * 设施按 `type`（+0x18）分三种收费方式，**互不相同**：
 *
 * | type | 例子 | 计费方式 |
 * |---|---|---|
 * | 1 | 百貨類 | 单价 × **转盘倍数** |
 * | 2 | 百貨類 | 同上，只是转盘素材不同（`0x44090e` 的第一个参数 1 / 2） |
 * | 3 | 加油站 | **掷骰步数** × 500 × 交通工具倍率 |
 * | 其他 | — | 不收费 |
 *
 * @source 分派：
 * ```asm
 * mov al, byte [facility + 0x18]
 * cmp al, 2 / jb  → type 1 分支(0x41a421)
 *            jbe → type 2 分支(0x41a485)
 * cmp al, 3 / je  → type 3 分支(0x41a4db)
 * jmp 不收费(0x41a581)
 * ```
 */

import type { FacilityInfo } from '../loaders/map.ts';
import { facilityToll } from './god-toll.ts';

export const FACILITY_TYPE_SHOP_A = 1;
export const FACILITY_TYPE_SHOP_B = 2;
/** 加油站 @source 提示文案 `加油站`（VA 0x0046385e）与 `×%d`（0x00463913） */
export const FACILITY_TYPE_GAS_STATION = 3;

/**
 * 设施的**按等级费率表**，6 项 uint16，位于 `facility + 0x24`。
 *
 * @source VA 0x0041a429：
 * ```asm
 * al  = byte [facility + 0x1a]     ; level
 * eax = eax + eax                  ; level * 2
 * eax = eax + edx                  ; + facility 基址
 * bx  = word [eax + 0x24]          ; ★ word[facility + 0x24 + level*2]
 * ```
 *
 * ⚠️ **下标 0 不是租金**：`+0x24` 同时就是 `housePrice`。
 * 真正的租金是等级 1..5（`+0x26`..`+0x2e`），共 5 档——
 * 与设施最高等级表（VA 0x00474940）给 type 1/2 的上限 5 吻合。
 *
 * 真实地图里多处形如 `[1000, 750, 1750, 4000, 8000, 15000]`：
 * 下标 1..5 严格递增，只有下标 0 跳出序列。
 *
 * 原版寻址就是 `+0x24 + level*2`，照搬不改。
 */
export const FACILITY_RATE_TABLE_OFFSET = 0x24;

/**
 * 涨价标记使费率**翻倍**。
 * @source `cmp byte [facility + 0x1c], 0 / je 跳过 / add ebx, ebx`
 */
export function applyPriceStatus(rate: number, priceStatus: number): number {
  return priceStatus !== 0 ? rate + rate : rate;
}

/**
 * type 1 / 2 的**单价**（尚未乘转盘倍数）。
 *
 * `单价 = rateByLevel[level] × 物价指数 ×（涨价 ? 2 : 1）`
 */
export function shopUnitPrice(
  rateByLevel: readonly number[],
  level: number,
  priceIndex: number,
  priceStatus: number,
): number {
  const rate = rateByLevel[level] ?? 0;
  return applyPriceStatus(rate * priceIndex, priceStatus);
}

/**
 * type 1 / 2 的最终费用 = 单价 × 转盘倍数。
 *
 * @source VA 0x0041a4b2：
 * ```asm
 * push 2 / call 0x44090e        ; 转盘，返回倍数
 * mov  ebp, eax
 * imul ebp, ebx                 ; ★ 总额 = 倍数 × 单价
 * ```
 * 提示文案「您的消費金額為\n\n%dx%d倍=%d元」印证了三者关系。
 *
 * ★ 转盘是 UI（`0x44090e` 里在加载图素、播动画），按 C-ARC-2
 *   不进 core——倍数由外部作为 action 参数传入，core 只做乘法。
 */
export function shopToll(unitPrice: number, multiplier: number): number {
  return unitPrice * multiplier;
}

export interface FacilityTollInput {
  facility: FacilityInfo;
  /** type 1/2 的按等级费率表 */
  rateByLevel: readonly number[];
  priceIndex: number;
  /** type 3 用：本次掷骰总步数 */
  stepsTotal: number;
  /** type 3 用：付款方的 traffic_method */
  trafficMethod: number;
  /** type 1/2 用：转盘倍数（由 UI/AI 给出） */
  multiplier: number;
}

/**
 * 按设施类型算出过路费（**尚未经神明调整**）。
 *
 * 神明的加减在付款前另行施加，见 `rules/god-toll.ts` 的 `adjustTollByGod`。
 */
export function calculateFacilityToll(input: FacilityTollInput): number {
  const { facility, rateByLevel, priceIndex, stepsTotal, trafficMethod, multiplier } = input;

  switch (facility.type) {
    case FACILITY_TYPE_SHOP_A:
    case FACILITY_TYPE_SHOP_B: {
      const unit = shopUnitPrice(rateByLevel, facility.level, priceIndex, facility.priceStatus);
      return shopToll(unit, multiplier);
    }
    case FACILITY_TYPE_GAS_STATION:
      return facilityToll(stepsTotal, trafficMethod, priceIndex);
    default:
      // @source jmp 0x41a581，ebp 保持先前 `xor ebp, ebp` 的 0
      return 0;
  }
}
