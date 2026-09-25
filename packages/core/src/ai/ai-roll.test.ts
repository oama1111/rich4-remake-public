/*
 * AI 决策里的随机数走**全局序列**（FU-2 / D-004 / D-007）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版电脑那一支的每一次 `rand()` 都走全局 `call 0x456f2d`：
 *   出牌主循环起点 `0x00441d4a`（>8 张才掷）、個性闸门 `0x0041e6ce`（只差一档才掷）、
 *   判定函数里的 `%4` / `%n`（如改建卡 `0x0041eec4`）、前瞻岔路 `0x0040b221`、
 *   骰子数 `0x004222e1` …
 * 本引擎把这些决策放在纯策略层，于是随机数由调用方经 `AiContext.roll` 递进来
 * （`decideAction` 自己从 `state.rngState` 播种），掷掉的数由 `reduce` 在同一局面上
 * 复算并写回 `state.rngState`（`aiDecisionRollAdvance`）。
 *
 * 这里钉住三条：
 *   ① 闸门只在**差一档**时掷（差两档 / 不用掷的档位一次都不掷）；
 *   ② 决策真的消耗全局流，且 reducer 记下的掷数与决策实际掷数**逐次相等**；
 *   ③ 真人的同一手不推进全局流。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, type Rich4Map } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import type { GameState } from '../state/types.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { CARDS } from '@rich4/data';
import { personalityAllowsLazy } from './personality.ts';
import { decideAction } from './policy.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const topoOf = (map: Rich4Map): MapTopology => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

describe('★ 個性闸门的懒求值（`0x0041e6c1` / `0x0041e6c9`）', () => {
  const countCalls = (f7: number, personality: number): number => {
    let calls = 0;
    personalityAllowsLazy(f7, personality, () => {
      calls++;
      return 0;
    });
    return calls;
  };

  it('差两档（≥2）→ 从不，且**一次都不掷**（原版 `xor eax,eax / ret`）', () => {
    expect(countCalls(2, 0)).toBe(0);
    expect(countCalls(1, -1)).toBe(0);
  });

  it('差一档（==1）→ 掷一次 `%3`，==0 才做', () => {
    expect(countCalls(1, 0)).toBe(1);
    expect(personalityAllowsLazy(1, 0, () => 0)).toBe(true);
    expect(personalityAllowsLazy(1, 0, () => 1)).toBe(false);
    expect(personalityAllowsLazy(1, 0, () => 2)).toBe(false);
  });

  it('不差档（≤0）→ 照做，也不掷', () => {
    expect(countCalls(0, 1)).toBe(0);
    expect(personalityAllowsLazy(0, 1, () => 2)).toBe(true);
  });
});

/** AI 走到「出牌」那一步（`aiStep = 2`、`aiBranch = 1`）的现场 */
function cardStep(map: Rich4Map): GameState {
  const s0 = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 11,
  });
  return { ...s0, currentPlayer: 0, phase: 'awaitingRoll', aiStep: 2, aiBranch: 1, pending: null };
}

describe('★★ 出牌决策消耗全局随机流（FU-2）', () => {
  run('reducer 记下的掷数 = 决策实际掷数（逐次相等），且服务器 / 单机同一手', () => {
    const map = loadMap();
    const topo = topoOf(map);
    // 手上塞满牌：`0x00441d4a` 的 `rand() % 张数` 一定掷，闸门与判定函数再各掷若干
    const s0 = cardStep(map);
    const cards = CARDS.slice(0, 10).map((c) => c.id);
    const state: GameState = {
      ...s0,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, cards, aiFlags: 3, personality: 1 } : p)),
    };

    // ① 决策实际掷了几次（用一支记账的脚本数出来）
    let calls = 0;
    const counting = new WatcomRng();
    counting.setState(state.rngState);
    const planned = decideAction({ state, map, roll: () => (calls++, counting.next()) });
    expect(calls).toBeGreaterThan(0);
    expect(planned).not.toBeNull();

    // ② 同一条 action 经 reducer：rngState 恰好前进 calls 步
    const action = planned!.type === 'useCard' ? planned! : ({ type: 'aiNext' } as const);
    const after = reduce(state, action, topo);
    expect(after).not.toBe(state);
    const replay = new WatcomRng();
    replay.setState(state.rngState);
    for (let i = 0; i < calls; i++) replay.next();
    expect(after.rngState).toBe(replay.getState());

    // ③ 同样的局面、不带显式脚本（生产路径：`decideAction` 自己播种）⇒ 同一手
    expect(decideAction({ state, map })).toEqual(planned);
  });

  run('★ 真人的同一手**不**推进全局流（`useCard` 只在电脑座位补掷）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = cardStep(map);
    const state: GameState = {
      ...s0,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, whoPlays: 1, cards: [CARDS[0]!.id] } : p)),
    };
    const after = reduce(state, { type: 'aiNext' }, topo);
    expect(after).toBe(state);
    expect(after.rngState).toBe(state.rngState);
  });
});
