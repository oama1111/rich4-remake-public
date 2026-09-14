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
import type { MapObject } from '../cards/summon.ts';

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
  /** 现金，可为负 @source player_info +0x1c (int32) */
  cash: number;
  /** 银行存款（含特别融资） */
  moneyInBank: number;
  loan: number;
  /** 特别融资 @source player_info +0x28 special_finance */
  specialFinance: number;
  /** TODO: semantics unknown @source player_info +0x2c —— 贷款还清时被清零 */
  f44: number;
  points: number;
  blocking: BlockingDays;
  /** 被银行拒绝放贷的剩余天数 @source player_info +0x3b days_rejected_by_bank */
  daysRejectedByBank: number;
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
  /** 移动中遇到岔路，等待选择方向 */
  | 'awaitingDirection'
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

  /** 本次掷骰的点数明细；未掷骰时为空 */
  dice: number[];
  /** 剩余步数 @source [0x48baf8] */
  stepsRemaining: number;
  /** 本次掷骰的总步数 @source [0x48bafc] */
  stepsTotal: number;

  /** 牌堆各卡剩余张数，下标 = 卡片 id - 1 */
  cardAmount: number[];

  /**
   * 地产归属：下标 = 地块 id，值 = 拥有者 index + 1（0 表示无主）。
   * 与地图静态数据分离，便于快照与比对。
   */
  landOwner: number[];
  /** 地块等级（0..5，`< 5` 才可续建 @source fcn_0040b110） */
  landLevel: number[];

  /** 回合序号，从 0 开始 */
  turnCount: number;

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
  lastEvent: { kind: 'news' | 'fortune'; id: number } | null;

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
