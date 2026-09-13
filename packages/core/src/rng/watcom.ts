/*
 * 大富翁4 原版伪随机数生成器（位级精确复现）
 * Copyright (C) 2026  rich4-remake contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * 原版 rich4.exe 使用 Open Watcom C 运行时的 `rand()`，是一个线性同余生成器。
 *
 * @source Rich4/rich4.exe  VA 0x00456F2D (file offset 0x5632D)  —— 直接反汇编原始二进制确认
 *   imul edx, dword [eax], 0x41c64e6d   ; next *= 1103515245
 *   add  edx, 0x3039                    ; next += 12345
 *   mov  dword [eax], edx
 *   mov  eax, edx
 *   shr  eax, 0x10                      ; 逻辑右移 16 位
 *   and  eax, 0x7fff                    ; 取低 15 位
 *
 * ⚠️ 重要：不要参考 `rich4-re/asm/mscrt.ld` 的实现。该链接脚本把 `_libc_rand`
 *    重定向到了 msvcrt 的 rand（乘数 0x343FD、增量 0x269EC3），那是**完全不同的序列**。
 *    逆向项目构建出的 rich4_mscrt.exe 已无法复现原版随机序列。
 */

/** 乘数 1103515245 @source rich4.exe:0x00456F37 */
const MULTIPLIER = 0x41c64e6d;
/** 增量 12345 @source rich4.exe:0x00456F3D */
const INCREMENT = 0x3039;
/** RAND_MAX = 32767 @source rich4.exe:0x00456F4A (and eax, 0x7fff) */
export const RAND_MAX = 0x7fff;
/**
 * 原版 CRT 启动时把 __rand_next 初始化为 1
 * @source rich4.exe __initthread @ VA 0x0045C8E3: mov dword [ebx+0xc], 1
 */
const DEFAULT_SEED = 1;

/**
 * 原版 PRNG。状态是单个 uint32。
 *
 * 与原版的**有意偏离**（见 docs/known-deviations.md）：
 * 原版在 3 处调用 `srand(GetTickCount())`（启动、读档后、每回合推进），
 * 因此原版对局**本质上不可复现**。重制版为满足联机所需的确定性
 * （DEVELOPMENT_PLAN.md §5.2 C-DET-4），改为由外部显式注入种子、
 * 且不在回合中途重播种。PRNG **算法本身位级一致**，故概率分布
 * （含 `% 6` 的模偏差）与原版完全相同。
 */
export class WatcomRng {
  /** 内部状态，始终保持为 uint32 */
  #state: number;

  constructor(seed: number = DEFAULT_SEED) {
    this.#state = seed >>> 0;
  }

  /** 等价于原版 srand()。原版直接赋值，无任何变换。@source rich4.exe:0x00456F5D */
  seed(value: number): void {
    this.#state = value >>> 0;
  }

  /** 读出当前内部状态（用于存档/联机快照） */
  getState(): number {
    return this.#state;
  }

  /** 恢复内部状态（用于读档/断线重连） */
  setState(state: number): void {
    this.#state = state >>> 0;
  }

  /**
   * 等价于原版 rand()，返回 0..32767。
   * 用 Math.imul 做 32 位截断乘法（普通 * 会超出 2^53 丢精度）。
   */
  next(): number {
    this.#state = (Math.imul(this.#state, MULTIPLIER) + INCREMENT) >>> 0;
    return (this.#state >>> 16) & RAND_MAX;
  }

  /**
   * 原版惯例：`rand() % n`。
   *
   * ⚠️ **必须保留模偏差**。32768 不是大多数 n 的整数倍，原版没有做拒绝采样，
   * 因此低位取值出现频率略高。重制版若"修正"成无偏采样，概率分布就与原版不符，
   * 违反 C-FID-4（禁止改良）。
   *
   * @source 全二进制 183 处调用点的固定汇编签名：
   *   call _libc_rand / mov edx,eax / sar edx,0x1f / idiv <reg>  → edx = rand() % n
   */
  below(n: number): number {
    return this.next() % n;
  }
}

/**
 * 掷骰子。
 *
 * @source rich4.exe fcn_00419572 @ VA 0x00419572 (asm/rich4.asm:12275)
 *   —— 全程序唯一的掷骰路径，玩家与 AI 共用。
 *
 * @param rng        随机源
 * @param diceCount  玩家的骰子数 `ndices`（玩家结构 +0x12，取值 1..3）
 * @param forced     遥控骰子强制值（1..6）；0 表示未使用
 * @returns          各骰点数与总和
 *
 * 注意三点原版行为：
 *  1. 遥控骰子路径**完全不消耗 rand()**；
 *  2. 遥控骰子会把骰子数**强制压成 1**（即使玩家有 3 颗骰，用遥控也只走 1..6 步）；
 *  3. 多骰时按下标 0,1,2 **顺序**调用 rand()，消耗次数 = diceCount。
 */
export function rollDice(
  rng: WatcomRng,
  diceCount: number,
  forced = 0,
): { dice: number[]; sum: number } {
  let dice: number[];
  if (forced !== 0) {
    dice = [forced]; // ndices 被强制为 1
  } else {
    dice = [];
    for (let i = 0; i < diceCount; i++) {
      dice.push(rng.below(6) + 1); // rand() % 6 + 1
    }
  }
  let sum = 0;
  for (const d of dice) sum += d;
  return { dice, sum };
}

/**
 * 抽卡（牌袋算法）。
 *
 * 原版**不是** `rand() % 30`，而是按每种卡的剩余数量把卡 id 压进一个 128 字节缓冲区，
 * 再从中等概率抽一个 —— 即按剩余量加权。
 *
 * @source rich4.exe _rich4_player_receive_random_card @ VA 0x00441E12
 *         (asm/rich4_card_utils_2.asm:16-67)
 *
 * @param rng           随机源
 * @param remainAmounts 长度 30 的数组，remainAmounts[id] = 该种卡的剩余张数
 * @returns             卡片编号（**1 基**，即 id+1）；牌袋为空时返回 0
 */
export function drawRandomCard(rng: WatcomRng, remainAmounts: readonly number[]): number {
  const bag: number[] = [];
  for (let id = 0; id < remainAmounts.length; id++) {
    const amount = remainAmounts[id] ?? 0;
    for (let j = 0; j < amount; j++) bag.push(id);
  }
  if (bag.length === 0) return 0;
  const picked = bag[rng.below(bag.length)];
  return picked === undefined ? 0 : picked + 1;
}
