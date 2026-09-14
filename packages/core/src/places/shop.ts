/*
 * 百貨公司 —— 买卖卡片与道具
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **这里花的是「點數」，不是钱。**
 *   點數来自地图上的「得５０點 / 得３０點 / 得１０點」三种格子，
 *   到百貨公司换卡片和道具。先前一直没接这条，所以道具经济是死的：
 *   开局发的四件用完就再也没有了，車子更是永远买不到。
 *
 * @source rich4-re/asm/rich4_shop.asm，并以 exe 复核：
 *   `_rich4_player_buy_card` @ VA 0x0042d23c
 *   `_rich4_player_buy_tool` @ VA 0x0042d270
 *   卖卡 `fcn_0042d145` / 卖道具 `fcn_0042d1b2`
 */

import type { Player } from '../state/types.ts';
import { CARDS, TOOLS } from '@rich4/data';
import { MAX_HAND_CARDS } from '../rules/special-square.ts';
import { giveTool, takeTool, toolCount, MAX_TOOL_ID, MIN_TOOL_ID } from '../rules/tools.ts';

/**
 * 回收价的比率 —— 卖出只退**九成**。
 *
 * @source 卖卡 `fmul qword [0x464364]`、卖道具 `fmul qword [0x46436c]`，
 *   两个常量都是 **0.9**，随后 `__round_toward_zero`（向零取整）。
 *
 * ⚠️ 原版乘的是 double 的 0.9，其精确值**略大于** 9/10
 *   （0.90000000000000002220446…）。对本项目的取值范围（价格 ≤ 255、
 *   数量 ≤ 9）而言，`trunc(v × 0.9_double)` 与 `floor(9v/10)` 恒等：
 *   两者之差是 `v × 2.2e-17`，远不足以跨过一个整数；而当 9v/10 恰为整数时，
 *   乘积落在该整数**之上**一点点，向零取整仍得同一个数。
 *   故此处用整数算式，既满足 C-DET-3 又与原版一致。
 */
export const RESELL_NUMERATOR = 9;
export const RESELL_DENOMINATOR = 10;

/** 卖出某个价格的东西能换回多少點數 */
export function resellValue(price: number): number {
  return Math.trunc((price * RESELL_NUMERATOR) / RESELL_DENOMINATOR);
}

/** 卡片的標價 @source 卡片表每项 8 字节，價格在 +5 */
export function cardPrice(cardId: number): number {
  return CARDS.find((c) => c.id === cardId)?.price ?? 0;
}

/** 道具的標價 @source 道具表每项 8 字节，價格在同一偏移 */
export function toolPrice(toolId: number): number {
  return TOOLS.find((t) => t.id === toolId)?.price ?? 0;
}

export type ShopError =
  | 'unknownItem'
  | 'notEnoughPoints'
  | 'handFull'
  | 'outOfStock'
  | 'toolLimit'
  | 'notOwned';

export interface BuyCardResult {
  ok: boolean;
  error: ShopError | null;
  player: Player;
  /** 本次花掉的點數 */
  spent: number;
}

/**
 * 买一张卡。
 *
 * @source `_rich4_player_buy_card`：
 * ```asm
 * receive_card(player, cardId)
 * bl = byte [cardId*8 + 0x47fdef]                 ; 標價
 * sub word [player*0x68 + 0x496b98], bx           ; ★ 从**點數**扣
 * ```
 *
 * ⚠️ 原版这个函数**不检查點數够不够**——那由商店界面拦着（只列得起的）。
 *   本引擎必须自己拦：否则一条构造出来的网络消息就能把點數刷成负数。
 *   同理也拦手牌上限。
 */
export function buyCard(player: Player, cardId: number): BuyCardResult {
  const fail = (error: ShopError): BuyCardResult => ({ ok: false, error, player, spent: 0 });

  const price = cardPrice(cardId);
  if (price <= 0) return fail('unknownItem');
  if (player.points < price) return fail('notEnoughPoints');
  // @source receive_card 内部对满手不发牌
  if (player.cards.length >= MAX_HAND_CARDS) return fail('handFull');

  return {
    ok: true,
    error: null,
    player: { ...player, points: player.points - price, cards: [...player.cards, cardId] },
    spent: price,
  };
}

export interface BuyToolResult {
  ok: boolean;
  error: ShopError | null;
  player: Player;
  tools: number[];
  stock: number[];
  spent: number;
}

/**
 * 买一个道具。
 *
 * @source `_rich4_player_buy_tool`，与买卡同构：
 *   `receive_tool` 之后 `sub word [+0x30], 標價`。
 *   发放本身走 `give_tool`（每种上限 9；编号 ≤ 8 还要查全局库存）。
 */
export function buyTool(
  player: Player,
  tools: readonly number[],
  stock: readonly number[],
  toolId: number,
): BuyToolResult {
  const fail = (error: ShopError): BuyToolResult => ({
    ok: false,
    error,
    player,
    tools: [...tools],
    stock: [...stock],
    spent: 0,
  });

  if (toolId < MIN_TOOL_ID || toolId > MAX_TOOL_ID) return fail('unknownItem');
  const price = toolPrice(toolId);
  if (price <= 0) return fail('unknownItem');
  if (player.points < price) return fail('notEnoughPoints');

  const r = giveTool(tools, stock, player.index, toolId);
  // give_tool 没发出去：要么已有 9 个，要么全局库存空了
  if (!r.given) {
    return fail(toolCount(tools, player.index, toolId) >= 9 ? 'toolLimit' : 'outOfStock');
  }

  return {
    ok: true,
    error: null,
    player: { ...player, points: player.points - price },
    tools: r.tools,
    stock: r.stock,
    spent: price,
  };
}

/**
 * 卖一张卡，退九成點數。
 *
 * @source `fcn_0042d145`：
 * ```asm
 * consume_card(player, cardId)
 * 價格 = byte [cardId*8 + 0x47fdef]
 * 點數 = trunc(點數 + 價格 × 0.9)
 * ```
 */
export function sellCard(player: Player, cardId: number): BuyCardResult {
  const at = player.cards.indexOf(cardId);
  if (at < 0) return { ok: false, error: 'notOwned', player, spent: 0 };

  const gain = resellValue(cardPrice(cardId));
  const cards = [...player.cards];
  cards.splice(at, 1);
  return {
    ok: true,
    error: null,
    player: { ...player, points: player.points + gain, cards },
    spent: -gain,
  };
}

/**
 * 卖道具，可一次卖多个，退九成點數。
 *
 * @source `fcn_0042d1b2`：
 * ```asm
 * 總價 = 標價 × 數量
 * 點數 = trunc(點數 + 總價 × 0.9)
 * tools[player][toolId] -= 數量
 * if (toolId <= 8) stock[toolId] += 數量        ; ★ 库存要还回去
 * ```
 * ⚠️ 注意是**先算總價再乘 0.9**，不是逐个算完再加——两者在取整上不等价。
 */
export function sellTool(
  player: Player,
  tools: readonly number[],
  stock: readonly number[],
  toolId: number,
  count: number,
): BuyToolResult {
  const fail = (error: ShopError): BuyToolResult => ({
    ok: false,
    error,
    player,
    tools: [...tools],
    stock: [...stock],
    spent: 0,
  });

  if (toolId < MIN_TOOL_ID || toolId > MAX_TOOL_ID) return fail('unknownItem');
  if (!Number.isInteger(count) || count <= 0) return fail('unknownItem');
  if (toolCount(tools, player.index, toolId) < count) return fail('notOwned');

  // @source 總價先乘再取整
  const gain = resellValue(toolPrice(toolId) * count);

  let nextTools = [...tools];
  let nextStock = [...stock];
  for (let i = 0; i < count; i++) {
    const r = takeTool(nextTools, nextStock, player.index, toolId);
    nextTools = r.tools;
    nextStock = r.stock;
  }

  return {
    ok: true,
    error: null,
    player: { ...player, points: player.points + gain },
    tools: nextTools,
    stock: nextStock,
    spent: -gain,
  };
}
