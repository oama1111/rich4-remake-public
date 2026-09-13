/*
 * 拍賣
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`run_auction` @ VA 0x0043bde5
 *
 * 五个调用点：拍賣卡(两处：住宅/设施分支)、破产清算、新聞事件、
 * 以及 0x0040d1e3。也就是说「拍卖」是个被多处复用的子系统，
 * 不是拍賣卡独有的。
 *
 * ★ C-ARC-2：**竞价过程是交互，不进 core**。
 *   原版的出价循环是模态 UI（与卡片目标选择同理），故本模块只负责
 *   两件能被验证的事：**算起拍价**、**按成交结果改归属**。
 *   谁出价、出多少，由外部（UI / AI）决定后作为参数传入。
 */

import type { LandInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { transferMoney, PARTY_POOL, type Company } from './payment.ts';

/**
 * 起拍价的等级系数。
 *
 * @source VA 0x0043be37：
 * ```asm
 * al = byte [land + 0x1a]          ; level
 * fild word [esp+0x94]             ; (float)level
 * fmul dword [0x004650b0]          ; ★ × 0.5
 * fld1 / faddp st(1)               ; ★ + 1.0
 * ```
 * 即系数 = `1 + level × 0.5`。
 */
export const AUCTION_LEVEL_FACTOR = 0.5;

/**
 * 拍卖起拍价。
 *
 * @source 接上式（VA 0x0043be5b）：
 * ```asm
 * ax = word [land + 0x1c]          ; land_price
 * fild / fmul (系数) / call 0x457dbc / fistp [0x48c488]
 * imul ebx, [0x4990e8]             ; ★ × 物价指数
 * ```
 *
 * 即 **`round(地价 × (1 + 等级 × 0.5)) × 物价指数`**。
 *
 * ⚠️ 取整发生在**乘物价指数之前**——先把浮点结果取整，再整数相乘。
 * 顺序换了在多数情况下结果相同，但等级为奇数时会差一点，故照搬。
 *
 * 取整走 x87 的就近取偶（与 rules/percentage.ts 同一个 `0x457dbc`）。
 */
export function auctionBasePrice(land: LandInfo, priceIndex: number): number {
  const factor = 1 + land.level * AUCTION_LEVEL_FACTOR;
  // 这里是**价格**而非评分，但原版就是浮点乘后取整，故如实复刻；
  // 取整方式与 percentage.ts 的 x87Round 相同。
  const rounded = x87Round(land.landPrice * factor);
  return rounded * priceIndex;
}

/**
 * x87 就近取偶。
 * 与 `rules/percentage.ts` 的同名函数一致——都是 `call 0x00457dbc`。
 */
function x87Round(v: number): number {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 竞价结果——由外部的出价流程给出 */
export interface AuctionOutcome {
  /** 得标者玩家下标；-1 表示**流拍** */
  winner: number;
  /** 成交价。流拍时忽略 */
  price: number;
}

export interface AuctionResult {
  players: Player[];
  land: LandInfo;
  pool: number;
  /** 是否流拍 */
  passedIn: boolean;
  bankrupted: boolean;
}

/**
 * 按竞价结果结算。
 *
 * @source 拍賣卡 VA 0x0044334f：
 * ```asm
 * call 0x43bde5(…, currentPlayer)
 * test eax, eax
 * jne  跳过                    ; 有人得标 → 归属在拍卖流程内已处理
 * mov byte [land + 0x19], 0    ; ★ 流拍 → 地块变**无主**
 * ```
 *
 * ★ 「流拍即无主」是关键的一条：拍賣卡对**别人的地**用出去，
 *   即便没人接手，原主也失去了它。
 *
 * 得标时买家付钱。付款方向为 `PARTY_POOL`——拍卖款进公库而不是给原主，
 * 这与购地卡（款项给原主）不同。
 *
 * ⚠️ 「款项进公库」是从破产清算路径的语义推定的，**尚未逐条核对**
 *   拍卖流程内部的付款调用。若日后发现原主也分钱，此处需要修正。
 */
export function settleAuction(
  players: readonly Player[],
  land: LandInfo,
  outcome: AuctionOutcome,
  pool = 0,
  companies: readonly Company[] = [],
): AuctionResult {
  // @source test eax,eax / je → 流拍分支
  if (outcome.winner < 0) {
    return {
      players: [...players],
      // @source mov byte [land + 0x19], 0
      land: { ...land, owner: 0 },
      pool,
      passedIn: true,
      bankrupted: false,
    };
  }

  const r = transferMoney(players, companies, pool, outcome.winner, PARTY_POOL, outcome.price, 0);
  return {
    players: r.players,
    land: { ...land, owner: outcome.winner + 1 },
    pool: r.pool,
    passedIn: false,
    bankrupted: r.bankrupted,
  };
}

/**
 * 谁有资格参与竞价。
 *
 * 排除出局者与现任地主——原版在出价循环里跳过他们。
 * ⚠️ 「现金不足是否仍可举牌」未核对，此处**不做**资金过滤，
 *   交由出价方自己判断，避免臆造规则。
 */
export function eligibleBidders(
  players: readonly Player[],
  land: LandInfo,
): number[] {
  const out: number[] = [];
  for (const p of players) {
    if (p.whoPlays === 0) continue;
    if (land.owner === p.index + 1) continue;
    out.push(p.index);
  }
  return out;
}
