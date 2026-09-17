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
import type { SaveGame } from './save.ts';
import type { Rich4Map } from './map.ts';
import { facilityFieldFromMap, landPriceFromMap, landTypeFromMap } from '../rules/new-game.ts';
import { emptyBoard } from '../places/notice-board.ts';
import {
  ACTOR_PLACE,
  INITIAL_ACTOR_PLACE,
  SPECIAL_ACTOR_BASE,
  idleActor,
  type SpecialActor,
} from '../rules/special-actors.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { emptyLottery } from '../places/lottery.ts';
import { EMPTY_HOLDING } from '../places/stock.ts';
import { emptyOwnership } from '../places/commercial.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from '../rules/objects.ts';
import { STOCKS_PER_MAP } from '@rich4/data';
import { emptyTools, initialToolStock, TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
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
 * 把存档里的 5 条替身记录搬成引擎的 `SpecialActor[]`。
 *
 * @source 记录布局见 `loaders/save.ts` 的 `SaveSpecialPlayer`；
 *   `place` 原版**不存**：`nodeId > 0` 就是在棋盘上走，
 *   否则沿用开局的位置（小偷/強盜在監獄、流氓/間諜在醫院、機器娃娃未出场）——
 *   与 `initialSpecialActors()` 同一套口径。
 */
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

export function importOriginalSave(save: SaveGame, map: Rich4Map): ImportResult {
  const gaps: Record<string, string> = {};
  const n = save.players.length;
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
    savedTrafficMethod: p.f67,
    savedNdices: p.f68,
    misfortune: 0,
    fortune: 0,
    luck: 0,
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

  // 地产归属与等级在存档的**地图数据块**里（结构同 map.mkf 的地图资源）。
  // 那一块已随存档读出，但本引擎的地图解析器目前只吃干净的地图资源，
  // 尚未支持从存档的地图块里回读实时归属。
  gaps['landOwner'] =
    '地产归属与等级存在存档的地图数据块中，解析器尚未支持从该块回读，已置为全部无主';
  gaps['lottery'] = '樂透号码表在存档中的偏移未验证，已置空';
  gaps['market'] = '股市行情与 144 日历史在存档中的偏移未验证，已按地图重置为初始行情';
  gaps['holdings'] = '各玩家持仓在存档中的偏移未验证，已置为空仓';
  gaps['pool'] = '公库金额在存档中的偏移未验证，已置 0';
  gaps['toolStock'] = '道具全局库存在存档中的偏移未验证，已置为初始库存';
  gaps['commercialShares'] = '各企业的已售股数在存档中的偏移未验证，已按地图初值重置';
  gaps['commercialOwners'] = '各企业的归属与持股排名在存档中的偏移未验证，已置为无主';
  gaps['objects'] = '地图物件表（神明/路障/地雷）在存档 0x0204 起，解析器尚未回读，已置空';
  // ★ 2026-09-17：替身表**已能从存档读出**（槽内 +0x1a8，5 × 16 字节，见
  //   `loaders/save.ts` 的 `SaveSpecialPlayer`），占用表随之**由替身表推出来**
  //   —— 两者是同一件事的两面，不一致就会出现「探得到却放不出来」的鬼状态
  //   （见 `rules/special-actors.ts` 的 `initialConfinement`）。
  //   仍缺的一格：`stepsRemaining`（「还剩几步」）**不在这 16 字节里**
  //   （它是全局 `[0x48baf8]`），故一律置 0 —— 替身走到一半时读档会少这一步数。
  gaps['newsDeck'] = '牌堆洗牌序在存档中的偏移未验证，已按顺序重建（不影响已抽过的牌）';
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
    // 本局开局资金档位（存档 0x268a）；老档 / 自制档里是 0 时退回默认档
    initialFund: save.initialFund > 0 ? save.initialFund : DEFAULT_INITIAL_FUND,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    forcedDice: 0,
    cardAmount: [...save.cardAmount],
    landOwner: new Array<number>(landCount).fill(0),
    landLevel: new Array<number>(landCount).fill(0),
    // ★ 种类从地图读出来当初值 —— 它会被改建卡/傳送機改，不能每次回地图取
    landType: landTypeFromMap(map, landCount),
    // ★ 存档里那块地图数据尚未回读（见下面的 gaps）⇒ 地价只能取地图初值
    landPrice: landPriceFromMap(map, landCount),
    noticeBoard: emptyBoard(),
    turnCount: 0,
    snapshots: [null, null, null, null],
    newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: 0 },
    fortuneDeck: { order: Array.from({ length: 37 }, (_, i) => i), cursor: 0 },
    pool: 0,
    specialActors,
    landTenureIndex: 0,
    // ★ 2026-09-16：两个全局现在**真的从存档读**了（0x2682 / 0x2686），
    //   不再一律按「無限」导入。
    winConditions: { targetDays: save.winTargetDays, targetWealth: save.winTargetWealth },
    // 导入的是「一局进行中」的状态，不是某条结束路径的结局
    victory: null,
    // ★ 已过天数也从存档读（0x2692）—— 它进「平均盈餘 = 盈餘 ÷ 总天数」，
    //   也进勝利條件的天数判定；先前一律 0，读档后那两处都是错的。
    totalDays: save.totalDays,
    totalMonths: 0,
    landLastToll: new Array<number>(landCount).fill(0),
    landTenure: new Array<number>(landCount).fill(0),
    landPriceStatus: new Array<number>(landCount).fill(0),
    facilityOwner: facilityFieldFromMap(map, (f) => f.owner),
    facilityLevel: facilityFieldFromMap(map, (f) => f.level),
    facilityType: facilityFieldFromMap(map, (f) => f.type),
    facilityPriceStatus: facilityFieldFromMap(map, (f) => f.priceStatus),
    facilityPrice: facilityFieldFromMap(map, (f) => f.landPrice),
    facilityLastToll: facilityFieldFromMap(map, () => 0),
    facilityTenure: facilityFieldFromMap(map, () => 0),
    facilityResearchProject: facilityFieldFromMap(map, () => 0),
    facilityResearchDays: facilityFieldFromMap(map, () => 0),
    companyFunds: new Array<number>(map.commercials.length + 1).fill(0),
    companyProfit: new Array<number>(map.commercials.length + 1).fill(0),
    aiStep: 0,
    aiBranch: 0,
    prisonOccupancy,
    hospitalOccupancy,
    lastEvent: null,
    // 纯表现提示：读档后不播「上一局那趟」（见 state/types.ts 的 GameState.lastNpcWalks）
    lastNpcWalks: [],
    // 回合边界的惡人队列：读档回到回合边界也是空的（重新起算）
    pendingNpcSlots: [],
    lottery: emptyLottery(),
    pending: null,
    tools,
    toolStock: initialToolStock(),
    market: newStockMarket(save.globalMapId),
    holdings: players.map(() =>
      Array.from({ length: STOCKS_PER_MAP }, () => ({ ...EMPTY_HOLDING })),
    ),
    // 下标 = 企业 1 基序号，故长度要多一格
    commercialOwners: Array.from({ length: map.commercials.length + 1 }, () => emptyOwnership()),
    objects: makeObjects(OBJECT_COUNT),
    commercialShares: Array.from(
      { length: map.commercials.length + 1 },
      (_, i) => map.commercials.find((c) => c.id === i)?.shares ?? 0,
    ),
  };

  return { state, gaps };
}
