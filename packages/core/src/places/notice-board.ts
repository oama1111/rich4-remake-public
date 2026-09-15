/*
 * 公佈欄 —— 玩家之间的二级市场
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这是**引擎里先前完全没有**的一套机制。需求方提到「公佈欄是玩家或 NPC
 *   可以把自己的卡片道具地產等挂上去出售的」，顺着这条线索把整套规则从
 *   汇编里解了出来。
 *
 * ## 槽位
 *
 * ```asm
 * ; 撤件 VA 0x004247d5
 * ebx = player*0x54 + 0x4967e0            ; ★ 每个玩家 0x54 = 84 字节
 * memmove(槽[slot], 槽[slot+1], (6 − slot) * 12)   ; 后面的往前挪
 * memset(ebx + 0x48, 0, 0xc)              ; 最后一格清零
 * ```
 * `7 × 12 = 84`，所以**每个玩家 7 个槽、每槽 12 字节**。
 * 「板满」的判定就是看最后那一格：
 * ```asm
 * ; VA 0x00427edf
 * imul eax, [0x49910c], 0x54
 * cmp byte [eax + 0x496828], 0            ; 0x496828 = 0x4967e0 + 0x48，即第 7 格
 * jne → 「公佈欄已滿\n\n請先撤件！」
 * ```
 *
 * 槽的结构（@source 挂牌 VA 0x004246c5 的几次写入）：
 * ```
 * +0  u8   類型（0 = 空）
 * +1  u8   挂牌时清零，用途未解
 * +2  u16  物品编号
 * +4  u32  標價
 * +8  u32  只有類型 1 用（股票的股數）
 * ```
 *
 * ## 四种類型
 *
 * 由购买那一路的四路跳表（`0x004255ca`）逐条解出：
 *
 * | 類型 | 是什么 | 编号的含义 | 上限检查 |
 * |---|---|---|---|
 * | 1 | **股票** | 股票下标 | 无 |
 * | 2 | **地產／設施** | `< 4000` 是住宅地 `id−2000`，否则設施 `id−4000` | 无 |
 * | 3 | **道具** | 道具编号 | 买家该道具 ≥ 9 → 「道具欄已滿\n\n無法購買！」 |
 * | 4 | **卡片** | 卡片编号 | 买家手牌 ≥ 15 → 「卡片欄已滿\n\n無法購買！」 |
 *
 * 類型 2 用的 `2000/4000` 编码与傳送機那套是同一套（见 rules/teleport.ts）。
 *
 * ## 成交
 *
 * ```asm
 * ; VA 0x004255f8
 * if (買家.cash < 槽.price) {
 *     if (買家是真人) 「您的現金不足！」
 *     return 0                                  ; ★ 不成交
 * }
 * …按類型转移物品…
 * 004258ac  call pay_money(買家, 賣家, 槽.price, 0)
 * ```
 *
 * ⚠️ **付的是现金**（`[player + 0x1c]`），不是存款。
 *
 * ## 挂牌价
 *
 * AI 挂卡片时用的是：
 * ```asm
 * ; VA 0x00428935
 * al = byte[卡號*8 + 0x47fdef]        ; 卡片標價
 * eax = 標價 × 0x64                    ; × 100
 * imul eax, [0x4990e8]                 ; × 物價指數
 * ```
 * 即 **標價 × 100 × 物價指數**。真人挂牌是自己输入价格
 * （「請輸入欲拍賣的價格\n\n（市價：%d元）」），那个「市價」多半就是这个数。
 *
 * ⚠️ 其余三种类型的「市價」怎么算**没解**，见 known-deviations 的 Q-BOARD-1。
 */

import type { GameState, Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { CARDS, TOOLS } from '@rich4/data';
import { MAX_HAND_CARDS } from '../rules/special-square.ts';
import { toolCount } from '../rules/tools.ts';
import { truncTowardZero } from '../rules/rounding.ts';

/** 每个玩家几个槽 @source `0x54 / 12 = 7` */
export const BOARD_SLOTS = 7;

/** 挂牌类型 @source 购买那一路的四路跳表 0x004255ca */
export const LISTING = {
  stock: 1,
  estate: 2,
  tool: 3,
  card: 4,
} as const;
export type ListingKind = (typeof LISTING)[keyof typeof LISTING];

/** 地產／設施 的编号编码，与傳送機同一套 @source VA 0x00425784 `cmp dx, 0xfa0` */
export const ESTATE_LAND_BASE = 0x7d0;
export const ESTATE_FACILITY_BASE = 0xfa0;

export interface Listing {
  kind: ListingKind;
  /** 物品编号；含义随 `kind` 变，见文件头那张表 */
  id: number;
  /** 標價，买家付**现金** */
  price: number;
  /** 只有股票用：股數 @source 槽 +8 */
  amount: number;
}

/** 一个玩家的挂牌栏：定长 7，`null` 表示空槽 */
export type BoardColumn = (Listing | null)[];

export function emptyColumn(): BoardColumn {
  return new Array<Listing | null>(BOARD_SLOTS).fill(null);
}

export function emptyBoard(playerCount = 4): BoardColumn[] {
  return Array.from({ length: playerCount }, () => emptyColumn());
}

/**
 * 板满了吗 —— 看最后那一格。
 * @source VA 0x00427ee6 `cmp byte [player*0x54 + 0x496828], 0`
 */
export function isColumnFull(col: BoardColumn | undefined): boolean {
  return (col?.[BOARD_SLOTS - 1] ?? null) !== null;
}

/**
 * 挂牌。
 *
 * @source VA 0x004246c5：从头找**第一个空槽**；途中若遇到**同类型同编号**的
 *   已挂项，就覆盖那一格（不新占一格）。七格都占满且没有同项 → 挂不上。
 */
export function listItem(col: BoardColumn, item: Listing): BoardColumn | null {
  let at = -1;
  for (let i = 0; i < BOARD_SLOTS; i++) {
    const s = col[i] ?? null;
    if (s === null) {
      at = i;
      break;
    }
    if (s.kind === item.kind && s.id === item.id) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const next = [...col];
  next[at] = item;
  return next;
}

/**
 * 撤件 —— 把后面的往前挪，最后一格清空。
 * @source VA 0x004247d5 的 `memmove` + `memset`
 */
export function withdrawItem(col: BoardColumn, slot: number): BoardColumn | null {
  if (slot < 0 || slot >= BOARD_SLOTS || (col[slot] ?? null) === null) return null;
  const next = [...col];
  for (let i = slot; i < BOARD_SLOTS - 1; i++) next[i] = next[i + 1] ?? null;
  next[BOARD_SLOTS - 1] = null;
  return next;
}

/**
 * 卡片的「市價」。
 * @source VA 0x00428935：`標價 × 100 × 物價指數`
 */
export const CARD_LIST_MULTIPLIER = 0x64;

export function cardListPrice(cardId: number, priceIndex: number): number {
  const price = CARDS.find((c) => c.id === cardId)?.price ?? 0;
  return price * CARD_LIST_MULTIPLIER * priceIndex;
}

export type BuyError =
  | 'noListing'
  | 'cashShort'
  | 'handFull'
  | 'toolFull'
  | 'selfPurchase'
  | 'sellerGone';

/**
 * 买家能不能买下这一件 —— 只做**检查**，不动状态。
 *
 * @source 购买 VA 0x004255e9 起。检查顺序照抄：**先查现金**，再按类型查容量。
 */
export function canBuyListing(
  state: GameState,
  buyer: number,
  seller: number,
  item: Listing | null,
): BuyError | null {
  if (item === null) return 'noListing';
  if (buyer === seller) return 'selfPurchase';
  const me = state.players[buyer];
  const him = state.players[seller];
  if (me === undefined || !isAlive(me)) return 'noListing';
  if (him === undefined) return 'sellerGone';
  // @source `cmp eax, [槽+4] / jge` —— 现金不够直接不成交
  if (me.cash < item.price) return 'cashShort';
  if (item.kind === LISTING.card && me.cards.length >= MAX_HAND_CARDS) return 'handFull';
  // @source `cmp byte [...+0x49915b], 9 / jb 可以` —— 同种道具满 9 个就买不了
  if (item.kind === LISTING.tool && toolCount(state.tools, buyer, item.id) >= MAX_TOOL_PER_KIND) {
    return 'toolFull';
  }
  return null;
}

/** 同一种道具最多持有几个 @source VA 0x004257e9 `cmp …, 9 / jb` */
export const MAX_TOOL_PER_KIND = 9;

/** 把挂牌上的编号解成地產／設施 */
export function decodeEstate(id: number): { kind: 'land' | 'facility'; index: number } {
  return id < ESTATE_FACILITY_BASE
    ? { kind: 'land', index: id - ESTATE_LAND_BASE }
    : { kind: 'facility', index: id - ESTATE_FACILITY_BASE };
}

/** 挂牌时把地產／設施编成编号 */
export function encodeEstate(kind: 'land' | 'facility', index: number): number {
  return (kind === 'land' ? ESTATE_LAND_BASE : ESTATE_FACILITY_BASE) + index;
}

/** 付款：买家掏**现金**给卖家 @source VA 0x004258ac `pay_money(買家, 賣家, 價, 0)` */
export function settlePayment(
  buyer: Player,
  seller: Player,
  price: number,
): { buyer: Player; seller: Player } {
  return {
    buyer: { ...buyer, cash: buyer.cash - price },
    seller: { ...seller, cash: seller.cash + price },
  };
}

// ============================================================
//  四种類型的「市價」—— 挂牌对话框里那句「請輸入欲拍賣的價格（市價：%d元）」
// ============================================================

/**
 * 道具的市價，与卡片同一形状：`標價 × 100 × 物價指數`。
 * @source 真人挂道具 VA 0x00426af8 `mov bl, [道具表 + id*8 + 5]; imul 0x64; imul 物價`；
 *   AI 挂道具 0x00428a0b 同式。截图 S13 的「路障 市價 3,000元」= 30 × 100 × 1 ✓
 */
export function toolListPrice(toolId: number, priceIndex: number): number {
  const price = TOOLS.find((t) => t.id === toolId)?.price ?? 0;
  return price * CARD_LIST_MULTIPLIER * priceIndex;
}

/**
 * 股票的市價 = `trunc(股數 × 現價)`。
 * @source VA 0x00425f1e：`fild 股數 / fmul dword [股票表 + 36*i + 現價] /
 *   call 0x457dbc / fistp` —— 0x457dbc 是 `__round_toward_zero`（**向零截断**），
 *   不是 `Math.round`：`1 股 × 2.5 元 = 2.5` 时原版给 2 而 `Math.round` 给 3。
 */
export function stockListPrice(shares: number, marketPrice: number): number {
  return truncTowardZero(shares * marketPrice);
}

/**
 * 地產／設施的市價 = `(地價 + 等級 × 房價) × 物價指數` —— 与 `rules/wealth.ts` 的估值同式。
 * @source VA 0x004265b9（地產 +0x1c/+0x1e/+0x1a）与 0x004265e5（設施 +0x22/+0x24/+0x1a）
 */
export function estateListPrice(
  landPrice: number,
  level: number,
  housePrice: number,
  priceIndex: number,
): number {
  return (landPrice + level * housePrice) * priceIndex;
}

// ============================================================
//  AI 怎么用公佈欄 —— 三道随机闸 + 两条挂牌规则 + 两条买入规则
// ============================================================

/**
 * @source AI 公佈欄回合 VA 0x0042886e 起（就是 AI 总调度里的 `fcn_00436b0a` 那一步）：
 * ```asm
 * 0042886e  if (rand() % 15 != 0) goto 重估          ; ★ 1/15 才考虑挂东西
 * 0042889a  if (手牌 <= 12) goto 挂道具              ; 卡片只在手牌 > 12 张时挂
 * 004288a9  候选 = 手上有**重复**的卡；随机挑一张
 * 0042891b  板满就先撤第 0 格（0x4247d5）
 * 00428935  挂 kind 4，價 = 標價 × 100 × 物價
 * 00428958  没挂成卡片才看道具：
 * 00428974  候选 = 数量 >= 3 的，或 数量 != 0 且 道具.f7 − 個性 == 2 的；随机挑一个
 * 00428a0b  挂 kind 3，價 = 標價 × 100 × 物價
 * 00428a37  if (rand() % 3 != 0) goto 买             ; ★ 1/3 概率重估自己挂着的道具/卡片價
 * 00428ae8  if (rand() % 4 != 0) 结束                ; ★ 1/4 概率去买别人的
 * 00428b05  逐个其他在场玩家、逐格：
 * 00428b59    kind 1 股票：round(標價 / 股數) < 現價 → 买
 * 00428bc6    kind 2 地產：3 × 估值 > 標價 且 cash > 2 × 標價 → 买
 *             其余類型不买；成交一件即止（ebp = 1）
 * ```
 *
 * ★ `f7 − 個性 == 2` 这一条把道具表的 **f7** 解出了一半：它是道具的「凶狠度」
 *   0..2（飛彈/時光機/工程車/核彈 是 2）。乖寶寶（個性 0）会把凶狠度 2 的道具
 *   挂出去卖掉，大老奸（個性 2）永远不会因这条卖东西。见 Q4。
 */
export const AI_BOARD_LIST_CHANCE = 15;
export const AI_BOARD_REPRICE_CHANCE = 3;
export const AI_BOARD_SHOP_CHANCE = 4;
/** 手牌**超过**这个数才考虑挂卡 @source `cmp eax, 0xc / jle` */
export const AI_CARD_LIST_MIN_HAND = 12;
/** 道具数量到这个数就考虑挂 @source `cmp ch, 3 / jae` */
export const AI_TOOL_LIST_MIN_COUNT = 3;

/** 手上重复的卡片编号（去重后） @source 0x004288a9 的双重循环 */
export function duplicateCards(hand: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = 0; j < hand.length; j++) {
      if (i === j) continue;
      if (hand[i] === hand[j]) {
        const id = hand[j]!;
        if (!out.includes(id)) out.push(id);
        break;
      }
    }
  }
  return out;
}

/** 这件道具 AI 想不想挂出去 @source 0x00428990..0x004289b5 */
export function aiWantsToListTool(count: number, toolF7: number, personality: number): boolean {
  if (count >= AI_TOOL_LIST_MIN_COUNT) return true;
  return count !== 0 && toolF7 - personality === 2;
}

/**
 * 别人挂的股票值不值得买 @source 0x00428b5e..0x00428bac
 *
 * ```asm
 * 00428b5e  fild dword [挂单 + 0x4967e4]   ; 挂牌总价
 * 00428b71  fild dword [挂单 + 0x4967e8]   ; 股数
 * 00428b75  fdivp
 * 00428b77  call 0x457dbc                  ; ★ __round_toward_zero：向零截断
 * 00428ba3  fcomp dword [股票表 + 現價] / jae 不要
 * ```
 * 即「`trunc(挂牌总价 / 股数) < 現價` 才买」。`.5` 处与 `Math.round` 差 1
 * （总价 5、2 股 ⇒ 2.5：原版 2，`Math.round` 3）。
 */
export function aiWantsListedStock(listedPrice: number, shares: number, marketPrice: number): boolean {
  if (shares <= 0) return false;
  return truncTowardZero(listedPrice / shares) < marketPrice;
}

/** 别人挂的地產值不值得买 @source 0x00428c63..0x00428c81 */
export function aiWantsListedEstate(listedPrice: number, valuation: number, cash: number): boolean {
  return valuation * 3 > listedPrice && cash > listedPrice * 2;
}
