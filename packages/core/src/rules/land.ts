/*
 * 地产规则：买地、盖房、升级判定
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_player_core_actions.asm
 *   `_rich4_handle_player_land_on_node` @ VA 0x0041987e 起
 *
 * C-DET-3：全程整数运算。
 */

import type { LandInfo } from '../loaders/map.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

/**
 * 落点的地块类型区间。
 *
 * @source loc_004198b9:
 * ```asm
 * cmp bx, 0x7d0 / jbe → 别处      ; type <= 2000
 * cmp bx, 0xfa0 / jae → 别处      ; type >= 4000
 * sub eax, 0x7d0 / imul eax,0x34  ; landIdx = type - 2000
 * ```
 * 这独立印证了从地图数据统计得出的 type 基数：住宅 = 2000 + 下标。
 */
export const HOUSING_TYPE_MIN = 0x7d0; // 2000（不含）
export const HOUSING_TYPE_MAX = 0xfa0; // 4000（不含）

/**
 * 设施的 type 区间。
 * @source 落点结算 `cmp ebp, 0xfa0 / jle 别处` 与 `cmp ebp, 0x1770 / jge 别处`
 *   （VA 0x00417946）——与住宅的判法同构，都是**开区间**。
 */
export const FACILITY_TYPE_MIN = 0xfa0; // 4000（不含）
export const FACILITY_TYPE_MAX = 0x1770; // 6000（不含）

/** 由节点 type 取设施下标；不是设施则返回 null */
export function facilityIndexOf(type: number): number | null {
  if (type <= FACILITY_TYPE_MIN || type >= FACILITY_TYPE_MAX) return null;
  return type - FACILITY_TYPE_MIN;
}

/** 由节点 type 求住宅地块下标；不是住宅则返回 null */
export function housingIndexOf(type: number): number | null {
  if (type <= HOUSING_TYPE_MIN || type >= HOUSING_TYPE_MAX) return null;
  return type - HOUSING_TYPE_MIN;
}

/**
 * 购地价格 = (地价 + 房价 × 当前等级) × 物价指数。
 *
 * 买一块已开发的地（拍卖、银行拍卖等）要连同已盖的房子一起买下，
 * 故按等级把房价累加进去。
 *
 * @source loc_0041a013:
 * ```asm
 * cl = land[0x1a]          ; level
 * dx = land[0x1e]          ; house_price
 * edx = house_price * level
 * cx = land[0x1c]          ; land_price
 * edx += land_price
 * ebp = price_index * edx
 * ```
 */
export function landPurchasePrice(land: LandInfo, priceIndex: number): number {
  return (land.landPrice + land.housePrice * land.level) * priceIndex;
}

/**
 * 盖房／升级费用 = 房价 × 物价指数。
 *
 * @source loc_004198b9 自有地分支:
 * ```asm
 * movzx ebp, word [esi + 0x1e]     ; house_price
 * imul ebp, dword [_rich4_price_index]
 * ```
 */
export function upgradeCost(land: LandInfo, priceIndex: number): number {
  return land.housePrice * priceIndex;
}

/**
 * 阻止买地的神明状态。
 *
 * @source loc_0041a013: `cmp byte [eax + 63], 0xc / je → end`
 *   （+63 = 0x3f = god_info）
 * ⚠️ 取值 12 **未见于** rich4-re/docs 的记载（文档只列了 1/2/5/6）。
 *    语义待确认（DEVELOPMENT_PLAN.md Q3 相关），此处保留原始数值。
 */
export const GOD_BLOCKS_PURCHASE = 0x0c;

export type PurchaseBlock =
  | 'alreadyOwned'
  | 'sleepWalking'
  | 'godBlocked'
  | 'notEnoughCash';

/**
 * 能否购买该地块。
 *
 * @source loc_0041a013 的前置判断序列：
 *   1. `days_sleep_walking != 0` → 不可（梦游中无法决策）
 *   2. `god_info == 0xc` → 不可
 *   3. 价格 > 现金 → 不可
 */
export function canPurchase(
  land: LandInfo,
  player: Player,
  priceIndex: number,
): { ok: boolean; reason: PurchaseBlock | null; price: number } {
  const price = landPurchasePrice(land, priceIndex);
  if (land.owner !== 0) return { ok: false, reason: 'alreadyOwned', price };
  if (player.blocking.sleepWalking !== 0) return { ok: false, reason: 'sleepWalking', price };
  if (player.godInfo === GOD_BLOCKS_PURCHASE) return { ok: false, reason: 'godBlocked', price };
  if (price > player.cash) return { ok: false, reason: 'notEnoughCash', price };
  return { ok: true, reason: null, price };
}

export type UpgradeBlock =
  | 'notOwner'
  | 'maxLevel'
  | 'chainStore'
  | 'sleepWalking'
  | 'notEnoughCash';

/**
 * 能否在自有地块上盖房／升级。
 *
 * @source loc_004198b9 自有地分支的判断序列：
 * ```asm
 * cmp byte [esi + 0x1a], 5 / jae → end     ; 等级 >= 5 不可再建
 * cmp byte [esi + 0x18], 0  / jne → end     ; 连锁店不可升级
 * cmp byte [player + 55], 0 / jne → end     ; 梦游中不可
 * cost = house_price * price_index
 * cmp cost, player.cash / jg → 钱不够
 * ```
 */
export function canUpgrade(
  land: LandInfo,
  player: Player,
  priceIndex: number,
): { ok: boolean; reason: UpgradeBlock | null; cost: number } {
  const cost = upgradeCost(land, priceIndex);
  if (land.owner !== player.index + 1) return { ok: false, reason: 'notOwner', cost };
  if (land.level >= MAX_LAND_LEVEL) return { ok: false, reason: 'maxLevel', cost };
  if (land.type !== LAND_TYPE_HOUSE) return { ok: false, reason: 'chainStore', cost };
  if (player.blocking.sleepWalking !== 0) return { ok: false, reason: 'sleepWalking', cost };
  if (cost > player.cash) return { ok: false, reason: 'notEnoughCash', cost };
  return { ok: true, reason: null, cost };
}

/**
 * 落在地块上时的处境判定。
 *
 * @source loc_004198b9 的三岔：
 *   owner == 0              → 可购买
 *   owner == 当前玩家 + 1   → 自有地，可盖房
 *   否则                    → 他人地产，需付过路费
 */
export type LandingOnLand = 'unowned' | 'own' | 'other';

export function landingOnLand(land: LandInfo, playerIndex: number): LandingOnLand {
  if (land.owner === 0) return 'unowned';
  return land.owner === playerIndex + 1 ? 'own' : 'other';
}
