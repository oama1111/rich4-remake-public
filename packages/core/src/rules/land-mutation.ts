/*
 * 地块状态变更 —— 拆除 / 涨价 / 查封
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 全部以原版 exe 反汇编为准，这是 16 张地块类卡片的共用底座。
 */

import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

// ============================================================
//  price_status —— 原来是个状态标记
// ============================================================

/**
 * 地块的状态标记。
 *
 * `land.h` 把它叫 `price_status`，实测是**状态枚举**：
 * 涨价卡写 0x50、查封卡写 0x51。
 *
 * ⚠️ **住宅与设施的该字段偏移不同**：
 *   housing_land → `0x17`
 *   business_land → `0x1c`
 * @source 涨价卡 VA 0x004454ef / 0x0044553e，查封卡 0x00445659 / 0x004456cb
 */
export const PRICE_STATUS = {
  NORMAL: 0,
  /** 涨价中 @source 涨价卡 `mov byte [land+0x17], 0x50` */
  RAISED: 0x50,
  /** 查封中 @source 查封卡 `mov byte [land+0x17], 0x51` */
  SEALED: 0x51,
} as const;

// ============================================================
//  拆除
// ============================================================

/**
 * 拆除的敌意系数。
 * @source 拆除卡 VA 0x00443c2b:
 * ```asm
 * eax = price_index
 * add eax, eax        ; pi*2
 * mov edx, eax
 * shl eax, 4          ; pi*32
 * sub eax, edx        ; ★ pi*30
 * ```
 */
export const DEMOLISH_HOSTILITY_FACTOR = 30;

export interface DemolishResult {
  land: LandInfo;
  /** 无主地块不记敌意 */
  hostilityDelta: number;
  /** 被拆的地块原主（玩家下标）；无主时为 -1 */
  victim: number;
}

/**
 * 拆除一级建筑。
 *
 * @source 拆除卡 VA 0x00443c0c:
 * ```asm
 * dec byte [land + 0x1a]        ; ★ level -= 1（无条件先减）
 * cmp byte [land + 0x18], 0     ; 是住宅吗？
 * je  跳过
 * mov byte [land + 0x1a], 0     ; ★ 连锁店：level 直接归 0
 * mov byte [land + 0x18], 0     ; ★ 连锁店：变回住宅
 * cmp byte [land + 0x19], 0     ; 无主则不记敌意
 * je  end
 * ```
 *
 * 即：**住宅只掉一级，连锁店被整个拆平并退回住宅**。
 */
export function demolishLand(land: LandInfo, priceIndex: number): DemolishResult {
  // 先无条件减一级
  let level = land.level - 1;
  let type = land.type;

  if (type !== LAND_TYPE_HOUSE) {
    // 连锁店：夷平并退回住宅
    level = 0;
    type = LAND_TYPE_HOUSE;
  }
  if (level < 0) level = 0;

  const owned = land.owner !== 0;
  return {
    land: { ...land, level, type },
    hostilityDelta: owned ? priceIndex * DEMOLISH_HOSTILITY_FACTOR : 0,
    victim: owned ? land.owner - 1 : -1,
  };
}

// ============================================================
//  涨价 / 查封
// ============================================================

/**
 * 给住宅地块打上状态标记。
 * @source 涨价卡 `mov byte [land+0x17], 0x50`；查封卡 `..., 0x51`
 */
export function markLand(
  land: LandInfo,
  status: (typeof PRICE_STATUS)[keyof typeof PRICE_STATUS],
): LandInfo {
  return { ...land, priceStatus: status };
}

/**
 * 给设施打上状态标记。
 *
 * ⚠️ 查封卡除了写状态，还会把设施的 `+0x1e` 清零。
 * @source 查封卡 VA 0x004456cb-0x004456d5:
 * ```asm
 * mov byte [fac + 0x1c], 0x51
 * mov byte [fac + 0x1e], 0
 * ```
 * `business_land` 的 `+0x1e` 未见于 land.h 记载，语义待确认，
 * 故此处以 `extraCleared` 显式表达而非静默忽略。
 */
export function markFacility(
  fac: FacilityInfo,
  status: (typeof PRICE_STATUS)[keyof typeof PRICE_STATUS],
): { facility: FacilityInfo; extraCleared: boolean } {
  return {
    facility: { ...fac, priceStatus: status },
    // 查封会额外清 +0x1e；涨价不会
    extraCleared: status === PRICE_STATUS.SEALED,
  };
}

/** 地块当前是否处于查封状态 */
export function isSealed(priceStatus: number): boolean {
  return priceStatus === PRICE_STATUS.SEALED;
}

/** 地块当前是否处于涨价状态 */
export function isRaised(priceStatus: number): boolean {
  return priceStatus === PRICE_STATUS.RAISED;
}
