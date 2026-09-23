/*
 * 路过銀行（走子途中经过銀行格，不是落点）—— 第八份试玩回报 #4
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 逐步处理 `fcn_0041b42d` @ 0x41b53f：`specialKind == 0xe`（銀行）且 `[player+0x37] == 0`（没在夢遊）
 *   且格上物件不是路障（type 0x10）→ `call 0x4379c9`（ATM 入口）。ATM 入口 `fcn_004379c9` 再分三支：
 *   拒绝往来期 → 訊息框 0x464bed 1000 ms；`who_plays == 1` 的真人 → 模态 ATM 窗；其余 → 按 cashRatio 重分現金/存款。
 *
 * 这里把玩家 0 摆到**銀行格的邻格**、上一格设成另一侧的邻格（岔路只剩銀行一条），
 * `stepsRemaining = 2` ⇒ 这一步踏上銀行时还剩 1 步 = 路过。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, type GameState } from './types.ts';
import { OBJECT_TYPE_ROADBLOCK, placeObjectOfType } from '../rules/object-landing.ts';
import { cashRatioTarget } from '../places/bank.ts';
import { decideAction } from '../ai/policy.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const topoOf = (map: ReturnType<typeof loadMap>) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

/** 玩家 0 站在銀行邻格、下一步必踏銀行；`steps` = 这一趟还要走几步（2 ⇒ 路过，1 ⇒ 落点）*/
function beforeBank(opts: { steps: number; whoPlays: number; over?: (p: GameState['players'][0]) => GameState['players'][0] }) {
  const map = loadMap();
  const topo = topoOf(map);
  const bank = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BANK);
  expect(bank, '这张图应该有銀行格').toBeDefined();
  // 找一个邻格：它到銀行的路要唯一，就把「上一格」设成它的另一个邻格
  const from = bank!.adjacent.map((id) => map.nodes[id - 1]!).find((n) => n.adjacent.length === 2);
  expect(from, '銀行旁应该有一条普通路格').toBeDefined();
  const prev = from!.adjacent.find((id) => id !== bank!.id)!;
  const game = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 3 });
  const cleared = game.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
  const state: GameState = {
    ...game,
    objects: cleared,
    phase: 'moving',
    stepsRemaining: opts.steps,
    stepsTotal: opts.steps,
    players: game.players.map((p, i) => {
      if (i !== 0) return p;
      const me = { ...p, nodeId: from!.id, lastNodeId: prev, whoPlays: opts.whoPlays, cash: 5000, moneyInBank: 3000 };
      return opts.over ? opts.over(me) : me;
    }),
  };
  return { state, topo, bank: bank! };
}

describe('★ 路过銀行', () => {
  run('真人路过 → pending atm，且踏上的是銀行格、步数还剩', () => {
    const { state, topo, bank } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.players[0]!.nodeId).toBe(bank.id);
    expect(r.stepsRemaining).toBe(1);
    expect(r.phase).toBe('moving');
    expect(r.pending).toEqual({ kind: 'atm' });
  });

  run('ATM 开着时再 step 不动（模态窗挡着走子）', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    expect(reduce(r, { type: 'step' }, topo)).toBe(r);
  });

  run('存款一笔 → pending 清掉、钱进銀行；之后能继续走', () => {
    const { state, topo, bank } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    const d = reduce(r, { type: 'bank', op: 'deposit', amount: 1000 }, topo);
    expect(d.pending).toBeNull();
    expect(d.players[0]!.cash).toBe(4000);
    expect(d.players[0]!.moneyInBank).toBe(4000);
    const w = reduce(d, { type: 'step' }, topo);
    expect(w.players[0]!.nodeId).not.toBe(bank.id);
    expect(w.stepsRemaining).toBe(0);
  });

  run('提款一笔 → pending 清掉、钱回手上', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    const w = reduce(r, { type: 'bank', op: 'withdraw', amount: 2000 }, topo);
    expect(w.pending).toBeNull();
    expect(w.players[0]!.cash).toBe(7000);
    expect(w.players[0]!.moneyInBank).toBe(1000);
  });

  run('路过时不许贷款 / 还款（ATM 窗只有存提两个键）', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    const l = reduce(r, { type: 'bank', op: 'borrow', amount: 1000 }, topo);
    expect(l.pending).toEqual({ kind: 'atm' });
    expect(l.players[0]!.cash).toBe(5000);
  });

  run('右键关窗（declineDecision）→ pending 清掉、钱不动', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    const c = reduce(r, { type: 'declineDecision' }, topo);
    expect(c.pending).toBeNull();
    expect(c.players[0]!.cash).toBe(5000);
    expect(c.players[0]!.moneyInBank).toBe(3000);
    // 关窗不结束回合：剩下那一步照走
    expect(c.phase).toBe('moving');
    expect(c.stepsRemaining).toBe(1);
    expect(reduce(c, { type: 'step' }, topo).stepsRemaining).toBe(0);
  });

  run('开着窗被托管（AI 接管）→ 策略替他关窗而不是反复 step', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    const taken = { ...r, players: r.players.map((p, i) => (i === 0 ? { ...p, whoPlays: WHO_PLAYS_HUMAN | 4 } : p)) };
    const map = loadMap();
    expect(decideAction({ state: taken, map })).toEqual({ type: 'declineDecision' });
    const c = reduce(taken, { type: 'declineDecision' }, topo);
    expect(decideAction({ state: c, map })).toEqual({ type: 'step' });
  });

  /** 全部现金在手（比 1.0）、目标比很低 ⇒ 差值远超 ±0.25 的「不动带」，一定重分 */
  const allCash = (p: GameState['players'][0]) => ({ ...p, cashRatio: 20, cash: 8000, moneyInBank: 0 });
  const expectedCash = (day: number) => Math.trunc(8000 * cashRatioTarget(20, day));

  run('电脑路过 → 不开窗，按 cashRatio 重分現金/存款', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_COMPUTER, over: allCash });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.pending).toBeNull();
    const me = r.players[0]!;
    expect(me.cash + me.moneyInBank).toBe(8000);
    expect(me.cash).toBe(expectedCash(r.day));
    expect(me.cash).toBeLessThan(8000);
  });

  run('真人被托管（1|4）也走重分那一支', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN | 4, over: allCash });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.pending).toBeNull();
    expect(r.players[0]!.cash).toBe(expectedCash(r.day));
  });

  run('真人（恰好 1）路过不重分 —— 钱等他自己在窗里办', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN, over: allCash });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.pending).toEqual({ kind: 'atm' });
    expect(r.players[0]!.cash).toBe(8000);
  });

  run('拒绝往来期 → 只给訊息框 1000 ms，不开窗也不重分', () => {
    const { state, topo } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN, over: (p) => ({ ...p, daysRejectedByBank: 5 }) });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.pending).toBeNull();
    // ★ 天数 = (+0x3b & 0x7f) + 1 @source `0x004379e6 and al,0x7f` / `0x004379ed inc eax` / `0x004379ee push eax`
    //   （先前写成 `args: [5]` 是复述实现、漏了那个 `inc`；与状态栏 / 回合开始那五扇框同一口径）
    expect(r.notices).toEqual([{ key: 'bank.rejected', args: [6], holdMs: 1000 }]);
    expect(r.players[0]!.cash).toBe(5000);
  });

  run('落点（最后一步）不算路过：走 settle 那条老路', () => {
    const { state, topo } = beforeBank({ steps: 1, whoPlays: WHO_PLAYS_HUMAN });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.stepsRemaining).toBe(0);
    expect(r.pending).toBeNull();
  });

  run('格上摆了路障 → 不触发', () => {
    const { state, topo, bank } = beforeBank({ steps: 2, whoPlays: WHO_PLAYS_HUMAN });
    const withBlock = { ...state, objects: placeObjectOfType(state.objects, OBJECT_TYPE_ROADBLOCK, bank.id).objects };
    const r = reduce(withBlock, { type: 'step' }, topo);
    expect(r.pending).toBeNull();
  });

  run('夢遊中路过 → 不触发', () => {
    const { state, topo } = beforeBank({
      steps: 2,
      whoPlays: WHO_PLAYS_HUMAN,
      over: (p) => ({ ...p, blocking: { ...p.blocking, sleepWalking: 3 } }),
    });
    const r = reduce(state, { type: 'step' }, topo);
    expect(r.pending).toBeNull();
  });
});
