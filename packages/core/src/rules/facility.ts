/*
 * 设施过路费
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准，落点结算函数内 VA 0x0041a404 起。
 *
 * ★ **五种设施的名字已全部对定**（先前 type 1/2 只敢叫「百貨類 A/B」）：
 *
 * | type | 建築 | 最高等級 | 计费方式 |
 * |---|---|---|---|
 * | 0 | **公園** | 1 | 不收费 |
 * | 1 | **旅館** | 5 | 单价 × 转盘倍数，**外加休息天数** |
 * | 2 | **購物中心** | 5 | 单价 × 转盘倍数 |
 * | 3 | **加油站** | 1 | **掷骰步数** × 500 × 交通工具倍率 |
 * | 4 | **研究所** | 5 | 不收费；每级可研發一种道具，见下 |
 *
 * 三条独立证据互相咬合：
 *
 * 1. **名字指针表** `[type*4 + 0x475150]`（@source 0x004179d2 等 10 处引用）
 *    指向 `0x00463847` 起的五个串：`公  園 / 旅  館 / 購物中心 / 加油站 / 研究所`。
 * 2. **最高等级表** `0x00474940` dump 出来是 `[1, 5, 5, 1, 5]` —— 与上面一一对应。
 * 3. **提示文案**分得清 1 与 2：
 *    `%s的旅館\n\n請進來休息...`（0x00465224）对
 *    `%s的購物中心\n\n您的消費倍數為...`（0x0046523c）。
 *    这正解释了两者「只是转盘素材不同」的表象 ——
 *    旅館那个转盘**同时决定住几天**。
 *
 * ⚠️ 等级名另有一张表 `[level*4 + 0x475164]`：`０級/一級/二級/…`。
 *
 * @source 分派：
 * ```asm
 * mov al, byte [facility + 0x18]
 * cmp al, 2 / jb  → type 1 分支(0x41a421)
 *            jbe → type 2 分支(0x41a485)
 * cmp al, 3 / je  → type 3 分支(0x41a4db)
 * jmp 不收费(0x41a581)
 * ```
 */

import type { FacilityInfo } from '../loaders/map.ts';
import { facilityToll } from './god-toll.ts';

/** @source 名字表 `[type*4 + 0x475150]` → 0x00463847 起五个串 */
export const FACILITY_TYPE = {
  park: 0,
  hotel: 1,
  mall: 2,
  gasStation: 3,
  lab: 4,
} as const;

/** @source 最高等级表 0x00474940 = `[1, 5, 5, 1, 5]` */
export const FACILITY_MAX_LEVEL: readonly number[] = [1, 5, 5, 1, 5];

/** ⚠️ 旧名，保留只为不破坏既有调用方；新代码用 `FACILITY_TYPE` */
export const FACILITY_TYPE_SHOP_A = FACILITY_TYPE.hotel;
export const FACILITY_TYPE_SHOP_B = FACILITY_TYPE.mall;
export const FACILITY_TYPE_GAS_STATION = FACILITY_TYPE.gasStation;

// ============================================================
//  研究所（type 4）—— 道具 9..13 的唯一来源
// ============================================================

/**
 * ★ **研發出来的道具编号 = 研發項目 + 8。**
 *
 * @source 每回合的研發推进 VA 0x0041cdb0（一个遍历所有设施的循环）：
 * ```asm
 * 0041cdb0  cl = 設施.+0x1e                 ; ★ 剩余研發天數
 * 0041cdb3  if (cl == 0) continue
 * 0041cdbd  dl = 設施.+0x19                 ; 業主（1 基）
 * 0041cdc6  if (dl != [0x49910c] + 1) continue  ; ★ 只在**業主自己的回合**倒数
 * 0041cdca  al = 設施.+0x1d                 ; ★ 研發項目 1..5
 * 0041cdcd  if (al > 設施.+0x1a) goto 作废   ; ★ 項目等级高过设施等级 → 作废
 * 0041cdd6  設施.+0x1e = cl - 1
 * 0041cdd9  if (还没归零) continue
 * 0041cdea  道具名 = [項目*8 + 0x47ff1a]
 * 0041cdf2  msg("%s開發完成！", 道具名)      ; 串 0x00463b68
 * 0041ce1b  eax = 項目 + 8                  ; ★★ 道具编号
 * 0041ce25  give_tool(當前玩家, eax)
 * 0041ce2f  作废: 設施.+0x1e = 0
 * ```
 *
 * ★★ 这解开了 `@rich4/data` 里一个长期没解释的巧合：
 *   **道具 9..13 的 `initAmount` 全是 0、`f6` 全是 2**，
 *   而别的道具 `initAmount` 都是 10。原因就是它们**不进全局库存**——
 *   `機器工人(9)/時光機(10)/傳送機(11)/工程車(12)/核子飛彈(13)`
 *   只能靠研究所研發出来，一级一种，顺序与编号完全一致。
 *
 * ⚠️ **研發時間**（写 `+0x1e` 的那一处）还没定位 —— 業主停留时选项目的那个
 *   界面没找到。所以本引擎只实现了「倒数与产出」，**起始天数由调用方给**。
 */
export const RESEARCH_TOOL_BASE = 8;
/** 研究所的研發項目下标范围（同时也是所需的设施等级） */
export const RESEARCH_MIN_PROJECT = 1;
export const RESEARCH_MAX_PROJECT = 5;

/** 研發項目 → 道具编号 @source 0x0041ce1b `add eax, 8` */
export function researchTool(project: number): number {
  return project + RESEARCH_TOOL_BASE;
}

export interface ResearchState {
  /** 研發項目 1..5；0 = 没在研發 @source 設施 +0x1d */
  project: number;
  /** 剩余天数；0 = 没在研發 @source 設施 +0x1e */
  daysLeft: number;
}

export interface ResearchTick {
  next: ResearchState;
  /** 研發成功时产出的道具编号；否则 0 */
  produced: number;
}

/**
 * 把一处研究所的研發推进一天。
 *
 * ★ 三条都不显然，全部照 exe：
 * - **只在業主自己的回合推进**（调用方负责只在轮到業主时调用）；
 * - **項目等级高过设施等级就作废**（拆了楼，研發也跟着黄）——
 *   `+0x1e` 直接清零，不是暂停；
 * - 归零那一刻才 `give_tool`，**不检查道具上限**（給不出去就凭空消失，
 *   与搶奪卡同理，见 cards/rob.ts）。
 */
export function tickResearch(state: ResearchState, facilityLevel: number): ResearchTick {
  if (state.daysLeft === 0) return { next: state, produced: 0 };
  // @source `cmp al, byte [ebx+0x1a] / ja 作废`
  if (state.project > facilityLevel) {
    return { next: { project: state.project, daysLeft: 0 }, produced: 0 };
  }
  const daysLeft = state.daysLeft - 1;
  if (daysLeft > 0) return { next: { project: state.project, daysLeft }, produced: 0 };
  return { next: { project: state.project, daysLeft: 0 }, produced: researchTool(state.project) };
}

/**
 * 设施的**按等级费率表**，6 项 uint16，位于 `facility + 0x24`。
 *
 * @source VA 0x0041a429：
 * ```asm
 * al  = byte [facility + 0x1a]     ; level
 * eax = eax + eax                  ; level * 2
 * eax = eax + edx                  ; + facility 基址
 * bx  = word [eax + 0x24]          ; ★ word[facility + 0x24 + level*2]
 * ```
 *
 * ⚠️ **下标 0 不是租金**：`+0x24` 同时就是 `housePrice`。
 * 真正的租金是等级 1..5（`+0x26`..`+0x2e`），共 5 档——
 * 与设施最高等级表（VA 0x00474940）给 type 1/2 的上限 5 吻合。
 *
 * 真实地图里多处形如 `[1000, 750, 1750, 4000, 8000, 15000]`：
 * 下标 1..5 严格递增，只有下标 0 跳出序列。
 *
 * 原版寻址就是 `+0x24 + level*2`，照搬不改。
 */
export const FACILITY_RATE_TABLE_OFFSET = 0x24;

/**
 * 涨价标记使费率**翻倍**。
 * @source `cmp byte [facility + 0x1c], 0 / je 跳过 / add ebx, ebx`
 */
export function applyPriceStatus(rate: number, priceStatus: number): number {
  return priceStatus !== 0 ? rate + rate : rate;
}

/**
 * type 1 / 2 的**单价**（尚未乘转盘倍数）。
 *
 * `单价 = rateByLevel[level] × 物价指数 ×（涨价 ? 2 : 1）`
 */
export function shopUnitPrice(
  rateByLevel: readonly number[],
  level: number,
  priceIndex: number,
  priceStatus: number,
): number {
  const rate = rateByLevel[level] ?? 0;
  return applyPriceStatus(rate * priceIndex, priceStatus);
}

/**
 * type 1 / 2 的最终费用 = 单价 × 转盘倍数。
 *
 * @source VA 0x0041a4b2：
 * ```asm
 * push 2 / call 0x44090e        ; 转盘，返回倍数
 * mov  ebp, eax
 * imul ebp, ebx                 ; ★ 总额 = 倍数 × 单价
 * ```
 * 提示文案「您的消費金額為\n\n%dx%d倍=%d元」印证了三者关系。
 *
 * ★ 转盘是 UI（`0x44090e` 里在加载图素、播动画），按 C-ARC-2
 *   不进 core——倍数由外部作为 action 参数传入，core 只做乘法。
 */
export function shopToll(unitPrice: number, multiplier: number): number {
  return unitPrice * multiplier;
}

export interface FacilityTollInput {
  facility: FacilityInfo;
  /** type 1/2 的按等级费率表 */
  rateByLevel: readonly number[];
  priceIndex: number;
  /** type 3 用：本次掷骰总步数 */
  stepsTotal: number;
  /** type 3 用：付款方的 traffic_method */
  trafficMethod: number;
  /** type 1/2 用：转盘倍数（由 UI/AI 给出） */
  multiplier: number;
}

/**
 * 按设施类型算出过路费（**尚未经神明调整**）。
 *
 * 神明的加减在付款前另行施加，见 `rules/god-toll.ts` 的 `adjustTollByGod`。
 */
export function calculateFacilityToll(input: FacilityTollInput): number {
  const { facility, rateByLevel, priceIndex, stepsTotal, trafficMethod, multiplier } = input;

  switch (facility.type) {
    case FACILITY_TYPE_SHOP_A:
    case FACILITY_TYPE_SHOP_B: {
      const unit = shopUnitPrice(rateByLevel, facility.level, priceIndex, facility.priceStatus);
      return shopToll(unit, multiplier);
    }
    case FACILITY_TYPE_GAS_STATION:
      return facilityToll(stepsTotal, trafficMethod, priceIndex);
    default:
      // @source jmp 0x41a581，ebp 保持先前 `xor ebp, ebp` 的 0
      return 0;
  }
}
