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

/**
 * 某支股票在本局中的实时状态 —— 就是原版 `_stocks_on_map`（0x496980）
 * 的一条 36 字节记录，字段名按已查明的语义命名，未明者保留原偏移名。
 *
 * ★ 字段语义由 `_rich4_stock_daily_tick`（fcn_004291d6）反推，
 *   见 rules/stock-market.ts 的逐行翻译。表里三个价格字段
 *   （+12/+16/+20）初值相同，但运行时各司其职：
 *   +12 是**永不变的参考价**（均值回归的锚），+16 是**今日开盘**，
 *   +20 是**今日收盘**，也是买卖与估值唯一取用的那个。
 */
export interface StockState {
  /** 当前股价（收盘）@source stock_info +20 (float) */
  price: number;
  /** 可流通股数 @source stock_info +8 (u16) */
  shares: number;
  /** @source stock_info +10 (u16)，与 shares 同步增减 */
  f10: number;
  /** 对应的地图企业下标；0 表示无 @source stock_info +4 */
  commercialIndex: number;
  /**
   * 非 0 则该股**当日不波动**，且趋势被清零。
   * @source loc_00429470 `cmp byte [+6], 0 / jne → f28 = 0`
   * 初始表中 96 支全为 0；疑为「新上市/停牌」标记。
   */
  f6: number;
  /**
   * 新闻剩余天数，**两个 4 位计数器**：
   * 高半字节 = 利多还剩几天，低半字节 = 利空还剩几天。
   * 非 0 时当日趋势固定为 ±10%（利多优先），为 0 才照常随机波动。
   * @source loc_0042921f `test dl, 0xf0`；每日递减见
   *   stock-market.ts 的 `tickStockCountdowns`（VA 0x0041cff9）
   */
  newsFlag: number;
  /** 参考价 —— 均值回归的锚，全局不变 @source stock_info +12 (float) */
  basePrice: number;
  /** 今日开盘价 = 昨日收盘 @source stock_info +16 (float) */
  openPrice: number;
  /** 波动系数 @source stock_info +24 (float)，0.40 ~ 2.00 */
  volatility: number;
  /** 当日涨跌趋势（百分比，钳在 ±10）@source stock_info +28 (float) */
  trend: number;
  /** 当日随机冲击，仅为可观测的中间量 @source stock_info +32 (float) */
  shock: number;
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
