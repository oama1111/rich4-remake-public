/*
 * 命運事件的效果
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 两阶段结构。每个事件函数入口都是：
 * ```asm
 * cmp dword [esp + 0x94], 0
 * jne 施加阶段
 * …公告阶段：算出金额存进 [0x48c5b4]，格式化提示语，显示…
 * ```
 * 即**同一个函数被调用两次**：先公告、后施加。
 * 这解释了为什么 `scan fortune all` 几乎扫不到状态写入——
 * 写入都在第二阶段跳转到的共用尾部里。
 *
 * 金额一律是 `物价指数 × factor`，系数见 `@rich4/data` 的 FORTUNE_EVENTS。
 */

import type { NoticeHint, NoticeKey, Player } from '../state/types.ts';
import type { MapNode, LandscapeInfo } from '../loaders/map.ts';
import type { MapObject } from '../cards/summon.ts';
import { isAiControlled, isAlive } from '../state/types.ts';
import { FORTUNE_EVENTS, eventAmount, fortuneEvent } from '@rich4/data';
import { PARTY_POOL, PAY_FLAG_DEBIT_FROM_BANK, receiveMoney, transferMoney } from '../rules/payment.ts';
import { receiveCard } from '../rules/receive-card.ts';
import { pickCardToSteal } from '../rules/npc-actions.ts';
import { sendToConfinement } from '../rules/confinement.ts';
import { wreckVehicle } from '../rules/object-landing.ts';
import { addMisfortuneDays } from '../rules/monthly.ts';
import { BLESSING_DOUBLE, BLESSING_VOID, blessingMultiplier } from '../rules/blessing.ts';
import { sellAllCards, sellAllTools } from '../rules/inventory.ts';
import {
  EMPTY_HOLDING,
  sellStock,
  type SellDestination,
  type StockHolding,
} from '../places/stock.ts';
import type { StockMarketState } from '../places/stock-market.ts';
// ★★ 命运这 4 条路上的「免罪卡(21) → 嫁禍卡(19)」二级判定 —— `0x441210` 只有一份实现，
//    与新聞 29 共用（见 `news-effects.ts` 的 `secondaryJudgement` 的 @source 块）。
//    不 import `rules/toll-flow.ts` 的 `aiScapegoat`：那个镜像的是 mode 1。
import { secondaryJudgement } from './news-effects.ts';

/**
 * 本模块要的随机出口：`below(n)`（挑人）+ `next()`（事件 5 抽牌）。
 * `WatcomRng` 天然满足；`news-effects.ts` 的 `EffectRng` 只有 `below`，
 * 故这里自己声明一个更宽的（避免为了一个 `next()` 去改共享类型）。
 */
type EventRng = { below(n: number): number; next(): number };

/**
 * 命運「付錢」那一族：施加阶段都落到同一条尾巴 `0x0044cec2`：
 * ```asm
 * 0044cec2  call 0x41d2c6            ; pay_money(当前玩家, -1, [0x48c5b4], 0) —— 进公库
 * 0044ced1  cmp byte [cur+0x15], 0 / je 收尾     ; 付完破產出局 ⇒ 后两步都跳过
 * 0044cede  cmp byte [0x46caf8], 0 / jne 收尾    ; 终局码非 0 ⇒ 同上
 * 0044cef9  call 0x44f42d            ; ★ 付錢台词 9/10/11（`player_say`）
 * 0044cf11  call 0x44ba63            ; ★ 保險理賠（保險期内赔回同一笔）
 * ```
 *
 * @source 各事件的施加入口（`[esp+0x94] != 0` 那一跳），`python3 tools/disasm.py va <入口> 16`：
 *   - 14 `0x0044cdab jne 0x44ce35` → `0x0044ce5d jne 0x44ce8b` → 顺落 `0x0044cec2`；
 *   - 15 `0x0044cf55` / 16 `0x0044d0a4` `jne 0x44cfdf` → `0x0044d007 jne 0x44d032`
 *     → `0x0044d057 … 0x0044d068 jmp 0x44cec2`；
 *   - 17 `0x0044d0e8` / 18 `0x0044d1b7` / 19 `0x0044d1f2` / 23 `0x0044d430` /
 *     24 `0x0044d474` / 26 `0x0044d4f9` / 30 `0x0044d606` `jne 0x44d172`
 *     → `0x0044d19a jne 0x44ce8b` → 顺落 `0x0044cec2`。
 *   神明加持返回 1（免付罰金）那一支（`0x0044ce5f` / `0x0044d009`）不付钱、改调 `0x44f567`，
 *   不在这条尾巴上。
 *
 * ★★ 第十四份試玩回報 #1 查出来的：先前 Q-INS-1 只把 `0x0044cf11` 记成「行人闖越馬路罰款（14）」
 *   一条的理赔，**漏了**另外 9 条也经过同一处 —— 保險期内抽到「付保險金 / 亂丟垃圾 / 遺失錢包…」
 *   原版同样赔回来。
 */
export const FORTUNE_PAY_TAIL_IDS: ReadonlySet<number> = new Set([14, 15, 16, 17, 18, 19, 23, 24, 26, 30]);

/** 命運 2「人頭被盜用冒貸」—— 施加完 `0x0044c218 call 0x44ba63`（保險理賠），**没有**台词 */
export const FORTUNE_FAKE_LOAN_ID = 2;

/**
 * ★ 第十四份：命運「進帳」那一族：施加阶段都落到 `0x0044d2a9`（`fcn_0044b896(0,0)` 獎金域）——
 *   返回 1 ⇒ 弹「獎金作廢」框、`0x0044d2e5 jmp 0x44d3d1` 一分不给；否则（2 则先 ×2，`0x0044d309`）
 *   `0x0044d31f call 0x41d3f4` 进现金 → **`0x0044d334 call 0x44f354`**（進帳台词 6/7/8）。
 * @source 各自的施加入口 `jne 0x44d2a9`：20 `0x0044d235` / 21 `0x0044d34c` / 22 `0x0044d3ec` /
 *   25 `0x0044d4b7` / 27 `0x0044d53c` / 28 `0x0044d57f` / 29 `0x0044d5c2` / 31 `0x0044d647`。
 */
export const FORTUNE_GIVE_TAIL_IDS: ReadonlySet<number> = new Set([20, 21, 22, 25, 27, 28, 29, 31]);

/**
 * ★ 第十四份：神明加持返回 **2** 时**也弹框**的那几条（其余几条的调用方只在返回 1 时弹）。
 *
 * @source 逐个调用方（`python3 tools/disasm.py va <地址> 40`）：
 *   - 弹：2 `0x0044c1cb`、6 `0x0044c6a3`、7 `0x0044c7b5`、12/13 `0x0044cd1f`（13 是跳板进 12）、
 *     14 `0x0044ce95`、15/16 `0x0044d03c`、17/18/19/23/24/26/30 `0x0044ce95`（经 `0x44d172`）、
 *     20/21/22/25/27/28/29/31 `0x0044d2f4`、33..36 `0x0044d887`（34..36 是跳板进 33）；
 *   - 不弹（调用方只 `cmp eax,1`）：3 `0x0044c28d`、8 `0x0044c881`、9 `0x0044c997`、
 *     10 `0x0044cab0`、11 `0x0044cbcb`、32 `0x0044d6ef`。
 *   返回 1 时**每一条**都弹。
 */
const BLESSING_DOUBLE_NOTICE_SILENT: ReadonlySet<number> = new Set([3, 8, 9, 10, 11, 32]);

/** 命運坐牢那一族（33 与跳板 34/35/36）：被神明挡掉时说事件 0 @source `0x0044d862 mov ecx,[… + 0x48084a]` / `0x0044d873` */
const FORTUNE_PRISON_IDS: ReadonlySet<number> = new Set([33, 34, 35, 36]);

/**
 * ★ 第十四份：命運施加阶段那一扇**神明加持**框（`fcn_0044b896` 写 `[0x48c5b8]`，调用方 `0x440cac(…, 0x5dc)`）。
 *   不弹返回 null。`say` 是框之后紧跟的那一句：
 *   - 罰款尾巴那一族免付（返回 1）⇒ `0x0044ce7e` / `0x0044d028 call 0x44f567(当前玩家, 原额)`（12/13/14）；
 *   - 坐牢那一族逃过（返回 1）⇒ `0x0044d873 player_say(当前玩家, 0, 事件 0)`。
 *   `godName` = `[0x47ed76 + god_info*4]`。
 */
export function fortuneBlessingNotice(
  id: number,
  kind: 'reward' | 'penalty' | 'misfortune',
  level: number,
  godName: string,
  player: number,
  baseAmount: number,
): NoticeHint | null {
  if (level !== BLESSING_VOID && level !== BLESSING_DOUBLE) return null;
  if (level === BLESSING_DOUBLE && BLESSING_DOUBLE_NOTICE_SILENT.has(id)) return null;
  const voided = level === BLESSING_VOID;
  const key: NoticeKey =
    kind === 'reward'
      ? voided ? 'blessing.rewardVoid' : 'blessing.rewardDouble'
      : kind === 'penalty'
        ? voided ? 'blessing.penaltyVoid' : 'blessing.penaltyDouble'
        : voided ? 'blessing.misfortuneVoid' : 'blessing.misfortuneDouble';
  // ★ 框在影片（入獄 / 住院）之前：`0x0044d88c call 0x440cac` 之后才 `0x441210` → `send_to_prison`
  const notice: NoticeHint = { key, args: [godName], beforeFilms: true };
  if (voided && FORTUNE_PAY_TAIL_IDS.has(id)) return { ...notice, say: { player, reliefAmount: baseAmount } };
  if (voided && FORTUNE_PRISON_IDS.has(id)) return { ...notice, say: { player, event: 0 } };
  return notice;
}

/**
 * 金额倍率档位 —— 转发 `rules/blessing.ts` 的定义。
 *
 * @source 施加阶段先 `call 0x44b896` 取档位，`2` 加倍、`1` 归零。
 * 档位由玩家的神明加持值（+0x46）决定，详见 rules/blessing.ts。
 *
 * ★ 先前只实现了「2 → 加倍」，**漏掉了「1 → 归零」**。
 *   四条提示语（獎金加倍／獎金作廢／罰金加倍／免付罰金）表明
 *   它是完整的三档倍率，不是一个布尔开关。
 */
export const DOUBLE_AMOUNT = BLESSING_DOUBLE;

/**
 * 支票跳票后银行拒绝往来的天数。
 * @source `add byte [player + 0x3b], 0x1e`（VA 0x0044c2ba）——0x1e = 30。
 * ★ 事件文案写作「一個月」，这里得到了确切数值。
 */
export const BANK_BAN_DAYS = 30;

/** 事件 6「強迫出國觀光%d天」 */
export const FORTUNE_TRIP_ABROAD = 6;
/** 事件 7「被外星人綁架%d天」 */
export const FORTUNE_ABDUCTED = 7;
/**
 * `days_disappearing`(`+0x33`) 里「原因」那 2 位 —— 低 6 位是天数。
 * @source `fcn_0040d375`（`rich4_player_utils.asm:189`）：`al = 原因 << 6; ah = 天数; or ah, al`
 */
export const DISAPPEAR_REASON_ABROAD = 0;
export const DISAPPEAR_REASON_ABDUCTED = 1;
/** 事件 8「股票違約交割損失股票%d％」 */
export const FORTUNE_STOCK_DEFAULT = 8;
/** 事件 9「變賣所有股票求現」 */
export const FORTUNE_STOCK_LIQUIDATE = 9;
/** 事件 10「機車被偷遺失」 */
export const FORTUNE_MOTORCYCLE_STOLEN = 10;
/** 事件 11「汽車撞電線桿全毀」 */
export const FORTUNE_CAR_WRECKED = 11;
/** 事件 32「變賣所有卡片道具」 */
export const FORTUNE_SELL_ALL_ITEMS = 32;
/**
 * 事件 0「強制拆除房屋一棟」 / 事件 1「強制徵收土地一處」。
 *
 * @source `0x0044be16` / `0x0044bfb1`，规格见
 *   `rich4-spec/docs/systems/fortune.md:363-443`（含 asm 与「精确规则」）。
 *   两条都属于 `factor: null` 那一族 ⇒ 先前在 `applyFortuneEffect` 里**直接早退成
 *   `unimplemented`**，一格地都没动过（第九份试玩回报 #6 的「完全没看到拆了哪里的房子」
 *   就是这个：不是表现层看不见，而是**根本没拆**）。
 */
export const FORTUNE_DEMOLISH_HOUSE = 0;
/** 事件 1「強制徵收土地一處」（未开发的那一块，同一条族） */
export const FORTUNE_CONFISCATE_LAND = 1;
/** 事件 4「侵入銀行電腦」@source 0x0044c2d4 `mov ecx, 0xa` → `[0x48c5b0]` */
export const FORTUNE_BANK_HACK = 4;
export const FORTUNE_BANK_HACK_PCT = 10;
/** 事件 8 的百分比字面量 @source 事件表 `literal: 10` */
export const FORTUNE_STOCK_DEFAULT_PCT = 10;
/** 事件 8 的除数 @source `fdiv dword [0x465a24]` = 100.0 */
export const FORTUNE_STOCK_PCT_SCALE = 100;

/**
 * 这两条事件的神明闸门：`fcn_0044b896` 返回 **1** 就整个挡掉
 * （「逃過此劫／免付罰金」那句由表现层放）。
 *
 * @source `fcn_0044c7ef` / `fcn_0044c91f` 的 `cmp eax, 1 / jne 继续`；
 *   10/11 同构。**注意不是 `blessingMultiplier`**：这几条只用「是不是 1」，
 *   档位 2 与 0 走同一条路（照常执行）。
 */
function cancelledByBlessing(ctx: FortuneEffectContext): boolean {
  return (ctx.multiplier ?? 0) === BLESSING_VOID;
}

export interface FortuneEffectResult {
  players: Player[];
  /**
   * 物件表 —— **只有**坐牢／住院事件（首次关押）会把它换掉：跟班神明之类的
   * 物件要跟着玩家搬进监狱／医院格（`@source 0x43d668 call 0x40fc00`）。
   * 其余事件是入参原样。
   */
  objects: MapObject[];
  /**
   * 卖股票之后当前玩家那一条持仓（与入参同下标）；没卖就是入参原样。
   * @source 事件 8/9 的 `rich4_sell_stock`（VA 0x00428e23）
   */
  holdings: StockHolding[] | null;
  /** 卖股票要动的行情（可流通股回补）——没卖就是入参原样 */
  market: StockMarketState | null;
  /** 车辆被毁要还回商店库存的道具表（下标 = 道具号）；没动就是入参原样 */
  toolStock: number[] | null;
  /** 变卖道具/手牌后的道具表（`tools[player*15+id]`）；没动就是 null */
  tools: number[] | null;
  /** 变卖手牌后的卡片库存（下标 = 卡片 id − 1）；没动就是 null */
  cardAmount: number[] | null;
  /**
   * 变卖手牌与道具得到的**點券** —— 只有事件 32 用得到
   * （破产清算那一支把返回值丢掉了）。
   */
  points: number;
  /**
   * 卖掉过股票的股票号 —— 调用方要对这几个跑一次
   * `_rich4_update_commercial_owner`（`rich4_sell_stock` 的尾巴）。
   */
  reown: number[];
  /**
   * ★ 事件尾巴的**特別融資收回** `fcn_00436b0a(0)`。
   *
   * 只有事件 **8**（股票違約交割）与 **9**（變賣所有股票求現）有这一句
   * （@source `rich4_fortune.asm` 的两处 `push 0 / call 0x436b0a`）。
   */
  recallFinance: boolean;
  /**
   * 神明加持把这一条整个挡掉了（`fcn_0044b896(...) == 1` 那一支）
   * —— 表现层要放「逃過此劫／免付罰金」那句（`fcn_00440cac`）。
   */
  cancelled: boolean;
  /** 公库余额 */
  pool: number;
  /**
   * 监狱占用表（`0x496b30`，8 槽）。
   *
   * ★★ 2026 本轮起**两张分开给** —— 与 `news-effects.ts` 2026-09-17 的同一处修复同因：
   *   先前 ctx 只有一个 `occupancy`，调用方一律传 `prisonOccupancy`，
   *   于是「命運 住院」会把病人记进**监狱**表（`0x496b30`），
   *   而医院表（`0x496b60`）永远空着 ⇒ 医院永远显示没人、床位统计全错。
   */
  prisonOccupancy: number[];
  /** 医院占用表（`0x496b60`，8 槽） */
  hospitalOccupancy: number[];
  /** 实际动用的金额（已含倍率） */
  amount: number;
  /** 是否有人因此破产 */
  bankrupted: boolean;
  /** 未实现的事件在此标记，便于上层降级处理 */
  unimplemented: boolean;
  /**
   * ★ 本次被拆 / 被征收的那一块地 —— 表现层要用它**把镜头移过去**并说那句倒霉台词。
   *
   * @source 原版 `0x0044bee8 call 0x41d476`（`update_player_info_window(x, y, 2)`，
   *   镜头移到这块地）→ `0x0044bf51 call 0x41d476(0,0,1)`（复位）→
   *   `0x0044bf5e call 0x4528b9`（sleep 300）→
   *   `0x0044bf9f call 0x44ef41`（`player_say(cur, 2, 台词[rand()&1])`）。
   *
   * 调用方据此把 `landLevel[landId]` / `landType[landId]` 清 0（**owner 不变**）。
   * `null` = 本次没拆任何东西。
   */
  demolished: { landId: number; x: number; y: number; payout: number; kind: 'demolish' | 'confiscate' } | null;
  /**
   * ★ 命運 5「生日收卡」**寿星是真人**时要挂出去的分帧信息：还没处理的座位
   *   （升序）。非 `null` 表示「这次一位都没收，等上层把这些人逐个问完」
   *   —— 见 `docs/deviations/T-055.md` 与 `state/reduce.ts` 的 `answerBirthdayCard`。
   *   `null` = 本次没有分帧（电脑当寿星那一支照旧当场收完）。
   */
  birthdaySeats: number[] | null;
  /**
   * ★★「免罪 21 / 嫁禍 19」二级判定之后**真正挨罚的人**（`0x441210` 的返回值）。
   *
   * 只有**坐牢／住院／出國·綁架**这三类事件带它 —— 也就是原版那 4 个
   * `call 0x441210` 的命運调用点；被判定者 = `ctx.currentPlayer`。
   *
   * - `null` = 没走二级判定（其余事件），或**免罪卡命中整条作废**（`eax == -1`）；
   * - `= currentPlayer` = 没卡 / 真人放弃转嫁 / 嫁祸无人可嫁（`0x441259 je`）；
   * - `≠ currentPlayer` = 嫁禍成功，替死鬼是这位。
   *
   * ⚠️ 调用方**必须**拿它去跑 `insureConfinement` —— 原版的保險理赔
   *   （`0x43d749` 在 `send_to_prison`／`0x43edf8` 在 `send_to_hospital`
   *   **函数体内**）关谁赔谁，与新聞 29 的 `chairmanPrison.victim` 同一口径。
   */
  fortuneVictim: number | null;
  /**
   * ★ 2026-09-23：命運 5「生日收卡」**电脑寿星**当场收的每一张（按收的顺序）——
   *   `fcn_0044192a` 电脑支每收一张弹一扇「搶得%s的\n\n%s」（`0x00441ab1`，1500 ms），调用方据此弹框。
   *   其余事件为 `undefined`。
   */
  robbed?: { victim: number; card: number }[];
}

/**
 * 事件 0/1 需要的那几个地块字段。
 *
 * 取 `MapTopology.lands` 即可（`loaders/map.ts` 的 `LandInfo` 是它的超集）；
 * 单独列一条接口是为了让**这个模块**不必知道地图的类型，也方便单测直接造。
 */
export interface FortuneEffectLand {
  /** 0 基地块下标（= 原版 `land_index`） */
  id: number;
  /** 1 基所有权（0 = 无主）；原版 `+0x19` */
  owner: number;
  /** 已开发等级；原版 `+0x1a`。0 = 空地 */
  level: number;
  /** 房屋单价；原版 `+0x1e`（uint16），赔款 = level × 它，**不乘物價指數** */
  housePrice: number;
  /**
   * 地价；原版 `+0x1c`（uint16）—— 事件 1「強制徵收」的补偿额（`0x0044c0ba mov ax, word [ebx+0x1c]`），
   * **不乘物價指數**。缺省按 0 算（老单测）。
   */
  landPrice?: number;
  /** 屏幕坐标 —— 表现层要把镜头移过去（`0x41d476` 收的就是这两个） */
  x: number;
  y: number;
}

export interface FortuneEffectContext {
  players: readonly Player[];
  /** 当前玩家的持仓（事件 8/9 要卖）—— 缺省表示没有股票 */
  holdings?: readonly StockHolding[];
  /** 股市行情（卖出价与可流通股）*/
  market?: StockMarketState;
  /** 全局道具库存（事件 10/11 把车还回去）*/
  toolStock?: number[];
  /** 当前玩家的道具表（事件 32 要全卖）`tools[player*15+id]` */
  tools?: number[];
  /** 卡片库存（事件 32 卖手牌要还回去），下标 = 卡片 id − 1 */
  cardAmount?: number[];
  /**
   * 事件 8/9 卖股票的去向。
   * @source 事件 8 的 `push 0`（进公库）、事件 9 的 `push 1`（进存款）。
   */
  sellDestination?: SellDestination;
  /**
   * 引擎随机出口。
   *
   * 两处用得到：
   *  · 事件 5「生日收卡」电脑那一支要 `rand() % 手牌数` 抽一张；
   *  · `0x441210` 的**嫁祸挑人**（`0x40d31c`）—— 只在「受害者是电脑、
   *    持 19、且没有最恨的人」时才真的掷一格。
   *
   * 缺省时：事件 5 报 `unimplemented`（照旧），而嫁祸挑人那一支按
   * **「无人可嫁」**处理（`−1`，19 留在手里）—— 那是给不关心随机的单元测试用的；
   * 引擎调用点（`reduce.ts`）必须传。
   * 传的必须是 `state.rngState` 装出来的那条流（C-DET-4）。
   */
  rng?: EventRng;
  currentPlayer: number;
  priceIndex: number;
  pool?: number;
  /** 监狱占用表（缺省全 0）；住院事件用的是下面那张 */
  prisonOccupancy?: readonly number[];
  /** 医院占用表（缺省全 0） */
  hospitalOccupancy?: readonly number[];
  /**
   * 物件表 + 节点表 —— **只在劫难类事件（坐牢／住院）用**：
   * 原版 `send_to_prison`/`send_to_hospital` 的函数体内含「传送到监狱／医院格 +
   * 跟班搬家」（`@source 0x43d601`..`0x43d674`），故首次关押时玩家会被挪走。
   * 缺省（不传）时**不传送**，只写计数 —— 那是给不关心盘面位置的单元测试用的；
   * 引擎调用点（`reduce.ts`）**必须**传。
   */
  objects?: readonly MapObject[];
  nodes?: readonly MapNode[];
  /** 特殊景观表（首次关押的屏幕坐标取它）—— 见 `rules/confinement.ts` */
  landscapes?: readonly LandscapeInfo[] | undefined;
  /**
   * ★ 地块表 —— **只在事件 0/1（強制拆除 / 強制徵收）用**。
   *
   * 事件 0/1 要按「owner == 当前玩家 且 level != 0」逐块筛候选，再 `rand() % 候选数`
   * 抽一块出来（@source `0x0044be49..0x0044be7a`）。缺省（不传）时这两条报
   * `unimplemented` —— 那是给不关心盘面的单元测试用的；引擎调用点（`reduce.ts`）
   * **必须**传。
   */
  lands?: readonly FortuneEffectLand[] | undefined;
  /**
   * `0x44b896` 返回的**倍率档位**：2 加倍、1 归零、0 不变。
   * 由玩家的神明加持值决定，见 rules/blessing.ts 的 blessingLevel()。
   */
  multiplier?: number;
  /**
   * 覆盖坐牢／住院天数。通常**不必给**——天数已在事件表的 `literal` 里
   * （公告阶段 `mov [0x48c5b4], imm` 的字面常量）。
   */
  days?: number;
}

/** 靠**事件号**分派、而不是靠 `effects` 那几条（见 `applyFortuneEffect` 的注释） */
export const FORTUNE_SPECIAL_IDS: readonly number[] = [
  FORTUNE_STOCK_DEFAULT,
  FORTUNE_STOCK_LIQUIDATE,
  FORTUNE_MOTORCYCLE_STOLEN,
  FORTUNE_CAR_WRECKED,
  FORTUNE_SELL_ALL_ITEMS,
];

/**
 * 本模块已实现效果的命運事件编号。
 *
 * ★ 2026-09-17 补齐：先前只列了「`factor != null` 且 pay/give」那一类，
 *   于是**按事件号分派**的那些（8/9 卖股票、10/11 丢车、32 变卖卡片道具）与
 *   坐牢/住院/冒貸/拒絕往來/出國觀光那几条**一个都没登记**（表里 `effects` 为空，
 *   靠 id 分派是命运这一支的写法）—— 一个消费者都没有的登记表，容易误导复核。
 */
export const IMPLEMENTED_FORTUNE_IDS: readonly number[] = FORTUNE_EVENTS.filter(
  (e) =>
    e.effects.includes('pay') ||
    e.effects.includes('give') ||
    e.effects.includes('prison') ||
    e.effects.includes('hospital') ||
    e.effects.includes('loan') ||
    e.effects.includes('bankBan') ||
    e.effects.includes('disappear') ||
    e.effects.includes('birthdayCard') ||
    FORTUNE_SPECIAL_IDS.includes(e.id),
).map((e) => e.id);


/**
 * 施加一个命運事件的效果（第二阶段）。
 *
 * 目前实现的是**纯金额**事件（罚款／捡钱／中奖／保险），它们占了
 * 命運表里最大的一块，且效果完全由 `factor` 与方向决定。
 *
 * ★ 两个方向**不对称**，这是照搬而非简化：
 * - `pay`  → `transferMoney(current, PARTY_POOL, 金额, 0)`
 *            现金不够会动存款，两者都空则破产
 * - `give` → `receiveMoney(current, 金额)` 直接加现金，不可能破产
 *
 * 坐牢（33..36）与住院（12/13）走 `confine`，天数取自事件表的 `literal`：
 * 酒醉大鬧 3 天、防礙風化 5 天、走私毒品 7 天、販賣大補帖 9 天；
 * 就醫与住院各 3 天。
 */
export function applyFortuneEffect(
  eventId: number,
  ctx: FortuneEffectContext,
): FortuneEffectResult {
  const players = [...ctx.players];
  let objects: MapObject[] = [...(ctx.objects ?? [])];
  const pool = ctx.pool ?? 0;
  const prisonOccupancy = [...(ctx.prisonOccupancy ?? new Array<number>(8).fill(0))];
  const hospitalOccupancy = [...(ctx.hospitalOccupancy ?? new Array<number>(8).fill(0))];
  const base: FortuneEffectResult = {
    players,
    objects,
    holdings: null,
    market: null,
    toolStock: null,
    tools: null,
    cardAmount: null,
    points: 0,
    reown: [],
    recallFinance: false,
    cancelled: false,
    pool,
    prisonOccupancy,
    hospitalOccupancy,
    amount: 0,
    bankrupted: false,
    unimplemented: false,
    // ★ 事件 0/1 才填（`null` = 本次没拆任何东西）
    demolished: null,
    birthdaySeats: null,
    // ★ 缺省 null = 本次没走「免罪 21 → 嫁禍 19」的二级判定
    //   （或免罪卡命中、整条作废）—— 只有坐牢/住院/出國·綁架那三条会填。
    fortuneVictim: null,
  };

  const entry = fortuneEvent(eventId);
  if (entry === undefined) return { ...base, unimplemented: true };

  const amount = eventAmount(entry, ctx.priceIndex) * blessingMultiplier(ctx.multiplier ?? 0);

  if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
    // 天数取自事件表的 literal（公告阶段写进 [0x48c5b4] 的字面常量）
    const raw = ctx.days ?? entry.literal;
    if (raw === null || raw === undefined) return { ...base, unimplemented: true };
    // ★ 神明加持：劫难那一支（`fcn_0044b896(1,1)`）
    //   @source `fcn_0044c5d8` 的 `cmp ecx, 1 / je 放「逃過此劫」并返回`、
    //     `cmp ecx, 2 / jne … / add [0x48c5b4], [0x48c5b4]`（天数翻倍）
    const mult = blessingMultiplier(ctx.multiplier ?? 0);
    if (mult === 0) return { ...base, cancelled: true };
    // ★★★ 2026-09-19：二级判定必须**在神明闸门之后**、**在 send_to_* 之前**。
    //   原版的次序是 `44b896`（神明）→ `440cac`（放台词）→ `441210`（免罪/嫁禍）
    //   —— 档位 1「逃過此劫」那一支在 `0x44ccfc/0x44cd0d`（命運 12）就直接跳尾声，
    //   **碰都不碰** `0x441210`，故那时手里的 21/19 一张都不会被扣。
    //   @source 4 个调用点：命運 7 `0x44c6c5`、命運 8 `0x44c7d7`、
    //     命運 12 `0x44cd41`、命運 33 `0x44d8a9`（后两处后接 `0x43ec3f` / `0x43d593`）；
    //     这 4 处的 `0x44476a` 第二参（mode）**都是 0**（`push 0 / push 0 / push esi`）。
    //   免罪 21 命中 ⇒ 整条作废；嫁禍 19 命中 ⇒ 换人（换的是 `send_to_*` 的目标）。
    //   没给随机出口（老单元测试）⇒ 原样直落本人。
    const judged =
      ctx.rng === undefined
        ? null
        : secondaryJudgement(players, ctx.currentPlayer, ctx.rng);
    if (judged !== null && judged.kind === 'absolution') {
      // `0x44122f mov eax,-1` ⇒ 各调用点 `cmp eax,-1 / je 尾声`：整条作废
      //（连 `send_to_*` 都不调，也不放第二句台词）。免罪卡已在判定里扣掉。
      return { ...base, players: [...judged.players], amount: 0 };
    }
    const players2 = judged === null ? players : [...judged.players];
    const victim = judged === null ? ctx.currentPlayer : judged.victim;
    const days = raw * mult;
    const kind = entry.effects.includes('prison') ? 'prison' : 'hospital';
    // ★ 目标表按 kind 取；**另一张**交给 confine 的 `otherOccupancy` 去清
    //   —— 原版首次关押时 `0x40d761` 会把"当前非 0 的那一张"清掉
    //   （`cmp [+0x34] / cmp [+0x35]` 两道闸）。此前 fortune 这条路**既**传错表
    //   **也**没传另一张。
    const occ = kind === 'prison' ? prisonOccupancy : hospitalOccupancy;
    const other = kind === 'prison' ? hospitalOccupancy : prisonOccupancy;
    // ★★ 2026-09-24（provenance 审计）：住院那两条（12/13）在送醫院**之前**先毁车：
    //   `0x0044cd54 push eax / call 0x40cd07`（替死鬼 / 本人）→ `0x0044cd65 call 0x43ec3f`。
    //   坐牢（33..36，`0x44d8a9 → 0x44d8c2`）没有这一句。先前漏了 ⇒「騎機車摔傷」住完院车还在。
    let toolStock: number[] | null = null;
    let playersIn = players2;
    if (kind === 'hospital') {
      const v = players2[victim];
      if (v !== undefined && isAlive(v)) {
        const stock = [...(ctx.toolStock ?? [])];
        const w = { ...v };
        if (wreckVehicle(w, stock)) {
          toolStock = stock;
          playersIn = players2.map((q, i) => (i === victim ? w : q));
        }
      }
    }
    const out = sendToConfinement(
      playersIn,
      objects,
      ctx.nodes ?? [],
      occ,
      kind,
      victim,
      days,
      other,
      ctx.landscapes,
      // ★ 首次关押的倒霉台词 4..6 天掷一次 rand（`0x0043d5f9` / `0x0043eca5 call 0x44f2c2`）——
      //   在二级判定（`0x441210`）之后、同一条随机流（cards 审计 cross-area (a)）
      ctx.rng,
    );
    objects = out.objects;
    return {
      ...base,
      players: out.players,
      objects: out.objects,
      prisonOccupancy: kind === 'prison' ? out.occupancy : (out.otherOccupancy ?? prisonOccupancy),
      hospitalOccupancy: kind === 'hospital' ? out.occupancy : (out.otherOccupancy ?? hospitalOccupancy),
      amount: days,
      fortuneVictim: victim,
      ...(toolStock === null ? {} : { toolStock }),
    };
  }

  // ── 命運 5：今天是你生日 向每人收取一張卡片 ─────────────────────
  //   @source `fcn_0044c3b7`：逐人筛（不是自己 / 没出局 / 手上有牌）；
  //   电脑当寿星时 `player_drop_random_card(对方)`（0x441e77 —— 与本引擎
  //   `pickCardToSteal` 是**同一个 exe 函数**）→ `receive_card(自己)`（0x4412e4，
  //   满手先弃最便宜的一张、弃牌回牌堆 —— `rules/receive-card.ts`）。
  //   ★ 真人那条原版弹**选牌窗**（`fcn_0044192a` 模式 0）—— 那一窗本引擎已经有了
  //     （`client/src/steal-picker.ts`，T-053）；因为它是**模态、逐个问**的，
  //     这里对真人寿星**分帧**（见下），电脑寿星照旧当场收完。
  if (entry.effects.includes('birthdayCard')) {
    // ── 寿星是**真人**：原版对每一位合格的人各弹一次模态选牌窗 ────────────
    //   @source `fcn_0044c3b7`（`rich4_fortune.asm:541`）的循环体：
    //   `mov dl, byte [eax + 0x496b7d]`（**寿星的** whoPlays）`cmp dl, 1 / jbe`
    //   → 真人这一支 `call fcn_0044192a(对方, 寿星, 0)`（模式 0 = 只有卡片欄）。
    //   ⇒ 本引擎分帧：这里**一位都不收**，把筛出来的座位挂成待决交互，
    //     由客户端逐个问（见 `state/reduce.ts` 的 `answerBirthdayCard`）。
    //     ⚠️ 不能在这里当场随机抽 —— 那是**电脑寿星**那一支的行为。
    const giver = players[ctx.currentPlayer];
    if (giver === undefined) return { ...base, unimplemented: true };
    if (!isAiControlled(giver)) {
      const seats: number[] = [];
      for (let i = 0; i < players.length; i++) {
        if (i === ctx.currentPlayer) continue;
        const other = players[i];
        if (other === undefined || !isAlive(other) || other.cards.length === 0) continue;
        seats.push(i);
      }
      // `edi`（原版那个计数）对**每个合格的人**都 +1，与挑没挑到无关
      if (seats.length === 0) return { ...base, amount: 0 };
      return { ...base, amount: seats.length, birthdaySeats: seats };
    }
    const rng = ctx.rng;
    if (rng === undefined) return { ...base, unimplemented: true };
    const next = [...players];
    const deck = [...(ctx.cardAmount ?? new Array<number>(30).fill(0))];
    let taken = 0;
    const robbed: { victim: number; card: number }[] = [];
    for (let i = 0; i < next.length; i++) {
      if (i === ctx.currentPlayer) continue;
      const other = next[i];
      if (other === undefined || !isAlive(other) || other.cards.length === 0) continue;
      const card = pickCardToSteal(other.cards, rng);
      if (card === null) continue;
      const hand = [...other.cards];
      hand.splice(hand.indexOf(card), 1);
      next[i] = { ...other, cards: hand };
      // ★★ 2026-09-24（provenance 审计）：牌堆计数 —— `0x441e77` 移除用的是 `0x441343`
      //   （尾 `0x004413a2 inc byte [卡+0x499197]`：**这张先回牌堆**），`0x4412e4` 收下时再 −1，
      //   满手弃掉的那张也回牌堆。先前只动手牌 ⇒ 寿星满手时弃牌凭空消失。
      deck[card - 1] = ((deck[card - 1] ?? 0) + 1) & 0xff;
      const me = next[ctx.currentPlayer];
      if (me !== undefined) {
        const got = receiveCard(me, card, deck);
        deck.splice(0, deck.length, ...got.cardAmount);
        next[ctx.currentPlayer] = got.player;
      }
      robbed.push({ victim: i, card });
      taken++;
    }
    return { ...base, players: next, amount: taken, robbed, cardAmount: deck };
  }

  // ── 命運 6/7：強迫出國觀光 / 被外星人綁架 ───────────────────────
  //   @source `fcn_0044c5d8`（6）/ `fcn_0044c6ed`（7）的施加阶段尾部：
  //   `fcn_0040d375(玩家, 天数, 原因)` ⇒ `blocking.disappearing = 天数 | (原因 << 6)`；
  //   调用前两处各有一次 `fcn_00441210(玩家)`（6 在 `0x44c6c5`、
  //   7 在 `0x44c7d7`，两者共用 `0x44c6d8` 起的同一段尾巴）。
  //   ★ 已经在外的人是**续期**（`0x0040d4c5`：`(旧 & 0x3f) + 打包值`），见下。
  //   ★ 神明加持与坐牢同一支：档位 1 → 逃過此劫（整条作废）、档位 2 → 天数翻倍。
  if (entry.effects.includes('disappear')) {
    const raw = ctx.days ?? entry.literal;
    if (raw === null || raw === undefined) return { ...base, unimplemented: true };
    const mult = blessingMultiplier(ctx.multiplier ?? 0);
    if (mult === 0) return { ...base, cancelled: true };
    const me = players[ctx.currentPlayer];
    if (me === undefined) return { ...base, unimplemented: true };
    // ★★ 二级判定（`0x441210`）在**「已经在外」那道闸之前**：
    //   `0x44c6be mov edi,[0x49910c] / push edi / call 0x441210` 先跑，
    //   「已经在外」的 `cmp [+0x33],0 / jne` 在它**后面**的 `0x40d375` 里。
    //   ⇒ 持 21/19 的人在这一条上照样扣卡（与坐牢/住院同一段共享尾巴）。
    // ★ 先跑二级判定（`0x441210`）：免罪 21 命中 ⇒ 整条作废；嫁禍 19 命中 ⇒ 换人。
    //   没给随机出口 ⇒ 原样直落本人。
    const judged =
      ctx.rng === undefined
        ? null
        : secondaryJudgement(players, ctx.currentPlayer, ctx.rng);
    if (judged !== null && judged.kind === 'absolution') {
      // `0x44122f mov eax,-1` ⇒ `cmp eax,-1 / je 尾声`：连 `0x40d375` 都不调。
      return { ...base, players: [...judged.players], amount: 0 };
    }
    const players2 = judged === null ? players : [...judged.players];
    const victim = judged === null ? ctx.currentPlayer : judged.victim;
    const target = players2[victim];
    if (target === undefined) return { ...base, players: players2, unimplemented: true };
    const days = raw * mult;
    const reason =
      eventId === FORTUNE_ABDUCTED ? DISAPPEAR_REASON_ABDUCTED : DISAPPEAR_REASON_ABROAD;
    if (target.blocking.disappearing !== 0) {
      // ★★ 2026-09-24（provenance 审计）：已经在外的人是**续期**，不是跳过：
      // ```asm
      // 0040d38e  al = 原因 << 6 / ah = 天数 | al / [esp] = ah      ; 打包值（字节）
      // 0040d39e  ah = [+0x33] / test ah,ah / jne 0x40d4c5
      // 0040d4c5  dl = ah & 0x3f / dh = dl + [esp] / [+0x33] = dh    ; ★ (旧 & 0x3f) + 打包值
      // ```
      //   这一支**只写这一个字节**：不清别的计数、不说台词、不理赔、不加倒楣天数 ⇒ `amount: 0`
      //   让调用方跳过台词与理赔。嫁禍的替死鬼可能正在国外（最恨的人 `0x40d2d3` 只看 `+0x15`）。
      const packed = ((days & 0xff) | (reason << 6)) & 0xff;
      const next = players2.map((q, i) =>
        i === victim
          ? { ...q, blocking: { ...q.blocking, disappearing: ((q.blocking.disappearing & 0x3f) + packed) & 0xff } }
          : q,
      );
      return { ...base, players: next, amount: 0, fortuneVictim: victim };
    }
    // ★★ 首次「消失」时原版会先 `call 0x40d761(player)`（@source 0x0040d3ad，
    //   在 `cmp byte [+0x33],0 / jne 出去` 之后）—— 也就是与坐牢/住院首次同一段收尾：
    //     · `[+0x34] != 0` ⇒ 清**监狱**占用表那一格
    //     · `[+0x35] != 0` ⇒ 清**医院**占用表那一格
    //     · `dword [+0x32] = 0` ⇒ 四个计数器一起清
    //   然后调用方再写 `disappearing`（本函数这里就是"调用方"）。
    //   差分证据：`rich4-spec/tests/test_confinement_release.py`（15/15）。
    //   此前 remake 只写 `disappearing` ⇒ 「住院中被綁架」会**同时**留在医院
    //   （`inHospital` 不清、医院床位不清），那张床再也放不出来。
    const meBlocking = target.blocking;
    const nextPrison = [...prisonOccupancy];
    const nextHospital = [...hospitalOccupancy];
    if (meBlocking.inPrison !== 0) nextPrison[victim] = 0;
    if (meBlocking.inHospital !== 0) nextHospital[victim] = 0;
    const next = players2.map((q, i) =>
      i === victim
        ? addMisfortuneDays(
            {
              ...q,
              blocking: {
                ...q.blocking,
                inHotel: 0,
                inPrison: 0,
                inHospital: 0,
                disappearing: (days & 0x3f) | (reason << 6),
              },
            },
            days,
          )
        : q,
    );
    return {
      ...base,
      players: next,
      prisonOccupancy: nextPrison,
      hospitalOccupancy: nextHospital,
      amount: days,
      fortuneVictim: victim,
    };
  }

  // ★ 冒貸：直接给 loan 加钱，不经任何付款通道
  // @source add dword [player + 0x24], edx（VA 0x0044c1fa）
  if (entry.effects.includes('loan')) {
    const p = players[ctx.currentPlayer];
    if (p === undefined) return { ...base, unimplemented: true };
    const next = players.map((q, i) =>
      i === ctx.currentPlayer ? { ...q, loan: q.loan + amount } : q,
    );
    return { ...base, players: next, amount };
  }

  // ── 事件 8/9：卖股票（以及 8/9 尾巴上的特別融資收回）────────────────
  // @source `fcn_0044c7ef`（8）/ `fcn_0044c91f`（9）的施加阶段：
  // ```
  // call 0x44b896(...)                      ; 神明加持
  // cmp [0x48c5b0], 1 / je 取消并放「逃過此劫」那句
  // 事件 8：for (i = 0; i < 12; i++) {       ; 每支按 literal% 卖掉
  //            shares = trunc(持仓 × literal / 100.0)
  //            rich4_sell_stock(player, i, shares, 0)     ; ★ 0 = 进公库
  //          }
  // 事件 9：for (i = 0; i < 12; i++) {       ; 全部卖掉
  //            if (持仓 == 0) continue
  //            rich4_sell_stock(player, i, 持仓, 1)       ; ★ 1 = 进存款
  //          }
  // push 0 / call 0x436b0a                  ; ★ 收回特別融資
  // ```
  if (eventId === FORTUNE_STOCK_DEFAULT || eventId === FORTUNE_STOCK_LIQUIDATE) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const market = ctx.market;
    const held = ctx.holdings;
    if (market === undefined || held === undefined) return { ...base, unimplemented: true };
    const pct = FORTUNE_STOCK_DEFAULT_PCT;
    const destination: SellDestination = ctx.sellDestination ?? 'pool';
    let player = players[ctx.currentPlayer] ?? undefined;
    if (player === undefined) return { ...base, unimplemented: true };
    const row = [...held];
    const stocks = [...market.stocks];
    const reown: number[] = [];
    // 事件 8 的卖出所得进**公库**（`sellStock` 只负责改持仓与行情，
    // 公库那一笔由调用方加 —— 与破产清算 `liquidateStocks` 同一约定）
    let toPool = 0;
    for (let i = 0; i < stocks.length; i++) {
      const h = row[i] ?? EMPTY_HOLDING;
      if (h.amount <= 0) continue;
      // 事件 8 按百分比（`literal` = 10 ⇒ 10%），事件 9 全部
      const shares =
        eventId === FORTUNE_STOCK_DEFAULT
          ? Math.trunc((h.amount * pct) / FORTUNE_STOCK_PCT_SCALE)
          : h.amount;
      if (shares <= 0) continue;
      const r = sellStock(player, h, stocks[i]!, shares, destination);
      player = r.player;
      if (destination === 'pool') toPool += r.amount;
      row[i] = r.holding;
      stocks[i] = r.stock;
      reown.push(i);
    }
    const nextPlayers = players.map((q, i) => (i === ctx.currentPlayer ? player! : q));
    return {
      ...base,
      players: nextPlayers,
      pool: pool + toPool,
      holdings: row,
      market: { ...market, stocks },
      reown,
      // ★ 事件 8/9 的尾巴：`push 0 / call 0x436b0a`
      recallFinance: true,
    };
  }

  // ── 事件 10/11：座驾被偷 / 撞毁 ────────────────────────────────
  // @source `fcn_0044ca46`（10，機車）/ `fcn_0044cb53`（11，汽車）：
  // ```
  // call 0x44b896(1, 1) / cmp [0x48c5b0], 1 / je 取消
  // player+0x11 = 0        ; traffic_method 归零（徒步）
  // player+0x12 = 1        ; ndices = 1（一颗骰子）
  // update_player_sprite
  // inc byte [0x497324]    ; ★ 事件 10：機車 回商店库存（道具 5）
  // inc byte [0x497325]    ; ★ 事件 11：汽車 回商店库存（道具 6）
  // ```
  // ⚠️ **原版不看当前座驾是什么**：开著汽車抽到「機車被偷」照样把
  //    `traffic_method` 清零、并把**機車**库存 +1。这是原版的既定行为，
  //    本引擎照抄（登记在 known-deviations 的 Q-FORTUNE-1）。
  if (eventId === FORTUNE_MOTORCYCLE_STOLEN || eventId === FORTUNE_CAR_WRECKED) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const player = players[ctx.currentPlayer];
    if (player === undefined) return { ...base, unimplemented: true };
    const tool = eventId === FORTUNE_MOTORCYCLE_STOLEN ? 5 : 6; // 機車 / 汽車
    const stock = [...(ctx.toolStock ?? [])];
    stock[tool] = (stock[tool] ?? 0) + 1;
    const nextPlayers = players.map((q, i) =>
      i === ctx.currentPlayer ? { ...q, trafficMethod: 0, ndices: 1 } : q,
    );
    return { ...base, players: nextPlayers, toolStock: stock };
  }

  // ── 事件 32「變賣所有卡片道具」──────────────────────────────
  // @source `fcn_0044d677` 的施加阶段：
  // ```
  // call 0x44b896(1,1) / cmp [0x48c5b0],1 / je 取消       ; 神明挡掉
  // call _rich4_player_sell_all_tools(player)
  // add word [player+0x30], ax                            ; ★ 所得进**點券**
  // call _rich4_player_sell_all_the_card(player)
  // add word [player+0x30], ax                            ; ★ 第二笔也进點券
  // update_player_info_window / player_say
  // ```
  if (eventId === FORTUNE_SELL_ALL_ITEMS) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const player = players[ctx.currentPlayer];
    if (player === undefined) return { ...base, unimplemented: true };
    const a = sellAllTools(player, ctx.tools ?? [], ctx.toolStock ?? []);
    const b = sellAllCards(a.player, ctx.cardAmount ?? []);
    const nextPlayers = players.map((q, i) => (i === ctx.currentPlayer ? b.player : q));
    return {
      ...base,
      players: nextPlayers,
      tools: a.tools,
      toolStock: a.toolStock,
      cardAmount: b.cardAmount,
      // 原版是 `add word`（16 位）；本引擎的點券一直是普通数值，不额外截断
      points: a.points + b.points,
    };
  }

  // ★ 支票跳票：银行拒绝往来 30 天
  // @source add byte [player + 0x3b], 0x1e（VA 0x0044c2ba）
  // ★★ 2026-09-24（provenance 审计）：
  //   `0x0044c27c push 1 / push 0 / call 0x44b896`（罰金档）→ `0x0044c28d cmp eax,1 / jne` ——
  //   档位 1 弹「免付」框后 `ret`，**不加天数**；档位 2 不加倍（只有 1 被判）。
  //   `add byte` ⇒ 8 位回绕。先前两样都没有。
  if (entry.effects.includes('bankBan')) {
    if (cancelledByBlessing(ctx)) return { ...base, cancelled: true };
    const next = players.map((q, i) =>
      i === ctx.currentPlayer
        ? { ...q, daysRejectedByBank: (q.daysRejectedByBank + BANK_BAN_DAYS) & 0xff }
        : q,
    );
    return { ...base, players: next };
  }

  // ── 事件 4「侵入銀行電腦 挪用其他人存款10％」──────────────────────
  // ★★ 2026-09-24（provenance 审计）：先前 `factor: null` ⇒ 落到下面的 unimplemented，**什么都不发生**。
  // ```asm
  // 0044c342  fild [0x48c5b0](=10) / fdiv dword [0x4659a0](100.0f) / fstp dword  ; ★ float32 0.1
  // 0044c357  for (ebx = 0; ebx < 人数; ebx++)
  // 0044c365    跳过自己；0044c36c who_plays == 0 跳过；0044c375 存款 == 0 跳过
  // 0044c37e    amt = trunc(存款 × 0.1f)       ; fild / fmul dword / 0x457dbc 截断 / fistp
  // 0044c397    pay_money(ebx → cur, amt, 4)    ; ★ flags 4：先扣**存款**；4&1==0 ⇒ 进收款方**存款**
  // ```
  //   没有神明加持、没有台词、没有理赔。
  if (eventId === FORTUNE_BANK_HACK) {
    const rate = Math.fround(Math.fround(FORTUNE_BANK_HACK_PCT) / Math.fround(100));
    let cur = players;
    let curPool = pool;
    let total = 0;
    let anyBankrupt = false;
    for (let i = 0; i < cur.length; i++) {
      if (i === ctx.currentPlayer) continue;
      const q = cur[i];
      if (q === undefined || !isAlive(q) || q.moneyInBank === 0) continue;
      const amt = Math.trunc(q.moneyInBank * rate);
      const r = transferMoney(cur, [], curPool, i, ctx.currentPlayer, amt, PAY_FLAG_DEBIT_FROM_BANK);
      cur = r.players;
      curPool = r.pool;
      total += r.paid;
      anyBankrupt = anyBankrupt || r.bankrupted;
    }
    return { ...base, players: [...cur], pool: curPool, amount: total, bankrupted: anyBankrupt };
  }

  // ── 事件 0/1：強制拆除房屋一棟 / 強制徵收土地一處 ──
  //
  // ★★ 第九份試玩回報 #6（Charles，2026-09-22）：
  //   「强制拆除房屋一栋，完全没看到到底拆了哪里的房子，如果是真的拆了，
  //     那房屋主人应该也会触发一个倒霉的台词」。
  //   查證結果：**根本沒拆** —— 這兩條 `factor: null`，先前在下面那句
  //   `if (entry.factor === null) return unimplemented` 直接早退（`effects:['give']`
  //   也救不了，因為早退在它前面）。所以「沒看到拆哪裡」不是表現層的問題。
  //
  // @source `0x0044be16`（事件 0）/ `0x0044bfb1`（事件 1）；
  //   规格与 asm 见 `rich4-spec/docs/systems/fortune.md:363-443`（「精确规则」）：
  //     候选 = { land i | owner == current_player+1 且 level != 0 }   （事件 1 是 level == 0）
  //     选中 = 候选[rand() % |候选|]
  //     赔款 = level × house_price（uint16，**不乘物價指數**）
  //     add_money(current_player, 赔款, 1)  → 进现金
  //     sel.level = 0 ; sel.type = 0        → ★ owner **不动**（拆完还是自己的空地）
  if (eventId === FORTUNE_DEMOLISH_HOUSE || eventId === FORTUNE_CONFISCATE_LAND) {
    const lands = ctx.lands;
    const rng = ctx.rng;
    // 不给盘面或不给随机流 ⇒ 照旧报未实现（单测的缺省口径）
    if (lands === undefined || rng === undefined) return { ...base, unimplemented: true };
    // 只认**住宅**用地（原版 `0x498e84` 那一张表），不含设施。
    const wantDeveloped = eventId === FORTUNE_DEMOLISH_HOUSE;
    const candidates = lands.filter(
      (l) => l.owner === ctx.currentPlayer + 1 && (l.level !== 0) === wantDeveloped,
    );
    // 候选空：原版这里是 `idiv 0`（除零）。调用点 `events/fortune.ts` 的可行性判定
    //   已经保证非空 ⇒ 真走到这儿说明有人绕过了判定；按「不生效」收口，不崩。
    if (candidates.length === 0) return { ...base, unimplemented: true };
    // ★★ 消耗点的次序说明（C-DET-1/4）：
    //   原版这一次 `rand()` 在 **pass 0**（`0x0044be65`，訊息框**之前**），
    //   而写状态（赔款 / 清 level/type / 镜头）在 pass 1（`0x0044becf` 起）。
    //   本模块是「一次算完」，把消耗点放在**选地这一刻**、且在本次事件任何其它
    //   随机消耗之前 —— 与 pass 0 在同一位置上。若日后有人在它前面再加一条吃随机
    //   的分支，必须重新核对次序。
    //   ⚠️ 另有**第二处** `rand()`：台词二选一 `台词[rand()&1]`（`0x0044bf86`）在
    //      `player_say` 的实参里。本引擎的台词不走 core（由客户端探测器选），
    //      故那一次**没有**照抄 —— 这是有意偏离，登记在 PR 描述里。
    const pick = candidates[rng.below(candidates.length)] ?? candidates[0]!;
    // ★★ 2026-09-24（provenance 审计）：两条事件**写的东西不同**，先前按事件 0 一律处理：
    //   事件 0 `0x0044bf1e..0x0044bf42`：`add_money(cur, level(u8) × word[+0x1e], 1)` → `+0x1a = 0`、`+0x18 = 0`
    //   事件 1 `0x0044c0b6..0x0044c0d2`：`add_money(cur, word[+0x1c], 1)`（**地价**）→ `+0x19 = 0`（owner）、
    //     `dword [+0x30] = 0`（地契到期日）；等级 / 种类一个字不碰。
    //   ⇒ 先前事件 1 赔 `0 × 房价 = 0`、地还是自己的 —— 「徵收」什么都没收走。
    const confiscate = eventId === FORTUNE_CONFISCATE_LAND;
    const payout = confiscate ? (pick.landPrice ?? 0) & 0xffff : pick.level * pick.housePrice;
    return {
      ...base,
      players: receiveMoney(players, ctx.currentPlayer, payout),
      amount: payout,
      demolished: { landId: pick.id, x: pick.x, y: pick.y, payout, kind: confiscate ? 'confiscate' : 'demolish' },
    };
  }

  if (entry.factor === null) return { ...base, unimplemented: true };

  if (entry.effects.includes('pay')) {
    const r = transferMoney(players, [], pool, ctx.currentPlayer, PARTY_POOL, amount, 0);
    return {
      ...base,
      players: r.players,
      pool: r.pool,
      amount: r.paid,
      bankrupted: r.bankrupted,
    };
  }

  if (entry.effects.includes('give')) {
    return {
      ...base,
      players: receiveMoney(players, ctx.currentPlayer, amount),
      amount,
    };
  }

  return { ...base, unimplemented: true };
}
