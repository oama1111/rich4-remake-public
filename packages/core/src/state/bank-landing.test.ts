/*
 * **落在**銀行格上：先 ATM、再貸款屏 —— 第十三份试玩回报 #2
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 落点分派（`fcn_00419844` 的銀行那一支）：
 * ```asm
 * 0041b396  call 0x4379c9                 ; ① ATM 入口（与路过那台 0x0041b5ab 是同一个函数）
 * 0041b39b  cmp  byte [0x46caf8], 0 / jne ; 终局码非 0 就不往下
 * 0041b3af  call 0x436668                 ; ② 貸款屏入口（`0x0043667b` 拒絕往來期内直接返回）
 * ```
 * ATM 入口 `fcn_004379c9`：拒絕往來 → 訊息框 `0x464bed`（天数 = (+0x3b & 0x7f) + 1，1000 ms）；
 * **恰好** who_plays == 1 的真人 → 模态 ATM 窗（暫停放款时 `0x408` 再弹 `0x464bd4`，1500 ms）；
 * 其余（电脑 / 托管）→ 按 cashRatio 重分現金/存款。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, type GameState } from './types.ts';
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

type P = GameState['players'][0];

/** 玩家 0 站在銀行邻格，`steps` 步走完正好停在銀行上（1 ⇒ 落点）；返回走完那一步、`settle` 之前的状态 */
function ontoBank(opts: { whoPlays: number; steps?: number; over?: (p: P) => P }) {
  const map = loadMap();
  const topo = topoOf(map);
  const bank = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BANK);
  expect(bank, '这张图应该有銀行格').toBeDefined();
  const from = bank!.adjacent.map((id) => map.nodes[id - 1]!).find((n) => n.adjacent.length === 2);
  expect(from, '銀行旁应该有一条普通路格').toBeDefined();
  const prev = from!.adjacent.find((id) => id !== bank!.id)!;
  const game = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 3 });
  const cleared = game.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
  const steps = opts.steps ?? 1;
  const state: GameState = {
    ...game,
    objects: cleared,
    phase: 'moving',
    stepsRemaining: steps,
    stepsTotal: steps,
    players: game.players.map((p, i) => {
      if (i !== 0) return p;
      const me = { ...p, nodeId: from!.id, lastNodeId: prev, whoPlays: opts.whoPlays, cash: 5000, moneyInBank: 3000 };
      return opts.over ? opts.over(me) : me;
    }),
  };
  const stepped = reduce(state, { type: 'step' }, topo);
  expect(stepped.players[0]!.nodeId).toBe(bank!.id);
  return { map, topo, bank: bank!, stepped };
}

/** 走上去并 `settle` */
function landOnBank(opts: { whoPlays: number; over?: (p: P) => P }) {
  const r = ontoBank(opts);
  expect(r.stepped.phase).toBe('settling');
  return { ...r, landed: reduce(r.stepped, { type: 'settle' }, r.topo) };
}

describe('★ 落在銀行：先 ATM（0x0041b396 → 0x4379c9），关掉才进貸款屏（0x0041b3af → 0x436668）', () => {
  run('真人落点 → 先挂 ATM（landing），不是貸款屏', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    expect(landed.pending).toEqual({ kind: 'atm', landing: true });
    expect(landed.phase).toBe('turnEnd');
    // 真人不重分 —— 钱等他自己在窗里办
    expect(landed.players[0]!.cash).toBe(5000);
    expect(landed.players[0]!.moneyInBank).toBe(3000);
  });

  run('ATM 里存一笔 → 钱进銀行，接着换成貸款屏', () => {
    const { landed, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    const d = reduce(landed, { type: 'bank', op: 'deposit', amount: 1000 }, topo);
    expect(d.players[0]!.cash).toBe(4000);
    expect(d.players[0]!.moneyInBank).toBe(4000);
    expect(d.pending?.kind).toBe('bank');
    expect(d.phase).toBe('turnEnd');
  });

  run('ATM 里提一笔 → 钱回手上，接着换成貸款屏', () => {
    const { landed, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    const w = reduce(landed, { type: 'bank', op: 'withdraw', amount: 2000 }, topo);
    expect(w.players[0]!.cash).toBe(7000);
    expect(w.players[0]!.moneyInBank).toBe(1000);
    expect(w.pending?.kind).toBe('bank');
  });

  run('ATM 什么都不办就关（declineDecision）→ 进貸款屏，回合不结束、钱不动', () => {
    const { landed, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    const c = reduce(landed, { type: 'declineDecision' }, topo);
    expect(c.pending?.kind).toBe('bank');
    expect(c.phase).toBe('turnEnd');
    expect(c.players[0]!.cash).toBe(5000);
    expect(c.players[0]!.moneyInBank).toBe(3000);
    // 貸款屏照旧：再关一次才走人
    const out = reduce(c, { type: 'declineDecision' }, topo);
    expect(out.pending).toBeNull();
  });

  run('貸款屏的额度是 ATM **之后**才取的快照（0x0043668f call 0x4239b9）', () => {
    const { landed, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    const direct = reduce(landed, { type: 'declineDecision' }, topo);
    const viaDeposit = reduce(landed, { type: 'bank', op: 'deposit', amount: 1000 }, topo);
    if (direct.pending?.kind !== 'bank' || viaDeposit.pending?.kind !== 'bank') throw new Error('应进貸款屏');
    // 存提只在現金与存款之间挪，身家不变
    expect(viaDeposit.pending.wealth).toBe(direct.pending.wealth);
  });

  run('ATM 窗只有存提：借款 / 还款在这一台上不认', () => {
    const { landed, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    expect(reduce(landed, { type: 'bank', op: 'borrow', amount: 1000 }, topo)).toBe(landed);
    expect(reduce(landed, { type: 'bank', op: 'repay', amount: 1000 }, topo)).toBe(landed);
  });

  run('ATM 开着时回合不会被自动结束（mechanicalAction 看 pending 停下；AI 策略只在托管时替他关窗）', () => {
    const { landed, map } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    // 真人（恰好 1）不归 AI 管
    expect(decideAction({ state: landed, map })).toBeNull();
  });

  run('开着窗被托管 → 策略替他关窗（而不是 endTurn 把 ATM 连同貸款屏一起跳掉）', () => {
    const { landed, map, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    const taken = { ...landed, players: landed.players.map((p, i) => (i === 0 ? { ...p, whoPlays: WHO_PLAYS_HUMAN | 4 } : p)) };
    expect(decideAction({ state: taken, map })).toEqual({ type: 'declineDecision' });
    const c = reduce(taken, { type: 'declineDecision' }, topo);
    expect(c.pending?.kind).toBe('bank');
  });

  /** 全部现金在手、目标比很低 ⇒ 一定重分 */
  const allCash = (p: P): P => ({ ...p, cashRatio: 20, cash: 8000, moneyInBank: 0 });

  run('电脑落点 → 不开 ATM：按 cashRatio 重分，然后直接是貸款屏（照旧）', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_COMPUTER, over: allCash });
    expect(landed.pending?.kind).toBe('bank');
    const me = landed.players[0]!;
    expect(me.cash + me.moneyInBank).toBe(8000);
    expect(me.cash).toBe(Math.trunc(8000 * cashRatioTarget(20, landed.day)));
  });

  run('真人被托管（1|4）落点 → 同电脑那一支', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN | 4, over: allCash });
    expect(landed.pending?.kind).toBe('bank');
    expect(landed.players[0]!.cash).toBe(Math.trunc(8000 * cashRatioTarget(20, landed.day)));
  });

  run('拒絕往來期内落点 → ATM 入口的訊息框（天数 +1、1000 ms），貸款屏也不进', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN, over: (p) => ({ ...p, daysRejectedByBank: 5 }) });
    expect(landed.pending).toBeNull();
    expect(landed.phase).toBe('turnEnd');
    // @source `0x004379e6 and al,0x7f` / `0x004379ed inc eax` / `0x004379ef push 0x464bed` / `0x00437a01 push 0x3e8`
    expect(landed.notices).toEqual([{ key: 'bank.rejected', args: [6], holdMs: 1000 }]);
  });

  run('拒絕往來期内电脑落点 → 同样只有那扇框', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_COMPUTER, over: (p) => ({ ...p, daysRejectedByBank: 0x80 }) });
    expect(landed.pending).toBeNull();
    expect(landed.notices).toEqual([{ key: 'bank.rejected', args: [1], holdMs: 1000 }]);
  });
});

describe('★ 銀行暫停放款（+0x3c != 0）时的 ATM —— 窗 0x401 → 0x408', () => {
  const frozen = (p: P): P => ({ ...p, bankFreezeDays: 4 });

  run('落点：ATM 照开，同一条 action 交出「銀行暫停放款」框（天数 +1，1500 ms 缺省）', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN, over: frozen });
    expect(landed.pending).toEqual({ kind: 'atm', landing: true });
    // @source `0x0043711b and al,0x7f` / `0x00437121 inc ebx` / `0x00437123 push 0x464bd4` / `0x00437135 push 0x5dc`
    expect(landed.notices).toEqual([{ key: 'bank.frozen', args: [5] }]);
  });

  run('暫停放款时 ATM 提不了款（0x00437028 模式 = 存款；0x004371ee 点提款钮换成当前模式）', () => {
    const { landed, topo } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN, over: frozen });
    expect(reduce(landed, { type: 'bank', op: 'withdraw', amount: 1000 }, topo)).toBe(landed);
    const d = reduce(landed, { type: 'bank', op: 'deposit', amount: 1000 }, topo);
    expect(d.players[0]!.moneyInBank).toBe(4000);
    expect(d.pending?.kind).toBe('bank');
  });

  run('路过也是同一台：暫停放款时同样弹框、同样提不了', () => {
    const { stepped, topo } = ontoBank({ whoPlays: WHO_PLAYS_HUMAN, steps: 2, over: frozen });
    expect(stepped.pending).toEqual({ kind: 'atm' });
    expect(stepped.notices).toEqual([{ key: 'bank.frozen', args: [5] }]);
    expect(reduce(stepped, { type: 'bank', op: 'withdraw', amount: 1000 }, topo)).toBe(stepped);
  });

  run('没暫停放款：不弹那扇框', () => {
    const { landed } = landOnBank({ whoPlays: WHO_PLAYS_HUMAN });
    expect(landed.notices.some((n) => n.key === 'bank.frozen')).toBe(false);
  });
});
