/*
 * 「施加一条 action + 宿主注入的重播种」—— 生产路径与重放路径共用的唯一实现
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版每回合在日推进里 `srand(GetTickCount())`（`0x0041D06E`）。core 读不到时钟，
 * 种子由宿主给；只要把**那一刻的种子**连同 action 一起记下来，整局就能逐条重放
 * （`client/flight-recorder.ts` 记、`tools/replay-report.ts` 放）。
 *
 * ★ 这个函数原先在 `client/rng-host.ts` 里。搬进 core 是为了让「玩的时候怎么施加」
 *   与「重放的时候怎么施加」**是同一段代码** —— 两份实现迟早会岔开，而岔开的症状
 *   恰好是「回报重放不出现场」，最难查。
 */

import { reduce, type MapTopology } from '../state/reduce.ts';
import type { Action } from '../state/actions.ts';
import type { GameState } from '../state/types.ts';
import { needsReseed, policyFor } from './policy.ts';

/** 这一条 action 之后，「日」是否推进了 —— 原版的重播种挂在日推进里（`0x41D06E`） */
function dayAdvanced(before: GameState, after: GameState): boolean {
  return after.day !== before.day || after.month !== before.month || after.year !== before.year;
}

/**
 * 施加一条 action，并在**日推进**之后按策略用 `seed` 重新播种（单机 = 原版 `0x41D06E`；
 * 联机策略下不重播种）。action 被拒（状态没变）时原样返回。
 */
export function reduceWithSeed(state: GameState, action: Action, topo: MapTopology, seed: number): GameState {
  const next = reduce(state, action, topo);
  if (next === state || !dayAdvanced(state, next)) return next;
  if (!needsReseed(policyFor(next.mode), 'turnAdvance')) return next;
  return reduce(next, { type: 'reseed', seed }, topo);
}

/** 从一份起点状态逐条重放一段轨迹；`onStep` 供调试时逐步观察 */
export function replayTrail(
  base: GameState,
  trail: readonly { action: Action; seed: number }[],
  topo: MapTopology,
  onStep?: (index: number, before: GameState, after: GameState) => void,
): GameState {
  let state = base;
  trail.forEach((e, i) => {
    const next = reduceWithSeed(state, e.action, topo, e.seed);
    onStep?.(i, state, next);
    state = next;
  });
  return state;
}
