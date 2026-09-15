/*
 * 研究所選項目屏 —— T-040
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 業主停在自己的**研究所**（設施 type 4、等级 ≥ 1、没被查封）上时，落点结算收尾
 * （@source VA 0x0041b0b3..0x0041b109）弹这一屏；真人在这里挑一个研發項目，
 * 电脑不走屏、直接取「等级」那一档（@source 0x004411e7）。
 * 研发期固定 **5 天**（@source 0x004411fb `mov byte [設施+0x1e], 5`），规则在
 * `@rich4/core` 的 `rules/facility.ts`。
 *
 * ## 出处：两个函数（窗口过程 @source VA 0x0044101d，鼠标 @source VA 0x004402d7）
 *
 * ⚠️ 全 exe 只有**一处**调用 `fcn_0044101d`（`0x0041b109`），所以这一屏的样子
 *   可以穷举 —— 下面每一条都带 VA。
 *
 * ★★ **这一屏的图来自两份资源，别合并**：
 *   - **板与条** = `Data.mkf` **资源 517**（`read_mkf(Data.mkf, 0x205)`，加载点
 *     VA 0x00408072 尾），一个 30 张图的共享 UI 图集。原版把图集基址放在全局
 *     `[0x48bad8]`，于是「第几张」写成「基址 + 偏移」：`+0x48` → 第 **5** 张、
 *     `+0x60` → 第 **7** 张（记录表从基址 +12 起、每项 12 字节）。
 *   - **項目图标** = `Panel.mkf` **资源 11** 的第 **10..14** 张 ——
 *     循环里 `ebp` 是 `read_mkf(panel, 0xb)`（@source 0x004441040 处 `push 0xb`
 *     配 `[0x48a05c]`，0x00441051 `mov ebp, eax`）。
 *
 * | 是什么 | 图 | 落点（屏幕） | @source |
 * |---|---|---|---|
 * | 立绘板 = Data517 图 **5**（249×170，锚点 (123,101)）| 抠黑 | 锚点 **(220,140)** → 实落 (97,39) | 0x00441161 |
 * | 标题串（= 设施名「研究所」，flag 2 正中）| — | **(220,122)** | 0x00441169 起 |
 * | 五格条 = Data517 图 **7**（400×89，锚点 (0,0)）| 抠黑 | **(20,280)** | 0x00441196 |
 * | 項目图标 = Panel11 图 **10..14**（32×40 / 36×32 / 34×15 / 34×19 / 14×36，锚点 = 中心）| 抠黑 | 条内 (0x30+76k, 0x2c) → 屏 **(68+76k, 324)** | 0x004410a2 / 0x0044109c |
 * | 每格先**去色**一块 66×54 | — | 条内 (0x0f+76k, 0x11) → 屏 **(35+76k, 297)** | 0x004410cc 起 |
 * | 悬停黄框两道 | — | 外 (32+76r, 294) 71×59、内 (33+76r, 295) 69×57 | 0x004404a2 |
 * | 項目名（只在悬停时画，flag 2 正中）| — | **(220,154)** —— 在立绘板里、标题下面 | 0x0044045c |
 * | 命中框 | — | x∈[35,406]、y∈[297,351]，**格号 = (x−35)/76** | loc_00440377 |
 * | 选中在 **WM_LBUTTONUP**（`0x202`），右键（`0x205`）回 **−1** = 取消 | — | — | loc_0044062b / loc_00440669 |
 *
 * ★★ **五个項目是横着一排的**（条内 y 固定 0x2c，x = 0x30 + 0x4c·k），
 *   所以命中判据里 `ebx` 是 **x**、`row = (x−0x23)/0x4c`，
 *   而 `y∈[0x129,0x15f]` 只是「有没有落在这一条 54px 高的格子里」。
 *   两者严丝合缝：去色块在 (35+76k, 297) 的 66×54 —— **就是命中框**。
 *
 * ## 一条不能省的细节：去色
 *
 * 每个格子先把 **66×54** 的一块**去色**（@source `fcn_004553fe` VA 0x004553fe：
 * 逐像素 `L = (r+g+b+0x10) >> 2` 再写回），而且是在**图标画完之后**去色 ——
 * 所以图标也是灰的；悬停只靠黄框 + 立绘板里的名字，**没有彩色高亮**。
 * 去色还**跳过纯黑**（`or ax,ax / je`），也就是底图上原本透明的地方不变。
 * 本模块用 canvas 的 `saturation` 混合等价实现（只作用于非透明像素），
 * 细节见 `docs/deviations/T-040.md` 的 A-040-3。
 */

import type { PendingInteraction } from '@rich4/core';
import { RESEARCH_MIN_PROJECT, RESEARCH_MAX_PROJECT, researchTool } from '@rich4/core';
import { TOOLS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 立绘板与五格条所在的档案 @source `read_mkf(Data.mkf, 0x205)`（VA 0x00408072 尾）*/
export const RESEARCH_ARCHIVE: ArchiveName = 'Data.mkf';

/** 共享 UI 图集资源号 @source VA 0x00408072 起 `push 0x205` */
export const RESEARCH_RESOURCE = 0x205;

/** 立绘板 = 图集的第 5 张 @source 0x00441157 `add eax, 0x48`（0x48 = 12 + 12×5）*/
export const RESEARCH_TITLE_CHUNK = 5;

/** 五格条 = 图集的第 7 张 @source 0x0044117d 的 `+0x60`（0x60 = 12 + 12×7）*/
export const RESEARCH_STRIP_CHUNK = 7;

/** 項目图标所在的档案 @source 0x00441040 `push 0xb` 配 `[0x48a05c]`（= mkf_panel）*/
export const RESEARCH_ICON_ARCHIVE: ArchiveName = 'Panel.mkf';

/** 項目图标的资源号 @source 0x00441040 `push 0xb` */
export const RESEARCH_ICON_RESOURCE = 0x0b;

/**
 * 項目图标 = Panel 11 的第 **10..14** 张。
 * @source 0x004410a2 `lea edx,[ebx+0xa]` → 记录指针 = `基址 + 12 + 12*(项目下标+10)`
 *   （`ebx` 是 0 基的项目下标）→ 图号 = **项目下标 + 10**。
 */
export const RESEARCH_ICON_FIRST = 10;

/** 图标图的张数（= 項目上限 5）*/
export const RESEARCH_ICON_COUNT = RESEARCH_MAX_PROJECT;

/**
 * 这一屏哪些图要**抠黑**（= 原版走带透明的 `fcn_00456418` / `fcn_004562a5`，
 * 而不是不透明的 `fcn_00456280`）。逐图判定，别在调用点手写：
 *
 * | 图 | 原版用哪个 | 抠黑 |
 * |---|---|---|
 * | Data517 图 5 立绘板 | `fcn_00456418` @0x441161 | ✓（黑是板子轮廓外的背景）|
 * | Data517 图 7 五格条 | 先 `fcn_00456280` 拷进内层表面，再整体 `fcn_00456418` @0x441196 | ✓（黑是外框与格间分隔）|
 * | Panel11 图 10..14 項目图标 | `fcn_004562a5` @0x4410bb | ✓（图标是黑底）|
 *
 * 表里没有的图（本屏用不到）一律不抠。
 */
export const RESEARCH_KEYED: readonly { archive: ArchiveName; resource: number; index: number }[] = [
  { archive: RESEARCH_ARCHIVE, resource: RESEARCH_RESOURCE, index: RESEARCH_TITLE_CHUNK },
  { archive: RESEARCH_ARCHIVE, resource: RESEARCH_RESOURCE, index: RESEARCH_STRIP_CHUNK },
  ...Array.from({ length: RESEARCH_ICON_COUNT }, (_, i) => ({
    archive: RESEARCH_ICON_ARCHIVE,
    resource: RESEARCH_ICON_RESOURCE,
    index: RESEARCH_ICON_FIRST + i,
  })),
];

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type ResearchSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 抠不抠黑由 `RESEARCH_KEYED` 说了算，别在各处手写 */
export function researchKeyed(archive: ArchiveName, resource: number, index: number): boolean {
  return RESEARCH_KEYED.some(
    (e) => e.archive === archive && e.resource === resource && e.index === index,
  );
}

function researchSprite(
  sprite: ResearchSprite,
  archive: ArchiveName,
  resource: number,
  index: number,
): Sprite | null {
  return sprite(archive, resource, index, researchKeyed(archive, resource, index));
}

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 行距 @source 0x00441094 `add esi, 0x4c`、`mov ebx, 0x4c` */
export const RESEARCH_STRIDE = 0x4c;

/** 五格条落点 @source 0x00441196 `draw_img_anchor(屏, 内层表面, 0x14, 0x118)` */
export const RESEARCH_STRIP_AT = { x: 0x14, y: 0x118 } as const;

/**
 * 条内（内层表面 = Data517 图 7，400×89 的局部坐标）：
 * - 图标落点 = `(0x30 + 0x4c·k, 0x2c)` —— @source 0x0044109c `push 0x2c` / `lea eax,[esi+0x21]`
 *   （`esi = 0xf + 0x4c·k`，故 x = 0x0f + 0x21 + 0x4c·k = 0x30 + 0x4c·k）
 * - 去色块 = `(0x0f + 0x4c·k, 0x11)` 66×54 —— @source 0x004410cc 起
 *   `fcn_004553fe(表面, esi, 0x11, 0x42, 0x36)`（签名 = (表面, x, y, 宽, 高)，见该函数序言）
 *
 * ★ 图标的锚点是**中心**，所以「落点」就是格子的中心 —— 5 个图标的中心同在
 *   y=0x2c=44，与去色块 (0x0f..0x51, 0x11..0x47) 的中心 (0x30, 0x2c) 完全重合。
 */
export const RESEARCH_ICON_LOCAL = { x: 0x30, y: 0x2c } as const;
export const RESEARCH_GRAY_LOCAL = { x: 0x0f, y: 0x11 } as const;

/** 去色块尺寸 @source 0x004410cc `push 0x36 / push 0x42`（= 66×54）*/
export const RESEARCH_GRAY_W = 0x42;
export const RESEARCH_GRAY_H = 0x36;

/** 立绘板锚点落点 @source 0x00441148 `push 0x8c` / `push 0xdc`（draw_img_anchor）*/
export const RESEARCH_TITLE_CHUNK_AT = { x: 0xdc, y: 0x8c } as const;

/** 标题串落点（flag 2 = 正中，故这是**文字块中心**）@source 0x00441169 起 */
export const RESEARCH_TITLE_AT = { x: 0xdc, y: 0x7a } as const;

/** 項目名落点（flag 2 = 正中）@source 0x0044045c 起 `push 2 / push 0x9a / push 0xdc` */
export const RESEARCH_NAME_AT = { x: 0xdc, y: 0x9a } as const;

/**
 * 悬停黄框：外框在 `(0x20 + 0x4c·r, 0x126)`、`0x47 × 0x3b`；
 * 内框在 `(0x21 + 0x4c·r, 0x127)`、`0x45 × 0x39`。
 * @source 0x004404a2：
 * ```asm
 * 004404a2  imul ebx, esi, 0x4c        ; ebx = 格号 × 76
 * 004404a5  add  ebx, 0x20             ; x = 0x20 + 76·r
 * 004404a8  draw_rect(表面, x, 0x126, 0x47, 0x3b, 0xffff00)
 * 004404c4  draw_rect(表面, x+1, 0x127, 0x45, 0x39, 0xffff00)
 * ```
 * 两道正好包住 66×54 的去色块（内框 69×57 ⊃ 66×54）。
 */
export const RESEARCH_HIGHLIGHT = {
  x0: 0x20,
  y0: 0x126,
  w: 0x47,
  h: 0x3b,
  /** 内框：x/y 各 +1、宽高各 −2 */
  inset: 1,
  color: '#ffff00',
} as const;

/** 命中框 @source `loc_00440377`：`cmp ebx,0x23 / jl`、`cmp ebx,0x196 / jg`、`cmp eax,0x129 / jl`、`cmp eax,0x15f / jg` */
export const RESEARCH_HIT = {
  x0: 0x23,
  x1: 0x196,
  y0: 0x129,
  y1: 0x15f,
} as const;

/** 字号 @source 0x004410fc `push 0x10`（`create_font` 的 arg1）*/
export const RESEARCH_FONT_SIZE = 0x10;
/** 字色 = 0xf0f0f0、描边 = 0x101010 @source 0x004410f1 起 */
export const RESEARCH_FILL = '#f0f0f0';
export const RESEARCH_OUTLINE = '#101010';

/**
 * 音效：换格悬停 / 确认。
 *
 * @source `loc_004403f5` 与 `loc_00440669` 都是
 *   `push 0 / push ref_0048231a|ref_00482322 / call rich4_play_sound_effect`，
 *   而 `play_sound_effect(ptr,k)` 取 `[ptr]` 当音效号 —— 两张表的头一个 word 分别是
 *   **0** 与 **1**（与 `audio.ts` 的 `SOUND_IDS.TITLE_HOVER` / `TITLE_CLICK` 同源）。
 */
export const RESEARCH_SOUND_HOVER = 0;
export const RESEARCH_SOUND_PICK = 1;

/** 图标图本身的最大尺寸（Panel11 图 10..14 里最宽 36、最高 40）—— 只用于 `researchOptionRect` */
export const RESEARCH_ICON_W = 36;
export const RESEARCH_ICON_H = 40;

// ============================================================
//  純函数
// ============================================================

/** 待决交互必须是这一屏的 @source `pending.kind === 'research'` */
export function isResearchPending(
  pending: PendingInteraction | null | undefined,
): pending is Extract<PendingInteraction, { kind: 'research' }> {
  return pending !== null && pending !== undefined && pending.kind === 'research';
}

/** 一个項目 */
export interface ResearchOption {
  /** 項目号 1..5 = 研发出的道具编号 − 8 @source 0x0041ce1b */
  project: number;
  /** 研发出来的那件道具的编号 */
  toolId: number;
  /** 道具名（= 原版 `[項目*8 + 0x47ff1a]` 那张名字表的串）*/
  name: string;
}

const TOOL_NAMES: ReadonlyMap<number, string> = new Map(TOOLS.map((t) => [t.id, t.name]));

/**
 * 这一屏要列哪几个項目。
 *
 * ★ 以 `pending.choices` 为准（core 已按 `1..等级` 算好，@source reduce.ts 的落点收尾）；
 *   `choices` 缺了才退回按 `level` 现推 —— 两条路的结果一样。
 *   `choices` 里的数一律夹在 `[RESEARCH_MIN_PROJECT, RESEARCH_MAX_PROJECT]`，
 *   越界的丢掉（`startResearch` 也会拒，但界面不该画一个点不动的项）。
 *
 * 名字取 `@rich4/data` 的道具表：`研发出的道具编号 = 項目号 + 8`。
 */
export function researchOptions(state: {
  pending?: PendingInteraction | null;
}): readonly ResearchOption[] {
  const pending = state.pending;
  if (!isResearchPending(pending)) return [];
  const raw =
    pending.choices.length > 0
      ? [...pending.choices]
      : Array.from({ length: Math.max(0, pending.level) }, (_, i) => i + 1);
  const out: ResearchOption[] = [];
  for (const p of raw) {
    if (p < RESEARCH_MIN_PROJECT || p > RESEARCH_MAX_PROJECT) continue;
    if (out.some((o) => o.project === p)) continue;
    const toolId = researchTool(p);
    out.push({ project: p, toolId, name: TOOL_NAMES.get(toolId) ?? `道具${toolId}` });
  }
  return out;
}

/** 第 `index` 格的图标锚点（屏幕坐标）= 该格去色块的中心 */
export function researchIconAt(index: number): { x: number; y: number } {
  return {
    x: RESEARCH_STRIP_AT.x + RESEARCH_ICON_LOCAL.x + index * RESEARCH_STRIDE,
    y: RESEARCH_STRIP_AT.y + RESEARCH_ICON_LOCAL.y,
  };
}

/** 第 `index` 格的图标矩形（屏幕坐标，按最大图标尺寸给的近似框）*/
export function researchOptionRect(index: number): { x: number; y: number; w: number; h: number } {
  const at = researchIconAt(index);
  return {
    x: at.x - Math.floor(RESEARCH_ICON_W / 2),
    y: at.y - Math.floor(RESEARCH_ICON_H / 2),
    w: RESEARCH_ICON_W,
    h: RESEARCH_ICON_H,
  };
}

/** 第 `index` 格的去色块矩形（屏幕坐标）—— **逐像素就是命中框** */
export function researchGrayRectAt(index: number): { x: number; y: number; w: number; h: number } {
  return {
    x: RESEARCH_STRIP_AT.x + RESEARCH_GRAY_LOCAL.x + index * RESEARCH_STRIDE,
    y: RESEARCH_STRIP_AT.y + RESEARCH_GRAY_LOCAL.y,
    w: RESEARCH_GRAY_W,
    h: RESEARCH_GRAY_H,
  };
}

/**
 * 点在**第几格**上；没点中返回 `null`。
 *
 * @source `loc_00440377`：
 * ```asm
 * 004403ab  cmp ebx, 0x23   ; ebx = x（五格横排，见文件头）
 * 004403b4  cmp ebx, 0x196
 * 004403c0  cmp eax, 0x129  ; eax = y
 * 004403cb  cmp eax, 0x15f
 * 004403d6  lea edx, [ebx - 0x23]
 * 004403e3  idiv 0x4c
 * ```
 * 命中框 `(35 + 76k, 297)` 66×54 与去色块**逐像素重合**，所以「点在框里」
 * 就等价于「点在某一格的去色块上」。
 *
 * @param level 设施等级：等级之外的格子（第 `level` 格往后）不认
 */
export function hitResearch(x: number, y: number, level: number): number | null {
  if (x < RESEARCH_HIT.x0 || x > RESEARCH_HIT.x1) return null;
  if (y < RESEARCH_HIT.y0 || y > RESEARCH_HIT.y1) return null;
  const row = Math.floor((x - RESEARCH_HIT.x0) / RESEARCH_STRIDE);
  if (row < 0 || row >= level) return null;
  if (row >= RESEARCH_MAX_PROJECT) return null;
  return row;
}

/** 第 `index` 格的悬停外框（绝对左上/右下）*/
export function researchHighlightRect(index: number): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const d = index * RESEARCH_STRIDE;
  return {
    x0: RESEARCH_HIGHLIGHT.x0 + d,
    y0: RESEARCH_HIGHLIGHT.y0,
    x1: RESEARCH_HIGHLIGHT.x0 + RESEARCH_HIGHLIGHT.w + d,
    y1: RESEARCH_HIGHLIGHT.y0 + RESEARCH_HIGHLIGHT.h,
  };
}

/** 第 `index` 格的两道黄框（外、内）@source 0x004404a2 / 0x004404c4 */
export function researchHighlightRects(
  index: number,
): readonly { x0: number; y0: number; x1: number; y1: number }[] {
  const d = index * RESEARCH_STRIDE;
  const h = RESEARCH_HIGHLIGHT;
  const i = h.inset;
  return [
    { x0: h.x0 + d, y0: h.y0, x1: h.x0 + h.w + d, y1: h.y0 + h.h },
    { x0: h.x0 + i + d, y0: h.y0 + i, x1: h.x0 + h.w - i + d, y1: h.y0 + h.h - i },
  ];
}

/** 項目名落点（flag 2 = 正中；**不随格子移动**，画在立绘板里）*/
export function researchNameAt(): { x: number; y: number } {
  return { x: RESEARCH_NAME_AT.x, y: RESEARCH_NAME_AT.y };
}

// ============================================================
//  绘制
// ============================================================

export interface ResearchDraw {
  /** 这一屏列出来的項目（顺序即格序）*/
  options: readonly ResearchOption[];
  /** 光标底下的格号；`null` = 没有 */
  hot?: number | null;
  /** 标题串 —— 原版是烤死的「研究所」，这里用 `pending.name` 兜底同一个串 */
  title: string;
}

function researchText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.font = `${RESEARCH_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = RESEARCH_OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = RESEARCH_FILL;
  ctx.fillText(text, x, y);
}

/**
 * 把一块矩形**去色**（转灰度）。
 *
 * @source `fcn_004553fe`（VA 0x004553fe）逐像素调 `[pixel_fmt*4 + 0x485968]`
 *   那四支例程（0x455442 / 0x455480 / 0x4554be / 0x4555eb）。以 555 那支为例：
 * ```asm
 * 00455442  lodsw ax,[esi]        ; 源像素（就是目标自己）
 * 00455444  or ax,ax / je 跳过    ; ★ 纯黑（0）不处理，留着透明
 * 00455449..00455465             ; r+g+b，+0x10 后 >> 2  —— 亮度
 * 00455468  shrd bx,ax,5 / shrd bx,ax,5 / shrd bx,ax,6
 * 00455477  mov [edi],bx          ; ★ 三个分量都用**亮度**填回
 * ```
 *   原版是在**已经画好的位图**上就地改；本引擎每帧重画、且 canvas 拿不到那张
 *   16bpp 缓冲，所以这里用 `globalCompositeOperation = 'saturation'` 等价实现
 *   （只作用在**非透明**像素上，与 `or ax,ax / je` 同观感）。
 *   见 `docs/deviations/T-040.md` 的 A-040-3。
 */
export function researchGray(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = '#808080';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * 画整屏。
 *
 * 顺序照原版（初画那一段 0x00441107 起，加上每格的图标/去色）：
 * 立绘板 → 标题串 → 五格条 →（每格：图标 → 去色块）→ 悬停时的名字 → 黄框。
 * ★ 原版把「图标 + 去色」先做进一张 400×89 的内层表面、再把整张表面贴到 (20,280)；
 *   本引擎直接按屏幕坐标画，逐像素位置完全一致（见 `RESEARCH_STRIP_AT` 的注）。
 */
export function drawResearchScreen(
  ctx: CanvasRenderingContext2D,
  sprite: ResearchSprite,
  d: ResearchDraw,
): void {
  ctx.save();

  // ── 立绘板 + 标题 ──
  const title = researchSprite(sprite, RESEARCH_ARCHIVE, RESEARCH_RESOURCE, RESEARCH_TITLE_CHUNK);
  if (title !== null) {
    ctx.drawImage(
      title.bitmap,
      RESEARCH_TITLE_CHUNK_AT.x - title.anchorX,
      RESEARCH_TITLE_CHUNK_AT.y - title.anchorY,
    );
  }
  researchText(ctx, d.title, RESEARCH_TITLE_AT.x, RESEARCH_TITLE_AT.y);

  // ── 五格条 ──
  const strip = researchSprite(sprite, RESEARCH_ARCHIVE, RESEARCH_RESOURCE, RESEARCH_STRIP_CHUNK);
  if (strip !== null) {
    ctx.drawImage(
      strip.bitmap,
      RESEARCH_STRIP_AT.x - strip.anchorX,
      RESEARCH_STRIP_AT.y - strip.anchorY,
    );
  }

  // ── 每格：图标 → 去色（原版就是这个先后，所以图标是灰的）──
  for (let i = 0; i < d.options.length; i++) {
    const icon = researchSprite(
      sprite,
      RESEARCH_ICON_ARCHIVE,
      RESEARCH_ICON_RESOURCE,
      RESEARCH_ICON_FIRST + i,
    );
    if (icon !== null) {
      const at = researchIconAt(i);
      ctx.drawImage(icon.bitmap, at.x - icon.anchorX, at.y - icon.anchorY);
    }
    const g = researchGrayRectAt(i);
    researchGray(ctx, g.x, g.y, g.w, g.h);
  }

  // ── 悬停：名字（画在立绘板里）+ 两道黄框 ──
  const hot = d.hot ?? null;
  if (hot !== null) {
    const opt = d.options[hot];
    if (opt !== undefined) {
      const n = researchNameAt();
      researchText(ctx, opt.name, n.x, n.y);
      ctx.strokeStyle = RESEARCH_HIGHLIGHT.color;
      ctx.lineWidth = 1;
      for (const r of researchHighlightRects(hot)) {
        ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
      }
    }
  }

  ctx.restore();
}

// ============================================================
//  UiScreen
// ============================================================

/** 光标底下的格（`null` = 没有）*/
let hot: number | null = null;
/** 按下记下的格（原版 `[0x48c530]`，初值 `0xffffffff`）*/
let pressed: number | null = null;

/** 只在这两处改；`active()` 是纯查询 @source `[0x48c530]` / `[0x48c534]` */
function reset(): void {
  hot = null;
  pressed = null;
}

function researchLevel(env: UiScreenEnv): number {
  const p = env.state.pending;
  return isResearchPending(p) ? p.level : 0;
}

export const researchScreen: UiScreen = {
  id: 'research',

  active(env: UiScreenEnv): boolean {
    return env.screen === 'game' && isResearchPending(env.state.pending);
  },

  draw(env: UiScreenEnv): void {
    const p = env.state.pending;
    if (!isResearchPending(p)) return;
    drawResearchScreen(env.stage, env.sprite, {
      options: researchOptions(env.state),
      hot,
      title: p.name || '研究所',
    });
  },

  move(x: number, y: number, env: UiScreenEnv): void {
    const row = hitResearch(x, y, researchLevel(env));
    if (row === hot) return;
    hot = row;
    // @source `loc_004403f5` `play_sound_effect(0x48231a)` —— 换格才响
    if (row !== null) env.playEffect(RESEARCH_SOUND_HOVER);
    env.requestRender();
  },

  down(x: number, y: number, env: UiScreenEnv): void {
    // 原版在 `0x200` 只记账（`[0x48c530] = 格号`），真正的答复在抬手 @source loc_0044062b
    pressed = hitResearch(x, y, researchLevel(env));
    env.requestRender();
  },

  up(x: number, y: number, env: UiScreenEnv): void {
    const row = pressed;
    pressed = null;
    if (row === null) return;
    // ★ 原版 `loc_0044062b` 查的是 `[0x48c530]` 这个**按下时记下的**格号，
    //   另要求抬手时仍在同一格上（`cmp ecx, [0x48c534]`）。
    if (hitResearch(x, y, researchLevel(env)) !== row) {
      env.requestRender();
      return;
    }
    const p = env.state.pending;
    if (!isResearchPending(p)) return;
    const opt = researchOptions(env.state)[row];
    if (opt === undefined) return;
    // @source `loc_00440669`：确认音 + PostMessage(格号) → 收尾写 `+0x1d` / `+0x1e`
    env.playEffect(RESEARCH_SOUND_PICK);
    hot = null;
    env.dispatch({ type: 'research', facilityId: p.facilityId, project: opt.project });
  },

  tick(env: UiScreenEnv): void {
    // 屏走了就把悬停/按下清掉（原版每次进屏都重置 `[0x48c530] = 0xffffffff`）
    if (!isResearchPending(env.state.pending)) reset();
  },
};
