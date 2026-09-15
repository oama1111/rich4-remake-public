/*
 * 字体栈 —— **全项目唯一一处**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 原版用的是什么字
 *
 * `_rich4_create_font`（VA 0x0044f9d8 尾）是这么建字体的：
 * ```asm
 * 0044fa64  mov eax, [esp + 8]     ; arg1 = 字号
 * 0044fa8c  neg eax                ; ★ 取负
 * 0044fa8e  push eax               ; → CreateFontA 的 cHeight
 * 0044fa8f  call dword cs:[0x46228c]   ; CreateFontA
 * ```
 * 其余几个 push 是 `CreateFontA` 的其它参数，其中两个关键值：
 * - 字体名（`pszFaceName`）在 `0x4660a0`，dump 出来是 **`細明體`**
 *   （bytes `b2 d3 a9 fa c5 e9`）；
 * - `iCharSet = 0x88` = `CHINESEBIG5_CHARSET`（繁体中文）。
 *
 * ★ **负的 `cHeight` 按 GDI 的规矩是 em 高度**（不是字符总高），
 *   所以 `create_font(n)` ↔ CSS `Npx` 是 **1:1** ——
 *   **所有字号一律照原版的数写，不要乘任何系数。**
 *
 * ## 为什么要用宋体系
 *
 * 实测（浏览器里 28px 画「1月」，量墨迹框与墨量）：
 *
 * | 字面 | 墨迹框 | 墨量（不透明像素数）|
 * |---|---|---|
 * | PingFang TC | 34×25 | 359 |
 * | Songti TC | 34×25 | 277 |
 * | LiSong Pro | 34×26 | 291 |
 *
 * **尺寸一模一样**，差的是**笔画粗细** —— PingFang 比宋体系粗约 30%。
 * 原版的細明體是宋体（衬线、笔画细），所以拿 PingFang 画会「看起来更大」。
 * 这一条是需求方 2026-09-15 报「月历的月份字好像太大」查出来的：
 * **不是字号问题，是字面问题。**
 */

/**
 * CJK 字体栈 —— **宋体系优先**（贴近原版的細明體），最后才落回系统无衬线。
 *
 * 顺序：macOS 的「宋体-繁」→ 通用 STSong → Windows 的細明體 / 新細明體 →
 * 兜底（Linux 上多半会落到无衬线，字形粗细会有差别，属可接受降级）。
 */
export const FONT_FAMILY =
  '"Songti TC", "STSong", "MingLiU", "PMingLiU", "PingFang TC", "Microsoft JhengHei", sans-serif';

/** 按字号取 `ctx.font` 串 */
export function font(size: number): string {
  return `${size}px ${FONT_FAMILY}`;
}

/** 加粗版（原版只有 `lfWeight`，少数几处标题用） */
export function boldFont(size: number): string {
  return `bold ${size}px ${FONT_FAMILY}`;
}
