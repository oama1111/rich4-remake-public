/*
 * 搶奪卡（13）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：卡片本体 VA 0x00443e3d，
 *   效果在 `0x0044192a`。
 *
 * 该函数里成对出现 `take_tool`(0x00445aa2) 与 `give_tool`(0x00445a4d)，
 * 且含模态消息循环 `0x004018e7`——**抢的是道具**，
 * 抢哪一个由一个交互界面选定。
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { giveTool, takeTool, toolsOf } from '../rules/tools.ts';

export interface RobResult {
  ok: boolean;
  error: TargetError | 'nothingToRob' | null;
  tools: number[];
  stock: number[];
  /** 实际抢到的道具编号；没抢到为 0 */
  robbed: number;
}

/**
 * 使用搶奪卡：从目标手里抢一个道具。
 *
 * ★ 转移走的是 `take_tool` + `give_tool` 两步，而**不是**直接搬数字。
 *   这有实际后果：`take_tool` 会把库存 +1、`give_tool` 会 −1，
 *   净额不变；但若目标那种道具已有 9 个（上限），
 *   `give_tool` 会拒发——此时道具**凭空消失**。
 *   这是原版两个函数组合出来的行为，照搬。
 *
 * ⚠️ 抢哪一个由外部选择（原版是模态 UI `0x004018e7`），
 *   按 C-ARC-2 不进 core。
 *
 * @param toolId 要抢的道具编号，由 UI/AI 给出
 */
export function applyRobCard(
  players: readonly Player[],
  currentPlayer: number,
  target: CardTarget,
  tools: readonly number[],
  stock: readonly number[],
  toolId: number,
): RobResult {
  const fail = (error: TargetError | 'nothingToRob'): RobResult => ({
    ok: false,
    error,
    tools: [...tools],
    stock: [...stock],
    robbed: 0,
  });

  if (target.kind !== 'player') return fail('wrongTargetKind');
  if (target.index < 0 || target.index >= players.length) return fail('playerOutOfRange');
  if (target.index === currentPlayer) return fail('cannotTargetSelf');

  const taken = takeTool(tools, stock, target.index, toolId);
  if (!taken.given) return fail('nothingToRob');

  const given = giveTool(taken.tools, taken.stock, currentPlayer, toolId);

  return {
    ok: true,
    error: null,
    tools: given.tools,
    stock: given.stock,
    robbed: toolId,
  };
}

/** 目标身上可抢的道具编号 —— 供 UI/AI 出选单 */
export function robbableTools(tools: readonly number[], target: number): number[] {
  return [...toolsOf(tools, target).keys()].sort((a, b) => a - b);
}
