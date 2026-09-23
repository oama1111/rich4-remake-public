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

// ============================================================
//  `_rich4_create_font` 的第 4 / 5 参 —— 字效（阴影 / 描边 / 粗体）与字距
// ============================================================

/**
 * 原版一次 `create_font(字号, 前景, 第二色, 字效, 字距)` 建出来的那套样式。
 *
 * @source `_rich4_create_font`（VA 0x0044f9d8）+ `rich4_draw_text`（VA 0x0044fabc）：
 * ```asm
 * 0044fa01  [0x4762e0] = 前景（BGR 换位）          ; 正文色
 * 0044fa27  [0x4762e4] = 第二色                    ; 阴影 / 描边色
 * 0044fa31  [0x4762d8] = 字效    0044fa36  [0x4762dc] = 字距
 * 0044fa3f  test byte [esp+0x14], 2 / je → ebx = 0x190 ; ★ bit1 = 粗体：lfWeight 0x2bc(700) / 0x190(400)
 * ; —— draw_text ——
 * 0044fb82  SetBkMode(dc, 1)  0044fb93  SetTextCharacterExtra(dc, 字距 − 1)
 * 0044fc31  test dh, 1 / je 0x44fccc          ; ★ bit0 = 阴影：第二色在 (+1,+1) 画**一遍**（0x44fc56 两个 1）
 * 0044fccc  test dh, 4 / je 0x44fe09          ; ★ bit2（且 bit0 没置）= 描边：第二色画四遍
 *                                             ;   (1,0) 0x44fd54 / (1,2) 0x44fd82 / (0,1) 0x44fdb3 / (2,1) 0x44fddd
 * 0044fe09  SetTextColor(前景)
 * 0044fe1e  test byte [0x4762d8], 4 / je → 正文偏移 (0,0)；置了 → (+1,+1)   ; 描边那一支正文居中在四遍里
 * ```
 * 本引擎用这一个助手把各屏的字效统一照这张表画，不再各自「描 3 px 黑边」。
 */
export interface GdiTextStyle {
  /** 字号（`create_font` 第 1 参，= CSS px）*/
  size: number;
  /** 正文色（第 2 参）*/
  color: string;
  /** 阴影 / 描边色（第 3 参）*/
  color2: string;
  /** 字效（第 4 参）：bit0 阴影、bit1 粗体、bit2 描边 */
  flags: number;
  /** 字距（第 5 参）；`SetTextCharacterExtra(字距 − 1)`，缺省 1 = 不加 */
  spacing?: number;
}

export const GDI_SHADOW = 1;
export const GDI_BOLD = 2;
export const GDI_OUTLINE = 4;

/** 这一套样式的 `ctx.font` 串（bit1 = 粗体）*/
export function gdiFont(s: GdiTextStyle): string {
  return `${(s.flags & GDI_BOLD) !== 0 ? 'bold ' : ''}${s.size}px ${FONT_FAMILY}`;
}

/**
 * 这一套样式在 (x, y) 要落的每一遍 `fillText`（先画的在前）—— 纯函数，单测钉住。
 * `dx/dy` 是相对 (x, y) 的偏移；`second` = 用第二色。
 */
export function gdiPasses(flags: number): { dx: number; dy: number; second: boolean }[] {
  const passes: { dx: number; dy: number; second: boolean }[] = [];
  if ((flags & GDI_SHADOW) !== 0) {
    passes.push({ dx: 1, dy: 1, second: true });
  } else if ((flags & GDI_OUTLINE) !== 0) {
    for (const [dx, dy] of [
      [1, 0],
      [1, 2],
      [0, 1],
      [2, 1],
    ] as const)
      passes.push({ dx, dy, second: true });
  }
  const main = (flags & GDI_OUTLINE) !== 0 ? 1 : 0;
  passes.push({ dx: main, dy: main, second: false });
  return passes;
}

/**
 * 按原版字效画一行字（`textAlign` / `textBaseline` 由调用方先设好）。
 * `ctx.font` 会被改成这套样式；字距用 `letterSpacing`（浏览器不支持时静默忽略）。
 */
export function drawGdiText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  s: GdiTextStyle,
): void {
  ctx.font = gdiFont(s);
  const extra = (s.spacing ?? 1) - 1;
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (extra !== 0 && 'letterSpacing' in spaced) spaced.letterSpacing = `${extra}px`;
  for (const p of gdiPasses(s.flags)) {
    ctx.fillStyle = p.second ? s.color2 : s.color;
    ctx.fillText(text, x + p.dx, y + p.dy);
  }
  if (extra !== 0 && 'letterSpacing' in spaced) spaced.letterSpacing = '0px';
}

/**
 * 框模板通用的那一句 `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)` —— 16 号、米白、**粗体 + 右下 1 px 阴影**。
 * @source 询问框 0x00440bbf、訊息框 0x00440d16、神明老虎机 0x0044073a、转盘 0x0044094e、
 *   設施选择 0x00440ac2、嫁禍选人 0x00440f10、研究所 0x004410fd、亮牌 0x00441fa1（八处逐字节同参）
 */
export const BOX_TEXT_STYLE: GdiTextStyle = { size: 0x10, color: '#f0f0f0', color2: '#101010', flags: 3, spacing: 1 };

/**
 * 各屏柜台人员 / 主持人的字框（`fcn_0044ec30` 开框 + `fcn_0044ecb6` 写字）那一句 `create_font`：
 * @source `0x0044ed4d mov ebx, [0x48c628]`（开框第 7 参 = 第二色）→ `test ebx, ebx` →
 *   非 0：`push 1 / push 3`（粗体 + 阴影）；为 0：`0x0044ed65 push 1 / push 2`（**只粗体**）→ `push 0x14` → `call 0x44f9d8`。
 *   正文色 = 开框第 6 参（`[0x48c61c]`）。19 处开框里只有魔法屋（`0x00432575 push 0x202020 / push 0xe0e0e0`）
 *   带第二色，其余全是 `push 0 / push 0x101010` ⇒ 20 号深色粗体、无阴影。
 */
export function clerkTextStyle(color = '#101010', color2: string | null = null): GdiTextStyle {
  return color2 === null
    ? { size: 0x14, color, color2: '#000000', flags: 2, spacing: 1 }
    : { size: 0x14, color, color2, flags: 3, spacing: 1 };
}
