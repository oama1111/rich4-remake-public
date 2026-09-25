/*
 * 购地卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 3`
 *   函数 VA 0x00442325
 */

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { housingIndexOf } from '../rules/land.ts';
import { misalignedDoubleInt } from '../rules/hostility.ts';

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
 * 购地卡的**設施支**：脚下是設施格（`0xfa0 < code < 0x1770`）时强买那座設施。
 *
 * @source VA 0x004424be..0x004425ec —— 与地块支同形，只换了字段：
 * ```asm
 * 004424eb  cmp byte [fac+0x19], 0 / je 失败          ; 无主 → 返回 0（不扣卡、不弹框）
 * 00442501  cmp owner, 当前+1 / je 失败               ; 自己的 → 同上
 * 0044250b  dl = [fac+0x1a]（等级）× word [fac+0x24]  ; 房价
 * 00442519  + word [fac+0x22]（地价）→ edi
 * 00442520  imul edi, [0x4990e8]（物价）
 * 0044252e  cmp edi, [当前+0x1c] / jg 0x4425f1        ; 现金不够 → 「您的現金不足！」，卡不扣
 * 00442574  call 0x40df69（敌意，同一个 double 低 32 位公式，地价取 +0x22）
 * 004425b7  mov [fac+0x19], 当前+1
 * 004425c4  到期日 +0x34（見 reduce 的 playCard）→ jmp 0x44246f pay_money(当前, 原主, edi, 0)
 * ```
 */
export function applyBuyFacilityCard(
  facility: FacilityInfo,
  player: Player,
  priceIndex: number,
): BuyLandResult {
  if (facility.owner === 0) {
    return { ok: false, reason: 'unowned', price: 0, previousOwner: -1 };
  }
  if (facility.owner === player.index + 1) {
    return { ok: false, reason: 'alreadyMine', price: 0, previousOwner: -1 };
  }
  const price = (facility.landPrice + facility.housePrice * facility.level) * priceIndex;
  if (price > player.cash) {
    return { ok: false, reason: 'notEnoughCash', price, previousOwner: facility.owner - 1 };
  }
  return { ok: true, reason: null, price, previousOwner: facility.owner - 1 };
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
 * ⚠️ **本文件原先写着「低 32 位恒为 0 ⇒ 本实现不产生敌意」——那是错的**（2026-09-19）：
 *   原先的扫描只用了 1000/1500/…/8000 这些"整齐"地价，它们都能被 5 整除，
 *   于是低 32 位确实是 0；但**机制上**只要 `(地价×物价)×(等级+2)` 不是 5 的倍数，
 *   低 32 位就是一个巨大的整数。原版差分测试用 `(1001, 等级 2, 物价 1)`
 *   真跑 `0x40df69` 得到 **+1717986919**（`rich4-spec/tests/test_land_auction_cards.py`）。
 *   ⇒ 复刻改为**照做**（`buyLandCardHostility()`）。
 */
export function buyLandCardHostility(
  landPrice: number,
  priceIndex: number,
  level: number,
): number {
  // ★★ 写法照 asm 的次序、按 **double 精度**逐步舍入：x87 默认精度控制字
  //   `0x027F`（PC = 10b = 53 位 = double），故每一步都舍成 double ⇒
  //   JS 的 `(地价×物价) * ((等级+2)/5)` 与原版**逐位相同**。
  //   反过来写成「精确乘积 ÷ 5」会得到另一个 double（差 1 ulp ⇒ 垃圾值差 1）。
  //   两条支路（住宅 `+0x1c` / 商業 `+0x22`）用的是同一个公式与同一对常量。
  // C-DET-3 定向豁免：这一处要位级复现（低 32 位是什么由浮点舍入决定），
  //   产出是敌意而不是账目金额。
  // eslint-disable-next-line no-restricted-syntax
  const value = (landPrice * priceIndex) * ((level + 2) / 5);
  return misalignedDoubleInt(value);
}

/** 原版计数中间量（保留给单元测试对照，不再是"最终值"） */
export function intendedBuyLandHostility(
  landPrice: number,
  priceIndex: number,
  level: number,
): number {
  // eslint-disable-next-line no-restricted-syntax
  return (landPrice * priceIndex) * ((level + 2) / 5);
}
