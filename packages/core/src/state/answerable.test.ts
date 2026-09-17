/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * ★ 每一个待决交互都必须答得掉
 *
 * 这一组断言是从**四个真实的卡死**里长出来的，四个都是同一种形状：
 * 引擎给出一个待决交互，而那个交互**没有任何 action 能推进它**，
 * 于是玩家（或 AI）点一百次也没反应。跑测试跑不出来，只有真去玩才撞见。
 *
 *   1. `bank` 有交互，reducer 里压根没有 `bank` action
 *   2. `lottery` 同上
 *   3. `auction` 同上
 *   4. `buyLand` 在衰神附身时照样弹出来，而 `purchase` 必定拒绝
 *
 * 所以这里不测「规则对不对」（那在各自的模块里测），只测
 * **「给得出的交互，一定答得掉」**。
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import type { Action } from './actions.ts';
import type { PendingInteraction } from '../rules/interaction.ts';
import { loanCapacity } from '../places/bank.ts';
import { CONFINEMENT_SLOTS } from '../rules/confinement.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

/**
 * 一块住宅地 + 站在它上面的节点（type = 0x7d0 + 地块下标）。
 *
 * ★ 下标取 **1** 而不是 0：`housingIndexOf` 判的是**开区间**
 *   （`type <= 0x7d0 → null`，@source 0x004198b9 的 `jbe`），
 *   即 type 恰为 2000 的那块在引擎与原版里都取不到 —— 地块下标从 1 起。
 */
const LAND_ID = 1;
const landTopo: MapTopology = {
  nodes: [makeNode({ id: 1, adjacent: [1], type: 0x7d0 + LAND_ID, ref: { kind: 'land', index: LAND_ID } })],
  lands: [makeLand({ id: LAND_ID, name: '測試地', landPrice: 1000, housePrice: 200 })],
};

/**
 * 补全一个 `pending{auction}` 的开拍字段。
 *
 * ★ Q-AUC-1 之后竞价循环归 core，`pending` 里要带现价 / 最高者 / 座位状态 /
 *   轮到谁 / 心理价位（`state/reduce.ts` 的 `openAuction` 在实际开拍时补齐）。
 *   这里手写的用例补上同一组字段，好让 `auctionBid` 走得通。
 */
function auctionPending(over: {
  entityId: number;
  basePrice: number;
  bidders: number[];
}): PendingInteraction {
  return {
    kind: 'auction',
    entityId: over.entityId,
    basePrice: over.basePrice,
    bidders: over.bidders,
    price: over.basePrice,
    top: -1,
    topCash: 0,
    seat: 0,
    status: [0, 1, 2, 3].map((i) => (over.bidders.includes(i) ? ('active' as const) : ('givenUp' as const))),
    limits: [0, 0, 0, 0],
  };
}

function withPending(pending: PendingInteraction, over: Partial<GameState> = {}): GameState {
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, nodeId: 1, cash: 500_000, moneyInBank: 200_000, points: 900 }),
    ),
    pending,
    phase: 'turnEnd',
    ...over,
  });
}

/** 一个交互「答得掉」= 至少存在一个 action 能改变状态 */
function answerable(s: GameState, candidates: Action[]): boolean {
  return candidates.some((a) => reduce(s, a, topo) !== s);
}

describe('★ 每一种待决交互都答得掉', () => {
  it('銀行', () => {
    const wealth = 1_000_000;
    const s = withPending({ kind: 'bank', wealth, loanCapacity: loanCapacity(wealth, 0), specialFinance: null });
    expect(
      answerable(s, [
        { type: 'bank', op: 'deposit', amount: 1000 },
        { type: 'bank', op: 'borrow', amount: 1000 },
      ]),
    ).toBe(true);
  });

  it('樂透', () => {
    const s = withPending({ kind: 'lottery', available: [0, 1, 2], price: 1000, owned: 0 });
    expect(answerable(s, [{ type: 'lottery', number: 0 }])).toBe(true);
  });

  it('拍賣', () => {
    const s = withPending(auctionPending({ entityId: 1, basePrice: 5000, bidders: [1, 2] }));
    // 流标也算答得掉 —— 原地主照样失去这块地
    expect(answerable(s, [{ type: 'auction', winner: -1, price: 0 }])).toBe(true);
  });

  it('保釋', () => {
    const occ = new Array<number>(CONFINEMENT_SLOTS).fill(0);
    occ[2] = 1;
    const s = withPending(
      {
        kind: 'bail',
        place: 'prison',
        candidates: [{ slot: 2, player: 2, name: '忍太郎', cost: 30, affordable: true }],
        points: 900,
      },
      { prisonOccupancy: occ },
    );
    expect(answerable(s, [{ type: 'bail', slot: 2 }])).toBe(true);
  });

  it('小游戏', () => {
    const s = withPending({ kind: 'minigame', game: 6, name: '企鵝挖寶', maxScore: 999 });
    expect(answerable(s, [{ type: 'minigame', score: null }])).toBe(true);
  });

  it('★ 生日收卡（T-055）：真答复答得掉，且答完 pending 清空、相位回 turnEnd', () => {
    const s = withPending(
      { kind: 'birthdayCard', seats: [1] },
      {
        phase: 'awaitingDecision',
        players: [0, 1, 2, 3].map((i) =>
          makePlayer({ index: i, nodeId: 1, cards: i === 1 ? [7] : [] }),
        ),
      },
    );
    const after = reduce(s, { type: 'birthdayCard', seat: 1, cardId: 7 }, topo);
    expect(after).not.toBe(s);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('turnEnd');
    expect(after.players[0]!.cards).toEqual([7]);
  });

  it('★ 放弃对任何交互都管用 —— 这是最后一道保险', () => {
    const kinds: PendingInteraction[] = [
      { kind: 'bank', wealth: 1000, loanCapacity: 500, specialFinance: null },
      { kind: 'lottery', available: [1], price: 1000, owned: 0 },
      auctionPending({ entityId: 1, basePrice: 100, bidders: [1] }),
      { kind: 'minigame', game: 7, name: '七彩氣球', maxScore: 999 },
      { kind: 'bail', place: 'hospital', candidates: [], points: 0 },
      // ★ 命運 5 分帧出来的那一族（T-055）：`declineDecision` 也要收得掉 ——
      //   托管 / 无头 / 真人一直不答时这是最后一道保险。
      { kind: 'birthdayCard', seats: [1, 2] },
      { kind: 'unimplemented', place: '某处', specialKind: 99 },
    ];
    for (const p of kinds) {
      const s = withPending(p);
      const after = reduce(s, { type: 'declineDecision' }, topo);
      expect(after, p.kind).not.toBe(s);
      expect(after.pending, p.kind).toBeNull();
    }
  });
});

describe('★ 给不出来的交互，就不该给', () => {
  it('★ 衰神附身时不弹買地 —— 弹了也买不成，玩家只会以为按钮坏了', () => {
    // 7 = 小衰神。`canPurchase` 查的是土地公那一处，查不到它；
    // 真正拦下消费的是 `purchase` 里的 `call 0x40fa61`。
    const blocked = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, cash: 999_999, godInfo: 7 })],
      phase: 'settling',
    });
    // 没有地图数据时 settle 直接收尾；这里只断言不会留下一个答不掉的 pending
    const after = reduce(blocked, { type: 'settle' }, topo);
    if (after.pending?.kind === 'buyLand') {
      expect(reduce(after, { type: 'buyLand' }, topo)).not.toBe(after);
    }
  });

  /**
   * ★ 買地/盖房**只能**答落点留下的那个交互。
   *
   * `awaitingDecision` 是所有待决交互共用的阶段（買設施/加蓋/研究所/
   * 拍賣卡挂出的拍賣…）。早先这两个 case 只查 phase，于是别的交互在等答复时，
   * 一个 `buyLand`/`upgradeLand` 就能把玩家的地买了、房盖了，顺手把那个交互顶掉。
   * 现在按 `pending.kind` 把关（与 `buyFacility` 那几个同一条规矩）。
   */
  describe('★ 買地/盖房必须就是落点那个交互', () => {
    const atLand = (over: Partial<GameState> = {}): GameState =>
      makeGameState({
        players: [makePlayer({ index: 0, nodeId: 1, cash: 500_000 })],
        phase: 'awaitingDecision',
        ...over,
      });

    it('拍賣卡挂出拍賣时，买不走脚下那块无主地', () => {
      const s = atLand({ pending: auctionPending({ entityId: LAND_ID, basePrice: 1000, bidders: [1] }) });
      expect(reduce(s, { type: 'buyLand' }, landTopo)).toBe(s);
    });

    it('拍賣卡挂出拍賣时，加蓋不了脚下的自有地', () => {
      const s = atLand({
        pending: auctionPending({ entityId: LAND_ID, basePrice: 1000, bidders: [1] }),
        landOwner: [0, 1],
      });
      expect(reduce(s, { type: 'upgradeLand' }, landTopo)).toBe(s);
    });

    it('研究所面板开着时，加蓋不了脚下的自有地', () => {
      const s = atLand({
        pending: { kind: 'research', facilityId: 0, name: '研究所', level: 1, choices: [1] },
        landOwner: [0, 1],
      });
      expect(reduce(s, { type: 'upgradeLand' }, landTopo)).toBe(s);
    });

    // 正对照：落点留下的那个交互，照样答得掉
    it('落点的買地交互仍然照答', () => {
      const s = atLand({
        pending: { kind: 'buyLand', landId: LAND_ID, name: '測試地', price: 1000 },
      });
      const after = reduce(s, { type: 'buyLand' }, landTopo);
      expect(after).not.toBe(s);
      expect(after.landOwner[LAND_ID]).toBe(1);
    });

    it('落点的加蓋交互仍然照答', () => {
      const s = atLand({
        pending: { kind: 'upgradeLand', landId: LAND_ID, name: '測試地', cost: 200 },
        landOwner: [0, 1],
      });
      const after = reduce(s, { type: 'upgradeLand' }, landTopo);
      expect(after).not.toBe(s);
      expect(after.landLevel[LAND_ID]).toBe(1);
    });
  });
});
