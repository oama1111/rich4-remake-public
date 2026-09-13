/*
 * 股票：买入、卖出、持仓成本
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_stocks.asm
 *   `_rich4_buy_stock`  @ VA 0x00428d2e
 *   `_rich4_sell_stock` @ VA 0x00428e23
 *   `_rich4_init_stock_commercial`
 */

import type { Player } from '../state/types.ts';

/**
 * 玩家对单支股票的持仓。
 *
 * ⚠️ **`rich4-re/asm/rich4_stocks.h` 把第二个字段声明成了 `int _;`（未使用）。**
 * 汇编里它是 **float，存的是持仓成本均价**：
 * ```asm
 * fmul dword [edx + (_rich4_player_stocks + 4)]   ; 按 float 读
 * fstp dword [edx + (_rich4_player_stocks + 4)]   ; 按 float 写
 * ```
 * 已登记于 docs/reverse-engineering-audit.md。
 */
export interface StockHolding {
  /** 持股数 @source player_stock_info +0 (int) */
  amount: number;
  /** 持仓成本均价 @source player_stock_info +4 (**float**，非 h 文件所称的 `int _`) */
  avgCost: number;
}

/** 某支股票在本局中的实时状态（从 STOCKS 模板拷贝而来） */
export interface StockState {
  /** 当前股价 @source stock_info +20 (float) */
  price: number;
  /** 可流通股数 @source stock_info +8 (u16) */
  shares: number;
  /** @source stock_info +10 (u16)，与 shares 同步增减 */
  f10: number;
  /** 对应的地图企业下标；0 表示无 @source stock_info +4 */
  commercialIndex: number;
}

/** 买入资金来源 */
export type BuySource =
  /** 股市柜台买入 —— **从存款扣款** */
  | 'market'
  /** 地图上的上市企业买入 —— **从现金扣款**，单价另算 */
  | 'commercial';

export interface TradeResult {
  player: Player;
  holding: StockHolding;
  stock: StockState;
  /** 本次成交金额 */
  amount: number;
}

/**
 * 重算持仓成本均价。
 *
 * @source _rich4_buy_stock 末段：
 * ```asm
 * fild  dword [edx + player_stocks]        ; 旧持股数
 * fmul  dword [edx + player_stocks + 4]    ; × 旧均价
 * call  __round_toward_zero
 * fistp dword [esp]                        ; oldTotal（取整）
 * add   dword [edx + player_stocks], esi   ; 持股数 += amount
 * ebx = oldTotal + cost
 * fild  dword [edx + player_stocks]        ; 新持股数
 * fild  dword [esp + 8]                    ; 新总成本
 * fdivrp st1                               ; 新总成本 / 新持股数
 * fstp  dword [edx + player_stocks + 4]    ; → 均价
 * ```
 * 注意 `oldTotal` 是**先取整**再参与加法的。
 */
export function recalcAvgCost(
  prev: StockHolding,
  addedShares: number,
  cost: number,
): StockHolding {
  const oldTotal = Math.trunc(prev.amount * prev.avgCost);
  const amount = prev.amount + addedShares;
  if (amount <= 0) return { amount: 0, avgCost: 0 };
  // 原版把均价存为 **32 位 float**（`fstp dword`），故用 fround 匹配其精度
  return { amount, avgCost: Math.fround((oldTotal + cost) / amount) };
}

/**
 * 买入股票。
 *
 * ⚠️ **两种买入方式的扣款来源不同**：
 * - `market`（股市柜台）：`cost = trunc(amount × price)`，**从存款扣**
 * - `commercial`（地图企业）：`unitPrice = trunc(com[0x24] / 10000)`，
 *   `cost = amount × unitPrice`，**从现金扣**
 *
 * @source loc_00428d7f（commercial 分支）与其上方（market 分支）
 */
export function buyStock(
  player: Player,
  holding: StockHolding,
  stock: StockState,
  shares: number,
  source: BuySource,
  commercialUnitPrice = 0,
): TradeResult {
  if (shares <= 0) return { player, holding, stock, amount: 0 };

  let cost: number;
  let nextPlayer: Player;

  if (source === 'market') {
    cost = Math.trunc(shares * stock.price);
    // ★ 股市买入从存款扣 @source sub dword [player+32], eax
    nextPlayer = { ...player, moneyInBank: player.moneyInBank - cost };
  } else {
    cost = shares * commercialUnitPrice;
    // ★ 企业买入从现金扣 @source sub dword [player+28], edx
    nextPlayer = { ...player, cash: player.cash - cost };
  }

  return {
    player: nextPlayer,
    holding: recalcAvgCost(holding, shares, cost),
    // 买入使可流通股数减少 @source sub word [+8], si / sub word [+10], si
    stock: { ...stock, shares: stock.shares - shares, f10: stock.f10 - shares },
    amount: cost,
  };
}

/** 卖出所得的去向 */
export type SellDestination =
  /** 进玩家存款 */
  | 'bank'
  /** 进全局池（破产清算路径）@source add dword [ref_00499080], eax */
  | 'pool';

/**
 * 卖出股票。
 *
 * ```
 * holding.amount -= shares
 * if (holding.amount == 0) holding.avgCost = 0       ← 清仓时成本归零
 * proceeds = trunc(shares × price)
 * stock.shares += shares;  stock.f10 += shares
 * ```
 * @source _rich4_sell_stock
 */
export function sellStock(
  player: Player,
  holding: StockHolding,
  stock: StockState,
  shares: number,
  destination: SellDestination = 'bank',
): TradeResult {
  if (shares <= 0 || holding.amount <= 0) {
    return { player, holding, stock, amount: 0 };
  }
  const sold = Math.min(shares, holding.amount);
  const remaining = holding.amount - sold;
  const proceeds = Math.trunc(sold * stock.price);

  return {
    // @source cmp [esp+0x20],0 / je → 进全局池；否则进存款
    player:
      destination === 'bank'
        ? { ...player, moneyInBank: player.moneyInBank + proceeds }
        : player,
    // @source jne loc_00428e5b / mov dword [+4], edx（清仓时 avgCost = 0）
    holding: { amount: remaining, avgCost: remaining === 0 ? 0 : holding.avgCost },
    stock: { ...stock, shares: stock.shares + sold, f10: stock.f10 + sold },
    amount: proceeds,
  };
}

/**
 * 地图企业的单位股价。
 * @source loc_00428d7f:
 * ```asm
 * edi = 0x2710                 ; 10000
 * eax = com[0x24]
 * cdq / idiv edi               ; 有符号整数除法
 * ```
 */
export const COMMERCIAL_PRICE_DIVISOR = 0x2710; // 10000

export function commercialUnitPrice(commercialField0x24: number): number {
  return Math.trunc(commercialField0x24 / COMMERCIAL_PRICE_DIVISOR);
}

/** 空仓 */
export const EMPTY_HOLDING: StockHolding = { amount: 0, avgCost: 0 };
