/*
 * ★ 推日期里开出的下線拍卖 → 新玩家的回合边界押到拍卖打完（ds/playtest-14 合并后 seed 230 的卡死）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 回合推进 `0x418ebd`：
 * ```asm
 * 00418f95  inc esi / mov [0x49910c], esi   ; 游标先推到下一位
 * 0041902e  call 0x41cf67                   ; 绕回 0 号：推日期 —— 15 日 0x0041d08f call 0x42ba97（分紅）
 *                                           ;   负分紅打破產 0x0042beba call 0x40cd87 → 释放 > 3 处连拍 3 场（0x43bde5，阻塞）
 * 00419039  call 0x41c84f                   ; ★ 拍卖全打完才轮到新玩家的回合边界（还款日检查 / 阻碍计数 / 神明任期）
 * ```
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, type GameState } from './types.ts';
import { topoOf } from '../testing/factories.ts';
import { packDate } from '../rules/calendar.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

function setup() {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo = topoOf(map);
  const game = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) })),
    seed: 7,
  });
  const company = (topo.commercials ?? [])[0]!;
  const lands = (topo.lands ?? []).slice(1, 6).map((l) => l.id);
  const landOwner = [...game.landOwner];
  for (const id of lands) landOwner[id] = 2; // 玩家 1 名下 5 块 ⇒ 破產释放 > 3 处 ⇒ 连拍 3 场
  const companyFunds = [...game.companyFunds];
  companyFunds[company.id] = -10_000_000;
  const state: GameState = {
    ...game,
    objects: game.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 })),
    day: 14,
    currentPlayer: 3,
    phase: 'turnEnd',
    pending: null,
    landOwner,
    companyFunds,
    holdings: game.holdings.map((row, p) =>
      p === 1 ? row.map((h, s) => (s === company.stockIndex ? { ...h, amount: 100 } : h)) : row,
    ),
    players: game.players.map((p, i) => {
      if (i === 0) {
        return {
          ...p,
          whoPlays: WHO_PLAYS_HUMAN,
          loan: 1000,
          // 15 日 + 3 天 ⇒ 真人还款提醒窗
          loanDueDate: packDate({ year: game.year, month: game.month, day: 18 }),
          blocking: { ...p.blocking, inHotel: 3 },
        };
      }
      if (i === 1) return { ...p, whoPlays: WHO_PLAYS_COMPUTER, cash: 100, moneyInBank: 0 };
      return { ...p, whoPlays: WHO_PLAYS_COMPUTER };
    }),
  };
  return { state, topo };
}

describe('★ 推日期（15 日分紅）打破產 → 下線拍卖先打完，才轮到新玩家的 0x41c84f', () => {
  run('拍卖挂着时：新玩家已是当前玩家，但还款日检查 / 阻碍计数都还没走', () => {
    const { state, topo } = setup();
    const r = reduce(state, { type: 'endTurn' }, topo);
    expect(r.day).toBe(15);
    expect(r.players[1]!.whoPlays).toBe(0); // 分紅打破產
    expect(r.currentPlayer).toBe(0);
    expect(r.phase).toBe('awaitingDecision');
    expect(r.pending?.kind).toBe('auction');
    expect(r.pendingQueue.length).toBe(2);
    expect(r.deferredTurnStart).toBe(0);
    expect(r.players[0]!.blocking.inHotel).toBe(3);
  });

  run('三场打完 ⇒ 这才走 0x41c84f：还款提醒窗挂出来（不覆盖拍卖），关窗后住宿 3 → 2', () => {
    const { state, topo } = setup();
    let s = reduce(state, { type: 'endTurn' }, topo);
    let n = 0;
    while (s.pending?.kind === 'auction' && n++ < 10) {
      expect(s.players[0]!.blocking.inHotel).toBe(3);
      s = reduce(s, { type: 'auction', winner: -1, price: 0 }, topo);
    }
    expect(n).toBe(3);
    expect(s.pending).toEqual({ kind: 'loanReminder' });
    expect(s.phase).toBe('turnStart');
    expect(s.currentPlayer).toBe(0);
    expect(s.deferredTurnStart ?? null).toBeNull();
    const closed = reduce(s, { type: 'declineDecision' }, topo);
    expect(closed.phase).toBe('turnStart');
    expect(closed.players[0]!.blocking.inHotel).toBe(2);
  });
});

describe('★ 2026-09-24 审计：分紅按人加总、每人结一次；分紅破产者的樂透号码开獎前就放掉', () => {
  run('两家企业：一家大负一家正 ⇒ 净额进存款，不会先扣穿再折现金（0x0042bce3 累加 → 0x0042be83 一次结）', () => {
    const { state, topo } = setup();
    const [a, b] = (topo.commercials ?? []) as NonNullable<typeof topo.commercials>;
    const companyFunds = [...state.companyFunds];
    companyFunds[a!.id] = -5_000;
    companyFunds[b!.id] = 8_000;
    const s: GameState = {
      ...state,
      companyFunds,
      holdings: state.holdings.map((row, p) =>
        p === 1 ? row.map((h, i) => (i === a!.stockIndex || i === b!.stockIndex ? { ...h, amount: 100 } : { ...h, amount: 0 })) : row.map((h) => ({ ...h, amount: 0 })),
      ),
      players: state.players.map((p, i) => (i === 1 ? { ...p, cash: 100, moneyInBank: 0 } : p)),
    };
    const r = reduce(s, { type: 'endTurn' }, topo);
    expect(r.day).toBe(15);
    // 净 +3000 进存款；現金不动（旧式先 −5000 把存款扣穿、現金 100 折光 ⇒ 破产）
    expect(r.players[1]!.whoPlays).not.toBe(0);
    expect(r.players[1]!.moneyInBank).toBe(3_000);
    expect(r.players[1]!.cash).toBe(100);
  });

  run('分紅打破产的人手里的樂透号码不参加当天开獎（0x0040d1a8 在 0x0041d094 之前）', () => {
    const { state, topo } = setup();
    const lottery = [...state.lottery];
    lottery[4] = 2; // 1 号（将被分紅打破产）买了唯一一张
    const r = reduce({ ...state, lottery, pool: 1000 }, { type: 'endTurn' }, topo);
    expect(r.players[1]!.whoPlays).toBe(0);
    // 号码放掉 ⇒ 一张票都没卖出 ⇒ 不开獎，奖池留着
    expect(r.lastLotteryDraw ?? null).toBeNull();
    expect(r.pool).toBeGreaterThanOrEqual(1000);
    expect(r.lottery[4]).toBe(0);
  });
});
