/*
 * 游戏状态定义
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * C-ARC-1：零依赖。C-DET-3：金额一律整数。
 * C-ARC-4：状态里**不记录「谁是本地玩家」**——本地/远程/AI 的差异只体现在
 *          action 的来源，不影响规则执行。这是联机免改造的前提。
 */

import type { GameMode } from '../rng/policy.ts';

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
  /** 各道具持有量，下标 = 道具 id - 1 */
  tools: number[];
  /** 冬眠天数累计 @source player_info +0x42 total_winter_sleep_days */
  totalWinterSleepDays: number;
  /** 同盟对象：0 表示无，否则为玩家 index + 1 */
  alliedPlayer: number;
  alliedDays: number;
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
