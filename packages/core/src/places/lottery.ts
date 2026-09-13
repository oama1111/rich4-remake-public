/*
 * 樂透
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：
 *   落点入口   VA 0x004315cc
 *   号码表     [0x004990b8]，36 项
 *   破产释放   VA 0x0040d1aa
 *   开奖前统计 VA 0x00430b07
 */

import type { Player } from '../state/types.ts';

/**
 * 号码总数。
 * @source 三处独立的循环上界都是 `cmp eax, 0x24 / jge`（36）：
 *   买号 VA 0x004316b1、破产释放 0x0040d1a3、开奖统计 0x00430b08。
 */
export const LOTTERY_NUMBERS = 0x24;

/**
 * 票价。
 * @source AI 分支 `cmp dword [player + 0x1c], 0x3e8`（VA 0x0043169e）
 *   与随后的 `sub dword [player + 0x1c], 0x3e8`（0x004316f6）。
 *
 * ⚠️ **不乘物价指数**——这两条都是与立即数直接比较/相减，
 * 中间没有 `imul [0x4990e8]`。与买地、过路费都不同，照搬。
 */
export const LOTTERY_TICKET_PRICE = 0x3e8;

/**
 * 每人可持号上限。
 * @source 开奖前 VA 0x00430b2a 起对各玩家的持号数逐个
 *   `cmp byte [...], 0xa / ja` —— 超过 10 就走另一条分支。
 *
 * ⚠️ 「超过 10 之后发生什么」尚未确认（0x00430b52 分支未解），
 * 故本模块只把它当作**购买上限**，不臆测别的后果。
 */
export const LOTTERY_MAX_PER_PLAYER = 10;

/**
 * 号码表：下标 = 号码（0..35），值 = **持有者下标 + 1**，0 表示未售出。
 *
 * @source 破产释放（VA 0x0040d1aa）逐项比对 `player + 1` 并清零，
 *   证实存的就是「玩家下标 + 1」这一编码——与地块 owner 同制。
 */
export type LotteryTable = number[];

export function emptyLottery(): LotteryTable {
  return new Array<number>(LOTTERY_NUMBERS).fill(0);
}

/** 尚未售出的号码 */
export function availableNumbers(t: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOTTERY_NUMBERS; i++) {
    if ((t[i] ?? 0) === 0) out.push(i);
  }
  return out;
}

/** 某人持有的号码 */
export function numbersOf(t: readonly number[], player: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOTTERY_NUMBERS; i++) {
    if (t[i] === player + 1) out.push(i);
  }
  return out;
}

export type BuyFailure =
  | 'taken'
  | 'outOfRange'
  | 'notEnoughCash'
  | 'tooMany';

export interface BuyResult {
  ok: boolean;
  reason: BuyFailure | null;
  player: Player;
  lottery: LotteryTable;
}

/**
 * 买一个号码。
 *
 * @source AI 分支（VA 0x0043169e 起）：
 * ```asm
 * cmp dword [player + 0x1c], 0x3e8    ; ★ 与**现金**比较
 * …收集未售出的号码到 buf，共 ebx 个
 * test ebx, ebx / je 结束              ; 全卖光了就算了
 * call rand / idiv ebx                 ; 随机挑一个
 * …
 * sub dword [player + 0x1c], 0x3e8     ; ★ 直接扣现金
 * ```
 *
 * ★ 与买地一样是**就地扣现金**，不走 pay_money，故没有存款级联、
 *   不会触发破产（对比 rules/purchase.ts 与 rules/payment.ts）。
 *
 * ⚠️ 号码由调用方给出。AI 走的是「在未售出的号码里随机挑一个」，
 *   那属于策略而非规则，放在 ai/ 而不是这里。
 */
export function buyTicket(
  player: Player,
  lottery: readonly number[],
  n: number,
): BuyResult {
  const fail = (reason: BuyFailure): BuyResult => ({
    ok: false,
    reason,
    player,
    lottery: [...lottery],
  });

  if (!Number.isInteger(n) || n < 0 || n >= LOTTERY_NUMBERS) return fail('outOfRange');
  if ((lottery[n] ?? 0) !== 0) return fail('taken');
  if (numbersOf(lottery, player.index).length >= LOTTERY_MAX_PER_PLAYER) return fail('tooMany');
  // @source cmp dword [player+0x1c], 0x3e8 —— 只看现金
  if (player.cash < LOTTERY_TICKET_PRICE) return fail('notEnoughCash');

  const next = [...lottery];
  next[n] = player.index + 1;
  return {
    ok: true,
    reason: null,
    // @source sub dword [player + 0x1c], 0x3e8
    player: { ...player, cash: player.cash - LOTTERY_TICKET_PRICE },
    lottery: next,
  };
}

/**
 * 玩家破产时释放其名下全部号码。
 *
 * @source VA 0x0040d1a8：
 * ```asm
 * al = byte [i + 0x4990b8]
 * edx = player + 1
 * cmp eax, edx / jne 下一个
 * xor al, dl                    ; 相等 → 结果 0
 * byte [i + 0x4990b8] = al
 * ```
 * `xor al, dl` 在两者相等时恰好得 0——原版用异或代替赋零。
 */
export function releaseTickets(lottery: readonly number[], player: number): LotteryTable {
  return [...lottery].map((v) => (v === player + 1 ? 0 : v));
}

/**
 * ⚠️ **开奖与派彩尚未实现。**
 *
 * 已定位：开奖前（VA 0x00430b07）会统计各玩家持号数并逐个与 10 比较，
 * 但中奖号如何产生、奖金如何计算，位于 0x00430b52 之后尚未解开的分支里。
 *
 * 在解出来之前**不提供任何派彩函数**——与其编一个看似合理的公式，
 * 不如让调用方明确地发现这块还没做。
 */
export const LOTTERY_DRAW_UNIMPLEMENTED = true;
