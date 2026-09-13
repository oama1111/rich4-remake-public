/*
 * 随机数播种策略 —— 单机保真 vs 联机确定性
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 设计要点：把「重新播种」表达为 action 流中的一条**显式 action**，
 * 而不是让引擎去读挂钟。由此同时满足两个看似矛盾的目标：
 *
 *   1. 单机完全复刻原版行为（含"读档重开刷结果"）；
 *   2. 联机严格确定性（C-DET-4），支持断线重连与反作弊；
 *   3. **两种模式下引擎都是纯函数** —— 因为非确定性被捕获成了
 *      action 日志里的数据，单机局同样可以完整回放。
 */

import type { WatcomRng } from './watcom.ts';

/** 对局模式 */
export type GameMode = 'single' | 'multiplayer';

/**
 * 原版重新播种的三个时机。
 * @source 全二进制扫描确认原版恰好 3 处 srand()，全部以 GetTickCount() 为种子：
 *   - 0x0040170F  asm/rich4_initialize.asm:146        游戏启动
 *   - 0x00402FA1  asm/rich4_save_files.asm:507        读档之后
 *   - 0x0041D06E  asm/rich4_player_core_actions.asm:4830  回合推进
 */
export type ReseedOccasion = 'gameStart' | 'afterLoad' | 'turnAdvance';

export interface RngPolicy {
  /**
   * 存档是否写入 PRNG 状态。
   * - `false`（单机）：读档后重新播种 → **保留原版的"读档重开刷结果"**
   * - `true`（联机）：快照精确恢复随机状态 → 断线重连不产生分歧
   */
  readonly persistRngState: boolean;
  /** 哪些时机需要宿主注入 reseed action */
  readonly reseedOn: readonly ReseedOccasion[];
}

/**
 * 单机策略 —— **与原版逐点一致，零偏离**。
 * 三个播种时机与原版相同，存档不含 PRNG 状态，故读档重开可刷结果。
 */
export const SINGLE_PLAYER_POLICY: RngPolicy = {
  persistRngState: false,
  reseedOn: ['gameStart', 'afterLoad', 'turnAdvance'],
};

/**
 * 联机策略 —— 仅开局播一次种，此后永不重播。
 *
 * 联机模式**没有「读档」这个动作**：中途重连走的是服务器下发的完整状态快照
 * （含 PRNG 状态），那是重同步而非读档，因此不存在"刷结果"的可能。
 * 开局种子由服务器生成并记录，用于赛后回放与争议复核。
 */
export const MULTIPLAYER_POLICY: RngPolicy = {
  persistRngState: true,
  reseedOn: ['gameStart'],
};

export function policyFor(mode: GameMode): RngPolicy {
  return mode === 'single' ? SINGLE_PLAYER_POLICY : MULTIPLAYER_POLICY;
}

/** 该模式下，此刻是否需要宿主注入一条 reseed action */
export function needsReseed(policy: RngPolicy, occasion: ReseedOccasion): boolean {
  return policy.reseedOn.includes(occasion);
}

/**
 * 存档中的 PRNG 表示。
 * 单机存档里 `rngState` 为 `null`，读档时由宿主注入新种子。
 */
export interface RngSaveData {
  readonly rngState: number | null;
}

/** 按策略把 PRNG 状态写入存档 */
export function serializeRng(rng: WatcomRng, policy: RngPolicy): RngSaveData {
  return { rngState: policy.persistRngState ? rng.getState() : null };
}

/**
 * 按策略从存档恢复 PRNG。
 *
 * @param freshSeed 宿主提供的新种子。仅在存档未携带 PRNG 状态时使用
 *                  （单机读档场景，对应原版的 `srand(GetTickCount())`）。
 * @returns 是否使用了新种子（true = 发生了重新播种，即"可刷结果"）
 */
export function deserializeRng(
  rng: WatcomRng,
  saved: RngSaveData,
  freshSeed: number,
): boolean {
  if (saved.rngState === null) {
    rng.seed(freshSeed);
    return true;
  }
  rng.setState(saved.rngState);
  return false;
}
