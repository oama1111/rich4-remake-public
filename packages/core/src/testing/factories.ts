/*
 * 测试用对象工厂
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 集中一处构造 Player / GameState，避免每次给模型加字段时
 * 都要改十几个测试文件。
 */
import type { Player, GameState } from '../state/types.ts';
import { WHO_PLAYS_HUMAN } from '../state/types.ts';
import { slotsFrom } from '../loaders/map.ts';
import type { LandInfo, FacilityInfo, MapNode } from '../loaders/map.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from '../rules/objects.ts';

export function makePlayer(over: Partial<Player> = {}): Player {
  return {
    index: 0,
    character: 0,
    whoPlays: WHO_PLAYS_HUMAN,
    xpos: 100,
    ypos: 100,
    nodeId: 1,
    lastNodeId: 0,
    direction: 0,
    trafficMethod: 0,
    ndices: 1,
    isMale: true,
    aiFlags: 3,
    loanRatio: 0,
    stockRatio: 0,
    bailStyle: 0,
    cash: 100_000,
    moneyInBank: 50_000,
    loan: 0,
    specialFinance: 0,
    loanDueDate: 0,
    points: 0,
    blocking: {
      inHotel: 0, disappearing: 0, inPrison: 0,
      inHospital: 0, sleeping: 0, sleepWalking: 0,
      stopping: 0, tortoiseWalking: 0,
    },
    daysRejectedByBank: 0,
    godInfo: 0,
    f64: 0,
    cards: [],
    tools: new Array<number>(13).fill(0),
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
    ...over,
  };
}

export function makeGameState(over: Partial<GameState> = {}): GameState {
  return {
    mode: 'single',
    rngState: 1,
    globalMapId: 0,
    day: 1, month: 1, year: 1998,
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i })),
    currentPlayer: 0,
    phase: 'turnStart',
    priceIndex: 1,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    forcedDice: 0,
    cardAmount: new Array<number>(30).fill(0),
    landOwner: [],
    landLevel: [],
    landType: [],
    turnCount: 0,
    snapshots: [null, null, null, null] as (string | null)[],
    // 测试默认给顺序牌堆——不洗牌，好让用例能指定拿到哪张
    newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: 0 },
    fortuneDeck: { order: Array.from({ length: 37 }, (_, i) => i), cursor: 0 },
    pool: 0,
    prisonOccupancy: new Array<number>(8).fill(0),
    hospitalOccupancy: new Array<number>(8).fill(0),
    lastEvent: null,
    lottery: new Array<number>(36).fill(0),
    pending: null,
    tools: new Array<number>(4 * 15).fill(0),
    toolStock: new Array<number>(14).fill(99),
    market: newStockMarket(0),
    holdings: [0, 1, 2, 3].map(() => Array.from({ length: 12 }, () => ({ amount: 0, avgCost: 0 }))),
    commercialShares: [],
    commercialOwners: [],
    objects: makeObjects(OBJECT_COUNT),
    ...over,
  };
}

/** 最小可用地图节点 */
export function makeNode(over: Partial<MapNode> = {}): MapNode {
  const adjacent = over.adjacent ?? [];
  return {
    id: 1,
    x: 0,
    y: 0,
    name: '',
    adjacent,
    // 手工节点没有文件里的槽号，按邻接表顺序补（见 loaders/map.ts 的 slotsFrom）
    adjacentSlots: slotsFrom(adjacent),
    type: 0,
    ref: { kind: 'special' },
    decorIndex: 0,
    flags: 0,
    specialKind: 0,
    noObjects: false,
    walkable: true,
    ...over,
  };
}

export function makeLand(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1, x: 0, y: 0, name: '测试区',
    priceStatus: 0, type: 0, owner: 0, level: 0, facing: 0,
    landPrice: 1000, housePrice: 200,
    rentByLevel: [200, 500, 1200, 2800, 6000, 10000],
    flast: 0,
    ...over,
  };
}

export function makeFacility(over: Partial<FacilityInfo> = {}): FacilityInfo {
  return {
    id: 1, x: 0, y: 0, name: '测试设施', type: 0, owner: 0, level: 0, facing: 0,
    priceStatus: 0, landPrice: 5000, housePrice: 1000,
    rateByLevel: [1000, 2000, 4000, 8000, 16000, 32000],
    ...over,
  };
}
