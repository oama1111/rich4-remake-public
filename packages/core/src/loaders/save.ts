/*
 * 大富翁4 存档解析器
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 布局来源：`rich4-re/csrc/loadsave.c` 的 load_checkpoint()，逐个 fread 推导而得。
 * 与 `rich4-re/docs/saveload.txt` 记载的三个锚点完全吻合：
 *   玩家数 @0x0C、玩家表 @0x10、卡片 @0x654、道具 @0x690
 */

/* C-ARC-1：零依赖，输入是字节数组 */

// ============================================================
//  尺寸常量
// ============================================================

/** 玩家结构大小 @source rich4-re/asm/rich4_player_info.h（字段偏移累加恰为 0x68） */
export const PLAYER_INFO_SIZE = 0x68;
/** 存档固定容纳 4 个玩家槽位 @source loadsave.c: fread(players, sizeof(player_info), 4, fp) */
export const MAX_PLAYERS = 4;
/** 特殊玩家 @source rich4_player_info.h special_player_info */
export const SPECIAL_PLAYER_SIZE = 0x10;

/**
 * 一个替身记录（`special_player_info`，16 字节）。
 *
 * @source `rich4-re/asm/rich4_player_info.h:81-97`：
 * ```c
 * uint16_t xpos, ypos, node_id, last_node_id;   // +0/+2/+4/+6
 * uint8_t owner;                                 // +8（保釋他的人 / 機器娃娃的使用者）
 * uint8_t direction;                             // +9
 * uint8_t f10, f11;                              // +10/+11（语义未明）
 * uint8_t days_winter_sleep;                     // +12 → 本引擎 `hibernating`
 * uint8_t days_sleep_walking;                    // +13 → `sleepwalkDays`
 * uint8_t days_stopping;                         // +14 → `halted`
 * uint8_t days_tortoise_walking;                 // +15 → `singleStep`
 * ```
 * ★ `x/y` 只给动画做插值，本引擎由 `nodeId` 现算（C-ARC-2）；
 *   「还剩几步」(`stepsRemaining`) **不在这 16 字节里**（它是全局 `[0x48baf8]`）。
 */
/**
 * 一条持仓记录 —— 与 `places/stock.ts` 的 `StockHolding` 同构。
 * @source `rich4_stocks.h` 的 `player_stock_info`：`int amount; int _;`
 *   ★ 第二个 int 实测是 **float 成本均价**（见 `places/stock.ts` 的注释）
 */
export interface StockHoldingRecord {
  amount: number;
  avgCost: number;
}

export interface SaveSpecialPlayer {
  x: number;
  y: number;
  nodeId: number;
  lastNodeId: number;
  owner: number;
  direction: number;
  f10: number;
  f11: number;
  hibernating: number;
  sleepwalkDays: number;
  halted: number;
  singleStep: number;
}
export const SPECIAL_PLAYER_COUNT = 5;
/** 地图物件 @source rich4_load_map.asm（0x450 字节 / 0x2e 项） */
export const OBJECT_INFO_SIZE = 0x18;
export const OBJECT_INFO_COUNT = 0x2e;
/** 每个玩家的逐回合快照 @source loadsave.c: fread(0x48cb80 + i*0x2718, 0x2718, 1, fp) */
export const PLAYER_SNAPSHOT_SIZE = 0x2718;
/** 每人持仓的股票支数（12 支）@source `player_stock_info[4][12]` */
export const STOCKS_PER_PLAYER = 12;

/** 卡片种类数 */
export const CARD_TYPE_COUNT = 30;
/** 每个玩家的卡片/道具槽位数（60 = 4 玩家 × 15 槽） */
export const PLAYER_SLOT_BYTES = 0x3c;

// ============================================================
//  字段偏移（由 loadsave.c 的 fread 序列逐个累加得出）
// ============================================================

export const OFFSET = {
  identifier: 0x0000,
  date: 0x0004,
  gameMap: 0x0008,
  gameStage: 0x000a,
  numPlayers: 0x000c,
  players: 0x0010,
  specialPlayers: 0x01b4,
  objectsInfo: 0x0204,
  playerCards: 0x0654,
  toolAmount: 0x0690,
  cardAmount: 0x06cc,
  playerStocks: 0x21f6,
  stocks: 0x2376,
  currentPlayer: 0x2676,
  /**
   * 勝利條件两个全局 —— **与 `[0x49911c]` / `[0x499108]` 同源**
   * （开局时由 `0x0040737d..0x004073a3` 从 `0x46cbe8` / `0x46cc00` 写进去）。
   *
   * ★ 2026-09-16 补（Q-SETUP-1 的残留）：偏移先前只写进了 deviations 文档，
   *   解析器没收，于是读原版存档一律按「两条都無限」导入。
   *   实测两个样本（Save0 中局 / SAVE1 开局）都是 0，即那两局选的确实是無限。
   * @source docs/deviations/Q-SETUP-1.md §5.2
   */
  winTargetDays: 0x2682,
  winTargetWealth: 0x2686,
  /**
   * 本局**选中的开局资金档位** `_rich4_game_initial_fund` `[0x49908c]`。
   *
   * @source 紧接 `winTargetWealth`（0x2686）之后、`priceIndex`（0x268e）之前；
   *   开局设置写入见 `rich4_new_game.asm:4032`，`savegame.q17.test.ts` 里有
   *   `Save0.dat` 该偏移 = 300000 的实测锚点。
   *
   * ★ 它有**规则**作用（`update_price_index` 的除数 + AI 买地保留额的基数），
   *   不只是「发多少钱」—— 先前解析器没收、引擎硬编码 30 万，见
   *   `state/types.ts` 的 `GameState.initialFund`。
   */
  initialFund: 0x268a,
  priceIndex: 0x268e,
  /** 已过天数 `[0x4990e4]`（日推进每回合 +1）@source 同上 §5.2 */
  totalDays: 0x2692,
  /** 卡片牌堆洗牌结果，36 项 @source fcn_00448b81 */
  cardDeck: 0x26fa,
  /** 命运牌堆洗牌结果，37 项 @source fcn_0044baea */
  fortuneDeck: 0x271e,
  /** 地图数据块大小（对应 ref_00498e94） */
  mapDataSize: 0x2747,
  /** 地图数据块起始 */
  mapData: 0x274b,
} as const;

// ============================================================
//  类型
// ============================================================

/** 谁在操作该玩家 @source rich4_player_info.h who_plays 低 2 比特 */
export const WHO_PLAYS = {
  NOT_ALIVE: 0,
  HUMAN: 1,
  COMPUTER: 2,
} as const;

/** 被托管标志（who_plays 的比特 2） */
export const AUTOPILOT_FLAG = 0x04;

/** 神明附身状态 @source rich4_player_info.h god_info */
export const GOD = {
  NONE: 0,
  SMALL_FORTUNE: 1, // 小财神
  BIG_FORTUNE: 2, // 大财神
  SMALL_POVERTY: 5, // 小穷神
  BIG_POVERTY: 6, // 大穷神
} as const;

/**
 * 玩家状态。字段名沿用逆向项目的命名；
 * 语义未明者保留 `fNN` 原名（C-FID-2）。
 */
export interface PlayerState {
  index: number;
  color: number;
  xpos: number;
  ypos: number;
  /** 所在地图节点号 */
  nodeId: number;
  lastNodeId: number;
  direction: number;
  trafficMethod: number;
  /** 骰子数，1..3 */
  ndices: number;
  /** 角色编号 0..11 @source docs/characters.txt「0x13 字节 = 角色编号」 */
  character: number;
  /** 原版 sex: 0 = 女, 1 = 男 */
  isFemale: boolean;
  /** 低 2 比特见 WHO_PLAYS；比特 2 表示被托管 */
  whoPlays: number;
  isAlive: boolean;
  isComputer: boolean;
  isAutopilot: boolean;
  f22: number;
  f23: number;
  f24: number;
  initCashRatio: number;
  f26: number;
  f27: number;
  /** 现金（有符号，可为负） */
  cash: number;
  /** 银行存款，含特别融资 */
  moneyInBank: number;
  loan: number;
  specialFinance: number;
  loanDueDate: number;
  /** 点数 */
  points: number;
  daysInHotel: number;
  daysDisappearing: number;
  daysInPrison: number;
  daysInHospital: number;
  daysSleeping: number;
  daysSleepWalking: number;
  daysStopping: number;
  daysTortoiseWalking: number;
  f58: number;
  daysRejectedByBank: number;
  daysBankNoLoans: number;
  /** 同盟卡剩余天数 */
  alliedDays: number;
  daysAssurance: number;
  /** 见 GOD 常量 */
  godInfo: number;
  f64: number;
  /** 同盟玩家：0 表示无，否则为玩家 id + 1 */
  alliedPlayer: number;
  totalWinterSleepDays: number;
  f67: number;
  f68: number;
  f70: number;
  f72: number;
  f74: number;
  /** 对其他玩家的敌意值，6 项 */
  hostility: number[];
  f100: number;
  f101: number;
  f102: number;
  f103: number;
  /** 手上的卡片编号列表（1 基；已剔除空槽） */
  cards: number[];
  /** 各道具持有数量，下标为道具 id - 1，长度 13 */
  tools: number[];
}

export interface SaveGame {
  identifier: number;
  /** 游戏内日期 */
  day: number;
  month: number;
  year: number;
  gameMap: number;
  gameStage: number;
  /** `game_stage * 4 + game_map`，0..7 */
  globalMapId: number;
  /** 玩家数量，**含已倒闭者** */
  numPlayers: number;
  players: PlayerState[];
  currentPlayer: number;
  /** 物价指数 */
  /** 本局选中的开局资金档位（`GAME_INITIAL_FUNDS` 之一）@source 0x268a */
  initialFund: number;
  priceIndex: number;
  /**
   *  game_time 档查 `0x46cbe8` 的结果 = 目标天数（0 = 無限）
   * @source `[0x49911c]`，存档 0x2682
   */
  winTargetDays: number;
  /**
   * 勝利條件档查 `0x46cc00` 再乘开局资金 = 目标总资产（0 = 無限）
   * @source `[0x499108]`，存档 0x2686
   */
  winTargetWealth: number;
  /** 已过天数 @source `[0x4990e4]`，存档 0x2692 */
  totalDays: number;
  /**
   * 各玩家的持仓：`playerStocks[玩家][股票] = { amount, avgCost }`。
   * @source `_rich4_player_stocks`，本文件的 `OFFSET.playerStocks = 0x21f6`，
   *   4 人 × 12 支 × 8 字节（`player_stock_info` = `int amount; float avgCost`）
   */
  playerStocks: StockHoldingRecord[][];
  /**
   * 五个替身（小偷/強盜/流氓/間諜/機器娃娃）的存档记录。
   * @source 槽内 `+0x1a8`（本文件的 `OFFSET.specialPlayers = 0x01b4`），5 × 16 字节
   */
  specialPlayers: SaveSpecialPlayer[];
  /** 牌堆中各种卡片的剩余张数，下标为卡片 id - 1 */
  cardAmount: number[];
  /** 地图数据块（结构同 map.mkf 的地图资源，但含实时归属状态） */
  mapData: Uint8Array;
}

// ============================================================
//  解析
// ============================================================

function parsePlayer(
  view: DataView,
  data: Uint8Array,
  index: number,
): PlayerState {
  const o = OFFSET.players + index * PLAYER_INFO_SIZE;
  const u8 = (at: number): number => data[o + at] ?? 0;

  const whoPlays = u8(0x15);
  const hostility: number[] = [];
  for (let i = 0; i < 6; i++) hostility.push(view.getUint32(o + 0x4c + i * 4, true));

  // 卡片：每个玩家 15 个槽位，0 表示空槽
  const cards: number[] = [];
  const cardBase = OFFSET.playerCards + index * 15;
  for (let i = 0; i < 15; i++) {
    const c = data[cardBase + i] ?? 0;
    if (c !== 0) cards.push(c);
  }

  // 道具：每个玩家 15 个槽位，按道具 id 索引，值为数量
  const tools: number[] = [];
  const toolBase = OFFSET.toolAmount + index * 15;
  for (let i = 0; i < 13; i++) tools.push(data[toolBase + i] ?? 0);

  return {
    index,
    color: view.getUint32(o + 0x04, true),
    xpos: view.getUint16(o + 0x08, true),
    ypos: view.getUint16(o + 0x0a, true),
    nodeId: view.getUint16(o + 0x0c, true),
    lastNodeId: view.getUint16(o + 0x0e, true),
    direction: u8(0x10),
    trafficMethod: u8(0x11),
    ndices: u8(0x12),
    character: u8(0x13),
    isFemale: u8(0x14) === 0,
    whoPlays,
    isAlive: (whoPlays & 0x03) !== WHO_PLAYS.NOT_ALIVE,
    isComputer: (whoPlays & 0x03) === WHO_PLAYS.COMPUTER,
    isAutopilot: (whoPlays & AUTOPILOT_FLAG) !== 0,
    f22: u8(0x16),
    f23: u8(0x17),
    f24: u8(0x18),
    initCashRatio: u8(0x19),
    f26: u8(0x1a),
    f27: u8(0x1b),
    cash: view.getInt32(o + 0x1c, true),
    moneyInBank: view.getInt32(o + 0x20, true),
    loan: view.getInt32(o + 0x24, true),
    specialFinance: view.getInt32(o + 0x28, true),
    loanDueDate: view.getUint32(o + 0x2c, true),
    points: view.getUint16(o + 0x30, true),
    daysInHotel: u8(0x32),
    daysDisappearing: u8(0x33),
    daysInPrison: u8(0x34),
    daysInHospital: u8(0x35),
    daysSleeping: u8(0x36),
    daysSleepWalking: u8(0x37),
    daysStopping: u8(0x38),
    daysTortoiseWalking: u8(0x39),
    f58: u8(0x3a),
    daysRejectedByBank: u8(0x3b),
    daysBankNoLoans: u8(0x3c),
    alliedDays: u8(0x3d),
    daysAssurance: u8(0x3e),
    godInfo: u8(0x3f),
    f64: u8(0x40),
    alliedPlayer: u8(0x41),
    totalWinterSleepDays: u8(0x42),
    f67: u8(0x43),
    f68: view.getUint16(o + 0x44, true),
    f70: view.getUint16(o + 0x46, true),
    f72: view.getUint16(o + 0x48, true),
    f74: view.getUint16(o + 0x4a, true),
    hostility,
    f100: u8(0x64),
    f101: u8(0x65),
    f102: u8(0x66),
    f103: u8(0x67),
    cards,
    tools,
  };
}

/**
 * 解析一个 `SAVEn.DAT` 存档。
 *
 * @source rich4-re/csrc/loadsave.c load_checkpoint()
 */
export function parseSave(data: Uint8Array): SaveGame {
  if (data.length < OFFSET.mapData) {
    throw new Error(`存档过短: ${data.length} 字节，至少需要 ${OFFSET.mapData}`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const gameMap = view.getUint16(OFFSET.gameMap, true);
  const gameStage = view.getUint16(OFFSET.gameStage, true);
  const numPlayers = view.getUint32(OFFSET.numPlayers, true);

  const players: PlayerState[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) players.push(parsePlayer(view, data, i));

  const cardAmount: number[] = [];
  for (let i = 0; i < CARD_TYPE_COUNT; i++) {
    cardAmount.push(data[OFFSET.cardAmount + i] ?? 0);
  }

  const specialPlayers: SaveSpecialPlayer[] = [];
  for (let i = 0; i < SPECIAL_PLAYER_COUNT; i++) {
    const o = OFFSET.specialPlayers + i * SPECIAL_PLAYER_SIZE;
    specialPlayers.push({
      x: view.getUint16(o, true),
      y: view.getUint16(o + 2, true),
      nodeId: view.getUint16(o + 4, true),
      lastNodeId: view.getUint16(o + 6, true),
      owner: data[o + 8] ?? 0,
      direction: data[o + 9] ?? 0,
      f10: data[o + 10] ?? 0,
      f11: data[o + 11] ?? 0,
      hibernating: data[o + 12] ?? 0,
      sleepwalkDays: data[o + 13] ?? 0,
      halted: data[o + 14] ?? 0,
      singleStep: data[o + 15] ?? 0,
    });
  }

  const playerStocks: StockHoldingRecord[][] = [];
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const row: StockHoldingRecord[] = [];
    for (let j = 0; j < STOCKS_PER_PLAYER; j++) {
      const o = OFFSET.playerStocks + (p * STOCKS_PER_PLAYER + j) * 8;
      row.push({ amount: view.getInt32(o, true), avgCost: view.getFloat32(o + 4, true) });
    }
    playerStocks.push(row);
  }

  const mapDataSize = view.getUint32(OFFSET.mapDataSize, true);
  const mapData = data.subarray(OFFSET.mapData, OFFSET.mapData + mapDataSize);

  return {
    identifier: view.getUint32(OFFSET.identifier, true),
    // 日期：day/month 各 1 字节，year 为小端 uint16 @source docs/rich4_cfg.txt
    day: data[OFFSET.date] ?? 0,
    month: data[OFFSET.date + 1] ?? 0,
    year: view.getUint16(OFFSET.date + 2, true),
    gameMap,
    gameStage,
    globalMapId: gameStage * 4 + gameMap,
    numPlayers,
    players,
    currentPlayer: view.getUint32(OFFSET.currentPlayer, true),
    // ⚠️ 用 `getInt32`（原版是 dword；正常档位都是正整数，但别把它当无符号量读）
    initialFund: view.getInt32(OFFSET.initialFund, true),
    priceIndex: view.getUint32(OFFSET.priceIndex, true),
    winTargetDays: view.getInt32(OFFSET.winTargetDays, true),
    winTargetWealth: view.getInt32(OFFSET.winTargetWealth, true),
    totalDays: view.getUint32(OFFSET.totalDays, true),
    playerStocks,
    specialPlayers,
    cardAmount,
    mapData,
  };
}

/**
 * 校验存档整体长度是否与结构推导一致。
 *
 * 期望长度 = 固定头部 + 地图数据 + 每个玩家(快照 + 一份地图数据)
 * @source loadsave.c 末尾的 per-player 循环
 */
export function expectedSaveLength(numPlayers: number, mapDataSize: number): number {
  return (
    OFFSET.mapData + mapDataSize + numPlayers * (PLAYER_SNAPSHOT_SIZE + mapDataSize)
  );
}
