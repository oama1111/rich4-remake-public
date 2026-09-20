/*
 * 重制版存档 —— 序列化 / 反序列化 / 原版存档导入
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么不沿用原版的二进制布局：
 *   原版存档是**内存镜像**——一堆全局变量按地址顺序 memcpy 出去
 *   （见 `restore_last_state` 的快照代码 VA 0x00448380 起）。
 *   它绑死在 32 位 x86 的结构体布局上，字段一旦增删就整体错位，
 *   而本项目的状态还在持续补全（股市、樂透、道具都是这几步才接上的）。
 *
 *   故重制版用**自己的格式**：带版本号的 JSON。原版存档则走
 *   `importOriginalSave` 单向导入。两者的分工是：
 *   - 新格式：完整、无损、可回放
 *   - 原版格式：**只读导入**，能读回来的照读，读不回来的明确报告
 *
 * ⚠️ C-DET-4：存档必须**无损**——存了再读回来，之后的 action 序列
 *   必须产出与没存过时逐字节相同的结果。`rngState` 因此必须入档
 *   （单机原版不存它，因为原版本就不可复现；见 rng/policy.ts）。
 */

import type { GameState } from '../state/types.ts';
import { WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from '../state/types.ts';
import type { SaveGame } from './save.ts';
import { OFFSET, PLAYER_SNAPSHOT_SIZE, parseSave } from './save.ts';
import { parseMap, type Rich4Map } from './map.ts';
import {
  ORIGINAL_SAVE_BLOCKS,
  ORIGINAL_STATE_BLOCK_SIZE,
} from './save-block-table.ts';
import {
  SNAPSHOT_FLAG_OFFSET,
  SNAPSHOT_REGIONS,
} from './save-writer.ts';
import { takeSnapshot } from '../rules/time-machine.ts';
import {
  commercialLiveFromMap,
  commercialOwnersFromMap,
  facilityFieldFromMap,
  landLevelFromMap,
  landOwnerFromMap,
  landPriceStatusFromMap,
  landTenureFromMap,
  landPriceFromMap,
  landTypeFromMap,
} from '../rules/new-game.ts';
import {
  BOARD_SLOTS,
  type BoardColumn,
  type ListingKind,
} from '../places/notice-board.ts';
import {
  ACTOR_PLACE,
  INITIAL_ACTOR_PLACE,
  SPECIAL_ACTOR_BASE,
  idleActor,
  type SpecialActor,
} from '../rules/special-actors.ts';
import { HISTORY_DAYS, newStockMarket, type StockMarketState } from '../places/stock-market.ts';
import { emptyLottery } from '../places/lottery.ts';
import type { EventDeck } from '../events/deck.ts';
import { EMPTY_HOLDING } from '../places/stock.ts';
import { STOCKS_PER_MAP } from '@rich4/data';
import { STOCKED_TOOL_MAX_ID, emptyTools, initialToolStock, TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
import { CONFINEMENT_SLOTS } from '../rules/confinement.ts';
import { DEFAULT_INITIAL_FUND, NO_WIN_CONDITIONS } from '../rules/setup.ts';

/** 存档格式版本。字段有增删就 +1，并在 `migrate` 里补上迁移。 */
export const SAVE_FORMAT_VERSION = 1;

/** 文件头标识，用来一眼认出这是本项目的存档 */
export const SAVE_MAGIC = 'RICH4-REMAKE';

export interface SaveFile {
  magic: typeof SAVE_MAGIC;
  version: number;
  /** 存档写出时的引擎状态，字段与 GameState 一一对应 */
  state: GameState;
}

// ============================================================
//  新格式
// ============================================================

/**
 * 写出存档。
 *
 * ⚠️ 用 `JSON.stringify` 的默认键序（即对象自身的插入序）。这**不违反**
 *   C-DET-5：那条约束禁的是「依赖 `Object.keys` 顺序来决定游戏行为」，
 *   而这里键序只影响字节表示，读回来的对象在语义上完全一致。
 */
export function serializeGame(state: GameState): string {
  const file: SaveFile = { magic: SAVE_MAGIC, version: SAVE_FORMAT_VERSION, state };
  return JSON.stringify(file);
}

export class SaveFormatError extends Error {}

/**
 * 读回存档。
 *
 * 校验到「这不是一个能安全喂给 reduce 的状态」就抛错——宁可读档失败，
 * 也不要拿一个缺字段的状态跑下去，那种错会在几十回合后才以
 * 「莫名其妙的 undefined」的形式爆出来。
 */
export function deserializeGame(text: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveFormatError('存档不是合法的 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new SaveFormatError('存档内容为空');

  const file = parsed as Partial<SaveFile>;
  if (file.magic !== SAVE_MAGIC) throw new SaveFormatError('不是 rich4-remake 的存档');
  if (typeof file.version !== 'number') throw new SaveFormatError('存档缺少版本号');
  if (file.version > SAVE_FORMAT_VERSION) {
    throw new SaveFormatError(
      `存档版本 ${file.version} 比本程序支持的 ${SAVE_FORMAT_VERSION} 还新`,
    );
  }
  if (typeof file.state !== 'object' || file.state === null) {
    throw new SaveFormatError('存档缺少状态');
  }

  const state = migrate(file.state, file.version);
  assertUsable(state);
  return state;
}

/** 旧版本存档的迁移。目前只有版本 1，留好接口。 */
function migrate(state: GameState, version: number): GameState {
  // 同版本内新增的可选数组：缺了就按零补齐（companyProfit 于 2026-09-14 加入）
  let patched: GameState = Array.isArray(state.companyProfit)
    ? state
    : { ...state, companyProfit: (state.companyFunds ?? []).map(() => 0) };
  // 电脑调度步（2026-09-14 加入）
  if (typeof patched.aiStep !== 'number') patched = { ...patched, aiStep: 0, aiBranch: 0 };
  if (typeof patched.totalMonths !== 'number') patched = { ...patched, totalMonths: 0 };
  if (patched.players.some((p) => typeof p.bankFreezeDays !== 'number')) {
    patched = { ...patched, players: patched.players.map((p) => ({ ...p, bankFreezeDays: p.bankFreezeDays ?? 0 })) };
  }
  // 勝利條件（遊戲時間 / 勝利條件）两个字段于 2026-09-16 加入。
  // 旧档没有它们 → 按「兩條都無限」补，行为与加字段之前逐字节一致。
  if (patched.winConditions === undefined) {
    patched = { ...patched, winConditions: { ...NO_WIN_CONDITIONS } };
  }
  if (patched.victory === undefined) patched = { ...patched, victory: null };
  if (version === SAVE_FORMAT_VERSION) return patched;
  // 将来：逐版本补齐新增字段
  return patched;
}

/** 必须存在的字段 —— 缺一个就说明这份存档不能用 */
const REQUIRED_KEYS: readonly (keyof GameState)[] = [
  'mode',
  'rngState',
  'globalMapId',
  'day',
  'month',
  'year',
  'players',
  'currentPlayer',
  'phase',
  'priceIndex',
  'viewRotation',
  'cardAmount',
  'landOwner',
  'landLevel',
  'newsDeck',
  'fortuneDeck',
  'pool',
  'lottery',
  'tools',
  'toolStock',
  'market',
  'holdings',
];

function assertUsable(state: GameState): void {
  for (const key of REQUIRED_KEYS) {
    if (state[key] === undefined) throw new SaveFormatError(`存档缺少字段 ${String(key)}`);
  }
  if (!Array.isArray(state.players) || state.players.length === 0) {
    throw new SaveFormatError('存档里没有玩家');
  }
  if (state.currentPlayer < 0 || state.currentPlayer >= state.players.length) {
    throw new SaveFormatError(`当前玩家下标 ${state.currentPlayer} 越界`);
  }
  if (state.holdings.length !== state.players.length) {
    throw new SaveFormatError('持仓表与玩家数对不上');
  }
}

// ============================================================
//  原版存档导入
// ============================================================

/** 导入时没能还原的东西 —— 明确报出来，不悄悄糊过去 */
export interface ImportGaps {
  /** 字段名 → 为什么没能还原 */
  readonly [field: string]: string;
}

export interface ImportResult {
  state: GameState;
  /** 用默认值顶上的字段。**调用方应当把它显示给用户**。 */
  gaps: ImportGaps;
  /**
   * ★ 这次导入**实际用的地图** —— 正常情况下是**存档自带的那块**
   *   （`parseMap(save.mapData)`），解析失败才退回调用方传进来的那张。
   *   表现层必须拿它去换 `topo` / 底图，否则会「状态按 A 图、画面按 B 图」。
   */
  map: Rich4Map;
}

/**
 * 把一份原版存档导入成引擎状态。
 *
 * ★ 单向：能读回来的照读，读不回来的用合理默认值顶上并**列进 `gaps`**。
 *   这比「静默补零」强得多——玩家会知道自己读进来的是一份什么。
 *
 * ⚠️ 目前能还原的是 `loaders/save.ts` 已**验证过偏移**的那部分：
 *   日期、地图、玩家结构体全部字段、手牌、道具、牌堆张数、物价指数。
 *   其余（樂透号码表、股市行情与持仓、公库、监狱/医院占用、牌堆洗牌序）
 *   在存档里的偏移尚未验证，故不猜——见各自的 gap 说明。
 */
/**
 * 用存档里的行情覆盖静态初值。
 *
 * @source 12 支 × 36 字节在平坦 `0x2376`、144 日历史在平坦 `0x6f6`（0x1b00 字节）；
 *   字段映射见 `loaders/save.ts` 的 `SaveStockRecord`。
 * ⚠️ 两样原版**存了但本解析器还没读**的东西：`[0x499100]`（历史游标 `day`）与
 *   `[0x499078]`（大盘指数）—— 前者先归 0、后者**按定义重算**
 *   （`trunc(Σ收盘 × 10)`，与 `tickStockMarket` 同一条式子），已登记。
 */
function importedMarket(save: SaveGame): StockMarketState {
  const base = newStockMarket(save.globalMapId);
  const stocks = base.stocks.map((st, i) => {
    const rec = save.stocksOnMap[i];
    if (rec === undefined) return st;
    return {
      ...st,
      commercialIndex: rec.commercialIndex,
      f6: rec.f6,
      newsFlag: rec.newsFlag,
      shares: rec.shares,
      f10: rec.f10,
      basePrice: rec.basePrice,
      openPrice: rec.openPrice,
      price: rec.price,
      volatility: rec.volatility,
      trend: rec.trend,
      shock: rec.shock,
    };
  });
  const history = base.history.map((row, i) => {
    const saved = save.stockHistory[i];
    if (saved === undefined || saved.length === 0) return row;
    const out = [...row];
    for (let d = 0; d < saved.length && d < out.length; d++) out[d] = saved[d]!;
    return out;
  });
  // ★ 与 `tickStockMarket` **同一条式子**：累加时也逐项 fround（原版是 32 位浮点加）
  let total = 0;
  for (const st of stocks) total = Math.fround(total + st.price);
  // ★ 历史游标 `[0x499100]` = **下一个要写的槽**（`rich4_stocks.asm:698-727`，
  //   写完 `+1`，到 0x90 归零）—— 与 `tickStockMarket` 的 `market.day` 同一语义，
  //   故直接读进来。存档里越界时夹回 0（原版不夹，但那等于写到界外，不照抄）。
  const rawDay = save.marketDay;
  const day = Number.isInteger(rawDay) && rawDay >= 0 && rawDay < HISTORY_DAYS ? rawDay : 0;
  return {
    ...base,
    stocks,
    history,
    day,
    // ★ 这里**不能**对乘积再取一次 `Math.fround`。原版（@source 0x004294b9）：
    //     fld   dword ptr [esp]        ; 单精度 → x87 扩展精度（精确）
    //     fmul  dword ptr [0x463fec]   ; ×10.0f（0x463fec = 0x41200000 = 10.0）
    //     call  0x457dbc               ; RC=11 → frndint 向零取整
    //     fistp dword ptr [0x499078]
    //   关键是**乘积留在 x87 扩展精度里，中途没有 `fstp` 回单精度**。
    //   而 float32 × 10 的精确积最多只需 24+3 = 27 位有效位，double 有 53 位
    //   ⇒ 在 JS 里 `total * 10` **本身就是精确的**；
    //   再 `Math.fround` 一次反而引入原版没有的舍入。
    //   实证：两个真实存档的 `[0x499078]` 是 74637 / 13490，
    //   多这一次 fround 会算成 74638 / 13491（差 1）。
    //   回归测试见 `savegame.test.ts` 的「大盘指数逐位等于存档原值」。
    index: Math.trunc(total * 10),
  };
}

/**
 * 全局道具库存 —— 存档平坦 `0x6ea`（8 字节，`[道具号 - 1]`）。
 *
 * @source `_rich4_remain_tool_amount`（0x497320）：
 *   `rich4_shop.asm:167` 是 `add byte [ecx + (0x497320 - 1)], dl`（下标 = 号 − 1）；
 *   `rich4_objects.asm:161/165/169` 的 `+1/+2/+3`（路障/地雷/定時炸彈）与
 *   `rich4_fortune.asm:1183/1272` 的 `+4/+5`（機車/汽車）逐条对得上。
 *   > 8 号的道具不限量，存档里没有它们的格 ⇒ 保持初始值。
 */
/** 新聞牌堆 36 张 / 命運牌堆 37 张（@source 存档写处 `push 0x24` / `push 0x25`）*/
const NEWS_DECK_SIZE = 36;
const FORTUNE_DECK_SIZE = 37;

/**
 * 存档里的牌堆（洗牌序 + 游标）→ 引擎的 `EventDeck`。
 *
 * @source 两张牌堆都在存档里：新聞 `0x499090`（36）/ 命運 `0x496b38`（37），
 *   游标 `[0x4990e0]` / `[0x4990b4]`；抽取处 `rich4_news.asm:3475` /
 *   `rich4_fortune.asm:2554` 都是「`order[cursor]` 再前进」——与本引擎同构。
 *   ⚠️ 存档里的序若不是 `0..size-1` 的合法排列（改坏的档），退回按顺序重建。
 */
function importedDeck(order: readonly number[], cursor: number, size: number): EventDeck {
  const seen = new Set<number>();
  const legal =
    order.length === size &&
    order.every((v) => Number.isInteger(v) && v >= 0 && v < size && !seen.has(v) && seen.add(v) !== undefined);
  return {
    order: legal ? [...order] : Array.from({ length: size }, (_, i) => i),
    cursor: Number.isInteger(cursor) && cursor >= 0 && cursor < size ? cursor : 0,
  };
}

/**
 * 樂透号码表（平坦 `0x26be` = `[0x4990b8]`，36 字节）。
 *
 * @source 编码：值 = **持有者下标 + 1**，0 = 未售出
 *   （破产释放 `rich4_player_bankrupt.asm:429` 逐项与 `玩家 + 1` 比对清零、
 *   開獎 `rich4_ui_letou.asm` 同制）。值越界（> 玩家数）时按未售出处理。
 */
function importedLottery(save: SaveGame): number[] {
  const table = emptyLottery();
  for (let i = 0; i < table.length; i++) {
    const v = save.lottery[i] ?? 0;
    table[i] = v > 0 && v <= save.players.length ? v : 0;
  }
  return table;
}

function importedToolStock(save: SaveGame): number[] {
  const stock = initialToolStock();
  for (let id = 1; id <= STOCKED_TOOL_MAX_ID; id++) {
    const v = save.toolStock[id - 1];
    if (v !== undefined) stock[id] = v;
  }
  return stock;
}

/**
 * 把存档里的 5 条替身记录搬成引擎的 `SpecialActor[]`。
 *
 * @source 记录布局见 `loaders/save.ts` 的 `SaveSpecialPlayer`；
 *   `place` 原版**不存**：`nodeId > 0` 就是在棋盘上走，
 *   否则沿用开局的位置（小偷/強盜在監獄、流氓/間諜在醫院、機器娃娃未出场）——
 *   与 `initialSpecialActors()` 同一套口径。
 */
/**
 * 公佈欄挂牌表：文件里的 28 个 12 字节槽 → 4 玩家 × 7 槽。
 *
 * @source 块 `0x2526`（= 运行时 `0x4967e0`，步长 `0x54` = 7 × 12）；
 *   槽内布局见 `save.ts` 的 `SaveListingSlot`。
 */
function importedNoticeBoard(save: SaveGame): BoardColumn[] {
  const cols: BoardColumn[] = [];
  for (let p = 0; p < 4; p++) {
    const col: BoardColumn = [];
    for (let s = 0; s < BOARD_SLOTS; s++) {
      const it = save.noticeBoard[p * BOARD_SLOTS + s];
      if (it === undefined || it.kind === 0) {
        col.push(null);
        continue;
      }
      col.push({
        kind: it.kind as ListingKind,
        id: it.id,
        price: it.price,
        amount: it.amount,
        estateType: it.estateType,
        estateLevel: it.estateLevel,
      });
    }
    cols.push(col);
  }
  return cols;
}

function importedSpecialActors(save: SaveGame): SpecialActor[] {
  return INITIAL_ACTOR_PLACE.map((initialPlace, i) => {
    const rec = save.specialPlayers[i];
    if (rec === undefined) return { ...idleActor(), place: initialPlace };
    return {
      nodeId: rec.nodeId,
      lastNodeId: rec.lastNodeId,
      direction: rec.direction,
      owner: rec.owner,
      // ⚠️ 「还剩几步」不在那 16 字节里（全局 `[0x48baf8]`）⇒ 读档时归零
      stepsRemaining: 0,
      halted: rec.halted,
      singleStep: rec.singleStep,
      hibernating: rec.hibernating,
      sleepwalkDays: rec.sleepwalkDays,
      place: rec.nodeId > 0 ? ACTOR_PLACE.board : initialPlace,
    };
  });
}

/** 由替身表推占用表 —— 两者必须一致（见 `rules/special-actors.ts` 的 `initialConfinement`） */
function confinementFromActors(
  actors: readonly SpecialActor[],
  kind: 'prison' | 'hospital',
): number[] {
  const want = kind === 'prison' ? ACTOR_PLACE.prison : ACTOR_PLACE.hospital;
  const occ = new Array<number>(CONFINEMENT_SLOTS).fill(0);
  actors.forEach((a, i) => {
    const slot = SPECIAL_ACTOR_BASE + i;
    if (a.place === want && slot < CONFINEMENT_SLOTS) occ[slot] = 1;
  });
  return occ;
}

/**
 * 存档自带的地图块 → `Rich4Map`（解析失败返回 `null`）。
 *
 * 反复解析的代价可以忽略（一次导入一次），换来的是**调用方不可能传错图**。
 */
function liveMapOf(save: SaveGame): Rich4Map | null {
  try {
    return parseMap(save.mapData);
  } catch {
    return null;
  }
}

export function importOriginalSave(save: SaveGame, fallbackMap: Rich4Map): ImportResult {
  const gaps: Record<string, string> = {};
  const n = save.players.length;
  // ★ 2026-09-17（第十一轮）：**地图以存档自带的那块为准**。
  //
  //   存档写进去的 `mapData` 就是当时的「加载数组」——地块归属/等级、企业的
  //   归属/排名/可售股数/盈餘**都在里面**；而游戏目录里那张静态地图那些字段
  //   恒为 0，而且**未必是同一张图**（实测 Save0 的块是 55 块地 / 8 設施 /
  //   6 企业「底特律·福特汽車」，而安装目录里按文件名找的 `0003.bin` 是
  //   73 块地 / 中国石油 —— 不是同一张）。
  //   ⇒ 由本函数自己解析存档的地图块；解析失败（改坏的档）才退回调用方传的。
  const map = liveMapOf(save) ?? fallbackMap;
  const landCount = map.lands.length + 1;

  const players = save.players.map((p) => ({
    index: p.index,
    character: p.character,
    whoPlays: p.whoPlays,
    xpos: p.xpos,
    ypos: p.ypos,
    nodeId: p.nodeId,
    lastNodeId: p.lastNodeId,
    direction: p.direction,
    trafficMethod: p.trafficMethod,
    ndices: p.ndices,
    isMale: !p.isFemale,
    aiFlags: p.f22,
    // 原版存档 +0x19 就是現金↔存款比例（parseSave 的 initCashRatio）—— 直接读回，
    // 不要拿角色表重算：玩家在託管AI 屏上改过之后，存档里的才是当前值
    cashRatio: p.initCashRatio,
    loanRatio: p.f24,
    stockRatio: p.f26,
    personality: p.f23,
    cash: p.cash,
    moneyInBank: p.moneyInBank,
    loan: p.loan,
    specialFinance: p.specialFinance,
    loanDueDate: p.loanDueDate,
    points: p.points,
    blocking: {
      inHotel: p.daysInHotel,
      disappearing: p.daysDisappearing,
      inPrison: p.daysInPrison,
      inHospital: p.daysInHospital,
      sleeping: p.daysSleeping,
      sleepWalking: p.daysSleepWalking,
      stopping: p.daysStopping,
      tortoiseWalking: p.daysTortoiseWalking,
    },
    daysRejectedByBank: p.daysRejectedByBank,
    bankFreezeDays: 0,
    godInfo: p.godInfo,
    f64: p.f64,
    cards: [...p.cards],
    tools: [],
    totalWinterSleepDays: p.totalWinterSleepDays,
    alliedPlayer: p.alliedPlayer,
    alliedDays: p.alliedDays,
    insuranceDays: p.daysAssurance,
    // ★★ 2026-09-17 订正（三个都是「写了但读错/没读」，由時光機快照的历史数据暴露）：
    //   · `+0x44/0x46/0x48` 是**神明附身的三项修正**（写侧一直对，读侧先前硬编码 0）——
    //     Save0 的 slot0 快照里玩家 0 是 `-100/60/60`，正是 `rules/objects.ts` 表里
    //     **天使** 的三项（`@source 0x40ead7` 附身时写、`0x40e14d` 送走时清）；
    //   · `savedTrafficMethod` 的真值在 **`+0x66`**、`savedNdices` 在 **`+0x67`**
    //     （`@source 0x4441dc` 夢遊卡：`mov dl,[+0x11] / mov [+0x66],dl`、
    //      `mov dl,[+0x12] / mov [+0x67],dl`）。
    //   ⚠️ 先前读的是 `f67`（`+0x43`，**全 exe 无读无写**）与 `f68`（`+0x44`，其实是
    //     misfortune）—— 两个样本这几格恰好全 0，所以逐字节往返测试**看不出来**。
    savedTrafficMethod: p.f102,
    savedNdices: p.f103,
    misfortune: p.f68,
    fortune: p.f70,
    luck: p.f72,
    // ⚠️ 原版 hostility 实为 4 项；存档里的第 5/6 项是月度累计金额
    //   （见 rules/monthly.ts 的考证），故只取前 4 项。
    hostility: p.hostility.slice(0, 4),
    monthlyPaid: p.hostility[4] ?? 0,
    monthlyReceived: p.hostility[5] ?? 0,
  }));

  // 道具：原版存的是「每人每种道具的数量」，本引擎用一张扁平表
  const tools = emptyTools(n);
  for (let i = 0; i < n; i++) {
    const owned = save.players[i]?.tools ?? [];
    for (let id = 1; id <= owned.length; id++) {
      tools[i * TOOL_SLOTS_PER_PLAYER + id] = owned[id - 1] ?? 0;
    }
  }

  // ★ 2026-09-17（第十一轮）：地产归属/等级**已接** —— 它们在存档自带的地图块
  //   （`save.mapData`，就是当时的加载数组）里，`parseMap` 早就读出 `owner`/`level`，
  //   只是导入路径先前把**静态**地图传了进来。实测 Save0 的存档地图块：
  //   55 块地里 43 块有主、40 块等级非 0。⇒ 这两条 gap 删掉。
  // ★ 樂透号码表已接（平坦 0x26be）——这条 gap 删掉。
  // ★ 行情（含历史游标）已全部接上（见 `importedMarket`）——这条 gap 删掉。
  // ★ 持仓已接（见上面 `holdings` 的构造）——这条 gap 删掉。
  // ★ 2026-09-17（第十轮）：公库**已定案**（平坦 0x26ba = `[0x499080]`）——
  //   先前「0x269e 像公库但次序不对」是误判（0x269e 是 `[0x49907c]`）。
  //   铁证：`rich4_player_core_actions.asm:5128` 收款方 = −1 时 `add [0x499080], ebx`；
  //   `rich4_stocks.asm:212` 手续费也加它；`rich4_ui_letou.asm:514` 把它印成奖池。
  //   实测 Save0 = 3000、SAVE1 = 0。这条 gap 删掉。
  // ★ 道具全局库存已接（见 `importedToolStock`）——这条 gap 删掉。
  // ★ 企业归属/排名/股数/盈餘也**已接**（同一个地图块，见上面的构造）——
  //   `parseMap` 现在会读 `+0x18`/`+0x1c..0x1f`/`+0x28`/`+0x2c`。
  //   ⇒ 这两条 gap 删掉。
  // ★ 物件表已接（见 `objects` 的构造）——这条 gap 删掉。
  // ★ 2026-09-17：替身表**已能从存档读出**（槽内 +0x1a8，5 × 16 字节，见
  //   `loaders/save.ts` 的 `SaveSpecialPlayer`），占用表随之**由替身表推出来**
  //   —— 两者是同一件事的两面，不一致就会出现「探得到却放不出来」的鬼状态
  //   （见 `rules/special-actors.ts` 的 `initialConfinement`）。
  //   仍缺的一格：`stepsRemaining`（「还剩几步」）**不在这 16 字节里**
  //   （它是全局 `[0x48baf8]`），故一律置 0 —— 替身走到一半时读档会少这一步数。
  // ★ 两个牌堆的洗牌序与游标已接（见 `importedDeck`）——这条 gap 删掉。
  gaps['rngState'] =
    '原版不存随机数状态（原版对局本就不可复现），读档后必须由宿主注入新种子';

  // ★ 2026-09-17：替身表**从存档读**（槽内 +0x1a8），占用表由它推出来。
  const specialActors = importedSpecialActors(save);
  const prisonOccupancy = confinementFromActors(specialActors, 'prison');
  const hospitalOccupancy = confinementFromActors(specialActors, 'hospital');

  const state: GameState = {
    mode: 'single',
    // ★ 必须由宿主用 reseed 注入 —— 这里给个确定的占位，
    //   避免「读档后每次跑出来的都不一样」这种最难查的不确定性。
    rngState: 1,
    globalMapId: save.globalMapId,
    day: save.day,
    month: save.month,
    year: save.year,
    players,
    currentPlayer: Math.min(Math.max(save.currentPlayer, 0), n - 1),
    phase: 'turnStart',
    priceIndex: save.priceIndex,
    // ★ 地图视角旋转（`[0x499088]`，存档 `+0x2743`）—— 原版存它，故读档要恢复。
    //   两个样本都是 0，所以这条同样只能靠构造字节验证（见 savegame.test.ts）。
    viewRotation: save.viewRotation,
    // 本局开局资金档位（存档 0x268a）；老档 / 自制档里是 0 时退回默认档
    initialFund: save.initialFund > 0 ? save.initialFund : DEFAULT_INITIAL_FUND,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    forcedDice: 0,
    cardAmount: [...save.cardAmount],
    // ★ 2026-09-17（第十一轮）：归属与等级**从地图读**了。
    //   静态地图文件里那两项恒为 0，而存档自带的地图块（`save.mapData`）
    //   就是当时的加载数组 ⇒ 直接把实时归属读出来。
    //   ⚠️ 前提是调用方把**存档自己的地图块**解析结果传进来
    //   （`parseMap(save.mapData)`，见 `client/main.ts` 的匯入路径）。
    landOwner: landOwnerFromMap(map, landCount),
    landLevel: landLevelFromMap(map, landCount),
    // ★ 种类从地图读出来当初值 —— 它会被改建卡/傳送機改，不能每次回地图取
    landType: landTypeFromMap(map, landCount),
    landPrice: landPriceFromMap(map, landCount),
    // ★ 公佈欄挂牌表**从存档读回来**（块 0x2526，4 玩家 × 7 槽 × 12 字节）。
    //   先前这里硬写 `emptyBoard()` ⇒ 挂牌在存档往返里**整块丢失**。
    noticeBoard: importedNoticeBoard(save),
    turnCount: 0,
    snapshots: [null, null, null, null],
    // ★ 2026-09-17（第十轮）：两个牌堆的**洗牌序与游标**都从存档读了
    //   （平坦 0x26fa / 0x271e，游标 0x26f2 / 0x26f6）—— 先前是按顺序重建的。
    newsDeck: importedDeck(save.newsDeck, save.newsCursor, NEWS_DECK_SIZE),
    fortuneDeck: importedDeck(save.fortuneDeck, save.fortuneCursor, FORTUNE_DECK_SIZE),
    // ★ 公库（平坦 0x26ba = `[0x499080]`）也读了 —— 先前一律 0
    pool: save.pool,
    specialActors,
    landTenureIndex: 0,
    // ★ 2026-09-16：两个全局现在**真的从存档读**了（0x2682 / 0x2686），
    //   不再一律按「無限」导入。
    winConditions: { targetDays: save.winTargetDays, targetWealth: save.winTargetWealth },
    // ★ 人类玩家数读存档块 `0x01b0`（`[0x499104]`）；0/异常值才退回按 whoPlays 数
    //   —— 原版这个全局只在开新局写一次，破产不改它（见 state/types.ts）
    humanPlayers: save.humanPlayers > 0
      ? save.humanPlayers
      : save.players.filter((pl) => (pl.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN).length,
    // 导入的是「一局进行中」的状态，不是某条结束路径的结局
    victory: null,
    // ★ 已过天数也从存档读（0x2692）—— 它进「平均盈餘 = 盈餘 ÷ 总天数」，
    //   也进勝利條件的天数判定；先前一律 0，读档后那两处都是错的。
    totalDays: save.totalDays,
    // ★ 月数计数器也从存档读（`[0x499084]`，平坦 0x2696）—— 先前硬填 0，
    //   于是「土地现值 ÷ 月数」（`0x429f60 idiv`）与跨月计数读档后都是错的。
    //   实测 Save0 = 9、SAVE1 = 0。这条是**写出侧往返测试**发现的（见 save-writer.test.ts）。
    totalMonths: save.totalMonths,
    landLastToll: new Array<number>(landCount).fill(0),
    // ★ 2026-09-17（第十二轮）：地契到期日与涨价/查封倒计时**从存档地图块读**。
    //   原版把两者都存在地图块里（住宅 `+0x30`/`+0x17`，商業 `+0x34`/`+0x1c`），
    //   而导入路径用的正是**存档自带的地图块** ⇒ 真值就在手边。
    //   此前硬填 0 的后果：读档后所有「涨价/跌价/查封」倒计时消失、
    //   所有「土地權限」到期日失效（`reduce.ts` 的 `sweepPriceStatus` 与
    //   `tenureExpiresToday` 永不触发）。
    landTenure: landTenureFromMap(map, landCount),
    landPriceStatus: landPriceStatusFromMap(map, landCount),
    facilityOwner: facilityFieldFromMap(map, (f) => f.owner),
    facilityLevel: facilityFieldFromMap(map, (f) => f.level),
    facilityType: facilityFieldFromMap(map, (f) => f.type),
    facilityPriceStatus: facilityFieldFromMap(map, (f) => f.priceStatus),
    facilityPrice: facilityFieldFromMap(map, (f) => f.landPrice),
    facilityLastToll: facilityFieldFromMap(map, () => 0),
    // ★ 同上：商業用地的地契到期日在 `+0x34`（与住宅的 `+0x30` 不同）
    facilityTenure: facilityFieldFromMap(map, (f) => f.flast),
    // ★★ 研发进度要**从地图块读**（`+0x1d` 项目 / `+0x1e` 剩余天数）。
    //   先前一律填 0 ⇒ 读原版存档时**正在研发的設施进度归零**。
    //   这个坑是被 `withLiveMapState` 的「合并前后逐字节相同」用例揪出来的：
    //   Save0 的 2 号設施在地图块里 `researchProject = 1`，而导入后是 0。
    facilityResearchProject: facilityFieldFromMap(map, (f) => f.researchProject ?? 0),
    facilityResearchDays: facilityFieldFromMap(map, (f) => f.researchDays ?? 0),
    // ★ 企业那四项也从地图读（+0x18 归属 / +0x1c..0x1f 排名 / +0x28 累積盈餘 /
    //   +0x2c 累計盈餘 / +0x30 可售股数）—— 实测 Save0：4/5 号归属 = 2（玩家 1），
    //   3 号 funds = 48000、4 号 profit = 197800、2 号 shares = 2176。
    commercialShares: commercialLiveFromMap(map, (c) => c.shares),
    commercialOwners: commercialOwnersFromMap(map),
    companyFunds: commercialLiveFromMap(map, (c) => c.funds),
    companyProfit: commercialLiveFromMap(map, (c) => c.profit),
    aiStep: 0,
    aiBranch: 0,
    prisonOccupancy,
    hospitalOccupancy,
    lastEvent: null,
    // 纯表现提示：读档后不播「上一局那趟」（见 state/types.ts 的 GameState.lastNpcWalks）
    lastNpcWalks: [],
    lastCardPlay: null,
    // 纯表现提示：读档后不弹「上一局那一笔」（见 state/types.ts 的 GameState.notices）
    notices: [],
    lastViewTarget: null,
    // 回合边界的惡人队列：读档回到回合边界也是空的（重新起算）
    pendingNpcSlots: [],
    // ★ 樂透号码表（平坦 0x26be = `[0x4990b8]`，36 字节，值 = 持有者 + 1）
    lottery: importedLottery(save),
    pending: null,
    pendingQueue: [],
    tools,
    // ★ 2026-09-17：全局道具库存**从存档读**（平坦 `0x6ea`，8 字节，
    //   `[道具号 - 1]`；> 8 号不限量、存档里也不存，按初始值放着）。
    toolStock: importedToolStock(save),
    // ★ 2026-09-17：行情**从存档读**（12 支 × 36 字节 + 144 日历史 0x1b00）。
    //   名字/顺序仍用静态表（存档 `+0` 是 exe 的名字**指针**，跨版本无意义），
    //   其余每个字段都覆盖成存档里的值；`index` 不在存档里 ⇒ 按定义重算
    //   （`trunc(Σ收盘 × 10)`，与 `tickStockMarket` 同一条式子）。
    market: importedMarket(save),
    // ★ 2026-09-17：持仓**从存档读**（`OFFSET.playerStocks`，4 人 × 12 支 × 8 字节）
    holdings: players.map((_, i) =>
      Array.from({ length: STOCKS_PER_MAP }, (_, j) => {
        const rec = save.playerStocks[i]?.[j];
        return rec === undefined
          ? { ...EMPTY_HOLDING }
          : { amount: rec.amount, avgCost: rec.avgCost };
      }),
    ),
    // ★ 2026-09-17：地图物件**从存档读**（平坦 `0x0204`，46 × 24 字节）。
    //   真 Save0 实测：46 项的 `type` 与静态表 `OBJECT_TYPE_TABLE` **逐个相符**，
    //   且有 8 个 `nodeId != 0`（神明 1/3/5/8/10、惡犬 11、路障 16×2）。
    objects: save.objects.map((rec) => ({
      type: rec.type,
      nodeId: rec.nodeId,
      state: rec.state,
      attached: rec.attached,
    })),
  };

  return { state, gaps, map };
}

// ============================================================
//  逐回合快照（時光機）的**读入**
// ============================================================

function readU32(data: Uint8Array, off: number): number {
  return (
    ((data[off] ?? 0) |
      ((data[off + 1] ?? 0) << 8) |
      ((data[off + 2] ?? 0) << 16) |
      ((data[off + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * 把原版存档里的**一份逐回合快照**还原成 `GameState`。
 *
 * ★ 快照不是「另一种格式」，而是**状态块的一个子集**：
 *   `SNAPSHOT_REGIONS` 的 28 个区（9,999 字节）与状态块**同源同义**，
 *   只是落在快照里的偏移不同。所以读入就是写出器的**逐字节逆运算**：
 *
 * ```text
 * 合成状态块 = 当前状态块
 *            ⊕ 快照的 28 个区（按 SNAPSHOT_REGIONS 搬回状态块偏移）
 * 合成存档   = 合成状态块 + 该快照自己的地图副本
 * ```
 * 之后走**现成的** `parseSave` → `importOriginalSave` ——
 * 不另写一套字段映射，故不可能与状态块读入出现分歧。
 *
 * ⚠️ 快照**自带地图副本**（回合开始时的归属/等级就在那份地图里），
 *   必须用**它**去解析，否则会「状态是回合开始的、归属是现在的」。
 *
 * @param stateBlock 文件开头那份状态块（`raw[0 .. 0x274b]`）
 * @param snapshot   该玩家的 `0x2718` 字节
 * @param mapData    紧随其后的地图副本（`mapDataSize` 字节）
 * @returns 该槽的导入结果；**空槽返回 `null`**（有效标记为 0）
 */
export function importPlayerSnapshot(
  stateBlock: Uint8Array,
  snapshot: Uint8Array,
  mapData: Uint8Array,
  fallbackMap: Rich4Map,
): ImportResult | null {
  if (snapshot.length < PLAYER_SNAPSHOT_SIZE) return null;
  // @source `0x004480ce mov dword ptr [eax + 0x48cb80], 1` —— 只给真人存
  if (readU32(snapshot, SNAPSHOT_FLAG_OFFSET) === 0) return null;

  const block = stateBlock.slice(0, ORIGINAL_STATE_BLOCK_SIZE);
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset);
    if (b === undefined) continue;
    block.set(snapshot.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes), r.stateBlockOffset);
  }

  const synthetic = new Uint8Array(block.length + mapData.length);
  synthetic.set(block, 0);
  synthetic.set(mapData, block.length);
  return importOriginalSave(parseSave(synthetic), fallbackMap);
}

/**
 * 匯入原版存档，**并把 4 个時光機快照一起读进来**。
 *
 * 这是 `importOriginalSave` 的完整版：除了当前局面，还把每玩家槽里的
 * 「回合开始时状态」还原成 `takeSnapshot` 那种 JSON，填进 `state.snapshots`
 * —— 否则读档之后時光機是**空转**的（原版读档后照常能回溯）。
 *
 * ⚠️ 快照槽**只有真人玩家才有**（`@source 0x0044809f test byte [player+0x15],1`），
 *   空槽保持 `null`，与 `restoreSnapshot` 的「没存过 → 不消耗道具」一致。
 */
export function importOriginalSaveWithSnapshots(
  raw: Uint8Array,
  fallbackMap: Rich4Map,
): ImportResult {
  const save = parseSave(raw);
  const base = importOriginalSave(save, fallbackMap);
  const mapDataSize = save.mapData.length;
  const stateBlock = raw.subarray(0, ORIGINAL_STATE_BLOCK_SIZE);
  const snapshots = [...base.state.snapshots];
  for (let i = 0; i < save.numPlayers; i++) {
    // 文件布局：状态块 + 主地图 + 每玩家（快照 0x2718 + 该玩家的地图副本）
    const at = OFFSET.mapData + mapDataSize + i * (PLAYER_SNAPSHOT_SIZE + mapDataSize);
    if (at + PLAYER_SNAPSHOT_SIZE + mapDataSize > raw.length) break;
    const snap = raw.subarray(at, at + PLAYER_SNAPSHOT_SIZE);
    const snapMap = raw.subarray(at + PLAYER_SNAPSHOT_SIZE, at + PLAYER_SNAPSHOT_SIZE + mapDataSize);
    const imported = importPlayerSnapshot(stateBlock, snap, snapMap, fallbackMap);
    if (imported !== null) snapshots[i] = takeSnapshot(imported.state);
  }
  return { ...base, state: { ...base.state, snapshots } };
}
