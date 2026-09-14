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
import { INITIAL_PRICE_INDEX } from './wealth.ts';
import { CARD_IMPLS } from '@rich4/data';
import { FORTUNE_DECK_SIZE, NEWS_DECK_SIZE, createDeck } from '../events/deck.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { CONFINEMENT_SLOTS } from './confinement.ts';
import { emptyLottery } from '../places/lottery.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { emptyOwnership } from '../places/commercial.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from './objects.ts';
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
}

/**
 * 每种卡片的初始张数。
 *
 * ⚠️ **尚未从原版取得**：牌堆数量表的位置未定位。
 * 它只影响抽卡的概率分布，不影响任何已验证的规则；
 * 一旦定位到真值应立刻替换。见 docs/known-deviations.md 的 Q-INIT-1。
 */
export const UNVERIFIED_CARDS_PER_KIND = 8;

/**
 * 起始节点。
 *
 * ⚠️ **尚未从原版取得**：地图头里没有起点字段（实测 0001.bin 的
 * 0x28 之后全为 0），开局代码里也查不到对 `node_id` 的写入。
 * 起点可能由某个特殊格类型或首次移动决定，待查。
 * 见 docs/known-deviations.md 的 Q-INIT-2。
 */
export const UNVERIFIED_START_NODE = 1;

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

function makeInitialPlayer(index: number, setup: PlayerSetup, fund: number, startNode: number): Player {
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
    trafficMethod: 1,
    ndices: 1,
    cash: money.cash,
    moneyInBank: money.moneyInBank,
    loan: 0,
    specialFinance: 0,
    f44: 0,
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
    blessing: 0,
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
export function newGame(opts: NewGameOptions): GameState {
  const {
    map,
    players,
    globalMapId = 0,
    initialFund = DEFAULT_INITIAL_FUND,
    mode = 'single',
    seed = 1,
    startNodeId = UNVERIFIED_START_NODE,
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

  // ★ 开局给每人发 機器娃娃/路障/地雷/定時炸彈 各一个
  //   @source 开局循环 VA 0x0040727f 起对每个在场玩家的四次 give_tool
  //   库存初值取自道具表（编号 1..8 各 10 份，9..13 不限量）
  let tools = emptyTools(players.length);
  let toolStock = initialToolStock();
  for (let i = 0; i < players.length; i++) {
    for (const toolId of STARTING_TOOLS) {
      const r = giveTool(tools, toolStock, i, toolId);
      tools = r.tools;
      toolStock = r.stock;
    }
  }

  return {
    mode,
    rngState: rng.getState(),
    globalMapId,
    day: 1,
    month: 1,
    year: 1998,
    players: players.map((s, i) => makeInitialPlayer(i, s, initialFund, startNodeId)),
    currentPlayer: 0,
    phase: 'turnStart',
    priceIndex: INITIAL_PRICE_INDEX,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    cardAmount: new Array<number>(CARD_IMPLS.length).fill(UNVERIFIED_CARDS_PER_KIND),
    landOwner: new Array<number>(landCount).fill(0),
    landLevel: new Array<number>(landCount).fill(0),
    turnCount: 0,
    newsDeck,
    fortuneDeck,
    pool: 0,
    prisonOccupancy: new Array<number>(CONFINEMENT_SLOTS).fill(0),
    hospitalOccupancy: new Array<number>(CONFINEMENT_SLOTS).fill(0),
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
    // ★ 46 项物件表（神明/路障/地雷/定時炸彈），开局都不在场上
    objects: makeObjects(OBJECT_COUNT),
  };
}
