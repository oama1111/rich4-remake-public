/*
 * 宿主侧的「重新播种」接线 —— 单机必须按原版三个时机 `srand(GetTickCount())`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版全程序只有 **3 处** `srand()`，种子都是 `GetTickCount()`：
 * | 地址 | 时机 |
 * |---|---|
 * | `0x0040170F` | 启动 |
 * | `0x00402FA1` | **读档之后** |
 * | `0x0041D06E` | **每回合**（日推进里，紧挨行情更新之前）|
 *
 * core 是纯函数、读不到时钟，所以这三个时机**必须由宿主注入**
 * （`rng/policy.ts` 的 `SINGLE_PLAYER_POLICY.reseedOn` 就是这份契约）。
 * ⚠️ 2026-09-19 之前**没有任何宿主接线**：读档后 `rngState` 要么沿用存档里的值、
 * 要么是原版导入路径给的占位 `1` ⇒ 「反复读同一个档，骰子/股价每次都一样」，
 * 与原版「读档重开刷结果」的体感相反。本模块补上这一环。
 *
 * ⚠️ 联机策略（`MULTIPLAYER_POLICY.reseedOn = ['gameStart']`）下这两个函数都是**空操作**
 * —— 联机局面由服务器定序，本机不得自己重播种。
 */

import { reduce, policyFor, needsReseed, type Action, type GameState } from '@rich4/core';
import type { MapTopology } from '@rich4/core';

/** 宿主时钟种子 —— 对应原版的 `GetTickCount()`（取正 31 位，与原版一致）。 */
export function clockSeed(now: number = Date.now()): number {
  return (now & 0x7fffffff) >>> 0;
}

/** 这一条 action 之后，「日」是否推进了 —— 原版的重播种挂在日推进里（`0x41D06E`） */
function dayAdvanced(before: GameState, after: GameState): boolean {
  return (
    after.day !== before.day ||
    after.month !== before.month ||
    after.year !== before.year
  );
}

/**
 * 施加一条 action，并在**日推进**之后按策略重新播种（单机 = 原版 `0x41D06E`）。
 *
 * @param seed 供测试注入固定种子；生产用默认的 `clockSeed()`
 */
export function reduceWithHostRng(
  state: GameState,
  action: Action,
  topo: MapTopology,
  seed: number = clockSeed(),
): GameState {
  const next = reduce(state, action, topo);
  if (next === state || !dayAdvanced(state, next)) return next;
  if (!needsReseed(policyFor(next.mode), 'turnAdvance')) return next;
  return reduce(next, { type: 'reseed', seed }, topo);
}

/**
 * 读档后重新播种（单机 = 原版 `0x402FA1`）。
 *
 * ★ 这就是「读档重开刷结果」：同一份存档读两次，之后的骰子/股价/事件都不一样。
 */
export function reseedAfterLoad(
  state: GameState,
  topo: MapTopology,
  seed: number = clockSeed(),
): GameState {
  if (!needsReseed(policyFor(state.mode), 'afterLoad')) return state;
  return reduce(state, { type: 'reseed', seed }, topo);
}
