/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * AI 出牌策略（card-policy.ts）的逐卡测试 —— 每张卡的「出不出、对谁出」各至少一条。
 * 判定条件全部以 rich4.exe 跳表 0x475324 各项的 VA 为准（见 card-policy.ts 各处 @source）。
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode } from '../loaders/map.ts';
import type { MapTopology } from '../state/reduce.ts';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';
import { newStockMarket } from '../places/stock-market.ts';
import {
  AI_NEVER_PLAYS,
  aiCardChoice,
  cardsToConsider,
  mostHated,
  type CardAiView,
} from './card-policy.ts';

// ============================================================
//  场景搭建
// ============================================================

interface Fixture {
  nodes?: MapNode[];
  lands?: LandInfo[];
  facilities?: FacilityInfo[];
  players?: GameState['players'];
  state?: Partial<GameState>;
  meIndex?: number;
}

/** 最小画面：默认一个 (0,0) 的普通节点，四名玩家都站在上面（视野 ±220 内） */
function viewOf(f: Fixture = {}): CardAiView {
  const players = f.players ?? [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));
  const state = makeGameState({ players, currentPlayer: f.meIndex ?? 0, ...f.state });
  const meIndex = f.meIndex ?? 0;
  const topo: MapTopology = {
    nodes: f.nodes ?? [makeNode({ id: 1, x: 0, y: 0 })],
    lands: f.lands ?? [],
    facilities: f.facilities ?? [],
  };
  return { state, topo, meIndex, me: state.players[meIndex]!, lands: f.lands ?? [], facilities: f.facilities ?? [] };
}

const landNode = (id: number, landId: number, x = 0, y = 0, adjacent: number[] = []): MapNode =>
  makeNode({ id, x, y, ref: { kind: 'land', index: landId }, adjacent });

const facilityNode = (id: number, facilityId: number, x = 0, y = 0, adjacent: number[] = []): MapNode =>
  makeNode({ id, x, y, ref: { kind: 'facility', index: facilityId }, adjacent });

/** 一条直线步道：1→2→…→n，用于 lookahead 类判定 */
function lineNodes(n: number, refs: Map<number, MapNode['ref']> = new Map()): MapNode[] {
  const out: MapNode[] = [];
  for (let i = 1; i <= n; i++) {
    const adjacent = [i - 1, i + 1].filter((j) => j >= 1 && j <= n);
    out.push(makeNode({ id: i, x: i * 10, y: 0, adjacent, ref: refs.get(i) ?? { kind: 'special' } }));
  }
  return out;
}

// ============================================================
//  共用机制
// ============================================================

describe('共用机制', () => {
  it('最恨的人：hostility 最大且 > 0；全 0 则 −1（0x0040d2d3）', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 3, 9, 9]; // 并列取靠前者？不——严格大于才换，故取 2
    expect(mostHated(players, 0)).toBe(2);
    players[0]!.hostility = [0, 0, 0, 0];
    expect(mostHated(players, 0)).toBe(-1);
  });

  it('一回合最多看 8 张：手牌 > 8 时从 rand%张数 起环形取（0x00441d31）', () => {
    const hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(cardsToConsider(hand, 3)).toEqual([4, 5, 6, 7, 8, 9, 10, 1]);
    expect(cardsToConsider([5, 6, 7], 0)).toEqual([5, 6, 7]);
    expect(cardsToConsider([], 0)).toEqual([]);
  });

  it('AI 从不主动打的六张：跳表指向 xor eax,eax; ret', () => {
    expect(AI_NEVER_PLAYS).toEqual([5, 6, 18, 19, 20, 21]);
    const view = viewOf();
    for (const id of AI_NEVER_PLAYS) expect(aiCardChoice(id, view)).toBeNull();
    expect(aiCardChoice(99, view)).toBeNull();
  });
});

// ============================================================
//  三十张卡
// ============================================================

describe('1 均富卡（0x0041e6fe）', () => {
  it('平均現金 > 我 10 倍且我現金 < 3000×物價 → 出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 1000 : 50000 }));
    expect(aiCardChoice(1, viewOf({ players }))).toEqual({ target: { kind: 'none' } });
  });

  it('我不够穷 → 不出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 4000 : 50000 }));
    expect(aiCardChoice(1, viewOf({ players }))).toBeNull();
  });
});

describe('2 均貧卡（0x0041e779）', () => {
  it('画面里最恨的人現金 > 30000×物價 且 > 我 2 倍 → 对他出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 1 ? 100000 : 10000 }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(2, viewOf({ players }))).toEqual({ target: { kind: 'player', index: 1 } });
  });

  it('没人够富 → 不出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 10000 }));
    expect(aiCardChoice(2, viewOf({ players }))).toBeNull();
  });
});

describe('3 購地卡（0x0041e9e2）', () => {
  const land = makeLand({ id: 1, owner: 2, level: 2, landPrice: 1000, housePrice: 200 });
  const nodes = [landNode(1, 1)];

  it('脚下是最恨的人 ≥ 2 级的地且买得起 → 出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(3, viewOf({ players, nodes, lands: [land] }))).toEqual({ target: { kind: 'none' } });
  });

  it('(地價+房價×等级)×物價 ≥ 現金 → 不出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 1000 : 10000 }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(3, viewOf({ players, nodes, lands: [land] }))).toBeNull();
  });

  it('脚下是无主地（不值得拿）→ 不出', () => {
    expect(aiCardChoice(3, viewOf({ nodes, lands: [makeLand({ id: 1 })] }))).toBeNull();
  });
});

describe('4 換地卡（0x0041eae2）', () => {
  it('脚下我的 ≤ 1 级地，换画面里更贵更高且值得拿的一块', () => {
    const mine = makeLand({ id: 1, owner: 1, level: 1, landPrice: 1000, name: 'A' });
    const better = makeLand({ id: 2, owner: 2, level: 2, landPrice: 2000, name: 'B' });
    const nodes = [landNode(1, 1), landNode(2, 2, 10, 0)];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(4, viewOf({ players, nodes, lands: [mine, better] }))).toEqual({
      target: { kind: 'land', landId: 2 },
    });
  });

  it('同區还有别的我的地 → 不换', () => {
    const mine = makeLand({ id: 1, owner: 1, level: 1, landPrice: 1000, name: 'A' });
    const alsoMine = makeLand({ id: 3, owner: 1, level: 1, landPrice: 1000, name: 'A' });
    const better = makeLand({ id: 2, owner: 2, level: 2, landPrice: 2000, name: 'B' });
    const nodes = [landNode(1, 1), landNode(2, 2, 10, 0)];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(4, viewOf({ players, nodes, lands: [mine, alsoMine, better] }))).toBeNull();
  });
});

describe('7 改建卡（0x0041ed3e）', () => {
  it('脚下我的 1 级住宅，乖寶寶直接改', () => {
    const land = makeLand({ id: 1, owner: 1, level: 1 });
    expect(aiCardChoice(7, viewOf({ nodes: [landNode(1, 1)], lands: [land] }))).toEqual({
      target: { kind: 'none' },
    });
  });

  it('脚下我的 1 级公園 → 改成随机 1..4 的設施', () => {
    const park = makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.park, level: 1 });
    const choice = aiCardChoice(7, viewOf({ nodes: [facilityNode(1, 1)], facilities: [park] }));
    expect(choice).not.toBeNull();
    expect(choice!.target).toEqual({ kind: 'none' });
    expect(choice!.facilityType).toBeGreaterThanOrEqual(1);
    expect(choice!.facilityType).toBeLessThanOrEqual(4);
    // rngState = 1（工厂默认）时确定性结果为 3 —— 钉住 D-004 的替身行为
    expect(choice!.facilityType).toBe(3);
  });

  it('脚下最恨的人的 ≥ 2 级非公園設施 → 改', () => {
    const hotel = makeFacility({ id: 1, owner: 2, type: FACILITY_TYPE.hotel, level: 2 });
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(7, viewOf({ players, nodes: [facilityNode(1, 1)], facilities: [hotel] }))).toEqual({
      target: { kind: 'none' },
    });
  });

  it('脚下对手的 1 级設施（不够格）→ 不改', () => {
    const hotel = makeFacility({ id: 1, owner: 2, type: FACILITY_TYPE.hotel, level: 1 });
    expect(aiCardChoice(7, viewOf({ nodes: [facilityNode(1, 1)], facilities: [hotel] }))).toBeNull();
  });
});

describe('8 拍賣卡（0x0041ef26）', () => {
  it('脚下对手 ≥ 3 级的地 → 拍', () => {
    const land = makeLand({ id: 1, owner: 2, level: 3 });
    expect(aiCardChoice(8, viewOf({ nodes: [landNode(1, 1)], lands: [land] }))).toEqual({
      target: { kind: 'none' },
    });
  });

  it('脚下最恨的人 2 级的地 → 拍；非最恨的人 2 级 → 不拍', () => {
    const land = makeLand({ id: 1, owner: 2, level: 2 });
    const nodes = [landNode(1, 1)];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    expect(aiCardChoice(8, viewOf({ players, nodes, lands: [land] }))).toBeNull();
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(8, viewOf({ players, nodes, lands: [land] }))).toEqual({
      target: { kind: 'none' },
    });
  });
});

describe('9 天使卡（0x0041f037）', () => {
  it('画面里我有一條 ≥ 3 间未满级住宅的街 → 对该街第一块出', () => {
    const lands = [5, 6, 7].map((id, k) =>
      makeLand({ id, owner: 1, level: k + 1, name: 'A', x: (k + 1) * 10 }),
    );
    const nodes = [makeNode({ id: 1 }), ...[5, 6, 7].map((id, k) => landNode(k + 2, id, (k + 1) * 10, 0))];
    expect(aiCardChoice(9, viewOf({ nodes, lands }))).toEqual({ target: { kind: 'land', landId: 5 } });
  });

  it('只有 2 间 → 不出', () => {
    const lands = [5, 6].map((id, k) => makeLand({ id, owner: 1, level: k + 1, name: 'A' }));
    const nodes = [makeNode({ id: 1 }), ...[5, 6].map((id, k) => landNode(k + 2, id, (k + 1) * 10, 0))];
    expect(aiCardChoice(9, viewOf({ nodes, lands }))).toBeNull();
  });
});

describe('10 惡魔卡（0x0041f1b3）', () => {
  it('最恨的人那條街 ≥ 2 间、等级和 ≥ 7、我 ≤ 1 → 砸', () => {
    const lands = [
      makeLand({ id: 5, owner: 2, level: 3, name: 'B' }),
      makeLand({ id: 6, owner: 2, level: 4, name: 'B' }),
    ];
    const nodes = [makeNode({ id: 1 }), landNode(2, 5, 10, 0), landNode(3, 6, 20, 0)];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 9, 0, 0];
    expect(aiCardChoice(10, viewOf({ players, nodes, lands }))).toEqual({
      target: { kind: 'land', landId: 5 },
    });
  });

  it('无最恨的人：对手合计 ≥ 3 间、等级和 ≥ 9、我为 0 → 砸', () => {
    const lands = [
      makeLand({ id: 5, owner: 2, level: 3, name: 'B' }),
      makeLand({ id: 6, owner: 2, level: 3, name: 'B' }),
      makeLand({ id: 7, owner: 3, level: 3, name: 'B' }),
    ];
    const nodes = [makeNode({ id: 1 }), landNode(2, 5, 10, 0), landNode(3, 6, 20, 0), landNode(4, 7, 30, 0)];
    expect(aiCardChoice(10, viewOf({ nodes, lands }))).toEqual({ target: { kind: 'land', landId: 5 } });
  });

  it('等级和不够 → 不砸', () => {
    const lands = [makeLand({ id: 5, owner: 2, level: 2, name: 'B' })];
    const nodes = [makeNode({ id: 1 }), landNode(2, 5, 10, 0)];
    expect(aiCardChoice(10, viewOf({ nodes, lands }))).toBeNull();
  });
});

describe('11 怪獸卡（0x0041f400）', () => {
  it('最恨的人有 ≥ 3 级設施 → 拆它（設施优先于地块）', () => {
    const hotel = makeFacility({ id: 2, owner: 2, type: FACILITY_TYPE.hotel, level: 3 });
    const nodes = [makeNode({ id: 1 }), facilityNode(2, 2, 10, 0)];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 9, 0, 0];
    expect(aiCardChoice(11, viewOf({ players, nodes, facilities: [hotel] }))).toEqual({
      target: { kind: 'facility', facilityId: 2 },
    });
  });

  it('无最恨的人：全体对手里最高的地块须 ≥ 4 级', () => {
    const l4 = makeLand({ id: 3, owner: 2, level: 4, landPrice: 3000 });
    const nodes4 = [makeNode({ id: 1 }), landNode(2, 3, 10, 0)];
    expect(aiCardChoice(11, viewOf({ nodes: nodes4, lands: [l4] }))).toEqual({
      target: { kind: 'land', landId: 3 },
    });
    const l3 = makeLand({ id: 3, owner: 2, level: 3, landPrice: 3000 });
    expect(aiCardChoice(11, viewOf({ nodes: nodes4, lands: [l3] }))).toBeNull();
  });
});

describe('12 拆除卡（0x0041f6a9）', () => {
  it('对手连锁店 ≥ 4 间 → 拆（乖寶寶不干）', () => {
    const chain = [3, 4, 5, 6].map((id, k) =>
      makeLand({ id, owner: 2, type: 1, level: 0, name: `C${k}` }),
    );
    const nodes = [makeNode({ id: 1 }), ...[3, 4, 5, 6].map((id, k) => landNode(k + 2, id, (k + 1) * 10, 0))];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, personality: i === 0 ? 1 : 0 }));
    expect(aiCardChoice(12, viewOf({ players, nodes, lands: chain }))).toEqual({
      target: { kind: 'land', landId: 3 },
    });
    // 乖寶寶（個性 0）不干
    const obedient = [0, 1, 2, 3].map((i) => makePlayer({ index: i, personality: 0 }));
    expect(aiCardChoice(12, viewOf({ players: obedient, nodes, lands: chain }))).toBeNull();
  });

  it('我地上的地雷（物件 17）→ 拆那个物件', () => {
    const mine = makeLand({ id: 1, owner: 1, level: 0 });
    const nodes = [makeNode({ id: 1 }), landNode(2, 1, 10, 0)];
    const state = makeGameState();
    state.objects[26]!.nodeId = 2; // 下标 26 → 类型 17 地雷
    const view = viewOf({ nodes, lands: [mine], state: { objects: state.objects } });
    expect(aiCardChoice(12, view)).toEqual({ target: { kind: 'object', objectIndex: 27 } });
  });
});

describe('13 搶奪卡（0x0041f901）', () => {
  it('最恨的人手里 f7 ≥ 1 最贵的一张 → 偷它', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    players[1]!.cards = [9, 15, 26]; // 天使(f7=0) / 冬眠(f7=2, 100) / 查稅(f7=1, 35)
    expect(aiCardChoice(13, viewOf({ players }))).toEqual({
      target: { kind: 'player', index: 1 },
      stealCard: 15,
    });
  });

  it('没有最恨的人：全体对手里 f7 == 2 最贵的', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[1]!.cards = [15]; // 冬眠 100
    players[2]!.cards = [10]; // 惡魔 180
    expect(aiCardChoice(13, viewOf({ players }))).toEqual({
      target: { kind: 'player', index: 2 },
      stealCard: 10,
    });
  });

  it('对手手里没有凶狠卡 → 不出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[1]!.cards = [9, 14]; // f7 都是 0
    expect(aiCardChoice(13, viewOf({ players }))).toBeNull();
  });
});

describe('14 停留卡（0x0041facc）', () => {
  it('脚下我的未满级住宅、同區另有我的地、钱够 → 对自己', () => {
    const lands = [
      makeLand({ id: 1, owner: 1, level: 1, housePrice: 200, name: 'A' }),
      makeLand({ id: 2, owner: 1, level: 0, name: 'A' }),
    ];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 50000, moneyInBank: 0 }));
    expect(aiCardChoice(14, viewOf({ players, nodes: [landNode(1, 1)], lands }))).toEqual({
      target: { kind: 'self' },
    });
  });

  it('对手站在我的 ≥ 2 级非公園設施上 → 对他', () => {
    const hotel = makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 2 });
    const nodes = [makeNode({ id: 1 }), facilityNode(2, 1, 10, 0)];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: i === 1 ? 2 : 1 }));
    expect(aiCardChoice(14, viewOf({ players, nodes, facilities: [hotel] }))).toEqual({
      target: { kind: 'player', index: 1 },
    });
  });
});

describe('15 冬眠卡（0x0041fe4e）', () => {
  it('rand()%4 == 0 才出（D-004 替身钉死两个取值）', () => {
    expect(aiCardChoice(15, viewOf({ state: { rngState: 3 } }))).toEqual({ target: { kind: 'none' } });
    expect(aiCardChoice(15, viewOf({ state: { rngState: 1 } }))).toBeNull();
  });
});

describe('16 夢遊卡 / 17 陷害卡（0x0041fe6f）', () => {
  it('画面里的对手中最恨的人优先', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 0, 7, 0];
    expect(aiCardChoice(16, viewOf({ players }))).toEqual({ target: { kind: 'player', index: 2 } });
  });

  it('冬眠中或手里有復仇卡的对手不选', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[1]!.cards = [18]; // 復仇卡
    players[2]!.blocking.sleeping = 3;
    players[3]!.blocking.sleeping = 1;
    expect(aiCardChoice(17, viewOf({ players }))).toBeNull();
  });
});

describe('22 送神符（0x0041ff77）', () => {
  it('身上是坏神 → 送', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, godInfo: i === 0 ? 5 : 0 }));
    expect(aiCardChoice(22, viewOf({ players }))).toEqual({ target: { kind: 'none' } });
  });

  it('身上是财神 → 不送', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, godInfo: i === 0 ? 1 : 0 }));
    expect(aiCardChoice(22, viewOf({ players }))).toBeNull();
  });
});

describe('23 請神符（0x0041fff8）', () => {
  it('画面里有没主的小财神 → 请', () => {
    const state = makeGameState();
    state.objects[0]!.nodeId = 1; // 下标 0 → 类型 1 小财神
    const view = viewOf({ state: { objects: state.objects } });
    expect(aiCardChoice(23, view)).toEqual({ target: { kind: 'object', objectIndex: 1 } });
  });

  it('身上已经有一位好神 → 不请', () => {
    const state = makeGameState();
    state.objects[0]!.nodeId = 1;
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, godInfo: i === 0 ? 2 : 0 }));
    expect(aiCardChoice(23, viewOf({ players, state: { objects: state.objects } }))).toBeNull();
  });
});

describe('24 紅卡（0x00420055）', () => {
  const openMarket = (): Pick<GameState, 'market' | 'holdings'> => {
    const market = newStockMarket(0);
    const stocks = market.stocks.map((s) => ({ ...s, f6: 0, openPrice: s.price }));
    const holdings = [0, 1, 2, 3].map(() =>
      Array.from({ length: 12 }, () => ({ amount: 0, avgCost: 0 })),
    );
    holdings[0]![2] = { amount: 100, avgCost: 50 }; // 5000
    holdings[0]![5] = { amount: 10, avgCost: 100 }; // 1000
    return { market: { ...market, stocks }, holdings };
  };

  it('开市日：拉我持仓市值最大的一支', () => {
    expect(aiCardChoice(24, viewOf({ state: openMarket() }))).toEqual({
      target: { kind: 'stock', index: 2 },
    });
  });

  it('漲停的那支不拉，顺延到次大持仓', () => {
    const s = openMarket();
    s.market.stocks[2] = { ...s.market.stocks[2]!, openPrice: 100, price: 200 };
    expect(aiCardChoice(24, viewOf({ state: s }))).toEqual({ target: { kind: 'stock', index: 5 } });
  });

  it('休市日（元旦）→ 不出', () => {
    expect(aiCardChoice(24, viewOf({ state: { ...openMarket(), year: 1998, month: 1, day: 1 } }))).toBeNull();
  });
});

describe('25 黑卡（0x004200ea）', () => {
  it('最恨的人持仓市值最大、我没持有的一支 → 砸', () => {
    const market = newStockMarket(0);
    const stocks = market.stocks.map((s) => ({ ...s, f6: 0, openPrice: s.price }));
    const holdings = [0, 1, 2, 3].map(() =>
      Array.from({ length: 12 }, () => ({ amount: 0, avgCost: 0 })),
    );
    holdings[1]![3] = { amount: 100, avgCost: 40 }; // 4000
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(25, viewOf({ players, state: { market: { ...market, stocks }, holdings } }))).toEqual({
      target: { kind: 'stock', index: 3 },
    });
  });

  it('没人持股 → 不出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(25, viewOf({ players }))).toBeNull();
  });
});

describe('26 查稅卡（0x004202d2）', () => {
  it('画面里最恨的人現金 > 30000×物價 → 查他', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 1 ? 40000 : 10000 }));
    players[0]!.hostility = [0, 5, 0, 0];
    expect(aiCardChoice(26, viewOf({ players }))).toEqual({ target: { kind: 'player', index: 1 } });
  });

  it('没有最恨的人：谁 > 50000×物價 查谁；都没有 → 不出', () => {
    const rich = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 2 ? 60000 : 10000 }));
    expect(aiCardChoice(26, viewOf({ players: rich }))).toEqual({ target: { kind: 'player', index: 2 } });
    const poor = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 10000 }));
    expect(aiCardChoice(26, viewOf({ players: poor }))).toBeNull();
  });
});

describe('27 漲價卡（0x0042040e）', () => {
  it('我占多数、等级和 ≥ 7、对手等级和 ≤ 3 的街 → 涨', () => {
    const lands = [
      makeLand({ id: 1, owner: 1, level: 3, name: 'A' }),
      makeLand({ id: 2, owner: 1, level: 4, name: 'A' }),
      makeLand({ id: 3, owner: 2, level: 2, name: 'A' }),
    ];
    const nodes = [makeNode({ id: 1 }), landNode(2, 1, 10, 0)];
    expect(aiCardChoice(27, viewOf({ nodes, lands }))).toEqual({ target: { kind: 'land', landId: 1 } });
  });

  it('地块没中时：涨我的 ≥ 3 级非公園/研究所設施', () => {
    const hotel = makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 3 });
    const nodes = [makeNode({ id: 1 }), facilityNode(2, 1, 10, 0)];
    expect(aiCardChoice(27, viewOf({ nodes, facilities: [hotel] }))).toEqual({
      target: { kind: 'facility', facilityId: 1 },
    });
  });
});

describe('28 查封卡（0x0042062b）', () => {
  it('前方 6 格内：我没有地的街对手等级和 ≥ 7 → 封', () => {
    const refs = new Map<number, MapNode['ref']>([[3, { kind: 'land', index: 5 }]]);
    const lands = [
      makeLand({ id: 5, owner: 2, level: 4, name: 'X' }),
      makeLand({ id: 6, owner: 2, level: 3, name: 'X' }),
    ];
    expect(aiCardChoice(28, viewOf({ nodes: lineNodes(7, refs), lands }))).toEqual({
      target: { kind: 'land', landId: 5 },
    });
  });

  it('前方有最恨的人的 ≥ 3 级非公園設施 → 封它', () => {
    const refs = new Map<number, MapNode['ref']>([[4, { kind: 'facility', index: 2 }]]);
    const hotel = makeFacility({ id: 2, owner: 2, type: FACILITY_TYPE.hotel, level: 3 });
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 9, 0, 0];
    expect(aiCardChoice(28, viewOf({ players, nodes: lineNodes(7, refs), facilities: [hotel] }))).toEqual({
      target: { kind: 'facility', facilityId: 2 },
    });
  });

  it('前方一无所获 → 不出', () => {
    expect(aiCardChoice(28, viewOf({ nodes: lineNodes(7) }))).toBeNull();
  });
});

describe('29 同盟卡（0x004207cc）', () => {
  it('画面里非最恨、未结盟的对手中地產最多的', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 9, 0, 0]; // 最恨 1
    const lands = [
      makeLand({ id: 1, owner: 2 }), // 玩家 1 一块
      makeLand({ id: 2, owner: 3 }),
      makeLand({ id: 3, owner: 3 }),
      makeLand({ id: 4, owner: 3 }), // 玩家 2 三块
    ];
    expect(aiCardChoice(29, viewOf({ players, lands }))).toEqual({ target: { kind: 'player', index: 2 } });
  });

  it('★ 原版怪癖：地產最多的恰是最恨的人 → 干脆不出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 9, 0, 0];
    const lands = [
      makeLand({ id: 1, owner: 2 }),
      makeLand({ id: 2, owner: 2 }),
      makeLand({ id: 3, owner: 3 }),
    ];
    expect(aiCardChoice(29, viewOf({ players, lands }))).toBeNull();
  });
});

describe('30 烏龜卡（0x00420970）', () => {
  it('前方 3 格无岔路、能买 ≥ 2 格、钱够 → 对自己慢慢爬', () => {
    const refs = new Map<number, MapNode['ref']>([
      [2, { kind: 'land', index: 1 }],
      [3, { kind: 'land', index: 2 }],
    ]);
    const lands = [
      makeLand({ id: 1, owner: 0, landPrice: 1000 }),
      makeLand({ id: 2, owner: 0, landPrice: 500 }),
    ];
    expect(aiCardChoice(30, viewOf({ nodes: lineNodes(4, refs), lands }))).toEqual({
      target: { kind: 'self' },
    });
  });

  it('前方有对手过路费 > 1000×物價 的街 → 作罢', () => {
    const refs = new Map<number, MapNode['ref']>([
      [2, { kind: 'land', index: 1 }],
      [3, { kind: 'land', index: 2 }],
    ]);
    const lands = [
      makeLand({ id: 1, owner: 2, level: 2, name: 'A', rentByLevel: [200, 500, 1200, 2800, 6000, 10000] }),
      makeLand({ id: 2, owner: 0, landPrice: 500 }),
    ];
    expect(aiCardChoice(30, viewOf({ nodes: lineNodes(4, refs), lands }))).toBeNull();
  });
});
