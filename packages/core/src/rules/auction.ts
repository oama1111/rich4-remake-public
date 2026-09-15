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

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
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
export function auctionBasePrice(
  entity: { landPrice: number; level: number },
  priceIndex: number,
): number {
  const factor = 1 + entity.level * AUCTION_LEVEL_FACTOR;
  // 这里是**价格**而非评分，但原版就是浮点乘后取整，故如实复刻；
  // 取整方式与 percentage.ts 的 x87Round 相同。
  const rounded = x87Round(entity.landPrice * factor);
  return rounded * priceIndex;
}

/**
 * 拍賣卡的敌意增量 —— ★ **这是原版 bug 的忠实复刻**。
 *
 * @source 拍賣卡 VA 0x00443286..0x004432c6（地块分支，設施分支
 *   0x004433ae 起同构、地价读 +0x22）：
 * ```asm
 * ax  = word [land + 0x1c]          ; 地价（設施为 +0x22）
 * imul eax, [0x4990e8]              ; × 物价指数
 * fild / fild level
 * fadd dword [0x465324]             ; level + 2.0
 * fdiv dword [0x465328]             ; (level + 2) / 5.0
 * fmulp                             ; value = 地价 × 物价 × (等级+2)/5  ← double
 * sub esp, 8 / fstp qword [esp]     ; ★ 以 **8 字节 double** 压栈
 * push current / push owner-1
 * call 0x40df69                     ; update_hostility(from, to, int delta)
 * ```
 *
 * `update_hostility`（0x0040df97 `mov ecx, [esp+0x14]`）按 **int** 读第三个
 * 参数 —— 实际读到的是那个 double 位型的**低 32 位**。对常规地价（结果
 * 是 2²¹ 以内的整数，尾数低 32 位为 0）敌意**恒为 0**；特大数值时则是
 * 尾数低位构成的垃圾值（甚至为负）。与黑卡（0x0044503f）的敌意段同属一类
 * 栈错位 bug，照原样复刻、不加"修复"。
 */
export function auctionCardHostility(
  landPrice: number,
  level: number,
  priceIndex: number,
): number {
  // ★ 刻意保持浮点、不取整：这条 bug 的成立与否，正取决于该 double 的
  //   低 32 位是否为零 —— 取整会毁掉复刻。产出是敌意（且是垃圾值）而
  //   非金额，C-DET-3 在此定向豁免（同 buy-land.ts 的既有先例）。
  // eslint-disable-next-line no-restricted-syntax
  const value = (landPrice * priceIndex * (level + 2)) / 5;
  // double 位型的低 32 位（x86 小端）
  low32Buf[0] = value;
  return low32View[0]! | 0;
}

const low32Buf = new Float64Array(1);
const low32View = new Uint32Array(low32Buf.buffer);

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

export interface FacilityAuctionResult {
  players: Player[];
  facility: FacilityInfo;
  pool: number;
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
 * 設施拍卖的结算 —— 与 `settleAuction` 同构（拍賣卡設施分支
 * VA 0x0044346c..0x0044348d：`run_auction` 返回 0（流拍）→
 * `mov byte [fac+0x19], 0` 变无主、清 +0x34 租期）。
 * 得标方向同样是买家付款进公库。
 */
export function settleFacilityAuction(
  players: readonly Player[],
  facility: FacilityInfo,
  outcome: AuctionOutcome,
  pool = 0,
  companies: readonly Company[] = [],
): FacilityAuctionResult {
  // @source test eax,eax / je → 流拍分支
  if (outcome.winner < 0) {
    return {
      players: [...players],
      // @source mov byte [fac + 0x19], 0
      facility: { ...facility, owner: 0 },
      pool,
      passedIn: true,
      bankrupted: false,
    };
  }

  const r = transferMoney(players, companies, pool, outcome.winner, PARTY_POOL, outcome.price, 0);
  return {
    players: r.players,
    facility: { ...facility, owner: outcome.winner + 1 },
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
  entity: { owner: number },
): number[] {
  const out: number[] = [];
  for (const p of players) {
    if (p.whoPlays === 0) continue;
    if (entity.owner === p.index + 1) continue;
    out.push(p.index);
  }
  return out;
}

// ============================================================
//  AI 出价（拍賣屏每轮向 core 问一次）
// ============================================================

/**
 * 「加价档」的金额 —— **五档**，不是屏上那七颗钮。
 *
 * @source VA 0x00475ba2 的 dword 表（`rich4_ui_auction.asm` 里
 *   `add eax, dword [ebx*4 + ref_00475ba2]`，`ebx` = 1..5）。
 *   逐字节 dump 出来是 `100 / 500 / 1000 / 5000 / 10000`
 *   （下标 0 那一格是紧邻的别张表数据，原版不会取它）。
 *
 * ⚠️ 屏上那七颗钮（PASS / +100 / +500 / +1000 / +5000 / +10000 / 放棄）是
 *   **真人**的入口（`loc_0043b010` 画图、`loc_0043bb86` 命中）；
 *   AI 走的是这五档 +「不加」。
 */
export const AUCTION_RAISE_STEPS: readonly number[] = [100, 500, 1000, 5000, 10000];

export interface AuctionAiInputs {
  /** 待拍实体的等级 @source land+0x1a / facility+0x1a */
  level: number;
  /** 地价：地块读 +0x1c、設施读 +0x22 */
  landPrice: number;
  /**
   * 本处实体的现金 @source `player+0x1c`
   * —— 最后一步会把心理价位**夹到现金**（`cmp eax, esi / jge`，取小者）
   */
  cash: number;
  /** @source `[0x4990e8]` */
  priceIndex: number;
  /** 起拍价 @source `[0x48c488]`（原版读的是那个全局） */
  basePrice: number;
  /** 同表的实体总数（`num_lands` / `num_facilities`） */
  total: number;
  /** 其中无主的条数 —— 越缺地越敢出价 */
  unowned: number;
  /**
   * ★ **仅地块**：与待拍地块**同名**、且属于出价者的地块数。
   *
   * @source 地块分支 `loc_00439f72` 的 `strcmp(esi+4, 目标+4)` 那一段
   *   （每命中一条 `inc ebp`）；設施分支**没有**这一项。
   */
  sameNameOwned?: number;
}

/**
 * AI 对一处产业的**心理价位上限**。
 *
 * @source `fcn_00439f0d` VA 0x00439f0d（`_rich4_ui_auction_entry` 在
 *   VA 0x0043c60f 对每个「不在场且没出过价」的电脑玩家调一次，
 *   结果存进座位表的 `+8`）。两张表同构，差别只在地价字段与
 *   「同名地产数」那一项：
 *
 * ```asm
 * factor   = rand()/32766.0 * 0.3 + 0.5          ; [0.5, 0.8]（0x465014/18/20）
 * ratio    = 无主数 / 总数                        ; fdivp
 * scarcity = 6.0 - 4.0 * ratio                   ; 0x465028/2c → 越缺地越高
 * v1 = round( ((level>>1) + 1 + 同名数) × 起拍价 × 物价指数 × scarcity × factor )
 * v2 = round( 地价 × 物价指数 × (3 + rand()/65536) )   ; 0x465030 = 1/65536、0x465034 = 3.0
 * return min(v1, v2, 现金)
 * ```
 *
 * ⚠️ `v1` 里**乘了两次物价指数**（起拍价本身已经含过一次）—— 原版如此，照抄。
 *
 * @param rnd 取 `[0,1)` 的随机数，代表 `rand()/32768`（注入是为单测能钉序列）。
 *   原版 `rand()` 值域 `0..0x7fff`，故 `rand() = rnd() * 32768`。
 */
export function auctionAiLimit(input: AuctionAiInputs, rnd: () => number): number {
  const rand = (): number => rnd() * 32768;

  // @source fdiv rand() / 32766.0（0x465014 = 32766.0）、×0.3（0x465018）、+0.5（0x465020）
  // eslint-disable-next-line no-restricted-syntax -- 原版这一段就是浮点（`fdiv`/`fmul`/`fadd`），产出的是**心理价位**不是账目金额
  const factor = (rand() / 32766) * 0.3 + 0.5;

  // @source fdivp（无主数 / 总数）、×4.0（0x465028）、fsubr 6.0（0x46502c）
  // eslint-disable-next-line no-restricted-syntax -- 同上，这是「缺地系数」而非金额
  const scarcity = 6 - 4 * (input.total === 0 ? 0 : input.unowned / input.total);

  const scale = (Math.floor(input.level / 2) + 1 + (input.sameNameOwned ?? 0)) *
    input.basePrice * input.priceIndex;
  const v1 = x87Round(scale * scarcity * factor);

  // @source `imul eax, ecx`（地价 × 物价指数）后 `fmul (rand()/65536 + 3.0)`
  const landValue = input.landPrice * input.priceIndex;
  // eslint-disable-next-line no-restricted-syntax -- 原版 `rand()` 直接除以 65536.0 再乘地价
  const v2 = x87Round(landValue * (3 + rand() / 65536));

  return Math.min(v1, v2, input.cash);
}

/**
 * 按心理价位挑**加多少** —— 返回 `AUCTION_RAISE_STEPS` 的**金额**，`0` = PASS。
 *
 * @source `loc_0043b124` VA 0x0043b124（电脑玩家那一支）：
 * ```asm
 * if (现金 < 现价)             → PASS（先由 loc_0043b08a 之外的 `cmp ecx, cash / jle` 判）
 * if (现价 + 10000 <= 心理价位) → +10000
 * if (现价 +  5000 <= 心理价位) → +5000
 * if (现价 +  1000 <= 心理价位) → +1000
 * if (现价 +   500 <= 心理价位) → +500
 * if (现价 +   100 <= 心理价位) → +100
 * else                          → PASS
 * ```
 *
 * 随后还有一段（`loc_0043b183`）：若这一口会**超过「当前最高出价者」的现金 + 500**，
 * 就把档位压到 `最高者现金 + 500 − 现价` 落在哪一档，避免把穷对手逼上绝路。
 * 传 `topCash`（无最高者时传 `null`）即启用。
 */
export function auctionAiRaise(
  limit: number,
  price: number,
  cash: number,
  topCash: number | null = null,
): number {
  if (cash < price) return 0;
  let step = 0;
  for (let i = AUCTION_RAISE_STEPS.length - 1; i >= 0; i--) {
    const s = AUCTION_RAISE_STEPS[i]!;
    if (price + s <= limit) {
      step = s;
      break;
    }
  }

  // @source loc_0043b183：`cmp esi, edi（心理这一口 vs 最高者现金+500）/ jle 保留`
  if (topCash !== null && step !== 0 && price + step > topCash + 500) {
    const room = topCash + 500 - price;
    if (room > 1000 && room <= 5000) step = 5000;
    else if (room > 500 && room <= 1000) step = 1000;
    else if (room > 100 && room <= 500) step = 500;
    else if (room <= 100) step = 100;
  }
  return step;
}

/**
 * 「真人这一口出不起」的判据 —— 屏上那颗钮按下去会不会被原版忽略。
 *
 * @source `loc_0043a478`：`add eax, dword [ebx*4 + 0x475ba2] / cmp eax, cash / jg 不理会`，
 *   即 **`现价 + 档位 > 现金` 就整个不响应**（连音都不放）。
 */
export function auctionCanAfford(price: number, step: number, cash: number): boolean {
  return price + step <= cash;
}
