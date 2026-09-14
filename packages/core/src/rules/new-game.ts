/*
 * 开新局
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 把「地图 + 玩家配置」变成一个可以直接喂给 `reduce()` 的初始状态。
 *
 * ★ 这是引擎此前缺的一块：测试有 `testing/factories.ts` 的 makeGameState，
 *   但那是给测试用的任意状态构造器，不保证符合原版的开局规则
 *   （资金分配、起始位置、牌堆数量）。真正开局要走本模块。
 */

import type { Rich4Map } from '../loaders/map.ts';
import type { GameState, Player } from '../state/types.ts';
import type { GameMode } from '../rng/policy.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';
import { DEFAULT_INITIAL_FUND, startingMoney } from './setup.ts';
import { CARDS, CHARACTERS } from '@rich4/data';
import { traitsOf } from '../ai/personality.ts';
import { INITIAL_PRICE_INDEX } from './wealth.ts';
import { CARD_IMPLS } from '@rich4/data';
import { FORTUNE_DECK_SIZE, NEWS_DECK_SIZE, createDeck } from '../events/deck.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { CONFINEMENT_SLOTS } from './confinement.ts';
import { emptyLottery } from '../places/lottery.ts';
import { emptyBoard } from '../places/notice-board.ts';
import { initialConfinement, initialSpecialActors } from './special-actors.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { emptyOwnership } from '../places/commercial.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from './objects.ts';
import {
  INITIAL_OBJECT_TYPES,
  objectNodeCandidates,
  pickObjectNode,
  placeObjectOfType,
} from './object-landing.ts';
import { TRAFFIC_REFUND } from './tool-effects.ts';
import { EMPTY_HOLDING } from '../places/stock.ts';
import { STOCKS_PER_MAP, stocksOfMap } from '@rich4/data';
import {
  STARTING_TOOLS,
  initialToolStock,
  emptyTools,
  giveTool,
} from './tools.ts';

/** 一名参战者的配置 */
export interface PlayerSetup {
  /** 角色编号 0..11 —— 决定开局现金/存款的比例 */
  character: number;
  /** 由人操作还是电脑 */
  kind: 'human' | 'computer';
}

export interface NewGameOptions {
  map: Rich4Map;
  players: readonly PlayerSetup[];
  /** 地图编号 `gameStage * 4 + gameMap` */
  globalMapId?: number;
  /** 开局资金档位，见 setup.ts 的 GAME_INITIAL_FUNDS */
  initialFund?: number;
  mode?: GameMode;
  /** PRNG 种子。★ 单机可随意；联机必须由服务器统一下发 */
  seed?: number;
  /** 所有人的起始节点。原版是地图上的固定起点，尚未定位，故可注入 */
  startNodeId?: number;
  /**
   * 開局自帶載具：0 走路 / 1 機車 / 2 汽車。
   *
   * ★ 原版是个**全局设置**（`[0x0046cb44]`），开局屏上选，对所有玩家一律生效：
   * ```asm
   * ; VA 0x00407219
   * dl = byte [0x46cb44]
   * [player + 0x11] = dl                  ; traffic_method
   * if (dl != 0) byte[0x497323 + dl]--    ; ★ 扣那件交通工具的全局库存
   * dl = byte[0x46cb44] + 1
   * [player + 0x12] = dl                  ; ★ ndices = traffic + 1
   * ```
   * 这解释了 `jump.mkf` 为什么每个角色有走路／機車／汽車三套侧视动画。
   */
  startingVehicle?: number;
  /** 土地權限档位 0..5，默认 0 = 無限期 @source `[0x46cb48]` → `[0x499110]` */
  landTenure?: number;
}



/**
 * 每种卡片的初始张数。
 *
 * ⚠️ **尚未从原版取得**：牌堆数量表的位置未定位。
 * 它只影响抽卡的概率分布，不影响任何已验证的规则；
 * 一旦定位到真值应立刻替换。见 docs/known-deviations.md 的 Q-INIT-1。
 */
/**
 * ⚠️ **已废弃**：牌堆初值不是常数，是卡片表的 `initAmount`（見 `initialCardAmounts`）。
 *   留着只为不破坏旧引用；新代码别用。
 */
export const UNVERIFIED_CARDS_PER_KIND = 8;

/**
 * 牌堆各卡的初始张数 = 卡片表的 `initAmount`（§7.1 那一列）。
 *
 * @source 開局 VA 0x004071a5：
 * ```asm
 * 004071a5  mov al, byte [ebx*8 + 0x47fdf6]     ; card_table[i].init_amount（+4）
 * 004071ac  mov byte [ebx + 0x499198], al        ; remain_card_amount[i]
 * 004071b3  cmp ebx, 0x1e / jl                   ; 30 张
 * ```
 * 紧接着 0x004071ba 同样的循环把道具表的 `initAmount` 抄进道具库存（已实现）。
 * Q-INIT-1 结案。
 */
export function initialCardAmounts(): number[] {
  const out = new Array<number>(CARD_IMPLS.length).fill(0);
  for (const c of CARDS) if (c.id - 1 < out.length) out[c.id - 1] = c.initAmount;
  return out;
}

/**
 * 起始节点。
 *
 * ⚠️ **尚未从原版取得**：地图头里没有起点字段（实测 0001.bin 的
 * 0x28 之后全为 0），开局代码里也查不到对 `node_id` 的写入。
 * 起点可能由某个特殊格类型或首次移动决定，待查。
 * 见 docs/known-deviations.md 的 Q-INIT-2。
 */
/**
 * ⚠️ **已废弃**：起始节点不是常数，是**随机抽**的（见 `drawStartNodes`）。
 *   留着只为 `startNodeId` 这个测试用的覆盖项有个默认值；`0` 表示「照原版随机」。
 */
export const UNVERIFIED_START_NODE = 0;

/**
 * 每个玩家的起始节点 —— **在全图可放物件的节点里随机抽一格**。
 *
 * @source 開局摆人 VA 0x004082d9 `call 0x40aa0f` → 结果写进 `node_id`（0x004082fb）。
 *   `0x40aa0f`：
 * ```asm
 * 0040aa1d  for (i = 1; i <= 节点数; i++)
 * 0040aa37    if (node.flags & 0x80ffff00) continue    ; 特殊格 / 已被占用的都不要
 * 0040aa40    if (四个邻接全为 0) continue              ; 孤立格不要
 * 0040aa4c    候选[n++] = i
 * 0040aa53  return 候选[rand() % n]
 * ```
 *   这与物件登场挑格的 `objectNodeCandidates`/`pickObjectNode` 是**同一条**筛选
 *   （那两个函数就是照它写的），故直接复用。`flags` 的 bits 8..11 是「谁站在这格」，
 *   所以**后摆的人不会与先摆的人同格** —— 这里按下标顺序逐个抽、逐个排除。
 *   Q-INIT-2 结案。
 */
export function drawStartNodes(
  nodes: Rich4Map['nodes'],
  count: number,
  rng: WatcomRng,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const free = objectNodeCandidates(nodes).filter((n) => !out.includes(n));
    out.push(pickObjectNode(free, rng.next()));
  }
  return out;
}

/**
 * 每家公司的总股本。
 * @source 开局初始化 `mov edx, 0x2710 / sub edx, 流通股数`（VA 0x00407df1）
 */
export const COMMERCIAL_TOTAL_SHARES = 0x2710; // 10000

/**
 * 各上市企业开局**自留**多少股（即还能卖给玩家多少）。
 *
 * @source 开局循环 VA 0x00407dd1：
 * ```asm
 * dl = byte [commercial + 0x19]        ; 对应股票下标
 * eax = word [stocks + dl*36 + 8]      ; 该股的流通股数
 * edx = 0x2710 - eax                   ; ★ 10000 − 流通股数
 * [commercial + 0x30] = edx
 * ```
 *
 * ⚠️ 地图文件里的 +0x30 **恒为 0**，这个值是开局算出来的，不是读出来的。
 *   后果很具体：流通股数已是 10000 的公司（如中國信託、大宇百貨）
 *   自留 0 股，**落在它们格子上买不到股**；只有 5000 股流通的人壽类
 *   才有 5000 股可卖。
 */
function commercialSharesOf(map: Rich4Map, globalMapId: number): number[] {
  const stocks = stocksOfMap(globalMapId);
  const out = new Array<number>(map.commercials.length + 1).fill(0);
  for (const c of map.commercials) {
    const floating = stocks[c.stockIndex]?.shares ?? 0;
    out[c.id] = COMMERCIAL_TOTAL_SHARES - floating;
  }
  return out;
}

function makeInitialPlayer(
  index: number,
  setup: PlayerSetup,
  fund: number,
  startNode: number,
  vehicle: number,
): Player {
  const money = startingMoney(setup.character, fund);
  return {
    index,
    character: setup.character,
    whoPlays: setup.kind === 'human' ? WHO_PLAYS_HUMAN : WHO_PLAYS_COMPUTER,
    xpos: 0,
    ypos: 0,
    nodeId: startNode,
    lastNodeId: startNode,
    direction: 0,
    // @source VA 0x00407219：交通工具与骰子数都由开局设置定，`ndices = traffic + 1`
    trafficMethod: vehicle,
    ndices: vehicle + 1,
    // @source player_info +0x14 sex：非 0 是男。取自角色表，开局定下不再变
    isMale: !(CHARACTERS[setup.character]?.isFemale ?? false),
    // @source +0x16/+0x17/+0x18/+0x1a 都是开局从角色表拷进来的性格旋钮
    ...traitsOf(setup.character),
    cash: money.cash,
    moneyInBank: money.moneyInBank,
    loan: 0,
    specialFinance: 0,
    loanDueDate: 0,
    points: 0,
    blocking: {
      inHotel: 0,
      disappearing: 0,
      inPrison: 0,
      inHospital: 0,
      sleeping: 0,
      sleepWalking: 0,
      stopping: 0,
      tortoiseWalking: 0,
    },
    daysRejectedByBank: 0,
    godInfo: 0,
    f64: 0,
    cards: [],
    // 道具已移到 GameState 的全局表；此处保留空数组仅为兼容
    tools: [],
    totalWinterSleepDays: 0,
    alliedPlayer: 0,
    alliedDays: 0,
    savedTrafficMethod: 0,
    savedNdices: 0,
    misfortune: 0,
    fortune: 0,
    luck: 0,
    hostility: [0, 0, 0, 0],
    monthlyPaid: 0,
    monthlyReceived: 0,
  };
}

/**
 * 造一个符合开局规则的状态。
 *
 * ★ 与 `makeGameState`（测试工厂）的区别：
 * - 按角色的 `initCashRatio` 分配现金/存款（已由 SAVE1.DAT 验证）
 * - 物价指数取原版开局值 1
 * - 地产全部无主、等级为 0，长度与地图的地块数对齐
 */
/**
 * 从地图读出各地块的初始种类。
 *
 * ★ 之后它会被改建卡（`type ^ 1`）与傳送機改掉，所以必须进状态；
 *   每次回地图静态数据取的话，那些改动等于没发生。
 */
export function landTypeFromMap(map: Rich4Map, landCount: number): number[] {
  const out = new Array<number>(landCount).fill(0);
  for (const l of map.lands) out[l.id] = l.type;
  return out;
}

/** 設施表的某个字段读成数组，下标 = 設施 id（0 号空着，与地块同制） */
export function facilityFieldFromMap(
  map: Rich4Map,
  pick: (f: Rich4Map['facilities'][number]) => number,
): number[] {
  const n = map.facilities.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  const out = new Array<number>(n).fill(0);
  for (const f of map.facilities) out[f.id] = pick(f);
  return out;
}

export function newGame(opts: NewGameOptions): GameState {
  const {
    map,
    players,
    globalMapId = 0,
    initialFund = DEFAULT_INITIAL_FUND,
    mode = 'single',
    seed = 1,
    startNodeId = UNVERIFIED_START_NODE,
    startingVehicle: vehicle = 0,
    landTenure = 0,
  } = opts;

  if (players.length < 2 || players.length > 4) {
    throw new RangeError(`玩家数须在 2..4，收到 ${players.length}`);
  }

  const landCount = map.lands.length + 1; // 地块编号从 1 开始

  // ★ 牌堆用**同一个** PRNG 依次洗出——顺序不可调换，
  //   否则消耗的随机数序列与原版不同，之后所有随机结果都会偏。
  //   洗完后把推进过的种子写回 rngState。
  const rng = new WatcomRng(seed >>> 0);
  const newsDeck = createDeck(rng, NEWS_DECK_SIZE);
  const fortuneDeck = createDeck(rng, FORTUNE_DECK_SIZE);

  // ★ 开局给每人发六件道具（見 rules/tools.ts 的 STARTING_TOOLS）
  //   库存初值取自道具表（编号 1..8 各 10 份，9..13 不限量）
  let tools = emptyTools(players.length);
  let toolStock = initialToolStock();
  // @source VA 0x00407225：自帶載具也要从那件交通工具的全局库存里扣
  if (vehicle !== 0) {
    const vid = TRAFFIC_REFUND.get(vehicle) ?? 0;
    if (vid !== 0) {
      toolStock = toolStock.map((n, i) => (i === vid ? Math.max(0, n - players.length) : n));
    }
  }
  for (let i = 0; i < players.length; i++) {
    for (const toolId of STARTING_TOOLS) {
      const r = giveTool(tools, toolStock, i, toolId);
      tools = r.tools;
      toolStock = r.stock;
    }
  }

  // ★ 开局把「小的那一半」神明与禮物/寶箱摆上地图
  //   @source VA 0x00407d6a：type 从 1 到 11 每次 +2，再加 13、14
  //   ⚠️ 顺序与随机数消耗必须与原版一致：每摆一个抽一次。
  //   ⚠️ 已占的格子要排除：原版筛候选时查的是节点 flags 的**运行时**
  //   占用位（`test dword [+0x24], 0x80ffff00`），放下一个就置一位。
  //   本引擎不在节点上镜像那份状态，故这里改为反查物件表——不排除的话
  //   八次抽签里出现重叠的概率相当高，实测第一个种子就撞上了。
  let objects = makeObjects(OBJECT_COUNT);
  const spots = objectNodeCandidates(map.nodes);
  const taken = new Set<number>();
  for (const type of INITIAL_OBJECT_TYPES) {
    const free = spots.filter((n) => !taken.has(n));
    const node = pickObjectNode(free, rng.next());
    if (node === 0) break;
    taken.add(node);
    objects = placeObjectOfType(objects, type, node).objects;
  }

  const startNodes = drawStartNodes(map.nodes, players.length, rng);

  return {
    mode,
    rngState: rng.getState(),
    globalMapId,
    day: 1,
    month: 1,
    year: 1998,
    players: players.map((s, i) =>
      makeInitialPlayer(i, s, initialFund, startNodeId > 0 ? startNodeId : (startNodes[i] ?? 1), vehicle),
    ),
    currentPlayer: 0,
    phase: 'turnStart',
    priceIndex: INITIAL_PRICE_INDEX,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    forcedDice: 0,
    cardAmount: initialCardAmounts(),
    landOwner: new Array<number>(landCount).fill(0),
    landLevel: new Array<number>(landCount).fill(0),
    // ★ 种类从地图读出来当初值 —— 它会被改建卡/傳送機改，不能每次回地图取
    landType: landTypeFromMap(map, landCount),
    landTenureIndex: landTenure,
    landLastToll: new Array<number>(landCount).fill(0),
    landTenure: new Array<number>(landCount).fill(0),
    // ★ 地图数据里設施的 owner/level/type 都是 0（见 facility.test.ts 那条实证），
    //   但照地块的做法从地图播种，免得日后某张图不是 0 时悄悄漏掉
    facilityOwner: facilityFieldFromMap(map, (f) => f.owner),
    facilityLevel: facilityFieldFromMap(map, (f) => f.level),
    facilityType: facilityFieldFromMap(map, (f) => f.type),
    facilityLastToll: facilityFieldFromMap(map, () => 0),
    facilityTenure: facilityFieldFromMap(map, () => 0),
    facilityResearchProject: facilityFieldFromMap(map, () => 0),
    facilityResearchDays: facilityFieldFromMap(map, () => 0),
    noticeBoard: emptyBoard(),
    specialActors: initialSpecialActors(),
    turnCount: 0,
    snapshots: [null, null, null, null],
    newsDeck,
    fortuneDeck,
    pool: 0,
    // ★ 开局**不是空的**：小偷/強盜蹲監獄，流氓/間諜躺醫院。
    //   @source 0x00407351 四条 `mov byte [...], 1`，见 rules/special-actors.ts
    prisonOccupancy: initialConfinement('prison', CONFINEMENT_SLOTS),
    hospitalOccupancy: initialConfinement('hospital', CONFINEMENT_SLOTS),
    lastEvent: null,
    lottery: emptyLottery(),
    pending: null,
    tools,
    toolStock,
    // ★ 12 支股票取自本地图那一段（`地图编号 × 12`）
    market: newStockMarket(globalMapId, map.commercials),
    // 开局全员空仓 @source `_rich4_player_stocks` 全零
    holdings: players.map(() => Array.from({ length: STOCKS_PER_MAP }, () => ({ ...EMPTY_HOLDING }))),
    // ★ 各企业的可售股数取自地图记录的 +0x30；下标 = 企业 1 基序号
    commercialShares: commercialSharesOf(map, globalMapId),
    // 开局各企业无主、排名表全空
    commercialOwners: map.commercials.map(() => emptyOwnership()).concat([emptyOwnership()]),
    // ★ 46 项物件表（神明/路障/地雷/定時炸彈）
    objects,
  };
}
