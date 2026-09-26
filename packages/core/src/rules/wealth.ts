/*
 * 总资产计算与物价指数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_calculate_player_wealth.asm @ VA 0x004239b9
 * @source `update_price_index` @ **VA 0x00423acf**
 *   （rich4-re 记的 0x00423ad0 差一字节，落在 `push ebx` 之后）
 *
 * ★ Q17 已结案，见 updatePriceIndex 的注释与 rules/setup.ts 的 GAME_INITIAL_FUNDS。
 */

import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

/** 估值用的一支股票持仓（持股数 + 市价） */
export interface StockValuation {
  /** 持股数 @source player_stock_info.amount（每项 8 字节，每人 12 支 = 96 字节） */
  amount: number;
  /**
   * 当前股价。
   * @source stock_info 的 `float f20`（偏移 20）——注意**不是** `f8`。
   *   `f8`(偏移 8) 是总股数（初始表里为 10000/5000 等），
   *   `f12/f16/f20` 三个 float 初值相同（如 100.0），`f20` 是估值时取用的那个。
   */
  price: number;
}

/** 股票支数 @source `cmp edx, 0xc / jl` —— 固定 12 支 */
export const STOCK_COUNT = 12;

/**
 * 计算玩家总资产。
 *
 * 构成：
 * ```
 * 现金 + 存款 − 贷款
 *   + Σ(持股数 × 股价)            ← 逐支累加，**每支之后都向零取整**
 *   + Σ(自有住宅：地价 + 等级×房价)
 *   + Σ(自有连锁店：地价 + 房价)   ← 与等级无关，与住宅不对称
 *   + Σ(自有设施：地价 + 等级×房价)
 * ```
 *
 * ⚠️ 股票部分原版用 x87 浮点，且**每支股票算完就 `fistp` 截断回整数**
 * （不是最后统一取整）。这里如实复刻逐次截断，否则多支股票时会有累积偏差。
 *
 * ⚠️⚠️ 还有一处**只在总资产 > 2^24 时才显形**的怪癖（2026 本轮用原版真码测出）：
 * ```asm
 * 004239ff  mov eax, [esp]            ; 当前整数总资产
 * 00423a02  mov [esp+4], eax
 * 00423a06  fild dword [esp+4]        ; 装入（精确）
 * 00423a0a  fstp dword [esp+4]        ; ★ 又**存回 float32**（>2^24 就丢低位）
 * 00423a0e  fadd dword [esp+4]        ; 加上这个被舍入过的总资产
 * 00423a12  call 0x457dbc             ; trunc
 * 00423a17  fistp dword [esp]         ; 写回整数总资产
 * ```
 * 即 `total = trunc(市值 + f32(total))` —— 总资产被**反复压进 24 位尾数**。
 * 实测（原版真码 vs 纯双精度，持股 1000、价 10.35）：
 * `total=16777217 → 16787566`（原版）但 `16787567`（双精度）；
 * `total=999999999 → 1000010368` 但 `1000010349`（**差 19**）。
 * 故此处必须 `Math.fround(total)`；否则大额玩家（>1677 万）的总资产会偏。
 * 回归用例见 `rules/wealth-f32.test.ts`。
 *
 * @source 现金/存款/贷款：`player[+28] + player[+32] − player[+36]`
 *   （0x1c cash / 0x20 money_in_bank / 0x24 loan）
 *
 * ★★ WLT-02（2026-09-25 follow-up 审计）：这整个累加器是**32 位整数**（帧里那一格 `[esp]`），
 *   不是 JS 双精度：
 * ```asm
 * 004239c7  mov edx, [eax + 0x496b84]      ; 現金（int32）
 * 004239cd  add edx, [eax + 0x496b88]      ; + 存款（32 位加法，溢出回绕）
 * 004239d3  mov esi, [eax + 0x496b8c]
 * 004239d9  sub edx, esi                   ; − 貸款
 * 004239db  mov [esp], edx                 ; 运行中的总资产 = int32
 * 00423a17  fistp dword [esp]              ; 股票那一轮**存回 int32**
 * 00423a4a  add ebp, ecx                   ; 地块/設施：32 位加法
 * 00423ac4  mov eax, [esp] / ret           ; ★ 返回值就是那个 int32
 * ```
 *   `fistp dword` 在**超出 int32 范围**时存的是 x87 的「整数不确定值」`0x80000000`
 *   （= −2147483648）：无效操作异常默认**屏蔽**（原版从不解除屏蔽，`0x457dbc` 只临时改
 *   取整方向、之后 `fldcw` 还原）。
 *
 *   ★ 这一条不是照文档推的 —— 用原版真码（Unicorn）实测过（`0x4239db..0x423a20`，
 *   注入口袋与持股/股价，回读 `[esp]`）：
 *   ```
 *   total=INT_MAX、无持股          → -2147483648
 *   持股 1000×2e6 = 2e9、total=0   → 2000000000   （范围内精确）
 *   持股 1000×3e6 = 3e9、total=0   → -2147483648  （fistp 溢出）
 *   total=2e9 + 1000×3e5           → -2147483648
 *   ```
 *   回归用例见 `rules/wealth-f32.test.ts` 的「32 位回绕」一节。
 */
export function calculatePlayerWealth(
  player: Player,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
  stocks: readonly StockValuation[] = [],
): number {
  // @source 0x004239c7..0x004239db —— 32 位加/减，溢出回绕（`| 0`）
  let total = (player.cash + player.moneyInBank - player.loan) | 0;

  // 股票：逐支累加并截断 @source loc_004239e0
  //
  // ⚠️★ 原版这个循环**不跳过空仓**：`for (edx = 0; edx < 12; edx++)`
  //   （`0x423a1a inc edx` / `0x423a1b cmp edx,0xc` / `jl`），每轮都走
  //   `fild 持股 → fmul 股价 → f32(total) → trunc → fistp`。
  //   持股为 0 时那一轮的价值就是「把总资产**再压一次 float32**」——
  //   所以**不能**因为 `stocks[s] === undefined` 就 `continue`，
  //   否则大额玩家（>2^24）的总资产会与原版差 1~19。
  for (let s = 0; s < STOCK_COUNT; s++) {
    const h = stocks[s];
    const amount = h?.amount ?? 0;
    const price = h?.price ?? 0;
    // ★ `f32(total)`：原版 0x423a0a 的 `fstp dword [esp+4]` 把运行中的总资产
    //   也舍入到 float32（>2^24 丢低位），见上方 @source 注释与 wealth-f32.test.ts
    // ★ `fistpInt32`：0x423a17 `fistp dword [esp]` —— 截断后存回 **int32**（越界 ⇒ INT_MIN）
    total = fistpInt32(Math.trunc(amount * price + Math.fround(total)));
  }

  const ownerId = player.index + 1;

  // 住宅地块 @source loc_00423a2d —— 每一步都是 32 位整数加法（`0x423a4a add ebp, ecx`），
  //   溢出**回绕**（`| 0`）；地价/房价在表里是 u16，`movzx` 零扩展后相加
  for (const land of lands) {
    if (land.owner !== ownerId) continue;
    total = (total + land.landPrice) | 0;
    if (land.type !== LAND_TYPE_HOUSE) {
      // 连锁店：固定加一份房价，**不乘等级**
      total = (total + land.housePrice) | 0;
    } else if (land.level !== 0) {
      total = (total + land.level * land.housePrice) | 0;
    }
  }

  // 设施 @source loc_00423a96
  //   total += level × house_price(0x24) + land_price(0x22)
  for (const fac of facilities) {
    if (fac.owner !== ownerId) continue;
    total = (total + fac.level * fac.housePrice + fac.landPrice) | 0;
  }

  return total;
}

/**
 * x87 `fistp dword` 的落地语义：截断之后存成 **int32**；超出范围存**整数不确定值**
 * `0x80000000`（= −2147483648）。
 *
 * @source 身家 0x00423a17 `fistp dword [esp]`。无效操作异常默认屏蔽、原版从不解除
 *   （`0x457dbc` 只临时改取整方向，`0x457dcf fldcw` 立刻还原）⇒ 越界时存的是
 *   那个保留值。★ 用原版真码（Unicorn）实测确认，见 `calculatePlayerWealth` 的注释。
 */
function fistpInt32(v: number): number {
  if (!Number.isFinite(v)) return -0x80000000;
  const t = Math.trunc(v);
  return t >= -0x80000000 && t <= 0x7fffffff ? t : -0x80000000;
}

/**
 * 物价指数的除数就是**开局资金**（全局 `[0x49908c]`，见 rules/setup.ts
 * 的 `GAME_INITIAL_FUNDS`）。
 *
 * ★ 两处独立佐证它确实是开局资金：
 *   1. `Save0.dat` / `SAVE1.DAT` 偏移 0x268A 均为 300000，且开局按该值发钱
 *   2. 人均总资产 300000 时物价指数恰为 1
 *
 * 物价指数开局值 @source mov dword [0x4990e8], 1（VA 0x004073b4） */
export const INITIAL_PRICE_INDEX = 1;

/**
 * 推进物价指数。
 *
 * ```
 * 新指数 = (在场玩家总资产之和 ÷ 在场人数) ÷ 初始资金
 * if (新指数 > 当前指数) 当前指数 = 新指数     ← ★ 只升不降
 * ```
 *
 * 这是游戏后期通货膨胀的来源：玩家越富，物价越高，且**永不回落**。
 *
 * ⚠️ 两次除法都是**有符号整数除法**（`idiv`，向零取整），不是浮点。
 *
 * ★ **全局唯一的运行时写入点是 VA 0x00423b1b**，由**日推进**
 *   `fcn_0041cf67`（VA 0x0041cfbf）每天调用一次。另两处写入分别是开局置 1
 *   与读档还原。也就是说物价指数**只在回合边界采样**。
 *
 * ★ 这解释了 `Save0.dat` 的疑点（原 Q17 遗留）：该存档指数为 5，
 *   而按存档当时的状态套公式得 11。因为那是**终局存档**——四人中三人
 *   已出局，平均只按剩下的巨富一人算，公式值自然高；但最后一次**采样**
 *   发生在还有多人在场时，平均低得多。
 *   **存档里的 5 是对的，拿终局状态套公式才是错的。**
 *
 * @source rich4_update_price_index.asm
 * @param players           全体玩家（含已出局者，函数内部按 who_plays 过滤）
 * @param wealthOf          取某玩家总资产
 * @param initialFund       开局资金 `_rich4_game_initial_fund`
 * @param currentPriceIndex 当前物价指数
 * @returns 更新后的物价指数
 */
export function updatePriceIndex(
  players: readonly Player[],
  wealthOf: (p: Player) => number,
  initialFund: number,
  currentPriceIndex: number,
): number {
  let sum = 0;
  let count = 0;
  for (const p of players) {
    if (!isAlive(p)) continue; // @source cmp byte [player+21], 0 / je skip
    // ★ 2026-09-24 审计订正：`0x00423af5 add esi, eax` 是 32 位累加（总身家 > 2^31 时回绕），照抄
    sum = (sum + wealthOf(p)) | 0;
    count++;
  }
  if (count === 0 || initialFund === 0) return currentPriceIndex;

  // idiv 是向零取整的有符号除法
  const average = Math.trunc(sum / count);
  const next = Math.trunc(average / initialFund);

  // @source cmp eax, price_index / jle → 不更新
  return next > currentPriceIndex ? next : currentPriceIndex;
}
