/*
 * 游戏 tick 的节拍 —— 掷骰预动作 / 滚骰 / 走子，三段共用
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 棋盘由**多媒体定时器**驱动（VA 0x00402198）：
 * ```asm
 * call cs:[__imp__timeSetEvent]      ; timeSetEvent(20, 5, 0x401f98, 0, TIME_PERIODIC)
 * ```                                        ; → 20 ms 一帧 = 50 Hz
 *
 * 每次渲染里判一次「这一帧要不要走一次游戏 tick」（VA 0x00401fad）：
 * ```asm
 * al = byte [0x497158]            ; cfg[0] = RICH4.CFG offset 0 = game speed
 * al = byte [eax + 0x46cb20]      ; ★ 分频表 [6, 4, 2, 0]
 * [0x46cb23]++                    ; 渲染计数器
 * if ([0x46cb23] >= al) { [0x46cb23] = 0 ; [0x46cafa] = 1 }
 * ```
 * 主循环 `if ([0x46cafa]) fcn_0040d7c4()`（VA 0x00401d88）—— 这就是**一次 tick**。
 * `cfg[0]` 的合法值是 0/1/2（`rich4_cfg.txt`：`game speed: 00,01,02`），
 * 无 CFG 文件时的初值是 **1**（VA 0x00411edc `mov byte [0x497158], 1`）。
 *
 * ★ **三段动画一律「1 帧 = 1 tick」**，原版没有任何独立的毫秒常量：
 *   骰子预动作 9 帧 = 9 tick、滚骰 36 帧 × 14 ms（FLIC 头自带）、走一格 N tick。
 */

/** 渲染周期（毫秒）@source `timeSetEvent(20, …)` VA 0x0040219a */
export const RENDER_MS = 20;

/**
 * 每多少**次渲染**才走一次游戏 tick，按 game speed 取。
 * @source VA 0x0046cb20
 */
export const TICK_DIVISOR: readonly number[] = [6, 4, 2, 0];

/**
 * 一次 tick 多少毫秒。
 *
 * ★ 表里的 `0` 不是「0 毫秒」而是「每一帧都 tick」（`cmp eax, edx` 里
 *   `edx` 至少为 1 时就会命中），故下限是 1 个渲染周期。
 */
export function tickMs(gameSpeed: number): number {
  const d = TICK_DIVISOR[Math.max(0, Math.min(TICK_DIVISOR.length - 1, gameSpeed))] ?? 2;
  return RENDER_MS * Math.max(1, d);
}
