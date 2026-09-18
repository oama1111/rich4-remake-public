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

/**
 * 「查封中」的**宽松**判据 —— 只看低半字节非 0。
 *
 * ★ 与 `isSealed` 不是同一条，别互相顶替：
 *   · `isSealed` 是**精确等值**（`== 0x51`），用于「贴的是哪张图」那类判断；
 *   · 这一条照抄原版几处闸门的写法 `test byte [...], 0xf / jne 跳过`
 *     （研究所的落点闸门 VA 0x0041b102、`tollExemption` 的查封那一支
 *     还要**两个半字节都非 0** 才免收）。
 *   涨价位是 `0x50`（低半字节 0）⇒ 本判据为假：涨价中的地/設施照样能办事。
 */
export function isSealedStrict(priceStatus: number): boolean {
  return (priceStatus & 0x0f) !== 0;
}

// ============================================================
//  每日递减 —— 涨价/查封状态的有效期
// ============================================================

/**
 * 涨价/查封状态**每天**递减一档（高 nibble = 剩余天数）。
 *
 * @source VA 0x0041d114（地块 +0x17）/ 0x0041d160（設施 +0x1c）：
 * ```asm
 * mov cl, byte [land + 0x17]
 * test cl, 0xf0 / je 下一块        ; 高 nibble 为 0 → 不动
 * ch = cl − 0x10; [land+0x17] = ch ; 高 nibble −1
 * test ch, 0xf0 / jne 下一块
 * mov byte [land + 0x17], 0        ; ★ 减到底 → 整字节清零（0x0041d129，
 *                                  ;   查封位一起清）
 * ```
 *
 * ★ 这两个循环（0x0041d0ff 起）在 `cmp edi,1 / jne 0x41d0ff` 的跨月守卫
 *   **之外** —— 是**每天**执行，不是每月。涨价卡写 0x50 即 5 天有效期：
 *   0x50 → 0x40 → … → 0x10 → 0。查封 0x51 同理，第 5 天减成 0x01
 *   时被整字节清 0，故查封位不会残存。
 */
export function sweepPriceStatus(status: number): number {
  if ((status & 0xf0) === 0) return status;
  const next = status - 0x10;
  return (next & 0xf0) === 0 ? 0 : next;
}
