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
  cardLoopEsiAfterFill,
  cardsToConsider,
  mostHated,
  visibleEntities,
  visibleRivals,
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
//  ★★ Q-TOOL-1：视野 = `0x40a45c(-1)` 摊平的那张 440×440 id 图（**屏幕空间**）
//  镜头位置 = 当前行动者（`0x415e70` 取 `[0x49910c]`），故中心就是我的节点。
//  下面的实测投影偏移（视角 0、镜头 (0,0)）来自 `rules/board-window.test.ts` 的预言机。
// ============================================================

describe('★★ 视野（Q-TOOL-1，@source 0x40a45c 的 -1 那一档）', () => {
  /** 我站节点 1 (0,0)，且节点 1 上挂地块 1（`visibleEntities` 是按**节点**枚举实体的） */
  const meAt0 = (extra: MapNode[]): MapNode[] => [
    makeNode({ id: 1, x: 0, y: 0, ref: { kind: 'land', index: 1 } }),
    ...extra,
  ];

  it('世界 +x 200 的地块**不在**画面里（投影 px = 224 > 220）—— 旧的节点方框会误判', () => {
    const nodes = meAt0([makeNode({ id: 2, x: 200, y: 0, ref: { kind: 'land', index: 2 } })]);
    const lands = [
      makeLand({ id: 1, x: 0, y: 0, owner: 1 }),
      makeLand({ id: 2, x: 200, y: 0, owner: 1 }),
    ];
    expect(visibleEntities(viewOf({ nodes, lands })).map((e) => e.id)).toEqual([1]);
  });

  it('世界 +y 220 的地块**在**画面里（投影 (101,175)）—— 旧的节点方框也会误判', () => {
    const nodes = meAt0([makeNode({ id: 2, x: 0, y: 220, ref: { kind: 'land', index: 2 } })]);
    const lands = [
      makeLand({ id: 1, x: 0, y: 0, owner: 1 }),
      makeLand({ id: 2, x: 0, y: 220, owner: 1 }),
    ];
    expect(visibleEntities(viewOf({ nodes, lands })).map((e) => e.id)).toEqual([1, 2]);
  });

  it('锚点是**记录自己的 x/y**：节点出画、记录在画面里的地块照样进候选（反之亦然）', () => {
    // 节点 2 在世界 (0,0)（画面正中），它那块地的记录却在 (400,0)（投影早已出窗）；
    // 节点 3 在世界 (200,0)（出窗），它那块地的记录贴着镜头 (0,10) ⇒ 在窗里。
    const nodes = meAt0([
      makeNode({ id: 2, x: 0, y: 0, ref: { kind: 'land', index: 2 } }),
      makeNode({ id: 3, x: 200, y: 0, ref: { kind: 'land', index: 3 } }),
    ]);
    const lands = [
      makeLand({ id: 2, x: 400, y: 0, owner: 1 }),
      makeLand({ id: 3, x: 0, y: 10, owner: 1 }),
    ];
    expect(visibleEntities(viewOf({ nodes, lands })).map((e) => e.id)).toEqual([3]);
  });

  it('id 图上没有实例的地块/設施不进候选（没房子又没主）', () => {
    const nodes = meAt0([
      makeNode({ id: 2, x: 10, y: 0, ref: { kind: 'land', index: 2 } }),
      makeNode({ id: 3, x: 20, y: 0, ref: { kind: 'facility', index: 2 } }),
      makeNode({ id: 4, x: 30, y: 0, ref: { kind: 'land', index: 3 } }),
    ]);
    const lands = [
      makeLand({ id: 2, x: 10, y: 0, level: 0, owner: 0 }), // 空、无主 ⇒ 不在图上
      makeLand({ id: 3, x: 30, y: 0, level: 0, owner: 2 }), // 无主但**有主**的另一种：在图上
    ];
    const facilities = [makeFacility({ id: 2, x: 20, y: 0, level: 0, owner: 0 })];
    expect(
      visibleEntities(viewOf({ nodes, lands, facilities })).map((e) => `${e.kind}${e.id}`),
    ).toEqual(['land3']);
  });

  it('对手按**节点**（棋子站在节点上）：世界 +x 200 的看不见，+y 220 的看得见', () => {
    const nodes = meAt0([makeNode({ id: 2, x: 200, y: 0 }), makeNode({ id: 3, x: 0, y: 220 })]);
    const players = [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, nodeId: i === 0 ? 1 : i === 1 ? 2 : i === 2 ? 3 : 2 }),
    );
    expect(visibleRivals(viewOf({ nodes, players }))).toEqual([2]);
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

  // ★★ 通道 2 差分（`rich4-spec/tests/test_junfu_card_ai.py`）：两道闸都是**严格** >
  it('★★ 平均恰为我的 10 倍 → 不出（严格 >）', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 100 : 1300 }));
    // avg = (100+3900)/4 = 1000 == 100×10
    expect(aiCardChoice(1, viewOf({ players }))).toBeNull();
  });

  it('★★ 我的现金恰为 3000×物價 → 不出（严格 >）', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 3000 : 100000 }));
    expect(aiCardChoice(1, viewOf({ players }))).toBeNull();
  });

  it('★ 我的现金 2999（= 3000×物價 − 1）且平均够高 → 出', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 2999 : 100000 }));
    expect(aiCardChoice(1, viewOf({ players }))).toEqual({ target: { kind: 'none' } });
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

  // ★★ 通道 2 差分（`rich4-spec/tests/test_junpin_card_ai.py` 的 [C] 组）：
  //   兜底支命中后**不 break**（`0x41e8d1` 之后 `0x41e8d6 inc` / `jmp` 回循环头）
  //   ⇒ **下标最大的合格者赢**。旧实现返回第一个 —— 与查稅卡同一个形状的坑。
  it('★★ 多人同时 > 50000×物價 且 > 我 3 倍 ⇒ 取**下标最大**者（不是第一个）', () => {
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 10000 : 100000 }));
    expect(aiCardChoice(2, viewOf({ players }))).toEqual({ target: { kind: 'player', index: 3 } });
  });

  it('★★ 门槛严格：現金恰为 50000×物價 → 不中；恰为我的 3 倍 → 不中', () => {
    const exact = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 1 ? 50000 : 10000 }));
    expect(aiCardChoice(2, viewOf({ players: exact }))).toBeNull();
    const tri = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 0 ? 30000 : i === 1 ? 90000 : 10000 }));
    expect(aiCardChoice(2, viewOf({ players: tri }))).toBeNull();
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

  it('脚下最恨的人的 ≥ 2 级非公園設施 → 改成**公園 0**（原版写 [0x48be58] = 0）', () => {
    const hotel = makeFacility({ id: 1, owner: 2, type: FACILITY_TYPE.hotel, level: 2 });
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    players[0]!.hostility = [0, 5, 0, 0];
    // @source 0x0041ef0c `xor esi,esi / mov [0x48be58],esi` —— 种类 0 = 公園
    //   （公园上限 1 级，所以这一手等于把对手那栋店打回 1 级）
    expect(aiCardChoice(7, viewOf({ players, nodes: [facilityNode(1, 1)], facilities: [hotel] }))).toEqual({
      target: { kind: 'none' },
      facilityType: FACILITY_TYPE.park,
    });
  });

  it('★ 对手的 ≥ 3 级設施（不挑最恨）→ 同样改成公園', () => {
    const mall = makeFacility({ id: 1, owner: 3, type: FACILITY_TYPE.mall, level: 3 });
    expect(aiCardChoice(7, viewOf({ nodes: [facilityNode(1, 1)], facilities: [mall] }))).toEqual({
      target: { kind: 'none' },
      facilityType: FACILITY_TYPE.park,
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

describe('12 拆除卡 —— 审计订正（ai-move）：画面清单一趟扫完', () => {
  it('★★ 画面上方的对手路障先于下方的连锁店（旧实现先扫完地块再扫物件）', () => {
    const chain = [3, 4, 5, 6].map((id, k) => makeLand({ id, owner: 2, type: 1, level: 0, name: `C${k}` }));
    const rival = makeLand({ id: 7, owner: 3, level: 1, name: 'R' });
    // 连锁店在 y = 50；对手的地（上面压着路障）在 y = -50
    const nodes = [
      makeNode({ id: 1 }),
      ...[3, 4, 5, 6].map((id, k) => landNode(k + 2, id, (k + 1) * 10, 50)),
      landNode(6, 7, 0, -50),
    ];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, personality: 1 }));
    const state = makeGameState();
    state.objects[24]!.nodeId = 6; // 下标 24 → 类型 16 路障
    const view = viewOf({ players, nodes, lands: [...chain, rival], state: { objects: state.objects } });
    expect(aiCardChoice(12, view)).toEqual({ target: { kind: 'object', objectIndex: 25 } });
    // 路障挪到连锁店下方 → 连锁店先中
    const below = [...nodes.slice(0, 5), landNode(6, 7, 0, 90)];
    state.objects[24]!.nodeId = 6;
    const view2 = viewOf({ players, nodes: below, lands: [...chain, rival], state: { objects: state.objects } });
    expect(aiCardChoice(12, view2)).toEqual({ target: { kind: 'land', landId: 3 } });
  });

  it('★ 附在人身上的物件不在画面清单里（0x00409e8b 跳过 +0x05 ≠ 0）', () => {
    const rival = makeLand({ id: 7, owner: 3, level: 1, name: 'R' });
    const nodes = [makeNode({ id: 1 }), landNode(2, 7, 0, -50)];
    const state = makeGameState();
    state.objects[24]!.nodeId = 2;
    state.objects[24]!.attached = 2;
    expect(aiCardChoice(12, viewOf({ nodes, lands: [rival], state: { objects: state.objects } }))).toBeNull();
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

  // ★★ 通道 2 差分（`rich4-spec/tests/test_stop_card_ai.py` DISCREPANCY #2）：
  //   原版「对别人」只对**出現在可見表 `0x48b8c4` 里**的玩家写 `nodeRefs[p]`
  //   （`0x41fcd7..0x41fd51`），未上屏的对手不参与。
  it('★★ 镜头外的对手站在我的 ≥2 级設施上 → **不**对他（原版有视野闸）', () => {
    const hotel = makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 2 });
    const nodes = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 1000, y: 0, ref: { kind: 'facility', index: 1 } }), // 视野 ±220 外
    ];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: i === 1 ? 2 : 1 }));
    expect(aiCardChoice(14, viewOf({ players, nodes, facilities: [hotel] }))).toBeNull();
  });

  it('★ 同一局面但对手在视野内 → 仍然对他（对照，证明上面那条不是把整支关了）', () => {
    const hotel = makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 2 });
    const nodes = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 100, y: 0, ref: { kind: 'facility', index: 1 } }),
    ];
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

  // ★★ 通道 2 差分（`rich4-spec/tests/test_card_policy_helpers.py`）：
  //   原版兜底支命中后**不 break**（`0x004203fe` 写完出口只 `mov esi,1`，
  //   `0x00420408` 继续 `inc` / `jmp` 回循环头）⇒ **下标最大**的合格者赢。
  it('★★ 多人同时 > 50000×物價 ⇒ 取**下标最大**者（不是第一个）', () => {
    const rich = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i >= 1 ? 60000 : 10000 }));
    expect(aiCardChoice(26, viewOf({ players: rich }))).toEqual({ target: { kind: 'player', index: 3 } });
  });

  it('★ 门槛是**严格** > 50000×物價（等于不查）', () => {
    const exact = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: i === 2 ? 50000 : 10000 }));
    expect(aiCardChoice(26, viewOf({ players: exact }))).toBeNull();
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

describe('27 漲價卡 —— 审计订正（ai-move）', () => {
  // ★★ `0x0042056e fcomp qword [0x463d38]` —— 那个常数是 double **0.66**，不是 0.5
  it('★★ 我占一半（1/2）→ 不涨：比例门槛是 0.66', () => {
    const lands = [
      makeLand({ id: 1, owner: 1, level: 5, name: 'A' }),
      makeLand({ id: 2, owner: 1, level: 4, name: 'A' }),
      makeLand({ id: 3, owner: 2, level: 1, name: 'A' }),
      makeLand({ id: 4, owner: 0, level: 0, name: 'A' }),
    ];
    const nodes = [makeNode({ id: 1 }), landNode(2, 1, 10, 0)];
    expect(aiCardChoice(27, viewOf({ nodes, lands }))).toBeNull();
    // 2/3 ≥ 0.66 → 涨
    expect(aiCardChoice(27, viewOf({ nodes, lands: lands.slice(0, 3) }))).toEqual({
      target: { kind: 'land', landId: 1 },
    });
  });

  it('★★ 33/50 恰好 0.66 → 涨（`jb` 只挡小于）', () => {
    const lands: LandInfo[] = [];
    for (let i = 1; i <= 50; i++) {
      lands.push(makeLand({ id: i, owner: i <= 33 ? 1 : 0, level: i <= 2 ? 4 : 0, name: 'A' }));
    }
    const nodes = [makeNode({ id: 1 }), landNode(2, 1, 10, 0)];
    expect(aiCardChoice(27, viewOf({ nodes, lands }))).toEqual({ target: { kind: 'land', landId: 1 } });
    lands[32] = makeLand({ id: 33, owner: 0, level: 0, name: 'A' }); // 32/50 = 0.64
    expect(aiCardChoice(27, viewOf({ nodes, lands }))).toBeNull();
  });

  // ★★ `0x004205f6 mov [esp+4], esi` —— 「目前最高等级」被写成了 esi（出牌主循环的残值）
  const twoHotels = () => ({
    nodes: [makeNode({ id: 1 }), facilityNode(2, 1, 10, 0), facilityNode(3, 2, 20, 0)],
    facilities: [
      makeFacility({ id: 1, owner: 1, type: FACILITY_TYPE.hotel, level: 3 }),
      makeFacility({ id: 2, owner: 1, type: FACILITY_TYPE.mall, level: 5 }),
    ],
  });

  it('★★ 手牌 ≤ 8（esi = 8）：只有**第一栋**合格的設施会被选中', () => {
    expect(aiCardChoice(27, { ...viewOf(twoHotels()), cardLoopEsi: 8 })).toEqual({
      target: { kind: 'facility', facilityId: 1 },
    });
    // 缺省即 8
    expect(aiCardChoice(27, viewOf(twoHotels()))).toEqual({ target: { kind: 'facility', facilityId: 1 } });
  });

  it('★★ esi = 3：第二栋 5 级 > 3 → 改选它；esi = 0：整支落空（收尾 `cmp [esp+4], 0 / je`）', () => {
    expect(aiCardChoice(27, { ...viewOf(twoHotels()), cardLoopEsi: 3 })).toEqual({
      target: { kind: 'facility', facilityId: 2 },
    });
    expect(aiCardChoice(27, { ...viewOf(twoHotels()), cardLoopEsi: 0 })).toBeNull();
  });

  it('★★ 先处理过地块：esi = 同街循环的出口下标（地块数 + 1）', () => {
    // 地块 1（我的 1 级，涨不了）在画面最上方 → esi = 地块数 + 1 = 3；之后 3 级旅馆 > 0 → 最高 = 3；
    // 5 级商场 > 3 → 改选商场
    const f = twoHotels();
    const nodes = [makeNode({ id: 1 }), landNode(9, 1, 0, -10), ...f.nodes.slice(1)];
    const lands = [makeLand({ id: 1, owner: 1, level: 1, name: 'A' }), makeLand({ id: 2, owner: 0, name: 'B' })];
    expect(aiCardChoice(27, { ...viewOf({ ...f, nodes, lands }), cardLoopEsi: 0 })).toEqual({
      target: { kind: 'facility', facilityId: 2 },
    });
  });

  it('出牌主循环填表后的 esi：≤ 8 张恒为 8；> 8 张 = (起点 + 8) % 张数', () => {
    expect(cardLoopEsiAfterFill(3, 0)).toBe(8);
    expect(cardLoopEsiAfterFill(8, 0)).toBe(8);
    expect(cardLoopEsiAfterFill(10, 1)).toBe(9);
    expect(cardLoopEsiAfterFill(10, 2)).toBe(0);
    expect(cardLoopEsiAfterFill(12, 7)).toBe(3);
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

  // ★★ 通道 2 差分（`rich4-spec/tests/test_turtle_card_ai.py` DISCREPANCY #1）：
  //   原版 `0x419744` 的返回值**已乘物價指數**（`0x4197d8/0x4197e0`），
  //   而门槛也是 `1000×pi` ⇒ 两边约掉，实际判据是**常量 1000**。
  //   旧实现 `streetTollOf` 漏乘 pi、门槛照乘 ⇒ pi > 1 时整体偏移。
  it('★★ 物價指數 = 2 时：对手街价和 1500 > 1000（与 pi 无关）→ 作罢', () => {
    const refs = new Map<number, MapNode['ref']>([
      [2, { kind: 'land', index: 1 }], // 对手的街（价和 1500）
      [3, { kind: 'land', index: 2 }], // 无主，可白拿
      [4, { kind: 'land', index: 3 }], // 我的未满级住宅，可白拿
    ]);
    const lands = [
      makeLand({ id: 1, owner: 2, level: 1, name: 'A', rentByLevel: [0, 1500, 0, 0, 0, 0] }),
      makeLand({ id: 2, owner: 0, landPrice: 100 }),
      makeLand({ id: 3, owner: 1, level: 0, housePrice: 100 }),
    ];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 50000, moneyInBank: 0 }));
    // 旧实现：1500 > 1000×2 = 2000 为假 ⇒ 误判「可发动」；修正后 1500 > 1000 ⇒ 作罢
    expect(aiCardChoice(30, viewOf({ players, nodes: lineNodes(5, refs), lands, state: { priceIndex: 2 } }))).toBeNull();
  });

  it('★ 同一局面 pi = 1 ⇒ 同样作罢（两档一致，排除「只是把门槛改了」）', () => {
    const refs = new Map<number, MapNode['ref']>([
      [2, { kind: 'land', index: 1 }],
      [3, { kind: 'land', index: 2 }],
      [4, { kind: 'land', index: 3 }],
    ]);
    const lands = [
      makeLand({ id: 1, owner: 2, level: 1, name: 'A', rentByLevel: [0, 1500, 0, 0, 0, 0] }),
      makeLand({ id: 2, owner: 0, landPrice: 100 }),
      makeLand({ id: 3, owner: 1, level: 0, housePrice: 100 }),
    ];
    const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 50000, moneyInBank: 0 }));
    expect(aiCardChoice(30, viewOf({ players, nodes: lineNodes(5, refs), lands }))).toBeNull();
  });
});
