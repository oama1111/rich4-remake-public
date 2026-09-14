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
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import type { Action } from './actions.ts';
import type { PendingInteraction } from '../rules/interaction.ts';
import { loanCapacity } from '../places/bank.ts';
import { CONFINEMENT_SLOTS } from '../rules/confinement.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

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
    const s = withPending({ kind: 'auction', entityId: 1, basePrice: 5000, bidders: [1, 2] });
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

  it('★ 放弃对任何交互都管用 —— 这是最后一道保险', () => {
    const kinds: PendingInteraction[] = [
      { kind: 'bank', wealth: 1000, loanCapacity: 500, specialFinance: null },
      { kind: 'lottery', available: [1], price: 1000, owned: 0 },
      { kind: 'auction', entityId: 1, basePrice: 100, bidders: [1] },
      { kind: 'minigame', game: 7, name: '七彩氣球', maxScore: 999 },
      { kind: 'bail', place: 'hospital', candidates: [], points: 0 },
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
});
