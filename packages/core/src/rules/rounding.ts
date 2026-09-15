/*
 * 原版的浮点取整辅助 —— `__round_toward_zero`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这是**全项目唯一**的一份「原版 x87 取整」实现。
 *   `percentage.ts` / `rent.ts` / `auction.ts` / `places/*` 等凡是
 *   反汇编里出现 `call 0x00457dbc` 的地方，都必须调它，不许各自再写一份。
 *
 * @source VA 0x00457dbc（`rich4_misc_util.asm` 的 `__round_toward_zero`）：
 * ```asm
 * 00457dbc  push     eax
 * 00457dbd  wait
 * 00457dbe  fnstcw   word ptr [esp]        ; 取当前 x87 控制字
 * 00457dc1  wait
 * 00457dc2  push     dword ptr [esp]       ; 复制一份（低 16 位是 CW）
 * 00457dc5  mov      byte ptr [esp + 1], 0x1f   ; ★ 高字节 = 0x1f
 * 00457dca  fldcw    word ptr [esp]        ; 装回：CW = 0x1fXX
 * 00457dcd  frndint                        ; 按 RC 取整
 * 00457dcf  fldcw    word ptr [esp + 4]    ; 还原原来的 CW
 * 00457dd3  wait
 * 00457dd4  lea      esp, [esp + 8]
 * 00457dd8  ret
 * ```
 *
 * x87 控制字（CW）的 bit10-11 是 RC（舍入控制）：
 * - `00` = 就近取偶（IEEE 默认，也是 DOS/Watcom 进程启动时的初值 `0x037f`）
 * - `01` = 向下（−∞）
 * - `10` = 向上（+∞）
 * - `11` = **向零**
 *
 * 这里只改高字节 ⇒ CW = `0x1f7f`：bit10-11 = `11` = **向零**，
 * bit8-9（PC，精度控制）仍为 `11` = 扩展精度，bit0-5 的异常屏蔽位不动。
 * 所以 `frndint` 是**向零截断**，不是就近取偶：
 * `1.5 → 1`、`2.5 → 2`、`1498.5 → 1498`、`−2.5 → −2`。
 *
 * ⚠️ 曾经的误读：T-034 那一轮把 0x457dbc 当成「x87 就近取偶
 *   （banker's rounding）」，于是 `percentage.ts` 写了 `x87Round`。
 *   两者在**恰好 .5** 时差 1（如现金 150 的 5% 所得税：7.5 → 截断 7
 *   vs 就近取偶 8），已按 exe 订正。见 `docs/deviations/Q-NUM-1.md`。
 *
 * ⚠️ 调用点后面通常紧跟 `fistp dword [..]`。`fistp` 用的是**已还原**的
 *   控制字（就近取偶），但此时 st(0) 已被 `frndint` 变成整数，故 `fistp`
 *   是精确的，不引入第二次取整。
 *
 * ⚠️ 89 个 `call 0x457dbc` 调用点里绝大多数是 UI 坐标 / 股价 / 小游戏一类，
 *   与 core 的规则无关；与本仓库规则模块对应的只有下面这些（详见 Q-NUM-1）：
 *   - 0x00449cfa 所得稅 = trunc(现金 × 0.05)
 *   - 0x00449f28 地價稅 = trunc(地产原值 × 0.05) × 物价指数
 *   - 0x0044a122 證交稅 = trunc(持股市值 × 0.05) × 物价指数
 *   - 0x0044af50 儲金紅利 = trunc(存款 × 0.1)
 *   - 0x00419f84 同盟分账 = trunc(实付总额 × (同盟份/总额)单精度)
 *   - 0x0041c383 強盜搶銀行 = trunc(存款 × 0.2)
 *   - 0x0042bc9a 企業紅利 = trunc(累積盈餘 × (持股/总持股)单精度)
 *   - 0x00425f2c 股票挂牌市價 = trunc(股數 × 現價)
 *   - 0x00428b77 挂牌股票单价判据 = trunc(挂牌总价 / 股数)
 *   - 0x0043be74 / 0x0043bfb8 拍賣起拍价 = trunc(地价 × (1 + 等级×0.5))
 *   - 0x00439ff7 / 0x0043a032 / 0x0043a0dd / 0x0043a118 拍賣 AI 心理价位
 *   - 0x0041d7e6 / 0x0041d84c 电脑买地保留额 = trunc(开局资金 × 0.05)
 *   - 0x00449668 / 0x0044970e 新聞地價 ×1.3、0x0044a3a8 地價 ×0.7
 */

/**
 * 原版 `__round_toward_zero` 的等价实现：**向零截断**。
 *
 * 对非负数就是 `Math.floor`，对负数就是 `Math.ceil`；统一下来即 `Math.trunc`。
 * ⚠️ **不要**换成 `Math.round`（.5 差 1）或 `Math.floor`（负数差 1）。
 *
 * @source VA 0x00457dbc（判据见本文件头部）
 */
export function truncTowardZero(v: number): number {
  return Math.trunc(v);
}
