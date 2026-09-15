/*
 * 勝利條件（遊戲時間 / 勝利條件）接线后的行为
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 判据与 VA 见 rules/victory.ts 与 docs/deviations/Q-SETUP-1.md。
 * 四条必须钉住的：
 *   ① 到点那天会怎样（当天结束 + 跳过当天的其余步骤）
 *   ② 总资产到倍率会怎样
 *   ③ 两条都为 0 时行为与「没接」逐字节一致
 *   ④ 破产结束条件仍然有效
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { gameOverCode, isGameOver, reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from './types.ts';
import { NO_WIN_CONDITIONS } from '../rules/setup.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

/** 一輪才过一天：让最后一名玩家收回合，回合才会绕回 0 号（0x00418f93） */
const endTurn = (s: GameState): GameState =>
  reduce({ ...s, phase: 'turnEnd', currentPlayer: s.players.length - 1 }, { type: 'endTurn' }, topo);

/** 四名玩家，现金各不相同（总资产 = 现金 + 存款 − 贷款） */
function withCash(amounts: readonly number[], over: Partial<GameState> = {}): GameState {
  return makeGameState({
    ...over,
    players: amounts.map((cash, i) =>
      makePlayer({ index: i, character: i, cash, moneyInBank: 0 }),
    ),
  });
}

describe('① 到点那天会怎样（遊戲時間）', () => {
  it('★ 總天數推到目标那天 → 当场终局，且当天的物价指数不采样', () => {
    // 四人身家各 120 万 → 若走完日推进，物价指数会采样到 (120万/30万) = 4
    const s = withCash([1_200_000, 1_200_000, 1_200_000, 1_200_000], {
      totalDays: 0,
      priceIndex: 1,
      winConditions: { targetDays: 1, targetWealth: 0 },
    });
    const out = endTurn(s);
    expect(out.phase).toBe('gameOver');
    // @source 0x0041cfab `inc [0x4990e4]` 在判定**之前** → 天数照加、日期照翻
    expect(out.totalDays).toBe(1);
    expect([out.year, out.month, out.day]).toEqual([1998, 1, 6]);
    // ★ 判定在 `call 0x423acf` 之前 → 达标当天不采样物价指数
    expect(out.priceIndex).toBe(1);
    // 赢家 = 在世者里的首富（原版 `fcn_0041d89e` 取 edi 最大者）
    // 终局码在清 who_plays **之前**就算好了：四名真人 → 3
    expect(out.victory).toEqual({ winner: 0, reason: 'timeLimit', wealth: 1_200_000, code: 3 });
    // ★ 除赢家以外全部 who_plays = 0（@source 0x0041d951 的循环），但**钱留着**
    expect(out.players.map((p) => p.whoPlays)).toEqual([WHO_PLAYS_HUMAN, 0, 0, 0]);
    expect(out.players[1]!.cash).toBe(1_200_000);
  });

  it('★ 目标 730 天：第 730 次日推进才结束，第 729 天不结束', () => {
    const base = withCash([300_000, 300_000, 300_000, 300_000], {
      totalDays: 728,
      winConditions: { targetDays: 730, targetWealth: 0 },
    });
    const day729 = endTurn(base);
    expect(day729.phase).not.toBe('gameOver');
    expect(day729.totalDays).toBe(729);
    const day730 = endTurn(day729);
    expect(day730.phase).toBe('gameOver');
    expect(day730.totalDays).toBe(730);
  });

  it('★ 结束时的当前玩家 = 赢家 @source 0x0041d915', () => {
    const s = withCash([10_000, 999_999, 20_000, 30_000], {
      totalDays: 0,
      winConditions: { targetDays: 1, targetWealth: 0 },
    });
    const out = endTurn(s);
    expect(out.currentPlayer).toBe(1);
    expect(out.victory?.winner).toBe(1);
  });

  it('★ 全员资产为 0 时天数条件不生效（原版 `test edi, edi / je`）', () => {
    const s = withCash([0, 0, 0, 0], {
      totalDays: 0,
      winConditions: { targetDays: 1, targetWealth: 0 },
    });
    const out = endTurn(s);
    expect(out.phase).not.toBe('gameOver');
    expect(out.totalDays).toBe(1);
  });

  it('只有日推进时才判 —— 未绕回 0 号的回合不结算', () => {
    const s = withCash([1_200_000, 1_200_000, 1_200_000, 1_200_000], {
      totalDays: 0,
      winConditions: { targetDays: 1, targetWealth: 0 },
    });
    const mid = reduce({ ...s, phase: 'turnEnd', currentPlayer: 1 }, { type: 'endTurn' }, topo);
    expect(mid.phase).toBe('turnStart');
    expect(mid.totalDays).toBe(0);
  });
});

describe('② 总资产到倍率会怎样（勝利條件）', () => {
  it('★ 首富总资产达标 → 终局，赢家是首富', () => {
    const s = withCash([500_000, 1_500_000, 700_000, 600_000], {
      winConditions: { targetDays: 0, targetWealth: 1_200_000 },
    });
    const out = endTurn(s);
    expect(out.phase).toBe('gameOver');
    expect(out.victory).toEqual({ winner: 1, reason: 'wealthTarget', wealth: 1_500_000, code: 3 });
  });

  it('没达标就不结束', () => {
    const s = withCash([500_000, 1_100_000, 700_000, 600_000], {
      winConditions: { targetDays: 0, targetWealth: 1_200_000 },
    });
    const out = endTurn(s);
    expect(out.phase).not.toBe('gameOver');
    expect(out.victory).toBeNull();
  });

  it('★ 恰好等于目标即达标（原版是 `jl` 跳出，`edi >= 目标` 就结束）', () => {
    const s = withCash([1_200_000, 10, 10, 10], {
      winConditions: { targetDays: 0, targetWealth: 1_200_000 },
    });
    expect(endTurn(s).phase).toBe('gameOver');
  });

  it('两条同时设：先看天数，天数没到再看金额', () => {
    const s = withCash([900_000, 900_000, 900_000, 900_000], {
      totalDays: 0,
      winConditions: { targetDays: 730, targetWealth: 800_000 },
    });
    const out = endTurn(s);
    expect(out.victory?.reason).toBe('wealthTarget');
  });

  it('★ 终局码照原版看「赢家是不是真人」@source 0x0041d96b..0x0041da55', () => {
    const base = (whoPlays: readonly number[]): GameState =>
      makeGameState({
        players: whoPlays.map((w, i) =>
          makePlayer({ index: i, character: i, whoPlays: w, cash: i === 1 ? 900_000 : 10_000 }),
        ),
        winConditions: { targetDays: 0, targetWealth: 800_000 },
        phase: 'turnEnd',
      });
    // 单人类局、赢家是真人 → 2（首富是 1 号，故 1 号是那唯一一名真人）
    const solo = endTurn(base([WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_COMPUTER]));
    expect(solo.victory?.winner).toBe(1);
    expect(gameOverCode(solo)).toBe(2);
    // 双人类局、赢家是真人 → 3
    const duo = endTurn(base([WHO_PLAYS_HUMAN, WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_COMPUTER]));
    expect(gameOverCode(duo)).toBe(3);
    // 赢家是电脑 → 1（单人局那支原版还有个「要读档吗」的模态框，见 victory.ts）
    const aiWins = makeGameState({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, whoPlays: i === 0 ? WHO_PLAYS_HUMAN : WHO_PLAYS_COMPUTER, cash: i === 2 ? 900_000 : 10_000 }),
      ),
      winConditions: { targetDays: 0, targetWealth: 800_000 },
      phase: 'turnEnd',
    });
    const aiOut = endTurn(aiWins);
    expect(aiOut.victory?.winner).toBe(2);
    expect(gameOverCode(aiOut)).toBe(1);
  });
});

describe('③ 两条都为 0 时行为不变', () => {
  it('★ 無限条件下跑很多天也不会自动结束', () => {
    let s = withCash([300_000, 300_000, 300_000, 300_000], {
      winConditions: { ...NO_WIN_CONDITIONS },
    });
    for (let i = 0; i < 60; i++) s = endTurn(s);
    expect(s.phase).not.toBe('gameOver');
    expect(s.victory).toBeNull();
    expect(s.totalDays).toBe(60);
    expect(isGameOver(s)).toBe(false);
  });

  it('★ 物价指数照常每天采样（唯一的既有行为差别点）', () => {
    const s = withCash([1_200_000, 1_200_000, 1_200_000, 1_200_000], {
      priceIndex: 1,
      winConditions: { ...NO_WIN_CONDITIONS },
    });
    const out = endTurn(s);
    expect(out.phase).toBe('turnStart');
    expect(out.priceIndex).toBe(4);
  });

  it('缺省（不传 winConditions）等价于两条都無限', () => {
    const s = withCash([300_000, 300_000, 300_000, 300_000], { totalDays: 99 });
    expect(s.winConditions).toEqual(NO_WIN_CONDITIONS);
    const out = endTurn(s);
    expect(out.phase).toBe('turnStart');
    expect(out.totalDays).toBe(100);
  });
});

describe('④ 破产结束条件仍然有效', () => {
  it('★ 只剩一人时照旧终局（单人局 → 终局码 2）', () => {
    // 直接构造「只剩一人」的局面：玩家 1 已出局
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, character: 0, whoPlays: WHO_PLAYS_HUMAN, cash: 10_000 }),
        makePlayer({ index: 1, character: 1, whoPlays: 0, cash: 0, moneyInBank: 0 }),
      ],
      winConditions: { ...NO_WIN_CONDITIONS },
      phase: 'turnEnd',
      currentPlayer: 0,
    });
    expect(isGameOver(s)).toBe(true);
    expect(gameOverCode(s)).toBe(2);
  });

  it('★ 按勝利條件終局时终局码不算「还剩几人」', () => {
    // 只剩一人、而且是单人局：终局码仍是 2，但 reason 记的是条件达标
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, character: 0, whoPlays: WHO_PLAYS_HUMAN, cash: 900_000 }),
        makePlayer({ index: 1, character: 1, whoPlays: 0, cash: 0, moneyInBank: 0 }),
      ],
      totalDays: 0,
      winConditions: { targetDays: 1, targetWealth: 0 },
      phase: 'turnEnd',
      currentPlayer: 0,
    });
    const out = endTurn(s);
    expect(out.phase).toBe('gameOver');
    expect(out.victory?.reason).toBe('timeLimit');
    expect(gameOverCode(out)).toBe(2);
  });
});
