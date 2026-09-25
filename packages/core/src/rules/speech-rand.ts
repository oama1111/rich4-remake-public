/*
 * 「好消息」台词阶梯 `fcn_0044f230(玩家, 點數)` 的那一次 `rand()`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 台词本身归表现层（C-ARC-2），但其中一档**消耗全局随机数**，那一次是规则态：
 * ```asm
 * 0044f23f  cmp edx, 0x64 / jle 0x44f262     ; > 100 → 固定一句，无 rand
 * 0044f262  cmp edx, 0x32 / jle 0x44f292     ; ≤ 50 → 另一句，无 rand
 * 0044f280  call 0x456f2d / and eax, 1        ; ★ 50 < 點數 ≤ 100 才掷
 * ```
 * 调用点（6 个）：抽卡格 `0x0041b38c`、禮物 `0x0041b98b`、小偷拿禮物 `0x0041bafa`、福神 `0x0040ee46`、
 * 董事長贈禮 `0x0042ea23`、節日送卡 `0x00452753`。
 */

/** 这个點數会不会让 `0x44f230` 掷一次 `rand()` */
export function goodNewsSpeechDrawsRand(points: number): boolean {
  return points > 0x32 && points <= 0x64;
}
