/*
 * 侧栏与小地图 —— 照原版布局画
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**只读**状态，不含任何规则。
 *
 * 原版的右侧栏是一张 200×280 的整图（`Panel.mkf` 资源 0），
 * 六张一组：
 *   图 0..3 = 資金 / 地產 / 股票 / 其他 四个标签页，
 *             每页三条横栏，左端各带一个图标（錢袋 / 存錢罐 / 金幣堆 …），
 *             右边缘是四个彩色竖标签（青 / 蓝 / 红 / 金）
 *   图 4    = 200×80 的窄版
 *   图 5    = 不带竖标签的版本
 * 这与游戏截图里的右栏完全一致，故数值只需按栏位写上去即可，
 * 不必自己画框。
 */

import {
  PANEL_PAGE_COUNT,
  daysInMonth,
  isHoliday,
  sceneOfMonth,
  weekdayOf,
  type GameState,
  type Rich4Map,
} from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import { portraitResource, type Sprite, type SpriteCache } from './assets.ts';
import type { Camera } from './render.ts';

/** 侧栏整图尺寸 @source Panel.mkf 资源 0 的图 0 */
export const PANEL_WIDTH = 200;
export const PANEL_HEIGHT = 280;

/**
 * 右下角那块 200×200。
 *
 * ★ 它**不是**我们自己加的调试小地图位，原版就有，而且是**可切换**的：
 * ```
 * RICH4.CFG  offset 5:  00 日曆   01 小地圖   02 兩者輪流
 * ```
 * （@source rich4-re/docs/rich4_cfg.txt —— 这是配置文件的字段说明，
 *   不涉及规则，属可信的一类线索。）
 *
 * 日曆那一面的底图就在 `Panel.mkf` 资源 2：
 * - 图 0..3 四季实景，**不带**日曆框（另有他用）
 * - 图 4..7 同样四季，带太阳/月亮与 `S M T W T F S` 那条星期栏 ← 游戏里用的是这组
 * - 图 8/9  24×23 亮/暗太阳；图 10/11 20×20 亮/暗月亮（盖在底图那两个上面）
 */
export const SIDEBAR = { x: 0, y: PANEL_HEIGHT, w: 200, h: 200 } as const;

/**
 * 日曆那一面的版式 —— **全部**取自 exe。日期与節日的算法在 core 的
 * `places/calendar.ts`（那边有完整的出处），这里只放坐标。
 *
 * 原版把这块 200×200 的绘制分成两个版式（@source VA 0x00416a0a 起）：
 *
 * **日曆**（@source VA 0x00416b4c 起）
 * ```asm
 * 00416b7c  底图 = 资源2[ 月份季节表[月-1] ]        ; 图 0..3，纯实景
 * 00416b98  draw(..., 0x1b8, 0x118)                 ; (440, 280) ← 侧栏原点
 * 00416c29  draw(资源2 图8,  0x1ce, 0x12c)          ; 太阳 (462, 300)
 * 00416c4b  draw(资源2 图11, 0x1ec, 0x12d)          ; 月亮 (492, 301)
 * 00416cbf  draw(星期名[今天], 0x1c6, 0x160, 3)      ; (454, 352)
 * 00416d27  draw("%d"  日,  0x1f4, 0x178, 2)        ; (500, 376)
 * 00416d72  draw("%d"  年,  0x244, 0x120, 0)        ; (580, 288)
 * 00416dc7  draw("%d月" 月,  0x1f4, 0x148, 2)        ; (500, 328)
 * ```
 *
 * **月曆**（@source VA 0x00416a0a 起）
 * ```asm
 * 00416a38  底图 = 资源2[ 季节 + 4 ]                ; 图 4..7，带星期栏
 * 00416aa1  esi = 23 × (该月1号是星期几) + 0x1d6    ; 第一格中心 x = 470 + 23w
 * 00416aa7  edi = 0x17a                             ; 第一行 y = 378
 * 00416ad3  今天：填 (x−10, y−6, 20, 14) 红底
 * 00416b33  esi == 0x260(608) → esi = 0x1bf(447)，edi += 0xe(14)   ; 换行
 * 00416b44  esi += 0x17(23)                          ; 下一格
 * ```
 *
 * ★ 七个格心 x = 470..608（步进 23）减去侧栏原点 440 得 30..168，
 *   与底图上那条 `S M T W T F S` 的七个圆点**逐像素对得上**——
 *   两头独立地印证了同一套坐标。
 *
 * ★ 那几个 `draw(串, x, y, flag)` 的**末位 flag 是对齐方式**，语义在
 *   `0x44fabc` 里：`lea eax,[flag-1]` / `jmp [eax*4 + 0x44faa0]`，7 路跳表：
 *
 *   | flag | 水平 | 垂直 |
 *   |---|---|---|
 *   | 0 或 >7 | 左 | 上（**不调整**）|
 *   | 1 | 右 | 上 |
 *   | **2 / 3 / 4** | **中** | **中** |
 *   | 5 | 左 | 中 |
 *   | 6 | 右 | 中 |
 *   | 7 | 中 | 下 |
 *
 *   即 `x`/`y` 是**文字块的中心**（flag 0 除外，那是左上角）——不是左边缘。
 *   这条先前靠截图反推过，读跳表后得到确证。
 */
export const CAL = {
  /** 日曆：太阳、月亮（侧栏内坐标） */
  sun: { x: 0x1ce - 440, y: 0x12c - 280 },
  moon: { x: 0x1ec - 440, y: 0x12d - 280 },
  /** 日曆：年 / 月 / 星期 / 日 */
  year: { x: 0x244 - 440, y: 0x120 - 280 },
  monthText: { x: 0x1f4 - 440, y: 0x148 - 280 },
  weekday: { x: 0x1c6 - 440, y: 0x160 - 280 },
  dayText: { x: 0x1f4 - 440, y: 0x178 - 280 },
  /** 月曆：格子 */
  grid: { x0: 0x1d6 - 440, y0: 0x17a - 280, pitch: 0x17, rowH: 0xe, cols: 7 },
  /** 月曆：今天的红底 */
  today: { dx: -10, dy: -6, w: 0x14, h: 0xe },
} as const;

/** 日曆用的两张小图 —— 太阳与（暗）月亮 @source 0x00416c29 / 0x00416c4b */
const SUN_IMAGE = 8;
const MOON_IMAGE = 11;

/**
 * 太阳与月亮**是按钮** —— 点它们切换「日曆 / 月曆」两个版式。
 *
 * @source VA 0x0041838c 起（棋盘窗口过程里鼠标落在**棋盘之外**的那一支）：
 * ```asm
 * 0041835f  cmp byte [0x49715d], 1     ; cfg+5 = 1（純小地圖）→ 两颗钮都不认
 * 00418366  je  skip
 * 0041836c  cmp esi, 0x1b8 / jle skip  ; x ≤ 440 → 不在侧栏
 * 00418378  cmp edx, 0x118 / jle skip  ; y ≤ 280 → 不在下面那块
 * 00418384  cmp edx, 0x120 / jl  end   ; y ∈ [288, 314]
 * 00418390  cmp edx, 0x13a / jg  end
 * 0041839c  cmp esi, 0x1c0 / jl  moon  ; ★ 太阳：x ∈ [448, 474]
 * 004183a4  cmp esi, 0x1da / jg  moon
 * 004183ac  cmp byte [0x497164], 0 / je end   ; 已经是日曆 → 什么都不做（连音效都不放）
 * 004183c4  mov byte [0x497164], 0            ; ★ 切到日曆
 * 004183d8  cmp esi, 0x1de / jl  end   ; ★ 月亮：x ∈ [478, 504]
 * 004183e4  cmp esi, 0x1f8 / jg  end
 * 004183f0  cmp byte [0x497164], 0 / jne end
 * 0041840c  mov byte [0x497164], 1            ; ★ 切到月曆
 * ```
 * 两处都 `play_sound_effect(1)`（`0x482322`）再 `fcn_004169bc` 重画侧栏。
 *
 * ★ 图号是写死的：日曆面画 **图 8（亮太阳）+ 图 11（暗月亮）**，
 *   `图 9 / 图 10`（暗太阳 / 亮月亮）**全程序一次都没用到** ——
 *   所以这两个钮**没有**「当前在哪一页」的亮暗提示。
 */
export const CAL_TOGGLE_HIT = {
  /** 太阳 = 切到日曆 @source `cmp esi, 0x1c0 / cmp esi, 0x1da` */
  sun: { x0: 0x1c0 - 440, x1: 0x1da - 440 },
  /** 月亮 = 切到月曆 @source `cmp esi, 0x1de / cmp esi, 0x1f8` */
  moon: { x0: 0x1de - 440, x1: 0x1f8 - 440 },
  /** 两颗共用同一段 y @source `cmp edx, 0x120 / cmp edx, 0x13a` */
  y0: 0x120 - 280,
  y1: 0x13a - 280,
} as const;

/** 点在太阳/月亮上返回要切到哪一面；没点中返回 null。坐标是**侧栏局部**（0..200） */
export function hitCalendarToggle(x: number, y: number): 'calendar' | 'month' | null {
  if (y < CAL_TOGGLE_HIT.y0 || y > CAL_TOGGLE_HIT.y1) return null;
  if (x >= CAL_TOGGLE_HIT.sun.x0 && x <= CAL_TOGGLE_HIT.sun.x1) return 'calendar';
  if (x >= CAL_TOGGLE_HIT.moon.x0 && x <= CAL_TOGGLE_HIT.moon.x1) return 'month';
  return null;
}
/** 月曆底图 = 季节 + 4 @source 0x00416a38 `lea ebx, [eax + 4]` */
const MONTH_VIEW_BASE = 4;
/** 假日与今天的颜色 @source 0x00416acc / 0x00416b01 `push 0xff0000` */
const HOLIDAY_COLOR = '#ff0000';
const PLAIN_COLOR = '#101010';

/** 星期名 @source 串表 `0x0047511c[0..6]` */
export const WEEKDAY_NAMES: readonly string[] = [
  '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六',
];

/** 月曆里一格的位置（側欄内坐标） */
export interface MonthCell {
  day: number;
  x: number;
  y: number;
}

/**
 * 一个月在月曆上占哪些格、各在哪 —— **纯函数**，绘制与测试共用。
 *
 * @source 0x00416aa1（第一格 x = `x0 + pitch × 1 号的星期`）
 *         0x00416b33（折行判据 `0x260 = 608` → 側欄坐标 `x0 + pitch×6`）
 *
 * ★ 抽成纯函数是因为它**错过一次**：折行判据写成 `x0 + pitch×cols`（第 8 列）
 *   而不是 `× (cols−1)`（第 7 列），于是每行画 8 天、整月逐行右移一格。
 *   这种错在画面上只是「日期对不上星期」，不细看根本发现不了 ——
 *   但一条「每行恰好 7 格」的断言当场就能抓住。
 */
export function monthCells(year: number, month: number): MonthCell[] {
  const total = daysInMonth(year, month);
  const first = weekdayOf(year, month, 1);
  const { x0, y0, pitch, rowH, cols } = CAL.grid;

  const cells: MonthCell[] = [];
  let col = first;
  let row = 0;
  for (let day = 1; day <= total; day++) {
    cells.push({ day, x: x0 + pitch * col, y: y0 + rowH * row });
    col++;
    if (col >= cols) {
      col = 0;
      row++;
    }
  }
  return cells;
}

/**
 * 右下角显示哪一面。
 * @source RICH4.CFG offset 5：00 日曆 / 01 小地圖 / 02 兩者輪流。
 *   「日曆」这一面自己又分**日曆**与**月曆**两个版式（见 `CAL`）。
 */
export type SidebarView = 'calendar' | 'month' | 'map';


// ============================================================
//  四页（資金 / 地產 / 股票 / 其他）
// ============================================================

/**
 * 四个 tag 的位置与文字。
 *
 * **位置**来自 exe —— @source VA 0x00416123：
 * ```asm
 * mov edx, [esp + ebx*4 + 0x94]      ; 该 tag 的 y（局部数组）
 * add edx, 0x14(20)
 * push 3 / push edx / push 0x273     ; x = 627、flag 3（正中）
 * mov edi, [ebx*4 + 0x475274]        ; 串表：資金/地產/股票/其他
 * ```
 * y 表在 `0x415d0d`（`[15, 88, 158, 230]`）再各 **+20** → 中心 35 / 108 / 178 / 250。
 * ★ 与从 `Panel.mkf` 资源 0 图 0 上**实测**的四条彩色竖条中心
 *   （34.5 / 105.5 / 177.5 / 247.5）逐条吻合，故 exe 的 y 就是竖条中心，保留。
 *
 * **画法**由需求方 2026-09-15 指定，与我们的 exe **不同**：
 * **竖排、白字、字号小一号**（exe 是横排、深色 `0x101010`/`0x404040`、字号 18）。
 * 需求方的实机截图上是白字竖排 —— 与我们 exe 属不同 build，
 * 位置/颜色/排法按需求方定的来，exe 的那套值记在这里备查。
 */
export const PANEL_TAGS = [
  { label: '資金', y: 35 },
  { label: '地產', y: 108 },
  { label: '股票', y: 178 },
  { label: '其他', y: 250 },
] as const;
/** tag 文字的 x（侧栏局部）@source `push 0x273` → 627 − 440 */
export const PANEL_TAG_X = 0x273 - 440;
/**
 * tag 字号 —— **需求方指定「小一点」**（exe 是 0x12 = 18，横排）。
 * 竖排两字时块高 2×14 = 28，正好放进 58 高的竖条；字宽 14 也不超出约 28 的条宽。
 */
const PANEL_TAG_SIZE = 14;
/** 竖排的字距（= 字号，让两字刚好相接） */
const PANEL_TAG_LINE = PANEL_TAG_SIZE;
/**
 * tag 文字色 —— **按 exe**。2026-09-15 需求方改口：先前照实机截图用的是白色，
 * 现在按 exe 改回**深色**。
 *
 * @source VA 0x004161a5 / 0x004161f1：
 * ```asm
 * 004161e7  mov al, byte [esi + 0x48be24]   ; 该玩家当前页
 * 004161ed  cmp ebx, eax                    ; ebx = tag 序号
 * 004161ef  jne 0x4161a5
 * 004161f1  mov eax, 0x101010               ; ★ 当前页 = 近黑
 * 004161f6  jmp 0x4161aa
 * 004161a5  mov eax, 0x404040               ; ★ 其余 = 深灰
 * ```
 */
const PANEL_TAG_COLOR_CURRENT = '#101010';
const PANEL_TAG_COLOR_OTHER = '#404040';

/**
 * 四条彩色竖条的**命中条**（侧栏局部坐标）。
 *
 * @source VA 0x004182fa —— 棋盘区之外的鼠标按下会落到这一支：
 * ```asm
 * cmp esi, 0x268          ; x < 616 → 不是标签
 * jl  skip
 * cmp edx, 0x118          ; y ≥ 280 → 不是标签
 * jge skip
 * mov ebx, 0x46           ; 70
 * mov eax, edx ; idiv ebx ; ★ 页号 = y / 70
 * cmp eax, 该玩家当前页   ; ★ 已经是这页 → 什么都不做（连音效都不放）
 * je  skip
 * play_sound_effect(0x482322) ; 确认音
 * mov byte [player + 0x48be24], bl   ; 换页
 * call fcn_00415f69                  ; 重画面板
 * ```
 * 即：**最右 24px（局部 x∈[176,200)）、整条 280 高、每 70 一格**。
 * 四格的页号与四条竖条的中心（35 / 108 / 178 / 250）一一对得上。
 *
 * ⚠️ 原版这一支前面有 `cfg+5 == 2` 的闸门 —— 因为 `fcn_00415f69` 在
 *   `cfg+5 == 2`（兩者輪流）时**整块面板都不画**（VA 0x004166ed 直接 ret），
 *   没有竖条可点。本引擎任何一态都画面板，故这里不加那道闸门。
 */
export const PANEL_TAG_HIT = { x: 176, h: 70, count: 4 } as const;

/** 点在第几条彩色竖条上；没点中返回 null（坐标是**侧栏局部**） */
export function hitPanelTag(x: number, y: number): number | null {
  if (x < PANEL_TAG_HIT.x || x >= PANEL_WIDTH) return null;
  if (y < 0 || y >= PANEL_TAG_HIT.h * PANEL_TAG_HIT.count) return null;
  return Math.floor(y / PANEL_TAG_HIT.h);
}

/**
 * 四页各自的三行标签。
 *
 * @source VA 0x00417eba 起 —— 原版在开局时把 12 个标签**用代码画进那四张页面图**
 *   （`rich4_draw_text(页面图, 串, 10, y, 0)`），所以 `Panel.mkf` 资源 0 的图里
 *   只有图标、没有文字。串表在 VA `0x463920` 起：
 *   `現  金 / 存  款 / 總資產 / 土  地 / 連鎖店 / 設  施 / 總市值 / 成  本 / 經營權 / 點  卷 / 貸  款 / 保險期`
 *   （串里带双空格是为了对齐，照抄），画的位置 x = 10、y = 80 / 145 / 208、字号 12、flag 0。
 */
export const PANEL_ROWS: readonly (readonly [string, string, string])[] = [
  ['現  金', '存  款', '總資產'],
  ['土  地', '連鎖店', '設  施'],
  ['總市值', '成  本', '經營權'],
  ['點  卷', '貸  款', '保險期'],
];
/** 行标签的 x / y（侧栏局部）@source VA 0x00417eba 的 `push 0xa` 与 `push 0x50/0x91/0xd0` */
export const PANEL_ROW_LABEL_X = 0xa;
export const PANEL_ROW_LABEL_Y = [0x50, 0x91, 0xd0] as const;
/** 行标签字号 @source `push 0xc` */
const PANEL_LABEL_SIZE = 0xc;
/**
 * 每页三行数值的**顶端** y 与右对齐 x。
 * @source `fcn_00415f69` 的四个页处理函数：一律 `push 1 / push y / push 0x258(600)`，
 *   flag 1 = 右上 —— 即 `y` 是文字块的**顶边**，x 是右缘。
 *
 * ★ 底图上那三条浅蓝横栏的 y 范围约 `96..128 / 160..192 / 224..256`
 *   （中心 112 / 176 / 240，间距 64）；22 号字落在顶边 102 时视觉中心正好
 *   ≈ 112 —— **两套数一致**，别只信一套。
 */
export const PANEL_VALUE_RIGHT = 0x258 - 440;
export const PANEL_VALUE_Y = [0x66, 0xa6, 0xe6] as const;
/** 数值字号 @source `push 0x16` */
const PANEL_VALUE_SIZE = 0x16;

export interface HudInput {
  state: GameState;
  map: Rich4Map;
  camera: Camera;
  /** 小地图底图（`map.mkf` 资源 `地图号+0x10` 图 0，200×200）；null 时只画节点 */
  minimapBg: ImageBitmap | null;
  /** 右下角那 200×200 现在显示哪一面 */
  sidebarView: SidebarView;
  /**
   * 小地图上的**标记点**（世界坐标）—— 点小地图留下的十字位置。
   * null 表示没有。
   * @source 原版 `[0x48be18]`（非 0 表示有标记）+ `[0x48be1c]`/`[0x48be20]`（坐标）
   */
  minimapMarker: { x: number; y: number } | null;
  /** 正被按下的箭头（1 = 左，2 = 右）；没按返回 null */
  pressedMinimapArrow: MinimapArrowId | null;
  /** 鼠标悬停的箭头；没悬停返回 null */
  hotMinimapArrow: MinimapArrowId | null;
  /**
   * 今天若逢節日，那张专属插画（`Data.mkf` 的 200×200 裸位图）——
   * 整张盖掉季节底图。非節日或无图时给 null。
   * @source VA 0x00416baf 起
   */
  holidayArt: ImageBitmap | null;
  /**
   * 側欄现在显示第几页（0 資金 / 1 地產 / 2 股票 / 3 其他）。
   * **每个玩家一份**（原版 `0x48be24 + 玩家号`），由 PgUp/PgDn 切换。
   */
  panelPage: number;
  /** 该页三行的文字（已按该页的格式排好），与 `PANEL_ROWS[page]` 一一对应 */
  panelRows: readonly string[];
}

/**
 * 点在右下角那块 200×200 上吗？
 *
 * ★ **原版点这块只是「点」，不会换面。** 换面只有两条路：
 *   RICH4.CFG offset 5 的设定，或 `HOTKEY.switchOption`/`switchWindowGroup`
 *   那对热键（VA 0x00401219 起，`[0x49715d] = ([0x49715d] + 1) % 3`）。
 *   先前「点一下换一面」是我们自己加的（`C-FID-1` 禁止的改良），已去掉。
 */
export function hitSidebar(x: number, y: number): boolean {
  return x >= SIDEBAR.x && x < SIDEBAR.x + SIDEBAR.w
    && y >= SIDEBAR.y && y < SIDEBAR.y + SIDEBAR.h;
}

// ============================================================
//  小地圖（側欄右下角那 200×200）
// ============================================================

/**
 * 世界坐标 → 小地图局部坐标（0..200）。
 *
 * @source VA 0x00416fb9（侧栏小地图）与 0x0040a8a1（独立小地图窗口），
 *   两处是同一段被编译出来的定点乘法：
 * ```asm
 * mov cx, word [player + 8]      ; 世界 x
 * mov eax, ecx
 * shl eax, 2 / sub eax, ecx      ; ×3
 * shl eax, 2 / sub eax, ecx      ; ×11
 * shl eax, 3 / add eax, ecx      ; ×89
 * shl eax, 6                     ; ×64
 * sar eax, 0x10                  ; (x×89×64) >> 16 == (x×89) >> 10 == x × 89/1024
 * lea esi, [eax + 0x1b8]         ; + 440 ← 侧栏原点
 * ```
 * 独立窗口那处 `shl eax, 7`（`>> 9`），正好是这里的**两倍** ——
 * 因为它是 400×400、这里是 200×200。
 *
 * ★ 2304 × 89 ÷ 1024 = 200.25 → 取整 200。世界宽 2304、这块 200 见方，
 *   这套整数运算就是原版「把整张图塞进 200×200」的写法。**别改成
 *   `size / worldW` 的浮点**：差 0.1%，逐像素对不齐。
 */
export const MINIMAP_NUM = 89;
export const MINIMAP_SHIFT = 10;

/** 世界坐标 → 小地图局部坐标（照原版的整数运算） */
export function minimapAt(world: number): number {
  return (world * MINIMAP_NUM) >> MINIMAP_SHIFT;
}

/**
 * 小地图**局部坐标 → 世界坐标** —— 点小地图时用。
 *
 * @source VA 0x00418591（按下）与 0x0041899b（拖动），同一段定点乘法：
 * ```asm
 * mov eax, ebx                   ; ebx = 局部 x
 * shl eax, 2 / sub eax, ebx      ; ×3
 * shl eax, 0xd                   ; ×8192
 * mov ebx, eax
 * shl eax, 5 / sub eax, ebx      ; ×31
 * sar eax, 0x10                  ; (x×3×8192×31) >> 16 == x × 93/8
 * ```
 * ★ 它与 `minimapAt` **不是精确互逆**（93/8 = 11.625 对 1024/89 = 11.5056，
 *   差 1%）。原版就是这样，照抄 —— 自己「修正」成互逆反而与原版不符。
 */
export const MINIMAP_INV_NUM = 93;
export const MINIMAP_INV_DEN = 8;

/** 小地图局部坐标 → 世界坐标（照原版的整数运算） */
export function minimapToWorld(local: number): number {
  return Math.trunc((local * MINIMAP_INV_NUM) / MINIMAP_INV_DEN);
}

/**
 * 点小地图时，镜头中心被夹在这个区间。
 *
 * @source VA 0x004185d8 起：算出世界坐标后逐轴夹紧 ——
 * ```asm
 * cmp ebx, 0xdc(220)   / jge … / mov [0x48be1c], 0xdc
 * cmp ebx, 0x824(2084)/ jle … / mov [0x48be1c], 0x824
 * ```
 * `220 … 2084` 正是 `[220, 2304 − 220]`：棋盘区宽 440，镜头中心离边 220
 * 时视口刚好贴住世界边界（VA 0x00417f98 `set_draw_area(0, 40, 440, 480)`）。
 */
export const MINIMAP_CENTER_MIN = 0xdc; // 220
export const MINIMAP_CENTER_MAX = 0x824; // 2084

export function clampCameraCenter(world: number): number {
  return Math.min(MINIMAP_CENTER_MAX, Math.max(MINIMAP_CENTER_MIN, world));
}

/**
 * 小地图左上角那两颗**左右箭头**（转视角）。
 *
 * @source VA 0x00418415（命中，`fcn_00417e26` 的 WM_LBUTTONDOWN 分支）：
 * ```asm
 * sub ebx, 0x1b8          ; ebx = 局部 x
 * sub esi, ecx            ; esi = 局部 y（ecx = 该态侧栏顶边，见 0x4752aa）
 * cmp ebx, 3    / jl  → 落回「主体」
 * cmp ebx, 0x35 / jg  → 落回「主体」      ; 3 <= x <= 53
 * cmp esi, 3    / jl  → 落回「主体」
 * cmp esi, 0x1c / jg  → 落回「主体」      ; 3 <= y <= 28
 * lea edx, [ebx - 3]
 * mov ebx, 0x19(25) ; idiv ebx ; inc eax  ; ★ 编号 = (x-3)/25 + 1
 * ```
 * 画的时候是 `443 + 25×(编号-1)`（VA 0x00416e89 与 0x00416e9c 分别
 * `+0xfc`(图20) 与 `+0x108`(图21)），与局部 3、28 逐像素吻合。
 */
export const MINIMAP_ARROW = { x: 3, y: 3, w: 25, h: 26 } as const;

/** 箭头编号 → 侧栏局部矩形（1 = 左，2 = 右） */
export function minimapArrowRect(id: MinimapArrowId): { x: number; y: number; w: number; h: number } {
  return {
    x: MINIMAP_ARROW.x + (id - 1) * MINIMAP_ARROW.w,
    y: MINIMAP_ARROW.y,
    w: MINIMAP_ARROW.w,
    h: MINIMAP_ARROW.h,
  };
}

export type MinimapArrowId = 1 | 2;

/**
 * 局部坐标落在哪颗箭头上；不在箭头上返回 null。
 *
 * ★ 原版的判据是 `x ∈ [3, 53]`，比两颗按钮合起来（3..52）**宽 1 像素**，
 *   那一像素会算出编号 3 —— 而编号只在 WM_LBUTTONUP 的
 *   `cmp bl,1 / cmp bl,2`（VA 0x004186f3）处被读，所以编号 3 是死区。
 *   这里照原样返回 null。
 */
export function hitMinimapArrow(localX: number, localY: number): MinimapArrowId | null {
  const { x, y, w, h } = MINIMAP_ARROW;
  if (localX < x || localX > x + 2 * w) return null;
  if (localY < y || localY > y + h - 1) return null;
  const id = Math.floor((localX - x) / w) + 1;
  return id === 1 || id === 2 ? id : null;
}

/** 局部坐标落在小地图**本体**上（不是箭头条，也不是框外） */
export function hitMinimapBody(localX: number, localY: number): boolean {
  if (localX < 0 || localX >= SIDEBAR.w) return false;
  if (localY < 0 || localY >= SIDEBAR.h) return false;
  return hitMinimapArrow(localX, localY) === null;
}

/**
 * 小地图上那两颗箭头的图 —— `Data.mkf` 资源 517。
 * @source VA 0x00407fdc `[0x48bad8] = read_mkf(Data.mkf, 0x205, 0, 0)`
 */
export const MINIMAP_ARROW_RESOURCE = 0x205;
/**
 * 图的编号。常态在 VA 0x00416e89/0x00416e9c 由偏移 `+0xfc`/`+0x108` 得出：
 * `(偏移 − 0x0c) / 12`（精灵表每张 12 字节头，从 `+0x0c` 起）→ **20 / 21**。
 * 高亮态在 VA 0x00418415 处是 `[0x48bad8] + 0x0c + 12 × (编号 + 0x11)` → **18 / 19**。
 */
export const MINIMAP_ARROW_IMAGE = {
  normal: { 1: 20, 2: 21 },
  hot: { 1: 18, 2: 19 },
} as const;

/**
 * 取景框与标记框的边长 —— **30×30 像素**。
 * @source VA 0x00417041（取景）与 0x004170c7（标记），两处都
 *   `push 0x1e(30) / push 0x1e(30)`，并各自 `−0xf(15)` 居中。
 *
 * ★ 它框的是**当前玩家那个圆点**，不是「视口能看到的世界范围」——
 *   先前我们画成 29 格宽的窗口，那是自己想的（原版没有这个东西）。
 */
export const MINIMAP_BOX = 30;

export class Hud {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  readonly #ready = new Map<string, Sprite | null>();
  readonly #pending = new Set<string>();
  #dirty = false;
  /** 解码落地时叫一声 —— 理由同 `BoardRenderer.#onReady` */
  #onReady: (() => void) | null = null;

  constructor(ctx: CanvasRenderingContext2D, sprites: SpriteCache) {
    this.#ctx = ctx;
    this.#sprites = sprites;
  }

  /** 由宿主注入「再画一帧」 */
  set onSpriteReady(fn: () => void) {
    this.#onReady = fn;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  clearDirty(): void {
    this.#dirty = false;
  }

  /** 同步取精灵；未就绪时后台解码并返回 null */
  #sprite(
    archive: 'Panel.mkf' | 'map.mkf' | 'Data.mkf',
    res: number,
    idx: number,
    colorKeyBlack = false,
  ): Sprite | null {
    const key = `${archive}:${res}:${idx}:${colorKeyBlack ? 'k' : ''}`;
    const hit = this.#ready.get(key);
    if (hit !== undefined) return hit;
    if (!this.#pending.has(key)) {
      this.#pending.add(key);
      void this.#sprites.get(archive, res, idx, colorKeyBlack).then((s) => {
        this.#ready.set(key, s);
        this.#pending.delete(key);
        this.#dirty = true;
        this.#onReady?.();
      });
    }
    return null;
  }

  draw(input: HudInput): void {
    const ctx = this.#ctx;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    this.#drawPanel(input);
    if (input.sidebarView === 'calendar') this.#drawCalendar(input);
    else if (input.sidebarView === 'month') this.#drawMonth(input);
    else this.#drawMinimap(input, SIDEBAR.y);
  }

  /**
   * 日曆面 —— 大图 + 年月日星期。版式全部照 exe，见 `CAL`。
   *
   * ★ **節日那天整张换掉底图**：原版取 `Data.mkf` 里按
   *   `HOLIDAY_ART_BASE[地图号] + 節日序号` 算出的那张 200×200 插画盖上去
   *   （@source VA 0x00416baf 起，载入在 0x00416bf3、绘制在 0x00416c12）。
   *   非節日才画季节底图 —— 两者**互斥**，不是叠加。
   */
  #drawCalendar(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year, globalMapId } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    if (input.holidayArt !== null) {
      ctx.drawImage(input.holidayArt, ox, oy, w, h);
    } else {
      const bg = this.#sprite('Panel.mkf', 2, sceneOfMonth(month));
      if (bg !== null) ctx.drawImage(bg.bitmap, ox, oy, w, h);
      else {
        ctx.fillStyle = '#7f9fbf';
        ctx.fillRect(ox, oy, w, h);
      }
    }

    // 太阳与月亮 —— 图 0..3 没有烤这两个，所以这里必须画
    const sun = this.#sprite('Panel.mkf', 2, SUN_IMAGE, true);
    if (sun !== null) ctx.drawImage(sun.bitmap, ox + CAL.sun.x, oy + CAL.sun.y);
    const moon = this.#sprite('Panel.mkf', 2, MOON_IMAGE, true);
    if (moon !== null) ctx.drawImage(moon.bitmap, ox + CAL.moon.x, oy + CAL.moon.y);

    const holiday = isHoliday(globalMapId, year, month, day);
    const text = (
      s: string,
      at: { x: number; y: number },
      align: CanvasTextAlign,
      font: string,
      fill: string,
    ): void => {
      ctx.font = font;
      ctx.textAlign = align;
      // ★ `flag 2/3/4` 在 exe 里**只调 x、不碰 y**（详见 CAL 上方的说明），
      //   所以 y 是文字块的**顶边**，不是中心。
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(s, ox + at.x, oy + at.y);
      ctx.fillStyle = fill;
      ctx.fillText(s, ox + at.x, oy + at.y);
    };
    // ★ 字号与对齐**全部**取自 exe（VA 0x00416cee..0x00416dd3）：
    //   `set_font` 紧挨在 `sprintf` 之前，作用于**紧接着的那一次** draw。
    //
    //   | 文字 | 字号 | flag | 对齐（查 0x44faa0 的跳表） |
    //   |---|---|---|---|
    //   | 日号 | `0x3c` = **60** | 2 | 正中 |
    //   | 年   | `0x18` = **24** | 0 | **左上**（flag 0 不调整，就是左上角）|
    //   | 月   | `0x1c` = **28** | 2 | 正中 |
    //   | 星期 | `0x10` = **16** | 3 | 正中 |
    //
    //   ⚠️ 先前这几个字号写的是 15 / 34，是从画面上目测的；年份还一度被改成居中
    //   （也是我的推断）。都以这段汇编为准。
    const small = '16px "PingFang TC", "Microsoft JhengHei", sans-serif';
    const dayFont = '60px "PingFang TC", "Microsoft JhengHei", sans-serif';

    // 年与月 —— 与月曆共用同一段（见 `#drawYearMonth`）
    this.#drawYearMonth(input);
    // ★ 星期名是**竖排**（一个字一行）。
    //
    //   这一条是**需求方的实机截图**定的（2026-09-15）：截图上「星期五」三个字上下叠着，
    //   与侧栏那四个 tag 是同一种排法。串表本身没有换行（`0x47511c` 指针表里
    //   「星期五」就是 6 字节 + NUL），所以竖排是**绘制侧**的事 ——
    //   与 tag 一样：`create_font` 的第 5 个参数（`[0x4762dc]`）为 1 时走竖排，
    //   走横排的那几处（货架、资产表标签）那一项都是 0。
    //
    //   ★ 竖排之后这一块只有 **16px 宽**，居中于局部 x=14 → 6..22，**正好在侧栏里**。
    //     （先前按横排算会得到 −10、以为要溢出到棋盘上 —— 那是读错排法导致的。）
    const wd = WEEKDAY_NAMES[weekdayOf(year, month, day)] ?? '';
    const wdFill = holiday ? HOLIDAY_COLOR : PLAIN_COLOR;
    [...wd].forEach((ch, k) => {
      // 竖排：x 由 `CAL.weekday.x` 居中，y 从顶边起逐字向下（字距 = 字号）
      text(ch, { x: CAL.weekday.x, y: CAL.weekday.y + k * PANEL_TAG_LINE }, 'center', small, wdFill);
    });
    text(
      String(day),
      CAL.dayText,
      'center',
      dayFont,
      holiday ? HOLIDAY_COLOR : PLAIN_COLOR,
    );
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 月曆面 —— 整月的格子。
   *
   * 底图 4..7 上那条 `S M T W T F S` 就是这个版式的表头，格子正好排在它下面。
   */
  #drawMonth(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year, globalMapId } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    const bg = this.#sprite('Panel.mkf', 2, MONTH_VIEW_BASE + sceneOfMonth(month));
    if (bg !== null) ctx.drawImage(bg.bitmap, ox, oy, w, h);
    else {
      ctx.fillStyle = '#7f9fbf';
      ctx.fillRect(ox, oy, w, h);
    }

    ctx.font = '12px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of monthCells(year, month)) {
      const { x, y } = cell;
      if (cell.day === day) {
        // @source 0x00416ad3：今天填一块红底
        ctx.fillStyle = HOLIDAY_COLOR;
        ctx.fillRect(ox + x + CAL.today.dx, oy + y + CAL.today.dy, CAL.today.w, CAL.today.h);
      }
      ctx.fillStyle = isHoliday(globalMapId, year, month, cell.day) ? HOLIDAY_COLOR : PLAIN_COLOR;
      if (cell.day === day) ctx.fillStyle = '#ffffff'; // 红底上要看得见
      ctx.fillText(String(cell.day), ox + x, oy + y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // ★ **月曆也要画年与月** —— 两个版式在 exe 里是**共用一条尾巴**的：
    //   日曆那支画完星期名与日号、月曆那支画完格子，**都跳/落到 0x00416d3b**，
    //   那一支才是画「年 + 月」的地方（`create_font(0x18)` → itoa(年) →
    //   `draw_text(x=0x244, y=0x120, flag 0)`；再 `create_font(0x1c)` →
    //   `sprintf("%d月")` → `draw_text(x=0x1f4, y=0x148, flag 2)`）。
    //   ⚠️ 先前只在日曆那面画了年月，月曆那面只有格子 —— 与需求方的原版截图对不上。
    this.#drawYearMonth(input);
  }

  /**
   * 年与月 —— **日曆与月曆两个版式共用** @source VA 0x00416d3b（年）/ 0x00416d86（月）。
   *
   * 年：24 号、（局部）左上 (140,8)、flag 0；月：28 号、水平居中 (60,48)、flag 2。
   */
  #drawYearMonth(input: HudInput): void {
    const ctx = this.#ctx;
    const { month, year } = input.state;
    const { x: ox, y: oy } = SIDEBAR;
    const line = (
      s: string,
      at: { x: number; y: number },
      align: CanvasTextAlign,
      size: number,
    ): void => {
      ctx.font = `${size}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = align;
      // flag 0 / 2 都**只调 x**（跳表 `0x44faa0` 按 `flag−1` 索引），y 是顶边
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(s, ox + at.x, oy + at.y);
      ctx.fillStyle = PLAIN_COLOR;
      ctx.fillText(s, ox + at.x, oy + at.y);
    };
    line(String(year), CAL.year, 'left', 24);
    line(`${month}月`, CAL.monthText, 'center', 28);
  }

  #drawPanel(input: HudInput): void {
    const ctx = this.#ctx;
    const me = input.state.players[input.state.currentPlayer];
    if (me === undefined) return;

    // 背景：**该玩家当前那一页**（Panel.mkf 资源 0 的图 0..3）@source VA 0x00416123
    const page = input.panelPage % PANEL_PAGE_COUNT;
    const bg = this.#sprite('Panel.mkf', 0, page);
    if (bg !== null) {
      ctx.drawImage(bg.bitmap, 0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    } else {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    }

    // 四个 tag（右缘竖条）—— **竖排、小一号**（排法仍按需求方的实机截图，
    // 颜色 2026-09-15 按 exe 改回深色：当前页 `0x101010`、其余 `0x404040`）
    ctx.font = `${PANEL_TAG_SIZE}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    PANEL_TAGS.forEach((tag, i) => {
      ctx.fillStyle = i === input.panelPage ? PANEL_TAG_COLOR_CURRENT : PANEL_TAG_COLOR_OTHER;
      const chars = [...tag.label];
      // 整块以竖条中心为准，逐字向下排
      const y0 = tag.y - ((chars.length - 1) * PANEL_TAG_LINE) / 2;
      chars.forEach((ch, k) => ctx.fillText(ch, PANEL_TAG_X, y0 + k * PANEL_TAG_LINE));
    });

    // 头像
    // ★ 头像也是 SMP，黑是抠图底色；不抠就会顶着一块黑框
    const face = this.#sprite('map.mkf', portraitResource(me.character), 0, true);
    if (face !== null) {
      // @source VA 0x0041618f `fcn_00456418(surface, 头像图, 0x1e2(482), 0x28(40))`
      //   —— 那两数是**锚点**落点，故按锚点画（侧栏局部 = 屏幕 − 440）
      ctx.drawImage(face.bitmap, 0x1e2 - 440 - face.anchorX, 0x28 - face.anchorY);
    }

    // 名字下面那条**角色色长条**（截图上那条红带）——
    // @source VA 0x004161f8 起两次 `fcn_004561be`（= 填充矩形）：
    //   黑 86×12 @(523,57)，再角色色 86×12 @(522,56) ⇒ 角色色块 + 1px 黑边
    const cc = CHARACTERS[me.character]?.color ?? 0xffffff;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0x20b - 440, 0x39 - 1, 0x56, 0xc + 2);
    ctx.fillStyle = `rgb(${(cc >> 16) & 0xff},${(cc >> 8) & 0xff},${cc & 0xff})`;
    ctx.fillRect(0x20a - 440, 0x38, 0x56, 0xc);

    // 姓名 ── @source VA 0x00416288 `draw_text(0, 名字, 0x234(564), 0x28(40), 2)`（flag 2 = 正中）
    ctx.fillStyle = '#101010';
    ctx.font = `${PANEL_VALUE_SIZE}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = CHARACTERS[me.character]?.name ?? `角色${me.character}`;
    ctx.fillText(name, 0x234 - 440, 0x28);
    if (me.whoPlays === 0) {
      ctx.fillStyle = '#a02a20';
      ctx.font = '12px "PingFang TC", sans-serif';
      ctx.fillText('（出局）', 0x234 - 440, 0x28 + 18);
    }

    // 三行标签（**原版是开局画进页面图的**，这里每帧照同样的坐标画）@source VA 0x00417eba
    const labels = PANEL_ROWS[page] ?? PANEL_ROWS[0]!;
    ctx.fillStyle = '#101010';
    ctx.font = `${PANEL_LABEL_SIZE}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < PANEL_ROW_LABEL_Y.length; i++) {
      ctx.fillText(labels[i]!, PANEL_ROW_LABEL_X, PANEL_ROW_LABEL_Y[i]!);
    }

    // 三行数值 —— 每页算的量不同，见 core 的 `panelValues`；文字由调用方
    // （client/panel.ts 的 `panelRows`）按各页的格式排好再传进来
    // @source VA 0x004162d4 / 0x00416355 / 0x0041646c / 0x004165e1
    ctx.font = `${PANEL_VALUE_SIZE}px "PingFang TC", monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#101010';
    for (let i = 0; i < PANEL_VALUE_Y.length; i++) {
      ctx.fillText(input.panelRows[i] ?? '', PANEL_VALUE_RIGHT, PANEL_VALUE_Y[i]!);
    }

    // 物价指数 ── @source VA 0x004161b8 `sprintf(格式 0x4638f5, 指数)` 后
    //   `draw_text(0, 串, 0x1c2(450), 0x104(260), 0)`；串本身就是「物價指數  %d」
    //   （5 个汉字 + 两个空格 + %d），故不必自己拼
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `${PANEL_LABEL_SIZE}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.fillStyle = '#101010';
    ctx.fillText(`物價指數  ${input.state.priceIndex}`, 0x1c2 - 440, 0x104);
  }

  /**
   * 小地图（侧栏右下角那 200×200）—— 全部照 `fcn_00416e6d`（VA 0x00416e6d）。
   *
   * 层次**按原版的绘制顺序**：
   * ```asm
   * 00416e78  底图 = [0x48badc] 图0（map.mkf 资源 地图号+0x10 的 200×200 成品图）
   * 00416e89  左箭头 = [0x48bad8]+0xfc（Data.mkf 517 图20）  画在 (443, 顶+3)
   * 00416e9c  右箭头 = [0x48bad8]+0x108（图21）              画在 (468, 顶+3)
   * 00416fb9  各玩家的圆点（按 (世界×89)>>10 定位）
   * 00417041  当前玩家：30×30 白框，中心在它的圆点上
   * 004170c7  标记点：30×30 红框（与当前玩家重合时不画）
   * ```
   * 底图是**预先算好的成品图**，不是拿 `.gnd` 现缩 —— 比例与取景都不同。
   */
  #drawMinimap(input: HudInput, top: number): void {
    const ctx = this.#ctx;
    const { state, map, minimapBg, minimapMarker } = input;
    const size = SIDEBAR.w;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, size, size);
    ctx.clip();

    ctx.fillStyle = '#0a1730';
    ctx.fillRect(0, top, size, size);
    if (minimapBg !== null) ctx.drawImage(minimapBg, 0, top, minimapBg.width, minimapBg.height);

    // 各格
    for (const n of map.nodes) {
      const owner = n.ref.kind === 'land' ? (state.landOwner[n.ref.index] ?? 0) : 0;
      ctx.fillStyle =
        owner === 0 ? 'rgba(240,240,240,0.75)' : (MINIMAP_OWNER[owner - 1] ?? '#fff');
      ctx.fillRect(minimapAt(n.x) - 1, top + minimapAt(n.y) - 1, 3, 3);
    }

    // 两颗箭头 —— 画在圆点之前（原版就是这个顺序），状态色见 #arrowImage
    for (const id of [1, 2] as const) {
      const r = minimapArrowRect(id);
      const hot = input.hotMinimapArrow === id || input.pressedMinimapArrow === id;
      const img = this.#sprite(
        'Data.mkf',
        MINIMAP_ARROW_RESOURCE,
        hot ? MINIMAP_ARROW_IMAGE.hot[id] : MINIMAP_ARROW_IMAGE.normal[id],
        true,
      );
      // ★ `fcn_00456418` 把图按**锚点**摆（VA 0x00455c64 `sub [ebp+0x18], anchorX`），
      //   所以「画在 (443, 顶+3)」指的是锚点落在那儿。
      if (img !== null) ctx.drawImage(img.bitmap, r.x - img.anchorX, top + r.y - img.anchorY);
    }

    // 棋子（圆点），并记下**当前玩家**的圆点位置
    const me = state.players[state.currentPlayer];
    let meDot: { x: number; y: number } | null = null;
    for (const p of state.players) {
      if (p.whoPlays === 0) continue;
      const n = map.nodes[p.nodeId - 1];
      if (n === undefined) continue;
      const dx = minimapAt(n.x);
      const dy = top + minimapAt(n.y);
      if (p.index === me?.index) meDot = { x: dx, y: dy };
      ctx.fillStyle = MINIMAP_OWNER[p.index] ?? '#fff';
      ctx.beginPath();
      ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 取景框：**当前玩家的圆点**上画 30×30 白框 @source VA 0x00417041
    // 标记框：标记点上画 30×30 红框，与当前玩家重合时不画 @source VA 0x004170c7
    const box = (cx: number, cy: number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - MINIMAP_BOX / 2, cy - MINIMAP_BOX / 2, MINIMAP_BOX, MINIMAP_BOX);
    };
    if (minimapMarker !== null) {
      const mx = minimapAt(minimapMarker.x);
      const my = top + minimapAt(minimapMarker.y);
      if (meDot === null || mx !== meDot.x || my !== meDot.y) box(mx, my, MINIMAP_MARKER_COLOR);
    }
    if (meDot !== null) box(meDot.x, meDot.y, MINIMAP_VIEW_COLOR);

    ctx.restore();
  }
}

/** 小地图上各玩家的颜色 —— 原版四人四色 */
const MINIMAP_OWNER = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;

/**
 * 取景框是**白的**、标记框是**红的**。
 * @source VA 0x00417041 `push 0xffffff` / VA 0x004170c7 `push 0xff0000`
 */
const MINIMAP_VIEW_COLOR = '#ffffff';
const MINIMAP_MARKER_COLOR = '#ff0000';
