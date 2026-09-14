/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 长局冒烟：让四个电脑玩家真打一局，看整套系统是否咬合
 *
 * 这类测试和单元测试的作用不同——它抓的是「各部分单独都对、
 * 合起来却跑不动」的问题：状态机卡死、事件永不触发、
 * 钱凭空出现或消失。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { holdingsCost, holdingsValue } from '../ai/stock-policy.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

interface SoakResult {
  state: GameState;
  steps: number;
  events: { news: number; fortune: number };
}

function soak(seed: number, maxTurns: number): SoakResult {
  const map = loadMap();
  const topo = { nodes: map.nodes, lands: map.lands };
  let state = newGame({ map, players: players(), seed });
  const events = { news: 0, fortune: 0 };
  let lastNews = state.newsDeck.cursor;
  let lastFortune = state.fortuneDeck.cursor;

  let steps = 0;
  for (; steps < 200_000; steps++) {
    const a = decideAction({ state, map });
    if (a === null) break;
    const next = reduce(state, a, topo);
    if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
    state = next;

    if (state.newsDeck.cursor !== lastNews) {
      events.news++;
      lastNews = state.newsDeck.cursor;
    }
    if (state.fortuneDeck.cursor !== lastFortune) {
      events.fortune++;
      lastFortune = state.fortuneDeck.cursor;
    }
    if (state.turnCount >= maxTurns) break;
  }
  return { state, steps, events };
}

/**
 * 同样跑一局，但每回合把存款按回合前的值还原 —— 等于关掉银行月息。
 *
 * 用来把「钱变多」这件事的来源钉死：关掉唯一那台印钞机之后，
 * 总额必须只减不增。
 */
function soakWithoutInterest(seed: number, maxTurns: number): GameState {
  const map = loadMap();
  const topo = { nodes: map.nodes, lands: map.lands };
  let state = newGame({ map, players: players(), seed });

  for (let steps = 0; steps < 200_000; steps++) {
    const a = decideAction({ state, map });
    if (a === null) break;
    const before = state.players.map((p) => p.moneyInBank);
    const next = reduce(state, a, topo);
    if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
    state =
      a.type === 'endTurn'
        ? { ...next, players: next.players.map((p, i) => ({ ...p, moneyInBank: before[i]! })) }
        : next;
    if (state.turnCount >= maxTurns) break;
  }
  return state;
}

describe('★ 长局冒烟', () => {
  run('300 回合不卡死', () => {
    const r = soak(2024, 300);
    expect(r.state.turnCount).toBeGreaterThanOrEqual(300);
    expect(r.steps).toBeLessThan(200_000);
  });

  run('★ 新聞与命運事件确实会触发', () => {
    const r = soak(2024, 300);
    expect(r.events.news + r.events.fortune).toBeGreaterThan(0);
  });

  run('★ 有人买地、有人盖房', () => {
    const r = soak(2024, 300);
    expect(r.state.landOwner.filter((v) => v !== 0).length).toBeGreaterThan(0);
    expect(r.state.landLevel.some((v) => v > 0)).toBe(true);
  });

  run('★ 钱确实会凭空出现 —— 唯一的印钞机是银行月息', () => {
    // ⚠️ 这条断言先前写反了（要求「净值 + 公库 ≤ 初始总额」）。
    //   那是接入日期推进之前的模型：那时没有月结，钱确实只在玩家之间搬。
    //   现在每跨一个月，无贷款者的存款 ×1.1（rules/monthly.ts，
    //   证据是 `fmul qword [0x464e88]` 那个 1.1），钱是**真的会变多**的。
    const r = soak(2024, 200);
    // ⚠️ 必须**把持仓算进来**：AI 接上炒股（角色表 f26）之后，存款会变成股票，
    //   只数 cash + moneyInBank 会看着凭空少一大块。
    const netWorth = r.state.players.reduce(
      (t, p) => t + p.cash + p.moneyInBank + holdingsValue(r.state, p.index),
      0,
    );
    const initial = 300_000 * 4;
    expect(netWorth + r.state.pool).toBeGreaterThan(initial);

    // 关掉月息这唯一一台印钞机，总额就该只减不增（钱变成了地产、进了公库）
    //
    // ⚠️ **必须减掉贷款**。银行放贷会把钱凭空加进存款
    //   （`borrow`：`money_in_bank += amount; loan += amount`），
    //   那不是印钞，是**负债**——净值没变。AI 接上 `loanRatio`（角色表 f24）
    //   之后它们真的会去借，不减这一项这条断言当场就假。
    const noInterest = soakWithoutInterest(2024, 200);
    // ⚠️ 这里按**成本**而不是市值算持仓：买入是把钱 1:1 换成成本，成本守恒；
    //   市值会随行情涨跌，那是账面盈亏，不是新印出来的钱。
    const frozen = noInterest.players.reduce(
      (t, p) => t + p.cash + p.moneyInBank + holdingsCost(noInterest, p.index) - p.loan,
      0,
    );
    expect(frozen + noInterest.pool).toBeLessThanOrEqual(initial);
  });

  run('★ 同种子可完整复现', () => {
    const a = soak(31337, 150);
    const b = soak(31337, 150);
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(a.state.landOwner).toEqual(b.state.landOwner);
    expect(a.state.players.map((p) => p.cash)).toEqual(b.state.players.map((p) => p.cash));
    expect(a.events).toEqual(b.events);
  });

  run('多个种子都能跑完', () => {
    for (const seed of [1, 7, 12345]) {
      const r = soak(seed, 120);
      expect(r.state.turnCount, `seed ${seed}`).toBeGreaterThanOrEqual(120);
    }
  });
});
