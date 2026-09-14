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

/**
 * ★ 研發時間**固定 5 天，不分项目**。
 * @source 选项目的对话框收尾 VA 0x004411f8：
 * ```asm
 * 004411e7  (非真人) ebx = level − 1          ; ★ 电脑直接取最高可选项目
 * 004411ed  if (ebx == −1) 退出               ; 取消 / 等级 0
 * 004411f6  inc bl
 * 004411f8  mov [設施 + 0x1d], bl            ; 項目 = 1..level
 * 004411fb  mov [設施 + 0x1e], 5             ; ★ 天数 = 5
 * ```
 * wiki 说「不同項目所需的研發時間不同」—— 与 exe 不符（或是 4Fun 的规则），以 exe 为准。
 */
export const RESEARCH_DAYS = 5;

/** 电脑选哪个項目：当前等级能开的最高一档 @source 0x004411e7 `ebx = level − 1; inc` */
export function aiPickResearchProject(facilityLevel: number): number {
  return facilityLevel;
}

/** 開始一项研發；項目必须在 1..等级 之内 */
export function startResearch(project: number, facilityLevel: number): ResearchState | null {
  if (project < RESEARCH_MIN_PROJECT || project > facilityLevel || project > RESEARCH_MAX_PROJECT) return null;
  return { project, daysLeft: RESEARCH_DAYS };
}
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

// ============================================================
//  轉盤（旅館 / 購物中心 / 保險）
// ============================================================

/**
 * 轉盤的格子表 —— **12 格一圈，数字格与空格交错**。
 *
 * @source 表 `0x00475d0c`，每种轉盤 12 字节，`0xff` 是空格：
 * ```
 * 轉盤 0            [ 1,ff, 0,ff, 1,ff, 2,ff, 3,ff, 2,ff]   （航空公司「旅遊費」用）
 * 轉盤 1  旅館      [ff,ff, 1,ff,ff, 4,ff, 3,ff,ff, 2,ff]   ← 住几天
 * 轉盤 2  購物中心  [ 1,ff, 6,ff, 5,ff, 4,ff, 3,ff, 2,ff]   ← 消費倍數
 * 轉盤 3  保險      [ 5,ff, 3,ff,30,ff,20,ff,15,ff,10,ff]   ← 投保天数
 * ```
 *
 * **怎么转**（@source 0x0043f7c6 起步、0x0043f127 每帧步进）：
 * ```asm
 * 0043f7da  [0x48c50c] = rand() % 12             ; ★ 随机起点
 * 0043f127  每帧 [0x48c50c] = ([0x48c50c] + 1) % 12   ; 顺时针一格一格走
 * 0043f9fa  停在第一个 != 0xff 的格子上           ; 空格不算数，继续走
 * 0043facb  return byte [0x475d0c + 轉盤 * 12 + 格子]
 * ```
 *
 * ⚠️ 真人那一路的**总步数与点击时机有关**（`0x0043f84f` 起的状态机在
 *   真人未点击时最多再转 0x28 帧），所以原版真人转轮盘**不可复现**；
 *   AI 那一路步数固定。两者的**分布**相同：起点均匀，结果 = 起点之后第一个
 *   数字格。本引擎对所有人都用这条，记为 D-003。
 *
 * 由此算出的分布（旅館为例）：1 天 4/12、2 天 3/12、3 天 2/12、4 天 3/12。
 */
export const WHEEL_SLOTS = 12;
export const WHEEL_BLANK = 0xff;
export const WHEEL_TABLE: readonly (readonly number[])[] = [
  [1, 0xff, 0, 0xff, 1, 0xff, 2, 0xff, 3, 0xff, 2, 0xff],
  [0xff, 0xff, 1, 0xff, 0xff, 4, 0xff, 3, 0xff, 0xff, 2, 0xff],
  [1, 0xff, 6, 0xff, 5, 0xff, 4, 0xff, 3, 0xff, 2, 0xff],
  [5, 0xff, 3, 0xff, 30, 0xff, 20, 0xff, 15, 0xff, 10, 0xff],
];
export const WHEEL = { travel: 0, hotel: 1, mall: 2, insurance: 3 } as const;

/**
 * 转一次轮盘。`randValue` 由调用方从 `WatcomRng` 取（C-DET-1）。
 * 返回停在的数字；表全是空格时返回 0（原版不存在这种表）。
 */
export function spinWheel(wheel: number, randValue: number): number {
  const table = WHEEL_TABLE[wheel];
  if (table === undefined) return 0;
  let slot = ((randValue % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS;
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    const v = table[slot] ?? WHEEL_BLANK;
    if (v !== WHEEL_BLANK) return v;
    slot = (slot + 1) % WHEEL_SLOTS;
  }
  return 0;
}

// ============================================================
//  地契年限（開局的「土地權限」）
// ============================================================

/**
 * 「土地權限」下拉的六档 → 打包日期增量（年<<16 | 月<<8 | 日）。
 *
 * @source 表 `0x004751f0` dump 出来是 `(0, 0x20000, 0x10000, 0x600, 0x300, 0x100)`，
 *   即 無限期 / 2 年 / 1 年 / 6 個月 / 3 個月 / 1 個月。
 *   買地時 `land.+0x30 = add_date(today, 表[[0x499110]])`（0x0041a108），
 *   買設施時写 `+0x34`（0x0041a978）；`[0x499110]` 就是開局那一项。
 */
export const LAND_TENURE_TABLE: readonly number[] = [0, 0x20000, 0x10000, 0x600, 0x300, 0x100];
export const LAND_TENURE_UNLIMITED = 0;

/**
 * 打包日期相加，**月份溢出进位到年**。
 *
 * @source `0x004521cb`：
 * ```asm
 * eax = a + b
 * if ((b >> 8) & 0xff != 0 && (eax & 0xff00) > 0xc00) eax += 0xf400   ; 月 > 12：+1 年 −12 月
 * ```
 * ⚠️ **日不进位**——原版就没处理日溢出（增量表里日恒为 0，所以不会撞上）。
 */
export function addPackedDate(a: number, b: number): number {
  let out = (a + b) >>> 0;
  if (((b >>> 8) & 0xff) !== 0 && (out & 0xff00) > 0xc00) out = (out + 0xf400) >>> 0;
  return out;
}

/** 買下地產/設施時写进去的到期日；無限期为 0 */
export function tenureExpiry(todayPacked: number, tenureIndex: number): number {
  const delta = LAND_TENURE_TABLE[tenureIndex] ?? 0;
  if (delta === 0) return 0;
  return addPackedDate(todayPacked, delta);
}

/**
 * 每日推进时的到期扫描 —— **到期即归无主，房子留着**。
 *
 * @source VA 0x0041d12d（地块）/ 0x0041d179（設施），两段同构：
 * ```asm
 * if (到期日 == today) { owner = 0; 到期日 = 0 }
 * ```
 * ★ 比的是 `==` 不是 `>=`：错过那一天（例如读档回到更晚的日子）就永远不到期。
 *   照抄，不改。
 */
export function tenureExpiresToday(expiryPacked: number, todayPacked: number): boolean {
  return expiryPacked !== 0 && expiryPacked === todayPacked;
}

// ============================================================
//  買、首建、加蓋
// ============================================================

/**
 * 五种建筑的名字。@source 名字指针表 `0x475150` → 0x00463847 起的五个串
 * （原文带全角空格：`公  園`、`旅  館`）。
 */
export const FACILITY_NAMES: readonly string[] = ['公  園', '旅  館', '購物中心', '加油站', '研究所'];

/** 買下无主設施 = 地價 × 物價指數 @source 0x0041a88c `movzx ebp, word [+0x22]; imul 物價` */
export function facilityBuyPrice(landPrice: number, priceIndex: number): number {
  return landPrice * priceIndex;
}
/** 首建（等级 0 → 1）同样按地價算 @source 0x0041a1fc */
export function facilityBuildPrice(landPrice: number, priceIndex: number): number {
  return landPrice * priceIndex;
}
/** 加蓋（等级 ≥ 1）按房價算 @source 0x0041a2d5 `movzx ebp, word [+0x24]; imul 物價` */
export function facilityUpgradePrice(housePrice: number, priceIndex: number): number {
  return housePrice * priceIndex;
}

/**
 * 这一级还能不能再蓋。@source 0x0041a2c2 `cmp level, byte [0x474940 + type] / jae 结束`
 */
export function canUpgradeFacility(type: number, level: number): boolean {
  return level < (FACILITY_MAX_LEVEL[type] ?? 0);
}

/**
 * AI 首建时选哪种建筑 —— `rand() % 4 + 1`。
 *
 * @source 0x0041a23e：
 * ```asm
 * call rand / idiv 4 / inc edx / mov [設施 + 0x18], dl
 * ```
 * ★ 所以电脑**永远不蓋公園**（0），只在 旅館/購物中心/加油站/研究所 里抽。
 */
export function aiPickFacilityType(randValue: number): number {
  return (randValue % 4) + 1;
}

/**
 * 旅館住宿的「本月意外損失」记账金额 = 2000 × 天数 × 物價指數。
 * @source 0x0041a805 起那串移位（(x×4−x)×8+x = 25x；×16 = 400x；×5 = 2000x）
 *   然后 `call 0x44ba63(住客, 该值, 0)`。
 * ⚠️ 这不是再付一笔钱：`0x44ba63` 是「记損失 + 若在保險期由保險公司理賠」，
 *   本引擎只把它记进 `monthlyLost`，理賠等保險公司落点做了再接（P0-15）。
 */
export function hotelStayLoss(days: number, priceIndex: number): number {
  return 2000 * days * priceIndex;
}
