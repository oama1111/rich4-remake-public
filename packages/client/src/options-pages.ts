/*
 * 設定（OPTION）屏的三个副屏 + 通用 YES/NO 框 —— Q-OPT-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 主面板在 `options.ts`（控件表 `0x474b92` + 跳表 `0x41034b`）。这里放
 * 右上角三颗黄钮各自推开的那一层：
 *
 * | 副屏 | 底图 | 窗口过程 | 绘制函数 | 谁推开 |
 * |---|---|---|---|---|
 * | 日期頁 | `Data.mkf` 资源 3 **图 2**（199×220） | `fcn_00410ac3` | `fcn_0040ff4b` | 標題頁那颗「日期更改」|
 * | 熱鍵頁 | 资源 3 **图 1**（328×336） | `fcn_00411122` | `fcn_00410158` | 標題頁那颗「熱鍵設定」|
 * | 遊戲說明 | `help.mkf` 资源 0 | `_rich4_ui_help_callback` | — | 標題頁那颗「遊戲說明」|
 * | YES/NO 框 | `Data.mkf` 资源 **440**（96×48，3 张） | `fcn_0045367e` | — | 遊戲中那三颗 |
 *
 * 「遊戲說明」在 `help-screen.ts`（T-045），这里只管另外三个。
 *
 * ## 每一条位置都是 exe 的表/指令，不是量出来的
 *
 * - 日期頁的 8 个控件矩形 = 表 `0x474ce8`（8 项 × 16 字节，left/top/right/bottom 左闭右开），
 *   配 8 路处理跳表 `0x410a87`
 * - 日期頁月/年字落点 = `0x474cd4/cd6`（48,32）与 `0x474cd8/cda`（133,30），对齐码 2
 * - 日期頁三个蓝钮的字 = 串表 `0x474cc8`（熱 鍵 / 取 消 / 確 定），
 *   落点表 `0x474cdc/cde` 起每项 4 字节：`(38,196) (101,196) (163,196)`，对齐码 2
 * - 日期頁日曆格 = `fcn_0040ff4b` 的日循环（`0x00410064` 起）：1 号落在
 *   `(23×星期 + 28, 80)`，x 步进 23、满 7 格（x 到 166）换行且 y += 18
 * - 熱鍵頁两列名字 = 串表 `0x474abc`（28 条）+ 入口 `0x00411c20` 起的坐标
 *   （x 62 / 208，y 33 起每行 +16）；键位列 = `fcn_00410158` 的 `+0x84` / `+0x11c`
 * - 熱鍵頁的键位表 = `0x497168`（56 字节 = 28 个 word），出厂默认 = `0x47edc2`
 * - 键名表 = `0x47edfa`（8 字节一项：dword 键号 + dword 名字指针），78 项
 * - 熱鍵頁三个钮 = 串表 `0x474b2c`（原始設定 / 取 消 / 確 定），落点 (52,296) 起 +113
 * - YES/NO 框 = 资源 440（96×48，图 0 素框 / 1 左半亮 / 2 右半亮），画在中心 (320,200)
 *
 * ## 三条「原版自己就是这样，照做」的怪癖
 *
 * 1. **日期頁最左那颗钮写着「熱 鍵」，按下去却是「回到今天」** ——
 *    标签表 `0x474cc8[0]` = `0x46375e`（'熱 鍵'），而它的抬手处理 `0x411036`
 *    是 `mov eax,[0x48bb5c] ; mov [0x48bb84],eax`，而 `[0x48bb5c]` 是入口
 *    `0x411a5d` 存进去的**系统今天**（`fcn_00458331` 取 DOS 日期）。照做。
 * 2. **熱鍵頁第二列「点哪一行改哪一行」差一行**：第一列存 `0x48bb9e = 行号+1`，
 *    第二列存 `行号+16`，而读写都走 `[0x48bb0e + 2*值]`（= 数组第 `值−1` 项）
 *    —— 第一列正好，第二列会改到**下一行**（`0x411533` 的 `add eax,0x10`）。
 *    见 `hotkeyEditSlot()`。
 * 3. **熱鍵頁最下面那条「空档」还会往下越界**：值最大 30 → 数组第 29 项，
 *    超过 28 项的数组（原版是写坏相邻内存）。本模块**只忽略越界那一下**
 *    （JS 里写 `arr[29]` 会把数组撑长，必须挡住），其余照抄。
 *
 * ## 抠黑（`Data.mkf` 的 SMP 黑底要逐图判定）
 *
 * `fcn_004563f5` = 不抠、`fcn_00456418` = 抠（见 `options.ts` 文件头）：
 *
 * | 图 | 谁画 | 抠黑 |
 * |---|---|---|
 * | 日期頁 图 2 | `fcn_0040ff4b` @0x0040ffab 的 `0x4563f5` | **不抠** |
 * | 熱鍵頁 图 1 | `fcn_00410158` @0x0041018f 的 `0x456418` | 抠 |
 * | 微调 图 12/13 | `0x410cc4` 的 `add eax,0x9c` / `0x410d72` 的 `0xa8` 之后 `0x456418` | 抠 |
 * | 蓝钮 图 14 | `0x410e25` 的 `add eax,0xb4` 之后 `0x456418` | 抠 |
 * | YES/NO 框 资源 440 图 0/1/2 | `fcn_00453a32` @0x00453af2 的 `0x4563f5` | **不抠** |
 *
 * ⚠️ 资源 3 的**图 7/8（16×16 箭头）与图 15（80×41 灰钮）全 exe 里一次都没被画过**
 *   ——把 `[0x48bb60]` 的每一次引用都扫了一遍（`add eax,0xc/0x18/0x24/0x30/0x3c/0x48/
 *   0x54/0x78/0x9c/0xa8/0xb4`，外加按钮组那条算出来的 `12*(arg+10)`）。先前记的
 *   「7/8 = 日期頁上下箭头、15 = 灰钮」是猜的：日期頁的箭头烘在图 2 上，
 *   按下时才贴 12/13。这三张图本模块不画。
 */

import { daysInMonth, weekdayOf } from '@rich4/core';
import type { Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import { IMG, OPTIONS_RESOURCE, type Rect } from './options.ts';

/** 这一屏的绘制素材出口（第 1 个参数 = 资源号，方便 YES/NO 框用 440）*/
export type PageSpriteFn = (resource: number, index: number, colorKeyBlack?: boolean) => Sprite | null;

function blit(
  ctx: CanvasRenderingContext2D,
  sprite: PageSpriteFn,
  resource: number,
  index: number,
  x: number,
  y: number,
  keyed = false,
): void {
  const s = sprite(resource, index, keyed);
  if (s !== null) ctx.drawImage(s.bitmap, x, y);
}

/** 居中文字 + 描边（原版是点阵字自带描边：`create_font(size, 前景, 0x101010, …)`）*/
function outlined(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke = '#101010',
): void {
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// ============================================================
//  日期頁（日期更改）—— 窗口过程 fcn_00410ac3 / 绘制 fcn_0040ff4b
// ============================================================

/** 底图尺寸 = 资源 3 图 2 的位图尺寸（199×220）*/
export const DATE_W = 199;
export const DATE_H = 220;
/** @source 0x00410b42 起：`x = 0x140 − w/2`、`y = 0x0f0 − h/2`（都是 `sar 1`）*/
export const DATE_AT = { x: 320 - (DATE_W >> 1), y: 240 - (DATE_H >> 1) } as const;

/** 日期頁的 8 个控件 —— 跳表 `0x410a87` 的项号 */
export const DATE_CTRL = {
  MONTH_UP: 0,
  MONTH_DOWN: 1,
  YEAR_UP: 2,
  YEAR_DOWN: 3,
  /** 写着「熱 鍵」、实际是「回到今天」那颗 */
  TODAY: 4,
  CANCEL: 5,
  OK: 6,
  /** 日曆格整块 */
  GRID: 7,
} as const;

/**
 * 控件矩形表 `0x474ce8`（8 项 × 16 字节，left/top/right/bottom，左闭右开），
 * 逐条抄成 `{x,y,w,h}`。
 */
export const DATE_RECTS: readonly Rect[] = [
  { x: 74, y: 21, w: 16, h: 10 }, // 0 月 ↑（图 12）
  { x: 74, y: 31, w: 16, h: 10 }, // 1 月 ↓（图 13）
  { x: 160, y: 21, w: 16, h: 10 }, // 2 年 ↑
  { x: 160, y: 31, w: 16, h: 10 }, // 3 年 ↓
  { x: 9, y: 180, w: 55, h: 30 }, // 4 熱 鍵（→ 今天）
  { x: 72, y: 180, w: 55, h: 30 }, // 5 取 消
  { x: 134, y: 180, w: 55, h: 30 }, // 6 確 定
  { x: 15, y: 70, w: 166, h: 107 }, // 7 日曆格整块
];

/** 按下的微调钮贴哪张图：上 = 12、下 = 13 @source 0x410cc4 的 `add eax,0x9c` / 0x410d72 的 `a8` */
export const DATE_SPIN_IMG = { up: IMG.SPIN_UP, down: IMG.SPIN_DOWN } as const;
/** 按下的蓝钮 @source 0x410e25 的 `add eax,0xb4` → 图 14 */
export const DATE_BUTTON_IMG = IMG.BLUE_BUTTON;

/** 三个蓝钮的字（表 `0x474cc8` 的三项）@source 串 0x46375e / 0x463584 / 0x46358a */
export const DATE_BUTTON_LABELS: readonly string[] = ['熱 鍵', '取 消', '確 定'];
/** 字落点（对齐码 2 = 以该点为中心）@source 表 `0x474cdc/cde` 起每项 4 字节 */
export const DATE_BUTTON_TEXT: readonly { x: number; y: number }[] = [
  { x: 38, y: 196 },
  { x: 101, y: 196 },
  { x: 163, y: 196 },
];

/** 月名（1..12；下标 0 不用）@source 串表 `0x474c94`（= 一月…十二月）*/
export const MONTH_NAMES: readonly string[] = [
  '',
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];
/** 月字落点 @source `fcn_0040ff4b` 的 `[0x474cd4]` / `[0x474cd6]` = (48,32)，对齐码 2 */
export const DATE_MONTH_AT = { x: 48, y: 32 } as const;
/** 年字落点 @source `[0x474cd8]` / `[0x474cda]` = (133,30)，对齐码 2 */
export const DATE_YEAR_AT = { x: 133, y: 30 } as const;

/**
 * 日曆格的几何 —— `fcn_0040ff4b` 的日循环（0x00410064 起）逐条读出来的。
 *
 * ```asm
 * ebx = arg2 + 0x1c + 0x17×星期      ; 1 号那一格的中心 x（arg2 = 对话框 x）
 * esi = arg3 + 0x50                  ; 第一行的中心 y
 * 每画一天：ebx += 0x17(23)
 *           若 ebx == arg2 + 0xa6(166) → ebx = arg2 + 0x1c(28)、esi += 0x12(18)
 * ```
 */
export const DATE_CELL = {
  /** 第 1 天那一格中心相对对话框的 x/y */
  x0: 0x1c,
  y0: 0x50,
  /** 横向步进 / 纵向步进 */
  dx: 0x17,
  dy: 0x12,
  /** 走到这个相对 x（7 列满）就换行 @source 0x00410108 `cmp ebx, eax`（`eax = arg2+0xa6`）*/
  wrapX: 0xa6,
  /** 选中那天的底 `(x−0xa, y−6)` 20×16 @source 0x0041009a 的 `[esi-6]` / 0x0041009e 的 `[ebx-0xa]` */
  boxDX: -0xa,
  boxDY: -6,
  boxW: 0x14,
  boxH: 0x10,
  /** 命中框 `(x−0xa .. x+0xa) × (y−8 .. y+8)` @source 0x00410e9a 的 `[eax-0xa]` / 0x00410ea1 的 `[edx-8]` */
  hitDX: 0xa,
  hitDY: 8,
} as const;

/** 选中那天的底 @source 0x00410091 `push 0x51916c`（`fcn_004561be` 是**填充**矩形）*/
export const DATE_SELECTED_FILL = '#51916c';
/** 年份下限 @source 0x00411008 `cmp ebx, 0x7ce`（= 1998，再小就不减）*/
export const DATE_MIN_YEAR = 0x7ce;
/** 这一屏的字号 @source 入口 0x4119e7 `rich4_create_font(0xf, 0x101010, 0x101010, 2, 0)` */
export const DATE_FONT_SIZE = 15;
/** 字色 @source 同上（前景与底都是 `0x101010`）*/
export const DATE_FONT_COLOR = '#101010';

/** 一个打包日期（年/月/日）—— 与 core `places/calendar.ts` 同一套口径 */
export interface DateDraft {
  year: number;
  month: number;
  day: number;
}

/** 解一个打包 dword @source `rules/calendar.ts` 文件头：`年 = v>>16`、`月 = (v>>8)&0xff`、`日 = v&0xff` */
export function unpackDate(v: number): DateDraft {
  return { year: v >>> 16, month: (v >>> 8) & 0xff, day: v & 0xff };
}

/** 打包回去 @source `advance_date` VA 0x00452117 的尾巴 */
export function packDate(d: DateDraft): number {
  return ((d.year << 16) | (d.month << 8) | d.day) >>> 0;
}

/**
 * 这个月画出来的每一天 —— 顺序与落点就是 `fcn_0040ff4b` 的循环。
 *
 * 第 1 天落在「星期几」那一列（0 = 星期日：`0x4520c6` 的 `(天数+4)%7`，
 * 表头就是底图上的 `S M T W T F S`）。
 */
export function dateDayCells(d: DateDraft): { day: number; x: number; y: number }[] {
  const total = daysInMonth(d.year, d.month);
  let x = DATE_CELL.x0 + DATE_CELL.dx * weekdayOf(d.year, d.month, 1);
  let y = DATE_CELL.y0;
  const out: { day: number; x: number; y: number }[] = [];
  for (let day = 1; day <= total; day++) {
    out.push({ day, x, y });
    if (x === DATE_CELL.wrapX) {
      x = DATE_CELL.x0;
      y += DATE_CELL.dy;
    } else {
      x += DATE_CELL.dx;
    }
  }
  return out;
}

/** 对话框内坐标 → 控件号（`0x474ce8` 那张表，左闭右开）*/
export function hitDateControl(x: number, y: number): number | null {
  for (let i = 0; i < DATE_RECTS.length; i++) {
    const r = DATE_RECTS[i]!;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return null;
}

/**
 * 「按下」在日期頁上命中了什么。
 *
 * @source `0x410bc8`（WM_LBUTTONDOWN）：先按 `0x474ce8` 找控件、命中格块（7）
 *   再按天的命中框细分（`0x410e78`），然后走跳表 `0x410a87`；
 *   `null` = 原版把 `[0x474d78]` 留成 8+ 直接什么都不做。
 */
export type DateHit =
  | { kind: 'spin'; ctrl: number; field: 'month' | 'year'; delta: -1 | 1 }
  | { kind: 'button'; ctrl: number; action: 'today' | 'cancel' | 'ok' }
  | { kind: 'day'; ctrl: number; day: number };

export function hitDatePage(x: number, y: number, d: DateDraft): DateHit | null {
  const ctrl = hitDateControl(x, y);
  if (ctrl === null) return null;
  switch (ctrl) {
    case DATE_CTRL.MONTH_UP:
      return { kind: 'spin', ctrl, field: 'month', delta: -1 };
    case DATE_CTRL.MONTH_DOWN:
      return { kind: 'spin', ctrl, field: 'month', delta: 1 };
    case DATE_CTRL.YEAR_UP:
      return { kind: 'spin', ctrl, field: 'year', delta: -1 };
    case DATE_CTRL.YEAR_DOWN:
      return { kind: 'spin', ctrl, field: 'year', delta: 1 };
    case DATE_CTRL.TODAY:
      return { kind: 'button', ctrl, action: 'today' };
    case DATE_CTRL.CANCEL:
      return { kind: 'button', ctrl, action: 'cancel' };
    case DATE_CTRL.OK:
      return { kind: 'button', ctrl, action: 'ok' };
    default: {
      const day = hitDateDay(x, y, d);
      return day === null ? null : { kind: 'day', ctrl, day };
    }
  }
}

/** 格块内的哪一天（对话框内坐标）；没点中任何一天 → `null` */
export function hitDateDay(x: number, y: number, d: DateDraft): number | null {
  for (const c of dateDayCells(d)) {
    if (
      x >= c.x - DATE_CELL.hitDX &&
      x < c.x + DATE_CELL.hitDX &&
      y >= c.y - DATE_CELL.hitDY &&
      y < c.y + DATE_CELL.hitDY
    ) {
      return c.day;
    }
  }
  return null;
}

/**
 * 把一次命中落到日期上（**抬手**才走这里；按下只画按下图）。
 *
 * @source 抬手跳表 `0x410aa7`：
 *   - `0x410f85` 月 −（`dec bl`，减到 0 就回 12）
 *   - `0x410fb3` 月 +（`cmp ah,0xd` → 回 1）
 *   - `0x410fff` 年 −（`cmp ebx,0x7ce / jle` → 1998 就不再减）
 *   - `0x41101a` 年 +
 *   - `0x411036` 「熱 鍵」= `[0x48bb84] = [0x48bb5c]`（今天的日期）
 *   - `0x41104c` 取消 = 抛 −1（什么都不拷回）/ `0x411081` 確定 = 抛出日期
 *
 * ★ 天**不夹取**：月改小了也可能留着 31 号（原版也不夹；绘制循环按当月天数画，
 *   于是那天没有格、也就不会高亮）。
 */
export function applyDateHit(d: DateDraft, hit: DateHit, today: DateDraft): DateDraft {
  switch (hit.kind) {
    case 'spin':
      if (hit.field === 'month') {
        let month = d.month + hit.delta;
        if (month === 0) month = 12;
        if (month === 13) month = 1;
        return { ...d, month };
      }
      if (hit.delta < 0) return d.year <= DATE_MIN_YEAR ? d : { ...d, year: d.year - 1 };
      return { ...d, year: d.year + 1 };
    case 'button':
      return hit.action === 'today' ? { ...today } : d;
    case 'day':
      return { ...d, day: hit.day };
  }
}

/** 日期頁那一屏要画的样子 */
export interface DateDraw {
  draft: DateDraft;
  /** 正按住的控件号（`null` = 没按）；原版按下贴图、**没有悬停** */
  pressed: number | null;
}

/**
 * 画日期頁。
 *
 * 顺序照原版：底图 2（不抠）→ 三个蓝钮的字（入口 `0x411a26` 往图 2 里写过）
 * → 月/年字（15 号黑字，对齐码 2）→ 日曆格（选中那天先填 20×16 绿底、
 * 再用 15 号白字写号）→ 按下的微调/蓝钮（蓝钮按下**再补一次自己的字**
 * —— 原版 `0x410e3a` 就是先贴图再写字）。
 */
export function drawDatePage(ctx: CanvasRenderingContext2D, sprite: PageSpriteFn, d: DateDraw): void {
  ctx.save();
  ctx.translate(DATE_AT.x, DATE_AT.y);

  blit(ctx, sprite, OPTIONS_RESOURCE, IMG.DATE_PAGE, 0, 0, false);

  for (let i = 0; i < DATE_BUTTON_LABELS.length; i++) {
    const at = DATE_BUTTON_TEXT[i]!;
    outlined(ctx, DATE_BUTTON_LABELS[i]!, at.x, at.y, DATE_FONT_SIZE, DATE_FONT_COLOR);
  }

  // 月 / 年
  outlined(
    ctx,
    MONTH_NAMES[d.draft.month] ?? '',
    DATE_MONTH_AT.x,
    DATE_MONTH_AT.y,
    DATE_FONT_SIZE,
    DATE_FONT_COLOR,
  );
  outlined(ctx, String(d.draft.year), DATE_YEAR_AT.x, DATE_YEAR_AT.y, DATE_FONT_SIZE, DATE_FONT_COLOR);

  // 日曆格
  for (const c of dateDayCells(d.draft)) {
    if (c.day === d.draft.day) {
      ctx.fillStyle = DATE_SELECTED_FILL;
      ctx.fillRect(c.x + DATE_CELL.boxDX, c.y + DATE_CELL.boxDY, DATE_CELL.boxW, DATE_CELL.boxH);
      outlined(ctx, String(c.day), c.x, c.y, DATE_FONT_SIZE, '#ffffff');
    } else {
      outlined(ctx, String(c.day), c.x, c.y, DATE_FONT_SIZE, DATE_FONT_COLOR);
    }
  }

  // 按下的钮
  const p = d.pressed;
  if (p === DATE_CTRL.MONTH_UP || p === DATE_CTRL.YEAR_UP) {
    const r = DATE_RECTS[p]!;
    blit(ctx, sprite, OPTIONS_RESOURCE, DATE_SPIN_IMG.up, r.x, r.y, true);
  } else if (p === DATE_CTRL.MONTH_DOWN || p === DATE_CTRL.YEAR_DOWN) {
    const r = DATE_RECTS[p]!;
    blit(ctx, sprite, OPTIONS_RESOURCE, DATE_SPIN_IMG.down, r.x, r.y, true);
  } else if (p === DATE_CTRL.TODAY || p === DATE_CTRL.CANCEL || p === DATE_CTRL.OK) {
    const i = p - DATE_CTRL.TODAY;
    const r = DATE_RECTS[p]!;
    blit(ctx, sprite, OPTIONS_RESOURCE, DATE_BUTTON_IMG, r.x, r.y, true);
    const at = DATE_BUTTON_TEXT[i]!;
    outlined(ctx, DATE_BUTTON_LABELS[i]!, at.x, at.y, DATE_FONT_SIZE, DATE_FONT_COLOR);
  }

  ctx.restore();
}

// ============================================================
//  熱鍵頁（熱鍵設定）—— 窗口过程 fcn_00411122 / 绘制 fcn_00410158
// ============================================================

/** 底图尺寸 = 资源 3 图 1（328×336）*/
export const HOTKEY_W = 328;
export const HOTKEY_H = 336;
/** @source 0x004111b6 起：`x = 0x140 − w/2`、`y = 0x0f0 − h/2` */
export const HOTKEY_AT = { x: 320 - (HOTKEY_W >> 1), y: 240 - (HOTKEY_H >> 1) } as const;

/** 两列各 14 行 */
export const HOTKEY_ROWS = 14;
export const HOTKEY_COUNT = HOTKEY_ROWS * 2;
/** 行距 @source `fcn_00410158` 的 `add esi, 0x10` */
export const HOTKEY_PITCH = 16;
/** 第一行的中心 y @source `add esi, 0x21` */
export const HOTKEY_Y0 = 0x21;
/**
 * 名字列 vs 键位列（都是对话框内坐标，都是对齐码 2 的中心）。
 *
 * - 名字（`0x474abc` 那 28 条）**烘在图 1 上**：入口 `0x00411c20` 起
 *   `x = 62 / 208`（`mov esi,0x3e` 后 `mov esi,0xd0`），y = 33 起每行 +16。
 * - 键名由 `fcn_00410158` 每帧现画：`x = 132 / 284`（`add edi,0x84` / `add edi,0x11c`），
 *   y 同样 33 起每行 +16。
 */
export const HOTKEY_NAME_X: readonly number[] = [62, 208];
export const HOTKEY_KEY_X: readonly number[] = [132, 284];
/** 字号 @source 入口 0x411c14 与 `fcn_00410158` 的 `push 0xc` */
export const HOTKEY_FONT_SIZE = 12;
/** 名字列的颜色 @source 入口 0x411c0f `push 0xf0f0f0`（白字黑底）*/
export const HOTKEY_NAME_COLOR = '#f0f0f0';
/** 键位列的颜色：前 8 条 `push 0xf0f0`（青）、第 8 条起 `push 0xf0f000`（黄）@source 0x4102e4 / 0x4101b8 */
export const HOTKEY_KEY_COLOR: readonly string[] = ['#00f0f0', '#f0f000'];
/** 文字描边色 @source 两次 `create_font` 的 `push 0x101010` */
export const HOTKEY_TEXT_STROKE = '#101010';
/** 前 8 条**不许改** @source `0x41180a cmp edi,8 / jle`（抬手处理里直接跳过）*/
export const HOTKEY_FIXED = 8;

/** 熱鍵頁的三个钮 —— 抬手处理里那三个魔数 */
export const HOTKEY_CTRL = {
  /** 原始設定：把出厂默认拷回工作副本（**不关屏**）@source 0x41173b 起 */
  DEFAULTS: 0x64,
  /** 取 消：关屏、不写回 @source 0x41177a */
  CANCEL: 0x65,
  /** 確 定：写回 `0x497168` + 存 CFG（`0x411f80`）@source 0x4117bc */
  OK: 0x66,
} as const;

/** 左闭右闭的矩形（熱鍵頁那边的判定全是 `jl`/`jg`，两端都算）*/
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function inBox(x: number, y: number, b: Box): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/** 左闭右闭 → 画图用的 `{x,y,w,h}` */
function boxRect(b: Box): Rect {
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
}

/** 三个钮的判定框 @source 0x4115d1 / 0x411666 / 0x4116f2 三段里的 `+0x11/+0x57`、`+0x82/+0xc8`、`+0xf2/+0x138` */
export const HOTKEY_BUTTON_BOXES: readonly Box[] = [
  { x0: 0x11, y0: 0x119, x1: 0x57, y1: 0x137 },
  { x0: 0x82, y0: 0x119, x1: 0xc8, y1: 0x137 },
  { x0: 0xf2, y0: 0x119, x1: 0x138, y1: 0x137 },
];
/** 三个钮的字（串表 `0x474b2c`）@source 串 0x463715 / 0x463584 / 0x46358a */
export const HOTKEY_BUTTON_LABELS: readonly string[] = ['原始設定', '取 消', '確 定'];
/** 字的落点：`esi = 0x34` 起每颗 +0x71(113)，y = 0x128(296)，对齐码 2 @source 0x411bd7 起 */
export const HOTKEY_BUTTON_TEXT: readonly { x: number; y: number }[] = [
  { x: 0x34, y: 0x128 },
  { x: 0x34 + 0x71, y: 0x128 },
  { x: 0x34 + 0x71 * 2, y: 0x128 },
];

/** 行的判定框：第一列 x 0x69..0xa0、第二列 x 0x101..0x138，y 0x19..0x108 @source 0x4113ec 起 */
export const HOTKEY_ROW_BOX = {
  x0: [0x69, 0x101] as const,
  x1: [0xa0, 0x138] as const,
  y0: 0x19,
  y1: 0x108,
} as const;

/**
 * 出厂键位表 `0x47edc2`（56 字节 = 28 个 word；低字节 = 键、高字节 = 修饰键）。
 *
 * 逐条 dump（`dump 0x47edc2 60 1`）：`38 39 40 37 | 13 27 9 9 | 89 78 32 68 87 88 67
 * 69 70 77 | 188 190 | 65 86 83 76 72 33 34 | 81 17`。
 * 最后一条 `(81,17)` = 低字节 0x51('Q') + 高字节 0x11(CTRL) = `CTRL-Q`（結束程式）。
 */
export const HOTKEY_DEFAULT_KEYS: readonly number[] = [
  38, 39, 40, 37, 13, 27, 9, 9, 89, 78, 32, 68, 87, 88, 67, 69, 70, 77, 188, 190, 65, 86, 83, 76,
  72, 33, 34, 0x1151,
];

/**
 * 键号 → 键名 —— 表 `0x47edfa`（每项 8 字节：dword 键号 + dword 名字指针），
 * 78 项，键号 0 结束；名字串在 `0x4666b0` 起（逐条 dump）。
 *
 * ★ 只有特殊键有长名字（`BS` / `TAB` / `CTRL-` / `PG UP` …），字母数字就是自己。
 *   表里查不到 → 原版**不画那半截**（`0x41021d` 的 `je 0x41023d`）。
 */
export const HOTKEY_KEY_NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  [8, 'BS'], [9, 'TAB'], [13, 'ENTER'], [17, 'CTRL-'], [27, 'ESC'], [32, 'SPACE'],
  [33, 'PG UP'], [34, 'PG DN'], [35, 'END'], [36, 'HOME'],
  [37, '←'], [38, '↑'], [39, '→'], [40, '↓'], [45, 'INS'],
  [48, '0'], [49, '1'], [50, '2'], [51, '3'], [52, '4'], [53, '5'], [54, '6'], [55, '7'],
  [56, '8'], [57, '9'],
  [65, 'A'], [66, 'B'], [67, 'C'], [68, 'D'], [69, 'E'], [70, 'F'], [71, 'G'], [72, 'H'],
  [73, 'I'], [74, 'J'], [75, 'K'], [76, 'L'], [77, 'M'], [78, 'N'], [79, 'O'], [80, 'P'],
  [81, 'Q'], [82, 'R'], [83, 'S'], [84, 'T'], [85, 'U'], [86, 'V'], [87, 'W'], [88, 'X'],
  [89, 'Y'], [90, 'Z'],
  [106, '*'], [107, '+'], [109, '-'], [111, '/'],
  [112, 'F1'], [113, 'F2'], [114, 'F3'], [115, 'F4'], [116, 'F5'], [117, 'F6'],
  [118, 'F7'], [119, 'F8'], [120, 'F9'], [121, 'F10'], [122, 'F11'], [123, 'F12'],
  [186, ';'], [187, '='], [188, '<'], [189, '-'], [190, '>'], [191, '?'], [192, '~'],
  [219, '['], [220, '\\'], [221, ']'], [222, "'"],
]);

/**
 * 一条键位怎么显示。
 *
 * @source `fcn_00410158` 0x4101cc 起：**先高字节、后低字节**，各自查 `0x47edfa`
 *   取名字、查不到就跳过；两截都没有就不画（0x41029a 的 `cmp byte [esp],0`）。
 *   于是 `0x1151` 显示成 `CTRL-` + `Q` = `CTRL-Q`（表里 0x11 的名字故意带尾巴 `-`）。
 */
export function keyText(entry: number): string {
  const hi = (entry >> 8) & 0xff;
  const lo = entry & 0xff;
  const a = hi === 0 ? '' : (HOTKEY_KEY_NAMES.get(hi) ?? '');
  const b = lo === 0 ? '' : (HOTKEY_KEY_NAMES.get(lo) ?? '');
  return a + b;
}

/** 第 `col` 列第 `row` 行的键名中心（对话框内，对齐码 2）*/
export function hotkeyTextAt(col: number, row: number): { x: number; y: number } {
  return { x: HOTKEY_KEY_X[col] ?? HOTKEY_KEY_X[0]!, y: HOTKEY_Y0 + row * HOTKEY_PITCH };
}

/** 第 `col` 列第 `row` 行的名字中心（对话框内）*/
export function hotkeyNameAt(col: number, row: number): { x: number; y: number } {
  return { x: HOTKEY_NAME_X[col] ?? HOTKEY_NAME_X[0]!, y: HOTKEY_Y0 + row * HOTKEY_PITCH };
}

/** 判定值 `0x48bb9e` → 列/行：第一列 `值 = 行+1`、第二列 `值 = 行+16` */
export function hotkeySpot(ctrl: number): { col: number; row: number; slot: number | null } | null {
  if (ctrl <= 0 || ctrl > HOTKEY_COUNT + 2) return null;
  const col = ctrl <= HOTKEY_ROWS + 1 ? 0 : 1;
  const row = col === 0 ? ctrl - 1 : ctrl - 16;
  return { col, row, slot: hotkeyEditSlot(col, row) };
}

/** 行按下时那块「凹下去」的矩形（对话框内）@source 0x41147c 起：`(x0, y0+16·行)` 到 `+0xf` */
export function hotkeyRowRect(col: number, row: number): Rect {
  const x0 = HOTKEY_ROW_BOX.x0[col] ?? HOTKEY_ROW_BOX.x0[0];
  const x1 = HOTKEY_ROW_BOX.x1[col] ?? HOTKEY_ROW_BOX.x1[0];
  return { x: x0, y: HOTKEY_ROW_BOX.y0 + row * HOTKEY_PITCH, w: x1 - x0 + 1, h: HOTKEY_PITCH - 1 };
}

/**
 * 点在第 `col` 列第 `row` 行时，**改的是数组第几项**。
 *
 * ★ 原版这里有个**自己的差一**：`0x41146a` 第一列存 `行号+1`、`0x411533`
 *   第二列存 `行号+16`，而读写都走 `[0x48bb0e + 2*值]` = 数组第 `值−1` 项
 *   —— 第一列 = 行号（对），第二列 = 行号+1（**改到下一行**）。照抄。
 *   越界（数组只有 28 项，第二列最下面那条空档算出来是 29）返回 `null`：
 *   本模块不写（JS 里写 `arr[29]` 会把数组撑长，原版是写坏相邻内存）。
 */
export function hotkeyEditSlot(col: number, row: number): number | null {
  const slot = col === 0 ? row : row + HOTKEY_ROWS + 1;
  return slot >= 0 && slot < HOTKEY_COUNT ? slot : null;
}

/** 对话框内坐标 → 这一屏的命中 */
export type HotkeyHit =
  | { kind: 'row'; ctrl: number; col: number; row: number; slot: number | null }
  | { kind: 'button'; ctrl: number; action: 'defaults' | 'cancel' | 'ok' };

/**
 * @source `0x4113d9`（WM_LBUTTONDOWN）的判定顺序：
 *   第一列行 → 第二列行 → 原始設定 → 取 消 → 確 定 → 都没中什么都不做。
 *   行号 = `(y − y0) >> 4`（`0x411465` 的算术右移），**不夹取**：最下面那条
 *   空档照样算成下一列的第 0/1 行（原版如此）。
 */
export function hitHotkeyPage(x: number, y: number): HotkeyHit | null {
  if (y >= HOTKEY_ROW_BOX.y0 && y <= HOTKEY_ROW_BOX.y1) {
    for (let col = 0; col < 2; col++) {
      const box: Box = {
        x0: HOTKEY_ROW_BOX.x0[col]!,
        x1: HOTKEY_ROW_BOX.x1[col]!,
        y0: HOTKEY_ROW_BOX.y0,
        y1: HOTKEY_ROW_BOX.y1,
      };
      if (!inBox(x, y, box)) continue;
      const row = (y - HOTKEY_ROW_BOX.y0) >> 4;
      const ctrl = col === 0 ? row + 1 : row + 16;
      return { kind: 'row', ctrl, col, row, slot: hotkeyEditSlot(col, row) };
    }
  }
  for (let i = 0; i < HOTKEY_BUTTON_BOXES.length; i++) {
    if (!inBox(x, y, HOTKEY_BUTTON_BOXES[i]!)) continue;
    const action = (['defaults', 'cancel', 'ok'] as const)[i]!;
    return { kind: 'button', ctrl: [0x64, 0x65, 0x66][i]!, action };
  }
  return null;
}

/**
 * 把一次按键并进一条键位（原版 `0x41183b` 起）。
 *
 * - 键号不在 `0x47edfa` 里 → 原版直接不理（`0x411874` 的 `je`）
 * - `CTRL`(0x11) → 整条置成 `0x1100`（修饰前缀，`0x411884`）
 * - 其余 → 把键号 `or` 进低字节（`0x4118ed`）
 * - 与**别的**条目撞车 → 不改（`0x4118d9` 的 `jmp`）
 * - 越界 → 不改（见 `hotkeyEditSlot`）
 */
export function hotkeyAssign(keys: readonly number[], slot: number, code: number): number[] | null {
  if (!HOTKEY_KEY_NAMES.has(code)) return null;
  if (slot < 0 || slot >= keys.length) return null;
  if (code === 0x11) {
    const next = [...keys];
    next[slot] = 0x1100;
    return next;
  }
  const merged = (keys[slot]! | code) & 0xffff;
  for (let i = 0; i < keys.length; i++) {
    if (i !== slot && keys[i] === merged) return null;
  }
  const next = [...keys];
  next[slot] = merged;
  return next;
}

/** 熱鍵頁那一屏要画的样子 */
export interface HotkeyDraw {
  /** 28 条键位（word）*/
  keys: readonly number[];
  /** 正按住的**值**（行 = 1..30 / 钮 = 100..102，就是 `0x48bb9e`）；`null` = 没按 */
  pressed: number | null;
  /** 正在等按键的那一条（数组下标）；`null` = 没在等 */
  capture: number | null;
  /** 等待时那块白底闪到「亮」这一拍 @source `0x48bbaa` */
  blink: boolean;
}

/** 等待按键时那块白底：`(键名中心 x−0x1a, y−7)` 53×13，纯 `0xf0f0f0` @source 0x41129c 起 */
export const HOTKEY_BLINK = { dx: -0x1a, dy: -7, w: 0x35, h: 0xd, fill: '#f0f0f0' } as const;

/**
 * 按下的内容「凹下去」—— 原版 `fcn_00451b9e`（VA 0x451b9e）是**破坏性像素操作**：
 * 整块内容右下各移 1px，再把上边、左边各一条压暗（`fcn_004552e7(…,−16)`，
 * 5 位分量减半）。本引擎每帧重画，所以按同样的观感重画一遍
 * （与商店屏的 `SHOP_CELL_PRESS` 同一套做法，见 `shop-screen.ts`）。
 */
export const HOTKEY_PRESS = { shift: 1, edge: 1, edgeAlpha: 0.5 } as const;

/** 按住时凹下去的那一块 —— 行用行矩形、钮用钮矩形；`null` = 这个值没有对应块 */
export function hotkeyPressedRect(ctrl: number): Rect | null {
  const spot = hotkeySpot(ctrl);
  if (spot !== null) return hotkeyRowRect(spot.col, spot.row);
  const box = HOTKEY_BUTTON_BOXES[ctrl - HOTKEY_CTRL.DEFAULTS];
  return box === undefined ? null : boxRect(box);
}

/** 画熱鍵頁 —— 底图 1（抠黑）→ 三个钮的字 + 名字/键位 28 条 → 等待闪白 → 按下凹块 */
export function drawHotkeyPage(
  ctx: CanvasRenderingContext2D,
  sprite: PageSpriteFn,
  names: readonly string[],
  d: HotkeyDraw,
): void {
  ctx.save();
  ctx.translate(HOTKEY_AT.x, HOTKEY_AT.y);

  const bg = sprite(OPTIONS_RESOURCE, IMG.HOTKEY_PAGE, true);
  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);

  // 三个钮的字（入口 0x411bed 往图 1 里写过的那三条）
  for (let i = 0; i < HOTKEY_BUTTON_LABELS.length; i++) {
    const at = HOTKEY_BUTTON_TEXT[i]!;
    outlined(ctx, HOTKEY_BUTTON_LABELS[i]!, at.x, at.y, HOTKEY_FONT_SIZE, HOTKEY_NAME_COLOR);
  }

  // 28 条：左列 0..13、右列 14..27
  for (let i = 0; i < HOTKEY_COUNT; i++) {
    const col = i < HOTKEY_ROWS ? 0 : 1;
    const row = i - (col === 0 ? 0 : HOTKEY_ROWS);
    const nameAt = hotkeyNameAt(col, row);
    outlined(ctx, names[i] ?? '', nameAt.x, nameAt.y, HOTKEY_FONT_SIZE, HOTKEY_NAME_COLOR);
    const keyAt = hotkeyTextAt(col, row);
    const text = keyText(d.keys[i] ?? 0);
    if (text !== '') {
      outlined(ctx, text, keyAt.x, keyAt.y, HOTKEY_FONT_SIZE, HOTKEY_KEY_COLOR[i < HOTKEY_FIXED ? 0 : 1]!);
    }
  }

  // 等按键时那条闪白 @source 0x411261（WM_TIMER 每 250ms，`0x48bbaa` 取反）
  if (d.capture !== null && d.blink) {
    const col = d.capture < HOTKEY_ROWS ? 0 : 1;
    const row = d.capture - (col === 0 ? 0 : HOTKEY_ROWS);
    const at = hotkeyTextAt(col, row);
    ctx.fillStyle = HOTKEY_BLINK.fill;
    ctx.fillRect(at.x + HOTKEY_BLINK.dx, at.y + HOTKEY_BLINK.dy, HOTKEY_BLINK.w, HOTKEY_BLINK.h);
  }

  // 按住的那一块：内容右下移 1px + 上/左压暗（行与钮都走这一条）
  const pressed = d.pressed;
  const rect = pressed === null ? null : hotkeyPressedRect(pressed);
  if (rect !== null && pressed !== null && bg !== null) {
    const { shift, edge, edgeAlpha } = HOTKEY_PRESS;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    // 连底图那一块一起挪（原版挪的就是屏幕上已经画好的像素）
    ctx.drawImage(bg.bitmap, rect.x, rect.y, rect.w, rect.h, rect.x + shift, rect.y + shift, rect.w, rect.h);
    const spot = hotkeySpot(pressed);
    if (spot !== null) {
      const slot = spot.col === 0 ? pressed - 1 : pressed - 16;
      const nameAt = hotkeyNameAt(spot.col, spot.row);
      outlined(ctx, names[slot] ?? '', nameAt.x + shift, nameAt.y + shift, HOTKEY_FONT_SIZE, HOTKEY_NAME_COLOR);
      const keyAt = hotkeyTextAt(spot.col, spot.row);
      const text = keyText(d.keys[slot] ?? 0);
      if (text !== '') {
        outlined(
          ctx,
          text,
          keyAt.x + shift,
          keyAt.y + shift,
          HOTKEY_FONT_SIZE,
          HOTKEY_KEY_COLOR[slot < HOTKEY_FIXED ? 0 : 1]!,
        );
      }
    } else {
      const i = pressed - HOTKEY_CTRL.DEFAULTS;
      const at = HOTKEY_BUTTON_TEXT[i];
      if (at !== undefined) {
        outlined(
          ctx,
          HOTKEY_BUTTON_LABELS[i] ?? '',
          at.x + shift,
          at.y + shift,
          HOTKEY_FONT_SIZE,
          HOTKEY_NAME_COLOR,
        );
      }
    }
    ctx.globalAlpha = edgeAlpha;
    ctx.fillStyle = '#000000';
    ctx.fillRect(rect.x, rect.y, rect.w, edge);
    ctx.fillRect(rect.x, rect.y, edge, rect.h);
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================
//  通用 YES/NO 框 —— fcn_00453a32 / fcn_0045367e
// ============================================================

/** 底图 = `Data.mkf` 资源 440 图 0/1/2（96×48）—— `read_mkf` @0x00453a50 的 `push 0x1b8` */
export const YESNO_RESOURCE = 0x1b8;
export const YESNO_W = 96;
export const YESNO_H = 48;
/** 调用点传的中心 (0x140, 0xc8) = (320,200) @source 0x004108ec 的两次 `push` */
export const YESNO_CENTER = { x: 0x140, y: 0xc8 } as const;
/** `fcn_00453a32` 自己把中心折成左上角：`x = 中心x − w/2`、`y = 中心y − h/2` @source 0x00453a69 起 */
export const YESNO_AT = {
  x: YESNO_CENTER.x - (YESNO_W >> 1),
  y: YESNO_CENTER.y - (YESNO_H >> 1),
} as const;

/**
 * 鼠标在哪一半（舞台坐标）：**1 = 左半 = YES、2 = 右半 = NO**、框外 = `null`。
 *
 * @source `0x00453745` 起：`sel = (relx / (w/2)) + 1`（`idiv` = 向零取整）；
 *   一旦不在框内（`relx < 0 || relx >= w || rely < 0 || rely >= h`）就把高亮清掉。
 */
export function hitYesNo(sx: number, sy: number): number | null {
  const x = sx - YESNO_AT.x;
  const y = sy - YESNO_AT.y;
  if (x < 0 || y < 0 || x >= YESNO_W || y >= YESNO_H) return null;
  return Math.trunc(x / (YESNO_W >> 1)) + 1;
}

/** 高亮 → 图号（不亮 = 图 0、左半 = 图 1、右半 = 图 2）@source 0x004537e0 的 `12*sel` */
export function yesNoImage(hot: number | null): number {
  return hot === null ? 0 : hot;
}

/** 画 YES/NO 框：三张都是**不抠**（`0x4563f5`）*/
export function drawYesNo(ctx: CanvasRenderingContext2D, sprite: PageSpriteFn, hot: number | null): void {
  blit(ctx, sprite, YESNO_RESOURCE, yesNoImage(hot), YESNO_AT.x, YESNO_AT.y, false);
}

/**
 * 「遊戲中那三颗」答「是」之后往回抛的结局 —— `[0x474d74] − 2`
 * （1 重新遊戲 / 2 認輸投降 / 3 結束遊戲）@source 0x00410911 起。
 */
export type OptionsOutcome = 'restart' | 'surrender' | 'quit';

/** 三颗黄钮的下标（0..2）→ 结局；答「否」= `null`（原版 `cmp eax,1 / jne` 直接什么都不做）*/
export function confirmOutcome(side: number, yes: boolean): OptionsOutcome | null {
  if (!yes) return null;
  const table: readonly (OptionsOutcome | undefined)[] = ['restart', 'surrender', 'quit'];
  return table[side] ?? null;
}
