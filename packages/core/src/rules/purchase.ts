/*
 * 落点消费：买地、盖房、买设施
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 关键发现：**落点消费不走 `pay_money`（VA 0x0041d2c6）。**
 *
 * 全 exe 只有 4 处调用 `pay_money`，全部是卡片与事件结算（见 rules/payment.ts）。
 * 落点消费是就地 `cmp` + `sub`：
 *
 * ```asm
 * movzx ebp, word [land + 0x1e]        ; house_price
 * imul  ebp, dword [0x4990e8]          ; × 物价指数
 * imul  eax, dword [0x49910c], 0x68    ; 当前玩家
 * cmp   ebp, dword [eax + 0x496b84]    ; 与**现金**比较
 * jg    放弃                            ; ★ 钱不够直接放弃，不动存款
 * …确认对话…
 * sub   dword [eax + 0x496b84], ebp    ; ★ 直接扣现金
 * ```
 *
 * 五处消费点结构完全一致（0x004199c5 / 0x0041a132 / 0x0041a29f /
 * 0x0041a34d / 0x0041a984），都只碰 `[+0x1c]`（现金），
 * **都没有存款级联，也都不会触发破产**。
 *
 * 这条差异很要紧：钱在银行里就是买不了地，必须先取出来。
 */

import type { Player } from '../state/types.ts';

/**
 * 禁止买地盖房的附身物件。
 *
 * @source 每次消费前都会 `call 0x0040fa61(player)`，非 0 则放弃：
 * ```asm
 * mov al, byte [player + 0x3f]    ; god_info
 * cmp al, 8
 * jb  查7 / jbe 命中               ; al == 8 → 命中
 * cmp al, 0xf / je 命中            ; al == 15 → 命中
 * jmp 放行
 * 查7: cmp al, 7 / jne 放行        ; al == 7 → 命中
 * 命中: 弹出「<物件名>不让你…」提示，返回非 0
 * ```
 *
 * 对照物件名表（VA 0x0047ed76，按类型索引）：
 * 7 = 小衰神、8 = 大衰神、15 = 死神。
 *
 * ⚠️ **这不是唯一的附身拦截**，别与另一处混淆：
 * `rules/land.ts` 的 `GOD_BLOCKS_PURCHASE = 12`（土地公）来自
 * `loc_0041a013` 处的内联判断 `cmp byte [player+0x3f], 0xc / je end`，
 * 只作用于**买无主地**这一条分支。
 *
 * 两处并存，判据不同、作用面也不同：
 *   - 12（土地公）→ 只挡「买无主地」
 *   - 7/8/15（衰神/死神）→ 挡所有走 `call 0x40fa61` 的消费
 */
export const PURCHASE_BLOCKING_GODS: readonly number[] = [7, 8, 15];

/** 物件名表 @source `mov esi, dword [eax*4 + 0x47ed76]` */
export const OBJECT_NAMES: readonly string[] = [
  '間諜', '小財神', '大財神', '小福神', '大福神',
  '小窮神', '大窮神', '小衰神', '大衰神', '天使',
  '惡魔', '惡犬', '土地公', '禮物', '寶箱',
  '死神', '路障', '地雷', '定時炸彈',
];

export type PurchaseFailure =
  /** 被衰神/死神附身，禁止消费 */
  | 'blockedByGod'
  /** 现金不足（**存款不算**） */
  | 'notEnoughCash';

export interface PurchaseResult {
  ok: boolean;
  reason: PurchaseFailure | null;
  /** 成交价 */
  price: number;
  /** 扣款后的玩家；失败时原样返回 */
  player: Player;
  /** 失败原因为 blockedByGod 时，挡下这次消费的物件名 */
  blockedBy: string | null;
}

/**
 * 附身物件是否禁止本次消费。
 * @returns 挡路的物件名；放行则为 null
 */
export function purchaseBlockedBy(player: Player): string | null {
  if (!PURCHASE_BLOCKING_GODS.includes(player.godInfo)) return null;
  return OBJECT_NAMES[player.godInfo] ?? `物件${player.godInfo}`;
}

/**
 * 执行一次落点消费。
 *
 * ★ 与 `rules/payment.ts` 的 `transferMoney` 的根本差别：
 * 这里**只看现金**，不足即失败，既不动存款也不触发破产。
 *
 * @param price 已含物价指数的成交价
 */
export function purchase(player: Player, price: number): PurchaseResult {
  const blockedBy = purchaseBlockedBy(player);
  if (blockedBy !== null) {
    return { ok: false, reason: 'blockedByGod', price, player, blockedBy };
  }
  // @source cmp ebp, [player + 0x1c] / jg 放弃 —— 用 jg，故恰好够是**可以**买的
  if (price > player.cash) {
    return { ok: false, reason: 'notEnoughCash', price, player, blockedBy: null };
  }
  return {
    ok: true,
    reason: null,
    price,
    // @source sub dword [player + 0x1c], ebp
    player: { ...player, cash: player.cash - price },
    blockedBy: null,
  };
}

/**
 * 盖房价 = 房价 × 物价指数。
 * @source `movzx ebp, word [land + 0x1e]` / `imul ebp, dword [0x4990e8]`
 */
export function buildHousePrice(housePrice: number, priceIndex: number): number {
  return housePrice * priceIndex;
}
