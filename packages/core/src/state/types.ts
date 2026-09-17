/*
 * 游戏状态定义
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * C-ARC-1：零依赖。C-DET-3：金额一律整数。
 * C-ARC-4：状态里**不记录「谁是本地玩家」**——本地/远程/AI 的差异只体现在
 *          action 的来源，不影响规则执行。这是联机免改造的前提。
 */

import type { GameMode } from '../rng/policy.ts';
import type { EventDeck } from '../events/deck.ts';
import type { PendingInteraction } from '../rules/interaction.ts';
import type { StockMarketState } from '../places/stock-market.ts';
import type { StockHolding } from '../places/stock.ts';
import type { CommercialOwnership } from '../places/commercial.ts';
import type { Listing } from '../places/notice-board.ts';
import type { MapObject } from '../cards/summon.ts';
import type { SpecialActor } from '../rules/special-actors.ts';
import type { WinConditions } from '../rules/setup.ts';
import type { VictoryOutcome } from '../rules/victory.ts';

// ============================================================
//  玩家控制方式
// ============================================================

/**
 * `who_plays` 字段的位含义。
 * @source rich4-re/asm/rich4_player_info.h:
 *   「低2比特 0: not alive, 1: human, 2: computer；比特2为1表示被托管」
 */
export const WHO_PLAYS_MASK = 0x03;
export const WHO_PLAYS_DEAD = 0;
export const WHO_PLAYS_HUMAN = 1;
export const WHO_PLAYS_COMPUTER = 2;
/** 托管：由 AI 代打，即使是人类玩家 */
export const WHO_PLAYS_AUTOPILOT = 0x04;
/**
 * 比特 4/5：原版在回合开始时用 `test byte[+0x15], 0x30` 检测，
 * 命中则跳过常规流程直接走子。**语义待确认**。
 * @source rich4.asm:6573 (fcn_0040c912)
 */
export const WHO_PLAYS_SPECIAL_MASK = 0x30;

// ============================================================
//  玩家
// ============================================================

/**
 * 阻碍类天数计数器。
 *
 * ⚠️ 原版这些字节的**高位是标志位**，不是纯计数：
 * 显示剩余天数时做 `(value & 0x7f) + 1`（`days_disappearing` 用 `& 0x3f`）。
 * @source rich4.asm:6596-6604、6640-6648 等处的 `and al,0x7f` / `inc eax`
 */
export interface BlockingDays {
  /** 住宿中 @source player_info +0x32 */
  inHotel: number;
  /** 消失中 @source +0x33，掩码 0x3f */
  disappearing: number;
  /** 坐牢中 @source +0x34 */
  inPrison: number;
  /** 住院中 @source +0x35 */
  inHospital: number;
  /** 冬眠中 @source +0x36 */
  sleeping: number;
  /** 梦游中 @source +0x37 —— 不阻碍回合，但会自动走子 */
  sleepWalking: number;
  /** 停留中 @source +0x38 days_stopping —— 停留卡设为 1 */
  stopping: number;
  /** 乌龟行走中 @source +0x39 days_tortoise_walking */
  tortoiseWalking: number;
}

export interface Player {
  index: number;
  /** 角色编号 0..11 */
  character: number;
  /** 见 WHO_PLAYS_* 常量 */
  whoPlays: number;
  /** 屏幕坐标 X @source player_info +0x08（冬眠卡以 xpos==0 判定跳过） */
  xpos: number;
  /** 屏幕坐标 Y @source player_info +0x0a */
  ypos: number;
  /** 所在地图节点号（1 基） */
  nodeId: number;
  /** 上一个节点号，用于判定前进方向 */
  lastNodeId: number;
  direction: number;
  /** 移动方式 @source player_info +0x11 traffic_method（新聞事件 16/17 依此筛选） */
  trafficMethod: number;
  /** 骰子数 1..3 */
  ndices: number;
  /**
   * 性别。@source player_info +0x14 `sex`，**非 0 是男、0 是女**。
   *
   * ★ 编码由魔法屋的两条目标筛选器独立印证：
   *   `所有男生` 要求 `cmp byte [+0x14], 0 / je 跳过`（非 0 才收），
   *   `所有女生` 反之（VA 0x00431c02 / 0x00431c31）。
   *
   * 取自角色表（`@rich4/data` 的 `isFemale`），开局定下就不再变——
   * 破产的 `memset(player + 0x1c, 0, 0x4c)` 够不着它。
   */
  isMale: boolean;
  /**
   * AI 能力位。@source player_info +0x16（角色表的 `f22`）。
   * bit0 会用卡、bit1 会用道具，见 `ai/personality.ts`。
   */
  aiFlags: number;
  /**
   * 現金 ↔ 存款比例，百分比。@source player_info +0x19（角色表的 `f25` = `initCashRatio`）。
   *
   * 开局按它分配现金/存款（见 `rules/setup.ts`），之后由**託管AI 屏**编辑
   * （`docs/original-screens.md` S3 的第一个滑块，VA 0x0041e602 的 `tbl[n][4] = +0x19`）。
   *
   * ⚠️ **目前没有任何规则读它**：原版拿它决定「到银行时多少放存款」，本引擎未实现
   *   该行为（见 known-deviations 的 Q-BANK-3）。所以现在它是个**纯设置值**，
   *   屏上调得动、存档存得住，但不影响 AI 决策。
   */
  cashRatio: number;
  /**
   * 借贷激进度，百分比。@source player_info +0x18（角色表的 `f24`）。
   * 到银行时 `loan = trunc(身家 × 该值 / 100)`。0 表示从不借。
   */
  loanRatio: number;
  /**
   * 炒股比例，百分比。@source player_info +0x1a（角色表的 `f26`）。
   * 0 表示从不碰股票。
   */
  stockRatio: number;
  /**
   * **個性**：0 乖寶寶 / 1 普通人 / 2 大老奸。
   * @source player_info +0x17（角色表的 `f23`）
   *
   * ★ 名字来自**原版实机截图**：「託管AI」对话框上这三档就印着
   *   `個 性：乖寶寶 / 普通人 / 大老奸`（见 docs/original-screens.md 的 S3）。
   *   先前本字段叫 `bailStyle`（「保釋倾向」）—— 那是**以偏概全**：
   *   保釋只是受它管的行为之一。
   *
   * ★ 它在 exe 里是一条**通用闸门**（VA 0x0041e69e）：每个 AI 行为在
   *   `0x47fdf1` 表里有个「所需个性」，差一档时 1/3 概率做、差两档以上
   *   从不做。即「乖寶寶只做温良的事，大老奸什么都做」。
   *   那张表尚未翻译，见 known-deviations 的 Q-AI-2。
   *
   * 目前唯一接上的消费者是監獄/醫院的保釋选择
   *   （VA 0x0043d3ee / 0x0043ea9a），见 `rules/visit.ts` 的 `BAIL_STYLE`。
   */
  personality: number;
  /** 现金，可为负 @source player_info +0x1c (int32) */
  cash: number;
  /** 银行存款（含特别融资） */
  moneyInBank: number;
  loan: number;
  /** 特别融资 @source player_info +0x28 special_finance */
  specialFinance: number;
  /**
   * 還款到期日（打包成 `日 | 月<<8 | 年<<16`），0 表示没欠款。
   *
   * ★ 语义已查明（原先标着 TODO）：
   * ```asm
   * ; VA 0x00433b88 —— 借款时定日子
   * if (player.f44 == 0) {
   *     player.f44 = add_days(今天, 0x5a)      ; ★ 借款后 90 天
   *     while (isHoliday(player.f44)) 往后顺延 ; 到期日不落在假日上
   * }
   * ; VA 0x00433bea —— 还清时清零
   * ```
   * 界面上那句「距還款日%d天」（串 0x00464a74）用的就是它。
   *
   * ★ 它还是 **AI 炒股的一道闸**：距到期日不足 15 天就不进股市
   *   （@source VA 0x0042bf5d `date_diff(今天, 到期日) < 0xf` → 直接返回）。
   */
  loanDueDate: number;
  points: number;
  blocking: BlockingDays;
  /** 被银行拒绝放贷的剩余天数 @source player_info +0x3b days_rejected_by_bank */
  daysRejectedByBank: number;
  /**
   * 「銀行暫停放款」剩余天数 @source player_info +0x3c（先前未名，Q-TURN-1）。
   * 新聞 #171「銀行擠兌停止放款１５天」把**所有在场玩家**的这一项写成 15（0x0044aeb6..0x0044aed2）；
   * 銀行屏据此拒贷并显示「銀行暫停放款 還剩%d天」（0x004351ce，`(+0x3c & 0x7f) + 1`）；
   * 与其它计数一样每輪递减、到 0 挂 0x80、下一輪清零（0x0041cbb8 / 0x0041caba）。
   */
  bankFreezeDays: number;
  /**
   * 附身的神明 —— 存的是**物件下标 + 1**，0 表示无。
   * @source player_info +0x3f
   * 真正的神明种类在 `objects_info[godInfo - 1].type`（见 rules/objects.ts）
   */
  godInfo: number;
  /**
   * 另一个物件引用槽 —— 同样是**物件下标 + 1**。
   * @source player_info +0x40（h 文件名为 f64）
   * 送神符与破产流程都会把它传给 remove_object。
   */
  f64: number;
  /** 手牌（卡片 id，1 基） */
  cards: number[];
  /**
   * ⚠️ **已废弃**，保留仅为兼容尚未迁移的调用方。
   *
   * 道具在原版里是**全局数组** `[0x0049915b]`（步长 15/人），
   * 不在玩家结构体内——与手牌 `rich4_player_cards` 同理。
   * 正确的读写走 `GameState.tools` 与 `rules/tools.ts`。
   */
  tools: number[];
  /** 冬眠天数累计 @source player_info +0x42 total_winter_sleep_days */
  totalWinterSleepDays: number;
  /** 同盟对象：0 表示无，否则为玩家 index + 1 */
  alliedPlayer: number;
  alliedDays: number;
  /**
   * 保險期剩余天数 @source player_info +0x3e（save.ts 叫 daysAssurance）。
   * 踩保險公司投保 `+= 天数 & 0x7f`（0x0041ac74），每日 −1、归零挂 0x80（0x0041cc4b）；
   * 非 0 时意外損失由保險公司理賠（0x0044ba63）。截图 S7/S10 的「保險期 N天」就是它。
   */
  insuranceDays: number;
  /**
   * 梦游前的交通方式，醒来后据此恢复。
   * @source player_info +0x66（`mov byte [p+0x66], dl` VA 0x0044437f）
   */
  savedTrafficMethod: number;
  /**
   * 梦游前的骰子数。
   * @source player_info +0x67（VA 0x0044438b）
   */
  savedNdices: number;
  /**
   * **衰運**，有符号 16 位。@source player_info +0x44
   *
   * 唯一的读者是 VA 0x00437d6a —— AI 的身家估值里加了 `衰運 × 10`：
   * `值 = 本月支出 − 本月收入 + 冬眠天数 × 物价指数 × 2500 + 衰運 × 10`。
   * 除此之外全局再无读取点，故它**不直接影响任何规则数值**，
   * 只改变 AI 眼中谁更「值得下手」。
   *
   * 由神明附身／离身增减，见 `rules/objects.ts` 的 `GOD_MODIFIERS`。
   */
  misfortune: number;
  /**
   * **財運**，有符号 16 位。@source player_info +0x46
   *
   * 决定新聞／命運事件**獎金与罰金**的倍率（见 rules/blessing.ts）：
   * `> 100` 必定翻档、`50..100` 一半概率、`< 0` 反向。
   *
   * ★ 增减来源已定位：**神明附身／离身**，见 `rules/objects.ts`
   *   的 `GOD_MODIFIERS`。全局只有 VA 0x0040e205（减）与
   *   0x0040ebec（加）两条写指令，都在那一对函数里。
   *
   * ⚠️ 旧名 `blessing`。改名是因为现在三项齐了
   *   （衰運/財運/福運），只留一个含糊的「加持值」会分不清谁是谁。
   */
  fortune: number;
  /**
   * **福運**，有符号 16 位。@source player_info +0x48
   *
   * 与 `fortune` 同一套阈值，但走 `blessing_level(1, …)` 那条分支，
   * 提示语是「倒霉加倍！／逃過此劫！」。由福神系与衰神系增减。
   */
  luck: number;
  /**
   * 对其他玩家的敌意，4 项，下标 = 对方玩家 index。
   * @source player_info +0x4c（`[a*0x68 + b*4 + 0x496bb4]`），下限 0、无上限
   * 更新走 rules/hostility.ts 的 updateHostility（VA 0x0040df69）。
   */
  hostility: number[];
  /**
   * 本月支出累计 @source player_info +0x5c（`add [player*0x68 + 0x496bc4], ebx`）
   *
   * ★ 这两个字段修正了 `rich4-re/asm/rich4_player_info.h` 的错误：
   * 它把这一段记成 `hostility[6]`，实为 `hostility[4]` + 本月支出/收入。
   * 佐证来自 `pay_money`（VA 0x0041d2c6）对二者的读写——见 rules/payment.ts。
   */
  monthlyPaid: number;
  /** 本月收入累计 @source player_info +0x60（`add [player*0x68 + 0x496bc8], ebx`） */
  monthlyReceived: number;
}

// ============================================================
//  回合阶段
// ============================================================

/**
 * 回合推进到哪一步。
 *
 * 原版用玩家状态机 `byte[0x498ea2 + player*0x34]` 配合 4 路跳表驱动
 * （@source rich4_player_utils.asm:566 fcn_0040d7c4，跳表 @0x40d7b4）。
 * 此处改为显式枚举，语义等价但可读。
 */
export type TurnPhase =
  /** 回合开始，尚未判定是否可行动 */
  | 'turnStart'
  /** 等待当前玩家决定掷骰（可先用卡/道具/买卖股票） */
  | 'awaitingRoll'
  /** 已掷骰，正在逐步移动 */
  | 'moving'
  /** 抵达落点，等待结算 */
  | 'settling'
  /** 落点需要玩家决策（买地/盖房等） */
  | 'awaitingDecision'
  /** 回合结束 */
  | 'turnEnd'
  /** 对局结束 */
  | 'gameOver';

// ============================================================
//  对局状态
// ============================================================

/**
 * 一个替身**这一趟**走过的格子 —— `runNpc` / `runDoll` 的 `path` 原样（含起点）。
 *
 * ★ 纯表现：只在 `GameState.lastNpcWalks` 这个提示字段里出现，
 *   渲染器拿它逐格起补间（`client/render.ts` 的 `ActorWalk` 同形）。
 *   `slot` = actor − 4（0..3 四大惡人，4 機器娃娃）。
 */
export interface NpcWalkHint {
  slot: number;
  /** 依次经过的节点号，含起点；`path[i] → path[i+1]` 是第 i 格 */
  path: number[];
}

export interface GameState {
  mode: GameMode;
  /** PRNG 内部状态。单机存档不持久化此字段（见 rng/policy.ts） */
  rngState: number;

  /** 地图编号 `gameStage * 4 + gameMap`，0..7 */
  globalMapId: number;
  /** 游戏内日期 */
  day: number;
  month: number;
  year: number;

  players: Player[];
  /** 当前行动玩家的下标 */
  currentPlayer: number;
  phase: TurnPhase;

  /** 物价指数 @source player_core_actions 的 _rich4_price_index */
  priceIndex: number;

  /**
   * 本局**选中的开局资金档位** @source 全局 `_rich4_game_initial_fund` `[0x49908c]`。
   *
   * ★ 为什么必须进状态：它不只是「发多少钱」—— 有两处**规则**直接读它：
   *   1. `update_price_index`（VA 0x00423acf）拿它当除数：
   *      `fild 全体身家 / fild [0x49908c]` ⇒ **档位越小、通胀越快**，
   *      它是难度旋钮（见 `rules/wealth.ts`）；
   *   2. AI 买地的保留额 `aiShouldPurchase(player, price, [0x49908c], priceIndex)`
   *      （= 开局资金 × 5%，见 `rules/purchase.ts`）。
   *
   * ⚠️ 先前这两处都硬编码 `DEFAULT_INITIAL_FUND`（30 万）—— 玩家在开局設定
   *   选 3 万档时，通胀与 AI 门槛仍按 30 万算。2026-09-16 起改读本字段。
   *
   * 取值是 `rules/setup.ts` 的 `GAME_INITIAL_FUNDS` 之一。
   */
  initialFund: number;

  /**
   * 開局的「土地權限」档位 0..5（無限期 / 2年 / 1年 / 6個月 / 3個月 / 1個月）。
   * @source `[0x499110]`（開局 `mov [0x499110], [0x46cb48]`，VA 0x00407373）；
   *   買地/買設施时按它查年限表 `0x004751f0` 写到期日。见 rules/facility.ts。
   */
  landTenureIndex: number;

  /**
   * 本局的两条**勝利條件** —— 開局設定屏最后两条下拉，开局写一次、之后不变。
   *
   * @source `[0x49911c]`（遊戲時間 → 天）与 `[0x499108]`（勝利條件 → 总资产），
   *   开局写入 VA 0x0040737d..0x004073a3；判定在日推进的 `fcn_0041d89e`。
   *   两个值都为 0 = 無限，判定整个跳过（与旧行为逐字节一致）。
   *   见 `rules/setup.ts` 的 `winConditionsOf` 与 `rules/victory.ts`。
   */
  winConditions: WinConditions;

  /**
   * 因**勝利條件达标**而结束时的结局；null 表示本局不是那样结束的。
   *
   * ★ 破产结束那条路不写它（那条路本来就是既有实现，见 `rules/bankruptcy.ts`）。
   *   它只记「谁赢、为什么赢」，终局码由 `gameOverCode()` 现算。
   *   @source `fcn_0041d89e` 的 0x0041d915 起：`[0x49910c] = 赢家下标`。
   */
  victory: VictoryOutcome | null;

  /** 開局以来的总天数 @source `[0x4990e4]`，每日推进 `inc`（0x0041cfab）；電腦公司按它收費 */
  totalDays: number;
  /**
   * 跨过的**月数**。@source `[0x499084]`：`0x0041d0f9 add [0x499084], edi`，edi 是 advanceDate
   * 的返回值（跨月为 1），每跨一个月 +1；AI 选股拿它除累計盈餘当「月均盈餘」。
   * （先前误当成總天數，總天數其实是 `[0x4990e4]`，对应 `totalDays`。）
   */
  totalMonths: number;

  /** 本次掷骰的点数明细；未掷骰时为空 */
  dice: number[];
  /** 剩余步数 @source [0x48baf8] */
  stepsRemaining: number;
  /** 本次掷骰的总步数 @source [0x48bafc] */
  stepsTotal: number;
  /**
   * 遙控骰子指定的点数，**一次性**；0 表示没指定。
   *
   * @source [0x475dd8]：`0x00447275` 写、`0x00447285` 读完当场清零，
   *   全局只有掷骰路径上那一个读取点（VA 0x0040d9a4）。
   */
  forcedDice: number;

  /** 牌堆各卡剩余张数，下标 = 卡片 id - 1 */
  cardAmount: number[];

  /**
   * 地产归属：下标 = 地块 id，值 = 拥有者 index + 1（0 表示无主）。
   * 与地图静态数据分离，便于快照与比对。
   */
  landOwner: number[];
  /** 地块等级（0..5，`< 5` 才可续建 @source fcn_0040b110） */
  landLevel: number[];

  /**
   * 地块种类（住宅 / 連鎖店），下标 = 地块 id。
   *
   * ★ 它**会变**，所以不能只从地图静态数据读：
   *   - 改建卡把住宅与連鎖店对调（`xor ah, 1`，见 cards/rebuild.ts）
   *   - 傳送機把整块地的归属、等级、种类一起搬走（见 rules/teleport.ts）
   *   原版直接改地块结构的 `+0x18`。
   *
   * ⚠️ 先前只把 `owner` 与 `level` 落回状态，`type` 的改动**被悄悄丢掉**了
   *   —— 改建卡看着生效、下一帧又变回去。
   */
  landType: number[];

  /**
   * 地块**当前地价**，下标 = 地块 id。
   *
   * ★ 它会变：新聞 6「公告地價調漲３０％」/ 14「房屋鬧鬼 地價下跌３０％」
   *   直接把同名地块的 `+0x1c` 乘上 1.3 / 0.7（截断）。
   *   @source `fcn_004494e0`（×1.3，常量 `[0x4654dc]`）/ `fcn_0044a220`（×0.7，`[0x46561c]`）
   *   字段出处 `land.h` 0x1c；先前只把 owner/level/type 落回状态，
   *   地价改动**无处落**，于是这两条新聞一直只画文案。
   */
  landPrice: number[];

  /**
   * 地块**上一次**收到的過路費，下标 = 地块 id。
   *
   * @source 住宅过路费付完之后 `mov [land + 0x2c], ebp`（VA 0x0041a00b）——
   *   是 **mov 不是 add**：记的是最近一笔，不是累计。
   *   它只有一个消费者：**間諜**踩上来「取走過路費」（VA 0x0041c597）。
   */
  landLastToll: number[];

  /**
   * 地契到期日（打包日期 年<<16|月<<8|日），0 = 無限期。下标 = 地块 id。
   *
   * @source 這就是 `land.h` 里那个「语义未明」的 **`flast`(+0x30)**：
   *   買地时 `if ([0x499110] != 0) land.+0x30 = today + 年限表[[0x499110]]`
   *   （VA 0x0041a108，年限表 0x004751f0），每日推进时
   *   `if (land.+0x30 == today) { owner = 0; +0x30 = 0 }`（VA 0x0041d12d）。
   *   即開局「土地權限」那一项：到期地契**归无主，房子留着**。
   */
  landTenure: number[];

  /**
   * 地块的状态标记（0 正常 / 0x50 漲價 / 0x51 查封），下标 = 地块 id。
   *
   * @source housing_land +0x17：漲價卡 0x004454ef `mov byte [land+0x17], 0x50`、
   *   查封卡 0x00445659 `..., 0x51`。
   * ★ 没有这一项，漲價/查封卡经 reduce 打出去就被丢弃 —— playCard 先前
   *   只合回 owner/level/type 三个数组。
   */
  landPriceStatus: number[];

  /**
   * 設施的归属／等级／种类／上次過路費／地契到期 —— 与地块那五项同构，
   * 下标 = 設施 id。
   *
   * ★ 先前 `topo.facilities` 是只读静态数据，設施**买不了、蓋不了、也不会
   *   到期**；傳送機搬設施、公佈欄挂設施、流氓按实时归属勒索都因此卡住。
   *   @source 設施结构 +0x19 / +0x1a / +0x18 / +0x30 / +0x34
   *   （VA 0x0041a926 買、0x0041a27c 首建、0x0041a35f 加蓋、0x0041a75e 記費、
   *   0x0041a978 到期日）。
   */
  facilityOwner: number[];
  facilityLevel: number[];
  /** 建筑种类 0 公園 / 1 旅館 / 2 購物中心 / 3 加油站 / 4 研究所；地图里恒为 0，首建时才定 */
  facilityType: number[];
  /**
   * 設施的状态标记（0 正常 / 0x50 漲價 / 0x51 查封），下标 = 設施 id。
   * @source business_land +0x1c：漲價卡 0x0044553e `mov byte [fac+0x1c], 0x50`、
   *   查封卡 0x004456cb `..., 0x51`。与地块不同，这两张卡对設施**只标记单个**。
   */
  facilityPriceStatus: number[];
  /**
   * 設施**当前地价**，下标 = 設施 id。
   *
   * ★ 同 `landPrice`：新聞 6/14 会乘 1.3 / 0.7（設施走 `+0x22`，与地块的 `+0x1c` 不同字段）。
   * @source `business_land +0x22`（`csrc/land.h`）
   */
  facilityPrice: number[];
  facilityLastToll: number[];
  facilityTenure: number[];
  /**
   * 研究所的研發：項目 1..5（0 = 没在研發）与剩余天数。下标 = 設施 id。
   * @source 設施 +0x1d / +0x1e（选项目 0x004411f8，每回合推进 0x0041cdb0）
   */
  facilityResearchProject: number[];
  facilityResearchDays: number[];

  /**
   * 公佈欄 —— 每个玩家 7 个挂牌槽。
   *
   * ★ 玩家（含电脑）可以把**股票／地產／道具／卡片**挂上去卖，
   *   别人付**现金**买走。见 places/notice-board.ts。
   */
  noticeBoard: (Listing | null)[][];

  /**
   * 棋盘上会走路的**非玩家**五个：小偷／強盜／流氓／間諜／機器娃娃。
   *
   * ★ 原版把它们与玩家一样当作「行动者」（`[0x49910c]` 取值 4..8），
   *   共用一张 5 × 16 字节的表。下标 = actor − 4。
   *   见 rules/special-actors.ts。
   */
  specialActors: SpecialActor[];

  /** 回合序号，从 0 开始 */
  turnCount: number;

  /**
   * ★ 电脑回合掷骰前的**调度步** @source VA 0x00418dc6：
   *   0 买股（0x42bf03）→ 1 卖股（0x42c79f）→ 2 用卡或用道具 → 3 掷骰。
   * 进 2 之前 reducer 顺手做原版夹在中间的三件事：特別融資收回（0x436b0a(0)）、
   * 公佈欄（0x4284be）、`rand() & 1` 定本回合用卡还是用道具（写进 `aiBranch`）。
   * 每回合 startTurn 清零；真人回合不用（策略层不看）。
   */
  aiStep: number;
  /** 1 = 本回合用卡，0 = 用道具 @source 0x00418e18 `call rand / test al, 1` */
  aiBranch: number;

  /**
   * 每个玩家的「回合开始快照」，供時光機（道具 10）还原。
   *
   * ★ 原版是同一套东西：`[0x48cb80 + 玩家 × 0x2718]`，只给真人存
   *   （@source VA 0x004480a0）。见 rules/time-machine.ts。
   *
   * ⚠️ 存的是序列化后的字符串而不是对象 —— 一来天然深拷贝，二来
   *   避免「状态里套状态」的递归类型。
   */
  snapshots: (string | null)[];

  /**
   * 新聞／命運牌堆。开局洗好，用游标依次取用（见 events/deck.ts）。
   * 两副牌是**独立**的，各有各的游标。
   */
  newsDeck: EventDeck;
  fortuneDeck: EventDeck;

  /** 公库 @source [0x499080] —— 罚款进这里 */
  pool: number;

  /**
   * 监狱／医院占用表，各 8 槽（0..3 玩家、4..7 地图物件）。
   * @source [0x00496b30] / [0x00496b60]，见 rules/confinement.ts
   */
  prisonOccupancy: number[];
  hospitalOccupancy: number[];

  /** 最近一次事件的记录，供表现层显示；不参与规则 */
  lastEvent: {
    /**
     * `news` / `fortune` = 新聞/命運事件框；`magicHouse` = 魔法屋那一趟
     *   （它没有事件框，但**表现层要显示「抽中了哪个条件」**，故借这条通道带出去）。
     */
    kind: 'news' | 'fortune' | 'magicHouse';
    id: number;
    /**
     * ★ 新闻百分比类那四条（11 所得稅 / 12 地價稅 / 13 證交稅 / 23 儲金紅利）
     *   的「先算好」结果：每位在场玩家该缴/该领多少（`shares` 见
     *   `events/news-effects.ts` 的 `NewsEffectResult`）。表现层按它逐行画
     *   —— 顺序是原版的「先算好并画出来、第二趟才真收」（`rich4_news.asm:1320`）。
     * 其余事件不带这一项。
     */
    shares?: readonly { player: number; amount: number }[];
    /**
     * ★ 魔法屋那一支（`kind === 'magicHouse'`）：**目标转盘抽中的条件号 0..11**。
     *
     * @source `spinMagicHouse` 的 `criterion`（VA 0x0043390b 一带：
     *   `rand() % 12` + `fcn_00431842` 复检直到该条件下有人）。
     *   表现层要按它显示条件名与条件图（`ash4_magic_house.asm` 的
     *   `loc_00432719` 尾：`fcn_0044ecb6([0x4756b8 + 条件下标*4])`）。
     *   ★ 先前表现层是**从 before→after 反推**的（D-MAGIC-1），
     *   反推错时字框会写错一个条件名 —— 现在以这里为准。
     */
    criterion?: number;
    /** ★ 魔法屋那一支：筛出的名单（玩家下标，升序）@source `MagicSpin.targets` */
    targets?: readonly number[];
  } | null;

  /**
   * **上一轮／上一次**替身走出来的整趟路径 —— 纯表现提示（T-047）。
   *
   * ★ 为什么要有它：core 一次动作里就把替身整趟走完（`runNpc` / `runDoll`
   *   逐格算完才回一个 `path`），而 `path` 的中间格是岔路上 `rand()` 选的、
   *   消费掉的 RNG 状态已经回不去，渲染器事后**推不出来**。原版是逐格 tick 播的，
   *   要 1:1 就得把这份路径原样交给渲染器（见 `client/render.ts` 的 `ActorWalk`）。
   *   三个覆写点：`reduce.ts` 的 `npcRound`（一輪里每个在盘上的惡人各一趟）、
   *   `bail`（保釋当场那一趟）、以及用道具 1 时 `runDoll` 的九格。
   *
   * ★ **只保留最近一次**（每次覆写整份，不做累积）—— 它描述的是「刚刚发生了什么」，
   *   用于起一段补间；累积起来既没有消费者，也会让读档后的画面莫名滑一段。
   *
   * ★ **纯表现，不参与任何规则判定**：
   *   - core 里没有任何规则读它（`grep lastNpcWalks` 只有覆写点与装配点）；
   *   - **不进 `stateFingerprint`**（`net/protocol.ts`）：那里的形参是一个
   *     **显式列字段**的结构类型，只取「规则可见」的量，本字段不在其中，
   *     故 `stateFingerprint(state)` 天然把它排除掉 —— C-DET 的确定性校验
   *     不受表现差异影响。`state/npc-round.test.ts` 里有一条用例钉住这件事：
   *     只改这一个字段，指纹必须不变（谁日后把指纹改成 `JSON.stringify(state)`
   *     之类，那条用例会当场红）。
   *   - 也因此它**不进 `history`、不进时光机快照**：两者存的是 action / state
   *     的规则可见部分，读了它反而是把表现混进确定性重放（C-DET-4）。
   */
  lastNpcWalks: NpcWalkHint[];

  /**
   * 回合边界上**还没轮到走的四大惡人**槽位（= actor − 4，只有 0..3）。
   *
   * ★ 为什么要有它：原版回合推进是**一条游标**（`[0x49910c]`），越过最后一名
   *   玩家后继续 4→7、每个惡人**单独**走一趟，游标到 8 才回到 0 并推日期
   *   （@source `rich4.asm:11766-11782` 与 `:11826 test ebx,ebx`）。
   *   本引擎的 `currentPlayer` 只装 0..3，故把「这一輪还没走的惡人」放在这里，
   *   由 `endTurn` 填、`npcStep` 逐个消费（见 `docs/deviations/T-047.md` 的 D-T047-5）。
   *
   * ⚠️ **这一份是规则的一部分**（不像 `lastNpcWalks`）：它决定「还没走完」，
   *   进了它就必须等 `npcStep` 走完才轮到下一位玩家。故：
   *   - 进存档 / 联机同步（它是可见的相位信息，不是表现提示）；
   *   - 但**不进 `stateFingerprint`**？—— 不，**要进**：两台机器如果在
   *     「游标停在第几个惡人」上不一致，那是**规则分歧**，必须被指纹抓到。
   *     （`lastNpcWalks` 那种纯表现才排除；见那条字段的注释。）
   *
   * 空数组 = 这一輪的惡人已经走完（或本来就没人在盘上）。
   */
  pendingNpcSlots: number[];

  /**
   * 樂透号码表，36 项；值 = 持有者下标 + 1，0 表示未售出。
   * @source [0x004990b8]，见 places/lottery.ts
   */
  lottery: number[];

  /**
   * 当前**待决的落点交互**；null 表示无需交互。
   *
   * ★ 它是规则的一部分：「落在这格上要求玩家做什么」由 core 判定，
   *   UI 与 AI 都只是作答者。否则两端各猜一套，联机必然对不上。
   */
  pending: PendingInteraction | null;

  /**
   * 全局道具表，`tools[player * 15 + toolId]`。
   * @source [0x0049915b]，步长 15，见 rules/tools.ts
   */
  tools: number[];

  /**
   * 道具的**全局库存**，下标 = 道具编号。
   * 只有编号 ≤ 8 的道具受此限制。
   * @source 基址 [0x0049731f]，即 `stock[toolId]` 落在 0x497320 起
   *   （`byte [i + 0x497320]`，i = toolId − 1，VA 0x00445af0）。
   *   初始值取自道具表的 `initAmount`：编号 1..8 各 10 份，9..13 不限量。
   *
   * ★ 回收也走这里：路障/地雷/炸彈被踩掉或爆掉会加回来
   *   （VA 0x0040e17f 起），座驾被地雷/炸彈毁掉也加回来
   *   （VA 0x0040cd3b，機車 → 5、汽車 → 6）——**不是**退进玩家的道具栏。
   *   禮物抽奖更是直接**按库存加权**：库存越多越容易抽到。
   */
  toolStock: number[];

  /**
   * 股市行情 —— 12 支股票、144 日历史、大盘指数。
   * @source `_stocks_on_map` 0x496980（12 × 36B）
   */
  market: StockMarketState;
  /**
   * 各玩家的持仓：`holdings[玩家][股票]`。
   * @source `_rich4_player_stocks`，每项 8 字节（持股数 + 成本均价 float）
   */
  holdings: StockHolding[][];

  /**
   * 各上市企业**还剩多少股可卖**，下标 = 企业 1 基序号。
   *
   * @source 地图记录的 `commercial + 0x30`，买入时
   *   `sub dword [ecx + 0x30], esi`（VA 0x00428db1）。
   *   它是**运行时**会变的量，故放进状态而不是留在地图表里。
   */
  commercialShares: number[];

  /**
   * 各上市企业的归属与持股排名，下标 = 企业 1 基序号。
   *
   * @source 企业记录 `+0x18`（拥有者）与 `+0x1c..+0x1f`（4 人排名表），
   *   每次买入股票后由 `_rich4_update_commercial_owner` 重排。
   *   见 places/commercial.ts。
   */
  commercialOwners: CommercialOwnership[];
  /**
   * 各企業的**累積盈餘**（有符号），下标 = 企業 id。@source commercial +0x28。
   * 别人踩上来交的費进这里（`pay_money(…, 100 + 企業下标, …)`，0x0041b022），
   * 每月 15 日按持股比例分给股东后清零（0x0042bd42）；間諜「取走盈餘」拿的也是它。
   */
  companyFunds: number[];
  /**
   * 各企業的**累計盈餘**（从不清零），下标 = 企業 id。@source commercial +0x2c。
   * `pay_money` 对企業一方的每笔增减都同时写 +0x28 与 +0x2c（0x0041d2e6/0x0041d2ea、
   * 0x0041d3a5/0x0041d3a9），分紅只清 +0x28。AI 选股用它除以總天數（[0x499084]）
   * 当「月均盈餘」看（0x0042c612..0x0042c638）。
   */
  companyProfit: number[];

  /**
   * 地图物件表，46 项 —— 神明、路障、地雷、定時炸彈都住在这里。
   *
   * @source `objects_info` [0x00496d08]，每项 24 字节；
   *   玩家的 `godInfo` 存的就是**这张表的下标 + 1**（见 rules/objects.ts）。
   */
  objects: MapObject[];
}

// ============================================================
//  判定辅助
// ============================================================

export function isAlive(p: Player): boolean {
  return (p.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_DEAD;
}

/** 该玩家此刻由 AI 操作吗（电脑玩家，或被托管的人类） */
export function isAiControlled(p: Player): boolean {
  if (!isAlive(p)) return false;
  if ((p.whoPlays & WHO_PLAYS_AUTOPILOT) !== 0) return true;
  return (p.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_COMPUTER;
}

/**
 * 是否存在阻碍行动的状态。
 *
 * 原版把 `days_in_hotel`(+0x32)、`days_disappearing`(+0x33)、
 * `days_in_prison`(+0x34)、`days_in_hospital`(+0x35) 这 4 个字节
 * 当作一个 dword 一次性比较，再单独检查 `days_sleeping`(+0x36)。
 * @source rich4.asm:6576-6579 `cmp dword [eax+0x32],0` / `cmp byte [eax+0x36],0`
 */
export function isBlocked(p: Player): boolean {
  const b = p.blocking;
  return (
    b.inHotel !== 0 ||
    b.disappearing !== 0 ||
    b.inPrison !== 0 ||
    b.inHospital !== 0 ||
    b.sleeping !== 0
  );
}

/** 剩余天数的显示值：低 7 位 + 1（高位是标志位） */
export function displayDays(raw: number, mask = 0x7f): number {
  return (raw & mask) + 1;
}
