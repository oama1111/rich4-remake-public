/*
 * 总资产计算与物价指数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_calculate_player_wealth.asm @ VA 0x004239b9
 * @source `update_price_index` @ **VA 0x00423acf**
 *   （rich4-re 记的 0x00423ad0 差一字节，落在 `push ebx` 之后）
 *
 * ★ Q17 已结案，见 updatePriceIndex 的注释与 rules/setup.ts 的 GAME_INITIAL_FUNDS。
 */

import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

/** 估值用的一支股票持仓（持股数 + 市价） */
export interface StockValuation {
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
 * ⚠️⚠️ 还有一处**只在总资产 > 2^24 时才显形**的怪癖（2026 本轮用原版真码测出）：
 * ```asm
 * 004239ff  mov eax, [esp]            ; 当前整数总资产
 * 00423a02  mov [esp+4], eax
 * 00423a06  fild dword [esp+4]        ; 装入（精确）
 * 00423a0a  fstp dword [esp+4]        ; ★ 又**存回 float32**（>2^24 就丢低位）
 * 00423a0e  fadd dword [esp+4]        ; 加上这个被舍入过的总资产
 * 00423a12  call 0x457dbc             ; trunc
 * 00423a17  fistp dword [esp]         ; 写回整数总资产
 * ```
 * 即 `total = trunc(市值 + f32(total))` —— 总资产被**反复压进 24 位尾数**。
 * 实测（原版真码 vs 纯双精度，持股 1000、价 10.35）：
 * `total=16777217 → 16787566`（原版）但 `16787567`（双精度）；
 * `total=999999999 → 1000010368` 但 `1000010349`（**差 19**）。
 * 故此处必须 `Math.fround(total)`；否则大额玩家（>1677 万）的总资产会偏。
 * 回归用例见 `rules/wealth-f32.test.ts`。
 *
 * @source 现金/存款/贷款：`player[+28] + player[+32] − player[+36]`
 *   （0x1c cash / 0x20 money_in_bank / 0x24 loan）
 */
export function calculatePlayerWealth(
  player: Player,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
  stocks: readonly StockValuation[] = [],
): number {
  let total = player.cash + player.moneyInBank - player.loan;

  // 股票：逐支累加并截断 @source loc_004239e0
  //
  // ⚠️★ 原版这个循环**不跳过空仓**：`for (edx = 0; edx < 12; edx++)`
  //   （`0x423a1a inc edx` / `0x423a1b cmp edx,0xc` / `jl`），每轮都走
  //   `fild 持股 → fmul 股价 → f32(total) → trunc → fistp`。
  //   持股为 0 时那一轮的价值就是「把总资产**再压一次 float32**」——
  //   所以**不能**因为 `stocks[s] === undefined` 就 `continue`，
  //   否则大额玩家（>2^24）的总资产会与原版差 1~19。
  for (let s = 0; s < STOCK_COUNT; s++) {
    const h = stocks[s];
    const amount = h?.amount ?? 0;
    const price = h?.price ?? 0;
    // ★ `f32(total)`：原版 0x423a0a 的 `fstp dword [esp+4]` 把运行中的总资产
    //   也舍入到 float32（>2^24 丢低位），见上方 @source 注释与 wealth-f32.test.ts
    total = Math.trunc(amount * price + Math.fround(total));
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
 * 物价指数的除数就是**开局资金**（全局 `[0x49908c]`，见 rules/setup.ts
 * 的 `GAME_INITIAL_FUNDS`）。
 *
 * ★ 两处独立佐证它确实是开局资金：
 *   1. `Save0.dat` / `SAVE1.DAT` 偏移 0x268A 均为 300000，且开局按该值发钱
 *   2. 人均总资产 300000 时物价指数恰为 1
 *
 * 物价指数开局值 @source mov dword [0x4990e8], 1（VA 0x004073b4） */
export const INITIAL_PRICE_INDEX = 1;

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
 * ★ **全局唯一的运行时写入点是 VA 0x00423b1b**，由回合推进处
 *   （VA 0x0041cfbf）每回合调用一次。另两处写入分别是开局置 1
 *   与读档还原。也就是说物价指数**只在回合边界采样**。
 *
 * ★ 这解释了 `Save0.dat` 的疑点（原 Q17 遗留）：该存档指数为 5，
 *   而按存档当时的状态套公式得 11。因为那是**终局存档**——四人中三人
 *   已出局，平均只按剩下的巨富一人算，公式值自然高；但最后一次**采样**
 *   发生在还有多人在场时，平均低得多。
 *   **存档里的 5 是对的，拿终局状态套公式才是错的。**
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
