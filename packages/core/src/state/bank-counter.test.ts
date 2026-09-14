/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 银行柜台接进 reduce
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { loanCapacity } from '../places/bank.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

function atCounter(over: Partial<GameState> = {}): GameState {
  const wealth = 1_000_000;
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, nodeId: 1, cash: 200_000, moneyInBank: 100_000, loan: 0 }),
    ),
    pending: { kind: 'bank', wealth, loanCapacity: loanCapacity(wealth, 0), specialFinance: null },
    phase: 'turnEnd',
    ...over,
  });
}

describe('★ 银行柜台 —— 先前有交互但没有对应的 action', () => {
  it('存款：现金 → 存款', () => {
    const s = atCounter();
    const r = reduce(s, { type: 'bank', op: 'deposit', amount: 50_000 }, topo);
    expect(r.players[0]!.cash).toBe(150_000);
    expect(r.players[0]!.moneyInBank).toBe(150_000);
    // 柜台还开着
    expect(r.pending?.kind).toBe('bank');
  });

  it('取款：存款 → 现金，且取不出超过余额的钱', () => {
    const s = atCounter();
    const r = reduce(s, { type: 'bank', op: 'withdraw', amount: 999_999 }, topo);
    expect(r.players[0]!.moneyInBank).toBe(0);
    expect(r.players[0]!.cash).toBe(300_000);
  });

  it('★ 借款进的是**存款**，不是现金', () => {
    const s = atCounter();
    const r = reduce(s, { type: 'bank', op: 'borrow', amount: 100_000 }, topo);
    expect(r.players[0]!.cash).toBe(200_000);
    expect(r.players[0]!.moneyInBank).toBe(200_000);
    expect(r.players[0]!.loan).toBe(100_000);
  });

  it('★ 借完之后柜台上的额度会跟着缩', () => {
    const s = atCounter();
    const before = s.pending!.kind === 'bank' ? s.pending.loanCapacity : 0;
    const r = reduce(s, { type: 'bank', op: 'borrow', amount: 100_000 }, topo);
    if (r.pending?.kind !== 'bank') throw new Error('柜台应该还开着');
    expect(r.pending.loanCapacity).toBe(before - 100_000);
  });

  it('还款先扣存款，不足再扣现金', () => {
    const s = atCounter();
    const borrowed = reduce(s, { type: 'bank', op: 'borrow', amount: 250_000 }, topo);
    const r = reduce(borrowed, { type: 'bank', op: 'repay', amount: 250_000 }, topo);
    expect(r.players[0]!.loan).toBe(0);
    // 存款 100_000 + 借来的 250_000 = 350_000，还 250_000 后剩 100_000
    expect(r.players[0]!.moneyInBank).toBe(100_000);
    expect(r.players[0]!.cash).toBe(200_000);
  });

  it('不成交时状态原样返回，柜台不关', () => {
    const s = atCounter();
    expect(reduce(s, { type: 'bank', op: 'deposit', amount: 0 }, topo)).toBe(s);
    expect(reduce(s, { type: 'bank', op: 'repay', amount: 1000 }, topo)).toBe(s); // 没欠款
  });

  it('不在柜台前时任何操作都无效', () => {
    const s = atCounter({ pending: null });
    expect(reduce(s, { type: 'bank', op: 'deposit', amount: 1000 }, topo)).toBe(s);
  });
});
