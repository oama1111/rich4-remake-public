/*
 * 上市企業落点 —— 董事長的好处、别人踩上来的費、月中分紅、保險理賠
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这块引擎里先前**完全没有**（走到上市企業只会问「是否認購股份」）。
 *   wiki 提过一嘴，回 exe 逐条落实：落点分派在 0x0041a9ca（自家）/ 0x0041ab6d（别人的），
 *   月中分紅在 0x0042ba97，保險理賠在 0x0044ba63。
 *
 * ★ **費用进公司，不进董事長口袋**：付款是 `pay_money(付款人, 企業編碼 − 0x170c, 費, 0)`
 *   （0x0041b022），收款方是 100 + 企業下标 —— 即公司的**累積盈餘**（`+0x28`）。
 *   盈餘每月 15 日按持股比例分给股东（`companyFunds` → `payDividends`）。
 *   wiki 那句「所有公司的盈利都不會直接作為董事長收取的過路費，而是在月中時作為
 *   紅利發給董事長和其他投資該股票的玩家」与 exe 完全一致。
 */

import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { FACILITY_MAX_LEVEL, WHEEL, spinWheel } from '../rules/facility.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import { truncTowardZero } from '../rules/rounding.ts';

// ============================================================
//  行業別（commercial +0x1a）
// ============================================================

/**
 * @source 分派 0x0041ab7f 起的一串 `cmp al, n`；名字按 special-finance.ts 里那张
 *   「行業別」表（只有 7 銀行是 exe 直接读到的，其余按各图企業名归纳）。
 */
export const INDUSTRY = {
  airline: 1,
  hotel: 2,
  electronics: 3,
  insurance: 4,
  auto: 5,
  oil: 6,
  bank: 7,
  store: 10,
  construction: 11,
  sect: 12,
} as const;

/**
 * 行業別 → 費名下标（`0x47517c` 那张 13 项表：過路費/房租費/加油費/修車費/店租費/
 * 住宿費/旅遊費/保險費/電腦費/工程費/水費/電費/購物費）。
 * @source 字节表 `0x0047528e`，dump 出来是 `[2,6,0,8,7,3,2,0,0,0,0,9,0,10]`，下标 = 行業別。
 */
export const INDUSTRY_FEE_NAME_INDEX: readonly number[] = [2, 6, 0, 8, 7, 3, 2, 0, 0, 0, 0, 9, 0, 10];
export const FEE_NAMES: readonly string[] = [
  '過路費', '房租費', '加油費', '修車費', '店租費', '住宿費', '旅遊費',
  '保險費', '電腦費', '工程費', '水費', '電費', '購物費',
];
export function feeNameOf(industry: number): string {
  return FEE_NAMES[INDUSTRY_FEE_NAME_INDEX[industry] ?? 0] ?? '過路費';
}

// ============================================================
//  别人的公司：按行業收費
// ============================================================

export type CompanyFee =
  /** 什么也不发生（行業 2、7..10，或走路的人踩汽車/石油、航空轉盤轉到 0） */
  | { kind: 'none' }
  /** 付一笔費给公司 */
  | { kind: 'fee'; amount: number; name: string }
  /** 保險：付費并投保 `days` 天 */
  | { kind: 'insurance'; amount: number; days: number }
  /** 建設：先选一处自己的地免费加蓋一级，再付那块地地價 × 物價的工程費 */
  | { kind: 'construction' };

/**
 * 踩到**别人的**上市企業要付什么。
 *
 * @source 0x0041ab6d 起：
 * ```asm
 * 0041ab6f  if (企業.owner == 0) 结束                 ; 无主公司不收費（只问認購）
 * 0041ab77  if (owner == 我) 结束                     ; 自家的走另一路（见 chairmanEffect）
 *  行業 1  航空   轉盤 0 → n；n == 0 →「不用出國！」；否则 費 = n × 地價 × 物價   （旅遊費）
 *  行業 3  電子   費 = 地價 × 遊戲總天數  ★ 不乘物價（0x0041ac2c 直接跳过 ×物價那句）（電腦費）
 *  行業 4  保險   轉盤 3 → 天数；費 = 天数 × 地價 × 物價；投保 +天数（& 0x7f）        （保險費）
 *  行業 5/6 汽車/石油  走路免；否则 費 = 地價 × (1 << (載具−1)) × 步數 × 物價       （修車費/加油費）
 *  行業 11 建設   选一处自己的地免费加蓋，費 = 那块地的地價 × 物價                    （工程費）
 *  行業 12 門派   費 = 地價 × 步數 × 物價                                            （幫主）
 *  其余（2 飯店、7 銀行、8、9、10 百貨）不收費
 * ```
 * 这里的「地價」是企業记录的 `+0x22`，本引擎叫 `landPrice`。
 */
export function companyFeeOnLanding(
  industry: number,
  landPrice: number,
  priceIndex: number,
  totalDays: number,
  trafficMethod: number,
  stepsTotal: number,
  randValue: number,
): CompanyFee {
  switch (industry) {
    case INDUSTRY.airline: {
      const n = spinWheel(WHEEL.travel, randValue);
      if (n === 0) return { kind: 'none' };
      return { kind: 'fee', amount: n * landPrice * priceIndex, name: feeNameOf(industry) };
    }
    case INDUSTRY.electronics:
      return { kind: 'fee', amount: landPrice * totalDays, name: feeNameOf(industry) };
    case INDUSTRY.insurance: {
      const days = spinWheel(WHEEL.insurance, randValue);
      return { kind: 'insurance', amount: days * landPrice * priceIndex, days };
    }
    case INDUSTRY.auto:
    case INDUSTRY.oil: {
      const v = trafficMethod & 3;
      if (v === 0) return { kind: 'none' };
      const mult = 1 << (v - 1);
      return { kind: 'fee', amount: landPrice * mult * stepsTotal * priceIndex, name: feeNameOf(industry) };
    }
    case INDUSTRY.construction:
      return { kind: 'construction' };
    case INDUSTRY.sect:
      return { kind: 'fee', amount: landPrice * stepsTotal * priceIndex, name: feeNameOf(industry) };
    default:
      return { kind: 'none' };
  }
}

/** 這一行業的落点會不會用到轉盤（決定要不要消耗随机数） */
export function industryUsesWheel(industry: number): boolean {
  return industry === INDUSTRY.airline || industry === INDUSTRY.insurance;
}

// ============================================================
//  認購股份：通用填数窗的上限
// ============================================================

/**
 * 一次認購的股數上限 —— 原版写死的 `0x3e8`。
 *
 * @source VA 0x0041d857：`cmp eax, 0x3e8 / jle short loc_0041d216 / mov esi, 0x3e8`
 */
export const MAX_SHARES_PER_PURCHASE = 0x3e8; // 1000

/**
 * 踩到上市企業时，那个**通用填数窗**（`fcn_00453544`）吃到的「上限」。
 *
 * ★ 这是**规则**，不是界面的事：原版在 `fcn_0041d1a9` 里算好再交给填数窗
 *   （`push esi / call fcn_00453544`），窗子里只做一次越界夹回。所以本引擎
 *   也把上限放进 `pending`，客户端**不许自己再算一遍**（C-ARC-2）。
 *
 * @source VA 0x0041d1a9，进「訊息框／填数窗」之前那一段：
 * ```asm
 * 0041d845  mov  ecx, 0x2710                  ; 10000
 * 0041d857  mov  eax, [ebx + 0x24]            ; 企業資產額
 * 0041d860  idiv ecx                          ; ecx = 每股售價 = 資產額 ÷ 10000（向零取整）
 * 0041d86a  mov  edx, [esi + 0x496b84]        ; ★ 買家**現金**（player + 0x1c，不是存款）
 * 0041d88e  idiv ecx                          ; eax = 現金 ÷ 每股售價
 * 0041d857  mov  esi, eax
 * 0041d85d  cmp  eax, 0x3e8
 * 0041d863  jle  loc_0041d216
 * 0041d865  mov  esi, 0x3e8                   ; ★ 一律夹到 1000 股
 * 0041d216  mov  eax, [ebx + 0x30]            ; 企業還剩多少股
 * 0041d21a  cmp  esi, eax
 * 0041d21c  jle  loc_0041d21f
 * 0041d21e  mov  esi, eax                     ; ★ 再夹到企業餘量
 * 0041d21f  test esi, esi
 * 0041d221  je   near loc_0041d2bb            ; ★ 算出来是 0 → 連問都不問
 * ```
 *
 * ⇒ `min(1000, 現金 ÷ 每股售價, 企業餘量)`；`0` 表示「问都别问」。
 *
 * ⚠️ **只有这条（真人問句 + 填数窗）用这个上限**。电脑那一条走的是
 *   `_rich4_calculate_max_purchase_count`（VA 0x0041d839：資產 × 物價為安全垫，
 *   拿現金減掉它再除單價），**没有 1000 这层闸** —— 所以 AI 策略层照旧
 *   用 `available` 自己算，不要拿这个函数的结果去卡电脑。
 */
export function shareWindowLimit(unitPrice: number, cash: number, available: number): number {
  // 原版这里 `idiv` 一个可能为 0 的单价（資產額 < 10000 时）会当场除零；
  // 本引擎给 0 = 不开窗，与「买不起一股」同一出口。
  if (unitPrice <= 0) return 0;
  const byCash = Math.trunc(cash / unitPrice);
  const byStock = Math.trunc(available);
  return Math.max(0, Math.min(MAX_SHARES_PER_PURCHASE, byCash, byStock));
}

// ============================================================
//  自家的公司：董事長的好处
// ============================================================

export type ChairmanEffect =
  | { kind: 'none' }
  /** 保險公司董事長：免費投保 `days` 天 @source 0x0041a9fe 轉盤 3 → +0x3e */
  | { kind: 'insurance'; days: number }
  /** 建設公司董事長：免費给自己的一处地加蓋一级 @source 0x0041aa3c */
  | { kind: 'construction' };

/**
 * @source 0x0041a9e8：`level(行業) < 4 → 无事；== 4 保險；== 11 建設；其余无事`
 */
export function chairmanEffect(industry: number, randValue: number): ChairmanEffect {
  if (industry === INDUSTRY.insurance) return { kind: 'insurance', days: spinWheel(WHEEL.insurance, randValue) };
  if (industry === INDUSTRY.construction) return { kind: 'construction' };
  return { kind: 'none' };
}

/** 投保天数的累加 —— `add dh, dl; and cl, 0x7f`（0x0041aa24 / 0x0041ac74） */
export function addInsuranceDays(current: number, days: number): number {
  return (current + days) & 0x7f;
}

// ============================================================
//  建設：电脑挑哪一处加蓋
// ============================================================

/**
 * @source `0x40b455(玩家)`：先扫地块表，只看自己的、住宅（type 0）、等级 < 5 的，
 *   取**当前等级租金**最大的；再扫設施表，自己的、等级 < 上限的，取**地價**最大的
 *   （与前面那个最大值比，谁大取谁）。返回实体编码（0x7d0 + 地块 / 0xfa0 + 設施），
 *   一个都没有返回 0。
 */
export function aiPickConstructionTarget(
  playerIndex: number,
  lands: readonly LandInfo[],
  landOwner: readonly number[],
  landLevel: readonly number[],
  landType: readonly number[],
  facilities: readonly FacilityInfo[],
  facilityOwner: readonly number[],
  facilityLevel: readonly number[],
  facilityType: readonly number[],
): number {
  let best = 0;
  let bestScore = 0;
  for (const l of lands) {
    if ((landOwner[l.id] ?? 0) !== playerIndex + 1) continue;
    if ((landType[l.id] ?? l.type) !== 0) continue;
    const level = landLevel[l.id] ?? 0;
    if (level >= MAX_LAND_LEVEL) continue;
    const rent = l.rentByLevel[level] ?? 0;
    if (rent > bestScore) {
      bestScore = rent;
      best = 0x7d0 + l.id;
    }
  }
  for (const f of facilities) {
    if ((facilityOwner[f.id] ?? 0) !== playerIndex + 1) continue;
    if (f.landPrice <= bestScore) continue;
    const type = facilityType[f.id] ?? 0;
    const level = facilityLevel[f.id] ?? 0;
    if (level >= (FACILITY_MAX_LEVEL[type] ?? 0)) continue;
    bestScore = f.landPrice;
    best = 0xfa0 + f.id;
  }
  return best;
}

// ============================================================
//  月中分紅
// ============================================================

export interface DividendRow {
  player: number;
  amount: number;
}

/**
 * 一家公司这个月分多少给谁。
 *
 * @source 0x0042bd61 起（每支股票一轮）：
 * ```asm
 * 0042bd72  company = [股票表[s] + 0x0c]；0 → 这支股票没有公司，跳过
 * 0042bdc3  ebp = Σ 在场玩家的持股                      ; ★ 分母是**玩家持股总和**，不是总股本
 * 0042bc0a  ratio[p] = held[p] ? held[p] / ebp : 0
 * 0042bc90  紅利[p] = trunc(company.+0x28 × ratio[p])   ; 累積盈餘 × 比例
 * 0042bd37  if (ebp != 0) company.+0x28 = 0             ; ★ 有人持股才清零，没人持股盈餘留着
 * ```
 * 最后（0x0042be83）`存款 += 紅利`；存款为负则并入现金，现金也负就归零并**破產**
 * —— 所以盈餘为负时分紅是**负的**，照抄。
 */
export function companyDividends(
  funds: number,
  holdings: readonly number[],
  players: readonly Player[],
): { rows: DividendRow[]; cleared: boolean } {
  let total = 0;
  for (let p = 0; p < players.length; p++) {
    const pl = players[p];
    if (pl === undefined || !isAlive(pl)) continue;
    total += holdings[p] ?? 0;
  }
  const rows: DividendRow[] = [];
  if (total === 0) return { rows, cleared: false };
  for (let p = 0; p < players.length; p++) {
    const pl = players[p];
    if (pl === undefined || !isAlive(pl)) continue;
    const held = holdings[p] ?? 0;
    if (held === 0) continue;
    // @source fild held / fild total / fdivp → 单精度比例（0x0042bc59 `fstp dword`）；
    //   0x0042bc90 `fild 盈餘` / 0x0042bc93 `fmul ratio` / 0x0042bc9a
    //   `call 0x457dbc`（`__round_toward_zero`：**向零截断**，不是就近/四舍五入）
    const ratio = Math.fround(held / total);
    const amount = truncTowardZero(Math.fround(funds * ratio));
    if (amount !== 0) rows.push({ player: p, amount });
  }
  return { rows, cleared: true };
}

/**
 * 紅利入账 —— 进**存款**，负数往下压：存款 < 0 就并进现金、存款归零；
 * 现金也 < 0 就归零并报破產。@source 0x0042be83..0x0042beba
 */
export function applyDividend(player: Player, amount: number): { player: Player; bankrupt: boolean } {
  let moneyInBank = player.moneyInBank + amount;
  let cash = player.cash;
  let bankrupt = false;
  if (moneyInBank < 0) {
    cash += moneyInBank;
    moneyInBank = 0;
    if (cash < 0) {
      cash = 0;
      bankrupt = true;
    }
  }
  return { player: { ...player, cash, moneyInBank }, bankrupt };
}

/** 分紅日 —— 与樂透開獎同一天 @source 0x0041d080 `cmp eax, 0xf` 之后先 0x42ba97 再 0x431712 */
export const DIVIDEND_DAY = 15;

// ============================================================
//  保險理賠
// ============================================================

/**
 * 在保險期内的損失由保險公司赔付。
 *
 * @source `0x44ba63(玩家, 損失, 旗标)`：
 * ```asm
 * 0044ba74  if (玩家.+0x3e == 0) return          ; 没投保
 * 0044ba82  找到 行業別 == 4 的那家企業          ; 保險公司
 * 0044baa5  msg("保險期間\n\n得到理賠金\n\n%d元")
 * 0044bad8  pay_money(100 + 企業下标, 玩家, 損失, 1)   ; ★ 公司付，進現金
 * ```
 * 谁会调它：旅館住店的 2000×天×物價、被狗咬/踩雷/炸彈住院、監獄等「意外損失」——
 * 本引擎眼下只在旅館那一处接（`hotelStayLoss`），其余调用点见 Q-INS-1。
 */
export function insurancePayout(insuranceDays: number, loss: number): number {
  return insuranceDays !== 0 && loss > 0 ? loss : 0;
}
