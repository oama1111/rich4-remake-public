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
 * 0 = 可出价，非 0 = 本轮已 PASS / 开场就被删掉。
 *
 * ★★ 2026-09-19 按 exe 订正（A8）—— 旧注释「PASS 是永久的 / 放棄写 4 /
 *   全文件没有一处写回 0」**三处都与字节相反**：
 *
 * ```asm
 * 0043a41b  test ebx, ebx / jbe 0x43a426      ; 0 = PASS
 * 0043a41f  cmp  ebx, 6 / je  0x43a43a        ; 6 = 放棄
 * 0043a426  mov  word [eax + 0x48c436], 1     ; ★ PASS 只写状态 1（**不删座位**）
 * 0043a462  mov  word [eax*4 + 0x48c434], dx  ; ★ 放棄把座位 **+0（玩家号）清 0**
 *                                             ;   —— 座位被整个摘掉，状态位一个都不写
 * 0043a6ae  xor  ebx, ebx                     ; ★★ 每一次**成功加价**之后：
 * 0043a6a9  mov  [0x48c4a8], eax              ;   最高者 ← 当前槽
 * 0043a6bb  mov  word [eax*4 + 0x48c436], si  ;   四个座位的状态**全部清 0**
 * 0043c4d3  mov  word [eax*4 + 0x48c434], si  ; 开拍前的显示循环也把非 0 状态座位
 * 0043c4e8  mov  word [eax*4 + 0x48c436], dx  ;   的 +0/+2 一起清 0（整格删掉）
 * ```
 *
 * ⇒ 准确的说法是：**PASS 只维持到下一次成功加价为止**（加价会把全场状态清零、
 *   所有人重新问一遍）；**放棄**压根不写状态，而是把座位从表里摘掉。
 *   ⚠️ 对 AI 座位而言「清零重问」**不影响结果**：心理价位在开拍时算一次就不再变
 *   （`0x43c5d0` 那一段只跑一次），而 PASS 的判据是「现价 + 100 > 心理价位」——
 *   现价只增不减，所以他下一轮必然还是 PASS。对**真人**座位则不一样：
 *   原版里他 PASS 之后别人一加价，他就又能举牌了。
 *   ⚠️ 本引擎的 `pending.status` 目前是**永久**的（`reduce.ts` 的 `auctionBid`
 *   不重置它），故真人的 PASS 在复刻里回不来 —— 已登记在报告里，待接线。
 */

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import { isAiControlled, type Player } from '../state/types.ts';
import { transferMoney, PARTY_POOL, type Company } from './payment.ts';
import { truncTowardZero } from './rounding.ts';
import { misalignedDoubleInt } from './hostility.ts';

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
  //   低 32 位 —— 取整会毁掉复刻。产出是敌意（且是垃圾值）而非金额，
  //   C-DET-3 在此定向豁免。取值统一走 `rules/hostility.ts` 的共享实现。
  // ★★ 写法必须**照 asm 的次序**、并且按 **double 精度**逐步舍入：
  //   x87 的默认精度控制字是 `0x027F`（PC = 10b = **53 位 = double**），
  //   所以 `fild A` → `fild level`/`fadd 2.0f`/`fdiv 5.0f` → `fmulp` 的每一步
  //   都舍成 double ⇒ 与 JS 的 `A * ((level + 2) / 5)` **逐位相同**。
  //   反过来写成「精确乘积 ÷ 5」（一次除法）会得到**另一个** double：
  //   实测 `A=1001, level=2` ⇒ 原版（与本式）低 32 位 = **+1717986919**，
  //   一次除法版 = +1717986918（差 1 ulp ⇒ 垃圾值差 1）。
  // eslint-disable-next-line no-restricted-syntax
  const value = (landPrice * priceIndex) * ((level + 2) / 5);
  return misalignedDoubleInt(value);
}

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
  /**
   * ★★ 得标后要写进 `landTenure[地產号]` 的**到期日**；**0 = 不写**。
   *
   * @source `0x43c788..0x43c7c9`（地產 +0x30）/ `0x43c7d3..0x43c804`（設施 +0x34）：
   * ```asm
   * 0043c77b  cmp  ebx, [esp+0x8c] / je 0x43c83b ; ★ 得标者 == 原地主 ⇒ 归属与到期日都不写
   * 0043c799  cmp  dword [0x499110], 0 / je ...  ; ★ 土地權限 = 無限期 ⇒ 不写
   * 0043c7a8  cmp  byte [land+0x19], 0 / jne ... ; ★ **原为有主** ⇒ 不写（旧主保留）
   * 0043c7ae  ebp = [eax + 0x4751f0]            ; 年限表[權限]（0x4751f0）
   * 0043c7bb  call 0x4521cb                     ; date_add(今天, 表项)
   * 0043c7c9  mov  [edx + 0x30], eax            ; 写地產到期日
   * ```
   *
   * ⚠️ 复刻原先**完全不动** tenure（`reduce.ts` 只有「買地」那一条路写），
   *   于是拍卖拿到的无主地**永不到期**。写入口在 `reduce.ts`，本文件只把
   *   「该写多少」算好放在这里 —— 见 `AuctionSettlementOptions.expiry`。
   */
  tenure: number;
}

export interface FacilityAuctionResult {
  players: Player[];
  facility: FacilityInfo;
  pool: number;
  passedIn: boolean;
  bankrupted: boolean;
  /** 同 `AuctionResult.tenure`，写进 `facilityTenure[設施号]` @source `0x43c7fe` */
  tenure: number;
}

/**
 * 落槌结算的可选输入。
 *
 * 两个字段都来自**调用点**（reducer 手上有全局态与地图表），本文件只做判定。
 */
export interface AuctionSettlementOptions {
  /**
   * ★★ **arg0** —— 发起这场拍卖的人（成交款的收款方）。
   *
   * @source `0x43c83b..0x43c855`：
   * ```asm
   * 0043c83b  push 0                     ; flags = 0（收款方进**存款**）
   * 0043c83d  mov  edx, [0x48c488]       ; 现价（落槌瞬间）
   * 0043c843  push edx
   * 0043c844  mov  ecx, [esp + 0xb4]     ; ★ arg0（= 用卡者 / 中签者）
   * 0043c84b  push ecx
   * 0043c84c  mov  eax, [esp + 0x98]     ; 得标者（1 基）
   * 0043c853  dec  eax
   * 0043c854  push eax
   * 0043c855  call 0x41d2c6              ; pay_money(得标者, arg0, 现价, 0)
   * ```
   * 五个调用点传的 arg0：拍賣卡（`0x44334e` / `0x443475`）= `[0x49910c]`
   * **当前行动者 = 用卡者**；魔法屋（`0x4324d4`）= `[0x49910c]` 中签者；
   * 新聞 7（`0x44989f`）与破产清算（`0x40d1e1`）= **`-1`** ⇒ 才是进公库。
   *
   * `-1`（或省略）= 没有卖家 ⇒ 成交款进公库（`PARTY_POOL`）。
   * ⚠️ 这个数**不是**「待拍实体的现主」：拍賣卡拍**别人的地**时卖方席位
   *   依然是**用卡者**，地主反而可以举牌把自己的地买回来（见 `eligibleBidders`）。
   */
  payee?: number;
  /**
   * ★★ 得标后应写的到期日（原版 `date_add(今天, 年限表[權限])`）。
   *
   * 调用方按 `tenureExpiry(packDate(state), state.landTenureIndex)` 算好传进来；
   * **0 = 無限期 ⇒ 不写**（原版直接拿 `[0x499110] != 0` 当闸门）。
   * 本函数再叠上「原为无主 ∧ 得标者 ≠ 原地主」两道闸门，决定结果里的 `tenure`。
   */
  expiry?: number;
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
 * ★★ 得标时的付款方向（2026-09-19 按 exe 订正，A1）：
 *   原版是 `pay_money(得标者, arg0, 现价, 0)` ⇒ 钱归**发起拍卖者**，
 *   **不是**公库。旧实现一律 `PARTY_POOL` 是错的；
 *   公库只在 `arg0 == -1`（新聞 7 / 破产清算，没有卖家席位）时才出现。
 *   `flags = 0` ⇒ 收款方进的是**存款**（`+0x20`）不是现金，且记 `+0x60` 收入。
 */
export function settleAuction(
  players: readonly Player[],
  land: LandInfo,
  outcome: AuctionOutcome,
  pool = 0,
  companies: readonly Company[] = [],
  options: AuctionSettlementOptions = {},
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
      // @source 0x43c71d：窗口返回 -1 ⇒ 直接跳过整个结算段（含到期日）
      tenure: 0,
    };
  }

  const payee = options.payee ?? -1;
  const r = transferMoney(
    players,
    companies,
    pool,
    outcome.winner,
    payee >= 0 ? payee : PARTY_POOL,
    outcome.price,
    0,
  );
  return {
    players: r.players,
    land: { ...land, owner: outcome.winner + 1 },
    pool: r.pool,
    passedIn: false,
    bankrupted: r.bankrupted,
    tenure: auctionTenureToWrite(land.owner, outcome.winner, options.expiry ?? 0),
  };
}

/**
 * 落槌与到期日两道闸门（拍卖两支共用）。
 *
 * @source 0x43c77b / 0x43c799 / 0x43c7a8（地產支；設施支 0x43c7d3 起同构）：
 * `得标者 != 原地主` ∧ `[0x499110] != 0` ∧ `原地主 == 0` 三条同时成立才写。
 * 第三条成立时第一条自动成立（得标者是 1 基 ⇒ 恒 ≥ 1 ≠ 0），此处仍照抄三条。
 */
function auctionTenureToWrite(ownerBefore: number, winner: number, expiry: number): number {
  if (ownerBefore === winner + 1) return 0; // @source 0x43c77b `je 0x43c83b`
  if (expiry === 0) return 0; // @source 0x43c799 `cmp [0x499110], 0 / je`
  if (ownerBefore !== 0) return 0; // @source 0x43c7a8 `cmp byte [land+0x19], 0 / jne`
  return expiry;
}

/**
 * 設施拍卖的结算 —— 与 `settleAuction` 同构（拍賣卡設施分支
 * VA 0x0044346c..0x0044348d：`run_auction` 返回 0（流拍）→
 * `mov byte [fac+0x19], 0` 变无主、清 +0x34 租期）。
 * 得标方向同样是**买家付款给 arg0**（`arg0 == -1` 才进公库）。
 */
export function settleFacilityAuction(
  players: readonly Player[],
  facility: FacilityInfo,
  outcome: AuctionOutcome,
  pool = 0,
  companies: readonly Company[] = [],
  options: AuctionSettlementOptions = {},
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
      tenure: 0,
    };
  }

  const payee = options.payee ?? -1;
  const r = transferMoney(
    players,
    companies,
    pool,
    outcome.winner,
    payee >= 0 ? payee : PARTY_POOL,
    outcome.price,
    0,
  );
  return {
    players: r.players,
    facility: { ...facility, owner: outcome.winner + 1 },
    pool: r.pool,
    passedIn: false,
    bankrupted: r.bankrupted,
    // @source 0x43c7fe `mov [edx + 0x34], eax` —— 設施的到期日在 +0x34
    tenure: auctionTenureToWrite(facility.owner, outcome.winner, options.expiry ?? 0),
  };
}

/**
 * 谁有资格参与竞价。
 *
 * ★★ 2026-09-19 按 exe 订正（A2）—— 原版**只**排除 `arg0`（发起拍卖者），
 *   **完全不看地主是谁**：
 *
 * @source `loc_0043c110` 建表循环（`0x43c109 mov ebp, [esp+0xac]` 先把 arg0 装进 ebp）：
 * ```asm
 * 0043c110  cmp  ebx, [0x499114] / jge 结束   ; 遍历**所有**玩家
 * 0043c11f  cmp  byte [player + 0x15], 0 / je 跳过  ; who_plays == 0（出局）不占座位
 * 0043c22a  cmp  ebx, ebp / jne 0x43c246      ; ★ 只有玩家号 == arg0 的那一位
 * 0043c23c  mov  word [座位 + 2], 7           ;   拿状态 7（绕圈永远跳过他）
 * ```
 *   ⇒ **地主可以举牌把自己的地买回来**（甚至可能「得标者 == 原地主」，
 *   原版照样让他付钱给 arg0，只是归属与到期日都不写，见 `0x43c77b`）。
 *
 * ⚠️ 复刻原先排除的是**现任地主**，与字节相反。
 * ⚠️ `seller === undefined` 走的是**过渡期的旧口径**（排除现任地主）——
 *   那是错的，只为在调用点接线前不改变既有行为；
 *   `state/reduce.ts` 的三处调用（魔法屋 / 新聞 7 / 破产清算）与
 *   `cards/registry.ts:698/716`（拍賣卡，arg0 = 用卡者）都必须把 arg0 传进来。
 *
 * ⚠️ 「现金不足是否仍可举牌」**由原版自己判**：现金 ≤ 底价那位在**建表时**
 *   就拿到状态 8（`0x43c132 cmp 现金, 底价 / jg`），等于不占座位；
 *   能出底价但后来出不起现价的，走 AI 的「放棄」（见 `auctionAiChoice`）。
 *   故此处**不做**资金过滤。
 *
 * @param seller **arg0**：发起拍卖者的玩家下标；`-1` = 没有卖方席位
 *   （新聞 7 / 破产清算，谁都可能中标）；`undefined` = 旧口径（见上）。
 */
export function eligibleBidders(
  players: readonly Player[],
  entity: { owner: number },
  seller: number | undefined = undefined,
): number[] {
  const out: number[] = [];
  for (const p of players) {
    if (p.whoPlays === 0) continue;
    if (seller === undefined) {
      // ⚠️ 过渡口径（**与 exe 相反**）：排除现任地主。接线后删掉这一支。
      if (entity.owner === p.index + 1) continue;
    } else if (p.index === seller) {
      // @source 0x43c22a `cmp ebx, ebp` —— arg0 那一格是状态 7
      continue;
    }
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
 * 原版拍卖**座位表**的布局（基址 `0x48c434`，步长 `0x14`）。
 *
 * ★★ A8 订正的正是这里的 **`+4`**：旧注释把「心理价位」记成座位 `+8`，
 *   而 `+8` 是那三张台词串的第一张。逐条 @source：
 *
 * | 偏移 | 含义 | 写点 |
 * |---|---|---|
 * | `+0x00` | 玩家号 + 1（**0 = 空槽**） | `0x43c257 mov word [esi*4+0x48c434], dx` |
 * | `+0x02` | 状态（0 = 可出价；8 = 出不起底价；7 = 卖家） | `0x43c148`…`0x43c23c` |
 * | `+0x04` | ★ **心理价位**（`0x48c438`） | `0x43c61e mov [esi+0x48c438], eax` |
 * | `+0x08` | 台词串 0（名字，`0x48c43c`） | `0x43c287` |
 * | `+0x0c` | 台词串 1（现金，`0x48c440`） | `0x43c2b4` |
 * | `+0x10` | 台词串 2（`0x48c444`） | `0x43c2e1` |
 *
 * 步长 `0x14` 的来源是 `imul eax,ebx,0x14` / `ebx*4 + ebx` 再 `*4` 两种写法。
 */
export const AUCTION_SEAT_STRIDE = 0x14;
export const AUCTION_SEAT_PLAYER_OFFSET = 0x00;
export const AUCTION_SEAT_STATUS_OFFSET = 0x02;
/** ★ 心理价位在 **+4** —— 不是 `+8`（A8） */
export const AUCTION_SEAT_LIMIT_OFFSET = 0x04;
/** 第一张台词串在 `+8`（旧注释误当成心理价位的那一格） */
export const AUCTION_SEAT_LABEL_OFFSET = 0x08;

/** PASS 按钮码 @source `0x43a41d jbe 0x43a426`（ebx == 0） */
export const AUCTION_BUTTON_PASS = 0;
/**
 * ★ 「出不起」的按钮码 = **6 = 放棄** @source `0x43b11a mov ebx, 6`。
 *
 * ⚠️ `0x43a41f cmp ebx,6 / je 0x43a43a` 那一支**不写状态**，而是把座位
 * `+0`（玩家号）清 0（`0x43a462`）—— 整个座位被摘掉。
 * 旧注释写「放棄写 4」，与字节不符（4 是加价档表的下标，不是按钮码）。
 */
export const AUCTION_BUTTON_GIVE_UP = 6;

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
 *   VA 0x0043c61e 对每个「不在场且没出过价」的电脑玩家调一次，
 *   结果存进座位表的 **`+4`**（`0x48c438`，A8 订正：旧注释写 `+8`，
 *   而 `+8` 是那三张台词串的第一张——`0x48c43c`）。两张表同构，差别只在地价字段与
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
 * if (现金 < 现价)             → PASS（0x43b11a 直接给 ebx = 6，见 auctionAiChoice）
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
 * 就拿 `room = 线 − 现价` 重挑一档。原版是**四对** `cmp/jle` + `cmp/jg`：
 * ```asm
 * 0043b1cd  cmp edi, 0x3e8  / jle 0x43b1e4   ; room <= 1000 → 试下一对
 * 0043b1d5  cmp edi, 0x1388 / jg  0x43b1e4   ; room >  5000 → 试下一对
 * 0043b1dd  mov ebx, 4                       ;   1000 < room <= 5000 → +5000
 * 0043b1e4  cmp edi, 0x1f4  / jle 0x43b1fb   ; room <=  500 → 试下一对
 * 0043b1ec  cmp edi, 0x3e8  / jg  0x43b1fb   ; room >  1000 → 试下一对
 * 0043b1f4  mov ebx, 3                       ;    500 < room <= 1000 → +1000
 * 0043b1fb  cmp edi, 0x64   / jle 0x43b20f   ; room <=  100 → 试下一对
 * 0043b200  cmp edi, 0x1f4  / jg  0x43b20f   ; room >   500 → 试下一对
 * 0043b208  mov ebx, 2                       ;    100 < room <=  500 → +500
 * 0043b20f  cmp edi, 0x64   / jg  0x43b219   ; room >   100 → ★ 档位**原样保留**
 * 0043b214  mov ebx, 1                       ;    room <=  100 → +100
 * ```
 * ⇒ **下界严格 `>`**：`room` 恰为 100 / 500 / 1000 时落的是**低一档**
 *   （room = 1000 ⇒ +1000、500 ⇒ +500、100 ⇒ +100）。`room > 5000` 时四对
 *   一个都不命中 ⇒ 档位原样保留（原版如此）。
 *   ★★ 这正是 A3：旧实现写成 `>= 1000 → 5000 / >= 500 → 1000 / >= 100 → 500`，
 *   三个边界各多出一档。
 *
 * 传 `topCash`（无最高者时传 `null`）即启用压价段。
 *
 * ⚠️ 压价那一段**只改档位、不保证结果 ≤ 最高者现金 + 500**（`room ∈ (1000,5000]`
 *   一律给 5000 档，哪怕 room 只有 1001）。照抄，别「改正」。
 *
 * ★★ A4（`0x43b219`）—— **只剩一个可出价座位时强制最小加价**：
 * ```asm
 * 0043b219  cmp  byte [0x48c4b1], 1 / jne 0x43b22b   ; 开场可出价座位数 != 1 → 不压
 * 0043b222  test ebx, ebx           / je  0x43b22b   ; PASS（0）不压
 * 0043b226  mov  ebx, 1                              ; 其余（含 6 = 放棄）一律压成 +100
 * ```
 *   `[0x48c4b1]` 是**窗口初始化**时写一次的数（`0x43a36c` 抄 `0x113` 的实参
 *   = `0x43c5d0` 显示循环数出的「状态 0 的座位数」），全场不再变 ⇒ 传
 *   `activeSeats` 时请传**开拍时**的 `'active'` 座位数（并排除卖家）。
 *   ⚠️ 原版这一段**也压 `ebx == 6`**（出不起的那一位），但那一口随后会被
 *   `0x43a478` 的 `cmp 现价+档位, 现金 / jg` 整口驳回；且「只剩 1 个可出价座位
 *   且已有人出价」时 `0x43b295` 早就判成交了，故该组合实际不可达
 *   —— `auctionAiChoice` 里照原样保留「放棄」出口，不模拟那条自锁路径。
 */
export function auctionAiRaise(
  limit: number,
  price: number,
  cash: number,
  topCash: number | null = null,
  activeSeats = 0,
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
    //   每一档的**下界都是严格 `>`**，room 恰为 100/500/1000 落低一档；
    //   room > 5000 四对全不命中 ⇒ 档位原样保留（原版如此）。
    if (room <= 100) step = 100;
    else if (room <= 500) step = 500;
    else if (room <= 1000) step = 1000;
    else if (room <= 5000) step = 5000;
  }

  // @source 0x43b219 `cmp byte [0x48c4b1], 1 / jne` + `test ebx,ebx / je` + `mov ebx,1`
  if (activeSeats === 1 && step !== 0) step = AUCTION_RAISE_STEPS[0]!;
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
 *   `'passed'` / `'givenUp'` 在**能不能出价**这件事上是同一档，但原版的两条
 *   出口差别很大（A5，按 exe 订正）：
 *   - `'passed'` = 按钮 0：`0x43a426 mov word [座位+2], 1` —— 只写状态位；
 *   - `'givenUp'` = 按钮 6：`0x43a462 mov word [座位+0], 0` —— **摘掉整个座位**
 *     （玩家号清 0），`0x43b295` 数出来的 `esi`/`edi` 都少一格。
 *   ⚠️ 本引擎目前只把它们都当「非 active」，摘座位那一步仍需 `reduce.ts` 接线。
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
 * ★ `[0x48c4b1]`：**开拍时**的可出价座位数 —— A4 的强制最小加价要它。
 *
 * @source `loc_0043c4f5` 的显示循环：状态 0 的座位每命中一个就 `inc edi`
 *   （`0x43c4f5`）；建表段收尾 `0x43c6db push edi` 把它当窗口过程第 2 实参，
 *   窗口初始化 `0x43a365` 抄进 `[0x48c4b1]`（`0x43a36c`），**此后不再变**
 *   （全 exe 只有这一个写点）⇒ `0x43b219` 判的始终是**开场**那个数。
 *
 * ★ `edi` 数的三条判据：`who_plays != 0` ∧ 不是卖家（状态 7，显示循环已删）
 *   ∧ `现金 > 底价`（`0x43c132 cmp / jg`）。本函数直接复用 `auctionSeatStatus`
 *   的口径，故只要 `bidders` 与座位表同集合（接线后就是），结果逐格相同。
 *
 * ⚠️ 必须传**开拍时**的 `basePrice` 与 `bidders`：竞价开始后现价会涨，
 *   拿涨过的现价去数就会少算（原版数的是底价那一刻的座位）。
 *
 * @param seller **arg0**（原版状态 7 那一格）；-1 = 没有卖方席位
 */
export function auctionActiveSeatCount(
  players: readonly Player[],
  bidders: readonly number[],
  basePrice: number,
  seller = -1,
): number {
  const status = auctionSeatStatus(players, bidders, basePrice);
  let n = 0;
  for (let i = 0; i < status.length; i++) {
    if (i === seller) continue; // @source 状态 7 的座位在显示循环里被删
    if (status[i] === 'active') n += 1;
  }
  return n;
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
 * @source 建表循环 VA 0x0043c5d0..0x0043c680（在 `fcn_0043bde5` 内）：
 * ```asm
 * 0043c5d0  cmp  ebx, 4 / jge 0x43c680     ; ★ 循环 4 个**座位槽**（按下标升序）
 * 0043c5e3  ax = word [ebx*20 + 0x48c434]  ; 该槽的玩家号 + 1（0 = 空槽）
 * 0043c5ea  test ax, ax / je  下一槽        ; 空槽 → **不掷**
 * 0043c5fa  test byte [player + 0x15], 6   ; ★ who_plays 的 bit1|bit2
 * 0043c601  je   0x43c624                  ;   不是电脑/托管 → **不掷**
 * 0043c603  cmp  word [ebx*20 + 0x48c436], 0
 * 0043c60b  jne  0x43c624                  ; ★ 座位状态非 0 → **不掷**
 * 0043c60d  push 实体号 / push 玩家号+1
 * 0043c616  call 0x439f0d                  ; ★ 算一次（内部开头就 call rand 一次）
 * 0043c61e  [ebx*20 + 0x48c438] = eax      ; 存心理价位
 * ```
 *
 * ★★ 四条闸门决定了**掷几次**，一条都不能少：
 *   1. 空槽不掷；
 *   2. **真人（`whoPlays & 6 == 0`）不掷** —— 他不是 rand 出来的价，是手点的；
 *   3. **座位状态非 0 的不掷** —— 建表时写下的 7（卖家）与 8（出不起底价）
 *      都在此列，而建表发生在 `0x439f0d` **之前**，所以「出不起底价」的座位
 *      心理价位停在 0；
 *   4. 顺序是**座位槽下标升序**（= 玩家下标升序）。
 *
 * ⚠️ 因此本函数**必须**知道 `status` 与 `seller`：复刻把卖家的「7」编码成了
 *   单独一个 `seller` 参数（`status` 里他是 `'active'`），不显式排除就会
 *   给他多掷一次随机数、把整条全局序列推歪。
 *
 * ⚠️ **随机源（2026-09-16 订正）**：原版这里是 `_libc_rand`（**全局** PRNG），
 *   所以开一场拍卖会**推进全局随机流**。本条曾以「怕联机两端对不上」为由
 *   改成派生种子（旧 D-T034-5），那个理由不成立：开拍在 **reducer** 里发生、
 *   两端对同一串 action 跑同一个 reducer，消费同样的次数就不会漂；
 *   而屏只读 `pending.limits`、从不重算（`client/auction-screen.ts`）。
 *   现按原版消费全局流，`rngState` 的回写由调用方（`startAuction`）负责。
 *
 * @param status 座位状态（按**玩家**下标索引）—— 只有 `'active'` 才掷
 * @param seller 卖家玩家下标（原版状态 7）；-1 = 无卖家
 * @param rand01 `rand()/32767`；**每算一家正好消费一次**
 */
export function auctionAiLimits(
  entity: AuctionEntity,
  players: readonly Player[],
  bidders: readonly number[],
  status: readonly AuctionSeatStatus[],
  seller: number,
  rand01: () => number,
): number[] {
  const limits = new Array<number>(players.length).fill(0);
  for (const bidder of bidders) {
    const p = players[bidder];
    // @source 空槽 / 出局者连座位都没有
    if (p === undefined || p.whoPlays === 0) continue;
    // @source cmp word [座+2], 0 / jne 跳过 —— 卖家(7)与出不起底价(8)都在此列
    if ((status[bidder] ?? 'active') !== 'active') continue;
    if (bidder === seller) continue;
    // @source test byte [player + 0x15], 6 / je 跳过 —— 真人那一格留 0
    if (!isAiControlled(p)) continue;
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
 *   1. `0x43b10c`：`cmp 现金, 现价 / jle` → **现金 < 现价就发按钮 6（放棄）**；
 *   2. `0x43b124`：拿座位 **`+4`**（`0x48c438`）的心理价位挑档（`auctionAiRaise`）；
 *   3. `0x43b183`：这一口若超过「当前最高出价者现金 + 500」就压档；
 *   4. `0x43b219`：开拍时可出价座位数恰为 1 时压成最小档（见 `auctionAiRaise`）。
 *
 * ⚠️ 第 1 条用的是**现金**而不是「现金 + 存款」（@source `+0x1c`）。
 * ⚠️ 心理价位为 0（不是电脑 / 没算过）时必然 PASS —— 与「出不起」**不是**
 *   同一条出口，见下。
 *
 * ★★ A5（2026-09-19 按 exe 订正）—— 旧注释写「原版 AI 那一支**只发 PASS**，
 *   放棄只有真人会按」，**与字节相反**：
 * ```asm
 * 0043b10c  mov  ecx, [0x48c488]           ; 现价
 * 0043b112  cmp  ecx, [edx + 0x496b84]     ; vs 该座位的现金
 * 0043b118  jle  0x43b124                  ; 现价 <= 现金 → 正常挑档
 * 0043b11a  mov  ebx, 6                    ; ★★ 出不起 ⇒ **代码 6 = 放棄**（不是 0）
 * 0043b11f  jmp  0x43b219
 * ```
 *   随后 `0x43a41f cmp ebx,6 / je 0x43a43a` 走「放棄」那一支，而那一支
 *   **不写状态、直接把座位 `+0`（玩家号）清 0**（`0x43a462`）——
 *   座位被整个摘掉，`0x43b295` 数出来的 `esi`/`edi` 都少一格。
 *   ⇒ 谁出不起现价，**座位就没了**（不是「先 PASS、下轮还能举」）。
 *
 *   ⚠️ 本引擎的 `pending.status` 目前把两条出口都映射成「非 active」
 *   （`reduce.ts` 的 `auctionBid`：`giveUp → 'givenUp'`、其余 → `'passed'`），
 *   而 `auctionFinished` 只数 `'active'` ⇒ **摘座位这一步还没落地**，
 *   需要 `reduce.ts` 接线（见报告）。
 */
export function auctionAiChoice(input: {
  /** 座位 **`+4`**（`0x48c438`）的心理价位（上限）；0 = 没算过 */
  limit: number;
  /** 现价 `[0x48c488]` */
  price: number;
  /** 出价者现金 `player+0x1c` */
  cash: number;
  /** 当前最高出价者的现金；还没有人出价传 null（不压档） */
  topCash: number | null;
  /**
   * ★ `[0x48c4b1]`：**开拍时**的可出价座位数（0 = 不知道 ⇒ 不启用 A4 的强制最小档）。
   * 见 `auctionAiRaise` 的 A4 说明。
   */
  activeSeats?: number;
}): AuctionAiChoice {
  // @source 0x43b112 `cmp 现价, 现金 / jle` + 0x43b11a `mov ebx, 6` —— 出不起 = 放棄
  if (input.cash < input.price) {
    // ⚠️ 原版紧接着的 0x43b219 会把 6 压成 1（+100），但 0x43a478 随后因
    //   「现价 + 100 > 现金」整口驳回 ⇒ 净效果什么都不发生；且「只剩 1 个可出价
    //   座位且已有人出价」时 0x43b295 早已判成交 ⇒ 该组合不可达。
    //   这里保留**原始按钮码**（放棄），不模拟那条自锁路径。
    return { step: 0, kind: 'giveUp' };
  }
  const step = auctionAiRaise(
    input.limit,
    input.price,
    input.cash,
    input.topCash,
    input.activeSeats ?? 0,
  );
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
  for (const i of pending.bidders) {
    if ((pending.status[i] ?? 'active') === 'active') active += 1;
  }
  // esi == 0 或 esi == edi（一个能出的都没有）→ 流標
  if (active === 0) return true;
  // 只有一个人能出价：原版单独判一条 —— 而且必须**已经有人出过价**才算成交
  if (active === 1) return pending.top >= 0;
  // ★★ 订正（第 160 条 N1）：原版这里**没有第三条成交判据**。
  // ```asm
  // 0043b2c5  test esi,esi / je 流標        ; 一个座位都没有
  // 0043b2c9  cmp  esi,edi / jne 0x43b2e6  ; 全被挡住 ⇒ 流標
  // 0043b2e6  cmp  esi,1 / je 0x43b2f6     ; ★ 只剩 1 个能出价的
  // 0043b2eb  sub  esi,edi / cmp esi,1 / jne 继续
  // 0043b2f6  cmp  dword [0x48c4a8],-1 / je 继续   ; 还没人出过价
  // ```
  //   其中 `esi` = 座位表里 `+0` 非 0 的个数、`edi` = 其中 `+2` 非 0 的个数，
  //   故 `esi − edi` **就是**「能出价的座位数」= 上面的 `active`，`esi == 1`
  //   也只是它的一个特例 —— 两条都已被前两行覆盖。
  //   ⚠️ 旧代码写 `active - blocked === 1`，实际算的是 `esi − 2·edi`：
  //   `active=2, blocked=1`（3 个座位里 1 个已 PASS）时复刻**直接落槌**，
  //   原版还会绕到下一家（`0x43b3c2`）。
  return false;
}

/**
 * 「能出价的座位一个不剩」—— 原版 `0x43b2c5..0x43b2cb` 的 `esi == edi`
 * （`esi` = 座位表 `+0` 非 0 的个数、`edi` = 其中 `+2` 非 0 的个数）。
 *
 * ★ 这个状态**排在成交判据之前**，且它自己的出口是 `0x43b2cd` 的
 * 「無人出價，宣佈流標」——**哪怕 `top` 已经有值**（有人出过价）也照样流拍，
 * 随后 `run_auction` 返回 0、调用方把地主清 0（`mov byte [land+0x19], 0`）。
 * 原版如此（C-FID：照抄，包括它看起来不讲理的地方）。
 *
 * ⚠️ 复刻的 `bidders` 里没有「卖家席位」（原版给卖家写状态 7，同时进 `esi` 与 `edi`
 * ⇒ 在 `esi − edi` 与 `esi == edi` 里**抵消**），故这里只数 `bidders` 即可。
 *
 * ★ **可达性分析**（第 161 条，回答上一轮登记的 N3）：在引擎自己的竞价循环里，
 *   这个「有人出过价 ∧ 全场都被挡住」的状态**走不到** —— 因为每一次出价之后都会复查，
 *   而 `active === 1` 且 `top >= 0` 时**当场判成交**（原版 `esi-edi == 1` 同理，
 *   它的复查也在每一次窗口刷新时跑）。要从 `top >= 0` 走到 `active == 0`，
 *   必须让「最后一个能出价的人」也 PASS，而那一步之前就已经落槌了。
 *   ⇒ 这个分支只可能由**外部塞进来的 pending**（例如读档还原的中途状态）触发。
 *   仍然照原版写（C-FID）：不因为「平时走不到」就把原版的判据删掉。
 */
export function auctionAllBlocked(pending: {
  bidders: readonly number[];
  status: readonly AuctionSeatStatus[];
}): boolean {
  if (pending.bidders.length === 0) return true;
  return pending.bidders.every((i) => (pending.status[i] ?? 'active') !== 'active');
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
  // ★★ N3（第 161 条）：原版 `0x43b2c9 cmp esi,edi / jne 0x43b2e6` 先于成交判据 ——
  //   全场座位都被挡住时**先**走到 `0x43b2cd`「無人出價，宣佈流標」，
  //   于是「有人出过价但之后所有人都 PASS/放棄」= **流拍**（地主被清 0），
  //   而不是把地判给最后一个出价的人。
  if (auctionAllBlocked(pending)) return { winner: -1, price: 0 };
  return { winner: pending.top, price: pending.price };
}

