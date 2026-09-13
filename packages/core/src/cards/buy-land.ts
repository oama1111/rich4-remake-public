/*
 * 购地卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 3`
 *   函数 VA 0x00442325
 */

import type { LandInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { housingIndexOf } from '../rules/land.ts';

export type BuyLandFailure =
  | 'notHousingLand'
  | 'unowned'
  | 'alreadyMine'
  | 'notEnoughCash';

export interface BuyLandResult {
  ok: boolean;
  reason: BuyLandFailure | null;
  /** 成交价 */
  price: number;
  /** 原地主的玩家下标；失败时为 -1 */
  previousOwner: number;
}

/**
 * 购地卡：**强制买下落点上他人的地产**。
 *
 * 价格与普通买地一致：`(地价 + 房价 × 等级) × 物价指数`
 * @source VA 0x00442399:
 * ```asm
 * movzx edi, byte [land + 0x1a]    ; level
 * mov   cx,  word [land + 0x1e]    ; house_price
 * imul  edi, ecx                    ; level * house_price
 * mov   cx,  word [land + 0x1c]    ; land_price
 * add   edi, ecx
 * imul  edi, dword [price_index]
 * cmp   edi, [player + 0x1c]       ; 与现金比较
 * jg    失败
 * ```
 *
 * 前置条件：
 * - 落点须为住宅地块（type ∈ (0x7d0, 0xfa0)）
 * - **地块必须有主**（`land.owner == 0` 则失败）
 * - **不能买自己的地**（`owner == current + 1` 则失败）
 * - 现金须足够（注意是**现金**，不动存款）
 */
export function applyBuyLandCard(
  nodeType: number,
  land: LandInfo | null,
  player: Player,
  priceIndex: number,
): BuyLandResult {
  const idx = housingIndexOf(nodeType);
  if (idx === null || land === null) {
    return { ok: false, reason: 'notHousingLand', price: 0, previousOwner: -1 };
  }
  // @source mov cl, [land+0x19] / test cl,cl / je 失败
  if (land.owner === 0) {
    return { ok: false, reason: 'unowned', price: 0, previousOwner: -1 };
  }
  // @source cmp eax, ecx(current+1) / je 失败
  if (land.owner === player.index + 1) {
    return { ok: false, reason: 'alreadyMine', price: 0, previousOwner: -1 };
  }

  const price = (land.landPrice + land.housePrice * land.level) * priceIndex;
  if (price > player.cash) {
    return { ok: false, reason: 'notEnoughCash', price, previousOwner: land.owner - 1 };
  }
  return { ok: true, reason: null, price, previousOwner: land.owner - 1 };
}

/**
 * ⚠️ **原版 bug：购地卡的敌意更新是空操作。**
 *
 * 原版计算了一个浮点敌意值：
 * ```asm
 * ecx = land_price * price_index
 * fild  dword [esp]              ; ecx
 * fild  word  [esp + 4]          ; level
 * fadd  dword [0x46531c]         ; + 2.0
 * fdiv  dword [0x465320]         ; / 5.0
 * fmulp st(1)                    ; → land_price * pi * (level + 2) / 5
 * sub   esp, 8
 * fstp  qword [esp]              ; ★ 压入 8 字节 double
 * push  edx / push esi
 * call  0x40df69                 ; update_hostility
 * ```
 * 但 `update_hostility` 的第三参数取自 `[esp + 0x14]`，是 **4 字节 int**
 * （对比均富卡：`push eax` 传的就是 int）。于是被调方读到的是
 * **double 的低 32 位**。
 *
 * 实测：在 840 种真实参数组合（地价 1000~8000、物价指数 1~20、等级 0~5）下，
 * 该低 32 位**无一例外为 0**，因为这些结果都是低位为零的"整齐"浮点数。
 *
 * 按 C-FID-4（原版 bug 默认保留），本实现同样**不产生敌意**。
 * 若日后要还原"设计意图"，公式记录在此：
 *   `land_price × price_index × (level + 2) / 5`
 */
export const BUY_LAND_HOSTILITY_IS_NOOP = true;

/**
 * 原版意图中的敌意公式（**实际不生效**，仅作记录与举证）。
 *
 * 此处**刻意保持浮点、不取整**：原版用 x87 的 `fdiv dword [0x465320]`（5.0），
 * 结果以 `fstp qword` 存为 double。上面那条 bug 的成立与否，正取决于该
 * double 的低 32 位是否为零——取整会毁掉这个论证。
 * 该函数不参与任何金额计算，故 C-DET-3 在此定向豁免。
 */
export const intendedBuyLandHostility = (
  landPrice: number,
  priceIndex: number,
  level: number,
  // eslint-disable-next-line no-restricted-syntax
): number => (landPrice * priceIndex * (level + 2)) / 5;
