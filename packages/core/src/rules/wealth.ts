/*
 * 总资产计算与物价指数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_calculate_player_wealth.asm @ VA 0x004239b9
 * @source rich4-re/asm/rich4_update_price_index.asm      @ VA 0x00423ad0
 */

import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

/** 玩家持有的一支股票 */
export interface StockHolding {
  /** 持股数 @source player_stock_info.amount（每项 8 字节，每人 12 支 = 96 字节） */
  amount: number;
  /**
   * 当前股价。
   * @source stock_info 的 `float f20`（偏移 20）——注意**不是** `f8`。
   *   `f8`(偏移 8) 是总股数（初始表里为 10000/5000 等），
   *   `f12/f16/f20` 三个 float 初值相同（如 100.0），`f20` 是估值时取用的那个。
   */
  price: number;
}

/** 股票支数 @source `cmp edx, 0xc / jl` —— 固定 12 支 */
export const STOCK_COUNT = 12;

/**
 * 计算玩家总资产。
 *
 * 构成：
 * ```
 * 现金 + 存款 − 贷款
 *   + Σ(持股数 × 股价)            ← 逐支累加，**每支之后都向零取整**
 *   + Σ(自有住宅：地价 + 等级×房价)
 *   + Σ(自有连锁店：地价 + 房价)   ← 与等级无关，与住宅不对称
 *   + Σ(自有设施：地价 + 等级×房价)
 * ```
 *
 * ⚠️ 股票部分原版用 x87 浮点，且**每支股票算完就 `fistp` 截断回整数**
 * （不是最后统一取整）。这里如实复刻逐次截断，否则多支股票时会有累积偏差。
 *
 * @source 现金/存款/贷款：`player[+28] + player[+32] − player[+36]`
 *   （0x1c cash / 0x20 money_in_bank / 0x24 loan）
 */
export function calculatePlayerWealth(
  player: Player,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
  stocks: readonly StockHolding[] = [],
): number {
  let total = player.cash + player.moneyInBank - player.loan;

  // 股票：逐支累加并截断 @source loc_004239e0
  for (let s = 0; s < STOCK_COUNT; s++) {
    const h = stocks[s];
    if (h === undefined) continue;
    total = Math.trunc(h.amount * h.price + total);
  }

  const ownerId = player.index + 1;

  // 住宅地块 @source loc_00423a2d
  for (const land of lands) {
    if (land.owner !== ownerId) continue;
    total += land.landPrice;
    if (land.type !== LAND_TYPE_HOUSE) {
      // 连锁店：固定加一份房价，**不乘等级**
      total += land.housePrice;
    } else if (land.level !== 0) {
      total += land.level * land.housePrice;
    }
  }

  // 设施 @source loc_00423a96
  //   total += level × house_price(0x24) + land_price(0x22)
  for (const fac of facilities) {
    if (fac.owner !== ownerId) continue;
    total += fac.level * fac.housePrice + fac.landPrice;
  }

  return total;
}

/**
 * 推进物价指数。
 *
 * ```
 * 新指数 = (在场玩家总资产之和 ÷ 在场人数) ÷ 初始资金
 * if (新指数 > 当前指数) 当前指数 = 新指数     ← ★ 只升不降
 * ```
 *
 * 这是游戏后期通货膨胀的来源：玩家越富，物价越高，且**永不回落**。
 *
 * ⚠️ 两次除法都是**有符号整数除法**（`idiv`，向零取整），不是浮点。
 *
 * @source rich4_update_price_index.asm
 * @param players           全体玩家（含已出局者，函数内部按 who_plays 过滤）
 * @param wealthOf          取某玩家总资产
 * @param initialFund       开局资金 `_rich4_game_initial_fund`
 * @param currentPriceIndex 当前物价指数
 * @returns 更新后的物价指数
 */
export function updatePriceIndex(
  players: readonly Player[],
  wealthOf: (p: Player) => number,
  initialFund: number,
  currentPriceIndex: number,
): number {
  let sum = 0;
  let count = 0;
  for (const p of players) {
    if (!isAlive(p)) continue; // @source cmp byte [player+21], 0 / je skip
    sum += wealthOf(p);
    count++;
  }
  if (count === 0 || initialFund === 0) return currentPriceIndex;

  // idiv 是向零取整的有符号除法
  const average = Math.trunc(sum / count);
  const next = Math.trunc(average / initialFund);

  // @source cmp eax, price_index / jle → 不更新
  return next > currentPriceIndex ? next : currentPriceIndex;
}
