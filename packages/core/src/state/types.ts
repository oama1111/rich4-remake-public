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
import type { AuctionRequest, PendingInteraction } from '../rules/interaction.ts';
import type { StockMarketState } from '../places/stock-market.ts';
import type { StockHolding } from '../places/stock.ts';
import type { CommercialOwnership } from '../places/commercial.ts';
import type { Listing } from '../places/notice-board.ts';
import type { MapObject } from '../cards/summon.ts';
import type { SpecialActor, SweptObject } from '../rules/special-actors.ts';
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
 * 比特 4：**「走回棋盘」标记**。
 *
 * 关押／住宿到期时释放函数调的 `0x40d6be` 会置上它
 * （`0040d6d1 or byte [player + 0x15], 0x10`），代表此人这一回合要**从綠島／
 * 醫院大樓走回棋盘**。回合推进函数 `0x418ebd` 见到它就整回合跳过
 * （`00418f8e jmp 0x419058`，不掷骰、不走子），并在 `00418f87 and byte
 * [player + 0x15], 0xf` 把它清掉。
 *
 * ⇒ **刑满／住满之后还要白丢一回合**，这也正是状态栏「還剩 N 天」显示
 * `(+0x34 & 0x7f) + 1` 的原因：显示的天数（= 会丢掉的回合数）比计数多 1。
 * 通道 2 证据：`rich4-spec/tests/test_day_tick.py`（28/28）。
 */
export const WHO_PLAYS_RETURN_TO_BOARD = 0x10;
/**
 * 比特 5：本回合位置被外力挪动过
 * （`0040d60e or byte [player + 0x15], 0x20`，在「把玩家挪到目标节点」的
 * `0x40d5a5` 里；与比特 4 同一处消费：`0x418ebd` 的 `and …, 0xf`）。
 * 具体触发条件**未决**（只在"当前玩家 + 节点号命中参数"那一支置位）。
 */
export const WHO_PLAYS_RELOCATED = 0x20;
/**
 * 比特 4/5 的合体掩码 —— 原版在回合开始时用 `test byte[+0x15], 0x30` 检测，
 * 命中则**整回合跳过**（不掷骰、不走子，也不走常规落点解析）。
 * @source rich4.asm:6573 (fcn_0040c912) / 0x00418f07 / 0x00418f87
 */
export const WHO_PLAYS_SPECIAL_MASK = 0x30;
/**
 * 比特 6：**刚被毁了车 / 咬了 / 炸了 —— 棋子画成乞丐**。
 *
 * `0x40cd07`（惡犬 / 地雷 / 定時炸彈 / 新聞 4 / 命運 10、11 共用的毁车例程）末尾
 * `0040cd5e or byte [player + 0x15], 0x40` 然后 `call 0x40b93b` 重载棋子图；`0x40b93b` 见到
 * `who_plays == 0`（出局的乞丐）**或**这一位就装资源 **+0x12 = 18**（`0040b9b7 add edi, 0x12`）——
 * 补丁衣服那一张。`send_to_hospital` 走到 `0043ecad and byte [+0x15], 0xf` 才清掉。
 *
 * ★ 引擎里这一位在同一条 action 内被设又被清（毁车之后紧接着就住院），after 里看不到 ——
 *   规则层**不写**它；它是给表现层用的记号（`client/deferred-board.ts` 在影片窗口里挂上、
 *   `client/render.ts` 见位画乞丐）。放在这里只为与原版位含义一一对应。
 */
export const WHO_PLAYS_WRECKED = 0x40;

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
  /**
   * 「落地之后是谁在打」—— `player_info +0x64`（存档里的 `f100`）。
   *
   * ★ 开局**只有它**记着人／电脑：玩家记录是整条从角色表抄来的（`0x004072e4 memcpy
   *   (player, 0x47e80c + 角色 × 0x68, 0x68)`），表里 `+0x08..+0x10`（坐标 / 节点 / 来路 / 朝向）
   *   与 `+0x15`（`who_plays`）**全是 0**；接着 `0x004072f9` 只写 `+0x64 = 1（人）/ 2（电脑）`。
   *   ⇒ 开局所有人都是「没上盘」：`who_plays == 0` 且 `xpos == 0`。
   * ★ 谁第一次被镜头对准（自己的第一个回合）才摆谁（`0x004082d9..0x004083a0`），
   *   落地影片播完那一刻才把它抄回 `+0x15`：
   * ```asm
   * 00418d01  mov dl, byte [eax + 0x496bcc]   ; +0x64
   * 00418d07  mov byte [eax + 0x496b7d], dl   ; → who_plays
   * ```
   * 之后原版不再拿它当「谁在打」读（`0x00447a49` 那件道具借它暂存交通工具，本引擎另有字段）。
   * 破产的 `memset(player + 0x1c, 0, 0x4c)` 覆盖到它（`markPlayerBankrupt` 清成 0）。
   *
   * 可选：旧存档 / 测试工厂造的玩家没有这一格 = 0 = 「不会再落地」。
   */
  landingWhoPlays?: number;
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
  /**
   * 这一趟**起步时定下的步数**（= 原版 `[0x48baf8]` 的初值）—— 走子时那串剩余步数要用（E-22）。
   *
   * @source `0x40dd1f` 的 actor ≥ 4 分支：惡人 `0x0040de64`（`rand()%9+2`）/ `0x0040de3d`（龜行 1）、
   *   機器娃娃 `0x0040debe`（9）。⚠️ **不等于** `path.length − 1`：半路被收回去 / 踩雷时
   *   路径提前断，而原版那串数字是从**掷出的步数**往下数的。缺省 = 按路径长度。
   */
  steps?: number;
  /**
   * 这一趟**沿途扫掉的物件**（只有 機器娃娃 会有；四大惡人恒空/缺省）。
   *
   * ★ 为什么要交出来（试玩3 #11）：core 一次就把九格走完，`objects` 里那几件
   *   交出去时**已经没有 `nodeId`**了 —— 客户端要么整趟一起少、要么就得知道
   *   「哪一件是在哪一格被扫的」才能让它逐格消失。这就是那个「哪一格」。
   *   `SweptObject.index` 是**走之前**那份 `state.objects` 的下标，
   *   故客户端可以拿它去 `before.objects` 里取回那一件的**位置与种类**
   *   （见 `client/render.ts` 的 `#objectSlots`）。
   *
   * ★ 与 `path` 同一类：纯表现提示，不进指纹 / 不进 history / 不进存档。
   *   缺省（读档、开局、四大惡人那两处覆写）不写这个字段。
   */
  cleared?: readonly SweptObject[];
}

/**
 * **上一次「某玩家用出了某张卡」** —— 纯表现提示（卡牌使用者台词）。
 *
 * ★ 为什么要有它：原版每张卡的函数体里都有一句
 *   `player_say(出牌者, flag, 卡牌台词表[角色][卡号-1])`
 *   （14 处同形：`@source 0x44210e` 等，表 VA `0x48123a`、行距 360），
 *   即**用卡时角色要说一句话**。那句话是**调用点参数**，不是状态跃迁，
 *   所以表现层那套「状态差分」探测器（`client/speech.ts` 的 `DETECTORS`）
 *   永远看不见它 —— 复刻侧因此**一个字都不说、语音也不响**（gaps §7.89(2)）。
 *   要补就得由 core 把「刚刚谁用了哪张卡」原样交出来。
 *
 * ★ 与 `lastNpcWalks` 同一类：**只保留最近一次**（每次覆写，不累积），
 *   纯表现、不参与任何规则判定 ——
 *   - core 里没有任何规则读它；
 *   - **不进 `stateFingerprint`**（`net/protocol.ts` 的形参是显式列字段的结构类型）；
 *   - **不进 `history`、不进存档、不进时光机快照**。
 *
 * ⚠️ 「用出去了」才写（对应原版卡片函数返回非 0）：`ok: false` 的那条路
 *   （= 卡还在手上、一点状态都没动）**不写**这个提示。
 */
export interface ToolUseHint {
  /** 用道具的人下标 0..3 */
  player: number;
  /** 道具号 1..13（`@rich4/data` 的 `toolLine(character, toolId)` 用它取台词） */
  toolId: number;
}

/** 一场拍卖落槌（纯表现；见 `GameState.lastAuctionResults`）*/
export interface AuctionResultHint {
  /** 落槌那一刻的 pending（开拍即流标：开拍那一份）*/
  pending: AuctionRequest & Partial<Extract<PendingInteraction, { kind: 'auction' }>>;
  /** 得标者玩家下标；−1 = 流标 */
  winner: number;
  /** 成交价（流标为 0）*/
  price: number;
}

export interface CardPlayHint {
  /** 出牌者下标 0..3 */
  player: number;
  /** 卡号 1..30（`@rich4/data` 的 `cardLine(character, card)` 用它取台词） */
  cardId: number;
  /**
   * ★ 第十四份：被动卡（免費卡 / 嫁禍卡）在收費那一段里用掉的 —— 亮牌已经作为訊息框队列里的一扇交出去
   *   （`NoticeHint.card`，好排在收費框之后），这里 `false` = 事件框**不再**亮这一张，只说台词。
   */
  popup?: false;
  /**
   * ★ 第十四份：出牌者之后**回一句**的人 —— 免費卡是地主（`0x00444b98`，卡牌台词表槽 79，表情 1；
   *   企業那一路地主实参 −1 ⇒ 不带），嫁禍卡是替死鬼（`0x00444a4b`，槽 78，表情 2）。
   */
  answeredBy?: number;
}

/** 魔法屋一段演出的前后状态（见 `GameState.lastMagicBeats`）*/
export interface MagicBeat {
  readonly before: GameState;
  readonly after: GameState;
}

/**
 * ★★ 第二十一份（`20260924-144653022`「这个页面应该有台词，评比本月最倒霉和最幸运…2个评比」）：
 * **这一次月结的现场** —— 纯表现提示，见 `GameState.lastMonthlySettle`。
 *
 * 原版月结屏 `fcn_00439bfa` / 窗口过程 `fcn_00437e61` 读的全是**结算那一刻**的值：
 * - 每行名牌（`0x00439cd7` 循环，画进图 `11+行`）：`存款：` = 加息**之前**的 `+0x20`、`利息：` = `trunc(存款×0.1)`
 *   或红字 `貸款中`（`+0x24 != 0`）；
 * - 状态 2（`0x004380d5`）才把存款 ×1.1（`0x00438201`），随后 `fcn_00437d1a` 评「本月悲情人物」
 *   （读 `+0x5c/+0x60/+0x42/+0x44`）、`fcn_00437dfe` 评「本月冠軍」（`calculate_player_wealth` 最大者）；
 * - 两张 4 行表（状态 7 / 0x11）画的是那两位**那一刻**的 `+0x5c/+0x60/+0x42` 与 `+0x1c/+0x20/总资产`；
 * - 模态循环结束后（`0x00439ec6`）才把三项月度累加器清零。
 *
 * 本引擎在 `advanceGameDay` 里一口气结完（累加器当场清零），表现层事后**反推不出**这些值
 * （先前的月结屏拿结算**之后**的累加器评奖 ⇒ 永远是 0 ⇒ 悲情人物那一段从来不出）。
 * 所以由 core 在结算那一刻交出来。
 */
export interface MonthlySettleHint {
  /** 在场玩家（`who_plays != 0`），**按 `players` 序**（= 原版 `[0x48c418]` 的填法 `0x00439caa`）*/
  readonly rows: readonly MonthlySettleRow[];
  /** 本月悲情人物（`fcn_00437d1a`）在 `players` 里的下标；`-1` = 无（原版 `0xff`）*/
  readonly unlucky: number;
  /** 本月冠軍 = 首富（`fcn_00437dfe`）在 `players` 里的下标 */
  readonly champion: number;
}

/** `MonthlySettleHint` 的一行 */
export interface MonthlySettleRow {
  readonly player: number;
  /** 加息之前的存款（名牌上的 `存款：`）@source `0x00439d6a mov eax, [p+0x20]` */
  readonly bankBefore: number;
  /** 这一笔利息（名牌上的 `利息：`；有贷款时为 0、名牌写 `貸款中`）*/
  readonly interest: number;
  /** 结算那一刻的贷款（`+0x24`，非 0 ⇒ `貸款中`）*/
  readonly loan: number;
  /** 本月意外損失 `+0x5c`（清零之前）*/
  readonly unexpectedLoss: number;
  /** 本月意外之財 `+0x60`（清零之前）*/
  readonly unexpectedGain: number;
  /** 本月倒楣天數 `+0x42`（清零之前）*/
  readonly unluckyDays: number;
  /** 加息之后的现金 / 存款 / 总资产（冠軍那张表 `0x00438e38` 起）*/
  readonly cash: number;
  readonly bank: number;
  readonly wealth: number;
}

/**
 * **这一次樂透開獎开出了什么**（第十二份試玩回報「沒展現出本期開獎號碼」）—— 纯表现提示，
 * 见 `GameState.lastLotteryDraw`。
 *
 * @source 原版 `0x00430b07`–`0x00430b77` 当场掷出号码（`ebx` = 1..36），
 *   随即 `0x00430b7a sprintf("%02d", ebx)` 拆成两位写进 `[0x48c37d]/[0x48c37e]`，
 *   开号那一拍 `0x00430c48`/`0x00430c80`（号码球）与 `0x00430cba`/`0x00430cf4`
 *   （`Data.mkf#517` 的大号绿字）把它画出来 —— **无论有没有人中**。
 *   这个号在原版只活在开奖屏的那两个字节里，状态机之外没有任何地方留下它；
 *   本引擎的 core 一条 action 就把开奖做完，表现层事后**反推不出**没人中奖时开的是几号
 *   （号码表与公库都原样），所以由 core 在开奖那一刻交出来。
 */
export interface LotteryDrawHint {
  /** 中奖号的**槽号 0..35**（屏上显示 `%02d` 的 `number + 1`，与投注屏/持号表同一口径）*/
  number: number;
  /** 得主下标；开出的号没人买为 `null` */
  winner: number | null;
  /** 开奖那一刻的公库（屏上「累積獎金」那一格；有人中奖时也就是他拿走的数）*/
  pool: number;
  /** **开奖前**的号码表（原版到收屏 `0x00430aee` 才 `memset`，演出全程铭牌上都看得见）*/
  sold: number[];
}

/**
 * **神明顯靈时说哪一句**（W-55 行 6）—— 纯表现提示，见 `GameState.lastGodLine`。
 *
 * @source 福神 `fcn_0040f8be` 的 `0x0040fa49 call 0x456f2d`（`rand()`）/
 *   `0x0040fa4e and eax,1` / `0x0040fa51 mov esi,[… + eax*4 + 0x48084a]`
 *   —— 即**角色台词表的事件 0 或 1**（`0x48084a + 108×角色 + 事件×4`）。
 */
export interface GodLineHint {
  /** 说话的人（玩家下标 0..3）= 原版 `[0x49910c]` 那个当前行动者 */
  player: number;
  /**
   * 台词槽位 = **角色台词表的事件号**（`@rich4/data` 的 `speechIndex(角色, 事件)`）。
   * 福神那一支是 `rand() & 1` ⇒ `0` 或 `1`。
   */
  event: number;
}

/**
 * **这一次神明發威掷出来的金额**（W-55 行 7）—— 纯表现提示，见 `GameState.lastGodPower`。
 *
 * @source `godPowerOf()`（`rules/god-power.ts`）掷出来的那个三位/四位数；
 *   消费点在財神那两支的台词闸门（`0x0040eca4 cmp esi,0x2bc` /
 *   `0x0040ed74 cmp esi, 5000×物價`）。
 */
/**
 * 董事長在商店送出的那一件（W-67-a）—— 纯表现提示，见 `GameState.lastShopGift`。
 *
 * 消费者：`client/src/speech.ts` 的 `detectShopGift`（走 `fcn_0044f230` 那一支阶梯）。
 */
export interface ShopGiftHint {
  /** 送的是道具还是卡 */
  readonly kind: 'tool' | 'card';
  /** 道具号 / 卡号 */
  readonly id: number;
  /** 那件的**點數价** —— 原版传给 `0x44f230` 的就是它（不是现金价）*/
  readonly points: number;
}

export interface GodPowerHint {
  /** 附身者（玩家下标 0..3）*/
  player: number;
  /** 神明**种类** 1..15（`objects[godInfo−1].type`，见 `rules/god-power.ts` 的常量）*/
  type: number;
  /** 那扇转盘窗拼出来的金额（小財神三位 / 大財神四位）*/
  amount: number;
}

/**
 * 一条**付费类落点的棕色訊息框**要显示什么 —— 纯表现提示。
 *
 * ★ 为什么要有它（issue #18）：原版在「走到别人的地产 / 企業」收钱之前，会先
 *   `sprintf` 一句文案、再 `push 0x5dc / call 0x440cac` 弹**通用訊息框**
 *   （1500 ms、可跳过）。重制版先前一个都不弹。
 *
 * ★★ **框里的金额是神明加成之前的那一笔**。原版：
 * ```asm
 * 00419d50  push 0x5dc                        ; 1500
 * 00419d5a  call 0x440cac                    ; ★ 先弹框（显示 ebp = 地主份 + 同盟份）
 * 00419d70  call 0x41d709                    ; ★ 之后才按付款方的神明调整金额
 * ```
 *   ⇒ 客户端**不许**从 `before → after` 的差分反推金额（神明一调整就对不上），
 *     必须原样用 core 交出来的数。`rules/rent.ts` 的 `RentResult.baseTotal`
 *     就是那一个数（`total` 是调过之后的）。
 *
 * ★ **纯表现，不参与任何规则判定**：
 *   - core 里没有任何规则读它（只有写入点与客户端消费者）；
 *   - **不进 `stateFingerprint`**（`net/protocol.ts` 的形参是**显式列字段**的
 *     结构类型，本字段不在其中）⇒ 两端不必在「弹没弹框」上一致；
 *   - **不进 `history`、不进存档**：它描述的是「刚刚发生了什么」。
 *   ⚠️ 已知的既有口径（`lastNpcWalks` / `lastCardPlay` 同病，非本次引入）：
 *     `rules/time-machine.ts` 的 `takeSnapshot` 是 `JSON.stringify(state)`，
 *     所以这个瞬态字段**会**随快照一起回滚。不影响任何规则判定。
 */
export interface NoticeHint {
  /**
   * 文案键 —— 由客户端查 `@rich4/data` 的 `messages.ts` 翻成原版格式串。
   *
   * ⚠️ 这里是**键**而不是文案，是为了让 core 不依赖表现层的排版，也为了让
   *   「core 交了什么」在单测里可逐字比对（`args` 的顺序就是原版 `sprintf` 的
   *   参数顺序，见 `client/src/notice-box-screen.ts` 的 `NOTICE_TEXT`）。
   */
  key: NoticeKey;
  /** `god.gotCard` 专用：得到的那张卡（1 基）—— 表现层按它的點數价配「好消息」台词（`0x44f230`）*/
  cardId?: number;
  /** 原版那次 `sprintf` 的参数，**顺序原样**（`%s` 已经代入好名字，不再是下标） */
  args: readonly (string | number)[];
  /**
   * 这扇框停留多久（ms）；缺席 = `NOTICE_HOLD_MS`（1500，`0x5dc`）。
   *
   * ★ 只有**得点格**那三句是 `0x3e8` = 1000 ms：
   *   `0x0041b1be` / `0x0041b258` / `0x0041b2dc` 三处都是 `push 0x3e8`。
   *   其余全部走 `0x5dc`。写在这里是为了客户端**不自己编时长**（C-ARC-2）。
   */
  holdMs?: number;
  /**
   * 这扇框在原版里排在**同一条 action 派生的影片之前**（`true`）。
   *
   * ★ 魔法屋那几扇就是：`0x431caa` 每一支都是**先** `0x440cac` 弹框（阻塞 1500 ms），
   *   **再**加蓋（大锤 0x229）/ 拆除（0x211）/ 送監獄・醫院（0x20d / 0x20c）的影片。
   *   而本引擎客户端的通用口径是「框等影片播完」（過路費閃地块那一类）⇒ 这个标记让客户端
   *   反过来：影片等这扇框收掉。缺席 = 通用口径。
   */
  beforeFilms?: boolean;
  /**
   * 框收掉之后原版还**空等**多久（ms，`fcn_0045285e` 忙等 —— 点不掉，也不画东西）；缺席 = 0。
   *
   * ★ 魔法屋那几支：變賣卡片 / 存入現金 / 變賣道具 收尾 `push 0xc8`（200 ms，0x00431d53）、
   *   向後轉 `push 0x1f4`（500 ms，0x004321e6）。
   */
  afterMs?: number;
  /**
   * ★ 第十四份（2026-09-23）：**这扇框之后**原版紧跟着的那一句 `player_say`（纯表现）。
   *
   * 两种形状：
   *   - `{ player, event }`：固定槽位（免收九种之后当前玩家的事件 13 `0x0041d6dd`；
   *     命運坐牢被神明挡掉之后的事件 0 `0x0044d873`）；
   *   - `{ player, reliefAmount }`：走 `fcn_0044f567` 那条「逃过一劫」阶梯（12/13/14），
   *     金额是**没付的那一笔**（命運罰金免付 `0x0044ce7e` / `0x0044d028`，
   *     大財神把费用抹成 0 `0x0041d7c1`）。档位由表现层按 `payTierFor` 分。
   */
  say?: { player: number; event: number } | { player: number; reliefAmount: number };
  /**
   * ★ 第十四份：这一扇**不是**訊息框，而是亮牌（`fcn_00441f73(卡号, 文字)`：卡面 + 那一句，1500 ms）——
   *   收費那一段里的被动卡要排在收費框之后、死神框之前，所以跟着訊息框排队。文字 = `key` 的格式串。
   */
  card?: number;
  /**
   * ★ 2026-09-23：`0x440cac` 的时长参数带 **bit31**（`0x80000000 | ms`）—— 框整体**右移 100**。
   * @source `0x00440cef test esi, 0x80000000 / je` → `0x00440cf7 and esi, 0x7fffffff` →
   *   `0x00440cfd add [esp], 0x64` / `0x00440d01 add [esp+8], 0x64`（x0 / x1 各 +100，锚点跟着走）。
   *   全 exe 只有三处带它：股市柜台漲停 / 跌停（`0x0042af18` / `0x0042b04b push 0x800003e8`）
   *   与貸款屏进门的暫停放款（`0x004351ee push 0x800005dc`）。
   */
  shiftRight?: boolean;
}

/**
 * 目前接出来的文案键 —— 只收「格式串已经在 `@rich4/data` 的 `messages.ts` 里、
 * 且 core 在那一处**已经知道确切金额**」的那几条。
 *
 * | 键 | 格式串 | @source |
 * |---|---|---|
 * | `rent.payOneOwner` | `RENT.payOneOwner` | 0x00419d3e `push 0x4639b3` |
 * | `rent.payTwoOwners` | `RENT.payTwoOwners` | 0x00419d1a `push 0x46399a` |
 * | `rent.payChairman` | `RENT.payChairman` | 0x0041ae98 `push 0x463a31` |
 * | `rent.payBoss` | `RENT.payBoss` | 0x0041ae86 `push 0x463a6a` |
 * | `rent.freeSealed` | `RENT.freeSealed` | 0x0041d59f `push 0x463bb8` |
 * | `rent.freeAllied` | `RENT.freeAllied` | 0x0041d5d7 `push 0x463bcd` |
 * | `rent.freeReaper` | `RENT.freeReaper` | 0x0041d5fa `push 0x463be2` |
 * | `rent.freeHotel` | `RENT.freeHotel` | 0x0041d613 `push 0x463bf5` |
 * | `rent.freeVanished` | `RENT.freeVanished` | 0x0041d62c `push 0x463c08` |
 * | `rent.freePrison` | `RENT.freePrison` | 0x0041d645 `push 0x463c1b` |
 * | `rent.freeHospital` | `RENT.freeHospital` | 0x0041d65e `push 0x463c2e` |
 * | `rent.freeWinterSleep` | `RENT.freeWinterSleep` | 0x0041d67a `push 0x463c41` |
 * | `rent.freeSleepwalk` | `RENT.freeSleepwalk` | 0x0041d696 `push 0x463c54` |
 * | `rent.reaperPays` | `RENT.reaperPays` | 0x00419f04 `push 0x4639cc` |
 * | `facility.hotel` | `FACILITY_TOLL.hotel` | 0x0041a46e `push 0x4639ff` |
 * | `facility.mall` | `FACILITY_TOLL.mall` | 0x0041a4c4 `push 0x463a14` |
 * | `facility.gasStation` | `RENT.payChairman` | 0x0041a55d `push 0x463a31` |
 * | `points.50` / `points.30` / `points.10` | `MESSAGE_BOX.points*` | 0x0041b1c3 / 0x0041b25d / 0x0041b2e1 |
 * | `points.card` | `MESSAGE_BOX.got` | 0x0041b35d `push 0x463aa8` |
 * | `object.gift` | `MESSAGE_BOX.got` | 0x0041b956 `push 0x463aa8` |
 * | `object.treasure` | `MESSAGE_BOX.got500Points` | 0x0041bb4e `push 0x463ad3` |
 * | `beggar.alms` | `MESSAGE_BOX.alms` | 0x0041b656 `push 0x463ab1` |
 * | `thief.loot` | `MESSAGE_BOX.thiefLoot` | 0x0041ba0a 等五处 `push 0x463ac0` |
 * | `confinement.*` | `CONFINEMENT.{hotel,disappearing,prison,hospital,sleeping}` | 0x0040c912 一族的五处推串点 `0x4631e0`/`0x4631f5`/`0x46320a`/`0x46321f`/`0x463234` |
 *
 * ★ 免收那九种是 `0x0041d559`「九种免收」的全部：豁免成立时原版**先 `sprintf`
 *   一句、再弹同一个通用訊息框**（`0x41d6a4 push 0x5dc / call 0x440cac`）。
 *   ⚠️ 参数个数**三种**，照 `0x457110` 的推栈顺序来（详见 `reduce.ts` 的
 *   `confinementNoticeKey`）：查封与死神只有一个 `%s`（只有費名），
 *   同盟两个 `%s` 都是「先名字后費名」，其余四种是「地主名 + 費名」。
 */
export type NoticeKey =
  | 'rent.payOneOwner'
  | 'rent.payTwoOwners'
  | 'rent.payChairman'
  | 'rent.payBoss'
  | 'rent.freeSealed'
  | 'rent.freeAllied'
  | 'rent.freeReaper'
  | 'rent.freeHotel'
  | 'rent.freeVanished'
  | 'rent.freePrison'
  | 'rent.freeHospital'
  | 'rent.freeWinterSleep'
  | 'rent.freeSleepwalk'
  | 'rent.reaperPays'
  | 'facility.hotel'
  | 'facility.mall'
  | 'facility.gasStation'
  | 'points.50'
  | 'points.30'
  | 'points.10'
  | 'points.card'
  /** 小遊戲「不玩」白拿的點券（`0x00415472 push 0x463797`，2000 ms）—— `args[0]` = 點數 */
  | 'points.minigame'
  | 'object.gift'
  | 'object.treasure'
  | 'beggar.alms'
  | 'thief.loot'
  // 神明落脚顯靈（`fcn_0040f381` / `fcn_0040f8be`）—— 格式串见 `@rich4/data` 的 `GOD_MANIFEST`
  | 'god.build'
  | 'god.demolish'
  | 'god.seize'
  /** 衰神/死神拦下一次消费（`fcn_0040fa61`，`0x463514`，1500 ms）—— `args[0]` = 物件名 */
  | 'god.blockPurchase'
  /** 福神附身得卡（`0x0040ee13 push 0x4632fd`，1500 ms）—— `args` = [神明名, 卡名]；`cardId` 给台词配档 */
  | 'god.gotCard'
  /**
   * **大福神**附身得两张卡（`0x0040eed7 push 0x463353`，1500 ms）—— **一扇框、两张卡名**。
   *
   * `args` = [先抽到的卡名, 後抽到的卡名]（格式串里 `%s` 只出现两次，**不含神明名**：
   * 「大福神附身\n\n得到%s及%s！」自己写着神明名）⇒ 与 `god.gotCard` 的 args 形状不同。
   */
  | 'god.gotCardTwo'
  /**
   * **小衰神**附身丢一张卡（`0x0040f12c push 0x4633ab`「小衰神附身\n\n遺失%s！」，`0x0040f13e push 0x5dc` = 1500 ms，
   * `0x0040f148 call 0x440cac`）—— `args[0]` = 丢掉的卡名；手里没卡（`0x441e77` 返回 0）不弹。
   */
  | 'god.lostCard'
  /**
   * 路过 / 落在銀行格但被拒絕往來（`0x004379ef push 0x464bed`，**1000 ms**）—— `args[0]` = 还剩几天
   * = `(+0x3b & 0x7f) + 1`（@source `0x004379e6 and al,0x7f` / `0x004379ed inc eax`）
   */
  | 'bank.rejected'
  /**
   * 真人开 ATM 时正「銀行暫停放款」（`+0x3c != 0`）：ATM 窗 `0x401` 铺完面板后 `PostMessage(0x408)`
   * （`0x004370a5`），`0x408` 那一支 `0x00437123 push 0x464bd4`「銀行暫停放款\n\n還剩%d天！」+
   * `0x00437135 push 0x5dc`（1500 ms）`call 0x440cac` —— 框盖在 ATM 上。`args[0]` = `(+0x3c & 0x7f) + 1`
   * （`0x0043711b and al,0x7f` / `0x00437121 inc ebx`）。
   */
  | 'bank.frozen'
  /**
   * 董事長蒞臨商店的贈禮（`_rich4_ui_shop_entry` 0x0042e9f8 `push 0x464378`，
   * 訊息框 1500 ms）—— **在商店窗打开之前**弹，`args[0]` = 送出那件的名字。
   */
  | 'shop.chairmanGift'
  /**
   * ★ 回合開始時「被阻礙」那五扇框 —— 住宿／消失／坐牢／住院／冬眠。
   *
   * @source `fcn_0040c912`（VA 0x0040c912，`rich4.asm:6561`）对**当前玩家无条件**弹，
   *   不分真人与电脑；`args` = [`玩家名`, `剩余天数`]，天数 = `displayRemainingDays(raw, mask)`
   *   （消失用 `DISAPPEARING_MASK = 0x3f`，其余 `0x7f`）。
   *   模板见 `@rich4/data` 的 `CONFINEMENT`（`0x4631e0` / `0x4631f5` / `0x46320a`
   *   / `0x46321f` / `0x463234`）。
   */
  | 'confinement.hotel'
  | 'confinement.disappearing'
  | 'confinement.prison'
  | 'confinement.hospital'
  | 'confinement.sleeping'
  /**
   * ★ 魔法屋（2026-09-23）—— 效果派发 `0x431caa` 对**每个中签者**弹的那一扇
   * （`sprintf("%s\n\n", 名字)` + `strcat(效果名)` → `0x440cac(…, 0x5dc)`，如 0x00431cee..0x00431d23）。
   * `args` = [中签者名, 效果名]。
   */
  | 'magic.effect'
  /**
   * 魔法屋「得一張卡片」那一扇（`0x004320dd` 一支：`"%s\n\n"` + `sprintf("得到%s！", 卡名)`，0x00432122）。
   * `args` = [中签者名, 卡名]。
   */
  | 'magic.gotCard'
  /**
   * 电脑踩魔法屋：两个转盘都转完后先弹「条件\n\n效果」（`0x00433981..0x004339b8`，
   * 格式串 `0x464842 "%s\n\n%s"`，1500 ms），**然后**才进 `0x431caa` 逐人施加。
   * `args` = [条件名（去掉 `#00NN`）, 效果名]。真人那一支没有这一扇（女巫窗口就是它）。
   */
  | 'magic.spin'
  /**
   * ★ 第十四份：命運的**神明加持**那六扇（`fcn_0044b896` 写 `[0x48c5b8]`，调用方 1500 ms）——
   * `args[0]` = 神明名（`[0x47ed76 + god_info*4]`）。见 `@rich4/data` 的 `BLESSING`。
   */
  | 'blessing.rewardDouble'
  | 'blessing.rewardVoid'
  | 'blessing.penaltyDouble'
  | 'blessing.penaltyVoid'
  | 'blessing.misfortuneDouble'
  | 'blessing.misfortuneVoid'
  /**
   * ★ 第十四份：过路费的神明调整（`fcn_0041d709`，金额变了才弹，1500 ms）—— `args[0]` = 費名。
   * 小財神 `0x463c67` / 大財神 `0x463c80` / 小窮神 `0x463c95` / 大窮神 `0x463cae`。
   */
  | 'god.tollHalf'
  | 'god.tollFree'
  | 'god.tollPlusHalf'
  | 'god.tollDouble'
  /** ★ 第十四份：保險理賠（`fcn_0044ba63`，`0x4658fa`，**2000 ms**）—— `args[0]` = 理賠金额 */
  | 'insurance.payout'
  /** ★ 第十四份：被动卡亮牌「使用%s」（带 `card`）—— `args[0]` = 卡名 */
  | 'card.use'
  /** ★ 第十四份：嫁禍卡亮牌「%s\n\n嫁禍卡生效！」（带 `card`）—— `args[0]` = 出牌者名 */
  | 'card.scapegoatOn'
  /** ★ 第十四份：电脑嫁禍之后「嫁禍給%s！」（`0x004449df`，1500 ms）—— `args[0]` = 替死鬼名 */
  | 'card.scapegoatTo'
  // ── ★ 2026-09-23 框模板反查补齐（格式串见 `@rich4/data` 的 `NOTICE_BOX`；时长缺席 = 1500）──
  /** 惡人：小偷偷點券 `[受害者, 點數]`（0x0041c255，1000 ms）*/
  | 'npc.stealPoints'
  /** 惡人：奪卡 `[受害者, 卡名]`（0x0041c2ea，1000 ms）*/
  | 'npc.stealCard'
  /** 惡人：強盜搶銀行 `[总得款, 主人]`（0x0041c415，2000 ms）*/
  | 'npc.robBank'
  /** 惡人：流氓勒索 `[地主, 金额]`（0x0041c56e / 0x0041c692）*/
  | 'npc.protection'
  /** 惡人：間諜取走過路費 `[金额]`（0x0041c56e / 0x0041c692 的另一支）*/
  | 'npc.spyToll'
  /** 惡人：間諜取走盈餘 `[金额]`（0x0041c778）*/
  | 'npc.spySurplus'
  /** 航空公司轉盤 0「不用出國！」（0x0041abf0）*/
  | 'company.noTravel'
  /** 建設公司（真人）选地之前「%s\n\n請選擇欲加蓋地點」`[企業名]`（0x0041aa62 / 0x0041acf7）*/
  | 'company.pickBuildSite'
  /** 研究所研發完成 `[道具名]`（0x0041ce0e）*/
  | 'research.done'
  /** 認購之后易主：門派「恭喜您成為幫主！」/ 其余「恭喜您獲得經營權！」（0x0041d2aa）*/
  | 'shares.becameBoss'
  | 'shares.becameChairman'
  /** 电脑买 / 卖股 `[玩家, 股名, 张数]`（0x0042c78c / 0x0042d092）*/
  | 'stock.aiBuy'
  | 'stock.aiSell'
  /**
   * 股市柜台（客户端自己弹，core 不产出）：漲停不能买 / 跌停不能卖
   * （`0x0042af18` / `0x0042b04b push 0x800003e8` —— **1000 ms、右移 100**）
   */
  | 'stock.limitUpNoBuy'
  | 'stock.limitDownNoSell'
  /** 貸款屏进门时正暫停放款 `[还剩天数]`（0x004351f8，**右移 100**）*/
  | 'bank.loanFrozen'
  /** 电脑贷款 `[玩家, 金额]`（0x0043694b）*/
  | 'bank.aiBorrow'
  /** 电脑提前还清贷款 `[玩家, 金额]`（0x00436877，1500 ms）*/
  | 'bank.aiRepay'
  /** 回合开始、今天就是还款日「貸款到期日\n\n強制執行！」（0x00436aa5，1500 ms）—— 之后当场扣款 */
  | 'bank.loanDueForced'
  /** 回合开始、距还款日 1 天 / 2 天（0x00436ae9，1500 ms）*/
  | 'bank.loanDueOneDay'
  | 'bank.loanDueTwoDays'
  /** 銀行準備金不足、董事長垫付 `[缺口, 董事長]`（0x00436c1f，2500 ms）*/
  | 'bank.reserveShortfall'
  /** 特別融資收回：先「銀行經營權易主！」（0x00436ccb），再 `[玩家, 金额]`（0x00436cfd）*/
  | 'bank.chairmanChanged'
  | 'bank.forcedSpecialRepay'
  /** 电脑保釋 `[被保的人]`：監獄 0x0043d550 / 醫院 0x0043ebfc */
  | 'bail.prison'
  | 'bail.hospital'
  /** 自己的地升级但现金不够「您的現金不足！」（0x00419a5d）*/
  | 'land.cashShort'
  /** 購地卡现金不够「您的現金不足！」（0x004425fb）*/
  | 'card.cashShort'
  /** 搶奪卡（电脑）/ 命運生日（电脑寿星）`[受害者, 卡名]`（0x00441ab1）*/
  | 'card.robbed'
  /** 紅卡 / 黑卡（电脑）`[股名, 卡名]`（0x00444fdb / 0x00445154）*/
  | 'card.useOnStock'
  /** 查稅卡 `[被查的人, 税金]`（0x004453ef）*/
  | 'card.taxed'
  /** 电脑用道具 `[道具名]`（0x00448070）*/
  | 'tool.aiUse';

/**
 * 这一次加蓋是**谁**发起的 —— 决定表现层要不要先播大锤。
 *
 * @source 三个调用点各自的序列：
 *   · `robotWorker`（道具 9，VA 0x00447295）：`0x0044731a push 0x229` +
 *     `0x00447326 call 0x450441`（read_mkf）+ `0x0044735c call 0x45144f`
 *     ⇒ **先大锤，再（bit7 时）0x20b**；
 *   · `magicHouse`（魔法屋「就地加蓋房屋」，VA 0x00431f67 那一支）：
 *     `0x00432028 push 0x229` + `0x00432034 call 0x450441` + `0x00432074
 *     call 0x45144f` ⇒ 与機器工人**同构**（先大锤，再 0x20b）；
 *   · `angelCard`（天使卡 9，VA 0x004434c0）：整个函数里**没有** `push 0x229`
 *     / `call 0x450441` / `call 0x45144f` —— 它**只**在 bit7 时 `0x004436d4
 *     call 0x40b0cd` ⇒ **只播 0x20b，不播大锤**；
 *   · `companyBuild`（建設公司「免費加蓋一處」那一族落点，VA 0x0041ad7e 一带）：
 *     `0x0041ad99 call 0x45144f`（大锤）+ `0x0041adaa test byte [esp+0xbc], 0x80`
 *     → `0x0041adb4 call 0x40b0cd` ⇒ 与機器工人**同构**（先大锤，再 0x20b）；
 *   · `ownUpgrade`（**自己的地**落点问出来的「升級房子」，VA 0x004198b9 自有地分支）：
 *     这一段**不走 `0x40b110`**（`0x004199d1 inc byte [esi + 0x1a]` 直接加 1），
 *     函数体里也**没有** `push 0x229` —— 大锤全 exe 只有 **4** 处
 *     （`0x0041aab8` / `0x0041ad4d` / `0x00432028` / `0x0044731a`，见下），
 *     落点例程一处都不在其中。它只在等级刚好到 5 时
 *     `0x004199eb cmp byte [esi + 0x1a], 5` → `0x00419a21 call 0x40b0cd`
 *     ⇒ **只播 0x20b，绝不播大锤**。
 *
 * ★★ 补记（本次回 exe 复核发现，README 原记「bit7 全 exe 只有 3 个消费点」
 *   **不完整**）：`0x40b0cd`（播 0x20b 那一支）全 exe 共 **8** 个调用点，
 *   **8/8** 前面都是一条「剛好升到 5 級」的判据（bit7 的 `test …,0x80`，
 *   或 `0x004199eb cmp byte [esi+0x1a], 5` 这种内联同形）：
 *
 *   | `0x20b` 调用点 | 所在函数 | 它前面的判据 |
 *   |---|---|---|
 *   | `0x0040f517` | `0x0040f381` | `0x0040f50e test bh, 0x80` |
 *   | `0x0040fa26` | `0x0040f8be` | `0x0040f9fa test bl, 0x80` |
 *   | `0x00419a21` | `0x004198b9`（落点跳表的一块） | `0x004199eb cmp byte [esi+0x1a], 5`（内联） |
 *   | `0x0041ab63` | `0x0041a3be` 尾块 | `0x0041ab21 test byte [esp+0xbc], 0x80` |
 *   | `0x0041adb4` | `0x0041abde` | `0x0041adaa test byte [esp+0xbc], 0x80` |
 *   | `0x0043208f` | `0x00431f67` | `0x00432085 test byte [esp+0xa8], 0x80` |
 *   | `0x004436d4` | `0x004434c0` | `0x004436b5 test al, 0x80` |
 *   | `0x00447373` | `0x00447295` | `0x0044736d test byte [esp], 0x80` |
 *
 *   反向也成立：`0x40b110` 的 8 个调用点**逐一**对上前 7 条 + 0x4436ad，
 *   即**原版每一次 `0x40b110` 都有影片**（天使卡那条只播 0x20b）。
 *   故本引擎在**每一个**免费加蓋出口都记提示，客户端照段序播，不漏不重。
 *
 * ★ 大锤 `0x229` 的**全部** 4 个 `push` 点（`disasm.py find 6829020000`
 *   命中 4 处，无第 5 处）：`0x0041aab8` / `0x0041ad4d`（建設公司那一族）、
 *   `0x00432028`（魔法屋）、`0x0044731a`（機器工人）。⇒ 只有这三个 `source`
 *   播大锤；`angelCard` 与 `ownUpgrade` 都只播 0x20b。
 */
export type BuildUpgradeSource =
  | 'robotWorker'
  | 'magicHouse'
  | 'companyBuild'
  | 'angelCard'
  | 'ownUpgrade'
  /**
   * 神明顯靈加蓋（天使 `0x0040f381` / 福神 `0x0040f8be`）：两支里都**没有** `push 0x229`，
   * 只在 bit7 时 `0x0040f517` / `0x0040fa26 call 0x40b0cd` ⇒ 只播 0x20b、不播大锤。
   */
  | 'godManifest'
  /**
   * **付费首建設施**（落点问出来的「蓋設施」，`0x0041a240` 那一支的 `0x0041a27c`）：
   * 等级 0 → 1、**不置 bit7**、没有 `0x229`，但**要响** `Effect.mkf` 50
   * （`0x0041a289 push 0x4823da / call 0x4542ce`）。
   * ⇒ 它是第 4 个（也是最后一个）顯靈音效点；`buildFxPlan` 对它**不播任何影片**。
   */
  | 'facilityFirstBuild';

/** 一次「加蓋一级」的事件记录（纯表现；见 `GameState.lastBuildUpgrades`）*/
export interface BuildUpgradeHint {
  /**
   * 被加蓋的**实体编码**（原版 `0x40b110` 的入参）：
   * · `0x7d0 + 地块下标` = 住宅/連鎖店；
   * · `0xfa0 + 設施下标` = 公園/旅館/購物中心/加油站/研究所。
   * @source `0x40b117 cmp edx, 0x7d0` / `0x40b11f cmp edx, 0xfa0`
   *
   * ⚠️ `ownUpgrade`（落点问出来的付费升級，`0x004198b9` 自有地分支）在原版里
   *   **没有** `0x40b110` 这个入参（它直接 `inc byte [esi + 0x1a]`）。
   *   这一格仍按同一个编码填 `0x7d0 + 地块下标`，只为让消费方有个统一的标识；
   *   `buildFxPlan` 并不读它。
   */
  entity: number;
  /**
   * ★ `0x40b110` 返回值的 **bit7** = 剛好升到 5 級
   *   （`BuildResult.reachedMaxLevel` / `buildUpgradeBit7`）。
   */
  reachedMaxLevel: boolean;
  /** 谁发起的（决定要不要先播大锤 0x229） */
  source: BuildUpgradeSource;
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
   * 地图视角旋转档位 **0..7**（`<` / `>` 两个热键改变）。
   *
   * @source `[0x499088]`，见 `rich4-spec/docs/systems/animation.md`
   *   （已结案：**是地图视角档位，不是动画帧计数**）与 `save-format.md` 的块序表 `+0x2743`。
   * ★ **它是持久状态**：原版会把它存进存档（`0x0040330d` 一带写出、
   *   `0x00402e6d` 读回），所以读档后视角要恢复。
   * ⚠️ 渲染层怎么用它属于表现层（`map.ts` 的「朝向 + 固定基」画法），
   *   本字段只负责**状态与存档**这一半。
   */
  viewRotation: number;

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
   * 本局的**人类玩家数** `[0x499104]` —— 终局码要读它，**开局算一次、之后不变**。
   *
   * ★★ 为什么必须存、不能现数（2026 本轮差分实证）：
   *   原版只在**新局**写它（`0x407166` 清零、`0x407250 inc` 按
   *   `player[i].+0x64 & 1` 计数），此外只有存档装载会恢复
   *   （`0x402b81`/`0x40307d push 0x499104`）。
   *   **破产处理 `0x40cd87` 不写它** —— 实测：2 人局里把 0 号破产后
   *   `[0x499104]` 仍是 2，而 `whoPlays==1` 的人数已掉到 1。
   *   原版结算读的是那个**不变的全局**（`0x41d96e cmp [0x499104],1`），
   *   所以「2 个人类里有 1 个先破产、之后靠时间/资产结束」这一局
   *   终局码是 **3（多人）**，不是 2。
   *   ⇒ 复刻若按 `whoPlays` 现数，会在这种局里走错结局分支。
   *
   * @source 计数点 `0x407250`、唯一读判 `0x41d96e`；存档块 `0x01b0`。
   */
  humanPlayers: number;

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
    kind: 'news' | 'fortune' | 'magicHouse' | 'minigameDecline';
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
     * ★ 新聞「随机挑一处建筑」那一族（5 外星怪獸 / 15 瓦斯爆炸 / 19 山洪 / 20 超級颱風 /
     *   21 龍捲風）**挑中的那一处**：`entity` = 实体编码（`0x7d0 + 地块 id` /
     *   `0xfa0 + 設施 id`，与原版 `[0x48c59c]` 同一套编码），`owner` = **改之前**的
     *   主人（1 基，0 = 无主；原版在 pass 0 就把 `byte [实体 + 0x19]` 存进 `[0x48c5a0]`）。
     *
     * @source 以新聞 21 `fcn_0044ac99` 为例：pass 0 `0x0044acbd rand() % (地块数 + 設施数)`
     *   → `0x0044acfe strcpy(buf, 实体 + 4)`（名字）→ `0x0044ad79 [0x48c5a0] = owner`
     *   → `0x0044ad90 sprintf("#0170龍捲風侵襲%s…", 名字)`；pass 1 `0x0044add3 0x40af12(实体)`
     *   → `0x0044aded view_to(x, y, 2)` → `0x0044adfe mutate_land(实体, 0)` → 影片 0x217 …
     *   → `0x0044ae4a owner != 0` 才让房主说一句。
     *
     * 表现层要它：訊息框里 `%s` 是**这个地名**（不是人名），镜头要移过去，房主要说话。
     * 纯表现提示（与本字段所在的 `lastEvent` 一样不参与任何规则判定）。
     */
    place?: { readonly entity: number; readonly owner: number };
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
    /**
     * ★ 小游戏「不玩」那一支（`kind === 'minigameDecline'`）：**选中的台词下标 0 或 1**。
     *
     * @source `0x004154b6`–`0x004154cf`：
     * ```asm
     * 004154b6  call 0x456f2d                        ; ★ 第二次 rand()
     * 004154bb  and  eax, 1
     * 004154be  mov  esi, dword ptr [ebx + eax*4 + 0x48084a]  ; 角色台词表[角色][0 或 1]
     * 004154cf  call 0x44ef41                        ; player_say
     * ```
     * 即台词取自**角色台词表 `0x48084a` 的事件 0／1**（好消息那两条）。
     * 这一支**电脑玩家也会走**，所以那两次 `rand()` 与谁在玩无关。
     *
     * ★ 第十四份：`kind === 'fortune'` 时是命運 9 / 10 / 11 / 32 施加后当前玩家那一句的事件号
     *   （9 → 5、10 → 3|4（`0x0044cb28` 的 `rand()&1`，core 掷）、11 → 3、32 → 3）；被神明挡掉就不带。
     */
    phraseIndex?: number;
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
   * **上一次用出的卡**（出牌者 + 卡号）—— 纯表现提示，见 `CardPlayHint`。
   *
   * 消费者：`client/src/speech.ts` 的 `cardPlaySpeech()`（用卡时角色说那句话）
   * ⇒ `speech-bubble.ts` 的 `cardLineBubbleOf()`（显示 + 语音）。
   */
  lastCardPlay: CardPlayHint | null;

  /**
   * ★★ **上一次用出去的道具**（用的人 + 道具号）—— 纯表现提示，与 `lastCardPlay` 同一套规矩
   *   （不进指纹/存档/history；**真的用出去了**才写）。
   *
   * 消费者：`client/src/speech.ts` 的 `toolUseSpeech()` —— 原版 13 件道具在用的那一下
   * 都 `player_say(角色, 0, _tool_strings[角色][道具号−1])`，而且**在 human/AI 分流之前**。
   *
   * 第十一份試玩回報 #3（`feedback/20260922-200005`）：「NPC放置炸弹、定时炸弹时好像也有台词」
   *   —— 这条通道先前整个没接（`DETECTORS` 只覆盖状态跃迁类台词）。
   */
  lastToolUsed: ToolUseHint | null;

  /**
   * ★★ **这一笔过路费把哪些地块算了进去**（地块 id，含同盟那一份）—— W-69。
   *
   * 原版在弹费用訊息框**之前**，把 id 图上这几格标 `0xffff` 再闪 16 帧
   * （`0x00419b9e` / `fcn_00451985`：亮度表 `0x476380`、每帧 30 ms、之后静 400 ms；
   * 块数 ≤ 1 时整段跳过 —— `0x00419c79 cmp [esp+0xe8],1 / jle`）。
   * 需求方看不到这段演出，才以为「四块同街的地只算了一块」。
   *
   * 规矩与 `lastCardPlay` / `lastViewTarget` 同一套：**纯表现、不进指纹/存档、
   * 只活一条 action**（`reduce` 出口按引用相等清成 null）。
   * 只有 `counted.length > 1` 才写，否则 null（原版那时不演）。
   */
  lastTollLands: number[] | null;

  /**
   * ★★ **这一次樂透開獎开出了什么** —— 纯表现提示，见 `LotteryDrawHint`。
   *
   * 消费者：`client/src/lottery-draw-screen.ts` 的 `lotteryDrawCue()`（开奖屏的号码球、
   * 中央大号数字、得主、持号表）。规矩与 `lastTollLands` 同一套：**纯表现、不进指纹/存档、
   * 只活一条 action**（`reduce` 出口按引用相等清成 null）。
   * 只在原版**真的开屏**时写（至少卖出一张票，`0x00431729 cmp eax,0x24 / je` 那道闸之内）。
   */
  lastLotteryDraw: LotteryDrawHint | null;

  /**
   * ★ **魔法屋逐人的演出分段**（D-MAGIC-16，2026-09-23）—— 纯表现提示（不进指纹、不进存档），
   * 只活一条 action（`reduce` 出口按引用相等清成 null）。缺席 / `null` = 这一条不是魔法屋。
   *
   * @source 效果派发 `0x431caa` 的逐人循环（`0x004320b4..0x004320aa`）：每位中签者整支演完
   *   （闸 → `0x41906a(1)` 重画 → 訊息框 → 镜头 / 影片 → 台词）才轮到下一位；「抽取命運三張」
   *   每一张（`0x00431dbc` 循环 `0x44db81`）也是一段完整的命運演出。
   *   core 一条 action 就把整趟写完了，所以把**每一段前后的完整状态**交给表现层逐段演
   *   （段里的 `currentPlayer` = 那位中签者，同原版 `0x004320c9`）。电脑那一支第一段是
   *   「条件\n\n效果」那一扇（`0x004339bd`）。
   */
  lastMagicBeats?: readonly MagicBeat[] | null;

  /**
   * ★ **回合开始被挡时这一回合说了哪几句**（事件 19 坐牢 / 20 住院 / 21 冬眠）—— 纯表现提示
   * （不进指纹、不进存档），只活一条 action。缺席 / `null` = 这一条不是被挡的回合开始。
   *
   * @source `fcn_0040c912`（主循环 `0x00418d70 push 0` 那一路）：三个计数各自非零时**各掷一次**
   *   `rand()`，`test al,1` 为真才说 —— 坐牢 `0x0040ca20`、住院 `0x0040ca99`、
   *   冬眠 `0x0040cb1b`（冬眠还要 `dword [+0x32] == 0`，即住宿/消失/坐牢/住院全为 0，`0x0040cb12`）。
   *   这几次 `rand()` 与游戏逻辑共用同一个发生器 ⇒ 在 core 里掷，所有客户端一致。
   *   （第十三份試玩回報，需求方拍板「按原版 1/2 概率」）
   */
  lastBlockedSays?: readonly number[] | null;

  /**
   * ★★ 第二十一份：**这一次月结的现场**（见 `MonthlySettleHint`）—— 纯表现提示（不进指纹、不进存档），
   * 只活一条 action（`reduce` 出口按引用相等清成 null）。缺席 / `null` = 这一条没有跨月。
   * 消费者：`client/src/monthly-screen.ts`。
   */
  lastMonthlySettle?: MonthlySettleHint | null;

  /**
   * ★ 第十四份（2026-09-23）：**这一条 action 里原版调了「進帳」档位函数 `fcn_0044f354` 的那几笔**
   * —— 纯表现提示（不进指纹、不进存档），只活一条 action。缺席 / `null` = 这一条没有。
   *
   * `0x44f354`（事件 6/7/8）全 exe 只有 6 个调用点，除大財神那一处（`0x0040ed85`，
   * 走 `lastGodPower`）外都在这里交出去：
   *   - `0x00419fa1` / `0x00419ff0`：過路費的**地主**（有同盟时只算地主那一份，同盟那份不说）；
   *   - `0x0041a735`：設施費的主人；
   *   - `0x00449a80`：新聞 8/9/10 的受奖人；
   *   - `0x0044d334`：命運「進帳」那一族（20/21/22/25/27/28/29/31）没被神明作廢时。
   * 金额 = 原版压给 `0x44f354` 的那个数；档位由表现层分（`gainEventFor`）。
   */
  lastGainSays?: readonly { player: number; amount: number }[] | null;

  /**
   * ★ 第十四份：**「消失」那一刻当事人说的那一句**（`fcn_0040d375` 的 `0x0040d3f8 call 0x44f2c2(玩家, 天数)`，
   * 小额损失那一族 3/4/5；天数 4..6 那一档的 `rand()&1` 在 core 用同一个发生器掷）—— 纯表现，只活一条 action。
   * 命運 6/7（出國 / 綁架）与航空公司的旅遊（`0x0041b05a`）共用。
   */
  lastDisappearSay?: { player: number; event: number } | null;

  /**
   * ★★ 第十八份（「怎么拍卖直接流标了」）：**这一条 action 里落槌的拍卖**（先后照落槌次序）——
   * 纯表现提示（不进指纹、不进存档），只活一条 action。缺席 / `null` = 这一条没有。
   *
   * 为什么要它：拍賣屏先前靠**屏内自己记**「最后一口是谁加的」推结果 —— 电脑那几口若不是本屏
   * 发的（单机回合驱动抢先答掉、联机由服务器出），屏就记不到 ⇒ 明明成交却演成「無人出價，宣佈流標。」。
   * 另外「一开拍就全体不可出价」在 reducer 里当场流标，pending 从没挂出来 ⇒ 屏根本不开；
   * 原版那种情形照样开窗、再弹「無人出價，宣佈流標。」（`0x0043b2c5`..`0x0043b2cd push 0x465063`）。
   *
   * `pending` = 落槌那一刻的那一份（开拍即流标时就是开拍那一份，座位状态照 `openAuction`）。
   */
  lastAuctionResults?: readonly AuctionResultHint[] | null;

  /**
   * ★★ **这一次 action 要把镜头移到哪里**（`view_to`，@source VA 0x0041d476）。
   *
   * 纯表现提示（不进指纹、不进存档）—— 与 `lastCardPlay` / `notices` 同一套规矩。
   *
   * ★ **只活一条 action**：`reduce` 出口会把「本 action 改动了状态、却没新写本字段」
   *   的那些情况清成 `null`（见 `reduce` 里那一段注释）。所以表现层看到非 null，
   *   就一定是**刚刚这条 action** 设的，直接照做即可。
   *
   * ## 原版语义（W-54 的首席取证）
   * ```
   * view_to(x, y, flags):
   *   flags & 1  ⇒ 只按上一次的中心重画（0x40829d(-1, 0)），**不动镜头**
   *                 —— 表里实参是 0,0,1 的那 38 处全部属于这一类 ⇒ 忽略
   *   否则：
   *     (x, y) == 当前行动者坐标 ⇒ 清标记 [0x48be18] = 0
   *     不等                     ⇒ [0x48be18] = 1、[0x48be1c]/[0x48be20] = (x, y)
   *     然后 fcn_00415e70 居中（**有标记用标记**）
   * ```
   * `refresh_screen`（`0x0041d546`）一律把标记清 0 ⇒ 镜头回到行动者。
   *
   * ★ 这与小地图点选用的是**同一个**标记（本引擎的 `minimapMarker`），
   *   所以客户端只要把它写进 `minimapMarker`、收屏时清掉，不必另做一套镜头。
   */
  lastViewTarget: { x: number; y: number } | null;

  /**
   * ★ **这一次落点顯靈时那位神明说的那句话**（W-55 行 6）—— 纯表现提示。
   *
   * 消费者：`client/src/speech.ts` 的 `detectLuckyGodLine()`。
   *
   * ## 为什么要有它
   *
   * 福神 `fcn_0040f8be` 在自己地升級成功、且**没到 5 级**那一支里用
   * `rand() & 1` 在**两句**台词里随机二选一：
   *
   * ```asm
   * 0040fa30  xor  ebx, ebx
   * 0040fa32  mov  bl, byte [eax + 0x496b7b]        ; 角色号（+0x13）
   * 0040fa44  shl  eax, 3 / 0040fa47 add ebx, eax    ; ebx = 108 × 角色
   * 0040fa49  call 0x456f2d                          ; ★ rand()
   * 0040fa4e  and  eax, 1
   * 0040fa51  mov  esi, [ebx + eax*4 + 0x48084a]     ; 角色台词表[角色][0 或 1]
   * 0040fa5b  push edi / 0040fa5c jmp 0x40ecde       ; player_say
   * ```
   *
   * 本引擎的对应物是 `luckyGodBonus()`：它**已经把那次 `rand()` 消费掉**
   * （`reduce.ts` 那条 `rng.next()`）却只把 `rngState` 写回去 —— 客户端拿不到
   * 「摇到 0 还是 1」，于是这一句复刻不出来。本字段就是把那个结果交出来。
   *
   * ★ **与 `lastCardPlay` / `notices` 同一套规矩**：不进 `stateFingerprint`
   * （`net/protocol.ts` 的形参是显式列字段的结构类型）、不进存档、不进 `history`；
   * 「本 action」的判据是**引用相等**（`luckyGodBonus` 每次新建一个对象）。
   * `reduce` 出口把「没新写本字段」的那些情况清成 `null`（与 `lastViewTarget` 同一处）。
   *
   * ⚠️ **只覆盖福神那支的随机二选一**。土地公顯靈那一句是**固定**的事件 0
   *   （`0x0040f8a0 mov ebp,[…表…+0]`，见 `docs/escalations.md` E-18 的订正），
   *   客户端直接从 `god.seize` 訊息框认出来即可，不需要本字段。
   */
  lastGodLine?: GodLineHint | null;

  /**
   * ★ **这一次神明發威掷出来的金额**（W-55 行 7）—— 纯表现提示。
   *
   * 消费者：`client/src/speech.ts` 的 `detectSmallWealthLine()` / `detectBigWealthLine()`。
   *
   * ## 为什么要有它
   *
   * 財神那两支的**额外台词**都以那个「转盘摇出来的数」为闸门，而那个数不在
   * 任何持久字段里（`godPowerOf` 掷完就丢，只把 `rngState` 写回）：
   *
   * ```asm
   * ; 小財神：金额 > 0x2bc（700）才说事件 8（角色台词表 +0x48086a = 事件 8）
   * 0040eca4  cmp esi, 0x2bc / 0040ecaa jle 0x40ece6
   * 0040ecac  cmp byte [0x46caf8], 0 / jne 0x40ece6   ; ★ 终局码非 0 就不说
   * 0040ecd3  mov esi, [ebx + eax*8 + 0x48086a]
   * 0040ecde  call 0x44ef41
   * ; 大財神：金额 ≥ 5000 × 物價 才走「進帳」档位函数
   * 0040ed74  cmp esi, eax / 0040ed76 jl 0x40ece6
   * 0040ed85  call 0x44f354
   * ```
   *
   * ★ 两条规矩与 `lastGodLine` 完全一样（引用相等 = 本 action、不进指纹/存档）。
   */
  lastGodPower?: GodPowerHint | null;

  /**
   * **这一次進商店时董事長送的那一件**（W-67-a）—— 纯表现提示。
   *
   * @source `_rich4_ui_shop_entry` `0x0042e9a0..0x0042ea23`：送成了才
   *   `call 0x44f230(玩家, 那件的**點數价**)`（「好消息」台词阶梯，与 W-55 的
   *   `pointsGained` 同一支 `fcn_0044f230`）。金额取**点数**（不是现金价）。
   * 两条规矩与 `lastGodLine` 一样：引用相等 = 本 action、不进指纹/存档。
   */
  lastShopGift?: ShopGiftHint | null;

  /**
   * **这一次落点要弹的棕色訊息框**（可能不止一条）—— 纯表现提示，见 `NoticeHint`（issue #18）。
   *
   * 消费者：`client/src/notice-box-screen.ts`（`screens.ts` 登记为 `'notice'`，
   * 并进了 `main.ts` 的 `BLOCKING_PRESENTATIONS` ⇒ 每扇 1500 ms 内回合驱动会等它）。
   *
   * ★★ **为什么是数组而不是单个字段**：原版在**一条 action** 里会连弹两扇框 ——
   *   住宅收租那一路先弹租金框（`0x00419d50 push 0x5dc / call 0x440cac`）
   *   **再**弹死神框（`0x00419f16` 同一个调用）；設施那一路同理
   *   （`0x41a56f` 之后 `0x41a6f2`）。单个字段会把第一扇顶掉。
   *   数组按**弹框顺序**排，客户端一条一条放。
   *
   * ★ 只在**真的弹**的那一刻写（与 `lastCardPlay` 同一条规矩）：
   *   空数组 = 这一条 action 没有付费框，客户端就不起播。
   *   数组的**引用**就是判据：`reduce` 每弹一次都新建一个数组，
   *   没弹的 action 一路 `{...state}` 把原引用带过来。
   */
  notices: NoticeHint[];

  /**
   * **本 action 里发生过的「加蓋一级」** —— 纯表现提示（C-DET-4）。
   *
   * ★ 两个来源都记在这里：
   *   · **免费加蓋**（`0x40b110` 那一族：機器工人 / 魔法屋 / 天使卡 / 建設公司），
   *   · **自己的地块上付費升級**（落点例程 `0x004198b9` 自有地分支，
   *     `source = 'ownUpgrade'`；它不走 `0x40b110`，只 `inc byte [地块+0x1a]`）。
   *
   * ★ 为什么要有它（README §7.142(5) E6）：`0x40b110` 的返回值带两条契约 ——
   *   **bit0 = 成了 / bit7 = 剛好升到 5 級**。全 exe 里 bit7 被消费在
   *   `0x00432085`（魔法屋就地加蓋）、`0x004436b5`（天使卡 9）、
   *   `0x0044736d`（機器工人 9）等处，后果是**再接播 Data.mkf 0x20b
   *   （66 帧 440×440 / 每帧 42 ms）+ 音效 `Effect.mkf` 0x5a + 一句台词**。
   *   先前客户端是**自己比较地块等级**算出这条 bit 的（`build-fx.ts` 的
   *   `reachedMaxLandLevel`，且注释把「設施支不置位」写反了）—— 那是把规则
   *   抄进表现层（违反 C-ARC-2）。现在改由 core 写、客户端只读。
   *
   * ★ **纯表现，不参与任何规则判定**：
   *   - core 里没有任何规则读它（只有写入点与装配点）；
   *   - **不进 `stateFingerprint`**（`net/protocol.ts`）：那里的形参是一个
   *     **显式列字段**的结构类型，本字段不在其中，故天然被排除 ——
   *     `state/reduce.test.ts` 有一条用例钉住这件事（谁日后把指纹改成
   *     `JSON.stringify(state)` 之类，那条用例会当场红）；
   *   - **不进 `history`**（action 日志里没有它）。
   *   ⚠️ 已知的既有口径（`lastNpcWalks` / `lastCardPlay` 同病，非本次引入）：
   *     `rules/time-machine.ts` 的 `takeSnapshot` 是 `JSON.stringify(state)`，
   *     所以这个瞬态字段**会**随快照一起回滚。它不影响任何规则判定。
   *
   * ★ **「本 action」的判据是引用相等**：`state.lastBuildUpgrades` 只有在
   *   真的发生了加蓋时才是一个**新数组**，于是
   *   `state.lastBuildUpgrades !== before.lastBuildUpgrades` 就等价于
   *   「这一条 action 里有加蓋」。表现层据此起播，不需要看 action 种类。
   *
   * ★ **可选**（`?`）是**有意**的：`GameState` 还由 `rules/new-game.ts` 与
   *   `loaders/savegame.ts` 逐字段装配，而那两个文件不在本次改动的范围内。
   *   于是本引擎遵守一条更宽的约定：**只要有写入点就整份覆写，缺席 = 没有**。
   *   读取方一律用 `state.lastBuildUpgrades ?? []`。
   */
  lastBuildUpgrades?: readonly BuildUpgradeHint[];

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
   * **排队中的后续拍卖** —— 一次流程里要连开好几场时用它。
   *
   * ★ 原版的拍卖 `0x43bde5` 是**阻塞式**的：调用它就跑完一整场
   *   （含窗口、出价、落槌）才返回。所以原版可以在一个循环里连开多场：
   *   · 破产清算 `0x40d1d5..0x40d20f` —— 释放地产 > 3 处时随机挑 3 处连拍；
   *   · 魔法屋「拍賣」结果 `0x4324d5` —— 每位中签者一场。
   *   本引擎的拍卖是**待决交互**（`pending`），同一时刻只能挂一场，
   *   于是同一流程里的其余场次排在这里，前一场落槌时自动接上
   *   （见 `state/reduce.ts` 的 `startAuction` / `settleAuctionExplicit`）。
   *
   * 空数组 = 没有排队的拍卖（绝大多数时候）。
   */
  pendingQueue: AuctionRequest[];

  /**
   * ★ 推日期（`0x41cf67`）里开出了拍卖（分紅打破產的下線拍卖）时，新当前玩家的回合边界
   * `0x41c84f`（还款日检查 / 阻碍计数 / 神明任期…）要等那串拍卖打完才走 —— 原版拍卖是阻塞调用，
   * `0x419039 call 0x41c84f` 排在 `0x41902e call 0x41cf67` 之后。这里记下「打完之后给谁走」；
   * 缺省 / `null` = 没有押着的。
   */
  deferredTurnStart?: number | null;

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

/**
 * 这一位**还没上盘**吗（开局之后、自己第一个回合之前）。
 *
 * @source 回合游标 `0x00418fee..0x00419006`：
 * ```asm
 * 00418ff5  cmp byte [player + 0x15], 0     ; who_plays
 * 00418ffc  jne 收下
 * 00418ffe  cmp word [player + 0x08], 0     ; xpos
 * 00419006  jne 跳过                         ; ★ who_plays == 0 且 xpos != 0 才是出局者
 * ```
 *   ⇒ `who_plays == 0 且 xpos == 0` 的人**照样轮到**；轮到时镜头函数 `0x0040829d`
 *   见 `(x, y) == (0, 0)`（`0x004082c9` / `0x004082d1`）就把他摆上盘。
 * ★ 另加一条 `landingWhoPlays != 0`：原版里出局者一定已经上过盘（xpos 非 0），这一格把
 *   「测试工厂 / 旧存档里 `whoPlays = 0` 又没填坐标的出局者」排除掉，免得被当成没上盘的人
 *   复活；破产会把这一格清成 0（`memset` 覆盖 +0x64）。在原版可达的局面上两种判据等价。
 */
export function isUnplaced(p: Player): boolean {
  return p.whoPlays === 0 && p.xpos === 0 && (p.landingWhoPlays ?? 0) !== 0;
}

/** 还在这一局里：在场，或还没上盘（等自己的第一个回合落地）*/
export function isInGame(p: Player): boolean {
  return isAlive(p) || isUnplaced(p);
}

/** 该玩家此刻由 AI 操作吗（电脑玩家，或被托管的人类） */
export function isAiControlled(p: Player): boolean {
  if (!isAlive(p)) return false;
  // ★★ 第 160 条订正（README §7.142(5) 的 A7）：原版判「电脑」用的是**位掩码 6**
  //   —— 任何读 `+0x15` 判电脑的地方都是 `test byte [player+0x15], 6 / je 真人`：
  //   ```asm
  //   0043c5fa  test byte ptr [player + 0x15], 6   ; ★ 拍卖开拍给电脑定价位
  //   0040b1ad  test byte ptr [player + 0x15], 6   ; ★ 設施首建随机种类
  //   ```
  //   ⇒ `whoPlays == 3`（bit0|bit1）也算**电脑**（3 & 6 = 2），
  //   带托管位（0x04）或走回棋盘位（0x10/0x20）的人也算电脑。
  //   ⚠️ 旧实现写 `(whoPlays & 3) === 2`（先看托管位、再比低 2 位）：
  //   `1 | 0x10`（真人 + 走回棋盘）会被判成**真人**，而原版是电脑
  //   ⇒ 少掷 2 个随机数、全局随机流错位。
  //   ★ 可达性：复刻内部写不出 3（`setAi` 白名单、`newGame` 只给 1/2、
  //   `confinement` 的 `& 0x0f` 都到不了），但**读档**会原样搬进 3
  //   （`loaders/savegame.ts`）⇒ 不能假定不可达。
  return (p.whoPlays & (WHO_PLAYS_COMPUTER | WHO_PLAYS_AUTOPILOT)) !== 0;
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
