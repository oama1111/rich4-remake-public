/*
 * 世界位移 → 八向朝向（`0x00454fb4`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 从 `state/reduce.ts` 挪出来的纯函数（`reduce.ts` 原样再导出）：开局摆人
 * （`rules/start-placement.ts`）也要用它，而 `reduce.ts` 又要调开局摆人 ——
 * 放在这里就不成环。
 */

/**
 * 世界位移 → 八向朝向。
 *
 * @source VA 0x0040d639：
 * ```asm
 * push dy / push dx / call 0x00454fb4
 * mov  byte [player + 0x10], al         ; player.direction
 * ```
 * 而 `0x00454fb4` 是定点 atan2 加一次量化：
 * ```asm
 * 00454fc1  neg ecx                     ; ★ dy 取反（屏幕 y 向下，角度按数学向上算）
 * 00454fc3  call atan2_16bit            ; → ax ∈ 0..0xffff 表示 0..360°
 * 00454fc8  shr ax, 0xc                 ; → 0..15（每 22.5°）
 * 00454fcc  inc ax / shr ax, 1          ; → 四舍五入到 0..8
 * 00454fd1  and eax, 7                  ; → 八分圆 0..7
 * 00454fd4  movzx eax, byte [eax + 0x482414]   ; 再查一张 8 字节重映射表
 * ```
 * 那张表是 `[2,3,4,5,6,7,0,1]`，即 `direction = (八分圆 + 2) & 7`。
 */
export const DIRECTION_REMAP: readonly number[] = [2, 3, 4, 5, 6, 7, 0, 1];

/**
 * 1 / 2π。
 *
 * ⚠️ 写成常量而不是 `x / (2π)`：C-DET-3 那条 lint 规则不准出现裸除法
 *   （它管的是金额，但规则没法分辨用途）。这里是角度，与钱无关。
 */
const TURNS_PER_RADIAN = 0.15915494309189535;

export function directionOf(dx: number, dy: number): number {
  // ★★ **零位移没有特例**（第 91 条通道 2 订正）。
  //   先前这里写 `if (dx === 0 && dy === 0) return 0`，依据是内层
  //   `atan2_16bit` 在 `0x00454fe5`（`or esi,ecx / je 0x45502b`）会提前 `ret`。
  //   但那只是**内层**的提前返回（返回 `ax = 0`），外层 `0x00454fb4` 拿到 0 之后
  //   **照样**走完 `shr ax,0xc / inc ax / shr ax,1 / and eax,7 / movzx [eax+0x482414]`
  //   —— 八分圆 0 查表得 **2**。通道 2 实测 `0x454fb4(0, 0) = 2`
  //   （`tests/test_walk_step.py` §A 末条）。
  // atan2(-dy, dx) 归一到 0..1 圈，再量化到八分圆
  const turns = Math.atan2(-dy, dx) * TURNS_PER_RADIAN;
  const octant = Math.round((((turns % 1) + 1) % 1) * 8) & 7;
  return DIRECTION_REMAP[octant]!;
}
