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
 * ⚠️ **尚未从原版取得**。原版的牌堆数量表位置未定位，此处先给一个
 * 中性的均等值，并在 `docs/known-deviations.md` 留了条目。
 * 它只影响抽卡概率分布，不影响任何已验证的规则。
 */
export const PLACEHOLDER_CARDS_PER_KIND = 8;

/**
 * 起始节点。
 *
 * ⚠️ 原版的起点由地图数据里某个标记决定，**尚未定位**。
 * 暂取 1 号节点；`startNodeId` 可覆盖。
 */
export const PLACEHOLDER_START_NODE = 1;

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
    tools: new Array<number>(13).fill(0),
    totalWinterSleepDays: 0,
    alliedPlayer: 0,
    alliedDays: 0,
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
    startNodeId = PLACEHOLDER_START_NODE,
  } = opts;

  if (players.length < 2 || players.length > 4) {
    throw new RangeError(`玩家数须在 2..4，收到 ${players.length}`);
  }

  const landCount = map.lands.length + 1; // 地块编号从 1 开始
  return {
    mode,
    rngState: seed >>> 0,
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
    cardAmount: new Array<number>(CARD_IMPLS.length).fill(PLACEHOLDER_CARDS_PER_KIND),
    landOwner: new Array<number>(landCount).fill(0),
    landLevel: new Array<number>(landCount).fill(0),
    turnCount: 0,
  };
}
