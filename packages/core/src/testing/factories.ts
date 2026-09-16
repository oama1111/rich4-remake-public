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
import type { LandInfo, FacilityInfo, MapNode, Rich4Map } from '../loaders/map.ts';
import { emptyBoard } from '../places/notice-board.ts';
import { DEFAULT_INITIAL_FUND } from '../rules/setup.ts';
import { initialSpecialActors } from '../rules/special-actors.ts';
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
    cashRatio: 50,
    loanRatio: 0,
    stockRatio: 0,
    personality: 0,
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
    bankFreezeDays: 0,
    godInfo: 0,
    f64: 0,
    cards: [],
    tools: new Array<number>(13).fill(0),
    totalWinterSleepDays: 0,
    alliedPlayer: 0,
    alliedDays: 0,
    insuranceDays: 0,
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
    // ★ 1998-01-05（星期一）—— 1998-01-01 是元旦，節日表首条，股市休市；
    //   默认日期若落在休市日，所有「随手建个状态就买股票」的测试都会静默失败。
    day: 5, month: 1, year: 1998,
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i })),
    currentPlayer: 0,
    phase: 'turnStart',
    priceIndex: 1,
    // 本局开局资金档位
    initialFund: DEFAULT_INITIAL_FUND,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    forcedDice: 0,
    cardAmount: new Array<number>(30).fill(0),
    landOwner: [],
    landLevel: [],
    landType: [],
    landTenureIndex: 0,
    // 勝利條件默认两条都無限（= 加字段之前的行为，见 rules/victory.ts）
    winConditions: { targetDays: 0, targetWealth: 0 },
    victory: null,
    totalDays: 0,
    totalMonths: 0,
    landLastToll: new Array<number>(64).fill(0),
    landTenure: new Array<number>(64).fill(0),
    landPriceStatus: new Array<number>(64).fill(0),
    facilityOwner: new Array<number>(32).fill(0),
    facilityLevel: new Array<number>(32).fill(0),
    facilityType: new Array<number>(32).fill(0),
    facilityPriceStatus: new Array<number>(32).fill(0),
    facilityLastToll: new Array<number>(32).fill(0),
    facilityTenure: new Array<number>(32).fill(0),
    facilityResearchProject: new Array<number>(32).fill(0),
    facilityResearchDays: new Array<number>(32).fill(0),
    companyFunds: new Array<number>(16).fill(0),
    companyProfit: new Array<number>(16).fill(0),
    aiStep: 0,
    aiBranch: 0,
    noticeBoard: emptyBoard(),
    specialActors: initialSpecialActors(),
    turnCount: 0,
    snapshots: [null, null, null, null] as (string | null)[],
    // 测试默认给顺序牌堆——不洗牌，好让用例能指定拿到哪张
    newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: 0 },
    fortuneDeck: { order: Array.from({ length: 37 }, (_, i) => i), cursor: 0 },
    pool: 0,
    prisonOccupancy: new Array<number>(8).fill(0),
    hospitalOccupancy: new Array<number>(8).fill(0),
    lastEvent: null,
    // 纯表现提示：还没人走过（见 types.ts 的 GameState.lastNpcWalks）
    lastNpcWalks: [],
    // 回合边界的惡人队列
    pendingNpcSlots: [],
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

/**
 * 从一张真地图造**完整**的 `topo`。
 *
 * ★ 2026-09-16 加：先前各测试各自写
 *   `const topo = { nodes: map.nodes, lands: map.lands }` —— 而规则里
 *   `topo.facilities` / `topo.commercials` **缺了就直接不结算、且不报错**，
 *   于是那些测试看着在跑一局，其实**从来没走到設施落点与企业落点**
 *   （`soak.test.ts` 就是这么瞎了很久，直到地圖 7 那条断言把它照出来）。
 *   统一走这里，少一个字段就是编译错误，而不是静默跳过。
 */
export function topoOf(map: Rich4Map): {
  nodes: MapNode[];
  lands: LandInfo[];
  facilities: FacilityInfo[];
  commercials: Rich4Map['commercials'];
} {
  return {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
  };
}
