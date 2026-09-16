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
 * ## 竞价循环归谁（Q-AUC-1 的定案，2026-09-15）
 *
 * 原版的竞价循环**不是一个交互式对话框**，而是窗口过程 `fcn_0043a2dd` 里
 * 一条 100ms 定时器驱动的循环：每转到一个座位，真人等点钮
 * （`0x407` 消息）、电脑当场算一口（`fcn_00439f0d` + `0x43b124`），
 * 每一口之后回 `loc_0043b295` 复查「还剩几个能出价的」。
 *
 * 本项目原先把它整条放在表现层（`client/auction-screen.ts`），于是
 * **无头跑 core 时拍賣永远答不掉**（服务端权威、soak 全 AI 局都卡在这）。
 * 现在循环立在这里（core 是权威、无头也能跑完），表现层只负责**收集真人**
 * 的那一口并把 core 的每一口演出来。
 *
 * 每个座位的状态（`AuctionSeatStatus`）与原版座位表 `+2` 那个 word 同义：
 * 0 = 可出价，非 0 = 已出过价/已放棄/不在场。★ **PASS 是永久的** ——
 * 全文件没有任何一处把 `[0x48c436 + 20i]` 写回 0（入口写一次、PASS 写 1、
 * 放棄写 4），所以流局的收敛靠的就是「出价的人越出越少」。
 */

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { transferMoney, PARTY_POOL, type Company } from './payment.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { truncTowardZero } from './rounding.ts';

// ★ 全项目只有 `rules/rounding.ts` 一份实现；这里转出去只为兼容既有引用。
export { truncTowardZero } from './rounding.ts';

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
 * 即 **`trunc(地价 × (1 + 等级 × 0.5)) × 物价指数`**。
 *
 * ⚠️ 取整发生在**乘物价指数之前**——先把浮点结果取整，再整数相乘。
 * 顺序换了在多数情况下结果相同，但等级为奇数时会差一点，故照搬。
 *
 * ⚠️ **取整是向零截断，不是就近取偶**：`call 0x457dbc` 的
 *   `__round_toward_zero`（VA 0x00457dbc，见 `rich4_misc_util.asm`）把
 *   x87 控制字 **bit10-11（RC）置成 `11` = 向零** 之后才 `frndint`
 *   （只改高字节 `mov byte [esp + 1], 0x1f` ⇒ CW = 0x1f7f，PC 仍是扩展精度）：
 *   ```asm
 *   __round_toward_zero:
 *   fnstcw [esp] / push [esp] / mov byte [esp+1], 0x1f / fldcw [esp]
 *   frndint / fldcw [esp+4] / ret
 *   ```
 *   故 `1.5 → 1`、`2.5 → 2`、`1498.5 → 1498`、`1501.5 → 1501`
 *   （T-034 那一轮把它当成了 `percentage.ts` 的就近取偶，是误读）。
 *
 * ★ 实现已上提到 `rules/rounding.ts`，本文件不再自留一份。
 */
export function auctionBasePrice(
  entity: { landPrice: number; level: number },
  priceIndex: number,
): number {
  const factor = 1 + entity.level * AUCTION_LEVEL_FACTOR;
  // 这里是**价格**而非评分：原版浮点乘之后走 `__round_toward_zero`，
  // 对非负数就是 `Math.trunc`。产物是**金额**，不豁免 C-DET-3。
  const truncated = truncTowardZero(entity.landPrice * factor);
  return truncated * priceIndex;
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
 * `__round_toward_zero` @source VA 0x00457dbc —— **已移至 `rules/rounding.ts`**。
 *
 * 本文件原先自留过一份同名实现（与 `percentage.ts` 的就近取偶版重名而语义相反），
 * 现统一为 `rounding.ts` 的唯一一份，并在文件头 `export { … } from` 转出，
 * 既有 `import { truncTowardZero } from './auction.ts'` 不受影响。
 */

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

/**
 * 压价那一段（`loc_0043b183`）用的余量。
 *
 * @source VA 0x0043b1bd `add edi, 0x1f4` —— 线 = **最高出价者现金 + 500**；
 *   随后的档位判据也是拿 `线 − 现价` 去比 `0x3e8 / 0x1388 / 0x1f4 / 0x64`。
 */
export const AUCTION_RAISE_CAP_MARGIN = 500;

/**
 * `fcn_00439f0d` 里第一次 `rand()` 的**除数**。
 *
 * @source `0x465014` 的 f32 —— 从 exe 逐字节 dump 出来是 `0x46fffe00`
 *   （`python3 tools/disasm.py va 0x465014` ⇒ `fdiv dword [0x465014]`），
 *   即 **32767.0f**，不是 32766。
 *
 * 而 `_libc_rand`（VA 0x00456f2d，MSVC LCG）returns `(state >> 16) & 0x7fff`，
 * 值域 **0..32767**，故 `rand()/32767.0 ∈ [0,1]`（闭区间右端可取到 1）。
 */
export const AUCTION_LIMIT_RAND_DIVISOR = 32767;

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
 * factor   = rand()/32767.0 * 0.3 + 0.5          ; [0.5, 0.8]（0x465014/18/20）
 * ratio    = 无主数 / 总数                        ; fdivp
 * scarcity = 6.0 - 4.0 * ratio                   ; 0x465028/2c → 越缺地越高
 * v1 = round( ((level>>1) + 1 + 同名数) × 起拍价 × 物价指数 × scarcity × factor )
 * v2 = round( 地价 × 物价指数 × (3 + rand()/65536) )   ; 0x465030 = 1/65536、0x465034 = 3.0
 * return min(v1, v2, 现金)
 * ```
 *
 * ⚠️ `v1` 里**乘了两次物价指数**（起拍价本身已经含过一次）—— 原版如此，照抄。
 *
 * ⚠️ 除数 0x465014 是 **32767.0f**（见 `AUCTION_LIMIT_RAND_DIVISOR`）。
 *   早先写 32766，是 T-034 那一轮读错的常量 —— 已按 exe 订正。
 *
 * @param rnd 取 `[0,1)` 的随机数，代表 `rand()/32768`（注入是为单测能钉序列）。
 *   原版 `rand()` 值域 `0..0x7fff`，故 `rand() = rnd() * 32768`。
 */
export function auctionAiLimit(input: AuctionAiInputs, rnd: () => number): number {
  const rand = (): number => rnd() * 32768;

  // @source fdiv rand() / 32767.0（0x465014 = 32767.0f）、×0.3（0x465018）、+0.5（0x465020）
  // eslint-disable-next-line no-restricted-syntax -- 原版这一段就是浮点（`fdiv`/`fmul`/`fadd`），产出的是**心理价位**不是账目金额
  const factor = (rand() / AUCTION_LIMIT_RAND_DIVISOR) * 0.3 + 0.5;

  // @source fdivp（无主数 / 总数）、×4.0（0x465028）、fsubr 6.0（0x46502c）
  // eslint-disable-next-line no-restricted-syntax -- 同上，这是「缺地系数」而非金额
  const scarcity = 6 - 4 * (input.total === 0 ? 0 : input.unowned / input.total);

  const scale = (Math.floor(input.level / 2) + 1 + (input.sameNameOwned ?? 0)) *
    input.basePrice * input.priceIndex;
  const v1 = truncTowardZero(scale * scarcity * factor);

  // @source `imul eax, ecx`（地价 × 物价指数）后 `fmul (rand()/65536 + 3.0)`
  const landValue = input.landPrice * input.priceIndex;
  // eslint-disable-next-line no-restricted-syntax -- 原版 `rand()` 直接除以 65536.0 再乘地价
  const v2 = truncTowardZero(landValue * (3 + rand() / 65536));

  return Math.min(v1, v2, input.cash);
}

/**
 * 按心理价位挑**加多少** —— 返回 `AUCTION_RAISE_STEPS` 的**金额**，`0` = PASS。
 *
 * @source `loc_0043b124` VA 0x0043b124（电脑玩家那一支；进入前先过
 *   `0x43b10c` 的 `cmp ecx, [玩家+0x1c] / jle`）：
 * ```asm
 * if (现金 < 现价)             → PASS（0x43b10c 直接跳到 0x43b17c 给 ebx = 0）
 * if (现价 + 10000 <= 心理价位) → +10000     ; lea edx,[ecx+0x2710] / cmp edx,esi / jg
 * if (现价 +  5000 <= 心理价位) → +5000      ; +0x1388
 * if (现价 +  1000 <= 心理价位) → +1000      ; +0x3e8
 * if (现价 +   500 <= 心理价位) → +500       ; +0x1f4
 * if (现价 +   100 <= 心理价位) → +100       ; +0x64
 * else                          → PASS（ebx = 0）
 * ```
 * 全部是**有符号**比较（`jle`/`jg`）。
 *
 * 随后还有一段（`loc_0043b183`，@source 0x0043b1c7..0x0043b217）：若这一口会
 * **超过「当前最高出价者」的现金 + 500**（VA 0x0043b1bd 的 `add edi, 0x1f4`），
 * 就拿 `room = 线 − 现价` 重挑一档：
 * ```asm
 * room <  100                → 100      ; cmp 0x64 / jle  +  cmp 0x64 / jg 的落空支
 * 100 <= room <  500         → 500      ; cmp 0x1f4 / jle + cmp 0x1f4 / jg
 * 500 <= room < 1000         → 1000     ; cmp 0x3e8 / jle + cmp 0x3e8 / jg
 * 1000 <= room <= 5000       → 5000     ; cmp 0x3e8 / jle + cmp 0x1388 / jg
 * room == 500 / 1000 / 5000  → ★ 档位**原样保留**（两边都不命中，原版就这样）
 * room > 5000                → 档位原样保留
 * ```
 * 传 `topCash`（无最高者时传 `null`）即启用。
 *
 * ⚠️ 压价那一段**只改档位、不保证结果 ≤ 最高者现金 + 500**（`room ∈ [1000,5000]`
 *   一律给 5000 档，哪怕 room 只有 1000）。照抄，别「改正」。
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

  // @source loc_0043b183：`add edi, 0x1f4` —— 「最高出价者的现金 + 500」这道线
  if (topCash !== null && step !== 0 && price + step > topCash + AUCTION_RAISE_CAP_MARGIN) {
    const room = topCash + AUCTION_RAISE_CAP_MARGIN - price;
    // ★ 逐条照抄 0x43b1cd..0x43b217 的 `cmp` / `jle` / `jg` **对**，别合并区间：
    //   `cmp 1000 / jle`（room ≤ 1000 跳过）+ `cmp 5000 / jg`（room > 5000 跳过）
    //   ⇒ room ∈ [1000, 5000] 走 5000 档（room 恰为 1000 或 5000 都命中）。
    if (room >= 1000 && room <= 5000) step = 5000;
    else if (room >= 500 && room < 1000) step = 1000;
    else if (room >= 100 && room < 500) step = 500;
    else if (room < 100) step = 100;
    // ⚠️ room > 5000 时四个区间一个都不命中 → 档位原样保留（原版如此）。
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

// ============================================================
//  竞价循环（Q-AUC-1：循环归 core，表现层只演）
// ============================================================

/**
 * 一个座位还能不能出价。
 *
 * ★ 与原版座位表 `+2` 那个 word 同义（0 = 可出价，非 0 = 不可）。
 *   `'passed'` / `'givenUp'` 在数值上是同一档（原版都写非 0），
 *   分开只为让表现层能把「放棄」和「PASS」演得不一样。
 */
export type AuctionSeatStatus = 'active' | 'passed' | 'givenUp';

/**
 * 开拍时给每个玩家定座位状态。
 *
 * @source 入口 `loc_0043c110` 起那段：
 * - `who_plays == 0`（出局）→ **连座位都没有**，直接跳过；
 * - **出不起底价**（`cmp 现金, 底价 / jg`，即 `现金 <= 底价`）→ 状态 8；
 *   本引擎把 8 与「不可出价」合并成 `'givenUp'`——原版之所以分开，
 *   只是因为 8 要画另一张图（`giveUp` 那张），规则上是同一档（非 0）；
 * - 其余 → 0（可出价）。
 *
 * ⚠️ 原版建表在 `fcn_00439f0d` **之前**（0x43c5d9 复查状态），故「出不起底价」
 *   的座位拿到的是心理价位 0。
 */
export function auctionSeatStatus(
  players: readonly Player[],
  bidders: readonly number[],
  basePrice: number,
): AuctionSeatStatus[] {
  const want = new Set(bidders);
  return players.map((p, i) => {
    if (p.whoPlays === 0) return 'givenUp';
    if (!want.has(i)) return 'givenUp';
    // @source 0x43c140 `cmp 现金, 底价 / jg` —— 恰好等于底价也出不起
    return p.cash <= basePrice ? 'givenUp' : 'active';
  });
}

/**
 * 「下一家轮到谁」@source `loc_0043b3c2`：座位号 +1 取模，跳过非「可出价」的。
 *
 * ★ 也要跳过**卖家**（原版卖家的状态是 7，绕圈一并跳过）—— 见 `auctionFirstSeat`
 *   的头注释。否则无主地自拍时（卖家也在 `bidders` 里且状态是 `'active'`）
 *   绕一圈会绕回卖家、屏上又等他自己点。
 *
 * 反复绕圈直到有人可出价为止；**一个可出价的都没有时原样返回**
 * （此时 `auctionFinished` 已经判成流标，这个值不再有人看）。
 */
export function auctionAdvanceSeat(
  bidders: readonly number[],
  status: readonly AuctionSeatStatus[],
  from: number,
  seller = -1,
): number {
  const n = bidders.length;
  if (n === 0) return from;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const player = bidders[i];
    if (player === undefined || player === seller) continue;
    if ((status[player] ?? 'active') === 'active') return i;
  }
  return from;
}

/**
 * 开场第一个出价席位。
 *
 * ★★ 2026-09-16 订正（外部审查 A-3）—— 两处都要照原版：
 *
 *   原版入口 `loc_0043c110` 把有资格的人压进 `[0x48c434]`（座位表，**slot** 下标），
 *   状态放在 `[0x48c436]`（同一下标）。建完表 `loc_0043a365` 把 `[0x48c4a4] = 0`
 *   —— 从 slot 0 起；再由 `loc_0043b3c2` 的绕圈（`inc` → `and 3` →
 *   `cmp [slot*20+0x48c434],0`）跳过**一切非 0 状态**。
 *   ★ **卖家在那种编码里就是状态 7**（建表时 `cmp ebx, [esp+0xac]` 那一支写 7），
 *   所以绕圈**永远跳过卖家** —— 起拍那一口不可能落在卖家头上。
 *
 *   本引擎的 `bidders` 是「按玩家下标压缩过的数组」、`status` 按**玩家下标**索引，
 *   两者混用先前踩了三个坑：
 *     ① 拿 `state.currentPlayer`（**玩家下标**）当 `bidders` 下标用；
 *     ② 一个都不可出价时返回 0 —— 那正好可能是卖家那一格；
 *     ③ **没把卖家排除掉**：无主地自拍时 `eligibleBidders` 不排除任何人
 *        （`entity.owner === 0` 谁都匹配不上），于是买家名单里含卖家自己、
 *        `status[卖家] === 'active'`，开场席位就落回**卖家**身上 ——
 *        真人卖家在屏上等自己点钮、三台电脑一口不出。
 *
 * ⇒ 现在：从 slot 0 起找第一个 **`'active'` 且不是卖家** 的座位；
 *   都没有返回 **-1**（此时 `auctionFinished` 已判流标/成交，调用方不该再拿它当座位）。
 *
 * @param seller 卖家（= 待拍实体的现主，取不到就传当前行动者）的**玩家下标**；
 *   传 `-1` 表示没有卖家要排除（例如调用方确实想按纯资格排座）。
 */
export function auctionFirstSeat(
  bidders: readonly number[],
  status: readonly AuctionSeatStatus[],
  seller = -1,
): number {
  const n = bidders.length;
  for (let i = 0; i < n; i++) {
    const player = bidders[i];
    if (player === undefined || player === seller) continue;
    if ((status[player] ?? 'active') === 'active') return i;
  }
  return -1;
}

/**
 * 与待拍地块**同名**、且属于该出价者的地块数。
 *
 * @source `loc_00439f72`：`strcmp(land[i]+4, 目标+4) == 0 && land[i]+0x19 == 出价者`
 *   → `inc ebp`。★ **只有地块那一支有这一项**；設施分支（`loc_0043a071`）
 *   只数无主数，没有同名数。
 *
 * `ownerOf` 用来把「运行期归属」覆盖到模板上（调用方传 `effective*` 或状态表）。
 */
export function sameNameLandOwned(
  name: string,
  player: number,
  lands: readonly LandInfo[],
  ownerOf: (id: number, fallback: number) => number,
): number {
  let n = 0;
  for (const l of lands) {
    if (l.name !== name) continue;
    if (ownerOf(l.id, l.owner) === player + 1) n += 1;
  }
  return n;
}

/** 設施那一支的「同名数」恒为 0 —— 原版压根不数 @source loc_0043a071 没有 strcmp 段 */
export function sameNameFacilityOwned(): number {
  return 0;
}

/**
 * 每个可以出价的玩家一份**心理价位**。
 *
 * @source 入口 `0x0043c5d9` 那段：对每个「在场、出得起底价、且是电脑」的
 *   座位调一次 `fcn_00439f0d`，结果存进座位 `+8`（`[0x48c438]`）。
 *   真人座位留 0（他不是 rand 出来的价，是手点的）。
 *
 * 本函数把「算一遍」与「怎么处理各种座位类型」绑在一起，**只在开拍时算一次**。
 *
 * ⚠️ **随机源**：原版那三处是 `_libc_rand`（全局 PRNG）。本引擎**不能**在这里
 *   动 `GameState.rngState`（那会让同一局在不同端上算出不同的心理价位），
 *   故用 `seed` 派生一条**独立的** WatcomRng —— 算法位级一致，只是序列
 *   由 `seed` 决定。见 `docs/deviations/T-034.md` 的 D-T034-5（同一条口径）。
 *
 * @param seed 调用方给的确定性种子（通常由 `rngState` + 实体号派生）
 */
export function auctionAiLimits(
  entity: AuctionEntity,
  players: readonly Player[],
  bidders: readonly number[],
  seed: number,
): number[] {
  const rng = new WatcomRng(seed >>> 0);
  // ★ 这里把 15 位整数归一成 [0,1) 交给 `auctionAiLimit`（它自己再乘回 32768），
  //   是**随机数归一化**不是金额计算；原版那三处也全是浮点（`fild`/`fdiv`）。
  // eslint-disable-next-line no-restricted-syntax -- C-DET-3 的定向豁免（同上）
  const rand01 = (): number => rng.next() / 32768;
  const limits = new Array<number>(players.length).fill(0);
  for (const bidder of bidders) {
    const p = players[bidder];
    // 原版只给「可出价的电脑」算；不在场/出局者连座位都没有
    if (p === undefined || p.whoPlays === 0) continue;
    limits[bidder] = aiLimitForPlayer(entity, bidder, p, rand01);
  }
  return limits;
}

/**
 * 待拍产业的「静态属性」—— 只依赖地图与归属，不依赖竞价进度。
 *
 * 地块与設施两支的差别只有**地价字段**（`+0x1c` vs `+0x22`）与
 * 「同名地产数」那一项（只有地块数），故这里用同一张表描述。
 */
export interface AuctionEntity {
  /** 起拍价 `[0x48c488]`（= `auctionBasePrice` 的产物，已含物价指数） */
  basePrice: number;
  /** 物价指数 `[0x4990e8]` */
  priceIndex: number;
  /** 地价：地块 +0x1c、設施 +0x22 */
  landPrice: number;
  /** 等级：地块/設施的 +0x1a */
  level: number;
  /** 同一支（地块表 / 設施表）的实体总数 @source `num_lands` / `num_facilities` */
  total: number;
  /** 其中无主的条数 @source `loc_00439f72` 的 `inc edi` */
  unowned: number;
  /** 这些实体里，**与待拍者同名且属于出价者**的条数（`0x439f72` 的 `inc ebp`） */
  sameNameOwned: (player: number) => number;
}

/** 某个出价者的心理价位 —— 把 `AuctionAiInputs` 拼起来之后问 `auctionAiLimit` */
function aiLimitForPlayer(
  entity: AuctionEntity,
  bidder: number,
  p: Player,
  rand01: () => number,
): number {
  return auctionAiLimit(
    {
      level: entity.level,
      landPrice: entity.landPrice,
      // @source 0x43a131：最后夹到 `[0x496b84]` = 玩家现金（不是现金 + 存款）
      cash: p.cash,
      priceIndex: entity.priceIndex,
      basePrice: entity.basePrice,
      total: entity.total,
      unowned: entity.unowned,
      sameNameOwned: entity.sameNameOwned(bidder),
    },
    rand01,
  );
}

/** 一次出价的结果：掏多少钱（0 = PASS）以及是「放棄」还是普通 PASS */
export interface AuctionAiChoice {
  step: number;
  kind: 'raise' | 'pass' | 'giveUp';
}

/**
 * 电脑这一口出不出、出多少。
 *
 * @source 拍賣窗口的刷新循环（`_rich4_ui_auction` 的 `loc_0043c4f5` 一带）
 *   在轮到某个座位时做三件事，本函数就是这三件事：
 *   1. `0x43b10c`：`cmp 现金, 现价 / jle` → **现金 ≤ 现价就 PASS**；
 *   2. `0x43b124`：拿座位 `+8` 的心理价位挑档（`auctionAiRaise`）；
 *   3. `0x43b183`：这一口若超过「当前最高出价者现金 + 500」就压档。
 *
 * ⚠️ 第 1 条用的是**现金**而不是「现金 + 存款」（@source `+0x1c`）。
 * ⚠️ 心理价位为 0（不是电脑 / 没算过）时必然 PASS —— 与「出不起」同一条出口。
 * ★ `kind` 恒为 `'pass'`：原版 AI 那一支**只发 PASS（按钮 0）**，
 *   「放棄」是真人屏上第 7 颗钮（`ebx == 6` → `loc_0043a43a`），电脑不走。
 *   保留这个字段是为了让表现层能把两条出口分开演。
 */
export function auctionAiChoice(input: {
  /** 座位 `+8` 的心理价位（上限）；0 = 没算过 */
  limit: number;
  /** 现价 `[0x48c488]` */
  price: number;
  /** 出价者现金 `player+0x1c` */
  cash: number;
  /** 当前最高出价者的现金；还没有人出价传 null（不压档） */
  topCash: number | null;
}): AuctionAiChoice {
  const step = auctionAiRaise(input.limit, input.price, input.cash, input.topCash);
  return step > 0 ? { step, kind: 'raise' } : { step: 0, kind: 'pass' };
}

/**
 * 拍卖结束了吗；结束了就把终局判出来。
 *
 * @source `loc_0043b295` VA 0x0043b295：
 * ```asm
 * esi = 有人的座位数 ; edi = 状态 != 0 的座位数
 * if (esi == 0 || esi == edi)                  → 流標
 * if (esi - edi == 1 && [0x48c4a8] != -1)      → 成交
 * ```
 * 即：**一个能出价的都没有 → 流标；只剩最高出价者一个人能出价 → 成交。**
 * 注意 `esi == 1` 那一条是单独判的（只有一个人能出价时不必减）。
 */
export function auctionFinished(pending: {
  bidders: readonly number[];
  status: readonly AuctionSeatStatus[];
  top: number;
}): boolean {
  let active = 0;
  let blocked = 0;
  for (const i of pending.bidders) {
    const st = pending.status[i] ?? 'active';
    if (st === 'active') active += 1;
    else blocked += 1;
  }
  // esi == 0 或 esi == edi（一个能出的都没有）→ 流標
  if (active === 0) return true;
  // 只有一个人能出价：原版单独判一条 —— 而且必须**已经有人出过价**才算成交
  if (active === 1) return pending.top >= 0;
  // 其余情况看「esi − edi == 1」：只有一个能出价的、且已有人出价 → 成交
  return active - blocked === 1 && pending.top >= 0;
}

/** 终局：`winner < 0` = 流拍 */
export function auctionOutcome(pending: {
  bidders: readonly number[];
  status: readonly AuctionSeatStatus[];
  top: number;
  price: number;
  basePrice: number;
}): { winner: number; price: number } {
  if (pending.top < 0) return { winner: -1, price: 0 };
  return { winner: pending.top, price: pending.price };
}

