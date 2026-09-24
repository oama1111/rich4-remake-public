/*
 * 第二十一份（`20260924-144653022`「评比本月最倒霉和最幸运…2 个评比，不是这样直接发利息」）：
 * core 在月结那一刻交出**现场**（`GameState.lastMonthlySettle`）—— 月结屏的名牌、悲情人物、冠軍都从这里取。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 病根：月结在 `advanceGameDay` 里当场把三项累加器清零（`clearMonthlyAccumulators`，原版 `0x00439ec6` 在模态循环**之后**），
 * 表现层事后拿 after 的累加器评「本月悲情人物」⇒ 永远 0 ⇒ 那一段从来不演。
 *
 * @source 状态 2 `0x004380d5`：存款 ×1.1（`0x00438201`）之后 `0x00438240 call 0x437d1a`（悲情）/ `0x0043824a call 0x437dfe`（冠軍）；
 *   名牌 `0x00439d6a`（加息前 `+0x20`）；悲情表 `+0x5c/+0x60/+0x42`（`0x004386fd` / `0x0043875d` / `0x004387bd`）。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from '../state/reduce.ts';
import type { GameState } from '../state/types.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { monthlySettleHint } from './monthly.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };
const endTurn = (s: GameState): GameState =>
  reduce({ ...s, phase: 'turnEnd', currentPlayer: s.players.length - 1 }, { type: 'endTurn' }, topo);

function monthEnd(over: (i: number) => Partial<ReturnType<typeof makePlayer>>): GameState {
  return makeGameState({
    year: 1998,
    month: 1,
    day: 31,
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, whoPlays: 1, moneyInBank: 100_000, ...over(i) })),
  });
}

describe('★★ `monthlySettleHint`（纯函数）', () => {
  it('加息前存款 / 利息 / 清零前的累加器逐行带出；只算在场者（`0x00439caa`）', () => {
    const pre = [0, 1, 2].map((i) =>
      makePlayer({ index: i, character: i, whoPlays: i === 2 ? 0 : 1, moneyInBank: 100_000, loan: i === 1 ? 5 : 0, monthlyPaid: 30_000 * i, monthlyReceived: 1000, totalWinterSleepDays: i }),
    );
    const post = pre.map((p) => ({ ...p, moneyInBank: p.loan !== 0 || p.whoPlays === 0 ? p.moneyInBank : 110_000, monthlyPaid: 0, monthlyReceived: 0, totalWinterSleepDays: 0 }));
    const h = monthlySettleHint(pre, post, 1, (p) => p.cash + p.moneyInBank);
    expect(h.rows.map((r) => r.player)).toEqual([0, 1]);
    expect(h.rows[0]).toMatchObject({ bankBefore: 100_000, interest: 10_000, loan: 0, unexpectedLoss: 0, unexpectedGain: 1000, unluckyDays: 0, bank: 110_000 });
    expect(h.rows[1]).toMatchObject({ bankBefore: 100_000, interest: 0, loan: 5, unexpectedLoss: 30_000, unluckyDays: 1 });
  });

  it('悲情人物 = `monthlyScore` 最高且领先 0.4（`0x437d1a`）；冠軍 = 总资产最高（`0x437dfe`）', () => {
    const pre = [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, whoPlays: 1, cash: [5, 900, 10, 20][i]!, monthlyPaid: [100, 5000, 1000, 0][i]! }),
    );
    const h = monthlySettleHint(pre, pre, 1, (p) => p.cash);
    expect(h.unlucky).toBe(1); // 5000 vs 次高 1000：3×5000 > 5×1000
    expect(h.champion).toBe(1);
    // 领先不够 ⇒ 无人（原版 0xff）
    const close = pre.map((p, i) => ({ ...p, monthlyPaid: [100, 5000, 4000, 0][i]! }));
    expect(monthlySettleHint(close, close, 1, (p) => p.cash).unlucky).toBe(-1);
  });
});

describe('★★ `advanceGameDay` 跨月写 `lastMonthlySettle`，只活一条 action', () => {
  it('跨月那一条 endTurn：现场是**结算之前**的累加器与存款；GameState 里的累加器照样清零', () => {
    const base = monthEnd((i) => ({ monthlyPaid: i === 2 ? 50_000 : 100, monthlyReceived: 10, totalWinterSleepDays: i === 2 ? 3 : 0 }));
    const s = endTurn(base);
    const h = s.lastMonthlySettle;
    expect(h).toBeTruthy();
    expect(h!.rows).toHaveLength(4);
    expect(h!.rows.every((r) => r.bankBefore === 100_000 && r.interest === 10_000 && r.bank === 110_000)).toBe(true);
    expect(h!.rows[2]).toMatchObject({ unexpectedLoss: 50_000, unexpectedGain: 10, unluckyDays: 3 });
    expect(h!.unlucky).toBe(2);
    // core 状态里照原版清零（`0x00439ec6`）
    expect(s.players.every((p) => p.monthlyPaid === 0 && p.monthlyReceived === 0 && p.totalWinterSleepDays === 0)).toBe(true);
  });

  it('下一条 action 就清掉；月中不写', () => {
    const s = endTurn(monthEnd(() => ({})));
    expect(s.lastMonthlySettle).toBeTruthy();
    const next = endTurn({ ...s, phase: 'turnEnd' });
    expect(next.lastMonthlySettle ?? null).toBeNull();
    const mid = endTurn(makeGameState({ month: 1, day: 10 }));
    expect(mid.lastMonthlySettle ?? null).toBeNull();
  });

  it('纯表现：不进指纹（与 `lastLotteryDraw` 同一规矩）', () => {
    const s = endTurn(monthEnd(() => ({})));
    const without: GameState = { ...s, lastMonthlySettle: null };
    expect(stateFingerprint(s)).toBe(stateFingerprint(without));
  });
});

describe('★★ 单机：日推进之后宿主的 `reseed` 不清瞬态提示', () => {
  it('`reduceWithSeed`（单机施加路径）跨月之后 `lastMonthlySettle` 还在', async () => {
    const { reduceWithSeed } = await import('../rng/host-reseed.ts');
    const base = monthEnd(() => ({}));
    const s = reduceWithSeed({ ...base, mode: 'single', phase: 'turnEnd', currentPlayer: 3 }, { type: 'endTurn' }, topo, 12345);
    expect(s.rngState).toBe(12345);
    expect(s.lastMonthlySettle).toBeTruthy();
  });
});
