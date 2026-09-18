/*
 * 搶奪卡（13）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：卡片本体 VA 0x00443e3d，
 *   效果在 `0x0044192a`。
 *
 * 效果函数 `0x44192a` 的返回值 ebx：**bit15 置位 → 道具路径**
 * （`and ebx,0x7fff` 后 `take_tool`(0x445aa2) + `give_tool`(0x445a4d)），
 * **否则 → 卡片路径**（`0x441343` 从对方手牌移除 + `0x4412e4` 给自己）。
 * 抢哪一个由模态选单（人类，`0x4018e7`）或 AI 参数（电脑，`0x41e6f2`）
 * 决定 —— 选择不进 core（C-ARC-2），由 target.steal 传入。
 */

import type { Player } from '../state/types.ts';
import type { CardTarget, TargetError } from './target.ts';
import { giveTool, takeTool, toolsOf } from '../rules/tools.ts';
import { MAX_HAND_CARDS } from '../rules/special-square.ts';
import { consumeCard } from './passive.ts';
import { CARDS } from '@rich4/data';

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

// ============================================================
//  卡片路径（T-003）
// ============================================================

/**
 * 卡片表里的价格（`0x47fdea` 每记录 `+5`，即 `0x47fdef + i*8`）。
 *
 * 三处用途：① 弃牌时比较贵贱（`0x0044128f`）；
 * ② 搶奪卡的敌意增量；③ **抽卡格尾部台词的条件**
 * （`0x0041b37b mov al,[ebx*8+0x47fdef]` → `0x0041b38c call 0x44f230`，
 * 后者只在 `50 < 价格 <= 100` 时 `call rand`）。
 */
export function priceOf(cardId: number): number {
  return CARDS.find((c) => c.id === cardId)?.price ?? 0;
}

/**
 * 给玩家一张卡（原版 `0x004412e4`）。
 *
 * 手牌满 15 张时先弃掉**价格最低**的一张再收入
 * （`0x44128f`：`cmp ebx, eax / jle 跳过` —— 严格更小才替换，
 * 同价时保留**槽位靠前**者；本引擎手牌是紧凑数组，槽位序 = 数组序）。
 * 随后写入第一个空槽（紧凑数组 = 末尾追加）。
 */
export function giveCard(player: Player, cardId: number): Player {
  const cards = [...player.cards];
  if (cards.length >= MAX_HAND_CARDS) {
    let cheapest = 0;
    for (let i = 1; i < cards.length; i++) {
      if (priceOf(cards[i]!) < priceOf(cards[cheapest]!)) cheapest = i;
    }
    cards.splice(cheapest, 1);
  }
  cards.push(cardId);
  return { ...player, cards };
}

export interface RobCardResult {
  ok: boolean;
  error: TargetError | 'nothingToRob' | null;
  players: Player[];
  /** 实际抢到的卡号；没抢到为 0 */
  robbed: number;
}

/**
 * 搶奪卡的**卡片路径**：从目标手牌抢一张卡。
 *
 * @source 0x441ae2：`push 卡号 / push 目标 / call 0x441343`（移除一张）
 *   然后 `push 卡号 / push 自己 / call 0x4412e4`（收入，满手先弃最便宜）。
 *   AI（`[eax+0x496b7d] != 1`）恒走此路径（`[0x48be5c]` = 卡号）。
 *
 * 牌堆计数不变：0x441343 对 `[卡号+0x499197]` +1、0x4412e4 −1，净额为零。
 */
export function applyRobCardCard(
  players: readonly Player[],
  currentPlayer: number,
  targetIndex: number,
  cardId: number,
): RobCardResult {
  const fail = (error: TargetError | 'nothingToRob'): RobCardResult => ({
    ok: false,
    error,
    players: [...players],
    robbed: 0,
  });

  if (targetIndex < 0 || targetIndex >= players.length) return fail('playerOutOfRange');
  if (targetIndex === currentPlayer) return fail('cannotTargetSelf');

  const victim = players[targetIndex]!;
  if (!victim.cards.includes(cardId)) return fail('nothingToRob');

  const taken = players.map((p, i) => (i === targetIndex ? consumeCard(p, cardId) : p));
  const given = giveCard(taken[currentPlayer]!, cardId);

  return {
    ok: true,
    error: null,
    players: taken.map((p, i) => (i === currentPlayer ? given : p)),
    robbed: cardId,
  };
}

/** 目标手牌 —— 供 UI/AI 出选单（原版选单列的就是 0x499120 手牌槽） */
export function robbableCards(players: readonly Player[], target: number): number[] {
  return [...(players[target]?.cards ?? [])];
}
