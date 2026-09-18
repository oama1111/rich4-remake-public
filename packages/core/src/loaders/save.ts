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
 * 存档里的一个地图物件（神明/路障/地雷…）。
 * @source `rules/objects.ts` 的 `OBJECTS_INFO_BASE`：+0 `type`(byte)、+2 `nodeId`(word)、
 *   +4 `state`(byte，附身后写 13/7)、+5 `attached`(byte，玩家下标 + 1)
 */
export interface SaveObjectRecord {
  type: number;
  nodeId: number;
  state: number;
  attached: number;
}

/**
 * 存档里的一条股票行情（12 支 × 36 字节）。
 *
 * ⚠️ `+0` 是**名字指针**（实测是 exe 数据段的 VA，如 `0x4668c1`）——
 *   跨版本无意义，本解析器**不读**它；名字/顺序仍由 `@rich4/data` 的静态表给。
 * @source `rich4_stocks.h` 的 `stock_info`（36 字节，字段名沿用其 fNN）
 */
export interface SaveStockRecord {
  /** `+4`：对应的地图企业下标（1 基；0 = 无）*/
  commercialIndex: number;
  /** `+6`：停牌/不波动标记 */
  f6: number;
  /** `+7`：新闻计数器（高半字节利多、低半字节利空）*/
  newsFlag: number;
  /** `+8`：可流通股数 */
  shares: number;
  /** `+10` */
  f10: number;
  /** `+12`：永不变的参考价 */
  basePrice: number;
  /** `+16`：今日开盘 */
  openPrice: number;
  /** `+20`：今日收盘（买卖与估值都用它）*/
  price: number;
  /** `+24`：波动系数 0.40~2.00 */
  volatility: number;
  /** `+28`：当日趋势（±10）*/
  trend: number;
  /** `+32`：当日随机冲击 */
  shock: number;
}

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
/** 地图物件条数（46）@source `memset(objects_info, 0, 0x450)` + `cmp ebx, 0x2e` */
export const OBJECT_RECORD_COUNT = 0x2e;
/** 一个物件的字节数（24）@source `0x450 / 0x2e`，代码里写作 `byte [eax*8 + …]`（eax = i*3） */
export const OBJECT_RECORD_SIZE = 24;

/** 每人持仓的股票支数（12 支）@source `player_stock_info[4][12]` */
export const STOCKS_PER_PLAYER = 12;

/**
 * 存档里那 8 个道具库存槽 = 道具号 1..8。
 *
 * ★ 与 `rules/tools.ts` 的 `STOCKED_TOOL_MAX_ID` **同值**；本文件按 C-ARC-1
 *   零依赖，故不 import 那一份 —— 两边的依据是同一条 exe 代码
 *   （`give_tool` 的 `cmp edx, 8 / jg 跳过`，> 8 不限量、存档里也不存）。
 */
const STOCKED_TOOL_BYTES = 8;

/**
 * 樂透号码个数（36）@source 号码表 `ref_004990b8` 的 `memset(0x24)`
 *   （`rich4_new_game.asm:4279`）与破产释放循环的 `cmp ebx, 0x24`
 *   （`rich4_player_bankrupt.asm:423`）。
 */
const LOTTERY_NUMBER_COUNT = 36;
/** 新聞牌堆 36 张 @source 写存档处 `push 0x24 / push 0x499090` */
const NEWS_DECK_SIZE = 36;
/** 命運牌堆 37 张 @source 写存档处 `push 0x25 / push 0x496b38` */
const FORTUNE_DECK_SIZE = 37;
/** 一条行情记录的字节数 @source `rich4_stocks.h` 的 `stock_info` */
export const STOCK_RECORD_SIZE = 36;
/** 每股的日历史长度 @source `cmp ecx, 0x90` = 144 */
export const HISTORY_DAYS_PER_STOCK = 0x90;

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
  /**
   * 全局道具库存（**只有 1..8 号**限量）@source `_rich4_remain_tool_amount`
   *   = `0x497320`，8 字节，**下标 = 道具号 − 1**（`rich4_shop.asm:167`
   *   `add byte [ecx + (0x497320 - 1)], dl`；`rich4_objects.asm:161/165/169`
   *   分别 `+1/+2/+3` 对应路障/地雷/定時炸彈，`rich4_fortune.asm:1183/1272`
   *   的 `+4/+5` 对应機車/汽車 —— 全对得上）。
   *
   * ★ 平坦偏移的来历（`rich4_save_files.asm` 的 `fwrite` 序列逐个累加）：
   *   `toolAmount`(60B) @0x690 → `cardAmount`(30B) @0x6cc → **本项**(8B) @0x6ea
   *   → 行情游标(4B) @0x6f2 → `history`(0x1b00) @0x6f6 → `playerStocks` @0x21f6。
   *   四个锚点（0x690 / 0x6cc / 0x6f6 / 0x21f6）本来就已核过 ⇒ 两处新偏移自洽。
   *   实测 Save0 该处 = [9,1,10,10,9,9,5,1]、SAVE1 = [6,6,6,6,10,10,10,6]（都像库存）。
   */
  toolStock: 0x06ea,
  /**
   * 行情历史的**写入游标** @source `[0x499100]`，dword。
   *
   * @source `rich4_stocks.asm:698-727`：写历史用 `[edx + eax*4 + 0x497328]`
   *   （`edx = 股票 × 0x240`、`eax` = 本项）⇒ **股票主序** `history[股][日]`；
   *   写完 `lea ecx,[eax+1] / cmp ecx,0x90 / 归零` ⇒ 本项是**下一个要写的槽**。
   *   读历史那支 `fcn_00429040` 则先 `dec edi`（`< 0` → `0x8f`）= 「昨天」。
   *   实测 Save0 = **107**、SAVE1 = **1**；SAVE1 的历史正好只有 12 个非零
   *   （12 支股各 1 天，位置 0/144/288/…）⇒ 与「游标 = 已写天数」完全自洽。
   */
  marketDay: 0x06f2,
  playerStocks: 0x21f6,
  stocks: 0x2376,
  /**
   * 144 日历史（12 支 × 144 天 × 4 字节 = 0x1b00 的 float 数组）。
   *
   * @source 平坦布局上它**紧贴在 `playerStocks` 前面**：
   *   `0x21f6 − 0x1b00 = 0x6f6`；实测 Save0 在该处读到 256/273/288/298/327/337
   *   这样一条**合理的价格序列**（1..9999），且这段正好不越界。
   *   （asm 里的槽内偏移 `+0x6ec` 是**另一套基准**，见 `known-deviations` 的存档一节。）
   */
  history: 0x6f6,
  /**
   * 公库 @source `_rich4_pool` = **`[0x499080]`**，4 字节。
   *
   * @source 三处铁证：① `rich4_player_core_actions.asm:5128`
   *   「收款方 = −1（公库）」那一支 `add dword [0x499080], ebx`；
   *   ② `rich4_stocks.asm:212` 股票交易手续费也加进它；
   *   ③ `rich4_ui_letou.asm:514` 樂透屏把它 `num_to_currency_string` 印成奖池。
   *   实测 Save0 = **3000**、SAVE1 = **0**。
   *   （先前登记的「0x269e 像公库但不合次序」是**误判**：0x269e 是 `[0x49907c]`，
   *   公库在它后面 0x1c 字节处，见下。）
   */
  pool: 0x26ba,
  /**
   * 樂透号码表（36 字节：下标 = 号码，值 = **持有者下标 + 1**，0 = 未售出）
   * @source `ref_004990b8`；新局 `memset(0x24)`（`rich4_new_game.asm:4279`）、
   *   破产时逐项与 `玩家 + 1` 比对清零（`rich4_player_bankrupt.asm:429`）。
   *   实测两个存档都是全 0（没人买过票）。
   */
  lottery: 0x26be,
  /**
   * ★ 地图视角旋转档位 0..7 @source `[0x499088]`，4 字节。
   *
   * 由热键 `<` / `>` 改变（`rich4-spec/docs/systems/animation.md` 已结案：
   * **是地图视角档位，不是动画帧计数**），并且**会存进存档**
   * —— 存档块序表 `+0x2743`，写侧 `@source 0x0040330d` 一带、
   * 读侧 `@source 0x00402e6d`。
   * 实测两个样本都是 **0**（默认视角），所以该字段**无法用样本区分**，
   * 只能靠构造字节做可证伪的单测。
   */
  viewRotation: 0x2743,
  /** 新聞牌堆游标 @source `[0x4990e0]`（实测 Save0 = 19、SAVE1 = 0）*/
  newsCursor: 0x26f2,
  /** 命運牌堆游标 @source `[0x4990b4]`（实测 Save0 = 7、SAVE1 = 0）*/
  fortuneCursor: 0x26f6,
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
  /**
   * **人类玩家数** `[0x499104]` —— 终局码的判据（`0x41d96e cmp [0x499104],1`）。
   *
   * ★ 原版只在开新局时按 `player[i].+0x64 & 1` 数一次（`0x407250 inc`），
   *   之后**不再更新**（破产 `0x40cd87` 不写它）⇒ 必须从存档读回来，
   *   不能拿 `whoPlays` 现数。实测 Save0 = **2**（该档 `whoPlays` 为 `1,1,2,2`）。
   *   见 `state/types.ts` 的 `GameState.humanPlayers`。
   */
  humanPlayers: 0x01b0,
  priceIndex: 0x268e,
  /** 已过天数 `[0x4990e4]`（日推进每回合 +1）@source 同上 §5.2 */
  totalDays: 0x2692,
  /**
   * 已过**月数**计数器 @source `[0x499084]`（dword）。
   *
   * @source 跨月 +1：`rich4_player_core_actions.asm` 的 `add dword [0x499084], edi`；
   *   另被 `0x429f60 idiv` 用作「土地现值 ÷ 月数」的除数。
   *   ★ 与 `0x499080`（公库）**毫无关系** —— 早期文档把两者并成「金钱统计池」是错的，
   *   见 `rich4-spec/docs/systems/save-scalars.md`。
   *   实测 Save0 = **9**、SAVE1 = **0**。
   */
  totalMonths: 0x2696,
  /**
   * **新聞**牌堆洗牌序，36 项（`0..35` 的排列）。
   *
   * @source `fcn_00448b81`（VA 0x00448b81）：洗好的号逐个
   *   `mov byte [ebx + 0x499090], al` —— ★ 写的是 **`0x499090`（新聞牌堆）**，
   *   并把游标 `[0x4990e0]` 清零；抽取处 `rich4_news.asm:3475` 也是它。
   *   ⚠️ 先前这一条标成「卡片牌堆」（`cardDeck`）是**误标**：卡片没有「牌堆」，
   *   手牌/库存是 `player_cards` / `remain_card_amount` 那两块（都在 0x690 一带）。
   *   实测 Save0/SAVE1 该处都正好是 `0..35` 的排列。
   */
  newsDeck: 0x26fa,
  /**
   * **命運**牌堆洗牌序，37 项（`0..36` 的排列）。
   * @source `fcn_0044baea`（VA 0x0044baea）写 `0x496b38`、游标 `[0x4990b4]`；
   *   抽取处 `rich4_fortune.asm:2554`。实测两档都是合法排列。
   */
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
  /**
   * `+0x04` 代表色（`0x00RRGGBB`）。
   *
   * ★ 它**不是玩家状态，是角色常量**：新局时整条玩家记录由
   *   `memcpy(player, &character_profiles[character], 0x68)` 拷来
   *   （`@source 0x004072c3`–`0x004072e4`），全 exe 也没有任何一处写过 `+0x04`。
   *   ⇒ 写档器按 `character` 查 `@rich4/data` 的表即可，`GameState` 不需要这个字段。
   *   同一句 memcpy 也产生了 `+0x00`（名字串指针，读档时被 `@source 0x00402bae` 覆盖）。
   */
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
  /**
   * `+0x43` —— ⚠️ **全 exe 无读无写的死字节**（`0x496bab` 的 `read_by`/`written_by` 都为空）。
   * 解析器留着它是为了逐字节往返；**不要**把它接到任何引擎字段上
   * （先前 `savedTrafficMethod: f67` 就是接错的，见 `savegame.ts` 的订正）。
   */
  f67: number;
  f68: number;
  f70: number;
  f72: number;
  f74: number;
  /** 对其他玩家的敌意值，6 项 */
  hostility: number[];
  f100: number;
  /** `+0x65` —— 只有 `0x41c84f` 读、**无写者** ⇒ 语义未决 */
  f101: number;
  /** ★ `+0x66` = **夢遊卡的「睡前移动方式」备份** @source `0x4441dc` `mov [+0x66],[+0x11]` */
  f102: number;
  /** ★ `+0x67` = **夢遊卡的「睡前骰子数」备份** @source `0x4441dc` `mov [+0x67],[+0x12]` */
  f103: number;
  /** 手上的卡片编号列表（1 基；已剔除空槽） */
  cards: number[];
  /** 各道具持有数量，下标为道具 id - 1，长度 13 */
  tools: number[];
}

/**
 * 公佈欄挂牌槽（12 字节）—— **块 `0x2526`：4 玩家 × 7 槽 × 12 字节 = 336**。
 *
 * ```asm
 * ; 挂牌 VA 0x004246c5 的几次写入（本文件只解出「读档要用的那几个字段」）
 * 00424725  mov byte  [eax + 0x4967e0], bl   ; +0 類型（0 = 空）
 * 0042472d  mov byte  [eax + 0x4967e1], bh   ; +1 挂牌天龄（**只写不读**的死数据）
 * 00424733  mov word  [eax + 0x4967e2], si   ; +2 物品编号
 * 0042473e  mov dword [eax + 0x4967e4], ecx  ; +4 標價
 * 00424751  mov word  [eax + 0x4967e8], dx   ; +8 股數（只有類型 1 = 股票用）
 * 00424785  mov byte  [eax + 0x4967ea], bl   ; +a 地產/設施的 +0x18（只有類型 2 用）
 * 0042478f  mov byte  [eax + 0x4967eb], dl   ; +b 地產/設施的 +0x1a（只有類型 2 用）
 * ```
 * ⚠️ `+8` 是 **word**、`+a`/`+b` 是两个 **byte** —— 别把 12 字节当成 3 个 u32。
 */
export interface SaveListingSlot {
  /** `+0`：0 = 空；1 = 股票、2 = 地產/設施、3 = 道具、4 = 卡片 */
  kind: number;
  /** `+2` */
  id: number;
  /** `+4` */
  price: number;
  /** `+8`，只有股票用 */
  amount: number;
  /** `+a`，只有類型 2（地產/設施）用：挂牌那一刻的 `+0x18` */
  estateType: number;
  /** `+b`，同上：`+0x1a`（等級） */
  estateLevel: number;
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
  /**
   * 人类玩家数 `[0x499104]` @source 状态块 `0x01b0` —— **开局写一次、之后不变**，
   * 是终局码的判据（不是「当前还活着几个真人」）。
   */
  humanPlayers: number;
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
  /** 已过月数计数器 @source `[0x499084]`（平坦 0x2696） */
  totalMonths: number;
  /** 46 个地图物件 @source `_rich4_objects_info`，平坦 `0x0204`，每项 24 字节 */
  objects: SaveObjectRecord[];
  /** 12 支股票的行情快照 @source `_stocks_on_map`，平坦 `0x2376` */
  stocksOnMap: SaveStockRecord[];
  /** `history[股票][日]`（12 × 144 的 float 价格）@source 平坦 `0x6f6`，0x1b00 字节 */
  stockHistory: number[][];
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
  /**
   * 全局道具库存（`[道具号 - 1]`，8 项 = 道具号 1..8；> 8 号不限量故不存）
   * @source 平坦 `0x6ea`，见 `OFFSET.toolStock`
   */
  toolStock: number[];
  /** 行情历史写入游标 `[0x499100]`（0..143）@source 平坦 `0x6f2` */
  marketDay: number;
  /** 公库 @source 平坦 `0x26ba`（`[0x499080]`）*/
  pool: number;
  /** 地图视角旋转 0..7 @source `[0x499088]` */
  viewRotation: number;
  /** 樂透号码表（36 项：`[号码]` = 持有者 + 1，0 = 未售出）@source 平坦 `0x26be` */
  lottery: number[];
  /** 新聞牌堆洗牌序（36 项）@source 平坦 `0x26fa` */
  newsDeck: number[];
  /** 新聞牌堆游标 @source 平坦 `0x26f2`（`[0x4990e0]`）*/
  newsCursor: number;
  /** 命運牌堆洗牌序（37 项）@source 平坦 `0x271e` */
  fortuneDeck: number[];
  /** 命運牌堆游标 @source 平坦 `0x26f6`（`[0x4990b4]`）*/
  fortuneCursor: number;
  /** 地图数据块（结构同 map.mkf 的地图资源，但含实时归属状态） */
  mapData: Uint8Array;
  /**
   * 公佈欄挂牌表，**按文件顺序** `[player*7 + slot]` 展开（28 项）。
   * 空槽的 `kind` 为 0。
   */
  noticeBoard: SaveListingSlot[];
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
    // ★ 这三项是**神明附身的三项修正**，**可为负**（土地公 −500、大窮神 +200…）：
    //   `rules/objects.ts` 的 `GOD_MODIFIERS` 表；写侧 `@source 0x40ead7`（附身）、
    //   清侧 `0x40e14d`。原版自己也是按**有符号**读的 —— 月度评分那段明确写着
    //   `(int16)player[0x44]`（`rules/monthly.ts` 的 @source `rich4.asm:16680`）⇒ 用 getInt16。
    //   （两份样本这三格全 0，所以「无符号」也能过逐字节往返 —— 又一次"样本不可观测"。）
    f68: view.getInt16(o + 0x44, true),
    f70: view.getInt16(o + 0x46, true),
    f72: view.getInt16(o + 0x48, true),
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

  // 全局道具库存：存档里只存**限量**的那 8 个（道具号 1..8），下标 = 号 − 1
  const toolStock: number[] = [];
  for (let i = 0; i < STOCKED_TOOL_BYTES; i++) {
    toolStock.push(data[OFFSET.toolStock + i] ?? 0);
  }

  // 樂透号码表 / 两个牌堆的洗牌序（都是逐字节的数组）
  const bytesAt = (off: number, n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(data[off + i] ?? 0);
    return out;
  };
  const lottery = bytesAt(OFFSET.lottery, LOTTERY_NUMBER_COUNT);
  const newsDeck = bytesAt(OFFSET.newsDeck, NEWS_DECK_SIZE);
  const fortuneDeck = bytesAt(OFFSET.fortuneDeck, FORTUNE_DECK_SIZE);

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

  const objects: SaveObjectRecord[] = [];
  for (let i = 0; i < OBJECT_RECORD_COUNT; i++) {
    const o = OFFSET.objectsInfo + i * OBJECT_RECORD_SIZE;
    objects.push({
      type: data[o] ?? 0,
      nodeId: view.getUint16(o + 2, true),
      state: data[o + 4] ?? 0,
      attached: data[o + 5] ?? 0,
    });
  }

  const stocksOnMap: SaveStockRecord[] = [];
  for (let i = 0; i < STOCKS_PER_PLAYER; i++) {
    const o = OFFSET.stocks + i * STOCK_RECORD_SIZE;
    stocksOnMap.push({
      commercialIndex: view.getUint16(o + 4, true),
      f6: data[o + 6] ?? 0,
      newsFlag: data[o + 7] ?? 0,
      shares: view.getUint16(o + 8, true),
      f10: view.getUint16(o + 10, true),
      basePrice: view.getFloat32(o + 12, true),
      openPrice: view.getFloat32(o + 16, true),
      price: view.getFloat32(o + 20, true),
      volatility: view.getFloat32(o + 24, true),
      trend: view.getFloat32(o + 28, true),
      shock: view.getFloat32(o + 32, true),
    });
  }

  const stockHistory: number[][] = [];
  for (let i = 0; i < STOCKS_PER_PLAYER; i++) {
    const row: number[] = [];
    for (let day = 0; day < HISTORY_DAYS_PER_STOCK; day++) {
      row.push(view.getFloat32(OFFSET.history + (i * HISTORY_DAYS_PER_STOCK + day) * 4, true));
    }
    stockHistory.push(row);
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

  // 公佈欄挂牌表（块 0x2526）：4 玩家 × 7 槽 × 12 字节
  const noticeBoard: SaveListingSlot[] = [];
  for (let slot = 0; slot < 28; slot++) {
    const o = 0x2526 + slot * 12;
    noticeBoard.push({
      kind: data[o] ?? 0,
      id: view.getUint16(o + 2, true),
      price: view.getUint32(o + 4, true),
      amount: view.getUint16(o + 8, true),
      estateType: data[o + 0x0a] ?? 0,
      estateLevel: data[o + 0x0b] ?? 0,
    });
  }

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
    humanPlayers: view.getUint32(OFFSET.humanPlayers, true),
    priceIndex: view.getUint32(OFFSET.priceIndex, true),
    winTargetDays: view.getInt32(OFFSET.winTargetDays, true),
    winTargetWealth: view.getInt32(OFFSET.winTargetWealth, true),
    totalDays: view.getUint32(OFFSET.totalDays, true),
    totalMonths: view.getUint32(OFFSET.totalMonths, true),
    objects,
    stocksOnMap,
    stockHistory,
    playerStocks,
    specialPlayers,
    cardAmount,
    toolStock,
    marketDay: view.getUint32(OFFSET.marketDay, true),
    pool: view.getInt32(OFFSET.pool, true),
    viewRotation: view.getUint32(OFFSET.viewRotation, true) & 7,
    lottery,
    newsDeck,
    newsCursor: view.getUint32(OFFSET.newsCursor, true),
    fortuneDeck,
    fortuneCursor: view.getUint32(OFFSET.fortuneCursor, true),
    mapData,
    noticeBoard,
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
