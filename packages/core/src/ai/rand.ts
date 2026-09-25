/*
 * AI 决策里的随机数来源
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 2026-09-25 审计（FU-2 / D-004 / D-007）：原版电脑那一支的随机数**全部走全局 `rand()`**
 *   （`call 0x456f2d`）—— 出牌主循环的起点、個性闸门的 `%3`、每张卡/每件道具判定函数里的
 *   `%4` / `%n` / 前瞻岔路、骰子数的 `&1` …。本引擎把这些决策放在**纯函数**策略层
 *   （C-DET-1：策略层不碰全局状态），于是先前统一用 `aiRoll` 的**确定性替身**：
 *   由 `rngState` 与一个盐派生，答案固定但**不推进随机序列** ⇒ 电脑回合之后随机流与原版不同步。
 *
 *   现在策略层的每一次 `rand()` 都问这里：**有真随机流就用它**（调用方 —— 客户端 / 服务器 /
 *   reducer —— 用 `WatcomRng` 现掷并把末态写回 `state.rngState`），没有（直接单测某个判定函数）
 *   才退回替身。替身只服务单测：生产路径的两个调用点与 reducer 的补掷都必传 `roll`。
 */

import type { GameState } from '../state/types.ts';

/**
 * 一个 `rand()` 提供者：每次调用返回一个 32 位无符号随机数并**推进**它自己的流。
 *
 * 生产路径上它是 `WatcomRng.next` 的包装（流从 `state.rngState` 播种、掷完写回），
 * 于是「策略层问一次 = 原版 `call 0x456f2d` 一次」。
 */
export type AiRoll = () => number;

/**
 * 纯策略层的 `rand() % n` 替身：由 `rngState` 与一个盐派生，同一状态同一问题答案固定。
 *
 * ⚠️ 只有**直接单测策略函数**（不给 `roll`）时才走它；它不推进任何序列。
 */
export function aiRoll(state: GameState, salt: number, n: number): number {
  if (n <= 0) return 0;
  return (((state.rngState >>> 0) ^ (Math.imul(salt, 0x9e3779b1) >>> 0)) >>> 0) % n;
}

/**
 * 策略层的一次 `rand() % n`。
 *
 * `n <= 0` 时**不掷**也返回 0（原版这里会 `idiv 0` 崩，各调用点都已先判非空，
 * 保留护栏只为让分支与旧实现逐字一致）。
 *
 * @param salt 那次 `call rand` 的 VA —— 只在退回替身时用作盐（便于单测定位是哪个判定点）
 */
export function aiRand(state: GameState, roll: AiRoll | undefined, salt: number, n: number): number {
  if (n <= 0) return 0;
  if (roll !== undefined) return roll() % n;
  return aiRoll(state, salt, n);
}
